import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Field, Phone, Spinner, StatusBadge } from '../../components/common';
import { api, errorText } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { downloadFile } from '../../lib/download';
import { date, dateTime, naira } from '../../lib/format';

/** US-21: sales, top items and what people nearby could not find. */
export function Reports() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    setData(null);
    api(`/reports/sales?days=${days}`).then(setData);
  }, [days]);
  const max = Math.max(1, ...(data?.byDay ?? []).map((d: any) => d.amount));
  return (
    <div>
      <div className="page-head">
        <div><h1>Reports</h1><div className="muted">Counter sales and collected reservations, and demand you are missing.</div></div>
        <div className="row">
          <select style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
          <button className="btn" onClick={() => downloadFile(`/reports/sales?days=${days}&format=csv`, `medassist-sales-${days}d.csv`)}>Export CSV</button>
          <button className="btn" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>
      {!data ? <Spinner /> : (
        <div className="stack-lg">
          <div className="kpis">
            <div className="kpi"><div className="k">Sales</div><div className="v mono" style={{ fontSize: '1.6rem' }}>{naira(data.total)}</div><div className="s muted">{data.count} lines</div></div>
            <div className="kpi"><div className="k">Best seller</div><div className="v" style={{ fontSize: '1.1rem' }}>{data.top[0]?.item ?? '—'}</div><div className="s muted">{data.top[0] ? `${data.top[0].quantity} sold` : ''}</div></div>
            <div className="kpi"><div className="k">Missed searches</div><div className="v">{data.missed.reduce((s: number, m: any) => s + m.times, 0)}</div><div className="s muted">nearby, not in your stock</div></div>
            <div className="kpi"><div className="k">Days with sales</div><div className="v">{data.byDay.length}</div><div className="s muted">of {days}</div></div>
          </div>
          <section className="card">
            <h2>Sales by day</h2>
            {data.byDay.length === 0 ? <p className="muted">No sales in this period.</p> : (
              <div className="row" style={{ alignItems: 'flex-end', gap: 4, height: 160, flexWrap: 'nowrap', overflowX: 'auto' }} role="img" aria-label="Sales by day">
                {data.byDay.map((d: any) => (
                  <div key={d.day} title={`${date(d.day)}: ${naira(d.amount)}`} style={{ flex: '1 0 14px', maxWidth: 36, height: `${Math.max(4, (d.amount / max) * 150)}px`, background: 'var(--brand)', borderRadius: '4px 4px 0 0' }} />
                ))}
              </div>
            )}
          </section>
          <div className="grid2">
            <section className="card">
              <h2>Top items</h2>
              {data.top.length === 0 ? <p className="muted">Nothing sold yet.</p> : (
                <table><tbody>{data.top.map((t: any) => <tr key={t.item}><td>{t.item}</td><td className="num-cell">{t.quantity}</td><td className="num-cell">{naira(t.amount)}</td></tr>)}</tbody></table>
              )}
            </section>
            <section className="card">
              <h2>Searched for but not in your stock</h2>
              {data.missed.length === 0 ? <p className="muted">No missed searches nearby.</p> : (
                <table><tbody>{data.missed.map((m: any) => <tr key={m.target}><td>{m.label}</td><td className="num-cell">{m.times}</td></tr>)}</tbody></table>
              )}
              <Link to="/dashboard/inventory/add" className="btn small mt">Add stock</Link>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/** US-25: payout account and settlement statement. */
export function Payouts() {
  const [data, setData] = useState<{ summary: any; payments: any[] } | null>(null);
  useEffect(() => {
    api('/payments/settlements').then(setData);
  }, []);
  if (!data) return <Spinner />;
  const s = data.summary;
  return (
    <div>
      <div className="page-head">
        <div><h1>Payouts</h1><div className="muted">Online payments are settled to your bank by Paystack, less the platform fee. Pay-at-pickup sales are paid to you at the counter.</div></div>
        <button className="btn" onClick={() => downloadFile('/payments/settlements?format=csv', 'medassist-settlements.csv')}>Export CSV</button>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="k">Paid online</div><div className="v mono" style={{ fontSize: '1.5rem' }}>{naira(s.gross)}</div><div className="s muted">{s.count} payments</div></div>
        <div className="kpi"><div className="k">Platform fees</div><div className="v mono" style={{ fontSize: '1.5rem' }}>{naira(s.fees)}</div></div>
        <div className="kpi"><div className="k">Settled to you</div><div className="v mono" style={{ fontSize: '1.5rem' }}>{naira(s.net)}</div></div>
        <div className="kpi"><div className="k">Refunded</div><div className="v mono" style={{ fontSize: '1.5rem' }}>{naira(s.refunded)}</div></div>
      </div>
      <div className="card tight spread" style={{ marginBottom: '1rem' }}>
        <span>Settlement account: {s.payoutAccount ? <span className="mono">{s.payoutAccount}</span> : <span className="warn-text">not set</span>}</span>
        <Link to="/dashboard/profile" className="btn small">Change bank details</Link>
      </div>
      {data.payments.length === 0 ? <Empty>No online payments yet.</Empty> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Reference</th><th>Method</th><th className="num-cell">Amount</th><th className="num-cell">Fee</th><th className="num-cell">Net</th><th>Status</th></tr></thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.reference}>
                  <td>{dateTime(p.paid_at)}</td>
                  <td className="mono small">{p.reference}</td>
                  <td>{p.method?.replace('_', ' ')}</td>
                  <td className="num-cell">{naira(p.amount)}</td>
                  <td className="num-cell">{naira(p.platform_fee)}</td>
                  <td className="num-cell">{naira(p.facility_amount)}</td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Staff accounts: each person signs in with a code sent to their own phone. */
export function Staff() {
  const { me } = useAuth();
  const [data, setData] = useState<{
    owner: any;
    staff: { id: string; name: string; phone: string; role: string; access: 'manager' | 'staff' }[];
    myAccess: 'owner' | 'manager' | 'staff';
    canManage: boolean;
    canSetManagers: boolean;
  } | null>(null);
  const [form, setForm] = useState({ name: '', role: me?.user.role === 'hospital' ? 'Records officer' : 'Pharmacist', phone: '', access: 'staff' as 'manager' | 'staff' });
  const [error, setError] = useState<string | null>(null);
  const load = () => api<NonNullable<typeof data>>('/staff').then(setData);
  useEffect(() => {
    load();
  }, []);
  if (!data) return <Spinner />;
  const act = (p: Promise<unknown>) => p.then(() => { setError(null); load(); }).catch((err) => setError(errorText(err)));
  const canChange = (m: { access: string }) => data.canManage && (m.access === 'staff' || data.canSetManagers);
  return (
    <div>
      <div className="page-head"><div><h1>Staff accounts</h1><div className="muted">People who can update this listing. Each signs in with a code sent to their phone — no shared passwords.</div></div></div>
      <div className="card tint small" style={{ marginBottom: '1rem' }}>
        <strong>Who can do what.</strong> <strong>Staff</strong> update stock, sales, beds and reservations.{' '}
        <strong>Managers</strong> can also edit the {me?.user.role === 'hospital' ? 'hospital' : 'pharmacy'} profile, see payouts and sales reports, and add or remove staff.
        Only the owner can make someone a manager.
      </div>
      <ErrorBox error={error} />
      <div className="card" style={{ marginBottom: '1rem' }}>
        <table>
          <thead><tr><th>Name</th><th>Job</th><th>Access</th><th>Phone</th><th /></tr></thead>
          <tbody>
            <tr><td><strong>{data.owner?.name}</strong></td><td>Owner</td><td><span className="badge ok">Owner</span></td><td><Phone value={data.owner?.phone} /></td><td /></tr>
            {data.staff.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.role}</td>
                <td>
                  {data.canSetManagers ? (
                    <select style={{ width: 'auto' }} value={m.access} onChange={(e) => act(api(`/staff/${m.id}`, { method: 'PATCH', body: { access: e.target.value } }))} aria-label={`${m.name} access`}>
                      <option value="staff">Staff</option>
                      <option value="manager">Manager</option>
                    </select>
                  ) : (
                    <span className={`badge ${m.access === 'manager' ? 'info' : 'grey'}`}>{m.access === 'manager' ? 'Manager' : 'Staff'}</span>
                  )}
                </td>
                <td><Phone value={m.phone} /></td>
                <td style={{ textAlign: 'right' }}>{canChange(m) && <button className="btn link" onClick={() => act(api(`/staff/${m.id}`, { method: 'DELETE' }))}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.canManage ? (
        <form className="card" onSubmit={(e) => { e.preventDefault(); act(api('/staff', { body: form }).then(() => setForm({ ...form, name: '', phone: '', access: 'staff' }))); }}>
          <h2>Add a person</h2>
          <div className="form-grid">
            <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <Field label="Job">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {['Records officer', 'Nurse in charge', 'Pharmacist', 'Pharmacy technician', 'Manager', 'Administrator'].map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Phone"><input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></Field>
            <Field label="Access">
              <select value={form.access} onChange={(e) => setForm({ ...form, access: e.target.value as 'manager' | 'staff' })} disabled={!data.canSetManagers}>
                <option value="staff">Staff</option>
                {data.canSetManagers && <option value="manager">Manager</option>}
              </select>
            </Field>
          </div>
          <button className="btn primary">Add person</button>
        </form>
      ) : (
        <p className="muted small">Ask the owner or a manager to add or remove people.</p>
      )}
    </div>
  );
}
