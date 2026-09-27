const test=require('node:test');
const assert=require('node:assert/strict');
const {readEvents,localBubble,intersect}=require('../pipeline');

test('NDJSON handles split UTF-8 and several events per chunk',async()=>{
  const bytes=Buffer.from('{"type":"bubble","text":"你好"}\n{"type":"done"}\n');
  const response=new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=2)controller.enqueue(bytes.subarray(i,i+2));controller.close();}}));
  const events=[];await readEvents(response,e=>events.push(e));assert.equal(events[0].text,'你好');assert.equal(events.length,2);
});
test('broken stream cannot report completion',async()=>{
  await assert.rejects(readEvents(new Response('{"type":"bubble"}\n'),()=>{}),/提前结束/);
  await assert.rejects(readEvents(new Response('{"type":"error","message":"timeout"}\n'),()=>{}),/timeout/);
});
test('physical pixels and masks map to a negative-origin display at 150% DPI',()=>{
  const b={x:30,y:60,w:150,h:90,masks:[{x:27,y:57,w:156,h:96}]};
  const mapped=localBubble(b,{rect:{x:-1800,y:100},display:{bounds:{x:-1920,y:0}},scale:1.5});
  assert.deepEqual([mapped.x,mapped.y,mapped.w,mapped.h],[140,140,100,60]);
  assert.deepEqual(mapped.masks[0],{x:138,y:138,w:104,h:64});
});
test('cross-screen capture clips to the actual chosen monitor',()=>{
  assert.deepEqual(intersect({x:-50,y:50,width:300,height:200},{x:0,y:0,width:1920,height:1080}),{x:0,y:50,width:250,height:200});
});
