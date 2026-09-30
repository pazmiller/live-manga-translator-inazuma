const {spawn, spawnSync} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const {createBackendClient} = require('./backend-client.cjs');

function createBackendService({executable, args, cwd, env, port, onError}) {
  const secret = randomBytes(32);
  const client = createBackendClient({port, secret});
  let child, closed = false;
  return {
    start() {
      child = spawn(executable, args, {cwd, env, windowsHide:true, stdio:['pipe','pipe','pipe']});
      const fail = () => {client.close();if (!closed) onError();};
      child.once('error', fail);
      child.once('exit', () => {child = null;fail();});
      child.stdin.on('error', fail);
      // Session secret travels only through the child's inherited stdin pipe.
      child.stdin.end(secret.toString('hex') + '\n');
      child.stdout.on('data', data => process.stdout.write(`[py] ${data}`));
      child.stderr.on('data', data => process.stderr.write(`[py] ${data}`));
    },
    request:client.request,
    close() {
      closed = true;client.close();secret.fill(0);
      if (child?.pid && process.platform === 'win32')
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true, stdio:'ignore', timeout:3000});
      else child?.kill();
    },
  };
}
module.exports = {createBackendService};
