import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import { useAreas } from '../components/AreaSelect';
import { ErrorBox, Field, Spinner, StatusBadge } from '../components/common';
import { CheckIcon, PinIcon, UserIcon, XIcon } from '../components/Icons';
import { Page } from '../components/Layout';
import { type Doc, UploadField } from '../components/Uploads';
import { api, ApiError, errorText, getToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { WARD_LABEL } from '../lib/format';
import { BED_TYPES, HOSPITAL_SERVICES, LGAS, PHARMACY_OFFERS, SPECIALTIES } from '../lib/places';
import { CodeBoxes } from './Login';

type Kind = 'pharmacy' | 'hospital' | 'specialist';
type Hours = Record<string, [string, string] | null>;

const DAY_GROUPS = [
  { label: 'Mon – Fri', keys: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  { label: 'Saturday', keys: ['sat'] },
  { label: 'Sunday', keys: ['sun'] },
];
const WEEK = [['Monday', 1], ['Tuesday', 2], ['Wednesday', 3], ['Thursday', 4], ['Friday', 5], ['Saturday', 6], ['Sunday', 0]] as const;
const LANGS = ['English', 'Yoruba', 'Hausa', 'Igbo', 'Pidgin'];

interface FacilityForm {
  name: string;
  phone: string;
  email: string;
  cacNumber: string;
  kind: string;
  ownership: string;
  emergencyPhone: string;
  address: string;
  city: string;
  area: string;
  lga: string;
  landmark: string;
  lat: number | null;
  lng: number | null;
  pinAdjusted: boolean;
  licenceNo: string;
  licenceExpiry: string;
  leadName: string;
  leadRegNo: string;
  hours: Hours;
  open24h: boolean;
  outpatient: [string, string];
  offers: string[];
  wards: { subType: string; total: number }[];
  staff: { name: string; role: string; phone: string }[];
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

interface SpecialistForm {
  title: string;
  languages: string[];
  specialty: string;
  yearsExperience: string;
  licenceNo: string;
  hospitals: { facilityId: string; name: string; area: string | null; position: string; status?: string }[];
  schedule: Record<number, { facilityId: string; start: string; end: string; onCall: boolean }>;
}

const blankFacility = (kind: Kind): FacilityForm => ({
  name: '', phone: '', email: '', cacNumber: '', kind: kind === 'hospital' ? 'General hospital' : 'Community pharmacy', ownership: 'Private',
  emergencyPhone: '', address: '', city: 'Ibadan', area: '', lga: '', landmark: '', lat: null, lng: null, pinAdjusted: false,
  licenceNo: '', licenceExpiry: '', leadName: '', leadRegNo: '',
  hours: { mon: ['08:00', '21:00'], tue: ['08:00', '21:00'], wed: ['08:00', '21:00'], thu: ['08:00', '21:00'], fri: ['08:00', '21:00'], sat: ['08:00', '21:00'], sun: ['12:00', '18:00'] },
  open24h: kind === 'hospital', outpatient: ['08:00', '16:00'],
  offers: kind === 'pharmacy' ? ['Fill prescriptions', 'Take reservations through MedAssist-9ja', 'Accept online payment'] : ['Emergency unit, 24 hours', 'Laboratory'],
  wards: kind === 'hospital' ? [{ subType: 'Emergency', total: 6 }, { subType: 'General ward', total: 20 }] : [],
  staff: [{ name: '', role: kind === 'hospital' ? 'Records officer' : 'Owner', phone: '' }],
  bankCode: '', bankName: '', accountNumber: '', accountName: '',
});

const blankSpecialist = (): SpecialistForm => ({ title: 'Dr.', languages: ['English'], specialty: '', yearsExperience: '', licenceNo: '', hospitals: [], schedule: {} });

function Pin({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

const Section = ({ n, title, children, intro }: { n: number; title: string; intro?: string; children: React.ReactNode }) => (
  <section className="card stack" style={{ padding: '1.4rem' }}>
    <h2 style={{ margin: 0 }}>{n}. {title}</h2>
    {intro && <p className="muted" style={{ margin: 0 }}>{intro}</p>}
    <div>{children}</div>
  </section>
);

/** Registration for pharmacies, hospitals and specialist doctors (design pages 14–19). */
export function Register() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { me, signIn, refresh } = useAuth();
  const signedInKind = me && ['pharmacy', 'hospital', 'specialist'].includes(me.user.role) ? (me.user.role as Kind) : null;
  const kind: Kind = signedInKind ?? ((['pharmacy', 'hospital', 'specialist'] as const).find((k) => k === params.get('type')) ?? 'pharmacy');
  const areaGroups = useAreas();

  const [f, setF] = useState<FacilityForm>(blankFacility(kind));
  const [s, setS] = useState<SpecialistForm>(blankSpecialist());
  const [account, setAccount] = useState({ name: '', phone: '', role: 'Owner' });
  const [docs, setDocs] = useState<Record<string, Doc | null>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(!!signedInKind);
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([]);
  const [hospitals, setHospitals] = useState<{ id: string; name: string; address: string }[]>([]);
  const [hospitalQuery, setHospitalQuery] = useState('');
  const [showMap, setShowMap] = useState(false);
  const [codeStep, setCodeStep] = useState<{ draft: boolean; devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    api('/payouts/banks').then(setBanks).catch(() => {});
    api('/facilities/hospitals').then(setHospitals).catch(() => {});
  }, []);

  // Resume a saved registration (or edit a live profile).
  useEffect(() => {
    if (!signedInKind) return;
    api('/register/mine')
      .then((r) => {
        if (!r) return;
        setAccount((a) => ({ ...a, name: r.user.name ?? '', phone: r.user.phone?.replace('+234', '0') ?? '' }));
        const docMap: Record<string, Doc> = {};
        for (const d of r.documents ?? []) docMap[d.kind] = d;
        setDocs(docMap);
        if (r.kind === 'specialist' && r.specialist) {
          const sp = r.specialist;
          setStatus(sp.verification_status);
          setNote(sp.verification_note);
          const sched: SpecialistForm['schedule'] = {};
          for (const x of r.schedule) sched[x.day] = { facilityId: x.facility_id, start: x.start ?? '08:00', end: x.end ?? '16:00', onCall: x.on_call };
          setS({
            title: sp.title, languages: sp.languages, specialty: sp.specialty, yearsExperience: sp.years_experience?.toString() ?? '', licenceNo: sp.licence_no,
            hospitals: r.hospitals.map((h: any) => ({ facilityId: h.facility_id, name: h.name, area: h.area, position: h.position, status: h.status })),
            schedule: sched,
          });
        } else if (r.facility) {
          const x = r.facility;
          setStatus(x.verification_status);
          setNote(x.verification_note);
          const city = (x.address as string).endsWith('Lagos') ? 'Lagos' : 'Ibadan';
          setF({
            ...blankFacility(kind),
            name: x.name, phone: x.phone?.replace('+234', '0') ?? '', email: x.email ?? '', cacNumber: x.cac_number ?? '', kind: x.kind ?? blankFacility(kind).kind,
            ownership: x.ownership ?? 'Private', emergencyPhone: x.emergency_phone?.replace('+234', '0') ?? '',
            address: (x.address as string).split(',')[0], city, area: x.area ?? '', lga: x.lga ?? '', landmark: x.landmark ?? '',
            lat: x.lat || null, lng: x.lng || null, pinAdjusted: true, licenceNo: x.licence_no, licenceExpiry: x.licence_expiry ?? '',
            leadName: x.lead_name ?? '', leadRegNo: x.lead_reg_no ?? '', hours: x.opening_hours ?? {}, open24h: x.open_24h,
            outpatient: x.outpatient_hours ?? ['08:00', '16:00'], offers: x.offers ?? [],
            wards: r.wards.map((w: any) => ({ subType: w.sub_type, total: w.capacity })),
            staff: [{ name: r.user.name ?? '', role: 'Owner', phone: r.user.phone?.replace('+234', '0') ?? '' }, ...r.staff.map((m: any) => ({ name: m.name, role: m.role, phone: m.phone.replace('+234', '0') }))],
            bankCode: x.payout_bank_code ?? '', bankName: x.payout_bank_name ?? '', accountNumber: x.payout_account_number ?? '', accountName: x.payout_account_name ?? '',
          });
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedInKind]);

  // Resolve the bank account name as soon as a full number is entered.
  useEffect(() => {
    if (!f.bankCode || !/^\d{10}$/.test(f.accountNumber)) return setF((x) => (x.accountName ? { ...x, accountName: '' } : x));
    const t = setTimeout(() => {
      api<{ accountName: string }>('/payouts/resolve', { body: { bankCode: f.bankCode, accountNumber: f.accountNumber, hint: f.name } })
        .then((r) => setF((x) => ({ ...x, accountName: r.accountName })))
        .catch(() => setF((x) => ({ ...x, accountName: '' })));
    }, 350);
    return () => clearTimeout(t);
  }, [f.bankCode, f.accountNumber, f.name]);

  const cityAreas = areaGroups.find((g) => g.city === f.city)?.areas ?? [];
  const setArea = (label: string) => {
    const a = cityAreas.find((x) => x.label === label);
    setF((x) => ({ ...x, area: label, ...(a && !x.pinAdjusted ? { lat: a.lat, lng: a.lng } : {}) }));
  };
  const setHours = (keys: string[], v: [string, string] | null) => setF((x) => ({ ...x, hours: { ...x.hours, ...Object.fromEntries(keys.map((k) => [k, v])) } }));
  const pickDoc = (k: string) => (file: File) => setDocs((d) => ({ ...d, [k]: { kind: k, filename: file.name, size: file.size, file } }));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  // The person applying: specialists and pharmacies use "Your account"; hospitals use the first staff row.
  const applicant = kind === 'hospital' ? f.staff[0] : account;

  const payload = (draft: boolean, otp?: string) => {
    const acct = { name: applicant.name, phone: applicant.phone, role: applicant.role, code: otp };
    if (kind === 'specialist') {
      return {
        draft, confirm, account: acct, title: s.title, languages: s.languages, specialty: s.specialty || null,
        yearsExperience: s.yearsExperience ? Number(s.yearsExperience) : null, licenceNo: s.licenceNo || null,
        hospitals: s.hospitals.map((h) => ({ facilityId: h.facilityId, position: h.position })),
        schedule: Object.entries(s.schedule).filter(([, v]) => v.facilityId).map(([day, v]) => ({ day: Number(day), facilityId: v.facilityId, start: v.onCall ? null : v.start, end: v.onCall ? null : v.end, onCall: v.onCall })),
      };
    }
    return {
      draft, confirm, account: acct, name: f.name, phone: f.phone || null, email: f.email || null, cacNumber: f.cacNumber || null,
      kind: f.kind, ownership: kind === 'hospital' ? f.ownership : null, emergencyPhone: kind === 'hospital' ? f.emergencyPhone || null : null,
      address: f.address || null, area: f.area || null, lga: f.lga || null, landmark: f.landmark || null, lat: f.lat, lng: f.lng,
      licenceNo: f.licenceNo || null, licenceExpiry: f.licenceExpiry || null, leadName: f.leadName || null, leadRegNo: f.leadRegNo || null,
      openingHours: f.open24h && kind === 'pharmacy' ? {} : f.hours, open24h: f.open24h, outpatientHours: kind === 'hospital' ? f.outpatient : null,
      offers: f.offers, wards: f.wards, staff: kind === 'hospital' ? f.staff.slice(1).filter((m) => m.name && m.phone) : [],
      payout: f.bankCode && f.accountNumber ? { bankCode: f.bankCode, bankName: f.bankName, accountNumber: f.accountNumber } : null,
    };
  };

  const uploadDocs = async () => {
    for (const d of Object.values(docs)) {
      if (!d?.file) continue;
      const form = new FormData();
      form.append('kind', d.kind);
      form.append('file', d.file);
      await api('/documents', { form, method: 'POST' });
    }
  };

  const send = async (draft: boolean, otp?: string) => {
    setBusy(true);
    setError(null);
    try {
      if (!getToken() && !otp) {
        const r = await api<{ devCode?: string; isNewUser: boolean }>('/auth/otp/request', { body: { phone: applicant.phone } });
        if (!r.isNewUser) throw new Error('An account already uses this phone number. Sign in to continue your registration.');
        setCodeStep({ draft, devCode: r.devCode });
        setCode('');
        return;
      }
      const r = await api<{ token?: string; status: string }>(`/register/${kind}`, { body: payload(draft, otp) });
      if (r.token) await signIn(r.token);
      await uploadDocs();
      await refresh();
      setStatus(r.status);
      setCodeStep(null);
      setDone(draft ? 'Saved. You can come back and finish later — sign in with your phone number.' : r.status === 'approved' ? 'Changes saved.' : 'Sent for review. We will SMS you when your listing is live.');
      if (!draft && r.status !== 'approved') setTimeout(() => navigate('/dashboard'), 1500);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? errorText(e) : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const hospitalMatches = useMemo(
    () => (hospitalQuery.trim().length < 2 ? [] : hospitals.filter((h) => h.name.toLowerCase().includes(hospitalQuery.toLowerCase()) && !s.hospitals.some((x) => x.facilityId === h.id)).slice(0, 6)),
    [hospitalQuery, hospitals, s.hospitals],
  );

  if (loading) return <Page><Spinner /></Page>;
  const live = status === 'approved';
  const titles: Record<Kind, [string, string, string]> = {
    pharmacy: ['For pharmacies', 'Register your pharmacy', 'It takes about 10 minutes. We check your PCN licence before your pharmacy appears in search. You can save and finish later.'],
    hospital: ['For hospitals and clinics', 'Register your hospital', 'Tell patients what you offer and how many beds you have. We check your registration before you appear in search, including emergency search.'],
    specialist: ['For specialist doctors', 'Register as a specialist', 'Let patients see when and where you are on duty. We check your MDCN registration, and each hospital you list confirms that you work there.'],
  };

  return (
    <Page narrow>
      <div className="stack-lg">
        <div className="spread">
          <div>
            <div className="eyebrow">{titles[kind][0]}</div>
            <h1>{live ? (kind === 'specialist' ? 'Your profile' : `${kind === 'pharmacy' ? 'Pharmacy' : 'Hospital'} profile`) : titles[kind][1]}</h1>
            <p className="lede" style={{ margin: 0 }}>{live ? 'Changes show to patients as soon as you save. Changing your licence number sends you back for verification.' : titles[kind][2]}</p>
          </div>
          {!me && <span className="small muted">Already registered? <Link to="/login?as=provider">Sign in</Link></span>}
        </div>
        {status && <div className="row"><StatusBadge status={status} />{note && <span className="small">{note}</span>}</div>}

        {!signedInKind && (
          <div className="segmented" role="tablist">
            {(['pharmacy', 'hospital', 'specialist'] as const).map((k) => (
              <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => { setParams({ type: k }); setF(blankFacility(k)); }}>
                {k === 'pharmacy' ? 'Pharmacy' : k === 'hospital' ? 'Hospital or clinic' : 'Specialist doctor'}
              </button>
            ))}
          </div>
        )}

        {kind !== 'specialist' ? (
          <>
            <Section n={1} title={kind === 'pharmacy' ? 'Pharmacy details' : 'Hospital details'}>
              <Field label={kind === 'pharmacy' ? 'Pharmacy name' : 'Hospital or clinic name'}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <div className="form-grid">
                {kind === 'hospital' && (
                  <>
                    <Field label="Type of facility">
                      <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                        {['General hospital', 'Specialist hospital', 'Teaching hospital', 'Clinic', 'Maternity home', 'Primary health centre'].map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Ownership">
                      <select value={f.ownership} onChange={(e) => setF({ ...f, ownership: e.target.value })}>
                        {['Private', 'Government', 'Mission or NGO'].map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                  </>
                )}
                <Field label={kind === 'pharmacy' ? 'Phone for customers' : 'Main phone'} hint={kind === 'pharmacy' ? 'Shown on your listing. Someone should answer it during opening hours.' : undefined}>
                  <input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
                </Field>
                {kind === 'hospital' ? (
                  <Field label="Emergency line (answered 24 hours)" hint="Shown on the Emergency screen. We test-call it before approval.">
                    <input type="tel" value={f.emergencyPhone} onChange={(e) => setF({ ...f, emergencyPhone: e.target.value })} style={{ borderColor: 'var(--danger)' }} />
                  </Field>
                ) : (
                  <>
                    <Field label="Email" optional><input type="email" placeholder="name@example.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
                    <Field label="CAC business number" optional><input placeholder="e.g. BN 1234567" value={f.cacNumber} onChange={(e) => setF({ ...f, cacNumber: e.target.value })} /></Field>
                  </>
                )}
              </div>
            </Section>

            <Section n={2} title="Location">
              <Field label="Street address"><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
              <div className="form-grid">
                <Field label="City">
                  <select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value, area: '', lga: '', pinAdjusted: false })}>
                    <option>Ibadan</option><option>Lagos</option>
                  </select>
                </Field>
                <Field label="Area">
                  <select value={f.area} onChange={(e) => setArea(e.target.value)}>
                    <option value="">Choose…</option>
                    {cityAreas.map((a) => <option key={a.label}>{a.label}</option>)}
                  </select>
                </Field>
                <Field label="Local government area">
                  <select value={f.lga} onChange={(e) => setF({ ...f, lga: e.target.value })}>
                    <option value="">Choose…</option>
                    {LGAS[f.city].map((l) => <option key={l}>{l}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Nearest landmark" hint="Helps people find you when street names are unclear.">
                <input placeholder="e.g. Opposite UI main gate, beside the bus stop" value={f.landmark} onChange={(e) => setF({ ...f, landmark: e.target.value })} />
              </Field>
              <div className={`card tight spread ${f.lat !== null ? 'tint' : 'warn'}`} style={{ borderColor: f.lat !== null ? 'transparent' : undefined }}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <PinIcon />
                  <div>
                    <strong>{f.lat !== null ? 'Map pin set' : 'Map pin not set yet'}</strong>
                    <div className="small">
                      {f.lat !== null
                        ? <>{f.pinAdjusted ? 'Placed by you.' : 'Placed from your area.'} Check it so distances are correct. <span className="mono">{f.lat.toFixed(4)}, {f.lng!.toFixed(4)}</span></>
                        : kind === 'hospital' ? 'Put the pin on your emergency entrance, so ambulances and patients reach the right gate.' : 'Choose your area or set the pin on the map.'}
                    </div>
                  </div>
                </div>
                <button type="button" className={`btn ${f.lat !== null ? 'outline' : 'primary'}`} onClick={() => setShowMap((m) => !m)}>{showMap ? 'Done' : f.lat !== null ? 'Adjust pin on map' : 'Set pin on map'}</button>
              </div>
              {showMap && (
                <div className="map small mt">
                  <MapContainer center={f.lat !== null ? { lat: f.lat, lng: f.lng! } : f.city === 'Lagos' ? { lat: 6.5244, lng: 3.3792 } : { lat: 7.3775, lng: 3.947 }} zoom={f.lat !== null ? 16 : 12} style={{ height: '100%' }}>
                    <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <Pin onPick={(lat, lng) => setF((x) => ({ ...x, lat, lng, pinAdjusted: true }))} />
                    {f.lat !== null && <CircleMarker center={{ lat: f.lat, lng: f.lng! }} radius={10} pathOptions={{ color: '#0f7b63', fillOpacity: 0.9 }} />}
                  </MapContainer>
                </div>
              )}
            </Section>

            <Section n={3} title={kind === 'pharmacy' ? 'Licence and pharmacist' : 'Registration'}>
              <div className="form-grid">
                <Field label={kind === 'pharmacy' ? 'PCN premises licence number' : 'State Ministry of Health registration number'} hint={kind === 'hospital' ? 'Government hospitals can leave this blank.' : undefined}>
                  <input className="mono" placeholder="[LICENCE NO.]" value={f.licenceNo} onChange={(e) => setF({ ...f, licenceNo: e.target.value })} />
                </Field>
                {kind === 'pharmacy' && (
                  <Field label="Licence expiry date"><input type="date" value={f.licenceExpiry} onChange={(e) => setF({ ...f, licenceExpiry: e.target.value })} /></Field>
                )}
                <Field label={kind === 'pharmacy' ? 'Superintendent pharmacist' : 'Medical director'}>
                  <input placeholder="Full name" value={f.leadName} onChange={(e) => setF({ ...f, leadName: e.target.value })} />
                </Field>
                <Field label={kind === 'pharmacy' ? "Pharmacist's PCN registration number" : "Medical director's MDCN number"}>
                  <input className="mono" placeholder={kind === 'pharmacy' ? '[REG NO.]' : '[MDCN NO.]'} value={f.leadRegNo} onChange={(e) => setF({ ...f, leadRegNo: e.target.value })} />
                </Field>
              </div>
              <div className="grid2">
                {kind === 'pharmacy' ? (
                  <>
                    <UploadField label="Copy of PCN licence" value={docs.licence ?? null} onPick={pickDoc('licence')} hint="PDF or photo, up to 5 MB" />
                    <UploadField label="Photo of your shop front" value={docs.shop_photo ?? null} onPick={pickDoc('shop_photo')} accept=".jpg,.jpeg,.png" hint="JPG or PNG, up to 5 MB. Show the signboard clearly." />
                  </>
                ) : (
                  <UploadField label="Registration certificate" value={docs.registration_certificate ?? null} onPick={pickDoc('registration_certificate')} compact />
                )}
              </div>
            </Section>

            {kind === 'hospital' && (
              <>
                <Section n={4} title="Services you offer" intro="Patients search by these. You can mark any of them unavailable later from your dashboard.">
                  <div className="checks">
                    {HOSPITAL_SERVICES.map((o) => (
                      <label key={o} className="check"><input type="checkbox" checked={f.offers.includes(o)} onChange={() => setF({ ...f, offers: toggle(f.offers, o) })} />{o}</label>
                    ))}
                  </div>
                </Section>
                <Section n={5} title="Wards and beds" intro="Enter the total beds in each ward. You'll update how many are free from your dashboard.">
                  <div className="stack">
                    <div className="row small muted" style={{ fontWeight: 600 }}><span style={{ flex: 1 }}>Ward</span><span style={{ width: 120 }}>Total beds</span><span style={{ width: 44 }} /></div>
                    {f.wards.map((w, i) => (
                      <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
                        <select style={{ flex: 1 }} value={w.subType} onChange={(e) => setF({ ...f, wards: f.wards.map((x, j) => (j === i ? { ...x, subType: e.target.value } : x)) })}>
                          {BED_TYPES.filter((b) => b === w.subType || !f.wards.some((x) => x.subType === b)).map((b) => <option key={b} value={b}>{WARD_LABEL[b]}</option>)}
                        </select>
                        <input style={{ width: 120 }} className="mono" type="number" min={0} value={w.total} onChange={(e) => setF({ ...f, wards: f.wards.map((x, j) => (j === i ? { ...x, total: Math.max(0, Number(e.target.value)) } : x)) })} aria-label="Total beds" />
                        <button type="button" className="btn small" style={{ width: 44 }} onClick={() => setF({ ...f, wards: f.wards.filter((_, j) => j !== i) })} aria-label="Remove ward"><XIcon width={16} /></button>
                      </div>
                    ))}
                    {f.wards.length < BED_TYPES.length && (
                      <button type="button" className="btn outline" style={{ alignSelf: 'start' }} onClick={() => setF({ ...f, wards: [...f.wards, { subType: BED_TYPES.find((b) => !f.wards.some((x) => x.subType === b))!, total: 0 }] })}>+ Add a ward</button>
                    )}
                  </div>
                </Section>
                <Section n={6} title="Opening hours">
                  <label className="check"><input type="checkbox" checked={f.open24h} onChange={(e) => setF({ ...f, open24h: e.target.checked })} /><strong>Emergency unit is open 24 hours, every day</strong></label>
                  <div className="row mt">
                    <span style={{ minWidth: 150, fontWeight: 600 }}>Outpatient clinics</span>
                    <input type="time" style={{ width: 150 }} value={f.outpatient[0]} onChange={(e) => setF({ ...f, outpatient: [e.target.value, f.outpatient[1]] })} aria-label="Clinics open" />
                    <input type="time" style={{ width: 150 }} value={f.outpatient[1]} onChange={(e) => setF({ ...f, outpatient: [f.outpatient[0], e.target.value] })} aria-label="Clinics close" />
                  </div>
                  {!f.open24h && <HoursEditor f={f} setHours={setHours} />}
                </Section>
                <Section n={7} title="Staff who will update your listing" intro="Add the people who will update beds and services. Each signs in with a code sent to their phone. The first person is you.">
                  <div className="stack">
                    {f.staff.map((m, i) => (
                      <div key={i} className="form-grid" style={{ alignItems: 'end' }}>
                        <Field label={i === 0 ? 'Your name' : 'Name'}><input value={m.name} onChange={(e) => setF({ ...f, staff: f.staff.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></Field>
                        <Field label="Role">
                          <select value={m.role} onChange={(e) => setF({ ...f, staff: f.staff.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })}>
                            {['Records officer', 'Medical director', 'Nurse in charge', 'Administrator', 'Owner'].map((r) => <option key={r}>{r}</option>)}
                          </select>
                        </Field>
                        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'end' }}>
                          <div style={{ flex: 1 }}><Field label={i === 0 ? 'Your phone (for sign-in)' : 'Phone'}><input type="tel" value={m.phone} onChange={(e) => setF({ ...f, staff: f.staff.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)) })} /></Field></div>
                          {i > 0 && <button type="button" className="btn small" style={{ marginBottom: '1rem' }} onClick={() => setF({ ...f, staff: f.staff.filter((_, j) => j !== i) })} aria-label="Remove person"><XIcon width={16} /></button>}
                        </div>
                      </div>
                    ))}
                    <button type="button" className="btn outline" style={{ alignSelf: 'start' }} onClick={() => setF({ ...f, staff: [...f.staff, { name: '', role: 'Records officer', phone: '' }] })}>+ Add another person</button>
                  </div>
                </Section>
                <PayoutSection n={8} f={f} setF={setF} banks={banks} optional />
              </>
            )}

            {kind === 'pharmacy' && (
              <>
                <Section n={4} title="Opening hours">
                  <label className="check" style={{ justifyContent: 'flex-end' }}><input type="checkbox" checked={f.open24h} onChange={(e) => setF({ ...f, open24h: e.target.checked })} />Open 24 hours</label>
                  {!f.open24h && <HoursEditor f={f} setHours={setHours} />}
                </Section>
                <Section n={5} title="What you offer">
                  <div className="checks">
                    {PHARMACY_OFFERS.map((o) => (
                      <label key={o} className="check"><input type="checkbox" checked={f.offers.includes(o)} onChange={() => setF({ ...f, offers: toggle(f.offers, o) })} />{o}</label>
                    ))}
                  </div>
                </Section>
                <PayoutSection n={6} f={f} setF={setF} banks={banks} />
                <Section n={7} title="Your account" intro="The person who will manage this pharmacy on MedAssist-9ja. You sign in with a code sent to this phone.">
                  <div className="form-grid">
                    <Field label="Your name"><input value={account.name} onChange={(e) => setAccount({ ...account, name: e.target.value })} autoComplete="name" /></Field>
                    <Field label="Your role">
                      <select value={account.role} onChange={(e) => setAccount({ ...account, role: e.target.value })}>
                        {['Owner', 'Superintendent pharmacist', 'Manager'].map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </Field>
                    <Field label="Your phone number"><input type="tel" value={account.phone} onChange={(e) => setAccount({ ...account, phone: e.target.value })} autoComplete="tel" /></Field>
                  </div>
                </Section>
              </>
            )}
          </>
        ) : (
          <>
            <Section n={1} title="About you">
              <div className="row" style={{ alignItems: 'flex-start', gap: '1.25rem' }}>
                <div className="stack center" style={{ width: 120 }}>
                  <div style={{ width: 96, height: 96, borderRadius: '50%', background: 'var(--brand-soft)', display: 'grid', placeItems: 'center', color: 'var(--brand)', margin: '0 auto' }}>
                    {docs.photo ? <CheckIcon width={32} height={32} /> : <UserIcon width={40} height={40} />}
                  </div>
                  <label className="btn small" style={{ cursor: 'pointer' }}>
                    {docs.photo ? 'Change photo' : 'Add photo'}
                    <input type="file" accept=".jpg,.jpeg,.png" hidden onChange={(e) => e.target.files?.[0] && pickDoc('photo')(e.target.files[0])} />
                  </label>
                </div>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div className="form-grid">
                    <Field label="Title">
                      <select value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })}>{['Dr.', 'Prof.', 'Mr.', 'Mrs.', 'Ms.'].map((t) => <option key={t}>{t}</option>)}</select>
                    </Field>
                    <Field label="Full name"><input value={account.name} onChange={(e) => setAccount({ ...account, name: e.target.value })} /></Field>
                    <Field label="Phone (for sign-in)" hint="Not shown to patients."><input type="tel" value={account.phone} onChange={(e) => setAccount({ ...account, phone: e.target.value })} /></Field>
                  </div>
                  <div className="label">Languages you consult in</div>
                  <div className="chips">
                    {LANGS.map((l) => (
                      <label key={l} className="check" style={{ marginRight: '0.75rem' }}><input type="checkbox" checked={s.languages.includes(l)} onChange={() => setS({ ...s, languages: toggle(s.languages, l) })} />{l}</label>
                    ))}
                  </div>
                </div>
              </div>
            </Section>
            <Section n={2} title="Qualifications">
              <div className="form-grid">
                <Field label="Specialty">
                  <select value={s.specialty} onChange={(e) => setS({ ...s, specialty: e.target.value })}>
                    <option value="">Choose…</option>
                    {SPECIALTIES.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </Field>
                <Field label="Years in this specialty"><input type="number" min={0} value={s.yearsExperience} onChange={(e) => setS({ ...s, yearsExperience: e.target.value })} /></Field>
                <Field label="MDCN registration number"><input className="mono" placeholder="[MDCN NO.]" value={s.licenceNo} onChange={(e) => setS({ ...s, licenceNo: e.target.value })} /></Field>
              </div>
              <div style={{ maxWidth: 360 }}>
                <UploadField label="Current practising licence" value={docs.practising_licence ?? null} onPick={pickDoc('practising_licence')} compact />
              </div>
            </Section>
            <Section n={3} title="Where you work" intro="Choose hospitals already on MedAssist-9ja. Each one confirms you before your schedule shows there.">
              <div className="suggest-wrap">
                <input className="filled" placeholder="Search hospital name, e.g. Ring Road" value={hospitalQuery} onChange={(e) => setHospitalQuery(e.target.value)} />
                {hospitalMatches.length > 0 && (
                  <div className="suggestions">
                    {hospitalMatches.map((h) => (
                      <button type="button" key={h.id} onMouseDown={() => { setS({ ...s, hospitals: [...s.hospitals, { facilityId: h.id, name: h.name, area: h.address.split(',').slice(-2, -1)[0]?.trim() ?? null, position: 'Consultant' }] }); setHospitalQuery(''); }}>
                        <span>{h.name}</span><span className="small muted">{h.address}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="stack mt">
                {s.hospitals.map((h, i) => (
                  <div key={h.facilityId} className="card tight spread">
                    <div>
                      <strong>{h.name}</strong>
                      <div className="row small muted">
                        {h.area && <span>{h.area} ·</span>}
                        <select style={{ width: 'auto', minHeight: 32, padding: '0 0.5rem' }} value={h.position} onChange={(e) => setS({ ...s, hospitals: s.hospitals.map((x, j) => (j === i ? { ...x, position: e.target.value } : x)) })} aria-label="Position">
                          <option>Consultant</option><option>Visiting consultant</option><option>Resident</option>
                        </select>
                      </div>
                    </div>
                    <div className="row">
                      <StatusBadge status={h.status === 'confirmed' ? 'confirmed' : 'pending'} label={h.status === 'confirmed' ? 'Confirmed' : 'Waiting for hospital'} />
                      <button type="button" className="btn small" onClick={() => setS({ ...s, hospitals: s.hospitals.filter((_, j) => j !== i) })} aria-label="Remove"><XIcon width={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="small muted mt">Hospital not listed yet? Ask it to <Link to="/register?type=hospital">register</Link>.</p>
            </Section>
            <Section n={4} title="Weekly schedule" intro="When you are usually at each hospital. “On call” means you can be called in for emergencies.">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Day</th><th>Hospital</th><th>From</th><th>To</th><th>On call</th></tr></thead>
                  <tbody>
                    {WEEK.map(([label, day]) => {
                      const row = s.schedule[day] ?? { facilityId: '', start: '08:00', end: '16:00', onCall: false };
                      const set = (patch: Partial<typeof row>) => setS({ ...s, schedule: { ...s.schedule, [day]: { ...row, ...patch } } });
                      return (
                        <tr key={day}>
                          <td><strong>{label}</strong></td>
                          <td style={{ minWidth: 190 }}>
                            <select value={row.facilityId} onChange={(e) => set({ facilityId: e.target.value })} aria-label={`${label} hospital`}>
                              <option value="">Not working</option>
                              {s.hospitals.map((h) => <option key={h.facilityId} value={h.facilityId}>{h.name.replace(/ (Hospital|Centre|Medical Centre)$/, '')}</option>)}
                            </select>
                          </td>
                          <td>{row.facilityId && !row.onCall ? <input type="time" value={row.start} onChange={(e) => set({ start: e.target.value })} aria-label={`${label} from`} style={{ width: 120 }} /> : '—'}</td>
                          <td>{row.facilityId && !row.onCall ? <input type="time" value={row.end} onChange={(e) => set({ end: e.target.value })} aria-label={`${label} to`} style={{ width: 120 }} /> : '—'}</td>
                          <td><input type="checkbox" disabled={!row.facilityId} checked={row.onCall} onChange={(e) => set({ onCall: e.target.checked })} aria-label={`${label} on call`} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="small muted mt">Going on leave? You can mark days off from your account so patients are not sent to you.</p>
            </Section>
          </>
        )}

        <label className="check">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span>
            {kind === 'pharmacy' && 'I confirm these details are correct and that my pharmacy will keep its stock and opening hours up to date. I agree to the terms for facilities.'}
            {kind === 'hospital' && 'I confirm these details are correct and that we will update our bed numbers at each shift change. I agree to the terms for facilities.'}
            {kind === 'specialist' && 'I confirm I hold a current licence to practise and will keep my schedule up to date. I agree to the terms for doctors.'}
          </span>
        </label>

        {codeStep && (
          <div className="card raised stack">
            <strong>Verify your phone</strong>
            <span className="small muted">We sent a 6-digit code to {applicant.phone}. It also becomes how you sign in.</span>
            {codeStep.devCode && <p className="devnote" style={{ margin: 0 }}>Development mode: your code is <strong className="mono">{codeStep.devCode}</strong>.</p>}
            <CodeBoxes value={code} onChange={setCode} autoFocus />
            <button className="btn primary" disabled={busy || code.length !== 6} onClick={() => send(codeStep.draft, code)}>Verify and {codeStep.draft ? 'save' : 'send for review'}</button>
          </div>
        )}
        <ErrorBox error={error} />
        {done && <div className="alert ok">{done}</div>}
        {!codeStep && (
          <div className="btn-row">
            <button className="btn primary big" disabled={busy || !confirm || !applicant.phone || !applicant.name} onClick={() => send(false)}>{live ? 'Save changes' : 'Send for review'}</button>
            {!live && <button className="btn big" disabled={busy || !applicant.phone || !applicant.name || (kind !== 'specialist' && !f.name)} onClick={() => send(true)}>Save and finish later</button>}
          </div>
        )}
        <p className="small muted">
          {kind === 'hospital' ? 'Doctors who work here can register separately as specialists and link themselves to your hospital.' : kind === 'pharmacy' ? 'After we approve you, you can add your stock from your dashboard. You’ll get an SMS when your pharmacy is live.' : 'You will get an SMS when your profile is verified.'}
        </p>
      </div>
    </Page>
  );
}

function HoursEditor({ f, setHours }: { f: FacilityForm; setHours: (keys: string[], v: [string, string] | null) => void }) {
  return (
    <div className="table-wrap mt">
      <table>
        <thead><tr><th>Day</th><th>Opens</th><th>Closes</th><th>Closed</th></tr></thead>
        <tbody>
          {DAY_GROUPS.map((g) => {
            const v = f.hours[g.keys[0]];
            return (
              <tr key={g.label}>
                <td><strong>{g.label}</strong></td>
                <td><input type="time" disabled={!v} value={v?.[0] ?? ''} onChange={(e) => setHours(g.keys, [e.target.value, v?.[1] ?? '18:00'])} aria-label={`${g.label} opens`} /></td>
                <td><input type="time" disabled={!v} value={v?.[1] ?? ''} onChange={(e) => setHours(g.keys, [v?.[0] ?? '08:00', e.target.value])} aria-label={`${g.label} closes`} /></td>
                <td><input type="checkbox" checked={!v} onChange={(e) => setHours(g.keys, e.target.checked ? null : ['08:00', '18:00'])} aria-label={`${g.label} closed`} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PayoutSection({ n, f, setF, banks, optional }: { n: number; f: FacilityForm; setF: (x: FacilityForm) => void; banks: { code: string; name: string }[]; optional?: boolean }) {
  return (
    <Section n={n} title="Where we send your payments" intro={`Money customers pay online is settled to this account by Paystack.${optional ? ' Needed only if you take bed deposits online.' : ''}`}>
      <div className="form-grid">
        <Field label="Bank">
          <select value={f.bankCode} onChange={(e) => setF({ ...f, bankCode: e.target.value, bankName: banks.find((b) => b.code === e.target.value)?.name ?? '' })}>
            <option value="">Choose your bank</option>
            {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Account number"><input className="mono" inputMode="numeric" maxLength={10} value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Account name" hint={f.accountName ? 'Filled in from your bank.' : 'Appears when the bank confirms the number.'}>
          <div className={`card tight row ${f.accountName ? 'tint' : 'soft'}`} style={{ minHeight: 48, borderColor: 'transparent' }}>
            {f.accountName ? <><CheckIcon width={16} /> <strong className="ok-text">{f.accountName}</strong></> : <span className="muted small">—</span>}
          </div>
        </Field>
      </div>
    </Section>
  );
}
