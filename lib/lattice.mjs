// lib/lattice.mjs — the 64-vertex sovereignty lattice ℒ = ℤ/64ℤ.
//
// Bit canon (game42 data/game-of-42.json axisSpace · AXIOMS A1; soulbis /sigil;
// agentprivacy_master lib/lattice-vertex.ts; spellweb vertex nodes; the guide's
// tools/lattice.mjs — all agree, and test/canon.test.mjs holds them to it):
//   d1 protection  = bit 5 = 32     d4 connection  = bit 2 = 4
//   d2 delegation  = bit 4 = 16     d5 computation = bit 1 = 2
//   d3 memory      = bit 3 = 8      d6 value       = bit 0 = 1
// A vertex's binary string b5b4b3b2b1b0 reads d1..d6 left to right.

export const N = 64;
export const DIMS = [
  { d: 1, id: 'protection',  bit: 5, weight: 32, glyph: '🛡️', label: 'Protection'  },
  { d: 2, id: 'delegation',  bit: 4, weight: 16, glyph: '🤝', label: 'Delegation'  },
  { d: 3, id: 'memory',      bit: 3, weight: 8,  glyph: '📜', label: 'Memory'      },
  { d: 4, id: 'connection',  bit: 2, weight: 4,  glyph: '🔗', label: 'Connection'  },
  { d: 5, id: 'computation', bit: 1, weight: 2,  glyph: '⚡', label: 'Computation' },
  { d: 6, id: 'value',       bit: 0, weight: 1,  glyph: '💎', label: 'Value'       },
];
export const DIM_ALIAS = { compute: 'computation', computing: 'computation', protect: 'protection',
  delegate: 'delegation', connect: 'connection', remember: 'memory', worth: 'value' };
export const byId = Object.fromEntries(DIMS.map(x => [x.id, x]));

export const succ = x => (x + 1) & 63;            // the wheel — visits all 64, returns to 0
export const neg  = x => (64 - x) & 63;           // ⚔️ Swordsman reflection
export const bnot = x => 63 - x;                  // 🧙 Mage antipode  (succ = neg∘bnot)
export const OPS = { succ, neg, bnot };
export const popcount = x => { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; };
export const stratum = popcount;
export const bits = x => x.toString(2).padStart(6, '0');
export const fromBits = s => (/^[01]{6}$/.test(s) ? parseInt(s, 2) : null);
export const dimsOf = x => DIMS.filter(d => x & d.weight).map(d => d.id);
export const isVertex = x => Number.isInteger(x) && x >= 0 && x < 64;

export function vertexFromDims(list) {
  let v = 0;
  for (let id of list) { id = String(id).toLowerCase().trim(); id = DIM_ALIAS[id] || id;
    const d = byId[id]; if (!d) return { error: `unknown dimension: ${id}` }; v |= d.weight; }
  return { vertex: v };
}
/** "101100" | "protection memory" | "d1 d3" | "V36" | 36 → vertex or null. */
export function parsePosture(raw) {
  if (isVertex(raw)) return raw;
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^[01]{6}$/.test(s)) return fromBits(s);
  const mv = s.match(/^v?(\d{1,2})$/i); if (mv) { const n = +mv[1]; return isVertex(n) ? n : null; }
  const toks = s.split(/[\s,+·|]+/).filter(Boolean).map(t => t.replace(/^d([1-6])$/i, (_, k) => DIMS[+k - 1].id));
  const r = vertexFromDims(toks); return r.error ? null : r.vertex;
}
/**
 * Name the lattice move a → b: the three operators first, then a single
 * bit-flip (a Hamming-1 edge of ∂M), otherwise a multi-bit jump, flagged.
 */
export function moveName(a, b) {
  if (!isVertex(a) || !isVertex(b)) return { op: 'none', flipped: [] };
  if (a === b) return { op: 'stay', flipped: [] };
  const x = a ^ b, flipped = DIMS.filter(d => x & d.weight).map(d => d.id);
  if (b === succ(a)) return { op: 'succ', flipped };
  if (b === neg(a))  return { op: 'neg',  flipped };
  if (b === bnot(a)) return { op: 'bnot', flipped };
  if (flipped.length === 1) return { op: 'flip', flipped };
  return { op: 'jump', flipped, bitsChanged: flipped.length };
}
export const moveLabel = m => m.op === 'flip' ? `flip ${m.flipped[0]}`
  : m.op === 'jump' ? `jump ×${m.bitsChanged} (${m.flipped.join(' ')})` : m.op;

/** A derived reading of a vertex, when no key describes it (mirrors /lattice). */
export function reading(x) {
  const s = popcount(x), STRATA = [1, 6, 15, 20, 15, 6, 1];
  return `Stratum ${s} of 6. ${s} of six dimensions held (${dimsOf(x).join(', ') || 'none'}); ${6 - s} open. `
    + `One of ${STRATA[s]} states at this depth. neg ⚔️ ${neg(x)} · bnot 🧙 ${bnot(x)} · succ 😊 ${succ(x)}.`;
}
