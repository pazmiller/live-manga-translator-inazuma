const {app, BrowserWindow, ipcMain, nativeImage} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.qa');
const windows = new Map();
const metrics = {};
const errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.setPath('userData', path.join(output, 'glass-tests'));
app.disableHardwareAcceleration();

async function until(check, message, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await delay(25);
  }
  throw new Error(message);
}

// A deterministic, deliberately colorful desktop substitute. No screen capture,
// system input, network request or translation provider is used in this test.
function backdrop(rect, phase = 0) {
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const pixels = Buffer.alloc(width * height * 4);
  const colors = [[240,76,156], [47,195,241], [252,189,69], [92,208,160], [133,113,247]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = Math.floor(x + rect.x + phase * 47);
    const py = Math.floor(y + rect.y + phase * 29);
    let rgb = colors[((Math.floor(px / 85) + phase) % colors.length + colors.length) % colors.length];
    let shade = .68 + .32 * ((py % 320 + 320) % 320) / 320;
    if ((px % 32 + 32) % 32 < 2 || (py % 32 + 32) % 32 < 2 || ((px + py) % 53 + 53) % 53 < 2) {rgb = [35,47,71]; shade = 1;}
    const i = (y * width + x) * 4;
    pixels[i] = rgb[2] * shade;
    pixels[i + 1] = rgb[1] * shade;
    pixels[i + 2] = rgb[0] * shade;
    pixels[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(pixels, {width, height});
}

function deliver(state) {
  state.win.webContents.send('glass:frame', {
    supported: true,
    surfaces: state.regions.map(region => ({id: region.id, image: backdrop(region, state.phase).toDataURL()})),
  });
}

async function capture(win, name) {
  await win.webContents.executeJavaScript(`Promise.all([...document.images].filter(img=>img.getAttribute('src')).map(img=>img.decode().catch(()=>{})))`);
  win.webContents.invalidate();
  await win.webContents.capturePage();
  await delay(90);
  const image = await win.webContents.capturePage();
  if (name) fs.writeFileSync(path.join(output, name), image.toPNG());
  return image;
}

function difference(first, second, rect) {
  const a = first.toBitmap(), b = second.toBitmap();
  const size = first.getSize();
  assert.deepEqual(size, second.getSize(), 'Comparison images must have equal dimensions');
  rect ??= {x:0, y:0, width:size.width, height:size.height};
  let changed = 0, total = 0, sum = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) {
    const i = (y * size.width + x) * 4;
    const delta = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    if (delta > 2) changed++;
    sum += delta; total++;
  }
  return {changed, total, mean:sum / total};
}

async function createWindow(file, width, height, initialize) {
  const win = new BrowserWindow({width, height, frame:false, show:false, transparent:true,
    webPreferences:{backgroundThrottling:false, preload:path.join(root, 'preload.js')}});
  const state = {win, regions:[], phase:0, requests:0};
  windows.set(win.webContents.id, state);
  win.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
  await win.loadFile(path.join(root, 'renderer', file));
  if (initialize) await initialize(win);
  await until(() => win.webContents.executeJavaScript(`Boolean(window.LiquidGlass)`), `${file}: liquid runtime not loaded`);
  await until(() => state.regions.length > 0, `${file}: renderer did not request local backdrop regions`);
  await until(() => win.webContents.executeJavaScript(`document.documentElement.dataset.glassBackdrop === 'live' && [...document.querySelectorAll('.liquid-texture')].some(img => img.complete && img.naturalWidth > 0)`), `${file}: backdrop image not rendered`);
  return state;
}

async function testToolbar() {
  const state = await createWindow('frame.html', 680, 240);
  const {win} = state;
  const evaluate = code => win.webContents.executeJavaScript(code, true);
  await evaluate(`document.getElementById('glassTone').value='clear'; document.getElementById('glassTone').dispatchEvent(new Event('change'))`);
  await until(() => evaluate(`document.getElementById('status').textContent==='框选漫画后开始翻译'`), 'Toolbar did not finish startup');
  metrics.toolbar = await evaluate(`({
    alpha:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--glass-bg').match(/([.\\d]+)\\s*\\)$/)[1]),
    controls:[...document.querySelectorAll('button,select')].filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return {id:el.id,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}}),
    filters:[...document.querySelectorAll('.liquid-texture')].map(el=>getComputedStyle(el).filter),
    surfaceCount:document.querySelectorAll('.liquid-surface').length
  })`);
  assert(metrics.toolbar.alpha <= .25, 'Clear material must actually be transparent');
  assert(metrics.toolbar.controls.every(control => control.inside), 'All toolbar controls must fit');
  assert(metrics.toolbar.filters.some(filter => filter.includes('url(')), 'Desktop texture must pass through an SVG lens');

  const initial = await capture(win, 'liquid-toolbar-clear.png');
  win.webContents.send('glass:motion', {x:630, y:25, impulse:1});
  await delay(180);
  const moved = await capture(win, 'liquid-toolbar-pointer.png');
  metrics.pointer = difference(initial, moved);
  assert(metrics.pointer.changed > 100, 'Pointer movement must change rendered glass pixels');

  state.phase = 1; deliver(state);
  await delay(160);
  const changed = await capture(win, 'liquid-toolbar-new-background.png');
  metrics.scene = difference(moved, changed);
  assert(metrics.scene.mean > 10, 'A changed background must remain clearly visible through the material');
  state.phase = 0; deliver(state); await delay(120);

  // Compare actual pixels with and without the distortion filter on the same
  // image and material, proving that transparency alone is not the whole effect.
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion', value:'reduce'}]});
  const mediaChanged = Date.now();
  metrics.motionMediaInitial = await evaluate(`({theme:document.getElementById('toolbar').dataset.liquidTheme,color:getComputedStyle(document.getElementById('toolbar')).color,text:getComputedStyle(document.getElementById('toolbar')).getPropertyValue('--glass-text'),motion:matchMedia('(prefers-reduced-motion:reduce)').matches,transparency:matchMedia('(prefers-reduced-transparency:reduce)').matches,dark:matchMedia('(prefers-color-scheme:dark)').matches})`);
  await until(() => evaluate(`(()=>{const toolbar=document.getElementById('toolbar');return toolbar.dataset.liquidTheme!=='dark'||getComputedStyle(toolbar).color==='rgb(245, 249, 255)'})()`), 'Dark-theme text did not settle after changing motion preference');
  metrics.motionMediaSettleMs = Date.now() - mediaChanged;
  await delay(150);
  metrics.opticalTheme = await evaluate(`({theme:document.getElementById('toolbar').dataset.liquidTheme,color:getComputedStyle(document.getElementById('toolbar')).color})`);
  const optical = await capture(win, 'liquid-toolbar-refracted.png');
  const filters = await evaluate(`Array.from(document.querySelectorAll('.liquid-texture'),el=>{const before=el.getAttribute('style');el.style.setProperty('filter','none','important');return before})`);
  const flat = await capture(win, 'liquid-toolbar-without-refraction.png');
  metrics.flatTheme = await evaluate(`({theme:document.getElementById('toolbar').dataset.liquidTheme,color:getComputedStyle(document.getElementById('toolbar')).color})`);
  assert.deepEqual(metrics.opticalTheme, metrics.flatTheme, 'Refraction comparison must not change the text theme');
  metrics.refraction = difference(optical, flat);
  assert(metrics.refraction.changed > 150, 'Lens must visibly bend the grid rather than only paint a glow');
  metrics.refractionEdge = difference(optical, flat, {x:10,y:70,width:12,height:88});
  assert(metrics.refractionEdge.changed > 100 && metrics.refractionEdge.mean > 2, 'Text-free rim must visibly refract the grid');
  await evaluate(`document.querySelectorAll('.liquid-texture').forEach((el,i)=>{const value=${JSON.stringify(filters)}[i];if(value===null)el.removeAttribute('style');else el.setAttribute('style',value)})`);
  await delay(150);
  const resting = await capture(win);
  await delay(300);
  const still = await capture(win, 'liquid-toolbar-reduced-motion.png');
  metrics.reducedMotion = difference(resting, still);
  assert(metrics.reducedMotion.mean < .3, 'Reduced motion should not keep animating the surface at rest');

  await evaluate(`document.getElementById('glassTone').value='tinted'; document.getElementById('glassTone').dispatchEvent(new Event('change'))`);
  await capture(win, 'liquid-toolbar-tinted.png');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[
    {name:'prefers-reduced-motion', value:'reduce'}, {name:'prefers-reduced-transparency', value:'reduce'},
  ]});
  await delay(150);
  assert(await evaluate(`matchMedia('(prefers-reduced-transparency: reduce)').matches && getComputedStyle(document.querySelector('.liquid-surface')).display==='none'`), 'Reduced transparency must remove the optical layer');
  await capture(win, 'liquid-toolbar-reduced-transparency.png');
  state.deliverDisabled = true;
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[]});
  await until(() => evaluate(`!matchMedia('(prefers-reduced-transparency:reduce)').matches`), 'Transparency preference did not reset');
  const id = await evaluate(`document.getElementById('toolbar').dataset.glassId`);
  win.webContents.send('glass:frame', {supported:true,surfaces:[{id,image:backdrop({x:8,y:8,width:664,height:176},3).toDataURL()}]});
  win.webContents.send('glass:frame', {supported:false,surfaces:[]});
  await delay(250);
  assert(await evaluate(`document.documentElement.dataset.glassBackdrop==='fallback' && [...document.querySelectorAll('.liquid-texture')].every(img=>!img.getAttribute('src'))`), 'A late image decode must not revive a disabled backdrop');
  metrics.noLateFallbackImage = true;
  win.webContents.debugger.detach();
  win.close();
}

