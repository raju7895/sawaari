/* Notifications: persist → socket → web push */
const { query } = require('../db');
const { pushToUser } = require('./push');
const socket = require('../socket');

async function notify(userId, { type, title, body, data }) {
  const { rows } = await query(
    `INSERT INTO notifications (user_id, type, title, body, data)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [userId, type, title, body || null, data ? JSON.stringify(data) : null]
  );
  const row = rows[0];
  socket.emitToUser(userId, 'notification:new', row);
  pushToUser(userId, {
    title,
    body: body || '',
    url: data && data.url ? data.url : '/app',
  }).catch(() => {});
  return row;
}

/** Notify every admin (verification queues, SOS, disputes) */
async function notifyAdmins(payload) {
  const { rows } = await query(`SELECT id FROM users WHERE role='admin' AND is_active`);
  for (const a of rows) await notify(a.id, payload);
}

module.exports = { notify, notifyAdmins };
