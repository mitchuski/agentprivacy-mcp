// test/proof-set.test.mjs — proof SETS and pinned / document-resolved verification
// methods (hearthold #90, after PR #92): an Archon-shaped credential carrying a
// secp256k1 proof and an eddsa-jcs-2022 proof side by side, under a did:cid
// verification method. Parity with runtimes/star-hold H18: the same fixture lands
// on the same states here. Run: node --test test/proof-set.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDI, verifyEnvelope, makeItem, buildHold, verifyHold, multikeyPub, vmPublicKey, resolverFromDidDocuments, composeResolver, signDI } from '../lib/hold.mjs';
import { pubFromSeed, base58 } from '../lib/sign.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'star-hold-proof-set.fixture.json');
const f = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const seed = (n) => n.toString(16).padStart(2, '0').repeat(32);
const NOW = new Date('2026-09-11T12:00:00.000Z');
const bytes = Buffer.from(JSON.stringify(f.credential), 'utf8');

test('parity: the runtime proof-set fixture lands on the same states (no pin → unavailable; pinned → valid; document → valid; tampered → invalid; secp-only → unsupported; wrong pin → invalid)', () => {
  assert.equal(f.schema, 'star-hold-proof-set-fixture/1');
  assert.equal(verifyEnvelope('vc/eddsa-jcs-2022', bytes).state, f.expected.noPin);
  const pinned = verifyEnvelope('vc/eddsa-jcs-2022', bytes, { pins: f.pins });
  assert.equal(pinned.state, f.expected.pinned);
  assert.equal(pinned.signer, f.expected.signer);
  assert.equal(pinned.verificationMethod, f.expected.verificationMethod);
  assert.equal(verifyEnvelope('vc/eddsa-jcs-2022', bytes, { didDocuments: [f.didDocument] }).state, f.expected.resolved);
  assert.equal(verifyEnvelope('vc/eddsa-jcs-2022', Buffer.from(JSON.stringify(f.tampered)), { pins: f.pins }).state, f.expected.tampered);
  const so = verifyEnvelope('vc/eddsa-jcs-2022', Buffer.from(JSON.stringify(f.secpOnly)), { pins: f.pins });
  assert.equal(so.state, f.expected.secpOnly);
  assert.match(so.reason, /EcdsaSecp256k1Signature2019/);
  const wrong = { [f.expected.verificationMethod]: 'z' + base58(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(pubFromSeed(seed(51)), 'hex')])) };
  assert.equal(verifyEnvelope('vc/eddsa-jcs-2022', bytes, { pins: wrong }).state, f.expected.wrongPin);
});

test('the set is reported proof by proof; a single proof keeps the pre-set shape', () => {
  const r = verifyDI(f.credential, { pins: f.pins });
  assert.equal(r.proofSet, true);
  assert.equal(r.proofCount, 2);
  assert.deepEqual(r.proofs.map((p) => p.state), f.expected.proofs);
  assert.match(r.proofs[0].suite, /^EcdsaSecp256k1Signature2019/);
  const single = verifyDI({ ...f.credential, proof: f.credential.proof[1] }, { pins: f.pins });
  assert.equal(single.state, 'valid');
  assert.equal(single.proofSet, undefined);
});

test('resolvers: Multikey and JWK entries decode to the same Ed25519 key; relative ids normalise; a non-Ed25519 method is refused with a reason, an absent one is unavailable', () => {
  const did = f.expected.signer;
  const mk = f.didDocument.didDocument.verificationMethod.find((v) => v.id === '#key-assertion-1');
  const pub = multikeyPub(mk.publicKeyMultibase);
  assert.equal(vmPublicKey(mk), pub);
  assert.equal(vmPublicKey({ publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pub, 'hex').toString('base64url') } }), pub);
  assert.equal(vmPublicKey(f.didDocument.didDocument.verificationMethod[0]), null); // secp256k1
  const r = resolverFromDidDocuments([f.didDocument]);
  assert.equal(r(did, did + '#key-assertion-1'), pub);
  assert.equal(r(did, did + '#key-missing'), null);
  assert.throws(() => r(did, did + '#key-1'), /not an Ed25519 key/);
  const chain = composeResolver({ pins: f.pins });
  assert.equal(chain(did, did + '#key-assertion-1'), pub);
  assert.equal(chain('did:web:example.org', 'did:web:example.org#k'), null);
});

test('a Hold carrying the dual-proof item re-verifies with pins forwarded through verifyHold; without them it reads unavailable', () => {
  const item = makeItem({ envelope: bytes, profile: 'vc/eddsa-jcs-2022', role: 'issuer', now: NOW }, { pins: f.pins });
  assert.equal(item.verification.state, 'valid');
  const hold = buildHold({ seedHex: seed(1), kappa: 'sha256:' + 'ab'.repeat(32), items: [item], at: NOW.toISOString() });
  assert.equal(verifyHold(hold, { pins: f.pins, now: NOW }).items[0].state, 'valid');
  assert.equal(verifyHold(hold, { now: NOW }).items[0].state, 'unavailable');
});

test('a proof set signed here round-trips: two eddsa proofs from two signers, both valid; one broken makes the set invalid', () => {
  const doc = { id: 'urn:test:two-signers', claim: 'x' };
  const a = signDI(doc, { seedHex: seed(60), verificationMethod: 'did:example:a#k', created: NOW.toISOString() }).proof;
  const b = signDI(doc, { seedHex: seed(61), verificationMethod: 'did:example:b#k', created: NOW.toISOString() }).proof;
  const pins = { 'did:example:a#k': pubFromSeed(seed(60)), 'did:example:b#k': pubFromSeed(seed(61)) };
  const ok = verifyDI({ ...doc, proof: [a, b] }, { pins });
  assert.equal(ok.state, 'valid');
  assert.deepEqual(ok.proofs.map((p) => p.state), ['valid', 'valid']);
  const broken = verifyDI({ ...doc, proof: [a, { ...b, proofValue: a.proofValue }] }, { pins });
  assert.equal(broken.state, 'invalid');
});
