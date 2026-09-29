// Exercise the real main/preload/renderers using generated desktop pixels and
// in-memory HTTP responses. No desktop capture, Python process or provider call.
const {app, BrowserWindow, screen, desktopCapturer, nativeImage} = require('electron');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.qa');
fs.mkdirSync(output, {recursive:true});
app.setPath('userData', path.join(output, 'glass-app-tests'));
app.disableHardwareAcceleration();
process.env.MWT_BACKEND_PORT = '18769';
process.env.MWT_ENV_FILE = path.join(output, 'glass-app-no-env');
process.env.DEEPSEEK_API_KEY = 'test-glass-app-key';
process.env.MWT_GLASS_CAPTURE = '1'; // Explicitly test the experimental optics path.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ignoreStates = new Map(), frames = new Map(), images = new Map();
const protection = [], materials = [], errors = [], requests = [];
let pointer, failOptics = false, opticCaptures = 0, otherCaptures = 0, spawns = 0;
let streamMode = 'pending';
const report = {nativeInput:'Always click-through; focus disabled; intended routing recorded',
  imageSource:'Generated nativeImage pattern only', network:'In-memory HTTP responses only'};

const originalIgnore = BrowserWindow.prototype.setIgnoreMouseEvents;
const originalProtection = BrowserWindow.prototype.setContentProtection;
BrowserWindow.prototype.setIgnoreMouseEvents = function(ignore, options) {
  ignoreStates.set(this.id, ignore);
  return originalIgnore.call(this, true, options);
};
BrowserWindow.prototype.setContentProtection = function(value) {
  protection.push({id:this.id, value});
  return originalProtection.call(this, value);
};
BrowserWindow.prototype.setBackgroundMaterial = function(material) { materials.push(material); };
BrowserWindow.prototype.focus = function() {};
app.on('browser-window-created', (_event, win) => {
  win.setFocusable(false);
  originalIgnore.call(win, true, {forward:true});
  const originalSend = win.webContents.send.bind(win.webContents);
  win.webContents.send = (channel, payload) => {
    if (channel === 'glass:frame') {
      const previous = frames.get(win.id) || {count:0};
      frames.set(win.id, {count:previous.count + 1, supported:payload.supported,
        surfaces:payload.surfaces.map(surface => ({id:surface.id,
          hash:surface.image ? createHash('sha256').update(surface.image).digest('hex') : null,
          size:surface.image ? nativeImage.createFromDataURL(surface.image).getSize() : null}))});
    }
    return originalSend(channel, payload);
  };
  win.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
});

function generatedImage(display) {
  if (images.has(display.id)) return images.get(display.id);
  const scale = Math.min(1, 1600 / Math.max(display.bounds.width, display.bounds.height));
  const width = Math.round(display.bounds.width * scale), height = Math.round(display.bounds.height * scale);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const grid = x % 31 < 2 || y % 29 < 2;
    pixels[i] = grid ? 30 : (x * 3 + y) % 180 + 60;
    pixels[i + 1] = grid ? 35 : (x + y * 2) % 170 + 70;
    pixels[i + 2] = grid ? 45 : (x * 2 + y * 3) % 190 + 50;
    pixels[i + 3] = 255;
  }
  const result = nativeImage.createFromBitmap(pixels, {width, height});
  images.set(display.id, result);
  return result;
}

desktopCapturer.getSources = async options => {
  if (options.fetchWindowIcons === false) {
    opticCaptures++;
    if (failOptics) throw new Error('Deliberate local optical capture failure');
  } else otherCaptures++;
  return screen.getAllDisplays().map(display => ({display_id:String(display.id), thumbnail:generatedImage(display)}));
};
childProcess.spawn = () => { spawns++; throw new Error('Python must never start in the optics smoke test'); };
global.fetch = async (url, options = {}) => {
  const endpoint = new URL(url).pathname;
  requests.push(endpoint);
  if (endpoint === '/health') return Response.json({service:'manga-window-translator', protocol:4,
    ocr:'ready', providers:{deepseek:true, google:true, claude:false}});
  assert.equal(endpoint, '/translate/stream', `Unexpected request: ${endpoint}`);
  if (streamMode === 'pending') return new Promise((_resolve, reject) => {
    const abort = () => reject(options.signal.reason || new Error('Cancelled'));
    if (options.signal.aborted) abort();
    else options.signal.addEventListener('abort', abort, {once:true});
  });
  const bubble = {id:0, x:45, y:55, w:140, h:90, text:'Generated fixture text', translated:'Deterministic translated text'};
  return new Response([
    {type:'regions', bubbles:[bubble]}, {type:'bubble', bubble},
    {type:'done', count:1, timings:{total:0.01}},
  ].map(event => JSON.stringify(event)).join('\n') + '\n', {headers:{'Content-Type':'application/x-ndjson'}});
};
require('../main.js');

