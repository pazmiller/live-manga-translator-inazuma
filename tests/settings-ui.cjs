// Real Electron windows + IPC + encrypted storage; provider network is controlled.
const {app,BrowserWindow,desktopCapturer,nativeImage,screen}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const qa=path.join(root,'.qa');
fs.mkdirSync(qa,{recursive:true});
const userData=fs.mkdtempSync(path.join(qa,'settings-ui-'));
app.setPath('userData',userData);
app.commandLine.appendSwitch('smoke-test');
process.env.MWT_ENV_FILE=path.join(userData,'no-legacy.env');
for(const key of ['OPENAI_API_KEY','GEMINI_API_KEY','DEEPSEEK_API_KEY','OPENAI_MODEL','GEMINI_MODEL','DEEPSEEK_MODEL']) delete process.env[key];
let syncMode='success', pointer={x:0,y:0};
const requests=[];
global.fetch=async(url,options)=>{
  url=String(url);
  if(url.endsWith('/health')) return Response.json({service:'manga-window-translator',protocol:4,ocr:'ready',providers:{}});
  if(url.endsWith('/models')) {
    assert(options.headers.Authorization.startsWith('Bearer test-'));
    if(syncMode==='failure') return new Response('private-error-body',{status:401});
    return Response.json({data:[{id:'gpt-6-luna'},{id:'gpt-custom-latest'}]});
  }
  if(url.endsWith('/translate/stream')) {
    const body=JSON.parse(options.body);requests.push(body);
    const raw={id:0,x:60,y:60,w:140,h:80,text:'原文',translated:'清除',can_replace:false};
    const events=[{type:'regions',bubbles:[raw]},{type:'bubble',bubble:raw},{type:'done',count:1}];
    return new Response(events.map(event=>JSON.stringify(event)).join('\n')+'\n');
  }
  throw Error(`Unexpected network request ${url}`);
};
require('node:child_process').spawn=()=>{throw Error('Unexpected backend process');};
app.on('browser-window-created',(_,win)=>win.webContents.setBackgroundThrottling(false));
app.whenReady().then(()=>{screen.getCursorScreenPoint=()=>pointer;});
desktopCapturer.getSources=async()=>[{display_id:String(screen.getPrimaryDisplay().id),
  thumbnail:nativeImage.createFromPath(path.join(qa,'fixture.png'))}];
