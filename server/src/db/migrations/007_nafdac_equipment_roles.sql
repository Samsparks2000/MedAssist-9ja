-- FR-07: NAFDAC registration number on every drug listing. It belongs to the product, so the
-- dashboard keeps it the same across all batches of one drug at a facility.
ALTER TABLE inventory_items ADD COLUMN nafdac_no text;

-- NFR-04: what a staff member may do, set by the facility owner. `role` stays the job title
-- ("Pharmacist", "Records officer"); `access` decides permissions.
--   manager: everything, including profile, payouts, sales reports and staff accounts
--   staff:   day-to-day updates (stock, sales, beds, reservations)
ALTER TABLE facility_staff
  ADD COLUMN access text NOT NULL DEFAULT 'staff' CHECK (access IN ('manager', 'staff'));
UPDATE facility_staff SET access = 'manager' WHERE lower(role) IN ('manager', 'administrator');
