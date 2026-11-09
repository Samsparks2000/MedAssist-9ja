-- Features from the MVP design: pay-at-pickup reservations confirmed by the pharmacy,
-- prescription/cold-chain flags, richer registration, documents, staff, services,
-- specialist hospital links, payouts, refill reminders and back-in-stock alerts.

-- Facilities -----------------------------------------------------------------
ALTER TABLE facilities DROP CONSTRAINT facilities_verification_status_check;
ALTER TABLE facilities ADD CONSTRAINT facilities_verification_status_check
  CHECK (verification_status IN ('draft', 'pending', 'info_requested', 'approved', 'rejected', 'suspended'));
ALTER TABLE facilities
  ADD COLUMN area                  text,
  ADD COLUMN lga                   text,
  ADD COLUMN landmark              text,
  ADD COLUMN kind                  text,          -- e.g. 'General hospital', 'Clinic', 'Community pharmacy'
  ADD COLUMN ownership             text,          -- 'Private', 'Government', 'Mission or NGO'
  ADD COLUMN emergency_phone       text,
  ADD COLUMN cac_number            text,
  ADD COLUMN licence_expiry        date,
  ADD COLUMN lead_name             text,          -- superintendent pharmacist / medical director
  ADD COLUMN lead_reg_no           text,
  ADD COLUMN offers                text[] NOT NULL DEFAULT '{}',
  ADD COLUMN outpatient_hours      jsonb,
  ADD COLUMN payout_bank_code      text,
  ADD COLUMN payout_bank_name      text,
  ADD COLUMN payout_account_number text,
  ADD COLUMN payout_account_name   text,
  ADD COLUMN verification_checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN submitted_at          timestamptz;
UPDATE facilities SET submitted_at = created_at;

-- People who may manage a facility besides its owner (hospital records officers, pharmacists).
CREATE TABLE facility_staff (
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (facility_id, user_id)
);
CREATE INDEX facility_staff_user_idx ON facility_staff (user_id);

-- Hospital services shown on emergency cards, with today's status.
CREATE TABLE facility_services (
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  service     text NOT NULL,
  status      text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'under_repair', 'not_available')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (facility_id, service)
);

-- Uploaded licences, certificates and photos, kept in the database (≤ 5 MB each).
CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id   uuid REFERENCES facilities(id) ON DELETE CASCADE,
  specialist_id uuid,
  kind          text NOT NULL,
  filename      text NOT NULL,
  mime          text NOT NULL,
  size          int NOT NULL,
  data          bytea NOT NULL,
  uploaded_by   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_facility_idx ON documents (facility_id);

-- Stock flags -----------------------------------------------------------------
ALTER TABLE inventory_items
  ADD COLUMN cost_price          numeric(12,2),
  ADD COLUMN needs_prescription  boolean NOT NULL DEFAULT false,
  ADD COLUMN refrigerated        boolean NOT NULL DEFAULT false,
  ADD COLUMN allow_reservations  boolean NOT NULL DEFAULT true;
ALTER TABLE drug_catalogue ADD COLUMN pack text;

CREATE TABLE catalogue_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id),
  name        text NOT NULL,
  details     text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'added', 'declined')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Orders: pay now (online) or pay at pickup, confirmed by the facility ---------
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('requested', 'pending_payment', 'paid', 'reserved', 'collected', 'cancelled', 'expired'));
ALTER TABLE orders
  ADD COLUMN payment_mode  text NOT NULL DEFAULT 'online' CHECK (payment_mode IN ('online', 'at_pickup')),
  ADD COLUMN confirmed_at  timestamptz,
  ADD COLUMN collected_at  timestamptz,
  ADD COLUMN needs_prescription boolean NOT NULL DEFAULT false;
DROP INDEX orders_active_pickup_code_idx;
CREATE UNIQUE INDEX orders_active_pickup_code_idx ON orders (facility_id, pickup_code)
  WHERE status IN ('requested', 'pending_payment', 'paid', 'reserved');

-- Specialists ---------------------------------------------------------------
ALTER TABLE specialists
  ADD COLUMN title            text NOT NULL DEFAULT 'Dr.',
  ADD COLUMN languages        text[] NOT NULL DEFAULT '{English}',
  ADD COLUMN years_experience int;
ALTER TABLE specialists DROP CONSTRAINT specialists_verification_status_check;
ALTER TABLE specialists ADD CONSTRAINT specialists_verification_status_check
  CHECK (verification_status IN ('draft', 'pending', 'info_requested', 'approved', 'rejected', 'suspended'));
ALTER TABLE documents ADD CONSTRAINT documents_specialist_fk FOREIGN KEY (specialist_id) REFERENCES specialists(id) ON DELETE CASCADE;

-- Each hospital a specialist lists must confirm them before their schedule shows there.
CREATE TABLE specialist_hospitals (
  specialist_id uuid NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  facility_id   uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  position      text NOT NULL DEFAULT 'Consultant',
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (specialist_id, facility_id)
);
-- Existing schedules come from seeded, already-known links.
INSERT INTO specialist_hospitals (specialist_id, facility_id, status)
  SELECT DISTINCT specialist_id, facility_id, 'confirmed' FROM duty_schedules;

ALTER TABLE duty_schedules
  ADD COLUMN on_call boolean NOT NULL DEFAULT false,
  ALTER COLUMN start_time DROP NOT NULL,
  ALTER COLUMN end_time DROP NOT NULL;
ALTER TABLE duty_schedules DROP CONSTRAINT duty_schedules_check;
ALTER TABLE duty_schedules ADD CONSTRAINT duty_schedules_times_check
  CHECK (on_call OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time));

-- Patient conveniences -------------------------------------------------------
CREATE TABLE refill_reminders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drug_id       uuid NOT NULL REFERENCES drug_catalogue(id),
  facility_id   uuid REFERENCES facilities(id) ON DELETE SET NULL,
  interval_days int NOT NULL CHECK (interval_days BETWEEN 7 AND 180),
  next_at       timestamptz NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refill_due_idx ON refill_reminders (active, next_at);

CREATE TABLE stock_watches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  drug_id     uuid NOT NULL REFERENCES drug_catalogue(id),
  notified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_watch_open_idx ON stock_watches (user_id, facility_id, drug_id) WHERE notified_at IS NULL;

-- Complaints get a category (Refund, Wrong stock, Contact, Other) -------------
ALTER TABLE feedback ADD COLUMN category text;
