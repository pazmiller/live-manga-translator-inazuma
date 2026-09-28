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
async function main(){
  const exe=path.resolve(process.argv[2]||path.join(root,'dist/win-unpacked/Inazuma.exe'));
  fs.mkdirSync(path.join(root,'.qa'),{recursive:true});
  const data=fs.mkdtempSync(path.join(root,'.qa/installed-smoke-'));
  const port=await freePort(),debug=await freePort();
  const env={...process.env,MWT_BACKEND_PORT:String(port),PATH:path.join(process.env.SystemRoot,'System32')};
  for(const key of ['DEEPSEEK_API_KEY','ANTHROPIC_API_KEY','ELECTRON_RUN_AS_NODE','MWT_GLASS_CAPTURE','MWT_ENV_FILE'])delete env[key];
  const child=spawn(exe,[`--user-data-dir=${data}`,`--remote-debugging-port=${debug}`,'--smoke-test'],{cwd:data,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let exited=false;child.once('exit',()=>{exited=true;});
  const output=chunk=>fs.appendFileSync(path.join(data,'app.log'),chunk);
  child.stdout.on('data',output);child.stderr.on('data',output);
  let ws;
  try {
    const health=await until(async()=>{const r=await fetch(`http://127.0.0.1:${port}/health`);const h=await r.json();return h.ocr==='ready'&&h;},'bundled OCR startup');
    console.log('Bundled backend ready; testing Japanese OCR');
    assert.equal(health.providers.deepseek,false,'No development credentials may leak into distribution');
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
    assert(fs.existsSync(path.join(data,'settings.env.txt')));
    await evaluate("document.getElementById('quit').click()");
    assert.equal(await evaluate("document.getElementById('quit').textContent"),'退出?');
    ws.send(JSON.stringify({id:++next,method:'Runtime.evaluate',params:{expression:"document.getElementById('quit').click()"}}));
    await until(()=>exited,'application exit');
    await until(async()=>{try{await fetch(`http://127.0.0.1:${port}/health`);return false;}catch{return true;}},'backend shutdown');
    console.log(JSON.stringify({passed:true,exe,ocrCharacters:ocr.text.length,pythonOnPath:false,credentialsIncluded:false,quitAndBackendCleanup:true,evidence:data},null,2));
  } finally {
    ws?.close();
    if(!exited)await new Promise(resolve=>spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('close',resolve));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
