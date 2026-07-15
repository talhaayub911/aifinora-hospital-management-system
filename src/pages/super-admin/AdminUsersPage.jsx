import { useMemo, useState } from 'react';
import { Download, Eye, Search, UserCheck, UserCog, UserX, Users } from 'lucide-react';
import { api } from '../../services/api.js';
import {
  ADMIN_API_ROOT,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
  TableShell,
  apiErrorMessage,
  asArray,
  formatDate,
  titleCase,
  useAdminResource,
  useAdminToast,
} from '../../components/super-admin/AdminUI.jsx';

export default function AdminUsersPage() {
  const resource = useAdminResource(`${ADMIN_API_ROOT}/users`);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [selected, setSelected] = useState(null);
  const [statusAction, setStatusAction] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { notify } = useAdminToast();
  const allUsers = asArray(resource.data, ['users', 'items']);
  const roles = [...new Set(allUsers.map((user) => user.roleKey || user.role?.key || user.role).filter(Boolean))];
  const users = useMemo(() => allUsers.filter((user) => {
    const needle = query.toLowerCase();
    return (!needle || [user.fullName, user.name, user.email, user.hospitalName, user.hospital?.name].some((value) => String(value || '').toLowerCase().includes(needle))) && (!role || (user.roleKey || user.role?.key || user.role) === role);
  }), [allUsers, query, role]);

  const exportUsers = () => {
    const header = ['Name', 'Email', 'Account type', 'Role', 'Hospital', 'Status', 'Last login'];
    const rows = users.map((user) => [user.fullName || user.name, user.email, user.accountType || user.type, user.roleKey || user.role?.name || user.role, user.hospitalName || user.hospital?.name || 'Platform', user.isActive === false ? 'Disabled' : user.status || 'Active', user.lastLoginAt || '']);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'ai-finora-users.csv'; anchor.click(); URL.revokeObjectURL(url);
    notify('User directory exported.');
  };

  const requestStatusChange = (user) => {
    setReason('');
    setStatusAction(user);
  };

  const applyStatusChange = async () => {
    if (!reason.trim()) {
      notify('Enter a reason for this user status change.', 'warning');
      return;
    }

    const nextActive = statusAction.isActive === false;
    setBusy(true);
    try {
      await api.patch(`${ADMIN_API_ROOT}/users/${statusAction.id}`, {
        isActive: nextActive,
        reason: reason.trim(),
      });
      notify(`${statusAction.fullName || statusAction.name} was ${nextActive ? 'enabled' : 'disabled'}.`);
      setStatusAction(null);
      setReason('');
      if (selected?.id === statusAction.id) setSelected(null);
      resource.reload();
    } catch (error) {
      notify(apiErrorMessage(error, 'User status could not be changed.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <PageHeader title="Users" description="Platform and hospital account directory. Hospital users remain isolated to exactly one tenant."><button className="sa-button sa-button--secondary" type="button" disabled={!users.length} onClick={exportUsers}><Download size={16} />Export directory</button></PageHeader>
    <section className="sa-panel"><div className="sa-toolbar"><label className="sa-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, email, or hospital" aria-label="Search users" /></label><select value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{roles.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></div>
      {resource.loading && <LoadingState label="Loading user directory…" />}{!resource.loading && resource.error && <ErrorState message={resource.error} onRetry={resource.reload} />}{!resource.loading && !resource.error && !users.length && <EmptyState icon={Users} title="No users found" description="Try changing your search or role filter." />}
      {!resource.loading && !resource.error && users.length > 0 && <TableShell><table className="sa-table"><thead><tr><th>User</th><th>Account</th><th>Role</th><th>Hospital tenant</th><th>Status</th><th>Last login</th><th>Created</th><th aria-label="Actions" /></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.fullName || user.name}</strong><span>{user.email}</span></td><td>{titleCase(user.accountType || user.type || (user.hospitalId ? 'hospital_user' : 'platform_user'))}</td><td>{titleCase(user.roleKey || user.role?.name || user.role)}</td><td>{user.hospitalName || user.hospital?.name || <span className="sa-platform-pill"><UserCog size={13} />AI Finora Platform</span>}</td><td><StatusBadge status={user.isActive === false ? 'disabled' : user.status || 'active'} /></td><td>{formatDate(user.lastLoginAt, true)}</td><td>{formatDate(user.createdAt)}</td><td><div className="sa-row-actions"><button className="sa-button sa-button--quiet sa-button--small" type="button" onClick={() => setSelected(user)}><Eye size={14} />View</button><button className={`sa-button sa-button--small ${user.isActive === false ? 'sa-button--quiet' : 'sa-button--quiet-danger'}`} type="button" onClick={() => requestStatusChange(user)}>{user.isActive === false ? <><UserCheck size={14} />Enable</> : <><UserX size={14} />Disable</>}</button></div></td></tr>)}</tbody></table></TableShell>}
    </section>
    {selected && <Modal title={selected.fullName || selected.name} description={selected.email} onClose={() => setSelected(null)} footer={<button className="sa-button sa-button--secondary" type="button" onClick={() => setSelected(null)}>Close</button>}><div className="sa-detail-grid">{[['Account type', titleCase(selected.accountType || selected.type || (selected.hospitalId ? 'hospital user' : 'platform user'))], ['Role', titleCase(selected.roleKey || selected.role?.name || selected.role)], ['Hospital', selected.hospitalName || selected.hospital?.name || 'AI Finora Platform'], ['Status', selected.isActive === false ? 'Disabled' : titleCase(selected.status || 'active')], ['Mobile', selected.mobile], ['Last login', formatDate(selected.lastLoginAt, true)], ['Password change required', selected.mustChangePassword ? 'Yes' : 'No'], ['Created', formatDate(selected.createdAt, true)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || '—'}</strong></div>)}</div></Modal>}
    <ConfirmDialog
      open={Boolean(statusAction)}
      title={`${statusAction?.isActive === false ? 'Enable' : 'Disable'} ${statusAction?.fullName || statusAction?.name || 'this user'}?`}
      description={statusAction?.isActive === false ? 'This user will be able to sign in again immediately.' : 'Existing sessions will be invalidated and the user will no longer be able to sign in.'}
      confirmLabel={statusAction?.isActive === false ? 'Enable user' : 'Disable user'}
      tone={statusAction?.isActive === false ? 'primary' : 'danger'}
      busy={busy}
      onCancel={() => { setStatusAction(null); setReason(''); }}
      onConfirm={applyStatusChange}
    >
      <Field label="Reason (required)"><textarea rows="4" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this account status is changing" /></Field>
    </ConfirmDialog>
  </>;
}
