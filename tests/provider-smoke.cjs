// Opt-in test: sends only a user-provided synthetic audio fixture to Xfyun.
// Credentials come from the process environment and are never logged or saved.
const { chromium } = require('playwright');
const fs = require('node:fs');

(async () => {
  if (!process.env.XFYUN_APP_ID || !process.env.XFYUN_API_KEY || !process.env.TEST_AUDIO_FILE) {
    throw new Error('Set XFYUN_APP_ID, XFYUN_API_KEY and TEST_AUDIO_FILE to opt in.');
  }
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--autoplay-policy=no-user-gesture-required']
  });
  try {
    const page = await browser.newPage();
    await page.route('**/synthetic-test-audio.wav', route => route.fulfill({
      contentType: 'audio/wav', body: fs.readFileSync(process.env.TEST_AUDIO_FILE)
    }));
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
    await page.locator('#asr-settings').click();
    await page.locator('[name=appId]').fill(process.env.XFYUN_APP_ID);
    await page.locator('[name=apiKey]').fill(process.env.XFYUN_API_KEY);
    await page.locator('#asr-form [type=submit]').click();
    await page.locator('#asr-dialog').waitFor({ state: 'hidden', timeout: 25000 });
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        await context.resume();
        const source = context.createBufferSource();
        const response = await fetch('synthetic-test-audio.wav');
        source.buffer = await context.decodeAudioData(await response.arrayBuffer());
        const output = context.createMediaStreamDestination();
        source.connect(output);
        source.onended = () => { window.syntheticSpeechDone = true; };
        source.start(context.currentTime + 3);
        window.syntheticContext = context;
        return output.stream;
      };
    });
    await page.locator('.hero .start-meeting:not([data-mode])').click();
    await page.waitForFunction(() => document.querySelector('#recognition-status')?.textContent.includes('讯飞已连接'), { timeout: 25000 });
    await page.waitForFunction(() => window.syntheticSpeechDone, null, { timeout: 40000 });
    await page.waitForFunction(() => document.querySelectorAll('.live-line:not(.interim)').length > 0, null, { timeout: 15000 });
    await page.locator('#finish-recording').click();
    await page.locator('#download-recording').waitFor({ timeout: 20000 });
    const text = await page.locator('.source-list').innerText();
    if (!text.includes('会议')) throw new Error('Expected synthetic speech was not recognized.');
    console.log('PASS: live Xfyun authentication, browser AudioWorklet streaming, recognized synthetic speech, final result saved.');
    console.log('Synthetic transcript: ' + text.replace(/\s+/g, ' ').slice(0, 220));
    await page.evaluate(() => window.syntheticContext?.close());
  } finally {
    await browser.close();
  }
})().catch(error => {
  // Do not print Playwright call logs, which could include input credentials.
  console.error('Provider check did not complete: ' + error.name);
  process.exit(1);
});
