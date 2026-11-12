/* Transactional email via SMTP (nodemailer). Disabled (logged) if SMTP not configured. */
const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;
if (config.smtp.enabled) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
}

async function sendMail({ to, subject, html, text }) {
  if (!transporter) {
    console.log(`[mail:DISABLED] to=${to} subject="${subject}"`);
    return { delivered: false };
  }
  await transporter.sendMail({ from: config.smtp.from, to, subject, html, text });
  return { delivered: true };
}

module.exports = { sendMail };
