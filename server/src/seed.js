/* Seeds configuration data only: admin account, cities, pricing, settings.
   No fake drivers/bookings/payments are ever created. */
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { pool, query, one } = require('./db');

/** 24-char password from a CSPRNG (used when no ADMIN_PASSWORD is set) */
function strongPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^*-_=+';
  const bytes = require('crypto').randomBytes(48);
  let out = '';
  for (let i = 0; i < 24; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const CITIES = [
  { name: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946, radius: 30 },
  { name: 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.8777, radius: 30 },
  { name: 'Delhi NCR', state: 'Delhi', lat: 28.6139, lng: 77.209, radius: 35 },
  { name: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567, radius: 25 },
  { name: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.4867, radius: 30 },
  { name: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707, radius: 30 },
  { name: 'Kolkata', state: 'West Bengal', lat: 22.5726, lng: 88.3639, radius: 25 },
  { name: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lng: 75.7873, radius: 25 },
  { name: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lng: 72.5714, radius: 25 },
  { name: 'Indore', state: 'Madhya Pradesh', lat: 22.7196, lng: 75.8577, radius: 20 },
];

// Default fare config per vehicle type (admin-editable at runtime)
const PRICING = {
  auto: {
    base_fare: 20, per_km: 15, per_minute: 0, min_fare: 35, booking_fee: 0,
    waiting_per_min: 2, free_wait_min: 5, night_multiplier: 1.25, night_from_hour: 23, night_to_hour: 5,
  },
  e_rickshaw: {
    base_fare: 15, per_km: 12, per_minute: 0, min_fare: 30, booking_fee: 0,
    waiting_per_min: 1.5, free_wait_min: 5, night_multiplier: 1.2, night_from_hour: 23, night_to_hour: 5,
  },
};

const SETTINGS = {
  commission_percent: 15,
  driver_request_timeout_sec: 120,
  search_radius_km: 6,
  cancellation_fee_after_accept: 10,
  support_phone: '+91-80-4000-1234',
  sos_number: '112',
  currency: 'INR',
};

async function main() {
  console.log('Seeding Sawaari configuration data...');

  // 1. Admin bootstrap — the password comes from the environment; if it is
  //    not set a strong one is generated and written to a git-ignored file,
  //    so a published repo never carries a working credential.
  const adminExists = await one(`SELECT id FROM users WHERE role='admin' LIMIT 1`);
  if (!adminExists) {
    let password = (config.admin.password || '').trim();
    let generated = false;
    if (!password) {
      password = strongPassword();
      generated = true;
    }
    const hash = await bcrypt.hash(password, 10);
    const admin = await one(
      `INSERT INTO users (role, name, phone, email, password_hash, phone_verified)
       VALUES ('admin', 'Platform Admin', $1, $2, $3, true)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [config.admin.phone.replace(/\D/g, ''), config.admin.email.toLowerCase(), hash]
    );
    if (generated) {
      const dir = path.join(__dirname, '..', 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'staff-credentials.txt');
      fs.writeFileSync(file, [
        '='.repeat(70),
        ' SAWAARI STAFF ADMIN — DEPLOYMENT CREDENTIALS',
        '='.repeat(70),
        ` Generated : ${new Date().toISOString()}`,
        ` Email     : ${config.admin.email}`,
        ` Password  : ${password}`,
        '',
        ' Store this in a password manager, then delete the file.',
        ' It is git-ignored and never sent to the frontend or the API.',
        '='.repeat(70),
        '',
      ].join('\n'), { mode: 0o600 });
      console.log(`✔ Staff admin created: ${config.admin.email}`);
      console.log(`  generated password written to ${file}`);
    } else {
      console.log(`✔ Staff admin created: ${config.admin.email} (password from ADMIN_PASSWORD)`);
    }
  } else {
    console.log('✔ Staff admin account exists');
  }

  // 2. Cities
  for (const c of CITIES) {
    await query(
      `INSERT INTO cities (name, state, center_lat, center_lng, radius_km)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (name) DO NOTHING`,
      [c.name, c.state, c.lat, c.lng, c.radius]
    );
  }
  console.log(`✔ ${CITIES.length} service cities ensured`);

  // 3. Pricing per city × vehicle type
  for (const c of CITIES) {
    const city = await one(`SELECT id FROM cities WHERE name = $1`, [c.name]);
    for (const [vtype, p] of Object.entries(PRICING)) {
      await query(
        `INSERT INTO pricing_configs
           (city_id, vehicle_type, base_fare, per_km, per_minute, min_fare, booking_fee,
            waiting_per_min, free_wait_min, night_multiplier, night_from_hour, night_to_hour)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (city_id, vehicle_type) DO NOTHING`,
        [city.id, vtype, p.base_fare, p.per_km, p.per_minute, p.min_fare, p.booking_fee,
         p.waiting_per_min, p.free_wait_min, p.night_multiplier, p.night_from_hour, p.night_to_hour]
      );
    }
  }
  console.log('✔ Default pricing ensured for all cities');

  // 4. Platform settings
  for (const [k, v] of Object.entries(SETTINGS)) {
    await query(
      `INSERT INTO platform_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO NOTHING`,
      [k, JSON.stringify(v)]
    );
  }
  console.log('✔ Platform settings ensured');

  console.log('Seed complete.');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
