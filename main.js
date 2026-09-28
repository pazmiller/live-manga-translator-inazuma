const {app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut, nativeImage, shell} = require('electron');
const fs = require('node:fs');
const path = require('path');
const os = require('os');
const {spawn, spawnSync} = require('child_process');
const {readEvents, localBubble, intersect} = require('./pipeline');
const {ReadingWatch} = require('./reading-watch');
const {makeGlassCapture} = require('./glass-capture');

let BACKEND_PORT = Number(process.env.MWT_BACKEND_PORT || 8765);
let BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const BORDER = 6, MIN_SIZE = 64;
const windowsBuild = Number(os.release().split('.')[2]);
const supportsWatch = process.platform === 'win32' && windowsBuild >= 19041;
// getSources is a screenshot API, not a low-latency video feed. On Windows it
// can stall the input thread for hundreds of milliseconds even when awaited.
const experimentalGlassCapture = process.env.MWT_GLASS_CAPTURE === '1';
let frameWin, selectionWin, backendProc, cursorTimer, watchTimer, glassTimer;
let activeJob = null, bubbleTask = null, lastBatch = null, editorWin = null;
let jobNumber = 0, generation = 0, reveal = false, interactionLocked = false;
let backendError = '', readingMode = 'fixed', stale = false, sampling = false;
let readingState = '', preferences = {}, watchVersion = 0;
const overlays = new Map(), mouseStates = new Map(), results = new Map(), contexts = new Map();
const pendingMessages = new WeakMap();
const watcher = new ReadingWatch(1000);
const glassCapture = makeGlassCapture({screen,desktopCapturer,send,
  canCapture:()=>supportsWatch && experimentalGlassCapture,isPaused:()=>Boolean(activeJob || bubbleTask)});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const contains = (r,p) => p.x>=r.x && p.y>=r.y && p.x<r.x+r.width && p.y<r.y+r.height;
const innerRect = b => ({x:b.x+BORDER,y:b.y+BORDER,width:b.width-BORDER*2,height:b.height-BORDER*2});
const sameRect = (a,b) => ['x','y','width','height'].every(key=>a[key]===b[key]);

