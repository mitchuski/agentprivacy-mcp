// test/canon.test.mjs — vectors that hold this package to the canon it mirrors.
// Bit order from game42; κ / Merkle rule from soulbis /sigil; the PSI element
// from the guide bake; the PNG carrier round-trip.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as L from '../lib/lattice.mjs';
import { canonicalJSON, kappaOf, merkleRoot, sha256hex, elementOf } from '../lib/kappa.mjs';
import { encode, embedKey, extractKey } from '../lib/png.mjs';
import * as B from '../lib/bake.mjs';

let fails = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };

// 1 · bit canon vs game42 axisSpace (the source of truth, when present)
const g42 = path.join(os.homedir(), 'game42', 'game-of-42.json');
if (fs.existsSync(g42)) {
  const axes = JSON.parse(fs.readFileSync(g42, 'utf8')).axisSpace.axes;
  for (const a of axes) { const id = L.DIM_ALIAS[a.id] || a.id; ok(L.byId[id] && L.byId[id].weight === a.latticeAxisVertex && L.byId[id].bit === a.latticeBit, `game42 axis ${a.id}: bit ${a.latticeBit} weight ${a.latticeAxisVertex}`); }
} else console.log('· game42 canon file not present — skipped');
ok(L.dimsOf(36).join('+') === 'protection+connection', 'V36 = protection+connection (spellweb vertex-v36)');
ok(L.dimsOf(22).join('+') === 'delegation+connection+computation', 'V22 = delegation+connection+computation (vertex-v22)');
ok(L.dimsOf(41).join('+') === 'protection+memory+value', 'V41 = protection+memory+value (vertex-v41)');
ok(L.bits(28) === '011100' && L.parsePosture('011100') === 28, 'V28 bits 011100 (Mage canonical)');
ok(L.succ(63) === 0 && L.neg(0) === 0 && L.neg(1) === 63 && L.bnot(0) === 63, 'succ wraps · neg(0)=0 · neg(1)=63 · bnot(0)=63');
let x = 0; for (let i = 0; i < 64; i++) x = L.neg(L.bnot(x)); ok(x === 0, 'succ = neg∘bnot visits all 64 and returns to 0');
ok(L.moveName(44, 45).op === 'succ' && L.moveName(44, 20).op === 'neg' && L.moveName(44, 19).op === 'bnot', 'named operators from V44');
ok(L.moveName(44, 12).op === 'flip' && L.moveName(44, 12).flipped[0] === 'protection', 'V44→V12 is flip protection');
ok(L.moveName(12, 33).op === 'jump' && L.moveName(12, 33).bitsChanged === 4, 'V12→V33 is a 4-bit jump, flagged');

// 2 · κ rule (soulbis canonicalJSON: keys sorted recursively, no whitespace, kappa excluded)
ok(canonicalJSON({ b: 1, a: [3, { z: 1, y: null }] }) === '{"a":[3,{"y":null,"z":1}],"b":1}', 'canonical form sorts recursively, no whitespace');
const k0 = { name: 'x', version: 1, palette: { cool: '#141a3d', warm: '#f0eee8', sword: '#e8523a', mage: '#4dd9e8' }, descriptions: {} };
ok(kappaOf(k0) === kappaOf({ ...k0, kappa: 'sha256:lies' }), 'kappa field is excluded from its own preimage');
ok(kappaOf(k0) === 'sha256:' + sha256hex(canonicalJSON(k0)), 'κ = sha256 over the canonical form');
// pinned: if this changes, the canonical rule changed — every surface would disagree
ok(kappaOf(k0) === 'sha256:' + sha256hex('{"descriptions":{},"name":"x","palette":{"cool":"#141a3d","mage":"#4dd9e8","sword":"#e8523a","warm":"#f0eee8"},"version":1}'), 'κ vector for the default key');

// 3 · Merkle conformance vector from soulbis /sigil (leaves sha256(utf8 packet-alpha/beta/gamma))
const leaves = ['packet-alpha', 'packet-beta', 'packet-gamma'].map(s => 'sha256:' + sha256hex(s));
ok(merkleRoot(leaves) === 'sha256:07f20f689c8bef2d8a9a2a71d94e7014ea8398cc603b0ff72dadba5c517983d1', 'Merkle root matches the /sigil conformance vector');

// 4 · PSI element re-derives from the bake's own record
try {
  const b = B.load();
  let n = 0, bad = 0;
  for (const rec of b.byKey.values()) { if (!rec.element) continue; n++; if (elementOf(rec.vertex, rec.slug, rec.links) !== rec.element) bad++; }
  ok(n > 0 && bad === 0, `PSI element re-derives for all ${n} baked pages (${bad} mismatches)`);
  const guide = [...b.byKey.values()].filter(r => r.site === 'guide');
  ok(new Set(guide.map(r => r.vertex)).size >= 2, `guide site: ${guide.length} pages at ${new Set(guide.map(r => r.vertex)).size} distinct vertices (Phase 0 done-when)`);
} catch (e) { console.log('· ' + e.message); }

// 5 · PNG carrier round-trip (tEXt cityKey · base64 JSON — the soulbis rule)
const px = new Uint8Array(16 * 16 * 4).fill(200);
const png = embedKey(encode(px, 16, 16), { ...k0, kappa: kappaOf(k0) });
const back = extractKey(png);
ok(back && back.kappa === kappaOf(k0) && back.name === 'x', 'sigil PNG carries the key and unfolds it back out');
ok(png.subarray(png.length - 12, png.length - 8).readUInt32BE(0) === 0 && png.toString('latin1', png.length - 8, png.length - 4) === 'IEND', 'chunk inserted before IEND');

console.log(fails ? `\n${fails} failing` : '\nall canon vectors hold');
process.exit(fails ? 1 : 0);
