import { useMemo } from 'react';
import {
  Banknote,
  Building2,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Eye,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  ADMIN_API_ROOT,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
  StatusBadge,
  formatDate,
  formatPkr,
  titleCase,
  useAdminResource,
} from '../../components/super-admin/AdminUI.jsx';

const metricDefinitions = [
  ['totalHospitals', 'Total hospitals', Building2, 'blue'],
  ['activeHospitals', 'Active hospitals', Sparkles, 'green'],
  ['trialHospitals', 'Trial hospitals', Clock3, 'purple'],
  ['pastDueHospitals', 'Past due', ShieldAlert, 'orange'],
  ['readOnlyHospitals', 'Read-only', Eye, 'orange'],
  ['suspendedHospitals', 'Suspended', ShieldAlert, 'red'],
  ['monthlyRecurringRevenue', 'Monthly recurring revenue', CircleDollarSign, 'blue', true],
  ['annualRecurringRevenue', 'Annual recurring revenue', TrendingUp, 'green', true],
  ['outstandingInvoiceAmount', 'Outstanding invoices', Banknote, 'orange', true],
  ['paymentsAwaitingVerification', 'Awaiting verification', CreditCard, 'purple'],
  ['renewingNext30Days', 'Renewing in 30 days', CalendarClock, 'blue'],
  ['enabledUsers', 'Enabled users', Users, 'green'],
];

function metricValue(data, key) {
  const aliases = {
    monthlyRecurringRevenue: ['mrr'],
    annualRecurringRevenue: ['arr'],
    outstandingInvoiceAmount: ['outstandingSubscriptionInvoices', 'outstandingAmount'],
    paymentsAwaitingVerification: ['pendingPaymentProofs'],
    renewingNext30Days: ['renewalsNext30Days'],
    enabledUsers: ['totalEnabledUsers'],
  };
  if (data?.[key] !== undefined) return data[key];
  return aliases[key]?.map((alias) => data?.[alias]).find((value) => value !== undefined) ?? 0;
}

