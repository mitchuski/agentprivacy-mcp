#!/usr/bin/env node
// verify.mjs — a self-contained checker for the Star Hold conformance pack.
// Zero dependencies beyond node:crypto and node:zlib; copy it anywhere next to the
// fixtures and run `node verify.mjs`. It re-derives every κ, checks every record,
// answers the challenge, reads every PNG carrier, and recomputes the Merkle roots.
// Exit 0 when every expectation in the pack holds; 1 otherwise.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ' — ' + detail}`); };

// ---- the City canonicalization profile (Law L5) ------------------------------
const canonical = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
  : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const kappaOf = (key) => { const c = { ...key }; delete c.kappa; return 'sha256:' + sha256hex(canonical(c)); };
const verdictOf = (key) => { const d = kappaOf(key); return typeof key.kappa !== 'string' ? 'unnamed' : d === key.kappa ? 'authentic' : 'mismatch'; };
const merkleRoot = (leaves) => { let level = [...leaves].sort(); if (!level.length) return null; while (level.length > 1) { const next = []; for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? 'sha256:' + sha256hex(level[i] + '|' + level[i + 1]) : level[i]); level = next; } return level[0]; };

// ---- Ed25519 + did:key --------------------------------------------------------
const SPKI = '302a300506032b6570032100';
const pubKey = (hex) => crypto.createPublicKey({ key: Buffer.concat([Buffer.from(SPKI, 'hex'), Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
const verify = (pubHex, bytes, sigHex) => { try { return crypto.verify(null, bytes, pubKey(pubHex), Buffer.from(sigHex, 'hex')); } catch { return false; } };
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58 = (buf) => { let n = BigInt('0x' + buf.toString('hex')), out = ''; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; } for (const b of buf) { if (b !== 0) break; out = '1' + out; } return out; };
const didKey = (pubHex) => 'did:key:z' + base58(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(pubHex, 'hex')]));
const isHex = (s, n) => typeof s === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(s); // lowercase only: case is preimage-significant
const recordPreimage = (r) => canonical({ kind: r.kind, publicKeyHex: r.publicKeyHex, kappa: r.kappa, prior: r.prior ?? null, at: r.at, walks: r.walks ?? 0, vrcs: r.vrcs ?? [] });
function verifyRecord(r) {
  if (r?.kind !== 'agentprivacy.vta/1') return 'invalid';
  if (!isHex(r.publicKeyHex, 64) || !isHex(r.sig, 128) || typeof r.at !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(r.kappa ?? '')) return 'invalid';
  if (r.did !== undefined && r.did !== didKey(r.publicKeyHex)) return 'invalid';
  if (r.participantId !== undefined && r.participantId !== 'ap-' + r.publicKeyHex.slice(0, 16)) return 'invalid';
  return verify(r.publicKeyHex, Buffer.from(recordPreimage(r), 'utf8'), r.sig) ? 'valid' : 'invalid';
}

// ---- PNG text chunks -----------------------------------------------------------
function textChunks(png) {
  const out = {}; let p = 8;
  while (p + 12 <= png.length) {
    const len = png.readUInt32BE(p), type = png.toString('latin1', p + 4, p + 8), data = png.subarray(p + 8, p + 8 + len);
    if (type === 'tEXt') { const z = data.indexOf(0); out[data.toString('latin1', 0, z)] = data.toString('latin1', z + 1); }
    else if (type === 'iTXt') { const z = data.indexOf(0); const comp = data[z + 1]; const l1 = data.indexOf(0, z + 3), l2 = data.indexOf(0, l1 + 1); const body = data.subarray(l2 + 1); out[data.toString('latin1', 0, z)] = (comp ? zlib.inflateSync(body) : body).toString('utf8'); }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return out;
}
const keyFromPng = (png) => { const t = textChunks(png); return t.cityKey ? JSON.parse(Buffer.from(t.cityKey, 'base64').toString('utf8')) : t.citykey ? JSON.parse(t.citykey) : null; };

// ---- 1 · City Keys ---------------------------------------------------------------
console.log('\nstar-hold conformance pack\n\n1 · City Key κ (city-key.fixture.json)');
const ck = read('city-key.fixture.json');
const byId = Object.fromEntries(ck.cases.map((c) => [c.id, c]));
for (const c of ck.cases) {
  const canon = canonical((({ kappa, ...k }) => k)(c.key));
  check(`${c.id}: canonical bytes match`, canon === c.canonical);
  check(`${c.id}: κ re-derives to ${c.kappa.slice(0, 23)}…`, kappaOf(c.key) === c.kappa);
  check(`${c.id}: verdict ${c.expect}`, verdictOf(c.key) === c.expect, verdictOf(c.key));
  if (c.sameAs) check(`${c.id}: same κ as ${c.sameAs}`, c.kappa === byId[c.sameAs].kappa);
  if (c.differsFrom) check(`${c.id}: κ differs from ${c.differsFrom}`, c.kappa !== byId[c.differsFrom].kappa);
  if (c.derivedShouldBe) check(`${c.id}: derived κ is ${c.derivedShouldBe.slice(0, 23)}…`, kappaOf(c.key) === c.derivedShouldBe);
}
check('unnamed derives the minimal κ', kappaOf(byId.unnamed.key) === byId.minimal.kappa);
check('merkle packets vector', merkleRoot(ck.merkle.packetsVector.leaves) === ck.merkle.packetsVector.root);
check('merkle hold vector = key.holds.root, count matches', merkleRoot(ck.merkle.holdVector.refs) === ck.merkle.holdVector.root && byId.full.key.holds.root === ck.merkle.holdVector.root && byId.full.key.holds.count === ck.merkle.holdVector.refs.length);

// ---- 2 · the record --------------------------------------------------------------
console.log('\n2 · agentprivacy.vta/1 (vta-record.fixture.json)');
const vr = read('vta-record.fixture.json');
const seedPub = crypto.createPublicKey(crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(vr.testKey.seedHex, 'hex')]), format: 'der', type: 'pkcs8' })).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
check('test key: seed → publicKeyHex → did:key', seedPub === vr.testKey.publicKeyHex && didKey(seedPub) === vr.testKey.did);
for (const r of vr.records) {
  check(`${r.id}: preimage bytes match`, recordPreimage(r.record) === r.preimage);
  check(`${r.id}: preimage sha256`, sha256hex(r.preimage) === r.preimageSha256);
  check(`${r.id}: verdict ${r.expect}`, verifyRecord(r.record) === r.expect, verifyRecord(r.record));
  if (r.signedKey) check(`${r.id}: signed over ${r.signedKey}`, r.record.kappa === byId[r.signedKey.split('#')[1]].kappa);
}

