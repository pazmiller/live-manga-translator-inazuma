// Native capture probe: keeps desktop pixels in memory, never saves or logs them.
const {app, desktopCapturer} = require('electron');
const {performance} = require('node:perf_hooks');
app.whenReady().then(async () => {
  let last=performance.now(), lag=0;
  const heartbeat=setInterval(()=>{const now=performance.now();lag=Math.max(lag,now-last-20);last=now;},20);
  try {
    for(let i=0;i<3;i++) {
      const start=performance.now();
      const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1600,height:1600},fetchWindowIcons:false});
      const captured=performance.now();
      for(const source of sources) if(!source.thumbnail.isEmpty()) source.thumbnail.toDataURL();
      await new Promise(resolve=>setTimeout(resolve,50));
      console.log(JSON.stringify({sample:i,captureMs:Math.round(captured-start),encodeMs:Math.round(performance.now()-captured-50),maxHeartbeatLagMs:Math.round(lag),screens:sources.length}));
    }
  } catch(error) {console.error(error.message);process.exitCode=1;}
  finally {clearInterval(heartbeat);app.exit(process.exitCode || 0);}
});
