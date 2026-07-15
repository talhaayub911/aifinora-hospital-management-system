import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  BedDouble,
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardPlus,
  CreditCard,
  Download,
  FileBarChart,
  FileText,
  HeartPulse,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  PackagePlus,
  Pencil,
  Pill,
  Plus,
  Printer,
  Receipt,
  RefreshCcw,
  Search,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Upload,
  UserCog,
  UserPlus,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../services/api.js';

const money = (value) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0,
  }).format(value);

const titleCase = (value = '') => String(value)
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const today = new Date();
const dateText = (value) =>
  value
    ? new Intl.DateTimeFormat('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }).format(
        new Date(value),
      )
    : '—';

const roles = {
  'Hospital Admin': ['Dashboard', 'Patients', 'Appointments', 'Doctors', 'Services', 'Billing', 'Payments', 'Receipts', 'Reports', 'Pharmacy Inventory', 'Branches', 'Users', 'Subscription & Billing', 'Data Export'],
  Receptionist: ['Dashboard', 'Patients', 'Appointments', 'Doctors', 'Services', 'Receipts'],
  'Billing Officer': ['Dashboard', 'Patients', 'Appointments', 'Services', 'Billing', 'Payments', 'Receipts'],
  Accountant: ['Dashboard', 'Billing', 'Payments', 'Receipts', 'Reports'],
};

const navItems = [
  { key: 'Dashboard', icon: LayoutDashboard, features: ['dashboard'] },
  { key: 'Patients', icon: Users, features: ['patient_registration'] },
  { key: 'Appointments', icon: CalendarDays, features: ['appointments', 'admissions'] },
  { key: 'Doctors', icon: Stethoscope, features: ['doctors', 'departments'] },
  { key: 'Services', icon: PackagePlus, features: ['charge_master'] },
  { key: 'Billing', icon: FileText, features: ['opd_billing', 'emergency_billing', 'inpatient_billing', 'pharmacy_billing', 'laboratory_billing', 'insurance_billing', 'corporate_billing'] },
  { key: 'Payments', icon: WalletCards, features: ['payments', 'refunds'] },
  { key: 'Receipts', icon: Receipt, features: ['receipts'] },
  { key: 'Reports', icon: FileBarChart, features: ['financial_reports'] },
  { key: 'Pharmacy Inventory', icon: Pill, features: ['pharmacy_inventory'] },
  { key: 'Branches', icon: Building2, features: ['multi_branch_management'] },
  { key: 'Users', icon: UserCog, features: [] },
  { key: 'Subscription & Billing', icon: CreditCard, features: [] },
  { key: 'Data Export', icon: Download, features: [] },
];

const pageRoutes = {
  Dashboard: '/hospital',
  Patients: '/hospital/patients',
  Appointments: '/hospital/appointments',
  Doctors: '/hospital/doctors',
  Services: '/hospital/services',
  Billing: '/hospital/billing',
  Payments: '/hospital/payments',
  Receipts: '/hospital/receipts',
  Reports: '/hospital/reports',
  'Pharmacy Inventory': '/hospital/pharmacy-inventory',
  Branches: '/hospital/branches',
  Users: '/hospital/users',
  'Subscription & Billing': '/hospital/subscription',
  'Data Export': '/hospital/data-export',
};

const featureByVisit = Object.freeze({
  OPD: 'opd_billing',
  Inpatient: 'inpatient_billing',
  Emergency: 'emergency_billing',
  Pharmacy: 'pharmacy_billing',
  Laboratory: 'laboratory_billing',
});

const pageFromPath = (pathname) => {
  const normalized = String(pathname || '').replace(/\/+$/, '') || '/hospital';
  return Object.entries(pageRoutes).find(([, path]) => path === normalized)?.[0] || null;
};

const displayRole = (role) => {
  const value = String(role || '').toLowerCase().replaceAll('_', ' ');
  if (value.includes('admin')) return 'Hospital Admin';
  if (value.includes('reception')) return 'Receptionist';
  if (value.includes('billing')) return 'Billing Officer';
  if (value.includes('account')) return 'Accountant';
  return 'Receptionist';
};

const unwrapList = (value, ...keys) => {
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return Array.isArray(value) ? value : [];
};

const downloadCsv = (filename, rows) => {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(url);
};

