import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSiteContextTools } from '../lib/site-context.mjs';
import { elementOf } from '../lib/kappa.mjs';
import * as B from '../lib/bake.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(),'mages-site-test-'));
const first = {site:'guide',sub:'guide',slug:'shared-page',vertex:28,links:['neighbour'],postured:true};
first.element=elementOf(first.vertex,first.slug,first.links);
const second={...first,site:'atlas',sub:'atlas'};
const data={baked:'2026-09-08T00:00:00Z',sites:[{id:'guide',sub:'guide'},{id:'atlas',sub:'atlas'}],byKey:new Map([['guide/shared-page',first],['atlas/shared-page',second]]),bySlug:new Map([['shared-page',[first,second]]])};
for(const r of [first,second]) {fs.mkdirSync(path.join(root,r.sub));fs.writeFileSync(path.join(root,r.sub,r.slug+'.json'),JSON.stringify({title:r.site,story:[{type:'paragraph',text:'Original text'}]}));}
const bake={SITE:root,load:()=>data,publicUrl:r=>`https://guide.agentprivacy.ai/${r.sub}/${r.slug}.html`};
const [cap,ctx]=createSiteContextTools({bake});const url=bake.publicUrl(first);
test('capabilities match the actual catalog',()=>assert.equal(cap.run().sites.length,2));
test('exact URL selects the correct copy and binds snapshot',()=>{
 const r=ctx.run({url});assert.equal(r.catalog.site,'guide');assert.equal(r.copies.length,2);assert.equal(r.lattice.bits,'011100');assert.equal(r.page.vertex,28);assert.equal(r.livePage,'not-checked');assert.equal(r.keyChanged,false);
 assert.equal(ctx.run({url:bake.publicUrl(second)}).catalog.site,'atlas');assert.equal(ctx.run({url:url+'#section'}).page.revision,r.page.revision);
});
test('changed content changes revision even with identical slug and topology',()=>{
 const before=ctx.run({url});fs.writeFileSync(path.join(root,'guide','shared-page.json'),JSON.stringify({title:'guide',story:[{type:'paragraph',text:'Changed text'}]}));
 const after=ctx.run({url});assert.notEqual(after.page.revision,before.page.revision);assert.notEqual(after.evidenceDigest,before.evidenceDigest);assert.equal(after.catalog.element,before.catalog.element);
});
test('unregistered, deceptive and non-page URLs cannot resolve',()=>{
 for(const bad of ['https://guide.agentprivacy.ai.evil.example/guide/shared-page.html','https://evil.example/','http://guide.agentprivacy.ai/guide/shared-page.html',url+'?token=secret','https://user@guide.agentprivacy.ai/guide/shared-page.html','https://guide.agentprivacy.ai/guide/unknown.html'])assert.throws(()=>ctx.run({url:bad}));
});
test('corrupt catalog element, invalid vertex and missing snapshot fail closed',()=>{
 const original=first.element;first.element='sha256:'+'0'.repeat(64);assert.throws(()=>ctx.run({url}),/PSI/);first.element=original;
 first.vertex=64;assert.throws(()=>ctx.run({url}),/lattice/);first.vertex=28;
 fs.renameSync(path.join(root,'guide','shared-page.json'),path.join(root,'guide','saved.json'));assert.throws(()=>ctx.run({url}));fs.renameSync(path.join(root,'guide','saved.json'),path.join(root,'guide','shared-page.json'));
});
test('actual MCP stdio lists and executes the new tools',()=>{
 const realUrl=B.publicUrl([...B.load().byKey.values()][0]);
 const input=[{jsonrpc:'2.0',id:1,method:'tools/list'},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'site_capabilities',arguments:{}}},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'site_context',arguments:{url:realUrl}}}].map(JSON.stringify).join('\n')+'\n';
 const result=spawnSync(process.execPath,[new URL('../server.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1')],{input,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);const rows=result.stdout.trim().split('\n').map(JSON.parse);
 assert(rows[0].result.tools.some(t=>t.name==='site_context'));assert(rows[0].result.tools.some(t=>t.name==='journey_fold'));assert.equal(rows[1].result.isError,false);assert(rows[1].result.structuredContent.sites.length>0);
 assert.equal(rows[2].result.isError,false);assert.equal(rows[2].result.structuredContent.page.url,realUrl);assert.match(rows[2].result.structuredContent.page.revision,/^sha256:[a-f0-9]{64}$/);
});
