// Full main/preload/HTTP/provider flow using saved screen pixels and deliberate
// stream interruptions. Native input is bypassed to avoid desktop interference;
// requested routing decisions are still checked through the real main process.
const {app,BrowserWindow,screen,desktopCapturer}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const qa=path.join(root,'.qa');
fs.mkdirSync(qa,{recursive:true});
app.setPath('userData',path.join(qa,'native-tests'));
app.disableHardwareAcceleration();
process.env.MWT_BACKEND_PORT='18766';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let fixtureImage,cursorOverride,interruptNext=false,captureCalls=0;
const requests=[];
const bubbleActions=[];
const ignoreStates=new Map();
const nativeIgnore=BrowserWindow.prototype.setIgnoreMouseEvents;
BrowserWindow.prototype.setIgnoreMouseEvents=function(ignore,options) {
  ignoreStates.set(this.id,ignore);return nativeIgnore.call(this,true,options);
};
BrowserWindow.prototype.focus=function(){};
app.on('browser-window-created',(_event,win)=>{win.setFocusable(false);nativeIgnore.call(win,true,{forward:true});});
desktopCapturer.getSources=async options=>{
  // Optical background sampling is separate from an OCR/reading capture.
  if(options.fetchWindowIcons!==false) captureCalls++;
  return [{display_id:String(screen.getPrimaryDisplay().id),thumbnail:fixtureImage}];
};
const nativeFetch=global.fetch;
global.fetch=async(url,options)=>{
  const action=String(url).includes('/bubble/') ? {endpoint:new URL(url).pathname,text:JSON.parse(options.body).text} : null;
  if(action) bubbleActions.push(action);
  const response=await nativeFetch(url,options);
  if(action) {const result=await response.clone().json();action.status=response.status;action.returnedText=result.text;}
  if(!String(url).endsWith('/translate/stream')) return response;
  const payload=JSON.parse(options.body);
  const request={only_ids:payload.only_ids ?? null,provider:payload.provider,cut:false,firstId:null};
  requests.push(request);
  if(!interruptNext || !response.ok) return response;
  interruptNext=false;request.cut=true;
  const reader=response.body.getReader(),decoder=new TextDecoder(),encoder=new TextEncoder();
  const body=new ReadableStream({
    async start(controller) {
      let pending='';
      try {
        while(true) {
          const {value,done}=await reader.read();
          if(done) {controller.close();return;}
          pending+=decoder.decode(value,{stream:true});
          let end;
          while((end=pending.indexOf('\n'))>=0) {
            const line=pending.slice(0,end);pending=pending.slice(end+1);
            controller.enqueue(encoder.encode(line+'\n'));
            if(line.trim() && JSON.parse(line).type==='bubble') {
              request.firstId=JSON.parse(line).bubble.id;
              controller.close();await reader.cancel().catch(()=>{});return;
            }
          }
        }
      } catch(error) {controller.error(error);}
    },
    cancel:()=>reader.cancel(),
  });
  return new Response(body,{status:response.status,headers:response.headers});
};
require('../main.js');

async function until(check,description,timeout=90000) {
  const start=Date.now();
  while(Date.now()-start<timeout) {
    const result=await check();if(result) return result;await delay(100);
  }
  throw new Error('Timed out waiting for '+description);
}

