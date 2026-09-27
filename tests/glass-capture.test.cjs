const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {makeGlassCapture} = require('../glass-capture');

function fakeWindow(bounds) {
  const win = new EventEmitter();
  win.bounds = {...bounds};
  win.getBounds = () => ({...win.bounds});
  win.isDestroyed = () => !!win.destroyed;
  win.isVisible = () => !win.hidden;
  return win;
}

function image(width, height, crops, resizes = []) {
  return {
    isEmpty:() => false,
    getSize:() => ({width, height}),
    crop(rect) { crops.push(rect); return image(rect.width, rect.height, crops, resizes); },
    resize(size) { resizes.push(size); return image(size.width, size.height, crops, resizes); },
    toDataURL:() => `data:image/mock;${width}x${height}`,
  };
}

function fixture({displays = [{id:1, bounds:{x:0, y:0, width:1920, height:1080}}],
  thumbnail = {width:1600, height:900}} = {}) {
  const sent = [], crops = [], resizes = [], calls = [];
  const sources = displays.map(display => ({display_id:String(display.id),
    thumbnail:image(thumbnail.width, thumbnail.height, crops, resizes)}));
  const state = {supported:true, paused:false, pointer:{x:0, y:0}};
  const desktopCapturer = {async getSources(options) { calls.push(options); return sources; }};
  const capture = makeGlassCapture({screen:{getAllDisplays:() => displays,
    getCursorScreenPoint:() => state.pointer}, desktopCapturer,
    send:(win, channel, payload) => sent.push({win, channel, payload}),
    canCapture:() => state.supported, isPaused:() => state.paused});
  return {capture, state, desktopCapturer, sent, crops, resizes, calls, sources};
}

test('negative monitor origin and thumbnail scale crop the actual registered window', async () => {
  const f = fixture({displays:[{id:7, bounds:{x:-1920, y:-120, width:1920, height:1080}}],
    thumbnail:{width:1280, height:720}});
  const win = fakeWindow({x:-1770, y:30, width:600, height:240});
  f.capture.register(win);
  f.capture.regions(win, [{id:'toolbar', kind:'toolbar', x:0, y:0, width:600, height:240}]);
  await f.capture.tick(0);
  assert.deepEqual(f.crops, [{x:100, y:100, width:400, height:160}]);
  assert.equal(f.sent[0].win, win);
  assert.equal(f.sent[0].channel, 'glass:frame');
  assert.equal(f.sent[0].payload.surfaces[0].image, 'data:image/mock;400x160');
  f.capture.dispose();
});

test('windows share one capture and idle work is throttled, without capturing unknown windows', async () => {
  const f = fixture();
  const a = fakeWindow({x:200, y:200, width:600, height:200});
  const b = fakeWindow({x:900, y:300, width:300, height:400});
  const unknown = fakeWindow(a.bounds);
  f.capture.register(a); f.capture.register(b);
  const region = [{id:'panel', x:0, y:0, width:200, height:100}];
  f.capture.regions(a, region); f.capture.regions(b, region); f.capture.regions(unknown, region);
  await f.capture.tick(0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.sent.length, 2);
  assert(f.sent.every(message => message.win !== unknown));
  f.capture.regions(a, region); // Repeating the same geometry must not force work.
  await f.capture.tick(160);
  assert.equal(f.calls.length, 1);
  f.state.pointer = {x:300, y:300};
  await f.capture.tick(170);
  assert.equal(f.calls.length, 2);
  assert.equal(f.sent.length, 3);
  await f.capture.tick(800);
  assert.equal(f.calls.length, 3);
  f.capture.dispose();
});

test('moving a window during capture drops old pixels and allows a fresh capture immediately', async () => {
  const f = fixture();
  const win = fakeWindow({x:200, y:200, width:600, height:200});
  f.capture.register(win);
  f.capture.regions(win, [{id:'bar', x:0, y:0, width:600, height:200}]);
  let resolve;
  f.desktopCapturer.getSources = () => new Promise(done => { resolve = done; });
  const pending = f.capture.tick(0);
  assert.equal(await f.capture.tick(200), false);
  win.bounds.x += 100; win.emit('move');
  resolve(f.sources); await pending;
  assert.equal(f.sent.length, 0);
  f.desktopCapturer.getSources = async () => f.sources;
  await f.capture.tick(201);
  assert.equal(f.sent.length, 1);
  assert.equal(f.crops[0].x, 250);
  f.capture.dispose();
});

