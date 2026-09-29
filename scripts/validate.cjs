const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function runStep(step, directory) {
  const started = Date.now();
  const log = path.join(directory, `${step.id}.log`);
  fs.writeFileSync(log, `${step.label}\n`);
  return new Promise(resolve => {
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(step.command, step.args, {cwd:root, env, windowsHide:true,
      detached:process.platform !== 'win32', stdio:['ignore','pipe','pipe']});
    let timedOut = false, launchError = null, cleanupError = null;
    const append = chunk => fs.appendFileSync(log, chunk);
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', error => {launchError = error.message;append(`${error.message}\n`);});
    const timer = setTimeout(() => {
      timedOut = true;
      append(`\nTIMEOUT after ${step.timeoutMs}ms\n`);
      if (!child.pid) return;
      if (process.platform === 'win32') {
        // Kill only this test's process tree, never other Electron/app instances.
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true});
        killer.on('error', error => {cleanupError=error.message;child.kill();});
        killer.on('exit', code => {
          if (code !== 0) {cleanupError=`taskkill exited ${code}`;child.kill();}
        });
      } else {
        try {process.kill(-child.pid, 'SIGKILL');}
        catch (error) {if (error.code !== 'ESRCH') {cleanupError=error.message;child.kill('SIGKILL');}}
      }
    }, step.timeoutMs);
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({id:step.id, label:step.label,
        status:timedOut ? 'TIMEOUT' : launchError || exitCode !== 0 ? 'FAIL' : 'PASS',
        durationMs:Date.now()-started, exitCode, signal, timeoutMs:step.timeoutMs,
        log, error:launchError, cleanupError});
    });
  });
}

async function runValidation(steps, directory, notCovered, announce = console.log) {
  fs.mkdirSync(directory, {recursive:true});
  const report = {startedAt:new Date().toISOString(), status:'RUNNING', results:[], notCovered};
  const reportPath = path.join(directory, 'latest.json');
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)+'\n');
  save();
  for (const step of steps) {
    announce(`RUN   ${step.label}`);
    const result = await runStep(step, directory);
    report.results.push(result);
    save();
    announce(`${result.status.padEnd(7)}${step.label} (${(result.durationMs/1000).toFixed(1)}s)`);
    if (result.status !== 'PASS') announce(`      日志：${result.log}`);
  }
  report.status = report.results.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL';
  report.finishedAt = new Date().toISOString();
  save();
  announce(`\n未覆盖：${notCovered.join('；')}\n结果：${report.status}\n报告：${reportPath}`);
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--glass')) throw new Error('Usage: node scripts/validate.cjs [--glass]');
  const glass = args.includes('--glass');
  const electron = require('electron');
  const ui = (id, label, file) => ({id, label, command:electron,
    args:[path.join(root, 'tests', file)], timeoutMs:60000});
  const steps = glass ? [ui('glass', '实验折射视觉', 'glass-smoke.cjs'),
    ui('glass-app', '实验折射主进程集成', 'glass-app-smoke.cjs')] : [
    {id:'unit', label:'基础测试', command:process.execPath,
      args:['--test', ...fs.readdirSync(path.join(root,'tests')).filter(file=>file.endsWith('.test.cjs')).sort().map(file=>path.join(root,'tests',file))], timeoutMs:30000},
    ui('ui', 'UI 功能与布局', 'renderer-smoke.cjs'),
    ui('settings', 'AI 设置与模型切换', 'settings-ui.cjs'),
    ui('input', 'Windows 原生输入', 'toolbar-input.cjs'),
    ui('responsive', '正常 GPU 响应性能', 'glass-responsive.cjs'),
  ];
  const notCovered = ['真实 OCR / 翻译服务与网络', '人工视觉与系统鼠标验收', '混合 DPI 双屏',
    glass ? '默认模式完整回归（另运行 npm run validate）' : '实验截图折射（另运行 npm run validate:glass）'];
  const directory = path.join(root,'.qa','validation',...(glass ? ['glass'] : []));
  const report = await runValidation(steps,directory,notCovered);
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}

if (require.main === module) main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports = {runValidation};
