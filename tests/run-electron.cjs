const { spawn } = require('node:child_process');
const path = require('node:path');
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const script = process.argv[2] || 'renderer-smoke.cjs';
spawn(require('electron'), [path.resolve(__dirname, script)], {env, stdio:'inherit'})
  .on('error', e=>{console.error(e);process.exitCode=1;})
  .on('exit', code=>process.exit(code ?? 1));
