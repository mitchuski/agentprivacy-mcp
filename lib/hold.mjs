// lib/hold.mjs — the Star Hold: a sidecar of retained signed envelopes beside
// the City Key. The key carries only `holds: { root, count }` — the same rule as
// `packets: { root, count }` — so third-party signatures never enter its κ
// preimage (PLAN_CITY_KEY_CRYPTO_UPGRADE invariant: signatures travel beside
// the key). Reference: ~/dtgwg-zkp-tf-mage/runtimes/star-hold (36/36); this
// module verifies that runtime's fixture to the same root and states
// (test/hold.test.mjs) and reuses lib/sign.mjs + lib/kappa.mjs so the
// agentprivacy canonical form and the Merkle rule cannot drift.
//
// Item profiles and who verifies them:
//   trust-task/eddsa-jcs-2022 · vc/eddsa-jcs-2022  — OpenVTC's Data Integrity
//       suite: SHA-256(JCS(proofConfig)) ‖ SHA-256(JCS(doc − proof)), Ed25519,
//       did:key resolved locally; other DID methods → 'unavailable' (never 'invalid')
//   agentprivacy.vta/1                              — lib/sign.mjs verifyRecord
//   agentprivacy.vrc/1                              — Rung 5's bilateral shape
//   vc/ecdsa-secp256k1-2019 · vc/ed25519-2020 · webauthn-assertion — DECLARED:
//       state 'unsupported', so a Hold can carry them honestly
// A stored verification state is a note, not a fact: verifyHold re-verifies
// every item and re-derives every ref and the root (Law L5).
import crypto from 'node:crypto';
import { canonicalJSON, kappaOf, merkleRoot, sha256hex } from './kappa.mjs';
import { VTA_KIND, isHex, pubFromSeed, base58, didKey, verifyRecord, sign as edSignHex, verify as edVerifyHex, pubKeyObject } from './sign.mjs';

export const HOLD_KIND = 'agentprivacy.star-hold/1';
export const PROJECTION_KIND = 'agentprivacy.star-hold-projection/1';
export const VRC_KIND = 'agentprivacy.vrc/1';
export const VERIFIER = 'agentprivacy-mcp/hold@0.1';
export const DEFAULT_BUDGET = 24576;
export const PROFILES = Object.freeze({
  'trust-task/eddsa-jcs-2022': 'di', 'vc/eddsa-jcs-2022': 'di', 'agentprivacy.vta/1': 'vta', 'agentprivacy.vrc/1': 'vrc',
  'vc/ecdsa-secp256k1-2019': 'declared', 'vc/ed25519-2020': 'declared', 'webauthn-assertion': 'declared',
});
export const ROLES = Object.freeze(['self', 'counterpart', 'issuer', 'witness']);

