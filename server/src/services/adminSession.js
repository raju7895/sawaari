/* Admin session lifecycle.

   Admin sessions are tracked server-side so they can be listed, revoked
   individually or all at once ("log out from every device"), and so an
   administrator's access can be cut instantly by suspending them.
   The JWT carries the session id (jti); every admin request checks the
   session row is still live. */
const jwt = require('jsonwebtoken');
const config = require('../config');
const { query, one } = require('../db');
const { httpError } = require('../utils');

const ABSOLUTE_TTL_HOURS = 12;   // hard expiry regardless of activity
const IDLE_TTL_HOURS = 2;        // sliding window for activity

function expiry() {
  return new Date(Date.now() + ABSOLUTE_TTL_HOURS * 3600 * 1000);
}

/** Create a session + signed token for an admin user. */
async function createSession({ adminUserId, ip, userAgent, role }) {
  const jti = require('crypto').randomUUID();
  const exp = expiry();
  await query(
    `INSERT INTO admin_sessions (admin_user_id, token_jti, ip_address, user_agent, expires_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [adminUserId, jti, ip || null, (userAgent || '').slice(0, 300), exp]
  );
  const token = jwt.sign(
    { sub: adminUserId, role, jti, scope: 'admin' },
    config.jwtSecret,
    { expiresIn: `${ABSOLUTE_TTL_HOURS}h`, issuer: 'sawaari-admin' }
  );
  return { token, jti, expiresAt: exp };
}

/** Validate that a session id is still active; refresh its activity window. */
async function isActive(jti) {
  if (!jti) return false;
  const row = await one(
    `SELECT id, expires_at, revoked_at FROM admin_sessions WHERE token_jti=$1`, [jti]
  );
  if (!row) return false;
  if (row.revoked_at) return false;
  if (new Date(row.expires_at) < new Date()) return false;
  await query(
    `UPDATE admin_sessions SET last_seen_at=now(),
       expires_at = LEAST(expires_at::timestamptz + interval '1 hour'::interval, ($2)::timestamptz)
     WHERE id=$1`,
    [row.id, expiry()]
  );
  return true;
}

/** Revoke one session (or all sessions of a user when id is omitted). */
async function revoke(adminUserId, sessionId = null, reason = 'revoked') {
  if (sessionId) {
    await query(
      `UPDATE admin_sessions SET revoked_at=now(), revoked_reason=$3
        WHERE id=$1 AND admin_user_id=$2 AND revoked_at IS NULL`,
      [sessionId, adminUserId, reason]
    );
    return;
  }
  await query(
    `UPDATE admin_sessions SET revoked_at=now(), revoked_reason=$2
      WHERE admin_user_id=$1 AND revoked_at IS NULL`,
    [adminUserId, reason]
  );
}

async function listSessions(adminUserId) {
  const { rows } = await query(
    `SELECT id, ip_address, user_agent, created_at, last_seen_at, expires_at, revoked_at, revoked_reason
       FROM admin_sessions WHERE admin_user_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [adminUserId]
  );
  return rows.map((r) => ({
    id: r.id,
    ip: r.ip_address,
    userAgent: r.user_agent,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    revokedReason: r.revoked_reason,
    active: !r.revoked_at && new Date(r.expires_at) > new Date(),
  }));
}

/** Purge sessions that expired long ago. */
async function cleanup() {
  await query(`DELETE FROM admin_sessions WHERE expires_at < now() - interval '7 days'`);
  await query(`DELETE FROM admin_login_attempts WHERE created_at < now() - interval '90 days'`);
}

module.exports = { createSession, isActive, revoke, listSessions, cleanup, ABSOLUTE_TTL_HOURS, IDLE_TTL_HOURS };