export default function OverviewPage() {
  const { data, loading, error, reload } = useAdminResource(`${ADMIN_API_ROOT}/overview`);
  const monthlyRevenue = useMemo(
    () => Array.isArray(data?.monthlyRevenue) ? data.monthlyRevenue : Array.isArray(data?.monthlySubscriptionRevenue) ? data.monthlySubscriptionRevenue : [],
    [data],
  );
  const statusDistribution = Array.isArray(data?.statusDistribution)
    ? Object.fromEntries(data.statusDistribution.map((item) => [item.status, item.count]))
    : data?.statusDistribution || {};
  const recentSignups = Array.isArray(data?.recentSignups) ? data.recentSignups : Array.isArray(data?.recentHospitalSignups) ? data.recentHospitalSignups : [];
  const recentPayments = Array.isArray(data?.recentPayments) ? data.recentPayments : Array.isArray(data?.recentSubscriptionPayments) ? data.recentSubscriptionPayments : [];
  const maxRevenue = useMemo(
    () => Math.max(...monthlyRevenue.map((item) => Number(item.amount ?? item.revenue ?? item.total ?? 0)), 1),
    [monthlyRevenue],
  );

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="A live view of hospital growth, subscription health, and recurring revenue across AI Finora."
      >
        <button className="sa-button sa-button--secondary" type="button" onClick={reload}><RefreshCw size={16} />Refresh</button>
      </PageHeader>

      {loading && <LoadingState label="Loading platform metrics…" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && (
        <>
          <section className="sa-metrics-grid" aria-label="SaaS metrics">
            {metricDefinitions.map(([key, label, Icon, tone, currency]) => {
              const value = metricValue(data, key);
              return <MetricCard key={key} icon={Icon} label={label} value={currency ? formatPkr(value, true) : Number(value || 0).toLocaleString('en-PK')} tone={tone} />;
            })}
          </section>

          <section className="sa-dashboard-grid">
            <article className="sa-panel sa-panel--wide">
              <div className="sa-panel__head">
                <div><h2>Monthly subscription revenue</h2><p>Verified recurring subscription payments in PKR</p></div>
                <span className="sa-panel__metric">{formatPkr(monthlyRevenue.reduce((sum, item) => sum + Number(item.amount ?? item.revenue ?? item.total ?? 0), 0), true)}</span>
              </div>
              {monthlyRevenue.length ? (
                <div className="sa-revenue-chart" role="img" aria-label="Monthly subscription revenue bar chart">
                  {monthlyRevenue.map((item, index) => {
                    const amount = Number(item.amount ?? item.revenue ?? item.total ?? 0);
                    return (
                      <div className="sa-revenue-chart__item" key={`${item.month || item.label}-${index}`}>
                        <span className="sa-revenue-chart__value">{formatPkr(amount, true)}</span>
                        <div className="sa-revenue-chart__track"><i style={{ height: `${Math.max((amount / maxRevenue) * 100, 4)}%` }} /></div>
                        <small>{item.month || item.label}</small>
                      </div>
                    );
                  })}
                </div>
              ) : <EmptyState title="No revenue recorded" description="Verified subscription payments will appear here." />}
            </article>

            <article className="sa-panel">
              <div className="sa-panel__head"><div><h2>Subscription health</h2><p>Hospitals by current access state</p></div></div>
              {Object.keys(statusDistribution).length ? (
                <div className="sa-distribution-list">
                  {Object.entries(statusDistribution).map(([status, count]) => {
                    const total = Math.max(Number(metricValue(data, 'totalHospitals')), 1);
                    return (
                      <div className="sa-distribution-row" key={status}>
                        <div><StatusBadge status={status} /><strong>{count}</strong></div>
                        <div className="sa-progress"><span style={{ width: `${Math.min((Number(count) / total) * 100, 100)}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              ) : <EmptyState title="No subscription data" description="Status distribution will appear after hospitals are onboarded." />}
            </article>
          </section>

          <section className="sa-dashboard-grid sa-dashboard-grid--even">
            <article className="sa-panel">
              <div className="sa-panel__head"><div><h2>Recent hospital signups</h2><p>Newest tenant accounts</p></div></div>
              {recentSignups.length ? (
                <div className="sa-feed-list">
                  {recentSignups.map((hospital) => (
                    <div className="sa-feed-row" key={hospital.id || hospital.code}>
                      <span className="sa-feed-avatar">{(hospital.name || 'H').slice(0, 2).toUpperCase()}</span>
                      <div><strong>{hospital.name}</strong><span>{hospital.city || 'Pakistan'} · {hospital.code || hospital.slug}</span></div>
                      <div className="sa-feed-row__end"><StatusBadge status={hospital.subscriptionStatus || hospital.status} /><small>{formatDate(hospital.createdAt)}</small></div>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="No recent signups" description="Newly onboarded hospitals will appear here." />}
            </article>

            <article className="sa-panel">
              <div className="sa-panel__head"><div><h2>Recent subscription payments</h2><p>Latest verified collections</p></div></div>
              {recentPayments.length ? (
                <div className="sa-feed-list">
                  {recentPayments.map((payment) => (
                    <div className="sa-feed-row" key={payment.id || payment.reference}>
                      <span className="sa-feed-avatar sa-feed-avatar--money"><Banknote size={17} /></span>
                      <div><strong>{payment.hospitalName || payment.hospital?.name || 'Hospital payment'}</strong><span>{payment.reference || payment.transactionReference || titleCase(payment.method)}</span></div>
                      <div className="sa-feed-row__end"><strong>{formatPkr(payment.amount)}</strong><small>{formatDate(payment.paidAt || payment.createdAt)}</small></div>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="No recent payments" description="Approved subscription payments will appear here." />}
            </article>
          </section>
        </>
      )}
    </>
  );
}
