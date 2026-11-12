/* Administrator role helpers shared by the web app.
 * The platform has six administrator roles; anything that branches on
 * "is this an administrator?" must know all of them. */

export const ADMIN_ROLES = [
  'super_admin',
  'admin',
  'finance_admin',
  'support_admin',
  'driver_manager',
  'moderator',
];

export const isAdminRole = (role) => ADMIN_ROLES.includes(role);

/** Where an administrator belongs after signing in. */
export function homeFor(user) {
  if (!user) return '/login';
  if (isAdminRole(user.role)) return '/admin';
  return user.role === 'driver' ? '/driver' : '/app';
}
