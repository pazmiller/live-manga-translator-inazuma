// Full main → preload → toolbar/editor → saved crop → real local Manga OCR, with translation stubbed.
const {app,BrowserWindow,screen,desktopCapturer,nativeImage}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(root,'.qa','manga-ui-live-user-data'));
app.commandLine.appendSwitch('smoke-test');
process.env.MWT_BACKEND_PORT='8765';
const fixture=nativeImage.createFromPath(path.join(root,'.qa','fixture.png'));
desktopCapturer.getSources=async()=>[{display_id:String(screen.getPrimaryDisplay().id),thumbnail:fixture}];
BrowserWindow.prototype.showInactive=function(){};
const raw={id:0,x:56,y:116,w:200,h:100,vertical:false,text:'待って。',
  translated:'等一下！一起走吧。',can_replace:false,background:'#ffffff',foreground:'#19191c'};
const second={...raw,id:1,x:360,y:310,text:'いや…',translated:'不…'};
const nativeFetch=global.fetch;
let mismatchSingle=true;
let mismatchBatch=true;
let enhancedTexts=[];
let mangaCalls=0;
global.fetch=(url,options)=>{
  if(String(url).endsWith('/translate/stream')) {
    const events=[{type:'regions',bubbles:[raw,second]},{type:'bubble',bubble:raw},
      {type:'bubble',bubble:second},{type:'done',count:2}];
    return Promise.resolve(new Response(events.map(event=>JSON.stringify(event)).join('\n')+'\n',
      {status:200,headers:{'content-type':'application/x-ndjson'}}));
  }
  if(String(url).endsWith('/bubble/translate')) {
    const request=JSON.parse(options.body);
    return Promise.resolve(new Response(JSON.stringify({text:mismatchSingle ? '另一气泡原文' : request.text,
      translated:mismatchSingle ? '错误的译文' : '校正后的译文'}),
    {status:200,headers:{'content-type':'application/json'}}));
  }
  if(String(url).endsWith('/bubble/manga-ocr')) {
    mangaCalls++;
    if(mangaCalls%2===0) return Promise.resolve(Response.json({text:'い、いやこれは…'}));
  }
  if(String(url).endsWith('/selection/translate-texts')) {
    enhancedTexts=JSON.parse(options.body).texts;
    return Promise.resolve(Response.json({items:enhancedTexts.map((text,index)=>({
      text:mismatchBatch && index===0 ? '另一气泡原文' : text,translated:`加强后的译文 ${index+1}`}))}));
  }
  return nativeFetch(url,options);
};
require('../main.js');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=30000) {
  const start=Date.now();
  while(Date.now()-start<timeout) {
    const value=await check();
    if(value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

app.whenReady().then(async()=>{
  let overlay;
  try {
    const frame=await until(()=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('frame.html')),'toolbar');
    const selection=await until(()=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('selection.html')),'selection');
    await until(()=>frame.webContents.executeJavaScript('Boolean(window.api?.health)',true),'preload');
    await until(async()=>{
      const health=await frame.webContents.executeJavaScript('window.api.health()',true);
      if(health.manga_ocr_state==='error' || health.manga_ocr_state==='missing') throw new Error(`Manga OCR ${health.manga_ocr_state}`);
      return health.manga_ocr_state==='ready';
    },'Manga OCR model',90000);
    const display=screen.getPrimaryDisplay();
    selection.setBounds(display.bounds);
    await frame.webContents.executeJavaScript(`document.getElementById('source').value='ja';document.getElementById('lock').click()`);
    overlay=await until(()=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('overlay.html')),'overlay');
    const view=code=>overlay.webContents.executeJavaScript(code,true);
    await until(()=>view(`Boolean(document.querySelector('.bubble .edit'))`),'translated bubble');
    await until(()=>frame.webContents.executeJavaScript(`!document.getElementById('enhanceOcr').hidden`,true),'enhance button');
    const enhancePoint=await frame.webContents.executeJavaScript(`(()=>{const r=document.getElementById('enhanceOcr').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,true);
    const clickEnhance=()=>{
      frame.webContents.sendInputEvent({type:'mouseMove',...enhancePoint});
      frame.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...enhancePoint});
      frame.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...enhancePoint});
    };
    clickEnhance();
    await until(()=>frame.webContents.executeJavaScript(`document.getElementById('message').textContent.includes('不对应')`,true),'mismatched batch rejection');
    assert.deepEqual(await view(`Array.from(document.querySelectorAll('.bubble')).map(el=>el.querySelector('.copy').textContent)`),
      [raw.translated,second.translated],'A failed batch must leave both original translations intact');
    mismatchBatch=false;clickEnhance();
    await until(()=>view(`Array.from(document.querySelectorAll('.bubble')).every((el,index)=>el.querySelector('.copy').textContent===\`加强后的译文 \${index+1}\`)`),'whole-selection enhancement');
    assert.equal(enhancedTexts.length,2,'Both enhanced sources share one translation request');
    assert(enhancedTexts.every(text=>text.trim()));
    assert.equal(await view(`document.querySelectorAll('.bubble')[0].dataset.key`),'1:0','First bubble keeps its identity');
    assert.equal(await view(`document.querySelectorAll('.bubble')[1].dataset.key`),'1:1','Second bubble keeps its identity');
    const firstSaved=await view(`window.api.inspectBubble('1:0').then(x=>({text:x.text,translated:x.translated}))`);
    assert.equal(firstSaved.text,enhancedTexts[0]);
    assert.equal(firstSaved.translated,'加强后的译文 1');
    const secondSaved=await view(`window.api.inspectBubble('1:1').then(x=>({text:x.text,translated:x.translated}))`);
    assert.equal(secondSaved.text,'い、いやこれは…');
    assert.equal(secondSaved.translated,'加强后的译文 2');
    await view(`document.querySelector('.bubble .edit').click()`);
    await until(()=>view(`!document.getElementById('editor-save').disabled`),'editable saved bubble');
    assert.equal(await view(`document.getElementById('editor-manga-ocr').disabled`),false,'Manga OCR should be clickable');
    const original=await view(`document.querySelector('.bubble .copy').textContent`);
    const start=Date.now();
    const point=await view(`(()=>{const r=document.getElementById('editor-manga-ocr').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    overlay.webContents.sendInputEvent({type:'mouseMove',...point});
    overlay.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    overlay.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
    await until(()=>view(`document.getElementById('editor-status').textContent.includes('精读完成') || !document.getElementById('editor-error').hidden`),'Manga OCR completion');
    const result=await view(`({text:document.getElementById('editor-source').value,error:document.getElementById('editor-error').hidden?'':document.getElementById('editor-error').textContent})`);
    assert.equal(result.error,'',JSON.stringify(result));
    assert(result.text.trim(),'Manga OCR should fill the draft');
    assert.equal(await view(`document.getElementById('editor-translation-label').textContent`),'当前译文',
      'Rerunning Manga OCR with the same source must not mark its translation stale');
    await view(`(()=>{const source=document.getElementById('editor-source');source.value+='！';source.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.match(await view(`document.getElementById('editor-translation-label').textContent`),/上次译文.*尚未重新翻译/);
    assert.equal(await view(`document.querySelector('.bubble .copy').textContent`),original,'OCR should not overwrite the saved translation');
    await view(`document.getElementById('editor-save').click()`);
    await until(()=>view(`document.getElementById('editor-error').textContent.includes('原文与当前气泡不一致')`),'mismatched provider text rejection');
    assert.equal(await view(`document.querySelector('.bubble .copy').textContent`),original,'Mismatched provider response must not overwrite the bubble');
    mismatchSingle=false;
    await view(`document.getElementById('editor-save').click()`);
    await until(()=>view(`document.getElementById('editor-shell').hidden`),'corrected single-bubble save');
    const saved=await view(`window.api.inspectBubble(document.querySelector('.bubble').dataset.key).then(x=>({text:x.text,translated:x.translated}))`);
    assert.equal(saved.text,result.text+'！');
    assert.equal(saved.translated,'校正后的译文');
    await frame.webContents.executeJavaScript(`document.getElementById('clear').click()`,true);
    await until(()=>frame.webContents.executeJavaScript(`document.getElementById('enhanceOcr').hidden`,true),'enhance button cleared');
    assert.equal(await view(`document.querySelectorAll('.bubble').length`),0);
    console.log(`PASS: whole-selection and editor Manga OCR UI completed; editor ${Date.now()-start} ms: ${result.text}`);
    app.quit();
  } catch(error) {
    if(overlay && !overlay.isDestroyed()) {
      const state=await overlay.webContents.executeJavaScript(`({status:document.getElementById('editor-status').textContent,error:document.getElementById('editor-error').textContent,disabled:document.getElementById('editor-manga-ocr').disabled,source:document.getElementById('editor-source').value})`,true).catch(()=>null);
      console.error('Editor state:',state);
    }
    console.error(error);
    app.exit(1);
  } finally {global.fetch=nativeFetch;}
});
