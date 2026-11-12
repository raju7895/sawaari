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
app.use(cors({ origin: true, credentials: true }));

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

server.listen(config.port, async () => {
  console.log(`✔ Sawaari API listening on http://localhost:${config.port}`);
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
