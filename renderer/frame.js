const $ = id => document.getElementById(id);
let busy = false;
let hasTranslated = false;
let fontScale = 1;
let interactionLocked = false;
let cancelText = '已取消';
let readingMode = 'fixed';
let readingRequest = 0;
let recovery = { available: false, canRestore: false, completed: 0, total: 0 };
let enhanceAvailable = false;

function status(text) {
  $('status').textContent = text;
  $('status').title = text;
}

function prefs() {
  return { source: $('source').value, target: $('target').value, provider: $('provider').value,
    mode: $('mode').value, fontScale, glassTone: $('glassTone').value, readingMode };
}

try {
  const saved = JSON.parse(localStorage.getItem('preferences') || '{}');
  for (const id of ['source', 'target', 'provider', 'mode', 'glassTone']) {
    if ([...$(id).options].some(option => option.value === saved[id])) $(id).value = saved[id];
  }
  fontScale = Math.max(.85, Math.min(1.5, Number(saved.fontScale) || 1));
  readingMode = saved.readingMode === 'watch' ? 'watch' : 'fixed';
} catch {}

function save() {
  const preferences = prefs();
  localStorage.setItem('preferences', JSON.stringify(preferences));
  document.documentElement.dataset.glassTone = preferences.glassTone;
  window.api.preferences({ mode: preferences.mode, fontScale, glassTone: preferences.glassTone });
  $('smaller').disabled = fontScale <= .85;
  $('larger').disabled = fontScale >= 1.5;
}
for (const id of ['source', 'target', 'provider', 'mode', 'glassTone']) $(id).onchange = save;
for (const [id, delta] of [['smaller', -.1], ['larger', .1]]) {
  $(id).onclick = () => {
    fontScale = Math.max(.85, Math.min(1.5, Math.round((fontScale + delta) * 100) / 100));
    save();
    status('字号 ' + Math.round(fontScale * 100) + '%');
  };
}
$('reveal').onclick = () => window.api.reveal();
$('configuration').onclick = async () => {
  try { await window.api.configuration(); }
  catch(error) { showError(error.message); }
};
window.api.onReveal(value => {
  $('reveal').setAttribute('aria-pressed', String(value));
  $('reveal').textContent = value ? '返回译文' : '查看原图';
});
$('interactToggle').onclick = () => {
  interactionLocked = !interactionLocked;
  $('interactToggle').textContent = interactionLocked ? '已锁定选区' : '锁定选区';
  $('interactToggle').setAttribute('aria-pressed', String(interactionLocked));
  window.api.setInteractionLocked(interactionLocked);
};

function reportLayout() {
  const rect = $('toolbar').getBoundingClientRect();
  window.api.hitRegions([{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }]);
  window.api.setToolbarHeight?.(Math.ceil(rect.bottom + 8));
}
function showError(text) {
  $('message').querySelector('p').textContent = text || '请稍后重试。';
  $('message').hidden = false;
  reportLayout();
}
function hideError() {
  $('message').hidden = true;
  reportLayout();
}
$('dismissMessage').onclick = hideError;
document.addEventListener('keydown', event => { if (event.key === 'Escape') hideError(); });

function updateRecovery() {
  $('enhanceOcr').hidden = !enhanceAvailable;
  $('enhanceOcr').disabled = busy;
  $('recovery').hidden = !recovery.available && !recovery.canRestore;
  $('recoveryCount').textContent = `本页完成 ${recovery.completed || 0} / ${recovery.total || 0}`;
  $('retryRemaining').disabled = busy || !recovery.available;
  $('restorePrevious').disabled = busy || !recovery.canRestore;
  reportLayout();
}
window.api.onRecovery?.(data => { recovery = data; enhanceAvailable = Boolean(data.canEnhance); updateRecovery(); });

function setBusy(value) {
  busy = value;
  document.body.classList.toggle('busy', value);
  $('lock').classList.toggle('busy', value);
  $('lock').querySelector('span').textContent = value ? '取消翻译' : '翻译选区';
  for (const id of ['source', 'target', 'provider', 'translateCurrent']) $(id).disabled = value;
  updateRecovery();
}

async function translate(retry = false) {
  if (busy) {
    if (retry) return;
    cancelText = '已取消';
    status('正在取消…');
    try { await window.api.cancel(); } catch (error) { showError(error.message); }
    return;
  }
  hasTranslated = true;
  setBusy(true);
  cancelText = '已取消';
  hideError();
  status(retry ? '继续翻译剩余文字…' : '正在准备…');
  try {
    const result = await (retry ? window.api.retryRemaining() : window.api.lock(prefs()));
    if (result.cancelled) status(cancelText);
    else if (result.error) { status('翻译未完成'); showError(result.error); }
    else if (!result.count) status('未发现文字，请调整选区');
    else {
      const elapsed = result.timings ? ` · ${(result.timings.total_ms / 1000).toFixed(1)} 秒` : '';
      status(result.ocr_cached && result.cached === result.count ? `已复用 · ${result.count} 处` : `${result.count} 处${elapsed}`);
      if (result.timings) $('status').title = `识别 ${result.timings.ocr_ms} ms / 翻译 ${result.timings.translation_ms} ms`;
    }
  } catch (error) { status('翻译未完成'); showError(error.message); }
  finally { setBusy(false); }
}
const doLock = () => translate();
$('lock').onclick = doLock;
window.api.onHotkeyLock(doLock);
$('enhanceOcr').onclick = async () => {
  if (busy || !enhanceAvailable) return;
  setBusy(true); cancelText = '已取消加强 OCR'; hideError(); status('正在加强 OCR…');
  try {
    const result = await window.api.enhanceCurrent();
    if (result.cancelled) status(cancelText);
    else if (result.error) { status('加强 OCR 未完成'); showError(result.error); }
    else status(result.changed ? `加强 OCR 完成 · 更新 ${result.changed} 处` : '加强 OCR 完成 · 原文没有变化');
  } catch (error) { status('加强 OCR 未完成'); showError(error.message); }
  finally { setBusy(false); }
};
$('translateCurrent').onclick = doLock;
$('retryRemaining').onclick = () => translate(true);
$('restorePrevious').onclick = async () => {
  if (busy) return;
  try {
    const result = await window.api.restorePrevious();
    if (result.restored) { hideError(); status(`已恢复上一版 · ${result.count} 处`); }
    else status('暂无可恢复的上一版');
  } catch (error) { showError(error.message); }
};
$('clear').onclick = async () => {
  cancelText = '已清除';
  try { await window.api.clear(); } catch (error) { showError(error.message); }
};
window.api.onStatus(data => {
  if (data.cleared) { cancelText = '已清除'; enhanceAvailable = false; updateRecovery(); hideError(); }
  status(data.text);
});

