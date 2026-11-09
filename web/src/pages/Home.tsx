import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AreaSelect } from '../components/AreaSelect';
import { NeedIcon, PulseIcon } from '../components/Icons';
import { SearchBox } from '../components/SearchBox';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { whenLabel } from '../lib/format';
import { useUserLocation } from '../lib/location';

const TRY = [
  ['Oxygen', 'resource:oxygen'],
  ['ICU bed', 'resource:bed:ICU'],
  ['Cardiologist', 'specialist:Cardiology'],
  ['Blood O-negative', 'resource:blood:O-'],
  ['Dialysis', 'resource:equipment:Dialysis machine'],
  ['Asthma inhaler', 'drug-generic:Salbutamol'],
] as const;

/** "Browse by need" tiles from the mobile design. */
export const NEEDS = [
  { label: 'Drugs', icon: 'drug', to: '/search?focus=1' },
  { label: 'Equipment', icon: 'equipment', to: '/search?target=resource%3Aequipment' },
  { label: 'Specialists', icon: 'doctor', to: '/search?target=specialist%3Aany' },
  { label: 'Hospital beds', icon: 'bed', to: '/search?target=resource%3Abed' },
  { label: 'Oxygen', icon: 'oxygen', to: '/search?target=resource%3Aoxygen' },
  { label: 'Open now', icon: 'open', to: '/search?target=facility%3Aany' },
] as const;

function RadiusRings() {
  return (
    <svg viewBox="0 0 300 300" width="100%" style={{ maxWidth: 300 }} role="img" aria-label="Search rings at 5, 10 and 20 km around you">
      <circle cx="150" cy="150" r="135" fill="none" stroke="#b9c9c6" strokeDasharray="4 5" />
      <circle cx="150" cy="150" r="88" fill="none" stroke="#5b6d6f" strokeDasharray="4 5" />
      <circle cx="150" cy="150" r="48" fill="#e1f2ec" stroke="#0f7b63" strokeWidth="2.5" />
      <circle cx="150" cy="150" r="9" fill="#0f7b63" />
      <text x="150" y="178" textAnchor="middle" fontSize="12" fill="#12282a">You</text>
      <text x="190" y="118" fontSize="11" fill="#0f7b63" fontFamily="IBM Plex Mono, monospace">5 km</text>
      <text x="222" y="80" fontSize="11" fill="#5b6d6f" fontFamily="IBM Plex Mono, monospace">10 km</text>
      <text x="245" y="34" fontSize="11" fill="#5b6d6f" fontFamily="IBM Plex Mono, monospace">20 km</text>
      <rect x="126" y="108" width="12" height="12" rx="2" fill="#c42b2b" />
      <rect x="88" y="196" width="12" height="12" rx="2" fill="#7f9a97" />
      <rect x="216" y="204" width="12" height="12" rx="2" fill="#7f9a97" />
      <rect x="36" y="88" width="12" height="12" rx="2" fill="#b9c9c6" />
    </svg>
  );
}

function ActiveReservation() {
  const { me } = useAuth();
  const [order, setOrder] = useState<any>(null);
  useEffect(() => {
    if (me?.user.role !== 'patient') return;
    api<any[]>('/orders').then((os) => setOrder(os.find((o) => ['requested', 'pending_payment', 'paid', 'reserved'].includes(o.status)) ?? null)).catch(() => {});
  }, [me]);
  if (!order) return null;
  return (
    <Link to={`/orders/${order.id}`} className="card raised spread" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 2 }}>Active reservation</div>
        <strong className="display" style={{ fontSize: '1.1rem' }}>{order.items?.[0]?.description}</strong>
        <div className="small muted">
          {order.facility_name} · {order.status === 'requested' ? 'waiting for the pharmacy' : order.status === 'pending_payment' ? 'awaiting payment' : `collect by ${whenLabel(order.expires_at)}`}
        </div>
      </div>
      {order.pickup_code ? <span className="mono" style={{ fontSize: '1.4rem', color: 'var(--ink)' }}>{order.pickup_code}</span> : <span className="btn small">Open</span>}
    </Link>
  );
}

