import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AreaSelect } from '../components/AreaSelect';
import { ErrorBox, Phone, SampleNote, Spinner } from '../components/common';
import { MapIcon, PhoneIcon } from '../components/Icons';
import { Page } from '../components/Layout';
import { ResultCard, ResultsMap, type SearchResult, type TargetKind } from '../components/Results';
import { SearchBox } from '../components/SearchBox';
import { api, errorText } from '../lib/api';
import { naira, telUrl } from '../lib/format';
import { useUserLocation } from '../lib/location';
import { useSocketEvent } from '../lib/socket';
import { rememberFacilities } from '../lib/symptoms';

interface Response {
  target: { spec: string; label: string; kind: TargetKind } | null;
  alternatives: { spec: string; label: string }[];
  results: SearchResult[];
  radiusKm: number | null;
  expanded: boolean;
  unmatched?: boolean;
  fallback: null | {
    emergencyNumber: string;
    nearestGeneralHospital: { id: string; name: string; address: string; phone: string; distanceKm: number } | null;
  };
}

const PASSTHROUGH = ['maxPrice', 'openNow', 'facilityType', 'radiusKm', 'maxAgeHours', 'sort'] as const;

const nounFor = (r: Response) => {
  const kind = r.target?.kind;
  if (kind === 'drug') return ['pharmacy', 'pharmacies'];
  if (kind === 'specialist' || r.target?.spec.startsWith('resource')) return ['hospital', 'hospitals'];
  return ['place', 'places'];
};

