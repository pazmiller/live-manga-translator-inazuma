// Real windows and native movement; backend and capture computation are controlled.
const {app,BrowserWindow,desktopCapturer}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {promisify}=require('node:util'),{execFile}=require('node:child_process');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.setPath('userData',fs.mkdtempSync(path.join(root,'.qa/window-lifecycle-')));
app.commandLine.appendSwitch('smoke-test');delete process.env.MWT_GLASS_CAPTURE;
process.env.MWT_ENV_FILE=path.join(app.getPath('userData'),'none');process.env.DEEPSEEK_API_KEY='test-lifecycle-key';
global.fetch=async()=>Response.json({service:'manga-window-translator',protocol:4,ocr:'ready',providers:{deepseek:true}});
const protections=new Map(),protect=BrowserWindow.prototype.setContentProtection;
BrowserWindow.prototype.setContentProtection=function(value){protections.set(this.id,value);return protect.call(this,value);};
let captures=0,excludedDuringCapture=false;
desktopCapturer.getSources=async()=>{
  captures++;excludedDuringCapture=BrowserWindow.getAllWindows().every(w=>protections.get(w.id)===true);
  throw Error('Controlled screenshot failure');
};
require('./mock-backend.cjs')();require('../main.js');
const read=(win,code)=>win.webContents.executeJavaScript(code,true);
async function native(win,move=false){
  const args=['-NoProfile','-File',path.join(__dirname,'native-window-state.ps1'),win.getNativeWindowHandle().readBigUInt64LE().toString()];
  if(move)args.push('-Move');
  return JSON.parse((await promisify(execFile)('powershell.exe',args)).stdout);
}
app.whenReady().then(async()=>{try {
  await delay(1200);
  const frame=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('frame.html'));
  const selection=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('selection.html'));
  const before=frame.getBounds();
  assert.equal((await native(frame,true)).affinity,0,'Idle toolbar must be screenshot-visible');
  await native(selection,true);await delay(150);
  const after=frame.getBounds();
  assert(Math.abs(after.width-before.width)<=1,`Toolbar grew from ${before.width} to ${after.width}`);
  assert(Math.abs(after.height-before.height)<=1,`Toolbar height drifted from ${before.height} to ${after.height}`);
  await read(frame,'window.api.configuration()');await delay(250);
  const settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('settings.html'));
  const settingsBefore=settings.getBounds();await native(selection,true);
  assert.deepEqual(settings.getBounds(),settingsBefore,'Settings dialog changed size/position');
  await read(settings,'void window.settingsApi.close()');
  for(let i=0;i<20 && !settings.isDestroyed();i++)await delay(25);
  assert(settings.isDestroyed());
  await read(frame,"window.api.setReadingMode('watch')");
  for(let i=0;i<40 && !captures;i++)await delay(50);
  await read(frame,"window.api.setReadingMode('fixed')");await delay(150);
  assert(captures>0);assert(excludedDuringCapture,'Watch screenshot must exclude app UI');
  assert.equal((await native(frame)).affinity,0,'Capture failure must restore screenshot visibility');
  assert.equal((await native(selection)).affinity,0);
  frame.showInactive();selection.showInactive();
  await read(frame,"window.api.lock({source:'ja',target:'zh-CN',provider:'deepseek',mode:'smart',fontScale:1,glassTone:'clear',readingMode:'fixed'})");
  assert(frame.isVisible() && selection.isVisible(),'Failed translation capture must restore visible windows');
  console.log(JSON.stringify({passed:true,before,after,settingsStable:true,captureExclusionRestored:true}));app.quit();
}catch(error){console.error(error);app.exit(1);}});