function HospitalPortal() {
  const { user, logout, endSupportAccess } = useAuth();
  const location = useLocation();
  const routerNavigate = useNavigate();
  const [active, setActive] = useState(() => pageFromPath(location.pathname) || 'Dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [admissions, setAdmissions] = useState([]);
  const [hospitalDoctors, setHospitalDoctors] = useState([]);
  const [hospitalDepartments, setHospitalDepartments] = useState([]);
  const [hospitalUsers, setHospitalUsers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [services, setServices] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [hospital, setHospital] = useState(user?.hospital || null);
  const [subscription, setSubscription] = useState(null);
  const [features, setFeatures] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState('');

  const role = displayRole(user?.role);
  const featureSet = useMemo(() => new Set(features.map((feature) =>
    typeof feature === 'string' ? feature : feature?.key || feature?.featureKey,
  ).filter(Boolean)), [features]);
  const status = String(subscription?.status || 'active').toLowerCase();
  const isSupportAccess = user?.accountType === 'SUPPORT' || user?.type === 'SUPPORT' || Boolean(user?.supportAccessSessionId);
  const canWriteOperational = !isSupportAccess && !['pending_payment', 'read_only', 'paused', 'suspended', 'canceled'].includes(status);

  const notify = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3000);
  }, []);

  const loadPortal = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await api.get('/hospital/bootstrap');
      const data = result?.data || result;
      setHospital(data.hospital || user?.hospital || null);
      const resolvedSubscription = data.subscription ? {
        ...data.subscription,
        limits: data.limits || data.subscription.limits,
        usage: data.usage || data.subscription.usage,
        features: data.features || data.subscription.features,
        safepay: data.safepay || data.subscription.safepay,
      } : data.hospital?.subscription || null;
      setSubscription(resolvedSubscription);
      setFeatures(unwrapList(data.features || data.enabledFeatures, 'features', 'enabledFeatures'));
      setPermissions(data.permissions || {});
      setPatients(unwrapList(data.patients, 'patients'));
      setAppointments(unwrapList(data.appointments, 'appointments'));
      setAdmissions(unwrapList(data.admissions, 'admissions'));
      setHospitalDoctors(unwrapList(data.doctors, 'doctors'));
      setHospitalDepartments(unwrapList(data.departments, 'departments'));
      setHospitalUsers(unwrapList(data.users || data.hospitalUsers, 'users', 'hospitalUsers'));
      setNotifications(unwrapList(data.notifications, 'notifications'));
      setServices(unwrapList(data.services, 'services'));
      setInvoices(unwrapList(data.patientInvoices || data.invoices, 'patientInvoices', 'invoices'));
      setPayments(unwrapList(data.patientPayments || data.payments, 'patientPayments', 'payments'));
    } catch (error) {
      setLoadError(error.message || 'Hospital data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [user?.hospital]);

  useEffect(() => { loadPortal(); }, [loadPortal]);

  const featureIncluded = useCallback((key) => featureSet.has(key), [featureSet]);
  const featureEnabled = useCallback((key) => {
    const permission = permissions[key];
    return featureIncluded(key) && Boolean(permission?.read || permission?.write || permission?.manage);
  }, [featureIncluded, permissions]);
  const allowed = useMemo(() => {
    const roleAllowed = roles[role] || [];
    return navItems.filter((item) => {
      if (!roleAllowed.includes(item.key)) return false;
      if (status === 'pending_payment') return item.key === 'Subscription & Billing';
      if (['suspended', 'canceled'].includes(status)) return ['Subscription & Billing', 'Data Export'].includes(item.key);
      if (['read_only', 'paused'].includes(status)) return ['Dashboard', 'Patients', 'Receipts', 'Reports', 'Subscription & Billing', 'Data Export'].includes(item.key);
      if (['Subscription & Billing', 'Data Export'].includes(item.key)) return true;
      if (item.key === 'Users') return featureEnabled('user_management');
      return !item.features.length || item.features.some((feature) => featureEnabled(feature));
    }).map((item) => item.key);
  }, [featureEnabled, role, status]);

  useEffect(() => {
    if (loading || !allowed.length) return;
    const requested = pageFromPath(location.pathname);
    if (requested && allowed.includes(requested)) {
      setActive(requested);
      return;
    }
    const fallback = allowed.includes('Dashboard') ? 'Dashboard' : allowed[0];
    setActive(fallback);
    routerNavigate(pageRoutes[fallback], { replace: true });
  }, [allowed, loading, location.pathname, routerNavigate]);

  const fallbackPage = allowed.includes('Dashboard') ? 'Dashboard' : allowed[0];
  const effectiveActive = allowed.includes(active) ? active : fallbackPage;

  const ensureWrite = (feature) => {
    if (isSupportAccess) {
      notify('Authorised support access is view-only for hospital operational records.');
      return false;
    }
    if (!canWriteOperational) {
      notify('This subscription currently permits viewing only. Submit payment or contact AI Finora support.');
      return false;
    }
    if (feature && !featureIncluded(feature)) {
      notify('This module is not included in the hospital subscription plan.');
      return false;
    }
    if (feature && !(permissions[feature]?.write || permissions[feature]?.manage)) {
      notify('Your hospital role has view-only access to this module.');
      return false;
    }
    return true;
  };

  const canWriteFeature = useCallback((feature) => {
    if (isSupportAccess || !canWriteOperational || !featureIncluded(feature)) return false;
    return Boolean(permissions[feature]?.write || permissions[feature]?.manage);
  }, [canWriteOperational, featureIncluded, isSupportAccess, permissions]);

  const endSupport = async () => {
    try { await endSupportAccess?.(); }
    catch (error) { notify(error.message || 'Support access could not be ended.'); }
  };

  const navigate = (page) => {
    if (!allowed.includes(page)) {
      notify(`${role} does not have permission to open ${page}.`);
      return;
    }
    setActive(page);
    routerNavigate(pageRoutes[page] || '/hospital');
    setSidebarOpen(false);
  };

  const pageProps = {
    patients,
    setPatients,
    appointments,
    setAppointments,
    admissions,
    setAdmissions,
    services,
    setServices,
    invoices,
    setInvoices,
    payments,
    setPayments,
    notify,
    navigate,
    role,
    canWriteOperational,
    ensureWrite,
    canWriteFeature,
    allowed,
    featureEnabled,
    hospitalDoctors,
    setHospitalDoctors,
    hospitalDepartments,
    setHospitalDepartments,
    hospitalUsers,
    setHospitalUsers,
    hospital,
    subscription,
    status,
    isSupportAccess,
    currentUser: user,
  };

  if (loading) return <PortalState icon={LoaderCircle} title="Loading hospital workspace" message="Resolving your tenant, role, plan, and permitted modules…" spinning />;
  if (loadError) return <PortalState icon={AlertTriangle} title="Hospital workspace unavailable" message={loadError} action={<button className="primary-button" onClick={loadPortal}>Try again</button>} />;

  if (!effectiveActive) return <PortalState icon={AlertTriangle} title="No hospital modules available" message="Your account does not currently have permission to open a hospital module. Contact your hospital administrator or AI Finora support." />;

  return (
    <div className="app-shell">
      <Sidebar active={effectiveActive} navigate={navigate} allowed={allowed} open={sidebarOpen} setOpen={setSidebarOpen} plan={typeof subscription?.plan === 'string' ? subscription.plan : subscription?.plan?.name || subscription?.planName} />
      <main className="main-area">
        <Header role={role} user={user} hospital={hospital} notificationCount={notifications.filter((item) => !item.readAt && !item.isRead).length} onNotifications={() => setShowNotifications(true)} onMenu={() => setSidebarOpen(true)} onLogout={logout} />
        {isSupportAccess && <div className="support-access-banner"><ShieldCheck size={18} /><span><strong>Authorised support access is active.</strong> This visible demo session is audited and limited to the stated support reason.</span><button onClick={endSupport}>End support access</button></div>}
        <SubscriptionBanner status={status} />
        <div className="content-area">
          {effectiveActive === 'Dashboard' && <Dashboard {...pageProps} />}
          {effectiveActive === 'Patients' && <PatientsPage {...pageProps} />}
          {effectiveActive === 'Appointments' && <AppointmentsPage {...pageProps} />}
          {effectiveActive === 'Doctors' && <DoctorsPage {...pageProps} doctors={hospitalDoctors} departments={hospitalDepartments} />}
          {effectiveActive === 'Services' && <ServicesPage {...pageProps} />}
          {effectiveActive === 'Billing' && <BillingPage {...pageProps} />}
          {effectiveActive === 'Payments' && <PaymentsPage {...pageProps} />}
          {effectiveActive === 'Receipts' && <ReceiptsPage {...pageProps} />}
          {effectiveActive === 'Reports' && <ReportsPage {...pageProps} />}
          {effectiveActive === 'Pharmacy Inventory' && <PharmacyInventoryPage {...pageProps} />}
          {effectiveActive === 'Branches' && <BranchesPage {...pageProps} />}
          {effectiveActive === 'Users' && <UsersPage {...pageProps} />}
          {effectiveActive === 'Subscription & Billing' && <SubscriptionBillingPage hospital={hospital} subscription={subscription} setSubscription={setSubscription} notify={notify} />}
          {effectiveActive === 'Data Export' && <DataExportPage {...pageProps} />}
        </div>
      </main>
      {showNotifications && <Modal title="Notifications" onClose={() => setShowNotifications(false)}>{notifications.length ? <div className="notification-list">{notifications.map((item) => <article key={item.id}><div className="patient-dot"><Bell size={16} /></div><div><strong>{item.title || String(item.type || 'Account update').replaceAll('_', ' ')}</strong><p>{item.message || item.body}</p><span>{dateText(item.createdAt)}</span></div></article>)}</div> : <EmptyState title="No notifications" message="Subscription and payment updates will appear here." />}</Modal>}
      {toast && <div className="toast" role="status"><Check size={18} />{toast}</div>}
    </div>
  );
}

function Sidebar({ active, navigate, allowed, open, setOpen, plan }) {
  return (
    <>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><HeartPulse size={25} /></div>
          <div><strong>AI Finora</strong><span>Hospital Management</span></div>
        </div>
        <nav>
          <div className="nav-label">MAIN MENU</div>
          {navItems.filter(({ key }) => allowed.includes(key)).map(({ key, icon: Icon }) => (
            <button key={key} className={`nav-item ${active === key ? 'active' : ''}`} onClick={() => navigate(key)}>
              <Icon size={19} /><span>{key}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-help">
          <div className="help-icon"><ClipboardPlus size={20} /></div>
          <strong>{plan || 'Hospital subscription'}</strong>
          <span>Your authenticated role and hospital plan jointly control the available modules.</span>
        </div>
      </aside>
      {open && <button aria-label="Close navigation" className="sidebar-overlay" onClick={() => setOpen(false)} />}
    </>
  );
}

function Header({ role, user, hospital, notificationCount, onNotifications, onMenu, onLogout }) {
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={onMenu}><Menu size={22} /></button>
      <div className="topbar-title"><span>{new Intl.DateTimeFormat('en-PK', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(today)}</span><strong>{hospital?.name || 'AI Finora Hospital Management'}</strong></div>
      <div className="topbar-actions">
        <button className="icon-button" aria-label={`${notificationCount || 0} unread notifications`} onClick={onNotifications}><Bell size={20} />{notificationCount > 0 && <span className="notification-dot" />}</button>
        <div className="role-switcher">
          <div className="avatar">{String(user?.name || user?.fullName || 'HU').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div>
          <div className="profile-copy"><strong>{user?.name || user?.fullName || 'Hospital User'}</strong><span>{role}</span></div>
        </div>
        <button className="icon-button" aria-label="Log out" title="Log out" onClick={onLogout}><LogOut size={19} /></button>
      </div>
    </header>
  );
}

function PortalState({ icon: Icon, title, message, action, spinning = false }) {
  return <main className="portal-state"><div className={`portal-state-icon ${spinning ? 'spinning' : ''}`}><Icon size={28} /></div><h1>{title}</h1><p>{message}</p>{action}</main>;
}

function SubscriptionBanner({ status }) {
  const copy = {
    past_due: 'Your subscription payment is overdue. Full access continues while payment is arranged.',
    grace_period: 'Your subscription is in its grace period. Please submit payment to avoid read-only access.',
    read_only: 'Your subscription is currently in read-only mode because payment is overdue. Existing records remain available. Please submit payment or contact AI Finora support.',
    paused: 'This hospital subscription is paused. Existing records can be viewed, but operational changes are disabled.',
    suspended: 'This hospital account is suspended. Hospital administrators retain access to billing and permitted export information only.',
    pending_payment: 'Onboarding access is limited until the required subscription payment is verified.',
    canceled: 'This subscription is canceled. Access is restricted according to the demonstration retention policy.',
  };
  if (!copy[status]) return null;
  return <div className={`subscription-access-banner ${status}`} role="status"><AlertTriangle size={18} /><span>{copy[status]}</span></div>;
}

function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="page-header">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {action}
    </div>
  );
}

function StatCard({ label, value, trend, icon: Icon, tone = 'blue' }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}><Icon size={23} /></div>
      <div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{trend}</small></div>
    </div>
  );
}

function Dashboard({ patients, appointments, admissions, invoices, payments, navigate, allowed, canWriteFeature }) {
  const [revenueDays, setRevenueDays] = useState(7);
  const revenue = payments.length
    ? payments.reduce((sum, payment) => sum + Math.max(Number(payment.amount || 0), 0), 0)
    : invoices.reduce((sum, invoice) => sum + Number(invoice.paid || invoice.paidAmount || 0), 0);
  const outstanding = invoices.reduce((sum, invoice) => sum + Math.max(Number(invoice.total || 0) - Number(invoice.paid || invoice.paidAmount || 0), 0), 0);
  const billed = invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const collectionRate = billed > 0 ? Math.min(Math.round((revenue / billed) * 100), 100) : 0;
  const thirdPartyOutstanding = invoices.reduce((sum, invoice) => String(invoice.payer || '').toLowerCase() === 'self pay'
    ? sum
    : sum + Math.max(Number(invoice.total || 0) - Number(invoice.paid || invoice.paidAmount || 0), 0), 0);
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayAppointments = appointments.filter((item) => String(item.date || item.appointmentDate || '').slice(0, 10) === todayKey);
  const currentAdmissions = admissions.filter((item) => !['discharged', 'cancelled', 'canceled'].includes(String(item.status || '').toLowerCase()));

  return (
    <>
      <PageHeader eyebrow="OVERVIEW" title="Hospital Dashboard" description="Monitor current clinical activity and billing performance." action={allowed.includes('Billing') && ['opd_billing', 'emergency_billing', 'inpatient_billing', 'pharmacy_billing', 'laboratory_billing'].some(canWriteFeature) ? <button className="primary-button" onClick={() => navigate('Billing')}><Plus size={18} /> New Invoice</button> : null} />
      <div className="stats-grid">
        <StatCard label="Registered Patients" value={patients.length} trend={`${patients.filter((item) => String(item.status).toLowerCase() === 'active').length} active records`} icon={Users} />
        <StatCard label="Today's Appointments" value={todayAppointments.length} trend={`${appointments.length} total appointment records`} icon={CalendarDays} tone="purple" />
        <StatCard label="Current Admissions" value={currentAdmissions.length} trend={`${admissions.length} admission records`} icon={BedDouble} tone="green" />
        <StatCard label="Collected Revenue" value={money(revenue)} trend={`${collectionRate}% of billed value`} icon={Banknote} tone="orange" />
      </div>

      <div className="dashboard-grid">
        <section className="panel revenue-panel">
          <div className="panel-heading"><div><h2>Revenue Overview</h2><p>Posted patient collections</p></div><label className="compact-select"><span className="sr-only">Revenue period</span><select className="secondary-button" value={revenueDays} onChange={(event) => setRevenueDays(Number(event.target.value))}><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select><ChevronDown size={15} /></label></div>
          <RevenueBars payments={payments} invoices={invoices} days={revenueDays} />
        </section>
        <section className="panel collection-panel">
          <div className="panel-heading"><div><h2>Collections</h2><p>Current billing position</p></div></div>
          <div className="donut-wrap">
            <div className="donut"><div><strong>{collectionRate}%</strong><span>Collected</span></div></div>
            <div className="legend-list">
              <div><i className="legend blue" /><span>Paid</span><strong>{money(revenue)}</strong></div>
              <div><i className="legend pale" /><span>Outstanding</span><strong>{money(outstanding)}</strong></div>
              <div><i className="legend purple" /><span>Third-party outstanding</span><strong>{money(thirdPartyOutstanding)}</strong></div>
            </div>
          </div>
        </section>
      </div>

      <div className="dashboard-grid lower">
        <section className="panel">
          <div className="panel-heading"><div><h2>Today's Appointments</h2><p>Upcoming and active consultations</p></div>{allowed.includes('Appointments') && <button className="link-button" onClick={() => navigate('Appointments')}>View all</button>}</div>
          <div className="compact-list">
            {todayAppointments.slice(0, 4).map((appt) => (
              <div className="compact-row" key={appt.id}><div className="time-pill">{appt.time}</div><div className="patient-dot">{String(appt.patient || '').split(' ').map((value) => value[0]).join('').slice(0,2)}</div><div className="grow"><strong>{appt.patient}</strong><span>{appt.doctor} · {appt.department}</span></div><Status status={appt.status} /></div>
            ))}
            {!todayAppointments.length && <EmptyState title="No appointments today" message="Appointments scheduled for today will appear here." />}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><h2>Quick Actions</h2><p>Common hospital operations</p></div></div>
          <div className="quick-grid">
            {allowed.includes('Patients') && canWriteFeature('patient_registration') && <button onClick={() => navigate('Patients')}><UserPlus size={22} /><span>Register Patient</span></button>}
            {allowed.includes('Appointments') && ['appointments', 'admissions'].some(canWriteFeature) && <button onClick={() => navigate('Appointments')}><CalendarDays size={22} /><span>Book Appointment</span></button>}
            {allowed.includes('Billing') && ['opd_billing', 'emergency_billing', 'inpatient_billing', 'pharmacy_billing', 'laboratory_billing'].some(canWriteFeature) && <button onClick={() => navigate('Billing')}><FileText size={22} /><span>Create Invoice</span></button>}
            {allowed.includes('Payments') && canWriteFeature('payments') && <button onClick={() => navigate('Payments')}><CreditCard size={22} /><span>Record Payment</span></button>}
          </div>
        </section>
      </div>
    </>
  );
}

function RevenueBars({ payments, invoices, days }) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const points = Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (days - index - 1));
    const key = date.toISOString().slice(0, 10);
    const amount = payments.length
      ? payments.filter((item) => String(item.date || item.paymentDate || item.createdAt || '').slice(0, 10) === key).reduce((sum, item) => sum + Math.max(Number(item.amount || 0), 0), 0)
      : invoices.filter((item) => String(item.date || item.invoiceDate || item.createdAt || '').slice(0, 10) === key).reduce((sum, item) => sum + Number(item.paid || item.paidAmount || 0), 0);
    return { key, label: new Intl.DateTimeFormat('en-PK', days <= 7 ? { weekday: 'short' } : { day: 'numeric' }).format(date), amount };
  });
  const max = Math.max(...points.map((point) => point.amount), 1);
  const displayed = days > 14 ? points.filter((_, index) => index % 3 === 0 || index === points.length - 1) : points;
  return <div className="bar-chart">{displayed.map((point) => <div className="bar-item" key={point.key}><span className="bar-value">{point.amount >= 1000 ? `${Math.round(point.amount / 1000)}k` : point.amount}</span><div className="bar-track"><div className="bar-fill" style={{ height: `${(point.amount / max) * 100}%` }} /></div><small>{point.label}</small></div>)}</div>;
}

function PatientsPage({ patients, setPatients, invoices, notify, ensureWrite, canWriteFeature }) {
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const filtered = patients.filter((p) => `${p.name} ${p.id} ${p.phone}`.toLowerCase().includes(query.toLowerCase()));
  const selectedActivity = selected ? invoices.filter((invoice) => String(invoice.patientId) === String(selected.id) || String(invoice.patient?.id) === String(selected.id)).slice(0, 5) : [];
  const addPatient = async (event) => {
    event.preventDefault();
    if (!ensureWrite('patient_registration')) return;
    const form = new FormData(event.currentTarget);
    try {
      const payload = { name: form.get('name'), age: Number(form.get('age')), gender: form.get('gender'), phone: form.get('phone'), city: form.get('city'), blood: form.get('blood'), cnic: form.get('cnic'), payer: form.get('payer') };
      const result = await api.post('/hospital/patients', payload);
      const item = result?.patient || result?.data?.patient || result?.data || result;
      setPatients([item, ...patients]); setModal(false); notify(`${item.name} registered successfully.`);
    } catch (error) { notify(error.message || 'Patient could not be registered.'); }
  };
  return (
    <>
      <PageHeader eyebrow="PATIENT MANAGEMENT" title="Patients" description="Register, search, and manage patient records." action={canWriteFeature('patient_registration') ? <button className="primary-button" onClick={() => ensureWrite('patient_registration') && setModal(true)}><UserPlus size={18} /> Register Patient</button> : null} />
      <section className="panel">
        <div className="toolbar"><div className="search-box"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by patient name, ID, or phone" /></div><div className="toolbar-note">{filtered.length} patient records</div></div>
        <div className="table-wrap"><table><thead><tr><th>Patient</th><th>Contact</th><th>Age / Gender</th><th>Blood</th><th>Payer</th><th>Status</th><th /></tr></thead><tbody>{filtered.map((p) => <tr key={p.id}><td><div className="table-person"><div className="patient-dot">{p.name.split(' ').map(v => v[0]).join('').slice(0,2)}</div><div><strong>{p.name}</strong><span>{p.id} · {p.cnic}</span></div></div></td><td><strong>{p.phone}</strong><span>{p.city}</span></td><td>{p.age} years<br /><span>{p.gender}</span></td><td><span className="blood-badge">{p.blood}</span></td><td>{p.payer}</td><td><Status status={p.status} /></td><td><button className="table-action" onClick={() => setSelected(p)}>View</button></td></tr>)}</tbody></table></div>
      </section>
      {modal && <Modal title="Register New Patient" onClose={() => setModal(false)}><form className="form-grid" onSubmit={addPatient}><Field label="Full Name" name="name" required /><Field label="Age" name="age" type="number" required /><SelectField label="Gender" name="gender" options={['Male', 'Female', 'Other']} /><Field label="Mobile Number" name="phone" required /><Field label="CNIC" name="cnic" placeholder="35202-1234567-1" required /><Field label="City" name="city" required /><SelectField label="Blood Group" name="blood" options={['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']} /><SelectField label="Payment Type" name="payer" options={['Self Pay', 'Jubilee Health', 'Adamjee Insurance', 'EFU Health', 'Corporate']} /><div className="modal-actions full"><button type="button" className="secondary-button" onClick={() => setModal(false)}>Cancel</button><button className="primary-button">Register Patient</button></div></form></Modal>}
      {selected && <Modal title="Patient Profile" onClose={() => setSelected(null)}><div className="profile-summary"><div className="profile-avatar">{selected.name.split(' ').map(v => v[0]).join('').slice(0,2)}</div><div><h3>{selected.name}</h3><p>{selected.id} · {selected.age} years · {selected.gender}</p></div></div><div className="details-grid"><Detail label="Phone" value={selected.phone} /><Detail label="CNIC" value={selected.cnic} /><Detail label="City" value={selected.city} /><Detail label="Blood Group" value={selected.blood} /><Detail label="Payer" value={selected.payer} /><Detail label="Status" value={selected.status} /></div><div className="patient-history"><h3>Recent billing activity</h3>{selectedActivity.map((invoice) => <div key={invoice.id}><span>{dateText(invoice.date || invoice.invoiceDate)}</span><strong>{invoice.type || invoice.visitType || 'Patient invoice'}</strong><small>{invoice.invoiceNumber || invoice.id} · {money(invoice.total || 0)}</small></div>)}{!selectedActivity.length && <p className="muted-copy">No patient invoices are available for this record.</p>}</div></Modal>}
    </>
  );
}

