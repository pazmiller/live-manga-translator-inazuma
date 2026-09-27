// A transparent native window cannot use CSS backdrop-filter to refract the
// desktop. These lenses filter only local, capture-excluded desktop crops.
(() => {
  const NS='http://www.w3.org/2000/svg';
  const surfaces=new Map();
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const reduceTransparency=matchMedia('(prefers-reduced-transparency: reduce)');
  let nextId=0,layoutTimer=0,animation=0,lastTime=0;
  const pointer={x:innerWidth/2,y:innerHeight/2,tx:innerWidth/2,ty:innerHeight/2,vx:0,vy:0,energy:0,pressure:0};
  const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
  const svg=(tag,attrs)=>{const el=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attrs)) el.setAttribute(key,String(value));return el;};

  function makeMap(width,height,radius,ring) {
    const scale=Math.min(1,440/Math.max(width,height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(width*scale));canvas.height=Math.max(1,Math.ceil(height*scale));
    const ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height);
    const bezel=ring?10:Math.min(26,Math.min(width,height)*.24);
    for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
      const px=(x+.5)/scale-width/2,py=(y+.5)/scale-height/2;
      const qx=Math.abs(px)-(width/2-radius),qy=Math.abs(py)-(height/2-radius);
      const ox=Math.max(qx,0),oy=Math.max(qy,0),length=Math.hypot(ox,oy);
      const distance=Math.min(Math.max(qx,qy),0)+length-radius;
      const depth=Math.max(0,-distance),t=clamp(depth/bezel,0,1);
      const strength=distance<0?Math.pow(Math.sin(Math.PI*t),.8):0;
      let nx=0,ny=0;
      if(length>0) {nx=-Math.sign(px)*ox/length;ny=-Math.sign(py)*oy/length;}
      else if(qx>qy) nx=-Math.sign(px);else ny=-Math.sign(py);
      const i=(y*canvas.width+x)*4;
      image.data[i]=Math.round(127.5+nx*strength*125);
      image.data[i+1]=Math.round(127.5+ny*strength*125);
      image.data[i+2]=128;image.data[i+3]=255;
    }
    ctx.putImageData(image,0,0);return canvas.toDataURL();
  }
  function attach(host,kind) {
    if(host.dataset.glassId) return;
    const id=`glass-${++nextId}`;host.dataset.glassId=id;
    const layer=document.createElement('div');layer.className='liquid-surface';layer.setAttribute('aria-hidden','true');
    const texture=document.createElement('img');texture.className='liquid-texture';texture.alt='';texture.draggable=false;
    Object.assign(texture.style,{position:'absolute',inset:'0',width:'100%',height:'100%',objectFit:'fill',pointerEvents:'none'});
    layer.appendChild(texture);host.prepend(layer);
    const definitions=svg('svg',{width:0,height:0,'aria-hidden':'true'});
    Object.assign(definitions.style,{position:'absolute',pointerEvents:'none'});
    const filter=svg('filter',{id:`${id}-lens`,filterUnits:'userSpaceOnUse',primitiveUnits:'userSpaceOnUse',x:0,y:0,'color-interpolation-filters':'sRGB'});
    const map=svg('feImage',{result:'lens-map',preserveAspectRatio:'none'});
    const displacement=svg('feDisplacementMap',{in:'SourceGraphic',in2:'lens-map',scale:26,xChannelSelector:'R',yChannelSelector:'G'});
    filter.append(map,displacement);definitions.appendChild(filter);layer.appendChild(definitions);
    texture.style.filter=`url(#${id}-lens)`;
    const surface={id,host,kind,layer,texture,filter,map,displacement,width:0,height:0,version:0,base:kind==='ring'?15:30};
    if(kind==='ring') {
      Object.assign(layer.style,{padding:'6px',boxSizing:'border-box',maskImage:'linear-gradient(#000 0 0),linear-gradient(#000 0 0)',maskClip:'content-box,border-box',maskComposite:'exclude'});
    }
    surfaces.set(id,surface);resizeObserver.observe(host);
  }
  function discover() {
    for(const host of document.querySelectorAll('[data-liquid-glass],.bubble.reading,.inplace .controls')) {
      if(host.closest('.liquid-surface')) continue;
      attach(host,host.dataset.liquidGlass || (host.matches('.bubble.reading')?'card':'pill'));
    }
    for(const [id,surface] of surfaces) {
      const {host}=surface;
      if(!host.isConnected || (!host.hasAttribute('data-liquid-glass') && !host.matches('.bubble.reading,.inplace .controls'))) {
        resizeObserver.unobserve(host);surface.layer.remove();delete host.dataset.glassId;surfaces.delete(id);
      }
    }
  }
  function layout() {
    layoutTimer=0;discover();const regions=[];
    for(const surface of surfaces.values()) {
      const {host,kind}=surface,r=host.getBoundingClientRect(),style=getComputedStyle(host);
      const visible=r.width>0 && r.height>0 && style.visibility!=='hidden' && style.display!=='none' && Number(style.opacity)>0;
      if(visible && !reduceTransparency.matches) regions.push({id:surface.id,x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),kind});
    }
    // Bound optical work as well as the screenshot transport on dense pages.
    const priority={toolbar:0,ring:0,panel:1,pill:2,card:3};
    regions.sort((a,b)=>(priority[a.kind]??4)-(priority[b.kind]??4));
    const selected=regions.slice(0,8),ids=new Set(selected.map(region=>region.id));
    for(const surface of surfaces.values()) {
      surface.active=ids.has(surface.id);
      if(!surface.active) clearSurface(surface);
    }
    window.api?.glassRegions?.(selected);
    kick();
  }
  // Build the costly PNG map only when a real optical texture arrives. Ordinary
  // transparent windows and continuous resizing must never enter this path.
  function prepareMap(surface) {
      const {host,filter,map,kind}=surface;
      const rect=host.getBoundingClientRect();
      const width=Math.round(rect.width),height=Math.round(rect.height);
      if(surface.width!==width || surface.height!==height) {
        surface.width=width;surface.height=height;
        const radius=Math.min(parseFloat(getComputedStyle(host).borderTopLeftRadius)||16,width/2,height/2);
        filter.setAttribute('width',width);filter.setAttribute('height',height);
        map.setAttribute('width',width);map.setAttribute('height',height);
        map.setAttribute('href',makeMap(width,height,radius,kind==='ring'));
      }
  }
  function scheduleLayout() {if(!layoutTimer) layoutTimer=setTimeout(layout,35);}
  const resizeObserver=new ResizeObserver(scheduleLayout);
  const observer=new MutationObserver(records=>{
    if(records.some(r=>!r.target.closest?.('.liquid-surface') && (r.type==='childList' || ['hidden','class','data-glass-tone'].includes(r.attributeName)))) scheduleLayout();
  });

  function clearSurface(surface) {
    surface.version++;surface.texture.removeAttribute('src');
    surface.host.removeAttribute('data-glass-ready');
  }
  function updateFrame(frame) {
    document.documentElement.dataset.glassBackdrop=frame.supported?'live':'fallback';
    if(!frame.supported) {
      for(const surface of surfaces.values()) {
        clearSurface(surface);
      }
      return;
    }
    for(const packet of frame.surfaces || []) {
      const surface=surfaces.get(packet.id);if(!surface || !surface.active) continue;
      const version=++surface.version;
      if(!packet.image || reduceTransparency.matches) {clearSurface(surface);continue;}
      const incoming=new Image();
      incoming.onload=()=>{
        if(version!==surface.version || !surface.host.isConnected || reduceTransparency.matches) return;
        prepareMap(surface);
        surface.texture.src=packet.image;
        surface.host.dataset.glassReady='true';
        // Local luminance only: no image data leaves this renderer.
        const sample=document.createElement('canvas');sample.width=sample.height=8;
        const ctx=sample.getContext('2d',{willReadFrequently:true});ctx.drawImage(incoming,0,0,8,8);
        const pixels=ctx.getImageData(0,0,8,8).data;let brightness=0;
        for(let i=0;i<pixels.length;i+=4) brightness+=(pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722);
        surface.host.dataset.liquidTheme=brightness/64<115?'dark':'light';
        kick();
      };
      incoming.src=packet.image;
    }
  }
  function move(data) {
    if(!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
    const speed=Math.hypot(data.x-pointer.tx,data.y-pointer.ty);
    pointer.tx=data.x;pointer.ty=data.y;
    pointer.energy=Math.max(pointer.energy,clamp(speed/90+(data.impulse||0)/35,0,1.5));
    kick();
  }
  function paint(now) {
    animation=0;const dt=clamp((now-lastTime)/16.667,.3,2);lastTime=now;
    if(reduceMotion.matches) {pointer.x=pointer.tx;pointer.y=pointer.ty;pointer.vx=pointer.vy=pointer.energy=0;}
    else {
      pointer.vx=(pointer.vx+(pointer.tx-pointer.x)*.12*dt)*Math.pow(.68,dt);
      pointer.vy=(pointer.vy+(pointer.ty-pointer.y)*.12*dt)*Math.pow(.68,dt);
      pointer.x+=pointer.vx*dt;pointer.y+=pointer.vy*dt;pointer.energy*=Math.pow(.9,dt);
    }
    for(const surface of surfaces.values()) {
      if(!surface.active) continue;
      const r=surface.host.getBoundingClientRect();if(!r.width || !r.height) continue;
      const x=clamp((pointer.x-r.x)/r.width,0,1),y=clamp((pointer.y-r.y)/r.height,0,1);
      surface.host.style.setProperty('--liquid-x',`${(x*100).toFixed(2)}%`);
      surface.host.style.setProperty('--liquid-y',`${(y*100).toFixed(2)}%`);
      surface.host.style.setProperty('--liquid-energy',pointer.energy.toFixed(3));
      surface.host.style.setProperty('--liquid-press',String(pointer.pressure));
      if(surface.kind==='ring') {
        document.body.style.setProperty('--liquid-x',`${(x*100).toFixed(2)}%`);
        document.body.style.setProperty('--liquid-y',`${(y*100).toFixed(2)}%`);
        document.body.style.setProperty('--liquid-energy',pointer.energy.toFixed(3));
      }
      const amount=reduceMotion.matches?surface.base:surface.base*(1+.24*pointer.energy+.10*pointer.pressure+.09*(x-.5)+.07*(y-.5));
      if(surface.host.dataset.glassReady==='true') surface.displacement.setAttribute('scale',amount.toFixed(2));
    }
    const moving=Math.abs(pointer.tx-pointer.x)+Math.abs(pointer.ty-pointer.y)+Math.abs(pointer.vx)+Math.abs(pointer.vy)>.2 || pointer.energy>.004;
    if(moving && !reduceMotion.matches) animation=requestAnimationFrame(paint);
  }
  function kick() {if(!animation) {lastTime=performance.now()-16;animation=requestAnimationFrame(paint);}}
  document.addEventListener('pointermove',event=>move({x:event.clientX,y:event.clientY}),{passive:true});
  document.addEventListener('pointerdown',()=>{pointer.pressure=1;pointer.energy=1;kick();},{passive:true});
  const release=()=>{pointer.pressure=0;pointer.energy=Math.max(pointer.energy,.5);kick();};
  document.addEventListener('pointerup',release,{passive:true});window.addEventListener('blur',release);
  // Hover-only controls need fresh capture regions when the pointer reveals them.
  document.addEventListener('pointerover',scheduleLayout,{passive:true});
  window.addEventListener('resize',scheduleLayout);
  reduceMotion.addEventListener('change',kick);reduceTransparency.addEventListener('change',scheduleLayout);
  window.api?.onGlassFrame?.(updateFrame);window.api?.onGlassMotion?.(move);
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class','data-glass-tone']});
  window.LiquidGlass=Object.freeze({updateFrame,pointer:move,refresh:scheduleLayout});
  scheduleLayout();
})();
