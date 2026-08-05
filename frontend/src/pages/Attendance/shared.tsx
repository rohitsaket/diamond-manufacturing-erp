import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Chip, INPUT_CLS, LABEL_CLS } from '../../components/common/HrmsUI';
import type { Severity } from '../../types/attendance';

/**
 * Small helpers shared by the attendance tabs. Kept in one file rather than
 * repeated per tab, since every screen here fetches, filters by a date range
 * and renders the same handful of status chips.
 */

/** Local `YYYY-MM-DD` for today, without dragging in a date library. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthStartISO(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function monthEndISO(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return `${date.slice(0, 7)}-${String(new Date(y as number, m as number, 0).getDate()).padStart(2, '0')}`;
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return '—';
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toFixed(2)} h`;
}

export function formatMinutes(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!n) return '—';
  if (n < 60) return `${n} min`;
  return `${Math.floor(n / 60)}h ${n % 60}m`;
}

/**
 * Fetch-on-mount with a manual reload and a stable loading/error contract.
 * Guards against a slow response landing after the component unmounts or after
 * a newer request has already resolved.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    let alive = true;
    setLoading(true);
    setError(null);

    loader()
      .then((result) => {
        if (!alive || id !== requestId.current) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (!alive || id !== requestId.current) return;
        setError(err instanceof Error ? err.message : 'Something went wrong');
      })
      .finally(() => {
        if (!alive || id !== requestId.current) return;
        setLoading(false);
      });

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

/** Wraps an action so the button can show progress and surface the failure. */
export function useAction(): {
  busy: boolean;
  error: string | null;
  notice: string | null;
  run: (fn: () => Promise<unknown>, successMessage?: string) => Promise<boolean>;
  clear: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<unknown>, successMessage?: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (successMessage) setNotice(successMessage);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'The action failed');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback(() => { setError(null); setNotice(null); }, []);
  return { busy, error, notice, run, clear };
}

export function ActionFeedback({ error, notice }: { error: string | null; notice: string | null }) {
  if (!error && !notice) return null;
  return (
    <div
      className={`px-3 py-2 rounded-md text-sm border ${
        error
          ? 'bg-danger-light border-danger/30 text-danger'
          : 'bg-success-light border-success/30 text-success'
      }`}
    >
      {error ?? notice}
    </div>
  );
}

/**
 * A note about something the deployment genuinely cannot do. Used wherever a
 * feature is a seam rather than a working integration, so the screen never
 * implies a capability that is not there.
 */
export function CapabilityNote({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-md bg-warning-light border border-warning/30">
      <AlertTriangle size={15} className="text-warning flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-warning text-xs font-semibold">{title}</p>
        <p className="text-text-secondary text-xs mt-0.5 leading-relaxed">{note}</p>
      </div>
    </div>
  );
}

export function RefreshButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border-default text-text-secondary text-xs font-medium hover:bg-bg-hover transition-colors disabled:opacity-50"
    >
      <RefreshCw size={13} className={busy ? 'animate-spin' : undefined} /> Refresh
    </button>
  );
}

/** From/to date pair used by nearly every tab. */
export function DateRangePicker({
  from, to, onChange, label = 'Range',
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  label?: string;
}) {
  return (
    <div className="flex items-end gap-2 flex-wrap">
      <div>
        <label className={LABEL_CLS}>{label} from</label>
        <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} className={`${INPUT_CLS} w-40`} />
      </div>
      <div>
        <label className={LABEL_CLS}>to</label>
        <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} className={`${INPUT_CLS} w-40`} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status chips
// ---------------------------------------------------------------------------
const STATUS_TONE: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary'> = {
  PRESENT: 'success', ABSENT: 'danger', HALF_DAY: 'warning', LEAVE: 'info',
  HOLIDAY: 'primary', WEEK_OFF: 'default',
  ACTIVE: 'success', INACTIVE: 'default', DRAFT: 'warning', PUBLISHED: 'success',
  LOCKED: 'info', ARCHIVED: 'default', MAINTENANCE: 'warning', DECOMMISSIONED: 'default',
  ONLINE: 'success', OFFLINE: 'danger', DEGRADED: 'warning', UNKNOWN: 'default',
  PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'default',
  ESCALATED: 'danger', APPLIED: 'success', EXPIRED: 'default', AUTO_APPROVED: 'info',
  OPEN: 'danger', ACKNOWLEDGED: 'warning', RESOLVED: 'success', WAIVED: 'info',
  CHECKED_IN: 'success', CHECKED_OUT: 'default', EXPECTED: 'info',
  NO_SHOW: 'warning', OVERSTAY: 'danger',
  INSIDE: 'success', OUTSIDE: 'danger', NO_FIX: 'warning', LOW_ACCURACY: 'warning',
  NOT_REQUIRED: 'default', LOST: 'danger', DAMAGED: 'warning', RETURNED: 'default',
  NOT_CONFIGURED: 'warning', FAILED: 'danger', SUCCESS: 'success', PARTIAL: 'warning',
  RUNNING: 'info', SKIPPED: 'default', DERIVED: 'default', PAID: 'success',
};

export function StatusChip({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return <span className="text-text-muted text-xs">—</span>;
  const tone = STATUS_TONE[value] ?? 'default';
  return <Chip label={label ?? value.replace(/_/g, ' ').toLowerCase()} tone={tone} />;
}

const SEVERITY_TONE: Record<Severity, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary'> = {
  INFO: 'info', LOW: 'default', MEDIUM: 'warning', HIGH: 'danger', CRITICAL: 'danger',
};

export function SeverityChip({ severity }: { severity: Severity }) {
  return <Chip label={severity.toLowerCase()} tone={SEVERITY_TONE[severity] ?? 'default'} dot />;
}

/** Renders each exception flag on a day as its own chip. */
export function ExceptionChips({ flags }: { flags: string[] }) {
  if (!flags.length) return <span className="text-text-muted text-xs">—</span>;
  const tone = (flag: string): 'warning' | 'danger' | 'info' =>
    flag === 'ABSENT' || flag === 'OUTSIDE_FENCE' || flag === 'MISSING_PUNCH' ? 'danger'
      : flag === 'OVERTIME' ? 'info' : 'warning';
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <Chip key={flag} label={flag.replace(/_/g, ' ').toLowerCase()} tone={tone(flag)} />
      ))}
    </div>
  );
}

/** Simple horizontal bar for the "x of y" comparisons used across the tabs. */
export function MiniBar({ value, max, tone = 'primary' }: { value: number; max: number; tone?: 'primary' | 'success' | 'warning' | 'danger' }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const colours: Record<string, string> = {
    primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger',
  };
  return (
    <div className="h-1.5 w-full rounded-full bg-bg-hover overflow-hidden" title={`${value} of ${max}`}>
      <div className={`h-full rounded-full ${colours[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