async function testSelection() {
  const state = await createWindow('selection.html', 540, 360);
  const {win} = state;
  const evaluate = code => win.webContents.executeJavaScript(code, true);
  const image = await capture(win, 'liquid-selection-transparent.png');
  metrics.selectionInitial = await evaluate(`({reducedMotion:matchMedia('(prefers-reduced-motion:reduce)').matches,reducedTransparency:matchMedia('(prefers-reduced-transparency:reduce)').matches,scales:[...document.querySelectorAll('feDisplacementMap')].map(el=>el.getAttribute('scale')),textures:[...document.querySelectorAll('.liquid-texture')].map(el=>({width:el.naturalWidth,height:el.naturalHeight,filter:getComputedStyle(el).filter}))})`);
  const pixels = image.toBitmap(), size = image.getSize();
  let opaqueInterior = 0, visibleEdge = 0;
  for (let y = 50; y < size.height - 30; y++) for (let x = 30; x < size.width - 30; x++) {
    if (pixels[(y * size.width + x) * 4 + 3] !== 0) opaqueInterior++;
  }
  for (let y = 35; y < size.height - 35; y++) for (let x = 0; x < 6; x++) {
    if (pixels[(y * size.width + x) * 4 + 3] > 0) visibleEdge++;
  }
  metrics.selection = {opaqueInterior, visibleEdge};
  assert.equal(opaqueInterior, 0, 'Selection interior must remain fully transparent');
  assert(visibleEdge > 500, 'Selection still needs a visible, refracting edge');
  win.webContents.send('glass:motion', {x:2, y:170, impulse:1});
  await delay(150);
  const moved = await capture(win, 'liquid-selection-pointer.png');
  metrics.selectionAfter = await evaluate(`({scales:[...document.querySelectorAll('feDisplacementMap')].map(el=>el.getAttribute('scale')),energy:getComputedStyle(document.querySelector('[data-liquid-glass="ring"]')).getPropertyValue('--liquid-energy')})`);
  metrics.selectionFullPointer = difference(image, moved);
  metrics.selectionPointer = difference(image, moved, {x:0,y:35,width:8,height:size.height-70});
  assert(metrics.selectionPointer.changed > 20, 'Selection border must react to pointer movement');

  const requests = state.requests;
  win.setSize(420, 260);
  await until(() => state.requests > requests && state.regions.some(region => region.kind === 'ring' && region.width === 420 && region.height === 260), 'Resizing must update requested ring geometry');
  await delay(120);
  assert(await evaluate(`(()=>{const r=document.querySelector('[data-liquid-glass="ring"]').getBoundingClientRect();return r.width===innerWidth&&r.height===innerHeight})()`), 'Optical ring follows the resized window');
  await capture(win, 'liquid-selection-resized.png');

  const {width, height} = win.getContentBounds();
  const background = backdrop({x:0,y:0,width,height}).toDataURL();
  await evaluate(`document.body.style.backgroundImage='url(${background})'`);
  await capture(win, 'liquid-selection-on-grid.png');
  await evaluate(`document.body.style.backgroundImage=''`);
  win.setSize(64, 64);
  await delay(150);
  assert(await evaluate(`document.querySelectorAll('.grip').length===4 && getComputedStyle(document.querySelector('.selection-label')).display==='none'`), 'Minimum size preserves grips without a clipped label');
  await capture(win, 'liquid-selection-minimum.png');
  win.close();
}

