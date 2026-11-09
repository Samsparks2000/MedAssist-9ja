-- Repairs sample-data text that was stored with a mis-encoded en dash ("UI–Ojoo Road").
UPDATE facilities SET address = replace(address, 'â€“', '–') WHERE address LIKE '%â€“%';
UPDATE facilities SET landmark = replace(landmark, 'â€“', '–') WHERE landmark LIKE '%â€“%';
