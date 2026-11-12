import { useAuth } from '../context/AuthContext';

/**
 * Renders children only when the signed-in administrator holds the
 * required permission. The server checks every action again — this only
 * keeps the UI honest about what each role can do.
 */
export function PermissionGate({ permission, permissions, children, fallback = null }) {
  const { user } = useAuth();
  const list = permissions || user?.permissions || [];
  if (!permission) return children;
  if (user?.role === 'super_admin') return children;
  if (!list.includes(permission)) return fallback;
  return children;
}

/** Convenience hook: can the signed-in administrator do this? */
export function usePermission() {
  const { user } = useAuth();
  return (permission) => {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
    return (user.permissions || []).includes(permission);
  };
}

export default PermissionGate;
