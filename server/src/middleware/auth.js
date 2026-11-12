const jwt = require('jsonwebtoken');
const config = require('../config');
const { one } = require('../db');
const { httpError } = require('../utils');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.name }, config.jwtSecret, { expiresIn: '7d' });
}

/** Express middleware: require a valid Bearer token */
async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw httpError(401, 'Authentication required');
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw httpError(401, 'Session expired or invalid. Please log in again.');
    }

    /* Administrator sessions are tracked server-side so they can be revoked
       and so a suspended administrator loses access immediately. */
    if (payload.scope === 'admin') {
      const sessions = require('../services/adminSession');
      const active = await sessions.isActive(payload.jti);
      if (!active) throw httpError(401, 'Your administrator session has expired or was signed out.');
    }

    const user = await one(
      `SELECT u.id, u.role, u.name, u.phone, u.email, u.avatar_url, u.is_active, u.phone_verified
       FROM users u WHERE u.id = $1`, [payload.sub]
    );
    if (!user) throw httpError(401, 'Account not found');
    if (!user.is_active) throw httpError(403, 'Your account has been blocked. Contact support.');

    // A suspended administrator is refused even with a valid token.
    if (payload.scope === 'admin') {
      const admin = await one(`SELECT status FROM admin_profiles WHERE user_id = $1`, [user.id]);
      if (!admin || admin.status !== 'active') {
        throw httpError(403, 'This administrator account is suspended.');
      }
    }

    req.user = user;
    req.sessionScope = payload.scope || 'app';
    next();
  } catch (err) { next(err); }
}

/** Restrict to roles, e.g. role('driver','admin') */
const role = (...roles) => (req, _res, next) => {
  if (!req.user) return next(httpError(401, 'Authentication required'));
  if (!roles.includes(req.user.role)) return next(httpError(403, 'You do not have access to this resource'));
  next();
};

/** Attach driver_profile row for driver routes */
async function requireDriverProfile(req, _res, next) {
  try {
    const dp = await one(`SELECT * FROM driver_profiles WHERE user_id = $1`, [req.user.id]);
    if (!dp) throw httpError(404, 'Driver profile not found. Please complete driver registration.');
    req.driverProfile = dp;
    next();
  } catch (err) { next(err); }
}

module.exports = { signToken, requireAuth, role, requireDriverProfile };
