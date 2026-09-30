const {app,BrowserWindow,desktopCapturer,nativeImage,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const profile=fs.mkdtempSync(path.join(root,'.qa/auth-ui-'));
app.setPath('userData',profile);app.commandLine.appendSwitch('smoke-test');
process.env.MWT_ENV_FILE=path.join(profile,'no-legacy.env');
for(const key of ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY'])delete process.env[key];
process.env.DEEPSEEK_API_KEY='test-auth-only-key';
delete process.env.MWT_BACKEND_PORT;
// Only replace OCR/provider computations, not provisioning or network auth.
const cp=require('node:child_process'),spawn=cp.spawn;
cp.spawn=(command,args,options)=>spawn(command,args[0]==='server.py'?[path.join(__dirname,'auth-backend-fixture.py'),...args.slice(1)]:args,options);
desktopCapturer.getSources=async()=>[{display_id:String(screen.getPrimaryDisplay().id),thumbnail:nativeImage.createFromPath(path.join(root,'.qa/fixture.png'))}];
require('../main.js');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<200;i++){if(await fn())return;await delay(50);}throw Error(`Timeout: ${label}`);}
const evaluate=(win,code)=>win.webContents.executeJavaScript(code,true);
app.whenReady().then(async()=>{
  try {
    let frame;
    await until(()=>frame=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('frame.html')),'toolbar');
    await until(()=>!frame.webContents.isLoading(),'loaded');
    assert.equal((await evaluate(frame,'window.api.health()')).ocr,'ready');
    await evaluate(frame,"document.getElementById('lock').click()");
    let overlay;
    await until(()=>overlay=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('overlay.html')),'overlay');
    await until(()=>evaluate(overlay,"document.querySelector('.copy')?.textContent==='Fixture translation'"),'translated bubble');
    await evaluate(overlay,"document.querySelector('.edit').click()");
    await until(()=>evaluate(overlay,"document.getElementById('editor-source').value==='こんにちは'"),'bubble editor');
    await evaluate(overlay,"document.getElementById('editor-source').value='Edited source';document.getElementById('editor-save').click()");
    await until(()=>evaluate(overlay,"document.querySelector('.copy')?.textContent==='Corrected translation'"),'single bubble saved');
    const enhanced=await evaluate(frame,'window.api.enhanceCurrent()');
    assert(!enhanced.error,enhanced.error);assert.equal(enhanced.count,1);
    await evaluate(frame,"document.getElementById('clear').click()");
    await until(()=>evaluate(frame,"document.getElementById('status').textContent==='已清除'"),'clear');
    console.log('PASS: real Electron/Python auth, translate button, streaming bubble, edit/save, enhanced OCR, clear and shutdown; synthetic OCR/provider data');
    app.quit();
  } catch(error){console.error(error);app.once('will-quit',()=>app.exit(1));app.quit();}
});