function AppointmentsPage({ patients, appointments, setAppointments, admissions, setAdmissions, notify, ensureWrite, canWriteFeature, featureEnabled, hospitalDoctors, hospitalDepartments }) {
  const [tab, setTab] = useState(() => featureEnabled('appointments') ? 'Appointments' : 'Admissions');
  const [modal, setModal] = useState(false);
  useEffect(() => {
    if (tab === 'Appointments' && !featureEnabled('appointments') && featureEnabled('admissions')) setTab('Admissions');
    if (tab === 'Admissions' && !featureEnabled('admissions') && featureEnabled('appointments')) setTab('Appointments');
  }, [featureEnabled, tab]);
  const addRecord = async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const feature = tab === 'Appointments' ? 'appointments' : 'admissions';
    if (!ensureWrite(feature)) return;
    try {
      const patient = patients.find(p => p.id === form.get('patient'));
      if (tab === 'Appointments') {
        const payload = { patientId: form.get('patient'), doctor: form.get('doctor'), department: form.get('department'), type: form.get('type'), time: form.get('time'), date: form.get('date') };
        const result = await api.post('/hospital/appointments', payload);
        const record = result?.appointment || result?.data?.appointment || result?.data || result;
        setAppointments([{ ...record, patient: record.patient?.name || record.patient || patient?.name }, ...appointments]);
        notify('Appointment booked successfully.');
      } else {
        const payload = { patientId: form.get('patient'), ward: form.get('ward'), room: form.get('room'), bed: form.get('bed'), doctor: form.get('doctor'), admitted: form.get('date'), package: form.get('package') };
        const result = await api.post('/hospital/admissions', payload);
        const record = result?.admission || result?.data?.admission || result?.data || result;
        setAdmissions([{ ...record, patient: record.patient?.name || record.patient || patient?.name }, ...admissions]);
        notify('Patient admitted successfully.');
      }
      setModal(false);
    } catch (error) { notify(error.message || 'The clinical record could not be saved.'); }
  };
  return (
    <>
      <PageHeader eyebrow="CLINICAL OPERATIONS" title="Appointments & Admissions" description="Manage OPD, emergency, and inpatient workflows." action={canWriteFeature(tab === 'Appointments' ? 'appointments' : 'admissions') ? <button className="primary-button" onClick={() => ensureWrite(tab === 'Appointments' ? 'appointments' : 'admissions') && setModal(true)}><Plus size={18} /> {tab === 'Appointments' ? 'Book Appointment' : 'New Admission'}</button> : null} />
      <div className="tabs" role="tablist" aria-label="Clinical operations">{featureEnabled('appointments') && <button role="tab" aria-selected={tab === 'Appointments'} className={tab === 'Appointments' ? 'active' : ''} onClick={() => setTab('Appointments')}>Appointments</button>}{featureEnabled('admissions') && <button role="tab" aria-selected={tab === 'Admissions'} className={tab === 'Admissions' ? 'active' : ''} onClick={() => setTab('Admissions')}>Admissions</button>}</div>
      <section className="panel">
        {tab === 'Appointments' ? <div className="table-wrap"><table><thead><tr><th>Patient</th><th>Doctor</th><th>Department</th><th>Visit Type</th><th>Date & Time</th><th>Status</th></tr></thead><tbody>{appointments.map(a => <tr key={a.id}><td><strong>{a.patient}</strong><span>{a.id}</span></td><td>{a.doctor}</td><td>{a.department}</td><td><span className="type-badge">{a.type}</span></td><td>{dateText(a.date)}<span>{a.time}</span></td><td><Status status={a.status} /></td></tr>)}</tbody></table></div> : <div className="table-wrap"><table><thead><tr><th>Patient</th><th>Ward / Room</th><th>Consultant</th><th>Admission Date</th><th>Billing</th><th>Status</th></tr></thead><tbody>{admissions.map(a => <tr key={a.id}><td><strong>{a.patient}</strong><span>{a.id}</span></td><td>{a.ward}<span>Room {a.room}, Bed {a.bed}</span></td><td>{a.doctor}</td><td>{dateText(a.admitted)}</td><td>{a.package}</td><td><Status status={a.status} /></td></tr>)}</tbody></table></div>}
      </section>
      {modal && <Modal title={tab === 'Appointments' ? 'Book Appointment' : 'Admit Patient'} onClose={() => setModal(false)}><form className="form-grid" onSubmit={addRecord}><SelectField label="Patient" name="patient" options={patients.map(p => ({ label: `${p.name} (${p.id})`, value: p.id }))} /><SelectField label="Doctor" name="doctor" options={hospitalDoctors.map(d => d.name)} />{tab === 'Appointments' ? <><SelectField label="Department" name="department" options={hospitalDepartments.map(d => d.name)} /><SelectField label="Visit Type" name="type" options={['OPD', 'Emergency', 'Follow-up']} /><Field label="Date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /><Field label="Time" name="time" type="time" /></> : <><SelectField label="Ward" name="ward" options={['General Ward', 'Cardiac Ward', 'Surgical Ward', 'Paediatric Ward']} /><Field label="Room" name="room" placeholder="G-101" /><Field label="Bed" name="bed" placeholder="01" /><Field label="Admission Date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /><SelectField label="Billing Package" name="package" options={['Self Pay', 'Insurance', 'Corporate']} /></>}<div className="modal-actions full"><button type="button" className="secondary-button" onClick={() => setModal(false)}>Cancel</button><button className="primary-button">Save</button></div></form></Modal>}
    </>
  );
}

function DoctorsPage({ notify, doctors: tenantDoctors = [], departments: tenantDepartments = [], setHospitalDoctors, setHospitalDepartments, ensureWrite, canWriteFeature, featureEnabled }) {
  const [tab, setTab] = useState(() => featureEnabled('doctors') ? 'Doctors' : 'Departments');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const doctorList = tenantDoctors;
  const departmentList = tenantDepartments;
  useEffect(() => {
    if (tab === 'Doctors' && !featureEnabled('doctors') && featureEnabled('departments')) setTab('Departments');
    if (tab === 'Departments' && !featureEnabled('departments') && featureEnabled('doctors')) setTab('Doctors');
  }, [featureEnabled, tab]);
  const saveSetup = async (event) => {
    event.preventDefault();
    const feature = tab === 'Doctors' ? 'doctors' : 'departments';
    if (!ensureWrite(feature)) return;
    const form = new FormData(event.currentTarget);
    try {
      if (tab === 'Doctors') {
        const payload = { name: form.get('name'), specialty: form.get('specialty'), department: form.get('department'), phone: form.get('phone'), fee: Number(form.get('fee')), availability: form.get('availability') };
        const result = editing
          ? await api.patch(`/hospital/doctors/${editing.databaseId || editing.id}`, payload)
          : await api.post('/hospital/doctors', payload);
        const item = result?.data || result;
        setHospitalDoctors(editing ? tenantDoctors.map((doctor) => doctor === editing ? item : doctor) : [item, ...tenantDoctors]);
        notify(`Doctor ${editing ? 'updated' : 'added to the hospital directory'}.`);
      } else {
        const payload = { name: form.get('name'), head: form.get('head') };
        const result = editing
          ? await api.patch(`/hospital/departments/${editing.id}`, payload)
          : await api.post('/hospital/departments', payload);
        const item = result?.data || result;
        setHospitalDepartments(editing ? tenantDepartments.map((department) => department === editing ? item : department) : [item, ...tenantDepartments]);
        notify(`Department ${editing ? 'updated' : 'added to hospital master data'}.`);
      }
      setModal(false); setEditing(null);
    } catch (error) { notify(error.message || `${tab === 'Doctors' ? 'Doctor' : 'Department'} could not be added.`); }
  };
  return (
    <>
      <PageHeader eyebrow="MASTER DATA" title="Doctors & Departments" description="Review consultants, specialties, departments, and consultation fees." action={canWriteFeature(tab === 'Doctors' ? 'doctors' : 'departments') ? <button className="primary-button" onClick={() => { if (ensureWrite(tab === 'Doctors' ? 'doctors' : 'departments')) { setEditing(null); setModal(true); } }}><Plus size={18} /> Add {tab === 'Doctors' ? 'Doctor' : 'Department'}</button> : null} />
      <div className="tabs" role="tablist" aria-label="Doctor master data">
        {featureEnabled('doctors') && <button role="tab" aria-selected={tab === 'Doctors'} className={tab === 'Doctors' ? 'active' : ''} onClick={() => setTab('Doctors')}>Doctors</button>}
        {featureEnabled('departments') && <button role="tab" aria-selected={tab === 'Departments'} className={tab === 'Departments' ? 'active' : ''} onClick={() => setTab('Departments')}>Departments</button>}
      </div>
      {tab === 'Doctors' ? <div className="cards-grid">{doctorList.map(d => <div className="doctor-card" key={d.id}><div className="doctor-top"><div className="doctor-avatar">{d.name.split(' ').slice(1).map(v => v[0]).join('').slice(0,2)}</div>{canWriteFeature('doctors') && <button className="icon-button" aria-label={`Edit ${d.name}`} onClick={() => { setEditing(d); setModal(true); }}><Pencil size={16} /></button>}</div><h3>{d.name}</h3><p>{d.specialty}</p><div className="doctor-meta"><span><Building2 size={15} />{d.department?.name || d.department || 'No department'}</span><span><CalendarDays size={15} />{d.availability || 'Not specified'}</span></div><div className="doctor-fee"><span>Consultation fee</span><strong>{money(d.fee)}</strong></div></div>)}</div> : <div className="cards-grid dept-grid">{departmentList.map((department) => { const Icon = department.icon || Building2; const d = department; return <div className="department-card" key={d.id || d.name}><div className="department-icon"><Icon size={24} /></div><div><h3>{d.name}</h3><p>Head: {d.head || 'Not assigned'}</p></div>{canWriteFeature('departments') && <button className="icon-button department-edit" aria-label={`Edit ${d.name}`} onClick={() => { setEditing(d); setModal(true); }}><Pencil size={16} /></button>}<div className="department-stats"><div><strong>{d.doctorsCount ?? d.doctors ?? 0}</strong><span>Doctors</span></div><div><strong>{d.patients ?? 0}</strong><span>Patients / mo.</span></div></div></div>; })}</div>}
      {modal && <Modal title={`${editing ? 'Edit' : 'Add'} ${tab === 'Doctors' ? 'Doctor' : 'Department'}`} onClose={() => { setModal(false); setEditing(null); }}><form className="form-grid" onSubmit={saveSetup}>{tab === 'Doctors' ? <><Field label="Doctor name" name="name" defaultValue={editing?.name} required /><Field label="Specialty" name="specialty" defaultValue={editing?.specialty} required /><SelectField label="Department" name="department" defaultValue={editing?.department} options={departmentList.map((item) => item.name)} /><Field label="Mobile" name="phone" defaultValue={editing?.phone} required /><Field label="Consultation fee (PKR)" name="fee" type="number" min="0" defaultValue={editing?.fee} required /><Field label="Availability" name="availability" placeholder="Mon–Sat" defaultValue={editing?.availability} required /></> : <><Field label="Department name" name="name" defaultValue={editing?.name} required /><Field label="Department head" name="head" defaultValue={editing?.head} required /></>}<div className="modal-actions full"><button type="button" className="secondary-button" onClick={() => { setModal(false); setEditing(null); }}>Cancel</button><button className="primary-button">Save {tab === 'Doctors' ? 'doctor' : 'department'}</button></div></form></Modal>}
    </>
  );
}

