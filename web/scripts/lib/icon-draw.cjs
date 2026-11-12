/* Shared icon rasteriser: draws the Sawaari mark and encodes PNGs.
 * No image libraries — just zlib and a small PNG writer. */
const zlib = require('zlib');

/* ── PNG encoder (RGBA, 8 bit) ─────────────────────────────── */
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
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;   // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── drawing ────────────────────────────────────────────────── */
const BRAND = [13, 148, 136];       // #0d9488
const BRAND_DARK = [15, 118, 110];  // #0f766e
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
 * Sawaari mark.
 * @param {number} size     pixel size
 * @param {object} opts     { maskable, adaptive, transparent }
 *   maskable    — fills the whole tile (Android adaptive safe zone)
 *   adaptive    — logo centred on transparency, sized for a 108dp canvas
 * @returns {Buffer} raw RGBA pixels
 */
function rasterize(size, opts = {}) {
  const { maskable = false, adaptive = false, transparent = false } = opts;
  const SS = 4;
  const W = size * SS;
  const data = Buffer.alloc(size * size * 4);

  // geometry in normalised units
  const bodyX0 = 0.18, bodyX1 = 0.82, bodyY0 = 0.44, bodyY1 = 0.66;
  const cabinX0 = 0.28, cabinX1 = 0.70, cabinY0 = 0.28, cabinY1 = 0.46;
  const roofX0 = 0.40, roofX1 = 0.60, roofY0 = 0.20, roofY1 = 0.30;
  const wheelR = 0.085;
  const wheel1 = [0.32, 0.70], wheel2 = [0.68, 0.70];

  // for the adaptive foreground the logo occupies the middle ~62% of the canvas
  const g = adaptive ? { x: 0.19, y: 0.19, s: 0.62 } : { x: 0, y: 0, s: 1 };
  const gx = (v) => g.x + v * g.s;
  const gy = (v) => g.y + v * g.s;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, gg = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px * SS + sx + 0.5) / W;
          const y = (py * SS + sy + 0.5) / W;
          let colour = null;

          if (adaptive) {
            // transparent canvas with the white logo only
            if (inRect(x, y, gx(bodyX0), gy(bodyY0), gx(bodyX1), gy(bodyY1))
              || inRect(x, y, gx(cabinX0), gy(cabinY0), gx(cabinX1), gy(cabinY1))
              || inRect(x, y, gx(roofX0), gy(roofY0), gx(roofX1), gy(roofY1))
              || inCircle(x, y, gx(wheel1[0]), gy(wheel1[1]), wheelR * g.s)
              || inCircle(x, y, gx(wheel2[0]), gy(wheel2[1]), wheelR * g.s)) {
              colour = WHITE;
            }
          } else {
            const radius = maskable ? W * 0.5 : W * 0.22;
            if (!inRounded(x * W, y * W, W, radius)) {
              colour = null;
            } else if (inRect(x, y, bodyX0, bodyY0, bodyX1, bodyY1)
              || inRect(x, y, cabinX0, cabinY0, cabinX1, cabinY1)
              || inRect(x, y, roofX0, roofY0, roofX1, roofY1)
              || inCircle(x, y, wheel1[0], wheel1[1], wheelR)
              || inCircle(x, y, wheel2[0], wheel2[1], wheelR)) {
              colour = WHITE;
            } else {
              colour = [
                Math.round(BRAND[0] + (BRAND_DARK[0] - BRAND[0]) * y),
                Math.round(BRAND[1] + (BRAND_DARK[1] - BRAND[1]) * y),
                Math.round(BRAND[2] + (BRAND_DARK[2] - BRAND[2]) * y),
              ];
            }
          }
          if (colour) { r += colour[0]; gg += colour[1]; b += colour[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      if (a > 0) {
        data[i] = Math.round(r / (a / 255));
        data[i + 1] = Math.round(gg / (a / 255));
        data[i + 2] = Math.round(b / (a / 255));
        data[i + 3] = Math.round(a / n);
      }
    }
  }
  return data;   // raw RGBA — encode with encodePng()
}

/** Encoded PNG of the Sawaari mark. */
function drawIcon(size, opts = {}) {
  return encodePng(size, size, rasterize(size, opts));
}

/**
 * Splash artwork: the brand mark centred on the dark app background.
 * @param {number} width  canvas width
 * @param {number} height canvas height
 * @param {number} logoSize size of the logo square in pixels
 */
function drawSplash(width, height, logoSize) {
  const SS = 2;
  const W = width * SS;
  const H = height * SS;
  const size = logoSize * SS;
  const data = Buffer.alloc(width * height * 4);

  // the logo is rasterised once, then composited
  const logo = rasterize(size, {});
  const logoSizePx = size;
  const offX = Math.round((W - logoSizePx) / 2);
  const offY = Math.round((H - logoSizePx) / 2);

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4;
      // background: deep slate with a subtle vertical gradient
      const t = py / height;
      let r = Math.round(15 + (10 - 15) * t);
      let g = Math.round(23 + (26 - 23) * t);
      let b = Math.round(42 + (46 - 42) * t);
      let a = 255;

      const lx = px * SS - offX;
      const ly = py * SS - offY;
      if (lx >= 0 && ly >= 0 && lx < logoSizePx && ly < logoSizePx) {
        const li = (ly * logoSizePx + lx) * 4;
        const la = logo[li + 3];
        if (la > 0) {
          const alpha = la / 255;
          r = Math.round(logo[li] * alpha + r * (1 - alpha));
          g = Math.round(logo[li + 1] * alpha + g * (1 - alpha));
          b = Math.round(logo[li + 2] * alpha + b * (1 - alpha));
        }
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return encodePng(width, height, data);
}

module.exports = { drawIcon, drawSplash, rasterize, encodePng, crc32 };
