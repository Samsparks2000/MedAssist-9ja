import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorBox, Spinner } from '../components/common';
import { BankIcon, CardIcon, CheckIcon, LockIcon, MobileIcon } from '../components/Icons';
import { Page } from '../components/Layout';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { drugName, naira, whenLabel } from '../lib/format';
import { haversineKm } from '../lib/geo';
import { useUserLocation } from '../lib/location';

type Method = 'card' | 'bank_transfer' | 'ussd';

const METHODS: { id: Method; label: string; hint: string; Icon: typeof CardIcon }[] = [
  { id: 'card', label: 'Card', hint: 'Verve, Visa, Mastercard', Icon: CardIcon },
  { id: 'bank_transfer', label: 'Bank transfer', hint: 'To a one-time account', Icon: BankIcon },
  { id: 'ussd', label: 'USSD', hint: 'Dial a code, no internet', Icon: MobileIcon },
];
const USSD_BANKS = ['GTBank *737#', 'Access *901#', 'First Bank *894#', 'UBA *919#', 'Zenith *966#', 'Fidelity *770#', 'Union *826#', 'Sterling *822#'];

interface Summary {
  facilityId: string;
  facilityName: string;
  address: string;
  lat: number;
  lng: number;
  openNow: boolean;
  item: string;
  detail: string;
  quantity: number;
  total: number;
  needsPrescription: boolean;
}

