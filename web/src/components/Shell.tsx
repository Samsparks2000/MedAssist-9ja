import { type ReactNode, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Brand } from './common';
import { MenuIcon, XIcon } from './Icons';

export interface NavItem {
  to: string;
  label: string;
  count?: number;
  end?: boolean;
}

/** Dark sidebar layout for facility dashboards and the navy admin console (design pages 11–13, 20). */
export function Shell({
  nav,
  who,
  caption,
  navy = false,
  children,
}: {
  nav: NavItem[];
  who?: { title: string; subtitle: string } | null;
  caption?: string;
  navy?: boolean;
  children: ReactNode;
}) {
  const { signOut, me } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const current = nav.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)));

  return (
    <div className="shell">
      <aside className={`sidebar ${navy ? 'navy' : ''} ${open ? 'open' : ''}`} aria-label="Dashboard">
        <div className="spread">
          <Brand to="/" />
          <button className="icon-btn hide-desktop" onClick={() => setOpen(false)} aria-label="Close menu">
            <XIcon />
          </button>
        </div>
        {caption && <div className="label-caps" style={{ marginTop: '0.6rem' }}>{caption}</div>}
        {who && (
          <div className="who">
            <strong>{who.title}</strong>
            <span className="small">{who.subtitle}</span>
          </div>
        )}
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="side" onClick={() => setOpen(false)}>
            <span>{n.label}</span>
            {n.count ? <span className="count">{n.count}</span> : null}
          </NavLink>
        ))}
        <div style={{ marginTop: '1.25rem' }}>
          <a
            href="/"
            className="side"
            onClick={(e) => {
              e.preventDefault();
              signOut();
              window.location.href = '/';
            }}
          >
            <span className="small">Sign out{me?.user.name ? ` · ${me.user.name.split(' ')[0]}` : ''}</span>
          </a>
        </div>
      </aside>
      <div className="shell-main">
        <div className="shell-top">
          <button className="btn small" onClick={() => setOpen(true)} aria-label="Open menu">
            <MenuIcon />
          </button>
          <strong>{current?.label ?? 'Dashboard'}</strong>
        </div>
        {children}
      </div>
    </div>
  );
}