// ---- 3 · the challenge ------------------------------------------------------------
console.log('\n3 · bound-signer challenge (challenge.fixture.json)');
const ch = read('challenge.fixture.json');
const rec = vr.records.find((r) => r.id === ch.record.split('#')[1]).record;
check('challenge preimage bytes match', canonical(ch.challenge) === ch.preimage && sha256hex(ch.preimage) === ch.preimageSha256);
const answer = (now, kappa = rec.kappa) => verifyRecord(rec) !== 'valid' ? 'bad-record' : kappa !== ch.challenge.kappa ? 'kappa-mismatch' : now > ch.challenge.exp ? 'expired' : verify(rec.publicKeyHex, Buffer.from(ch.preimage, 'utf8'), ch.responseSigHex) ? 'ok' : 'bad-response';
check(`response verifies at ${ch.expect.at}: ${ch.expect.verdict}`, answer(ch.expect.at) === ch.expect.verdict);
check('after exp: expired', answer(ch.challenge.exp + 1) === ch.expect.afterExp);
check('another κ: kappa-mismatch', answer(ch.expect.at, 'sha256:' + '00'.repeat(32)) === ch.expect.otherKappa);

// ---- 4 · PNG carriers -------------------------------------------------------------
console.log('\n4 · PNG carriers (png-carrier.fixture.json)');
const pf = read('png-carrier.fixture.json');
for (const f of pf.files) {
  const png = fs.readFileSync(path.join(HERE, f.file));
  check(`${f.file}: sha256 + size`, crypto.createHash('sha256').update(png).digest('hex') === f.sha256 && png.length === f.bytes);
  const chunks = textChunks(png);
  check(`${f.file}: chunks ${f.chunks.join('+')}`, JSON.stringify(Object.keys(chunks)) === JSON.stringify(f.chunks));
  const key = keyFromPng(png);
  check(`${f.file}: carried key re-derives κ ${f.kappa.slice(0, 23)}… (authentic)`, key && kappaOf(key) === f.kappa && verdictOf(key) === 'authentic');
  if (f.sameKeyAs) check(`${f.file}: same κ as ${f.sameKeyAs}`, f.kappa === byId[f.sameKeyAs.split('#')[1]].kappa);
  if (f.record) { const sig = JSON.parse(Buffer.from(chunks.cityKeySig, 'base64').toString('utf8')); check(`${f.file}: cityKeySig verifies and names the carried κ`, verifyRecord(sig) === 'valid' && sig.kappa === kappaOf(key)); }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