require('../main.js');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=10000) {
  const start=Date.now();while(Date.now()-start<timeout){const value=await check();if(value)return value;await delay(50);}
  throw Error(`Timed out: ${label}`);
}
const evaluate=(win,code)=>win.webContents.executeJavaScript(code,true);
async function click(win,selector) {
  const point=await evaluate(win,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  const bounds=win.getBounds();pointer={x:bounds.x+point.x,y:bounds.y+point.y};
  await delay(70);
  win.webContents.sendInputEvent({type:'mouseMove',...point});
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  await delay(50);
}
async function type(win,selector,value) {
  await click(win,selector);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['control']});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['control']});
  win.webContents.insertText(value);await delay(30);
}
async function choose(win,value) {
  await evaluate(win,`document.getElementById('model').value=${JSON.stringify(value)};document.getElementById('model').dispatchEvent(new Event('change'))`);
}
async function snapshot(win,name) {
  win.showInactive();win.webContents.invalidate();
  await evaluate(win,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await delay(100);
  fs.writeFileSync(path.join(qa,name),(await win.webContents.capturePage()).toPNG());
  win.hide();
}
async function open(frame) {
  await click(frame,'#configuration');
  const win=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('settings.html')),'settings window');
  await until(()=>evaluate(win,"!document.getElementById('save').disabled"),'settings loaded');
  return win;
}
async function translate(frame,provider,model,key) {
  const count=requests.length;
  await click(frame,'#lock');
  await until(()=>requests.length===count+1,'translation request');
  assert.equal(requests.at(-1).provider,provider);
  assert.equal(requests.at(-1).model,model);
  assert.equal(requests.at(-1).api_key,key);
  await until(()=>evaluate(frame,"['翻译选区','Translate region'].includes(document.querySelector('#lock span').textContent)"),'translation complete');
}
app.whenReady().then(async()=>{
  try {
    const frame=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('frame.html')),'toolbar');
    await until(()=>evaluate(frame,"document.getElementById('status').textContent.includes('翻译AI配置')"),'unconfigured prompt');
    let win=await open(frame);
    assert.equal(BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('settings.html')).length,1);
    assert.deepEqual(await evaluate(frame,"Array.from(document.getElementById('provider').options).map(o=>o.value)"),['deepseek','openai','gemini']);
    await click(win,'label:has(input[value="openai"])');
    await type(win,'#api-key','test-openai-key');
    await click(win,'#toggle-key');
    assert.equal(await evaluate(win,"document.getElementById('api-key').type"),'text');
    await click(win,'#toggle-key');
    await click(win,'#sync');
    await until(()=>evaluate(win,"document.getElementById('feedback').textContent.includes('连接成功')"),'model sync');
    assert.equal(await evaluate(win,"document.getElementById('endpoint').textContent"),'https://api.openai.com/v1');
    await choose(win,'__custom');await type(win,'#custom-model','gpt-custom-manual');
    // API Key stays hidden in captured evidence.
    await snapshot(win,'settings-openai.png');
    await click(win,'#save');await until(()=>win.isDestroyed(),'save closes settings');
    await translate(frame,'openai','gpt-custom-manual','test-openai-key');
    win=await open(frame);
    assert.equal(await evaluate(win,"document.getElementById('api-key').value"),'');
    assert.match(await evaluate(win,"document.getElementById('api-key').placeholder"),/留空沿用/);
    assert.equal(await evaluate(win,"document.getElementById('custom-model').value"),'gpt-custom-manual');
    const summary=await evaluate(win,'window.settingsApi.load()');
    assert(!JSON.stringify(summary).includes('test-openai-key'));
    await choose(win,'gpt-6-luna');await click(win,'#save');await until(()=>win.isDestroyed(),'save with retained key');
    await translate(frame,'openai','gpt-6-luna','test-openai-key');
    win=await open(frame);await click(win,'label:has(input[value="gemini"])');
    await type(win,'#api-key','test-gemini-key');syncMode='failure';await click(win,'#sync');
    await until(()=>evaluate(win,"document.getElementById('feedback').classList.contains('error')"),'sync error');
    assert.match(await evaluate(win,"document.getElementById('feedback').textContent"),/密钥无效/);
    assert.equal(await evaluate(win,"document.getElementById('save').disabled"),false);
    await snapshot(win,'settings-error.png');
    await choose(win,'gemini-3.8-flash');await click(win,'#save');await until(()=>win.isDestroyed(),'Gemini saved');
    await translate(frame,'gemini','gemini-3.8-flash','test-gemini-key');
    win=await open(frame);await click(win,'label:has(input[value="deepseek"])');
    await type(win,'#api-key','test-deepseek-key');await click(win,'#save');await until(()=>win.isDestroyed(),'DeepSeek saved');
    await translate(frame,'deepseek','deepseek-flash','test-deepseek-key');
    win=await open(frame);
    await evaluate(win,"document.getElementById('custom-model').value='unused'");
    win.setResizable(true);win.setSize(440,610);await delay(100);
    assert(await evaluate(win,"document.documentElement.scrollWidth<=innerWidth"),'Small window has no horizontal overflow');
    await snapshot(win,'settings-small.png');
    await click(win,'#sync');
    await until(()=>evaluate(win,"document.getElementById('feedback').classList.contains('error')"),'small window sync error');
    assert(await evaluate(win,"document.getElementById('feedback').getBoundingClientRect().bottom<=document.querySelector('footer').getBoundingClientRect().top"),'Error must be visible above the fixed actions');
    await click(win,'#cancel');await until(()=>win.isDestroyed(),'cancel closes window');
    assert.equal(await evaluate(frame,"document.getElementById('provider').value"),'deepseek');
    const originalTarget=await evaluate(frame,"document.getElementById('target').value");
    await click(frame,'#uiLanguage');
    await until(()=>evaluate(frame,"document.documentElement.lang==='en'"),'English toolbar');
    assert.equal(await evaluate(frame,"document.querySelector('#lock span').textContent"),'Translate region');
    assert.equal(await evaluate(frame,"document.getElementById('target').value"),originalTarget,'UI language must not change translation target');
    assert(await evaluate(frame,"Array.from(document.querySelectorAll('button,select')).filter(e=>e.getClientRects().length).every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})"),'English toolbar controls fit');
    frame.webContents.send('frame:status',{text:'正在翻译 2/5…'});
    await until(()=>evaluate(frame,"document.getElementById('status').textContent==='Translating 2/5…'"),'localized progress');
    await snapshot(frame,'frame-english.png');
    await translate(frame,'deepseek','deepseek-flash','test-deepseek-key');
    const overlay=BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('overlay.html')).at(-1);
    await until(()=>evaluate(overlay,"document.querySelector('.edit')?.textContent==='Edit'"),'English bubble controls');
    assert.equal(await evaluate(overlay,"document.querySelector('.copy').textContent"),'清除','Manga translation is never localized');
    await click(overlay,'.edit');
    await until(()=>evaluate(overlay,"document.getElementById('editor-source').value==='原文'"),'saved source');
    assert.equal(await evaluate(overlay,"document.getElementById('editor-translation').textContent"),'清除');
    assert.equal(await evaluate(overlay,"document.getElementById('editor-save').textContent"),'Translate & save');
    await snapshot(overlay,'editor-english.png');
    await click(overlay,'#editor-close');
    win=await open(frame);
    assert.equal(await evaluate(win,"document.documentElement.lang"),'en','New windows inherit saved UI language');
    assert.match(await evaluate(win,"document.getElementById('api-key').placeholder"),/Leave blank/);
    await click(win,'#sync');
    await until(()=>evaluate(win,"document.getElementById('feedback').textContent.includes('Invalid key')"),'English provider error');
    await snapshot(win,'settings-english.png');
    win.setResizable(true);win.setSize(440,610);await delay(100);
    await click(win,'#sync');
    await until(()=>evaluate(win,"document.getElementById('feedback').textContent.includes('Invalid key')"),'English small window error');
    assert(await evaluate(win,"document.documentElement.scrollWidth<=innerWidth"),'English settings fit narrow windows');
    await snapshot(win,'settings-english-small.png');
    await click(win,'#cancel');await until(()=>win.isDestroyed(),'English cancel');
    frame.webContents.reload();
    await until(()=>evaluate(frame,"document.documentElement.lang==='en' && document.querySelector('#lock span')?.textContent==='Translate region'"),'language persists after reload');
    win=await open(frame);await click(win,'#uiLanguage');
    await until(()=>evaluate(frame,"document.querySelector('#lock span').textContent==='翻译选区'"),'Chinese synchronized across windows');
    assert.equal(await evaluate(win,"document.getElementById('save').textContent"),'保存并使用');
    await click(win,'#cancel');await until(()=>win.isDestroyed(),'Chinese cancel');
    const saved=fs.readFileSync(path.join(userData,'ai-settings.json'),'utf8');
    assert(!saved.includes('test-openai-key')&&!saved.includes('test-gemini-key')&&!saved.includes('test-deepseek-key'));
    assert(!fs.existsSync(path.join(userData,'settings.env.txt')));
    console.log('PASS: AI settings, provider routing, encrypted keys, English/Chinese persistence and cross-window sync, source/translation protection');
    app.quit();
  } catch(error) {console.error(error);app.exit(1);}
});
