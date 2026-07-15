import { useMemo, useState } from 'react';
import { Clock3, Eye, Headphones, MessageSquareReply, Search } from 'lucide-react';
import { api } from '../../services/api.js';
import {
  ADMIN_API_ROOT,
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

const supportStatuses = ['open', 'in_progress', 'waiting_hospital', 'resolved', 'closed'];
const supportPriorities = ['low', 'normal', 'high', 'urgent'];
const activeStatuses = new Set(['open', 'in_progress', 'waiting_hospital']);

function normalizeChoice(value, fallback = '') {
  return String(value || fallback).trim().toLowerCase();
}

function displayTicket(request) {
  return request.ticketNumber || request.number || request.id;
}

export default function SupportRequestsPage() {
  const resource = useAdminResource(`${ADMIN_API_ROOT}/support-requests`);
  const usersResource = useAdminResource(`${ADMIN_API_ROOT}/users`);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const { notify } = useAdminToast();

  const allRequests = asArray(resource.data, ['supportRequests', 'requests', 'items']);
  const allUsers = asArray(usersResource.data, ['users', 'items']);
  const platformUsers = allUsers.filter((user) => {
    const accountType = normalizeChoice(user.accountType || user.type);
    if (accountType) return accountType.includes('platform');
    return !user.hospitalId && !user.hospital;
  });
  const usersById = useMemo(
    () => new Map(allUsers.map((user) => [String(user.id), user])),
    [allUsers],
  );
  const requests = useMemo(() => allRequests.filter((request) => {
    const needle = query.trim().toLowerCase();
    const requester = usersById.get(String(request.hospitalUserId || ''));
    const matchesSearch = !needle || [
      displayTicket(request),
      request.subject,
      request.hospitalName,
      request.hospital?.name,
      request.requesterName,
      requester?.fullName,
      requester?.email,
    ].some((value) => String(value || '').toLowerCase().includes(needle));
    return matchesSearch && (!status || normalizeChoice(request.status) === status);
  }), [allRequests, query, status, usersById]);

  const openManage = (request) => {
    setSelected(request);
    setDraft({
      status: normalizeChoice(request.status, 'open'),
      priority: normalizeChoice(request.priority, 'normal'),
      assignedPlatformUserId: request.assignedPlatformUserId || request.assignee?.id || '',
      response: request.response || '',
    });
  };

  const closeManage = () => {
    if (busy) return;
    setSelected(null);
    setDraft(null);
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`${ADMIN_API_ROOT}/support-requests/${selected.id}`, {
        ...draft,
        status: draft.status.toUpperCase(),
        priority: draft.priority.toUpperCase(),
        assignedPlatformUserId: draft.assignedPlatformUserId || null,
      });
      notify(`${displayTicket(selected) || 'Support request'} updated.`);
      setSelected(null);
      setDraft(null);
      resource.reload();
    } catch (error) {
      notify(apiErrorMessage(error, 'Support request could not be updated.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const selectedRequester = selected
    ? usersById.get(String(selected.hospitalUserId || ''))
    : null;

  return <>
    <PageHeader title="Support requests" description="Triage hospital account issues without opening patient records or silently entering a tenant.">
      <span className="sa-queue-count">
        <Clock3 size={17} />
        {allRequests.filter((item) => activeStatuses.has(normalizeChoice(item.status))).length} open
      </span>
    </PageHeader>
    <section className="sa-panel">
      <div className="sa-toolbar">
        <label className="sa-search">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ticket, subject, hospital, or requester" aria-label="Search support requests" />
        </label>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          {supportStatuses.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}
        </select>
      </div>
      {resource.loading && <LoadingState label="Loading support requests…" />}
      {!resource.loading && resource.error && <ErrorState message={resource.error} onRetry={resource.reload} />}
      {!resource.loading && !resource.error && !requests.length && <EmptyState icon={Headphones} title="No support requests" description="Hospital account and subscription support requests will appear here." />}
      {!resource.loading && !resource.error && requests.length > 0 && (
        <TableShell>
          <table className="sa-table">
            <thead><tr><th>Ticket</th><th>Hospital</th><th>Subject</th><th>Requester</th><th>Priority</th><th>Assigned to</th><th>Status</th><th>Updated</th><th aria-label="Actions" /></tr></thead>
            <tbody>{requests.map((request) => {
              const requester = usersById.get(String(request.hospitalUserId || ''));
              const assignee = usersById.get(String(request.assignedPlatformUserId || ''));
              const description = String(request.description || '');
              return <tr key={request.id}>
                <td><strong>{displayTicket(request)}</strong></td>
                <td>{request.hospitalName || request.hospital?.name}</td>
                <td><strong>{request.subject}</strong><span>{description.slice(0, 80)}{description.length > 80 ? '…' : ''}</span></td>
                <td>{request.requesterName || request.requester?.fullName || requester?.fullName || 'Hospital user'}<span>{request.requesterEmail || request.requester?.email || requester?.email}</span></td>
                <td><StatusBadge status={request.priority || 'normal'} /></td>
                <td>{request.assigneeName || request.assignee?.fullName || assignee?.fullName || 'Unassigned'}</td>
                <td><StatusBadge status={request.status} /></td>
                <td>{formatDate(request.updatedAt || request.createdAt, true)}</td>
                <td><button className="sa-button sa-button--quiet sa-button--small" type="button" onClick={() => openManage(request)}><Eye size={14} />Manage</button></td>
              </tr>;
            })}</tbody>
          </table>
        </TableShell>
      )}
    </section>

    {selected && draft && (
      <Modal
        size="large"
        title={displayTicket(selected) || 'Support request'}
        description={`${selected.hospitalName || selected.hospital?.name} · ${selected.subject}`}
        onClose={closeManage}
        footer={<>
          <button className="sa-button sa-button--secondary" type="button" disabled={busy} onClick={closeManage}>Cancel</button>
          <button className="sa-button sa-button--primary" type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save response'}</button>
        </>}
      >
        <div className="sa-ticket-message">
          <span>REQUEST FROM {selected.requesterName || selected.requester?.fullName || selectedRequester?.fullName || 'Hospital user'}</span>
          <p>{selected.description || selected.message}</p>
          <small>{formatDate(selected.createdAt, true)}</small>
        </div>
        <div className="sa-form-grid sa-form-grid--three">
          <Field label="Status">
            <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
              {supportStatuses.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })}>
              {supportPriorities.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}
            </select>
          </Field>
          <Field label="Assign to">
            <select value={draft.assignedPlatformUserId} onChange={(event) => setDraft({ ...draft, assignedPlatformUserId: event.target.value })}>
              <option value="">Unassigned</option>
              {platformUsers.map((user) => <option key={user.id} value={user.id}>{user.fullName || user.name}</option>)}
            </select>
          </Field>
          <Field className="sa-field--span-3" label="Response to hospital">
            <textarea rows="5" value={draft.response} onChange={(event) => setDraft({ ...draft, response: event.target.value })} placeholder="Add an account-safe response. Do not request clinical details." />
          </Field>
        </div>
        {asArray(selected.responses || selected.messages, ['items']).length > 0 && (
          <div className="sa-ticket-thread">
            <h3><MessageSquareReply size={17} />Conversation</h3>
            {asArray(selected.responses || selected.messages, ['items']).map((message, index) => <article key={message.id || index}><strong>{message.authorName || message.author?.fullName || 'Support'}</strong><p>{message.message || message.content}</p><small>{formatDate(message.createdAt, true)}</small></article>)}
          </div>
        )}
      </Modal>
    )}
  </>;
}
