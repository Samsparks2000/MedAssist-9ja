import bcrypt from 'bcryptjs';
import type pg from 'pg';
import { one, query, tx } from './pool.js';

/**
 * Development seed: a drug catalogue and fictional facilities in the two pilot cities
 * (Lagos and Ibadan). Each city is a pack added only when missing, so an existing database
 * picks up new packs on the next start. Every seeded account uses SEED_PASSWORD.
 */

type DrugSeed = [brand: string, generic: string, strength: string, form: string, category: string];
export const DRUGS: DrugSeed[] = [
  ['Coartem', 'Artemether/Lumefantrine', '80/480mg', 'Tablet', 'Antimalarial'],
  ['Coartem', 'Artemether/Lumefantrine', '20/120mg', 'Dispersible tablet', 'Antimalarial'],
  ['Lonart DS', 'Artemether/Lumefantrine', '80/480mg', 'Tablet', 'Antimalarial'],
  ['Amatem Softgel', 'Artemether/Lumefantrine', '80/480mg', 'Capsule', 'Antimalarial'],
  ['P-Alaxin', 'Dihydroartemisinin/Piperaquine', '40/320mg', 'Tablet', 'Antimalarial'],
  ['Camosunate', 'Artesunate/Amodiaquine', '100/270mg', 'Tablet', 'Antimalarial'],
  ['Artesun', 'Artesunate', '60mg', 'Injection', 'Antimalarial'],
  ['Panadol', 'Paracetamol', '500mg', 'Tablet', 'Analgesic'],
  ['Panadol Extra', 'Paracetamol/Caffeine', '500/65mg', 'Tablet', 'Analgesic'],
  ['Emzor Paracetamol', 'Paracetamol', '500mg', 'Tablet', 'Analgesic'],
  ['Emzor Paracetamol Syrup', 'Paracetamol', '120mg/5ml', 'Syrup', 'Analgesic'],
  ['Brufen', 'Ibuprofen', '400mg', 'Tablet', 'Analgesic'],
  ['Voltaren', 'Diclofenac', '50mg', 'Tablet', 'Analgesic'],
  ['Augmentin', 'Amoxicillin/Clavulanic acid', '625mg', 'Tablet', 'Antibiotic'],
  ['Amoxil', 'Amoxicillin', '500mg', 'Capsule', 'Antibiotic'],
  ['Ciprotab', 'Ciprofloxacin', '500mg', 'Tablet', 'Antibiotic'],
  ['Flagyl', 'Metronidazole', '400mg', 'Tablet', 'Antibiotic'],
  ['Rocephin', 'Ceftriaxone', '1g', 'Injection', 'Antibiotic'],
  ['Zithromax', 'Azithromycin', '500mg', 'Tablet', 'Antibiotic'],
  ['Mixtard 30', 'Insulin human (biphasic isophane)', '100IU/ml', 'Injection', 'Insulin'],
  ['Actrapid', 'Insulin human (soluble)', '100IU/ml', 'Injection', 'Insulin'],
  ['Lantus', 'Insulin glargine', '100IU/ml', 'Injection', 'Insulin'],
  ['Lantus SoloStar', 'Insulin glargine', '100IU/ml 3ml pen', 'Pen', 'Insulin'],
  ['Basaglar KwikPen', 'Insulin glargine', '100IU/ml 3ml pen', 'Pen', 'Insulin'],
  ['NovoRapid', 'Insulin aspart', '100IU/ml', 'Injection', 'Insulin'],
  ['NovoMix 30 FlexPen', 'Insulin aspart (biphasic)', '100IU/ml 3ml pen', 'Pen', 'Insulin'],
  ['Humulin R', 'Insulin human (regular)', '100IU/ml', 'Injection', 'Insulin'],
  ['Insulin Syringes', 'Insulin syringe', '1ml x10', 'Syringe', 'Diabetes supplies'],
  ['Accu-Chek Test Strips', 'Glucose test strips', 'x50', 'Strips', 'Diabetes supplies'],
  ['Glucophage', 'Metformin', '500mg', 'Tablet', 'Antidiabetic'],
  ['Daonil', 'Glibenclamide', '5mg', 'Tablet', 'Antidiabetic'],
  ['Norvasc', 'Amlodipine', '5mg', 'Tablet', 'Antihypertensive'],
  ['Norvasc', 'Amlodipine', '10mg', 'Tablet', 'Antihypertensive'],
  ['Zestril', 'Lisinopril', '10mg', 'Tablet', 'Antihypertensive'],
  ['Moduretic', 'Amiloride/Hydrochlorothiazide', '5/50mg', 'Tablet', 'Antihypertensive'],
  ['Aldomet', 'Methyldopa', '250mg', 'Tablet', 'Antihypertensive'],
  ['Ventolin Inhaler', 'Salbutamol', '100mcg', 'Inhaler', 'Respiratory'],
  ['Ventolin', 'Salbutamol', '4mg', 'Tablet', 'Respiratory'],
  ['EpiPen', 'Adrenaline (epinephrine)', '0.3mg', 'Auto-injector', 'Emergency'],
  ['Solu-Cortef', 'Hydrocortisone', '100mg', 'Injection', 'Emergency'],
  ['Valium', 'Diazepam', '10mg/2ml', 'Injection', 'Emergency'],
  ['Syntocinon', 'Oxytocin', '10IU', 'Injection', 'Obstetric'],
  ['Cytotec', 'Misoprostol', '200mcg', 'Tablet', 'Obstetric'],
  ['Magnesium Sulphate', 'Magnesium sulphate', '50%', 'Injection', 'Obstetric'],
  ['Emzor ORS', 'Oral rehydration salts', '20.5g', 'Sachet', 'Rehydration'],
  ['Zinc Sulphate', 'Zinc', '20mg', 'Dispersible tablet', 'Rehydration'],
  ['Losec', 'Omeprazole', '20mg', 'Capsule', 'Gastrointestinal'],
  ['Clarityne', 'Loratadine', '10mg', 'Tablet', 'Antihistamine'],
  ['Phenergan', 'Promethazine', '25mg', 'Tablet', 'Antihistamine'],
  ['Zentel', 'Albendazole', '400mg', 'Tablet', 'Anthelmintic'],
  ['Folic Acid', 'Folic acid', '5mg', 'Tablet', 'Supplement'],
  ['Fersolate', 'Ferrous sulphate', '200mg', 'Tablet', 'Supplement'],
];

