/* Fare engine. All rates come from pricing_configs (per city, per vehicle type,
   admin-editable). Never hardcoded in code. */

const { one } = require('../db');

/** Find the active service city covering a coordinate */
async function findCityForPoint(lat, lng, { strict = true } = {}) {
  const city = await one(
    `SELECT id, name, state, center_lat, center_lng, radius_km FROM cities
     WHERE is_active
       AND (6371 * acos(
             least(1, greatest(-1,
               cos(radians($1)) * cos(radians(center_lat)) * cos(radians(center_lng) - radians($2))
               + sin(radians($1)) * sin(radians(center_lat))
             ))
           )) <= radius_km
     ORDER BY (6371 * acos(
             least(1, greatest(-1,
               cos(radians($1)) * cos(radians(center_lat)) * cos(radians(center_lng) - radians($2))
               + sin(radians($1)) * sin(radians(center_lat))
             ))
           )) ASC
     LIMIT 1`,
    [lat, lng]
  );
  if (!city && strict) {
    const nearest = await one(
      `SELECT name, round((6371 * acos(least(1,greatest(-1, cos(radians($1))*cos(radians(center_lat))*cos(radians(center_lng)-radians($2)) + sin(radians($1))*sin(radians(center_lat))))))::numeric, 0) AS km
       FROM cities WHERE is_active ORDER BY 2 ASC LIMIT 1`, [lat, lng]
    );
    throw Object.assign(new Error(
      nearest ? `Sawaari does not serve this location yet. Nearest service area is ${nearest.name} (~${nearest.km} km away).`
              : 'Sawaari does not serve this location yet.'
    ), { status: 422 });
  }
  return city;
}

/** Get pricing row for a city + vehicle type */
async function getPricing(cityId, vehicleType) {
  return one(
    `SELECT * FROM pricing_configs WHERE city_id=$1 AND vehicle_type=$2 AND is_active`,
    [cityId, vehicleType]
  );
}

/**
 * Compute fare. Returns { breakdown: [{key,label,amount}], total }.
 * waitingMinutes is added at ride completion; night multiplier applies to
 * distance+time charges only, as configured.
 */
function computeFare(pricing, { distanceKm, durationMin, waitingMinutes = 0, at = new Date() }) {
  const p = pricing;
  const items = [];
  const add = (key, label, amount) => {
    const a = Math.round(amount * 100) / 100;
    if (a !== 0) items.push({ key, label, amount: a });
  };

  add('base', 'Base fare', parseFloat(p.base_fare));
  add('distance', `Distance (${distanceKm} km × ₹${p.per_km}/km)`, parseFloat(p.per_km) * distanceKm);
  if (parseFloat(p.per_minute) > 0) {
    add('time', `Time (${durationMin} min × ₹${p.per_minute}/min)`, parseFloat(p.per_minute) * durationMin);
  }

  let subtotal = items.reduce((s, i) => s + i.amount, 0);

  // Night charge
  const hour = at.getHours();
  const isNight = p.night_multiplier > 1 &&
    (p.night_from_hour > p.night_to_hour
      ? (hour >= p.night_from_hour || hour < p.night_to_hour)
      : (hour >= p.night_from_hour && hour < p.night_to_hour));
  if (isNight) {
    const nightAmt = subtotal * (parseFloat(p.night_multiplier) - 1);
    add('night', `Night charge (${Math.round((parseFloat(p.night_multiplier) - 1) * 100)}% surcharge, ${String(p.night_from_hour).padStart(2,'0')}:00–${String(p.night_to_hour).padStart(2,'0')}:00)`, nightAmt);
    subtotal += nightAmt;
  }

  add('booking_fee', 'Platform booking fee', parseFloat(p.booking_fee));

  // Waiting (charged at completion, beyond free minutes)
  const billableWait = Math.max(0, waitingMinutes - (p.free_wait_min || 0));
  if (billableWait > 0 && parseFloat(p.waiting_per_min) > 0) {
    add('waiting', `Waiting (${billableWait} min × ₹${p.waiting_per_min}/min after ${p.free_wait_min} min free)`,
      billableWait * parseFloat(p.waiting_per_min));
  }

  let total = subtotal;
  const minFare = parseFloat(p.min_fare);
  if (total < minFare) {
    add('min_fare_adjust', `Minimum fare adjustment`, minFare - total);
    total = minFare;
  }

  total = Math.round(total * 100) / 100;
  return {
    breakdown: items,
    total,
    meta: { isNight, freeWaitMin: p.free_wait_min, waitingPerMin: parseFloat(p.waiting_per_min) },
  };
}

module.exports = { findCityForPoint, getPricing, computeFare };
