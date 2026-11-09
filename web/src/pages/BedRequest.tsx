import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ErrorBox, Field, Spinner, StatusBadge } from '../components/common';
import { PhoneIcon, RouteIcon } from '../components/Icons';
import { LocationPicker } from '../components/LocationPicker';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { directionsUrl, telUrl } from '../lib/format';
import { useUserLocation } from '../lib/location';
import { getSocket, useSocketEvent } from '../lib/socket';
import { load, save } from '../lib/storage';

const BED_TYPES = ['Emergency', 'ICU', 'General ward', 'Maternity', 'Paediatric'];
const TOKENS = 'ma9.bedTokens';

export function BedRequestForm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const { location } = useUserLocation();
  const [form, setForm] = useState({
    patientName: '',
    contactPhone: me?.user.phone ?? '',
    subType: BED_TYPES.includes(params.get('type') ?? '') ? params.get('type')! : 'Emergency',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location) return setError('Set your location first');
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string; accessToken: string }>('/bed-requests', {
        body: { ...form, notes: form.notes || undefined, lat: location.lat, lng: location.lng },
      });
      save(TOKENS, { ...load<Record<string, string>>(TOKENS, {}), [r.id]: r.accessToken });
      navigate(`/bed-requests/${r.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <h1>Request a hospital bed</h1>
      <p className="muted">We send this to the nearest verified hospital with a free bed of this type. If they do not answer within 3 minutes it moves to the next one.</p>
      <a className="btn call-112 block" href="tel:112"><PhoneIcon width={20} height={20} aria-hidden="true" /> Life-threatening? Call 112 now</a>
      <LocationPicker compact />
      <form className="card" onSubmit={submit}>
        <Field label="Bed type">
          <select value={form.subType} onChange={(e) => setForm({ ...form, subType: e.target.value })}>
            {BED_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Patient name">
          <input value={form.patientName} onChange={(e) => setForm({ ...form, patientName: e.target.value })} required />
        </Field>
        <Field label="Your phone number" hint="The hospital's answer is sent here by SMS.">
          <input type="tel" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} required />
        </Field>
        <Field label="What happened? (optional)">
          <textarea value={form.notes} maxLength={300} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <ErrorBox error={error} />
        <button className="btn danger block mt" disabled={busy || !location}>Send bed request</button>
      </form>
    </div>
  );
}

interface BedStatus {
  id: string;
  patient_name: string;
  sub_type: string;
  status: string;
  respond_by: string | null;
  forwards: number;
  facility_name: string | null;
  facility_phone: string | null;
  facility_address: string | null;
  facility_lat: number | null;
  facility_lng: number | null;
  order_id: string | null;
}

export function BedRequestStatus() {
  const { id } = useParams();
  const { location } = useUserLocation();
  const token = load<Record<string, string>>(TOKENS, {})[id!];
  const [r, setR] = useState<BedStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(
    () => api<BedStatus>(`/bed-requests/${id}${token ? `?token=${encodeURIComponent(token)}` : ''}`).then(setR).catch((e) => setError(errorText(e))),
    [id, token],
  );
  useEffect(() => {
    refresh();
    if (token) getSocket().emit('watch-bed-request', { id, token });
    const t = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(refresh, 20_000);
    return () => {
      clearInterval(t);
      clearInterval(poll);
    };
  }, [id, token, refresh]);
  useSocketEvent('bed-request', () => refresh(), [refresh]);

  if (error) return <ErrorBox error={error} />;
  if (!r) return <Spinner />;
  const secs = r.respond_by ? Math.max(0, Math.round((new Date(r.respond_by).getTime() - now) / 1000)) : 0;

  return (
    <div className="stack">
      <div className="spread">
        <h1>{r.sub_type} bed for {r.patient_name}</h1>
        <StatusBadge status={r.status} />
      </div>
      {r.status === 'pending' && (
        <div className="card stack">
          <div className="row"><div className="spinner" /> Waiting for <strong>{r.facility_name}</strong> to confirm…</div>
          <div className="small muted">Moves to the next nearest hospital in {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}{r.forwards ? ` · tried ${r.forwards} hospital${r.forwards > 1 ? 's' : ''} already` : ''}</div>
          {r.facility_phone && <a className="btn" href={telUrl(r.facility_phone)}><PhoneIcon width={18} height={18} aria-hidden="true" /> Call {r.facility_name}</a>}
        </div>
      )}
      {r.status === 'accepted' && (
        <div className="card stack">
          <div className="alert ok"><strong>{r.facility_name}</strong> has a bed ready. Go now.</div>
          <div className="muted">{r.facility_address}</div>
          <div className="grid2">
            <a className="btn primary" href={telUrl(r.facility_phone!)}><PhoneIcon width={18} height={18} aria-hidden="true" /> Call</a>
            <a className="btn" href={directionsUrl({ lat: r.facility_lat!, lng: r.facility_lng! }, location)} target="_blank" rel="noreferrer"><RouteIcon width={18} height={18} aria-hidden="true" /> Directions</a>
          </div>
          {r.order_id && <Link className="btn" to={`/orders/${r.order_id}`}>Pay the bed deposit</Link>}
        </div>
      )}
      {r.status === 'unmatched' && (
        <div className="card stack" role="alert">
          <p>No hospital nearby has confirmed a free {r.sub_type} bed.</p>
          <a className="btn danger block" href="tel:112"><PhoneIcon width={20} height={20} aria-hidden="true" /> Call 112</a>
          <Link className="btn" to={`/search?target=${encodeURIComponent('resource:bed')}&emergency=1`}>See any hospital with beds</Link>
        </div>
      )}
      {(r.status === 'pending' || r.status === 'accepted') && (
        <button
          className="btn ghost"
          onClick={() => confirm('Cancel this bed request?') && api(`/bed-requests/${id}/cancel${token ? `?token=${encodeURIComponent(token)}` : ''}`, { method: 'POST' }).then(refresh)}
        >
          Cancel request
        </button>
      )}
    </div>
  );
}
