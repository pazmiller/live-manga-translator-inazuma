// Run the actual built/installed exe, with no system mouse input or paid APIs.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function until(fn,label){for(let i=0;i<180;i++){try{const r=await fn();if(r)return r;}catch{}await delay(250);}throw Error(`Timeout: ${label}`);}
async function inspectSettings(target) {
  const socket=new WebSocket(target.webSocketDebuggerUrl);
  try {
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{reject(Error('Settings IPC timed out'));socket.close();},10000);
      socket.onerror=()=>{clearTimeout(timer);reject(Error('Settings debugger connection failed'));};
      socket.onopen=()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{
        expression:'window.settingsApi.load()',awaitPromise:true,returnByValue:true}}));
      socket.onmessage=event=>{
        const response=JSON.parse(event.data);if(response.id!==1)return;
        clearTimeout(timer);
        if(response.error||response.result?.exceptionDetails) reject(Error('Packaged settings failed to load'));
        else resolve(response.result.result.value);
      };
    });
  } finally {socket.close();}
}
async function main(){
  const manga=process.argv.includes('--manga');
  const exe=path.resolve(process.argv[2]||path.join(root,'dist/win-unpacked/Inazuma.exe'));
  fs.mkdirSync(path.join(root,'.qa'),{recursive:true});
  const data=fs.mkdtempSync(path.join(root,'.qa/installed-smoke-'));
  const port=await freePort(),debug=await freePort();
  const env={...process.env,MWT_BACKEND_PORT:String(port),PATH:path.join(process.env.SystemRoot,'System32')};
  if(manga) Object.assign(env,{HF_HOME:path.join(data,'empty-hf-cache'),HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'});
  for(const key of ['OPENAI_API_KEY','GEMINI_API_KEY','DEEPSEEK_API_KEY','ANTHROPIC_API_KEY','ELECTRON_RUN_AS_NODE','MWT_GLASS_CAPTURE','MWT_ENV_FILE'])delete env[key];
  let child,exited=true;
  const output=chunk=>fs.appendFileSync(path.join(data,'app.log'),chunk);
  child=spawn(exe,[`--user-data-dir=${data}`,`--remote-debugging-port=${debug}`,'--smoke-test'],{cwd:data,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  exited=false;child.once('exit',()=>{exited=true;});child.stdout.on('data',output);child.stderr.on('data',output);
  let ws;
  try {
    const health=await until(async()=>{const r=await fetch(`http://127.0.0.1:${port}/health`);const h=await r.json();return h.ocr==='ready'&&h;},'bundled OCR startup');
    console.log('Bundled backend ready; testing Japanese OCR');
    assert.equal(health.protocol,4);
    assert(Object.values(health.providers).every(value=>value===false),'No development credentials may leak into distribution');
    if(manga) {
      await until(async()=>{const h=await(await fetch(`http://127.0.0.1:${port}/health`)).json();return h.manga_ocr_state==='ready';},'offline bundled Manga OCR startup');
      const image=fs.readFileSync(path.join(root,'.qa/fixture-bubble.png')).toString('base64');
      for(let attempt=0;attempt<2;attempt++) {
        const start=Date.now();
        const result=await fetch(`http://127.0.0.1:${port}/bubble/manga-ocr`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image,source:'ja'})});
        const answer=await result.json();assert(result.ok,JSON.stringify(answer));assert.match(answer.text,/一緒に行こう/);
        console.log(`Offline bundled Manga OCR pass ${attempt+1}: ${Date.now()-start} ms, ${answer.text.length} characters`);
      }
      assert(!fs.existsSync(env.HF_HOME),'Bundled Manga OCR must not populate an external model cache');
    }
    const response=await fetch(`http://127.0.0.1:${port}/bubble/ocr`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:fs.readFileSync(path.join(root,'.qa/fixture.png')).toString('base64'),source:'ja'})});
    const ocr=await response.json();assert(response.ok,JSON.stringify(ocr));assert(ocr.text.length>0);
    for(const source of ['en','zh','ko']){
      console.log(`Testing ${source} OCR`);
      const result=await fetch(`http://127.0.0.1:${port}/bubble/ocr`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:fs.readFileSync(path.join(root,'.qa/fixture.png')).toString('base64'),source})});
      assert(result.ok,`${source}: ${await result.text()}`);
    }
    const target=await until(async()=>{const tabs=await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json();return tabs.find(t=>t.url.endsWith('frame.html'));},'packaged toolbar');
    ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let next=0;const pending=new Map();
    ws.onmessage=event=>{const msg=JSON.parse(event.data);if(pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(Error(msg.error.message)):resolve(msg.result);}};
    function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
    async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
    assert.equal(await evaluate('typeof window.api.configuration'),'function');
    await evaluate("document.getElementById('clear').click()");await delay(200);
    assert.equal(await evaluate("document.getElementById('status').textContent"),'已清除');
    await evaluate("document.getElementById('uiLanguage').click()");
    await until(()=>evaluate("document.querySelector('#lock span').textContent==='Translate region'"),'packaged English toolbar');
    await evaluate("document.getElementById('uiLanguage').click()");
    await until(()=>evaluate("document.querySelector('#lock span').textContent==='翻译选区'"),'packaged Chinese toolbar');
    assert(!fs.existsSync(path.join(data,'settings.env.txt')),'Fresh install does not create a manual credential file');
    await evaluate("document.getElementById('configuration').click()");
    const settingsTarget=await until(async()=>{const tabs=await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json();return tabs.find(t=>t.url.endsWith('settings.html'));},'packaged AI settings');
    const settings=await inspectSettings(settingsTarget);
    assert.deepEqual(Object.keys(settings.providers).sort(),['deepseek','gemini','openai']);
    assert(Object.values(settings.providers).every(provider=>!provider.hasKey));
    await evaluate("document.getElementById('quit').click()");
    assert.equal(await evaluate("document.getElementById('quit').textContent"),'退出?');
    ws.send(JSON.stringify({id:++next,method:'Runtime.evaluate',params:{expression:"document.getElementById('quit').click()"}}));
    await until(()=>exited,'application exit');
    await until(async()=>{try{await fetch(`http://127.0.0.1:${port}/health`);return false;}catch{return true;}},'backend shutdown');
    console.log(JSON.stringify({passed:true,exe,mangaOcrOffline:manga,ocrCharacters:ocr.text.length,pythonOnPath:false,credentialsIncluded:false,quitAndBackendCleanup:true,evidence:data},null,2));
  } finally {
    ws?.close();
    if(!exited)await new Promise(resolve=>spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('close',resolve));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