// JCS (RFC 8785) as star-key packages/core/src/trust-tasks/canonical.ts writes it.
export function jcs(v) {
  if (v === null) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('JCS rejects non-finite numbers'); return Object.is(v, -0) ? '0' : String(v); }
  if (typeof v === 'string') return jcsString(v);
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => jcsString(k) + ':' + jcs(v[k])).join(',') + '}';
  throw new Error(`JCS cannot encode value of type ${typeof v}`);
}
function jcsString(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 0x22) out += '\\"'; else if (ch === 0x5c) out += '\\\\'; else if (ch === 0x08) out += '\\b'; else if (ch === 0x0c) out += '\\f';
    else if (ch === 0x0a) out += '\\n'; else if (ch === 0x0d) out += '\\r'; else if (ch === 0x09) out += '\\t';
    else if (ch < 0x20) out += '\\u' + ch.toString(16).padStart(4, '0'); else out += s[i];
  }
  return out + '"';
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58decode(s) {
  let n = 0n;
  for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error('invalid base58'); n = n * 58n + BigInt(i); }
  let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
  let zeros = 0; for (const ch of s) { if (ch !== '1') break; zeros++; }
  return Buffer.concat([Buffer.alloc(zeros), n === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex')]);
}
export function didKeyPub(did) {
  if (typeof did !== 'string' || !did.startsWith('did:key:z')) throw new Error('not a did:key');
  const b = base58decode(did.slice(9));
  if (b.length !== 34 || b[0] !== 0xed || b[1] !== 0x01) throw new Error('not an ed25519 did:key');
  return b.subarray(2).toString('hex');
}
export const vmOf = (did) => did + '#' + did.slice('did:key:'.length);
const edVerify = (pubHex, bytes, sig) => { try { return crypto.verify(null, bytes, pubKeyObject(pubHex), sig); } catch { return false; } };

// ---- Data Integrity eddsa-jcs-2022 -------------------------------------------
export function signDI(doc, { seedHex, verificationMethod, proofPurpose = 'assertionMethod', created = new Date().toISOString() }) {
  const proofConfig = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', verificationMethod, created, proofPurpose };
  const copy = { ...doc }; delete copy.proof;
  const toSign = Buffer.concat([sha256(Buffer.from(jcs(proofConfig), 'utf8')), sha256(Buffer.from(jcs(copy), 'utf8'))]);
  return { ...copy, proof: { ...proofConfig, proofValue: 'z' + base58(Buffer.from(edSignHex(seedHex, toSign), 'hex')) } };
}
// ------------------------------------------ verification-method resolvers
// A resolver maps (controller DID, verification-method URL) to a 32-byte Ed25519
// public key hex, or null when it cannot — an unresolved key is 'unavailable',
// never 'invalid'. did:key resolves offline. Any other method needs either a key
// PINNED out of band (hearthold #90, option 2) or a DID document the caller has
// already fetched (option 1 — e.g. Archon's public resolver,
// GET https://archon.technology/1.0/identifiers/<did>, which returns
// { didDocument, didResolutionMetadata, didDocumentMetadata }). The network step
// stays with the caller: this module never fetches during verification.
const defaultResolve = (did) => (did.startsWith('did:key:') ? didKeyPub(did) : null);
/** Multikey publicKeyMultibase ('z' + base58btc(0xed01 ‖ pub)) → 32-byte hex. Ed25519 only. */
export function multikeyPub(mb) {
  if (typeof mb !== 'string' || !mb.startsWith('z')) throw new Error('not a multibase base58btc key');
  const b = base58decode(mb.slice(1));
  if (b.length !== 34 || b[0] !== 0xed || b[1] !== 0x01) throw new Error('not an ed25519 Multikey');
  return b.subarray(2).toString('hex');
}
/** A DID-document verificationMethod entry → 32-byte Ed25519 hex, or null when the key is not Ed25519 (secp256k1, X25519, …). */
export function vmPublicKey(entry) {
  if (typeof entry?.publicKeyMultibase === 'string') { try { return multikeyPub(entry.publicKeyMultibase); } catch { return null; } }
  const j = entry?.publicKeyJwk;
  if (j && j.kty === 'OKP' && j.crv === 'Ed25519' && typeof j.x === 'string') { const b = Buffer.from(j.x, 'base64url'); if (b.length === 32) return b.toString('hex'); }
  if (isHex(entry?.publicKeyHex, 64)) return entry.publicKeyHex.toLowerCase();
  return null;
}
/** pins: { '<did>#<fragment>' | '<did>': multikey | 32-byte hex | verificationMethod entry }. Matched by the full URL first, then the controller. */
export function resolverFromPins(pins = {}) {
  return (controller, vmUrl) => {
    const hit = pins[vmUrl] ?? pins[controller];
    if (hit == null) return null;
    if (typeof hit === 'string') return isHex(hit, 64) ? hit.toLowerCase() : multikeyPub(hit);
    const pub = vmPublicKey(hit);
    if (!pub) throw new Error(`pinned key for ${vmUrl} is not an Ed25519 key`);
    return pub;
  };
}
/** didDocuments: resolver results or bare DID documents. Relative method ids ('#key-1') are normalised against the document id. */
export function resolverFromDidDocuments(docs = []) {
  const byId = new Map();
  for (const d of docs) { const doc = d?.didDocument ?? d; if (typeof doc?.id === 'string') byId.set(doc.id, doc); }
  return (controller, vmUrl) => {
    const doc = byId.get(controller);
    if (!doc) return null;
    const abs = (id) => (typeof id === 'string' && id.startsWith('#') ? doc.id + id : id);
    const entry = (Array.isArray(doc.verificationMethod) ? doc.verificationMethod : []).find((v) => abs(v?.id) === vmUrl);
    if (!entry) return null; // the document does not list the method: cannot be checked with this document, not a failed signature
    const pub = vmPublicKey(entry);
    if (!pub) throw new Error(`verification method ${vmUrl} is ${entry.type ?? 'of unknown type'}, not an Ed25519 key`);
    return pub;
  };
}
/** did:key offline → a caller resolver → pins → DID documents; the first key wins. */
export function composeResolver({ resolve, pins, didDocuments } = {}) {
  const chain = [defaultResolve];
  if (typeof resolve === 'function') chain.push(resolve);
  if (pins) chain.push(resolverFromPins(pins));
  if (didDocuments) chain.push(resolverFromDidDocuments(didDocuments));
  return (controller, vmUrl) => { for (const r of chain) { const pub = r(controller, vmUrl); if (pub) return pub; } return null; };
}

// ---------------------------------------------------------- proof / proof set
const isEddsaJcs = (p) => p?.type === 'DataIntegrityProof' && p?.cryptosuite === 'eddsa-jcs-2022';
const suiteOf = (p) => `${p?.type ?? 'none'}/${p?.cryptosuite ?? 'none'}`;
// One proof over the unsecured document (the document with the whole `proof`
// property removed — W3C Data Integrity §proof sets: every proof in a set is
// created over the unsecured data document, never over the other proofs).
function verifyOneProof(unsecured, p, resolve, expectedProofPurpose) {
  if (!isEddsaJcs(p)) return { state: 'unsupported', reason: `unsupported proof suite: ${suiteOf(p)}`, verificationMethod: typeof p?.verificationMethod === 'string' ? p.verificationMethod : null };
  if (expectedProofPurpose && p.proofPurpose !== expectedProofPurpose) return { state: 'invalid', reason: `proofPurpose ${p.proofPurpose} != ${expectedProofPurpose}` };
  const vm = p.verificationMethod;
  if (typeof vm !== 'string' || !vm.includes('#')) return { state: 'invalid', reason: 'missing/invalid verificationMethod' };
  if (typeof p.proofValue !== 'string' || !p.proofValue.startsWith('z')) return { state: 'invalid', reason: "missing/invalid proofValue (expected multibase 'z')" };
  const controller = vm.slice(0, vm.indexOf('#'));
  let pub;
  try { pub = resolve(controller, vm); } catch (e) { return { state: 'invalid', signer: controller, verificationMethod: vm, reason: `verificationMethod resolution failed: ${e.message}` }; }
  if (!pub) return { state: 'unavailable', signer: controller, verificationMethod: vm, reason: 'verification method not resolvable here (did:key offline; other methods need a pinned key or a fetched DID document)' };
  const proofConfig = { ...p }; delete proofConfig.proofValue;
  const payload = Buffer.from(jcs(unsecured), 'utf8');
  const toVerify = Buffer.concat([sha256(Buffer.from(jcs(proofConfig), 'utf8')), sha256(payload)]);
  let sig; try { sig = base58decode(p.proofValue.slice(1)); } catch { return { state: 'invalid', signer: controller, verificationMethod: vm, reason: 'proofValue not base58' }; }
  if (sig.length !== 64) return { state: 'invalid', signer: controller, verificationMethod: vm, reason: `unexpected signature length: ${sig.length}` };
  const ok = edVerify(pub, toVerify, sig);
  return { state: ok ? 'valid' : 'invalid', signer: controller, verificationMethod: vm, reason: ok ? null : 'signature verification failed', sigBytes: 64, payloadBytes: payload.length };
}
// A single proof behaves exactly as before. A proof SET (proof: [...]) — e.g. an
// Archon credential carrying a secp256k1 proof and an eddsa-jcs-2022 proof side by
// side (hearthold #90) — is composed conservatively: any supported proof that FAILS
// makes the item invalid (a second proof never papers over a broken one); otherwise
// one supported proof that verifies makes it valid; otherwise unavailable if a
// supported proof could not be resolved; otherwise unsupported. Every proof's own
// verdict is reported in `proofs`. Carrying an unsupported proof is never accepting it.
export function verifyDI(doc, opts = {}) {
  const raw = doc?.proof;
  if (!raw || typeof raw !== 'object') return { state: 'invalid', reason: 'no proof' };
  const set = Array.isArray(raw) ? raw : [raw];
  if (!set.length) return { state: 'invalid', reason: 'empty proof set' };
  const resolve = composeResolver(opts);
  const unsecured = { ...doc }; delete unsecured.proof;
  const results = set.map((p) => verifyOneProof(unsecured, p, resolve, opts.expectedProofPurpose));
  if (set.length === 1) return results[0];
  const pick = (s) => results.find((r) => r.state === s);
  const chosen = pick('invalid') ?? pick('valid') ?? pick('unavailable') ?? results[0];
  const proofs = results.map((r, i) => ({ suite: suiteOf(set[i]), state: r.state, reason: r.reason ?? null, verificationMethod: r.verificationMethod ?? null }));
  const reason = chosen.state === 'valid' ? null
    : chosen.state === 'unsupported' ? `no proof in the set is under a suite this verifier implements: ${proofs.map((q) => q.suite).join(', ')}`
    : chosen.reason;
  return { ...chosen, reason, proofSet: true, proofCount: set.length, proofs };
}
// ---- agentprivacy.vta/1 (lib/sign.mjs) and agentprivacy.vrc/1 ----------------
function verifyVta(rec) {
  const v = verifyRecord(rec);
  if (rec?.kind !== VTA_KIND) return { state: 'unsupported', reason: 'not an agentprivacy.vta/1 record' };
  const did = isHex(rec.publicKeyHex, 64) ? didKey(rec.publicKeyHex) : null;
  return { state: v.ok ? 'valid' : 'invalid', signer: did, verificationMethod: did ? vmOf(did) : null, reason: v.ok ? null : (v.why ?? v.reason ?? 'record did not verify'), sigBytes: 64, payloadBytes: Buffer.byteLength(canonicalJSON({ kind: rec.kind, publicKeyHex: rec.publicKeyHex, kappa: rec.kappa, prior: rec.prior ?? null, at: rec.at, walks: rec.walks ?? 0, vrcs: rec.vrcs ?? [] }), 'utf8') };
}
export const vrcBytes = (v) => Buffer.from(canonicalJSON({ kind: v.kind, parties: v.parties, intersection: v.intersection, proverb: v.proverb, issued: v.issued }), 'utf8');
function verifyVrc(v) {
  if (v?.kind !== VRC_KIND) return { state: 'unsupported', reason: 'not an agentprivacy.vrc/1 record' };
  if (!Array.isArray(v.parties) || v.parties.length !== 2 || !v.parties.every((p) => isHex(p, 64)) || !isHex(v.sigA, 128) || !isHex(v.sigB, 128)) return { state: 'invalid', reason: 'record shape' };
  const bytes = vrcBytes(v);
  const a = edVerifyHex(v.parties[0], bytes, v.sigA), b = edVerifyHex(v.parties[1], bytes, v.sigB);
  return { state: a && b ? 'valid' : 'invalid', signer: didKey(v.parties[0]) + ',' + didKey(v.parties[1]), reason: a && b ? null : 'signature verification failed', sigBytes: 128, payloadBytes: bytes.length };
}
// ---- envelopes and items ------------------------------------------------------
const measure = (bytes, r) => ({ alg: r?.sigBytes ? 'ed25519' : null, sigBytes: r?.sigBytes ?? null, payloadBytes: r?.payloadBytes ?? null, envelopeBytes: bytes.length });
export function verifyEnvelope(profile, bytes, opts = {}) {
  const family = PROFILES[profile];
  if (!family) return { state: 'unsupported', reason: `unknown profile ${profile}`, signed: measure(bytes, null) };
  if (family === 'declared') return { state: 'unsupported', reason: `profile ${profile} is declared, not verified by ${VERIFIER}`, signed: measure(bytes, null) };
  let doc; try { doc = JSON.parse(bytes.toString('utf8')); } catch { return { state: 'invalid', reason: 'envelope is not JSON', signed: measure(bytes, null) }; }
  const r = family === 'di' ? verifyDI(doc, opts) : family === 'vta' ? verifyVta(doc) : verifyVrc(doc);
  return { state: r.state, reason: r.reason ?? null, signer: r.signer ?? null, verificationMethod: r.verificationMethod ?? null, signed: measure(bytes, r) };
}
export const refOf = (bytes) => 'sha256:' + sha256hex(bytes.toString('utf8'));
export const itemBytes = (item) => Buffer.from(item.envelope, 'base64url');
const toBytes = (e) => Buffer.isBuffer(e) ? e : Buffer.from(typeof e === 'string' ? e : JSON.stringify(e), 'utf8');
export function makeItem({ envelope, profile, role = 'counterpart', subject, audience, issued, expires, status, acceptedAt, now = new Date() }, opts = {}) {
  if (!PROFILES[profile]) throw new Error(`unknown profile ${profile}`);
  if (!ROLES.includes(role)) throw new Error(`unknown role ${role}`);
  const bytes = toBytes(envelope);
  const v = verifyEnvelope(profile, bytes, opts);
  const item = { ref: refOf(bytes), profile, envelope: bytes.toString('base64url'), signer: v.signer ? { did: v.signer, verificationMethod: v.verificationMethod } : null, signed: v.signed, role,
    status: status ?? { state: 'unknown' }, acceptedAt: acceptedAt ?? now.toISOString(),
    verification: { state: v.state, verifier: VERIFIER, inputDigest: refOf(bytes), at: now.toISOString(), reason: v.reason ?? null } };
  for (const [k, val] of Object.entries({ subject, audience, issued, expires })) if (val !== undefined) item[k] = val;
  return item;
}
export const holdBytes = (h) => Buffer.from(canonicalJSON({ kind: h.kind, bearer: h.bearer, kappa: h.kappa, root: h.root, count: h.count, at: h.at }), 'utf8');
const usedBytes = (items) => items.reduce((n, i) => n + (i?.signed?.envelopeBytes ?? 0), 0);
export function buildHold({ seedHex, kappa, items, budget = DEFAULT_BUDGET, at = new Date().toISOString() }) {
  if (!Array.isArray(items) || !items.length) throw new Error('a Hold needs at least one item');
  const refs = items.map((i) => i.ref);
  if (new Set(refs).size !== refs.length) throw new Error('duplicate-item: two items share a ref');
  if (!/^sha256:[0-9a-f]{64}$/.test(kappa ?? '')) throw new Error('kappa must name the City Key this Hold belongs to');
  const publicKeyHex = pubFromSeed(seedHex);
  const hold = { kind: HOLD_KIND, bearer: didKey(publicKeyHex), bearerPublicKeyHex: publicKeyHex, kappa, items, root: merkleRoot(refs), count: items.length, budget: { bytes: budget, used: usedBytes(items), fits: usedBytes(items) <= budget }, at };
  hold.sig = edSignHex(seedHex, holdBytes(hold));
  return hold;
}
// items → root → key.holds → κ (moves; prior chains) → the Hold names that κ → the bearer signs.
export function holdFor({ seedHex, key, items, budget = DEFAULT_BUDGET, at = new Date().toISOString() }) {
  const next = { ...key }; delete next.kappa;
  next.holds = { root: merkleRoot(items.map((i) => i.ref)), count: items.length };
  if (key.kappa) next.prior = key.kappa;
  next.kappa = kappaOf(next);
  return { key: next, hold: buildHold({ seedHex, kappa: next.kappa, items, budget, at }) };
}
export function verifyHold(hold, { key = null, resolve, pins, didDocuments, now = new Date() } = {}) {
  const verifyOpts = {}; if (resolve) verifyOpts.resolve = resolve; if (pins) verifyOpts.pins = pins; if (didDocuments) verifyOpts.didDocuments = didDocuments;
  const why = []; const push = (c, m) => { if (!c) why.push(m); return c; };
  push(hold?.kind === HOLD_KIND, 'kind');
  push(isHex(hold?.bearerPublicKeyHex, 64) && hold?.bearer === didKey(hold.bearerPublicKeyHex), 'bearer did does not derive from bearerPublicKeyHex');
  const items = Array.isArray(hold?.items) ? hold.items : [];
  push(items.length > 0, 'items');
  const bearerSig = isHex(hold?.sig, 128) && isHex(hold?.bearerPublicKeyHex, 64) && edVerifyHex(hold.bearerPublicKeyHex, holdBytes(hold), hold.sig);
  push(bearerSig, 'bearer signature over {kind,bearer,kappa,root,count,at} does not verify');
  const refsMatch = items.every((i) => typeof i?.envelope === 'string' && refOf(itemBytes(i)) === i.ref);
  push(refsMatch, 'an item ref does not re-derive from its retained bytes');
  const derived = merkleRoot(items.map((i) => i.ref));
  const rootMatches = derived === hold?.root;
  push(rootMatches, 'root does not re-derive from item refs');
  push(hold?.count === items.length, 'count');
  const results = items.map((i) => { const v = verifyEnvelope(i.profile, itemBytes(i), verifyOpts); return { ref: i.ref, profile: i.profile, role: i.role, state: v.state, reason: v.reason, signer: v.signer, signed: v.signed }; });
  let keyMatches = null;
  if (key) { keyMatches = kappaOf(key) === hold?.kappa && (key.holds == null || (key.holds.root === hold.root && key.holds.count === hold.count)); push(keyMatches, 'the Hold does not belong to this key (κ or holds{root,count} differ)'); }
  const used = usedBytes(items);
  return { ok: why.length === 0, bearerSig, root: { derived, stamped: hold?.root ?? null, matches: rootMatches }, refsMatch, keyChecked: !!key, keyMatches, items: results,
    allValid: results.length > 0 && results.every((r) => r.state === 'valid'), budget: { bytes: hold?.budget?.bytes ?? null, used, fits: hold?.budget?.bytes == null ? null : used <= hold.budget.bytes }, checkedAt: now.toISOString(), why };
}
// Projection states and measurements describe this verification, never cached notes.
// The retained bearer signature binds the Hold header/root, not every projected field.
// Projection is a linkable view of evidence, not recipient authorization.
export function projectHold(hold, options = {}) {
  const verified = verifyHold(hold, options);
  if (!verified.ok) throw new Error('invalid Hold structure; projection not returned');
  return { kind: PROJECTION_KIND, bearer: hold.bearer, kappa: hold.kappa, root: hold.root, count: hold.count, at: hold.at, sig: hold.sig,
    items: verified.items.map((i) => ({ ref: i.ref, profile: i.profile, role: i.role, signed: i.signed, verification: { state: i.state } })) };
}
export const holdsSlot = (hold) => ({ root: hold.root, count: hold.count });
