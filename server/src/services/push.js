/* Web Push (VAPID). Active only when VAPID keys are configured. */
const webpush = require('web-push');
const config = require('../config');
const { query, many } = require('../db');

let initialized = false;
if (config.vapid.enabled) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  initialized = true;
}

async function pushToUser(userId, { title, body, url }) {
  if (!initialized) return { sent: 0, skipped: 'web-push not configured' };
  const subs = await many(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=$1`, [userId]);
  let sent = 0;
  const dead = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, url })
      );
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) dead.push(s.id);
    }
  }
  if (dead.length) await query(`DELETE FROM push_subscriptions WHERE id = ANY($1)`, [dead]);
  return { sent };
}

module.exports = { pushToUser, enabled: initialized };
