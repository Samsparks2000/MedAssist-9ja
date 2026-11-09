-- Hospitals created before services existed get them from what they already list, so the
-- Emergency screen (which needs "Emergency unit, 24 hours") works for them straight away.
INSERT INTO facility_services (facility_id, service)
SELECT DISTINCT f.id, s.service
  FROM facilities f
  JOIN resources r ON r.facility_id = f.id
  CROSS JOIN LATERAL (VALUES
    (CASE WHEN r.type = 'bed' AND r.sub_type = 'Emergency' AND f.open_24h THEN 'Emergency unit, 24 hours' END),
    (CASE WHEN r.type = 'bed' AND r.sub_type = 'ICU' THEN 'Intensive care (ICU)' END),
    (CASE WHEN r.type = 'bed' AND r.sub_type = 'Maternity' THEN 'Maternity and delivery' END),
    (CASE WHEN r.type = 'bed' AND r.sub_type = 'Paediatric' THEN 'Children''s care' END),
    (CASE WHEN r.type = 'blood' THEN 'Blood bank' END),
    (CASE WHEN r.type = 'oxygen' THEN 'Oxygen' END),
    (CASE WHEN r.type = 'equipment' AND r.sub_type = 'Ventilator' THEN 'Ventilator' END),
    (CASE WHEN r.type = 'equipment' AND r.sub_type = 'CT scanner' THEN 'CT scan' END),
    (CASE WHEN r.type = 'equipment' AND r.sub_type = 'X-ray' THEN 'X-ray' END),
    (CASE WHEN r.type = 'equipment' AND r.sub_type = 'Dialysis machine' THEN 'Dialysis' END)
  ) AS s(service)
 WHERE f.type = 'hospital' AND s.service IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM facility_services x WHERE x.facility_id = f.id)
ON CONFLICT DO NOTHING;

UPDATE facilities f SET offers = (SELECT coalesce(array_agg(service), '{}') FROM facility_services s WHERE s.facility_id = f.id)
 WHERE f.type = 'hospital' AND f.offers = '{}';
UPDATE facilities SET emergency_phone = phone WHERE type = 'hospital' AND emergency_phone IS NULL;
UPDATE facilities SET kind = CASE WHEN is_general_hospital THEN 'General hospital' ELSE 'Specialist hospital' END WHERE type = 'hospital' AND kind IS NULL;
UPDATE facilities SET kind = 'Community pharmacy' WHERE type = 'pharmacy' AND kind IS NULL;
-- Insulin and other cold-chain or prescription-only stock gets its flags.
UPDATE inventory_items i SET needs_prescription = true
  FROM drug_catalogue d WHERE d.id = i.drug_id AND d.category IN ('Insulin', 'Antibiotic', 'Antidiabetic', 'Antihypertensive', 'Obstetric', 'Emergency');
UPDATE inventory_items i SET refrigerated = true
  FROM drug_catalogue d WHERE d.id = i.drug_id AND d.category IN ('Insulin', 'Obstetric');