function ServicesPage({ services, setServices, notify, ensureWrite, canWriteFeature }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const categories = ['All', ...new Set(services.map(s => s.category))];
  const filtered = services.filter(s => (category === 'All' || s.category === category) && `${s.name} ${s.id}`.toLowerCase().includes(query.toLowerCase()));
  const saveService = async (event) => { event.preventDefault(); if (!ensureWrite('charge_master')) return; const f = new FormData(event.currentTarget); const payload = { name: f.get('name'), category: f.get('category'), department: f.get('department'), price: Number(f.get('price')) }; try { const result = editing ? await api.patch(`/hospital/services/${editing.databaseId || editing.id}`, payload) : await api.post('/hospital/services', payload); const item = result?.service || result?.data?.service || result?.data || result; setServices(editing ? services.map((service) => service === editing ? item : service) : [...services, item]); setModal(false); setEditing(null); notify(`Charge ${editing ? 'updated' : 'added to the charge master'}.`); } catch (error) { notify(error.message || 'Charge could not be saved.'); } };
  return (
    <>
      <PageHeader eyebrow="CHARGE MASTER" title="Services, Medicines & Room Charges" description="Maintain billable services and standard hospital rates." action={canWriteFeature('charge_master') ? <button className="primary-button" onClick={() => { if (ensureWrite('charge_master')) { setEditing(null); setModal(true); } }}><Plus size={18} /> Add Charge</button> : null} />
      <section className="panel"><div className="toolbar multi"><div className="search-box"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search charge master" /></div><select className="select-control" value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></div><div className="table-wrap"><table><thead><tr><th>Code</th><th>Service / Item</th><th>Category</th><th>Department</th><th>Standard Rate</th><th /></tr></thead><tbody>{filtered.map(s => <tr key={s.id}><td><span className="code-badge">{s.code || s.id}</span></td><td><strong>{s.name}</strong></td><td>{s.category}</td><td>{s.department?.name || s.department}</td><td><strong>{money(s.price)}</strong></td><td>{canWriteFeature('charge_master') && <button className="icon-button" aria-label={`Edit ${s.name}`} onClick={() => { setEditing(s); setModal(true); }}><Pencil size={16} /></button>}</td></tr>)}</tbody></table></div></section>
      {modal && <Modal title={`${editing ? 'Edit' : 'Add'} Billable Charge`} onClose={() => { setModal(false); setEditing(null); }}><form className="form-grid" onSubmit={saveService}><Field label="Service / Item Name" name="name" defaultValue={editing?.name} required /><SelectField label="Category" name="category" defaultValue={editing?.category} options={['Consultation', 'Laboratory', 'Radiology', 'Emergency', 'Room', 'Procedure', 'Medicine']} /><Field label="Department" name="department" defaultValue={editing?.department?.name || editing?.department} required /><Field label="Rate (PKR)" name="price" type="number" min="0" defaultValue={editing?.price} required /><div className="modal-actions full"><button type="button" className="secondary-button" onClick={() => { setModal(false); setEditing(null); }}>Cancel</button><button className="primary-button">Save Charge</button></div></form></Modal>}
    </>
  );
}

function BillingPage({ patients, services, invoices, setInvoices, notify, navigate, ensureWrite, canWriteFeature, featureEnabled }) {
  const [patientId, setPatientId] = useState(patients[0]?.id || '');
  const [payer, setPayer] = useState(patients[0]?.payer || 'Self Pay');
  const [visitType, setVisitType] = useState('OPD');
  const [items, setItems] = useState(() => services.slice(0, 2).map((service) => ({ serviceId: service.id, qty: 1 })));
  const [discount, setDiscount] = useState(0);
  const [coverage, setCoverage] = useState(0);
  const [notes, setNotes] = useState('');
  const selectedPatient = patients.find(p => p.id === patientId);
  const lines = items.map(item => ({ ...item, service: services.find(s => s.id === item.serviceId) })).filter(i => i.service);
  const subtotal = lines.reduce((sum, item) => sum + item.service.price * item.qty, 0);
  const insurance = payer === 'Self Pay' ? 0 : Math.round((Math.max(subtotal - discount, 0) * coverage) / 100);
  const total = Math.max(subtotal - discount - insurance, 0);
  const availableVisitTypes = useMemo(() => Object.keys(featureByVisit).filter((type) => featureEnabled(featureByVisit[type])), [featureEnabled]);
  useEffect(() => {
    if (!services.length) return;
    setItems((current) => current.some((item) => services.some((service) => service.id === item.serviceId))
      ? current
      : [{ serviceId: services[0].id, qty: 1 }]);
  }, [services]);
  useEffect(() => {
    if (availableVisitTypes.length && !availableVisitTypes.includes(visitType)) setVisitType(availableVisitTypes[0]);
  }, [availableVisitTypes, visitType]);
  const addLine = () => services[0] && setItems([...items, { serviceId: services[0].id, qty: 1 }]);
  const generate = async () => {
    const requiredFeature = featureByVisit[visitType] || 'opd_billing';
    if (!ensureWrite(requiredFeature) || !selectedPatient || !lines.length) return;
    try {
      const result = await api.post('/hospital/patient-invoices', { patientId, payer, visitType, items: items.map((item) => ({ serviceId: item.serviceId, qty: item.qty })), discount: Number(discount), coverage: Number(coverage), notes: notes.trim() || undefined });
      const raw = result?.invoice || result?.data?.invoice || result?.data || result;
      const inv = { ...raw, patient: raw.patient?.name || raw.patient || selectedPatient.name, patientId, date: raw.date || raw.createdAt, payer, total: raw.total ?? total, paid: raw.paid ?? 0, status: raw.status || (total === 0 ? 'Paid' : 'Outstanding'), type: raw.type || raw.visitType || visitType, items: raw.items?.map((item) => ({ ...item, name: item.name || item.description || item.service?.name, price: item.price ?? item.unitPrice })) || lines.map(i => ({ name: i.service.name, qty: i.qty, price: i.service.price })), discount: Number(discount), insurance, notes: raw.notes || notes.trim() };
      setInvoices([inv, ...invoices]); notify(`${inv.id || inv.invoiceNumber} generated successfully.`); navigate('Receipts');
    } catch (error) { notify(error.message || 'Invoice could not be generated.'); }
  };
  return (
    <>
      <PageHeader eyebrow="BILLING WORKSPACE" title="Create Patient Invoice" description="Build an itemised bill for OPD, inpatient, emergency, pharmacy, or laboratory services." />
      <div className="billing-layout">
        <section className="panel invoice-builder">
          <div className="section-title"><span>1</span><div><h2>Patient & Visit Details</h2><p>Select the patient and billing arrangement.</p></div></div>
          <div className="form-grid compact"><SelectField label="Patient" value={patientId} onChange={e => { const p = patients.find(x => x.id === e.target.value); setPatientId(e.target.value); setPayer(p?.payer || 'Self Pay'); }} options={patients.map(p => ({ label: `${p.name} (${p.id})`, value: p.id }))} /><SelectField label="Visit Type" value={availableVisitTypes.includes(visitType) ? visitType : availableVisitTypes[0]} onChange={e => setVisitType(e.target.value)} options={availableVisitTypes} /><SelectField label="Payer" value={payer} onChange={e => setPayer(e.target.value)} options={['Self Pay', ...(featureEnabled('insurance_billing') ? ['Jubilee Health', 'Adamjee Insurance', 'EFU Health'] : []), ...(featureEnabled('corporate_billing') ? ['Corporate'] : [])]} />{payer !== 'Self Pay' && <Field label="Coverage %" type="number" value={coverage} onChange={e => setCoverage(Number(e.target.value))} min="0" max="100" />}</div>
          <div className="section-title"><span>2</span><div><h2>Services & Charges</h2><p>Add all billable items to the invoice.</p></div></div>
          <div className="line-items"><div className="line-head"><span>Service / Item</span><span>Qty</span><span>Rate</span><span>Amount</span><span /></div>{items.map((item, index) => { const s = services.find(v => v.id === item.serviceId); return <div className="line-row" key={`${item.serviceId}-${index}`}><select value={item.serviceId} onChange={e => setItems(items.map((x,i) => i === index ? { ...x, serviceId: e.target.value } : x))}>{services.map(v => <option value={v.id} key={v.id}>{v.name}</option>)}</select><input type="number" min="1" value={item.qty} onChange={e => setItems(items.map((x,i) => i === index ? { ...x, qty: Number(e.target.value) } : x))} /><strong>{money(s?.price || 0)}</strong><strong>{money((s?.price || 0) * item.qty)}</strong><button className="icon-button danger" onClick={() => setItems(items.filter((_,i) => i !== index))}><Trash2 size={16} /></button></div>})}</div>
          <button className="add-line" onClick={addLine}><Plus size={17} /> Add another service</button>
          <div className="section-title"><span>3</span><div><h2>Adjustments</h2><p>Apply an authorised discount where required.</p></div></div>
          <div className="form-grid compact"><Field label="Discount (PKR)" type="number" value={discount} onChange={e => setDiscount(Number(e.target.value))} min="0" /><Field label="Reference / Notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength="1000" placeholder="Optional approval or claim reference" /></div>
        </section>
        <aside className="panel invoice-summary">
          <h2>Invoice Summary</h2>
          <div className="summary-patient"><div className="patient-dot">{selectedPatient?.name.split(' ').map(v => v[0]).join('').slice(0,2)}</div><div><strong>{selectedPatient?.name}</strong><span>{selectedPatient?.id} · {visitType}</span></div></div>
          <div className="summary-lines"><div><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div><span>Discount</span><strong>- {money(discount)}</strong></div>{payer !== 'Self Pay' && <div><span>Insurance Coverage</span><strong>- {money(insurance)}</strong></div>}<div className="summary-total"><span>Patient Payable</span><strong>{money(total)}</strong></div></div>
          <div className="summary-note"><ShieldCheck size={19} /><span>This is a demo invoice. No real patient or payment data is processed.</span></div>
          {!services.length && <div className="summary-note"><AlertTriangle size={19} /><span>Add at least one active item to the charge master before creating an invoice.</span></div>}
          {services.length > 0 && canWriteFeature(featureByVisit[visitType] || 'opd_billing') && <button className="primary-button wide" onClick={generate}><FileText size={18} /> Generate Invoice</button>}
        </aside>
      </div>
    </>
  );
}

