const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createSettingsStore} = require('../settings-store.cjs');

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inazuma-settings-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const encrypted = new Map();
  const safeStorage = {isEncryptionAvailable:()=>true,
    encryptString(value) {const token=`cipher-${encrypted.size}`;encrypted.set(token,value);return Buffer.from(token);},
    decryptString(buffer) {if(!encrypted.has(buffer.toString())) throw Error('Cannot decrypt');return encrypted.get(buffer.toString());}};
  const file = path.join(directory, 'ai-settings.json');
  const args = {file, safeStorage, env:{}, ...options};
  return {directory, file, args, store:createSettingsStore(args)};
}
test('save encrypts all keys, remembers per-provider models, and blank key preserves saved key', t => {
  const {store,file,args} = fixture(t);
  store.save({provider:'openai',model:'gpt-6-luna',apiKey:'test-secret-openai'});
  store.save({provider:'gemini',model:'custom-gemini',apiKey:'test-secret-gemini'});
  store.save({provider:'openai',model:'ft:gpt-6-luna:custom',apiKey:''});
  const reloaded = createSettingsStore(args);
  assert.deepEqual(reloaded.credentials('openai'), {provider:'openai',model:'ft:gpt-6-luna:custom',api_key:'test-secret-openai'});
  assert.equal(reloaded.credentials('gemini').model,'custom-gemini');
  assert.equal(reloaded.summary().selectedProvider,'openai');
  assert(!fs.readFileSync(file,'utf8').includes('test-secret'));
  assert(!JSON.stringify(reloaded.summary()).includes('test-secret'));
});
test('legacy credentials migrate without modifying the original file', t => {
  const {directory,args} = fixture(t);
  const legacyFile=path.join(directory,'legacy.env');
  const text='DEEPSEEK_API_KEY="test-legacy-key"\nDEEPSEEK_MODEL=deepseek-chat\n';
  fs.writeFileSync(legacyFile,text);
  const store=createSettingsStore({...args,legacyFiles:[legacyFile]});
  assert.equal(store.credentials('deepseek').api_key,'test-legacy-key');
  assert.equal(store.credentials('deepseek').model,'deepseek-flash');
  assert.equal(fs.readFileSync(legacyFile,'utf8'),text);
});
test('invalid input and unavailable encryption never change saved settings', t => {
  const {store,file,args} = fixture(t);
  store.save({provider:'deepseek',model:'deepseek-flash',apiKey:'test-good-key'});
  const before=fs.readFileSync(file,'utf8');
  for (const data of [{provider:'claude',model:'test',apiKey:'x'}, {provider:'openai',model:'bad model',apiKey:'x'},
    {provider:'openai',model:'custom',apiKey:'x\ny'}, {provider:'openai',model:'custom',apiKey:''}]) assert.throws(()=>store.save(data));
  args.safeStorage.isEncryptionAvailable=()=>false;
  assert.throws(()=>store.save({provider:'deepseek',model:'another-model'}),/加密/);
  assert.equal(fs.readFileSync(file,'utf8'),before);
  assert.equal(store.credentials('deepseek').model,'deepseek-flash');
});
test('key decryption failure explains re-entry and never returns ciphertext as a key', t => {
  const {store,args}=fixture(t);
  store.save({provider:'gemini',model:'gemini-3.8-flash',apiKey:'test-gemini-key'});
  args.safeStorage.decryptString=()=>{throw Error('Private OS detail');};
  const recovered=createSettingsStore(args);
  assert.match(recovered.summary().error,/重新输入/);
  assert.equal(recovered.summary().providers.gemini.hasKey,false);
  assert.throws(()=>recovered.credentials('gemini'));
});
test('model sync uses fixed official endpoints, filters nontext and old models, and keeps manual choices', async t => {
  const {store}=fixture(t);
  store.save({provider:'openai',model:'my-custom-model',apiKey:'test-key'});
  let requested;
  const result=await store.syncModels({provider:'openai'},async(url,options)=>{
    requested={url,options};
    return Response.json({data:[{id:'gpt-6-luna'},{id:'gpt-next',created:Date.now()/1000},
      {id:'gpt-old',created:1},{id:'gpt-image-2'},{id:'gemini-3.8-flash-tts'},{id:'gpt-next',created:Date.now()/1000}]});
  });
  assert.equal(requested.url,'https://api.openai.com/v1/models');
  assert.equal(requested.options.headers.Authorization,'Bearer test-key');
  assert.equal(requested.options.redirect,'error');
  assert.deepEqual(result.models.map(model=>model.id),['gpt-6-luna','gpt-next']);
  assert.equal(store.credentials('openai').model,'my-custom-model');
});
test('sync failure is actionable and never includes provider response secrets', async t => {
  const {store}=fixture(t);
  const request={provider:'gemini',apiKey:'test-private-key'};
  await assert.rejects(store.syncModels(request,async()=>new Response('test-private-key',{status:401})),/密钥无效/);
  await assert.rejects(store.syncModels(request,async()=>{throw Error('test-private-key');}),/连接失败/);
  assert.equal(store.summary().providers.gemini.hasKey,false);
});
