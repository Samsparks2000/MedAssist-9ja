import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBox, SampleNote, Spinner, StatusBadge } from '../../components/common';
import { Shell, type NavItem } from '../../components/Shell';
import { api, errorText } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { minutesSince, time, updatedLabel } from '../../lib/format';
import { useSocketEvent } from '../../lib/socket';
import { Register } from '../Register';
import { BedRequestsInbox } from './BedRequests';
import { BedsAndServices, Rota } from './Hospital';
import { AddStock, Inventory, InventoryTable, Sell } from './Inventory';
import { Payouts, Reports, Staff } from './More';
import { ReservationList, Reservations } from './Reservations';
import { SpecialistDashboard } from './Specialist';

export interface Facility {
  id: string;
  name: string;
  type: 'pharmacy' | 'hospital';
  area: string | null;
  address: string;
  verification_status: string;
  verification_note: string | null;
  last_updated: string;
  open_24h: boolean;
  opening_hours: Record<string, [string, string] | null>;
  payout_subaccount: string | null;
  owner_id: string;
}

export interface Overview {
  reservations: number;
  needs_answer: number;
  low_stock: number;
  expiring: number;
  soonest_expiry_days: number | null;
  bed_requests: number;
  missedSearches: number;
  missedTop: { label: string; target: string; times: number }[];
}

