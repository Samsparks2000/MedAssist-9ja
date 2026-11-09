import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Field, Spinner } from '../components/common';
import { Page } from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { useUserLocation } from '../lib/location';

/** Patient profile: details, saved places, refill reminders and back-in-stock alerts. */
export function Profile() {
  const { me, refresh, signOut } = useAuth();
  const { location } = useUserLocation();
  const [name, setName] = useState(me?.user.name ?? '');
  const [refills, setRefills] = useState<any[] | null>(null);
  const [watches, setWatches] = useState<any[] | null>(null);
  const [saved, setSaved] = useState(false);

  const load = () => {
    if (me?.user.role !== 'patient') return;
    api<any[]>('/me/refills').then(setRefills);
    api<any[]>('/me/watches').then(setWatches);
  };
  useEffect(load, [me]);
  if (!me) return <Page><Spinner /></Page>;

  return (
    <Page narrow>
      <div className="stack-lg">
        <h1>Profile</h1>
        <section className="card stack">
          <form className="row" style={{ alignItems: 'end' }} onSubmit={async (e) => { e.preventDefault(); await api('/auth/me', { method: 'PATCH', body: { name } }); await refresh(); setSaved(true); }}>
            <div style={{ flex: 1, minWidth: 200 }}><Field label="Your name"><input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} /></Field></div>
            <button className="btn" style={{ marginBottom: '1rem' }}>{saved ? 'Saved' : 'Save'}</button>
          </form>
          {me.user.phone && <div className="small muted">Phone: <span className="mono">{me.user.phone.replace('+234', '0')}</span></div>}
          {me.user.email && <div className="small muted">Email: <span className="mono">{me.user.email}</span></div>}
        </section>

        {me.user.role === 'patient' && (
          <>
            <section className="card stack">
              <h2 style={{ margin: 0 }}>Saved places</h2>
              {me.locations.length === 0 && <p className="muted small" style={{ margin: 0 }}>Save home or work so searches start there.</p>}
              {me.locations.map((l) => (
                <div key={l.id} className="spread">
                  <span><strong>{l.label}</strong> <span className="small muted">{l.address}</span></span>
                  <button className="btn small" onClick={async () => { await api(`/auth/me/locations/${l.id}`, { method: 'DELETE' }); refresh(); }}>Remove</button>
                </div>
              ))}
              {location && (
                <button
                  className="btn small outline"
                  style={{ alignSelf: 'start' }}
                  onClick={async () => {
                    const label = prompt('Name this place (e.g. Home, Work)', 'Home');
                    if (!label) return;
                    await api('/auth/me/locations', { body: { label, address: location.label, lat: location.lat, lng: location.lng } });
                    refresh();
                  }}
                >
                  Save “{location.label}”
                </button>
              )}
            </section>

            <section className="card stack">
              <h2 style={{ margin: 0 }}>Refill reminders</h2>
              {!refills ? <Spinner /> : refills.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Set one from any collected order.</p> : refills.map((r) => (
                <div key={r.id} className="spread">
                  <span><strong>{r.drug}</strong> <span className="small muted">every {r.interval_days} days · next {date(r.next_at)}{r.facility_name ? ` · ${r.facility_name}` : ''}</span></span>
                  <button className="btn small" onClick={async () => { await api(`/me/refills/${r.id}`, { method: 'DELETE' }); load(); }}>Stop</button>
                </div>
              ))}
            </section>

            <section className="card stack">
              <h2 style={{ margin: 0 }}>Back-in-stock alerts</h2>
              {!watches ? <Spinner /> : watches.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Tap “Tell me when back” on an out-of-stock medicine.</p> : watches.map((w) => (
                <div key={w.id} className="spread">
                  <span><strong>{w.drug}</strong> <span className="small muted">at <Link to={`/facility/${w.facility_id}`}>{w.facility_name}</Link>{w.notified_at ? ' · back in stock' : ' · waiting'}</span></span>
                  <button className="btn small" onClick={async () => { await api(`/me/watches/${w.id}`, { method: 'DELETE' }); load(); }}>Remove</button>
                </div>
              ))}
            </section>
          </>
        )}
        <div className="btn-row">
          <Link className="btn" to="/notifications">Notifications</Link>
          <button className="btn danger-outline" onClick={() => { signOut(); window.location.href = '/'; }}>Sign out</button>
        </div>
        {me.user.role !== 'patient' && <Empty>Manage your facility from the <Link to="/dashboard">dashboard</Link>.</Empty>}
      </div>
    </Page>
  );
}
