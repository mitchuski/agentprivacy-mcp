#!/usr/bin/env node
// scripts/star-hold-conformance.mjs — the Star Hold conformance pack for a
// receiving implementation (hearthold #90 / PR #92 asked for it): City Key JSON
// samples with expected canonical bytes and κ, PNG carriers, a signed
// agentprivacy.vta/1 record with its verifying key, a bound-signer challenge
// answered by the same key, and the Merkle vectors. Everything is deterministic
// (fixed seed, fixed times, fixed pixels) so two runs produce the same bytes.
//
//   node scripts/star-hold-conformance.mjs           # (re)write fixtures/star-hold-conformance/
//   node scripts/star-hold-conformance.mjs --check   # regenerate in memory, diff against disk, exit 1 on drift
//
// The test key is a PUBLISHED seed (0x01 × 32). It is never a bearer. The farm
// record is public data — what a VTA publishes on its proofs page.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { canonicalJSON, kappaOf, stamp, verifyKappa, merkleRoot, sha256hex } from '../lib/kappa.mjs';
import { VTA_KIND, pubFromSeed, participantId, didKey, sign, recordBytes, verifyRecord } from '../lib/sign.mjs';
import { encode, withTextChunk, crc32, embedKey, readTextChunks, extractKey } from '../lib/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'fixtures', 'star-hold-conformance');
const AT = '2026-09-13T00:00:00.000Z';
const GENERATED_BY = 'agentprivacy-mcp/scripts/star-hold-conformance.mjs';
const SEED = '01'.repeat(32);

// ---- the keys -----------------------------------------------------------------
const runtimeFixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'star-hold.fixture.json'), 'utf8'));
const full = runtimeFixture.key; // the Star Hold runtime's key: identity, lit, holds{root,count}, prior, kappa
const minimalContent = { version: 1, name: 'conformance · minimal', palette: { cool: '#4a7fb5', warm: '#d9a441', sword: '#8fb3d9', mage: '#e0b56a' }, descriptions: { cool: 'the protecting side', warm: 'the projecting side' } };
const minimal = stamp(minimalContent);
const unnamed = { ...minimalContent };
const nested = stamp({ version: 1, name: 'conformance · nested order', palette: { warm: '#d9a441', cool: '#4a7fb5', mage: '#e0b56a', sword: '#8fb3d9' }, descriptions: {}, walks: [{ slug: 'z-first', steps: [3, 1, 2] }, { slug: 'a-second', steps: [] }], zeta: { b: [true, null, 1.5, 'x'], a: { y: 'inner', x: 0 } } });
const unknownField = stamp({ ...full, unknownAdditive: { kept: true, order: [3, 1, 2], nested: { z: 'z', a: 'a' } } });
const reexport = stamp(stamp(full));
const mismatch = { ...full, kappa: minimal.kappa };
const caseOf = (id, key, expect, note, extra = {}) => ({ id, expect, note, canonical: canonicalJSON((({ kappa, ...c }) => c)(key)), kappa: kappaOf(key), key, ...extra });
const cityKey = {
  schema: 'star-hold-conformance/city-key/1', generatedBy: GENERATED_BY, at: AT,
  profile: {
    name: 'agentprivacy City canonicalization (Law L5)',
    rule: 'kappa = "sha256:" + hex(SHA-256(UTF-8(canonical(key without top-level kappa)))); canonical = object keys sorted recursively (default JS sort, code-unit order), array order preserved, primitives via JSON.stringify, no whitespace; unknown fields stay in the preimage; prior is content; kappa is the only field excluded, and only at the top level',
    notJcs: 'this is not RFC 8785 JCS: control characters in strings and number edge cases may differ; the credential signature (eddsa-jcs-2022) is a separate layer over JCS',
    verdicts: { authentic: 'kappa present and re-derives', unnamed: 'no kappa: the key learns its name', mismatch: 'kappa present and does not re-derive: reject' },
  },
  cases: [
    caseOf('minimal', minimal, 'authentic', 'the four base fields, stamped'),
    caseOf('unnamed', unnamed, 'unnamed', 'the same content without a kappa: derived kappa equals the minimal case'),
    caseOf('nested-order', nested, 'authentic', 'keys inserted out of order at every depth; arrays keep their order; null, booleans, non-integer numbers'),
    caseOf('full', full, 'authentic', 'the Star Hold runtime fixture key: identity, lit, holds{root,count}, prior; the record and the PNG carriers below are bound to THIS kappa'),
    caseOf('unknown-field', unknownField, 'authentic', 'full + an additive field a reader has never seen: it survives the round trip and moves kappa (SHAPE ≠ VIEW: content moved, so the name moved)', { differsFrom: 'full' }),
    caseOf('unchanged-reexport', reexport, 'authentic', 'full stamped twice: an unchanged re-export is idempotent, the same bytes and the same kappa', { sameAs: 'full' }),
    caseOf('mismatch', mismatch, 'mismatch', 'full carrying the minimal case\'s kappa: derived ≠ stamped, reject', { derivedShouldBe: kappaOf(full) }),
  ],
  merkle: {
    rule: 'leaves sorted once (lexicographic); each round pairs left|right as "sha256:" + hex(SHA-256(UTF-8(left + "|" + right))) over the prefixed strings; an odd tail is promoted unchanged; empty set → null',
    packetsVector: { leaves: ['packet-alpha', 'packet-beta', 'packet-gamma'].map((s) => 'sha256:' + sha256hex(s)), leavesAre: 'sha256 of the UTF-8 strings packet-alpha, packet-beta, packet-gamma', root: merkleRoot(['packet-alpha', 'packet-beta', 'packet-gamma'].map((s) => 'sha256:' + sha256hex(s))) },
    holdVector: { refs: runtimeFixture.hold.items.map((i) => i.ref), refsAre: 'sha256 of each retained envelope\'s bytes (the Star Hold runtime fixture, 7 items)', root: merkleRoot(runtimeFixture.hold.items.map((i) => i.ref)), carriedAs: full.holds },
  },
};

