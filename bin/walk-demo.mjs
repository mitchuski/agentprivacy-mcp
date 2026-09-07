#!/usr/bin/env node
// bin/walk-demo.mjs — the scripted agent. Phase 3's "done when", minus the
// signature (a write tool): search the guide, walk five pages, evolve a key,
// render a sigil, re-derive κ from the sigil — zero human clicks, zero data
// leaving the machine. Speaks real MCP to server.mjs over stdio, so what it
// proves is what any MCP client gets.
//
//   node bin/walk-demo.mjs ["query"] [--out=dir]
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const query = args.find(a => !a.startsWith('--')) || 'private knowledge network federation';
const outDir = (args.find(a => a.startsWith('--out=')) || '').slice(6) || path.join(os.tmpdir(), 'agentprivacy-mcp-demo');
fs.mkdirSync(outDir, { recursive: true });

const srv = spawn(process.execPath, [path.join(HERE, '..', 'server.mjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
let nextId = 1; const pending = new Map(); let buf = '';
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
  const m = JSON.parse(line); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } });
const rpc = (method, params) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const notify = (method, params) => srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
const call = async (name, a) => { const r = await rpc('tools/call', { name, arguments: a }); if (r.isError) throw new Error(name + ': ' + r.content[0].text); return r.structuredContent; };
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) process.exitCode = 1; };

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'walk-demo', version: '0' } });
  notify('notifications/initialized');
  console.log(`agentprivacy-mcp ${init.serverInfo.version} · protocol ${init.protocolVersion}`);
  const { tools } = await rpc('tools/list');
  console.log(`tools: ${tools.map(t => t.name).join(' · ')}\n`);

  // 1 · search → an ordered walk
  const s = await call('guide_search', { query, limit: 9 });
  console.log(`guide_search("${query}") → ${s.steps.length} steps of ${s.matched} matched`);
  const steps = s.steps.slice(0, 5);
  // an agent walks: when the search gives fewer than five, it follows links from
  // the last star — every neighbour is a named lattice move away
  while (steps.length < 5) {
    const last = steps[steps.length - 1];
    const nb = await call('guide_neighbours', { slug: last.slug, site: last.site });
    const next = nb.neighbours.find(n => n.resolved && !steps.some(x => x.slug === n.slug));
    if (!next) break;
    steps.push({ site: next.site, slug: next.slug, vertex: next.vertex, posture: next.posture, via: 'neighbour · ' + next.move });
  }
  for (const st of steps) console.log(`   ${st.site}/${st.slug}  V${st.vertex} ${st.posture || '(strand)'}  ${st.via}`);
  ok(steps.length === 5, 'five pages to walk');

  // 2 · read one, follow its neighbours — every link is a named move
  const pg = await call('guide_page', { slug: steps[0].slug, site: steps[0].site });
  console.log(`\nguide_page(${pg.slug}) → V${pg.vertex} ${pg.posture || ''} ${pg.dims.join('+')} · ${pg.items} items · ${pg.weave.length} links`);
  const nb = await call('guide_neighbours', { slug: steps[0].slug, site: steps[0].site });
  for (const n of nb.neighbours.slice(0, 6)) console.log(`   ${n.dir === 'out' ? '→' : '←'} ${n.slug.padEnd(40)} V${String(n.vertex ?? '?').padEnd(2)} ${n.move}`);
  ok(nb.neighbours.every(n => typeof n.move === 'string'), 'every neighbour carries a named lattice move');

  // Phase 0 done-when: two pages on the same site at different vertices, walk = named move
  const guide = (await call('guide_search', { query: 'guide', limit: 12, sites: ['guide'] })).steps;
  const verts = new Set(guide.map(g => g.vertex));
  ok(verts.size >= 2, `guide pages sit at ${verts.size} distinct vertices (site strand alone would give 1)`);
  const mv = await call('lattice_move', { vertex: steps[0].vertex, op: 'to ' + steps[1].vertex });
  ok(typeof mv.move === 'string', `V${steps[0].vertex} → V${steps[1].vertex} is a named move: ${mv.move}`);

  // 3 · evolve the default key with the walk (pure, deterministic)
  const ev = await call('key_evolve', { walk: steps.map(x => ({ site: x.site, slug: x.slug })), name: 'demo walk' });
  console.log(`\nkey_evolve → κ ${ev.kappa.slice(0, 23)}… · prior ${ev.prior.slice(0, 23)}… · moves ${ev.walk.moves.join(' , ')}`);
  const ev2 = await call('key_evolve', { walk: steps.map(x => ({ site: x.site, slug: x.slug })), name: 'demo walk' });
  ok(ev.kappa === ev2.kappa, 'the same walk evolves to the same κ (deterministic)');
  ok(ev.walk.steps.every(st => /^sha256:/.test(st.element)), 'every step carries its PSI element (never a bare vertex)');

  // 4 · render the sigil (carries the key) and re-derive κ from the PNG
  const out = path.join(outDir, 'demo-sigil.png');
  const sg = await call('sigil_render', { key: ev.key, out });
  console.log(`sigil_render → ${sg.bytes} bytes · ${sg.wrote}`);
  const back = await call('key_derive', { key: out });
  ok(back.carrier === 'png' && back.kappa === 'verified' && back.derived === ev.kappa, 'κ re-derived from the sigil PNG matches (Law L5)');
  ok(back.walked.length > 0 && back.walks === 1, `the carried key holds the walk (${back.walked.length} walked vertices)`);
  fs.writeFileSync(path.join(outDir, 'demo-key.json'), JSON.stringify(ev.key, null, 1));
  console.log(`\nwrote ${out} and demo-key.json — import the PNG on soulbis.com/sigil to see it unfold.`);

  // 5 · --sign: hand the evolved key to a SEPARATE Swordsman process (throwaway
  // keystore), get the signed VTA record back, verify it on the Mage side, and
  // seal it into the sigil. This is the full Phase 3 done-when.
  if (args.includes('--sign')) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-demo-swordsman-'));
    const senv = { ...process.env, AGENTPRIVACY_HOME: home };
    const SW = path.join(HERE, '..', 'swordsman', 'swordsman.mjs');
    const { spawnSync } = await import('node:child_process');
    spawnSync(process.execPath, [SW, 'init'], { env: senv, stdio: 'ignore' });
    const sw = spawn(process.execPath, [SW], { env: senv, stdio: ['pipe', 'pipe', 'inherit'] });
    let sbuf = ''; const spend = new Map(); let sid = 1;
    sw.stdout.on('data', d => { sbuf += d; let i; while ((i = sbuf.indexOf('\n')) >= 0) { const line = sbuf.slice(0, i); sbuf = sbuf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line); const p = spend.get(m.id); if (p) { spend.delete(m.id); p(m); } } });
    const srpc = (method, params) => new Promise(res => { const id = sid++; spend.set(id, res); sw.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
    try {
      await srpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'walk-demo', version: '0' } });
      const signed = (await srpc('tools/call', { name: 'key_sign', arguments: { key: ev.key } })).result.structuredContent;
      ok(!signed.refused && signed.vta, `the Swordsman signed the evolution (${signed.vta ? signed.vta.participantId : signed.refused})`);
      const ver = await call('key_verify', { vta: signed.vta, key: ev.key, since: new Date(Date.now() - 60e3).toISOString(), horizonDays: 30 });
      ok(ver.ok && ver.keyMatches && ver.liveness.holds, `the Mage verified it in public · evolved_since holds · ${ver.did}`);
      const sealed = (await srpc('tools/call', { name: 'sigil_seal', arguments: { png: out, vta: signed.vta, out: path.join(outDir, 'demo-sigil-signed.png') } })).result.structuredContent;
      const back = await call('key_verify', { vta: sealed.wrote });
      ok(back.ok && back.kappa === ev.kappa, 'the sealed sigil PNG carries key + signature; both re-derive');
      const pub = (await srpc('tools/call', { name: 'vta_publish', arguments: {} })).result.structuredContent;
      ok(pub.vta && pub.proofsPageItem, `vta_publish → a proofs page item for <name>.mages.city (publishes ${pub.publishes.length} things, withholds ${pub.withholds.join(' · ')})`);
      fs.writeFileSync(path.join(outDir, 'demo-proofs-item.json'), pub.proofsPageItem.text);
    } finally { sw.stdin.end(); fs.rmSync(home, { recursive: true, force: true }); }
  }
} catch (e) { console.error('✗ ' + e.message); process.exitCode = 1; }
finally { srv.stdin.end(); }
