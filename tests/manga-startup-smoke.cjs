// Hidden full-app startup check with the real local OCR services, no provider call.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(root,'.qa','manga-startup-user-data'));
app.commandLine.appendSwitch('smoke-test');
process.env.MWT_BACKEND_PORT='18767';
require('../main.js');

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,description,timeout=90000) {
  const started=Date.now();
  while(Date.now()-started<timeout) {
    const value=await check();
    if(value) return value;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

app.whenReady().then(async()=>{
  try {
    const frame=await until(()=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('frame.html')),'frame');
    const health=()=>frame.webContents.executeJavaScript('window.api.health()',true);
    await until(()=>frame.webContents.executeJavaScript('Boolean(window.api?.health)',true),'preload');
    const ready=await until(async()=>{
      const state=await health();
      assert.equal(state.protocol,4);
      if(state.manga_ocr_state==='error' || state.manga_ocr_state==='missing') throw new Error(`Manga OCR ${state.manga_ocr_state}`);
      return state.ocr==='ready' && state.manga_ocr_state==='ready' ? state : null;
    },'both OCR models to warm');
    assert.equal(ready.manga_ocr,true);
    console.log('PASS: full app started and both OCR models are ready before translation');
    app.quit();
  } catch(error) {
    console.error(error);
    app.exit(1);
  }
});
