/* Append-only audit trail for every administrative action.
   The table itself refuses UPDATE/DELETE (DB trigger), so entries
   written here are permanent evidence of who did what, when and
   from where. */
const { query } = require('../db');

const CATEGORY_BY_PREFIX = [
  ['user.', 'users'],
  ['driver.', 'drivers'],
  ['booking.', 'bookings'],
  ['payment.', 'payments'],
  ['refund.', 'finance'],
  ['settlement.', 'finance'],
  ['report.', 'reports'],
  ['ticket.', 'support'],
  ['admin.', 'administration'],
  ['session.', 'security'],
  ['login.', 'security'],
  ['setting.', 'settings'],
  ['pricing.', 'settings'],
  ['city.', 'settings'],
  ['notification.', 'support'],
];

function categoryFor(action) {
  for (const [prefix, cat] of CATEGORY_BY_PREFIX) if (action.startsWith(prefix)) return cat;
  return 'general';
}

/**
 * Write an audit entry.
 * @param {object} ctx  { adminId, adminEmail, adminRole, ip, userAgent }
 * @param {string} action  e.g. 'user.block'
 * @param {object} opts    { targetType, targetId, targetLabel, previousValue, newValue, result }
 */
async function record(ctx, action, opts = {}) {
  const {
    targetType = null, targetId = null, targetLabel = null,
    previousValue = null, newValue = null, result = 'success',
  } = opts;

  const adminId = ctx && ctx.adminId ? ctx.adminId : null;
  let adminEmail = ctx && ctx.adminEmail ? ctx.adminEmail : null;
  let adminRole = ctx && ctx.adminRole ? ctx.adminRole : null;
  if (adminId && !adminEmail) {
    try {
      const { rows } = await query('SELECT email, role FROM users WHERE id=$1', [adminId]);
      if (rows[0]) { adminEmail = rows[0].email; adminRole = rows[0].role; }
    } catch { /* keep nulls */ }
  }

  try {
    await query(
      `INSERT INTO admin_audit_log
        (admin_id, admin_email, admin_role, action, category, target_type, target_id,
         target_label, previous_value, new_value, ip_address, user_agent, result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        adminId, adminEmail, adminRole, action, categoryFor(action),
        targetType, targetId ? String(targetId) : null, targetLabel,
        previousValue === undefined || previousValue === null ? null : JSON.stringify(previousValue),
        newValue === undefined || newValue === null ? null : JSON.stringify(newValue),
        ctx && ctx.ip ? ctx.ip : null,
        ctx && ctx.userAgent ? ctx.userAgent : null,
        result,
      ]
    );
  } catch (err) {
    // Never let audit failure break the action, but make it visible.
    console.error('[audit] write failed:', err.message);
  }
}

/** Express helper: build the audit context from a request. */
function ctxFrom(req) {
  return {
    adminId: req.user ? req.user.id : null,
    adminEmail: req.user ? req.user.email : null,
    adminRole: req.adminProfile ? req.adminProfile.admin_role : (req.user ? req.user.role : null),
    ip: req.ip || (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || null,
    userAgent: (req.headers['user-agent'] || '').slice(0, 300),
  };
}

module.exports = { record, ctxFrom, categoryFor };
