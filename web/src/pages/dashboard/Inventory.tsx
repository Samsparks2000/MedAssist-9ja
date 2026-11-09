import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorBox, Field, SampleNote, Spinner } from '../../components/common';
import { FileIcon } from '../../components/Icons';
import { api, errorText } from '../../lib/api';
import { downloadFile } from '../../lib/download';
import { date, monthYear, naira } from '../../lib/format';
import type { Facility } from './Dashboard';

interface Item {
  id: string;
  drug_id: string;
  brand_name: string;
  generic_name: string;
  strength: string;
  form: string;
  category: string | null;
  quantity: number;
  reserved: number;
  price: number;
  cost_price: number | null;
  batch_no: string;
  expiry_date: string;
  reorder_level: number;
  days_to_expiry: number;
  needs_prescription: boolean;
  refrigerated: boolean;
}

interface Drug {
  id: string;
  brand_name: string;
  generic_name: string;
  strength: string;
  form: string;
  category: string | null;
}

const label = (d: { brand_name: string; generic_name?: string; strength?: string; form?: string }) =>
  `${d.generic_name && d.generic_name !== d.brand_name ? `${d.generic_name} (${d.brand_name})` : d.brand_name} ${d.strength ?? ''}`.trim();

function status(i: Item, lowDrugs: Set<string>) {
  if (i.days_to_expiry <= 0) return { text: 'Expired', cls: 'danger' };
  if (i.quantity - i.reserved <= 0) return { text: 'Out of stock', cls: 'danger' };
  if (i.days_to_expiry <= 30) return { text: `Expires in ${i.days_to_expiry} days`, cls: 'danger' };
  if (lowDrugs.has(i.drug_id)) return { text: 'Low', cls: 'warn' };
  if (i.days_to_expiry <= 90) return { text: `Expires in ${i.days_to_expiry} days`, cls: 'warn' };
  return { text: 'In stock', cls: 'ok' };
}