// ---- the record ---------------------------------------------------------------
const pub = pubFromSeed(SEED);
const testKey = { label: 'TEST KEY — a published seed, never a bearer; Ed25519 seed → public key is deterministic', seedHex: SEED, publicKeyHex: pub, did: didKey(pub), participantId: participantId(pub) };
const mkRecord = (kappa, prior, extra = {}) => { const r = { kind: VTA_KIND, publicKeyHex: pub, participantId: participantId(pub), did: didKey(pub), kappa, prior, at: AT, walks: 0, vrcs: [], ...extra }; r.sig = sign(SEED, recordBytes(r)); return r; };
const testRecord = mkRecord(full.kappa, full.prior ?? null);
const proofs = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'mages_city', 'farm', 'soulbis.mages.localhost', 'pages', 'proofs'), 'utf8'));
const farmRecord = JSON.parse(proofs.story.find((i) => i.type === 'code').text).cityKey.vta;
const recCase = (id, record, expect, note, extra = {}) => ({ id, expect, note, preimage: recordBytes(record).toString('utf8'), preimageSha256: sha256hex(recordBytes(record).toString('utf8')), ourVerdict: verifyRecord(record).ok ? 'valid' : 'invalid', record, ...extra });
const upper = { ...testRecord, publicKeyHex: testRecord.publicKeyHex.toUpperCase(), sig: testRecord.sig.toUpperCase() };
const tampered = { ...testRecord, walks: 1 };
const didMismatch = { ...testRecord, did: didKey(pubFromSeed('02'.repeat(32))) };
const vtaRecord = {
  schema: 'star-hold-conformance/vta-record/1', generatedBy: GENERATED_BY, at: AT,
  rule: {
    kind: VTA_KIND,
    preimage: 'canonical({kind, publicKeyHex, kappa, prior, at, walks, vrcs}) under the City profile above — defaults prior→null, walks→0, vrcs→[]; keys sorted; no whitespace; sig, did and participantId are not in the preimage',
    signature: 'Ed25519 (RFC 8032, pure Ed25519, no prehash) over the UTF-8 bytes of the preimage; sig = 64 bytes as lowercase hex; verified with node:crypto (OpenSSL) here and in the mages.city chip with WebCrypto',
    encodings: 'publicKeyHex = 32 bytes lowercase hex; case is preimage-significant: uppercase hex changes the signed bytes and the signature fails (the uppercase-hex case); at is required (an absent at would canonicalize to the token undefined, which is not JSON); did must equal did:key:z + base58btc(0xed 0x01 ‖ publicKey) when present; participantId must equal "ap-" + the first 16 hex characters when present',
    origin: 'agentprivacy-mcp lib/sign.mjs (recordBytes, sign, verifyRecord) — the Swordsman signs with it; lib/kappa.mjs canonicalJSON',
  },
  testKey,
  records: [
    recCase('test-full-key', testRecord, 'valid', 'signed by the test key over the full City Key\'s kappa (city-key.fixture.json#full), prior = that key\'s prior', { signedKey: 'city-key.fixture.json#full' }),
    recCase('farm-soulbis', farmRecord, 'valid', 'a record a City resident publishes on its proofs page (soulbis.mages.localhost, signed 2026-09-05); public data — the bearer public key, the kappa, the prior, the count of walks; never the key or the walk', { source: 'mages.city farm · soulbis.mages.localhost/proofs · cityKey.vta' }),
    recCase('uppercase-hex', upper, 'invalid', 'the test record with publicKeyHex and sig uppercased: hex case is preimage-significant, so the signature does not verify — a conforming verifier rejects, it does not normalise'),
    recCase('tampered-walks', tampered, 'invalid', 'walks changed after signing'),
    recCase('did-mismatch', didMismatch, 'invalid', 'a did that does not derive from publicKeyHex: rejected before the signature is checked'),
  ],
};

