import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { STATUS_LABEL } from '../lib/format';
import { LogoMark } from './Icons';

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <div className="row muted" role="status">
    <div className="spinner" /> {label}…
  </div>
);

export const ErrorBox = ({ error }: { error: string | null | undefined }) =>
  error ? (
    <div className="alert danger" role="alert">
      {error}
    </div>
  ) : null;

const tone: Record<string, string> = {
  paid: 'ok', success: 'ok', collected: 'ok', approved: 'ok', accepted: 'ok', refunded: 'ok', reserved: 'ok', confirmed: 'ok', available: 'ok',
  pending_payment: 'warn', pending: 'warn', refund_pending: 'warn', requested: 'warn', info_requested: 'warn', draft: 'grey', under_repair: 'warn',
  cancelled: 'grey', expired: 'grey',
  rejected: 'danger', suspended: 'danger', failed: 'danger', unmatched: 'danger', declined: 'danger', not_available: 'danger',
};

export const StatusBadge = ({ status, label }: { status: string; label?: string }) => (
  <span className={`badge ${tone[status] ?? ''}`}>{label ?? STATUS_LABEL[status] ?? status}</span>
);

export function Field({ label, children, hint, optional, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; optional?: boolean; className?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label>
        {label}
        {optional && <span className="opt"> (optional)</span>}
        <div style={{ marginTop: '0.3rem' }}>{children}</div>
      </label>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="card muted center">{children}</div>;

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand" aria-label="MedAssist-9ja home">
      <LogoMark />
      <span>
        MedAssist<span className="accent">-9ja</span>
      </span>
    </Link>
  );
}

export const SampleNote = ({ children }: { children: ReactNode }) => <p className="tiny muted mt">{children}</p>;

/** Monospace phone number grouped for reading aloud: 0801 234 5201. */
export function Phone({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const local = value.startsWith('+234') ? `0${value.slice(4)}` : value;
  const grouped = local.replace(/^(\d{4})(\d{3})(\d+)$/, '$1 $2 $3');
  return <span className="mono">{grouped}</span>;
}
