// lib/key.mjs — pure functions over a City Key (the v1 wire format minted on
// agentprivacy /city, consumed by soulbis /star, /lattice, /sigil).
//
//   { name, version:1, palette:{cool,warm,sword,mage}, descriptions:{"0".."63"},
//     lit?, focus?, identity?, trace?, witness?, geometry?, figures?, packets?,
//     charts?, prior?, did?, kappa?, walks? }
//
// `walks` is the additive field this lane introduces (consumers ignore unknown
// fields per the spec's extensibility clause): the walks the bearer — human on
// the star chart / spellweb, or their Mage — has taken across the guide, each
// step naming a page by slug with the vertex it was seated at and the PSI
// element derived from it. A walk is content: appending one moves the κ and
// chains `prior` to the ancestor (C87: the key accumulates).
//
// Everything here is deterministic: no timestamps, no randomness. The same key
// and the same walk give the same evolved key and the same κ, whoever calls.
import fs from 'node:fs';
import { canonicalJSON, kappaOf, verifyKappa, stamp, sha256hex, elementOf } from './kappa.mjs';
import { extractKey } from './png.mjs';
import { moveName, moveLabel, isVertex, popcount } from './lattice.mjs';
import { resolveWalk } from './bake.mjs';

/** Palette reconciled to the soulbis canon (agentprivacy_master lib/city-key.ts). */
export const PALETTE = { cool: '#141a3d', warm: '#f0eee8', sword: '#e8523a', mage: '#4dd9e8' };
export const defaultKey = (name = 'city key') => ({ name, version: 1, palette: { ...PALETTE }, descriptions: {} });

/** Accept a key as object · JSON text · PNG (Buffer, data: URL, base64) · file path. */
export function parseKeyInput(input) {
  if (input == null) return { error: 'no key given' };
  if (Buffer.isBuffer(input)) { const k = extractKey(input); return k ? { key: k, carrier: 'png' } : { error: 'PNG carries no City Key' }; }
  if (typeof input === 'object') return { key: input, carrier: 'json' };
  let s = String(input).trim();
  if (s.startsWith('data:image/png;base64,')) s = s.slice(22);
  if (/^iVBOR/.test(s)) return parseKeyInput(Buffer.from(s, 'base64'));
  if (s.startsWith('{')) { try { return { key: JSON.parse(s), carrier: 'json' }; } catch (e) { return { error: 'bad JSON: ' + e.message }; } }
  if (fs.existsSync(s)) {
    const buf = fs.readFileSync(s);
    if (buf[0] === 0x89 && buf[1] === 0x50) return parseKeyInput(buf);
    return parseKeyInput(buf.toString('utf8'));
  }
  return { error: 'not a City Key: expected JSON, a sigil PNG, or a path to one' };
}
export function isCityKey(o) { return !!o && typeof o === 'object' && o.version === 1 && typeof o.palette === 'object' && typeof o.descriptions === 'object'; }

/** L5 — verification is re-derivation. */
export function derive(key) {
  const v = verifyKappa(key);
  const canon = canonicalJSON((() => { const c = { ...key }; delete c.kappa; return c; })());
  const hex = v.derived.slice(7);
  const walked = new Set(), litSet = new Set(Array.isArray(key.lit) ? key.lit : []);
  for (const w of (key.walks || [])) for (const st of (w.steps || [])) if (isVertex(st.vertex)) walked.add(st.vertex);
  return {
    name: key.name || null, version: key.version ?? null, isCityKey: isCityKey(key),
    kappa: v.verdict, derived: v.derived, stamped: v.stamped, prior: typeof key.prior === 'string' ? key.prior : null,
    canonicalBytes: Buffer.byteLength(canon, 'utf8'),
    glyphs: hex,                                       // 64 hex glyphs, one per vertex in succ order
    lit: [...litSet].sort((a, b) => a - b), walked: [...walked].sort((a, b) => a - b),
    described: Object.keys(key.descriptions || {}).length, walks: (key.walks || []).length,
    identity: key.identity?.displayName || key.identity?.publicKeyHex?.slice(0, 16) || null,
    did: key.did || null,
  };
}

/** Digest of a walk: sha256 over its canonical steps (site·slug·vertex·element). */
export const walkDigest = steps => 'sha256:' + sha256hex(canonicalJSON(steps.map(s => ({ site: s.site, slug: s.slug, vertex: s.vertex, element: s.element }))));

/**
 * key.evolve — append a walk. Returns the evolved key with `prior` set to the
 * κ of the key it grew from (stamped if present, else re-derived), and its own
 * κ stamped. Unsigned: a Swordsman signs it (Rung 1), not this function.
 */
export function evolve(key, walk, { name = null, chart = 'https://guide.agentprivacy.ai/star-chart/' } = {}) {
  if (!isCityKey(key)) return { error: 'not a City Key v1 (needs version:1, palette, descriptions)' };
  const r = resolveWalk(walk);
  if (!r.steps.length) return { error: 'the walk names no baked page' + (r.missing.length ? ' — missing: ' + r.missing.join(', ') : '') };
  const steps = r.steps.map(s => ({ site: s.site, slug: s.slug, vertex: s.vertex,
    element: s.element || elementOf(s.vertex, s.slug, []) , ...(s.unbaked ? { unbaked: true } : {}) }));
  const moves = steps.slice(1).map((s, i) => moveLabel(moveName(steps[i].vertex, s.vertex)));
  const entry = { chart, steps, digest: walkDigest(steps), moves, ...(name ? { name } : {}) };
  const priorK = typeof key.kappa === 'string' ? key.kappa : kappaOf(key);
  const next = { ...key }; delete next.kappa;
  next.walks = [...(key.walks || []), entry];
  next.prior = priorK;
  const out = stamp(next);
  return { key: out, kappa: out.kappa, prior: priorK, walk: entry, missing: r.missing,
    strata: steps.map(s => popcount(s.vertex)), vertices: steps.map(s => s.vertex) };
}

/** compare.plain — the ∩ of two keys' walked / lit vertices, in the open. DEVELOPMENT ONLY. */
export function comparePlain(a, b) {
  const walked = k => { const s = new Set(); for (const w of (k.walks || [])) for (const st of (w.steps || [])) if (isVertex(st.vertex)) s.add(st.vertex); return s; };
  const lit = k => new Set(Array.isArray(k.lit) ? k.lit : []);
  const A = new Set([...walked(a), ...lit(a)]), B = new Set([...walked(b), ...lit(b)]);
  const both = [...A].filter(x => B.has(x)).sort((x, y) => x - y);
  const elA = new Set(), elB = new Set();
  for (const w of (a.walks || [])) for (const st of (w.steps || [])) if (st.element) elA.add(st.element);
  for (const w of (b.walks || [])) for (const st of (w.steps || [])) if (st.element) elB.add(st.element);
  const elements = [...elA].filter(e => elB.has(e));
  return { kappaA: kappaOf(a), kappaB: kappaOf(b), intersectionVertices: both,
    aOnly: [...A].filter(x => !B.has(x)).sort((x, y) => x - y), bOnly: [...B].filter(x => !A.has(x)).sort((x, y) => x - y),
    intersectionElements: elements.length, sybilDial: { revealed: both.length, private: 64 - both.length },
    warning: 'plain comparison reads both keys in full — Rung 3 (DH-PSI) replaces this; disabled when VTA_MODE=1' };
}
