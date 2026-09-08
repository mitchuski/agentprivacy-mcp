import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cityInvitationDraft,experienceRoute} from '../lib/city-entry.mjs';
test('draft cannot silently publish or preserve extra private fields',()=>{
 const args={summary:'A home for a source-linked contribution.',privateKey:'secret',publish:true};
 const a=cityInvitationDraft(args);assert.equal(a.eventDraft.publish,false);assert.equal(a.sent,false);assert.ok(!JSON.stringify(a).includes('secret'));assert.deepEqual(a,cityInvitationDraft(args));
 for(const input of [{summary:''},{summary:'x'.repeat(501)},{summary:'a\nb'},{summary:'ok',action:'terms-acceptance'},{summary:'ok',target:'unbound'}])assert.throws(()=>cityInvitationDraft(input));
});
test('routes disclose no authority and have no caller-controlled destination',()=>{
 for(const intent of ['arrive','learn','carry','cast','collaborate']){const r=experienceRoute({intent,url:'https://evil.invalid'});assert.equal(r.liveCapabilitiesVerified,false);assert.ok(r.tools.length);assert.ok(!r.url.includes('evil'));}
 assert.throws(()=>experienceRoute({intent:'__proto__'}));
});
test('both entry tools are callable over real MCP stdio',()=>{
 const requests=[['city_invitation_draft',{summary:'I bring a question and a permitted artefact.'}],['experience_route',{intent:'arrive'}]].map(([name,args],id)=>JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}}));
 const child=spawnSync(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),input:requests.join('\n')+'\n',encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 const out=child.stdout.trim().split('\n').map(x=>JSON.parse(x).result);assert.equal(out.length,2);assert.ok(out.every(x=>x.isError===false));assert.equal(out[0].structuredContent.eventDraft.publish,false);
});

test('overview names only tools the server actually advertises',()=>{
 const messages=[{jsonrpc:'2.0',id:1,method:'tools/list'},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'experience_overview',arguments:{}}}];
 const child=spawnSync(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),input:messages.map(x=>JSON.stringify(x)).join('\n')+'\n',encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);
 const out=child.stdout.trim().split('\n').map(x=>JSON.parse(x).result),names=new Set(out[0].tools.map(x=>x.name));
 assert.equal(out[1].isError,false);const overview=out[1].structuredContent;
 for(const capability of overview.capabilities)for(const name of capability.tools)assert.ok(names.has(name),name);
 assert.equal(overview.capabilities.find(x=>x.id==='agreements-vrc-tasks').status,'pending-live-adapters');
});
