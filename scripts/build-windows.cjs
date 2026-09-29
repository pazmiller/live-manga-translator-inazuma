const {spawnSync} = require('node:child_process');
const path = require('node:path');
const root=path.resolve(__dirname,'..');
function run(command,args) {
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.error) throw result.error;
  if(result.status!==0) process.exit(result.status || 1);
}
if(process.platform!=='win32') throw new Error('Build on Windows x64.');
// Resolve every supported language model at build time, not on the user's
// first launch (the installed backend may live in a read-only directory).
run(path.join(root,'backend','.venv','Scripts','python.exe'),['-c',
  "import sys; sys.path.insert(0, 'backend'); import ocr; [ocr.warmup(lang) for lang in ('ja','en','zh','ko')]"]);
run(path.join(root,'backend','.venv','Scripts','python.exe'),['-m','PyInstaller',
  '--noconfirm','--onedir','--name','inazuma-backend','--distpath','.build/backend',
  '--workpath','.build/work','--specpath','.build','--collect-all','rapidocr',
  '--collect-all','onnxruntime','--collect-submodules','uvicorn','--collect-data','certifi',
  '--add-data','backend/provider-catalog.json;.',
  'backend/server.py']);
run(process.execPath,[require.resolve('electron-builder/cli.js'),'--win','--x64','--publish','never']);