// ---- the challenge (hearthold PR #92 shape) -----------------------------------
const challenge = { nonce: sha256hex('star-hold-conformance nonce ' + AT), kappa: full.kappa, audience: 'hearthold:mages.archon.social', exp: 1800000060000 };
const challengePreimage = canonicalJSON(challenge);
const challengeFixture = {
  schema: 'star-hold-conformance/bound-signer-challenge/1', generatedBy: GENERATED_BY, at: AT,
  rule: 'hearthold PR #92 challengePreimage = canonicalCityJSON({nonce, kappa, audience, exp}) — the same City profile; the response is an Ed25519 signature (lowercase hex) over the UTF-8 preimage by the key the record binds; a verifier checks the record first, then kappa equality, then expiry, then the signature; the nonce is single-use on the Warden',
  record: 'vta-record.fixture.json#test-full-key',
  challenge, preimage: challengePreimage, preimageSha256: sha256hex(challengePreimage),
  responseSigHex: sign(SEED, Buffer.from(challengePreimage, 'utf8')),
  expect: { at: 1800000000000, verdict: 'ok', afterExp: 'expired', otherKappa: 'kappa-mismatch' },
};

// ---- the PNG carriers ---------------------------------------------------------
const W = 16, H = 16;
const rgba = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; rgba[o] = x * 16; rgba[o + 1] = y * 16; rgba[o + 2] = (x ^ y) * 16; rgba[o + 3] = 255; }
const base = encode(rgba, W, H);
const pngKey = embedKey(base, full);                                                        // tEXt cityKey = base64(JSON)
const pngSigned = withTextChunk(pngKey, 'cityKeySig', Buffer.from(JSON.stringify(testRecord), 'utf8').toString('base64'));
function withITXt(png, keyword, text) {                                                      // the guide chart keepsake carrier: iTXt citykey = raw JSON
  const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0, 0, 0]), Buffer.from([0]), Buffer.from([0]), Buffer.from(text, 'utf8')]);
  const chunk = Buffer.alloc(12 + data.length); chunk.writeUInt32BE(data.length, 0); chunk.write('iTXt', 4, 'latin1'); data.copy(chunk, 8); chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  const iend = png.length - 12; return Buffer.concat([png.subarray(0, iend), chunk, png.subarray(iend)]);
}
const pngItxt = withITXt(base, 'citykey', JSON.stringify(full));
const pngFixture = {
  schema: 'star-hold-conformance/png-carrier/1', generatedBy: GENERATED_BY, at: AT,
  rule: 'a City Key travels inside its sigil PNG. Carrier A (soulbis /star, /lattice, /sigil, the Swordsman): a tEXt chunk before IEND, keyword cityKey, text = base64(JSON.stringify(key)). Carrier B (the guide star chart keepsake): an iTXt chunk, keyword citykey, uncompressed, text = the JSON itself. A signed sigil adds tEXt cityKeySig = base64(JSON.stringify(record)). Readers accept both carriers; on import re-derive kappa from what the image carried (Law L5). Pixels are not part of kappa.',
  pixels: '16×16 RGBA, r = x·16, g = y·16, b = (x xor y)·16, a = 255, filter 0, zlib level 9 — deterministic so the file digests below are reproducible',
  files: [
    { file: 'city-key.fixture.png', carrier: 'A: tEXt cityKey (base64 JSON)', chunks: Object.keys(readTextChunks(pngKey)), kappa: kappaOf(extractKey(pngKey)), sameKeyAs: 'city-key.fixture.json#full', sha256: sha256hex(pngKey), bytes: pngKey.length },
    { file: 'city-key-signed.fixture.png', carrier: 'A + tEXt cityKeySig (base64 JSON record)', chunks: Object.keys(readTextChunks(pngSigned)), kappa: kappaOf(extractKey(pngSigned)), record: 'vta-record.fixture.json#test-full-key', sha256: sha256hex(pngSigned), bytes: pngSigned.length },
    { file: 'city-key-itxt.fixture.png', carrier: 'B: iTXt citykey (raw JSON)', chunks: Object.keys(readTextChunks(pngItxt)), kappa: kappaOf(extractKey(pngItxt)), sameKeyAs: 'city-key.fixture.json#full', sha256: sha256hex(pngItxt), bytes: pngItxt.length },
  ],
};

