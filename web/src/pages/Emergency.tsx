import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import { ErrorBox, Phone, Spinner } from '../components/common';
import { BackIcon, MapIcon, NeedIcon, PhoneIcon, PinIcon } from '../components/Icons';
import { LocationPicker } from '../components/LocationPicker';
import { api, errorText } from '../lib/api';
import { directionsUrl, telUrl, updatedLabel } from '../lib/format';
import { useUserLocation } from '../lib/location';
import { useSocketEvent } from '../lib/socket';
import { recentFacilities, rememberFacilities } from '../lib/symptoms';

const SITUATIONS = [
  ['chest', 'Chest pain or heart', 'chest pain'],
  ['breathing', 'Trouble breathing', 'breathing trouble'],
  ['bleeding', 'Bleeding or injury', 'bleeding or injury'],
  ['pregnancy', 'Pregnancy or labour', 'pregnancy or labour'],
  ['unconscious', 'Unconscious or fainting', 'unconsciousness'],
  ['child', 'Child emergency', 'a child emergency'],
  ['poisoning', 'Poisoning or overdose', 'poisoning'],
  ['other', 'Something else', 'emergencies'],
] as const;

/** Need tiles from the mobile emergency design: tap what you need, see only places that have it now. */
const NEED_TILES = [
  { label: 'Hospital bed', hint: 'Request one now', icon: 'bed', to: '/bed-request' },
  { label: 'Oxygen', hint: 'Cylinders available now', icon: 'oxygen', to: '/search?target=resource%3Aoxygen&emergency=1' },
  { label: 'Open pharmacy', hint: 'Open right now', icon: 'pharmacy', to: '/search?target=facility%3Apharmacy&emergency=1' },
  { label: 'Doctor on duty', hint: 'Specialist available', icon: 'doctor', to: '/search?target=specialist%3Aany&emergency=1' },
  { label: 'Urgent drug', hint: 'Type a drug name', icon: 'drug', to: '/search?focus=1&emergency=1' },
  { label: 'Other equipment', hint: 'Ventilator, dialysis, scans', icon: 'equipment', to: '/search?target=resource%3Aequipment&emergency=1' },
];

interface Hospital {
  id: string;
  name: string;
  area: string | null;
  lat: number;
  lng: number;
  emergencyPhone: string;
  distanceKm: number;
  etaMinutes: number;
  minutesAgo: number;
  stale: boolean;
  tags: { label: string; strong: boolean }[];
}

interface Response {
  radiusKm: number | null;
  hospitals: Hospital[];
  nearestGeneralHospital: { id: string; name: string; phone: string; distanceKm: number } | null;
}

