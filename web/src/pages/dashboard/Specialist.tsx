import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ErrorBox, Spinner, StatusBadge } from '../../components/common';
import { api, errorText } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmt12 = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
};

/** US-10: "available now" toggle, this week's schedule and which hospitals have confirmed you. */
export function SpecialistDashboard() {
  const { me, refresh } = useAuth();
  const [data, setData] = useState<{ profile: any; schedule: any[]; hospitals: any[] } | null>(null);
  const [availAt, setAvailAt] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api('/specialists/me');
    setData(d);
    setAvailAt(d.profile?.available_at ?? d.hospitals.find((h: any) => h.status === 'confirmed')?.facility_id ?? '');
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <Spinner />;
  if (!data.profile || data.profile.verification_status === 'draft') return <Navigate to="/dashboard/profile" replace />;
  const p = data.profile;
  const confirmed = data.hospitals.filter((h) => h.status === 'confirmed');
  const run = async (body: object, ok: string) => {
    try {
      await api('/specialists/me/availability', { body });
      setMsg(ok);
      setError(null);
      await load();
      refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const today = new Date().getDay();

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{me?.user.name}</h1>
          <div className="muted">{p.specialty} · MDCN <span className="mono">{p.licence_no}</span></div>
        </div>
        <StatusBadge status={p.verification_status} />
      </div>
      {p.verification_status === 'pending' && <div className="alert warn" style={{ marginBottom: '1rem' }}>We are checking your MDCN registration. Patients will find you once it is approved.</div>}
      {(p.verification_status === 'rejected' || p.verification_status === 'info_requested') && (
        <div className="alert danger" style={{ marginBottom: '1rem' }}>{p.verification_note} <Link to="/dashboard/profile">Update your profile</Link></div>
      )}
      <ErrorBox error={error} />
      {msg && <div className="alert ok" style={{ marginBottom: '1rem' }}>{msg}</div>}

      <div className="layout-side">
        <div className="stack-lg">
          <section className={`card stack ${p.available_now ? 'tint' : ''}`}>
            <h2 style={{ margin: 0 }}>{p.available_now ? 'You are available now' : 'Available now?'}</h2>
            <p className="muted small" style={{ margin: 0 }}>Patients searching nearby see you straight away, even outside your usual hours.</p>
            {confirmed.length === 0 ? (
              <p className="warn-text small" style={{ margin: 0 }}>No hospital has confirmed you yet.</p>
            ) : (
              <div className="row">
                <select style={{ flex: 1, minWidth: 220 }} value={availAt} onChange={(e) => setAvailAt(e.target.value)} aria-label="Hospital">
                  {confirmed.map((h) => <option key={h.facility_id} value={h.facility_id}>{h.name}</option>)}
                </select>
                {p.available_now ? (
                  <button className="btn" onClick={() => run({ availableNow: false }, 'You are now off duty.')}>Go off duty</button>
                ) : (
                  <button className="btn primary" disabled={!availAt || p.verification_status !== 'approved'} onClick={() => run({ availableNow: true, facilityId: availAt }, 'Patients nearby can now see you are available.')}>I am available now</button>
                )}
              </div>
            )}
          </section>

          <section className="card">
            <div className="spread" style={{ marginBottom: '0.5rem' }}>
              <h2 style={{ margin: 0 }}>This week</h2>
              <Link to="/dashboard/profile" className="btn small">Edit schedule</Link>
            </div>
            <table>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const rows = data.schedule.filter((s) => s.day === d);
                  return (
                    <tr key={d} style={d === today ? { fontWeight: 700 } : {}}>
                      <td>{DAYS[d]}{d === today ? ' (today)' : ''}</td>
                      <td className={rows.length ? '' : 'muted'}>
                        {rows.length ? rows.map((s) => `${s.facility_name} · ${s.on_call ? 'on call' : `${fmt12(s.start)}–${fmt12(s.end)}`}`).join('; ') : 'Not working'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
        <aside className="card stack">
          <h3 style={{ margin: 0 }}>Where you work</h3>
          {data.hospitals.map((h) => (
            <div key={h.facility_id} className="spread">
              <span><strong>{h.name}</strong><div className="tiny muted">{h.position}</div></span>
              <StatusBadge status={h.status === 'confirmed' ? 'confirmed' : h.status === 'declined' ? 'declined' : 'pending'} label={h.status === 'pending' ? 'Waiting for hospital' : undefined} />
            </div>
          ))}
          <Link to="/dashboard/profile" className="small">Add a hospital</Link>
        </aside>
      </div>
    </div>
  );
}