async function until(check, description, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await check();
    if (result) return result;
    await delay(35);
  }
  throw new Error(`Timed out: ${description}`);
}

app.whenReady().then(async () => {
  let frame, selection, overlay;
  try {
    const originalCursor = screen.getCursorScreenPoint.bind(screen);
    screen.getCursorScreenPoint = () => pointer || originalCursor();
    frame = await until(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('frame.html')), 'toolbar');
    selection = await until(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('selection.html')), 'selection');
    const evaluate = code => frame.webContents.executeJavaScript(code, true);
    const selected = code => selection.webContents.executeJavaScript(code, true);
    await until(() => evaluate('Boolean(window.api && window.LiquidGlass)'), 'toolbar and optics runtime');
    await until(() => selected('Boolean(window.api && window.LiquidGlass)'), 'selection optics runtime');
    await evaluate("window.api.setReadingMode('fixed');window.api.setInteractionLocked(false);true");
    const work = screen.getPrimaryDisplay().workArea;
    frame.setPosition(work.x + 25, work.y + 25);
    selection.setBounds({x:work.x + 75, y:work.y + 330, width:Math.min(520, work.width - 100), height:Math.min(310, work.height - 360)});
    pointer = {x:frame.getBounds().x + 40, y:frame.getBounds().y + 20};

    const live = win => win.webContents.executeJavaScript(`document.documentElement.dataset.glassBackdrop==='live' && [...document.querySelectorAll('.liquid-texture')].some(image=>image.getAttribute('src') && image.complete && image.naturalWidth>0)`);
    await until(() => live(frame), 'real toolbar IPC live texture');
    await until(() => live(selection), 'real selection IPC live texture');
    assert(BrowserWindow.getAllWindows().every(win => win.isContentProtected()), 'All application windows must be excluded from the backdrop feed');
    assert.equal(materials.length, 0, 'Native Acrylic must not make the supposedly clear window opaque');
    await until(() => ignoreStates.get(frame.id) === false && ignoreStates.get(selection.id) === true, 'toolbar intended hit routing');
    pointer = {x:selection.getBounds().x + 2, y:selection.getBounds().y + 120};
    await until(() => ignoreStates.get(selection.id) === false, 'selection edge intended hit routing');
    pointer = {x:selection.getBounds().x + 180, y:selection.getBounds().y + 180};
    await until(() => ignoreStates.get(selection.id) === true, 'selection interior click-through');

    const first = frames.get(selection.id);
    const bounds = selection.getBounds();
    selection.setBounds({...bounds, x:bounds.x + 43, y:bounds.y + 23});
    await until(() => {
      const latest = frames.get(selection.id);
      return latest.count > first.count && latest.surfaces.some(surface => surface.hash &&
        surface.hash !== first.surfaces.find(old => old.id === surface.id)?.hash);
    }, 'moving the real window samples new desktop coordinates');
    const moved = frames.get(selection.id);
    await evaluate(`window.api.resizeTo(${bounds.x + 43},${bounds.y + 23},${bounds.width - 80},${bounds.height - 40},'se')`);
    await until(() => {
      const latest = frames.get(selection.id);
      return latest.count > moved.count && latest.surfaces.some(surface => surface.size &&
        surface.size.width !== moved.surfaces.find(old => old.id === surface.id)?.size?.width);
    }, 'resizing the real selection refreshes optical crop dimensions');
    report.geometry = {before:bounds, after:selection.getBounds()};

    assert.equal((await evaluate("window.api.setReadingMode('watch')")).mode, 'watch');
    await delay(950);
    assert(BrowserWindow.getAllWindows().every(win => win.isContentProtected()), 'Watch mode retains capture exclusion');
    assert.equal((await evaluate("window.api.setReadingMode('fixed')")).mode, 'fixed');
    assert(BrowserWindow.getAllWindows().every(win => win.isContentProtected()), 'Fixed mode must also retain capture exclusion');
    assert(protection.every(call => call.value === true), 'Reading mode must never expose controls to their own feed');
    assert.equal(requests.filter(endpoint => endpoint === '/translate/stream').length, 0, 'Watching must not call a translation provider');

    await evaluate(`window.__glassJob=null;window.api.lock({source:'en',target:'zh-CN',provider:'deepseek',mode:'cards'}).then(value=>window.__glassJob=value);true`);
    await until(() => requests.includes('/translate/stream'), 'pending in-memory translation');
    const pausedCount = opticCaptures;
    await delay(550);
    assert.equal(opticCaptures, pausedCount, 'Optics must stop capturing while translation is active');
    await evaluate('window.api.cancel()');
    await until(() => evaluate('window.__glassJob?.cancelled'), 'translation cancellation');
    await until(() => opticCaptures > pausedCount, 'optics resume after cancelled translation');
    report.translationPause = true;

    streamMode = 'complete';
    const result = await evaluate("window.api.lock({source:'en',target:'zh-CN',provider:'deepseek',mode:'cards'})");
    assert.equal(result.count, 1);
    overlay = await until(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('overlay.html')), 'translation overlay');
    await until(() => live(overlay), 'newly created overlay gets local optics');
    assert(overlay.isContentProtected(), 'Dynamically created overlay must also be excluded from capture');
    await until(() => frames.get(overlay.id)?.surfaces?.some(surface => surface.hash), 'overlay optical crop through main');

    failOptics = true;
    await until(() => evaluate("document.documentElement.dataset.glassBackdrop==='fallback' && [...document.querySelectorAll('.liquid-texture')].every(image=>!image.getAttribute('src'))"), 'capture failure clears old toolbar texture');
    await until(() => selected("document.documentElement.dataset.glassBackdrop==='fallback' && [...document.querySelectorAll('.liquid-texture')].every(image=>!image.getAttribute('src'))"), 'capture failure clears old selection texture');
    await delay(150);
    assert.equal(await evaluate("[...document.querySelectorAll('.liquid-texture')].some(image=>image.getAttribute('src'))"), false, 'A late image decode must not restore the failed capture');
    failOptics = false;
    await until(() => live(frame), 'toolbar automatically recovers from transient capture failure');
    await until(() => live(selection), 'selection automatically recovers from transient capture failure');
    await until(() => live(overlay), 'overlay automatically recovers from transient capture failure');
    report.failureRecovery = true;

    await evaluate('window.api.clear()');
    await until(() => overlay.webContents.executeJavaScript("document.querySelectorAll('.bubble').length===0"), 'clear remains functional');
    assert.equal(spawns, 0, 'Test must not start Python');
    assert.equal(materials.length, 0);
    assert.deepEqual(errors, [], 'No renderer JavaScript errors');
    report.protectedWindows = BrowserWindow.getAllWindows().map(win => ({id:win.id, protected:win.isContentProtected()}));
    report.captures = {optics:opticCaptures, translationAndWatch:otherCaptures};
    report.requests = requests;
    report.frames = [...frames.entries()];
    fs.writeFileSync(path.join(output, 'liquid-main-report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(output, 'liquid-main-toolbar.png'), (await frame.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output, 'liquid-main-selection.png'), (await selection.webContents.capturePage()).toPNG());
    console.log('PASS main/preload optics: local cropped textures, move/resize, exclusion in fixed/watch, hit routing, translation pause/cancel, dynamic overlay, failure recovery; no network/provider/Python');
    app.exit(0);
  } catch (error) {
    report.failure = error.message;
    report.frames = [...frames.entries()];
    report.protection = protection;
    report.errors = errors;
    fs.writeFileSync(path.join(output, 'liquid-main-report.json'), JSON.stringify(report, null, 2));
    console.error(error);
    app.exit(1);
  }
});
