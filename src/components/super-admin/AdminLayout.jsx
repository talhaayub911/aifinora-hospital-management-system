import { useMemo, useState } from 'react';
import {
  Activity,
  BadgeDollarSign,
  Bell,
  Building2,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  FileCheck2,
  FileText,
  Headphones,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  UserCog,
  X,
} from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { ConfirmDialog, useAdminToast } from './AdminUI.jsx';

const navigation = [
  { to: '/super-admin', end: true, label: 'Overview', icon: LayoutDashboard },
  { to: '/super-admin/hospitals', label: 'Hospitals', icon: Building2 },
  { to: '/super-admin/hospitals/new', label: 'Add Hospital', icon: ClipboardList },
  { to: '/super-admin/plans', label: 'Subscription Plans', icon: BadgeDollarSign },
  { to: '/super-admin/subscriptions', label: 'Subscriptions', icon: CircleDollarSign },
  { to: '/super-admin/invoices', label: 'Subscription Invoices', icon: FileText },
  { to: '/super-admin/payment-verification', label: 'Payment Verification', icon: FileCheck2 },
  { to: '/super-admin/safepay-transactions', label: 'Safepay Transactions', icon: CreditCard },
  { to: '/super-admin/users', label: 'Users', icon: UserCog },
  { to: '/super-admin/support-requests', label: 'Support Requests', icon: Headphones },
  { to: '/super-admin/activity-logs', label: 'Activity Logs', icon: Activity },
  { to: '/super-admin/settings', label: 'Platform Settings', icon: Settings },
];

function pageName(pathname) {
  if (/\/hospitals\/new\/?$/.test(pathname)) return 'Onboard Hospital';
  if (/\/hospitals\/[^/]+\/?$/.test(pathname)) return 'Hospital Account';
  const item = [...navigation].reverse().find(({ to }) => pathname.startsWith(to) && to !== '/super-admin');
  return item?.label || 'SaaS Overview';
}

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, endSupportAccess } = useAuth();
  const { notify } = useAdminToast();
  const currentPage = useMemo(() => pageName(location.pathname), [location.pathname]);

  const finishLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      notify(error?.message || 'Unable to log out. Please try again.', 'error');
    } finally {
      setLoggingOut(false);
      setLogoutOpen(false);
    }
  };

  const supportSession = user?.supportAccessSession || user?.supportAccess;

  return (
    <div className="sa-shell">
      <aside className={`sa-sidebar ${sidebarOpen ? 'sa-sidebar--open' : ''}`} aria-label="Super Admin navigation">
        <div className="sa-brand">
          <div className="sa-brand__mark"><ShieldCheck size={24} /></div>
          <div><strong>AI Finora</strong><span>Super Admin</span></div>
          <button className="sa-sidebar__close" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={19} /></button>
        </div>
        <div className="sa-sidebar__label">PLATFORM CONTROL</div>
        <nav className="sa-nav">
          {navigation.map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `sa-nav__item ${isActive ? 'sa-nav__item--active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sa-sidebar__security">
          <ShieldCheck size={20} />
          <div><strong>Platform boundary</strong><span>Patient records stay hidden unless audited support access is active.</span></div>
        </div>
      </aside>

      {sidebarOpen && <button className="sa-sidebar-overlay" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <div className="sa-workspace">
        {supportSession && (
          <div className="sa-support-banner" role="alert">
            <ShieldCheck size={17} />
            <span><strong>Audited support access is active.</strong> Every action is being logged.</span>
            {endSupportAccess && <button type="button" onClick={endSupportAccess}>End access</button>}
          </div>
        )}
        <header className="sa-topbar">
          <div className="sa-topbar__left">
            <button className="sa-icon-button sa-mobile-menu" type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
            <div><span>AI Finora SaaS Platform</span><strong>{currentPage}</strong></div>
          </div>
          <div className="sa-topbar__right">
            <button className="sa-icon-button" type="button" aria-label="View notifications" onClick={() => navigate('/super-admin/activity-logs')}>
              <Bell size={18} /><i className="sa-notification-dot" />
            </button>
            <div className="sa-profile">
              <button type="button" className="sa-profile__trigger" aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)}>
                <span className="sa-avatar">{(user?.name || user?.fullName || user?.email || 'SA').split(/\s|@/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
                <span className="sa-profile__copy"><strong>{user?.name || user?.fullName || 'Platform Administrator'}</strong><small>{user?.email || 'Signed-in platform account'}</small></span>
                <ChevronDown size={16} />
              </button>
              {profileOpen && (
                <div className="sa-profile__menu">
                  <div><strong>Super Admin</strong><span>Full platform access</span></div>
                  <button type="button" onClick={() => { setProfileOpen(false); setLogoutOpen(true); }}><LogOut size={16} />Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="sa-content"><Outlet /></main>
      </div>

      <ConfirmDialog
        open={logoutOpen}
        title="Sign out of AI Finora?"
        description="You will need to authenticate again to access platform controls."
        confirmLabel="Sign out"
        tone="danger"
        busy={loggingOut}
        onCancel={() => setLogoutOpen(false)}
        onConfirm={finishLogout}
      />
    </div>
  );
}

export { navigation as superAdminNavigation };
