// Desktop pixels are kept in memory and delivered only to registered app windows.
// The caller must exclude those windows from capture before enabling this module.
const {intersect} = require('./pipeline');

const MAX_SURFACES = 8;
const MAX_PIXELS = 1_200_000;
const MAX_DIMENSION = 1600;
const PRIORITY = {toolbar:0, ring:1, panel:2};

function sameBounds(a, b) {
  return ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < 0.00001);
}

function makeGlassCapture({screen, desktopCapturer, send, canCapture, isPaused = () => false}) {
  const windows = new Map();
  let busy = false;
  let disposed = false;

  function deliver(state, payload) {
    if (!disposed && windows.has(state.win) && !state.win.isDestroyed()) {
      send(state.win, 'glass:frame', payload);
    }
  }

  function clear(state) {
    if (state.available !== false) deliver(state, {supported:false, surfaces:[]});
    state.available = false;
  }

  function register(win) {
    if (disposed || windows.has(win) || win.isDestroyed()) return;
    const state = {win, regions:[], signature:'[]', revision:0, dirty:true,
      lastCapture:-Infinity, available:null};
    const changed = () => { state.revision++; state.dirty = true; };
    const closed = () => {
      windows.delete(win);
      for (const event of ['move', 'resize', 'show']) win.removeListener(event, changed);
      win.removeListener('closed', closed);
    };
    state.release = closed;
    for (const event of ['move', 'resize', 'show']) win.on(event, changed);
    win.once('closed', closed);
    windows.set(win, state);
  }

  function regions(win, list) {
    const state = windows.get(win);
    if (!state || win.isDestroyed() || !Array.isArray(list)) return;
    const bounds = win.getBounds();
    const viewport = {x:0, y:0, width:bounds.width, height:bounds.height};
    const seen = new Set();
    const accepted = [];
    // Limit inspection as well as output; renderer data never drives unbounded work.
    for (const item of list.slice(0, 64)) {
      if (!item || typeof item.id !== 'string' || item.id.length > 128 || seen.has(item.id)) continue;
      if (![item.x, item.y, item.width, item.height].every(Number.isFinite)) continue;
      if (item.width <= 0 || item.height <= 0) continue;
      const rect = intersect(viewport, item);
      if (rect.width < 1 || rect.height < 1) continue;
      seen.add(item.id);
      accepted.push({id:item.id, kind:typeof item.kind === 'string' ? item.kind : '', ...rect});
    }
    accepted.sort((a, b) => (PRIORITY[a.kind] ?? 3) - (PRIORITY[b.kind] ?? 3));
    const next = accepted.slice(0, MAX_SURFACES);
    const signature = JSON.stringify(next);
    if (signature === state.signature) return;
    state.regions = next;
    state.signature = signature;
    state.revision++;
    state.dirty = true;
    if (!next.length) deliver(state, {supported:true, surfaces:[]});
  }

  async function tick(now = Date.now()) {
    if (disposed || busy) return false;
    if (isPaused()) {
      for (const state of windows.values()) {clear(state);state.dirty=true;}
      return false;
    }
    if (!canCapture()) {
      for (const state of windows.values()) clear(state);
      return false;
    }
    const pointer = screen.getCursorScreenPoint();
    const pending = [];
    for (const state of windows.values()) {
      const {win} = state;
      if (win.isDestroyed() || !win.isVisible() || !state.regions.length) continue;
      const bounds = win.getBounds();
      // Overlay windows cover a whole monitor; only proximity to an actual
      // glass surface should keep their capture rate high while reading.
      const near = state.regions.some(region => {
        const x=pointer.x-bounds.x-region.x,y=pointer.y-bounds.y-region.y;
        if(x < -40 || y < -40 || x > region.width+40 || y > region.height+40) return false;
        return region.kind!=='ring' || x<40 || y<40 || x>region.width-40 || y>region.height-40;
      });
      const interval = near || state.dirty ? 150 : 750;
      if (now - state.lastCapture < interval) continue;
      pending.push({state, bounds, revision:state.revision, regions:state.regions});
    }
    if (!pending.length) return false;
    busy = true;
    try {
      const displays = screen.getAllDisplays();
      const sources = await desktopCapturer.getSources({types:['screen'],
        thumbnailSize:{width:MAX_DIMENSION, height:MAX_DIMENSION}, fetchWindowIcons:false});
      // Settings, window bounds, or regions can change while the capture resolves.
      if (disposed || !canCapture() || isPaused()) return false;
      for (const work of pending) {
        const {state, bounds} = work;
        if (!windows.has(state.win) || state.win.isDestroyed() || !state.win.isVisible() ||
            state.revision !== work.revision || !sameBounds(bounds, state.win.getBounds())) continue;
        const surfaces = [];
        let budget = MAX_PIXELS;
        for (const region of work.regions) {
          const absolute = {...region, x:bounds.x + region.x, y:bounds.y + region.y};
          const matches = displays.map(display => ({display, rect:intersect(absolute, display.bounds)}))
            .filter(match => match.rect.width > 0 && match.rect.height > 0)
            .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
          const match = matches[0];
          // A single texture cannot represent two monitors at different DPI. Keep
          // that surface truly transparent until it fits onto one monitor again.
          if (!match || budget < 1024 || !sameBounds(absolute, match.rect)) {
            surfaces.push({id:region.id, image:null});
            continue;
          }
          const source = sources.find(candidate => candidate.display_id === String(match.display.id));
          if (!source || source.thumbnail.isEmpty()) {
            surfaces.push({id:region.id, image:null});
            continue;
          }
          const size = source.thumbnail.getSize();
          const scaleX = size.width / match.display.bounds.width;
          const scaleY = size.height / match.display.bounds.height;
          const left = Math.max(0, Math.floor((match.rect.x - match.display.bounds.x) * scaleX));
          const top = Math.max(0, Math.floor((match.rect.y - match.display.bounds.y) * scaleY));
          const right = Math.min(size.width, Math.ceil((match.rect.x + match.rect.width - match.display.bounds.x) * scaleX));
          const bottom = Math.min(size.height, Math.ceil((match.rect.y + match.rect.height - match.display.bounds.y) * scaleY));
          if (right <= left || bottom <= top) continue;
          let crop = source.thumbnail.crop({x:left, y:top, width:right-left, height:bottom-top});
          const pixels = crop.getSize();
          const shrink = Math.min(1, MAX_DIMENSION / pixels.width, MAX_DIMENSION / pixels.height,
            Math.sqrt(budget / (pixels.width * pixels.height)));
          if (shrink < 1) crop = crop.resize({width:Math.max(1, Math.floor(pixels.width * shrink)),
            height:Math.max(1, Math.floor(pixels.height * shrink)), quality:'good'});
          const output = crop.getSize();
          budget -= output.width * output.height;
          surfaces.push({id:region.id, image:crop.toDataURL()});
        }
        state.lastCapture = now;
        state.dirty = false;
        state.available = surfaces.some(surface => surface.image);
        deliver(state, {supported:state.available, surfaces});
      }
      return true;
    } catch {
      for (const {state} of pending) {
        state.lastCapture = now;
        clear(state);
      }
      return false;
    } finally {
      busy = false;
    }
  }

  function dispose() {
    disposed = true;
    for (const state of windows.values()) state.release();
    windows.clear();
  }

  return {register, regions, tick, dispose};
}

module.exports = {makeGlassCapture};
