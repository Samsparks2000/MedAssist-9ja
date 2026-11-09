import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ErrorBox, Spinner } from '../components/common';
import { api, errorText } from '../lib/api';
import { naira } from '../lib/format';

/**
 * Test-mode stand-in for the gateway's hosted checkout. It collects no card details: it only
 * asks the API to send the signed webhook a real gateway would send.
 */
export function MockCheckout() {
  const { reference } = useParams();
  const navigate = useNavigate();
  const [p, setP] = useState<{ amount: number; facility_name: string; order_id: string; status: string } | null>(null);
  const [params] = useSearchParams();
  const preset = params.get('method');
  const [method, setMethod] = useState<'card' | 'bank_transfer' | 'ussd'>(preset === 'ussd' || preset === 'bank_transfer' ? preset : 'card');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/payments/mock/${encodeURIComponent(reference!)}`).then(setP).catch((e) => setError(errorText(e)));
  }, [reference]);

  const complete = async (success: boolean) => {
    setBusy(true);
    try {
      await api(`/payments/mock/${encodeURIComponent(reference!)}/complete`, { body: { method, success } });
      navigate(`/orders/${p!.order_id}?reference=${encodeURIComponent(reference!)}`, { replace: true });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  if (error) return <ErrorBox error={error} />;
  if (!p) return <Spinner />;
  return (
    <div className="card stack" style={{ maxWidth: 440, margin: '0 auto' }}>
      <div className="devnote">Test checkout — no real money moves. Set PAYMENT_PROVIDER=paystack to use the live gateway.</div>
      <h1>Pay {naira(p.amount)}</h1>
      <div className="muted">to {p.facility_name} · ref {reference}</div>
      <fieldset className="stack" style={{ border: 0, padding: 0 }}>
        <legend className="small muted">Payment method</legend>
        {(
          [
            ['card', 'Debit card'],
            ['bank_transfer', 'Bank transfer'],
            ['ussd', 'USSD (*737#, *894#, …)'],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="check card" style={{ padding: '0.75rem' }}>
            <input type="radio" name="method" checked={method === v} onChange={() => setMethod(v)} /> {label}
          </label>
        ))}
      </fieldset>
      <button className="btn primary block" disabled={busy || p.status !== 'initialized'} onClick={() => complete(true)}>
        Simulate successful payment
      </button>
      <button className="btn ghost block" disabled={busy || p.status !== 'initialized'} onClick={() => complete(false)}>
        Simulate failed payment
      </button>
    </div>
  );
}
