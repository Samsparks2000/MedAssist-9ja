import { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUserLocation } from '../lib/location';
import { PinIcon } from './Icons';

interface Place {
  label: string;
  lat: number;
  lng: number;
}

const LAGOS = { lat: 6.5244, lng: 3.3792 };

function ClickToSet({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** GPS first (US-12), typed address or landmark as fallback (US-13), and a map pin for correction. */
export function LocationPicker({ compact = false }: { compact?: boolean }) {
  const { location, status, locate, setLocation } = useUserLocation();
  const { me } = useAuth();
  const [editing, setEditing] = useState(!location && !compact);
  const [text, setText] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    if (text.trim().length < 2) return setPlaces([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<Place[]>(`/geo/autocomplete?q=${encodeURIComponent(text)}`, { signal: ctrl.signal }).then(setPlaces).catch(() => {});
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [text]);

  if (!editing) {
    return (
      <div className="spread card" style={{ padding: '0.6rem 0.9rem' }}>
        <div className="row">
          <PinIcon width={20} height={20} aria-hidden="true" />
          <span>
            {status === 'locating' ? 'Finding your location…' : location ? <strong>{location.label}</strong> : 'No location set'}
          </span>
        </div>
        <button className="btn small ghost" onClick={() => setEditing(true)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="card stack">
      <div className="spread">
        <strong>Where are you?</strong>
        {location && (
          <button className="btn small ghost" onClick={() => setEditing(false)}>
            Done
          </button>
        )}
      </div>
      <button
        className="btn primary block"
        disabled={status === 'locating'}
        onClick={async () => {
          if (await locate()) setEditing(false);
        }}
      >
        <PinIcon width={20} height={20} aria-hidden="true" /> {status === 'locating' ? 'Locating…' : 'Use my current location'}
      </button>
      {status === 'denied' && <div className="alert warn small">Location permission was blocked. Type your area or landmark instead.</div>}
      {status === 'unavailable' && <div className="alert warn small">We could not get a GPS fix. Type your area or landmark instead.</div>}

      <div style={{ position: 'relative' }}>
        <label htmlFor="addr">Or type an address or landmark</label>
        <input id="addr" placeholder="e.g. Yaba, Allen Avenue, LUTH" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        {places.length > 0 && (
          <div className="suggestions">
            {places.map((p) => (
              <button
                type="button"
                key={p.label}
                onClick={() => {
                  setLocation({ lat: p.lat, lng: p.lng, label: p.label, source: 'address' });
                  setText('');
                  setEditing(false);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {me?.locations.length ? (
        <div className="chips">
          {me.locations.map((l) => (
            <button key={l.id} className="chip" onClick={() => { setLocation({ lat: l.lat, lng: l.lng, label: l.label, source: 'address' }); setEditing(false); }}>
              {l.label}
            </button>
          ))}
        </div>
      ) : null}

      <button className="btn small ghost" onClick={() => setShowMap((s) => !s)}>
        {showMap ? 'Hide map' : 'Set my position on a map'}
      </button>
      {showMap && (
        <div className="map small">
          <MapContainer center={location ?? LAGOS} zoom={12} style={{ height: '100%' }}>
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <ClickToSet onPick={(lat, lng) => setLocation({ lat, lng, label: 'Pinned on map', source: 'map' })} />
            {location && <CircleMarker center={location} radius={9} pathOptions={{ color: '#2563eb', fillOpacity: 0.8 }} />}
          </MapContainer>
        </div>
      )}
    </div>
  );
}
