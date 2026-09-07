// lib/sign.mjs — Rung 1, the public half: verify a signed City Key, derive a
// did:key, check the liveness predicate. Holds NO secret; the Mage server and the
// Swordsman both import it. Signing lives only in swordsman/swordsman.mjs.
//
// Identity = the AgentCard's ed25519 key (agentprivacy /ceremony · @noble/ed25519,
// raw 32-byte seed + 32-byte public key, hex). Node verifies it the way the
// mages.city Portal does: SPKI DER prefix + raw key, canonical JSON (keys sorted
// recursively, no whitespace — the same rule as κ), hex signature.
//
// The VTA record (kind agentprivacy.vta/1) is what a Verifiable Trust Agent
// PUBLISHES (plan Phase 5): bearer public key · current κ · prior · commitments —
// never the key, never the walk. The signature covers the canonical form of
// {kind, publicKeyHex, kappa, prior, at, walks, vrcs}. Its `at` is the one
// deliberately non-deterministic thing in this package: a signature is an event.
import crypto from 'node:crypto';
import { canonicalJSON, kappaOf } from './kappa.mjs';

export const VTA_KIND = 'agentprivacy.vta/1';
export const SPKI = '302a300506032b6570032100';                 // ed25519 SubjectPublicKeyInfo prefix
export const PKCS8 = '302e020100300506032b657004220420';        // ed25519 PrivateKeyInfo prefix (32-byte seed follows)
export const isHex = (s, n) => typeof s === 'string' && new RegExp(`^[0-9a-f]{${n}}$`, 'i').test(s);