const hours = (open: string, close: string, sunday: [string, string] | null = ['12:00', '18:00']) => ({
  mon: [open, close], tue: [open, close], wed: [open, close], thu: [open, close], fri: [open, close],
  sat: [open, close], sun: sunday,
});

interface FacilitySeed {
  slug: string;
  owner: string;
  name: string;
  type: 'pharmacy' | 'hospital';
  address: string;
  lat: number;
  lng: number;
  phone: string;
  open24h?: boolean;
  closes?: string;
  general?: boolean;
  status?: 'approved' | 'pending';
  staleHours?: number;
  area?: string;
  landmark?: string;
  /** Hospital services that are not available today (everything else listed is). */
  servicesDown?: Partial<Record<string, 'under_repair' | 'not_available'>>;
  services?: string[];
}

type StockSeed = [brand: string, strength: string, quantity: number, price: number];
type ResSeed = [type: 'bed' | 'blood' | 'oxygen' | 'equipment', subType: string, capacity: number, available: number, price?: number];
interface SpecialistSeed {
  slug: string;
  name: string;
  specialty: string;
  licence: string;
  where: string[];
  status?: 'approved' | 'pending';
}

interface CityPack {
  city: string;
  hospitalLicencePrefix: string;
  /** Prefix for generated owner and specialist phone numbers, kept distinct per city. */
  ownerPhone: string;
  specialistPhone: string;
  facilities: FacilitySeed[];
  stock: Record<string, StockSeed[]>;
  resources: Record<string, ResSeed[]>;
  specialists: SpecialistSeed[];
  /** Pack-specific extras run after the generic seeding. */
  extra?: (c: pg.PoolClient, ids: Record<string, string>, drugId: (b: string, s: string) => Promise<string>) => Promise<void>;
}

