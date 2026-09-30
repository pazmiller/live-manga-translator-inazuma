const {pathToFileURL} = require('node:url');

const webPreferences = Object.freeze({contextIsolation:true, sandbox:true, nodeIntegration:false,
  nodeIntegrationInWorker:false, nodeIntegrationInSubFrames:false, webviewTag:false,
  webSecurity:true, allowRunningInsecureContent:false});
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const one = test => args => args.length === 1 && test(args[0]);
const choice = (...values) => v => values.includes(v);
const number = v => Number.isFinite(v) && Math.abs(v) <= 100000;
const boolean = one(v => typeof v === 'boolean');
const empty = args => args.length === 0;
const provider = choice('openai','gemini','deepseek');
const appearance = v => object(v) && choice('smart','cards')(v.mode) &&
  Number.isFinite(v.fontScale) && v.fontScale >= .85 && v.fontScale <= 1.5 && choice('clear','tinted')(v.glassTone);
const key = v => typeof v === 'string' && /^\d{1,16}:\d{1,16}$/.test(v);
const rect = v => object(v) && ['x','y','width','height'].every(k => number(v[k])) && v.width >= 0 && v.height >= 0;
const settings = v => object(v) && provider(v.provider) && typeof v.apiKey === 'string' && v.apiKey.length <= 4096;
const policies = new Map();
function policy(channels, roles, validate = empty) {
  for (const channel of channels.split(' ')) policies.set(channel, {roles:roles.split(' '), validate});
}
policy('frame:retry frame:restore frame:enhance frame:cancel frame:clear frame:reveal frame:quit frame:configuration frame:recenter','toolbar');
policy('frame:health','toolbar overlay');
policy('frame:getBounds','selection');
policy('frame:lock','toolbar',one(v => appearance(v) && provider(v.provider) &&
  choice('ja','en','zh','ko')(v.source) && choice('zh-CN','zh-TW','en','ja')(v.target) && choice('fixed','watch')(v.readingMode)));
policy('frame:preferences','toolbar',one(appearance));
policy('frame:readingMode','toolbar',one(choice('fixed','watch')));
policy('frame:interact','toolbar',boolean);
policy('frame:height','toolbar',one(v => number(v) && v > 0));
policy('frame:resizeTo','selection',args => args.length === 5 && args.slice(0,4).every(number) &&
  args[2] > 0 && args[3] > 0 && choice('n','s','e','w','ne','nw','se','sw',undefined)(args[4]));
policy('bubble:inspect bubble:ocr bubble:manga-ocr bubble:dismiss','overlay',one(key));
policy('bubble:translate','overlay',one(v => object(v) && key(v.key) && typeof v.text === 'string' && v.text.trim().length > 0 && v.text.length <= 4000));
policy('overlay:editor','overlay',boolean);
policy('win:dragging','toolbar selection overlay',boolean);
policy('win:hitRegions','toolbar selection overlay',one(v => Array.isArray(v) && v.length <= 400 && v.every(rect)));
policy('glass:regions','toolbar selection overlay',one(v => Array.isArray(v) && v.length <= 64 &&
  v.every(r => rect(r) && typeof r.id === 'string' && r.id.length <= 128 && typeof r.kind === 'string' && r.kind.length <= 32)));
policy('settings:load settings:close','settings');
policy('settings:models','settings',one(settings));
policy('settings:save','settings',one(v => settings(v) && typeof v.model === 'string' && v.model.length > 0 && v.model.length <= 256));

function createSecurity(ipcMain) {
  const windows = new WeakMap(), sessions = new WeakSet();
  function protectWindow(win, role, file) {
    const contents = win.webContents;
    windows.set(contents, {role, url:pathToFileURL(file).href});
    win.once('closed', () => windows.delete(contents));
    contents.setWindowOpenHandler(() => ({action:'deny'}));
    for (const event of ['will-navigate','will-frame-navigate','will-redirect','will-attach-webview']) {
      contents.on(event, event => event.preventDefault());
    }
    const session = contents.session;
    if (!sessions.has(session)) {
      sessions.add(session);
      // No renderer needs device access; screenshots are taken in the main process.
      session.setPermissionCheckHandler(() => false);
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    }
  }
  function allowed(channel, event, args) {
    try {
      const rule = policies.get(channel), window = windows.get(event.sender);
      return Boolean(rule && window && !event.sender.isDestroyed() &&
        event.senderFrame === event.sender.mainFrame && event.senderFrame.url === window.url &&
        rule.roles.includes(window.role) && rule.validate(args));
    } catch { return false; }
  }
  function register(method, channel, callback) {
    if (!policies.has(channel)) throw new Error(`Missing IPC policy: ${channel}`);
    ipcMain[method](channel, (event, ...args) => {
      if (allowed(channel,event,args)) return callback(event,...args);
      // send() has no rejection channel: discard it without crashing the app.
      if (method === 'handle') throw new Error('Blocked IPC request');
    });
  }
  return {protectWindow, allowed, handle:(channel,callback)=>register('handle',channel,callback),
    on:(channel,callback)=>register('on',channel,callback)};
}
module.exports = {createSecurity, webPreferences};
