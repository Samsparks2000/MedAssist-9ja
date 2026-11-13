import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, SampleNote, Spinner, StatusBadge } from '../../components/common';
import { ClockIcon } from '../../components/Icons';
import { api, errorText } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { minutesSince, time, updatedLabel, WARD_LABEL } from '../../lib/format';
import type { Facility } from './Dashboard';

interface Resource {
  type: 'bed' | 'blood' | 'oxygen' | 'equipment';
  subType: string;
  capacity: number;
  available: number;
  status: 'available' | 'in_use' | 'maintenance' | null;
  price: number | null;
}

/** Hospital services that are the same thing as an equipment row, so the two statuses stay in step. */
const SERVICE_FOR_EQUIPMENT: Record<string, string> = {
  'CT scanner': 'CT scan', 'X-ray': 'X-ray', Ventilator: 'Ventilator', 'Dialysis machine': 'Dialysis',
};

const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const BLOOD_ALERT = 2;
const TODAY_LABEL: Record<string, [string, string]> = {
  on_duty: ['On duty', 'ok'],
  on_call: ['On call', 'info'],
  later_today: ['Later today', 'grey'],
  off: ['Off today', 'grey'],
};

/** Hospital "Beds and services" (design page 12): what you save here is what patients see. */
export function BedsAndServices({ facility, onSaved }: { facility: Facility; onSaved: () => void }) {
  const { me } = useAuth();
  const [rows, setRows] = useState<Resource[] | null>(null);
  const [services, setServices] = useState<{ service: string; status: string }[]>([]);
  const [allServices, setAllServices] = useState<string[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<any[]>('/resources').then((rs) => setRows(rs.map((r) => ({ type: r.type, subType: r.sub_type, capacity: r.capacity, available: r.available, status: r.status, price: r.price }))));
    api<{ all: string[]; services: { service: string; status: string }[] }>('/hospital/services').then((s) => { setServices(s.services); setAllServices(s.all); });
    api<any[]>('/hospital/specialists').then(setDoctors).catch(() => {});
  }, []);
  useEffect(() => load(), [load]);

  if (!rows) return <Spinner />;
  const age = minutesSince(facility.last_updated);
  const update = (type: Resource['type'], subType: string, patch: Partial<Resource>) => {
    const exists = rows.some((r) => r.type === type && r.subType === subType);
    setRows(exists ? rows.map((r) => (r.type === type && r.subType === subType ? { ...r, ...patch } : r)) : [...rows, { type, subType, capacity: 0, available: 0, status: null, price: null, ...patch }]);
    setDirty(true);
    setMsg(null);
  };
  const beds = rows.filter((r) => r.type === 'bed');
  const blood = (g: string) => rows.find((r) => r.type === 'blood' && r.subType === g);
  const equipment = rows.filter((r) => r.type === 'equipment' || r.type === 'oxygen');

  const save = async () => {
    try {
      await api('/resources', { method: 'PUT', body: { items: rows } });
      await api('/hospital/services', { method: 'PUT', body: { items: services } });
      setDirty(false);
      setError(null);
      setMsg('Saved. Patients see these numbers now.');
      onSaved();
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Beds and services</h1>
          <div className="muted">Signed in as {me?.user.name ?? 'staff'} · what you save here is what patients see</div>
        </div>
        <button className="btn primary" disabled={!dirty} onClick={save}>Save all changes</button>
      </div>

      {age > 3 * 60 && (
        <div className="card warn spread" style={{ marginBottom: '1rem' }}>
          <span className="row" style={{ alignItems: 'flex-start', flex: 1 }}>
            <ClockIcon />
            <span><strong>Bed numbers were last updated {updatedLabel(age).replace('Updated ', '')}{age < 1440 ? `, at ${time(facility.last_updated)}` : ''}.</strong> Please check them at each shift change so patients are not sent to a full ward.</span>
          </span>
          <button className="btn small" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }} onClick={() => api('/facilities/mine/confirm', { method: 'POST' }).then(onSaved)}>Numbers are still correct</button>
        </div>
      )}
      <ErrorBox error={error} />
      {msg && <div className="alert ok" style={{ marginBottom: '1rem' }}>{msg}</div>}

      <section className="card stack">
        <div>
          <h2 style={{ margin: 0 }}>Free beds by ward</h2>
          <p className="muted small" style={{ margin: 0 }}>Use − and + when a patient is admitted or discharged.</p>
        </div>
        {beds.length === 0 && <p className="muted">No wards yet — add them in <Link to="/dashboard/profile">Hospital profile</Link>.</p>}
        <div className="wards">
          {beds.map((b) => {
            const full = b.available === 0;
            const low = !full && b.available <= Math.max(1, Math.round(b.capacity * 0.2));
            return (
              <div key={b.subType} className={`ward ${full ? 'full' : low ? 'low' : ''}`}>
                <div className="spread">
                  <strong>{WARD_LABEL[b.subType] ?? b.subType}</strong>
                  <span className={`small ${full ? 'danger-text' : low ? 'warn-text' : 'muted'}`}>{full ? `Full · of ${b.capacity}` : low ? `${b.available} free of ${b.capacity}` : `of ${b.capacity}`}</span>
                </div>
                <div className="counter">
                  <button aria-label={`One fewer free ${b.subType} bed`} onClick={() => update('bed', b.subType, { available: Math.max(0, b.available - 1) })}>−</button>
                  <div className="v" aria-live="polite">{b.available}</div>
                  <button aria-label={`One more free ${b.subType} bed`} onClick={() => update('bed', b.subType, { available: Math.min(b.capacity, b.available + 1) })}>+</button>
                </div>
                <div className="bar"><i style={{ width: `${b.capacity ? (b.available / b.capacity) * 100 : 0}%` }} /></div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="layout-side mt">
        <section className="card">
          <h2>Services and equipment</h2>
          <table>
            <thead><tr><th>Service</th><th>Status today</th></tr></thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.service}>
                  <td>{s.service}</td>
                  <td style={{ width: 190 }}>
                    <select className={`status-${s.status}`} value={s.status} onChange={(e) => {
                        const status = e.target.value;
                        setServices(services.map((x) => (x.service === s.service ? { ...x, status } : x)));
                        const machine = Object.keys(SERVICE_FOR_EQUIPMENT).find((k) => SERVICE_FOR_EQUIPMENT[k] === s.service);
                        if (machine && rows.some((r) => r.type === 'equipment' && r.subType === machine)) {
                          update('equipment', machine, status === 'under_repair' ? { status: 'maintenance', available: 0 } : { status: 'available' });
                        }
                        setDirty(true);
                      }} aria-label={`${s.service} status`}>
                      <option value="available">Available</option>
                      <option value="under_repair">Under repair</option>
                      <option value="not_available">Not available</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {allServices.some((a) => !services.some((s) => s.service === a)) && (
            <select className="mt" value="" onChange={(e) => { if (e.target.value) { setServices([...services, { service: e.target.value, status: 'available' }]); setDirty(true); } }} aria-label="Add a service">
              <option value="">+ Add a service…</option>
              {allServices.filter((a) => !services.some((s) => s.service === a)).map((a) => <option key={a}>{a}</option>)}
            </select>
          )}
          {equipment.length > 0 && (
            <>
              <h3 className="mt">Equipment and oxygen</h3>
              <p className="muted small" style={{ margin: 0 }}>Machines marked under repair are hidden from patient searches until you mark them working again.</p>
              <table>
                <thead><tr><th>Item</th><th>Working status</th><th>Free now</th></tr></thead>
                <tbody>
                  {equipment.map((r) => {
                    const repair = r.type === 'equipment' && r.status === 'maintenance';
                    return (
                      <tr key={r.subType}>
                        <td>{r.subType}</td>
                        <td style={{ width: 170 }}>
                          {r.type === 'equipment' ? (
                            <select
                              className={`status-${repair ? 'under_repair' : 'available'}`}
                              value={repair ? 'maintenance' : 'available'}
                              onChange={(e) => {
                                const repairNow = e.target.value === 'maintenance';
                                update(r.type, r.subType, repairNow ? { status: 'maintenance', available: 0 } : { status: 'available' });
                                const service = SERVICE_FOR_EQUIPMENT[r.subType];
                                if (service && services.some((x) => x.service === service)) {
                                  setServices(services.map((x) => (x.service === service ? { ...x, status: repairNow ? 'under_repair' : 'available' } : x)));
                                }
                              }}
                              aria-label={`${r.subType} working status`}
                            >
                              <option value="available">Working</option>
                              <option value="maintenance">Under repair</option>
                            </select>
                          ) : (
                            <span className="muted small">—</span>
                          )}
                        </td>
                        <td style={{ width: 190 }}>
                          <div className="row" style={{ flexWrap: 'nowrap' }}>
                            <input className="mono" type="number" min={0} max={r.capacity} disabled={repair} style={{ width: 70, minHeight: 38 }} value={r.available} onChange={(e) => update(r.type, r.subType, { available: Math.min(r.capacity, Math.max(0, Number(e.target.value))) })} aria-label={`${r.subType} free`} />
                            <span className="small muted">of {r.capacity}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </section>

        <section className="card stack" id="blood">
          <div>
            <h2 style={{ margin: 0 }}>Blood bank</h2>
            <p className="muted small" style={{ margin: 0 }}>Units available · alert below {BLOOD_ALERT}</p>
          </div>
          <div className="blood">
            {GROUPS.map((g) => {
              const v = blood(g)?.available ?? 0;
              return (
                <div key={g} className={v === 0 ? 'out' : v < BLOOD_ALERT ? 'low' : ''}>
                  <div className="g">{g.replace('-', '−')}</div>
                  <input type="number" min={0} value={v} onChange={(e) => update('blood', g, { available: Math.max(0, Number(e.target.value)), capacity: Math.max(0, Number(e.target.value)) })} aria-label={`${g} units`} className={v === 0 ? 'danger-text' : v < BLOOD_ALERT ? 'warn-text' : ''} />
                </div>
              );
            })}
          </div>
          <button className="btn block" disabled={!dirty} onClick={save}>Update blood units</button>
        </section>
      </div>

      <section className="card mt">
        <div className="spread" style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>Specialists today</h2>
          <Link to="/dashboard/specialists" className="btn small">Edit weekly rota</Link>
        </div>
        {doctors.filter((d) => d.link_status === 'confirmed').length === 0 ? (
          <p className="muted">No confirmed specialists yet. Doctors register themselves and list your hospital; you confirm them in Specialists and rota.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Doctor</th><th>Specialty</th><th>Today</th><th>Usual hours</th></tr></thead>
              <tbody>
                {doctors.filter((d) => d.link_status === 'confirmed').map((d) => (
                  <tr key={d.id}>
                    <td><strong>{d.name}</strong></td>
                    <td>{d.specialty}</td>
                    <td><span className={`badge ${TODAY_LABEL[d.today][1]}`}>{TODAY_LABEL[d.today][0]}</span></td>
                    <td className="muted">{d.usualHours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <SampleNote>Hospital, staff names, bed numbers and blood units shown are sample data.</SampleNote>
    </div>
  );
}

/** Specialists who list this hospital: confirm or decline them; see their usual hours. */
export function Rota() {
  const [docs, setDocs] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<any[]>('/hospital/specialists').then(setDocs).catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
  }, []);
  const decide = (id: string, d: 'confirm' | 'decline') => api(`/hospital/specialists/${id}/${d}`, { method: 'POST' }).then(load).catch((e) => setError(errorText(e)));

  if (!docs) return <Spinner />;
  const pending = docs.filter((d) => d.link_status === 'pending');
  const confirmed = docs.filter((d) => d.link_status === 'confirmed');
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Specialists and rota</h1>
          <div className="muted">Doctors set their own weekly schedule. Patients only see doctors you have confirmed work here.</div>
        </div>
      </div>
      <ErrorBox error={error} />
      {pending.length > 0 && (
        <section className="card stack" style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Waiting for your confirmation</h2>
          {pending.map((d) => (
            <div key={d.id} className="req attention">
              <div>
                <strong>{d.title} {d.name.replace(/^Dr\.\s*/, '')}</strong> · {d.specialty} · {d.position}
                <div className="small muted">MDCN <span className="mono">{d.licence_no}</span> · {d.verification_status === 'approved' ? 'licence verified by MedAssist-9ja' : 'licence check in progress'} · {d.usualHours}</div>
              </div>
              <div className="row">
                <button className="btn small" onClick={() => decide(d.id, 'decline')}>Does not work here</button>
                <button className="btn small primary" onClick={() => decide(d.id, 'confirm')}>Confirm</button>
              </div>
            </div>
          ))}
        </section>
      )}
      <section className="card">
        <h2>Confirmed specialists</h2>
        {confirmed.length === 0 ? <Empty>None yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Doctor</th><th>Specialty</th><th>Today</th><th>Usual hours</th><th /></tr></thead>
              <tbody>
                {confirmed.map((d) => (
                  <tr key={d.id}>
                    <td><strong>{d.name}</strong><div className="tiny muted">{d.position}</div></td>
                    <td>{d.specialty}</td>
                    <td><span className={`badge ${TODAY_LABEL[d.today][1]}`}>{TODAY_LABEL[d.today][0]}</span>{d.verification_status !== 'approved' && <> <StatusBadge status={d.verification_status} /></>}</td>
                    <td className="muted">{d.usualHours}</td>
                    <td style={{ textAlign: 'right' }}><button className="btn link" onClick={() => confirm(`Remove ${d.name} from your hospital?`) && decide(d.id, 'decline')}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