const LAGOS: CityPack = {
  city: 'Lagos',
  hospitalLicencePrefix: 'LSMOH',
  ownerPhone: '+234805',
  specialistPhone: '+234806',
  facilities: [
    { slug: 'tunde', owner: 'Pharm. Tunde Adeyemi', name: "Tunde's Care Pharmacy", type: 'pharmacy', address: '14 Herbert Macaulay Way, Yaba', lat: 6.5072, lng: 3.3735, phone: '+2348031110001' },
    { slug: 'lekki-wellness', owner: 'Pharm. Ngozi Eze', name: 'Lekki Wellness Pharmacy', type: 'pharmacy', address: '22 Admiralty Way, Lekki Phase 1', lat: 6.4489, lng: 3.4741, phone: '+2348031110002' },
    { slug: 'ikeja-central', owner: 'Pharm. Musa Lawal', name: 'Ikeja Central Pharmacy', type: 'pharmacy', address: '5 Allen Avenue, Ikeja', lat: 6.6005, lng: 3.3552, phone: '+2348031110003' },
    { slug: 'surulere-family', owner: 'Pharm. Kola Bankole', name: 'Surulere Family Pharmacy', type: 'pharmacy', address: '31 Adeniran Ogunsanya St, Surulere', lat: 6.4925, lng: 3.3555, phone: '+2348031110004' },
    { slug: 'vi-medicare', owner: 'Pharm. Ada Obi', name: 'VI Medicare Pharmacy', type: 'pharmacy', address: '9 Adeola Odeku St, Victoria Island', lat: 6.4307, lng: 3.4196, phone: '+2348031110005' },
    { slug: 'maryland-247', owner: 'Pharm. Femi Ajayi', name: 'Maryland 24/7 Pharmacy', type: 'pharmacy', address: '2 Mobolaji Bank Anthony Way, Maryland', lat: 6.5722, lng: 3.3661, phone: '+2348031110006', open24h: true },
    { slug: 'ajah-community', owner: 'Pharm. Halima Bello', name: 'Ajah Community Pharmacy', type: 'pharmacy', address: '40 Addo Road, Ajah', lat: 6.4712, lng: 3.5791, phone: '+2348031110007', staleHours: 30 },
    { slug: 'festac', owner: 'Pharm. Chinedu Okeke', name: 'Festac Health Pharmacy', type: 'pharmacy', address: '23 Road, Festac Town', lat: 6.4681, lng: 3.2851, phone: '+2348031110008' },
    { slug: 'gbagada-new', owner: 'Pharm. Sade Ogun', name: 'Gbagada New Hope Pharmacy', type: 'pharmacy', address: '7 Diya St, Gbagada', lat: 6.5541, lng: 3.3877, phone: '+2348031110009', status: 'pending' },
    { slug: 'bello', owner: 'Mrs. Folake Bello', name: 'Bello Specialist Hospital', type: 'hospital', address: '18 Oba Akran Avenue, Ikeja', lat: 6.6044, lng: 3.3462, phone: '+2348031110010', open24h: true },
    { slug: 'mainland-general', owner: 'Dr. Tope Alabi', name: 'Mainland General Hospital', type: 'hospital', address: '1 Hospital Road, Yaba', lat: 6.5118, lng: 3.3786, phone: '+2348031110011', open24h: true, general: true },
    { slug: 'island-general', owner: 'Dr. Yemi Cole', name: 'Island General Hospital', type: 'hospital', address: '3 Broad Street, Lagos Island', lat: 6.4537, lng: 3.3913, phone: '+2348031110012', open24h: true, general: true },
    { slug: 'lekki-heart', owner: 'Dr. Ifeoma Nwosu', name: 'Lekki Heart & Critical Care Centre', type: 'hospital', address: '11 Fola Osibo Road, Lekki Phase 1', lat: 6.4421, lng: 3.4669, phone: '+2348031110013', open24h: true },
    { slug: 'surulere-mch', owner: 'Dr. Bisi Adebayo', name: 'Surulere Mother & Child Hospital', type: 'hospital', address: '50 Bode Thomas St, Surulere', lat: 6.4874, lng: 3.3539, phone: '+2348031110014', open24h: true },
    { slug: 'ikorodu-kidney', owner: 'Dr. Sani Garba', name: 'Ikorodu Kidney & Dialysis Centre', type: 'hospital', address: '12 Lagos Road, Ikorodu', lat: 6.6151, lng: 3.5072, phone: '+2348031110015', open24h: true },
  ],
  stock: {
    tunde: [['Coartem', '80/480mg', 40, 3800], ['Panadol', '500mg', 300, 60], ['Mixtard 30', '100IU/ml', 6, 9500], ['Augmentin', '625mg', 25, 6500], ['Glucophage', '500mg', 120, 2200], ['Ventolin Inhaler', '100mcg', 8, 4200], ['Emzor ORS', '20.5g', 80, 250]],
    'lekki-wellness': [['Lantus', '100IU/ml', 5, 28000], ['NovoRapid', '100IU/ml', 4, 21000], ['Coartem', '80/480mg', 25, 4200], ['Panadol Extra', '500/65mg', 200, 120], ['Norvasc', '5mg', 60, 5200], ['Losec', '20mg', 40, 3500]],
    'ikeja-central': [['Mixtard 30', '100IU/ml', 10, 9000], ['Actrapid', '100IU/ml', 7, 9800], ['Lonart DS', '80/480mg', 50, 2500], ['Ciprotab', '500mg', 60, 1800], ['Flagyl', '400mg', 100, 900], ['EpiPen', '0.3mg', 2, 65000]],
    'surulere-family': [['P-Alaxin', '40/320mg', 30, 3200], ['Emzor Paracetamol', '500mg', 400, 40], ['Emzor Paracetamol Syrup', '120mg/5ml', 30, 700], ['Zinc Sulphate', '20mg', 50, 900], ['Amoxil', '500mg', 80, 1500], ['Humulin R', '100IU/ml', 3, 11000]],
    'vi-medicare': [['Lantus', '100IU/ml', 3, 30000], ['Zithromax', '500mg', 20, 7800], ['Clarityne', '10mg', 40, 2600], ['Brufen', '400mg', 90, 1200], ['Zestril', '10mg', 45, 4800]],
    'maryland-247': [['Coartem', '80/480mg', 30, 3900], ['Mixtard 30', '100IU/ml', 4, 9600], ['Ventolin Inhaler', '100mcg', 12, 4000], ['Solu-Cortef', '100mg', 10, 3500], ['Panadol', '500mg', 250, 60], ['Rocephin', '1g', 15, 4500]],
    'ajah-community': [['Coartem', '80/480mg', 15, 4000], ['Panadol', '500mg', 150, 70], ['Mixtard 30', '100IU/ml', 2, 9900]],
    festac: [['Amatem Softgel', '80/480mg', 35, 2800], ['Camosunate', '100/270mg', 25, 1500], ['Aldomet', '250mg', 60, 2500], ['Fersolate', '200mg', 100, 600], ['Folic Acid', '5mg', 120, 300]],
    'mainland-general': [['Artesun', '60mg', 40, 2500], ['Syntocinon', '10IU', 30, 800], ['Magnesium Sulphate', '50%', 20, 1500], ['Rocephin', '1g', 40, 4000]],
    'surulere-mch': [['Syntocinon', '10IU', 25, 850], ['Cytotec', '200mcg', 40, 900], ['Emzor Paracetamol Syrup', '120mg/5ml', 20, 700], ['Coartem', '20/120mg', 30, 2500]],
  },
  resources: {
    bello: [['bed', 'ICU', 6, 2, 150000], ['bed', 'General ward', 30, 8, 20000], ['bed', 'Emergency', 8, 3], ['blood', 'O+', 0, 12], ['blood', 'A+', 0, 6], ['oxygen', 'Oxygen cylinder', 20, 9], ['equipment', 'Ventilator', 4, 1], ['equipment', 'CT scanner', 1, 1], ['equipment', 'X-ray', 2, 2]],
    'mainland-general': [['bed', 'General ward', 120, 14], ['bed', 'Emergency', 20, 5], ['bed', 'Maternity', 40, 6], ['bed', 'Paediatric', 30, 4], ['blood', 'O+', 0, 20], ['blood', 'O-', 0, 3], ['blood', 'B+', 0, 9], ['oxygen', 'Oxygen cylinder', 50, 18], ['equipment', 'X-ray', 3, 2], ['equipment', 'Ultrasound', 3, 2]],
    'island-general': [['bed', 'General ward', 90, 0], ['bed', 'Emergency', 15, 2], ['bed', 'ICU', 8, 0], ['blood', 'O+', 0, 7], ['blood', 'AB+', 0, 2], ['oxygen', 'Oxygen cylinder', 30, 6], ['equipment', 'Ventilator', 5, 0]],
    'lekki-heart': [['bed', 'ICU', 10, 3, 250000], ['bed', 'Emergency', 6, 2], ['oxygen', 'Oxygen cylinder', 25, 12], ['equipment', 'Ventilator', 6, 2], ['equipment', 'ECG machine', 4, 4], ['equipment', 'Defibrillator', 4, 4], ['equipment', 'CT scanner', 1, 1]],
    'surulere-mch': [['bed', 'Maternity', 25, 5, 50000], ['bed', 'Paediatric', 20, 6], ['equipment', 'Incubator', 8, 3], ['equipment', 'Ultrasound', 2, 2], ['blood', 'O+', 0, 5], ['blood', 'O-', 0, 1]],
    'ikorodu-kidney': [['equipment', 'Dialysis machine', 6, 2], ['bed', 'General ward', 20, 7], ['oxygen', 'Oxygen cylinder', 10, 4]],
  },
  specialists: [
    { slug: 'okafor', name: 'Dr. Emeka Okafor', specialty: 'Cardiology', licence: 'MDCN/R/45512', where: ['bello', 'lekki-heart'] },
    { slug: 'adeyemi', name: 'Dr. Funmi Adeyemi', specialty: 'Paediatrics', licence: 'MDCN/R/38221', where: ['surulere-mch', 'mainland-general'] },
    { slug: 'ibrahim', name: 'Dr. Aisha Ibrahim', specialty: 'Obstetrics & Gynaecology', licence: 'MDCN/R/40987', where: ['surulere-mch'] },
    { slug: 'eze', name: 'Dr. Chuka Eze', specialty: 'Nephrology', licence: 'MDCN/R/41230', where: ['ikorodu-kidney'] },
    { slug: 'ogun', name: 'Dr. Lanre Ogun', specialty: 'Emergency Medicine', licence: 'MDCN/R/47700', where: ['mainland-general', 'island-general'] },
  ],
  extra: async (c, ids, drugId) => {
    // One batch close to expiry so the expiry alert flow is visible.
    await query(
      `INSERT INTO inventory_items (facility_id, drug_id, quantity, price, batch_no, expiry_date, reorder_level)
       VALUES ($1, $2, 18, 1500, 'TUN-EXP1', current_date + 25, 5)`,
      [ids.tunde, await drugId('Amoxil', '500mg')],
      c,
    );
  },
};