/** Inventory table (design pages 11 and 20). `preview` shows the first rows on the overview. */
export function InventoryTable({ preview = false }: { preview?: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') ?? 'all';
  const [text, setText] = useState('');
  const [edit, setEdit] = useState<Record<string, { quantity: number; price: number; reorderLevel: number }>>({});
  const [limit, setLimit] = useState(preview ? 6 : 30);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => api<Item[]>('/inventory').then(setItems), []);
  useEffect(() => {
    reload();
  }, [reload]);

  const lowDrugs = useMemo(() => {
    const byDrug = new Map<string, { stock: number; level: number }>();
    for (const i of items ?? []) {
      const cur = byDrug.get(i.drug_id) ?? { stock: 0, level: 0 };
      if (i.days_to_expiry > 0) cur.stock += i.quantity - i.reserved;
      cur.level = Math.max(cur.level, i.reorder_level);
      byDrug.set(i.drug_id, cur);
    }
    return new Set([...byDrug].filter(([, v]) => v.level > 0 && v.stock <= v.level).map(([k]) => k));
  }, [items]);

  if (!items) return <Spinner />;
  const shown = items
    .filter((i) => filter !== 'low' || lowDrugs.has(i.drug_id))
    .filter((i) => filter !== 'expiring' || i.days_to_expiry <= 90)
    .filter((i) => filter !== 'out' || i.quantity - i.reserved <= 0)
    .filter((i) => !text || `${i.brand_name} ${i.generic_name} ${i.batch_no}`.toLowerCase().includes(text.toLowerCase()));

  const save = async (i: Item) => {
    const e = edit[i.id];
    try {
      await api(`/inventory/${i.id}`, { method: 'PATCH', body: { quantity: e.quantity, price: e.price, reorderLevel: e.reorderLevel, reason: 'Stock count' } });
      setEdit(({ [i.id]: _, ...rest }) => rest);
      setError(null);
      reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="stack">
      <div className="spread">
        <h2 style={{ margin: 0 }}>Inventory <span className="small muted" style={{ fontFamily: 'var(--font)', fontWeight: 400 }}>· {items.length} items</span></h2>
        <div className="row">
          <input className="filled" style={{ width: 240 }} placeholder="Search medicine or batch" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search medicine or batch" />
          <select style={{ width: 'auto' }} value={filter} onChange={(e) => setParams(e.target.value === 'all' ? {} : { filter: e.target.value })} aria-label="Filter">
            <option value="all">All items</option>
            <option value="low">Low stock</option>
            <option value="expiring">Expiring ≤ 90 days</option>
            <option value="out">Out of stock</option>
          </select>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th className="num-cell">In stock</th><th className="num-cell">Reorder at</th><th className="num-cell">Price</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((i) => {
              const e = edit[i.id];
              const s = status(i, lowDrugs);
              return (
                <tr key={i.id}>
                  <td>{label(i)} <span className="muted small">{i.form}</span></td>
                  <td className="mono">{i.batch_no}</td>
                  <td className={i.days_to_expiry <= 30 ? 'danger-text' : ''}>{i.days_to_expiry <= 30 ? date(i.expiry_date) : monthYear(i.expiry_date)}</td>
                  <td className="num-cell">
                    {e ? <input type="number" min={i.reserved} style={{ width: 80 }} value={e.quantity} onChange={(ev) => setEdit({ ...edit, [i.id]: { ...e, quantity: Number(ev.target.value) } })} aria-label="Quantity" /> : <>{i.quantity - i.reserved}{i.reserved > 0 && <span className="muted"> +{i.reserved} held</span>}</>}
                  </td>
                  <td className="num-cell">
                    {e ? <input type="number" min={0} style={{ width: 70 }} value={e.reorderLevel} onChange={(ev) => setEdit({ ...edit, [i.id]: { ...e, reorderLevel: Number(ev.target.value) } })} aria-label="Reorder level" /> : i.reorder_level}
                  </td>
                  <td className="num-cell">
                    {e ? <input type="number" min={0} style={{ width: 100 }} value={e.price} onChange={(ev) => setEdit({ ...edit, [i.id]: { ...e, price: Number(ev.target.value) } })} aria-label="Price" /> : naira(i.price)}
                  </td>
                  <td><span className={`badge ${s.cls}`}>{s.text}</span></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {e ? (
                      <>
                        <button className="btn small primary" onClick={() => save(i)}>Save</button>{' '}
                        <button className="btn small ghost" onClick={() => setEdit(({ [i.id]: _, ...rest }) => rest)}>Cancel</button>
                      </>
                    ) : i.quantity - i.reserved <= 0 || i.days_to_expiry <= 0 ? (
                      <Link className="btn link" to={`/dashboard/inventory/add?drug=${i.drug_id}`}>Restock</Link>
                    ) : (
                      <button className="btn link" onClick={() => setEdit({ ...edit, [i.id]: { quantity: i.quantity, price: i.price, reorderLevel: i.reorder_level } })}>Edit</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="spread">
        <span className="small muted">Showing {Math.min(limit, shown.length)} of {shown.length} · “+1 held” means reserved for a customer</span>
        {shown.length > limit && (preview ? <Link className="btn small" to="/dashboard/inventory">Show more</Link> : <button className="btn small" onClick={() => setLimit(limit + 50)}>Show more</button>)}
      </div>
    </div>
  );
}

export function Inventory() {
  return (
    <div>
      <div className="page-head">
        <div><h1>Inventory</h1><div className="muted">Every change here updates what patients see within seconds.</div></div>
        <div className="btn-row">
          <Link className="btn" to="/dashboard/inventory/add?tab=upload">Upload a spreadsheet</Link>
          <Link className="btn primary" to="/dashboard/inventory/add">Add stock</Link>
        </div>
      </div>
      <div className="card"><InventoryTable /></div>
    </div>
  );
}

interface UploadError {
  row: number;
  message: string;
  kind?: 'unknown_drug' | 'expired' | 'price' | 'other';
  raw?: string;
  suggestion?: { drugId: string; label: string };
  fields?: { drugId: string | null; quantity: number | null; price: number | null; batchNo: string; expiryDate: string | null; reorderLevel: number };
}
interface UploadResult {
  valid: number;
  errors: UploadError[];
  preview: { row: number; drugId: string; drugLabel: string; quantity: number; price: number; batchNo: string; expiryDate: string; reorderLevel: number }[];
}

/** Add stock (design page 20): one item with a live patient preview, or a spreadsheet with fix-ups. */
export function AddStock({ facility }: { facility: Facility }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'one' | 'upload'>(params.get('tab') === 'upload' ? 'upload' : 'one');
  return (
    <div>
      <Link to="/dashboard/inventory" className="small">← Back to inventory</Link>
      <div className="page-head" style={{ marginTop: '0.5rem' }}>
        <div><h1>Add stock</h1><div className="muted">Add a delivery from your supplier. Patients see the new stock as soon as you save.</div></div>
      </div>
      <div className="tabs">
        <button className={tab === 'one' ? 'on' : ''} onClick={() => setTab('one')}>Add one item</button>
        <button className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>Upload a spreadsheet</button>
      </div>
      {tab === 'one' ? <AddOne facility={facility} onDone={() => navigate('/dashboard/inventory')} /> : null}
      <div className="mt"><SpreadsheetUpload /></div>
      <SampleNote>Medicines, batches, prices and counts shown are sample data.</SampleNote>
    </div>
  );
}

function AddOne({ facility, onDone }: { facility: Facility; onDone: () => void }) {
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<Drug[]>([]);
  const [drug, setDrug] = useState<Drug | null>(null);
  const [demand, setDemand] = useState<{ searches: number; available: number; listed: boolean } | null>(null);
  const [form, setForm] = useState({ batchNo: '', expiry: '', quantity: '', price: '', cost: '', reorder: '', rx: false, cold: false, reservable: true });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const id = params.get('drug');
    if (id) api<Drug[]>('/catalogue').then((all) => { const d = all.find((x) => x.id === id); if (d) pick(d); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (drug || q.trim().length < 2) return setMatches([]);
    const t = setTimeout(() => api<Drug[]>(`/catalogue?q=${encodeURIComponent(q)}`).then(setMatches).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q, drug]);

  const pick = (d: Drug) => {
    setDrug(d);
    setMatches([]);
    const rx = ['Insulin', 'Antibiotic', 'Antidiabetic', 'Antihypertensive', 'Obstetric', 'Emergency'].includes(d.category ?? '');
    setForm((f) => ({ ...f, rx, cold: ['Insulin', 'Obstetric'].includes(d.category ?? '') }));
    api(`/inventory/demand/${d.id}`).then(setDemand).catch(() => setDemand(null));
  };

  // A month picker gives "2028-04"; stock is listed until the end of that month.
  const expiryDate = form.expiry ? new Date(Date.UTC(Number(form.expiry.slice(0, 4)), Number(form.expiry.slice(5, 7)), 0)).toISOString().slice(0, 10) : '';

  const submit = async (again: boolean) => {
    if (!drug) return;
    try {
      await api('/inventory', {
        body: {
          drugId: drug.id, batchNo: form.batchNo, expiryDate, quantity: Number(form.quantity), price: Number(form.price),
          costPrice: form.cost ? Number(form.cost) : null, reorderLevel: Number(form.reorder || 0),
          needsPrescription: form.rx, refrigerated: form.cold, allowReservations: form.reservable,
        },
      });
      setError(null);
      if (!again) return onDone();
      setMsg(`${label(drug)} saved.`);
      setDrug(null);
      setQ('');
      setDemand(null);
      setForm({ batchNo: '', expiry: '', quantity: '', price: '', cost: '', reorder: '', rx: false, cold: false, reservable: true });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const requestCatalogue = async () => {
    const name = prompt('Which medicine should we add? Include strength and pack, e.g. "Amoxicillin 250 mg suspension 100 ml"', q);
    if (!name) return;
    await api('/catalogue/requests', { body: { name } });
    setMsg('Thanks — we will add it and let you know.');
  };

  return (
    <div className="layout-side">
      <form className="card" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
        <div className="suggest-wrap field">
          <label htmlFor="med">Medicine</label>
          <input id="med" value={drug ? label(drug) + ` ${drug.form}` : q} onChange={(e) => { setDrug(null); setQ(e.target.value); setDemand(null); }} placeholder="Start typing, e.g. Amoxicillin 500" autoComplete="off" required />
          {!drug && q.trim().length >= 2 && (
            <div className="suggestions">
              {matches.slice(0, 6).map((d) => (
                <button type="button" key={d.id} onMouseDown={() => pick(d)}>
                  <span><strong>{label(d)} {d.form.toLowerCase()}</strong> <span className="muted small">· {d.category?.toLowerCase()}</span></span>
                </button>
              ))}
              <div className="small muted" style={{ padding: '0.6rem 1rem' }}>Not listed? <button type="button" className="btn link" onMouseDown={requestCatalogue}>Ask us to add it to the catalogue</button></div>
            </div>
          )}
        </div>
        <div className="form-grid">
          <Field label="Batch number"><input className="mono" value={form.batchNo} onChange={(e) => setForm({ ...form, batchNo: e.target.value })} required /></Field>
          <Field label="Expiry date"><input type="month" value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} required /></Field>
          <Field label="Packs received"><input className="mono" type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required /></Field>
          <Field label="Selling price per pack (₦)"><input className="mono" type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></Field>
          <Field label={<>Cost price (₦) <span className="opt">· private</span></>}><input className="mono" type="number" min={0} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
          <Field label="Alert me when below"><input className="mono" type="number" min={0} value={form.reorder} onChange={(e) => setForm({ ...form, reorder: e.target.value })} /></Field>
        </div>
        <div className="row" style={{ gap: '1.5rem' }}>
          <label className="check"><input type="checkbox" checked={form.rx} onChange={(e) => setForm({ ...form, rx: e.target.checked })} />Needs a prescription</label>
          <label className="check"><input type="checkbox" checked={form.cold} onChange={(e) => setForm({ ...form, cold: e.target.checked })} />Keep refrigerated</label>
          <label className="check"><input type="checkbox" checked={form.reservable} onChange={(e) => setForm({ ...form, reservable: e.target.checked })} />Allow reservations</label>
        </div>
        <hr className="divider" />
        <ErrorBox error={error} />
        {msg && <div className="alert ok">{msg}</div>}
        <div className="btn-row">
          <button className="btn primary" disabled={!drug}>Save</button>
          <button type="button" className="btn" disabled={!drug} onClick={() => submit(true)}>Save and add another</button>
        </div>
      </form>
      <aside className="stack">
        <div className="eyebrow" style={{ color: 'var(--muted)' }}>How patients will see it</div>
        <div className="preview-card stack">
          <h3 style={{ margin: 0 }}>{facility.name}</h3>
          <div className="item-line" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <strong>{drug ? `${label(drug)} · ${drug.form}` : 'Choose a medicine'}</strong>
            <span><span className="mono">{form.price ? naira(Number(form.price)) : '₦—'}</span> <span className="ok-text small">In stock</span></span>
          </div>
          <span className="small muted">{form.rx ? 'Needs a prescription · ' : ''}updated just now</span>
        </div>
        {drug && demand && (
          <div className="card tint" style={{ borderColor: 'transparent' }}>
            {demand.listed && demand.available <= 0 ? <>This item was <strong>out of stock</strong>. After you save, it shows in search again. </> : null}
            {demand.searches > 0 ? <><strong>{demand.searches} {demand.searches === 1 ? 'person' : 'people'}</strong> nearby searched for it this week.</> : 'Patients nearby will see it as soon as you save.'}
          </div>
        )}
      </aside>
    </div>
  );
}

/** Spreadsheet upload with one-click fixes for rows that need checking (US-16). */
function SpreadsheetUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [fixed, setFixed] = useState<Record<number, NonNullable<UploadError['fields']> & { label: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async (f: File) => {
    setFile(f);
    setBusy(true);
    setDone(null);
    setFixed({});
    const form = new FormData();
    form.append('file', f);
    try {
      setResult(await api<UploadResult>('/inventory/upload?dryRun=true', { form, method: 'POST' }));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = [
    ...(result?.preview ?? []).map((r) => ({ drugId: r.drugId, quantity: r.quantity, price: r.price, batchNo: r.batchNo, expiryDate: r.expiryDate, reorderLevel: r.reorderLevel })),
    ...Object.values(fixed).map((f) => ({ drugId: f.drugId!, quantity: f.quantity!, price: f.price!, batchNo: f.batchNo, expiryDate: f.expiryDate!, reorderLevel: f.reorderLevel })),
  ];
  const remaining = (result?.errors ?? []).filter((e) => !fixed[e.row]);

  const fix = (e: UploadError) => {
    const base = { ...e.fields!, label: e.raw ?? '' };
    if (e.kind === 'unknown_drug' && e.suggestion) return setFixed({ ...fixed, [e.row]: { ...base, drugId: e.suggestion.drugId, label: e.suggestion.label } });
    if (e.kind === 'expired') {
      const v = prompt('New expiry date (YYYY-MM-DD)');
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v > new Date().toISOString().slice(0, 10)) setFixed({ ...fixed, [e.row]: { ...base, expiryDate: v } });
      return;
    }
    if (e.kind === 'price') {
      const v = Number(prompt('Selling price (₦)'));
      if (v > 0) setFixed({ ...fixed, [e.row]: { ...base, price: v } });
    }
  };

  const importAll = async () => {
    setBusy(true);
    try {
      const r = await api<{ created: number; updated: number }>('/inventory/import', { body: { rows: ready } });
      setDone(`Added ${r.created} new batches and updated ${r.updated}.${remaining.length ? ` ${remaining.length} rows still need fixing.` : ''}`);
      setResult(null);
      setFile(null);
      setFixed({});
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack">
      <div className="spread">
        <div>
          <h2 style={{ margin: 0 }}>Or upload a spreadsheet</h2>
          <p className="muted" style={{ margin: 0 }}>Best for your first setup or a big delivery. Columns: medicine, strength, batch, expiry, quantity, price.</p>
        </div>
        <button className="btn" onClick={() => downloadFile('/inventory/template.csv', 'medassist-stock-template.csv')}>Get the template</button>
      </div>
      <label className="dropzone">
        <input type="file" accept=".csv,.xlsx" hidden onChange={(e) => e.target.files?.[0] && check(e.target.files[0])} />
        <strong>{busy ? 'Reading…' : 'Choose an Excel or CSV file'}</strong>
        <div className="small muted">.xlsx or .csv, up to 5 MB</div>
      </label>
      <ErrorBox error={error} />
      {done && <div className="alert ok">{done}</div>}
      {result && file && (
        <>
          <div className="file-chip spread">
            <span className="row"><FileIcon /><strong>{file.name}</strong> · {result.valid + result.errors.length} rows read</span>
            <span><span className="ok-text">{ready.length} ready</span>{remaining.length > 0 && <> · <span className="warn-text">{remaining.length} need checking</span></>}</span>
          </div>
          {result.errors.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Row</th><th>In your file</th><th>Problem</th><th /></tr></thead>
                <tbody>
                  {result.errors.map((e) => (
                    <tr key={e.row}>
                      <td className="mono">{e.row}</td>
                      <td>{e.raw}</td>
                      <td className={fixed[e.row] ? 'ok-text' : e.kind === 'expired' ? 'danger-text' : 'warn-text'}>
                        {fixed[e.row] ? `Fixed${e.kind === 'unknown_drug' ? `: ${fixed[e.row].label}` : ''}` : e.kind === 'unknown_drug' && e.suggestion ? <>Did you mean <strong>{e.suggestion.label}</strong>?</> : e.message}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {!fixed[e.row] && e.kind === 'unknown_drug' && e.suggestion && <button className="btn small outline" onClick={() => fix(e)}>Yes, use it</button>}
                        {!fixed[e.row] && e.kind === 'expired' && <button className="btn small" onClick={() => fix(e)}>Edit date</button>}
                        {!fixed[e.row] && e.kind === 'price' && <button className="btn small" onClick={() => fix(e)}>Add price</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="row">
            <button className="btn primary" disabled={busy || ready.length === 0} onClick={importAll}>Add the {ready.length} ready items</button>
            {remaining.length > 0 && <span className="small muted">Fix the other {remaining.length} now or later.</span>}
          </div>
        </>
      )}
    </section>
  );
}

/** US-17: counter sale; stock is deducted first-expiry-first-out and expired batches are refused. */
export function Sell() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [lines, setLines] = useState<{ drugId: string; quantity: number }[]>([]);
  const [pick, setPick] = useState('');
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => api<Item[]>('/inventory').then(setItems);
  useEffect(() => {
    reload();
  }, []);

  const drugs = useMemo(() => {
    const m = new Map<string, { label: string; stock: number; price: number }>();
    for (const i of items ?? []) {
      if (i.days_to_expiry <= 0) continue;
      const cur = m.get(i.drug_id) ?? { label: `${label(i)} ${i.form}`, stock: 0, price: i.price };
      cur.stock += i.quantity - i.reserved;
      m.set(i.drug_id, cur);
    }
    return m;
  }, [items]);

  if (!items) return <Spinner />;
  const total = lines.reduce((s, l) => s + (drugs.get(l.drugId)?.price ?? 0) * l.quantity, 0);

  return (
    <div>
      <div className="page-head"><div><h1>Record a sale</h1><div className="muted">Stock goes down automatically, oldest batch first. Expired batches are never sold.</div></div></div>
      <div className="card stack" style={{ maxWidth: 680 }}>
        <div className="row">
          <select style={{ flex: 2, minWidth: 220 }} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Medicine">
            <option value="">Choose a medicine…</option>
            {[...drugs].filter(([, d]) => d.stock > 0).map(([id, d]) => <option key={id} value={id}>{d.label} ({d.stock} available)</option>)}
          </select>
          <input style={{ flex: 1, minWidth: 80 }} className="mono" type="number" min={1} aria-label="Quantity" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} />
          <button className="btn" disabled={!pick} onClick={() => { setLines([...lines.filter((l) => l.drugId !== pick), { drugId: pick, quantity: qty }]); setPick(''); setQty(1); }}>Add</button>
        </div>
        {lines.length > 0 && (
          <dl className="kv">
            {lines.map((l) => (
              <div key={l.drugId} style={{ display: 'contents' }}>
                <dt>{l.quantity} × {drugs.get(l.drugId)?.label} <button className="btn link small" onClick={() => setLines(lines.filter((x) => x !== l))}>remove</button></dt>
                <dd className="mono">{naira((drugs.get(l.drugId)?.price ?? 0) * l.quantity)}</dd>
              </div>
            ))}
            <dt><strong>Estimated total</strong></dt><dd className="mono"><strong>{naira(total)}</strong></dd>
          </dl>
        )}
        <ErrorBox error={error} />
        {msg && <div className="alert ok">{msg}</div>}
        <button
          className="btn primary big"
          disabled={!lines.length}
          onClick={async () => {
            try {
              const r = await api<{ total: number }>('/inventory/sales', { body: { items: lines } });
              setMsg(`Sale recorded: ${naira(r.total)}. Stock and the public listing are updated.`);
              setError(null);
              setLines([]);
              reload();
            } catch (e) {
              setError(errorText(e));
              setMsg(null);
            }
          }}
        >
          Complete sale
        </button>
      </div>
    </div>
  );
}
