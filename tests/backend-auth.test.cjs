const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {randomBytes, createHmac} = require('node:crypto');
const {createBackendClient, AUTH_ERROR} = require('../backend-client.cjs');

async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  return server.address().port;
}
function hello(req, res, secret, extra = {}) {
  const nonce = new URL(req.url,'http://localhost').searchParams.get('nonce');
  const proof = createHmac('sha256',secret).update(`server\n${nonce}`).digest('hex');
  res.writeHead(200, {'Content-Type':'application/json', ...extra});
  res.end(JSON.stringify({proof}));
}

test('fake/old backend never receives credential headers or payload', async t=>{
  const seen=[];
  const port=await fixture(t,(req,res)=>{seen.push({url:req.url,authorization:req.headers.authorization});res.end(JSON.stringify({service:'manga-window-translator',protocol:4}));});
  const client=createBackendClient({port,secret:randomBytes(32)});
  await assert.rejects(client.request('/translate/stream',{method:'POST',body:'private-key-and-image'}),{message:AUTH_ERROR});
  assert.equal(seen.length,1);assert(seen[0].url.startsWith('/auth?'));assert.equal(seen[0].authorization,undefined);
  client.close();
});

test('authenticated requests use same connection and preserve streamed results',async t=>{
  const secret=randomBytes(32);let authenticatedSocket,received;
  const port=await fixture(t,async(req,res)=>{
    if(req.url.startsWith('/auth?')){authenticatedSocket=req.socket;hello(req,res,secret);return;}
    assert.equal(req.socket,authenticatedSocket);
    assert.equal(req.headers.authorization,`Bearer ${createHmac('sha256',secret).update('client').digest('hex')}`);
    const chunks=[];for await(const chunk of req)chunks.push(chunk);received=Buffer.concat(chunks).toString();
    res.writeHead(200,{'Content-Type':'application/x-ndjson'});res.write('{"type":"progress"}\n');
    setTimeout(()=>res.end('{"type":"done"}\n'),10);
  });
  const client=createBackendClient({port,secret});
  const response=await client.request('/translate/stream',{method:'POST',body:'test-input'});
  assert.equal(await response.text(),'{"type":"progress"}\n{"type":"done"}\n');assert.equal(received,'test-input');client.close();
});

test('connection replacement after a valid challenge fails before sending secrets',async t=>{
  const secret=randomBytes(32);let posts=0;
  const port=await fixture(t,(req,res)=>{
    if(req.url.startsWith('/auth?'))hello(req,res,secret,{'Connection':'close'});
    else {posts++;res.end();}
  });
  const client=createBackendClient({port,secret});
  await assert.rejects(client.request('/bubble/translate',{method:'POST',body:'private'}),{message:AUTH_ERROR});
  assert.equal(posts,0);client.close();
});

test('proof from another launch is rejected',async t=>{
  const port=await fixture(t,(req,res)=>hello(req,res,randomBytes(32)));
  const client=createBackendClient({port,secret:randomBytes(32)});
  await assert.rejects(client.request('/health'),{message:AUTH_ERROR});client.close();
});

test('abort and shutdown cancel authentication and future requests',async t=>{
  const port=await fixture(t,()=>{});
  const client=createBackendClient({port,secret:randomBytes(32)});
  await assert.rejects(client.request('/health',{signal:AbortSignal.timeout(30)}));
  client.close();await assert.rejects(client.request('/health'));
});
