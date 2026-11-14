/* The data layer moved to src/lib/api.js when Supabase took over.
 *
 * Every page keeps importing { api } from '../api' — this file keeps that
 * contract working and is the single place to change if you ever want to
 * move the import path.
 */
export {
  api,
  setToken,
  getToken,
  ApiError,
  fmtINR,
  fmtDateTime,
  fmtDate,
  timeAgo,
  safeInternalPath,
} from './lib/api';
