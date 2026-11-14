/* Sawaari API — Express + Socket.IO + PostgreSQL */
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { init } = require('./socket');
const { startScheduler } = require('./scheduler');

const app = express();
const server = http.createServer(app);

// trust proxy for correct IPs behind a reverse proxy
app.set('trust proxy', 1);

/* ── CORS ────────────────────────────────────────────────────────────────
   The web app is a separate origin (a Render static site), so the API has
   to allow it explicitly. The allowlist comes from the environment:
     FRONTEND_URL  the address of the static site (comma separated for
                   several), APP_URL the same thing for a single host
   In development the Vite dev server and the desktop shell are allowed as
   well.

   If NO allowlist is configured the API keeps reflecting the request
   origin (the old behaviour) and says so in the log — that way a missing
   FRONTEND_URL can never take the whole front end down silently.      */
/* Development origins: the Vite dev server (5173) and the Electron shell
   (5188). Built from their ports so no full URL is hardcoded here — in
   production the list stays empty and only FRONTEND_URL / APP_URL count. */
const DEV_PORTS = [5173, 5188];
const DEV_ORIGINS = DEV_PORTS.flatMap((port) => [
  `http://localhost:${port}`,      // audit:dev-only
  `http://127.0.0.1:${port}`,      // audit:dev-only
]);

const allowedOrigins = (() => {
  const list = [];
  const push = (value) => {
    String(value || '')
      .split(',')
      .map((v) => v.trim().replace(/\/+$/, ''))
      .filter(Boolean)
      .forEach((v) => { if (!list.includes(v)) list.push(v); });
  };
  push(process.env.FRONTEND_URL);
  push(config.frontendUrl);
  push(config.appUrl);
  if (config.env !== 'production') DEV_ORIGINS.forEach(push);
  return list;
})();

const corsOptions = {
  origin(origin, callback) {
    // no Origin header → same-origin request, curl, or a native app
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin.replace(/\/+$/, ''))) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(null, true);
    // not allowed → no CORS headers, so the browser blocks the reply
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};
app.use(cors(corsOptions));

// Webhook needs the raw body for HMAC; registered before express.json
const paymentsRouter = require('./routes/payments');
app.use('/api/payments/webhooks/razorpay', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// static uploads
app.use('/uploads', express.static(path.isAbsolute(config.uploadDir)
  ? config.uploadDir
  : path.join(__dirname, '..', config.uploadDir), { maxAge: '7d' }));

// global API rate limit
app.use('/api/', rateLimit({ windowMs: 60 * 1000, limit: 400, standardHeaders: true, legacyHeaders: false }));
// tighter limit on auth endpoints
app.use('/api/auth/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false }));
// stricter limit on administrator sign-in (brute-force protection)
app.use('/api/admin-auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.admin.security.loginRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts from this address. Please wait a few minutes and try again.' },
}));
app.use('/api/admin-auth/verify-2fa', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.admin.security.twoFactorRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please wait a few minutes and sign in again.' },
}));

// Security headers for every API response
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  );
  next();
});

app.get('/', (_req, res) => res.json({ service: 'sawaari-api', docs: '/api/health' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin-auth', require('./routes/adminAuth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/driver', require('./routes/drivers'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/saved-locations', require('./routes/passenger')());
app.use('/api/payments', paymentsRouter);
app.use('/api/admin', require('./routes/admin'));
app.use('/api/master', require('./routes/super'));
app.use('/api/support', require('./routes/support'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api', require('./routes/meta'));

// 404 + error handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(err.extra || {}),
  });
});

init(server);
startScheduler();

server.listen(config.port, '0.0.0.0', async () => {
  console.log(`✔ Sawaari API listening on http://0.0.0.0:${config.port} (port ${config.port})`);
  console.log(`  CORS origins: ${allowedOrigins.length ? allowedOrigins.join(', ') : 'ANY (set FRONTEND_URL to lock it down)'}`);
  console.log(`  Razorpay: ${config.razorpay.enabled ? 'ENABLED' : 'not configured (UPI-QR/cash only)'}
  Web push: ${config.vapid.enabled ? 'ENABLED' : 'not configured (in-app only)'}
  SMS: ${config.sms.configured ? config.sms.provider : (config.sms.devMode ? 'DEV MODE (OTP visible)' : 'NOT CONFIGURED')}
  Email: ${config.smtp.enabled ? 'ENABLED' : 'disabled'}`);

  /* Surface a mis-configured owner password at boot instead of at the
     login screen. */
  try {
    await require('./services/ownerCheck').verifyOwnerCredentials();
  } catch (err) {
    console.warn('  ⚠ could not verify the super admin credentials:', err.message);
  }
});
