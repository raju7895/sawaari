/* Role-based access control for the admin console.
   Permission strings are granular; each role has a default set and a
   Super Admin may grant a subset of its own permissions to others.
   The server always re-checks permissions — the UI only hides buttons. */
const { one, many } = require('../db');
const { httpError } = require('../utils');

const PERMISSIONS = {
  // users & accounts
  'users.view': 'View users and profiles',
  'users.edit': 'Edit user information',
  'users.block': 'Block / unblock accounts',
  'users.suspend': 'Suspend / reactivate accounts',
  'users.deactivate': 'Permanently deactivate accounts',
  'users.bulk': 'Bulk account operations',
  // drivers
  'drivers.view': 'View driver records',
  'drivers.verify': 'Verify / reject drivers and documents',
  'drivers.manage': 'Edit vehicle data, suspend drivers',
  // bookings
  'bookings.view': 'View bookings and ride history',
  'bookings.cancel': 'Cancel bookings (with reason)',
  'bookings.dispute': 'Resolve booking disputes',
  // payments & finance
  'payments.view': 'View payments and transactions',
  'payments.verify': 'Verify pending payments',
  'payments.refund': 'Issue refunds',
  'finance.view': 'View revenue, commission and settlements',
  'finance.reports': 'Generate financial reports and exports',
  'finance.settings': 'Change commission and pricing rules',
  // support & safety
  'reports.view': 'View reports and complaints',
  'reports.investigate': 'Assign, annotate and resolve reports',
  'tickets.view': 'View support tickets',
  'tickets.reply': 'Reply to support tickets',
  'notifications.send': 'Send platform notifications',
  // platform
  'analytics.view': 'View analytics',
  'cities.view': 'View cities and locations',
  'cities.manage': 'Add or deactivate service cities',
  'settings.view': 'View platform settings',
  'settings.edit': 'Change platform settings',
  'settings.security': 'Change security settings (2FA, lockouts, sessions)',
  // administration
  'admins.view': 'View admin accounts',
  'admins.create': 'Invite / create admin accounts',
  'admins.edit': 'Change admin roles and permissions',
  'admins.suspend': 'Suspend / reactivate admins',
  'admins.remove': 'Remove admin accounts',
  'audit.view': 'View the audit log',
};

const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

/* Default permission set per role. Super Admin implicitly holds every
   permission and cannot have permissions removed. */
const ROLE_DEFAULTS = {
  super_admin: [...ALL_PERMISSIONS],
  admin: [
    'users.view', 'users.edit', 'users.block', 'users.suspend',
    'drivers.view', 'drivers.verify', 'drivers.manage',
    'bookings.view', 'bookings.cancel', 'bookings.dispute',
    'payments.view', 'payments.verify',
    'reports.view', 'reports.investigate', 'tickets.view', 'tickets.reply',
    'notifications.send', 'analytics.view', 'cities.view', 'cities.manage',
    'settings.view', 'admins.view', 'audit.view',
  ],
  finance_admin: [
    'users.view',
    'bookings.view',
    'payments.view', 'payments.verify', 'payments.refund',
    'finance.view', 'finance.reports', 'finance.settings',
    'analytics.view', 'audit.view',
  ],
  support_admin: [
    'users.view', 'users.block',
    'drivers.view',
    'bookings.view',
    'reports.view', 'reports.investigate',
    'tickets.view', 'tickets.reply',
    'notifications.send',
    'analytics.view', 'cities.view', 'settings.view',
  ],
  driver_manager: [
    'users.view', 'users.block', 'users.suspend',
    'drivers.view', 'drivers.verify', 'drivers.manage',
    'bookings.view',
    'reports.view', 'reports.investigate',
    'notifications.send',
    'analytics.view', 'cities.view',
  ],
  moderator: [
    'users.view', 'users.block', 'users.suspend',
    'drivers.view',
    'bookings.view',
    'reports.view', 'reports.investigate',
    'tickets.view',
    'analytics.view',
  ],
};

const ROLES = Object.keys(ROLE_DEFAULTS);
const ADMIN_ROLES = ROLES;

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Administrator',
  finance_admin: 'Finance Admin',
  support_admin: 'Support Admin',
  driver_manager: 'Driver Manager',
  moderator: 'Moderator',
};

