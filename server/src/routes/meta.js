const express = require('express');
const { z } = require('zod');
const { many } = require('../db');
const { asyncHandler } = require('../utils');
const { validateQuery } = require('../middleware/validate');
const geo = require('../services/geo');
const settingsSvc = require('../services/settings');
const razorpaySvc = require('../services/razorpay');
const pushSvc = require('../services/push');
const config = require('../config');

const router = express.Router();

/** GET /api/health */
router.get('/health', (_req, res) => {
  res.json({
    ok: true, service: 'sawaari-api', time: new Date().toISOString(),
    integrations: {
      database: true,
      razorpay: razorpaySvc.enabled(),
      webPush: pushSvc.enabled,
      smsProvider: config.sms.configured ? config.sms.provider : (config.sms.devMode ? 'dev-mode' : 'none'),
      email: config.smtp.enabled,
    },
  });
});

/** GET /api/meta/config — feature availability for the frontend */
router.get('/meta/config', asyncHandler(async (_req, res) => {
  const settings = await settingsSvc.getSettings();
  res.json({
    appName: 'Sawaari',
    currency: settings.currency || 'INR',
    razorpay: { enabled: razorpaySvc.enabled(), keyId: razorpaySvc.keyId() || null },
    webPush: pushSvc.enabled,
    sosNumber: settings.sos_number || '112',
    supportPhone: settings.support_phone,
  });
}));

/** GET /api/meta/cities — public service areas + pricing */
router.get('/meta/cities', asyncHandler(async (_req, res) => {
  const cities = await many(
    `SELECT c.id, c.name, c.state, c.center_lat, c.center_lng, c.radius_km,
            (SELECT json_agg(json_build_object(
              'vehicleType', p.vehicle_type, 'baseFare', p.base_fare, 'perKm', p.per_km,
              'minFare', p.min_fare, 'waitingPerMin', p.waiting_per_min, 'freeWaitMin', p.free_wait_min,
              'nightMultiplier', p.night_multiplier
            ) ORDER BY p.vehicle_type)
              FROM pricing_configs p WHERE p.city_id = c.id AND p.is_active) AS pricing
       FROM cities c WHERE c.is_active ORDER BY c.name`
  );
  res.json(cities.map((c) => ({
    ...c, centerLat: c.center_lat, centerLng: c.center_lng, radiusKm: c.radius_km,
    center_lat: undefined, center_lng: undefined, radius_km: undefined,
  })));
}));

/** GET /api/geo/search?q= — forward geocode (Nominatim proxy) */
router.get('/geo/search', validateQuery(z.object({
  q: z.string().min(2).max(120),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
})), asyncHandler(async (req, res) => {
  const near = req.query.lat !== undefined && req.query.lng !== undefined
    ? [req.query.lat, req.query.lng] : null;
  res.json(await geo.geocode(req.query.q, near));
}));

/** GET /api/geo/reverse?lat=&lng= */
router.get('/geo/reverse', validateQuery(z.object({
  lat: z.coerce.number(), lng: z.coerce.number(),
})), asyncHandler(async (req, res) => {
  res.json(await geo.reverseGeocode(req.query.lat, req.query.lng));
}));

/** GET /api/geo/route?fromLat=&fromLng=&toLat=&toLng= — real road route */
router.get('/geo/route', validateQuery(z.object({
  fromLat: z.coerce.number(), fromLng: z.coerce.number(),
  toLat: z.coerce.number(), toLng: z.coerce.number(),
})), asyncHandler(async (req, res) => {
  res.json(await geo.route({
    fromLat: req.query.fromLat, fromLng: req.query.fromLng,
    toLat: req.query.toLat, toLng: req.query.toLng,
  }));
}));

module.exports = router;