function send(win, channel, payload) {
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isLoading()) {
    let pending=pendingMessages.get(win);
    if (!pending) {
      pending=[];pendingMessages.set(win,pending);
      win.webContents.once('did-finish-load',()=>{
        pendingMessages.delete(win);
        if (!win.isDestroyed()) for (const [queuedChannel,queuedPayload] of pending) win.webContents.send(queuedChannel,queuedPayload);
      });
    }
    pending.push([channel,payload]);
  } else win.webContents.send(channel,payload);
}
function broadcast(channel,payload) {for(const win of overlays.values()) send(win,channel,payload);}
function trackMouse(win) {
  mouseStates.set(win,{regions:[],dragging:false,ignore:null,motion:null});
  win.on('closed',()=>{mouseStates.delete(win);if(editorWin===win) editorWin=null;});
  // Keep our controls out of the local optical feed to prevent mirror feedback.
  if(supportsWatch) win.setContentProtection(true);
  glassCapture.register(win);
}
function selectionState() {
  if(selectionWin && !selectionWin.isDestroyed()) {
    const rect=innerRect(selectionWin.getBounds());
    send(selectionWin,'selection:state',{width:rect.width,height:rect.height,readingMode,stale});
  }
}
function setStale(value) {stale=value;broadcast('overlay:stale',{stale});selectionState();recoveryState();}
function readingStatus(state,text) {
  if(readingState===state) return;
  readingState=state;send(frameWin,'frame:readingState',{state,text});
}
function createWindows() {
  const work=screen.getPrimaryDisplay().workArea;
  frameWin=new BrowserWindow({x:work.x+24,y:work.y+24,width:680,height:220,
    show:!app.commandLine.hasSwitch('smoke-test'),
    transparent:true,frame:false,alwaysOnTop:true,hasShadow:false,resizable:false,
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true}});
  trackMouse(frameWin);frameWin.setAlwaysOnTop(true,'screen-saver');
  frameWin.loadFile(path.join(__dirname,'renderer/frame.html'));
  frameWin.on('closed',()=>{frameWin=null;app.quit();});
  selectionWin=new BrowserWindow({x:work.x+70,y:work.y+260,width:620,height:Math.max(MIN_SIZE,Math.min(640,work.height-280)),
    show:!app.commandLine.hasSwitch('smoke-test'),
    minWidth:MIN_SIZE,minHeight:MIN_SIZE,transparent:true,frame:false,alwaysOnTop:true,
    hasShadow:false,resizable:false,skipTaskbar:true,
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true}});
  trackMouse(selectionWin);selectionWin.setAlwaysOnTop(true,'screen-saver');
  selectionWin.loadFile(path.join(__dirname,'renderer/selection.html')).then(selectionState);
  const changed=()=>{
    selectionState();
    watchVersion++;
    if(readingMode==='watch' && results.size) {watcher.invalidate();setStale(true);readingStatus('changed','选区已移动，停稳后可重新翻译');}
    recoveryState();
  };
  selectionWin.on('move',changed);selectionWin.on('resize',changed);
  selectionWin.on('closed',()=>{selectionWin=null;app.quit();});
}
function getOverlay(display) {
  const key=String(display.id);
  if(overlays.has(key)) return overlays.get(key);
  const win=new BrowserWindow({...display.bounds,transparent:true,frame:false,alwaysOnTop:true,
    hasShadow:false,resizable:false,movable:false,skipTaskbar:true,show:false,
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true}});
  trackMouse(win);win.setAlwaysOnTop(true,'screen-saver');win.setIgnoreMouseEvents(true,{forward:true});
  win.loadFile(path.join(__dirname,'renderer/overlay.html')).then(()=>{send(win,'overlay:preferences',preferences);win.showInactive();});
  win.on('closed',()=>overlays.delete(key));overlays.set(key,win);return win;
}
async function captureRegion(selected,preview=false) {
  const display=screen.getDisplayMatching(selected),rect=intersect(selected,display.bounds);
  if(rect.width<8 || rect.height<8) throw new Error('选区在屏幕外，请重新框选');
  const width=preview?Math.min(1280,Math.round(display.size.width*display.scaleFactor)):Math.round(display.size.width*display.scaleFactor);
  const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width,height:Math.round(width*display.size.height/display.size.width)}});
  const source=sources.find(s=>s.display_id===String(display.id));
  if(!source || source.thumbnail.isEmpty()) throw new Error('无法截取屏幕，请检查屏幕录制权限');
  const size=source.thumbnail.getSize(),scale=size.width/display.bounds.width;
  const crop={x:Math.max(0,Math.round((rect.x-display.bounds.x)*scale)),y:Math.max(0,Math.round((rect.y-display.bounds.y)*scale)),width:Math.round(rect.width*scale),height:Math.round(rect.height*scale)};
  crop.width=Math.min(crop.width,size.width-crop.x);crop.height=Math.min(crop.height,size.height-crop.y);
  const image=source.thumbnail.crop(crop);
  return {png:preview?null:image.toPNG(),sample:samplePixels(image),scale,display,rect};
}
function samplePixels(image) {
  const pixels=image.resize({width:64,height:64,quality:'good'}).toBitmap(),sample=Buffer.alloc(pixels.length/4);
  for(let i=0;i<sample.length;i++) sample[i]=Math.round((pixels[i*4]+pixels[i*4+1]*2+pixels[i*4+2])/4);
  return sample;
}
async function waitForBackend(signal,timeoutMs=60000) {
  const start=Date.now();
  while(Date.now()-start<timeoutMs) {
    signal?.throwIfAborted();if(backendError) throw new Error(backendError);
    try {
      const response=await fetch(`${BACKEND_URL}/health`,{signal:AbortSignal.timeout(1000)});
      if(response.ok) {
        const data=await response.json();
        if(data.service!=='manga-window-translator' || data.protocol!==3) throw new Error('端口上是旧版服务，请退出旧版应用后重试');
        return data;
      }
    } catch(error) {if(error.message.includes('旧版服务')) throw error;}
    await sleep(200);
  }
  throw new Error('后端启动超时，请检查 Python 环境后重启');
}
async function startBackend() {
  try {
    const response=await fetch(`${BACKEND_URL}/health`,{signal:AbortSignal.timeout(700)});
    if(response.ok) {
      const info=await response.json();
      if(info.service==='manga-window-translator' && info.protocol===3) return;
      backendError='端口被旧版服务占用，请退出旧版应用后重试';return;
    }
  } catch {}
  const backendDir=app.isPackaged ? path.join(process.resourcesPath,'backend') : path.join(__dirname,'backend');
  const executable=app.isPackaged ? path.join(backendDir,'inazuma-backend.exe') : path.join(backendDir,'.venv','Scripts','python.exe');
  const args=app.isPackaged ? [String(BACKEND_PORT)] : ['server.py',String(BACKEND_PORT)];
  backendProc=spawn(executable,args,{
    cwd:backendDir,stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8',
      ...(app.isPackaged ? {MWT_ENV_FILE:configurationFile()} : {})}});
  backendProc.stdout.on('data',d=>process.stdout.write(`[py] ${d}`));backendProc.stderr.on('data',d=>process.stderr.write(`[py] ${d}`));
  backendProc.on('error',()=>{backendError=app.isPackaged ? '内置识别服务启动失败，请重新安装应用' : 'Python 启动失败，请按 README 安装后端环境';});
  backendProc.on('exit',()=>{backendProc=null;backendError='后端已停止，请重启应用';});
}
function configurationFile() {
  const config=path.join(app.getPath('userData'),'settings.env.txt');
  if(!fs.existsSync(config)) {
    fs.mkdirSync(path.dirname(config),{recursive:true});
    fs.writeFileSync(config,'# Fill in your own keys, save, then restart Inazuma.\nDEEPSEEK_API_KEY=\nANTHROPIC_API_KEY=\nDEEPSEEK_MODEL=deepseek-chat\n',{encoding:'utf8',flag:'wx'});
  }
  return config;
}
function cancelJob() {activeJob?.controller.abort();bubbleTask?.abort();}
function recoveryState() {
  const c=lastBatch;
  const selected=selectionWin && !selectionWin.isDestroyed() ? innerRect(selectionWin.getBounds()) : null;
  const matches=Boolean(c && selected && sameRect(intersect(selected,c.capture.display.bounds),c.capture.rect));
  send(frameWin,'frame:recovery',{available:Boolean(c && !c.success && c.regions.size>c.completed.size),canRestore:Boolean(c && !c.success && c.previous.length),
    canEnhance:Boolean(c && c.success && matches && !stale && c.opts.source==='ja' && [...c.completed.keys()].some(id=>results.has(`${c.id}:${id}`))),
    completed:c?.completed.size||0,total:c?.regions.size||0});
}
function clearAll() {
  generation++;watchVersion++;cancelJob();lastBatch=null;results.clear();contexts.clear();editorWin=null;
  broadcast('overlay:clear');watcher.reset();setStale(false);recoveryState();
  send(frameWin,'frame:status',{text:'已清除',cleared:true});
}
function pruneCaptures() {
  // At most three saved screenshots; old visible translations remain readable.
  while(contexts.size>3) contexts.delete(contexts.keys().next().value);
  while(results.size>240) results.delete(results.keys().next().value);
}
async function runLock(opts,retry=false) {
  if(activeJob || bubbleTask) return {error:'已有翻译任务正在进行'};
  if(editorWin) return {error:'请先完成或关闭单条编辑'};
  if(retry && stale) return {error:'画面已变化，请翻译新页；补译使用的是上一张截图'};
  let context=retry?lastBatch:null;
  if(retry && (!context || context.success || !contexts.has(context.id))) return {error:'没有可补译的任务，请重新翻译选区'};
  const job={controller:new AbortController(),generation};activeJob=job;
  const signal=AbortSignal.any([job.controller.signal,AbortSignal.timeout(90000)]);
  let outcome={},begun=false;
  const current=()=>activeJob===job && generation===job.generation && !signal.aborted;
  const progress=text=>{if(current()) {send(frameWin,'frame:status',{text});send(context?.overlay,'overlay:progress',{text});}};
  try {
    progress('正在连接翻译服务…');await waitForBackend(signal);signal.throwIfAborted();
    if(!retry) {
      const selected=innerRect(selectionWin.getBounds());
      const windows=[frameWin,selectionWin,...overlays.values()].filter(w=>w && !w.isDestroyed() && w.isVisible());
      for(const win of windows) win.hide();
      let capture;
      try {await sleep(80);capture=await captureRegion(selected);} finally {for(const win of windows) if(!win.isDestroyed()) win.showInactive();}
      signal.throwIfAborted();
      context={id:++jobNumber,capture,opts:{...opts},regions:new Map(),completed:new Map(),previous:[],overlay:getOverlay(capture.display),success:false};
      for(const [key,entry] of results) {
        const overlap=intersect(entry.screenRect,capture.rect);
        if(entry.displayId===capture.display.id && overlap.width>0 && overlap.height>0) {context.previous.push([key,entry]);results.delete(key);}
      }
      contexts.set(context.id,context);lastBatch=context;pruneCaptures();watchVersion++;watcher.accept(capture.sample);setStale(false);
    }
    const {capture}=context;opts=context.opts;
    reveal=false;broadcast('overlay:reveal',false);send(frameWin,'frame:reveal',false);
    const toolbar=frameWin.getBounds();
    send(context.overlay,'overlay:begin',{job:context.id,retry,mode:opts.mode||'smart',fontScale:opts.fontScale||1,target:opts.target,
      rect:{x:capture.rect.x-capture.display.bounds.x,y:capture.rect.y-capture.display.bounds.y,width:capture.rect.width,height:capture.rect.height},
      toolbar:{x:toolbar.x-capture.display.bounds.x,y:toolbar.y-capture.display.bounds.y,width:toolbar.width,height:toolbar.height}});
    begun=true;progress(retry?'正在补译剩余内容…':'正在识别文字…');
    const body={image:capture.png.toString('base64'),source:opts.source,target:opts.target,provider:opts.provider};
    if(retry) body.only_ids=[...context.regions.keys()].filter(id=>!context.completed.has(id));
    const response=await fetch(`${BACKEND_URL}/translate/stream`,{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let summary;
    await readEvents(response,event=>{
      if(!current()) return;
      if(event.type==='progress') progress(event.text);
      if(event.type==='regions') {
        for(const b of event.bubbles) context.regions.set(b.id,b);
        send(context.overlay,'overlay:regions',{job:context.id,bubbles:event.bubbles.map(b=>localBubble(b,capture))});
      }
      if(event.type==='bubble') {
        const raw=event.bubble,key=`${context.id}:${raw.id}`;
        const bubble={...localBubble(raw,capture),key,job:context.id,target:opts.target};
        context.completed.set(raw.id,bubble);
        results.set(key,{bubble,raw,contextId:context.id,displayId:capture.display.id,screenRect:{x:capture.rect.x+raw.x/capture.scale,y:capture.rect.y+raw.y/capture.scale,width:raw.w/capture.scale,height:raw.h/capture.scale}});
        send(context.overlay,'overlay:add',[bubble]);progress(`正在翻译 ${context.completed.size}/${context.regions.size}…`);
      }
      if(event.type==='done') summary=event;
    });
    signal.throwIfAborted();if(!summary) throw new Error('翻译连接中断，可补译剩余内容');
    context.success=context.completed.size===context.regions.size;
    if(context.success) context.previous=[];
    outcome={...summary,count:context.completed.size,completed:context.completed.size,total:context.regions.size};
  } catch(error) {
    outcome=job.controller.signal.aborted?{cancelled:true}: {error:signal.aborted?'翻译超时，可补译剩余内容':error.message};
    outcome.completed=context?.completed.size||0;outcome.total=context?.regions.size||0;
  } finally {
    if(activeJob===job) {
      if(generation===job.generation && begun) send(context.overlay,'overlay:finish',{job:context.id,success:context.success,...outcome});
      activeJob=null;recoveryState();
    }
  }
  return outcome;
}
function restorePrevious() {
  const c=lastBatch;
  if(activeJob || bubbleTask || !c || c.success || !c.previous.length) return {restored:false,count:0};
  for(const [key,entry] of results) if(entry.contextId===c.id) results.delete(key);
  for(const [key,entry] of c.previous) results.set(key,entry);
  const ids=new Set(c.previous.map(([,entry])=>entry.contextId));
  const previousContext=ids.size===1?contexts.get([...ids][0]):null;
  watchVersion++;
  if(previousContext && sameRect(previousContext.capture.rect,c.capture.rect) && previousContext.capture.display.id===c.capture.display.id) {
    watcher.accept(previousContext.capture.sample);watcher.observe(c.capture.sample);
  } else watcher.invalidate();
  send(c.overlay,'overlay:restore',{job:c.id});
  reveal=false;broadcast('overlay:reveal',false);send(frameWin,'frame:reveal',false);
  setStale(readingMode==='watch' && (watcher.invalidated || watcher.state!=='watching'));
  const count=c.previous.length;c.previous=[];lastBatch=null;recoveryState();return {restored:true,count};
}
function bubbleEntry(key) {
  const entry=results.get(key),context=entry && contexts.get(entry.contextId);
  if(!entry || !context) throw new Error('这条译文的截图已过期，请重新翻译选区');
  return {entry,context};
}
function bubbleCrop(entry,context,padding=8) {
  const image=nativeImage.createFromBuffer(context.capture.png),size=image.getSize(),b=entry.raw;
  const x=Math.max(0,Math.floor(b.x-padding)),y=Math.max(0,Math.floor(b.y-padding));
  return image.crop({x,y,width:Math.max(1,Math.min(size.width-x,Math.ceil(b.w+2*padding))),height:Math.max(1,Math.min(size.height-y,Math.ceil(b.h+2*padding)))});
}
async function enhanceSelection() {
  if(activeJob || bubbleTask) return {error:'已有翻译任务正在进行，请稍候'};
  if(editorWin) return {error:'请先完成或关闭单条编辑'};
  const context=lastBatch;
  if(!context || !context.success || !contexts.has(context.id)) return {error:'请先翻译当前选区'};
  if(context.opts.source!=='ja') return {error:'加强 OCR 目前只支持日文选区'};
  const selected=innerRect(selectionWin.getBounds());
  if(stale || !sameRect(intersect(selected,context.capture.display.bounds),context.capture.rect))
    return {error:'选区或画面已变化，请重新翻译选区'};
  const candidates=[...context.regions.values()].map(raw=>{
    const key=`${context.id}:${raw.id}`;
    return {key,entry:results.get(key)};
  }).filter(item=>item.entry);
  if(!candidates.length) return {error:'当前选区没有可精读的气泡'};
  if(candidates.length>100) return {error:'当前选区气泡过多，请缩小选区'};
  const controller=new AbortController();bubbleTask=controller;
  const savedGeneration=generation;
  const progress=text=>{
    if(generation===savedGeneration && lastBatch===context && !controller.signal.aborted) {
      send(frameWin,'frame:status',{text});
      send(context.overlay,'overlay:progress',{job:context.id,enhance:true,text});
    }
  };
  const post=async(path,body,timeout)=>{
    const response=await fetch(`${BACKEND_URL}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
      signal:AbortSignal.any([controller.signal,AbortSignal.timeout(timeout)])});
    const data=await response.json();
    controller.signal.throwIfAborted();
    if(!response.ok) throw new Error(typeof data.detail==='string'?data.detail:'加强 OCR 失败，请重试');
    return data;
  };
  try {
    const staged=[];
    for(const [index,{key,entry}] of candidates.entries()) {
      progress(`正在精读气泡 ${index+1}/${candidates.length}…`);
      const data=await post('/bubble/manga-ocr',{image:bubbleCrop(entry,context,16).toPNG().toString('base64'),source:'ja'},40000);
      const text=typeof data.text==='string'?data.text.trim():'';
      if(!text) throw new Error(`第 ${index+1} 条气泡未识别到文字，原有译文已保留`);
      staged.push({key,entry,text,translated:entry.bubble.translated});
    }
    const changed=staged.filter(item=>item.text!==item.entry.bubble.text);
    if(changed.length) {
      progress(`已精读 ${candidates.length} 处，正在翻译 ${changed.length} 条更新的原文…`);
      const data=await post('/selection/translate-texts',{texts:changed.map(item=>item.text),
        source:'ja',target:context.opts.target,provider:context.opts.provider},120000);
      if(!Array.isArray(data.items) || data.items.length!==changed.length)
        throw new Error('翻译条数与精读原文不一致，请重试');
      data.items.forEach((value,index)=>{
        if(value.text!==changed[index].text || typeof value.translated!=='string' || !value.translated.trim())
          throw new Error('翻译结果与精读原文不对应，请重试');
        changed[index].translated=value.translated.trim();
      });
    }
    const currentSelection=innerRect(selectionWin.getBounds());
    if(generation!==savedGeneration || lastBatch!==context || editorWin || stale ||
      !sameRect(intersect(currentSelection,context.capture.display.bounds),context.capture.rect) ||
      candidates.some(({key,entry})=>results.get(key)!==entry))
      throw new Error('气泡已变化，请重新翻译选区后再加强 OCR');
    controller.signal.throwIfAborted();
    const updated=[];
    for(const item of changed) {
      const {entry,text,translated}=item;
      entry.raw={...entry.raw,text,translated};
      entry.bubble={...entry.bubble,text,translated};
      context.regions.set(entry.raw.id,entry.raw);
      context.completed.set(entry.raw.id,entry.bubble);
      updated.push(entry.bubble);
    }
    if(updated.length) send(context.overlay,'overlay:replace',updated);
    return {count:candidates.length,changed:updated.length};
  } catch(error) {
    return {error:controller.signal.aborted?'已取消加强 OCR':error.name==='TimeoutError'?'加强 OCR 超时，请重试':error.message,
      cancelled:controller.signal.aborted};
  } finally {
    send(context.overlay,'overlay:progress',null);
    if(bubbleTask===controller) bubbleTask=null;
  }
}
async function bubbleAction(key,kind,text) {
  if(activeJob || bubbleTask) return {error:'已有翻译任务正在进行，请稍候'};
  const controller=new AbortController();bubbleTask=controller;
  try {
    const {entry,context}=bubbleEntry(key),savedGeneration=generation;
    const recognition=kind==='ocr'||kind==='manga-ocr';
    const body=recognition?{image:bubbleCrop(entry,context,kind==='manga-ocr'?16:8).toPNG().toString('base64'),source:context.opts.source}:{text,source:context.opts.source,target:context.opts.target,provider:context.opts.provider};
    const response=await fetch(`${BACKEND_URL}/bubble/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(kind==='manga-ocr'?40000:60000)])});
    const data=await response.json();controller.signal.throwIfAborted();
    if(!response.ok) throw new Error(typeof data.detail==='string'?data.detail:'单条处理失败，请检查原文后重试');
    if(generation!==savedGeneration || results.get(key)!==entry) throw new Error('这条译文已变化，请重新打开编辑');
    if(recognition) return data;
    if(data.text!==text) throw new Error('翻译返回的原文与当前气泡不一致，请重试');
    entry.bubble={...entry.bubble,text:data.text,translated:data.translated};entry.raw={...entry.raw,text:data.text,translated:data.translated};
    context.completed.set(entry.raw.id,entry.bubble);return {bubble:entry.bubble};
  } catch(error) {return {error:controller.signal.aborted?'已取消':error.message};}
  finally {if(bubbleTask===controller) bubbleTask=null;}
}
async function watchSelection() {
  if(readingMode!=='watch' || sampling || !selectionWin) return;
  if(activeJob || bubbleTask || editorWin || [...mouseStates.values()].some(s=>s.dragging)) {readingStatus('paused','操作完成后继续检测翻页');return;}
  sampling=true;const savedVersion=watchVersion,bounds=selectionWin.getBounds();
  try {
    const capture=await captureRegion(innerRect(bounds),true);
    if(readingMode!=='watch' || savedVersion!==watchVersion || activeJob || bubbleTask || editorWin || JSON.stringify(bounds)!==JSON.stringify(selectionWin.getBounds())) return;
    watcher.observe(capture.sample);
    if(stale!==(watcher.state!=='watching')) setStale(watcher.state!=='watching');
    const state=watcher.state;
    readingStatus(state,state==='stable'?'画面已稳定，点击翻译新页':state==='changed'?'画面变化，旧译文已隐藏':'正在检测翻页');
  } catch {if(readingMode==='watch' && savedVersion===watchVersion) readingStatus('error','暂时无法检测画面，可手动翻译选区');}
  finally {sampling=false;}
}
function setReadingMode(value) {
  watchVersion++;
  readingMode=value==='watch'?'watch':'fixed';
  if(readingMode==='watch' && !supportsWatch) {readingMode='fixed';readingStatus('error','连续阅读需要 Windows 10 2004 或更新版本');return {mode:readingMode,error:'当前系统不支持无闪烁的连续阅读'};}
  watcher.reset();
  const baseline=lastBatch || contexts.get([...results.values()].at(-1)?.contextId);
  if(baseline?.capture) {
    watcher.accept(baseline.capture.sample);
    const selected=innerRect(selectionWin.getBounds()),display=screen.getDisplayMatching(selected);
    if(display.id!==baseline.capture.display.id || !sameRect(intersect(selected,display.bounds),baseline.capture.rect)) watcher.invalidate();
  }
  setStale(false);readingState='';readingStatus(readingMode==='watch'?'watching':'off',readingMode==='watch'?'正在检测翻页':'固定位置，手动翻译');
  return {mode:readingMode};
}

