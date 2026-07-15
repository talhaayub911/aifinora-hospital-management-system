import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Inbox,
  LoaderCircle,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../../services/api.js';

export const ADMIN_API_ROOT = '/super-admin';

export function unwrapApi(response) {
  const first = response?.data ?? response;
  return first?.data ?? first;
}

export function apiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  return (
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.data?.error?.message ||
    error?.message ||
    fallback
  );
}

export function asArray(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

export function formatPkr(value, compact = false) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-PK', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

export function titleCase(value = '') {
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function useAdminResource(path, options = {}) {
  const { enabled = true, initialData = null } = options;
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);
  const controllerRef = useRef(null);

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    controllerRef.current?.abort();

    if (!enabled || !path) {
      controllerRef.current = null;
      setLoading(false);
      return null;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await api.get(path, { signal: controller.signal });
      const next = unwrapApi(response);
      if (requestIdRef.current !== requestId) return null;
      setData(next);
      return next;
    } catch (requestError) {
      if (requestError?.name === 'AbortError' || requestIdRef.current !== requestId) {
        return null;
      }
      setError(apiErrorMessage(requestError));
      return null;
    } finally {
      if (requestIdRef.current === requestId) {
        if (controllerRef.current === controller) controllerRef.current = null;
        setLoading(false);
      }
    }
  }, [enabled, path]);

  useEffect(() => {
    load();
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [load]);

  return { data, setData, loading, error, reload: load, setError };
}

const ToastContext = createContext(null);

export function AdminToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const notify = useCallback((message, tone = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3600);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="sa-toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => {
          const Icon = toast.tone === 'error' ? XCircle : toast.tone === 'warning' ? AlertCircle : CheckCircle2;
          return (
            <div className={`sa-toast sa-toast--${toast.tone}`} key={toast.id} role="status">
              <Icon size={18} aria-hidden="true" />
              <span>{toast.message}</span>
              <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useAdminToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useAdminToast must be used inside AdminToastProvider');
  return context;
}

export function PageHeader({ eyebrow = 'AI FINORA CONTROL CENTRE', title, description, children }) {
  return (
    <header className="sa-page-header">
      <div>
        <span className="sa-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="sa-page-actions">{children}</div>}
    </header>
  );
}

export function StatusBadge({ status, label }) {
  const normalized = String(status || 'unknown').toLowerCase().replace(/\s+/g, '_');
  return <span className={`sa-status sa-status--${normalized}`}>{label || titleCase(status || 'Unknown')}</span>;
}

export function LoadingState({ label = 'Loading data…', compact = false }) {
  return (
    <div className={`sa-state ${compact ? 'sa-state--compact' : ''}`} role="status">
      <LoaderCircle className="sa-spin" size={compact ? 18 : 26} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="sa-state sa-state--error" role="alert">
      <AlertCircle size={26} />
      <strong>We couldn’t load this section</strong>
      <span>{message}</span>
      {onRetry && <button className="sa-button sa-button--secondary" type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ title = 'Nothing here yet', description, icon: Icon = Inbox, action }) {
  return (
    <div className="sa-state sa-state--empty">
      <Icon size={30} />
      <strong>{title}</strong>
      {description && <span>{description}</span>}
      {action}
    </div>
  );
}

export function Modal({ title, description, children, onClose, size = 'medium', footer }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="sa-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose?.();
    }}>
      <section className={`sa-modal sa-modal--${size}`} role="dialog" aria-modal="true" aria-labelledby="sa-modal-title">
        <header className="sa-modal__head">
          <div>
            <h2 id="sa-modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="sa-icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
        </header>
        <div className="sa-modal__body">{children}</div>
        {footer && <footer className="sa-modal__footer">{footer}</footer>}
      </section>
    </div>
  );
}

export function ConfirmDialog({ open, title, description, confirmLabel = 'Confirm', tone = 'primary', busy, onConfirm, onCancel, children }) {
  if (!open) return null;
  return (
    <Modal
      title={title}
      description={description}
      onClose={busy ? undefined : onCancel}
      footer={(
        <>
          <button className="sa-button sa-button--secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className={`sa-button sa-button--${tone}`} type="button" disabled={busy} onClick={onConfirm}>
            {busy && <LoaderCircle className="sa-spin" size={16} />}{confirmLabel}
          </button>
        </>
      )}
    >
      {children}
    </Modal>
  );
}

export function Field({ label, error, hint, className = '', children }) {
  return (
    <label className={`sa-field ${className}`}>
      <span className="sa-field__label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
      {error && <small className="sa-field__error">{error}</small>}
    </label>
  );
}

export function MetricCard({ icon: Icon, label, value, detail, tone = 'blue' }) {
  return (
    <article className="sa-metric-card">
      <div className={`sa-metric-card__icon sa-tone--${tone}`}><Icon size={21} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </article>
  );
}

export function TableShell({ children, className = '' }) {
  return <div className={`sa-table-wrap ${className}`}>{children}</div>;
}

export function ActionMenu({ label = 'Actions', children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className={`sa-action-menu sa-action-menu--${align}`} ref={ref}>
      <button className="sa-button sa-button--quiet sa-button--small" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{label}</button>
      {open && <div className="sa-action-menu__popover" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}
