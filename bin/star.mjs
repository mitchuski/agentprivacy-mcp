#!/usr/bin/env node
// bin/star.mjs — the Star runtime's command line. The Star is not a wallet: it
// aggregates many keys (the bearer's Swordsman's Key / City Key / Mage's Key,
// the pairwise identifiers, the counterparts' keys behind the records it holds)
// and every item in its Hold is a signed relationship. So the first verb is
// `relate`. Nothing here touches a browser; the extension and the web readers
// are surfaces over this runtime.
//
//   star relate <envelope.json|-> --key <key.json> --profile <p> [--role self|counterpart|issuer|witness]
//        verify a signed envelope and relate it into the bearer's Hold (the
//        Swordsman holds the seed; this process never sees it); prints the key
//        that now carries holds{root,count} under a new κ — sign it with key_sign
//   star hold show [--full]      the projection (refs, states, bytes); --full = the retained envelopes
//   star hold project [--key <key.json>]  explicit projection-only stdout; linkable, not permission
//   star hold verify             re-verify every item, the root and the bearer signature
//   star present                 NOT AVAILABLE — says exactly what is missing (Rung 3/5 salts, a community root)
//   star profiles                the item profiles this runtime verifies or declares
//
// Speaks MCP over stdio to swordsman/swordsman.mjs (AGENTPRIVACY_HOME respected).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyHold, PROFILES } from '../lib/hold.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SW = path.join(HERE, '..', 'swordsman', 'swordsman.mjs');
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name) => argv.includes(name);
const out = (o, code = 0) => { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); process.exit(code); };
const usage = () => { process.stderr.write(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 19).map((l) => l.slice(3)).join('\n') + '\n'); process.exit(2); };

async function swordsman(calls) {
  const srv = spawn(process.execPath, [SW], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1; const pending = new Map(); let buf = '';
  const rejectPending = () => { for (const p of pending.values()) p.reject(new Error('Swordsman unavailable or invalid response')); pending.clear(); };
  srv.on('error', rejectPending); srv.on('close', rejectPending);
  srv.stdin.on('error', rejectPending);
  srv.stderr.resume(); // errors are reported through a bounded local contract, not forwarded diagnostics
  srv.stdout.on('data', (d) => {
    buf += d;
    if (buf.length > 8 * 1024 * 1024) { rejectPending(); srv.kill(); return; }
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { rejectPending(); srv.kill(); return; }
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); m.error || (m.result?.isError && !m.result?.structuredContent) ? p.reject(new Error('Swordsman request failed')) : p.resolve(m); }
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject });
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const deadline = setTimeout(() => { rejectPending(); srv.kill(); }, 10000);
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'star', version: '0.1' } });
    const results = [];
    for (const [name, args] of calls) results.push((await rpc('tools/call', { name, arguments: args })).result.structuredContent);
    return results;
  } finally { clearTimeout(deadline); srv.kill(); }
}

const [verb, sub] = argv;
if (!verb || has('--help')) usage();

if (verb === 'profiles') out({ profiles: PROFILES, note: 'di = eddsa-jcs-2022 Data Integrity (OpenVTC); vta = agentprivacy.vta/1; vrc = Rung 5 bilateral; declared = carried, marked unsupported, never called valid' });

if (verb === 'relate') {
  const file = sub, key = flag('--key'), profile = flag('--profile'), role = flag('--role') ?? 'counterpart';
  if (!file || !key || !profile) usage();
  const envelope = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  const keyJSON = JSON.parse(fs.readFileSync(key, 'utf8'));
  const [r] = await swordsman([['hold_relate', { key: keyJSON, envelope, profile, role, subject: flag('--subject'), issued: flag('--issued'), expires: flag('--expires') }]]);
  if (r.refused) out({ refused: r.refused }, 1);
  if (flag('--write-key')) fs.writeFileSync(flag('--write-key'), JSON.stringify(r.key, null, 2) + '\n');
  out({ related: r.item, hold: { root: r.hold.root, count: r.hold.count, kappa: r.hold.kappa }, key: flag('--write-key') ? { wrote: flag('--write-key'), kappa: r.key.kappa, prior: r.key.prior ?? null, holds: r.key.holds } : r.key, next: r.note });
}

if (verb === 'hold') {
  if (sub === 'project') {
    if (has('--full')) out({ error: 'hold project cannot include --full; use hold show --full for local diagnostics' }, 1);
    let retained;
    try { [retained] = await swordsman([['hold_show', { full: true }]]); }
    catch { out({ error: 'retained Hold unavailable' }, 1); }
    if (!retained?.hold) out({ error: 'no readable Hold available for projection' }, 1);
    let key;
    if (has('--key')) {
      try { key = JSON.parse(fs.readFileSync(flag('--key'), 'utf8')); }
      catch { out({ error: 'key must be a readable JSON file' }, 1); }
    }
    // Full input stays between local processes; stdout is the explicitly selected recipient view.
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'hold_verify', arguments: { hold: retained.hold, key, responseMode: 'projection' } } };
    const reply = spawnSync(process.execPath, [path.join(HERE, '..', 'server.mjs')], {
      input: JSON.stringify(request) + '\n', encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    });
    if (reply.status !== 0) out({ error: 'projection verifier unavailable' }, 1);
    let result;
    try { result = JSON.parse(reply.stdout.trim()).result; }
    catch { out({ error: 'invalid projection verifier response' }, 1); }
    if (result?.isError || result?.structuredContent?.kind !== 'agentprivacy.star-hold-projection/1') {
      out({ error: 'Hold could not be projected under the supplied checks' }, 1);
    }
    out(result.structuredContent);
  }
  if (sub === 'show') { const [r] = await swordsman([['hold_show', { full: has('--full') }]]); out(r); }
  if (sub === 'verify') {
    const [r] = await swordsman([['hold_show', { full: true }]]);
    if (!r.hold) out(r, 1);
    const key = flag('--key') ? JSON.parse(fs.readFileSync(flag('--key'), 'utf8')) : null;
    const v = verifyHold(r.hold, { key });
    out({ ok: v.ok, allValid: v.allValid, bearerSig: v.bearerSig, root: v.root, keyChecked: v.keyChecked, keyMatches: v.keyMatches, budget: v.budget, items: v.items.map((i) => ({ ref: i.ref, profile: i.profile, role: i.role, state: i.state, reason: i.reason, signed: i.signed })), why: v.why }, v.ok ? 0 : 1);
  }
  usage();
}

if (verb === 'present') {
  out({ available: false,
    why: 'a presentation needs what Rungs 3 and 5 have not minted yet: the bearer\'s member salt in a community, the pairwise R-DID salts per counterpart, the counterparts\' issuer linkages, and the community\'s published set root. The relations are built and tested (dtgwg-zkp-tf-mage/runtimes/star-hold/src/present.mjs, k-of-n community vouches); the proof system is not (spec case X3, unmeasured).',
    rule: 'the same rule as the extension\'s disabled "Create ZK proof" button: no proof control until a verifier exists (VERTEX_PATHWAYS §three distinct operations)' }, 2);
}

usage();
