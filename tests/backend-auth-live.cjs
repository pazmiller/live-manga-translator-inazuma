// Real Python process, private stdin provisioning, HTTP handshake and real OCR.
// No provider requests and no desktop screenshots.
const {createBackendService} = require('../backend-service.cjs');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const delay = ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const env={...process.env,MWT_ENV_FILE:path.join(root,'.qa','no-security-test.env'),HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'};
  for(const key of ['OPENAI_API_KEY','GEMINI_API_KEY','DEEPSEEK_API_KEY','ANTHROPIC_API_KEY'])delete env[key];
  // This test targets RapidOCR transport; Manga OCR startup has its own live test.
  env.MWT_MANGA_OCR_PYTHON=path.join(root,'.qa','nonexistent-python.exe');
  let failed=false;
  const service=createBackendService({executable:path.join(root,'backend/.venv/Scripts/python.exe'),
    args:['server.py',String(port)],cwd:path.join(root,'backend'),env,port,onError:()=>{failed=true;}});
  service.start();
  try {
    let ready=false;
    for(let i=0;i<100&&!ready;i++){
      assert(!failed,'Backend exited');
      try{ready=(await(await service.request('/health',{signal:AbortSignal.timeout(1000)})).json()).ocr==='ready';}catch{}
      if(!ready)await delay(200);
    }
    assert(ready,'OCR did not warm up');
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/bubble/ocr`,{method:'POST',body:'bad input'})).status,401);
    const image=fs.readFileSync(path.join(root,'.qa/fixture.png')).toString('base64');
    const started=Date.now();
    const result=await service.request('/bubble/ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image,source:'ja'})});
    const data=await result.json();assert(result.ok);assert(data.text.length>0);
    const healthStarted=Date.now();
    for(let i=0;i<10;i++)assert((await(await service.request('/health')).json()).ok);
    console.log(JSON.stringify({passed:true,realOcrCharacters:data.text.length,ocrAndHealthMs:Date.now()-started,
      meanAuthenticatedHealthMs:(Date.now()-healthStarted)/10,unauthorizedBlocked:true}));
  } finally {service.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
