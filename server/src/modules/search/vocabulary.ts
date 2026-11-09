/**
 * Plain-language vocabulary for search (US-02): resource types, specialties and symptom
 * categories, each mapped to a target spec string the search engine understands:
 *   resource:<type>[:<sub_type>] | specialist:<specialty> | drug-generic:<name> | drug-category:<name> | drug-id:<uuid>
 */

export const BED_TYPES = ['ICU', 'General ward', 'Maternity', 'Paediatric', 'Emergency'] as const;
export const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'] as const;
export const EQUIPMENT_TYPES = [
  'Ventilator', 'Dialysis machine', 'CT scanner', 'MRI scanner', 'X-ray', 'Ultrasound', 'Incubator', 'Defibrillator', 'ECG machine',
] as const;
export const OXYGEN_TYPES = ['Oxygen cylinder'] as const;
export const RESOURCE_SUBTYPES = {
  bed: BED_TYPES,
  blood: BLOOD_GROUPS,
  oxygen: OXYGEN_TYPES,
  equipment: EQUIPMENT_TYPES,
} as const;

/** Hospital services patients search by and see on emergency cards (status set daily). */
export const HOSPITAL_SERVICES = [
  'Emergency unit, 24 hours', 'Intensive care (ICU)', 'Maternity and delivery', "Children's care", 'Surgery',
  'Dialysis', 'X-ray', 'CT scan', 'Laboratory', 'Blood bank', 'Oxygen', 'Ventilator', 'Ambulance',
] as const;

/** What a pharmacy offers (registration step 5). */
export const PHARMACY_OFFERS = [
  'Fill prescriptions', 'Cold storage (insulin, vaccines)', 'Blood pressure and sugar checks',
  'Accept NHIA or HMO patients', 'Take reservations through MedAssist-9ja', 'Accept online payment',
] as const;

/** Patient-facing ward names for bed sub-types. */
export const WARD_LABELS: Record<string, string> = {
  Emergency: 'Emergency (A&E)',
  Paediatric: "Children's ward",
  ICU: 'ICU',
  'General ward': 'General ward',
  Maternity: 'Maternity',
};

export const SPECIALTIES = [
  'Cardiology', 'Paediatrics', 'Obstetrics & Gynaecology', 'General Surgery', 'Orthopaedics', 'Neurology', 'Nephrology',
  'Endocrinology', 'Pulmonology', 'Emergency Medicine', 'Internal Medicine', 'Psychiatry', 'Ophthalmology', 'ENT',
  'Dermatology', 'Oncology', 'Urology', 'Haematology',
] as const;

export interface VocabEntry {
  term: string;
  target: string;
  label: string;
}

const entries: VocabEntry[] = [];
const add = (target: string, label: string, ...terms: string[]) => {
  for (const term of [label, ...terms]) entries.push({ term, target, label });
};

add('resource:bed', 'Hospital bed', 'bed', 'admission', 'hospital bed space', 'free bed');
add('resource:bed:ICU', 'ICU bed', 'icu', 'intensive care', 'intensive care unit', 'critical care');
add('resource:bed:General ward', 'General ward bed', 'ward bed', 'general bed');
add('resource:bed:Maternity', 'Maternity bed', 'labour ward', 'delivery bed', 'labour room', 'maternity ward');
add('resource:bed:Paediatric', 'Paediatric bed', 'children ward', 'child bed', 'pediatric bed', 'paediatric ward');
add('resource:bed:Emergency', 'Emergency bed', 'a&e', 'accident and emergency', 'emergency room', 'casualty', 'er');
add('resource:blood', 'Blood (any group)', 'blood', 'blood bank', 'blood transfusion', 'transfusion');
for (const g of BLOOD_GROUPS) {
  const word = g.endsWith('-') ? 'negative' : 'positive';
  const base = g.slice(0, -1);
  add(`resource:blood:${g}`, `Blood ${g}`, `${g} blood`, `${base} ${word}`, `${base} ${word.slice(0, 3)}`, `blood group ${g}`);
}
add('resource:oxygen', 'Oxygen', 'oxygen cylinder', 'o2', 'oxygen tank', 'medical oxygen');
add('resource:equipment:Ventilator', 'Ventilator', 'breathing machine', 'life support', 'respirator');
add('resource:equipment:Dialysis machine', 'Dialysis', 'dialysis machine', 'kidney dialysis', 'haemodialysis', 'hemodialysis');
add('resource:equipment:CT scanner', 'CT scan', 'ct scanner', 'cat scan');
add('resource:equipment:MRI scanner', 'MRI', 'mri scan', 'mri scanner');
add('resource:equipment:X-ray', 'X-ray', 'xray', 'x ray');
add('resource:equipment:Ultrasound', 'Ultrasound', 'scan', 'sonography');
add('resource:equipment:Incubator', 'Incubator', 'baby incubator', 'neonatal incubator');
add('resource:equipment:Defibrillator', 'Defibrillator', 'aed', 'heart shock machine');
add('resource:equipment:ECG machine', 'ECG', 'ecg machine', 'ekg', 'heart tracing');

