import { useMemo, useState } from 'react';
import { Activity, Download, Eye, LockKeyhole, Search } from 'lucide-react';
import {
  ADMIN_API_ROOT,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  TableShell,
  asArray,
  formatDate,
  titleCase,
  useAdminResource,
  useAdminToast,
} from '../../components/super-admin/AdminUI.jsx';

export default function ActivityLogsPage() {
  const resource = useAdminResource(`${ADMIN_API_ROOT}/audit-logs`);
  const [query, setQuery] = useState('');
  const [actorType, setActorType] = useState('');
  const [selected, setSelected] = useState(null);
  const { notify } = useAdminToast();
  const allLogs = asArray(resource.data, ['auditLogs', 'logs', 'items']);
  const actorTypes = [...new Set(allLogs.map((log) => log.actorType).filter(Boolean))];
  const logs = useMemo(() => allLogs.filter((log) => {
    const needle = query.toLowerCase();
    return (!needle || [log.action, log.actorName, log.actor?.fullName, log.hospitalName, log.hospital?.name, log.entityType, log.entityId, log.reason].some((value) => String(value || '').toLowerCase().includes(needle))) && (!actorType || log.actorType === actorType);
  }), [allLogs, query, actorType]);

  const exportLogs = () => {
    const header = ['Date', 'Actor', 'Actor type', 'Hospital', 'Action', 'Entity type', 'Entity ID', 'Reason', 'IP address'];
    const rows = logs.map((log) => [log.createdAt, log.actorName || log.actor?.fullName, log.actorType, log.hospitalName || log.hospital?.name, log.action, log.entityType, log.entityId, log.reason, log.ipAddress]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'ai-finora-audit-logs.csv'; link.click(); URL.revokeObjectURL(url); notify('Audit log export created.');
  };

  return <>
    <PageHeader title="Activity logs" description="Immutable evidence for sensitive platform, subscription, payment, user, and support-access actions."><button className="sa-button sa-button--secondary" type="button" disabled={!logs.length} onClick={exportLogs}><Download size={16} />Export logs</button></PageHeader>
    <div className="sa-immutable-banner"><LockKeyhole size={19} /><div><strong>Immutable audit trail</strong><span>Logs cannot be edited or deleted through the interface.</span></div></div>
    <section className="sa-panel"><div className="sa-toolbar"><label className="sa-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Actor, hospital, action, entity, or reason" aria-label="Search activity logs" /></label><select value={actorType} onChange={(e) => setActorType(e.target.value)}><option value="">All actor types</option>{actorTypes.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></div>
      {resource.loading && <LoadingState label="Loading audit logs…" />}{!resource.loading && resource.error && <ErrorState message={resource.error} onRetry={resource.reload} />}{!resource.loading && !resource.error && !logs.length && <EmptyState icon={Activity} title="No audit entries found" description="Sensitive platform actions will be recorded here." />}
      {!resource.loading && !resource.error && logs.length > 0 && <TableShell><table className="sa-table"><thead><tr><th>Date & time</th><th>Actor</th><th>Hospital</th><th>Action</th><th>Entity</th><th>Reason</th><th>IP address</th><th aria-label="Actions" /></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{formatDate(log.createdAt, true)}</td><td><strong>{log.actorName || log.actor?.fullName || 'System'}</strong><span>{titleCase(log.actorType)}</span></td><td>{log.hospitalName || log.hospital?.name || 'Platform'}</td><td><span className="sa-action-code">{titleCase(log.action)}</span></td><td><strong>{titleCase(log.entityType)}</strong><span>{log.entityId}</span></td><td className="sa-table__truncate">{log.reason || '—'}</td><td>{log.ipAddress || '—'}</td><td><button className="sa-button sa-button--quiet sa-button--small" type="button" onClick={() => setSelected(log)}><Eye size={14} />Inspect</button></td></tr>)}</tbody></table></TableShell>}
    </section>
    {selected && <Modal size="large" title={titleCase(selected.action)} description={`${formatDate(selected.createdAt, true)} · ${selected.actorName || selected.actor?.fullName || 'System'}`} onClose={() => setSelected(null)} footer={<button className="sa-button sa-button--secondary" type="button" onClick={() => setSelected(null)}>Close</button>}><div className="sa-detail-grid sa-detail-grid--three">{[['Actor type', titleCase(selected.actorType)], ['Hospital', selected.hospitalName || selected.hospital?.name || 'Platform'], ['Entity type', titleCase(selected.entityType)], ['Entity ID', selected.entityId], ['Reason', selected.reason], ['IP address', selected.ipAddress]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || '—'}</strong></div>)}</div><div className="sa-change-grid"><section><h3>Previous value</h3><pre>{JSON.stringify(selected.previousValue ?? selected.previousValues ?? null, null, 2)}</pre></section><section><h3>New value</h3><pre>{JSON.stringify(selected.newValue ?? selected.newValues ?? null, null, 2)}</pre></section></div></Modal>}
  </>;
}