// Ibadan pack follows the MVP design's sample data (Bodija Market Pharmacy, Bodija Specialist Hospital, …).
const IBADAN: CityPack = {
  city: 'Ibadan',
  hospitalLicencePrefix: 'OYSMOH',
  // 0807/0808 were used by an earlier draft of this pack; keep clear of them on older databases.
  ownerPhone: '+234809',
  specialistPhone: '+234810',
  facilities: [
    { slug: 'bodija-market', owner: 'Pharm. Tunde Afolayan', name: 'Bodija Market Pharmacy', type: 'pharmacy', address: '14 Awolowo Avenue', area: 'Bodija', landmark: "Opposite the market's main gate", lat: 7.4268, lng: 3.9128, phone: '+2348012345201' },
    { slug: 'ui-gate', owner: 'Pharm. Bimpe Oladipo', name: 'UI Gate Pharmacy', type: 'pharmacy', address: '3 UI–Ojoo Road', area: 'Agbowo', landmark: 'Beside the UI main gate', lat: 7.444, lng: 3.9075, phone: '+2348012345202', open24h: true },
    { slug: 'mokola-community', owner: 'Pharm. Segun Alade', name: 'Mokola Community Pharmacy', type: 'pharmacy', address: '2 Mokola Roundabout', area: 'Mokola', landmark: 'By the roundabout', lat: 7.406, lng: 3.8935, phone: '+2348012345203', closes: '20:00', staleHours: 30 },
    { slug: 'dugbe-health', owner: 'Pharm. Hauwa Yusuf', name: 'Dugbe Health Pharmacy', type: 'pharmacy', address: '9 Dugbe Market Road', area: 'Dugbe', landmark: 'Near Cocoa House', lat: 7.3895, lng: 3.8885, phone: '+2348012345204' },
    { slug: 'iwo-road-chemists', owner: 'Pharm. Dayo Akinola', name: 'Iwo Road Chemists', type: 'pharmacy', address: '40 Iwo Road', area: 'Iwo Road', landmark: 'Opposite the motor park', lat: 7.4085, lng: 3.9465, phone: '+2348012345205' },
    { slug: 'agbowo-health', owner: 'Mr. Daniel Afolabi', name: 'Agbowo Health Pharmacy', type: 'pharmacy', address: '22 UI–Ojoo Road', area: 'Agbowo', landmark: 'Opposite UI main gate, beside the bus stop', lat: 7.4446, lng: 3.899, phone: '+2348051232231', status: 'pending' },
    { slug: 'bodija-specialist', owner: 'Mrs. Folake Bello', name: 'Bodija Specialist Hospital', type: 'hospital', address: '22 Bodija Estate Road', area: 'Bodija', landmark: 'Behind Bodija post office', lat: 7.421, lng: 3.9105, phone: '+2348023456101', open24h: true,
      services: ['Emergency unit, 24 hours', 'Intensive care (ICU)', 'Maternity and delivery', "Children's care", 'Oxygen', 'Ventilator', 'CT scan', 'Dialysis', 'Ambulance', 'Blood bank', 'Laboratory'],
      servicesDown: { 'CT scan': 'under_repair', Dialysis: 'not_available' } },
    { slug: 'agodi-medical', owner: 'Mrs. Tolu Ige', name: 'Agodi Medical Centre', type: 'hospital', address: '8 Agodi Gate Road', area: 'Agodi', landmark: 'Near Agodi Gardens', lat: 7.4075, lng: 3.916, phone: '+2348023456102', open24h: true,
      services: ['Emergency unit, 24 hours', 'Oxygen', 'Ambulance', 'Laboratory', 'X-ray', 'Surgery'] },
    { slug: 'ring-road-general', owner: 'Dr. Femi Oyewole', name: 'Ring Road General Hospital', type: 'hospital', address: '30 Ring Road', area: 'Ring Road', landmark: 'Beside the State Secretariat junction', lat: 7.361, lng: 3.876, phone: '+2348023456103', open24h: true, general: true, staleHours: 30,
      services: ['Emergency unit, 24 hours', 'Intensive care (ICU)', 'Maternity and delivery', 'Surgery', 'Blood bank', 'Oxygen', 'X-ray', 'Laboratory'] },
    { slug: 'akobo-kidney', owner: 'Dr. Kunle Ojo', name: 'Akobo Kidney & Dialysis Centre', type: 'hospital', address: '6 Akobo Estate Road', area: 'Akobo', lat: 7.4245, lng: 3.956, phone: '+2348023456104', open24h: true,
      services: ['Dialysis', 'Laboratory'] },
    { slug: 'oke-ado-mission', owner: 'Dr. Grace Adewale', name: 'Oke-Ado Mission Hospital', type: 'hospital', address: 'Oke-Ado Road', area: 'Oke-Ado', landmark: 'Near Oke-Ado market', lat: 7.375, lng: 3.88, phone: '+2348023457701', open24h: true, status: 'pending',
      services: ['Emergency unit, 24 hours', 'Maternity and delivery', "Children's care", 'Surgery', 'X-ray', 'Laboratory', 'Blood bank', 'Oxygen'] },
  ],
  stock: {
    'bodija-market': [['Lantus SoloStar', '100IU/ml 3ml pen', 12, 14500], ['Glucophage', '500mg', 42, 1900], ['Coartem', '80/480mg', 30, 3500], ['Norvasc', '5mg', 6, 1600], ['Ventolin Inhaler', '100mcg', 18, 4800], ['Insulin Syringes', '1ml x10', 30, 2000], ['Accu-Chek Test Strips', 'x50', 12, 8500], ['Rocephin', '1g', 9, 3200]],
    'ui-gate': [['Lantus SoloStar', '100IU/ml 3ml pen', 3, 13900], ['Mixtard 30', '100IU/ml', 8, 9200], ['Augmentin', '625mg', 18, 6600], ['Emzor Paracetamol', '500mg', 300, 40], ['Solu-Cortef', '100mg', 8, 3600]],
    'mokola-community': [['Basaglar KwikPen', '100IU/ml 3ml pen', 4, 13800], ['NovoMix 30 FlexPen', '100IU/ml 3ml pen', 3, 17500], ['Lonart DS', '80/480mg', 40, 2400]],
    'dugbe-health': [['Lantus SoloStar', '100IU/ml 3ml pen', 20, 15200], ['Amoxil', '500mg', 60, 2200], ['Panadol', '500mg', 200, 60], ['P-Alaxin', '40/320mg', 20, 3100]],
    'iwo-road-chemists': [['Coartem', '80/480mg', 25, 3800], ['Emzor ORS', '20.5g', 50, 250], ['EpiPen', '0.3mg', 1, 66000]],
    'agodi-medical': [['Artesun', '60mg', 30, 2500], ['Rocephin', '1g', 30, 4000]],
  },
  resources: {
    'bodija-specialist': [['bed', 'Emergency', 8, 3], ['bed', 'ICU', 6, 1, 150000], ['bed', 'General ward', 40, 14, 20000], ['bed', 'Maternity', 12, 5, 40000], ['bed', 'Paediatric', 10, 0],
      ['blood', 'A+', 0, 6], ['blood', 'A-', 0, 1], ['blood', 'B+', 0, 4], ['blood', 'B-', 0, 0], ['blood', 'AB+', 0, 2], ['blood', 'AB-', 0, 0], ['blood', 'O+', 0, 9], ['blood', 'O-', 0, 2],
      ['oxygen', 'Oxygen cylinder', 20, 9], ['equipment', 'Ventilator', 4, 2], ['equipment', 'CT scanner', 1, 0], ['equipment', 'Dialysis machine', 2, 0]],
    'agodi-medical': [['bed', 'Emergency', 10, 3], ['bed', 'General ward', 30, 6], ['blood', 'O+', 0, 5], ['oxygen', 'Oxygen cylinder', 15, 6], ['equipment', 'X-ray', 1, 1]],
    'ring-road-general': [['bed', 'Emergency', 18, 4], ['bed', 'ICU', 8, 4], ['bed', 'General ward', 100, 12], ['bed', 'Maternity', 30, 5], ['blood', 'O+', 0, 15], ['blood', 'O-', 0, 2], ['oxygen', 'Oxygen cylinder', 40, 14], ['equipment', 'X-ray', 2, 2]],
    'akobo-kidney': [['equipment', 'Dialysis machine', 5, 2], ['bed', 'General ward', 12, 4]],
  },
  specialists: [
    { slug: 'c-okafor', name: 'Dr. Chinedu Okafor', specialty: 'Cardiology', licence: 'MDCN/R/52101', where: ['bodija-specialist', 'agodi-medical'] },
    { slug: 'f-adeyemi', name: 'Dr. Folasade Adeyemi', specialty: 'Obstetrics & Gynaecology', licence: 'MDCN/R/52230', where: ['bodija-specialist'] },
    { slug: 'm-bakare', name: 'Dr. Musa Bakare', specialty: 'Paediatrics', licence: 'MDCN/R/52345', where: ['bodija-specialist', 'ring-road-general'] },
    { slug: 't-ojo', name: 'Dr. Tayo Ojo', specialty: 'Orthopaedics', licence: 'MDCN/R/52410', where: ['bodija-specialist'] },
    { slug: 'k-danjuma', name: 'Dr. Kabir Danjuma', specialty: 'Emergency Medicine', licence: 'MDCN/R/52500', where: ['ring-road-general', 'agodi-medical'] },
    { slug: 's-lawal', name: 'Dr. Samuel Lawal', specialty: 'Neurology', licence: 'MDCN/R/52611', where: ['bodija-specialist'], status: 'pending' },
  ],
};

