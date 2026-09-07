// lib/png.mjs — a zero-dependency PNG writer/reader, enough for a sigil.
//
// encode(rgba, w, h)           → PNG bytes (8-bit RGBA, zlib via node:zlib)
// withTextChunk(png, kw, text) → PNG with a tEXt chunk inserted before IEND
// readTextChunks(png)          → { keyword: text } from tEXt AND iTXt chunks
//
// The carrier rule is soulbis's: keyword 'cityKey', payload = base64(JSON) in a
// tEXt chunk before IEND, so /star, /lattice and /sigil unfold the key back out.
// The guide star chart's keepsake writes iTXt 'citykey' (raw JSON) instead; the
// reader accepts both, so key.derive can read either carrier.
import zlib from 'node:zlib';

const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
export const crc32 = buf => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

/** rgba: Buffer/Uint8Array of w*h*4 bytes. */
export function encode(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA, no interlace
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function withTextChunk(png, keyword, text) {
  const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]);
  const iend = png.length - 12;   // a well-formed PNG ends with the 12-byte IEND chunk
  return Buffer.concat([png.subarray(0, iend), chunk('tEXt', data), png.subarray(iend)]);
}

export function readTextChunks(png) {
  const out = {};
  if (png.length < 20 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4E || png[3] !== 0x47) return out;
  let p = 8;
  while (p + 12 <= png.length) {
    const len = png.readUInt32BE(p), type = png.toString('latin1', p + 4, p + 8), data = png.subarray(p + 8, p + 8 + len);
    if (type === 'tEXt') { const z = data.indexOf(0); if (z > 0) out[data.toString('latin1', 0, z)] = data.toString('latin1', z + 1); }
    else if (type === 'iTXt') {
      // keyword NUL compFlag compMethod NUL(lang) NUL(translated) text
      const z = data.indexOf(0); if (z > 0) {
        const comp = data[z + 1]; let q = z + 3;
        const l1 = data.indexOf(0, q); const l2 = data.indexOf(0, l1 + 1);
        const body = data.subarray(l2 + 1);
        try { out[data.toString('latin1', 0, z)] = (comp ? zlib.inflateSync(body) : body).toString('utf8'); } catch {}
      }
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return out;
}

/** Pull a City Key out of a PNG: soulbis 'cityKey' (base64 JSON) or chart 'citykey' (JSON). */
export function extractKey(png) {
  const t = readTextChunks(png);
  if (t.cityKey) { try { return JSON.parse(Buffer.from(t.cityKey, 'base64').toString('utf8')); } catch {} }
  if (t.citykey) { try { return JSON.parse(t.citykey); } catch {} }
  return null;
}
export function embedKey(png, key) {
  return withTextChunk(png, 'cityKey', Buffer.from(JSON.stringify(key), 'utf8').toString('base64'));
}
