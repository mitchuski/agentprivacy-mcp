// test/hold.test.mjs — the Star Hold in the Mage's lane: the runtime fixture
// verifies to the same root and states here (parity), a Hold built here from a
// real evolved key + Swordsman-shaped record round-trips, and the OpenVTC DI
// suite verifies through the same path. Run: node --test test/hold.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeItem, holdFor, buildHold, verifyHold, projectHold, holdsSlot, signDI, verifyDI, verifyEnvelope, itemBytes, didKeyPub, vmOf, PROFILES } from '../lib/hold.mjs';
import { evolve, defaultKey } from '../lib/key.mjs';
import { pubFromSeed, didKey, sign, recordBytes, VTA_KIND } from '../lib/sign.mjs';
import { kappaOf, merkleRoot } from '../lib/kappa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'star-hold.fixture.json');
const seed = (n) => n.toString(16).padStart(2, '0').repeat(32);
const NOW = new Date('2026-09-11T12:00:00.000Z');

test('parity: the runtime fixture verifies to the same root, count, κ and per-item states', () => {
  const f = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.equal(f.schema, 'star-hold-fixture/1');
  const v = verifyHold(f.hold, { key: f.key, now: NOW });
  assert.equal(v.ok, true, v.why.join('; '));
  assert.equal(v.root.derived, f.expected.root);
  assert.equal(f.hold.count, f.expected.count);
  assert.equal(kappaOf(f.key), f.expected.kappa);
  assert.equal(v.keyMatches, true);
  assert.deepEqual(v.items.map((i) => ({ ref: i.ref, profile: i.profile, state: i.state })), f.expected.states);
  assert.equal(v.items.filter((i) => i.state === 'valid').length, 7);
  assert.equal(v.allValid, true);
  assert.deepEqual([...new Set(v.items.map((i) => i.profile))].sort(), ['agentprivacy.vrc/1', 'agentprivacy.vta/1', 'trust-task/eddsa-jcs-2022', 'vc/eddsa-jcs-2022']);
});

test('a Hold built from an evolved City Key and a Swordsman-shaped record round-trips; the key carries only holds{root,count}', () => {
  const s = seed(7);
  const k0 = evolve(defaultKey('bearer'), ['the-private-knowledge-network', 'federation-map', 'welcome-visitors'], { name: 'first' }).key;
  const k1 = { ...k0, identity: { ...(k0.identity ?? {}), publicKeyHex: pubFromSeed(s) } }; delete k1.kappa; k1.kappa = kappaOf(k1);
  const rec = { kind: VTA_KIND, publicKeyHex: pubFromSeed(s), participantId: 'ap-' + pubFromSeed(s).slice(0, 16), did: didKey(pubFromSeed(s)), kappa: k1.kappa, prior: k1.prior ?? null, at: NOW.toISOString(), walks: k1.walks?.length ?? 0, vrcs: [] };
  rec.sig = sign(s, recordBytes(rec));
  const item0 = makeItem({ envelope: rec, profile: 'agentprivacy.vta/1', role: 'self', now: NOW });
  assert.equal(item0.verification.state, 'valid');
  const tt = signDI({ id: 'urn:uuid:1', type: 'vrc/publish/0.1', issuer: didKey(pubFromSeed(seed(9))), issuedAt: NOW.toISOString(), payload: { hello: 'world' } }, { seedHex: seed(9), verificationMethod: vmOf(didKey(pubFromSeed(seed(9)))), created: NOW.toISOString() });
  const item1 = makeItem({ envelope: tt, profile: 'trust-task/eddsa-jcs-2022', role: 'witness', now: NOW });
  assert.equal(item1.verification.state, 'valid');
  assert.equal(item1.signed.sigBytes, 64);
  const { key: k2, hold } = holdFor({ seedHex: s, key: k1, items: [item0, item1], at: NOW.toISOString() });
  assert.deepEqual(Object.keys(k2.holds).sort(), ['count', 'root']);
  assert.equal(k2.prior, k1.kappa);
  assert.equal(hold.kappa, k2.kappa);
  assert.equal(hold.root, merkleRoot([item0.ref, item1.ref]));
  const v = verifyHold(hold, { key: k2, now: NOW });
  assert.equal(v.ok, true, v.why.join('; '));
  assert.equal(v.allValid, true);
  assert.deepEqual(holdsSlot(hold), k2.holds);
  // moved to another key → refused; tampered item → refsMatch false; edited count → bearer sig fails
  assert.equal(verifyHold(hold, { key: k1, now: NOW }).keyMatches, false);
  const t = structuredClone(hold); const d = JSON.parse(itemBytes(t.items[1]).toString('utf8')); d.payload.hello = 'there'; t.items[1].envelope = Buffer.from(JSON.stringify(d)).toString('base64url');
  assert.equal(verifyHold(t, { now: NOW }).refsMatch, false);
  const c = structuredClone(hold); c.count = 5;
  assert.equal(verifyHold(c, { now: NOW }).bearerSig, false);
  assert.throws(() => buildHold({ seedHex: s, kappa: k2.kappa, items: [item0, item0] }), /duplicate-item/);
});

test('the projection carries refs and states only; DI verify distinguishes invalid from unavailable; declared profiles are unsupported', () => {
  const f = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const p = JSON.stringify(projectHold(f.hold));
  assert.equal(p.includes('"envelope"'), false);
  for (const i of f.hold.items) if (i.role === 'counterpart' && i.signer) assert.equal(p.includes(i.signer.did), false);
  const di = f.hold.items.find((i) => i.profile === 'trust-task/eddsa-jcs-2022');
  const doc = JSON.parse(itemBytes(di).toString('utf8'));
  assert.equal(verifyDI(doc).state, 'valid');
  assert.equal(verifyDI({ ...doc, payload: { statement: 'changed' } }).state, 'invalid');
  assert.equal(verifyDI({ ...doc, proof: { ...doc.proof, verificationMethod: 'did:webvh:example.com:abc#key-0' } }).state, 'unavailable');
  assert.equal(didKeyPub(doc.proof.verificationMethod.split('#')[0]).length, 64);
  assert.equal(verifyEnvelope('vc/ed25519-2020', Buffer.from('{}')).state, 'unsupported');
  assert.equal(Object.values(PROFILES).filter((f) => f === 'declared').length, 3);
});
