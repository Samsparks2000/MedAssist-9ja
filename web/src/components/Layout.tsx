import { type ReactNode, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { isProvider, useAuth } from '../lib/auth';
import { useSocketEvent } from '../lib/socket';
import { AreaSelect } from './AreaSelect';
import { Brand } from './common';
import { BellIcon, HomeIcon, PulseIcon, ReceiptIcon, SearchIcon, UserIcon } from './Icons';
import { SearchBox } from './SearchBox';

function useUnread() {
  const { me } = useAuth();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!me) return setUnread(0);
    api<{ unread: number }>('/notifications').then((r) => setUnread(r.unread)).catch(() => {});
  }, [me]);
  useSocketEvent('notification', () => setUnread((n) => n + 1), [me?.user.id]);
  return [unread, setUnread] as const;
}

/** Header search used on results pages (design page 6). */
function HeaderSearch() {
  const navigate = useNavigate();
  return (
    <div className="header-search">
      <div style={{ flex: 1 }}>
        <SearchBox compact onSearch={(p) => navigate(`/search?${new URLSearchParams(p as Record<string, string>)}`)} />
      </div>
      <div style={{ width: 200 }}>
        <AreaSelect id="header-area" />
      </div>
    </div>
  );
}

export function PublicLayout({ searchInHeader = false }: { searchInHeader?: boolean }) {
  const { me, signOut } = useAuth();
  const [unread, setUnread] = useUnread();
  const loc = useLocation();
  const role = me?.user.role;
  const onHome = loc.pathname === '/';

  return (
    <div className="app">
      <header className="site-header">
        <div className="container">
          <Brand />
          {searchInHeader && <HeaderSearch />}
          <nav className="site-nav" aria-label="Main">
            {role === 'patient' && <NavLink className="navlink strong hide-mobile" to="/orders">My orders</NavLink>}
            {isProvider(role) && <NavLink className="navlink strong hide-mobile" to="/dashboard">Dashboard</NavLink>}
            {role === 'admin' && <NavLink className="navlink strong hide-mobile" to="/admin">Admin console</NavLink>}
            {me ? (
              <>
                <NavLink to="/notifications" className="navlink hide-mobile" aria-label={`Notifications, ${unread} unread`} onClick={() => setUnread(0)}>
                  <BellIcon />
                  {unread > 0 && <span className="badge danger" style={{ marginLeft: 2 }}>{unread}</span>}
                </NavLink>
                <a className="navlink hide-mobile" href="/" onClick={(e) => { e.preventDefault(); signOut(); window.location.href = '/'; }}>Sign out</a>
              </>
            ) : (
              <NavLink className="navlink strong hide-mobile" to="/login">Sign in</NavLink>
            )}
            <Link to="/emergency" className="btn danger small" style={{ minHeight: 42, padding: '0 1.1rem' }}>Emergency</Link>
          </nav>
        </div>
      </header>
      <Outlet />
      <footer className="site-footer">
        <div className="container spread">
          <span>MedAssist-9ja does not diagnose or prescribe and does not replace emergency services.</span>
          <span>Emergency: <a href="tel:112"><strong>112</strong></a></span>
        </div>
      </footer>
      <nav className="tabbar" aria-label="App">
        <NavLink to="/" end><HomeIcon />Home</NavLink>
        <NavLink to="/search"><SearchIcon />Search</NavLink>
        <NavLink to="/emergency" className="sos"><PulseIcon />Emergency</NavLink>
        {isProvider(role) || role === 'admin' ? (
          <NavLink to={role === 'admin' ? '/admin' : '/dashboard'}><ReceiptIcon />Dashboard</NavLink>
        ) : (
          <NavLink to="/orders"><ReceiptIcon />Orders</NavLink>
        )}
        <NavLink to={me ? '/profile' : '/login'} onClick={() => setUnread(0)}>
          <UserIcon />
          {me ? 'Profile' : 'Sign in'}
          {unread > 0 && <span className="dot">{unread}</span>}
        </NavLink>
      </nav>
    </div>
  );
}

export function Page({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <main className="page">
      <div className={`container ${narrow ? 'narrow' : ''}`}>{children}</div>
    </main>
  );
}