test('transparent overlay space and selection center do not trigger high-rate capture', async () => {
  const f=fixture(),win=fakeWindow({x:0,y:0,width:1920,height:1080});
  f.capture.register(win);
  f.capture.regions(win,[{id:'card',kind:'card',x:100,y:100,width:200,height:100},
    {id:'ring',kind:'ring',x:500,y:100,width:700,height:700}]);
  f.state.pointer={x:900,y:400};await f.capture.tick(0);await f.capture.tick(160);
  assert.equal(f.calls.length,1,'Empty selection center stays at idle cadence');
  f.state.pointer={x:1550,y:750};await f.capture.tick(330);
  assert.equal(f.calls.length,1,'Fullscreen overlay empty space also stays idle');
  f.state.pointer={x:504,y:400};await f.capture.tick(500);
  assert.equal(f.calls.length,2,'Actual glass border wakes the fast cadence');
  f.capture.dispose();
});

test('partial monitor crops and missing screens clear their surfaces instead of stretching', async () => {
  const f = fixture();
  const win = fakeWindow({x:-100, y:200, width:600, height:200});
  f.capture.register(win);
  f.capture.regions(win, [{id:'bar', x:0, y:0, width:600, height:200}]);
  await f.capture.tick(0);
  assert.equal(f.crops.length, 0);
  assert.deepEqual(f.sent[0].payload, {supported:false, surfaces:[{id:'bar', image:null}]});
  win.bounds.x = 100; win.emit('move');
  f.sources.length = 0;
  await f.capture.tick(151);
  assert.equal(f.crops.length, 0);
  assert.deepEqual(f.sent[1].payload, {supported:false, surfaces:[{id:'bar', image:null}]});
  f.capture.dispose();
});

test('fractional CSS rectangles remain capturable without pretending monitor clipping is a full surface', async () => {
  const f = fixture();
  const win = fakeWindow({x:200, y:200, width:600, height:200});
  f.capture.register(win);
  f.capture.regions(win, [{id:'bar', x:0.1, y:0.2, width:521.3, height:109.6}]);
  await f.capture.tick(0);
  assert.equal(f.sent[0].payload.supported, true);
  assert.equal(f.crops.length, 1);
  f.capture.dispose();
});

test('unsupported and paused capture do no desktop work, closure discards an in-flight frame', async () => {
  const f = fixture();
  const win = fakeWindow({x:200, y:200, width:600, height:200});
  f.capture.register(win);
  f.capture.regions(win, [{id:'bar', x:0, y:0, width:600, height:200}]);
  f.state.paused = true; await f.capture.tick(0);
  f.state.paused = false; f.state.supported = false; await f.capture.tick(1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.sent[0].payload.supported, false);
  f.state.supported = true;
  let resolve;
  f.desktopCapturer.getSources = () => new Promise(done => { resolve = done; });
  const pending = f.capture.tick(200);
  win.destroyed = true; win.emit('closed');
  resolve(f.sources); await pending;
  assert.equal(f.sent.length, 1);
  assert.equal(win.listenerCount('move'), 0);
  f.capture.dispose();
});

test('surface count and delivered pixel budget remain bounded with oversized renderer requests', async () => {
  const f = fixture({displays:[{id:1, bounds:{x:0, y:0, width:2000, height:2000}}],
    thumbnail:{width:1600, height:1600}});
  const win = fakeWindow({x:0, y:0, width:2000, height:2000});
  f.capture.register(win);
  f.capture.regions(win, [
    ...Array.from({length:20}, (_, i) => ({id:`surface-${i}`, x:0, y:0, width:2000, height:2000})),
    {id:'bar', kind:'toolbar', x:0, y:0, width:600, height:200},
    {id:'bad', x:NaN, y:0, width:10, height:10},
  ]);
  await f.capture.tick(0);
  const surfaces = f.sent[0].payload.surfaces;
  assert(surfaces.length <= 8);
  assert.equal(surfaces[0].id, 'bar');
  const pixels = surfaces.filter(surface => surface.image).reduce((sum, surface) => {
    const [, width, height] = surface.image.match(/;(\d+)x(\d+)$/);
    assert(+width <= 1600 && +height <= 1600);
    return sum + width * height;
  }, 0);
  assert(pixels <= 1_200_000);
  f.capture.dispose();
});
