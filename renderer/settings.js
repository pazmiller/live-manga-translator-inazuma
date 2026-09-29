const $ = id => document.getElementById(id);
let settings, provider, busy = false;
const drafts = new Map();

function feedback(message = '', error = false) {
  $('feedback').textContent = message;
  $('feedback').classList.toggle('error', error);
  if(message) $('feedback').scrollIntoView({block: 'nearest'});
}
function setBusy(value) {
  busy = value;
  for (const id of ['providers', 'fields', 'save']) $(id).disabled = value;
  $('settings-form').setAttribute('aria-busy', String(value));
}
function draft() { return drafts.get(provider); }
function collect() {
  if(!provider) return;
  draft().model = $('model').value === '__custom' ? $('custom-model').value.trim() : $('model').value;
  draft().custom = $('model').value === '__custom';
  draft().apiKey = $('api-key').value;
}
function renderModels() {
  const current = draft(), config = settings.providers[provider];
  $('model').replaceChildren();
  for (const model of current.models) {
    const option = new Option(`${model.label}${model.note ? ' · ' + model.note : ''}`, model.id);
    $('model').add(option);
  }
  $('model').add(new Option('手动输入模型名称…', '__custom'));
  const custom = current.custom || !current.models.some(model => model.id === current.model);
  $('model').value = custom ? '__custom' : current.model;
  $('custom-model').value = custom ? current.model : '';
  $('custom-field').hidden = !custom;
  $('custom-model').required = custom;
  $('model-note').textContent = current.synced
    ? '已同步账户可用文本模型；服务商未提供的发布日期不作推断。'
    : `近三个月文本模型 · 官方核对 ${settings.checkedAt}`;
  $('endpoint').textContent = config.baseUrl;
}
function selectProvider(id) {
  collect(); provider = id;
  const config = settings.providers[id];
  if(!drafts.has(id)) drafts.set(id, {model: config.model, apiKey: '', models: config.models, custom: false});
  document.querySelector(`input[name="provider"][value="${id}"]`).checked = true;
  renderModels();
  $('api-key').value = draft().apiKey;
  $('api-key').type = 'password';
  $('api-key').required = !config.hasKey;
  $('api-key').placeholder = config.hasKey ? '已保存密钥 · 留空沿用，输入可替换' : `粘贴 ${config.name} 的 API Key`;
  $('key-state').textContent = config.hasKey ? '密钥已保存' : '保存在本机';
  $('toggle-key').textContent = '显示';
  $('toggle-key').setAttribute('aria-label', '显示密钥');
  $('toggle-key').setAttribute('aria-pressed', 'false');
  feedback();
}
for (const input of document.querySelectorAll('input[name="provider"]')) input.onchange = () => selectProvider(input.value);
$('model').onchange = () => {
  const custom = $('model').value === '__custom';
  $('custom-field').hidden = !custom; $('custom-model').required = custom;
  if(custom) $('custom-model').focus();
  collect(); feedback();
};
$('toggle-key').onclick = () => {
  const visible = $('api-key').type === 'password';
  $('api-key').type = visible ? 'text' : 'password';
  $('toggle-key').textContent = visible ? '隐藏' : '显示';
  $('toggle-key').setAttribute('aria-label', visible ? '隐藏密钥' : '显示密钥');
  $('toggle-key').setAttribute('aria-pressed', String(visible));
};
$('sync').onclick = async () => {
  if(busy) return;
  collect(); setBusy(true); feedback('正在连接服务商，读取可用模型…');
  $('sync').textContent = '同步中…';
  try {
    const result = await window.settingsApi.models({provider, apiKey: draft().apiKey});
    if(result.error) throw new Error(result.error);
    if(!result.models.length) {feedback('已连接，但未发现适用的文本模型。可以手动填写模型名称。');return;}
    draft().models = result.models; draft().synced = true; renderModels();
    feedback(`连接成功 · 已同步 ${result.models.length} 个模型。模型实际可用性以翻译请求为准。`);
  } catch(error) {feedback(error.message, true);}
  finally {setBusy(false);$('sync').textContent = '↻ 同步可用模型';}
};
$('settings-form').onsubmit = async event => {
  event.preventDefault(); if(busy) return;
  collect(); setBusy(true); feedback('正在保存…'); $('save').textContent = '保存中…';
  try {
    const result = await window.settingsApi.save({provider, model: draft().model, apiKey: draft().apiKey});
    if(result.error) throw new Error(result.error);
    $('api-key').value = ''; drafts.clear();
    await window.settingsApi.close();
  } catch(error) {feedback(error.message, true);}
  finally {setBusy(false);$('save').textContent = '保存并使用';}
};
$('close').onclick = $('cancel').onclick = () => window.settingsApi.close();
document.addEventListener('keydown', event => {if(event.key === 'Escape') window.settingsApi.close();});
window.settingsApi.load().then(data => {
  settings = data; selectProvider(data.selectedProvider); setBusy(false);
  for (const [id, config] of Object.entries(data.providers)) {
    const state = document.querySelector(`[data-state="${id}"]`);
    state.textContent = config.hasKey ? '已配置' : '未配置'; state.classList.toggle('connected', config.hasKey);
  }
  if(data.error) feedback(data.error, true);
}).catch(() => feedback('设置读取失败，请关闭窗口后重新打开。', true));
