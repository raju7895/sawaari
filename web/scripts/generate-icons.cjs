/* Generates the PWA / launcher icons without any image library.
 *
 * Draws the Sawaari mark: a teal rounded square with a white auto-rickshaw
 * silhouette, rendered with 4x supersampling for clean edges, then encoded
 * as a PNG with Node's built-in zlib.
 *
 * Usage: node scripts/generate-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ── tiny PNG encoder (RGBA, 8 bit) ─────────────────────────── */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── drawing helpers ─────────────────────────────────────────── */
const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const BRAND = hex('#0d9488');   // teal
const BRAND_DARK = hex('#0f766e');
const WHITE = [255, 255, 255];

const inRounded = (x, y, size, radius) => {
  const r = radius;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
};

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/**
 * Sawaari mark: rounded teal tile, white auto-rickshaw (body, cabin, canopy,
 * one wheel) — recognisable at 48px.
 */
function drawIcon(size, { maskable = false } = {}) {
  const SS = 4;                       // supersampling factor
  const W = size * SS;
  const data = Buffer.alloc(size * size * 4);
  const radius = maskable ? W * 0.5 : W * 0.22;  // maskable icons fill the tile

  // geometry in normalised units of the canvas
  const bodyX0 = 0.18, bodyX1 = 0.82, bodyY0 = 0.44, bodyY1 = 0.66;
  const cabinX0 = 0.28, cabinX1 = 0.70, cabinY0 = 0.28, cabinY1 = 0.46;
  const roofX0 = 0.40, roofX1 = 0.60, roofY0 = 0.20, roofY1 = 0.30;
  const wheelR = 0.085;
  const wheel1 = [0.32, 0.70], wheel2 = [0.68, 0.70];

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px * SS + sx + 0.5) / W;
          const y = (py * SS + sy + 0.5) / W;
          let colour = null;
          if (!inRounded(x * W, y * W, W, radius)) {
            colour = null; // transparent
          } else if (inRect(x, y, bodyX0, bodyY0, bodyX1, bodyY1)
            || inRect(x, y, cabinX0, cabinY0, cabinX1, cabinY1)
            || inRect(x, y, roofX0, roofY0, roofX1, roofY1)
            || inCircle(x, y, wheel1[0], wheel1[1], wheelR)
            || inCircle(x, y, wheel2[0], wheel2[1], wheelR)) {
            colour = WHITE;
          } else {
            // subtle vertical gradient on the tile
            const t = y;
            colour = [
              Math.round(BRAND[0] + (BRAND_DARK[0] - BRAND[0]) * t),
              Math.round(BRAND[1] + (BRAND_DARK[1] - BRAND[1]) * t),
              Math.round(BRAND[2] + (BRAND_DARK[2] - BRAND[2]) * t),
            ];
          }
          if (colour) { r += colour[0]; g += colour[1]; b += colour[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      if (a > 0) {
        data[i] = Math.round(r / (a / 255));
        data[i + 1] = Math.round(g / (a / 255));
        data[i + 2] = Math.round(b / (a / 255));
        data[i + 3] = Math.round(a / n);
      }
    }
  }
  return encodePng(size, size, data);
}

/* ── write the icon set ──────────────────────────────────────── */
const outDir = path.join(__dirname, '..', '..', 'web', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const files = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-192.png', 192, { maskable: true }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
  ['favicon-64.png', 64, {}],
];

for (const [name, size, opts] of files) {
  const png = drawIcon(size, opts);
  fs.writeFileSync(path.join(outDir, name), png);
  console.log(`  ✔ ${name.padEnd(26)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
console.log(`icons written to ${outDir}`);
