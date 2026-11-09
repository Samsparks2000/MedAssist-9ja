import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, Phone, SampleNote, Spinner, StatusBadge } from '../components/common';
import { MapIcon, ShieldIcon } from '../components/Icons';
import { Page } from '../components/Layout';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { directionsUrl, drugName, minutesSince, monthYear, naira, telUrl, time, updatedLabel, WARD_LABEL } from '../lib/format';
import { haversineKm } from '../lib/geo';
import { useUserLocation } from '../lib/location';
import { useSocketEvent } from '../lib/socket';

interface Drug {
  drug_id: string;
  brand_name: string;
  generic_name: string;
  strength: string;
  form: string;
  category: string | null;
  available: number;
  price: number | null;
  last_price: number;
  reorder_level: number;
  batch_no: string | null;
  expiry_date: string | null;
  needs_prescription: boolean;
  refrigerated: boolean;
  allow_reservations: boolean;
}

interface FacilityDetail {
  id: string;
  name: string;
  type: 'pharmacy' | 'hospital';
  address: string;
  area: string | null;
  landmark: string | null;
  phone: string;
  emergencyPhone: string | null;
  lat: number;
  lng: number;
  verified: boolean;
  openNow: boolean;
  open24h: boolean;
  hours: string;
  openingHours: Record<string, [string, string] | null>;
  today: number;
  lastUpdated: string;
  trust: { licenceNo: string; leadName: string | null; licenceType: string };
  drugs: Drug[];
  services: { service: string; status: string }[];
  resources: { id: string; type: string; sub_type: string; capacity: number; available: number; status: string | null; price: number | null }[];
  specialists: { id: string; name: string; specialty: string; available_now: boolean; on_call: boolean }[];
  rating: { avg: number | null; count: number };
}

const CATEGORY_GROUPS: Record<string, string[]> = {
  Diabetes: ['Insulin', 'Antidiabetic', 'Diabetes supplies'],
  Malaria: ['Antimalarial'],
  Antibiotics: ['Antibiotic'],
  'Blood pressure': ['Antihypertensive'],
  Asthma: ['Respiratory'],
  'Pain & fever': ['Analgesic'],
};
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const fmt12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
};

/** Groups days with the same hours: "Mon – Sat 8 am – 9 pm". */
function hoursRows(h: FacilityDetail['openingHours'], today: number) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const rows: { days: number[]; text: string }[] = [];
  for (const d of order) {
    const v = h[DAYS[d]];
    const text = v ? `${fmt12(v[0])} – ${fmt12(v[1])}` : 'Closed';
    const last = rows.at(-1);
    if (last && last.text === text && d !== today && !last.days.includes(today)) last.days.push(d);
    else rows.push({ days: [d], text });
  }
  return rows.map((r) => ({
    label: r.days.length > 1 ? `${DAY_NAMES[r.days[0]].slice(0, 3)} – ${DAY_NAMES[r.days.at(-1)!].slice(0, 3)}` : DAY_NAMES[r.days[0]] + (r.days[0] === today ? ' (today)' : ''),
    text: r.text,
    today: r.days.includes(today),
  }));
}

function stockText(d: Drug) {
  if (d.available <= 0) return { text: 'Out of stock', cls: 'danger-text' };
  if (d.available <= Math.max(3, d.reorder_level)) return { text: 'Few left', cls: 'warn-text' };
  return { text: 'In stock', cls: 'ok-text' };
}