function PaymentsPage({ invoices, setInvoices, payments, setPayments, notify, ensureWrite, canWriteFeature, featureEnabled }) {
  const [modal, setModal] = useState(false);
  const [refundModal, setRefundModal] = useState(false);
  const [tab, setTab] = useState(() => featureEnabled('payments') ? 'payments' : 'refunds');
  const [refunds, setRefunds] = useState(() => payments.filter((item) => Number(item.amount) < 0));
  const positivePayments = payments.filter((item) => Number(item.amount) > 0 && !String(item.status).toLowerCase().includes('refund'));
  const outstanding = invoices.filter((invoice) => Number(invoice.total) > Number(invoice.paid || invoice.paidAmount || 0));
  const todayKey = new Date().toISOString().slice(0, 10);
  const monthKey = todayKey.slice(0, 7);
  const collectedToday = positivePayments.filter((item) => String(item.date || item.paymentDate || '').slice(0, 10) === todayKey).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const refundedThisMonth = refunds.filter((item) => String(item.date || item.paymentDate || '').slice(0, 7) === monthKey).reduce((sum, item) => sum + Math.abs(Number(item.amount || 0)), 0);

  useEffect(() => {
    if (!featureEnabled('refunds')) return undefined;
    let active = true;
    api.get('/hospital/patient-refunds').then((result) => {
      if (active) setRefunds(unwrapList(result?.data || result, 'refunds', 'payments'));
    }).catch((error) => { if (active) notify(error.message || 'Refund history could not be loaded.'); });
    return () => { active = false; };
  }, [featureEnabled, notify]);

  const record = async (event) => {
    event.preventDefault();
    if (!ensureWrite('payments')) return;
    const form = new FormData(event.currentTarget);
    const invoice = invoices.find((item) => (item.id || item.invoiceNumber) === form.get('invoice'));
    const amount = Number(form.get('amount'));
    const balance = Number(invoice?.total || 0) - Number(invoice?.paid || invoice?.paidAmount || 0);
    if (!invoice || amount <= 0 || amount > balance) { notify('Enter a positive amount no greater than the invoice balance.'); return; }
    try {
      const result = await api.post('/hospital/patient-payments', { invoiceId: invoice.databaseId || invoice.id, amount, method: form.get('method'), reference: form.get('reference') || undefined });
      const raw = result?.payment || result?.data?.payment || result?.data || result;
      const item = { ...raw, id: raw.id || raw.paymentNumber, invoice: invoice.id || invoice.invoiceNumber, patient: invoice.patient?.name || invoice.patient, date: raw.date || raw.createdAt, method: raw.method || form.get('method'), amount, status: raw.status || 'Received' };
      setPayments([item, ...payments]);
      setInvoices(invoices.map((current) => current === invoice ? { ...current, paid: Math.min(Number(current.paid || 0) + amount, Number(current.total)), status: Number(current.paid || 0) + amount >= Number(current.total) ? 'Paid' : 'Partially Paid' } : current));
      setModal(false); notify('Payment recorded and outstanding balance updated.');
    } catch (error) { notify(error.message || 'Payment could not be recorded.'); }
  };

  const issueRefund = async (event) => {
    event.preventDefault();
    if (!ensureWrite('refunds')) return;
    const form = new FormData(event.currentTarget);
    const payment = positivePayments.find((item) => String(item.databaseId || item.id) === String(form.get('paymentId')));
    const amount = Number(form.get('amount'));
    if (!payment || amount <= 0 || amount > Number(payment.amount || 0)) { notify('Enter a valid refund amount within the original payment total.'); return; }
    try {
      const result = await api.post('/hospital/patient-refunds', { paymentId: payment.databaseId || payment.id, amount, reason: form.get('reason'), method: form.get('method') });
      const item = result?.refund || result?.data?.refund || result?.data || result;
      setRefunds([item, ...refunds]);
      setPayments([item, ...payments]);
      setRefundModal(false); setTab('refunds'); notify('Refund recorded with an audit entry.');
    } catch (error) { notify(error.message || 'Refund could not be recorded.'); }
  };

  const visibleRows = tab === 'refunds' ? refunds : positivePayments;
  return (
    <>
      <PageHeader eyebrow="REVENUE CYCLE" title="Payments, Refunds & Outstanding Balances" description="Track collections and authorised patient refunds." action={<div className="header-actions">{canWriteFeature('refunds') && <button className="secondary-button" onClick={() => ensureWrite('refunds') && setRefundModal(true)}><RefreshCcw size={17} /> Issue Refund</button>}{canWriteFeature('payments') && <button className="primary-button" onClick={() => ensureWrite('payments') && setModal(true)}><CreditCard size={18} /> Record Payment</button>}</div>} />
      <div className="stats-grid three"><StatCard label="Collected Today" value={money(collectedToday)} trend={`${positivePayments.filter((item) => String(item.date || item.paymentDate || '').slice(0, 10) === todayKey).length} posted transactions`} icon={Banknote} /><StatCard label="Outstanding" value={money(outstanding.reduce((sum, invoice) => sum + Number(invoice.total) - Number(invoice.paid || invoice.paidAmount || 0), 0))} trend={`${outstanding.length} open invoices`} icon={CircleDollarSign} tone="orange" /><StatCard label="Refunds This Month" value={money(refundedThisMonth)} trend={`${refunds.filter((item) => String(item.date || item.paymentDate || '').slice(0, 7) === monthKey).length} recorded refunds`} icon={RefreshCcw} tone="purple" /></div>
      <div className="tabs" role="tablist" aria-label="Patient transactions">{featureEnabled('payments') && <button role="tab" aria-selected={tab === 'payments'} className={tab === 'payments' ? 'active' : ''} onClick={() => setTab('payments')}>Payments</button>}{featureEnabled('refunds') && <button role="tab" aria-selected={tab === 'refunds'} className={tab === 'refunds' ? 'active' : ''} onClick={() => setTab('refunds')}>Refunds</button>}</div>
      <section className="panel"><div className="panel-heading"><div><h2>{tab === 'refunds' ? 'Refund history' : 'Recent payments'}</h2><p>Tenant-scoped patient account transactions</p></div><button className="secondary-button" onClick={() => downloadCsv(`hospital-${tab}.csv`, visibleRows)} disabled={!visibleRows.length}><Download size={16} /> Export</button></div>{visibleRows.length ? <div className="table-wrap"><table><thead><tr><th>Transaction</th><th>Patient</th><th>Invoice</th><th>Date</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead><tbody>{visibleRows.map((item) => <tr key={item.id}><td><strong>{item.id}</strong>{item.reference && <span>{item.reference}</span>}</td><td>{item.patient?.name || item.patient || '—'}</td><td>{item.invoice?.invoiceNumber || item.invoice || '—'}</td><td>{dateText(item.date || item.paymentDate)}</td><td>{item.method}</td><td><strong className={Number(item.amount) < 0 ? 'negative' : ''}>{money(item.amount)}</strong></td><td><Status status={item.status || (tab === 'refunds' ? 'Refunded' : 'Received')} /></td></tr>)}</tbody></table></div> : <EmptyState title={`No ${tab}`} message={`${titleCase(tab)} will appear here after they are recorded.`} />}</section>
      {modal && <Modal title="Record Patient Payment" onClose={() => setModal(false)}><form className="form-grid" onSubmit={record}><SelectField label="Outstanding Invoice" name="invoice" options={outstanding.map((invoice) => ({ label: `${invoice.id} — ${invoice.patient} (${money(Number(invoice.total) - Number(invoice.paid || invoice.paidAmount || 0))})`, value: invoice.id }))} required /><SelectField label="Payment Method" name="method" options={['Cash', 'Card', 'Bank Transfer', 'Insurance', 'Corporate']} required /><Field label="Amount (PKR)" name="amount" type="number" min="1" required /><Field label="Reference Number" name="reference" placeholder="Optional" /><div className="modal-actions full"><button type="button" className="secondary-button" onClick={() => setModal(false)}>Cancel</button><button className="primary-button">Post Payment</button></div></form></Modal>}
      {refundModal && <Modal title="Issue Patient Refund" onClose={() => setRefundModal(false)}><form className="form-grid" onSubmit={issueRefund}><SelectField className="full" label="Original Payment" name="paymentId" options={positivePayments.map((payment) => ({ label: `${payment.id} — ${payment.patient || 'Patient'} (${money(payment.amount)})`, value: payment.databaseId || payment.id }))} required /><Field label="Refund Amount (PKR)" name="amount" type="number" min="1" required /><SelectField label="Refund Method" name="method" options={['Original Method', 'Cash', 'Bank Transfer']} required /><label className="field full"><span>Reason</span><textarea name="reason" rows="4" minLength="3" required /></label><div className="modal-actions full"><button type="button" className="secondary-button" onClick={() => setRefundModal(false)}>Cancel</button><button className="primary-button">Record Refund</button></div></form></Modal>}
    </>
  );
}

