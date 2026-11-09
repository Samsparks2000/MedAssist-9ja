import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Empty, ErrorBox, Phone, SampleNote, Spinner, StatusBadge } from '../components/common';
import { FileIcon, ImageIcon } from '../components/Icons';
import { Shell } from '../components/Shell';
import { api, errorText, getToken } from '../lib/api';
import { dateTime, naira, telUrl } from '../lib/format';

interface Stats {
  facilities_live: number;
  pending_verifications: number;
  oldest_pending_days: number | null;
  stale_listings: number;
  open_complaints: number;
  refund_complaints: number;
  failed_payments_today: number;
  pct_updated_24h: number | null;
  payment_success_pct: number | null;
  patients: number;
  searches_7d: number;
  unmet_searches_7d: number;
}

export function Admin() {
  const [stats, setStats] = useState<Stats | null>(null);
  const loadStats = useCallback(() => api<Stats>('/admin/stats').then(setStats).catch(() => {}), []);
  useEffect(() => {
    loadStats();
  }, [loadStats]);
  return (
    <Shell
      navy
      caption="Admin console"
      nav={[
        { to: '/admin', label: 'Verification', end: true, count: stats?.pending_verifications },
        { to: '/admin/outdated', label: 'Outdated listings' },
        { to: '/admin/complaints', label: 'Complaints', count: stats?.open_complaints },
        { to: '/admin/payments', label: 'Payments and refunds' },
        { to: '/admin/facilities', label: 'All facilities' },
        { to: '/admin/catalogue', label: 'Drug catalogue' },
        { to: '/admin/reports', label: 'Reports' },
      ]}
    >
      <Routes>
        <Route index element={<Verification stats={stats} onChange={loadStats} />} />
        <Route path="outdated" element={<Outdated />} />
        <Route path="complaints" element={<Complaints onChange={loadStats} />} />
        <Route path="payments" element={<Payments />} />
        <Route path="facilities" element={<Facilities />} />
        <Route path="catalogue" element={<Catalogue />} />
        <Route path="reports" element={<AdminReports stats={stats} />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
      <SampleNote>Facilities, people, orders and figures shown are sample data.</SampleNote>
    </Shell>
  );
}

const CHECKS: Record<'pharmacy' | 'hospital' | 'specialist', [string, string][]> = {
  pharmacy: [['register', 'Licence number found on the PCN register'], ['match', 'Name and address match the licence'], ['expiry', 'Licence is not expired'], ['phone', 'Phone number answered and confirmed']],
  hospital: [['register', 'Registration found with the State Ministry of Health'], ['match', 'Name and address match the registration'], ['emergency', 'Emergency line answered on a test call'], ['pin', 'Map pin is on the emergency entrance']],
  specialist: [['register', 'Name found on the MDCN register'], ['licence', 'Practising licence is current'], ['specialty', 'Specialty matches the register'], ['phone', 'Phone number answered and confirmed']],
};

async function openDocument(id: string) {
  const res = await fetch(`/api/documents/${id}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) return alert('Could not open the document');
  window.open(URL.createObjectURL(await res.blob()), '_blank');
}

const DOC_LABEL: Record<string, string> = {
  licence: 'PCN licence', shop_photo: 'Shop front photo', registration_certificate: 'Registration certificate', practising_licence: 'Practising licence', photo: 'Profile photo',
};

function Kpis({ stats }: { stats: Stats | null }) {
  return (
    <div className="kpis">
      <div className="kpi"><div className="k">Waiting for verification</div><div className="v">{stats?.pending_verifications ?? '…'}</div><div className="s warn-text">{stats?.oldest_pending_days ? `oldest waiting ${stats.oldest_pending_days} days` : ' '}</div></div>
      <div className="kpi"><div className="k">Listings not updated in 24 h</div><div className="v">{stats?.stale_listings ?? '…'}</div><div className="s muted">of {stats?.facilities_live ?? '…'} live facilities</div></div>
      <div className="kpi"><div className="k">Open complaints</div><div className="v">{stats?.open_complaints ?? '…'}</div><div className="s danger-text">{stats?.refund_complaints ? `${stats.refund_complaints} about a refund` : ' '}</div></div>
      <div className="kpi"><div className="k">Failed payments today</div><div className="v">{stats?.failed_payments_today ?? '…'}</div><div className="s muted">no one was charged</div></div>
    </div>
  );
}

/** US-30 (design page 13): review queue, documents, checklist, decision with a note; all audit-logged. */
function Verification({ stats, onChange }: { stats: Stats | null; onChange: () => void }) {
  const [status, setStatus] = useState('pending');
  const [data, setData] = useState<{ facilities: any[]; specialists: any[] } | null>(null);
  const [selected, setSelected] = useState<{ kind: 'facility' | 'specialist'; id: string } | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => api(`/admin/verifications?status=${status}`).then((d) => { setData(d); return d; }), [status]);
  useEffect(() => {
    load().then((d) => {
      const first = d.facilities[0] ? { kind: 'facility' as const, id: d.facilities[0].id } : d.specialists[0] ? { kind: 'specialist' as const, id: d.specialists[0].id } : null;
      setSelected(first);
    });
  }, [load]);

  const item = selected && data ? (selected.kind === 'facility' ? data.facilities : data.specialists).find((x) => x.id === selected.id) : null;
  useEffect(() => {
    setChecklist(item?.verification_checklist ?? {});
    setNote('');
  }, [item?.id]);

  const days = (iso: string) => {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    return d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days`;
  };

  const decide = async (decision: 'approve' | 'reject' | 'request_info' | 'suspend') => {
    if (!item || !selected) return;
    try {
      await api(`/admin/${selected.kind === 'facility' ? 'facilities' : 'specialists'}/${item.id}/verify`, { body: { decision, reason: note || undefined, checklist } });
      setMsg(`${item.name}: ${decision === 'approve' ? 'approved and listed' : decision === 'request_info' ? 'asked for more information' : decision === 'reject' ? 'rejected' : 'suspended'}.`);
      setError(null);
      onChange();
      const d = await load();
      setSelected(d.facilities[0] ? { kind: 'facility', id: d.facilities[0].id } : d.specialists[0] ? { kind: 'specialist', id: d.specialists[0].id } : null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const queue = [
    ...(data?.facilities ?? []).map((f) => ({ kind: 'facility' as const, id: f.id, name: f.name, sub: `${f.type === 'pharmacy' ? 'Pharmacy' : 'Hospital'} · ${f.area ?? ''} · ${f.documents.length} document${f.documents.length === 1 ? '' : 's'}${f.type === 'pharmacy' && f.documents.length < 2 ? ' · document missing' : ''}`, at: f.submitted_at })),
    ...(data?.specialists ?? []).map((s) => ({ kind: 'specialist' as const, id: s.id, name: `${s.title} ${s.name.replace(/^Dr\.\s*/, '')}`, sub: `Specialist · ${s.specialty} · ${s.documents.length} document${s.documents.length === 1 ? '' : 's'}`, at: s.submitted_at })),
  ];
  const kindKey: 'pharmacy' | 'hospital' | 'specialist' = selected?.kind === 'specialist' ? 'specialist' : item?.type ?? 'pharmacy';

  return (
    <div>
      <div className="page-head">
        <div><h1>Verification</h1><div className="muted">Only approved facilities and doctors appear in search. Check each licence before approving.</div></div>
        <select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Show">
          <option value="pending">Waiting for review</option>
          <option value="info_requested">Asked for more information</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>
      <Kpis stats={stats} />
      {msg && <div className="alert ok" style={{ marginBottom: '1rem' }}>{msg}</div>}
      <div className="layout-side" style={{ gridTemplateColumns: 'minmax(260px, 380px) minmax(0, 1fr)' }}>
        <section className="card stack" style={{ alignSelf: 'start' }}>
          <h2 style={{ margin: 0 }}>{status === 'pending' ? 'Waiting for review' : 'Applications'}</h2>
          {!data ? <Spinner /> : queue.length === 0 ? <p className="muted">Nothing here.</p> : queue.map((q) => (
            <button key={q.id} className={`choice ${selected?.id === q.id ? 'on' : ''}`} style={{ font: 'inherit', textAlign: 'left', width: '100%', borderColor: selected?.id === q.id ? 'var(--info)' : undefined, background: selected?.id === q.id ? '#eef3fc' : undefined }} onClick={() => setSelected({ kind: q.kind, id: q.id })}>
              <span style={{ flex: 1 }}><strong>{q.name}</strong><span className="small muted">{q.sub}</span></span>
              <span className={`small ${days(q.at).includes('day') && parseInt(days(q.at)) >= 3 ? 'warn-text' : 'muted'}`}>{days(q.at)}</span>
            </button>
          ))}
        </section>

        {item ? (
          <section className="card stack">
            <div className="spread-top">
              <div>
                <h2 style={{ margin: 0 }}>{selected!.kind === 'specialist' ? `${item.title} ${item.name.replace(/^Dr\.\s*/, '')}` : item.name}</h2>
                <div className="muted small">
                  Applied {dateTime(item.submitted_at)} by {selected!.kind === 'specialist' ? item.name : item.owner_name} · <Phone value={selected!.kind === 'specialist' ? item.phone : item.owner_phone} />
                </div>
              </div>
              <StatusBadge status={item.verification_status} />
            </div>
            {selected!.kind === 'facility' ? (
              <div className="grid2" style={{ gap: '0.75rem 1.5rem' }}>
                <div><div className="small muted">Address</div>{item.address}{item.landmark ? ` (${item.landmark})` : ''}</div>
                <div><div className="small muted">Map pin</div><span className="mono">{Number(item.lat).toFixed(4)}, {Number(item.lng).toFixed(4)}</span> · <a href={`https://www.google.com/maps?q=${item.lat},${item.lng}`} target="_blank" rel="noreferrer">Check on map</a></div>
                <div><div className="small muted">{item.type === 'pharmacy' ? 'PCN premises licence no.' : 'State registration no.'}</div><span className="mono">{item.licence_no || '—'}</span>{item.licence_expiry ? ` · expires ${item.licence_expiry}` : ''}</div>
                <div><div className="small muted">{item.type === 'pharmacy' ? 'Superintendent pharmacist' : 'Medical director'}</div>{item.lead_name ?? '—'}{item.lead_reg_no ? <> · reg. no. <span className="mono">{item.lead_reg_no}</span></> : ''}</div>
                <div><div className="small muted">Phones</div><Phone value={item.phone} />{item.emergency_phone ? <> · emergency <Phone value={item.emergency_phone} /></> : ''}</div>
                <div><div className="small muted">Payout account</div>{item.payout_account_name ? `${item.payout_account_name} · ${item.payout_bank_name}` : '—'}</div>
              </div>
            ) : (
              <div className="grid2" style={{ gap: '0.75rem 1.5rem' }}>
                <div><div className="small muted">Specialty</div>{item.specialty}{item.years_experience ? ` · ${item.years_experience} years` : ''}</div>
                <div><div className="small muted">MDCN registration</div><span className="mono">{item.licence_no}</span></div>
                <div><div className="small muted">Hospitals</div>{item.hospitals.map((h: any) => `${h.name} (${h.status})`).join(', ') || '—'}</div>
                <div><div className="small muted">Languages</div>{item.languages?.join(', ')}</div>
              </div>
            )}
            <div>
              <div className="small muted" style={{ marginBottom: 6 }}>Documents</div>
              <div className="btn-row">
                {item.documents.length === 0 && <span className="warn-text small">No documents uploaded</span>}
                {item.documents.map((d: any) => (
                  <button key={d.id} className="btn small" onClick={() => openDocument(d.id)}>
                    {d.mime.startsWith('image') ? <ImageIcon width={16} /> : <FileIcon width={16} />} {DOC_LABEL[d.kind] ?? d.kind}{d.mime === 'application/pdf' ? ' (PDF)' : ''}
                  </button>
                ))}
              </div>
            </div>
            <fieldset className="card tight stack" style={{ margin: 0 }}>
              <legend className="label" style={{ padding: '0 0.4rem' }}>Checklist</legend>
              {CHECKS[kindKey].map(([key, text]) => (
                <label key={key} className="check">
                  <input type="checkbox" checked={!!checklist[key]} onChange={(e) => { const next = { ...checklist, [key]: e.target.checked }; setChecklist(next); if (selected!.kind === 'facility') api(`/admin/facilities/${item.id}/checklist`, { method: 'PUT', body: { checklist: next } }).catch(() => {}); }} />
                  {text}
                </label>
              ))}
            </fieldset>
            <label>Note to the applicant (sent if you ask for more or reject)
              <textarea style={{ marginTop: 6 }} placeholder="e.g. Please upload a clearer copy of your licence" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <ErrorBox error={error} />
            <div className="btn-row">
              {item.verification_status !== 'approved' && (
                <button className="btn primary" disabled={!CHECKS[kindKey].every(([k]) => checklist[k])} title="Tick every check first" onClick={() => decide('approve')}>Approve and list</button>
              )}
              {item.verification_status !== 'approved' && <button className="btn" disabled={note.trim().length < 3} onClick={() => decide('request_info')}>Ask for more information</button>}
              {item.verification_status !== 'approved' && <button className="btn danger-outline" disabled={note.trim().length < 3} onClick={() => decide('reject')}>Reject</button>}
              {item.verification_status === 'approved' && <button className="btn danger-outline" disabled={note.trim().length < 3} onClick={() => decide('suspend')}>Suspend listing</button>}
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>Every decision is saved in the audit log with your name and the time.</p>
          </section>
        ) : (
          <Empty>Select an application.</Empty>
        )}
      </div>
      <div className="grid2 mt">
        <section className="card"><OutdatedTable compact /></section>
        <section className="card"><ComplaintList compact /></section>
      </div>
    </div>
  );
}

function OutdatedTable({ compact = false }: { compact?: boolean }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api<any[]>('/admin/freshness').then(setRows);
  useEffect(() => {
    load();
  }, []);
  if (!rows) return <Spinner />;
  const shown = compact ? rows.slice(0, 4) : rows;
  return (
    <div className="stack">
      <div className="spread">
        <h2 style={{ margin: 0 }}>Outdated listings</h2>
        {!compact && <button className="btn small" onClick={() => api<{ reminded: number }>('/admin/freshness/remind', { method: 'POST' }).then((r) => { setMsg(`Reminded ${r.reminded} facilities.`); load(); })}>Send reminders now</button>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>Reminders go out automatically after 24 hours. Listings are flagged to patients after 24 hours and hidden from search after 72 hours.</p>
      {msg && <div className="alert ok">{msg}</div>}
      {shown.length === 0 ? <p className="muted">Every live facility updated in the last 24 hours.</p> : (
        <table>
          <thead><tr><th>Facility</th><th>Last update</th><th /></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className={r.hidden ? 'danger-text' : 'warn-text'}>{r.hours_since_update >= 48 ? `${Math.floor(r.hours_since_update / 24)} days ago` : `${r.hours_since_update} h ago`}{r.hidden ? ' · hidden' : ''}</td>
                <td style={{ textAlign: 'right' }}>{r.hidden || !r.stale_reminded_at ? <a className="btn small" href={telUrl(r.phone)}>Call them</a> : <span className="small muted">Reminder sent</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const Outdated = () => <div><div className="page-head"><div><h1>Outdated listings</h1></div></div><div className="card"><OutdatedTable /></div></div>;

const CATEGORY_TONE: Record<string, string> = { Refund: 'danger', 'Wrong stock': 'warn', Contact: 'grey', Price: 'warn', Service: 'grey', Other: 'grey' };

function ComplaintList({ compact = false, status = 'open', onChange }: { compact?: boolean; status?: string; onChange?: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const load = useCallback(() => api<any[]>(`/admin/complaints?status=${status}`).then(setRows), [status]);
  useEffect(() => {
    load();
  }, [load]);
  if (!rows) return <Spinner />;
  const shown = compact ? rows.slice(0, 3) : rows;
  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>Complaints</h2>
      {shown.length === 0 && <p className="muted">No complaints.</p>}
      {shown.map((c) => (
        <div key={c.id} className="card tight stack" style={{ gap: '0.3rem' }}>
          <div className="spread">
            <strong>{c.category === 'Refund' ? 'Refund not received' : c.category === 'Wrong stock' ? 'Drug listed but not in shop' : c.category === 'Contact' ? 'Phone number not reachable' : c.category ?? 'Complaint'}</strong>
            <span className={`badge ${CATEGORY_TONE[c.category] ?? 'grey'}`}>{c.category ?? 'Other'}</span>
          </div>
          <div className="small muted">{c.pickup_code ? `Order ${c.pickup_code} · ` : ''}{c.facility_name} · {dateTime(c.created_at)}</div>
          {!compact && <p style={{ margin: 0 }}>{c.comment}</p>}
          {!compact && <div className="small muted">From {c.user_name ?? 'patient'} · <Phone value={c.user_phone} /></div>}
          {c.resolution && <div className="alert ok small">{c.resolution}</div>}
          {!compact && c.status === 'open' && (
            <button className="btn small" style={{ alignSelf: 'start' }} onClick={() => { const r = prompt('Resolution note (sent to the patient):'); if (r) api(`/admin/complaints/${c.id}/resolve`, { body: { resolution: r } }).then(() => { load(); onChange?.(); }); }}>Mark resolved</button>
          )}
        </div>
      ))}
    </div>
  );
}

function Complaints({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState('open');
  return (
    <div>
      <div className="page-head"><div><h1>Complaints</h1></div></div>
      <div className="tabs">{['open', 'resolved'].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s === 'open' ? 'Open' : 'Resolved'}</button>)}</div>
      <ComplaintList status={status} onChange={onChange} />
    </div>
  );
}

function Payments() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    api<any[]>('/admin/payments').then(setRows);
  }, []);
  if (!rows) return <Spinner />;
  return (
    <div>
      <div className="page-head"><div><h1>Payments and refunds</h1><div className="muted">Refunds are sent automatically within 24 hours of a cancellation.</div></div></div>
      {rows.length === 0 ? <Empty>No payments yet.</Empty> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Created</th><th>Reference</th><th>Facility</th><th className="num-cell">Amount</th><th>Method</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.reference}>
                  <td>{dateTime(p.created_at)}</td>
                  <td className="mono small">{p.reference}</td>
                  <td>{p.facility_name}</td>
                  <td className="num-cell">{naira(p.amount)}</td>
                  <td>{p.gateway === 'counter' ? 'At counter' : p.method ?? '—'}</td>
                  <td><StatusBadge status={p.status} />{p.status === 'refund_pending' && <div className="tiny muted">due {dateTime(p.refund_due_at)}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Facilities() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => api<any[]>(`/admin/facilities?q=${encodeURIComponent(q)}`).then(setRows), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <div className="page-head"><div><h1>All facilities</h1></div><input className="filled" style={{ maxWidth: 280 }} placeholder="Search name or area" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!rows ? <Spinner /> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Area</th><th>Status</th><th>Last update</th><th className="num-cell">Reliability</th><th className="num-cell">Complaints</th></tr></thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <td><a href={`/facility/${f.id}`}>{f.name}</a></td>
                  <td>{f.type}</td>
                  <td>{f.area ?? '—'}</td>
                  <td><StatusBadge status={f.verification_status} /></td>
                  <td>{dateTime(f.last_updated)}</td>
                  <td className="num-cell">{Math.round(f.reliability_score * 100)}%</td>
                  <td className="num-cell">{f.open_complaints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Catalogue() {
  const [drugs, setDrugs] = useState<any[] | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ brandName: '', genericName: '', strength: '', form: 'Tablet', category: '' });
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    api<any[]>(`/catalogue${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setDrugs);
    api<any[]>('/admin/catalogue-requests').then(setRequests);
  };
  useEffect(load, [q]);
  return (
    <div>
      <div className="page-head"><div><h1>Drug catalogue</h1><div className="muted">Pharmacies can only list medicines in the catalogue, which keeps names consistent for search.</div></div></div>
      {requests.some((r) => r.status === 'open') && (
        <section className="card stack" style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Requests from facilities</h2>
          {requests.filter((r) => r.status === 'open').map((r) => (
            <div key={r.id} className="req">
              <span><strong>{r.name}</strong> <span className="small muted">· {r.facility_name} · {dateTime(r.created_at)}</span></span>
              <span className="row">
                <button className="btn small" onClick={() => api(`/admin/catalogue-requests/${r.id}`, { body: { status: 'declined' } }).then(load)}>Decline</button>
                <button className="btn small primary" onClick={() => { setForm({ ...form, brandName: r.name }); api(`/admin/catalogue-requests/${r.id}`, { body: { status: 'added' } }).then(load); }}>Mark added</button>
              </span>
            </div>
          ))}
        </section>
      )}
      <form className="card" style={{ marginBottom: '1rem' }} onSubmit={async (e) => { e.preventDefault(); try { await api('/catalogue', { body: form }); setForm({ brandName: '', genericName: '', strength: '', form: 'Tablet', category: '' }); setError(null); load(); } catch (err) { setError(errorText(err)); } }}>
        <h2>Add a medicine</h2>
        <div className="form-grid">
          <input placeholder="Brand name" value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })} required aria-label="Brand name" />
          <input placeholder="Generic name" value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} required aria-label="Generic name" />
          <input placeholder="Strength, e.g. 500mg" value={form.strength} onChange={(e) => setForm({ ...form, strength: e.target.value })} aria-label="Strength" />
          <input placeholder="Form, e.g. Tablet" value={form.form} onChange={(e) => setForm({ ...form, form: e.target.value })} aria-label="Form" />
          <input placeholder="Category, e.g. Antibiotic" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} aria-label="Category" />
          <button className="btn primary">Add</button>
        </div>
        <ErrorBox error={error} />
      </form>
      <div className="card stack">
        <input className="filled" placeholder="Search the catalogue" value={q} onChange={(e) => setQ(e.target.value)} />
        {!drugs ? <Spinner /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Brand</th><th>Generic</th><th>Strength</th><th>Form</th><th>Category</th></tr></thead>
              <tbody>{drugs.map((d) => <tr key={d.id}><td>{d.brand_name}</td><td>{d.generic_name}</td><td>{d.strength}</td><td>{d.form}</td><td>{d.category}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminReports({ stats }: { stats: Stats | null }) {
  const [unmet, setUnmet] = useState<any[] | null>(null);
  const [audit, setAudit] = useState<any[] | null>(null);
  const [entity, setEntity] = useState('');
  useEffect(() => {
    api<any[]>('/admin/unmet-searches').then(setUnmet);
  }, []);
  useEffect(() => {
    api<any[]>(`/admin/audit${entity ? `?entity=${entity}` : ''}`).then(setAudit);
  }, [entity]);
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Reports</h1><div className="muted">Pilot success measures from the PRD, unmet demand and the audit log.</div></div></div>
      <div className="kpis">
        <div className="kpi"><div className="k">Facilities updated in 24 h</div><div className="v">{stats?.pct_updated_24h ?? '—'}%</div><div className="s muted">target ≥ 80%</div></div>
        <div className="kpi"><div className="k">Payment success</div><div className="v">{stats?.payment_success_pct ?? '—'}%</div><div className="s muted">target ≥ 95%</div></div>
        <div className="kpi"><div className="k">Searches, last 7 days</div><div className="v">{stats?.searches_7d ?? '…'}</div><div className="s muted">{stats?.unmet_searches_7d ?? 0} found nothing</div></div>
        <div className="kpi"><div className="k">Registered patients</div><div className="v">{stats?.patients ?? '…'}</div><div className="s muted">{stats?.facilities_live ?? 0} live facilities</div></div>
      </div>
      <section className="card">
        <h2>What people could not find (30 days)</h2>
        {!unmet ? <Spinner /> : unmet.length === 0 ? <p className="muted">Nothing unmet.</p> : (
          <table><thead><tr><th>Search</th><th>Interpreted as</th><th className="num-cell">Times</th><th>Last</th></tr></thead>
            <tbody>{unmet.map((r, i) => <tr key={i}><td>{r.query}</td><td className="small muted">{r.target ?? 'not recognised'}</td><td className="num-cell">{r.times}</td><td>{dateTime(r.last_searched)}</td></tr>)}</tbody></table>
        )}
      </section>
      <section className="card stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Audit log</h2>
          <select style={{ width: 'auto' }} value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filter">
            <option value="">All entities</option>
            {['facility', 'specialist', 'inventory_item', 'resource', 'order', 'payment', 'bed_request', 'feedback', 'document'].map((e) => <option key={e}>{e}</option>)}
          </select>
        </div>
        {!audit ? <Spinner /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>
                {audit.map((r) => (
                  <tr key={r.id}>
                    <td className="small">{dateTime(r.created_at)}</td>
                    <td className="small">{r.actor_name ?? 'system'}{r.actor_role ? ` (${r.actor_role})` : ''}</td>
                    <td>{r.action}</td>
                    <td className="small muted" style={{ maxWidth: 380, wordBreak: 'break-word' }}>{r.details ? JSON.stringify(r.details) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
