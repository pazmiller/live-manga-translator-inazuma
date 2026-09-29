const fs = require('node:fs');
const path = require('node:path');
const catalog = require('./backend/provider-catalog.json');
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function definition(provider) {
  if (!Object.hasOwn(catalog.providers, provider)) throw new Error('请选择 OpenAI、Gemini 或 DeepSeek');
  return catalog.providers[provider];
}
function validateModel(model) {
  if (typeof model !== 'string' || !modelPattern.test(model.trim())) throw new Error('请填写有效的模型名称（最多 128 个字符）');
  return model.trim();
}
function validateKey(key) {
  if (typeof key !== 'string' || !key.trim() || key.length > 4096 || /[^\x21-\x7e]/.test(key.trim()))
    throw new Error('请输入有效的 API Key，不要包含空格或换行');
  return key.trim();
}

function createSettingsStore({file, safeStorage, legacyFiles = [], env = process.env}) {
  const legacy = {};
  for (const legacyFile of legacyFiles) {
    if (!fs.existsSync(legacyFile)) continue;
    for (const line of fs.readFileSync(legacyFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (match) legacy[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const configs = {};
  let selectedProvider = 'deepseek';
  let loadError = '';
  for (const [id, def] of Object.entries(catalog.providers)) {
    let model = env[def.modelEnv] || legacy[def.modelEnv] || def.defaultModel;
    // These retired aliases came from earlier Inazuma versions.
    if (id === 'deepseek' && ['deepseek-chat', 'deepseek-reasoner'].includes(model)) model = def.defaultModel;
    configs[id] = {model, apiKey: env[def.keyEnv] || legacy[def.keyEnv] || ''};
  }
  if (fs.existsSync(file)) {
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (stored.version !== 1) throw new Error('Unsupported settings');
      definition(stored.selectedProvider);
      selectedProvider = stored.selectedProvider;
      for (const id of Object.keys(configs)) {
        const saved = stored.providers?.[id];
        if (!saved) continue;
        configs[id] = {model: validateModel(saved.model), apiKey: ''};
        if (saved.key) {
          try { configs[id].apiKey = safeStorage.decryptString(Buffer.from(saved.key, 'base64')); }
          catch { loadError = '有密钥无法解密，请为对应服务商重新输入。'; }
        }
      }
    } catch { loadError = '无法读取已保存的 翻译AI配置，请重新配置。'; }
  } else {
    selectedProvider = Object.keys(configs).find(id => configs[id].apiKey) || 'deepseek';
  }
  function summary() {
    return {selectedProvider, checkedAt: catalog.checkedAt, windowStart: catalog.windowStart, error: loadError,
      providers: Object.fromEntries(Object.entries(configs).map(([id, config]) =>
        [id, {...catalog.providers[id], model: config.model, hasKey: Boolean(config.apiKey)}]))};
  }
  function credentials(provider, model) {
    definition(provider);
    const config = configs[provider];
    return {provider, model: validateModel(model || config.model), api_key: validateKey(config.apiKey)};
  }
  function save({provider, model, apiKey = ''}) {
    definition(provider);
    const next = {...configs, [provider]: {model: validateModel(model), apiKey: validateKey(apiKey || configs[provider].apiKey)}};
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密暂不可用，请稍后重试');
    const stored = {version: 1, selectedProvider: provider, providers: {}};
    for (const [id, config] of Object.entries(next)) {
      stored.providers[id] = {model: config.model, key: config.apiKey ? safeStorage.encryptString(config.apiKey).toString('base64') : ''};
    }
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temporary = `${file}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(stored, null, 2) + '\n', {mode: 0o600});
      fs.renameSync(temporary, file);
    } catch {
      throw new Error('无法保存 翻译AI配置，请检查应用数据目录的写入权限');
    }
    Object.assign(configs, next); selectedProvider = provider; loadError = '';
    return summary();
  }
  async function syncModels({provider, apiKey = ''}, fetcher = fetch) {
    const def = definition(provider);
    const key = validateKey(apiKey || configs[provider].apiKey);
    let response;
    try {
      response = await fetcher(`${def.baseUrl}/models`, {headers: {Authorization: `Bearer ${key}`},
        signal: AbortSignal.timeout(15000), redirect: 'error'});
    } catch { throw new Error('连接失败或超时，请检查网络后重试'); }
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error('密钥无效或没有权限，请检查 API Key');
      if (response.status === 429) throw new Error('服务商暂时限流，请稍后重试');
      throw new Error(`获取模型失败（${response.status}），可继续使用预置模型或手动输入`);
    }
    let data;
    try { data = await response.json(); } catch { throw new Error('服务商返回的模型列表无效，请稍后重试'); }
    if (!Array.isArray(data.data)) throw new Error('服务商返回的模型列表无效，请稍后重试');
    const known = new Map(def.models.map(model => [model.id, model]));
    const cutoff = Date.now() / 1000 - 92 * 86400;
    const models = [];
    for (const item of data.data) {
      const id = typeof item.id === 'string' ? item.id.replace(/^models\//, '') : '';
      if (!modelPattern.test(id) || models.some(model => model.id === id)) continue;
      if (!/^(gpt-|chat-|o[134](?:-|$)|gemini-|deepseek-)/.test(id) || /image|audio|tts|live|realtime|transcrib|embedding|robotics|omni|codex|research|cyber|daybreak|moderation/i.test(id)) continue;
      if (item.created > 0 && item.created < cutoff && !known.has(id)) continue;
      models.push(known.get(id) || {id, label: id, note: item.created > 0 ? '近期 · 账户可用' : '账户可用 · 日期未提供'});
    }
    models.sort((a, b) => Number(known.has(b.id)) - Number(known.has(a.id)) || a.id.localeCompare(b.id));
    return {models, syncedAt: new Date().toISOString()};
  }
  return {summary, credentials, save, syncModels};
}

module.exports = {createSettingsStore};
