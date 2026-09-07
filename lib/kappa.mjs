// lib/kappa.mjs — the κ-label (UOR-ADDR · sha256 axis). Identity is content,
// not location. Law L5: a κ is never trusted, only re-derived.
//
// Canonical form: the object's JSON with keys sorted recursively, no whitespace,
// the `kappa` field excluded from its own preimage. Byte-identical to the rule
// on soulbis.com/star, /lattice, /sigil, agentprivacy_master lib/city-key.ts
// (canonicalCityKeyJSON) and the dual-agent harness's tools/kappa.mjs.
// test/canon.test.mjs pins a vector so this copy cannot drift silently.
import crypto from 'node:crypto';

export function canonicalJSON(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJSON).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonicalJSON(v[k])).join(',') + '}';
}
export const sha256hex = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
/** κ of an object: sha256 over its canonical form with `kappa` removed. */
export function kappaOf(obj) {
  const c = { ...obj }; delete c.kappa;
  return 'sha256:' + sha256hex(canonicalJSON(c));
}
/** Re-derive and compare. verdict ∈ verified | mismatch | unlabelled. */
export function verifyKappa(obj) {
  const derived = kappaOf(obj);
  if (typeof obj?.kappa !== 'string') return { verdict: 'unlabelled', derived, stamped: null };
  return { verdict: derived === obj.kappa ? 'verified' : 'mismatch', derived, stamped: obj.kappa };
}
/** Stamp: return a copy with kappa = κ(content). Idempotent on unchanged content. */
export function stamp(obj) { const c = { ...obj }; delete c.kappa; c.kappa = kappaOf(c); return c; }
/** Canonical bytes of the content (kappa excluded) — what the sigil is drawn from. */
export const canonicalBytes = obj => { const c = { ...obj }; delete c.kappa; return Buffer.from(canonicalJSON(c), 'utf8'); };

/**
 * The PSI element for one page of a walk — the same rule the guide bake uses
 * (agentprivacy.guide/tools/star-chart.mjs elementOf): never a bare vertex.
 */
export const elementOf = (vertex, slug, sortedLinks) =>
  'sha256:' + sha256hex(`${vertex}|${slug}|${[...sortedLinks].sort().join(',')}`);

/** Merkle root over sorted leaves — the packets rule from /sigil (odd promoted). */
export function merkleRoot(leaves) {
  let level = [...leaves].sort();
  if (!level.length) return null;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(i + 1 < level.length ? 'sha256:' + sha256hex(level[i] + '|' + level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
}