const PACKS = [LAGOS, IBADAN];

const RETIRED_SAMPLE_ACCOUNTS = [
  'bodija-care', 'mokola', 'alpha-sango', 'iwo-road-247', 'ring-road-pharm', 'ibadan-central', 'agodi-specialist',
  'bodija-mch', 'ring-road-heart', 'akobo-dialysis',
].map((s) => `${s}@medassist.test`);

const PRESCRIPTION_CATEGORIES = new Set(['Insulin', 'Antibiotic', 'Antidiabetic', 'Antihypertensive', 'Obstetric', 'Emergency']);
const COLD_CATEGORIES = new Set(['Insulin', 'Obstetric']);

function defaultServices(resources: ResSeed[], open24h: boolean): string[] {
  const s = new Set<string>();
  if (open24h && resources.some(([t, sub]) => t === 'bed' && sub === 'Emergency')) s.add('Emergency unit, 24 hours');
  for (const [t, sub] of resources) {
    if (t === 'bed' && sub === 'ICU') s.add('Intensive care (ICU)');
    if (t === 'bed' && sub === 'Maternity') s.add('Maternity and delivery');
    if (t === 'bed' && sub === 'Paediatric') s.add("Children's care");
    if (t === 'blood') s.add('Blood bank');
    if (t === 'oxygen') s.add('Oxygen');
    if (t === 'equipment' && sub === 'Ventilator') s.add('Ventilator');
    if (t === 'equipment' && sub === 'CT scanner') s.add('CT scan');
    if (t === 'equipment' && sub === 'X-ray') s.add('X-ray');
    if (t === 'equipment' && sub === 'Dialysis machine') s.add('Dialysis');
  }
  s.add('Laboratory');
  return [...s];
}

