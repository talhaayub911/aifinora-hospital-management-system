import { Navigate, Route, Routes } from 'react-router-dom';
import AdminLayout from '../../components/super-admin/AdminLayout.jsx';
import { AdminToastProvider } from '../../components/super-admin/AdminUI.jsx';
import '../../styles/super-admin.css';
import ActivityLogsPage from './ActivityLogsPage.jsx';
import AddHospitalPage from './AddHospitalPage.jsx';
import AdminUsersPage from './AdminUsersPage.jsx';
import HospitalDetailPage from './HospitalDetailPage.jsx';
import HospitalsPage from './HospitalsPage.jsx';
import InvoicesPage from './InvoicesPage.jsx';
import OverviewPage from './OverviewPage.jsx';
import PaymentVerificationPage from './PaymentVerificationPage.jsx';
import PlansPage from './PlansPage.jsx';
import PlatformSettingsPage from './PlatformSettingsPage.jsx';
import SafepayTransactionsPage from './SafepayTransactionsPage.jsx';
import SubscriptionsPage from './SubscriptionsPage.jsx';
import SupportRequestsPage from './SupportRequestsPage.jsx';

export function SuperAdminRoutes() {
  return (
    <AdminToastProvider>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="hospitals" element={<HospitalsPage />} />
          <Route path="hospitals/new" element={<AddHospitalPage />} />
          <Route path="hospitals/:hospitalId" element={<HospitalDetailPage />} />
          <Route path="plans" element={<PlansPage />} />
          <Route path="subscriptions" element={<SubscriptionsPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="payment-verification" element={<PaymentVerificationPage />} />
          <Route path="safepay-transactions" element={<SafepayTransactionsPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="support-requests" element={<SupportRequestsPage />} />
          <Route path="activity-logs" element={<ActivityLogsPage />} />
          <Route path="settings" element={<PlatformSettingsPage />} />
          <Route path="*" element={<Navigate to="/super-admin" replace />} />
        </Route>
      </Routes>
    </AdminToastProvider>
  );
}

export const SuperAdminApp = SuperAdminRoutes;
export default SuperAdminRoutes;