/** Roles that may never be given away or escalated to. */
const PROTECTED_ROLES = ['super_admin'];

function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

/** Effective permissions for an admin profile (role defaults + overrides). */
function permissionsFor(profile) {
  if (!profile) return [];
  if (profile.admin_role === 'super_admin') return [...ALL_PERMISSIONS];
  const base = ROLE_DEFAULTS[profile.admin_role] || [];
  const overrides = profile.permissions;
  if (!overrides || typeof overrides !== 'object') return [...base];
  const granted = Array.isArray(overrides.grant) ? overrides.grant : [];
  const denied = Array.isArray(overrides.deny) ? overrides.deny : [];
  return [...new Set(base.concat(granted))].filter((p) => !denied.includes(p) && ALL_PERMISSIONS.includes(p));
}

function hasPermission(profile, permission) {
  if (!profile) return false;
  if (profile.status !== 'active') return false;
  if (profile.admin_role === 'super_admin') return true;
  return permissionsFor(profile).includes(permission);
}

/** Load the admin profile for the authenticated user. */
async function loadProfile(userId) {
  return one(
    `SELECT ap.*, u.name, u.email, u.phone, u.is_active
       FROM admin_profiles ap JOIN users u ON u.id = ap.user_id
      WHERE ap.user_id = $1`, [userId]
  );
}

/**
 * Express middleware factory: require a specific permission.
 *   router.post('/x', requirePermission('finance.settings'), handler)
 */
function requirePermission(permission) {
  return async (req, _res, next) => {
    try {
      const profile = await loadProfile(req.user.id);
      if (!profile) return next(httpError(403, 'This account is not an administrator.'));
      req.adminProfile = profile;
      req.adminPermissions = permissionsFor(profile);
      if (!hasPermission(profile, permission)) {
        return next(httpError(403, `Your role (${ROLE_LABELS[profile.admin_role] || profile.admin_role}) is not allowed to perform this action.`, {
          requiredPermission: permission,
        }));
      }
      return next();
    } catch (err) { return next(err); }
  };
}

/** Middleware: any admin identity (any role) — used for read-only shells. */
function requireAdmin(req, _res, next) {
  if (!req.user) return next(httpError(401, 'Authentication required'));
  if (!isAdminRole(req.user.role)) return next(httpError(403, 'Administrator access only'));
  return next();
}

/** Only the platform owner may perform this action. */
function requireSuperAdmin(req, _res, next) {
  if (!req.adminProfile || req.adminProfile.admin_role !== 'super_admin' || !req.adminProfile.is_owner) {
    return next(httpError(403, 'Only the Super Admin owner can perform this action.'));
  }
  return next();
}

/** List of admin accounts with their effective permissions. */
async function listAdmins() {
  const rows = await many(
    `SELECT ap.user_id, ap.admin_role, ap.is_owner, ap.status, ap.email_verified,
            ap.twofa_enabled, ap.failed_attempts, ap.locked_until, ap.last_login_at,
            ap.last_login_ip, ap.created_at, ap.invited_by,
            u.name, u.email, u.phone, u.is_active
       FROM admin_profiles ap JOIN users u ON u.id = ap.user_id
      ORDER BY (ap.admin_role='super_admin') DESC, ap.created_at ASC`
  );
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    adminRole: r.admin_role,
    roleLabel: ROLE_LABELS[r.admin_role] || r.admin_role,
    isOwner: r.is_owner,
    status: r.status,
    emailVerified: r.email_verified,
    twofaEnabled: r.twofa_enabled,
    locked: Boolean(r.locked_until && new Date(r.locked_until) > new Date()),
    lockedUntil: r.locked_until,
    failedAttempts: r.failed_attempts,
    lastLoginAt: r.last_login_at,
    lastLoginIp: r.last_login_ip,
    createdAt: r.created_at,
    permissions: permissionsFor(r),
    isProtected: PROTECTED_ROLES.includes(r.admin_role) || r.is_owner,
  }));
}

module.exports = {
  PERMISSIONS, ALL_PERMISSIONS, ROLE_DEFAULTS, ROLES, ADMIN_ROLES, ROLE_LABELS,
  PROTECTED_ROLES, isAdminRole, permissionsFor, hasPermission, loadProfile,
  requirePermission, requireAdmin, requireSuperAdmin, listAdmins,
};