const addMonths = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};

async function seedCatalogue(c: pg.PoolClient) {
  for (const [brand, generic, strength, form, category] of DRUGS) {
    await query(
      `INSERT INTO drug_catalogue (brand_name, generic_name, strength, form, category) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (brand_name, strength, form) DO NOTHING`,
      [brand, generic, strength, form, category],
      c,
    );
  }
}

async function seedCity(c: pg.PoolClient, pack: CityPack, hash: string) {
  const drugId = async (brand: string, strength: string) =>
    (await one('SELECT id FROM drug_catalogue WHERE brand_name = $1 AND strength = $2', [brand, strength], c))!.id as string;

  const ids: Record<string, string> = {};
  for (const [n, f] of pack.facilities.entries()) {
    const owner = await one(
      `INSERT INTO users (name, email, phone, role, password_hash, consent_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
      [f.owner, `${f.slug}@medassist.test`, `${pack.ownerPhone}${String(n + 1).padStart(7, '0')}`, f.type, hash],
      c,
    );
    const status = f.status ?? 'approved';
    const row = await one(
      `INSERT INTO facilities (owner_id, name, type, is_general_hospital, licence_no, address, lat, lng, phone, opening_hours, open_24h,
                               verification_status, verified_at, last_updated, reliability_score, area, landmark, emergency_phone,
                               kind, offers, submitted_at, lead_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, CASE WHEN $12 = 'approved' THEN now() END,
               now() - make_interval(hours => $13), $14, $15, $16, $17, $18, $19, now() - interval '2 days', $20) RETURNING id`,
      [
        owner!.id, f.name, f.type, !!f.general,
        `${f.type === 'pharmacy' ? 'PCN' : pack.hospitalLicencePrefix}/${10001 + n}`,
        `${f.address}, ${f.area ? f.area + ', ' : ''}${pack.city}`, f.lat, f.lng, f.phone, JSON.stringify(hours('08:00', f.closes ?? '21:00')),
        !!f.open24h, status, f.staleHours ?? 0, 0.5 + (((n + 2) * 7) % 10) / 40,
        f.area ?? null, f.landmark ?? null, f.type === 'hospital' ? f.phone : null,
        f.type === 'pharmacy' ? 'Community pharmacy' : f.general ? 'General hospital' : 'Specialist hospital',
        f.type === 'pharmacy' ? ['Fill prescriptions', 'Cold storage (insulin, vaccines)', 'Take reservations through MedAssist-9ja', 'Accept online payment'] : (f.services ?? []),
        f.owner,
      ],
      c,
    );
    ids[f.slug] = row!.id;
    if (f.type === 'hospital') {
      // Hospitals without an explicit list get services implied by what they stock.
      const services = f.services ?? defaultServices(pack.resources[f.slug] ?? [], !!f.open24h);
      for (const s of services) {
        await query('INSERT INTO facility_services (facility_id, service, status) VALUES ($1, $2, $3)', [row!.id, s, f.servicesDown?.[s] ?? 'available'], c);
      }
    }
  }

  for (const [slug, items] of Object.entries(pack.stock)) {
    for (const [i, [brand, strength, qty, price]] of items.entries()) {
      const drug = await one('SELECT id, category FROM drug_catalogue WHERE brand_name = $1 AND strength = $2', [brand, strength], c);
      await query(
        `INSERT INTO inventory_items (facility_id, drug_id, quantity, price, batch_no, expiry_date, reorder_level, updated_at,
                                     cost_price, needs_prescription, refrigerated)
         VALUES ($1,$2,$3,$4,$5,$6,$7, (SELECT last_updated FROM facilities WHERE id = $1), $8, $9, $10)`,
        [
          ids[slug], drug!.id, qty, price, `${slug.slice(0, 3).toUpperCase()}${2600 + i}`, addMonths(6 + (i % 12)), Math.max(2, Math.round(qty / 5)),
          Math.round(price * 0.76), PRESCRIPTION_CATEGORIES.has(drug!.category), COLD_CATEGORIES.has(drug!.category),
        ],
        c,
      );
    }
  }

  for (const [slug, items] of Object.entries(pack.resources)) {
    for (const [type, sub, cap, avail, price] of items) {
      await query(
        `INSERT INTO resources (facility_id, type, sub_type, capacity, available, status, price) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ids[slug], type, sub, type === 'blood' ? avail : cap, avail, type === 'equipment' ? (avail > 0 ? 'available' : 'in_use') : null, price ?? null],
        c,
      );
    }
  }

  for (const [i, s] of pack.specialists.entries()) {
    const u = await one(
      `INSERT INTO users (name, email, phone, role, password_hash, consent_at) VALUES ($1,$2,$3,'specialist',$4, now()) RETURNING id`,
      [s.name, `${s.slug}@medassist.test`, `${pack.specialistPhone}${String(i + 1).padStart(7, '0')}`, hash],
      c,
    );
    const approved = (s.status ?? 'approved') === 'approved';
    const sp = await one(
      `INSERT INTO specialists (user_id, specialty, licence_no, verification_status, available_now, available_at, languages, years_experience)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [u!.id, s.specialty, s.licence, s.status ?? 'approved', approved && i % 2 === 0, approved && i % 2 === 0 ? ids[s.where[0]] : null,
        ['English', 'Yoruba'], 5 + i * 2],
      c,
    );
    for (const [j, slug] of s.where.entries()) {
      await query(
        'INSERT INTO specialist_hospitals (specialist_id, facility_id, position, status) VALUES ($1, $2, $3, $4)',
        [sp!.id, ids[slug], j === 0 ? 'Consultant' : 'Visiting consultant', approved || j === 0 ? 'confirmed' : 'pending'],
        c,
      );
      for (let day = 0; day < 7; day++) {
        // Alternate day/evening shifts across their hospitals so someone is usually on duty.
        const [start, end] = (day + j) % 2 === 0 ? ['08:00', '16:00'] : ['16:00', '23:59'];
        await query(
          'INSERT INTO duty_schedules (specialist_id, facility_id, day, start_time, end_time) VALUES ($1,$2,$3,$4,$5)',
          [sp!.id, ids[slug], day, start, end],
          c,
        );
      }
    }
  }
  await pack.extra?.(c, ids, drugId);
}

/**
 * Seeds a fresh database, and adds any city pack (or catalogue entry) an older database lacks.
 * Returns the names of the cities seeded.
 */
export async function seedIfEmpty(): Promise<string[]> {
  const password = process.env.SEED_PASSWORD || 'MedAssist#2026';
  const hash = await bcrypt.hash(password, 10);
  const fresh = !(await one('SELECT 1 FROM users LIMIT 1'));
  const seeded: string[] = [];

  await tx(async (c) => {
    await seedCatalogue(c);
    if (fresh) {
      await query(
        `INSERT INTO users (name, email, phone, role, password_hash, consent_at) VALUES ('Kemi Admin', 'admin@medassist.test', '+2348030000000', 'admin', $1, now())`,
        [hash],
        c,
      );
    }
    // An earlier draft of the Ibadan sample data is retired (suspended, not deleted) so it does
    // not appear next to the current sample facilities.
    await query(
      `UPDATE facilities SET verification_status = 'suspended', verification_note = 'Retired sample data'
        WHERE verification_status = 'approved'
          AND owner_id IN (SELECT id FROM users WHERE email = ANY($1))`,
      [RETIRED_SAMPLE_ACCOUNTS],
      c,
    );
    for (const pack of PACKS) {
      const marker = `${pack.facilities[0].slug}@medassist.test`;
      if (await one('SELECT 1 FROM users WHERE email = $1', [marker], c)) continue;
      await seedCity(c, pack, hash);
      seeded.push(pack.city);
    }
    if (fresh) {
      // A pending specialist for the admin verification queue.
      const pending = await one(
        `INSERT INTO users (name, email, phone, role, password_hash, consent_at) VALUES ('Dr. Tobi Akin', 'akin@medassist.test', '+2348069999999', 'specialist', $1, now()) RETURNING id`,
        [hash],
        c,
      );
      await query(`INSERT INTO specialists (user_id, specialty, licence_no) VALUES ($1, 'Neurology', 'MDCN/R/50011')`, [pending!.id], c);
    }
  });
  if (seeded.length) console.log(`Seeded demo data for ${seeded.join(' and ')} (accounts use SEED_PASSWORD; see README).`);
  return seeded;
}
