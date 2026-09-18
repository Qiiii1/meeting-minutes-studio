const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const context = await browser.newContext({ permissions: ['microphone'] });
  await context.addInitScript(() => {
    window.__sockets = [];
    navigator.mediaDevices.getDisplayMedia = async () => {
      const context = new AudioContext({ sampleRate: 48000 });
      await context.resume();
      const output = context.createMediaStreamDestination();
      const tone = context.createOscillator();
      tone.frequency.value = 880;
      tone.connect(output);
      tone.start();
      window.__sharedAudioContext = context;
      return output.stream;
    };
    class Socket {
      static OPEN = 1;
      static CLOSED = 3;
      constructor(url) {
        this.url = url;
        this.readyState = 1;
        this.bufferedAmount = 0;
        this.frames = [];
        window.__sockets.push(this);
        setTimeout(() => this.onmessage?.({ data: JSON.stringify({ action: 'started', code: '0' }) }), 10);
      }
      send(data) {
        const bytes = new Uint8Array(data);
        if (bytes[0] === 123 && bytes.length < 100) {
          this.result('结束时的最后一句。', true, 1);
          setTimeout(() => this.close(), 10);
        } else this.frames.push(bytes);
      }
      result(text, final, id = 0) {
        this.onmessage?.({ data: JSON.stringify({
          action: 'result', data: JSON.stringify({
            seg_id: id, cn: { st: { bg: '100', type: final ? '0' : '1', rt: [{ ws: [{ cw: [{ w: text }] }] }] } }
          })
        }) });
      }
      close() { this.readyState = 3; this.onclose?.(); }
    }
    window.WebSocket = Socket;
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  for (const input of ['', 'abc', '595f23df1512041814', '你好世界', 'x'.repeat(100)]) {
    assert.equal(await page.evaluate(x => XfyunASR.md5(x), input), crypto.createHash('md5').update(input).digest('hex'));
  }
  const url = await page.evaluate(() => XfyunASR.signedUrl('example-app', 'test-only-key', '1512041814'));
  const expected = crypto.createHmac('sha1', 'test-only-key').update(crypto.createHash('md5').update('example-app1512041814').digest('hex')).digest('base64');
  assert.equal(new URL(url).searchParams.get('signa'), expected);
  assert(!url.includes('test-only-key'));
  await page.locator('.hero .start-meeting:not([data-mode])').click();
  await page.locator('#asr-dialog').waitFor();
  await page.locator('[name=appId]').fill('example-app');
  await page.locator('[name=apiKey]').fill('test-only-key');
  await page.locator('#asr-form [type=submit]').click();
  await page.locator('#asr-dialog').waitFor({ state: 'hidden' });
  await page.locator('.hero .start-meeting:not([data-mode])').click();
  await page.locator('#finish-recording').waitFor();
  await page.waitForFunction(() => document.querySelector('#recognition-status').textContent.includes('讯飞已连接'));
  await page.waitForTimeout(1250);
  const frames = await page.evaluate(() => window.__sockets.at(-1).frames.map(f => f.byteLength));
  assert(frames.length > 10);
  assert(frames.every(n => n === 1280));
  await page.evaluate(() => window.__sockets.at(-1).result('中间文本', false));
  assert((await page.locator('.interim').innerText()).includes('中间文本'));
  await page.evaluate(() => {
    window.__sockets.at(-1).result('第一条确认文本', true);
    window.__sockets.at(-1).result('修正后的确认文本', true);
  });
  assert.equal(await page.locator('.live-line:not(.interim)').count(), 1);
  await page.locator('#pause-recording').click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__sockets.at(-1).readyState), 3);
  await page.locator('#pause-recording').click();
  await page.waitForFunction(() => document.querySelector('#recognition-status').textContent.includes('讯飞已连接'));
  await page.waitForTimeout(150);
  await page.locator('#finish-recording').click();
  await page.locator('#download-recording').waitFor();
  assert((await page.locator('.source-list').innerText()).includes('结束时的最后一句'));
  assert(await page.evaluate(() => !JSON.stringify(localStorage).includes('test-only-key') && !JSON.stringify(sessionStorage).includes('test-only-key')));
  await page.locator('#back').click();
  await page.locator('.hero .start-meeting[data-mode=online]').click();
  await page.waitForFunction(() => document.querySelector('#recognition-status')?.textContent.includes('讯飞已连接'));
  await page.waitForTimeout(1000);
  assert(await page.evaluate(() => window.__sockets.at(-1).frames.some(f => f.some(b => b !== 0))));
  await page.locator('#finish-recording').click();
  await page.locator('#download-recording').waitFor();
  await page.evaluate(() => window.__sharedAudioContext.close());
  await page.reload();
  assert.equal(await page.evaluate(() => XfyunASR.mode()), 'unconfigured');
  assert.deepEqual(errors, []);
  console.log('PASS: MD5/HMAC vectors, session-only settings, signed URL, 16 kHz PCM worklet 1280-byte frames, interim/final updates, pause/reconnect, final result drain, secret persistence checks. Provider mocked.');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
