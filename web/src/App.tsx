import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spinner } from './components/common';
import { Page, PublicLayout } from './components/Layout';
import { isProvider, type Role, useAuth } from './lib/auth';
import { Admin } from './pages/Admin';
import { BedRequestForm, BedRequestStatus } from './pages/BedRequest';
import { Dashboard } from './pages/dashboard/Dashboard';
import { Emergency } from './pages/Emergency';
import { Facility } from './pages/Facility';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { MockCheckout } from './pages/MockCheckout';
import { Complaint, Notifications } from './pages/Notifications';
import { OrderDetail, Orders } from './pages/Orders';
import { Profile } from './pages/Profile';
import { Register } from './pages/Register';
import { Reserve } from './pages/Reserve';
import { Search } from './pages/Search';

function RequireRole({ roles, children, loginAs }: { roles?: Role[]; children: ReactNode; loginAs?: 'provider' }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Page><Spinner /></Page>;
  if (!me) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}${loginAs ? '&as=provider' : ''}`} replace />;
  }
  if (roles && !roles.includes(me.user.role)) return <Page><div className="alert warn">This page is not available for your account type.</div></Page>;
  return <>{children}</>;
}

export function App() {
  const { me } = useAuth();
  const role = me?.user.role;
  return (
    <Routes>
      {/* Facility dashboards and the admin console use their own sidebar shell. */}
      <Route path="dashboard/*" element={<RequireRole roles={['pharmacy', 'hospital', 'specialist']} loginAs="provider"><Dashboard /></RequireRole>} />
      <Route path="admin/*" element={<RequireRole roles={['admin']} loginAs="provider"><Admin /></RequireRole>} />

      <Route element={<PublicLayout searchInHeader />}>
        <Route path="search" element={<Search />} />
        <Route path="facility/:id" element={<Facility />} />
      </Route>

      <Route element={<PublicLayout />}>
        <Route index element={isProvider(role) ? <Navigate to="/dashboard" replace /> : role === 'admin' ? <Navigate to="/admin" replace /> : <Home />} />
        <Route path="emergency" element={<Emergency />} />
        <Route path="login" element={<Login />} />
        <Route path="provider" element={<Navigate to="/login?as=provider" replace />} />
        <Route path="register" element={<Register />} />
        <Route path="bed-request" element={<Page narrow><BedRequestForm /></Page>} />
        <Route path="bed-requests/:id" element={<Page narrow><BedRequestStatus /></Page>} />
        <Route path="reserve" element={<RequireRole roles={['patient']}><Reserve /></RequireRole>} />
        <Route path="mock-checkout/:reference" element={<RequireRole roles={['patient']}><Page><MockCheckout /></Page></RequireRole>} />
        <Route path="orders" element={<RequireRole roles={['patient']}><Orders /></RequireRole>} />
        <Route path="orders/:id" element={<RequireRole roles={['patient']}><OrderDetail /></RequireRole>} />
        <Route path="profile" element={<RequireRole><Profile /></RequireRole>} />
        <Route path="complaint" element={<RequireRole roles={['patient']}><Page narrow><Complaint /></Page></RequireRole>} />
        <Route path="notifications" element={<RequireRole><Page narrow><Notifications /></Page></RequireRole>} />
        <Route path="*" element={<Page><div className="card">Page not found. <a href="/">Go home</a></div></Page>} />
      </Route>
    </Routes>
  );
}