async function testOverlay() {
  const bubble = {id:0, key:'glass-card', job:30, x:160, y:190, w:110, h:90,
    text:'今日はいい天気ですね。', translated:'今天天气真好。透过玻璃仍能看清背景，正文保持清楚。'};
  ipcMain.handle('bubble:inspect', () => ({text:bubble.text, translated:bubble.translated,
    image:backdrop({x:160,y:190,width:110,height:90}).toDataURL(), source:'ja', target:'zh-CN', provider:'DeepSeek'}));
  const state = await createWindow('overlay.html', 900, 640, async win => {
    win.webContents.send('overlay:begin', {job:30, mode:'cards', fontScale:1, target:'zh-CN', rect:{x:0,y:0,width:900,height:640}});
    win.webContents.send('overlay:add', [bubble]);
    win.webContents.send('overlay:finish', {job:30, success:true, completed:1, total:1});
  });
  const {win} = state;
  const evaluate = code => win.webContents.executeJavaScript(code, true);
  assert(await evaluate(`Boolean(document.querySelector('.bubble.reading .liquid-texture'))`), 'Dynamic reading card gets a live glass surface');
  await capture(win, 'liquid-reading-card.png');
  await evaluate(`document.querySelector('.edit').click()`);
  await until(() => evaluate(`!document.getElementById('editor-save').disabled && document.querySelector('#bubble-editor .liquid-texture')?.naturalWidth > 0`), 'Editor must receive a live local backdrop');
  assert(await evaluate(`(()=>{const panel=document.getElementById('bubble-editor'),r=panel.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.getElementById('editor-source').value.length>0})()`), 'Editor and its corrected-text field remain usable');
  await capture(win, 'liquid-editor.png');
  await evaluate(`document.getElementById('editor-cancel').click()`);
  win.webContents.send('overlay:clear');
  await until(() => state.regions.length === 0, 'Cleared cards and hidden editor must stop requesting background capture');
  assert.equal(await evaluate(`document.querySelectorAll('.bubble').length`), 0);
  metrics.overlay = {dynamicCard:true, editor:true, noCaptureAfterClear:true};
  ipcMain.removeHandler('bubble:inspect');
  win.close();
}

