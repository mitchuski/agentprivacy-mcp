import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {projectHold,verifyHold} from '../lib/hold.mjs';
const fixture=()=>JSON.parse(fs.readFileSync(new URL('./fixtures/star-hold.fixture.json',import.meta.url),'utf8'));
function rpc(args){
 const message={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'hold_verify',arguments:args}};
 const p=spawnSync(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{input:JSON.stringify(message)+'\n',encoding:'utf8',timeout:10000,env:{...process.env,VTA_MODE:'1'}});
 assert.equal(p.status,0,p.stderr);const wire=JSON.parse(p.stdout.trim());
 return {wire:wire.result,value:wire.result.structuredContent};
}
test('projection recomputes cached state and measurements without mutating input',()=>{
 const {hold}=fixture();hold.items[0].verification.state='invalid';hold.items[0].signed.envelopeBytes=0;
 const before=JSON.stringify(hold),fresh=verifyHold(hold),view=projectHold(hold);
 assert.equal(view.items[0].verification.state,'valid');
 assert.deepEqual(view.items[0].signed,fresh.items[0].signed);
 assert.equal(JSON.stringify(hold),before);
});
test('unsupported profile never inherits cached valid in a projection',()=>{
 const {hold}=fixture();hold.items[0].profile='vc/ed25519-2020';hold.items[0].verification.state='valid';
 assert.equal(verifyHold(hold).ok,true);assert.equal(verifyHold(hold).allValid,false);
 assert.equal(projectHold(hold).items[0].verification.state,'unsupported');
});
test('projection rejects invalid structure and wrong key',()=>{
 const {hold,key}=fixture();const wrong=structuredClone(key);wrong.name='wrong-key';
 assert.throws(()=>projectHold(hold,{key:wrong}),/invalid Hold structure/);
 hold.items[0].envelope=Buffer.from('{}').toString('base64url');
 assert.throws(()=>projectHold(hold),/invalid Hold structure/);
});
test('diagnostic compatibility retains fresh items and optional fresh projection',()=>{
 const {hold,key}=fixture();hold.items[0].verification.state='invalid';
 const {value}=rpc({hold,key,project:true});assert.equal(value.ok,true);
 assert(value.items.some(x=>x.signer));assert.equal(value.projection.items[0].verification.state,'valid');
 assert.equal(rpc({hold,key}).value.projection,undefined);
});
test('projection response has exactly the recipient contract, no diagnostic wrapper',()=>{
 const {hold,key}=fixture();hold.items[0].profile='vc/ed25519-2020';
 const {value,wire}=rpc({hold,key,responseMode:'projection'});assert.equal(wire.isError,false);
 assert.equal(value.kind,'agentprivacy.star-hold-projection/1');
 assert.deepEqual(Object.keys(value).sort(),['kind','bearer','kappa','root','count','at','sig','items'].sort());
 for(const item of value.items)assert.deepEqual(Object.keys(item).sort(),['ref','profile','role','signed','verification'].sort());
 assert.equal(value.items[0].verification.state,'unsupported');
 assert(!JSON.stringify(value).includes('"signer"'));assert(!JSON.stringify(value).includes('"envelope"'));
 // Both MCP result carriers must contain the same reduced object.
 assert.deepEqual(JSON.parse(wire.content[0].text),value);
});
test('projection errors are bounded and invalid modes fail explicitly',()=>{
 const {hold}=fixture();hold.items[0].envelope=Buffer.from('{}').toString('base64url');
 const bad=rpc({hold,responseMode:'projection'});assert.equal(bad.wire.isError,true);
 assert.deepEqual(bad.value,{error:'invalid Hold structure; projection not returned'});
 assert.equal(rpc({hold:'{',responseMode:'projection'}).wire.isError,true);
 assert.equal(rpc({hold,responseMode:'typo'}).wire.isError,true);
});