export function Facility() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const { location } = useUserLocation();
  const [f, setF] = useState<FacilityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [filter, setFilter] = useState('All');
  const [text, setText] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => api<FacilityDetail>(`/facilities/${id}`).then(setF).catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useSocketEvent<{ facilityId: string }>('availability', (e) => e.facilityId === id && load(), [id]);

  const searched = useMemo(() => {
    const wanted = params.get('drug') ?? params.get('reserve');
    return f?.drugs.find((d) => d.drug_id === wanted && d.available > 0) ?? null;
  }, [f, params]);

  if (error) return <Page><ErrorBox error={error} /></Page>;
  if (!f) return <Page><Spinner /></Page>;

  const km = location ? Math.round(haversineKm(location, f) * 10) / 10 : null;
  const updatedMin = minutesSince(f.lastUpdated);
  const groupNames = Object.keys(CATEGORY_GROUPS).filter((g) => f.drugs.some((d) => CATEGORY_GROUPS[g].includes(d.category ?? '')));
  const shownDrugs = f.drugs
    .filter((d) => filter === 'All' || CATEGORY_GROUPS[filter]?.includes(d.category ?? ''))
    .filter((d) => !text || `${d.brand_name} ${d.generic_name}`.toLowerCase().includes(text.toLowerCase()));
  const visible = showAll ? shownDrugs : shownDrugs.slice(0, 8);
  const reserveUrl = (drugId: string, quantity = 1, mode?: string) => `/reserve?facility=${f.id}&drug=${drugId}&qty=${quantity}${mode ? `&mode=${mode}` : ''}`;
  const isPatientOrGuest = !me || me.user.role === 'patient';

  const watch = async (drugId: string) => {
    if (!me) return navigate(`/login?next=${encodeURIComponent(`/facility/${f.id}`)}`);
    try {
      await api('/me/watches', { body: { facilityId: f.id, drugId } });
      setNotice('We will send you an SMS when it is back in stock.');
    } catch (e) {
      setNotice(errorText(e));
    }
  };

  const beds = f.resources.filter((r) => r.type === 'bed');
  const blood = f.resources.filter((r) => r.type === 'blood');
  const equipment = f.resources.filter((r) => r.type === 'equipment' || r.type === 'oxygen');

  return (
    <Page>
      <div className="stack-lg">
        <Link to={-1 as never} onClick={(e) => { e.preventDefault(); navigate(-1); }} className="small">‹ Back to results</Link>

        <div className="card">
          <div className="layout-side" style={{ gap: '1rem' }}>
            <div className="stack" style={{ gap: '0.5rem' }}>
              <div className="row">
                <span className="badge caps">{f.type}</span>
                {f.verified ? <span className="small ok-text row" style={{ gap: 4 }}><ShieldIcon width={16} /> Verified by MedAssist-9ja</span> : <StatusBadge status="pending" label="Awaiting verification" />}
              </div>
              <h1 style={{ margin: 0 }}>{f.name}</h1>
              <div className="muted">{f.address}{f.landmark ? ` · ${f.landmark}` : ''}</div>
              <div className="meta" style={{ fontSize: '0.95rem' }}>
                <span className={f.openNow ? 'ok-text' : 'danger-text'}>{f.hours}</span>
                {km !== null && <span><span className="mono">{km}</span> km from you</span>}
                <span className={updatedMin > 24 * 60 ? 'warn-text' : ''}>Stock {updatedLabel(updatedMin).toLowerCase()}{updatedMin < 24 * 60 ? `, ${time(f.lastUpdated)}` : ''}</span>
                {f.rating.count > 0 && <span>★ {f.rating.avg} ({f.rating.count})</span>}
              </div>
            </div>
            <div className="stack" style={{ gap: '0.6rem' }}>
              <div className="card soft tight">
                <div className="small muted">{f.type === 'hospital' && f.emergencyPhone ? 'Emergency line' : 'Phone'}</div>
                <div style={{ fontSize: '1.35rem', color: 'var(--ink)' }}><Phone value={f.emergencyPhone ?? f.phone} /></div>
              </div>
              <div className="grid2" style={{ gap: '0.5rem' }}>
                <a className="btn primary" href={telUrl(f.emergencyPhone ?? f.phone)}>Call</a>
                <a className="btn" href={directionsUrl(f, location)} target="_blank" rel="noreferrer">Directions</a>
              </div>
            </div>
          </div>
        </div>

        <div className="layout-side">
          <div className="stack-lg">
            {searched && isPatientOrGuest && (
              <section className="card tint stack">
                <div className="eyebrow" style={{ margin: 0 }}>You searched for</div>
                <div className="spread-top">
                  <div>
                    <h2 style={{ margin: 0 }}>{drugName(searched)}</h2>
                    <div className="small">
                      {searched.available} in stock{searched.expiry_date ? ` · expires ${monthYear(searched.expiry_date)}` : ''}
                      {searched.refrigerated ? ' · keep refrigerated' : ''}{searched.needs_prescription ? ' · needs a prescription' : ''}
                    </div>
                  </div>
                  <span className="mono" style={{ fontSize: '1.7rem', color: 'var(--ink)' }}>{naira(searched.price)}</span>
                </div>
                <div className="row">
                  <label className="row" style={{ margin: 0, gap: '0.5rem' }}>
                    Quantity
                    <select style={{ width: 'auto' }} value={qty} onChange={(e) => setQty(Number(e.target.value))}>
                      {Array.from({ length: Math.min(10, searched.available) }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{n} {searched.form?.toLowerCase().includes('pen') || /pen/i.test(searched.strength) ? (n === 1 ? 'pen' : 'pens') : n === 1 ? 'pack' : 'packs'}</option>
                      ))}
                    </select>
                  </label>
                  {searched.allow_reservations ? (
                    <>
                      <Link className="btn primary" to={reserveUrl(searched.drug_id, qty, 'online')}>Reserve and pay {naira((searched.price ?? 0) * qty)}</Link>
                      <Link className="btn outline" to={reserveUrl(searched.drug_id, qty, 'at_pickup')}>Reserve, pay at pickup</Link>
                    </>
                  ) : (
                    <a className="btn primary" href={telUrl(f.phone)}>Call to buy</a>
                  )}
                </div>
                <p className="small" style={{ margin: 0 }}>
                  The pharmacy confirms your reservation and holds it for you{f.openNow ? ' until closing time or for 2 hours' : ' from when it opens'}.
                </p>
              </section>
            )}

            {f.drugs.length > 0 && (
              <section className="card stack">
                <div className="spread">
                  <h2 style={{ margin: 0 }}>Medicines in stock</h2>
                  <input style={{ maxWidth: 280 }} className="filled" placeholder={`Search this ${f.type}`} value={text} onChange={(e) => setText(e.target.value)} aria-label={`Search this ${f.type}`} />
                </div>
                <div className="chips">
                  {['All', ...groupNames].map((g) => (
                    <button key={g} className={`chip ${filter === g ? 'on' : ''}`} onClick={() => setFilter(g)}>
                      {g}{g === 'All' ? ` · ${f.drugs.length}` : ''}
                    </button>
                  ))}
                </div>
                {notice && <div className="alert ok">{notice}</div>}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Medicine</th><th className="hide-mobile">Form</th><th className="num-cell">Price</th><th>Stock</th><th /></tr>
                    </thead>
                    <tbody>
                      {visible.map((d) => {
                        const s = stockText(d);
                        const out = d.available <= 0;
                        return (
                          <tr key={d.drug_id} style={out ? { color: 'var(--muted)' } : {}}>
                            <td>
                              <strong style={out ? { color: 'var(--muted)' } : {}}>{d.generic_name === d.brand_name ? d.brand_name : `${d.generic_name} (${d.brand_name.replace(/ (SoloStar|KwikPen|FlexPen)$/, '')})`}</strong>
                              <div className="tiny muted">{d.needs_prescription ? 'Prescription' : ''}{d.needs_prescription && d.refrigerated ? ' · ' : ''}{d.refrigerated ? 'Refrigerated' : ''}</div>
                            </td>
                            <td className="hide-mobile muted">{[d.strength, d.form].filter(Boolean).join(' · ')}</td>
                            <td className="num-cell">{naira(d.price ?? d.last_price)}</td>
                            <td className={s.cls}>{s.text}</td>
                            <td style={{ textAlign: 'right' }}>
                              {out ? (
                                isPatientOrGuest && <button className="btn link" onClick={() => watch(d.drug_id)}>Tell me when back</button>
                              ) : (
                                isPatientOrGuest && d.allow_reservations && <Link className="btn small outline" to={reserveUrl(d.drug_id)}>Reserve</Link>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="spread">
                  <span className="small muted">Showing {visible.length} of {shownDrugs.length} medicines</span>
                  {shownDrugs.length > visible.length && <button className="btn small" onClick={() => setShowAll(true)}>Show more</button>}
                </div>
              </section>
            )}

            {f.type === 'hospital' && (
              <section className="card stack">
                <h2 style={{ margin: 0 }}>Beds and services</h2>
                {beds.length > 0 && (
                  <div className="grid3" style={{ gap: '0.6rem' }}>
                    {beds.map((b) => (
                      <div key={b.id} className="card soft tight">
                        <div className="small muted">{WARD_LABEL[b.sub_type] ?? b.sub_type}</div>
                        <div className={`mono ${b.available === 0 ? 'danger-text' : ''}`} style={{ fontSize: '1.4rem' }}>{b.available} <span className="small muted">of {b.capacity} free</span></div>
                      </div>
                    ))}
                  </div>
                )}
                {f.services.length > 0 && (
                  <div className="chips">
                    {f.services.map((s) => (
                      <span key={s.service} className={`tag ${s.status === 'available' ? 'strong' : ''}`} style={s.status !== 'available' ? { textDecoration: 'line-through', color: 'var(--muted)' } : {}}>
                        {s.service}{s.status === 'under_repair' ? ' (under repair)' : ''}
                      </span>
                    ))}
                  </div>
                )}
                {blood.length > 0 && (
                  <div className="small">
                    <strong>Blood bank:</strong> {blood.map((b) => `${b.sub_type} ${b.available}`).join(' · ')}
                  </div>
                )}
                {equipment.length > 0 && (
                  <div className="small">
                    <strong>Equipment:</strong> {equipment.map((e) => `${e.sub_type} ${e.status === 'maintenance' ? '(maintenance)' : `${e.available} free`}`).join(' · ')}
                  </div>
                )}
                {beds.some((b) => b.available > 0) && <Link className="btn primary" to="/bed-request" style={{ alignSelf: 'start' }}>Request a bed</Link>}
              </section>
            )}

            {f.specialists.length > 0 && (
              <section className="card stack">
                <h2 style={{ margin: 0 }}>Specialists today</h2>
                {f.specialists.map((s) => (
                  <div key={s.id} className="spread">
                    <span><strong>{s.name}</strong> · {s.specialty}</span>
                    <span className={`badge ${s.available_now ? 'ok' : s.on_call ? 'info' : 'ok'}`}>{s.available_now ? 'Available now' : s.on_call ? 'On call' : 'On duty'}</span>
                  </div>
                ))}
              </section>
            )}

            {!f.drugs.length && !f.resources.length && !f.specialists.length && <Empty>No live availability listed right now. Call to confirm.</Empty>}
          </div>

          <aside className="stack-lg">
            <div className="card stack">
              <h3 style={{ margin: 0 }}>Location</h3>
              <div>{f.address}</div>
              {f.landmark && <div className="small muted">Landmark: {f.landmark}</div>}
              <a className="btn outline" href={directionsUrl(f, location)} target="_blank" rel="noreferrer"><MapIcon /> View on map</a>
            </div>
            <div className="card stack">
              <h3 style={{ margin: 0 }}>Opening hours</h3>
              {f.open24h ? (
                <div className="ok-text">Open 24 hours, every day</div>
              ) : (
                <dl className="kv" style={{ margin: 0 }}>
                  {hoursRows(f.openingHours, f.today).map((r) => (
                    <div key={r.label} style={{ display: 'contents', fontWeight: r.today ? 700 : 400 }}>
                      <dt style={r.today ? { color: 'var(--ink)', fontWeight: 700 } : {}}>{r.label}</dt>
                      <dd style={r.today ? { fontWeight: 700 } : {}}>{r.text}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <div className="card stack">
              <h3 style={{ margin: 0 }}>Why you can trust this listing</h3>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '0.35rem' }}>
                <li>{f.trust.licenceType} checked: <span className="mono">{f.trust.licenceNo}</span></li>
                {f.trust.leadName && <li>{f.type === 'pharmacy' ? 'Superintendent pharmacist' : 'Medical director'}: {f.trust.leadName}</li>}
                <li>Stock updated by the {f.type} {updatedLabel(updatedMin).replace('Updated ', '')}</li>
                {f.rating.count > 0 && <li>Rated {f.rating.avg} out of 5 by {f.rating.count} users</li>}
              </ul>
              {me?.user.role === 'patient' && <Link to={`/complaint?facility=${f.id}`} className="small" style={{ fontWeight: 700 }}>Report a problem with this {f.type}</Link>}
            </div>
          </aside>
        </div>
      </div>
    </Page>
  );
}
