-- ════════════════════════════════════════════════════════════
-- SAWAARI PLATFORM SCHEMA  v1
-- Users, profiles, vehicles, docs, cities, pricing, bookings,
-- ride events, chat, payments, earnings, reviews, notifications,
-- push subs, support, reports, SOS, settings.
--
-- Nearby-driver search uses an accurate haversine great-circle
-- formula over lat/lng columns (works on stock PostgreSQL).
-- Migration 002 shows the optional PostGIS/GiST upgrade.
-- ════════════════════════════════════════════════════════════

-- ── USERS ─────────────────────────────────────────────────────
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role            text NOT NULL CHECK (role IN ('passenger','driver','admin')),
  name            text NOT NULL,
  phone           text NOT NULL UNIQUE,               -- 10-digit, digits only
  email           text UNIQUE,
  password_hash   text NOT NULL,
  avatar_url      text,
  is_active       boolean NOT NULL DEFAULT true,       -- false = blocked
  blocked_reason  text,
  phone_verified  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_role_idx ON users(role);
CREATE INDEX users_active_idx ON users(is_active);

-- ── OTP CODES (hashed, expiring) ─────────────────────────────
CREATE TABLE otp_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier   text NOT NULL,                          -- phone number
  purpose      text NOT NULL CHECK (purpose IN ('register','password_reset')),
  code_hash    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     int NOT NULL DEFAULT 0,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_identifier_idx ON otp_codes(identifier, purpose, created_at DESC);

-- ── PASSENGER PROFILES ───────────────────────────────────────
CREATE TABLE passenger_profiles (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rating_avg   numeric(3,2) NOT NULL DEFAULT 0,
  rating_count int NOT NULL DEFAULT 0,
  default_city uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── DRIVER PROFILES ──────────────────────────────────────────
CREATE TABLE driver_profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','approved','rejected')),
  rejection_reason   text,
  reviewed_by        uuid REFERENCES users(id),
  reviewed_at        timestamptz,
  is_online          boolean NOT NULL DEFAULT false,
  current_booking_id uuid,                             -- set while on an active ride
  upi_id             text,
  upi_verified       boolean NOT NULL DEFAULT false,
  rating_avg         numeric(3,2) NOT NULL DEFAULT 0,
  rating_count       int NOT NULL DEFAULT 0,
  rides_completed    int NOT NULL DEFAULT 0,
  rides_cancelled    int NOT NULL DEFAULT 0,
  total_earnings     numeric(12,2) NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_online_idx ON driver_profiles(is_online, verification_status) WHERE current_booking_id IS NULL;

-- ── VEHICLES ──────────────────────────────────────────────────
CREATE TABLE vehicles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_profile_id   uuid NOT NULL REFERENCES driver_profiles(id) ON DELETE CASCADE,
  registration_number text NOT NULL UNIQUE,
  vehicle_type        text NOT NULL CHECK (vehicle_type IN ('auto','e_rickshaw')),
  model               text,
  capacity            int NOT NULL DEFAULT 3,
  photo_url           text,
  is_primary          boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_driver_idx ON vehicles(driver_profile_id);

-- ── DRIVER DOCUMENTS ─────────────────────────────────────────
CREATE TABLE driver_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id) ON DELETE CASCADE,
  doc_type          text NOT NULL CHECK (doc_type IN ('license','aadhaar','vehicle_rc','insurance','profile_photo')),
  file_url          text NOT NULL,
  doc_number        text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  review_note       text,
  reviewed_by       uuid REFERENCES users(id),
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_docs_driver_idx ON driver_documents(driver_profile_id);

-- ── CITIES (service areas) ───────────────────────────────────
CREATE TABLE cities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  state       text,
  center_lat  double precision NOT NULL,
  center_lng  double precision NOT NULL,
  radius_km   int NOT NULL DEFAULT 25,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── PRICING CONFIGURATION (per city + vehicle type) ───────────
