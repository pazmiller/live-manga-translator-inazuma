const items = new Map();
const dismissed = new Set();
let session = {job:0, mode:'smart', fontScale:1, target:'zh-CN', rect:{x:20,y:60,width:500,height:600}};
let previous = null;
let batchOpen = false;
let editor = null;
let drag = null;
let hitScheduled = false;
const clamp = (n,min,max) => Math.min(Math.max(n,min),Math.max(min,max));
const box = el => {const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
const area = (a,b) => Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
const sourceBox = b => ({x:b.x,y:b.y,width:b.w,height:b.h});
const bubbleKey = b => b.key || `${b.job}:${b.id}`;
const editorShell = document.getElementById('editor-shell');
const editorPanel = document.getElementById('bubble-editor');
const editorSource = document.getElementById('editor-source');
const editorTranslationLabel = document.getElementById('editor-translation-label');
const editorTranslation = document.getElementById('editor-translation');
const editorSave = document.getElementById('editor-save');
const editorReocr = document.getElementById('editor-reocr');
const editorMangaOcr = document.getElementById('editor-manga-ocr');
const editorError = document.getElementById('editor-error');
const editorStatus = document.getElementById('editor-status');

function reportHits() {
  if(hitScheduled) return;
  hitScheduled=true;
  requestAnimationFrame(()=>{
    hitScheduled=false;
    const regions=[];
    if(editor) {
      regions.push({x:0,y:0,width:innerWidth,height:innerHeight});
    } else if(!document.body.classList.contains('revealed') && !document.body.classList.contains('stale')) {
      for(const {el} of items.values()) {
        regions.push(box(el));
        // Include the small toolbar above a replacement so it remains reachable.
        const r=box(el.querySelector('.controls'));
        regions.push(r);
      }
    }
    window.api.hitRegions(regions);
  });
}

function fit(item) {
  const {b, content, copy}=item;
  const vertical=b.vertical && (b.target || session.target)!=='en';
  content.classList.toggle('vertical',vertical);
  const min=Math.round(14*session.fontScale), max=Math.round(24*session.fontScale);
  function fits(size) {
    copy.style.fontSize=size+'px';
    const r=copy.getBoundingClientRect();
    return r.width<=content.clientWidth+0.5 && r.height<=content.clientHeight+0.5 &&
      content.scrollWidth<=content.clientWidth && content.scrollHeight<=content.clientHeight;
  }
  if(!fits(min)) return false;
  let low=min,high=max;
  while(low<high) {const mid=Math.ceil((low+high)/2); if(fits(mid)) low=mid; else high=mid-1;}
  fits(low);
  return true;
}

function positionCard(item) {
  const {el,b}=item;
  const w=el.offsetWidth,h=el.offsetHeight;
  const bounded=(x,y)=>({x:clamp(x,8,innerWidth-w-8),y:clamp(y,8,innerHeight-h-8),width:w,height:h});
  const candidates=[bounded(b.x+b.w+16,b.y),bounded(b.x-w-16,b.y),
    bounded(b.x,b.y+b.h+16),bounded(b.x,b.y-h-16)];
  // Edge positions provide alternatives on dense pages and near screen bounds.
  for(let y=12;y<innerHeight-h;y+=Math.max(80,h+12)) {
    candidates.push(bounded(12,y),bounded(innerWidth-w-12,y));
  }
  const obstacles=Array.from(items.values()).filter(other=>other!==item);
  for(const other of obstacles) {
    const r=box(other.el);
    candidates.push(bounded(r.x+r.width+12,r.y),bounded(r.x-w-12,r.y),
      bounded(r.x,r.y+r.height+12),bounded(r.x,r.y-h-12));
  }
  for(let x=8;x<innerWidth-w;x+=Math.max(100,w+12)) {
    for(let y=8;y<innerHeight-h;y+=Math.max(70,h+12)) candidates.push(bounded(x,y));
  }
  const score=r=>{
    let penalty=area(r,sourceBox(b))*6;
    if(session.toolbar) penalty+=area(r,session.toolbar)*100;
    for(const other of obstacles) penalty+=area(r,box(other.el))*15+area(r,sourceBox(other.b))*3;
    return penalty+Math.hypot(r.x-b.x,r.y-b.y)*0.15;
  };
  candidates.sort((a,b)=>score(a)-score(b));
  el.style.left=candidates[0].x+'px'; el.style.top=candidates[0].y+'px';
}

function updateLeader(item) {
  if(!item.anchor) return;
  const {b,el,anchor,line}=item;
  const x=clamp(b.x-25,2,innerWidth-23),y=clamp(b.y,2,innerHeight-23);
  anchor.style.left=x+'px';anchor.style.top=y+'px';
  const r=box(el);
  line.setAttribute('x1',x+10);line.setAttribute('y1',y+10);
  line.setAttribute('x2',clamp(x+10,r.x,r.x+r.width));
  line.setAttribute('y2',clamp(y+10,r.y,r.y+r.height));
}

function render(item) {
  const {el,b,content,copy}=item;
  copy.textContent=item.original ? b.text : b.translated;
  el.className='bubble inplace'+(item.original?' showing-original':'');
  el.style.left=b.x+'px';el.style.top=b.y+'px';
  el.style.width=Math.max(1,b.w)+'px';el.style.height=Math.max(1,b.h)+'px';
  el.style.setProperty('--ink',b.foreground || '#19191c');
  el.style.setProperty('--ink-outline',b.background || '#fff');
  content.style.maxHeight='';
  el.querySelectorAll('.mask').forEach(mask=>mask.remove());
  item.anchor?.remove();item.line?.remove();item.anchor=item.line=null;
  const inplace=session.mode==='smart' && b.can_replace && !item.moved && !item.original && fit(item);
  if(inplace) {
    for(const r of b.masks || []) {
      const mask=document.createElement('div');mask.className='mask';
      Object.assign(mask.style,{left:r.x-b.x+'px',top:r.y-b.y+'px',width:r.w+'px',height:r.h+'px',background:b.background});
      el.insertBefore(mask,content);
    }
  } else {
    el.classList.replace('inplace','reading');content.classList.remove('vertical');
    copy.style.fontSize=Math.round(17*session.fontScale)+'px';
    const width=clamp(Math.sqrt(copy.textContent.length)*31,240,340);
    el.style.width=Math.min(width,innerWidth-16)+'px';el.style.height='auto';
    content.style.maxHeight=Math.min(280,innerHeight-16)+'px';
    positionCard(item);
    if(item.position) {el.style.left=clamp(item.position.x,8,innerWidth-el.offsetWidth-8)+'px';el.style.top=clamp(item.position.y,8,innerHeight-el.offsetHeight-8)+'px';}
    const anchor=document.createElement('div');anchor.className='anchor';anchor.textContent=b.id+1;
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    document.body.appendChild(anchor);document.getElementById('leaders').appendChild(line);
    item.anchor=anchor;item.line=line;updateLeader(item);
  }
  el.querySelector('.original').textContent=item.original?'译文':'原文';
  const controls=el.querySelector('.controls');
  controls.style.top=inplace && b.y<34 ? '0' : '';
  controls.style.left=inplace && b.x<140 ? '0' : '';
  controls.style.right=inplace && b.x<140 ? 'auto' : '';
  reportHits();
}

function removeItem(key) {
  const item=items.get(key);
  if(!item) return;
  if(editor?.item===item) closeEditor(false);
  if(drag?.item===item) endDrag();
  item.el.remove();item.anchor?.remove();item.line?.remove();items.delete(key);reportHits();
  return item;
}

function dismissItem(key) {
  dismissed.add(key);window.api.dismissBubble(key);removeItem(key);
}

function addBubble(b,replace=false) {
  if(b.job!==session.job || (!batchOpen && !replace)) return;
  const key=bubbleKey(b);
  if(dismissed.has(key)) return;
  for(const pending of document.querySelectorAll('.pending')) if(pending.dataset.id===String(b.id)) pending.remove();
  const existing=items.get(key);
  if(existing) {
    if(editor?.item===existing) closeEditor(false);
    existing.b=b;existing.revision++;render(existing);
    return;
  }
  const el=document.createElement('section');el.setAttribute('aria-label','译文 '+(b.id+1));el.tabIndex=0;
  el.dataset.key=key;
  const content=document.createElement('div');content.className='content';
  const copy=document.createElement('span');copy.className='copy';content.appendChild(copy);el.appendChild(content);
  const controls=document.createElement('div');controls.className='controls';
  const number=document.createElement('span');number.className='number';number.textContent=String(b.id+1).padStart(2,'0');controls.appendChild(number);
  const original=document.createElement('button');original.className='original';original.textContent='原文';original.title='对照原文，也可双击译文';controls.appendChild(original);
  const edit=document.createElement('button');edit.className='edit';edit.textContent='编辑';edit.title='修正原文、重新识别或翻译';edit.setAttribute('aria-label','编辑此条译文');controls.appendChild(edit);
  const close=document.createElement('button');close.className='dismiss';close.textContent='×';close.title='关闭此译文';close.setAttribute('aria-label','关闭此译文');controls.appendChild(close);
  el.appendChild(controls);document.body.appendChild(el);
  const item={b,el,content,copy,original:false,moved:false,revision:0};items.set(key,item);
  while(items.size>120) dismissItem(items.keys().next().value);
  const toggle=()=>{item.original=!item.original;render(item);};
  original.onclick=toggle;
  edit.onclick=()=>openEditor(item,edit);
  close.onclick=()=>dismissItem(key);
  el.ondblclick=e=>{if(!e.target.closest('button')) toggle();};
  el.onkeydown=e=>{if(e.key==='Escape') dismissItem(key);};
  el.addEventListener('pointerdown',e=>{
    if(editor || e.button!==0 || e.target.closest('button') || (el.classList.contains('reading') && e.clientX>el.getBoundingClientRect().right-14)) return;
    drag={item,startX:e.clientX,startY:e.clientY,x:el.offsetLeft,y:el.offsetTop,moved:false};
    el.setPointerCapture(e.pointerId);window.api.dragging(true);e.preventDefault();
  });
  render(item);
}

function editorCurrent(state) {
  return editor===state && items.get(state.key)===state.item && state.item.revision===state.revision;
}

function setEditorBusy(state,busy,message='') {
  if(!editorCurrent(state)) return;
  state.busy=busy;
  editorSource.disabled=busy;
  editorSave.disabled=busy || !state.ready;
  editorReocr.disabled=busy || !state.hasImage;
  editorMangaOcr.disabled=busy;
  editorPanel.setAttribute('aria-busy',String(busy));
  editorStatus.textContent=message;
  reportHits();
}

function showEditorError(error) {
  editorError.textContent=String(error?.message || error || '操作失败，请重试。');
  editorError.hidden=false;
}

function updateTranslationStale(state) {
  if(!editorCurrent(state)) return;
  const changed=editorSource.value.trim()!==state.savedText.trim();
  editorTranslationLabel.textContent=changed ? '上次译文（原文已改，尚未重新翻译）' : '当前译文';
  editorTranslation.classList.toggle('stale',changed);
}
editorSource.addEventListener('input',()=>{if(editor) updateTranslationStale(editor);});

function closeEditor(restoreFocus=true) {
  if(!editor) return;
  const trigger=editor.trigger;
  clearTimeout(editor.healthTimer);
  editor=null;editorShell.hidden=true;
  document.getElementById('editor-image').removeAttribute('src');
  window.api.editorOpen(false);
  if(restoreFocus && trigger?.isConnected) trigger.focus({preventScroll:true});
  reportHits();
}

async function refreshMangaHealth(state) {
  try {
    const health=await window.api.health();
    if(!editorCurrent(state)) return;
    const modelState=health.manga_ocr_state || (health.manga_ocr ? 'ready' : 'missing');
    const hint=state.source!=='ja' ? '日漫精读仅支持日文气泡；请选日语并重新翻译选区。'
      : !state.hasImage ? '此条截图已不可用；可直接编辑原文。'
      : modelState==='loading' ? '日漫精读模型正在后台加载；可点击尝试，未就绪时会提示重试。'
      : modelState==='missing' ? '日漫精读模型未安装；请按 README 安装可选模型并重启。'
      : modelState==='error' ? '日漫精读模型启动失败；请检查模型安装后重启。' : '';
    editorMangaOcr.title=hint || '用 Manga OCR 识别已保存的气泡截图';
    if(!state.busy) setEditorBusy(state,false,hint);
    if(modelState==='loading') state.healthTimer=setTimeout(()=>refreshMangaHealth(state),1000);
  } catch(error) {
    if(editorCurrent(state) && !state.busy) setEditorBusy(state,false,'日漫精读状态暂时不可用；可继续手动编辑原文。');
  }
}

async function openEditor(item,trigger) {
  closeEditor(false);endDrag();
  const state={item,key:bubbleKey(item.b),revision:item.revision,trigger,busy:false,ready:false,hasImage:false,source:'',savedText:item.b.text || ''};
  editor=state;editorShell.hidden=false;
  editorSource.value=item.b.text || '';
  editorTranslation.textContent=item.b.translated || '暂无译文';
  updateTranslationStale(state);
  document.getElementById('editor-title').textContent=`编辑第 ${item.b.id+1} 条译文`;
  document.getElementById('editor-provider').textContent='';
  const preview=document.getElementById('editor-image');preview.hidden=true;preview.removeAttribute('src');
  const placeholder=document.getElementById('editor-image-placeholder');placeholder.hidden=false;placeholder.textContent='正在读取截图…';
  editorError.hidden=true;editorError.textContent='';
  setEditorBusy(state,true,'正在读取已保存的识别结果…');
  window.api.editorOpen(true);editorPanel.focus({preventScroll:true});
  try {
    const result=await window.api.inspectBubble(state.key);
    if(!editorCurrent(state)) return;
    if(result.error) throw new Error(result.error);
    editorSource.value=result.text ?? item.b.text ?? '';
    state.savedText=editorSource.value;
    editorTranslation.textContent=result.translated || item.b.translated || '暂无译文';
    updateTranslationStale(state);
    const provider=typeof result.provider==='string' ? result.provider : result.provider?.name;
    document.getElementById('editor-provider').textContent=[result.source,result.target].filter(Boolean).join(' → ')+(provider ? ` · ${provider}` : '');
    state.hasImage=Boolean(result.image);state.ready=true;state.source=result.source;
    if(result.image) {preview.src=result.image;preview.hidden=false;placeholder.hidden=true;}
    else placeholder.textContent='此条截图已不可用，可直接编辑原文。';
    setEditorBusy(state,false,state.source==='ja' && state.hasImage ? '可点击「日漫精读」；模型状态正在确认。' :
      state.source!=='ja' ? '日漫精读仅支持日文气泡；请选日语并重新翻译选区。' :
      '此条截图已不可用，可直接编辑原文。');
    editorSource.focus({preventScroll:true});
    refreshMangaHealth(state);
  } catch(error) {
    if(!editorCurrent(state)) return;
    placeholder.textContent='无法读取已保存的截图';
    showEditorError(error);setEditorBusy(state,false);
  }
}

editorReocr.onclick=async()=>{
  const state=editor;
  if(!state || state.busy || !state.hasImage) return;
  editorError.hidden=true;setEditorBusy(state,true,'正在重新识别已保存的截图…');
  try {
    const result=await window.api.reocrBubble(state.key);
    if(!editorCurrent(state)) return;
    if(result.error) throw new Error(result.error);
    editorSource.value=result.text ?? '';
    updateTranslationStale(state);
    setEditorBusy(state,false,'识别完成。检查原文后，点击「翻译并保存」。');
    editorSource.focus({preventScroll:true});
  } catch(error) {
    if(!editorCurrent(state)) return;
    showEditorError(error);setEditorBusy(state,false);
  }
};

editorMangaOcr.onclick=async()=>{
  const state=editor;
  if(!state || state.busy) return;
  if(!state.hasImage) {showEditorError('此条保存的截图已不可用，可手动修改原文。');return;}
  if(state.source!=='ja') {showEditorError('日漫精读仅支持日文气泡；请选日语并重新翻译选区。');return;}
  editorError.hidden=true;setEditorBusy(state,true,'正在用 Manga OCR 精读已保存的气泡截图…');
  const started=Date.now();
  const timer=setInterval(()=>{
    if(editorCurrent(state)) editorStatus.textContent=`正在精读…已等待 ${Math.floor((Date.now()-started)/1000)} 秒，可点取消关闭。`;
  },1000);
  try {
    const result=await window.api.mangaOcrBubble(state.key);
    if(!editorCurrent(state)) return;
    if(result.error) throw new Error(result.error);
    if(!result.text?.trim()) throw new Error('未识别到文字，请保持原文或手动修改。');
    editorSource.value=result.text;
    updateTranslationStale(state);
    setEditorBusy(state,false,'精读完成。请核对原文，再点击「翻译并保存」。');
    editorSource.focus({preventScroll:true});
  } catch(error) {
    if(!editorCurrent(state)) return;
    showEditorError(error);setEditorBusy(state,false);
  } finally {
    clearInterval(timer);
  }
};

editorSave.onclick=async()=>{
  const state=editor;
  if(!state || state.busy || !state.ready) return;
  const text=editorSource.value.trim();
  editorError.hidden=true;
  if(!text) {showEditorError('请先填写要翻译的原文。');editorSource.focus();return;}
  setEditorBusy(state,true,'正在使用原翻译服务翻译这一条…');
  try {
    const result=await window.api.retranslateBubble({key:state.key,text});
    if(!editorCurrent(state)) return;
    if(result.error) throw new Error(result.error);
    if(!result.bubble || bubbleKey(result.bubble)!==state.key) throw new Error('返回的译文不属于这一条，请重试。');
    state.item.b=result.bubble;state.item.revision++;
    render(state.item);closeEditor();
  } catch(error) {
    if(!editorCurrent(state)) return;
    showEditorError(error);setEditorBusy(state,false);
  }
};

document.getElementById('editor-close').onclick=()=>closeEditor();
document.getElementById('editor-cancel').onclick=()=>closeEditor();
editorShell.addEventListener('pointerdown',event=>{if(event.target===editorShell) closeEditor();});
editorShell.addEventListener('keydown',event=>{
  if(event.key==='Escape') {event.preventDefault();event.stopPropagation();closeEditor();return;}
  if(event.key==='Enter' && (event.ctrlKey || event.metaKey)) {event.preventDefault();editorSave.click();return;}
  if(event.key!=='Tab') return;
  const focusable=[...editorPanel.querySelectorAll('button:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey && (document.activeElement===first || document.activeElement===editorPanel)) {event.preventDefault();last.focus();}
  else if(!event.shiftKey && document.activeElement===last) {event.preventDefault();first.focus();}
});

document.addEventListener('pointermove',e=>{
  if(!drag) return;
  const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
  if(!drag.moved && Math.hypot(dx,dy)<4) return;
  if(!drag.moved) {
    drag.moved=true;drag.item.moved=true;render(drag.item);
    drag.item.el.classList.add('dragging');
  }
  const el=drag.item.el;
  const x=clamp(drag.x+dx,8,innerWidth-el.offsetWidth-8),y=clamp(drag.y+dy,8,innerHeight-el.offsetHeight-8);
  el.style.left=x+'px';el.style.top=y+'px';drag.item.position={x,y};updateLeader(drag.item);
});
function endDrag() {if(drag) drag.item.el.classList.remove('dragging');drag=null;window.api.dragging(false);reportHits();}
document.addEventListener('pointerup',endDrag);
document.addEventListener('pointercancel',endDrag);
window.addEventListener('blur',endDrag);
window.addEventListener('resize',()=>{for(const item of items.values()) render(item);reportHits();});

window.api.onOverlayBegin(data=>{
  closeEditor(false);endDrag();
  const retry=data.retry && data.job===session.job;
  session={...session,...data};batchOpen=true;
  document.querySelectorAll('.pending').forEach(el=>el.remove());
  if(!retry) {
    dismissed.clear();previous={job:data.job,items:new Map()};
    // Detach the previous version until this batch succeeds or is restored.
    for(const [key,item] of items) if(area(sourceBox(item.b),data.rect)>0) previous.items.set(key,removeItem(key));
  }
  document.body.classList.remove('revealed','stale');reportHits();
});
window.api.onOverlayRegions(data=>{
  if(data.job!==session.job || !batchOpen) return;
  for(const b of data.bubbles) {
    if(items.has(bubbleKey({...b,job:data.job})) || dismissed.has(bubbleKey({...b,job:data.job}))) continue;
    const el=document.createElement('div');el.className='pending';el.dataset.id=b.id;el.dataset.number=b.id+1;
    Object.assign(el.style,{left:b.x+'px',top:b.y+'px',width:b.w+'px',height:b.h+'px'});document.body.appendChild(el);
  }
});
window.api.onOverlayAdd(bubbles=>bubbles.forEach(bubble=>addBubble(bubble)));
window.api.onOverlayReplace(bubbles=>bubbles.forEach(bubble=>addBubble(bubble,true)));
window.api.onOverlayProgress(data=>{
  if(data && ((!batchOpen && !data.enhance) || (data.job!==undefined && data.job!==session.job))) return;
  const el=document.getElementById('progress');el.hidden=!data;
  if(!data) return;
  el.querySelector('span').textContent=data.text;
  el.style.left=clamp(session.rect.x+12,8,innerWidth-el.offsetWidth-8)+'px';
  el.style.top=clamp(session.rect.y+session.rect.height-el.offsetHeight-12,8,innerHeight-el.offsetHeight-8)+'px';
});
window.api.onOverlayFinish(data=>{
  if(data.job!==session.job) return;
  batchOpen=false;
  if(data.success) previous=null;
  document.getElementById('progress').hidden=true;
  document.querySelectorAll('.pending').forEach(el=>el.remove());
});
window.api.onOverlayClear(()=>{
  closeEditor(false);session.job=-1;batchOpen=false;previous=null;dismissed.clear();endDrag();for(const key of items.keys()) removeItem(key);
  document.querySelectorAll('.pending').forEach(el=>el.remove());document.getElementById('progress').hidden=true;
  document.body.classList.remove('stale','revealed');reportHits();
});
window.api.onOverlayRestore(data=>{
  if(data.job!==session.job || previous?.job!==data.job) return;
  closeEditor(false);endDrag();batchOpen=false;
  for(const [key,item] of items) if(item.b.job===data.job) removeItem(key);
  for(const [key,item] of previous.items) {
    items.set(key,item);document.body.appendChild(item.el);render(item);
  }
  previous=null;
  document.querySelectorAll('.pending').forEach(el=>el.remove());document.getElementById('progress').hidden=true;
  document.body.classList.remove('stale','revealed');reportHits();
});
window.api.onOverlayStale(data=>{
  if(data.stale) closeEditor(false);
  document.body.classList.toggle('stale',Boolean(data.stale));reportHits();
});
window.api.onOverlayReveal(value=>{if(value) closeEditor(false);document.body.classList.toggle('revealed',value);reportHits();});
window.api.onOverlayPreferences(prefs=>{
  session={...session,...prefs};
  if(prefs.glassTone) document.documentElement.dataset.glassTone=prefs.glassTone;
  for(const item of items.values()) render(item);
});
