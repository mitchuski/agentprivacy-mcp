// lib/sigil.mjs — sigil.render: the κ as a lighting of the 64, drawn into a PNG
// that CARRIES the key (tEXt 'cityKey', base64 JSON — the soulbis carrier rule),
// so /star, /lattice and /sigil unfold it back out and re-derive the κ (L5).
//
// The correspondence (soulbis /sigil): SHA-256 = 64 hex glyphs = one per vertex
// of ℒ = ℤ/64ℤ. Glyph x = hex[x] of the RE-DERIVED κ — never the stamped claim.
// Light = the glyph (0..f), colour = the key's palette by stratum (cool→warm),
// lit vertices ring in sword coral, walked vertices ring in mage cyan.
// No font rendering here (zero-dep): the name + κ caption ride in the chunk.
import { encode, embedKey } from './png.mjs';
import { kappaOf } from './kappa.mjs';
import { popcount, isVertex } from './lattice.mjs';

const hex2rgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lerp = (a, b, t) => a + (b - a) * t;

export function render(key, { size = 512 } = {}) {
  const kappa = kappaOf(key), hex = kappa.slice(7);
  const pal = key.palette || {};
  const cool = hex2rgb(pal.cool) || [20, 26, 61], warm = hex2rgb(pal.warm) || [240, 238, 232];
  const sword = hex2rgb(pal.sword) || [232, 82, 58], mage = hex2rgb(pal.mage) || [77, 217, 232];
  const lit = new Set(Array.isArray(key.lit) ? key.lit : []);
  const walked = new Set(); for (const w of (key.walks || [])) for (const st of (w.steps || [])) if (isVertex(st.vertex)) walked.add(st.vertex);

  const W = size, H = size, px = new Uint8Array(W * H * 4);
  const bg = [8, 12, 32];
  for (let i = 0; i < W * H; i++) { px[i * 4] = bg[0]; px[i * 4 + 1] = bg[1]; px[i * 4 + 2] = bg[2]; px[i * 4 + 3] = 255; }
  const blend = (x, y, rgb, a) => { if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return; const i = (y * W + x) * 4;
    px[i] = Math.round(lerp(px[i], rgb[0], a)); px[i + 1] = Math.round(lerp(px[i + 1], rgb[1], a)); px[i + 2] = Math.round(lerp(px[i + 2], rgb[2], a)); };
  const disc = (cx, cy, r, rgb, alpha = 1, soft = 1.5) => {
    for (let y = Math.floor(cy - r - soft); y <= Math.ceil(cy + r + soft); y++) for (let x = Math.floor(cx - r - soft); x <= Math.ceil(cx + r + soft); x++) {
      const d = Math.hypot(x - cx, y - cy); if (d > r + soft) continue;
      blend(x, y, rgb, alpha * (d <= r ? 1 : 1 - (d - r) / soft)); } };
  const ring = (cx, cy, r, w, rgb, alpha = 1) => {
    for (let y = Math.floor(cy - r - w); y <= Math.ceil(cy + r + w); y++) for (let x = Math.floor(cx - r - w); x <= Math.ceil(cx + r + w); x++) {
      const d = Math.abs(Math.hypot(x - cx, y - cy) - r); if (d > w) continue; blend(x, y, rgb, alpha * (1 - d / w)); } };

  const cx = W / 2, cy = H / 2, R = W * 0.36;
  // faint six-petal envelope (n = 6, one per dimension) — the ring's stance
  ring(cx, cy, R, 1.2, [60, 70, 120], 0.5);
  for (let x = 0; x < 64; x++) {
    const g = parseInt(hex[x], 16), t = popcount(x) / 6, th = (x / 64) * Math.PI * 2 - Math.PI / 2;
    const petal = 1 + 0.06 * Math.cos(6 * th);
    const px0 = cx + Math.cos(th) * R * petal, py0 = cy + Math.sin(th) * R * petal;
    const col = [0, 1, 2].map(i => lerp(cool[i], warm[i], t));
    const inten = 0.12 + 0.88 * g / 15, rad = (W / 512) * (3 + 7 * g / 15);
    disc(px0, py0, rad * 2.2, col, inten * 0.25, rad);           // glow
    disc(px0, py0, rad, col, inten);                              // the glyph
    if (lit.has(x)) ring(px0, py0, rad + 3.5, 1.4, sword, 0.95);
    if (walked.has(x)) ring(px0, py0, rad + 6.5, 1.2, mage, 0.9);
  }
  // centre: a small κ-coloured seal — the first four glyphs as four dots
  for (let i = 0; i < 4; i++) { const g = parseInt(hex[i], 16); disc(cx - 18 + i * 12, cy, 3 + 2 * g / 15, warm, 0.35 + 0.65 * g / 15); }

  const png = encode(px, W, H);
  const carried = { ...key }; delete carried.kappa; carried.kappa = kappa;   // the PNG carries the key with its κ stamped
  return { png: embedKey(png, carried), kappa, glyphs: hex, lit: [...lit].sort((a, b) => a - b), walked: [...walked].sort((a, b) => a - b), size };
}
