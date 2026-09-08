import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {prepareBrowserAction,verifyBrowserResult} from '../lib/browser-action.mjs';
import {createBundle,foldJourney,packetProof} from '../lib/journey.mjs';
const now=Date.parse('2026-09-08T12:00:00Z');
const input={operationId:'fixture-operation-001',subject:'did:example:holder',audience:'https://agentprivacy.ai',page:'https://agentprivacy.ai/guide/walk',action:'spell.cast',target:'fixture-spell',contentDigest:'sha256:'+'a'.repeat(64),expiresAt:'2026-09-08T12:03:00Z'};
test('proposal is deterministic, bound to intent, and never grants authority',()=>{
 const a=prepareBrowserAction(input,{now});assert.deepEqual(a,prepareBrowserAction(input,{now}));assert.equal(a.authorized,false);assert.equal(a.dispatched,false);
 assert.notEqual(a.intentDigest,prepareBrowserAction({...input,target:'other'},{now}).intentDigest);
 for(const change of [{page:'https://evil.invalid/'},{audience:'https://agentprivacy.ai.evil.invalid'},{page:input.page+'?token=secret'},{target:'<script>'},{expiresAt:'2026-09-08T12:06:00Z'},{expiresAt:'2026-09-08T12:00:00Z'},{action:'credential.issue'}])assert.throws(()=>prepareBrowserAction({...input,...change},{now}));
});
test('host receipt seam refuses missing verifier, mismatched operation and changed evidence',async()=>{
 const proposal=prepareBrowserAction(input,{now}),packet={proof:'fixture-proof'};
 const receipt={id:'fixture-receipt',intentDigest:proposal.intentDigest,operationId:input.operationId,status:'applied',packetProof:packet.proof};
 await assert.rejects(verifyBrowserResult({proposal,receipt,packet,now}),/not connected/);
 for(const bad of [{...receipt,operationId:'other'},{...receipt,packetProof:'other'}])await assert.rejects(verifyBrowserResult({proposal,receipt:bad,packet,now,verifyReceipt:async()=>({valid:true})}));
 await assert.rejects(verifyBrowserResult({proposal,receipt,packet,now,verifyReceipt:async()=>({valid:false})}),/failed/);
});
test('fixture-approved result folds one original artefact and retries add nothing',async()=>{
 const proposal=prepareBrowserAction(input,{now});
 const packet={v:1,shopHref:input.page,class:'fixture',witness:'fixture',ceremony:'fixture',timestamp:new Date(now).toISOString(),ceremonyTrace:[],payloadMode:'revealed',vertex:0,anchoredTo:input.contentDigest,districtRoot:input.contentDigest};packet.proof=packetProof(packet);
 const receipt={id:'fixture-receipt',intentDigest:proposal.intentDigest,operationId:input.operationId,status:'applied',packetProof:packet.proof};
 const approved=await verifyBrowserResult({proposal,receipt,packet,now,verifyReceipt:async()=>({valid:true})}); // Scheduling fixture, not live crypto.
 const first=foldJourney(createBundle({version:1}),{packet:approved.packet});
 const retry=foldJourney(first.bundle,{packet:approved.packet});assert.equal(retry.changed,false);assert.equal(retry.bundle.packets.length,1);
});
test('actual MCP stdio exposes proposal tool without claiming dispatch',()=>{
 const args={...input,expiresAt:new Date(Date.now()+120000).toISOString()};
 const call={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'browser_action_prepare',arguments:args}};
 const child=spawnSync(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),input:JSON.stringify(call)+'\n',encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout).result;assert.equal(result.isError,false);assert.equal(result.structuredContent.dispatched,false);
});
