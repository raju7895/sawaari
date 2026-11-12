/* Small crypto helpers for admin secrets:
   - AES-256-GCM encryption at rest (TOTP shared secrets)
   - RFC 6238 TOTP (Google Authenticator / Authy compatible)
   - Base32 encoding for the TOTP secret
   Nothing here ever leaves the server. */
const crypto = require('crypto');
const config = require('../config');

const KEY = crypto.createHash('sha256')
  .update(config.admin.totpEncryptionKey || config.jwtSecret)
  .digest();

/* ── AES-256-GCM ─────────────────────────────────────────── */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(payload) {
  if (!payload) return null;
  try {
    const [version, ivB64, tagB64, dataB64] = String(payload).split(':');
    if (version !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/* ── Base32 (RFC 4648, no padding) ───────────────────────── */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/* ── TOTP (RFC 6238, SHA-1, 6 digits, 30s step) ──────────── */
function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

function totp(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30);
  return hotp(base32Decode(secret), counter);
}

/** Verify a TOTP code allowing ±1 time step (clock drift). */
function verifyTotp(secret, code, window = 1) {
  if (!secret || !code) return false;
  const cleaned = String(code).replace(/\D/g, '');
  if (cleaned.length !== 6) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    const candidate = hotp(base32Decode(secret), counter + i);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(cleaned))) return true;
  }
  return false;
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/** otpauth:// URI for authenticator apps. */
function totpUri({ secret, email, issuer = 'Sawaari' }) {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/* ── Backup codes ────────────────────────────────────────── */
function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = {
  encrypt, decrypt, base32Encode, base32Decode,
  totp, verifyTotp, generateTotpSecret, totpUri,
  generateBackupCodes, randomToken,
};