export const pubKeyObject = hex => crypto.createPublicKey({ key: Buffer.concat([Buffer.from(SPKI, 'hex'), Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
export const privKeyObject = seedHex => crypto.createPrivateKey({ key: Buffer.concat([Buffer.from(PKCS8, 'hex'), Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
export const pubFromSeed = seedHex => crypto.createPublicKey(privKeyObject(seedHex)).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
export const participantId = pub => 'ap-' + String(pub).slice(0, 16).toLowerCase();

// did:key for ed25519: 'z' + base58btc(0xed 0x01 ‖ 32-byte public key) → did:key:z6Mk…
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(buf) {
  let n = BigInt('0x' + buf.toString('hex')), out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b !== 0) break; out = '1' + out; }
  return out;
}
export const didKey = pubHex => 'did:key:z' + base58(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(pubHex, 'hex')]));

/** The bytes a VTA record's signature covers. */
export const recordBytes = r => Buffer.from(canonicalJSON({ kind: r.kind, publicKeyHex: r.publicKeyHex, kappa: r.kappa, prior: r.prior ?? null, at: r.at, walks: r.walks ?? 0, vrcs: r.vrcs ?? [] }), 'utf8');

export const sign = (seedHex, bytes) => crypto.sign(null, bytes, privKeyObject(seedHex)).toString('hex');
export const verify = (pubHex, bytes, sigHex) => { try { return crypto.verify(null, bytes, pubKeyObject(pubHex), Buffer.from(sigHex, 'hex')); } catch { return false; } };

/**
 * Verify a VTA record; with the key present, also that the record names THIS
 * key (L5: κ re-derived from the key equals the signed κ, prior agrees).
 */
export function verifyRecord(rec, key = null) {
  if (!rec || rec.kind !== VTA_KIND) return { ok: false, why: `kind must be ${VTA_KIND}` };
  if (!isHex(rec.publicKeyHex, 64)) return { ok: false, why: 'publicKeyHex must be 32 bytes hex' };
  if (!isHex(rec.sig, 128)) return { ok: false, why: 'sig must be 64 bytes hex' };
  if (!/^sha256:[0-9a-f]{64}$/.test(rec.kappa || '')) return { ok: false, why: 'kappa must be sha256:<hex>' };
  const pid = participantId(rec.publicKeyHex);
  if (rec.participantId && rec.participantId.toLowerCase() !== pid) return { ok: false, why: `participantId must be ${pid}` };
  if (rec.did && rec.did !== didKey(rec.publicKeyHex)) return { ok: false, why: 'did does not derive from publicKeyHex' };
  if (!verify(rec.publicKeyHex, recordBytes(rec), rec.sig)) return { ok: false, why: 'signature does not verify over {kind, publicKeyHex, kappa, prior, at, walks, vrcs}' };
  const out = { ok: true, participantId: pid, did: didKey(rec.publicKeyHex), kappa: rec.kappa, prior: rec.prior ?? null, at: rec.at };
  if (key) {
    const k = kappaOf(key);
    if (k !== rec.kappa) return { ...out, ok: false, why: `the key re-derives to ${k.slice(0, 23)}…, the record was signed over ${rec.kappa.slice(0, 23)}…` };
    if ((key.prior ?? null) !== (rec.prior ?? null)) return { ...out, ok: false, why: 'the key\'s prior differs from the signed prior' };
    if (key.identity?.publicKeyHex && key.identity.publicKeyHex.toLowerCase() !== rec.publicKeyHex.toLowerCase()) return { ...out, ok: false, why: 'the key names a different bearer than the record' };
    out.keyMatches = true;
  }
  return out;
}

/**
 * Verify an AgentCard as agentprivacy /ceremony signs it (CeremonyWizard):
 * ed25519 over JSON.stringify({participantId, displayName, publicKeyHex,
 * grimoires, privacy, trustTier}) IN THAT ORDER (plain stringify, not the
 * sorted canon), hex signature. The board never re-issues identity; this is
 * how a Swordsman checks the card it was handed at init, and how the Mage
 * checks a card on a resident's `agent-card` page.
 */
export function verifyCard(card) {
  if (!card || typeof card !== 'object') return { ok: false, why: 'no card' };
  if (!isHex(card.publicKeyHex, 64)) return { ok: false, why: 'publicKeyHex must be 32 bytes hex' };
  const pid = participantId(card.publicKeyHex);
  if ((card.participantId || '').toLowerCase() !== pid) return { ok: false, why: `participantId must be ${pid}` };
  if (!isHex(card.signature, 128)) return { ok: false, why: 'signature must be 64 bytes hex' };
  const msg = JSON.stringify({ participantId: card.participantId, displayName: card.displayName, publicKeyHex: card.publicKeyHex, grimoires: card.grimoires, privacy: card.privacy, trustTier: card.trustTier });
  const ok = verify(card.publicKeyHex, Buffer.from(msg, 'utf8'), card.signature);
  return ok ? { ok: true, participantId: pid, did: didKey(card.publicKeyHex), displayName: card.displayName, trustTier: card.trustTier, drakeOrb: card.drakeOrb?.tier || null }
    : { ok: false, why: 'signature does not verify over the card payload' };
}

/**
 * evolved_since(t) — the first predicate (plan §8 Q4): a signed evolution landed
 * after t. Proven by a valid record with at ≥ t; a stale κ is a stale agent.
 * `horizon` is the bearer's own g (days) after which the reading expires.
 */
export function evolvedSince(rec, since, { horizonDays = null, now = new Date() } = {}) {
  const v = verifyRecord(rec);
  if (!v.ok) return { ok: false, why: v.why, predicate: 'evolved_since' };
  const t = new Date(since), at = new Date(rec.at);
  if (isNaN(t) || isNaN(at)) return { ok: false, why: 'bad timestamp', predicate: 'evolved_since' };
  const holds = at >= t;
  const expires = horizonDays == null ? null : new Date(at.getTime() + horizonDays * 864e5);
  return { predicate: 'evolved_since', since: t.toISOString(), signedAt: at.toISOString(), holds, ok: holds,
    expires: expires ? expires.toISOString() : null, expired: expires ? now > expires : false,
    establishes: holds ? ['memory'] : [], note: holds ? 'a signed evolution landed after t — the agent is live' : 'no signed evolution since t — stale κ, stale agent' };
}
