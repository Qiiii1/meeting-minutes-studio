'use strict';
window.DeepSeekNotes=(()=>{
  const API_URL='https://api.deepseek.com/chat/completions';
  const CHUNK_SIZE=28000;
  let credentials=null,afterConfigure=null;

  const schemaExample={
    summary:'2-3 句概括会议目标、结论与影响',
    points:['主题：关键讨论事实与上下文'],
    decisions:['会议中明确确认或达成共识的决定'],
    actions:[{text:'具体、可执行的任务',owner:'明确姓名/团队或待确认',due:'YYYY-MM-DD/原文日期或待确认',priority:'高/中/低'}],
    next_steps:['下一次会议、里程碑或后续动作'],
    parking_lot:['尚未解决、需要跟进或信息不足的事项']
  };
  const systemPrompt=`你是专业的中文会议纪要编辑器。严格遵循 meeting-notes Skill 的工作流：从原始转写中提炼会议摘要、按主题组织关键讨论、识别明确决策、抽取行动项及负责人和期限、列出下一步，并把未解决内容放入 Parking Lot。

事实规则：只使用原文和会议元数据中的信息，禁止补充常识、猜测结论或虚构承诺。只有明确的决定性表达才能列入 decisions。负责人或截止日期没有明确说出时必须写“待确认”；即使 Skill 通用模板允许默认给组织者，本产品也禁止这样做。相对日期无法根据会议日期可靠换算时保留原话。合并重复内容，保留分歧、风险和限制。转写可能有识别错误，语义不确定时放入 parking_lot。

仅输出一个有效 JSON 对象，不要 Markdown、代码围栏或额外说明。所有字段必须存在。JSON 格式示例：${JSON.stringify(schemaExample)}`;

  function splitTranscript(text){
    if(text.length<=CHUNK_SIZE)return [text];
    const blocks=text.split(/\n{2,}/),chunks=[];let current='';
    for(const block of blocks){
      if(block.length>CHUNK_SIZE){
        if(current){chunks.push(current);current='';}
        for(let i=0;i<block.length;i+=CHUNK_SIZE)chunks.push(block.slice(i,i+CHUNK_SIZE));
      }else if((current+'\n\n'+block).length>CHUNK_SIZE){chunks.push(current);current=block;}
      else current+=(current?'\n\n':'')+block;
    }
    if(current)chunks.push(current);
    return chunks;
  }
  function cleanString(value){return typeof value==='string'?value.trim():'';}
  function cleanList(value){
    if(!Array.isArray(value))return [];
    return value.map(item=>typeof item==='string'?item.trim():cleanString(item?.text||item?.topic)).filter(Boolean).slice(0,50);
  }
  function normalize(value){
    if(!value||typeof value!=='object')throw new Error('DeepSeek 返回的纪要格式不完整，请重试。');
    const actions=Array.isArray(value.actions)?value.actions.map(item=>({
      text:cleanString(item?.text||item?.action),
      owner:cleanString(item?.owner)||'待确认',
      due:cleanString(item?.due||item?.due_date)||'待确认',
      priority:cleanString(item?.priority)||'中'
    })).filter(item=>item.text).slice(0,50):[];
    return {
      summary:cleanString(value.summary),
      points:cleanList(value.points||value.key_points),
      decisions:cleanList(value.decisions),
      actions,
      next_steps:cleanList(value.next_steps),
      parking_lot:cleanList(value.parking_lot||value.notes||value.pending)
    };
  }
  async function request(userPrompt,retry=true){
    if(!credentials)throw new Error('请先配置 DeepSeek API Key。');
    let response;
    try{
      response=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${credentials.apiKey}`},body:JSON.stringify({model:credentials.model,messages:[{role:'system',content:systemPrompt},{role:'user',content:userPrompt}],response_format:{type:'json_object'},temperature:.2,max_tokens:5000,stream:false})});
    }catch(error){throw new Error('无法从浏览器连接 DeepSeek。请检查网络；若浏览器拦截跨域请求，请改用支持的浏览器或服务端代理。');}
    const body=await response.json().catch(()=>null);
    if(!response.ok){const detail=body?.error?.message||`HTTP ${response.status}`;throw new Error(`DeepSeek 请求失败：${detail}`);}
    const content=body?.choices?.[0]?.message?.content;
    if(!content&&retry)return request(userPrompt+'\n请务必立即输出非空 JSON。',false);
    try{return normalize(JSON.parse(content));}
    catch(error){if(retry)return request(userPrompt+'\n上一次格式无效，请严格按示例重新输出 JSON。',false);throw error;}
  }
  function metadata(meeting){return `会议名称：${meeting.title}\n会议日期：${meeting.date}\n会议类型：${meeting.type}\n已知参会人：${meeting.attendees||'待确认'}`;}
  async function generate(meeting,transcript,onProgress=()=>{}){
    const chunks=splitTranscript(transcript.trim());
    if(!chunks[0])throw new Error('会议原文为空，无法生成纪要。');
    if(chunks.length===1){onProgress('DeepSeek 正在按 meeting-notes Skill 整理…');return request(`${metadata(meeting)}\n\n请把以下会议原文整理成完整纪要 JSON：\n\n${chunks[0]}`);}
    const partial=[];
    for(let i=0;i<chunks.length;i++){
      onProgress(`正在整理长会议：第 ${i+1}/${chunks.length} 段…`);
      partial.push(await request(`${metadata(meeting)}\n\n这是长会议原文的第 ${i+1}/${chunks.length} 段。提取本段事实，输出纪要 JSON；不要把未在本段出现的信息补进去：\n\n${chunks[i]}`));
    }
    onProgress('正在合并各段结果并去重…');
    return request(`${metadata(meeting)}\n\n以下是长会议各段的结构化结果。请合并、去重、解决重复表述并输出一份完整纪要 JSON；不得增加这些结果之外的事实：\n\n${JSON.stringify(partial)}`);
  }
  function refreshBadge(){const button=document.querySelector('#ai-settings');if(button)button.textContent=credentials?'DeepSeek 已配置 ✓':'连接 DeepSeek ⚙';}
  function settings(callback){afterConfigure=callback||null;const form=document.querySelector('#ai-form');form.reset();document.querySelector('#ai-status').textContent=credentials?'本页已有配置。填写后可替换，关闭窗口则保留。':'API Key 仅保留在本页内存；整理时才会调用 DeepSeek。';document.querySelector('#ai-dialog').showModal();}
  function configure(apiKey,model='deepseek-flash'){credentials={apiKey:apiKey.trim(),model};refreshBadge();}
  document.querySelector('#ai-settings').onclick=()=>settings();
  document.querySelector('#ai-form').onsubmit=event=>{
    event.preventDefault();const form=event.target;configure(form.elements.apiKey.value,form.elements.model.value);form.reset();document.querySelector('#ai-dialog').close();const callback=afterConfigure;afterConfigure=null;callback?.();
  };
  document.querySelector('#clear-ai').onclick=()=>{credentials=null;afterConfigure=null;refreshBadge();document.querySelector('#ai-form').reset();document.querySelector('#ai-status').textContent='本页 DeepSeek 配置已清除。';};
  document.querySelector('#ai-dialog').addEventListener('close',()=>document.querySelector('#ai-form').reset());
  return {generate,settings,configure,mode:()=>credentials?'configured':'unconfigured',splitTranscript,normalize};
})();
