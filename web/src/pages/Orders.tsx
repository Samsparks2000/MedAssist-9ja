import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, Phone, SampleNote, Spinner, StatusBadge } from '../components/common';
import { CheckIcon } from '../components/Icons';
import { Page } from '../components/Layout';
import { api, errorText } from '../lib/api';
import { dateTime, directionsUrl, naira, telUrl, time, whenLabel } from '../lib/format';
import { useUserLocation } from '../lib/location';
import { useSocketEvent } from '../lib/socket';

interface Payment {
  reference: string;
  status: string;
  amount: number;
  method: string | null;
  gateway: string;
  paidAt: string | null;
  refundedAt: string | null;
  refundReference: string | null;
  refundDueAt: string | null;
}

interface Order {
  id: string;
  type: 'drug' | 'bed';
  status: string;
  payment_mode: 'online' | 'at_pickup';
  total: number;
  pickup_code: string | null;
  expires_at: string;
  created_at: string;
  confirmed_at: string | null;
  collected_at: string | null;
  cancel_reason: string | null;
  needs_prescription: boolean;
  facility_id: string;
  facility_name: string;
  facility_address: string;
  facility_landmark: string | null;
  facility_phone: string;
  facility_lat: number;
  facility_lng: number;
  customer_phone: string;
  distanceKm: number | null;
  items: { description: string; quantity: number; unitPrice: number; drugId: string | null }[];
  payments: Payment[] | null;
  rated: boolean;
}

const ACTIVE = ['requested', 'pending_payment', 'paid', 'reserved'];
const METHOD: Record<string, string> = { card: 'Card', bank_transfer: 'Bank transfer', ussd: 'USSD', counter: 'Cash or POS at the counter' };