ipcMain.handle('frame:lock',(_e,opts)=>runLock(opts));
ipcMain.handle('frame:retry',()=>runLock(null,true));ipcMain.handle('frame:restore',restorePrevious);
ipcMain.handle('frame:enhance',enhanceSelection);
ipcMain.handle('frame:cancel',cancelJob);ipcMain.handle('frame:clear',clearAll);ipcMain.handle('frame:health',()=>waitForBackend());
function toggleReveal() {reveal=!reveal;broadcast('overlay:reveal',reveal);send(frameWin,'frame:reveal',reveal);return reveal;}
ipcMain.handle('frame:reveal',toggleReveal);ipcMain.handle('frame:readingMode',(_e,value)=>setReadingMode(value));
ipcMain.on('frame:preferences',(_e,prefs)=>{preferences=prefs;broadcast('overlay:preferences',prefs);send(selectionWin,'overlay:preferences',prefs);});
ipcMain.on('frame:interact',(_e,value)=>{interactionLocked=Boolean(value);});
ipcMain.handle('frame:getBounds',()=>selectionWin.getBounds());ipcMain.handle('frame:quit',()=>app.quit());
ipcMain.handle('frame:configuration',async()=>{
  const file=app.isPackaged ? configurationFile() : path.join(__dirname,'.env');
  if(!app.isPackaged && !fs.existsSync(file)) fs.copyFileSync(path.join(__dirname,'.env.example'),file);
  if(app.isPackaged) {
    const error=await shell.openPath(file);if(error) throw new Error(error);
  } else spawn('notepad.exe',[file],{windowsHide:true});
});
ipcMain.on('frame:height',(_e,value)=>{
  if(!frameWin || !Number.isFinite(value)) return;
  const b=frameWin.getBounds(),work=screen.getDisplayMatching(b).workArea,height=Math.max(150,Math.min(Math.ceil(value),work.height));
  frameWin.setBounds({x:Math.max(work.x,Math.min(b.x,work.x+work.width-b.width)),y:Math.max(work.y,Math.min(b.y,work.y+work.height-height)),width:b.width,height});
});
ipcMain.handle('frame:recenter',()=>{
  const p=screen.getCursorScreenPoint(),work=screen.getDisplayNearestPoint(p).workArea,b=selectionWin.getBounds(),width=Math.min(b.width,work.width),height=Math.min(b.height,work.height);
  selectionWin.setBounds({x:Math.round(Math.max(work.x,Math.min(p.x-width/2,work.x+work.width-width))),y:Math.round(Math.max(work.y,Math.min(p.y-height/2,work.y+work.height-height))),width,height});
});
ipcMain.handle('frame:resizeTo',(_e,x,y,w,h,anchor='se')=>{
  if(![x,y,w,h].every(Number.isFinite)) return;
  const work=screen.getDisplayMatching(selectionWin.getBounds()).workArea,width=Math.round(Math.max(MIN_SIZE,Math.min(w,work.width))),height=Math.round(Math.max(MIN_SIZE,Math.min(h,work.height)));
  if(anchor.includes('w')) x+=w-width;if(anchor.includes('n')) y+=h-height;
  selectionWin.setBounds({x:Math.round(x),y:Math.round(y),width,height});
});
ipcMain.handle('bubble:inspect',(_e,key)=>{
  try {const {entry,context}=bubbleEntry(key);return {text:entry.bubble.text,translated:entry.bubble.translated,image:bubbleCrop(entry,context).toDataURL(),...context.opts};}
  catch(error) {return {error:error.message};}
});
ipcMain.handle('bubble:ocr',(_e,key)=>bubbleAction(key,'ocr'));ipcMain.handle('bubble:manga-ocr',(_e,key)=>bubbleAction(key,'manga-ocr'));ipcMain.handle('bubble:translate',(_e,data)=>bubbleAction(data.key,'translate',data.text));
ipcMain.on('bubble:dismiss',(_e,key)=>{results.delete(key);recoveryState();});
ipcMain.on('overlay:editor',(event,value)=>{
  const win=BrowserWindow.fromWebContents(event.sender);
  if(value) {editorWin=win;win.setIgnoreMouseEvents(false);win.focus();}
  else if(editorWin===win) {editorWin=null;bubbleTask?.abort();}
});
ipcMain.on('win:hitRegions',(event,regions)=>{const state=mouseStates.get(BrowserWindow.fromWebContents(event.sender));if(state) state.regions=regions.slice(0,400);});
ipcMain.on('win:dragging',(event,value)=>{const state=mouseStates.get(BrowserWindow.fromWebContents(event.sender));if(state) state.dragging=Boolean(value);});
ipcMain.on('glass:regions',(event,regions)=>glassCapture.regions(BrowserWindow.fromWebContents(event.sender),regions));
function updateMouse() {
  const point=screen.getCursorScreenPoint(),tb=frameWin?.getBounds(),sb=selectionWin?.getBounds();
  const overToolbar=tb && frameWin.isVisible() && contains(tb,point),insideSelection=sb && selectionWin.isVisible() && contains(sb,point);
  const corner=insideSelection && (point.x<sb.x+16 || point.x>=sb.x+sb.width-16) && (point.y<sb.y+16 || point.y>=sb.y+sb.height-16);
  const inChrome=insideSelection && (!contains(innerRect(sb),point) || corner);let overBubble=false;
  function setIgnore(win,ignore) {const state=mouseStates.get(win);if(state && state.ignore!==ignore) {win.setIgnoreMouseEvents(ignore,{forward:true});state.ignore=ignore;}}
  for(const win of overlays.values()) {
    const state=mouseStates.get(win);if(!state || !win.isVisible()) continue;
    const b=win.getBounds(),local={x:point.x-b.x,y:point.y-b.y};
    const hit=editorWin===win || (!editorWin && !overToolbar && !inChrome && !reveal && !stale && state.regions.some(r=>contains(r,local)));
    overBubble ||= hit;setIgnore(win,!(state.dragging || hit));
  }
  if(frameWin) setIgnore(frameWin,Boolean(editorWin) || !(overToolbar || mouseStates.get(frameWin)?.dragging));
  if(selectionWin) setIgnore(selectionWin,Boolean(editorWin) || Boolean(overToolbar) || !(mouseStates.get(selectionWin)?.dragging || inChrome || (interactionLocked && insideSelection && !overBubble)));
  for(const [win,state] of mouseStates) {
    if(!win.isVisible()) continue;
    const b=win.getBounds(),local={x:point.x-b.x,y:point.y-b.y};
    const previous=state.motion;
    if(previous && previous.x===local.x && previous.y===local.y && previous.wx===b.x && previous.wy===b.y) continue;
    if(local.x>=-80 && local.y>=-80 && local.x<=b.width+80 && local.y<=b.height+80) {
      send(win,'glass:motion',{...local,impulse:previous?Math.min(60,Math.hypot(b.x-previous.wx,b.y-previous.wy)):0});
    }
    state.motion={...local,wx:b.x,wy:b.y};
  }
}
app.whenReady().then(async()=>{
  if(app.isPackaged && !process.env.MWT_BACKEND_PORT) {
    // Each installed instance owns its backend; never borrow a development
    // server's credentials or terminate another instance's service on exit.
    BACKEND_PORT=await new Promise((resolve,reject)=>{
      const server=require('node:net').createServer();server.once('error',reject);
      server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});
    });
    BACKEND_URL=`http://127.0.0.1:${BACKEND_PORT}`;
  }
  startBackend();createWindows();cursorTimer=setInterval(updateMouse,40);watchTimer=setInterval(watchSelection,850);
  if(experimentalGlassCapture) glassTimer=setInterval(()=>glassCapture.tick(),150);
  globalShortcut.register('CommandOrControl+Shift+T',()=>send(frameWin,'frame:hotkeyLock'));
  globalShortcut.register('CommandOrControl+Shift+C',clearAll);globalShortcut.register('CommandOrControl+Shift+O',toggleReveal);
  screen.on('display-removed',(_event,display)=>{clearAll();overlays.get(String(display.id))?.close();});
  screen.on('display-metrics-changed',(_event,display)=>{clearAll();overlays.get(String(display.id))?.setBounds(display.bounds);});
});
app.on('before-quit',()=>{
  cancelJob();clearInterval(cursorTimer);clearInterval(watchTimer);clearInterval(glassTimer);
  glassCapture.dispose();globalShortcut.unregisterAll();
  if(backendProc?.pid && process.platform==='win32')
    spawnSync('taskkill.exe',['/PID',String(backendProc.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:3000});
  else backendProc?.kill();
});
app.on('window-all-closed',()=>app.quit());
