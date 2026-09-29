const {spawnSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root=path.resolve(__dirname,'..');
const manga=process.argv.includes('--manga');
function run(command,args) {
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.error) throw result.error;
  if(result.status!==0) process.exit(result.status || 1);
}
if(process.platform!=='win32') throw new Error('Build on Windows x64.');
if(manga) run(path.join(root,'.manga-ocr-venv','Scripts','python.exe'),[path.join(root,'scripts','build-manga.py')]);
// Resolve every supported language model at build time, not on the user's
// first launch (the installed backend may live in a read-only directory).
run(path.join(root,'backend','.venv','Scripts','python.exe'),['-c',
  "import sys; sys.path.insert(0, 'backend'); import ocr; [ocr.warmup(lang) for lang in ('ja','en','zh','ko')]"]);
run(path.join(root,'backend','.venv','Scripts','python.exe'),['-m','PyInstaller',
  '--noconfirm','--onedir','--name','inazuma-backend','--distpath','.build/backend',
  '--workpath','.build/work','--specpath','.build','--collect-all','rapidocr',
  '--collect-all','onnxruntime','--collect-submodules','uvicorn','--collect-data','certifi',
  '--add-data',`${path.join(root,'backend','provider-catalog.json')};.`,
  'backend/server.py']);
const builderArgs=[require.resolve('electron-builder/cli.js'),'--win','--x64','--publish','never'];
if(manga) {
  const config=JSON.parse(fs.readFileSync(path.join(root,'electron-builder.json'),'utf8'));
  config.appId+='.mangaocr';
  config.productName='Inazuma MangaOCR';
  config.directories.output='dist/mangaocr';
  config.extraResources.push({from:'.build/manga-runtime/inazuma-manga-ocr',to:'manga-ocr'});
  config.nsis.artifactName='Inazuma-MangaOCR-Setup-${version}-${arch}.exe';
  const configFile=path.join(root,'.build','electron-builder-manga.json');
  fs.writeFileSync(configFile,JSON.stringify(config,null,2));
  builderArgs.push('--config',configFile);
}
run(process.execPath,builderArgs);
