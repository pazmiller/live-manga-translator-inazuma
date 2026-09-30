// Probe Windows non-client hit testing; no system mouse movement or clicks.
const {app,BrowserWindow,screen,desktopCapturer}=require('electron');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const path=require('node:path');
const assert=require('node:assert/strict');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fs=require('node:fs');
fs.mkdirSync(path.resolve(__dirname,'../.qa'),{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.resolve(__dirname,'../.qa/toolbar-input-')));
delete process.env.MWT_GLASS_CAPTURE;
process.env.MWT_ENV_FILE=path.join(app.getPath('userData'),'no-env');
process.env.DEEPSEEK_API_KEY='test-toolbar-key';
global.fetch=async()=>Response.json({service:'manga-window-translator',protocol:4,ocr:'ready',providers:{deepseek:true}});
require('node:child_process').spawn=()=>{throw Error('Unexpected backend spawn');};
let captureRequests=0;
desktopCapturer.getSources=async()=>{captureRequests++;throw Error('Controlled capture failure');};
const originalIgnore=BrowserWindow.prototype.setIgnoreMouseEvents;
const ignoreRequests=new Map();
let pointer={x:0,y:0};
app.whenReady().then(()=>{screen.getCursorScreenPoint=()=>pointer;});
BrowserWindow.prototype.setIgnoreMouseEvents=function(value){ignoreRequests.set(this.id,value);return originalIgnore.call(this,true,{forward:true});};
BrowserWindow.prototype.focus=function(){};
app.on('browser-window-created',(_,win)=>{win.setFocusable(false);win.setIgnoreMouseEvents(true);});
require('./mock-backend.cjs')();
require('../main');
app.whenReady().then(async()=>{
  try {
    await delay(1600);
    const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('frame.html'));
    const points=await win.webContents.executeJavaScript(`['lock','clear','reveal','larger','interactToggle','quit','source','moveSelection','title'].map(id=>{const r=(id==='title'?document.querySelector('h1'):document.getElementById(id)).getBoundingClientRect();return {id,x:r.x+r.width/2,y:r.y+r.height/2};})`);
    const bounds=win.getBounds();
    const absolute=points.map(p=>({id:p.id,...screen.dipToScreenPoint({x:Math.round(bounds.x+p.x),y:Math.round(bounds.y+p.y)})}));
    const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-File',path.join(__dirname,'native-hit-test.ps1'),win.getNativeWindowHandle().readBigUInt64LE().toString(),JSON.stringify(absolute)]);
    const hits=JSON.parse(stdout);
    console.log(JSON.stringify(hits));
    for(const result of hits) assert.equal(result.hit,result.id==='title'?2:1,`${result.id} has incorrect native hit region`);
    async function click(id) {
      const p=points.find(p=>p.id===id);
      pointer={x:Math.round(bounds.x+p.x),y:Math.round(bounds.y+p.y)};
      await delay(90);
      assert.equal(ignoreRequests.get(win.id),false,'Toolbar must request real mouse input over controls');
      const at={x:Math.round(p.x),y:Math.round(p.y)};
      win.webContents.sendInputEvent({type:'mouseMove',...at});
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...at});
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...at});
      await delay(140);
    }
    const read=code=>win.webContents.executeJavaScript(code);
    await click('larger');assert.match(await read(`document.getElementById('status').textContent`),/字号/);
    await click('interactToggle');assert.equal(await read(`document.getElementById('interactToggle').getAttribute('aria-pressed')`),'true');
    await click('reveal');assert.equal(await read(`document.getElementById('reveal').getAttribute('aria-pressed')`),'true');
    await click('clear');assert.equal(await read(`document.getElementById('status').textContent`),'已清除');
    await click('lock');assert.equal(captureRequests,1,'Translate click must reach the main capture handler');
    assert.equal(await read(`document.getElementById('status').textContent`),'翻译未完成');
    await click('clear');assert.equal(await read(`document.getElementById('message').hidden`),true);
    await click('quit');assert.equal(await read(`document.getElementById('quit').textContent`),'退出?');
    console.log('PASS native button/title regions, mouse routing and pointer-driven controls with real IPC');
  }catch(error){console.error(error);process.exitCode=1;}
  finally{app.exit(process.exitCode||0);}
});
