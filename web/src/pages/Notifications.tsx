import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, Field, Spinner } from '../components/common';
import { api, errorText } from '../lib/api';
import { dateTime } from '../lib/format';
import { useSocketEvent } from '../lib/socket';

interface Note {
  id: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export function Notifications() {
  const [items, setItems] = useState<Note[] | null>(null);
  const load = () => api<{ items: Note[] }>('/notifications').then((r) => setItems(r.items));
  useEffect(() => {
    load().then(() => api('/notifications/read-all', { method: 'POST' }));
  }, []);
  useSocketEvent('notification', () => load());

  if (!items) return <Spinner />;
  return (
    <div className="stack">
      <h1>Notifications</h1>
      {items.length === 0 && <Empty>Nothing yet.</Empty>}
      {items.map((n) => (
        <div key={n.id} className="card" style={n.read_at ? {} : { borderColor: 'var(--brand)' }}>
          <div className="spread">
            <strong>{n.title}</strong>
            <span className="small muted">{dateTime(n.created_at)}</span>
          </div>
          <p className="small">{n.body}</p>
          {n.link && <Link to={n.link} className="small">Open</Link>}
        </div>
      ))}
    </div>
  );
}

/** FR-13: users can raise a complaint about a facility for admin review. */
export function Complaint() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [comment, setComment] = useState('');
  const [category, setCategory] = useState('Wrong stock');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/feedback', { body: { type: 'complaint', facilityId: params.get('facility'), orderId: params.get('order') ?? undefined, comment, category } });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (done)
    return (
      <div className="card stack">
        <div className="alert ok">Thank you. Our team will review this and contact you.</div>
        <button className="btn" onClick={() => navigate(-1)}>Back</button>
      </div>
    );
  return (
    <form className="card stack" onSubmit={submit}>
      <h1>Report a problem</h1>
      <Field label="What kind of problem?">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="Wrong stock">Drug listed but not in the shop</option>
          <option value="Refund">Refund not received</option>
          <option value="Contact">Phone number not reachable</option>
          <option value="Price">Wrong price</option>
          <option value="Service">Poor service</option>
          <option value="Other">Something else</option>
        </select>
      </Field>
      <Field label="What went wrong?" hint="For example: item listed but not available, wrong price, rude staff, unlicensed practice.">
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} minLength={10} maxLength={1000} required />
      </Field>
      <ErrorBox error={error} />
      <button className="btn primary">Send</button>
    </form>
  );
}
