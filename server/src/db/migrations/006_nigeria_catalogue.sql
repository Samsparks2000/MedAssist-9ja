-- Widens the drug catalogue with medicines commonly sold in Nigerian pharmacies and hospitals:
-- items on the Nigeria Essential Medicines List plus well-known local and imported brands
-- (Emzor, May & Baker, Fidson, GSK, Sanofi, Novo Nordisk and others).
-- NAFDAC registration numbers are not recorded here and have not been checked one by one
-- against the NAFDAC Greenbook; pharmacies still confirm the exact product they stock.
-- Codeine-containing cough syrups are left out on purpose (banned in Nigeria since 2018).

INSERT INTO drug_catalogue (brand_name, generic_name, strength, form, category) VALUES
  -- Antimalarial
  ('Lonart', 'Artemether/Lumefantrine', '20/120mg', 'Tablet', 'Antimalarial'),
  ('Lumartem', 'Artemether/Lumefantrine', '80/480mg', 'Tablet', 'Antimalarial'),
  ('Gvither', 'Artemether', '80mg/ml', 'Injection', 'Antimalarial'),
  ('Fansidar', 'Sulfadoxine/Pyrimethamine', '500/25mg', 'Tablet', 'Antimalarial'),
  ('Maloxine', 'Sulfadoxine/Pyrimethamine', '500/25mg', 'Tablet', 'Antimalarial'),
  ('Quinine Sulphate', 'Quinine', '300mg', 'Tablet', 'Antimalarial'),
  ('Paludrine', 'Proguanil', '100mg', 'Tablet', 'Antimalarial'),

  -- Analgesic
  ('M&B Paracetamol', 'Paracetamol', '500mg', 'Tablet', 'Analgesic'),
  ('Calpol', 'Paracetamol', '120mg/5ml', 'Suspension', 'Analgesic'),
  ('Nurofen', 'Ibuprofen', '200mg', 'Tablet', 'Analgesic'),
  ('Cataflam', 'Diclofenac potassium', '50mg', 'Tablet', 'Analgesic'),
  ('Diclofenac Injection', 'Diclofenac', '75mg/3ml', 'Injection', 'Analgesic'),
  ('Ponstan Forte', 'Mefenamic acid', '500mg', 'Tablet', 'Analgesic'),
  ('Feldene', 'Piroxicam', '20mg', 'Capsule', 'Analgesic'),
  ('Tramadol', 'Tramadol', '50mg', 'Capsule', 'Analgesic'),

  -- Antibiotic
  ('Ampiclox', 'Ampicillin/Cloxacillin', '500mg', 'Capsule', 'Antibiotic'),
  ('Amoxil', 'Amoxicillin', '250mg/5ml', 'Suspension', 'Antibiotic'),
  ('Augmentin', 'Amoxicillin/Clavulanic acid', '1g', 'Tablet', 'Antibiotic'),
  ('Augmentin', 'Amoxicillin/Clavulanic acid', '228mg/5ml', 'Suspension', 'Antibiotic'),
  ('Ceporex', 'Cefalexin', '500mg', 'Capsule', 'Antibiotic'),
  ('Zinnat', 'Cefuroxime', '500mg', 'Tablet', 'Antibiotic'),
  ('Tavanic', 'Levofloxacin', '500mg', 'Tablet', 'Antibiotic'),
  ('Septrin', 'Co-trimoxazole', '480mg', 'Tablet', 'Antibiotic'),
  ('Erythromycin', 'Erythromycin', '500mg', 'Tablet', 'Antibiotic'),
  ('Doxycycline', 'Doxycycline', '100mg', 'Capsule', 'Antibiotic'),
  ('Tetracycline', 'Tetracycline', '250mg', 'Capsule', 'Antibiotic'),
  ('Dalacin C', 'Clindamycin', '300mg', 'Capsule', 'Antibiotic'),
  ('Gentamicin', 'Gentamicin', '80mg/2ml', 'Injection', 'Antibiotic'),
  ('Flagyl', 'Metronidazole', '200mg/5ml', 'Suspension', 'Antibiotic'),

  -- Antifungal
  ('Diflucan', 'Fluconazole', '150mg', 'Capsule', 'Antifungal'),
  ('Nizoral', 'Ketoconazole', '200mg', 'Tablet', 'Antifungal'),
  ('Grisovin', 'Griseofulvin', '500mg', 'Tablet', 'Antifungal'),
  ('Canesten', 'Clotrimazole', '1%', 'Cream', 'Antifungal'),
  ('Nystatin', 'Nystatin', '100,000IU/ml', 'Oral suspension', 'Antifungal'),

  -- Antiviral, antiretroviral and TB
  ('Acyclovir', 'Aciclovir', '400mg', 'Tablet', 'Antiviral'),
  ('TLD', 'Tenofovir/Lamivudine/Dolutegravir', '300/300/50mg', 'Tablet', 'Antiretroviral'),
  ('TLE', 'Tenofovir/Lamivudine/Efavirenz', '300/300/600mg', 'Tablet', 'Antiretroviral'),
  ('RHZE', 'Rifampicin/Isoniazid/Pyrazinamide/Ethambutol', '150/75/400/275mg', 'Tablet', 'Antituberculosis'),

  -- Anthelmintic
  ('Vermox', 'Mebendazole', '100mg', 'Tablet', 'Anthelmintic'),
  ('Zentel', 'Albendazole', '200mg/5ml', 'Suspension', 'Anthelmintic'),
  ('Biltricide', 'Praziquantel', '600mg', 'Tablet', 'Anthelmintic'),

  -- Antihistamine
  ('Piriton', 'Chlorphenamine', '4mg', 'Tablet', 'Antihistamine'),
  ('Zyrtec', 'Cetirizine', '10mg', 'Tablet', 'Antihistamine'),

  -- Antihypertensive and cardiovascular
  ('Adalat Retard', 'Nifedipine', '20mg', 'Tablet', 'Antihypertensive'),
  ('Cozaar', 'Losartan', '50mg', 'Tablet', 'Antihypertensive'),
  ('Hyzaar', 'Losartan/Hydrochlorothiazide', '50/12.5mg', 'Tablet', 'Antihypertensive'),
  ('Hydrochlorothiazide', 'Hydrochlorothiazide', '25mg', 'Tablet', 'Antihypertensive'),
  ('Tenormin', 'Atenolol', '50mg', 'Tablet', 'Antihypertensive'),
  ('Lasix', 'Furosemide', '40mg', 'Tablet', 'Antihypertensive'),
  ('Aldactone', 'Spironolactone', '25mg', 'Tablet', 'Antihypertensive'),
  ('Hydralazine', 'Hydralazine', '20mg', 'Injection', 'Antihypertensive'),
  ('Lipitor', 'Atorvastatin', '20mg', 'Tablet', 'Cardiovascular'),
  ('Zocor', 'Simvastatin', '20mg', 'Tablet', 'Cardiovascular'),
  ('Aspirin', 'Aspirin', '75mg', 'Tablet', 'Cardiovascular'),

  -- Diabetes
  ('Glucophage', 'Metformin', '850mg', 'Tablet', 'Antidiabetic'),
  ('Diamicron MR', 'Gliclazide', '60mg', 'Tablet', 'Antidiabetic'),
  ('Amaryl', 'Glimepiride', '2mg', 'Tablet', 'Antidiabetic'),
  ('Januvia', 'Sitagliptin', '100mg', 'Tablet', 'Antidiabetic'),
  ('Insulatard', 'Insulin human (isophane)', '100IU/ml', 'Injection', 'Insulin'),
  ('Humulin N', 'Insulin human (isophane)', '100IU/ml', 'Injection', 'Insulin'),
  ('On Call Plus Test Strips', 'Glucose test strips', 'x50', 'Strips', 'Diabetes supplies'),

  -- Gastrointestinal
  ('Buscopan', 'Hyoscine butylbromide', '10mg', 'Tablet', 'Gastrointestinal'),
  ('Nexium', 'Esomeprazole', '40mg', 'Tablet', 'Gastrointestinal'),
  ('Gaviscon', 'Sodium alginate/Sodium bicarbonate/Calcium carbonate', '200ml', 'Suspension', 'Gastrointestinal'),
  ('Magnesium Trisilicate', 'Magnesium trisilicate', '500mg', 'Tablet', 'Gastrointestinal'),
  ('Imodium', 'Loperamide', '2mg', 'Capsule', 'Gastrointestinal'),
  ('Plasil', 'Metoclopramide', '10mg', 'Tablet', 'Gastrointestinal'),
  ('Dulcolax', 'Bisacodyl', '5mg', 'Tablet', 'Gastrointestinal'),

  -- Respiratory and corticosteroids
  ('Seretide Evohaler', 'Fluticasone/Salmeterol', '125/25mcg', 'Inhaler', 'Respiratory'),
  ('Salbutamol Syrup', 'Salbutamol', '2mg/5ml', 'Syrup', 'Respiratory'),
  ('Aminophylline', 'Aminophylline', '100mg', 'Tablet', 'Respiratory'),
  ('Singulair', 'Montelukast', '10mg', 'Tablet', 'Respiratory'),
  ('Prednisolone', 'Prednisolone', '5mg', 'Tablet', 'Corticosteroid'),
  ('Dexamethasone', 'Dexamethasone', '4mg/ml', 'Injection', 'Corticosteroid'),

  -- Neurology and mental health
  ('Tegretol', 'Carbamazepine', '200mg', 'Tablet', 'Antiepileptic'),
  ('Epanutin', 'Phenytoin', '100mg', 'Capsule', 'Antiepileptic'),
  ('Epilim', 'Sodium valproate', '200mg', 'Tablet', 'Antiepileptic'),
  ('Amitriptyline', 'Amitriptyline', '25mg', 'Tablet', 'Psychiatric'),
  ('Haloperidol', 'Haloperidol', '5mg', 'Tablet', 'Psychiatric'),

  -- Sickle cell
  ('Hydrea', 'Hydroxyurea', '500mg', 'Capsule', 'Sickle cell'),

  -- Obstetric and contraceptive
  ('Ergometrine', 'Ergometrine', '0.5mg/ml', 'Injection', 'Obstetric'),
  ('Cyklokapron', 'Tranexamic acid', '100mg/ml', 'Injection', 'Obstetric'),
  ('Postinor-2', 'Levonorgestrel', '0.75mg', 'Tablet', 'Contraceptive'),
  ('Microgynon', 'Levonorgestrel/Ethinylestradiol', '0.15/0.03mg', 'Tablet', 'Contraceptive'),

  -- Emergency and IV fluids
  ('Adrenaline', 'Adrenaline (epinephrine)', '1mg/ml', 'Injection', 'Emergency'),
  ('Atropine', 'Atropine', '0.6mg/ml', 'Injection', 'Emergency'),
  ('Dextrose 50%', 'Glucose', '50%', 'Injection', 'Emergency'),
  ('Normal Saline', 'Sodium chloride', '0.9% 500ml', 'Infusion', 'IV fluid'),
  ('Ringer''s Lactate', 'Compound sodium lactate', '500ml', 'Infusion', 'IV fluid'),
  ('Dextrose 5%', 'Glucose', '5% 500ml', 'Infusion', 'IV fluid'),

  -- Eye
  ('Chloramphenicol Eye Drops', 'Chloramphenicol', '0.5%', 'Eye drops', 'Eye'),

  -- Supplements
  ('Vitamin C', 'Ascorbic acid', '100mg', 'Tablet', 'Supplement'),
  ('Vitamin B Complex', 'Vitamin B complex', 'Standard', 'Tablet', 'Supplement'),
  ('Ranferon-12', 'Ferrous fumarate/Folic acid/Vitamin B12', '200ml', 'Syrup', 'Supplement'),
  ('Astymin', 'Amino acids/Multivitamin', 'Standard', 'Capsule', 'Supplement'),
  ('Pregnacare', 'Prenatal multivitamin', 'Standard', 'Tablet', 'Supplement')
ON CONFLICT (brand_name, strength, form) DO NOTHING;
