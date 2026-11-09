/** Local government areas for the pilot cities (registration "Local government area"). */
export const LGAS: Record<string, string[]> = {
  Ibadan: ['Ibadan North', 'Ibadan North-East', 'Ibadan North-West', 'Ibadan South-East', 'Ibadan South-West', 'Akinyele', 'Egbeda', 'Ido', 'Lagelu', 'Oluyole', 'Ona Ara'],
  Lagos: [
    'Agege', 'Ajeromi-Ifelodun', 'Alimosho', 'Amuwo-Odofin', 'Apapa', 'Badagry', 'Epe', 'Eti-Osa', 'Ibeju-Lekki', 'Ifako-Ijaiye', 'Ikeja', 'Ikorodu',
    'Kosofe', 'Lagos Island', 'Lagos Mainland', 'Mushin', 'Ojo', 'Oshodi-Isolo', 'Shomolu', 'Surulere',
  ],
};

export const HOSPITAL_SERVICES = [
  'Emergency unit, 24 hours', 'Intensive care (ICU)', 'Maternity and delivery', "Children's care", 'Surgery', 'Dialysis', 'X-ray', 'CT scan',
  'Laboratory', 'Blood bank', 'Oxygen', 'Ventilator', 'Ambulance',
];

export const PHARMACY_OFFERS = [
  'Fill prescriptions', 'Cold storage (insulin, vaccines)', 'Blood pressure and sugar checks', 'Accept NHIA or HMO patients',
  'Take reservations through MedAssist-9ja', 'Accept online payment',
];

export const BED_TYPES = ['Emergency', 'ICU', 'General ward', 'Maternity', 'Paediatric'] as const;

export const SPECIALTIES = [
  'Cardiology', 'Paediatrics', 'Obstetrics & Gynaecology', 'General Surgery', 'Orthopaedics', 'Neurology', 'Nephrology', 'Endocrinology',
  'Pulmonology', 'Emergency Medicine', 'Internal Medicine', 'Psychiatry', 'Ophthalmology', 'ENT', 'Dermatology', 'Oncology', 'Urology', 'Haematology',
];
