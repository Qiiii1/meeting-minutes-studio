'use strict';

// Live capture is deliberately separate from the static demo and document editor.
// No synthetic text is ever inserted into a real recording.
window.LiveMeeting = (() => {
  let session = null;
  let dbPromise = null;
  const volatileAudio = new Map();
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('minutes-recordings-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('chunks', { keyPath: ['meetingId', 'index'] });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function storeChunk(meetingId, index, blob) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chunks', 'readwrite');
      tx.objectStore('chunks').put({ meetingId, index, blob });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function readAudio(m) {
    if (volatileAudio.has(m.id)) return volatileAudio.get(m.id);
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction('chunks').objectStore('chunks').getAll(IDBKeyRange.bound([m.id, 0], [m.id, Number.MAX_SAFE_INTEGER]));
      request.onsuccess = () => resolve(new Blob(request.result.map(c => c.blob), { type: m.audioMime || 'audio/webm' }));
      request.onerror = () => reject(request.error);
    });
  }

  async function removeAudio(id) {
    volatileAudio.delete(id);
    try {
      const db = await database();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('chunks', 'readwrite');
        tx.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch { toast('录音缓存删除失败，可在浏览器网站设置中清除本站数据。'); }
  }

  const clockText = seconds => {
    seconds = Math.floor(seconds);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  function elapsed(s) { return s.elapsed + (s.state === 'recording' ? (performance.now() - s.resumedAt) / 1000 : 0); }
  function message(text, warning = false) {
    if (!session) return;
    session.message = text;
    session.warning = warning;
    const node = $('#recognition-status');
    if (node) { node.textContent = text; node.classList.toggle('warning', warning); }
    if (warning && session.meeting) {
      session.meeting.asrWarning = '本次转写曾中断或不可用，原文可能不完整，请回听录音核对。';
      persist();
    }
  }

  function stopRecognition(s) {
    clearTimeout(s.restart);
    clearTimeout(s.recognitionTimeout);
    const r = s.recognition;
    if (r) { try { r.stop(); } catch {} }
  }

  function startRecognition(s) {
    const desktopChromium = !/Android|iPhone|iPad/i.test(navigator.userAgent) && Number(navigator.userAgent.match(/(?:Chrome|Chromium)\/(\d+)/)?.[1]) >= 135;
    if (s.online && !desktopChromium) {
      s.autoRecognition = false;
      message('双声源录音正在继续。混合音轨字幕需桌面 Chrome 135+ 或讯飞实时服务，当前浏览器不启用字幕。', true);
      return;
    }
    if (!Recognition || s.state !== 'recording' || s.recognition) return;
    const r = new Recognition();
    s.recognition = r;
    r.lang = 'zh-CN';
    r.continuous = true;
    r.interimResults = true;
    r.onstart = () => { clearTimeout(s.recognitionTimeout); if (session === s && s.state === 'recording') message(s.online ? '双声源实时文字已连接，正在聆听…' : '实时文字已连接，正在聆听…'); };
    r.onresult = event => {
      if (session !== s) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal && !s.finalIndices.has(i)) {
          s.finalIndices.add(i);
          if (text) s.meeting.segments.push({ speaker: '发言', time: clockText(elapsed(s)), text });
        } else if (!result.isFinal) interim += text;
      }
      s.interim = interim;
      s.meeting.raw = sourceText(s.meeting);
      persist();
      drawTranscript(s);
    };
    r.onerror = event => {
      clearTimeout(s.recognitionTimeout);
      if (session !== s || s.state !== 'recording') return;
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      s.autoRecognition = false;
      const descriptions = {
        'not-allowed': '浏览器未允许语音识别。',
        'service-not-allowed': '此浏览器没有可用的语音识别服务。',
        network: '语音识别服务连接失败。',
        'audio-capture': '语音识别无法访问麦克风。',
        'language-not-supported': '当前识别服务不支持中文。'
      };
      message(`${descriptions[event.error] || '实时文字暂不可用。'}录音仍在继续，可重试字幕。`, true);
    };
    r.onend = () => {
      clearTimeout(s.recognitionTimeout);
      if (s.recognition === r) s.recognition = null;
      s.interim = '';
      if (session !== s) return;
      drawTranscript(s);
      if (s.state === 'recording' && s.autoRecognition) {
        s.restart = setTimeout(() => startRecognition(s), 500);
      }
    };
    s.finalIndices = new Set();
    s.recognitionTimeout = setTimeout(() => {
      if (session !== s || s.state !== 'recording') return;
      s.autoRecognition = false;
      message('实时文字连接超时。音频仍在录制，可重试字幕或结束后下载录音。', true);
      try { r.abort(); } catch {}
    }, 12000);
    try { if (s.online) r.start(s.stream.getAudioTracks()[0]); else r.start(); } catch {
      s.recognition = null;
      s.autoRecognition = false;
      message('无法启动实时文字，录音仍在继续。可点击“重试字幕”。', true);
    }
  }

  function startXfyun(s) {
    if (s.xfOpening) { s.xfRestartRequested = true; return s.xfOpening; }
    s.xfOpening = (async () => {
      await s.xfStopping;
      if (session !== s || s.state !== 'recording') return;
      const offset = elapsed(s);
      const finalSegments = new Map();
      message('正在连接讯飞实时转写，请等待连接成功后开始谈话…');
      try {
        const controller = await window.XfyunASR.connect(s.stream, {
          onResult(result) {
            if (session !== s) return;
            if (result.final) {
              const segment = { speaker: '发言', time: clockText(offset + result.begin / 1000), text: result.text };
              if (finalSegments.has(result.id)) Object.assign(finalSegments.get(result.id), segment);
              else if (result.text) { finalSegments.set(result.id, segment); s.meeting.segments.push(segment); }
              s.interim = '';
              s.meeting.raw = sourceText(s.meeting);
              persist();
            } else s.interim = result.text;
            drawTranscript(s);
          },
          onError(text) {
            if (session === s && s.state === 'recording') message(text + ' 本地录音仍在继续。', true);
          }
        });
        if (session !== s || s.state !== 'recording') { await controller.stop(); return; }
        s.xf = controller;
        message(s.online ? '讯飞已连接 · 麦克风与共享声音正在实时转写。' : '讯飞已连接 · 正在实时转写你的谈话。');
      } catch (error) {
        if (session === s && s.state === 'recording') message(error.message + ' 本地录音仍在继续。', true);
      }
    })().finally(() => {
      s.xfOpening = null;
      const restart = s.xfRestartRequested;
      s.xfRestartRequested = false;
      if (restart && session === s && s.state === 'recording' && !s.xf) startXfyun(s);
    });
    return s.xfOpening;
  }

  function stopXfyun(s) {
    s.xfRestartRequested = false;
    const controller = s.xf;
    s.xf = null;
    if (controller) s.xfStopping = controller.stop();
    return s.xfStopping || Promise.resolve();
  }

  function drawTranscript(s) {
    const list = $('#live-transcript');
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 100;
    list.innerHTML = s.meeting.segments.map(segment => `<div class="live-line"><time>${escapeHtml(segment.time)}</time><p>${escapeHtml(segment.text)}</p></div>`).join('') +
      (s.interim ? `<div class="live-line interim"><time>识别中</time><p>${escapeHtml(s.interim)}</p></div>` : '') +
      (!s.meeting.segments.length && !s.interim ? '<div class="listening-empty"><span>◉</span><h3>把注意力留给对话</h3><p>识别到的谈话会显示在这里。<br>字幕连接失败时，音频仍会独立录制。</p></div>' : '');
    if (nearBottom) list.scrollTop = list.scrollHeight;
    $('#live-words').textContent = `${s.meeting.segments.reduce((n, line) => n + line.text.length, 0)} 字`;
  }

  function draw() {
    const s = session;
    if (!s) return;
    activeId = null;
    $('#breadcrumb').textContent = '正在开会';
    $('#app').innerHTML = `<div class="page-heading"><div><div class="eyebrow">BE PRESENT. WE’RE LISTENING.</div><h1>好好聊，正在为你记录。</h1><p class="subtext">${s.online?'麦克风 + 共享音频已连接，只保存声音，不保存画面。':'收录麦克风听到的谈话。'}保持此页面打开，结束后可回听与编辑。</p></div><span class="live-pill"><i></i><span id="live-state">正在录音</span></span></div>
      <div class="live-layout"><section class="panel live-main"><div class="panel-header"><h2>实时谈话记录</h2><span id="live-words">0 字</span></div><div id="recognition-status" role="status" class="recognition-status"></div><div id="live-transcript" class="live-transcript"></div><div class="live-transcript-foot"><span>普通话 · ${s.provider==='xfyun'?'讯飞实时转写':'浏览器字幕'}</span><button class="text-button" id="retry-recognition">重试字幕</button></div></section>
      <aside class="live-control"><div class="recording-orb" id="recording-orb">${[12,23,36,49,30,55,37,24,14].map(h=>`<i style="--h:${h}px"></i>`).join('')}</div><div class="recording-timer" id="recording-timer">00:00</div><p class="recording-caption" id="recording-caption">会议进行中</p><div class="mic-meter"><span id="mic-level"></span></div><p class="field-hint">${s.online?'麦克风 + 共享声音':'麦克风'}输入音量</p><label>会议名称<input id="live-title" value="${escapeHtml(s.meeting.title)}" maxlength="100"></label><button class="secondary" id="pause-recording">Ⅱ 暂停记录</button><button class="primary" id="finish-recording">■ 结束并保存会议</button><div class="recording-note"><strong>音频与文字分别保存</strong><p id="recording-storage">录音分段保存到此浏览器，文字自动保存。结束后请下载录音备份。</p><p>${s.provider==='xfyun'?'实时音频发送至讯飞并消耗你的账号额度。暂停时关闭转写连接，继续时重新连接。':'实时字幕依赖浏览器语音服务，可能将音频发送给浏览器服务商。'}当前不自动区分不同发言人。</p></div></aside></div>`;
    $('#live-title').oninput = e => { s.meeting.title = e.target.value.trim() || `${today()} 的会议`; persist(); };
    $('#pause-recording').onclick = togglePause;
    $('#finish-recording').onclick = finish;
    $('#retry-recognition').onclick = () => {
      if (s.state !== 'recording') return toast('请先继续录音，再重试字幕。');
      if (s.provider === 'xfyun') { stopXfyun(s); startXfyun(s); return; }
      if (!Recognition) return message('当前浏览器不支持实时识别。请下载录音，并使用支持 SpeechRecognition 的浏览器或接入讯飞实时服务。', true);
      s.autoRecognition = true;
      stopRecognition(s);
      if (!s.recognition) startRecognition(s);
      message('正在尝试连接实时文字…');
    };
    message(s.message, s.warning);
    drawTranscript(s);
    updateControls(s);
  }

  function updateControls(s) {
    if (!$('#live-state')) return;
    const paused = s.state === 'paused';
    $('#live-state').textContent = paused ? '已暂停' : s.state === 'finishing' ? '正在保存' : '正在录音';
    $('#recording-caption').textContent = paused ? '麦克风已暂停收录' : '会议进行中';
    $('#pause-recording').textContent = paused ? '▶ 继续记录' : 'Ⅱ 暂停记录';
    $('#recording-orb').classList.toggle('paused', paused);
    $('#recording-timer').textContent = clockText(elapsed(s));
    document.body.classList.toggle('recording-paused', paused);
  }

  function stopTracks(s) {
    for (const stream of [s.stream, s.micStream, s.sharedStream]) stream?.getTracks().forEach(t => t.stop());
  }

  async function start(mode = 'offline') {
    if (session) { if (session.meeting && session.state !== 'finishing') draw(); return; }
    if (window.XfyunASR?.mode() === 'unconfigured') {
      window.XfyunASR.settings(() => toast('转写已配置，请点击开始会议。'));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      return showError('当前浏览器无法录音', '请在支持麦克风录音的独立浏览器中打开此 HTTPS 网页。部分内嵌浏览器无法提供麦克风权限。', mode);
    }
    if (mode === 'online' && !navigator.mediaDevices.getDisplayMedia) return showError('当前浏览器无法共享会议声音', '请使用桌面浏览器。线上会议需选择会议标签页或支持音频共享的屏幕，并开启共享音频。', mode);
    window.demoToken = null;
    const s = { provider: window.XfyunASR?.mode() || 'browser', online: mode === 'online', state: 'starting', elapsed: 0, resumedAt: 0, chunks: [], writes: [], autoRecognition: true, message: '正在连接实时文字…', interim: '', finalIndices: new Set(), recognition: null };
    session = s;
    document.body.classList.add('meeting-active');
    $('#app').innerHTML = `<section class="panel progress-card"><div class="spinner"></div><h2>${s.online?'选择会议音频，并允许麦克风':'请允许麦克风访问'}</h2><p class="subtext" style="margin-top:15px">${s.online?'选择会议所在标签页或屏幕，勾选“共享音频”。只录声音，不录画面。':'授权后将自动开始记录。请在浏览器权限提示中选择“允许”。'}</p><button id="cancel-microphone" class="text-button" style="margin-top:22px">取消开始</button></section>`;
    $('#cancel-microphone').onclick = () => { session = null; document.body.classList.remove('meeting-active'); goHome(); };
    try {
      if (s.online) {
        s.sharedStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, systemAudio: 'include', selfBrowserSurface: 'exclude' });
        if (session !== s) { stopTracks(s); return; }
        if (!s.sharedStream.getAudioTracks().length) { const error = new Error('No shared audio'); error.name = 'NoSharedAudioError'; throw error; }
      }
      s.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (session !== s) { stopTracks(s); return; }
      s.stream = s.micStream;
      if (s.online) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        s.mixContext = new AudioCtx();
        await s.mixContext.resume();
        if (session !== s) { stopTracks(s); s.mixContext.close(); return; }
        const output = s.mixContext.createMediaStreamDestination();
        for (const source of [s.micStream, s.sharedStream]) {
          const gain = s.mixContext.createGain();
          gain.gain.value = 0.7;
          s.mixContext.createMediaStreamSource(source).connect(gain).connect(output);
        }
        s.stream = output.stream;
      }
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t));
      s.recorder = new MediaRecorder(s.stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
      const extension = s.recorder.mimeType.includes('mp4') ? 'm4a' : 'webm';
      s.meeting = { id: uid(), title: `${today()} 的会议`, date: today(), type: s.online ? '线上会议' : '现场会议', status: 'draft', demo: false, live: true, asrProvider: s.provider, recording: true, attendees: '待确认', duration: '录音中', summary: '待整理：录音和识别原文已保存，可使用 DeepSeek 自动整理。', points: '', decisions: '', pending: '请回听核对识别文字，并确认负责人及日期。', next: '', actions: [], segments: [], raw: '', audioMime: s.recorder.mimeType, audioName: `meeting-${today()}.${extension}`, audioStored: false };
      meetings.unshift(s.meeting);
      persist();
      s.recorder.ondataavailable = event => {
        if (!event.data.size) return;
        const index = s.chunks.length;
        s.chunks.push(event.data);
        s.writes.push(storeChunk(s.meeting.id, index, event.data).then(() => {
          s.meeting.audioStored = true;
          persist();
        }).catch(() => {
          s.storageFailed = true;
          if ($('#recording-storage')) $('#recording-storage').textContent = '浏览器录音存储失败。音频暂存于内存，请勿刷新，结束后立即下载备份。';
        }));
      };
      s.recorder.onerror = () => { s.captureError = '录音设备发生错误，已保存可用片段。'; finish(); };
      [...s.micStream.getAudioTracks(), ...(s.sharedStream?.getTracks() || [])].forEach(track => track.onended = () => { if (s.state !== 'finishing') { s.captureError = '麦克风或共享音频连接中断，已结束并保存可用片段。'; finish(); } });
      s.state = 'recording';
      s.resumedAt = performance.now();
      s.recorder.start(1000);
      draw();
      s.timer = setInterval(() => { updateControls(s); s.meeting.duration = clockText(elapsed(s)); }, 250);
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        s.audioContext = new AudioCtx();
        await s.audioContext.resume();
        const analyser = s.audioContext.createAnalyser();
        analyser.fftSize = 256;
        s.audioContext.createMediaStreamSource(s.stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        s.levelTimer = setInterval(() => {
          analyser.getByteTimeDomainData(data);
          const level = s.state === 'paused' ? 0 : Math.min(100, Math.sqrt(data.reduce((n,v) => n + ((v-128)/128)**2,0)/data.length)*450);
          if ($('#mic-level')) $('#mic-level').style.width = `${level}%`;
        }, 100);
      } catch { /* Audio recording does not depend on the level meter. */ }
      if (session !== s || s.state !== 'recording') return;
      if (s.provider === 'xfyun') startXfyun(s);
      else if (Recognition) startRecognition(s);
      else message('此浏览器不支持实时文字。音频正在录制，结束后可下载；实时转写需要受支持的浏览器或讯飞服务。', true);
    } catch (error) {
      stopTracks(s);
      s.mixContext?.close().catch(() => {});
      if (session !== s) return;
      session = null;
      if (s.meeting) { s.meeting.recording = false; s.meeting.recordingWarning = '录音启动失败，可能没有音频片段。'; persist(); }
      document.body.classList.remove('meeting-active');
      if (error.name === 'NoSharedAudioError') return showError('没有收到对方的声音', '刚才的共享源没有音轨，会议尚未开始。请重新选择会议标签页并勾选“共享音频”；桌面会议应用需浏览器和系统支持共享系统声音。', mode);
      const denied = ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
      showError(denied ? '麦克风权限尚未开启' : '无法连接麦克风', denied ? '请在浏览器的网站权限中允许麦克风，然后重试。内嵌浏览器不支持时，请复制链接到独立浏览器打开。' : '请检查麦克风是否连接、是否被其他应用独占，再重新开始会议。', mode);
    }
  }

  function togglePause() {
    const s = session;
    if (!s || !['recording', 'paused'].includes(s.state)) return;
    if (s.state === 'recording') {
      s.elapsed = elapsed(s);
      s.state = 'paused';
      s.recorder.pause();
      for (const stream of [s.stream, s.micStream, s.sharedStream]) stream?.getAudioTracks().forEach(t => t.enabled = false);
      stopRecognition(s);
      if (s.provider === 'xfyun') stopXfyun(s);
      message('已暂停收音与字幕，点击继续即可恢复。');
    } else {
      for (const stream of [s.stream, s.micStream, s.sharedStream]) stream?.getAudioTracks().forEach(t => t.enabled = true);
      s.recorder.resume();
      s.state = 'recording';
      s.resumedAt = performance.now();
      if (s.provider === 'xfyun') startXfyun(s);
      else if (s.autoRecognition) startRecognition(s);
      else message('录音已继续，实时文字未连接，可重试字幕。', true);
    }
    updateControls(s);
  }

  async function finish() {
    const s = session;
    if (!s || !['recording', 'paused'].includes(s.state)) return;
    s.elapsed = elapsed(s);
    s.state = 'finishing';
    s.autoRecognition = false;
    stopRecognition(s);
    const xfEnded = stopXfyun(s);
    clearInterval(s.timer);
    clearInterval(s.levelTimer);
    $$('#pause-recording, #finish-recording').forEach(b => b.disabled = true);
    if ($('#finish-recording')) $('#finish-recording').textContent = '正在保存…';
    updateControls(s);
    const audioStopped = s.recorder.state === 'inactive' ? Promise.resolve() : new Promise(resolve => {
      s.recorder.addEventListener('stop', resolve, { once: true });
      s.recorder.stop();
    });
    stopTracks(s);
    const recognition = s.recognition;
    if (recognition) await Promise.race([
      new Promise(resolve => recognition.addEventListener('end', resolve, { once: true })),
      new Promise(resolve => setTimeout(resolve, 1500))
    ]);
    if (recognition) { try { recognition.abort(); } catch {} }
    await audioStopped;
    await s.xfOpening;
    await xfEnded;
    s.audioContext?.close().catch(() => {});
    s.mixContext?.close().catch(() => {});
    await Promise.all(s.writes);
    const blob = new Blob(s.chunks, { type: s.recorder.mimeType });
    volatileAudio.set(s.meeting.id, blob);
    s.meeting.recording = false;
    if (!s.meeting.segments.length) {
      s.meeting.summary = '本次仅保存录音，未收到实时识别文字。请下载录音进行转写，或手动补充原文。';
      s.meeting.pending = '实时文字未生成；请勿把空白原文当作完整记录。';
    }
    s.meeting.duration = clockText(s.elapsed);
    s.meeting.raw = sourceText(s.meeting);
    s.meeting.recordingWarning = [s.captureError, s.storageFailed ? '录音未完整存入浏览器，请立即下载备份。' : '', s.meeting.asrWarning].filter(Boolean).join(' ');
    persist();
    setAudio(blob, s.meeting.id);
    session = null;
    document.body.classList.remove('meeting-active', 'recording-paused');
    openMeeting(s.meeting.id);
    toast(s.captureError || '会议已结束。可回听、下载录音并校对文字。');
  }

  function showError(title, detail, mode = 'offline') {
    $('#app').innerHTML = `<section class="panel progress-card"><div class="eyebrow">MICROPHONE ACCESS</div><h2>${escapeHtml(title)}</h2><p class="recording-error">${escapeHtml(detail)}</p><button class="primary start-meeting" data-mode="${mode}">重新开始会议</button><button class="text-button" id="recording-back" style="margin-left:20px">返回首页</button></section>`;
    $('#recording-back').onclick = () => goHome();
  }

  async function attachPlayback(m) {
    if (!m.live) return;
    const host = $('#live-audio-host');
    if (!host) return;
    try {
      const blob = await readAudio(m);
      if (activeId !== m.id || !host.isConnected) return;
      if (!blob.size) { host.innerHTML = '<p class="notice">没有可恢复的录音片段。识别文字仍可在下方查看。</p>'; return; }
      setAudio(blob, m.id);
      host.innerHTML = `<audio class="local-audio" controls src="${escapeHtml(audioUrl)}"></audio><button class="secondary" id="download-recording">↓ 下载录音（${(blob.size/1024/1024).toFixed(1)} MB）</button><p class="field-hint">录音保存在此浏览器。请下载备份后再清除网站数据。</p>`;
      $('#download-recording').onclick = () => {
        const a = document.createElement('a');
        a.href = audioUrl;
        a.download = `${safeName(m.title)}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`;
        a.click();
      };
    } catch { host.innerHTML = '<p class="notice">无法读取录音缓存。请检查浏览器存储权限；识别文字仍保留在下方。</p>'; }
  }

  document.addEventListener('click', e => {
    if (e.target.closest('.start-meeting')) { e.preventDefault(); start(e.target.closest('.start-meeting').dataset.mode || 'offline'); }
    if (session && e.target.closest('.nav-item, .brand, [data-mobile-view], .new-meeting, #try-demo, #about-button, #asr-settings')) {
      e.preventDefault(); e.stopImmediatePropagation();
      toast('会议仍在记录，请先暂停或结束并保存。');
    }
  }, true);
  window.addEventListener('beforeunload', event => {
    if (session) { event.preventDefault(); event.returnValue = ''; }
  });
  document.addEventListener('keydown', event => {
    if (session && event.key.toLowerCase() === 'n' && !event.target.matches('input,textarea')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  for (const m of meetings) {
    if (m.recording) {
      m.recording = false;
      m.recordingWarning = '上次录音意外中断。下方仅恢复已写入浏览器的录音和文字，末尾内容可能缺失。';
    }
  }
  persist();
  return { start, attachPlayback, removeAudio, isActive: () => Boolean(session) };
})();
