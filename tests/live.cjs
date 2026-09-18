const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}), args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  const context = await browser.newContext({permissions:['microphone'],viewport:{width:1440,height:1000},acceptDownloads:true});
  // Synthetic microphone and deterministic recognition events; no human audio/cloud ASR.
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => window.XfyunASR?.useBrowser());
    window.__recognizers = [];
    window.__streams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      if (sessionStorage.getItem('denyMic')) throw new DOMException('Denied', 'NotAllowedError');
      const stream = await original(options); window.__streams.push(stream); return stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      const ctx = new AudioContext(); window.__testAudioContext = ctx;
      const output = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator(); osc.frequency.value = 880; osc.connect(output); osc.start(); await ctx.resume();
      const canvas = document.createElement('canvas'); const video = canvas.captureStream().getVideoTracks()[0];
      const stream = new MediaStream(sessionStorage.getItem('noSharedAudio') ? [video] : [...output.stream.getTracks(),video]);
      window.__streams.push(stream); return stream;
    };
    class Recognition extends EventTarget {
      start(track) { this.track = track; window.__recognizers.push(this); setTimeout(()=>this.onstart?.(),0); }
      stop() { setTimeout(()=>{this.onend?.();this.dispatchEvent(new Event('end'))},10); }
      abort() { this.stop(); }
      result(text, final = true) { const result=[{transcript:text}];result.isFinal=final;this.onresult?.({resultIndex:0,results:[result]}); }
    }
    window.SpeechRecognition=Recognition;
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4173/',{waitUntil:'networkidle'});
  await page.screenshot({path:'/tmp/minutes-live-home.png',fullPage:true});
  await page.locator('.hero .start-meeting:not([data-mode])').click();
  await page.locator('#finish-recording').waitFor();
  await page.waitForFunction(()=>window.__recognizers.length>0);
  await page.evaluate(()=>window.__recognizers.at(-1).result('这是实际会议文字处理路径的测试。',false));
  assert((await page.locator('#live-transcript').innerText()).includes('识别中'));
  await page.evaluate(()=>window.__recognizers.at(-1).result('今天确认由小林负责交付原型。'));
  await page.evaluate(()=>window.__recognizers.at(-1).result('今天确认由小林负责交付原型。'));
  assert.equal(await page.locator('.live-line:not(.interim)').count(),1);
  await page.waitForTimeout(1200);
  await page.locator('#pause-recording').click();
  assert.equal(await page.locator('#live-state').innerText(),'已暂停');
  assert(await page.evaluate(()=>window.__streams.every(s=>s.getAudioTracks().every(t=>!t.enabled))));
  const pausedTime=await page.locator('#recording-timer').innerText();await page.waitForTimeout(1100);assert.equal(await page.locator('#recording-timer').innerText(),pausedTime);
  await page.locator('#pause-recording').click();
  assert.equal(await page.locator('#live-state').innerText(),'正在录音');
  await page.waitForTimeout(200);
  await page.screenshot({path:'/tmp/minutes-recording.png',fullPage:true});
  await page.locator('[data-view=all]').click();assert.equal(await page.locator('#finish-recording').count(),1);
  await page.locator('#finish-recording').click();await page.locator('#download-recording').waitFor();
  assert((await page.locator('.source-list').innerText()).includes('今天确认由小林'));
  assert(await page.evaluate(()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
  const downloadPromise=page.waitForEvent('download');await page.locator('#download-recording').click();const d=await downloadPromise;await d.saveAs('/tmp/minutes-real-recorder-test.webm');
  await page.reload();await page.locator('.meeting-card').first().click();await page.locator('#download-recording').waitFor();
  const playable=await page.locator('#live-audio-host audio').evaluate(async audio=>{const response=await fetch(audio.src);const b=await response.blob();const ctx=new AudioContext();const decoded=await ctx.decodeAudioData(await b.arrayBuffer());await ctx.close();return {size:b.size,duration:decoded.duration};});assert(playable.size>1000&&playable.duration>0);
  await page.locator('#back').click();await page.locator('.start-meeting[data-mode=online]').click();await page.locator('#finish-recording').waitFor();
  await page.waitForFunction(()=>window.__recognizers.some(r=>r.track));
  assert(await page.evaluate(()=>window.__recognizers.at(-1).track.kind==='audio'));
  await page.evaluate(()=>window.__recognizers.at(-1).result('混合音轨的字幕测试。'));
  await page.waitForTimeout(1200);await page.locator('#finish-recording').click();await page.locator('#download-recording').waitFor();
  assert(await page.evaluate(()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
  await page.locator('#back').click();await page.evaluate(()=>sessionStorage.setItem('noSharedAudio','1'));
  await page.locator('.start-meeting[data-mode=online]').click();await page.getByRole('heading',{name:'没有收到对方的声音'}).waitFor();assert.equal(await page.locator('#finish-recording').count(),0);
  assert(await page.evaluate(()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
  await page.locator('#recording-back').click();await page.evaluate(()=>sessionStorage.setItem('denyMic','1'));
  await page.locator('.hero .start-meeting:not([data-mode])').click();await page.getByRole('heading',{name:'麦克风权限尚未开启'}).waitFor();assert.equal(await page.locator('#finish-recording').count(),0);
  await page.locator('#recording-back').click();await page.evaluate(()=>sessionStorage.removeItem('denyMic'));
  await page.locator('.hero .start-meeting:not([data-mode])').click();await page.locator('#finish-recording').waitFor();await page.waitForTimeout(300);
  await page.evaluate(()=>window.__recognizers.at(-1).onerror({error:'network'}));assert((await page.locator('#recognition-status').innerText()).includes('录音仍在继续'));
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/minutes-recording-mobile.png',fullPage:true});
  await page.locator('#finish-recording').click();await page.locator('#download-recording').waitFor();
  assert.deepEqual(errors,[]);console.log('PASS: real MediaRecorder with fake microphone; interim/final deduplication; pause/resume; navigation guard; stop/release; playable download; IndexedDB reload; online mixed audio track; missing shared audio; mic denied; ASR network failure; mobile layout. Cloud speech quality not tested.');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