export function Emergency() {
  const navigate = useNavigate();
  const { location, status, locate } = useUserLocation();
  const [situation, setSituation] = useState<string | null>(null);
  const [radius, setRadius] = useState<number | undefined>();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const recent = recentFacilities();

  useEffect(() => {
    // A stale or missing position is re-checked: in an emergency the phone's GPS is best.
    if (!location || location.source === 'gps' || Date.now() - location.at > 10 * 60_000) locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(() => {
    if (!location) return;
    const sp = new URLSearchParams({ lat: String(location.lat), lng: String(location.lng) });
    if (situation) sp.set('situation', situation);
    if (radius) sp.set('radiusKm', String(radius));
    api<Response>(`/search/emergency?${sp}`)
      .then((r) => {
        setData(r);
        setError(null);
        rememberFacilities(r.hospitals.slice(0, 5).map((h) => ({ id: h.id, name: h.name, phone: h.emergencyPhone, distanceKm: h.distanceKm })));
      })
      .catch((e) => setError(errorText(e)));
  }, [location, situation, radius]);
  useEffect(() => load(), [load]);
  useSocketEvent('availability', () => load(), [load]);

  const sitWords = SITUATIONS.find((s) => s[0] === situation)?.[2];
  const nextRadius = data?.radiusKm === 5 ? 10 : data?.radiusKm === 10 ? 20 : null;

  return (
    <>
      <div className="sos-head">
        <div className="container narrow stack" style={{ gap: '0.6rem' }}>
          <div className="row" style={{ gap: '0.9rem' }}>
            <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back"><BackIcon /></button>
            <h1>Emergency</h1>
          </div>
          <div className="spread small">
            <span className="row" style={{ gap: 6 }}>
              <PinIcon width={16} />
              {status === 'locating' ? 'Finding your location…' : location ? (
                <span>Near <strong>{location.label.replace(', Lagos', '').replace(', Ibadan', '')}</strong>{location.source === 'gps' ? ' · from your phone’s location' : ''}</span>
              ) : 'Location not set'}
            </span>
            <button className="btn link" style={{ color: '#fff' }} onClick={() => setChanging((c) => !c)}>{changing ? 'Done' : 'Change'}</button>
          </div>
        </div>
      </div>

      <main className="page">
        <div className="container narrow stack-lg">
          {changing && <LocationPicker />}

          <div className="call-first stack">
            <strong className="danger-text">If someone’s life is in danger, call first</strong>
            <a className="btn danger big block" href="tel:112"><PhoneIcon /> Call 112</a>
            <span className="muted small">Free national emergency number. Say where you are and what happened.</span>
          </div>

          <section>
            <h2>What is happening?</h2>
            <p className="muted small">Optional. It helps us show hospitals with the right doctors and equipment.</p>
            <div className="situations">
              {SITUATIONS.map(([key, label]) => (
                <button key={key} className={`situation ${situation === key ? 'on' : ''}`} aria-pressed={situation === key} onClick={() => setSituation(situation === key ? null : key)}>
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="stack">
            <div>
              <h2>Nearest hospitals{sitWords ? ` for ${sitWords}` : ''}</h2>
              <p className="muted small">
                Emergency unit listed{situation && situation !== 'other' ? ' and the right doctor where available' : ''} · within {data?.radiusKm ?? 5} km · nearest first
              </p>
            </div>
            {!location && status !== 'locating' && <div className="alert warn">Set your location to see nearby hospitals.</div>}
            <ErrorBox error={error} />
            {!data && location && <Spinner label="Finding hospitals" />}
            {data && data.hospitals.length > 0 && (
              <button className="btn outline block" onClick={() => setShowMap((s) => !s)}><MapIcon /> {showMap ? 'Hide map' : 'See these hospitals on a map'}</button>
            )}
            {showMap && data && location && (
              <div className="map small">
                <MapContainer center={location} zoom={13} style={{ height: '100%' }}>
                  <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <CircleMarker center={location} radius={8} pathOptions={{ color: '#2557a7', fillOpacity: 0.9 }}><Popup>You</Popup></CircleMarker>
                  {data.hospitals.map((h, i) => (
                    <CircleMarker key={h.id} center={h} radius={11} pathOptions={{ color: '#c42b2b', fillOpacity: 0.9 }}>
                      <Popup><strong>{i + 1}. {h.name}</strong><br />{h.distanceKm} km · <a href={telUrl(h.emergencyPhone)}>Call</a></Popup>
                    </CircleMarker>
                  ))}
                </MapContainer>
              </div>
            )}
            {data?.hospitals.map((h, i) => (
              <article key={h.id} className="card result">
                <div className="head">
                  <div className="title">
                    <span className="num red">{i + 1}</span>
                    <div>
                      <h3><Link to={`/facility/${h.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{h.name}</Link></h3>
                      <div className={`small ${h.stale ? 'warn-text' : 'muted'}`}>
                        {h.area} · {updatedLabel(h.minutesAgo)}{h.stale ? ', call to confirm' : ''} · Verified
                      </div>
                    </div>
                  </div>
                  <div className="distance">
                    <div className="km">{h.distanceKm} km</div>
                    <div className="eta">about {h.etaMinutes} min</div>
                  </div>
                </div>
                <div className="chips">
                  {h.tags.map((t) => <span key={t.label} className={`tag ${t.strong ? 'strong' : ''}`}>{t.label}</span>)}
                </div>
                <div>Emergency line: <Phone value={h.emergencyPhone} /></div>
                <div className="grid2" style={{ gap: '0.6rem' }}>
                  <a className="btn danger" href={telUrl(h.emergencyPhone)}>Call hospital</a>
                  <a className="btn" href={directionsUrl(h, location)} target="_blank" rel="noreferrer">Directions</a>
                </div>
              </article>
            ))}
            {data && data.hospitals.length === 0 && (
              <div className="card danger stack" role="alert">
                <strong>No hospital with an emergency unit within 20 km has updated its listing.</strong>
                <a className="btn danger" href="tel:112"><PhoneIcon /> Call 112</a>
                {data.nearestGeneralHospital && (
                  <div className="spread">
                    <span>Nearest general hospital: <strong>{data.nearestGeneralHospital.name}</strong> · {data.nearestGeneralHospital.distanceKm} km</span>
                    <a className="btn small" href={telUrl(data.nearestGeneralHospital.phone)}>Call</a>
                  </div>
                )}
              </div>
            )}
            {nextRadius && data && data.hospitals.length > 0 && (
              <button className="btn link center" style={{ alignSelf: 'center' }} onClick={() => setRadius(nextRadius)}>Show hospitals further away</button>
            )}
          </section>

          <section>
            <h2>Need something specific?</h2>
            <p className="muted small">Tap what you need. We show only places that have it now.</p>
            <div className="need-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {NEED_TILES.map((n) => (
                <Link key={n.label} to={n.to} className="need" style={{ alignItems: 'flex-start', textAlign: 'left' }}>
                  <NeedIcon name={n.icon} style={{ color: 'var(--danger)' }} />
                  <span>{n.label}</span>
                  <span className="tiny muted" style={{ fontWeight: 400 }}>{n.hint}</span>
                </Link>
              ))}
            </div>
          </section>

          {recent.length > 0 && (
            <section className="card stack">
              <h3>Places you viewed recently</h3>
              <p className="tiny muted">Saved on this phone so you can still call them if the network is slow.</p>
              {recent.map((f) => (
                <div key={f.id} className="spread">
                  <span>{f.name}</span>
                  <a className="btn small" href={telUrl(f.phone)}><PhoneIcon width={16} /> Call</a>
                </div>
              ))}
            </section>
          )}
          <p className="tiny muted center">No account needed.</p>
        </div>
      </main>
    </>
  );
}