const specialtyTerms: Record<(typeof SPECIALTIES)[number], string[]> = {
  Cardiology: ['cardiologist', 'heart doctor', 'heart specialist'],
  Paediatrics: ['paediatrician', 'pediatrician', 'child doctor', 'children doctor'],
  'Obstetrics & Gynaecology': ['gynaecologist', 'gynecologist', 'obstetrician', 'obgyn', 'women doctor'],
  'General Surgery': ['surgeon', 'surgery'],
  Orthopaedics: ['orthopaedic surgeon', 'orthopedic', 'bone doctor', 'fracture doctor'],
  Neurology: ['neurologist', 'brain doctor', 'nerve doctor'],
  Nephrology: ['nephrologist', 'kidney doctor', 'kidney specialist'],
  Endocrinology: ['endocrinologist', 'diabetes doctor', 'hormone doctor'],
  Pulmonology: ['pulmonologist', 'chest physician', 'lung doctor'],
  'Emergency Medicine': ['emergency doctor', 'emergency physician'],
  'Internal Medicine': ['physician', 'general physician', 'internist'],
  Psychiatry: ['psychiatrist', 'mental health doctor'],
  Ophthalmology: ['ophthalmologist', 'eye doctor', 'eye specialist'],
  ENT: ['ear nose and throat', 'ent doctor', 'otolaryngologist'],
  Dermatology: ['dermatologist', 'skin doctor'],
  Oncology: ['oncologist', 'cancer doctor', 'cancer specialist'],
  Urology: ['urologist'],
  Haematology: ['haematologist', 'hematologist', 'blood doctor'],
};
for (const s of SPECIALTIES) add(`specialist:${s}`, s, ...specialtyTerms[s]);

export const VOCABULARY = entries;

export interface SymptomCategory {
  key: string;
  label: string;
  icon: string;
  targets: string[];
}

/** Symptom icons for people who do not know medical terms; first target is searched by default. */
export const SYMPTOMS: SymptomCategory[] = [
  { key: 'breathing', label: 'Breathing difficulty', icon: 'lungs', targets: ['resource:oxygen', 'resource:equipment:Ventilator', 'resource:bed:ICU', 'drug-generic:Salbutamol', 'specialist:Pulmonology'] },
  { key: 'chest', label: 'Chest pain / heart', icon: 'heart', targets: ['specialist:Cardiology', 'resource:bed:ICU', 'resource:equipment:ECG machine', 'resource:equipment:Defibrillator'] },
  { key: 'bleeding', label: 'Heavy bleeding', icon: 'drop', targets: ['resource:blood', 'resource:bed:Emergency', 'specialist:General Surgery'] },
  { key: 'accident', label: 'Accident / injury', icon: 'bandage', targets: ['resource:bed:Emergency', 'specialist:Orthopaedics', 'resource:equipment:X-ray', 'resource:blood'] },
  { key: 'pregnancy', label: 'Pregnancy / labour', icon: 'baby', targets: ['resource:bed:Maternity', 'specialist:Obstetrics & Gynaecology', 'resource:equipment:Ultrasound'] },
  { key: 'child', label: 'Sick child', icon: 'child', targets: ['specialist:Paediatrics', 'resource:bed:Paediatric', 'drug-category:Antimalarial'] },
  { key: 'fever', label: 'Fever / malaria', icon: 'thermometer', targets: ['drug-category:Antimalarial', 'drug-generic:Paracetamol', 'specialist:Internal Medicine'] },
  { key: 'diabetes', label: 'Diabetes / sugar', icon: 'syringe', targets: ['drug-category:Insulin', 'drug-generic:Metformin', 'specialist:Endocrinology'] },
  { key: 'kidney', label: 'Kidney problem', icon: 'kidney', targets: ['resource:equipment:Dialysis machine', 'specialist:Nephrology'] },
  { key: 'stroke', label: 'Stroke / fainting', icon: 'brain', targets: ['specialist:Neurology', 'resource:equipment:CT scanner', 'resource:bed:ICU'] },
];
