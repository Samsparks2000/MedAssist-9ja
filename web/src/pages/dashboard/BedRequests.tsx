import { useCallback, useEffect, useState } from 'react';
import { Empty, ErrorBox, Spinner, StatusBadge } from '../../components/common';
import { api, errorText } from '../../lib/api';
import { dateTime, telUrl } from '../../lib/format';
import { useSocketEvent } from '../../lib/socket';

interface Incoming {
  id: string;
  patient_name: string;
  contact_phone: string;
  sub_type: string;
  notes: string | null;
  status: string;
  respond_by: string | null;
  created_at: string;
}

/** Hospital inbox for bed requests; unanswered requests move on after the timeout (US-29). */
export function BedRequestsInbox() {
  const [items, setItems] = useState<Incoming[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => api<Incoming[]>('/bed-requests/incoming').then(setItems), []);
  useEffect(() => {
    load();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [load]);
  useSocketEvent('bed-request', () => load(), [load]);
  useSocketEvent('notification', () => load(), [load]);

  const act = async (id: string, action: 'accept' | 'decline') => {
    try {
      await api(`/bed-requests/${id}/${action}`, { method: 'POST' });
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
    load();
  };

  if (!items) return <Spinner />;
  return (
    <div className="stack">
      <ErrorBox error={error} />
      {items.length === 0 && <Empty>No bed requests right now. Keep your bed counts current so nearby requests reach you.</Empty>}
      {items.map((r) => {
        const secs = r.respond_by ? Math.max(0, Math.round((new Date(r.respond_by).getTime() - now) / 1000)) : 0;
        return (
          <div key={r.id} className="card stack" style={r.status === 'pending' ? { borderColor: 'var(--danger)', borderWidth: 2 } : {}}>
            <div className="spread">
              <strong>{r.sub_type} bed · {r.patient_name}</strong>
              <StatusBadge status={r.status} />
            </div>
            {r.notes && <p className="small">{r.notes}</p>}
            <div className="small muted">
              Received {dateTime(r.created_at)} · <a href={telUrl(r.contact_phone)}>{r.contact_phone}</a>
            </div>
            {r.status === 'pending' && (
              <>
                <div className="small"><strong>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</strong> left before it goes to the next hospital</div>
                <div className="grid2">
                  <button className="btn primary" onClick={() => act(r.id, 'accept')}>Accept — hold a bed</button>
                  <button className="btn" onClick={() => act(r.id, 'decline')}>No bed — pass on now</button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
