// lib/merkle-kappa.mjs — the κ registry's Merkle tree (kappa-core merkle.rs;
// kappa_evidence_mage kappa.py merkle_root / merkle_proof / merkle_verify),
// the tree a Star Hold uses from agentprivacy.star-hold/2.
//
// Leaves and interior nodes are hashed under different tags — sha256(0x00 ‖ leaf)
// and sha256(0x01 ‖ left ‖ right) — so no interior node can be presented as a
// leaf. That is the separation the /1 tree lacked (its leaves and nodes were
// both plain sha256 over text) and the hypothesis formal_mage's
// Formal.Merkle.disclosure_sound proves soundness under. An odd last node is
// paired with itself, as merkle.rs does; that is safe only because a Hold's
// leaves are its refs, sorted and unique (holdRootV2 enforces both).
import crypto from 'node:crypto';

const sha = (...parts) => crypto.createHash('sha256').update(Buffer.concat(parts)).digest();
export const hashLeaf = (data) => sha(Buffer.from([0x00]), data);
export const hashNode = (l, r) => sha(Buffer.from([0x01]), l, r);

/** Root over leaf byte strings, in the order given; null for none. */
export function merkleRootBytes(leaves) {
  if (!leaves.length) return null;
  let level = leaves.map(hashLeaf);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(hashNode(level[i], level[i + 1] ?? level[i]));
    level = next;
  }
  return level[0];
}

/** (sibling, siblingIsLeft) pairs from the leaf level up, as merkle.rs builds them. */
export function merkleProofBytes(leaves, index) {
  if (index < 0 || index >= leaves.length) return null;
  let level = leaves.map(hashLeaf); const proof = [];
  while (level.length > 1) {
    let sib = index ^ 1; if (sib >= level.length) sib = index;
    proof.push({ sibling: level[sib], left: sib < index });
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(hashNode(level[i], level[i + 1] ?? level[i]));
    level = next; index = Math.floor(index / 2);
  }
  return proof;
}

export function merkleVerifyBytes(root, leaf, proof) {
  let cur = hashLeaf(leaf);
  for (const s of proof) cur = s.left ? hashNode(s.sibling, cur) : hashNode(cur, s.sibling);
  return Buffer.compare(cur, root) === 0;
}

// ---- the Hold's use of it: leaves are the item refs as UTF-8, sorted, unique ----
const refLeaves = (refs) => {
  const sorted = [...refs].sort();
  for (let i = 1; i < sorted.length; i++) if (sorted[i] === sorted[i - 1]) throw new Error('duplicate-item: two items share a ref');
  return sorted;
};
export function holdRootV2(refs) {
  if (!refs.length) return null;
  return 'sha256:' + merkleRootBytes(refLeaves(refs).map((r) => Buffer.from(r, 'utf8'))).toString('hex');
}
/** The inclusion proof for one ref, as hex pairs a verifier can carry in JSON. */
export function holdProofV2(refs, ref) {
  const sorted = refLeaves(refs); const i = sorted.indexOf(ref);
  if (i < 0) return null;
  return merkleProofBytes(sorted.map((r) => Buffer.from(r, 'utf8')), i).map((s) => ({ sibling: s.sibling.toString('hex'), left: s.left }));
}
export function holdVerifyV2(root, ref, proof) {
  if (!/^sha256:[0-9a-f]{64}$/.test(root ?? '') || !Array.isArray(proof)) return false;
  if (!proof.every((s) => /^[0-9a-f]{64}$/.test(s?.sibling ?? '') && typeof s.left === 'boolean')) return false;
  return merkleVerifyBytes(Buffer.from(root.slice(7), 'hex'), Buffer.from(ref, 'utf8'), proof.map((s) => ({ sibling: Buffer.from(s.sibling, 'hex'), left: s.left })));
}