export function Search() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { location, status, locate } = useUserLocation();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const lastFetch = useRef(0);

  const q = params.get('q') ?? '';
  const target = params.get('target') ?? '';
  const view = params.get('view') === 'map' ? 'map' : 'list';

  useEffect(() => {
    if (!location && status === 'idle') locate();
  }, [location, status, locate]);

  const run = useCallback(
    async (quiet = false) => {
      if (!location || (!q && !target)) return;
      const sp = new URLSearchParams({ lat: String(location.lat), lng: String(location.lng) });
      if (target) sp.set('target', target);
      else sp.set('q', q);
      for (const f of PASSTHROUGH) {
        const v = params.get(f);
        if (v) sp.set(f, v);
      }
      if (!quiet) setLoading(true);
      lastFetch.current = Date.now();
      try {
        const res = await api<Response>(`/search?${sp}`);
        setData(res);
        setError(null);
        rememberFacilities(res.results.slice(0, 5).map((r) => ({ id: r.facility.id, name: r.facility.name, phone: r.facility.phone, distanceKm: r.distanceKm })));
      } catch (e) {
        setError(errorText(e));
      } finally {
        setLoading(false);
      }
    },
    [location, q, target, params],
  );

  useEffect(() => {
    run();
  }, [run]);

  // FR-06: refresh quietly when any facility publishes a change (debounced).
  const pending = useRef<number>(undefined);
  useSocketEvent('availability', () => {
    window.clearTimeout(pending.current);
    const wait = Math.max(0, 1500 - (Date.now() - lastFetch.current));
    pending.current = window.setTimeout(() => run(true), wait);
  }, [run]);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null || v === '') next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
    setSelected(null);
  };
  const toggle = (k: string, v: string) => setParam(k, params.get(k) === v ? null : v);

  // "Under ₦15,000": a round threshold just above the cheapest result.
  const prices = data?.results.map((r) => r.price).filter((p): p is number => p !== null) ?? [];
  const priceCap = params.get('maxPrice') ?? (prices.length > 1 ? String(Math.ceil(Math.min(...prices) / 1000) * 1000 + 1000) : null);
  const where = location?.label.replace(/, (Lagos|Ibadan)$/, '') ?? 'you';
  const radius = data?.radiusKm ?? Number(params.get('radiusKm') ?? 5);
  const nextRadius = radius < 10 ? 10 : radius < 20 ? 20 : null;
  const [one, many] = data ? nounFor(data) : ['place', 'places'];
  const title = data?.target ? `${data.target.label} near ${where}` : q ? `“${q}” near ${where}` : 'Search';

  if (!q && !target) {
    return (
      <Page narrow>
        <div className="stack-lg">
          <h1>What do you need?</h1>
          <div className="search-card stack">
            <SearchBox onSearch={(p) => navigate(`/search?${new URLSearchParams(p as Record<string, string>)}`)} id="search-page-q" />
            <AreaSelect className="filled" />
            {params.get('focus') && <p className="small muted">Type a drug name — brand or generic. Spelling mistakes are fine.</p>}
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <div className="stack-lg">
        {params.get('emergency') && (
          <a className="btn danger block" href="tel:112"><PhoneIcon /> Life-threatening? Call 112 now</a>
        )}
        <div className="hide-desktop stack">
          <SearchBox initial={q || data?.target?.label || ''} onSearch={(p) => navigate(`/search?${new URLSearchParams(p as Record<string, string>)}`)} id="mobile-q" />
          <AreaSelect className="filled" />
        </div>

        <div className="spread-top" style={{ flexWrap: 'wrap' }}>
          <div>
            <h1>{title}</h1>
            {data && !data.unmatched && data.results.length > 0 && (
              <p className="muted" style={{ margin: 0 }}>
                {data.results.length} {data.results.length === 1 ? one : many} {data.target?.kind === 'drug' ? 'list it' : 'have it'} within {data.radiusKm} km · {params.get('sort') && params.get('sort') !== 'nearest' ? 'sorted by your choice' : 'nearest first'}
                {data.target?.kind === 'drug' ? ' · prices set by each pharmacy' : ''}
                {data.expanded && <span className="badge warn" style={{ marginLeft: 8 }}>Search widened</span>}
                <span className="live" style={{ marginLeft: 10 }}>Live</span>
              </p>
            )}
          </div>
          <label className="row" style={{ gap: '0.5rem', fontWeight: 500, margin: 0 }}>
            <span className="small muted">Sort by</span>
            <select style={{ width: 'auto', minHeight: 42 }} value={params.get('sort') ?? 'best'} onChange={(e) => setParam('sort', e.target.value === 'best' ? null : e.target.value)}>
              <option value="best">Nearest (best match)</option>
              <option value="nearest">Distance only</option>
              <option value="price">Lowest price</option>
              <option value="updated">Recently updated</option>
            </select>
          </label>
        </div>

        <div className="spread">
          <div className="chips" aria-label="Filters">
            <span className="small muted">Filter:</span>
            <button className={`chip ${params.get('radiusKm') === '5' || !params.get('radiusKm') ? 'on' : ''}`} onClick={() => setParam('radiusKm', params.get('radiusKm') && params.get('radiusKm') !== '5' ? '5' : null)}>
              Within {params.get('radiusKm') ?? 5} km
            </button>
            <button className={`chip ${params.get('openNow') ? 'on' : ''}`} aria-pressed={!!params.get('openNow')} onClick={() => toggle('openNow', 'true')}>Open now</button>
            <button className={`chip ${params.get('facilityType') === 'pharmacy' ? 'on' : ''}`} onClick={() => toggle('facilityType', 'pharmacy')}>Pharmacies</button>
            <button className={`chip ${params.get('facilityType') === 'hospital' ? 'on' : ''}`} onClick={() => toggle('facilityType', 'hospital')}>Hospitals</button>
            {priceCap && data?.target?.kind === 'drug' && (
              <button className={`chip ${params.get('maxPrice') ? 'on' : ''}`} onClick={() => toggle('maxPrice', priceCap)}>Under {naira(Number(priceCap))}</button>
            )}
            <button className={`chip ${params.get('maxAgeHours') ? 'on' : ''}`} onClick={() => toggle('maxAgeHours', '168')}>Updated this week</button>
          </div>
          <div className="toggle" role="group" aria-label="View">
            <button className={view === 'list' ? 'on' : ''} onClick={() => setParam('view', null)}>List</button>
            <button className={view === 'map' ? 'on' : ''} onClick={() => setParam('view', 'map')}><MapIcon width={16} /> Map</button>
          </div>
        </div>

        {!location && status !== 'locating' && <div className="alert warn">Choose your area or use your location to see nearby results.</div>}
        {loading && <Spinner label="Finding the nearest available" />}
        <ErrorBox error={error} />

        {data && !loading && (
          <>
            {data.unmatched && (
              <div className="card stack">
                <p>We could not match “{q}”. Try a brand or generic name, or one of these:</p>
                <div className="chips">
                  {data.alternatives.map((a) => <button key={a.spec} className="chip" onClick={() => setParam('target', a.spec)}>{a.label}</button>)}
                </div>
              </div>
            )}

            {!data.unmatched && data.alternatives.length > 0 && (
              <div className="chips small" aria-label="Did you mean">
                <span className="muted">Also:</span>
                {data.alternatives.slice(0, 4).map((a) => <button key={a.spec} className="chip" onClick={() => setParam('target', a.spec)}>{a.label}</button>)}
              </div>
            )}

            {data.fallback && (
              <div className="card danger stack" role="alert">
                <h2>Nothing available within 20 km</h2>
                <p style={{ margin: 0 }}>If this is an emergency, call 112 now or go to the nearest general hospital.</p>
                <a className="btn danger" href="tel:112"><PhoneIcon /> Call 112</a>
                {data.fallback.nearestGeneralHospital && (
                  <div className="spread">
                    <div>
                      <strong>{data.fallback.nearestGeneralHospital.name}</strong>
                      <div className="small muted">{data.fallback.nearestGeneralHospital.address} · {data.fallback.nearestGeneralHospital.distanceKm} km · <Phone value={data.fallback.nearestGeneralHospital.phone} /></div>
                    </div>
                    <a className="btn" href={telUrl(data.fallback.nearestGeneralHospital.phone)}>Call</a>
                  </div>
                )}
                <Link to="/emergency" className="btn">Open the emergency screen</Link>
              </div>
            )}

            {data.target && data.results.length > 0 && location && view === 'map' && (
              <div className="map-layout">
                <div className="stack">
                  <div className="chips">
                    <span className="small muted">Search area</span>
                    {[5, 10, 20].map((r) => (
                      <button key={r} className={`chip ${radius === r ? 'on' : ''}`} onClick={() => setParam('radiusKm', r === 5 ? null : String(r))}>{r} km</button>
                    ))}
                    <span className="small muted">· tap a pin to see details</span>
                  </div>
                  <ResultsMap results={data.results} origin={location} radiusKm={radius} selected={selected} onSelect={setSelected} kind={data.target.kind} spec={data.target.spec} />
                </div>
                <div className="card stack" style={{ alignSelf: 'start' }}>
                  <h3>On this map</h3>
                  {data.results.map((r, i) => (
                    <button key={r.facility.id} className={`choice ${selected === i ? 'on' : ''}`} onClick={() => setSelected(i)} style={{ textAlign: 'left', font: 'inherit', width: '100%' }}>
                      <span className={`num ${r.openNow ? '' : 'grey'}`}>{i + 1}</span>
                      <span style={{ flex: 1 }}>
                        <strong>{r.facility.name}</strong>
                        <span className={`small ${!r.openNow ? 'danger-text' : r.stale ? 'warn-text' : 'muted'}`}>
                          {r.price !== null ? `${naira(r.price)} · ` : ''}{!r.openNow ? r.hours.toLowerCase() : r.stale ? 'call to confirm' : r.hours.replace('Open · ', 'open · ')}
                        </span>
                      </span>
                      <span className="mono small">{r.distanceKm} km</span>
                    </button>
                  ))}
                  {nextRadius && <button className="btn" onClick={() => setParam('radiusKm', String(nextRadius))}>Search up to {nextRadius} km</button>}
                </div>
              </div>
            )}

            {data.target && data.results.length > 0 && view === 'list' && (
              <div className="stack">
                {data.results.map((r, i) => (
                  <ResultCard key={r.facility.id} r={r} index={i} kind={data.target!.kind} spec={data.target!.spec} origin={location} />
                ))}
                {nextRadius && (
                  <div className="more-box">
                    <span className="muted">Need more options? We can search further out, to {nextRadius} km{nextRadius === 10 ? ' and then 20 km' : ''}.</span>
                    <button className="btn" onClick={() => setParam('radiusKm', String(nextRadius))}>Search up to {nextRadius} km</button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Page>
  );
}