// ---- write / check ------------------------------------------------------------
const files = {
  'city-key.fixture.json': Buffer.from(JSON.stringify(cityKey, null, 2) + '\n', 'utf8'),
  'vta-record.fixture.json': Buffer.from(JSON.stringify(vtaRecord, null, 2) + '\n', 'utf8'),
  'challenge.fixture.json': Buffer.from(JSON.stringify(challengeFixture, null, 2) + '\n', 'utf8'),
  'png-carrier.fixture.json': Buffer.from(JSON.stringify(pngFixture, null, 2) + '\n', 'utf8'),
  'city-key.fixture.png': pngKey, 'city-key-signed.fixture.png': pngSigned, 'city-key-itxt.fixture.png': pngItxt,
};
// self-consistency before anything is written
const must = (c, m) => { if (!c) { console.error('conformance pack inconsistent: ' + m); process.exit(2); } };
must(verifyKappa(full).verdict === 'verified', 'full key');
must(cityKey.merkle.packetsVector.root === 'sha256:07f20f689c8bef2d8a9a2a71d94e7014ea8398cc603b0ff72dadba5c517983d1', 'packets vector');
must(cityKey.merkle.holdVector.root === full.holds.root && cityKey.merkle.holdVector.root === runtimeFixture.expected.root, 'hold vector');
must(kappaOf(reexport) === full.kappa && kappaOf(unknownField) !== full.kappa, 're-export / unknown field');
for (const r of vtaRecord.records) must(r.ourVerdict === r.expect, 'record ' + r.id);
must(kappaOf(extractKey(pngSigned)) === testRecord.kappa, 'signed png binds the record to the carried key');

if (process.argv.includes('--check')) {
  let drift = 0;
  for (const [name, bytes] of Object.entries(files)) {
    const p = path.join(OUT, name);
    if (!fs.existsSync(p)) { console.error('missing ' + name); drift++; continue; }
    if (!fs.readFileSync(p).equals(bytes)) { console.error('drift ' + name); drift++; }
  }
  console.log(drift ? `conformance pack: ${drift} file(s) drifted` : `conformance pack: ${Object.keys(files).length} files match disk`);
  process.exit(drift ? 1 : 0);
}
fs.mkdirSync(OUT, { recursive: true });
for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), bytes);
console.log(`wrote ${Object.keys(files).length} files to ${path.relative(ROOT, OUT)}`);
console.log(`  full κ ${full.kappa}\n  test key ${testKey.did}\n  packets vector ${cityKey.merkle.packetsVector.root}\n  hold vector ${cityKey.merkle.holdVector.root} (count ${full.holds.count})`);
