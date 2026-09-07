// test/swordsman.test.mjs — Rung 1: the Swordsman signs under policy, the Mage
// verifies in public, the process boundary holds. Runs against a throwaway
// keystore (AGENTPRIVACY_HOME in the OS temp dir); never touches ~/.agentprivacy.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evolve, defaultKey } from '../lib/key.mjs';
import { verifyRecord, evolvedSince, didKey, pubFromSeed } from '../lib/sign.mjs';
import { kappaOf } from '../lib/kappa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SW = path.join(HERE, '..', 'swordsman', 'swordsman.mjs');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-swordsman-'));
const env = { ...process.env, AGENTPRIVACY_HOME: HOME };
let fails = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };

// init from a known seed — the ceremony's privateKeyHex shape
const seed = 'a'.repeat(63) + '1';
const r0 = spawnSync(process.execPath, [SW, 'init', '--seed', seed], { env, encoding: 'utf8' });
ok(r0.status === 0 && /Swordsman identity imported/.test(r0.stdout), 'init --seed imports the bearer identity');
const id = JSON.parse(fs.readFileSync(path.join(HOME, 'swordsman', 'identity.json'), 'utf8'));
ok(id.publicKeyHex === pubFromSeed(seed) && id.participantId === 'ap-' + id.publicKeyHex.slice(0, 16), 'participantId is ap-<16 hex of the public key> (the AgentCard rule)');
ok(/^did:key:z6Mk/.test(id.did) && id.did === didKey(id.publicKeyHex), 'did:key derives from the public key (z6Mk…)');
const r1 = spawnSync(process.execPath, [SW, 'init', '--seed', seed], { env, encoding: 'utf8' });
ok(r1.status !== 0, 'a second init without --force is refused (the key is not silently replaced)');

// speak MCP to the Swordsman
const srv = spawn(process.execPath, [SW], { env, stdio: ['pipe', 'pipe', 'inherit'] });
let nextId = 1; const pending = new Map(); let buf = '';
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line); const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); } } });
const rpc = (method, params) => new Promise(res => { const id = nextId++; pending.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const call = async (name, a) => (await rpc('tools/call', { name, arguments: a })).result.structuredContent;

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  ok(init.result.serverInfo.name === 'agentprivacy-swordsman', 'the Swordsman is its own MCP server (separate process from the Mage)');
  const tools = (await rpc('tools/list')).result.tools.map(t => t.name);
  ok(tools.includes('key_sign') && tools.includes('vta_publish') && !tools.includes('guide_search'), `write tools only: ${tools.join(' ')}`);
  const pol = await call('policy_show', {});
  ok(pol.identity && !('seedHex' in pol.identity) && !JSON.stringify(pol).includes(seed), 'policy_show never returns the seed');

  // genesis: evolve the default key with a real walk, sign it
  const k1 = evolve(defaultKey('bearer'), ['the-private-knowledge-network', 'federation-map', 'welcome-visitors'], { name: 'first' }).key;
  const s1 = await call('key_sign', { key: k1 });
  ok(!s1.refused && s1.vta && s1.vta.kappa === k1.kappa, 'genesis evolution signed');
  const v1 = verifyRecord(s1.vta, k1);
  ok(v1.ok && v1.keyMatches, 'the Mage-side verifier accepts it against the key (L5)');
  ok(!verifyRecord({ ...s1.vta, kappa: 'sha256:' + '0'.repeat(64) }).ok, 'a tampered record fails');
  ok(!verifyRecord(s1.vta, { ...k1, name: 'someone else' }).ok, 'a tampered key fails against the record');

  // chain: evolve FROM the signed key → prior = head → signed
  const k2 = evolve(k1, ['contribute'], { name: 'second' }).key;
  const s2 = await call('key_sign', { key: k2 });
  ok(!s2.refused && s2.vta.prior === k1.kappa && s2.ledgerLength === 2, 'a chained evolution (prior = ledger head) is signed');
  // history rewrite: evolve from k1 again (prior = k1.κ, but head is k2.κ) → refused
  const k2b = evolve(k1, ['distribution-gates'], { name: 'rewrite' }).key;
  const s3 = await call('key_sign', { key: k2b });
  ok(s3.refused && /not the ledger head/.test(s3.refused), `history rewrite refused: ${s3.refused}`);
  // re-sign unchanged content → refused
  const s4 = await call('key_sign', { key: k2 });
  ok(s4.refused && /already signed/.test(s4.refused), 'unchanged content is not re-signed');
  // another bearer's key → refused
  const k3 = evolve({ ...k2, identity: { publicKeyHex: 'b'.repeat(64) } }, ['contribute'], { name: 'x' }).key;
  const s5 = await call('key_sign', { key: k3 });
  ok(s5.refused && /only its bearer/.test(s5.refused), 'a key naming another bearer is refused');
  // κ mismatch → refused
  const s6 = await call('key_sign', { key: { ...k2, kappa: 'sha256:' + 'f'.repeat(64) } });
  ok(s6.refused && /κ mismatch/.test(s6.refused), 'a key whose stamped κ lies is refused');

  // publish: the record a mages.city resident page carries
  const pub = await call('vta_publish', {});
  ok(pub.vta && verifyRecord(pub.vta).ok && pub.proofsPageItem?.type === 'code', 'vta_publish yields a verifying record + a proofs page item');
  ok(pub.withholds.includes('the walk') && !JSON.stringify(pub).includes('the-private-knowledge-network'), 'publication carries no walk content');
  const proofs = JSON.parse(pub.proofsPageItem.text);
  ok(proofs.v === 1 && Array.isArray(proofs.packets) && proofs.cityKey.kappa === k2.kappa && proofs.cityKey.did === id.did, 'proofs item matches the resident-page shape {v, packets, cityKey, swordsmansKey, drakeOrb}');

  // liveness: evolved_since(t)
  const live = evolvedSince(s2.vta, new Date(Date.now() - 60e3).toISOString(), { horizonDays: 30 });
  const stale = evolvedSince(s2.vta, new Date(Date.now() + 60e3).toISOString());
  ok(live.holds && !stale.holds && live.expires, 'evolved_since(t): holds for t in the past, fails for t in the future, carries a horizon');

  // rate limit
  fs.writeFileSync(path.join(HOME, 'swordsman', 'policy.json'), JSON.stringify({ ...pol.policy, maxSignaturesPerMinute: 2 }));
  const k4 = evolve(k2, ['federation-log'], { name: 'third' }).key;
  const s7 = await call('key_sign', { key: k4 });
  ok(s7.refused && /rate limit/.test(s7.refused), `rate limit enforced from the ledger: ${s7.refused}`);
} finally { srv.stdin.end(); fs.rmSync(HOME, { recursive: true, force: true }); }

console.log(fails ? `\n${fails} failing` : '\nthe Swordsman holds');
process.exit(fails ? 1 : 0);
