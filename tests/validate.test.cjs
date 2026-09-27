const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {runValidation} = require('../scripts/validate.cjs');

test('validator records failure, launch error and timeout, then continues to a passing step', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mwt-validator-'));
  const step=(id,code,timeoutMs=5000)=>({id,label:id,command:process.execPath,args:['-e',code],timeoutMs});
  try {
    const report=await runValidation([
      step('failure', 'console.error("controlled failure");process.exit(3)'),
      {id:'missing',label:'missing',command:path.join(directory,'missing-executable'),args:[],timeoutMs:5000},
      step('timeout','setInterval(()=>{},1000)',300),
      step('pass','console.log("finished")'),
    ],directory,['manual review'],()=>{});
    assert.equal(report.status,'FAIL');
    assert.deepEqual(report.results.map(result=>result.status),['FAIL','FAIL','TIMEOUT','PASS']);
    assert.equal(report.results[0].exitCode,3);
    assert.match(fs.readFileSync(report.results[0].log,'utf8'),/controlled failure/);
    assert.match(fs.readFileSync(report.results[3].log,'utf8'),/finished/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'latest.json'),'utf8')),report);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
