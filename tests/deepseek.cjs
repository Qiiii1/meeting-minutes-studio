const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  let calls=0,authorization='';
  await context.route('https://api.deepseek.com/chat/completions',async route=>{
    calls++;authorization=route.request().headers().authorization;
    const request=route.request().postDataJSON();
    assert.equal(request.model,'deepseek-flash');
    assert.equal(request.response_format.type,'json_object');
    assert(request.messages[0].content.includes('meeting-notes Skill'));
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({
      summary:'团队确认首版会议纪要流程。',
      points:['产品范围：完成记录、整理和导出闭环'],
      decisions:['首版支持上传录音与粘贴文字'],
      actions:[{text:'完成交互原型',owner:'林悦',due:'2026-09-22',priority:'高'},{text:'联系试用用户',owner:'',due:'',priority:'中'}],
      next_steps:['下次检查完整流程'],
      parking_lot:['试用样本负责人待确认']
    })}}]})});
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.BASE_URL||'http://127.0.0.1:4173/',{waitUntil:'networkidle'});
  assert.equal(await page.evaluate(()=>DeepSeekNotes.mode()),'unconfigured');
  assert.deepEqual(await page.evaluate(()=>DeepSeekNotes.splitTranscript('甲'.repeat(60000)).map(x=>x.length)),[28000,28000,4000]);
  await page.locator('.meeting-card').first().click();
  const before=await page.locator('[data-field=summary]').innerText();
  await page.locator('#generate-notes').click();await page.locator('#ai-dialog').waitFor();
  await page.locator('#ai-form [name=apiKey]').fill('test-only-deepseek-key');
  await page.locator('#ai-form [type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('[data-field=summary]')?.textContent==='团队确认首版会议纪要流程。');
  assert.equal(calls,1);assert.equal(authorization,'Bearer test-only-deepseek-key');
  assert.equal(await page.locator('#actions .action-row').count(),2);
  assert.equal(await page.locator('#actions .action-row').nth(1).locator('[data-prop=owner]').innerText(),'待确认');
  assert.equal(await page.locator('#actions .action-row').nth(1).locator('[data-prop=due]').innerText(),'待确认');
  assert((await page.locator('[data-field=pending]').innerText()).includes('负责人待确认'));
  assert(await page.evaluate(()=>!JSON.stringify(localStorage).includes('test-only-deepseek-key')&&!JSON.stringify(sessionStorage).includes('test-only-deepseek-key')));
  await page.locator('#undo-ai').click();assert.equal(await page.locator('[data-field=summary]').innerText(),before);
  await page.reload();assert.equal(await page.evaluate(()=>DeepSeekNotes.mode()),'unconfigured');
  assert.deepEqual(errors,[]);
  console.log('PASS: DeepSeek JSON request, meeting-notes prompt, generated fields, unknown owner/date safeguards, undo, long-text splitting, session-only secret. Provider mocked.');
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
