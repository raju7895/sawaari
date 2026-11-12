-- ════════════════════════════════════════════════════════════
-- OPTIONAL PostGIS upgrade.  (@optional: skipped gracefully
-- when PostGIS is not installed; re-run `npm run migrate`
-- after installing PostGIS to activate it.)
-- The app works on stock PostgreSQL using haversine queries.
-- Nearby-driver queries automatically switch to GiST indexes
-- when the extension exists (see src/routes/bookings.js).
-- ════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE driver_locations
  ADD COLUMN IF NOT EXISTS geog geography(POINT, 4326);

UPDATE driver_locations
   SET geog = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
 WHERE geog IS NULL;

CREATE INDEX IF NOT EXISTS driver_loc_geog_idx
  ON driver_locations USING GIST (geog);