function greeting() {
  const h = Number(new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', hour12: false }));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const fmt12 = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
};

export function Dashboard() {
  const { me } = useAuth();
  const [facility, setFacility] = useState<Facility | null | undefined>(undefined);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const role = me?.user.role;

  const load = useCallback(async () => {
    if (role !== 'pharmacy' && role !== 'hospital') return;
    try {
      const f = await api<Facility>('/facilities/mine');
      setFacility(f);
      api<Overview>('/reports/overview').then(setOverview).catch(() => {});
    } catch (e) {
      if ((e as { status?: number }).status === 404) setFacility(null);
      else setError(errorText(e));
    }
  }, [role]);
  useEffect(() => {
    load();
  }, [load]);
  useSocketEvent('order', () => load(), [load]);
  useSocketEvent('bed-request', () => load(), [load]);
  useSocketEvent('notification', () => load(), [load]);

  if (!me) return <Spinner />;
  if (role === 'specialist') {
    return (
      <Shell nav={[{ to: '/dashboard', label: 'My availability', end: true }, { to: '/dashboard/profile', label: 'Profile and schedule' }]} who={{ title: `${me.user.name ?? 'Doctor'}`, subtitle: me.specialist?.specialty ?? 'Specialist' }}>
        <Routes>
          <Route index element={<SpecialistDashboard />} />
          <Route path="profile" element={<Register />} />
        </Routes>
      </Shell>
    );
  }
  if (error) return <div className="container"><ErrorBox error={error} /></div>;
  if (facility === undefined) return <div className="container mt"><Spinner /></div>;
  if (facility === null || facility.verification_status === 'draft') return <Navigate to="/register" replace />;

  const isHospital = facility.type === 'hospital';
  const nav: NavItem[] = isHospital
    ? [
        { to: '/dashboard', label: 'Beds and services', end: true },
        { to: '/dashboard/bed-requests', label: 'Bed requests', count: overview?.bed_requests },
        { to: '/dashboard/specialists', label: 'Specialists and rota' },
        { to: '/dashboard/inventory', label: 'Supplies and pharmacy' },
        { to: '/dashboard/reservations', label: 'Reservations', count: overview?.needs_answer },
        { to: '/dashboard/reports', label: 'Reports' },
        { to: '/dashboard/profile', label: 'Hospital profile' },
        { to: '/dashboard/staff', label: 'Staff accounts' },
        { to: '/dashboard/payouts', label: 'Payouts' },
      ]
    : [
        { to: '/dashboard', label: 'Overview', end: true },
        { to: '/dashboard/inventory', label: 'Inventory' },
        { to: '/dashboard/reservations', label: 'Reservations', count: overview?.needs_answer },
        { to: '/dashboard/sell', label: 'Record a sale' },
        { to: '/dashboard/reports', label: 'Reports' },
        { to: '/dashboard/profile', label: 'Pharmacy profile' },
        { to: '/dashboard/staff', label: 'Staff accounts' },
        { to: '/dashboard/payouts', label: 'Payouts' },
      ];
  const verified = facility.verification_status === 'approved';

  return (
    <Shell nav={nav} who={{ title: facility.name, subtitle: `${verified ? 'Verified' : 'Not yet live'} · ${facility.area ?? ''}${facility.address.endsWith('Lagos') ? ', Lagos' : ', Ibadan'}` }}>
      {!verified && (
        <div className={`alert ${facility.verification_status === 'rejected' || facility.verification_status === 'suspended' ? 'danger' : 'warn'}`} style={{ marginBottom: '1rem' }}>
          <StatusBadge status={facility.verification_status} />{' '}
          {facility.verification_status === 'pending' && 'We are checking your licence. You will not appear in search until it is approved — you can add stock now.'}
          {facility.verification_status === 'info_requested' && <>We need more information: {facility.verification_note}. <Link to="/dashboard/profile">Update your registration</Link>.</>}
          {facility.verification_status === 'rejected' && <>Not approved: {facility.verification_note}. <Link to="/dashboard/profile">Fix and resubmit</Link>.</>}
          {facility.verification_status === 'suspended' && <>Your listing is suspended: {facility.verification_note}</>}
        </div>
      )}
      <Routes>
        <Route index element={isHospital ? <BedsAndServices facility={facility} onSaved={load} /> : <PharmacyOverview facility={facility} overview={overview} onChange={load} />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="inventory/add" element={<AddStock facility={facility} />} />
        <Route path="sell" element={<Sell />} />
        <Route path="reservations" element={<Reservations onChange={load} />} />
        <Route path="bed-requests" element={<BedRequestsInbox />} />
        <Route path="specialists" element={<Rota />} />
        <Route path="reports" element={<Reports />} />
        <Route path="profile" element={<Register />} />
        <Route path="staff" element={<Staff />} />
        <Route path="payouts" element={<Payouts />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Shell>
  );
}

/** Pharmacy overview (design page 11). */
function PharmacyOverview({ facility, overview, onChange }: { facility: Facility; overview: Overview | null; onChange: () => void }) {
  const { me } = useAuth();
  const [alerts, setAlerts] = useState<{ low: any[]; expiring: any[] } | null>(null);
  const [outOfStock, setOutOfStock] = useState<any[]>([]);
  const age = minutesSince(facility.last_updated);
  const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long' });
  const hours = facility.open_24h ? 'open 24 hours' : (() => {
    const h = facility.opening_hours[DAYS[new Date().getDay()]];
    return h ? `open ${fmt12(h[0])} to ${fmt12(h[1])}` : 'closed today';
  })();

  const load = useCallback(() => {
    api('/inventory/alerts').then(setAlerts).catch(() => {});
    api<any[]>('/inventory').then((items) => {
      const byDrug = new Map<string, { label: string; qty: number; hidden: boolean }>();
      for (const i of items) {
        const cur = byDrug.get(i.drug_id) ?? { label: `${i.brand_name} ${i.strength}`, qty: 0, hidden: true };
        if (i.days_to_expiry > 0) cur.qty += i.quantity - i.reserved;
        byDrug.set(i.drug_id, cur);
      }
      setOutOfStock([...byDrug.values()].filter((d) => d.qty <= 0));
    });
  }, []);
  useEffect(() => load(), [load]);
  useSocketEvent('notification', () => load(), [load]);

  const firstName = me?.user.name?.replace(/^(Pharm\.|Dr\.|Mr\.|Mrs\.|Ms\.)\s*/, '') ?? '';
  const title = me?.user.name?.startsWith('Pharm.') ? `Pharm. ${firstName.split(' ')[0]}` : firstName.split(' ')[0];
  const alertItems = [
    ...outOfStock.map((d) => ({ cls: 'red', html: <><strong>{d.label} is out of stock.</strong> It is hidden from search until you add stock.</> })),
    ...(alerts?.expiring ?? []).filter((x) => x.days_to_expiry <= 30).map((x) => ({ cls: 'red', html: <><strong>{x.brand_name} {x.strength}, batch {x.batch_no},</strong> {x.days_to_expiry <= 0 ? 'has expired and is blocked from sale' : `expires in ${x.days_to_expiry} days`}. {x.quantity} left.</> })),
    ...(alerts?.low ?? []).map((l) => ({ cls: 'amber', html: <><strong>{l.brand_name} {l.strength}</strong> is low: {l.stock} left, reorder level {l.reorder_level}.</> })),
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{greeting()}{title ? `, ${title}` : ''}</h1>
          <div className="muted">{today} · stock last updated {updatedLabel(age).replace('Updated ', '').toLowerCase()}{age < 1440 ? ` at ${time(facility.last_updated)}` : ''} · {hours}</div>
        </div>
        <div className="btn-row">
          <Link className="btn" to="/dashboard/inventory/add?tab=upload">Upload stock (Excel/CSV)</Link>
          <Link className="btn" to="/dashboard/inventory/add">Add stock</Link>
          <Link className="btn primary" to="/dashboard/sell">Record a sale</Link>
        </div>
      </div>

      {age > 20 * 60 && (
        <div className="card warn spread" style={{ marginBottom: '1rem' }}>
          <span><strong>Your listing was last updated {updatedLabel(age).replace('Updated ', '')}.</strong> Patients see a warning after 24 hours and you are hidden after 72.</span>
          <button className="btn small" onClick={() => api('/facilities/mine/confirm', { method: 'POST' }).then(onChange)}>Stock is still correct</button>
        </div>
      )}

      <div className="kpis">
        <Link to="/dashboard/reservations" className="kpi">
          <div className="k">Reservations waiting</div>
          <div className="v">{overview?.reservations ?? '…'}</div>
          <div className="s warn-text">{overview?.needs_answer ? `${overview.needs_answer} need${overview.needs_answer === 1 ? 's' : ''} your answer` : 'none need an answer'}</div>
        </Link>
        <Link to="/dashboard/inventory?filter=low" className="kpi">
          <div className="k">Low on stock</div>
          <div className="v">{overview?.low_stock ?? '…'}</div>
          <div className="s warn-text">at or below reorder level</div>
        </Link>
        <Link to="/dashboard/inventory?filter=expiring" className="kpi">
          <div className="k">Expiring within 90 days</div>
          <div className="v">{overview?.expiring ?? '…'}</div>
          <div className="s danger-text">{overview?.soonest_expiry_days != null ? (overview.soonest_expiry_days <= 0 ? 'some already expired' : `1 expires in ${overview.soonest_expiry_days} days`) : ' '}</div>
        </Link>
        <Link to="/dashboard/reports" className="kpi">
          <div className="k">Searches you missed</div>
          <div className="v">{overview?.missedSearches ?? '…'}</div>
          <div className="s muted">this week, nearby, not in your stock</div>
        </Link>
      </div>

      <div className="layout-side" style={{ gridTemplateColumns: undefined }}>
        <section className="card">
          <h2>Reservations</h2>
          <ReservationList compact onChange={onChange} />
        </section>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Alerts</h2>
          {alertItems.length === 0 && <p className="muted small">No alerts. Nice.</p>}
          {alertItems.slice(0, 4).map((a, i) => <div key={i} className={`alert-item ${a.cls}`}><span>{a.html}</span></div>)}
          {alertItems.length > 4 && <div className="alert-item amber"><span><strong>{alertItems.length - 4} more items</strong> need attention.</span></div>}
          <Link to="/dashboard/inventory" className="small" style={{ fontWeight: 700 }}>See all in inventory</Link>
        </section>
      </div>

      <section className="card mt">
        <InventoryTable preview />
      </section>

      {overview && overview.missedTop.length > 0 && (
        <section className="card mt stack">
          <div>
            <h2 style={{ margin: 0 }}>People nearby searched for these</h2>
            <p className="muted small" style={{ margin: 0 }}>Within 5 km of your pharmacy this week, and not in your stock.</p>
          </div>
          <div className="grid4" style={{ gap: '0.6rem' }}>
            {overview.missedTop.map((m) => (
              <div key={m.target} className="card soft tight spread"><strong>{m.label}</strong><span className="mono">{m.times}</span></div>
            ))}
          </div>
        </section>
      )}
      <SampleNote>Customers, stock, batches and figures shown are sample data.</SampleNote>
    </div>
  );
}
