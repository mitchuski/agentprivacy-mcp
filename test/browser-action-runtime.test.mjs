import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createBrowserActionRuntime} from '../lib/browser-action-runtime.mjs';
import {prepareBrowserAction} from '../lib/browser-action.mjs';
import {createBundle,packetProof} from '../lib/journey.mjs';
const time=Date.parse('2026-09-08T12:00:00Z'),now=()=>time;
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'browser-action-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const input={operationId:'test-operation-001',subject:'did:example:holder',audience:'https://agentprivacy.ai',page:'https://agentprivacy.ai/guide/walk',action:'spell.cast',target:'fixture',contentDigest:'sha256:'+'a'.repeat(64),expiresAt:new Date(time+120000).toISOString()};
 const proposal=prepareBrowserAction(input,{now:time}),bundle=createBundle({version:1}),context={subject:input.subject,origin:input.audience,page:input.page};
 const packet={v:1,shopHref:input.page,class:'fixture',witness:'fixture',ceremony:'fixture',timestamp:new Date(time).toISOString(),ceremonyTrace:[],payloadMode:'revealed',vertex:0,anchoredTo:input.contentDigest,districtRoot:input.contentDigest};packet.proof=packetProof(packet);
 const result={packet,receipt:{id:'fixture-receipt',operationId:input.operationId,intentDigest:proposal.intentDigest,packetProof:packet.proof,status:'applied'}};
 const verifyReceipt=async()=>({valid:true}); // Deliberately a fixture, not cryptographic verification.
 return {directory,input,proposal,bundle,context,result,verifyReceipt,now};
}
test('durable result survives reopening; retries neither execute nor duplicate evidence',async t=>{
 const f=fixture(t);let count=0;const adapter={authorize:async()=>true,execute:async()=>{count++;return f.result;}};
 const first=await createBrowserActionRuntime({...f,adapter})(f);assert.equal(first.status,'recorded');
 const retry=await createBrowserActionRuntime({...f,adapter})({...f,bundle:first.bundle});
 assert.equal(count,1);assert.equal(retry.replayed,true);assert.equal(retry.changed,false);
 await assert.rejects(createBrowserActionRuntime({...f,adapter})({...f,proposal:prepareBrowserAction({...f.input,target:'changed'},{now:time})}),/conflict/);
});
test('lost reply reconciles the same operation without another execute',async t=>{
 const f=fixture(t);let executions=0,reconciles=0;
 const adapter={authorize:async()=>true,execute:async()=>{executions++;throw Error('lost');},reconcile:async i=>{reconciles++;assert.equal(i.operationId,f.input.operationId);return f.result;}};
 assert.equal((await createBrowserActionRuntime({...f,adapter})(f)).status,'unconfirmed');
 assert.equal((await createBrowserActionRuntime({...f,adapter})(f)).status,'recorded');assert.equal(executions,1);assert.equal(reconciles,1);
});
test('competing runtimes cannot both dispatch; denied and wrong-context requests do nothing',async t=>{
 const f=fixture(t);let count=0;const adapter={authorize:async()=>true,execute:async()=>{count++;return f.result;}};
 const results=await Promise.all([createBrowserActionRuntime({...f,adapter})(f),createBrowserActionRuntime({...f,adapter})(f)]);
 assert.equal(count,1);assert.equal(results.filter(r=>r.status==='recorded').length,1);
 await assert.rejects(createBrowserActionRuntime({...f,adapter})({...f,context:{...f.context,origin:'https://other.invalid'}}),/context/);
 assert.equal((await createBrowserActionRuntime({...f,adapter:{...adapter,authorize:async()=>false}})(f)).status,'denied');assert.equal(count,1);
});
test('invalid artefact remains pending; absent reconciliation never retries execution',async t=>{
 const f=fixture(t);let count=0;const adapter={authorize:async()=>true,execute:async()=>{count++;return {...f.result,packet:{...f.result.packet,body:'tampered'}};}};
 const run=createBrowserActionRuntime({...f,adapter});assert.equal((await run(f)).status,'unconfirmed');assert.equal((await run(f)).status,'unconfirmed');assert.equal(count,1);
 const file=fs.readdirSync(f.directory).find(n=>n.endsWith('.json'));assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,file))).status,'pending');
});
test('retained crash locks and expiry during consent stop dispatch',async t=>{
 const f=fixture(t);let count=0;
 const adapter={authorize:async()=>true,execute:async()=>{count++;return f.result;}};
 const lock=path.join(f.directory,crypto.createHash('sha256').update(f.input.operationId).digest('hex')+'.json.lock');
 fs.writeFileSync(lock,'retained');
 assert.equal((await createBrowserActionRuntime({...f,adapter})(f)).status,'unconfirmed');assert.equal(count,0);assert.equal(fs.readFileSync(lock,'utf8'),'retained');fs.unlinkSync(lock);
 let current=time;const expires={...adapter,authorize:async()=>{current=time+180000;return true;}};
 await assert.rejects(createBrowserActionRuntime({...f,adapter:expires,now:()=>current})(f),/Expiry/);assert.equal(count,0);assert.deepEqual(fs.readdirSync(f.directory),[]);
});
