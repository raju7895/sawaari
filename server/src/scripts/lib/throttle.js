/* Shared helper for the admin test scripts: turns a throttled sign-in into
   an actionable message instead of a confusing crash further down. */
function explainThrottle(res, step) {
  if (res && res.status === 429) {
    console.error(`\n  ✖ sign-in throttled during "${step}".`);
    console.error('    The API rate-limits administrator sign-ins per source address');
    console.error('    (ADMIN_LOGIN_RATE_LIMIT / ADMIN_2FA_RATE_LIMIT, default 20/30 per 15 min).');
    console.error('    Wait 15 minutes, restart the API (the limiter is per process), or raise');
    console.error('    those limits in server/.env for a test environment.');
    return true;
  }
  return false;
}

module.exports = { explainThrottle };
