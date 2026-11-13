import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import { Link } from 'react-router-dom';
import { directionsUrl, naira, telUrl, updatedLabel } from '../lib/format';
import type { UserLocation } from '../lib/location';
import { Phone } from './common';
import { RouteIcon, XIcon } from './Icons';

export interface ResultItem {
  id: string;
  label: string;
  available: number;
  price: number | null;
  drugId?: string;
  resourceId?: string;
  detail?: string;
  needsPrescription?: boolean;
  refrigerated?: boolean;
}

export interface SearchResult {
  facility: { id: string; name: string; type: string; address: string; area: string | null; landmark: string | null; phone: string; lat: number; lng: number; reliability: number };
  distanceKm: number;
  etaMinutes: number;
  available: number;
  price: number | null;
  items: ResultItem[];
  openNow: boolean;
  hours: string;
  lastUpdated: string;
  minutesAgo: number;
  stale: boolean;
}

export type TargetKind = 'drug' | 'resource' | 'specialist' | 'facility';

function stockLabel(kind: TargetKind, spec: string, it: ResultItem) {
  if (kind === 'specialist') return it.detail ?? 'On duty';
  if (kind === 'facility') return '';
  if (spec.startsWith('resource:bed')) return `${it.available} ${it.available === 1 ? 'bed' : 'beds'} free`;
  if (spec.startsWith('resource:blood')) return `${it.available} units`;
  if (spec.startsWith('resource:oxygen')) return `${it.available} ${it.available === 1 ? 'cylinder' : 'cylinders'}`;
  if (spec.startsWith('resource:equipment')) return `${it.available} working and free`;
  return it.available <= 3 ? `Only ${it.available} left` : `${it.available} in stock`;
}

const itemLabel = (spec: string, it: ResultItem) => (spec.startsWith('resource:blood') ? `Blood ${it.label}` : it.label);

/** One result card (design page 6). The first result is outlined; closed places can be reserved for tomorrow. */
export function ResultCard({ r, index, kind, spec, origin }: { r: SearchResult; index: number; kind: TargetKind; spec: string; origin: UserLocation | null }) {
  const isBed = spec.startsWith('resource:bed');
  const bedType = isBed ? (spec.split(':')[2] ?? r.items[0]?.label) : null;
  const top = r.items[0];
  return (
    <article className={`card result ${index === 0 ? 'first' : ''}`}>
      <div className="head">
        <div className="title">
          <span className={`num ${r.openNow ? '' : 'grey'}`}>{index + 1}</span>
          <div>
            <h3>{r.facility.name}</h3>
            <div className="meta">
              <span>{r.facility.area ?? r.facility.type}</span>
              <span className={r.openNow ? 'ok-text' : 'danger-text'}>{r.hours}</span>
              <span className={r.stale ? 'warn-text' : ''}>{updatedLabel(r.minutesAgo)}{r.stale ? ', call to confirm' : ''}</span>
              <span className="ok-text">Verified</span>
            </div>
          </div>
        </div>
        <div className="distance">
          <div className="km">{r.distanceKm} km</div>
          <div className="eta">about {r.etaMinutes} min drive</div>
        </div>
      </div>
      {kind !== 'facility' && (
        <div className="stack" style={{ gap: '0.4rem' }}>
          {r.items.slice(0, 3).map((it) => (
            <div key={it.id} className="item-line">
              <strong>{itemLabel(spec, it)}</strong>
              {it.price !== null && <span className="price">{naira(it.price)}</span>}
              <span className={it.available <= 3 && kind === 'drug' ? 'warn-text small' : 'ok-text small'}>{stockLabel(kind, spec, it)}</span>
              {it.needsPrescription && <span className="badge grey">Prescription</span>}
            </div>
          ))}
        </div>
      )}
      <div className="foot">
        <span className="call">Call to confirm: <Phone value={r.facility.phone} /></span>
        <div className="actions">
          <a className="btn hide-desktop" href={telUrl(r.facility.phone)}>Call</a>
          <a className="btn" href={directionsUrl(r.facility, origin)} target="_blank" rel="noreferrer">Directions</a>
          <Link className="btn" to={`/facility/${r.facility.id}${kind === 'drug' && top?.drugId ? `?drug=${top.drugId}` : ''}`}>
            View {r.facility.type === 'pharmacy' ? 'pharmacy' : 'hospital'}
          </Link>
          {kind === 'drug' && top?.drugId && (
            <Link className="btn primary primary-action" to={`/reserve?facility=${r.facility.id}&drug=${top.drugId}`}>
              {r.openNow ? 'Reserve and pay' : 'Reserve for tomorrow'}
            </Link>
          )}
          {isBed && (
            <Link className="btn primary primary-action" to={`/bed-request?type=${encodeURIComponent(bedType ?? '')}`}>Request a bed</Link>
          )}
          {!isBed && kind !== 'drug' && (
            <a className="btn primary primary-action hide-mobile" href={telUrl(r.facility.phone)}>Call</a>
          )}
        </div>
      </div>
    </article>
  );
}

