import { useCallback, useEffect, useState } from 'react';
import { Empty, ErrorBox, Spinner, StatusBadge } from '../../components/common';
import { api, errorText } from '../../lib/api';
import { dateTime, naira, time } from '../../lib/format';
import { useSocketEvent } from '../../lib/socket';

interface FacilityOrder {
  id: string;
  type: string;
  status: string;
  payment_mode: 'online' | 'at_pickup';
  total: number;
  expires_at: string;
  created_at: string;
  confirmed_at: string | null;
  cancel_reason: string | null;
  needs_prescription: boolean;
  pickup_code: string | null;
  needs_answer: boolean;
  customer_name: string;
  customer_phone: string;
  items: { description: string; quantity: number }[];
}

/** Active reservations with the actions from the design: Decline, Confirm and set aside, Enter code to hand over. */
export function ReservationList({ compact = false, status, onChange }: { compact?: boolean; status?: string; onChange?: () => void }) {
  const [orders, setOrders] = useState<FacilityOrder[] | null>(null);
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => api<FacilityOrder[]>(`/facility-orders?${status ? `status=${status}` : 'active=true'}`).then(setOrders),
    [status],
  );
  useEffect(() => {
    load();
  }, [load]);
  useSocketEvent('order', () => load(), [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      setError(null);
      setMsg(ok ?? null);
      await load();
      onChange?.();
    } catch (e) {
      setError(errorText(e));
      setMsg(null);
    }
  };

  if (!orders) return <Spinner />;
  const shown = compact ? orders.slice(0, 4) : orders;
  return (
    <div className="stack">
      {msg && <div className="alert ok">{msg}</div>}
      <ErrorBox error={error} />
      {shown.length === 0 && (compact ? <p className="muted small">No reservations waiting.</p> : <Empty>No reservations here.</Empty>)}
      {shown.map((o) => {
        const what = o.items?.map((i) => `${i.description.split(' ').slice(0, 2).join(' ')} × ${i.quantity}`).join(', ');
        const active = ['requested', 'pending_payment', 'paid', 'reserved'].includes(o.status);
        return (
          <div key={o.id} className={`req ${o.needs_answer ? 'attention' : ''}`}>
            <div style={{ minWidth: 0 }}>
              <div className="row">
                <strong>{what}</strong>
                {o.status === 'requested' && <span className="badge warn">New · pay at pickup</span>}
                {o.status === 'paid' && <span className="badge ok">Paid {naira(o.total)}</span>}
                {o.status === 'reserved' && <span className="badge info">Pay {naira(o.total)} at pickup</span>}
                {o.status === 'pending_payment' && <span className="badge grey">Awaiting payment</span>}
                {!active && <StatusBadge status={o.status} />}
              </div>
              <div className="small muted">
                {o.customer_name} · <span className="mono">{o.customer_phone}</span>
                {o.pickup_code && <> · code <span className="mono">{o.pickup_code}</span></>}
                {o.status === 'requested' ? ` · requested ${time(o.created_at)}` : active && o.status !== 'pending_payment' ? ` · collect by ${time(o.expires_at)}` : ` · ${dateTime(o.created_at)}`}
                {o.needs_prescription ? ' · needs prescription' : ''}
                {o.cancel_reason && !active ? ` · ${o.cancel_reason}` : ''}
              </div>
            </div>
            {active && (
              <div className="row">
                {o.needs_answer ? (
                  <>
                    <button className="btn small" onClick={() => { const r = prompt('Why are you declining? The customer sees this and is refunded if they paid.', 'Out of stock'); if (r) act(() => api(`/facility-orders/${o.id}/cancel`, { body: { reason: r } }), 'Declined.'); }}>Decline</button>
                    <button className="btn small primary" onClick={() => act(() => api(`/facility-orders/${o.id}/confirm`, { method: 'POST' }), 'Confirmed. The customer has been sent their pickup code.')}>Confirm and set aside</button>
                  </>
                ) : codeFor === o.id ? (
                  <form className="row" onSubmit={(e) => { e.preventDefault(); act(() => api('/facility-orders/collect', { body: { code } }), `Handed over${o.payment_mode === 'at_pickup' ? ` — collect ${naira(o.total)} now` : ''}.`).then(() => { setCodeFor(null); setCode(''); }); }}>
                    <input className="mono" style={{ width: 130, minHeight: 38 }} placeholder="MA-0000" value={code} onChange={(e) => setCode(e.target.value)} autoFocus aria-label="Pickup code" />
                    <button className="btn small primary" disabled={code.replace(/\D/g, '').length < 4}>Verify</button>
                    <button type="button" className="btn small ghost" onClick={() => setCodeFor(null)}>Cancel</button>
                  </form>
                ) : (
                  o.status !== 'pending_payment' && <button className="btn small outline" onClick={() => { setCodeFor(o.id); setCode(''); }}>Enter code to hand over</button>
                )}
                {!compact && !o.needs_answer && o.status !== 'pending_payment' && codeFor !== o.id && (
                  <button className="btn small ghost" onClick={() => { const r = prompt('Why can this not be fulfilled? Paid customers are refunded automatically.'); if (r) act(() => api(`/facility-orders/${o.id}/cancel`, { body: { reason: r } }), 'Cancelled.'); }}>Cannot fulfil</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Reservations({ onChange }: { onChange?: () => void }) {
  const [tab, setTab] = useState<string | undefined>(undefined);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Reservations</h1>
          <div className="muted">Confirm pay-at-pickup requests within 30 minutes. Enter the customer’s code when you hand over.</div>
        </div>
      </div>
      <div className="tabs">
        {[[undefined, 'Active'], ['collected', 'Collected'], ['cancelled', 'Cancelled'], ['expired', 'Expired']].map(([v, l]) => (
          <button key={l} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{l}</button>
        ))}
      </div>
      <ReservationList status={tab} onChange={onChange} />
    </div>
  );
}
