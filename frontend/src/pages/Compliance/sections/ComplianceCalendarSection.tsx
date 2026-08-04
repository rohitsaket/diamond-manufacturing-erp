import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  BellRing,
  CalendarDays,
  CheckCircle2,
  Clock,
  RefreshCw,
  Sparkles,
  UserPlus,
  CalendarClock,
  Ban,
} from 'lucide-react';
import { api } from '../../../api/client';
import { complianceApi, financialYearOf } from '../../../api/compliance';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
  StatCard,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';
import { TabBar } from '../../../components/common/TabBar';

// ---------------------------------------------------------------------------
// Local date helpers (date-fns is not installed)
// ---------------------------------------------------------------------------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `2026-07-15` -> `15 Jul 2026`. Returns an em dash when there is nothing to show. */
function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const iso = String(value).slice(0, 10);
  const parts = iso.split('-');
  if (parts.length !== 3) return String(value);
  const [y, m, d] = parts;
  const monthIndex = Number(m) - 1;
  if (!y || !d || !Number.isFinite(monthIndex)) return String(value);
  return `${d} ${MONTH_NAMES[monthIndex] ?? m} ${y}`;
}

/** `2026-07` -> `Jul 2026`. */
function fmtMonthKey(key: string): string {
  const parts = key.split('-');
  if (parts.length !== 2) return key;
  const monthIndex = Number(parts[1]) - 1;
  return `${MONTH_NAMES[monthIndex] ?? parts[1]} ${parts[0]}`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function firstWeekday(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();
}

/** The twelve month keys of an Indian financial year, April first. */
function fyMonthKeys(fy: string): string[] {
  const startYear = Number(String(fy).slice(0, 4));
  if (!Number.isFinite(startYear)) return [];
  return Array.from({ length: 12 }, (_, i) => {
    const month = ((3 + i) % 12) + 1;
    const year = i < 9 ? startYear : startYear + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  });
}

function fyOptions(): string[] {
  const current = financialYearOf();
  const start = Number(current.slice(0, 4));
  return [start - 2, start - 1, start, start + 1].map((y) => `${y}-${y + 1}`);
}

// ---------------------------------------------------------------------------
// Presentation maps
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const STATUS_TONE: Record<string, Tone> = {
  UPCOMING: 'default',
  DUE_SOON: 'warning',
  OVERDUE: 'danger',
  COMPLETED: 'success',
  WAIVED: 'default',
  NOT_APPLICABLE: 'default',
};

const STATUS_DOT: Record<string, string> = {
  UPCOMING: 'bg-text-muted',
  DUE_SOON: 'bg-warning',
  OVERDUE: 'bg-danger',
  COMPLETED: 'bg-success',
  WAIVED: 'bg-text-muted',
  NOT_APPLICABLE: 'bg-text-muted',
};

const STATUS_ORDER = ['OVERDUE', 'DUE_SOON', 'UPCOMING', 'COMPLETED', 'WAIVED', 'NOT_APPLICABLE'];

const CLOSED_STATUSES = new Set(['COMPLETED', 'WAIVED', 'NOT_APPLICABLE']);

interface CalendarEntry {
  id: number;
  obligationCode?: string | null;
  obligationName?: string | null;
  category?: string | null;
  obligationType?: string | null;
  frequency?: string | null;
  authority?: string | null;
  financialYear?: string | null;
  periodLabel?: string | null;
  monthKey?: string | null;
  stateCode?: string | null;
  dueDate: string;
  originalDueDate?: string | null;
  extensionReason?: string | null;
  status: string;
  ownerUserId?: number | null;
  ownerName?: string | null;
  completedOn?: string | null;
  remarks?: string | null;
  reminderSentAt?: string | null;
  daysToDue?: number | null;
}

type ActionKind = 'complete' | 'waive' | 'extend' | 'assign';

/**
 * The statutory calendar: generated due dates, their live status, and the four
 * things an operator can do to one. The generator only understands weekends, so
 * that limitation is stated on the screen rather than left to be discovered.
 */
export function ComplianceCalendarSection() {
  const [financialYear, setFinancialYear] = useState<string>(financialYearOf());
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<'timeline' | 'grid'>('timeline');
  const [gridMonth, setGridMonth] = useState<string>(() => todayISO().slice(0, 7));
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [genResult, setGenResult] = useState<any | null>(null);
  const [refreshResult, setRefreshResult] = useState<any | null>(null);
  const [reminderResult, setReminderResult] = useState<any | null>(null);

  const [action, setAction] = useState<{ kind: ActionKind; entry: CalendarEntry } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    complianceApi
      .calendar({ financialYear })
      .then((rows) => setEntries(Array.isArray(rows) ? (rows as CalendarEntry[]) : []))
      .catch((err: any) => setError(err?.message ?? 'Could not load the compliance calendar'))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [financialYear]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the month grid pointed at a month that exists in the selected year.
  useEffect(() => {
    const months = fyMonthKeys(financialYear);
    if (months.length > 0 && !months.includes(gridMonth)) {
      const today = todayISO().slice(0, 7);
      setGridMonth(months.includes(today) ? today : (months[0] as string));
    }
  }, [financialYear, gridMonth]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.category) set.add(e.category);
    return [...set].sort();
  }, [entries]);

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (statusFilter === 'ALL' || e.status === statusFilter) &&
          (categoryFilter === 'ALL' || e.category === categoryFilter),
      ),
    [entries, statusFilter, categoryFilter],
  );

  const stats = useMemo(() => {
    let overdue = 0;
    let dueSoon = 0;
    let completed = 0;
    for (const e of entries) {
      if (e.status === 'OVERDUE') overdue++;
      if (e.status === 'COMPLETED') completed++;
      const days = Number(e.daysToDue ?? NaN);
      if (!CLOSED_STATUSES.has(e.status) && Number.isFinite(days) && days >= 0 && days <= 7) dueSoon++;
    }
    return { overdue, dueSoon, completed, total: entries.length };
  }, [entries]);

  const byMonth = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of filtered) {
      const key = String(e.dueDate ?? '').slice(0, 7) || 'unknown';
      const bucket = map.get(key);
      if (bucket) bucket.push(e);
      else map.set(key, [e]);
    }
    for (const list of map.values()) list.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const generate = () => {
    setGenerating(true);
    complianceApi
      .generateCalendar(financialYear)
      .then((res) => {
        setGenResult(res ?? null);
        load();
      })
      .catch((err: any) => window.alert(err?.message ?? 'Could not generate the calendar'))
      .finally(() => setGenerating(false));
  };

  const refreshStatuses = () => {
    setRefreshing(true);
    complianceApi
      .refreshCalendar()
      .then((res) => {
        setRefreshResult(res ?? null);
        load();
      })
      .catch((err: any) => window.alert(err?.message ?? 'Could not refresh statuses'))
      .finally(() => setRefreshing(false));
  };

  const sendReminders = () => {
    setReminding(true);
    complianceApi
      .sendReminders()
      .then((res) => {
        setReminderResult(res ?? null);
        load();
      })
      .catch((err: any) => window.alert(err?.message ?? 'Could not send reminders'))
      .finally(() => setReminding(false));
  };

  const closeAction = () => setAction(null);
  const afterMutation = () => {
    setAction(null);
    load();
  };

  return (
    <div className="space-y-4">
      {/* Controls ---------------------------------------------------------- */}
      <div className="bg-bg-card border border-border-default rounded-md p-4 space-y-3">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className={LABEL_CLS} htmlFor="cal-fy">
              Financial year
            </label>
            <select
              id="cal-fy"
              className={`${INPUT_CLS} w-40`}
              value={financialYear}
              onChange={(e) => setFinancialYear(e.target.value)}
            >
              {fyOptions().map((fy) => (
                <option key={fy} value={fy}>
                  {fy}
                </option>
              ))}
            </select>
          </div>

          <button onClick={generate} className={BTN_PRIMARY} disabled={generating}>
            <Sparkles size={14} className={`inline mr-1.5 ${generating ? 'animate-pulse' : ''}`} />
            Generate calendar
          </button>
          <button onClick={refreshStatuses} className={BTN_SECONDARY} disabled={refreshing}>
            <RefreshCw size={14} className={`inline mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh statuses
          </button>
          <button onClick={sendReminders} className={BTN_SECONDARY} disabled={reminding}>
            <BellRing size={14} className="inline mr-1.5" />
            Send reminders
          </button>
          <button onClick={load} className={BTN_SECONDARY} disabled={loading}>
            <RefreshCw size={14} className={`inline mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* The weekend-only caveat, stated in the backend's own words. */}
        <div className="px-3 py-2 rounded-md bg-info-light border border-info/30 text-info text-xs flex items-start gap-2">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            {genResult?.adjustmentNote
              ? String(genResult.adjustmentNote)
              : 'Generated due dates are shifted off Saturdays and Sundays only. This system has no government '
                + 'holiday list, so public holidays and state closures are not accounted for — check any date that '
                + 'falls near one.'}
          </span>
        </div>

        {genResult && (
          <div className="px-3 py-2 rounded-md bg-bg-secondary border border-border-light text-xs text-text-secondary space-y-1">
            <p className="text-text-primary font-medium">
              {financialYear}: {Number(genResult.created ?? 0)} created, {Number(genResult.updated ?? 0)} updated,{' '}
              {Number(genResult.unchanged ?? 0)} unchanged, {Number(genResult.weekendAdjusted ?? 0)} weekend-adjusted
              from {Number(genResult.obligationsProcessed ?? 0)} obligation(s).
            </p>
            <p className="text-text-muted">
              Generation is idempotent — running it again on unchanged obligations reports 0 created and 0 updated.
            </p>
            {Array.isArray(genResult.obligationsSkipped) && genResult.obligationsSkipped.length > 0 && (
              <ul className="list-disc pl-4 text-text-muted">
                {genResult.obligationsSkipped.map((s: any, i: number) => (
                  <li key={`${s?.code ?? i}`}>
                    <span className="font-medium">{String(s?.code ?? '—')}</span>: {String(s?.reason ?? '')}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {refreshResult && (
          <div className="px-3 py-2 rounded-md bg-bg-secondary border border-border-light text-xs text-text-secondary">
            Statuses aged as of {fmtDate(refreshResult.asOf)} — {Number(refreshResult.markedOverdue ?? 0)} marked
            overdue, {Number(refreshResult.markedDueSoon ?? 0)} marked due soon. Completed, waived and not-applicable
            entries are never re-aged.
          </div>
        )}

        {reminderResult && (
          <div className="px-3 py-2 rounded-md bg-bg-secondary border border-border-light text-xs text-text-secondary">
            {Number(reminderResult.notified ?? 0)} entr(ies) notified to {Number(reminderResult.recipients ?? 0)}{' '}
            recipient(s) out of {Number(reminderResult.candidates ?? 0)} candidate(s). Reminders are idempotent: each
            entry is stamped once sent and will not be notified again unless its due date is extended.
          </div>
        )}
      </div>

      {/* Stats ------------------------------------------------------------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Overdue" value={stats.overdue} intent={stats.overdue > 0 ? 'danger' : 'default'} />
        <StatCard
          label="Due in 7 days"
          value={stats.dueSoon}
          intent={stats.dueSoon > 0 ? 'warning' : 'default'}
          hint="Open entries only"
        />
        <StatCard label="Completed" value={stats.completed} intent="success" />
        <StatCard label="Total entries" value={stats.total} hint={financialYear} />
      </div>

      {/* Filters ----------------------------------------------------------- */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-text-muted text-[10px] uppercase tracking-wider font-semibold mr-1">Status</span>
          {['ALL', ...STATUS_ORDER].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
                statusFilter === s
                  ? 'bg-primary-light border-primary/30 text-primary'
                  : 'border-border-default text-text-muted hover:border-text-muted'
              }`}
            >
              {s === 'ALL' ? 'All' : s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-text-muted text-[10px] uppercase tracking-wider font-semibold mr-1">Category</span>
          {['ALL', ...categories].map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
                categoryFilter === c
                  ? 'bg-primary-light border-primary/30 text-primary'
                  : 'border-border-default text-text-muted hover:border-text-muted'
              }`}
            >
              {c === 'ALL' ? 'All' : c.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      <TabBar
        tabs={[
          { id: 'timeline', label: 'Timeline', count: filtered.length },
          { id: 'grid', label: 'Month grid' },
        ]}
        active={view}
        onChange={(id) => setView(id === 'grid' ? 'grid' : 'timeline')}
      />

      {loading && firstLoad && <LoadingBlock label="Loading calendar…" />}

      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button onClick={load} className={BTN_SECONDARY}>
            Retry
          </button>
        </div>
      )}

      {!error && !firstLoad && filtered.length === 0 && (
        <EmptyBlock
          message="No calendar entries for these filters"
          hint="Generate the calendar for this financial year to create entries from the active obligations."
        />
      )}

      {!error && filtered.length > 0 && view === 'timeline' && (
        <div className="space-y-4">
          {byMonth.map(([monthKey, rows]) => (
            <div key={monthKey} className="bg-bg-card border border-border-default rounded-md overflow-hidden">
              <div className="px-4 py-2 bg-bg-secondary border-b border-border-default flex items-center gap-2">
                <CalendarDays size={14} className="text-text-muted" />
                <h3 className="text-text-primary text-sm font-semibold">{fmtMonthKey(monthKey)}</h3>
                <span className="text-text-muted text-xs">({rows.length})</span>
              </div>
              <ul className="divide-y divide-border-light">
                {rows.map((entry) => (
                  <TimelineRow key={entry.id} entry={entry} onAction={(kind) => setAction({ kind, entry })} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {!error && view === 'grid' && (
        <MonthGrid
          monthKey={gridMonth}
          months={fyMonthKeys(financialYear)}
          onMonthChange={setGridMonth}
          entries={filtered}
        />
      )}

      <AnimatePresence>
        {action && (
          <EntryActionModal
            kind={action.kind}
            entry={action.entry}
            onClose={closeAction}
            onDone={afterMutation}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline row
// ---------------------------------------------------------------------------

function TimelineRow({ entry, onAction }: { entry: CalendarEntry; onAction: (kind: ActionKind) => void }) {
  const days = Number(entry.daysToDue ?? NaN);
  const closed = CLOSED_STATUSES.has(entry.status);
  const daysTone = !Number.isFinite(days) || closed
    ? 'text-text-muted'
    : days <= 3
      ? 'text-danger font-semibold'
      : days <= 7
        ? 'text-warning font-semibold'
        : 'text-text-secondary';
  const daysLabel = !Number.isFinite(days)
    ? '—'
    : days < 0
      ? `${Math.abs(days)}d overdue`
      : days === 0
        ? 'due today'
        : `${days}d left`;

  return (
    <li className="px-4 py-3 hover:bg-bg-hover transition-colors">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-text-primary text-sm font-medium">{entry.obligationName ?? '—'}</span>
            <span className="text-text-muted text-[11px] font-mono">{entry.obligationCode ?? '—'}</span>
            {entry.category && <Chip label={String(entry.category).replace(/_/g, ' ')} tone="primary" />}
            <Chip
              label={String(entry.status).replace(/_/g, ' ')}
              tone={STATUS_TONE[entry.status] ?? 'default'}
              dot
            />
            {entry.stateCode && <Chip label={String(entry.stateCode)} />}
          </div>

          <div className="flex items-center gap-3 flex-wrap text-xs">
            <span className="text-text-secondary">{entry.periodLabel ?? '—'}</span>
            <span className="text-text-muted">·</span>
            <span className="text-text-primary">Due {fmtDate(entry.dueDate)}</span>
            <span className={daysTone}>{daysLabel}</span>
            <span className="text-text-muted">·</span>
            <span className="text-text-secondary">
              Owner: {entry.ownerName ?? (entry.ownerUserId ? `user #${entry.ownerUserId}` : '—')}
            </span>
            {entry.authority && <span className="text-text-muted">· {entry.authority}</span>}
            {entry.reminderSentAt && (
              <span className="text-text-muted">· reminded {timeAgo(entry.reminderSentAt)}</span>
            )}
          </div>

          {entry.originalDueDate && (
            <p className="text-warning text-[11px] flex items-start gap-1">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <span>
                ⚠ moved from {fmtDate(entry.originalDueDate)}
                {entry.extensionReason ? ` — ${entry.extensionReason}` : ''}
              </span>
            </p>
          )}

          {entry.completedOn && (
            <p className="text-success text-[11px]">Completed {fmtDate(entry.completedOn)}</p>
          )}
          {entry.remarks && !entry.completedOn && (
            <p className="text-text-muted text-[11px]">{entry.remarks}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <RowButton icon={<CheckCircle2 size={13} />} label="Complete" onClick={() => onAction('complete')} />
          <RowButton icon={<Ban size={13} />} label="Waive" onClick={() => onAction('waive')} />
          <RowButton icon={<CalendarClock size={13} />} label="Extend" onClick={() => onAction('extend')} />
          <RowButton icon={<UserPlus size={13} />} label="Assign" onClick={() => onAction('assign')} />
        </div>
      </div>
    </li>
  );
}

function RowButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1 rounded border border-border-default text-text-secondary text-[11px] font-medium hover:bg-bg-hover transition-colors inline-flex items-center gap-1"
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

function MonthGrid({
  monthKey,
  months,
  onMonthChange,
  entries,
}: {
  monthKey: string;
  months: string[];
  onMonthChange: (key: string) => void;
  entries: CalendarEntry[];
}) {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const valid = Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12;

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      const iso = String(e.dueDate ?? '').slice(0, 10);
      if (!iso.startsWith(monthKey)) continue;
      const bucket = map.get(iso);
      if (bucket) bucket.push(e);
      else map.set(iso, [e]);
    }
    return map;
  }, [entries, monthKey]);

  if (!valid) return <EmptyBlock message="Pick a month to see the grid" />;

  const total = daysInMonth(year, month);
  const lead = firstWeekday(year, month);
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const today = todayISO();

  return (
    <div className="bg-bg-card border border-border-default rounded-md overflow-hidden">
      <div className="px-4 py-2 bg-bg-secondary border-b border-border-default flex items-center gap-3 flex-wrap">
        <CalendarDays size={14} className="text-text-muted" />
        <select
          className={`${INPUT_CLS} w-40 py-1`}
          value={monthKey}
          onChange={(e) => onMonthChange(e.target.value)}
          aria-label="Month"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {fmtMonthKey(m)}
            </option>
          ))}
        </select>
        <span className="text-text-muted text-xs">
          {[...byDay.values()].reduce((sum, list) => sum + list.length, 0)} due date(s) this month
        </span>
      </div>

      <div className="grid grid-cols-7 border-b border-border-light">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-text-muted font-semibold text-center">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((iso, index) => {
          const dayEntries = iso ? (byDay.get(iso) ?? []) : [];
          return (
            <div
              key={iso ?? `blank-${index}`}
              className={`min-h-[92px] border-r border-b border-border-light p-1.5 ${
                iso === today ? 'bg-bg-selected' : iso ? '' : 'bg-bg-secondary'
              }`}
            >
              {iso && (
                <>
                  <p className={`text-[11px] mb-1 ${iso === today ? 'text-primary font-semibold' : 'text-text-muted'}`}>
                    {Number(iso.slice(8, 10))}
                  </p>
                  <div className="space-y-1">
                    {dayEntries.map((e) => (
                      <div
                        key={e.id}
                        title={`${e.obligationName ?? ''} — ${e.periodLabel ?? ''} (${e.status})`}
                        className="flex items-center gap-1 px-1 py-0.5 rounded bg-bg-hover"
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[e.status] ?? 'bg-text-muted'}`}
                        />
                        <span className="text-[10px] text-text-secondary truncate">
                          {e.obligationCode ?? e.obligationName ?? '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2 flex items-center gap-3 flex-wrap border-t border-border-default">
        {STATUS_ORDER.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-[10px] text-text-muted">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[s] ?? 'bg-text-muted'}`} />
            {s.replace(/_/g, ' ')}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row action modal
// ---------------------------------------------------------------------------

const ACTION_TITLES: Record<ActionKind, string> = {
  complete: 'Mark completed',
  waive: 'Waive obligation',
  extend: 'Extend due date',
  assign: 'Assign owner',
};

function EntryActionModal({
  kind,
  entry,
  onClose,
  onDone,
}: {
  kind: ActionKind;
  entry: CalendarEntry;
  onClose: () => void;
  onDone: () => void;
}) {
  const [completedOn, setCompletedOn] = useState(todayISO());
  const [filingId, setFilingId] = useState('');
  const [challanId, setChallanId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [reason, setReason] = useState('');
  const [newDueDate, setNewDueDate] = useState(String(entry.dueDate ?? '').slice(0, 10));
  const [ownerUserId, setOwnerUserId] = useState(entry.ownerUserId ? String(entry.ownerUserId) : '');
  const [saving, setSaving] = useState(false);

  const submit = () => {
    setSaving(true);
    let promise: Promise<unknown>;
    if (kind === 'complete') {
      promise = complianceApi.completeEntry(entry.id, {
        completedOn,
        filingId: filingId ? Number(filingId) : null,
        challanId: challanId ? Number(challanId) : null,
        remarks: remarks || null,
      });
    } else if (kind === 'waive') {
      promise = complianceApi.waiveEntry(entry.id, reason);
    } else if (kind === 'extend') {
      promise = complianceApi.extendEntry(entry.id, { newDueDate, reason });
    } else {
      promise = api.put<any>(`/compliance/calendar/${entry.id}/assign`, { ownerUserId: Number(ownerUserId) });
    }
    promise
      .then(() => onDone())
      .catch((err: any) => window.alert(err?.message ?? 'The change could not be saved'))
      .finally(() => setSaving(false));
  };

  const disabled =
    saving ||
    (kind === 'waive' && !reason.trim()) ||
    (kind === 'extend' && (!reason.trim() || !newDueDate)) ||
    (kind === 'assign' && !Number.isFinite(Number(ownerUserId)));

  return (
    <ModalShell
      title={ACTION_TITLES[kind]}
      subtitle={`${entry.obligationName ?? entry.obligationCode ?? 'Obligation'} · ${entry.periodLabel ?? ''} · due ${fmtDate(entry.dueDate)}`}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={BTN_SECONDARY} disabled={saving}>
            Cancel
          </button>
          <button onClick={submit} className={BTN_PRIMARY} disabled={disabled}>
            {saving ? 'Saving…' : ACTION_TITLES[kind]}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {kind === 'complete' && (
          <>
            <div>
              <label className={LABEL_CLS} htmlFor="cal-completed">
                Completed on
              </label>
              <input
                id="cal-completed"
                type="date"
                className={INPUT_CLS}
                value={completedOn}
                onChange={(e) => setCompletedOn(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS} htmlFor="cal-filing">
                  Filing id (optional)
                </label>
                <input
                  id="cal-filing"
                  className={INPUT_CLS}
                  value={filingId}
                  onChange={(e) => setFilingId(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 42"
                />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="cal-challan">
                  Challan id (optional)
                </label>
                <input
                  id="cal-challan"
                  className={INPUT_CLS}
                  value={challanId}
                  onChange={(e) => setChallanId(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 17"
                />
              </div>
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="cal-remarks">
                Remarks (optional)
              </label>
              <textarea
                id="cal-remarks"
                className={INPUT_CLS}
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
            <p className="text-text-muted text-[11px]">
              Linking the filing or challan makes the completed entry traceable back to the document that closed it.
            </p>
          </>
        )}

        {kind === 'waive' && (
          <>
            <div>
              <label className={LABEL_CLS} htmlFor="cal-waive-reason">
                Reason (required)
              </label>
              <textarea
                id="cal-waive-reason"
                className={INPUT_CLS}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why this obligation does not have to be met"
              />
            </div>
            <p className="text-text-muted text-[11px]">
              A waived entry is never re-aged, so it will not turn overdue later. The reason is stored on the record.
            </p>
          </>
        )}

        {kind === 'extend' && (
          <>
            <div>
              <label className={LABEL_CLS} htmlFor="cal-new-due">
                New due date
              </label>
              <input
                id="cal-new-due"
                type="date"
                className={INPUT_CLS}
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
              />
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="cal-extend-reason">
                Reason (required)
              </label>
              <textarea
                id="cal-extend-reason"
                className={INPUT_CLS}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. CBDT circular 12/2026 extended the deadline"
              />
            </div>
            <div className="px-3 py-2 rounded-md bg-info-light border border-info/30 text-info text-[11px]">
              The date the law originally asked for ({fmtDate(entry.originalDueDate ?? entry.dueDate)}) is preserved on
              the record as the original due date — extending never erases it. An overdue entry returns to upcoming and
              becomes eligible for a fresh reminder.
            </div>
          </>
        )}

        {kind === 'assign' && (
          <>
            <div>
              <label className={LABEL_CLS} htmlFor="cal-owner">
                Owner user id
              </label>
              <input
                id="cal-owner"
                className={INPUT_CLS}
                value={ownerUserId}
                onChange={(e) => setOwnerUserId(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 3"
              />
            </div>
            <p className="text-text-muted text-[11px]">
              This is a login user id, not an employee id. The assigned user is notified immediately with the due date
              and the authority.
            </p>
          </>
        )}

        <div className="flex items-center gap-2 pt-1 text-text-muted text-[11px]">
          <Clock size={12} />
          Current status: {String(entry.status).replace(/_/g, ' ')}
        </div>
      </div>
    </ModalShell>
  );
}
