// Real main/preload/renderers; synthetic desktop capture and backend only.
const {app, BrowserWindow, desktopCapturer} = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
app.setPath('userData',path.resolve(__dirname,'../.qa/responsive-tests'));
delete process.env.MWT_GLASS_CAPTURE;
process.env.MWT_BACKEND_PORT='18779';
let captures=0;
desktopCapturer.getSources=async()=>{captures++;return [];};
require('node:child_process').spawn=()=>{throw Error('Unexpected backend spawn');};
global.fetch=async()=>Response.json({service:'manga-window-translator',protocol:4,ocr:'ready',providers:{}});
const ignore=BrowserWindow.prototype.setIgnoreMouseEvents;
BrowserWindow.prototype.setIgnoreMouseEvents=function(){return ignore.call(this,true,{forward:true});};
BrowserWindow.prototype.focus=function(){};
app.on('browser-window-created',(_,win)=>{win.setFocusable(false);win.setIgnoreMouseEvents(true);});
require('../main');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  try {
    await delay(1800);
    const wins=BrowserWindow.getAllWindows();
    const toolbar=wins.find(win=>win.webContents.getURL().endsWith('frame.html'));
    const selection=wins.find(win=>win.webContents.getURL().endsWith('selection.html'));
    assert(toolbar && selection);
    const bounds=selection.getBounds();
    let maxLag=0,last=performance.now();
    const timer=setInterval(()=>{const now=performance.now();maxLag=Math.max(maxLag,now-last-20);last=now;},20);
    try {
      for(let i=0;i<35;i++) {
        selection.setBounds({...bounds,x:bounds.x+i*2,width:bounds.width+i});
        toolbar.webContents.send('glass:motion',{x:50+i*12,y:60,impulse:10});
        await delay(40);
      }
      await delay(300);
    } finally {clearInterval(timer);}
    assert.equal(captures,0,'Default startup/drag must never invoke decorative desktop capture');
    const maps=await toolbar.webContents.executeJavaScript(`document.querySelector('feImage')?.hasAttribute('href')`);
    assert.equal(maps,false,'Default rendering must not build optical displacement maps');
    assert(maxLag<200,`Input heartbeat stalled for ${Math.round(maxLag)}ms`);
    console.log(JSON.stringify({passed:true,captures,resizeSteps:35,maxMainHeartbeatLagMs:Math.round(maxLag),gpu:app.getGPUFeatureStatus().gpu_compositing}));
  } catch(error){console.error(error);process.exitCode=1;}
  finally {app.exit(process.exitCode || 0);}
});
