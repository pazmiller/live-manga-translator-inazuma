const test=require('node:test');
const assert=require('node:assert/strict');
const {ReadingWatch,difference}=require('../reading-watch');

test('page change hides results immediately and waits for stable content',()=>{
  const watcher=new ReadingWatch(1000);
  watcher.accept(Buffer.alloc(4096,255));
  assert.deepEqual(watcher.observe(Buffer.alloc(4096,100),0),{state:'changed',stale:true});
  assert.equal(watcher.observe(Buffer.alloc(4096,100),500),null);
  assert.deepEqual(watcher.observe(Buffer.alloc(4096,100),1100),{state:'stable',stale:true});
  assert.equal(watcher.observe(Buffer.alloc(4096,100),2200),null);
  assert.deepEqual(watcher.observe(Buffer.alloc(4096,255),2500),{state:'watching',stale:false});
});
test('scroll movement restarts the quiet period, translation accepts a new baseline',()=>{
  const watcher=new ReadingWatch(1000);
  watcher.accept(Buffer.alloc(100,255));
  watcher.observe(Buffer.alloc(100,90),0);
  watcher.observe(Buffer.alloc(100,140),800);
  assert.equal(watcher.observe(Buffer.alloc(100,140),1200),null);
  assert.equal(watcher.observe(Buffer.alloc(100,140),1900).state,'stable');
  watcher.accept(Buffer.alloc(100,140));
  assert.equal(watcher.observe(Buffer.alloc(100,140),4000),null);
});
test('small animation noise does not invalidate the entire page',()=>{
  const base=Buffer.alloc(4096,150), noisy=Buffer.from(base);
  noisy.fill(0,0,20);
  const watcher=new ReadingWatch();watcher.accept(base);
  assert(difference(base,noisy)<.055);
  assert.equal(watcher.observe(noisy,10),null);
});

test('moving the selection requires a new translation even if its pixels look alike',()=>{
  const watcher=new ReadingWatch(1000),sample=Buffer.alloc(4096,240);
  watcher.accept(sample);watcher.invalidate();
  assert.deepEqual(watcher.observe(sample,100),{state:'changed',stale:true});
  assert.deepEqual(watcher.observe(sample,1200),{state:'stable',stale:true});
  watcher.accept(sample);
  assert.equal(watcher.observe(sample,2500),null);
});
