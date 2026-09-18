'use strict';

// The API key is session-only: never persisted, logged, or included in a URL.
// Only the time-limited HMAC signature is sent to the fixed official WSS endpoint.
window.XfyunASR = (() => {
  let credentials = null;
  let selectedMode = 'unconfigured';
  let afterConfigure = null;
  let settingsVersion = 0;
  const encoder = new TextEncoder();

  function md5(text) {
    const input = encoder.encode(text);
    const bytes = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
    bytes.set(input); bytes[input.length] = 0x80;
    const view = new DataView(bytes.buffer);
    view.setUint32(bytes.length - 8, input.length * 8, true);
    const shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
    let h = [0x67452301,0xefcdab89,0x98badcfe,0x10325476];
    const rotate = (n,s) => (n << s) | (n >>> (32-s));
    for (let offset=0; offset<bytes.length; offset+=64) {
      let [a,b,c,d] = h;
      for (let i=0;i<64;i++) {
        let f,g;
        if(i<16){f=(b&c)|(~b&d);g=i;}
        else if(i<32){f=(d&b)|(~d&c);g=(5*i+1)%16;}
        else if(i<48){f=b^c^d;g=(3*i+5)%16;}
        else {f=c^(b|~d);g=(7*i)%16;}
        const k=Math.floor(Math.abs(Math.sin(i+1))*4294967296);
        const temp=d;d=c;c=b;
        b=(b+rotate((a+f+k+view.getUint32(offset+g*4,true))|0,shifts[Math.floor(i/16)*4+i%4]))|0;
        a=temp;
      }
      h=[(h[0]+a)|0,(h[1]+b)|0,(h[2]+c)|0,(h[3]+d)|0];
    }
    return h.map(n=>[0,8,16,24].map(s=>((n>>>s)&255).toString(16).padStart(2,'0')).join('')).join('');
  }

  async function signedUrl(appId, apiKey, timestamp = Math.floor(Date.now()/1000).toString()) {
    const key = await crypto.subtle.importKey('raw',encoder.encode(apiKey),{name:'HMAC',hash:'SHA-1'},false,['sign']);
    const hash = await crypto.subtle.sign('HMAC',key,encoder.encode(md5(appId+timestamp)));
    const signa = btoa(String.fromCharCode(...new Uint8Array(hash)));
    return `wss://rtasr.xfyun.cn/v1/ws?${new URLSearchParams({appid:appId,ts:timestamp,signa,lang:'cn'})}`;
  }

  function providerError(code) {
    return ({10105:'讯飞鉴权失败，请核对 APPID、API Key 和 IP 白名单。',10110:'讯飞实时转写未授权或额度/并发不可用，请检查服务开通状态。',10800:'讯飞连接数已达上限，请结束其他连接后重试。',37005:'讯飞未持续收到音频，转写连接已中断。',10700:'讯飞转写引擎报错，请检查音频或重试。'})[Number(code)] || `讯飞返回错误（${String(code).replace(/[^0-9]/g,'')}），请检查实时转写服务配置。`;
  }

  async function openSocket(config, callbacks = {}) {
    const ws = new WebSocket(await signedUrl(config.appId, config.apiKey));
    ws.binaryType = 'arraybuffer';
    let started = false, closing = false;
    let resolveClosed;
    const closed = new Promise(resolve=>resolveClosed=resolve);
    const ready = new Promise((resolve,reject) => {
      const timeout=setTimeout(()=>{closing=true;ws.close();reject(new Error('讯飞连接超时，请检查网络。'))},12000);
      ws.onmessage=event=>{
        let packet;
        try {packet=JSON.parse(event.data)} catch {return}
        if(packet.action==='started') {started=true;clearTimeout(timeout);resolve();}
        if(packet.action==='error') {
          const error=new Error(providerError(packet.code));
          clearTimeout(timeout);
          if(!started)reject(error);else callbacks.onError?.(error.message);
          closing=true;ws.close();
        }
        if(packet.action==='result') {
          try {
            const data=typeof packet.data==='string'?JSON.parse(packet.data):packet.data;
            const st=data.cn?.st;
            if(!st)return;
            const text=(st.rt||[]).flatMap(rt=>(rt.ws||[]).map(w=>w.cw?.[0]?.w||'')).join('');
            callbacks.onResult?.({id:String(data.seg_id),text,final:String(st.type)==='0',begin:Number(st.bg)||0});
          } catch {callbacks.onError?.('讯飞返回的文字格式无法解析，录音仍保留。')}
        }
      };
      ws.onerror=()=>{clearTimeout(timeout);if(!started)reject(new Error('无法连接讯飞，请检查网络或 API 配置。'));};
      ws.onclose=()=>{
        clearTimeout(timeout);resolveClosed();
        if(!started)reject(new Error('讯飞在鉴权完成前关闭连接。'));
        else if(!closing)callbacks.onError?.('讯飞转写连接已断开，录音仍在继续。请重试字幕。');
      };
    });
    await ready;
    return {
      send(buffer) {
        if (ws.readyState!==WebSocket.OPEN || closing) return false;
        if(ws.bufferedAmount>32000*3) {closing=true;ws.close();callbacks.onError?.('网络发送积压，已停止转写以避免错位。录音仍保留，请重试字幕。');return false;}
        ws.send(buffer);return true;
      },
      async stop() {
        if(closing)return closed;
        closing=true;
        if(ws.readyState===WebSocket.OPEN)ws.send(encoder.encode('{"end": true}'));
        await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,3000))]);
        if(ws.readyState<2)ws.close();
      }
    };
  }

  async function connect(stream, callbacks) {
    if(!credentials)throw new Error('请先配置讯飞实时转写。');
    const config={...credentials};
    let socket,context,node,source,mute;
    try {
      context=new AudioContext({sampleRate:16000});
      await context.resume();
      if(context.sampleRate!==16000)throw new Error('此浏览器无法提供 16 kHz 音频，请使用桌面 Chrome。');
      await context.audioWorklet.addModule('pcm-worklet.js');
      socket=await openSocket(config,callbacks);
      source=context.createMediaStreamSource(stream);
      node=new AudioWorkletNode(context,'minutes-pcm',{channelCount:1,channelCountMode:'explicit'});
      mute=context.createGain();mute.gain.value=0;
      node.port.onmessage=event=>socket.send(event.data);
      source.connect(node).connect(mute).connect(context.destination);
      return {
        async stop() {
          source.disconnect();node.disconnect();node.port.onmessage=null;
          await context.close();
          await socket.stop();
        }
      };
    } catch(error) {
      source?.disconnect();node?.disconnect();
      await context?.close().catch(()=>{});
      await socket?.stop();
      throw error;
    }
  }

  function refreshBadge() {
    const button=document.querySelector('#asr-settings');
    if(button)button.textContent=selectedMode==='xfyun'?'讯飞已配置 ✓':selectedMode==='browser'?'浏览器字幕 ⚙':'连接讯飞 ⚙';
  }
  function settings(callback) {
    settingsVersion++;
    afterConfigure=callback||null;
    const dialog=document.querySelector('#asr-dialog');
    document.querySelector('#asr-form').reset();
    document.querySelector('#asr-status').textContent=credentials?'本页已有配置。填写后可替换，关闭窗口则保留。':'填写实时语音转写（标准版）的 APPID 和 API Key。';
    dialog.showModal();
  }
  function configure(appId,apiKey) {credentials={appId:appId.trim(),apiKey:apiKey.trim()};selectedMode='xfyun';refreshBadge();}
  function useBrowser() {credentials=null;selectedMode='browser';refreshBadge();}
  document.querySelector('#asr-settings').onclick=()=>settings();
  document.querySelector('#asr-form').onsubmit=async event=>{
    event.preventDefault();
    const form=event.target;
    const version=settingsVersion;
    const appId=form.elements.appId.value.trim(),apiKey=form.elements.apiKey.value.trim();
    const button=form.querySelector('[type=submit]');
    button.disabled=true;button.textContent='正在验证…';
    document.querySelector('#asr-status').textContent='正在验证讯飞鉴权，不发送会议音频。';
    try {
      const socket=await openSocket({appId,apiKey});
      await socket.stop();
      if(version!==settingsVersion || !document.querySelector('#asr-dialog').open)return;
      configure(appId,apiKey);form.reset();
      document.querySelector('#asr-dialog').close();
      const callback=afterConfigure;afterConfigure=null;callback?.();
    }catch(error){document.querySelector('#asr-status').textContent=error.message;}
    finally{button.disabled=false;button.textContent='验证并连接讯飞';}
  };
  document.querySelector('#use-browser-asr').onclick=()=>{
    useBrowser();document.querySelector('#asr-form').reset();document.querySelector('#asr-dialog').close();
    const callback=afterConfigure;afterConfigure=null;callback?.();
  };
  document.querySelector('#clear-asr').onclick=()=>{credentials=null;selectedMode='unconfigured';refreshBadge();document.querySelector('#asr-form').reset();document.querySelector('#asr-status').textContent='本页配置已清除。';};
  document.querySelector('#asr-dialog').addEventListener('close',()=>{settingsVersion++;document.querySelector('#asr-form').reset();});
  return {connect,settings,configure,useBrowser,mode:()=>selectedMode,md5,signedUrl};
})();