app.whenReady().then(async()=>{
  let fixture,frame,selection,overlay;
  const report={requests,bubbleActions,nativeInput:'Bypassed to prevent desktop interference; intended routing decisions checked'};
  try {
    const nativeCursor=screen.getCursorScreenPoint.bind(screen);
    screen.getCursorScreenPoint=()=>cursorOverride || nativeCursor();
    frame=await until(()=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('frame.html')),'toolbar');
    selection=await until(()=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('selection.html')),'selection window');
    const evaluate=code=>frame.webContents.executeJavaScript(code,true);
    await until(()=>evaluate(`Boolean(window.api && document.getElementById('lock'))`),'toolbar API');
    await evaluate(`document.getElementById('fixedMode').click();document.getElementById('source').value='ja';document.getElementById('target').value='zh-CN';document.getElementById('mode').value='smart'`);
    const display=screen.getPrimaryDisplay();
    const x=display.workArea.x+35,y=display.workArea.y+95;
    const width=Math.min(1000,display.workArea.width-80),height=Math.min(740,display.workArea.height-140);
    fixture=new BrowserWindow({width:display.bounds.width,height:display.bounds.height,frame:false,show:false,skipTaskbar:true,webPreferences:{contextIsolation:true}});
    const html=path.join(qa,'native-fixture.html');
    fs.writeFileSync(html,`<body style="margin:0;background:#ddd"><img src="fixture.png" style="position:absolute;left:${x-display.bounds.x}px;top:${y-display.bounds.y}px;width:${width}px;height:${height}px"></body>`);
    await fixture.loadFile(html);
    await until(()=>fixture.webContents.executeJavaScript(`document.querySelector('img').complete && document.querySelector('img').naturalWidth>0`),'fixture image');
    fixtureImage=await fixture.webContents.capturePage();
    selection.setBounds({x:x-6,y:y-6,width:width+12,height:height+12});selection.showInactive();
    frame.setPosition(display.workArea.x+display.workArea.width-frame.getBounds().width-20,display.workArea.y+35);
    frame.showInactive();
    await evaluate(`document.getElementById('provider').value='deepseek'`);
    const health=await evaluate(`window.api.health()`);
    assert.equal(health.protocol,4);assert(health.providers.deepseek,'Live smoke needs configured DeepSeek key');

    async function translateSelection({cut=false}={}) {
      const before=requests.length;interruptNext=cut;
      await evaluate(`document.getElementById('lock').click()`);
      await until(()=>requests.length>before,'HTTP translation start');
      await until(()=>evaluate(`!document.getElementById('lock').textContent.includes('取消')`),'translation completion');
      return evaluate(`({status:document.getElementById('status').textContent,error:document.getElementById('message').hidden?null:document.getElementById('message').textContent})`);
    }
    report.state=await translateSelection();
    assert.equal(report.state.error,null,JSON.stringify(report.state));
    overlay=await until(()=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('overlay.html')),'overlay');
    const view=code=>overlay.webContents.executeJavaScript(code,true);
    const bubbles=()=>view(`Array.from(document.querySelectorAll('.bubble')).map(el=>({key:el.dataset.key,text:el.querySelector('.copy').textContent,mode:el.className,x:el.offsetLeft,y:el.offsetTop}))`);
    report.bubbles=await bubbles();
    assert.equal(report.bubbles.length,6,JSON.stringify(report.bubbles));
    cursorOverride={x:frame.getBounds().x+80,y:frame.getBounds().y+15};await delay(120);
    assert.equal(ignoreStates.get(frame.id),false,'Separate toolbar wakes from click-through');
    assert.equal(ignoreStates.get(overlay.id),true,'Overlay does not block toolbar');
    cursorOverride={x:display.bounds.x+report.bubbles[0].x+10,y:display.bounds.y+report.bubbles[0].y+10};await delay(120);
    assert.equal(ignoreStates.get(overlay.id),false,'Bubble becomes interactive from click-through');
    assert.equal(ignoreStates.get(selection.id),true,'Selection interior does not intercept bubble clicks');
    cursorOverride={x:x+width-40,y:y+height-40};await delay(120);
    assert.equal(ignoreStates.get(overlay.id),true,'Empty overlay remains click-through');
    fs.writeFileSync(path.join(qa,'native-overlay.png'),(await overlay.webContents.capturePage()).toPNG());

    // Read and OCR the retained crop; corrected text goes through the real text API.
    const capturesBeforeEditor=captureCalls;
    const editedKey=report.bubbles[0].key;
    await view(`document.querySelector('.bubble .edit').click()`);
    await until(()=>view(`!document.getElementById('editor-save').disabled`),'saved bubble inspection');
    assert(await view(`(()=>{const img=document.getElementById('editor-image');return !img.hidden && img.src.startsWith('data:image/png;base64,') && img.naturalWidth>0})()`),'Editor displays original saved crop');
    await view(`document.getElementById('editor-reocr').click()`);
    await until(()=>view(`!document.getElementById('editor-reocr').disabled && document.getElementById('editor-status').textContent.includes('识别完成')`),'bubble OCR');
    report.reocr=await view(`document.getElementById('editor-source').value`);
    assert(report.reocr.trim(),'Real reOCR returns dialogue');
    await delay(150);
    fs.writeFileSync(path.join(qa,'native-editor.png'),(await overlay.webContents.capturePage()).toPNG());
    const corrected='今日は必ずいい日になる。';
    await view(`document.getElementById('editor-source').value=${JSON.stringify(corrected)};document.getElementById('editor-save').click()`);
    await until(()=>view(`document.getElementById('editor-shell').hidden`),'corrected bubble translation');
    report.edited=await view(`window.api.inspectBubble(${JSON.stringify(editedKey)}).then(({text,translated})=>({text,translated}))`);
    assert.equal(report.edited.text,corrected);assert(report.edited.translated.trim());
    assert.equal(captureCalls,capturesBeforeEditor,'Bubble editing uses saved source instead of recapturing the desktop');
    assert.equal((await bubbles()).length,6,'Single correction retains other bubbles');

    // End a real stream after one bubble; retry requests only missing original IDs.
    report.interrupted=await translateSelection({cut:true});
    assert(report.interrupted.error,'A truncated stream must show an error');
    const partial=await bubbles();assert.equal(partial.length,1);
    const cutoff=requests.at(-1);assert.notEqual(cutoff.firstId,null);
    await until(()=>evaluate(`!document.getElementById('retryRemaining').hidden && !document.getElementById('retryRemaining').disabled`),'retry control');
    const beforeRetry=requests.length;
    await evaluate(`document.getElementById('retryRemaining').click()`);
    await until(()=>requests.length>beforeRetry,'retry request');
    await until(async()=>!await evaluate(`document.getElementById('lock').textContent.includes('取消')`) && (await bubbles()).length===6,'remaining bubbles');
    report.retry=requests.at(-1);
    assert.deepEqual(report.retry.only_ids,[0,1,2,3,4,5].filter(id=>id!==cutoff.firstId));
    const completed=await bubbles();
    assert.equal(completed.find(b=>b.key===partial[0].key)?.text,partial[0].text,'Successful bubble remains unchanged');

    // A fresh failed batch can restore the complete immediately preceding view.
    const previous=completed.map(({key,text})=>({key,text}));
    await translateSelection({cut:true});
    assert.equal((await bubbles()).length,1);
    await until(()=>evaluate(`!document.getElementById('restorePrevious').hidden && !document.getElementById('restorePrevious').disabled`),'restore control');
    await evaluate(`document.getElementById('reveal').click()`);
    await until(()=>view(`document.body.classList.contains('revealed')`),'reveal before restore');
    await evaluate(`document.getElementById('restorePrevious').click()`);
    await until(async()=>(await bubbles()).length===6,'previous view restoration');
    assert.deepEqual((await bubbles()).map(({key,text})=>({key,text})),previous);
    assert.equal(await view(`document.body.classList.contains('revealed')`),false,'Restoration reveals translated bubbles');
    assert.equal(await evaluate(`document.getElementById('reveal').getAttribute('aria-pressed')`),'false');
    const restoredBubble=(await bubbles())[0];
    cursorOverride={x:display.bounds.x+restoredBubble.x+10,y:display.bounds.y+restoredBubble.y+10};
    await until(()=>ignoreStates.get(overlay.id)===false,'restored bubble routing');
    report.restored=true;

    // Watch compares actual capture pixels and pauses while its editor is open.
    const beforeWatch=requests.length;
    await evaluate(`document.getElementById('watchMode').click()`);
    await until(()=>evaluate(`document.querySelector('.reading-row').dataset.state==='watching'`),'reading watch');
    assert.equal(await evaluate(`document.getElementById('watchMode').getAttribute('aria-pressed')`),'true');
    await view(`document.querySelector('.bubble .edit').click()`);
    await until(()=>evaluate(`document.querySelector('.reading-row').dataset.state==='paused'`),'watch paused for editor',10000);
    await view(`document.getElementById('editor-cancel').click()`);
    await until(()=>evaluate(`document.querySelector('.reading-row').dataset.state==='watching'`),'watch resumed after editor',10000);
    const originalFixture=fixtureImage;
    await fixture.webContents.executeJavaScript(`document.body.style.filter='brightness(.55)'`);
    await delay(250);
    fixtureImage=await fixture.webContents.capturePage();
    assert(!fixtureImage.toPNG().equals(originalFixture.toPNG()),'Changed-page fixture must contain different pixels');
    await until(()=>view(`document.body.classList.contains('stale')`),'stale overlay hidden',10000);
    await until(()=>evaluate(`document.querySelector('.reading-row').dataset.state==='stable'`),'stable changed page',10000);
    assert(await evaluate(`!document.getElementById('translateCurrent').hidden`),'Stable page offers explicit translation');
    assert.equal(requests.length,beforeWatch,'Watch must not automatically call a paid provider');
    report.watch=await evaluate(`({state:document.querySelector('.reading-row').dataset.state,text:document.getElementById('readingStatus').textContent})`);
    await delay(150);
    fs.writeFileSync(path.join(qa,'native-watch.png'),(await frame.webContents.capturePage()).toPNG());

    // Restoring page A after a failed translation of changed page B must keep
    // A's results hidden until the captured source pixels really return to A.
    report.changedPageFailure=await translateSelection({cut:true});
    assert(report.changedPageFailure.error);
    await until(()=>evaluate(`!document.getElementById('restorePrevious').disabled`),'changed-page restore control');
    await evaluate(`document.getElementById('restorePrevious').click()`);
    await until(async()=>(await bubbles()).length===6 && await view(`document.body.classList.contains('stale')`),'restored original remains stale on new page');
    assert.deepEqual((await bubbles()).map(({key,text})=>({key,text})),previous);
    await until(()=>evaluate(`document.querySelector('.reading-row').dataset.state==='stable'`),'changed page remains stable after restore',10000);
    assert(await view(`document.body.classList.contains('stale')`),'Restoration cannot paint old translations onto changed content');
    assert.equal(requests.length,beforeWatch+1,'Only explicit changed-page translation calls the provider');
    report.changedPageRestore=true;
    fixtureImage=originalFixture;
    await until(()=>view(`!document.body.classList.contains('stale')`),'original page restored',10000);
    await evaluate(`document.getElementById('fixedMode').click()`);
    await until(()=>evaluate(`document.querySelector('.reading-row').dataset.state==='off'`),'fixed reading mode');

    await evaluate(`document.getElementById('reveal').click()`);await delay(100);
    assert(await view(`document.body.classList.contains('revealed')`));
    await evaluate(`document.getElementById('reveal').click()`);
    await evaluate(`document.getElementById('lock').click();document.getElementById('clear').click()`);
    await until(()=>evaluate(`!document.getElementById('lock').textContent.includes('取消')`),'cancel and clear');
    await delay(250);assert.equal((await bubbles()).length,0,'Late results cannot reappear after clear');

    const before=selection.getBounds(),toolbarBefore=frame.getBounds();
    await evaluate(`window.api.resizeTo(${before.x},${before.y},40,40,'se')`);
    const southeast=selection.getBounds();
    assert.equal(southeast.width,64);assert.equal(southeast.height,64);
    assert.equal(southeast.x,before.x);assert.equal(southeast.y,before.y);
    selection.setBounds(before);
    await evaluate(`window.api.resizeTo(${before.x+before.width-40},${before.y+before.height-40},40,40,'nw')`);
    const northwest=selection.getBounds();
    assert.equal(northwest.x+northwest.width,before.x+before.width);
    assert.equal(northwest.y+northwest.height,before.y+before.height);
    assert.equal(frame.getBounds().width,toolbarBefore.width,'Selection resize does not shrink toolbar');
    report.selection={southeast,northwest};
    report.display={bounds:display.bounds,scaleFactor:display.scaleFactor};
    fs.writeFileSync(path.join(qa,'native-report.json'),JSON.stringify(report,null,2));
    console.log('PASS full app: live OCR/DeepSeek; saved-crop correction; missing-only retry; previous-view restore; page watch; reveal; cancel-clear; independent 64px selection');
    console.log(JSON.stringify({state:report.state,edited:report.edited,retry:report.retry,watch:report.watch}));
    fixture.close();app.quit();
  } catch(error) {
    report.failure=error.message;
    if(frame && !frame.isDestroyed()) report.toolbar=await frame.webContents.executeJavaScript(`document.body.innerText`).catch(()=>null);
    if(overlay && !overlay.isDestroyed()) fs.writeFileSync(path.join(qa,'native-failure.png'),(await overlay.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(qa,'native-failure.json'),JSON.stringify(report,null,2));
    console.error(error);app.quit();setTimeout(()=>app.exit(1),0);
  } finally {global.fetch=nativeFetch;}
});
