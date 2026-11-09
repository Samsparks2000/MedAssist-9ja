-- MedAssist-9ja core schema (PRD section 9).
-- Geo search uses a B-tree index on (lat, lng) for bounding-box prefiltering plus Haversine;
-- on a PostGIS host this can be swapped for a geography column without changing the API.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text,
  phone         text UNIQUE,
  email         text UNIQUE,
  role          text NOT NULL CHECK (role IN ('patient', 'pharmacy', 'hospital', 'specialist', 'admin')),
  password_hash text,
  consent_at    timestamptz,
  suspended     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  phone      text PRIMARY KEY,
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saved_locations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      text NOT NULL,
  address    text,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE facilities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            uuid REFERENCES users(id),
  name                text NOT NULL,
  type                text NOT NULL CHECK (type IN ('pharmacy', 'hospital')),
  is_general_hospital boolean NOT NULL DEFAULT false,
  licence_no          text NOT NULL,
  address             text NOT NULL,
  lat                 double precision NOT NULL,
  lng                 double precision NOT NULL,
  phone               text NOT NULL,
  email               text,
  -- {"mon": ["08:00","20:00"], ...}; null entry = closed that day. open_24h overrides.
  opening_hours       jsonb NOT NULL DEFAULT '{}'::jsonb,
  open_24h            boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'pending'
                      CHECK (verification_status IN ('pending', 'approved', 'rejected', 'suspended')),
  verification_note   text,
  verified_at         timestamptz,
  reliability_score   numeric(4,3) NOT NULL DEFAULT 0.5,
  payout_subaccount   text,
  last_updated        timestamptz NOT NULL DEFAULT now(),
  stale_reminded_at   timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX facilities_geo_idx ON facilities (lat, lng);
CREATE INDEX facilities_owner_idx ON facilities (owner_id);

CREATE TABLE drug_catalogue (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name   text NOT NULL,
  generic_name text NOT NULL,
  strength     text,
  form         text,
  category     text,
  UNIQUE (brand_name, strength, form)
);

CREATE TABLE inventory_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id   uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  drug_id       uuid NOT NULL REFERENCES drug_catalogue(id),
  quantity      int NOT NULL CHECK (quantity >= 0),
  reserved      int NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  price         numeric(12,2) NOT NULL CHECK (price >= 0),
  batch_no      text NOT NULL,
  expiry_date   date NOT NULL,
  reorder_level int NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (reserved <= quantity),
  UNIQUE (facility_id, drug_id, batch_no)
);
CREATE INDEX inventory_drug_idx ON inventory_items (drug_id);

CREATE TABLE resources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('bed', 'blood', 'oxygen', 'equipment')),
  sub_type    text NOT NULL,
  capacity    int NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  available   int NOT NULL DEFAULT 0 CHECK (available >= 0),
  status      text CHECK (status IN ('available', 'in_use', 'maintenance')),
  price       numeric(12,2),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_id, type, sub_type)
);
CREATE INDEX resources_type_idx ON resources (type, sub_type);

CREATE TABLE specialists (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  specialty           text NOT NULL,
  licence_no          text NOT NULL,
  bio                 text,
  phone               text,
  verification_status text NOT NULL DEFAULT 'pending'
                      CHECK (verification_status IN ('pending', 'approved', 'rejected', 'suspended')),
  verification_note   text,
  available_now       boolean NOT NULL DEFAULT false,
  available_at        uuid REFERENCES facilities(id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE duty_schedules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  specialist_id uuid NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  facility_id   uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  day           smallint NOT NULL CHECK (day BETWEEN 0 AND 6), -- 0 = Sunday
  start_time    time NOT NULL,
  end_time      time NOT NULL,
  CHECK (end_time > start_time)
);

CREATE TABLE orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  facility_id   uuid NOT NULL REFERENCES facilities(id),
  type          text NOT NULL CHECK (type IN ('drug', 'bed')),
  status        text NOT NULL CHECK (status IN ('pending_payment', 'paid', 'collected', 'cancelled', 'expired')),
  pickup_code   text NOT NULL,
  expires_at    timestamptz NOT NULL,
  total         numeric(12,2) NOT NULL,
  cancel_reason text,
  bed_request_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_idx ON orders (user_id);
CREATE INDEX orders_facility_idx ON orders (facility_id);
CREATE INDEX orders_expiry_idx ON orders (status, expires_at);

CREATE TABLE order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES inventory_items(id),
  resource_id       uuid REFERENCES resources(id),
  description       text NOT NULL,
  quantity          int NOT NULL CHECK (quantity > 0),
  unit_price        numeric(12,2) NOT NULL
);

CREATE TABLE payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders(id),
  reference        text NOT NULL UNIQUE,
  gateway          text NOT NULL,
  amount           numeric(12,2) NOT NULL,
  platform_fee     numeric(12,2) NOT NULL DEFAULT 0,
  facility_amount  numeric(12,2) NOT NULL DEFAULT 0,
  method           text,
  status           text NOT NULL CHECK (status IN ('initialized', 'success', 'failed', 'refund_pending', 'refunded')),
  paid_at          timestamptz,
  refund_due_at    timestamptz,
  refunded_at      timestamptz,
  refund_reference text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments (order_id);

CREATE TABLE bed_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES users(id),
  patient_name          text NOT NULL,
  contact_phone         text NOT NULL,
  sub_type              text NOT NULL,
  notes                 text,
  lat                   double precision NOT NULL,
  lng                   double precision NOT NULL,
  facility_id           uuid REFERENCES facilities(id),
  tried_facility_ids    uuid[] NOT NULL DEFAULT '{}',
  status                text NOT NULL CHECK (status IN ('pending', 'accepted', 'unmatched', 'cancelled')),
  respond_by            timestamptz,
  responded_at          timestamptz,
  access_token          text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bed_requests_pending_idx ON bed_requests (status, respond_by);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Deduplicates alerts so each threshold fires once, e.g. 'low:<facility>:<drug>', 'exp30:<item>'.
CREATE TABLE alerts_sent (
  key     text PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  order_id    uuid REFERENCES orders(id),
  type        text NOT NULL CHECK (type IN ('rating', 'complaint')),
  score       smallint CHECK (score BETWEEN 1 AND 5),
  comment     text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE search_log (
  id           bigserial PRIMARY KEY,
  query        text NOT NULL,
  target       text,
  lat          double precision,
  lng          double precision,
  result_count int NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor_id   uuid,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_log (entity, entity_id);
