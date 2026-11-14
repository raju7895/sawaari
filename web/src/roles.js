/* The roles the platform knows.
 *
 *   rider    books and rides
 *   driver   drives and earns
 *   admin    the master console
 *
 * The role lives in profiles.role and is enforced by the database
 * (row-level security), not by this file.
 */
export const ROLES = ['rider', 'driver', 'admin'];

export const ADMIN_ROLES = ['admin'];

export const isAdminRole = (role) => ADMIN_ROLES.includes(role);

export const isDriverRole = (role) => role === 'driver';

export const isRiderRole = (role) => role === 'rider';

/** Where somebody belongs after signing in. */
export function homeFor(role) {
  if (!role) return '/login';
  if (isAdminRole(role)) return '/admin';
  if (isDriverRole(role)) return '/driver';
  return '/passenger';
}
