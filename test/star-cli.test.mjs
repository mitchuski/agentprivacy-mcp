// test/star-cli.test.mjs — the Star runtime's command line over a throwaway
// Swordsman: relate the bearer's own signed record, relate a counterpart's DTG
// VRC from the runtime fixture, refuse a tampered envelope, verify, show the
// projection. Never touches ~/.agentprivacy. Run: node --test test/star-cli.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evolve, defaultKey } from '../lib/key.mjs';
import { pubFromSeed } from '../lib/sign.mjs';
import { kappaOf } from '../lib/kappa.mjs';
import { itemBytes } from '../lib/hold.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SW = path.join(HERE, '..', 'swordsman', 'swordsman.mjs');
const STAR = path.join(HERE, '..', 'bin', 'star.mjs');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-star-'));
const env = { ...process.env, AGENTPRIVACY_HOME: HOME };
const run = (...args) => { const r = spawnSync(process.execPath, [STAR, ...args], { env, encoding: 'utf8' }); let json = null; try { json = JSON.parse(r.stdout); } catch { /* usage */ } return { status: r.status, json, stderr: r.stderr }; };
const seed = 'b'.repeat(63) + '2';
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'star-hold.fixture.json'), 'utf8'));

test('the Star relates its bearer\'s own record, then a counterpart\'s VRC; a tampered envelope is refused; the key carries holds{root,count}', () => {
  assert.equal(spawnSync(process.execPath, [SW, 'init', '--seed', seed], { env, encoding: 'utf8' }).status, 0);
  // the bearer's key, signed by the Swordsman → its VTA record is the first relationship (role self)
  const k0 = evolve(defaultKey('bearer'), ['the-private-knowledge-network', 'federation-map'], { name: 'first' }).key;
  const k1 = { ...k0, identity: { ...(k0.identity ?? {}), publicKeyHex: pubFromSeed(seed) } }; delete k1.kappa; k1.kappa = kappaOf(k1);
  const keyPath = path.join(HOME, 'key.json'); fs.writeFileSync(keyPath, JSON.stringify(k1));
  const sw = spawnSync(process.execPath, ['-e', `
    const { spawn } = require('node:child_process'); const fs = require('node:fs');
    const s = spawn(process.execPath, [${JSON.stringify(SW)}], { stdio: ['pipe','pipe','inherit'] }); let buf='';
    s.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const line = buf.slice(0,i); buf = buf.slice(i+1); if (!line.trim()) continue; const m = JSON.parse(line); if (m.id === 2) { process.stdout.write(JSON.stringify(m.result.structuredContent.vta)); s.kill(); } } });
    s.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{ name:'t', version:'0' } } })+'\\n');
    s.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'key_sign', arguments:{ key: JSON.parse(fs.readFileSync(${JSON.stringify(keyPath)},'utf8')) } } })+'\\n');
  `], { env, encoding: 'utf8' });
  const vta = JSON.parse(sw.stdout);
  const vtaPath = path.join(HOME, 'vta.json'); fs.writeFileSync(vtaPath, JSON.stringify(vta));
  const r1 = run('relate', vtaPath, '--key', keyPath, '--profile', 'agentprivacy.vta/1', '--role', 'self', '--write-key', path.join(HOME, 'key2.json'));
  assert.equal(r1.status, 0, r1.stderr + JSON.stringify(r1.json));
  assert.equal(r1.json.related.state, 'valid');
  assert.equal(r1.json.hold.count, 1);
  const k2 = JSON.parse(fs.readFileSync(path.join(HOME, 'key2.json'), 'utf8'));
  assert.deepEqual(Object.keys(k2.holds).sort(), ['count', 'root']);
  assert.equal(k2.prior, k1.kappa);
  assert.equal(r1.json.hold.kappa, k2.kappa);
  // a counterpart's DTG VRC (eddsa-jcs-2022 under a pairwise did:key) from the runtime fixture
  const vrcItem = fixture.hold.items.find((i) => i.profile === 'vc/eddsa-jcs-2022');
  const vrcPath = path.join(HOME, 'vrc.json'); fs.writeFileSync(vrcPath, itemBytes(vrcItem));
  const r2 = run('relate', vrcPath, '--key', path.join(HOME, 'key2.json'), '--profile', 'vc/eddsa-jcs-2022', '--role', 'counterpart', '--write-key', path.join(HOME, 'key3.json'));
  assert.equal(r2.status, 0, JSON.stringify(r2.json));
  assert.equal(r2.json.related.state, 'valid');
  assert.equal(r2.json.hold.count, 2);
  assert.match(r2.json.related.signer, /^did:key:z6Mk/);
  // the same envelope twice is refused; a tampered one never enters
  assert.equal(run('relate', vrcPath, '--key', path.join(HOME, 'key3.json'), '--profile', 'vc/eddsa-jcs-2022').status, 1);
  const doc = JSON.parse(itemBytes(vrcItem).toString('utf8')); doc.credentialSubject.relationship = 'vouched-harder';
  const badPath = path.join(HOME, 'bad.json'); fs.writeFileSync(badPath, JSON.stringify(doc));
  const r3 = run('relate', badPath, '--key', path.join(HOME, 'key3.json'), '--profile', 'vc/eddsa-jcs-2022');
  assert.equal(r3.status, 1); assert.match(r3.json.refused, /does not verify/);
  // a self item must be the bearer's own signature
  const r4 = run('relate', vrcPath, '--key', path.join(HOME, 'key3.json'), '--profile', 'vc/eddsa-jcs-2022', '--role', 'self');
  assert.equal(r4.status, 1); assert.match(r4.json.refused, /self item|already held/);
});

test('hold verify re-verifies everything against the key; hold show is the projection; present says what is missing', () => {
  const v = run('hold', 'verify', '--key', path.join(HOME, 'key3.json'));
  assert.equal(v.status, 0, JSON.stringify(v.json));
  assert.equal(v.json.allValid, true); assert.equal(v.json.keyMatches, true); assert.equal(v.json.items.length, 2);
  const s = run('hold', 'show');
  assert.equal(s.status, 0); assert.equal(s.json.count, 2);
  assert.equal(JSON.stringify(s.json).includes('"envelope"'), false);
  const full = run('hold', 'show', '--full');
  assert.equal(typeof full.json.hold.items[0].envelope, 'string');
  const p = run('present');
  assert.equal(p.status, 2); assert.equal(p.json.available, false); assert.match(p.json.why, /Rungs 3 and 5/);
  const prof = run('profiles');
  assert.equal(prof.status, 0); assert.equal(Object.keys(prof.json.profiles).length, 7);
});