function updateReadingState(data) {
  $('readingStatus').textContent = data.text;
  $('readingStatus').title = data.text;
  document.querySelector('.reading-row').dataset.state = data.state;
  $('translateCurrent').hidden = data.state !== 'stable';
}
window.api.onReadingState?.(updateReadingState);
function applyReadingMode(value) {
  readingMode = value === 'watch' ? 'watch' : 'fixed';
  $('fixedMode').setAttribute('aria-pressed', String(readingMode === 'fixed'));
  $('watchMode').setAttribute('aria-pressed', String(readingMode === 'watch'));
  save();
}
async function setReadingMode(value) {
  const request = ++readingRequest;
  const previousMode = readingMode;
  applyReadingMode(value);
  updateReadingState({ state: value === 'watch' ? 'watching' : 'off', text: value === 'watch' ? '检测翻页，确认后再翻译' : '固定选区，按需翻译' });
  try {
    const result = await window.api.setReadingMode?.(value);
    if (request !== readingRequest) return;
    if (result?.mode === 'fixed' || result?.mode === 'watch') applyReadingMode(result.mode);
    if (result?.error) { updateReadingState({ state: 'error', text: result.error }); showError(result.error); }
  } catch (error) {
    if (request !== readingRequest) return;
    applyReadingMode(previousMode);
    updateReadingState({ state: 'error', text: '阅读模式切换失败，请重试' });
    showError(error.message);
  }
}
$('fixedMode').onclick = () => setReadingMode('fixed');
$('watchMode').onclick = () => setReadingMode('watch');
$('moveSelection').onclick = async () => {
  try { await window.api.moveSelectionToCursor?.(); status('选区已移回当前屏幕'); }
  catch (error) { showError(error.message); }
};

let settingsLoaded = false;
function applyConfiguration(settings) {
  $('provider').value = settings.selectedProvider;
  for (const option of $('provider').options) {
    const config = settings.providers[option.value];
    option.disabled = !config?.hasKey;
    option.title = config?.hasKey ? config.model : '请在 翻译AI配置中填写密钥';
  }
  save();
}
window.api.onConfigurationChanged?.(settings => {
  settingsLoaded = true; applyConfiguration(settings); hideError();
  status(`已切换 ${settings.providers[settings.selectedProvider].name} · ${settings.providers[settings.selectedProvider].model}`);
});
function updateHealth(data) {
  if(data.settings && !settingsLoaded) {settingsLoaded = true;applyConfiguration(data.settings);}
  if (!busy && !hasTranslated) status(data.ocr === 'loading' ? '普通 OCR 预热中，可开始框选'
    : data.manga_ocr_state === 'loading' ? '日漫精读后台载入中，可开始翻译'
    : Object.values(data.providers).some(Boolean) ? '框选漫画后开始翻译' : '先打开 翻译AI配置，连接翻译服务');
  for (const option of $('provider').options) {
    option.disabled = !data.providers[option.value];
    option.title = option.disabled ? '请在 翻译AI配置中填写密钥' : data.settings?.providers[option.value]?.model || '';
  }
  if ($('provider').selectedOptions[0]?.disabled) {
    const available = [...$('provider').options].find(option => !option.disabled);
    if (available) { $('provider').value = available.value; save(); }
  }
  if (data.ocr === 'loading' || data.manga_ocr_state === 'loading')
    setTimeout(() => window.api.health().then(updateHealth).catch(() => {}), 1000);
  if (data.ocr === 'error' && !busy && !hasTranslated) status('预热失败，翻译时将重试');
}
window.api.health().then(updateHealth).catch(error => { status('服务不可用'); showError(error.message); });

let quitArmed = false;
$('quit').onclick = () => {
  if (quitArmed) { window.api.quit(); return; }
  quitArmed = true;
  $('quit').textContent = '退出?';
  $('quit').setAttribute('aria-label', '再次点击退出应用');
  $('quit').classList.add('armed');
  setTimeout(() => {
    quitArmed = false;
    $('quit').textContent = '×';
    $('quit').setAttribute('aria-label', '退出应用');
    $('quit').classList.remove('armed');
  }, 3000);
};
new ResizeObserver(reportLayout).observe($('toolbar'));
setReadingMode(readingMode);
