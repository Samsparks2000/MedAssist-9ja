-- Pickup codes are short (MA-4827), so they only need to be unique among a facility's active orders.
CREATE UNIQUE INDEX orders_active_pickup_code_idx ON orders (facility_id, pickup_code)
  WHERE status IN ('pending_payment', 'paid');