function ReceiptsPage({ invoices, notify, hospital }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(invoices[0]);
  const filtered = invoices.filter((invoice) => `${invoice.id || invoice.invoiceNumber} ${invoice.patient?.name || invoice.patient || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    if (selected && invoices.some((invoice) => invoice.id === selected.id)) return;
    setSelected(invoices[0] || null);
  }, [invoices, selected]);
  return (
    <>
      <PageHeader eyebrow="DOCUMENT CENTRE" title="Invoices & Receipts" description="Preview, print, and download patient billing documents." />
      <div className="receipt-layout">
        <section className="panel receipt-list"><div className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search invoice or patient" aria-label="Search invoices and receipts" /></div>{filtered.map(inv => <button key={inv.id} className={`receipt-item ${selected?.id === inv.id ? 'active' : ''}`} onClick={() => setSelected(inv)}><div><strong>{inv.id}</strong><span>{inv.patient?.name || inv.patient} · {dateText(inv.date)}</span></div><div><strong>{money(inv.total)}</strong><Status status={inv.status} /></div></button>)}{!filtered.length && <EmptyState title="No matching invoices" message="Try another invoice number or patient name." />}</section>
        <section className="panel document-panel">
          {selected ? <InvoiceDocument invoice={selected} hospital={hospital} /> : <EmptyState title="Select an invoice" message="Choose an invoice to preview and print it." />}
          {selected && <div className="document-actions"><button className="secondary-button" onClick={() => { window.print(); notify('Print dialog opened.'); }}><Printer size={17} /> Print</button><button className="primary-button" onClick={() => { window.print(); notify('Choose Save as PDF in the browser print dialog.'); }}><Download size={17} /> Save as PDF</button></div>}
        </section>
      </div>
    </>
  );
}

function InvoiceDocument({ invoice, hospital }) {
  const items = invoice.items || [];
  const subtotal = items.reduce((sum, item) => sum + Number(item.qty || item.quantity || 1) * Number(item.price || item.unitPrice || 0), 0);
  const paid = Number(invoice.paid || invoice.paidAmount || 0);
  const balance = Math.max(Number(invoice.total || 0) - paid, 0);
  return <div className="invoice-document" id="printable-invoice"><div className="invoice-brand"><div className="brand-mark"><HeartPulse size={25} /></div><div><h2>{hospital?.name || 'Hospital Invoice'}</h2><p>{[hospital?.address, hospital?.city, hospital?.province, hospital?.phone].filter(Boolean).join(' · ')}</p></div><div className="invoice-title"><strong>INVOICE</strong><span>{invoice.id || invoice.invoiceNumber}</span></div></div><div className="invoice-info"><div><span>BILL TO</span><strong>{invoice.patient?.name || invoice.patient}</strong><p>Patient ID: {invoice.patientId}<br />Billing Type: {invoice.payer}</p></div><div><span>INVOICE DETAILS</span><p>Date: <strong>{dateText(invoice.date || invoice.invoiceDate)}</strong><br />Visit Type: <strong>{invoice.type || invoice.visitType}</strong><br />Status: <strong>{invoice.status}</strong></p></div></div><table className="invoice-table"><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{items.map((item,index) => { const quantity = Number(item.qty || item.quantity || 1); const price = Number(item.price || item.unitPrice || 0); return <tr key={`${item.name || item.description}-${index}`}><td>{item.name || item.description}</td><td>{quantity}</td><td>{money(price)}</td><td>{money(quantity * price)}</td></tr>; })}</tbody></table><div className="invoice-totals"><div><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div><span>Discount</span><strong>- {money(invoice.discount)}</strong></div><div><span>Insurance / Payer</span><strong>- {money(invoice.insurance)}</strong></div><div className="grand"><span>Total Payable</span><strong>{money(invoice.total)}</strong></div><div><span>Paid</span><strong>{money(paid)}</strong></div><div className="balance"><span>Balance Due</span><strong>{money(balance)}</strong></div></div>{invoice.notes && <div className="invoice-notes"><strong>Reference / Notes</strong><p>{invoice.notes}</p></div>}<div className="invoice-footer"><p>Thank you for choosing {hospital?.name || 'our hospital'}.</p><span>This computer-generated invoice does not require a signature.</span></div></div>;
}

function ReportsPage({ invoices, payments }) {
  const [range, setRange] = useState('This Month');
  const now = new Date();
  const rangeStart = new Date(now);
  if (range === 'This Week') rangeStart.setDate(now.getDate() - 6);
  else if (range === 'This Quarter') rangeStart.setMonth(Math.floor(now.getMonth() / 3) * 3, 1);
  else rangeStart.setDate(1);
  rangeStart.setHours(0, 0, 0, 0);
  const inRange = (value) => { const date = new Date(value); return !Number.isNaN(date.getTime()) && date >= rangeStart && date <= now; };
  const filteredInvoices = invoices.filter((invoice) => inRange(invoice.date || invoice.invoiceDate || invoice.createdAt));
  const filteredPayments = payments.filter((payment) => inRange(payment.date || payment.paymentDate || payment.createdAt));
  const billed = filteredInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const collected = filteredPayments.length
    ? filteredPayments.reduce((sum, payment) => sum + Math.max(Number(payment.amount || 0), 0), 0)
    : filteredInvoices.reduce((sum, invoice) => sum + Number(invoice.paid || invoice.paidAmount || 0), 0);
  const outstanding = filteredInvoices.reduce((sum, invoice) => sum + Math.max(Number(invoice.total || 0) - Number(invoice.paid || invoice.paidAmount || 0), 0), 0);
  const collectionRate = billed > 0 ? Math.min(Math.round((collected / billed) * 100), 100) : 0;
  const payerTotals = filteredInvoices.reduce((totals, invoice) => {
    const raw = String(invoice.payer || 'Self Pay').toLowerCase();
    const key = raw.includes('corporate') ? 'Corporate' : raw === 'self pay' ? 'Self Pay' : 'Insurance';
    totals[key] += Number(invoice.total || 0);
    return totals;
  }, { 'Self Pay': 0, Insurance: 0, Corporate: 0 });
  const departmentRows = Object.values(filteredInvoices.reduce((groups, invoice) => {
    const key = titleCase(invoice.type || invoice.visitType || 'Other');
    const current = groups[key] || { name: key, patients: new Set(), billed: 0, collected: 0 };
    current.patients.add(invoice.patientId || invoice.patient?.id || invoice.patient || invoice.id);
    current.billed += Number(invoice.total || 0);
    current.collected += Number(invoice.paid || invoice.paidAmount || 0);
    groups[key] = current;
    return groups;
  }, {}));
  return (
    <>
      <PageHeader eyebrow="FINANCIAL ANALYTICS" title="Financial Reports" description="Analyse billing, collections, payer mix, and service-line revenue." action={<div className="header-actions"><label className="sr-only" htmlFor="financial-report-range">Report date range</label><select id="financial-report-range" className="select-control" value={range} onChange={e => setRange(e.target.value)}><option>This Week</option><option>This Month</option><option>This Quarter</option></select><button className="secondary-button" disabled={!filteredInvoices.length} onClick={() => downloadCsv('hospital-financial-report.csv', filteredInvoices.map((invoice) => ({ invoice: invoice.id || invoice.invoiceNumber, date: invoice.date || invoice.invoiceDate, patient: invoice.patient?.name || invoice.patient, payer: invoice.payer, total: invoice.total, paid: invoice.paid || invoice.paidAmount, status: invoice.status }))) }><Download size={16} /> Export Report</button></div>} />
      <div className="stats-grid three"><StatCard label="Gross Billing" value={money(billed)} trend={range} icon={FileText} /><StatCard label="Net Collections" value={money(collected)} trend={`Collection rate ${collectionRate}%`} icon={Banknote} tone="green" /><StatCard label="Accounts Receivable" value={money(outstanding)} trend={`${filteredInvoices.filter((invoice) => Number(invoice.total) > Number(invoice.paid || invoice.paidAmount || 0)).length} open balances`} icon={CircleDollarSign} tone="orange" /></div>
      <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><div><h2>Monthly Revenue</h2><p>Gross billing versus collections</p></div></div><DualBars invoices={invoices} payments={payments} /></section><section className="panel"><div className="panel-heading"><div><h2>Payer Mix</h2><p>Revenue distribution for {range.toLowerCase()}</p></div></div><div className="payer-list">{Object.entries(payerTotals).map(([label, value]) => <PayerRow key={label} label={label} percent={billed > 0 ? Math.round((value / billed) * 100) : 0} value={money(value)} />)}</div></section></div>
      <section className="panel"><div className="panel-heading"><div><h2>Service-line Performance</h2><p>Billing and collection summary by visit type</p></div></div>{departmentRows.length ? <div className="table-wrap"><table><thead><tr><th>Service line</th><th>Patients</th><th>Gross Billing</th><th>Collections</th><th>Outstanding</th><th>Collection Rate</th></tr></thead><tbody>{departmentRows.map((row) => { const rate = row.billed > 0 ? Math.round((row.collected / row.billed) * 100) : 0; return <tr key={row.name}><td><strong>{row.name}</strong></td><td>{row.patients.size}</td><td>{money(row.billed)}</td><td>{money(row.collected)}</td><td>{money(Math.max(row.billed - row.collected, 0))}</td><td><div className="rate-cell"><div><span style={{ width: `${Math.min(rate, 100)}%` }} /></div><strong>{rate}%</strong></div></td></tr>; })}</tbody></table></div> : <EmptyState title="No report data" message={`No patient invoices were posted during ${range.toLowerCase()}.`} />}</section>
    </>
  );
}

function DualBars({ invoices, payments }) {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const billed = invoices.filter((invoice) => String(invoice.date || invoice.invoiceDate || invoice.createdAt || '').slice(0, 7) === key).reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    const collected = payments.length
      ? payments.filter((payment) => String(payment.date || payment.paymentDate || payment.createdAt || '').slice(0, 7) === key).reduce((sum, payment) => sum + Math.max(Number(payment.amount || 0), 0), 0)
      : invoices.filter((invoice) => String(invoice.date || invoice.invoiceDate || invoice.createdAt || '').slice(0, 7) === key).reduce((sum, invoice) => sum + Number(invoice.paid || invoice.paidAmount || 0), 0);
    return { key, label: new Intl.DateTimeFormat('en-PK', { month: 'short' }).format(date), billed, collected };
  });
  const max = Math.max(...months.flatMap((month) => [month.billed, month.collected]), 1);
  return <div className="dual-chart">{months.map((month) => <div className="dual-item" key={month.key}><div className="dual-bars"><span title={`Billed ${money(month.billed)}`} style={{ height: `${(month.billed / max) * 100}%` }} /><i title={`Collected ${money(month.collected)}`} style={{ height: `${(month.collected / max) * 100}%` }} /></div><small>{month.label}</small></div>)}</div>;
}

function PayerRow({ label, percent, value }) { return <div className="payer-row"><div><strong>{label}</strong><span>{percent}%</span></div><div className="payer-track"><span style={{ width: `${percent}%` }} /></div><small>{value}</small></div>; }

function SubscriptionBillingPage({ hospital, subscription: initialSubscription, setSubscription, notify }) {
  const [billing, setBilling] = useState({ subscription: initialSubscription, invoices: [], proofs: [], bankInstructions: null, safepay: null });
  const initialSubscriptionRef = useRef(initialSubscription);
  initialSubscriptionRef.current = initialSubscription;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [proofInvoice, setProofInvoice] = useState(null);
  const [safepayMessage, setSafepayMessage] = useState('');
  const [supportModal, setSupportModal] = useState(false);
  const [proofBusy, setProofBusy] = useState(false);
  const [safepayBusyId, setSafepayBusyId] = useState('');
  const [supportBusy, setSupportBusy] = useState(false);

  const loadBilling = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await api.get('/hospital/subscription');
      const data = result?.data || result;
      const baseSubscription = data.subscription || (data?.id && data?.status ? data : initialSubscriptionRef.current);
      const nextSubscription = baseSubscription ? {
        ...baseSubscription,
        limits: data.limits || baseSubscription.limits,
        usage: data.usage || baseSubscription.usage,
        features: data.features || data.modules || baseSubscription.features,
      } : null;
      setBilling({ subscription: nextSubscription, invoices: unwrapList(data.invoices || data.subscriptionInvoices, 'invoices', 'subscriptionInvoices'), proofs: unwrapList(data.proofs || data.bankTransferProofs, 'proofs', 'bankTransferProofs'), bankInstructions: data.bankInstructions || data.bank || null, safepay: data.safepay || baseSubscription?.safepay || null });
      setSubscription(nextSubscription);
    } catch (requestError) { setError(requestError.message || 'Subscription billing could not be loaded.'); }
    finally { setLoading(false); }
  }, [setSubscription]);

  useEffect(() => { loadBilling(); }, [loadBilling]);

  const submitProof = async (event) => {
    event.preventDefault();
    setProofBusy(true);
    const form = new FormData(event.currentTarget);
    form.set('invoiceId', proofInvoice.databaseId || proofInvoice.id);
    if (proofInvoice.parentProofId) form.set('parentProofId', proofInvoice.parentProofId);
    try {
      await api.post('/hospital/bank-transfer-proofs', form);
      setProofInvoice(null);
      notify('Bank-transfer proof submitted for AI Finora verification.');
      await loadBilling();
    } catch (requestError) { notify(requestError.message || 'Payment proof could not be submitted.'); }
    finally { setProofBusy(false); }
  };

  const createSafepayLink = async (invoice) => {
    const invoiceId = invoice.databaseId || invoice.id;
    setSafepayBusyId(invoiceId);
    try {
      const result = await api.post(`/hospital/subscription-invoices/${invoiceId}/safepay-link`, {});
      const data = result?.data || result;
      if (data.url && !data.demo && data.mode !== 'demo') window.location.assign(data.url);
      else setSafepayMessage(data.message || 'Safepay Demo is enabled. No real payment is being processed because merchant credentials are not configured.');
    } catch (requestError) { setSafepayMessage(requestError.message || 'Safepay is not configured for real payments.'); }
    finally { setSafepayBusyId(''); }
  };

  const submitSupport = async (event) => {
    event.preventDefault();
    setSupportBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await api.post('/hospital/support-requests', { subject: form.get('subject'), priority: String(form.get('priority') || 'Normal').toUpperCase(), description: form.get('message') });
      setSupportModal(false);
      notify('Support request sent to AI Finora.');
    } catch (requestError) { notify(requestError.message || 'Support request could not be sent.'); }
    finally { setSupportBusy(false); }
  };

  if (loading) return <PortalState icon={LoaderCircle} title="Loading subscription billing" message="Retrieving invoices and payment verification history…" spinning />;
  if (error) return <PortalState icon={AlertTriangle} title="Subscription billing unavailable" message={error} action={<button className="primary-button" onClick={loadBilling}>Try again</button>} />;

  const current = billing.subscription || {};
  const plan = current.plan?.name || current.planName || 'Custom';
  const implementation = billing.invoices.find((invoice) => String(invoice.type || invoice.invoiceType).toLowerCase().includes('implementation'));
  const modules = unwrapList(current.features || current.modules, 'features', 'modules').map((feature) => typeof feature === 'string' ? feature : feature.key || feature.featureKey || feature.code).filter(Boolean);
  const limits = current.limits || {};
  const usage = current.usage || {};
  const limitRows = [
    ['Users', usage.users ?? usage.activeUsers ?? 0, limits.maxUsers],
    ['Branches', usage.branches ?? usage.activeBranches ?? 0, limits.maxBranches],
    ['Beds', usage.beds ?? hospital?.numberOfBeds ?? 0, limits.maxBeds],
    ['Storage', usage.storageMb ?? usage.storageUsedMb ?? 0, limits.storageLimitMb, ' MB'],
  ];
  const safepay = billing.safepay || {};
  const showSafepay = Boolean(safepay.enabled && (safepay.demoMode || safepay.realPaymentsEnabled || safepay.configured));
  const safepayLabel = safepay.demoMode ? 'Safepay Demo' : 'Pay with Safepay';
  const hasBankInstructions = Boolean(billing.bankInstructions?.bankName && billing.bankInstructions?.accountTitle && billing.bankInstructions?.iban);
  return (
    <>
      <PageHeader eyebrow="AI FINORA ACCOUNT" title="Subscription & Billing" description="Manage your hospital plan, AI Finora invoices, and bank-transfer verification." action={<button className="secondary-button" onClick={() => setSupportModal(true)}><Bell size={17} /> Contact support</button>} />
      <div className="stats-grid">
        <StatCard label="Current Plan" value={plan} trend={current.billingCycle || 'Monthly'} icon={PackagePlus} />
        <StatCard label="Subscription Status" value={String(current.status || 'active').replaceAll('_', ' ')} trend={`Period ends ${dateText(current.currentPeriodEnd)}`} icon={ShieldCheck} tone="green" />
        <StatCard label="Implementation Fee" value={implementation?.status || current.implementationFeeStatus || 'Not due'} trend={implementation ? money(implementation.total) : 'Separate one-time invoice'} icon={CircleDollarSign} tone="purple" />
        <StatCard label="Next Renewal" value={dateText(current.nextBillingDate)} trend={current.gracePeriodEndsAt ? `Grace ends ${dateText(current.gracePeriodEndsAt)}` : 'Configured per contract'} icon={CalendarDays} tone="orange" />
      </div>

      <div className="dashboard-grid lower subscription-lower">
        <section className="panel"><div className="panel-heading"><div><h2>Plan usage & limits</h2><p>Current tenant usage against contracted allowances</p></div></div><div className="usage-list">{limitRows.map(([label, used, limit, suffix = '']) => { const numericLimit = Number(limit); const percentage = numericLimit > 0 ? Math.min((Number(used || 0) / numericLimit) * 100, 100) : 0; return <div className="usage-row" key={label}><div><span>{label}</span><strong>{Number(used || 0).toLocaleString('en-PK')}{suffix} / {limit == null ? 'Custom' : `${Number(limit).toLocaleString('en-PK')}${suffix}`}</strong></div><div className="usage-track"><span style={{ width: `${percentage}%` }} /></div></div>; })}</div></section>
        <section className="panel"><div className="panel-heading"><div><h2>Enabled modules</h2><p>Your role permissions are applied in addition to this plan</p></div></div>{modules.length ? <div className="module-chip-grid">{modules.map((module) => <span className="module-chip" key={module}><Check size={14} />{titleCase(module)}</span>)}</div> : <EmptyState title="No module list available" message="Contact AI Finora if your plan entitlements are not displayed." />}</section>
      </div>

      <section className="panel subscription-summary-panel">
        <div className="panel-heading"><div><h2>AI Finora subscription invoices</h2><p>These are separate from hospital patient invoices.</p></div></div>
        {billing.invoices.length ? <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Type</th><th>Issued</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>{billing.invoices.map((invoice) => { const balance = invoice.outstandingBalance ?? Math.max((invoice.total || 0) - (invoice.paidAmount || 0), 0); const openForPayment = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(String(invoice.status || '').toUpperCase()) && balance > 0; const invoiceId = invoice.databaseId || invoice.id; return <tr key={invoice.id}><td><strong>{invoice.invoiceNumber || invoice.id}</strong><span>{invoice.billingPeriod || 'AI Finora services'}</span></td><td>{String(invoice.type || invoice.invoiceType || '').replaceAll('_', ' ')}</td><td>{dateText(invoice.issueDate)}</td><td>{dateText(invoice.dueDate)}</td><td><strong>{money(invoice.total || 0)}</strong></td><td>{money(balance)}</td><td><Status status={String(invoice.status || 'issued').replaceAll('_', ' ')} /></td><td><div className="table-actions"><button className="table-action" type="button" onClick={() => setSelectedInvoice(invoice)}>View / Print</button>{openForPayment && <button className="table-action" type="button" onClick={() => setProofInvoice(invoice)}>Submit payment</button>}{openForPayment && showSafepay && <button className="table-action" type="button" disabled={safepayBusyId === invoiceId} onClick={() => createSafepayLink(invoice)}>{safepayBusyId === invoiceId ? 'Preparing…' : safepayLabel}</button>}</div></td></tr>; })}</tbody></table></div> : <EmptyState title="No subscription invoices" message="New implementation or renewal invoices will appear here." />}
      </section>

      <div className="dashboard-grid lower subscription-lower">
        <section className="panel"><div className="panel-heading"><div><h2>Bank-transfer instructions</h2><p>Use the invoice number as your payment reference.</p></div></div><div className="bank-instructions"><Detail label="Bank" value={billing.bankInstructions?.bankName || billing.bankInstructions?.name || 'Not configured'} /><Detail label="Account title" value={billing.bankInstructions?.accountTitle || billing.bankInstructions?.account_title || 'Not configured'} /><Detail label="IBAN" value={billing.bankInstructions?.iban || 'Not configured'} />{billing.bankInstructions?.branchCode && <Detail label="Branch code" value={billing.bankInstructions.branchCode} />}</div><div className="summary-note"><ShieldCheck size={19} /><span>{hasBankInstructions ? billing.bankInstructions?.paymentInstructions || 'Confirm the invoice number and transfer reference before submitting proof.' : 'Bank-transfer instructions must be configured by an AI Finora platform administrator before sending funds.'}</span></div></section>
        <section className="panel"><div className="panel-heading"><div><h2>Verification history</h2><p>Submitted bank-transfer proofs</p></div></div>{billing.proofs.length ? <div className="compact-list">{billing.proofs.map((proof) => <div className="compact-row" key={proof.id}><div className="patient-dot"><Upload size={16} /></div><div className="grow"><strong>{proof.transactionReference}</strong><span>{money(proof.claimedAmount ?? proof.amount)} · {proof.bankName} · {dateText(proof.transferDate)}</span>{proof.rejectionReason && <small className="negative">{proof.rejectionReason}</small>}</div>{String(proof.status).toLowerCase() === 'rejected' && <button className="table-action" onClick={() => { const invoice = billing.invoices.find((item) => item.id === proof.invoiceId); if (invoice) setProofInvoice({ ...invoice, parentProofId: proof.id }); }}>Resubmit</button>}<Status status={String(proof.status).replaceAll('_', ' ')} /></div>)}</div> : <EmptyState title="No transfer proofs" message="Choose an outstanding invoice to submit a receipt." />}</section>
      </div>

      {proofInvoice && <Modal title={`Submit payment for ${proofInvoice.invoiceNumber || proofInvoice.id}`} onClose={() => !proofBusy && setProofInvoice(null)}><form className="form-grid" onSubmit={submitProof}><Field label="Paid amount (PKR)" name="amount" type="number" min="1" max={proofInvoice.outstandingBalance ?? proofInvoice.total} required /><Field label="Bank name" name="bankName" required /><Field label="Transaction reference" name="transactionReference" required /><Field label="Transfer date" name="transferDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /><label className="field full"><span>Transfer receipt or screenshot</span><input name="proof" type="file" accept="image/png,image/jpeg,application/pdf" required /></label><div className="summary-note full"><ShieldCheck size={18} /><span>Uploads are stored outside public web access and can only be retrieved through authenticated routes.</span></div><div className="modal-actions full"><button type="button" className="secondary-button" disabled={proofBusy} onClick={() => setProofInvoice(null)}>Cancel</button><button className="primary-button" disabled={proofBusy}><Upload size={17} />{proofBusy ? 'Submitting…' : 'Submit for verification'}</button></div></form></Modal>}
      {selectedInvoice && <Modal title={`Subscription Invoice ${selectedInvoice.invoiceNumber || selectedInvoice.id}`} onClose={() => setSelectedInvoice(null)}><SubscriptionInvoiceDocument invoice={selectedInvoice} hospital={hospital} bankInstructions={billing.bankInstructions} /><div className="document-actions"><button className="primary-button" onClick={() => window.print()}><Printer size={17} /> Print / Save as PDF</button></div></Modal>}
      {safepayMessage && <Modal title={safepay.demoMode ? 'Safepay Demo' : 'Safepay payment'} onClose={() => setSafepayMessage('')}><div className="safe-demo"><ShieldCheck size={32} /><p>{safepayMessage}</p><strong>No payment has been completed from this message.</strong></div><div className="modal-actions"><button className="primary-button" onClick={() => setSafepayMessage('')}>Close</button></div></Modal>}
      {supportModal && <Modal title="Contact AI Finora Support" onClose={() => !supportBusy && setSupportModal(false)}><form className="form-grid" onSubmit={submitSupport}><Field label="Subject" name="subject" minLength="3" required /><SelectField label="Priority" name="priority" options={['Normal', 'High', 'Urgent']} /><label className="field full"><span>How can we help?</span><textarea name="message" rows="5" minLength="5" required /></label><div className="modal-actions full"><button type="button" className="secondary-button" disabled={supportBusy} onClick={() => setSupportModal(false)}>Cancel</button><button className="primary-button" disabled={supportBusy}>{supportBusy ? 'Sending…' : 'Send support request'}</button></div></form></Modal>}
    </>
  );
}

function SubscriptionInvoiceDocument({ invoice, hospital, bankInstructions }) {
  const items = invoice.items || [];
  const paid = invoice.paidAmount || 0;
  const balance = invoice.outstandingBalance ?? Math.max((invoice.total || 0) - paid, 0);
  const billingPeriod = invoice.billingPeriod
    || (invoice.billingPeriodStart && invoice.billingPeriodEnd
      ? `${dateText(invoice.billingPeriodStart)} to ${dateText(invoice.billingPeriodEnd)}`
      : invoice.billingPeriodStart
        ? `From ${dateText(invoice.billingPeriodStart)}`
        : invoice.billingPeriodEnd
          ? `Through ${dateText(invoice.billingPeriodEnd)}`
          : 'One-time charge / not applicable');
  const paymentInstructions = invoice.paymentInstructions
    || bankInstructions?.paymentInstructions
    || 'Use the invoice number as the transfer reference and submit proof for AI Finora verification.';
  const publicBankDetails = [
    ['Bank', bankInstructions?.bankName || bankInstructions?.name],
    ['Account title', bankInstructions?.accountTitle || bankInstructions?.account_title],
    ['IBAN', bankInstructions?.iban],
    ['Branch code', bankInstructions?.branchCode || bankInstructions?.branch_code],
  ].filter(([, value]) => String(value || '').trim());

  return <div className="invoice-document subscription-invoice-document" id="printable-subscription-invoice">
    <div className="invoice-brand"><div className="brand-mark"><HeartPulse size={25} /></div><div><h2>AI Finora</h2><p>Hospital SaaS subscription services · Pakistan</p></div><div className="invoice-title"><strong>SUBSCRIPTION INVOICE</strong><span>{invoice.invoiceNumber || invoice.id}</span></div></div>
    <div className="invoice-info"><div><span>BILL TO</span><strong>{hospital?.name}</strong><p>Hospital code: {hospital?.code || hospital?.slug}<br />{hospital?.city}, {hospital?.province}</p></div><div><span>INVOICE DETAILS</span><p>Type: <strong>{String(invoice.type || invoice.invoiceType || '').replaceAll('_', ' ')}</strong><br />Issue: <strong>{dateText(invoice.issueDate)}</strong><br />Due: <strong>{dateText(invoice.dueDate)}</strong><br />Billing period: <strong>{billingPeriod}</strong></p></div></div>
    <table className="invoice-table"><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{items.length ? items.map((item, index) => <tr key={item.id || index}><td>{item.description || item.name}</td><td>{item.quantity || item.qty || 1}</td><td>{money(item.unitAmount ?? item.unitPrice ?? item.price ?? item.amount)}</td><td>{money(item.lineTotal ?? item.amount ?? (item.quantity || 1) * (item.unitAmount || item.unitPrice || item.price || 0))}</td></tr>) : <tr><td>{String(invoice.type || invoice.invoiceType || 'Subscription service').replaceAll('_', ' ')}</td><td>1</td><td>{money(invoice.subtotal || invoice.total || 0)}</td><td>{money(invoice.subtotal || invoice.total || 0)}</td></tr>}</tbody></table>
    <div className="invoice-totals"><div><span>Subtotal</span><strong>{money(invoice.subtotal || invoice.total || 0)}</strong></div><div><span>Discount</span><strong>- {money(invoice.discount || 0)}</strong></div><div><span>Tax</span><strong>{money(invoice.tax || 0)}</strong></div><div className="grand"><span>Total</span><strong>{money(invoice.total || 0)}</strong></div><div><span>Paid</span><strong>{money(paid)}</strong></div><div className="balance"><span>Balance Due</span><strong>{money(balance)}</strong></div></div>
    <div className="invoice-payment-details" role="group" aria-label="Payment and bank-transfer details">
      <section><h3>Payment instructions</h3><p>{paymentInstructions}</p></section>
      <section><h3>Bank details</h3>{publicBankDetails.length
        ? <><dl>{publicBankDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{bankInstructions?.demoOnly && <p className="invoice-payment-warning">Demonstration account only — do not send real funds.</p>}</>
        : <p>Bank-transfer details are not configured. Contact AI Finora support before sending funds.</p>}</section>
    </div>
    <div className="invoice-footer"><p>Manual bank transfer requires AI Finora verification before subscription activation.</p><span>Use your browser print dialog to save this document as PDF.</span></div>
  </div>;
}

function EmptyState({ title, message }) { return <div className="empty-state"><FileText size={26} /><strong>{title}</strong><span>{message}</span></div>; }

function PharmacyInventoryPage({ notify, ensureWrite, canWriteFeature }) {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [modal, setModal] = useState(false);

  const loadInventory = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await api.get('/hospital/pharmacy-inventory');
      setItems(unwrapList(result?.data || result, 'items', 'inventory'));
    } catch (requestError) { setError(requestError.message || 'Pharmacy inventory could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadInventory(); }, [loadInventory]);

  const saveItem = async (event) => {
    event.preventDefault();
    if (!ensureWrite('pharmacy_inventory')) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      sku: form.get('sku'), name: form.get('name'), batchNumber: form.get('batchNumber') || undefined,
      quantity: Number(form.get('quantity')), reorderLevel: Number(form.get('reorderLevel') || 0),
      unitCost: Number(form.get('unitCost') || 0), salePrice: Number(form.get('salePrice') || 0),
      expiryDate: form.get('expiryDate') || (editing ? null : undefined),
    };
    try {
      const result = editing ? await api.patch(`/hospital/pharmacy-inventory/${editing.id}`, payload) : await api.post('/hospital/pharmacy-inventory', payload);
      const item = result?.data || result;
      setItems(editing ? items.map((current) => current.id === editing.id ? item : current) : [item, ...items]);
      setEditing(null); setModal(false); notify(`Inventory item ${editing ? 'updated' : 'created'}.`);
    } catch (requestError) { notify(requestError.message || 'Inventory item could not be saved.'); }
  };
  const filtered = items.filter((item) => `${item.sku} ${item.name} ${item.batchNumber || ''}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <PageHeader eyebrow="PHARMACY OPERATIONS" title="Pharmacy Inventory" description="Track tenant-scoped medicine stock, batches, expiry dates, and reorder levels." action={canWriteFeature('pharmacy_inventory') ? <button className="primary-button" onClick={() => { if (ensureWrite('pharmacy_inventory')) { setEditing(null); setModal(true); } }}><Plus size={18} /> Add Inventory Item</button> : null} />
    <section className="panel"><div className="toolbar"><div className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search medicine, SKU, or batch" aria-label="Search pharmacy inventory" /></div><button className="secondary-button" type="button" onClick={loadInventory}><RefreshCcw size={16} /> Refresh</button></div>
      {loading && <InlineState icon={LoaderCircle} message="Loading pharmacy inventory…" spinning />}{!loading && error && <InlineState icon={AlertTriangle} message={error} action={<button className="secondary-button" onClick={loadInventory}>Try again</button>} />}{!loading && !error && !filtered.length && <EmptyState title="No inventory items" message="Add the first medicine or adjust your search." />}
      {!loading && !error && filtered.length > 0 && <div className="table-wrap"><table><thead><tr><th>SKU / Medicine</th><th>Batch</th><th>Quantity</th><th>Reorder Level</th><th>Cost / Sale</th><th>Expiry</th><th>Status</th><th /></tr></thead><tbody>{filtered.map((item) => { const low = Number(item.quantity || 0) <= Number(item.reorderLevel || 0); return <tr key={item.id}><td><strong>{item.name}</strong><span>{item.sku}</span></td><td>{item.batchNumber || '—'}</td><td><strong>{Number(item.quantity || 0).toLocaleString('en-PK')}</strong></td><td>{Number(item.reorderLevel || 0).toLocaleString('en-PK')}</td><td>{money(item.unitCost || 0)}<span>Sale {money(item.salePrice || 0)}</span></td><td>{dateText(item.expiryDate)}</td><td><Status status={low ? 'Low Stock' : 'In Stock'} /></td><td>{canWriteFeature('pharmacy_inventory') && <button className="icon-button" aria-label={`Edit ${item.name}`} onClick={() => { setEditing(item); setModal(true); }}><Pencil size={16} /></button>}</td></tr>; })}</tbody></table></div>}
    </section>
    {modal && <Modal title={`${editing ? 'Edit' : 'Add'} Inventory Item`} onClose={() => { setEditing(null); setModal(false); }}><form className="form-grid" onSubmit={saveItem}><Field label="SKU" name="sku" defaultValue={editing?.sku} required /><Field label="Medicine name" name="name" defaultValue={editing?.name} required /><Field label="Batch number" name="batchNumber" defaultValue={editing?.batchNumber} /><Field label="Quantity" name="quantity" type="number" min="0" defaultValue={editing?.quantity ?? 0} required /><Field label="Reorder level" name="reorderLevel" type="number" min="0" defaultValue={editing?.reorderLevel ?? 0} /><Field label="Unit cost (PKR)" name="unitCost" type="number" min="0" step="0.01" defaultValue={editing?.unitCost ?? 0} /><Field label="Sale price (PKR)" name="salePrice" type="number" min="0" step="0.01" defaultValue={editing?.salePrice ?? 0} /><Field label="Expiry date" name="expiryDate" type="date" defaultValue={String(editing?.expiryDate || '').slice(0, 10)} /><div className="modal-actions full"><button className="secondary-button" type="button" onClick={() => { setEditing(null); setModal(false); }}>Cancel</button><button className="primary-button">Save Item</button></div></form></Modal>}
  </>;
}

function BranchesPage({ notify, ensureWrite, canWriteFeature, subscription }) {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [modal, setModal] = useState(false);

  const loadBranches = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await api.get('/hospital/branches'); setBranches(unwrapList(result?.data || result, 'branches', 'items')); }
    catch (requestError) { setError(requestError.message || 'Hospital branches could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadBranches(); }, [loadBranches]);

  const saveBranch = async (event) => {
    event.preventDefault(); if (!ensureWrite('multi_branch_management')) return;
    const form = new FormData(event.currentTarget);
    const payload = { code: form.get('code'), name: form.get('name'), address: form.get('address') || undefined, city: form.get('city'), province: form.get('province'), phone: form.get('phone') || undefined, ...(editing ? { isActive: form.get('isActive') === 'on' } : {}) };
    try {
      const result = editing ? await api.patch(`/hospital/branches/${editing.id}`, payload) : await api.post('/hospital/branches', payload);
      const branch = result?.data || result;
      setBranches(editing ? branches.map((current) => current.id === editing.id ? branch : current) : [branch, ...branches]);
      setEditing(null); setModal(false); notify(`Branch ${editing ? 'updated' : 'created'}.`);
    } catch (requestError) { notify(requestError.message || 'Branch could not be saved.'); }
  };
  const branchLimit = subscription?.limits?.maxBranches ?? subscription?.maxBranches;
  return <>
    <PageHeader eyebrow="TENANT STRUCTURE" title="Hospital Branches" description="Manage locations within this hospital tenant and its subscribed branch limit." action={canWriteFeature('multi_branch_management') ? <button className="primary-button" onClick={() => { if (ensureWrite('multi_branch_management')) { setEditing(null); setModal(true); } }}><Plus size={18} /> Add Branch</button> : null} />
    <div className="stats-grid three"><StatCard label="Configured Branches" value={branches.length} trend={branchLimit == null ? 'Custom branch allowance' : `${branchLimit} plan limit`} icon={Building2} /><StatCard label="Active Branches" value={branches.filter((branch) => branch.isActive !== false).length} trend="Available locations" icon={Check} tone="green" /><StatCard label="Inactive Branches" value={branches.filter((branch) => branch.isActive === false).length} trend="Records retained" icon={AlertTriangle} tone="orange" /></div>
    <section className="panel">{loading && <InlineState icon={LoaderCircle} message="Loading hospital branches…" spinning />}{!loading && error && <InlineState icon={AlertTriangle} message={error} action={<button className="secondary-button" onClick={loadBranches}>Try again</button>} />}{!loading && !error && !branches.length && <EmptyState title="No branches configured" message="Add the first hospital location for this tenant." />}{!loading && !error && branches.length > 0 && <div className="table-wrap"><table><thead><tr><th>Branch</th><th>Code</th><th>Location</th><th>Phone</th><th>Status</th><th /></tr></thead><tbody>{branches.map((branch) => <tr key={branch.id}><td><strong>{branch.name}</strong><span>{branch.address || 'No address supplied'}</span></td><td><span className="code-badge">{branch.code}</span></td><td>{branch.city}<span>{branch.province}</span></td><td>{branch.phone || '—'}</td><td><Status status={branch.isActive === false ? 'Inactive' : 'Active'} /></td><td>{canWriteFeature('multi_branch_management') && <button className="icon-button" aria-label={`Edit ${branch.name}`} onClick={() => { setEditing(branch); setModal(true); }}><Pencil size={16} /></button>}</td></tr>)}</tbody></table></div>}</section>
    {modal && <Modal title={`${editing ? 'Edit' : 'Add'} Hospital Branch`} onClose={() => { setEditing(null); setModal(false); }}><form className="form-grid" onSubmit={saveBranch}><Field label="Branch code" name="code" defaultValue={editing?.code} required /><Field label="Branch name" name="name" defaultValue={editing?.name} required /><Field label="City" name="city" defaultValue={editing?.city} required /><Field label="Province" name="province" defaultValue={editing?.province} required /><Field label="Phone" name="phone" defaultValue={editing?.phone} /><Field label="Address" name="address" defaultValue={editing?.address} />{editing && <label className="check-field full"><input type="checkbox" name="isActive" defaultChecked={editing.isActive !== false} /><span>Branch is active</span></label>}<div className="modal-actions full"><button className="secondary-button" type="button" onClick={() => { setEditing(null); setModal(false); }}>Cancel</button><button className="primary-button">Save Branch</button></div></form></Modal>}
  </>;
}

function DataExportPage({ notify, isSupportAccess }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadRequests = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await api.get('/hospital/data-export-requests'); setRequests(unwrapList(result?.data || result, 'requests', 'items')); }
    catch (requestError) { setError(requestError.message || 'Data-export requests could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadRequests(); }, [loadRequests]);

  const submitRequest = async (event) => {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await api.post('/hospital/data-export-requests', { scope: form.get('scope'), format: form.get('format'), reason: form.get('reason') });
      const request = result?.data || result;
      setRequests([request, ...requests]); setModal(false); notify('Data-export request submitted for secure preparation.');
    } catch (requestError) { notify(requestError.message || 'Data-export request could not be submitted.'); }
    finally { setBusy(false); }
  };
  return <>
    <PageHeader eyebrow="DATA PORTABILITY" title="Data Export Requests" description="Request a secure tenant export. The request is audited and does not make patient files public." action={!isSupportAccess ? <button className="primary-button" onClick={() => setModal(true)}><Download size={18} /> Request Export</button> : null} />
    <div className="summary-note export-security-note"><ShieldCheck size={19} /><span>Export requests remain available in read-only and suspended account states. AI Finora must verify and prepare any resulting archive through an authorised secure channel.</span></div>
    <section className="panel">{loading && <InlineState icon={LoaderCircle} message="Loading export requests…" spinning />}{!loading && error && <InlineState icon={AlertTriangle} message={error} action={<button className="secondary-button" onClick={loadRequests}>Try again</button>} />}{!loading && !error && !requests.length && <EmptyState title="No export requests" message="Submitted tenant-export requests and their status will appear here." />}{!loading && !error && requests.length > 0 && <div className="table-wrap"><table><thead><tr><th>Request</th><th>Scope</th><th>Format</th><th>Reason</th><th>Submitted</th><th>Status</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td><strong>{request.requestNumber || request.id}</strong></td><td>{titleCase(request.scope || request.exportScope || 'all_data')}</td><td>{String(request.format || request.exportFormat || 'CSV').toUpperCase()}</td><td>{request.reason || request.description || '—'}</td><td>{dateText(request.createdAt || request.requestedAt)}</td><td><Status status={request.status || 'Open'} /></td></tr>)}</tbody></table></div>}</section>
    {modal && <Modal title="Request Hospital Data Export" onClose={() => !busy && setModal(false)}><form className="form-grid" onSubmit={submitRequest}><SelectField label="Export scope" name="scope" options={[{ label: 'All tenant data', value: 'ALL_DATA' }, { label: 'Patient records', value: 'PATIENTS' }, { label: 'Billing records', value: 'BILLING' }, { label: 'Operational records', value: 'OPERATIONS' }]} required /><SelectField label="Format" name="format" options={['CSV', 'JSON']} required /><label className="field full"><span>Reason for export</span><textarea name="reason" rows="4" minLength="3" required /></label><div className="modal-actions full"><button type="button" className="secondary-button" disabled={busy} onClick={() => setModal(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Submitting…' : 'Submit Request'}</button></div></form></Modal>}
  </>;
}

function InlineState({ icon: Icon, message, action, spinning = false }) { return <div className="inline-state" role={Icon === AlertTriangle ? 'alert' : 'status'}><Icon className={spinning ? 'spinning' : ''} size={22} /><span>{message}</span>{action}</div>; }

function UsersPage({ role, notify, hospitalUsers, setHospitalUsers, ensureWrite, canWriteFeature, currentUser }) {
  const [modal, setModal] = useState(false);
  const [accessChange, setAccessChange] = useState(null);
  const [accessReason, setAccessReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api.get('/hospital/users').then((result) => {
      if (active) setHospitalUsers(unwrapList(result?.data || result, 'users'));
    }).catch((error) => { if (active) notify(error.message || 'Hospital users could not be loaded.'); });
    return () => { active = false; };
  }, [notify, setHospitalUsers]);
  const permissionRows = ['Dashboard', 'Patient Registration', 'Appointments & Admissions', 'Charge Master', 'Invoice Generation', 'Payments & Refunds', 'Financial Reports', 'User Management'];
  const map = {
    'Hospital Admin': [1,1,1,1,1,1,1,1],
    Receptionist: [1,1,1,1,0,0,0,0],
    'Billing Officer': [1,1,1,1,1,1,0,0],
    Accountant: [1,0,0,0,1,1,1,0],
  };
  const addUser = async (event) => {
    event.preventDefault();
    if (!ensureWrite('user_management')) return;
    const form = new FormData(event.currentTarget);
    try {
      const roleKey = String(form.get('role')).toLowerCase().replaceAll(' ', '_');
      const result = await api.post('/hospital/users', { fullName: form.get('fullName'), email: form.get('email'), mobile: form.get('mobile'), roleKey, temporaryPassword: form.get('temporaryPassword'), requirePasswordChange: true });
      const newUser = result?.user || result?.data?.user || result?.data || result;
      setHospitalUsers([newUser, ...hospitalUsers]);
      setModal(false);
      notify('Hospital user created with a temporary password.');
    } catch (error) { notify(error.message || 'Hospital user could not be created.'); }
  };
  const updateAccess = async () => {
    if (!accessChange || !ensureWrite('user_management')) return;
    setBusy(true);
    try {
      const result = await api.patch(`/hospital/users/${accessChange.id}`, { isActive: !accessChange.isActive, reason: accessReason.trim() });
      const updated = result?.data || result;
      setHospitalUsers(hospitalUsers.map((item) => item.id === accessChange.id ? { ...item, ...updated, isActive: updated.isActive ?? !accessChange.isActive } : item));
      notify(`${accessChange.fullName} ${accessChange.isActive ? 'disabled' : 'reactivated'}.`);
      setAccessChange(null); setAccessReason('');
    } catch (error) { notify(error.message || 'User access could not be updated.'); }
    finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader eyebrow="ACCESS CONTROL" title="Users & Permissions" description="Configure role-based access for hospital staff." action={canWriteFeature('user_management') ? <button className="primary-button" onClick={() => ensureWrite('user_management') && setModal(true)}><UserPlus size={18} /> Add User</button> : null} />
      <div className="role-cards">{Object.keys(roles).map((r) => <div className={`role-card ${role === r ? 'current' : ''}`} key={r}><div className="role-icon"><UserCog size={22} /></div><div><strong>{r}</strong><span>{hospitalUsers.filter((item) => displayRole(item.role) === r && item.isActive !== false).length} active users</span></div>{role === r && <em>Current role</em>}</div>)}</div>
      <section className="panel users-panel"><div className="panel-heading"><div><h2>Hospital users</h2><p>Disable access without deleting identity or audit history</p></div></div>{hospitalUsers.length ? <div className="table-wrap"><table><thead><tr><th>User</th><th>Contact</th><th>Role</th><th>Password status</th><th>Access</th><th /></tr></thead><tbody>{hospitalUsers.map((item) => { const isCurrent = String(item.id) === String(currentUser?.id); return <tr key={item.id}><td><strong>{item.fullName}</strong>{isCurrent && <span>Current account</span>}</td><td>{item.email}<span>{item.mobile || 'No mobile'}</span></td><td>{item.roleName || displayRole(item.role)}</td><td>{item.mustChangePassword ? 'Change required' : 'Current'}</td><td><Status status={item.isActive === false ? 'Disabled' : 'Active'} /></td><td>{canWriteFeature('user_management') && !isCurrent && <button className={`table-action ${item.isActive === false ? '' : 'negative'}`} onClick={() => { setAccessReason(''); setAccessChange({ ...item, isActive: item.isActive !== false }); }}>{item.isActive === false ? 'Reactivate' : 'Disable'}</button>}</td></tr>; })}</tbody></table></div> : <EmptyState title="No hospital users" message="Create the first staff account for this hospital." />}</section>
      <section className="panel"><div className="panel-heading"><div><h2>Permission Matrix</h2><p>View access available to each system role</p></div></div><div className="table-wrap permission-table"><table><thead><tr><th>Module</th>{Object.keys(map).map(r => <th key={r}>{r}</th>)}</tr></thead><tbody>{permissionRows.map((row,index) => <tr key={row}><td><strong>{row}</strong></td>{Object.keys(map).map(r => <td key={r}>{map[r][index] ? <span className="permission yes"><Check size={15} /></span> : <span className="permission no"><X size={15} /></span>}</td>)}</tr>)}</tbody></table></div></section>
      {modal && <Modal title="Add Hospital User" onClose={() => setModal(false)}><form className="form-grid" onSubmit={addUser}><Field label="Full name" name="fullName" required /><Field label="Email" name="email" type="email" required /><Field label="Mobile" name="mobile" required /><SelectField label="Role" name="role" options={['Receptionist', 'Billing Officer', 'Accountant', 'Hospital Admin']} /><Field label="Temporary password" name="temporaryPassword" type="password" autoComplete="new-password" minLength="10" maxLength="128" pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{10,128}" title="Use 10–128 characters with uppercase, lowercase, a number, and a special character." required /><div className="summary-note full"><ShieldCheck size={18} /><span>Use 10–128 characters with uppercase, lowercase, a number, and a special character. The user must change it at first login.</span></div><div className="modal-actions full"><button type="button" className="secondary-button" onClick={() => setModal(false)}>Cancel</button><button className="primary-button">Create user</button></div></form></Modal>}
      {accessChange && <Modal title={`${accessChange.isActive ? 'Disable' : 'Reactivate'} ${accessChange.fullName}?`} onClose={() => !busy && setAccessChange(null)}><div className="summary-note"><ShieldCheck size={18} /><span>{accessChange.isActive ? 'The user will be signed out and unable to log in. Their records and audit history remain intact.' : 'The user will regain access according to their role, plan modules, and subscription state.'}</span></div><label className="field"><span>Reason (required)</span><textarea rows="4" value={accessReason} onChange={(event) => setAccessReason(event.target.value)} minLength="3" required /></label><div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setAccessChange(null)}>Cancel</button><button type="button" className="primary-button" disabled={busy || accessReason.trim().length < 3} onClick={updateAccess}>{busy ? 'Saving…' : 'Confirm Access Change'}</button></div></Modal>}
    </>
  );
}

function Modal({ title, onClose, children }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || [])];
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current?.(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); previous?.focus?.(); };
  }, []);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}><div ref={dialogRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="modal-head"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label={`Close ${title}`} onClick={onClose}><X size={20} /></button></div>{children}</div></div>;
}
function Field({ label, name, className = '', ...props }) { return <label className={`field ${className}`}><span>{label}</span><input name={name} {...props} /></label>; }
function SelectField({ label, name, options = [], className = '', ...props }) { return <label className={`field ${className}`}><span>{label}</span><select name={name} {...props}>{options.map((opt) => typeof opt === 'string' ? <option key={opt} value={opt}>{opt}</option> : <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></label>; }
function Detail({ label, value }) { return <div className="detail"><span>{label}</span><strong>{value}</strong></div>; }
function Status({ status }) { const label = String(status || 'Unknown'); const slug = label.toLowerCase().replaceAll(' ', '-').replaceAll('_', '-'); return <span className={`status ${slug}`}>{titleCase(label)}</span>; }

export default HospitalPortal;