export function Home() {
  const navigate = useNavigate();
  const { location } = useUserLocation();
  const [text, setText] = useState('');
  const [target, setTarget] = useState<string | undefined>();

  const go = (p: { q?: string; target?: string }) => {
    const params = new URLSearchParams();
    if (p.target) params.set('target', p.target);
    if (p.q) params.set('q', p.q);
    navigate(`/search?${params}`);
  };

  return (
    <>
      <section className="hero">
        <div className="container stack-lg">
          <div>
            <div className="eyebrow">Medical resource locator·</div>
            <h1>Find the nearest place that has the care you need.</h1>
            <p className="lede">
              Search for a drug, medical equipment or a specialist. MedAssist-9ja shows the closest hospitals and pharmacies that list it, so you stop going from
              place to place hoping to find it.
            </p>
          </div>

          <form
            className="search-card"
            onSubmit={(e) => {
              e.preventDefault();
              if (target) go({ target, q: text });
              else if (text.trim()) go({ q: text.trim() });
            }}
          >
            <div className="search-grid">
              <div>
                <label htmlFor="home-q">What do you need?</label>
                <SearchBox id="home-q" value={text} onChange={(t, spec) => { setText(t); setTarget(spec); }} />
              </div>
              <div>
                <label htmlFor="home-area">Your area</label>
                <AreaSelect id="home-area" className="filled" />
              </div>
              <button className="btn primary big" disabled={!text.trim() || !location}>Search</button>
            </div>
            <div className="chips mt">
              <span className="small muted">Try:</span>
              {TRY.map(([label, spec]) => (
                <button type="button" key={spec} className="chip" onClick={() => go({ target: spec, q: label })}>{label}</button>
              ))}
            </div>
          </form>


          <ActiveReservation />

          <section>
            <h2>Browse by need</h2>
            <div className="need-grid">
              {NEEDS.map((n) => (
                <Link key={n.label} to={n.to} className="need"><NeedIcon name={n.icon} />{n.label}</Link>
              ))}
            </div>
          </section>
        </div>
      </section>

      <section className="band white" id="how">
        <div className="container">
          <div className="eyebrow">How it works</div>
          <h2 className="big-title">Four steps from search to the right door</h2>
          <p className="lede">Hospitals and pharmacies keep their stock and services up to date on MedAssist-9ja. When you search, the app checks those records and how far each place is from you.</p>
          <div className="layout-side mt2">
            <div className="steps">
              {[
                ['Tell us what you need', 'Type a drug, equipment or specialist, or tap Emergency. Choose your area, or let the app use your phone’s location.'],
                ['We search outward from you', 'The neighbourhood search looks within 5 km first. If nothing there has it, it widens to 10 km, then 20 km.'],
                ['Compare and confirm', 'See distance, price and when each place last updated its records. Call to confirm before you leave.'],
                ['Reserve, pay and go', 'Reserve a drug and pay by card, transfer or USSD — or pay at pickup — then follow the directions to the facility.'],
              ].map(([t, d], i) => (
                <div className="step" key={t}>
                  <span className="num ring">{i + 1}</span>
                  <div>
                    <h3>{t}</h3>
                    <p className="muted">{d}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="card soft center">
              <RadiusRings />
              <p className="small muted" style={{ textAlign: 'left' }}>Each search starts with the inner ring. The red square is the nearest facility that lists what you asked for.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="band" id="why">
        <div className="container">
          <div className="eyebrow">Why it matters</div>
          <h2 className="big-title">In an emergency, every wasted trip costs time you do not have</h2>
          <p className="lede">Today, many people in Nigeria call or travel to several hospitals and pharmacies before they find one with the right drug, a free bed or a doctor on duty. MedAssist-9ja replaces that trial and error with one search.</p>
          <div className="pillars mt2">
            {[
              ['Faster care', 'Knowing where to go first means treatment can start sooner, which matters most in emergencies.'],
              ['Lower cost', 'Fewer wasted trips means less money spent on transport and calls while someone is sick.'],
              ['Trusted providers', 'Only verified pharmacies and hospitals appear, which helps people avoid fake drugs and unlicensed outlets.'],
              ['Better stock for facilities', 'Pharmacies and hospitals get simple inventory tools, low-stock and expiry alerts, and see what people search for.'],
            ].map(([t, d]) => (
              <div className="pillar" key={t}>
                <h3>{t}</h3>
                <p className="muted">{d}</p>
              </div>
            ))}
          </div>
          <div className="compare mt2">
            <div className="card danger">
              <h3 style={{ color: 'var(--danger-ink)' }}>Without MedAssist-9ja</h3>
              <ol>
                <li>Call a pharmacy: out of stock.</li>
                <li>Travel to a second one: closed.</li>
                <li>Ask around, try a third.</li>
                <li>Finally find the drug, hours later.</li>
              </ol>
            </div>
            <div className="card tint" style={{ borderColor: 'transparent' }}>
              <h3 style={{ color: 'var(--brand)' }}>With MedAssist-9ja</h3>
              <ol>
                <li>Search once.</li>
                <li>See the nearest place that lists it.</li>
                <li>Call to confirm, or reserve and pay.</li>
                <li>Go straight there.</li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="band dark on-dark" id="facilities">
        <div className="container">
          <div className="eyebrow">For hospitals and pharmacies</div>
          <h2 className="big-title">List your facility and reach people who need you</h2>
          <p className="lede" style={{ color: '#a9bcb9' }}>Facilities manage their stock and services from a dashboard. Every sale or change updates what the public sees.</p>
          <div className="grid2 mt2">
            <div className="card">
              <h3>Pharmacies</h3>
              <ul>
                <li>Upload stock from a spreadsheet</li>
                <li>Stock goes down automatically with each sale</li>
                <li>Low-stock and expiry alerts</li>
                <li>Receive reservations and payments</li>
              </ul>
              <Link to="/register?type=pharmacy" className="btn mint">Register a pharmacy</Link>
            </div>
            <div className="card">
              <h3>Hospitals</h3>
              <ul>
                <li>List services, bed capacity and equipment</li>
                <li>Publish specialists’ duty schedules</li>
                <li>Track blood, oxygen and consumables</li>
                <li>Reports on demand and stock</li>
              </ul>
              <div className="stack">
                <Link to="/register?type=hospital" className="btn mint" style={{ alignSelf: 'start' }}>Register a hospital</Link>
                <Link to="/register?type=specialist" style={{ color: 'var(--mint)', fontWeight: 700 }}>Are you a specialist doctor? Register here</Link>
              </div>
            </div>
          </div>
          <p className="small mt2" style={{ color: '#a9bcb9' }}>Already listed? <Link to="/login?as=provider" style={{ color: 'var(--mint)' }}>Sign in to your dashboard</Link></p>
        </div>
      </section>
    </>
  );
}