CREATE TABLE pricing_configs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id          uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  vehicle_type     text NOT NULL CHECK (vehicle_type IN ('auto','e_rickshaw')),
  base_fare        numeric(8,2) NOT NULL,
  per_km           numeric(8,2) NOT NULL,
  per_minute       numeric(8,2) NOT NULL DEFAULT 0,
  min_fare         numeric(8,2) NOT NULL,
  booking_fee      numeric(8,2) NOT NULL DEFAULT 0,
  waiting_per_min  numeric(8,2) NOT NULL DEFAULT 0,
  free_wait_min    int NOT NULL DEFAULT 5,
  night_multiplier numeric(4,2) NOT NULL DEFAULT 1,
  night_from_hour  int NOT NULL DEFAULT 23,
  night_to_hour    int NOT NULL DEFAULT 5,
  is_active        boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, vehicle_type)
);

-- ── PLATFORM SETTINGS (key/value) ────────────────────────────
CREATE TABLE platform_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── SAVED LOCATIONS ───────────────────────────────────────────
CREATE TABLE saved_locations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      text NOT NULL,
  address    text NOT NULL,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_loc_user_idx ON saved_locations(user_id);

-- ── BOOKINGS ──────────────────────────────────────────────────
CREATE TABLE bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               text NOT NULL UNIQUE,              -- human reference e.g. SW-8F3K2A
  passenger_id      uuid NOT NULL REFERENCES users(id),
  driver_profile_id uuid REFERENCES driver_profiles(id),
  city_id           uuid REFERENCES cities(id),
  booking_type      text NOT NULL CHECK (booking_type IN ('immediate','scheduled','custom')),
  scheduled_at      timestamptz,
  vehicle_type      text NOT NULL DEFAULT 'auto',

  pickup_lat double precision NOT NULL,
  pickup_lng double precision NOT NULL,
  pickup_address text NOT NULL,
  drop_lat   double precision NOT NULL,
  drop_lng   double precision NOT NULL,
  drop_address text NOT NULL,

  distance_km   numeric(8,2) NOT NULL,
  duration_min  int NOT NULL,
  route_geometry jsonb,                                -- geojson line for map

  fare_breakdown  jsonb NOT NULL,
  estimated_fare  numeric(10,2) NOT NULL,
  final_fare      numeric(10,2),
  waiting_minutes int NOT NULL DEFAULT 0,

  status          text NOT NULL DEFAULT 'searching' CHECK (status IN
    ('scheduled','searching','assigned','arriving','arrived','in_progress','completed','cancelled','expired')),
  ride_otp        text NOT NULL,                       -- driver must enter to start ride
  share_token     text NOT NULL UNIQUE,                -- public live tracking
  cancellation_reason text,
  cancelled_by    uuid REFERENCES users(id),
  cancellation_fee numeric(8,2) NOT NULL DEFAULT 0,
  payment_status  text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded')),

  created_at   timestamptz NOT NULL DEFAULT now(),
  assigned_at  timestamptz,
  arrived_at   timestamptz,
  started_at   timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bookings_passenger_idx ON bookings(passenger_id, created_at DESC);
CREATE INDEX bookings_driver_idx ON bookings(driver_profile_id, created_at DESC);
CREATE INDEX bookings_status_idx ON bookings(status);
CREATE INDEX bookings_city_idx ON bookings(city_id);
CREATE INDEX bookings_created_idx ON bookings(created_at DESC);

-- ── RIDE STATUS EVENTS (timeline) ────────────────────────────
CREATE TABLE ride_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  status     text NOT NULL,
  actor_id   uuid REFERENCES users(id),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_events_booking_idx ON ride_events(booking_id, created_at);

-- ── RIDE CHAT ─────────────────────────────────────────────────
CREATE TABLE booking_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bmsg_booking_idx ON booking_messages(booking_id, created_at);

