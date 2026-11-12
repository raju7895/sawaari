/* OTP issue/verify. Codes are hashed (sha256 + pepper) before storage,
   expire after 10 minutes, allow max 5 attempts, single use. */
const crypto = require('crypto');
const config = require('../config');
const { query, one } = require('../db');
const { sendSms } = require('./sms');
const { httpError } = require('../utils');

const OTP_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;

const hash = (code, identifier) =>
  crypto.createHash('sha256').update(`${code}:${identifier}:${config.otpPepper}`).digest('hex');

async function issueOtp(identifier, purpose = 'register') {
  // throttle: max 1 request / 60s
  const recent = await one(
    `SELECT created_at FROM otp_codes WHERE identifier=$1 AND purpose=$2 AND created_at > now() - interval '60 seconds' LIMIT 1`,
    [identifier, purpose]
  );
  if (recent) throw httpError(429, 'Please wait a minute before requesting another OTP.');

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await query(
    `INSERT INTO otp_codes (identifier, purpose, code_hash, expires_at) VALUES ($1,$2,$3, now() + interval '${OTP_TTL_MIN} minutes')`,
    [identifier, purpose, hash(code, identifier)]
  );
  const text = `${code} is your Sawaari verification code. It expires in ${OTP_TTL_MIN} minutes. Never share this code.`;
  const result = await sendSms(identifier, text);
  return { devCode: result.dev || !result.delivered ? code : null };
}

async function verifyOtp(identifier, purpose, code) {
  const row = await one(
    `SELECT id, code_hash, attempts, expires_at, consumed_at FROM otp_codes
     WHERE identifier=$1 AND purpose=$2 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [identifier, purpose]
  );
  if (!row) throw httpError(400, 'No active OTP found. Please request a new code.');
  if (row.expires_at < new Date()) throw httpError(400, 'OTP expired. Please request a new code.');
  if (row.attempts >= MAX_ATTEMPTS) throw httpError(429, 'Too many wrong attempts. Request a new OTP.');
  if (row.code_hash !== hash(code, identifier)) {
    await query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id=$1`, [row.id]);
    throw httpError(400, 'Incorrect OTP.');
  }
  await query(`UPDATE otp_codes SET consumed_at = now() WHERE id=$1`, [row.id]);
  return true;
}

module.exports = { issueOtp, verifyOtp };