export function Orders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<Order[]>('/orders').then(setOrders).catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
  }, []);
  useSocketEvent('order', () => load());

  if (error) return <Page narrow><ErrorBox error={error} /></Page>;
  if (!orders) return <Page narrow><Spinner /></Page>;
  const active = orders.filter((o) => ACTIVE.includes(o.status));
  const past = orders.filter((o) => !ACTIVE.includes(o.status));
  const Row = ({ o }: { o: Order }) => {
    const refund = o.payments?.find((p) => p.status === 'refund_pending' || p.status === 'refunded');
    return (
      <Link to={`/orders/${o.id}`} className="card spread" style={{ textDecoration: 'none', color: 'inherit' }}>
        <div>
          <strong>{o.items?.map((i) => `${i.description} × ${i.quantity}`).join(', ')}</strong>
          <div className="small muted">{o.facility_name} · {naira(o.total)} · {dateTime(o.created_at)}</div>
          {ACTIVE.includes(o.status) && o.status !== 'requested' && o.status !== 'pending_payment' && <div className="small">Collect by {whenLabel(o.expires_at)}</div>}
        </div>
        <div className="row">
          {o.pickup_code && ACTIVE.includes(o.status) && <span className="mono" style={{ color: 'var(--ink)' }}>{o.pickup_code}</span>}
          <StatusBadge status={o.status} />
          {refund && <StatusBadge status={refund.status} />}
        </div>
      </Link>
    );
  };
  return (
    <Page narrow>
      <div className="stack-lg">
        <h1>My orders</h1>
        {orders.length === 0 && <Empty>No reservations yet. <Link to="/">Search for a medicine</Link>.</Empty>}
        {active.length > 0 && <section className="stack"><h2>Active</h2>{active.map((o) => <Row key={o.id} o={o} />)}</section>}
        {past.length > 0 && <section className="stack"><h2>Past</h2>{past.map((o) => <Row key={o.id} o={o} />)}</section>}
      </div>
    </Page>
  );
}

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(until).getTime() - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return <span className="mono">{h ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, '0')}`}</span>;
}

/** Status timeline (design page 9), adapted to pay-now and pay-at-pickup orders. */
function Timeline({ o }: { o: Order }) {
  const paid = o.payments?.find((p) => p.status !== 'failed' && p.gateway !== 'counter');
  const ended = o.status === 'cancelled' || o.status === 'expired';
  const steps =
    o.payment_mode === 'online'
      ? [
          { label: 'Payment received', done: !!paid?.paidAt, sub: paid?.paidAt ? `${time(paid.paidAt)} · ${METHOD[paid.method ?? ''] ?? paid.method}` : 'Waiting for payment' },
          { label: 'Pharmacy confirmed and set it aside', done: !!o.confirmed_at, sub: o.confirmed_at ? time(o.confirmed_at) : 'Usually within a few minutes' },
          { label: 'Waiting for you to collect', done: !!o.collected_at, sub: `Before ${whenLabel(o.expires_at)}` },
          { label: 'Collected', done: !!o.collected_at, sub: o.collected_at ? time(o.collected_at) : '' },
        ]
      : [
          { label: 'Reservation sent', done: true, sub: time(o.created_at) },
          { label: 'Pharmacy confirmed and set it aside', done: !!o.confirmed_at, sub: o.confirmed_at ? time(o.confirmed_at) : `Waiting for an answer (until ${time(o.expires_at)})` },
          { label: 'Waiting for you to collect and pay', done: !!o.collected_at, sub: o.confirmed_at ? `Before ${whenLabel(o.expires_at)}` : '' },
          { label: 'Collected and paid', done: !!o.collected_at, sub: o.collected_at ? time(o.collected_at) : '' },
        ];
  const current = ended ? -1 : steps.findIndex((s) => !s.done);
  return (
    <ol className="timeline">
      {steps.map((s, i) => (
        <li key={s.label} className={s.done ? 'done' : i === current ? 'current' : ''}>
          <span className="dot">{s.done && <CheckIcon width={13} />}</span>
          <strong style={!s.done && i !== current ? { color: 'var(--muted)', fontWeight: 500 } : {}}>{s.label}</strong>
          {s.sub && (s.done || i === current) && <div className="small muted">{s.sub}</div>}
        </li>
      ))}
    </ol>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { location } = useUserLocation();
  const [o, setO] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [interval, setIntervalDays] = useState(28);
  const [refillSet, setRefillSet] = useState(false);

  const load = useCallback(() => {
    const q = location ? `?lat=${location.lat}&lng=${location.lng}` : '';
    return api<Order>(`/orders/${id}${q}`).then(setO).catch((e) => setError(errorText(e)));
  }, [id, location]);

  // Returning from checkout: confirm with the gateway in case the webhook is still on its way.
  useEffect(() => {
    const ref = params.get('reference');
    (ref ? api(`/payments/verify/${encodeURIComponent(ref)}`).catch(() => null) : Promise.resolve()).then(() => {
      if (ref) setParams({}, { replace: true });
      load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useSocketEvent<{ id: string }>('order', (e) => e.id === id && load(), [id, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!o) return <Page>{error ? <ErrorBox error={error} /> : <Spinner />}</Page>;
  const payment = o.payments?.find((p) => p.status !== 'failed');
  const active = ACTIVE.includes(o.status);
  const what = o.items?.[0]?.description ?? 'order';
  const shortWhat = what.split(' ')[0];
  const holdLabel = whenLabel(o.expires_at);

  const headline =
    o.status === 'requested' ? 'Waiting for the pharmacy to confirm'
    : o.status === 'pending_payment' ? 'Finish paying to hold it'
    : o.status === 'paid' || o.status === 'reserved' ? `Your ${shortWhat.toLowerCase()} is reserved`
    : o.status === 'collected' ? 'Collected — thank you'
    : o.status === 'expired' ? 'This reservation expired'
    : 'This reservation was cancelled';

  return (
    <Page>
      <div className="stack-lg">
        <div className="card">
          <div className="layout-side" style={{ alignItems: 'center' }}>
            <div className="stack" style={{ gap: '0.4rem' }}>
              {payment?.status === 'success' && payment.gateway !== 'counter' && (
                <div className="row ok-text"><span className="num" style={{ width: 24, height: 24 }}><CheckIcon width={13} /></span> Paid · {naira(payment.amount)}</div>
              )}
              {o.payment_mode === 'at_pickup' && active && <div className="row"><StatusBadge status={o.status} /> <span className="small muted">Pay {naira(o.total)} at the counter</span></div>}
              <h1 style={{ margin: 0 }}>{headline}</h1>
              <p style={{ margin: 0 }}>
                {o.status === 'requested' && <>We sent your request to <strong>{o.facility_name}</strong>. You will get an SMS with your pickup code when they confirm.</>}
                {o.status === 'pending_payment' && <>Complete payment within <Countdown until={o.expires_at} /> or the items go back on sale.</>}
                {(o.status === 'paid' || o.status === 'reserved') && (
                  <>{o.facility_name} {o.confirmed_at ? 'confirmed your order' : 'has your order'}. Collect it by <strong>{holdLabel}</strong>. We also sent this code to <span className="mono">{o.customer_phone.replace('+234', '0').replace(/^(\d{4})(\d{3})/, '$1 $2 ')}</span> by SMS.</>
                )}
                {o.cancel_reason && !active && o.status !== 'collected' && <>{o.cancel_reason}.</>}
              </p>
            </div>
            {o.pickup_code && active && (
              <div className="pickup-code">
                <div className="eyebrow" style={{ margin: 0 }}>Pickup code</div>
                <div className="code" aria-label={`Pickup code ${o.pickup_code.split('').join(' ')}`}>{o.pickup_code}</div>
                <div className="small">Show this at the counter</div>
              </div>
            )}
            {o.status === 'pending_payment' && (
              <button className="btn primary big" onClick={() => navigate(`/reserve?order=${o.id}`)}>Pay {naira(o.total)}</button>
            )}
          </div>
        </div>
        <ErrorBox error={error} />

        <div className="layout-side">
          <div className="stack-lg">
            <section className="card">
              <h2>Order status</h2>
              {o.status === 'cancelled' || o.status === 'expired' ? <p className="muted" style={{ margin: 0 }}>{o.cancel_reason ?? 'Ended'}.</p> : <Timeline o={o} />}
            </section>

            {o.status === 'collected' && !o.rated && (
              <section className="card stack">
                <h2 style={{ margin: 0 }}>How was {o.facility_name}?</h2>
                <div className="chips" role="radiogroup" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} className={`chip ${rating >= n ? 'on' : ''}`} role="radio" aria-checked={rating === n} onClick={() => setRating(n)}>★ {n}</button>
                  ))}
                </div>
                <textarea placeholder="Optional comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
                <button className="btn primary" style={{ alignSelf: 'start' }} disabled={!rating || busy} onClick={() => act(() => api('/feedback', { body: { type: 'rating', orderId: o.id, score: rating, comment: comment || undefined } }))}>Submit rating</button>
              </section>
            )}

            {o.type === 'drug' && (
              <section className="card spread">
                <div>
                  <h3 style={{ margin: 0 }}>Need this again next month?</h3>
                  <p className="muted small" style={{ margin: 0 }}>{refillSet ? 'Done — we will remind you by SMS before it runs out.' : 'We can remind you by SMS before it runs out.'}</p>
                </div>
                {!refillSet && (
                  <div className="row">
                    <select style={{ width: 'auto' }} value={interval} onChange={(e) => setIntervalDays(Number(e.target.value))} aria-label="Reminder interval">
                      <option value={14}>Every 2 weeks</option>
                      <option value={28}>Every 4 weeks</option>
                      <option value={30}>Every month</option>
                      <option value={56}>Every 8 weeks</option>
                      <option value={90}>Every 3 months</option>
                    </select>
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          const drugId = o.items?.find((i) => i.drugId)?.drugId;
                          if (!drugId) throw new Error('Could not find this medicine for a reminder');
                          await api('/me/refills', { body: { drugId, facilityId: o.facility_id, intervalDays: interval } });
                          setRefillSet(true);
                        })
                      }
                    >
                      Set refill reminder
                    </button>
                  </div>
                )}
              </section>
            )}
          </div>

          <aside className="stack-lg">
            <section className="card stack">
              <h3 style={{ margin: 0 }}>Where to collect</h3>
              <div>
                <strong>{o.facility_name}</strong>
                <div className="small muted">{o.facility_address}{o.facility_landmark ? ` · ${o.facility_landmark}` : ''}{o.distanceKm !== null ? ` · ${o.distanceKm} km` : ''}</div>
              </div>
              <div>Phone: <Phone value={o.facility_phone} /></div>
              <div className="grid2" style={{ gap: '0.5rem' }}>
                <a className="btn primary" href={directionsUrl({ lat: o.facility_lat, lng: o.facility_lng }, location)} target="_blank" rel="noreferrer">Directions</a>
                <a className="btn" href={telUrl(o.facility_phone)}>Call</a>
              </div>
              {o.needs_prescription && <div className="small warn-text">Bring your prescription.</div>}
            </section>

            <section className="card stack">
              <h3 style={{ margin: 0 }}>Receipt</h3>
              <dl className="kv" style={{ margin: 0 }}>
                {o.items?.map((i, n) => (
                  <div key={n} style={{ display: 'contents' }}>
                    <dt>{i.description} × {i.quantity}</dt>
                    <dd className="mono">{naira(i.unitPrice * i.quantity)}</dd>
                  </div>
                ))}
                {payment && <><dt>Paid with</dt><dd>{METHOD[payment.method ?? ''] ?? payment.method}{payment.gateway === 'mock' ? ' · Paystack (test)' : payment.gateway === 'paystack' ? ' · Paystack' : ''}</dd></>}
                {payment && payment.gateway !== 'counter' && <><dt>Reference</dt><dd className="mono">{payment.reference}</dd></>}
                {payment?.status === 'refund_pending' && <><dt>Refund due by</dt><dd>{dateTime(payment.refundDueAt)}</dd></>}
                {payment?.refundedAt && <><dt>Refunded</dt><dd>{dateTime(payment.refundedAt)}</dd></>}
                {!payment && <><dt>Total</dt><dd className="mono">{naira(o.total)}</dd></>}
              </dl>
              {payment && <button className="btn small" onClick={() => window.print()} style={{ alignSelf: 'start' }}>Print receipt</button>}
            </section>

            {active && (
              <button
                className="btn danger-outline block"
                disabled={busy}
                onClick={() => confirm(o.status === 'paid' ? 'Cancel and get a full refund?' : 'Cancel this reservation?') && act(() => api(`/orders/${o.id}/cancel`, { method: 'POST' }))}
              >
                {o.status === 'paid' ? 'Cancel and get a refund' : 'Cancel reservation'}
              </button>
            )}
            <Link to={`/complaint?facility=${o.facility_id}&order=${o.id}`} className="small center">Report a problem</Link>
          </aside>
        </div>
        <SampleNote>Order details, code and payment reference shown are sample data.</SampleNote>
      </div>
    </Page>
  );
}
