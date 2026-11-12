/* SMS delivery. Providers: none (dev), msg91, twilio.
   In dev mode (SMS_DEV_MODE=true) the OTP is logged + returned to the API
   response so the flow is fully testable without an SMS account. */
const config = require('../config');

async function sendSms(phone, text) {
  if (config.sms.devMode) {
    console.log(`[sms:DEV] to ${phone}: ${text}`);
    return { delivered: false, dev: true };
  }
  if (!config.sms.configured) {
    // No provider configured and not dev mode → fail honestly.
    throw Object.assign(new Error('SMS provider not configured. Set SMS_PROVIDER and its credentials in server/.env, or set SMS_DEV_MODE=true.'), { status: 503 });
  }
  if (config.sms.provider === 'msg91') return sendViaMsg91(phone, text);
  if (config.sms.provider === 'twilio') return sendViaTwilio(phone, text);
  throw Object.assign(new Error(`Unknown SMS_PROVIDER: ${config.sms.provider}`), { status: 500 });
}

async function sendViaMsg91(phone, text) {
  const { authKey, senderId, templateId } = config.sms.msg91;
  // MSG91 flow SMS uses template; falls back to plain send API when template absent
  const url = templateId
    ? `https://api.msg91.com/api/v5/flow/`
    : `https://api.msg91.com/api/sendhttp.php`;
  const body = templateId
    ? JSON.stringify({
        authkey: authKey, mobiles: `91${phone}`,
        [templateId]: text, VAR1: text,
      })
    : null;
  const qs = templateId
    ? ''
    : new URLSearchParams({ authkey: authKey, mobiles: `91${phone}`, message: text, sender: senderId, route: '4' }).toString();
  const res = await fetch(templateId ? url : `${url}?${qs}`, {
    method: templateId ? 'POST' : 'GET',
    headers: templateId ? { 'Content-Type': 'application/json' } : undefined,
    body,
  });
  if (!res.ok) throw new Error(`MSG91 error: ${res.status} ${await res.text()}`);
  return { delivered: true };
}

async function sendViaTwilio(phone, text) {
  const { accountSid, authToken, from } = config.sms.twilio;
  const params = new URLSearchParams({ To: `+91${phone}`, From: from, Body: text });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  if (!res.ok) throw new Error(`Twilio error: ${res.status} ${await res.text()}`);
  return { delivered: true };
}

module.exports = { sendSms };