ipcMain.on('glass:regions', (event, regions) => {
  const state = windows.get(event.sender.id);
  if (!state) return;
  assert(Array.isArray(regions), 'Backdrop requests must be a bounded surface list');
  state.regions = regions;
  state.requests++;
  if (!state.deliverDisabled) deliver(state);
});
ipcMain.on('frame:height', (event, height) => {
  const state = windows.get(event.sender.id);
  if (state) state.win.setSize(680, Math.ceil(height));
});
ipcMain.handle('frame:health', () => ({ocr:'ready', providers:{deepseek:true, google:true, claude:false}}));
ipcMain.handle('frame:readingMode', (_event, mode) => ({mode}));
ipcMain.handle('frame:getBounds', event => windows.get(event.sender.id).win.getBounds());

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(output, {recursive:true});
    fs.writeFileSync(path.join(output, 'liquid-fixture.png'), backdrop({x:0,y:0,width:680,height:240}).toPNG());
    await testToolbar();
    await testSelection();
    await testOverlay();
    assert.deepEqual(errors, [], 'Renderer must not report JavaScript errors');
    fs.writeFileSync(path.join(output, 'liquid-glass-metrics.json'), JSON.stringify(metrics, null, 2));
    console.log('PASS: rendered refraction, pointer response, changing backdrop, transparent selection, resize, readable controls and accessibility fallbacks');
    app.exit(0);
  } catch (error) {
    fs.writeFileSync(path.join(output, 'liquid-glass-metrics.json'), JSON.stringify(metrics, null, 2));
    console.error(error);
    app.exit(1);
  }
});