/** Reserve and pay (design page 7): choose pay now or pay at pickup, then a payment method. */
export function Reserve() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const { location } = useUserLocation();
  const existingOrder = params.get('order');
  const [s, setS] = useState<Summary | null>(null);
  const [collectBy, setCollectBy] = useState<string | null>(null);
  const [mode, setMode] = useState<'online' | 'at_pickup'>(params.get('mode') === 'at_pickup' ? 'at_pickup' : 'online');
  const [method, setMethod] = useState<Method>('card');
  const [bank, setBank] = useState(USSD_BANKS[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (existingOrder) {
          const o = await api(`/orders/${existingOrder}`);
          setMode('online');
          setS({
            facilityId: o.facility_id, facilityName: o.facility_name, address: o.facility_address, lat: o.facility_lat, lng: o.facility_lng, openNow: true,
            item: o.items?.[0]?.description ?? 'Reservation', detail: `qty ${o.items?.reduce((n: number, i: any) => n + i.quantity, 0) ?? 1}`,
            quantity: 1, total: o.total, needsPrescription: o.needs_prescription,
          });
          setCollectBy(null);
          return;
        }
        const facilityId = params.get('facility')!;
        const drugId = params.get('drug')!;
        const quantity = Math.max(1, Number(params.get('qty') ?? 1));
        const [f, cb] = await Promise.all([api(`/facilities/${facilityId}`), api<{ collectBy: string }>(`/facilities/${facilityId}/collect-by`)]);
        const d = f.drugs.find((x: any) => x.drug_id === drugId);
        if (!d || d.available <= 0) throw new Error('This medicine is no longer in stock here.');
        setS({
          facilityId, facilityName: f.name, address: f.address, lat: f.lat, lng: f.lng, openNow: f.openNow,
          item: drugName(d), detail: `qty ${Math.min(quantity, d.available)}`,
          quantity: Math.min(quantity, d.available), total: (d.price ?? 0) * Math.min(quantity, d.available), needsPrescription: d.needs_prescription,
        });
        setCollectBy(cb.collectBy);
      } catch (e) {
        setError(errorText(e));
      }
    })();
  }, [existingOrder, params]);

  const submit = async () => {
    if (!s) return;
    setBusy(true);
    setError(null);
    try {
      let orderId = existingOrder;
      if (!orderId) {
        const o = await api<{ id: string }>('/orders', {
          body: { facilityId: s.facilityId, items: [{ drugId: params.get('drug'), quantity: s.quantity }], paymentMode: mode },
        });
        orderId = o.id;
      }
      if (mode === 'at_pickup') {
        navigate(`/orders/${orderId}`, { replace: true });
        return;
      }
      const pay = await api<{ authorizationUrl: string }>(`/orders/${orderId}/pay`, { body: { method, ussdBank: method === 'ussd' ? bank : undefined } });
      window.location.href = pay.authorizationUrl;
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  if (error && !s) return <Page narrow><ErrorBox error={error} /><Link to={-1 as never} onClick={(e) => { e.preventDefault(); navigate(-1); }}>‹ Back</Link></Page>;
  if (!s) return <Page><Spinner /></Page>;
  const km = location ? Math.round(haversineKm(location, s) * 10) / 10 : null;
  const until = collectBy ? whenLabel(collectBy) : null;

  return (
    <Page>
      <div className="stack-lg" style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="spread">
          <Link to={`/facility/${s.facilityId}`} className="small">‹ Back to pharmacy</Link>
          {me?.user.phone && <span className="small muted">Signed in as <span className="mono">{me.user.phone.replace('+234', '0')}</span></span>}
        </div>
        <div className="steps-bar" aria-label="Progress">
          <span className="done"><span className="num" style={{ width: 22, height: 22 }}><CheckIcon width={12} /></span> Sign in</span>
          <span className="now"><span className="num ring" style={{ width: 22, height: 22, fontSize: '0.75rem', borderWidth: 1.5 }}>2</span> Reserve and pay</span>
          <span><span className="num ring" style={{ width: 22, height: 22, fontSize: '0.75rem', borderWidth: 1.5, borderColor: 'var(--border-strong)', color: 'var(--muted)' }}>3</span> Pick up</span>
        </div>
        <h1 style={{ margin: 0 }}>Reserve and pay</h1>

        <div className="layout-side">
          <div className="stack-lg">
            {!existingOrder && (
              <section className="card stack">
                <h2 style={{ margin: 0 }}>How do you want to pay?</h2>
                <div className="grid2" style={{ gap: '0.75rem' }}>
                  <label className={`choice ${mode === 'online' ? 'on' : ''}`}>
                    <input type="radio" name="mode" checked={mode === 'online'} onChange={() => setMode('online')} />
                    <span><strong>Pay now</strong><span className="small muted">Card, bank transfer or USSD. The pharmacy holds your medicine{until ? ` until ${until}` : ''}.</span></span>
                  </label>
                  <label className={`choice ${mode === 'at_pickup' ? 'on' : ''}`}>
                    <input type="radio" name="mode" checked={mode === 'at_pickup'} onChange={() => setMode('at_pickup')} />
                    <span><strong>Pay at pickup</strong><span className="small muted">Pay with cash or POS at the counter. The pharmacy confirms first, then holds it for 2 hours.</span></span>
                  </label>
                </div>
              </section>
            )}

            {mode === 'online' && (
              <section className="card stack">
                <h2 style={{ margin: 0 }}>Payment method</h2>
                <div className="grid3" style={{ gap: '0.75rem' }}>
                  {METHODS.map(({ id, label, hint, Icon }) => (
                    <label key={id} className={`choice ${method === id ? 'on' : ''}`} style={{ flexDirection: 'column' }}>
                      <span className="row"><input type="radio" name="method" checked={method === id} onChange={() => setMethod(id)} /><Icon /></span>
                      <span><strong>{label}</strong><span className="small muted">{hint}</span></span>
                    </label>
                  ))}
                </div>
                {method === 'ussd' && (
                  <label>Your bank
                    <select value={bank} onChange={(e) => setBank(e.target.value)} style={{ marginTop: 6 }}>
                      {USSD_BANKS.map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </label>
                )}
                <div className="card soft tight row small" style={{ alignItems: 'flex-start' }}>
                  <LockIcon />
                  <span style={{ flex: 1 }}>You’ll finish payment on Paystack’s secure page. MedAssist-9ja never sees or stores your card details.</span>
                </div>
              </section>
            )}

            <ErrorBox error={error} />
            <div className="sticky-cta">
              <button className="btn primary big block" disabled={busy} onClick={submit}>
                {mode === 'online' ? <>Pay <span className="mono">{naira(s.total)}</span></> : 'Send reservation request'}
              </button>
            </div>
            <p className="small muted">
              {mode === 'online'
                ? `If the pharmacy declines or cancels your order, you get a full refund within 24 hours. You can cancel yourself${until ? ` before ${until}` : ''} for a full refund.`
                : 'You will get an SMS when the pharmacy confirms. Nothing is charged now.'}
            </p>
          </div>

          <aside className="card stack">
            <h2 style={{ margin: 0 }}>Your reservation</h2>
            <div>
              <strong>{s.facilityName}</strong>
              <div className="small muted">{s.address}{km !== null ? ` · ${km} km` : ''}</div>
            </div>
            <hr className="divider" style={{ margin: 0 }} />
            <div className="spread-top">
              <div><strong>{s.item}</strong><div className="small muted">{s.detail}</div></div>
              <span className="mono">{naira(s.total)}</span>
            </div>
            <hr className="divider" style={{ margin: 0 }} />
            <div className="spread"><strong>Total</strong><span className="mono" style={{ fontSize: '1.6rem', color: 'var(--ink)' }}>{naira(s.total)}</span></div>
            <div className="card soft tight small">
              {until && <div>Collect by: <strong>{until}</strong>{!s.openNow ? ' (opens later)' : ''}</div>}
              <div>Bring: your pickup code (sent by SMS)</div>
            </div>
            {s.needsPrescription && <div className="small warn-text">{s.item.split(' (')[0]} needs a prescription. Show it at the counter when you collect.</div>}
          </aside>
        </div>
      </div>
    </Page>
  );
}
