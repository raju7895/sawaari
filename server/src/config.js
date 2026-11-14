require('dotenv').config();

const required = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
};

const config = {
  env: required('NODE_ENV', 'development'),
  port: parseInt(required('PORT', '4000'), 10),
  appUrl: required('APP_URL', 'http://localhost:5173'),
  /* Origin of the web front end (the Render static site). Several
     addresses can be given, separated by commas. It is what the CORS
     allowlist is built from. */
  frontendUrl: required('FRONTEND_URL', ''),
  databaseUrl: required('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/sawaari'),
  jwtSecret: required('JWT_SECRET', 'dev-jwt-secret-change-me'),
  otpPepper: required('OTP_PEPPER', 'dev-otp-pepper-change-me'),
  admin: {
    /* Defaults are deliberately non-credential: the seed script generates a
       strong password when none is configured, so a freshly cloned repo can
       never expose a working login. */
    email: required('ADMIN_EMAIL', 'admin@example.com'),
    password: required('ADMIN_PASSWORD', ''),
    phone: required('ADMIN_PHONE', '9999999999'),
    /* Platform owner (SUPER_ADMIN). The password is a deployment secret:
       supply it via the environment / secret manager, never in code.
       If it is absent the seed script generates a strong one-time password
       and writes it to server/backups/ (git-ignored) instead of guessing. */
    superAdmin: {
      email: required('SUPER_ADMIN_EMAIL', 'owner@example.com'),
      password: required('SUPER_ADMIN_PASSWORD', ''),
      name: required('SUPER_ADMIN_NAME', 'Platform Owner'),
      phone: required('SUPER_ADMIN_PHONE', ''),
    },
    /* Encryption key for TOTP shared secrets at rest. Falls back to
       JWT_SECRET when unset, but a dedicated key is recommended. */
    totpEncryptionKey: required('ADMIN_TOTP_ENCRYPTION_KEY', ''),
    security: {
      maxLoginAttempts: parseInt(required('ADMIN_MAX_LOGIN_ATTEMPTS', '5'), 10),
      lockoutMinutes: parseInt(required('ADMIN_LOCKOUT_MINUTES', '15'), 10),
      maxFailedAttempts: parseInt(required('ADMIN_MAX_FAILED_ATTEMPTS', '5'), 10),
      accountLockMinutes: parseInt(required('ADMIN_ACCOUNT_LOCK_MINUTES', '30'), 10),
      sessionHours: parseInt(required('ADMIN_SESSION_HOURS', '12'), 10),
      inviteExpiryHours: parseInt(required('ADMIN_INVITE_EXPIRY_HOURS', '72'), 10),
      /* Request-rate limits (per source IP). Raise them in a test
         environment; keep them tight in production. */
      loginRateLimit: parseInt(required('ADMIN_LOGIN_RATE_LIMIT', '20'), 10),
      twoFactorRateLimit: parseInt(required('ADMIN_2FA_RATE_LIMIT', '30'), 10),
    },
  },
  sms: {
    devMode: required('SMS_DEV_MODE', 'true') === 'true',
    provider: required('SMS_PROVIDER', 'none'),
    msg91: {
      authKey: required('MSG91_AUTH_KEY', ''),
      senderId: required('MSG91_SENDER_ID', 'SAWAAR'),
      templateId: required('MSG91_TEMPLATE_ID', ''),
    },
    twilio: {
      accountSid: required('TWILIO_ACCOUNT_SID', ''),
      authToken: required('TWILIO_AUTH_TOKEN', ''),
      from: required('TWILIO_FROM', ''),
    },
  },
  smtp: {
    host: required('SMTP_HOST', ''),
    port: parseInt(required('SMTP_PORT', '587'), 10),
    user: required('SMTP_USER', ''),
    pass: required('SMTP_PASS', ''),
    from: required('SMTP_FROM', 'Sawaari <no-reply@sawaari.local>'),
  },
  razorpay: {
    keyId: required('RAZORPAY_KEY_ID', ''),
    keySecret: required('RAZORPAY_KEY_SECRET', ''),
    webhookSecret: required('RAZORPAY_WEBHOOK_SECRET', ''),
  },
  vapid: {
    publicKey: required('VAPID_PUBLIC_KEY', ''),
    privateKey: required('VAPID_PRIVATE_KEY', ''),
    subject: required('VAPID_SUBJECT', 'mailto:admin@example.com'),
  },
  geo: {
    osrmBase: required('OSRM_BASE_URL', 'https://router.project-osrm.org'),
    // Extra routing hosts tried in order if the primary is unreachable.
    osrmFallbacks: required('OSRM_FALLBACK_URLS', 'https://routing.openstreetmap.de/routed-car'),
    nominatimBase: required('NOMINATIM_BASE_URL', 'https://nominatim.openstreetmap.org'),
  },
  uploadDir: required('UPLOAD_DIR', 'uploads'),
};

config.razorpay.enabled = Boolean(config.razorpay.keyId && config.razorpay.keySecret);
config.smtp.enabled = Boolean(config.smtp.host && config.smtp.user);
config.vapid.enabled = Boolean(config.vapid.publicKey && config.vapid.privateKey);
config.sms.configured = config.sms.provider !== 'none';

/* ── production safety guard ───────────────────────────────────
   The development defaults above are published in a public GitHub
   repository. Starting production with them would let anybody sign
   their own admin token or read the stored TOTP secrets, so the
   process refuses to boot instead. Render generates these two
   values for you (render.yaml → generateValue: true).
     openssl rand -hex 32   → JWT_SECRET
     openssl rand -hex 24   → OTP_PEPPER                                    */
if (config.env === 'production') {
  const WEAK = [
    ['JWT_SECRET', config.jwtSecret, 'dev-jwt-secret-change-me', 32],
    ['OTP_PEPPER', config.otpPepper, 'dev-otp-pepper-change-me', 16],
  ];
  for (const [key, value, devDefault, minLength] of WEAK) {
    if (!value || value === devDefault || value.length < minLength) {
      /* Print it as a block: this is the first thing anyone sees in the
         Render log when a deploy comes up empty. */
      const message = [
        '',
        '  ════════════════════════════════════════════════════════════════',
        `  ✖ ${key} is missing, still the published development default,`,
        `    or shorter than ${minLength} characters.`,
        '',
        '    The API refuses to start: with a public secret anybody could',
        '    sign their own admin token or decrypt the stored 2FA secrets.',
        '',
        '    FIX (Render → the API service → Environment):',
        `      ${key} = a random value of at least ${minLength} characters`,
        '',
        '    Generate one with:',
        `      node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
        '',
        '  ════════════════════════════════════════════════════════════════',
        '',
      ].join('\n');
      console.error(message);
      throw new Error(`${key} is not set to a strong production value.`);
    }
  }
}

module.exports = config;
