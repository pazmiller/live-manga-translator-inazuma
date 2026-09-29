const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {createSecurity,webPreferences}=require('../electron-security.cjs');
const {ipcMain}=require('electron');
const root=path.resolve(__dirname,'..');
app.setPath('userData',fs.mkdtempSync(path.join(root,'.qa/security-ui-')));
const security=createSecurity(ipcMain);
security.handle('frame:getBounds',()=>({width:123}));
security.handle('frame:quit',()=>assert.fail('wrong role reached quit'));
const run=(win,code)=>win.webContents.executeJavaScript(code,true);
app.whenReady().then(async()=>{
  try {
    const file=path.join(root,'renderer/selection.html');
    const win=new BrowserWindow({show:false,webPreferences:{...webPreferences,preload:path.join(root,'preload.js')}});
    security.protectWindow(win,'selection',file);await win.loadFile(file);
    assert.equal((await run(win,'window.api.getBounds()')).width,123);
    assert.equal(await run(win,'typeof require'),'undefined');
    assert.equal(win.webContents.getLastWebPreferences().sandbox,true);
    await assert.rejects(run(win,'window.api.quit()'),/Blocked IPC/);
    const rogue=new BrowserWindow({show:false,webPreferences:{...webPreferences,preload:path.join(root,'preload.js')}});
    await rogue.loadFile(file);
    await assert.rejects(run(rogue,'window.api.getBounds()'),/Blocked IPC/);
    const blocked=await run(win,`(async()=>{
      window.injected=false;const s=document.createElement('script');s.textContent='window.injected=true';document.body.append(s);
      let networkBlocked=false;try{await fetch('https://example.com')}catch{networkBlocked=true}
      return {inline:!window.injected,network:networkBlocked,notification:await Notification.requestPermission()};
    })()`);
    assert.deepEqual(blocked,{inline:true,network:true,notification:'denied'});
    const count=BrowserWindow.getAllWindows().length;
    await run(win,"window.open('https://example.com');void 0");
    await run(win,"location.href='https://example.com';void 0");
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(BrowserWindow.getAllWindows().length,count);
    assert.equal(win.webContents.getURL(),require('node:url').pathToFileURL(file).href);
    console.log('PASS: real sandbox, IPC role/source denial, inline script/network CSP, permission, popup and navigation blocking');
    app.quit();
  } catch(error){console.error(error);app.exit(1);}
});