function pinIcon(n: number, open: boolean, selected: boolean) {
  const color = open ? '#0f7b63' : '#7f9a97';
  const size = selected ? 38 : 30;
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    html: `<div class="pin" style="background:${color};width:${size}px;height:${size}px"><span>${n}</span></div>`,
  });
}

function FitTo({ origin, radiusKm }: { origin: UserLocation; radiusKm: number }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(L.latLng(origin.lat, origin.lng).toBounds(radiusKm * 2000), { padding: [20, 20] });
  }, [map, origin.lat, origin.lng, radiusKm]);
  return null;
}

/** Map view (design page 8) with the search radius, numbered pins and a detail popup. */
export function ResultsMap({
  results,
  origin,
  radiusKm,
  selected,
  onSelect,
  kind,
  spec,
}: {
  results: SearchResult[];
  origin: UserLocation;
  radiusKm: number;
  selected: number | null;
  onSelect: (i: number | null) => void;
  kind: TargetKind;
  spec: string;
}) {
  const sel = selected !== null ? results[selected] : null;
  const top = sel?.items[0];
  const icons = useMemo(() => results.map((r, i) => pinIcon(i + 1, r.openNow, i === selected)), [results, selected]);
  return (
    <div className="map tall">
      <MapContainer center={origin} zoom={13} style={{ height: '100%' }} zoomControl>
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitTo origin={origin} radiusKm={radiusKm} />
        <Circle center={origin} radius={radiusKm * 1000} pathOptions={{ color: '#0f7b63', weight: 2, dashArray: '8 8', fillOpacity: 0.05 }} />
        <CircleMarker center={origin} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#2557a7', fillOpacity: 1 }} />
        {results.map((r, i) => (
          <Marker key={r.facility.id} position={r.facility} icon={icons[i]} eventHandlers={{ click: () => onSelect(i) }} />
        ))}
      </MapContainer>
      <div className="legend">
        <span><i style={{ background: '#2557a7' }} />You</span>
        <span><i style={{ background: '#0f7b63' }} />Open now</span>
        <span><i style={{ background: '#7f9a97' }} />Closed</span>
      </div>
      {sel && (
        <div className="map-popup stack" role="dialog" aria-label={sel.facility.name}>
          <div className="spread-top">
            <div>
              <h3 style={{ margin: 0 }}>{selected! + 1} · {sel.facility.name}</h3>
              <div className="small muted">
                {sel.facility.address.split(',')[0]} · <span className={sel.openNow ? 'ok-text' : 'danger-text'}>{sel.hours}</span>
              </div>
            </div>
            <button className="btn small" onClick={() => onSelect(null)} aria-label="Close"><XIcon /></button>
          </div>
          <div className="stat-boxes">
            <div className="stat-box"><div className="v">{sel.distanceKm} km</div><div className="tiny muted">distance</div></div>
            <div className="stat-box"><div className="v">{sel.etaMinutes} min</div><div className="tiny muted">by car</div></div>
            <div className="stat-box"><div className="v">{Math.max(1, Math.round(sel.distanceKm * 13))} min</div><div className="tiny muted">walking</div></div>
          </div>
          {top && kind !== 'facility' && (
            <div className="small">
              {itemLabel(spec, top)}
              {top.price !== null && <> · <span className="mono">{naira(top.price)}</span></>} · <span className="ok-text">{stockLabel(kind, spec, top)}</span>
            </div>
          )}
          <a className="btn primary block" href={directionsUrl(sel.facility, origin)} target="_blank" rel="noreferrer"><RouteIcon /> Start directions in Google Maps</a>
          <div className="grid2" style={{ gap: '0.5rem' }}>
            <a className="btn" href={telUrl(sel.facility.phone)}>Call</a>
            <Link className="btn" to={`/facility/${sel.facility.id}${top?.drugId ? `?drug=${top.drugId}` : ''}`}>View {sel.facility.type}</Link>
          </div>
        </div>
      )}
    </div>
  );
}
