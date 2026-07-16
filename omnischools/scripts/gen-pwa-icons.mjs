// Generates the Phase-1 placeholder PWA app icons — a gold "O" on navy, inside the
// maskable safe zone (tokens #C8975B on #1A2B47). No image dependency: a tiny hand-rolled
// PNG encoder (zlib + CRC32, both Node built-ins) keeps this portable and dep-free.
// Kofi Q4: placeholder mark ships install today; the owner swaps the real brand mark later.
// Run: node scripts/gen-pwa-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const NAVY = [26, 43, 71]; // #1A2B47
const GOLD = [200, 151, 91]; // #C8975B

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Anti-aliased coverage (0..1) that a pixel sits inside the gold ring, via 4×4 supersampling. */
function ringCoverage(px, py, size) {
  const cx = size / 2;
  const cy = size / 2;
  const outer = size * 0.33; // ring outer radius — inside the 40% maskable safe zone
  const inner = size * 0.205; // ring inner radius (the hole of the "O")
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const dx = px + (sx + 0.5) / 4 - cx;
      const dy = py + (sy + 0.5) / 4 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= outer && d >= inner) hits++;
    }
  }
  return hits / 16;
}

function renderPng(size) {
  // Raw RGBA scanlines with a leading filter byte (0 = none) per row.
  const rowBytes = size * 4 + 1;
  const raw = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const cov = ringCoverage(x, y, size);
      const r = Math.round(NAVY[0] + (GOLD[0] - NAVY[0]) * cov);
      const g = Math.round(NAVY[1] + (GOLD[1] - NAVY[1]) * cov);
      const b = Math.round(NAVY[2] + (GOLD[2] - NAVY[2]) * cov);
      const o = rowStart + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = 255; // fully opaque — full-bleed navy so it is valid as maskable
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "img");
for (const size of [192, 512]) {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, renderPng(size));
  console.log(`wrote ${file}`);
}