-- ── LIVE DRIVER LOCATIONS ─────────────────────────────────────
CREATE TABLE driver_locations (
  driver_profile_id uuid PRIMARY KEY REFERENCES driver_profiles(id) ON DELETE CASCADE,
  lat  double precision NOT NULL,
  lng  double precision NOT NULL,
  heading numeric(6,2),
  accuracy_m numeric(8,2),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_loc_updated_idx ON driver_locations(updated_at);

-- ── PAYMENTS ──────────────────────────────────────────────────
CREATE TABLE payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings(id),
  passenger_id      uuid NOT NULL REFERENCES users(id),
  method            text NOT NULL CHECK (method IN ('online','upi_qr','cash')),
  amount            numeric(10,2) NOT NULL,
  currency          text NOT NULL DEFAULT 'INR',
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','awaiting_verification','paid','failed','refunded')),
  -- Razorpay (gateway) fields
  rzp_order_id      text,
  rzp_payment_id    text,
  rzp_signature     text,
  rzp_refund_id     text,
  -- Direct UPI fields
  upi_intent_url    text,
  upi_txn_ref       text,
  upi_vpa           text,
  passenger_utr     text,                              -- submitted by passenger, needs verification
  verified_by       uuid REFERENCES users(id),
  verified_at       timestamptz,
  failure_reason   text,
  refunded_amount   numeric(10,2) NOT NULL DEFAULT 0,
  meta              jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_booking_idx ON payments(booking_id);
CREATE INDEX payments_status_idx ON payments(status);
CREATE UNIQUE INDEX payments_rzp_order_idx ON payments(rzp_order_id) WHERE rzp_order_id IS NOT NULL;

-- ── DRIVER EARNINGS ──────────────────────────────────────────
CREATE TABLE driver_earnings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id),
  booking_id        uuid NOT NULL UNIQUE REFERENCES bookings(id),
  gross             numeric(10,2) NOT NULL,
  commission        numeric(10,2) NOT NULL,
  net               numeric(10,2) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX earnings_driver_idx ON driver_earnings(driver_profile_id, created_at DESC);

-- ── REVIEWS ──────────────────────────────────────────────────
CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL UNIQUE REFERENCES bookings(id),
  reviewer_id uuid NOT NULL REFERENCES users(id),
  reviewee_id uuid NOT NULL REFERENCES users(id),
  rating      int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_reviewee_idx ON reviews(reviewee_id);

-- ── NOTIFICATIONS ─────────────────────────────────────────────
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text,
  data       jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notif_user_idx ON notifications(user_id, created_at DESC);

-- ── WEB PUSH SUBSCRIPTIONS ────────────────────────────────────
CREATE TABLE push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_user_idx ON push_subscriptions(user_id);

-- ── SUPPORT TICKETS ──────────────────────────────────────────
CREATE TABLE support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  booking_id  uuid REFERENCES bookings(id),
  subject     text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_status_idx ON support_tickets(status, created_at DESC);

CREATE TABLE ticket_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_msg_idx ON ticket_messages(ticket_id, created_at);

-- ── USER REPORTS (report driver/passenger) ────────────────────
CREATE TABLE user_reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id    uuid NOT NULL REFERENCES users(id),
  against_user_id uuid NOT NULL REFERENCES users(id),
  booking_id     uuid REFERENCES bookings(id),
  reason         text NOT NULL,
  details        text,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','dismissed')),
  resolution_note text,
  resolved_by    uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_status_idx ON user_reports(status, created_at DESC);

-- ── SOS ALERTS ────────────────────────────────────────────────
CREATE TABLE sos_alerts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES bookings(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  lat double precision,
  lng double precision,
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  acknowledged_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sos_status_idx ON sos_alerts(status, created_at DESC);

-- ── ADMIN ACTION AUDIT ───────────────────────────────────────
CREATE TABLE admin_actions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid NOT NULL REFERENCES users(id),
  action     text NOT NULL,
  target      text,
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_actions_idx ON admin_actions(created_at DESC);
