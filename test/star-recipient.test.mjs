import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=()=>JSON.parse(fs.readFileSync(path.join(root,'test/fixtures/star-hold.fixture.json'),'utf8'));
function setup(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ap-recipient-'));
 const init=spawnSync(process.execPath,[path.join(root,'swordsman/swordsman.mjs'),'init','--seed','11'.repeat(32)],{env:{...process.env,AGENTPRIVACY_HOME:dir},encoding:'utf8'});
 assert.equal(init.status,0,init.stderr);const f=fixture();
 const save=h=>fs.writeFileSync(path.join(dir,'swordsman/hold.json'),JSON.stringify(h));
 save(f.hold);const key=path.join(dir,'key.json');fs.writeFileSync(key,JSON.stringify(f.key));
 const run=(...args)=>{
   const p=spawnSync(process.execPath,[path.join(root,'bin/star.mjs'),...args],{env:{...process.env,AGENTPRIVACY_HOME:dir},encoding:'utf8',timeout:10000});
   let value;try{value=JSON.parse(p.stdout);}catch{}
   return {status:p.status,stdout:p.stdout,value,stderr:p.stderr};
 };return {f,save,key,run};
}
test('recipient command emits only the projection and leaves retained data unchanged',()=>{
 const {run,key,f}=setup();const v=run('hold','project','--key',key);
 assert.equal(v.status,0,v.stderr);assert.equal(v.value.kind,'agentprivacy.star-hold-projection/1');
 assert.deepEqual(Object.keys(v.value).sort(),['kind','bearer','kappa','root','count','at','sig','items'].sort());
 assert(!v.stdout.includes('"envelope"'));assert(!v.stdout.includes('"signer"'));
 assert.deepEqual(run('hold','show','--full').value.hold,f.hold);
});
test('recipient receives fresh unsupported rather than cached valid',()=>{
 const {run,f,save}=setup();f.hold.items[0].profile='vc/ed25519-2020';f.hold.items[0].verification.state='valid';save(f.hold);
 const v=run('hold','project');assert.equal(v.status,0,v.stderr);
 assert.equal(v.value.items[0].verification.state,'unsupported');
});
test('tamper refusal and correction are explicit without returning retained bytes',()=>{
 const {run,f,save,key}=setup();const bad=structuredClone(f.hold);bad.items[0].envelope=Buffer.from('{}').toString('base64url');save(bad);
 const v=run('hold','project','--key',key);assert.equal(v.status,1);assert(v.value.error);assert(!v.stdout.includes('"envelope"'));
 save(f.hold);const corrected=run('hold','project','--key',key);assert.equal(corrected.status,0);assert.equal(corrected.value.count,7);
 const retry=run('hold','project','--key',key);assert.deepEqual(retry.value,corrected.value);
});
test('wrong key, conflicting full flag and empty store fail explicitly',()=>{
 const {run,key,f}=setup();f.key.name='different';fs.writeFileSync(key,JSON.stringify(f.key));
 assert.equal(run('hold','project','--key',key).status,1);
 const conflict=run('hold','project','--full');assert.equal(conflict.status,1);assert(conflict.value.error);
 const empty=fs.mkdtempSync(path.join(os.tmpdir(),'ap-recipient-empty-'));
 const p=spawnSync(process.execPath,[path.join(root,'bin/star.mjs'),'hold','project'],{env:{...process.env,AGENTPRIVACY_HOME:empty},encoding:'utf8',timeout:10000});
 assert.equal(p.status,1);assert(JSON.parse(p.stdout).error);
});
test('a reduced later response does not remove an earlier full disclosure',()=>{
 const {run}=setup();const earlier=run('hold','show','--full');const later=run('hold','project');
 assert.equal(later.status,0,later.stderr);assert(!later.stdout.includes('"envelope"'));
 const recipientHistory=[earlier.value,later.value];assert(recipientHistory[0].hold.items[0].envelope);
});
