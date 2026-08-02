import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ArrowRight } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { attendanceApi, engagementApi, hrDashboardApi } from '../../../api/hrms';
import type { AttendanceRecord, DashboardPayload, KpiCard } from '../../../types/hrms';
import { ATTENDANCE_STYLE } from '../../../types/hrms';
import {
  BTN_SECONDARY,
  Chip,
  ErrorBlock,
  LoadingBlock,
  inr,
} from '../../../components/common/HrmsUI';
import { KpiTile } from '../KpiTile';
import { WidgetCard, WidgetEmpty, WidgetUnavailable } from '../WidgetCard';

// ---------------------------------------------------------------------------
// Defensive readers
// ---------------------------------------------------------------------------
type AnyRec = Record<string, any>;

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function asObject(value: unknown): AnyRec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRec) : {};
}

function asArray<T = AnyRec>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  return localIso(d);
}

/** dd MMM without pulling in date-fns (not installed). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(value: unknown): string {
  const raw = String(value ?? '').slice(0, 10);
  const d = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return raw || '—';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
}

type ChipTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

function payrollTone(status: string): ChipTone {
  if (status === 'PAID') return 'success';
  if (status === 'LOCKED') return 'info';
  if (status === 'OPEN') return 'warning';
  return 'default';
}

function priorityTone(priority: string): ChipTone {
  if (priority === 'URGENT') return 'danger';
  if (priority === 'HIGH') return 'warning';
  if (priority === 'LOW') return 'default';
  return 'primary';
}

const CALENDAR_TONE: Record<string, ChipTone> = {
  HOLIDAY: 'success',
  LEAVE: 'info',
  BIRTHDAY: 'primary',
  ANNIVERSARY: 'primary',
  TRAINING: 'warning',
  MEETING: 'default',
  EVENT: 'default',
  PAYROLL: 'warning',
};

const TOOLTIP_STYLE = {
  background: 'var(--color-bg-card)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 6,
  fontSize: 11,
  color: 'var(--color-text-primary)',
} as const;

// ---------------------------------------------------------------------------
// Filter pills
// ---------------------------------------------------------------------------
type Category = 'attendance' | 'payroll' | 'people' | 'other';
type Filter = 'all' | Category;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'people', label: 'People' },
  { key: 'other', label: 'Other' },
];

interface LoadedData {
  hr: DashboardPayload | null;
  daily: AttendanceRecord[];
  tasks: AnyRec[];
  calendar: AnyRec[];
  announcements: AnyRec[];
}

const EMPTY: LoadedData = { hr: null, daily: [], tasks: [], calendar: [], announcements: [] };

/**
 * Widget gallery: one card per widget type, every card fed from a single
 * section-level fetch. Widgets with no backing data source say so rather than
 * showing a placeholder number.
 */
export function WidgetsSection({ onNavigate }: { onNavigate: (page: string) => void }) {
  const today = useMemo(() => localIso(new Date()), []);

  const [data, setData] = useState<LoadedData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const hrFailure: string[] = [];

    const [hr, daily, tasks, calendar, announcements] = await Promise.all([
      hrDashboardApi.hr().catch((err: unknown) => {
        hrFailure.push(errMsg(err));
        return null;
      }),
      attendanceApi.daily(today).catch(() => [] as AttendanceRecord[]),
      engagementApi.tasks({}).catch(() => [] as AnyRec[]),
      hrDashboardApi.calendar(today, addDays(today, 30)).catch(() => [] as AnyRec[]),
      engagementApi.announcements({ activeOnly: true }).catch(() => [] as AnyRec[]),
    ]);

    setData({
      hr,
      daily: asArray<AttendanceRecord>(daily),
      tasks: asArray(tasks),
      calendar: asArray(calendar),
      announcements: asArray(announcements),
    });
    setError(hrFailure[0] ?? null);
    setLoading(false);
    setLoaded(true);
  }, [today]);

  useEffect(() => {
    void load();
  }, [load]);

  const [filter, setFilter] = useState<Filter>('all');

  if (loading && !loaded) return <LoadingBlock label="Loading widgets…" />;

  if (error) {
    return (
      <div className="space-y-3">
        <ErrorBlock message={error} />
        <button type="button" className={BTN_SECONDARY} onClick={() => void load()}>
          <RefreshCw size={14} className="inline mr-1.5 -mt-0.5" />
          Retry
        </button>
      </div>
    );
  }

  const widgets = asObject(data.hr?.widgets);
  const hrKpis = asArray<KpiCard>(data.hr?.kpis);
  const leaveRequests = asArray(widgets.leaveRequests);
  const payrollStatus = asArray(widgets.payrollStatus);
  const latestPeriod = asObject(payrollStatus[0]);
  const attendanceRate = asArray(widgets.attendanceRate);

  // -- Attendance ------------------------------------------------------------
  let present = 0;
  let absent = 0;
  let onLeave = 0;
  let halfDay = 0;
  let marked = 0;
  for (const rec of data.daily) {
    const status = rec?.status ?? null;
    if (status) marked += 1;
    if (status === 'PRESENT') present += 1;
    else if (status === 'ABSENT') absent += 1;
    else if (status === 'LEAVE') onLeave += 1;
    else if (status === 'HALF_DAY') halfDay += 1;
  }

  // -- Tasks -----------------------------------------------------------------
  const openTasks = data.tasks
    .filter((t) => {
      const status = String(asObject(t).status ?? '');
      return status === 'PENDING' || status === 'IN_PROGRESS';
    })
    .slice(0, 5);

  // -- Charts ----------------------------------------------------------------
  const chartData = attendanceRate.slice(-30).map((row) => {
    const r = asObject(row);
    return { date: shortDate(r.date), presentPct: num(r.presentPct) };
  });

  const cards: { id: string; category: Category; node: React.ReactNode }[] = [
    {
      id: 'attendance',
      category: 'attendance',
      node: (
        <WidgetCard
          title="Attendance"
          subtitle={`Register for ${today}`}
          actions={
            <button
              type="button"
              className="text-primary text-[11px] font-medium hover:underline inline-flex items-center gap-1"
              onClick={() => onNavigate('attendance')}
            >
              Open attendance <ArrowRight size={12} />
            </button>
          }
        >
          {data.daily.length === 0 ? (
            <WidgetEmpty message="No working employees on the register" />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Present', value: present, cls: ATTENDANCE_STYLE.PRESENT.cell },
                  { label: 'Absent', value: absent, cls: ATTENDANCE_STYLE.ABSENT.cell },
                  { label: 'Leave', value: onLeave, cls: ATTENDANCE_STYLE.LEAVE.cell },
                ].map((s) => (
                  <div key={s.label} className={`rounded-md px-3 py-2 ${s.cls}`}>
                    <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
                    <p className="text-[11px] uppercase tracking-wider">{s.label}</p>
                  </div>
                ))}
              </div>
              <p className="text-text-muted text-[11px]">
                {marked} of {data.daily.length} marked
                {halfDay > 0 ? ` · ${halfDay} half day` : ''}
              </p>
            </div>
          )}
        </WidgetCard>
      ),
    },
    {
      id: 'leave',
      category: 'attendance',
      node: (
        <WidgetCard title="Leave" subtitle={`${leaveRequests.length} pending request(s)`}>
          {leaveRequests.length === 0 ? (
            <WidgetEmpty message="No leave requests awaiting approval" />
          ) : (
            <ul className="space-y-2">
              {leaveRequests.slice(0, 3).map((row, i) => {
                const r = asObject(row);
                return (
                  <li
                    key={String(r.id ?? i)}
                    className="flex items-start justify-between gap-2 border-b border-border-light last:border-0 pb-2 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-text-primary text-sm truncate">
                        {String(r.employeeName ?? 'Unknown')}
                      </p>
                      <p className="text-text-muted text-[11px] truncate">
                        {String(r.leaveTypeName ?? 'Leave')} · {shortDate(r.fromDate)} –{' '}
                        {shortDate(r.toDate)}
                      </p>
                    </div>
                    <span className="text-text-secondary text-[11px] tabular-nums flex-shrink-0">
                      {num(r.days)}d
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </WidgetCard>
      ),
    },
    {
      id: 'payroll',
      category: 'payroll',
      node: (
        <WidgetCard
          title="Payroll"
          subtitle="Latest salary period"
          actions={
            <button
              type="button"
              className="text-primary text-[11px] font-medium hover:underline inline-flex items-center gap-1"
              onClick={() => onNavigate('payroll')}
            >
              Open payroll <ArrowRight size={12} />
            </button>
          }
        >
          {payrollStatus.length === 0 ? (
            <WidgetEmpty message="No payroll period created yet" />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-text-primary text-sm font-medium truncate">
                  {String(latestPeriod.label ?? '—')}
                </p>
                <Chip
                  label={String(latestPeriod.status ?? 'UNKNOWN')}
                  tone={payrollTone(String(latestPeriod.status ?? ''))}
                  dot
                />
              </div>
              <p className="text-2xl font-semibold tabular-nums text-text-primary">
                {inr(num(latestPeriod.totalNet))}
              </p>
              <p className="text-text-muted text-[11px]">
                Net payable · {num(latestPeriod.lineCount)} lines · gross{' '}
                {inr(num(latestPeriod.totalGross))}
              </p>
            </div>
          )}
        </WidgetCard>
      ),
    },
    {
      id: 'task',
      category: 'people',
      node: (
        <WidgetCard title="Tasks" subtitle="Open tasks across the team">
          {openTasks.length === 0 ? (
            <WidgetEmpty message="No open tasks" />
          ) : (
            <ul className="space-y-2">
              {openTasks.map((row, i) => {
                const t = asObject(row);
                return (
                  <li
                    key={String(t.id ?? i)}
                    className="flex items-start justify-between gap-2 border-b border-border-light last:border-0 pb-2 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-text-primary text-sm truncate">{String(t.title ?? '—')}</p>
                      <p className="text-text-muted text-[11px] truncate">
                        {String(t.employeeName ?? 'Unassigned')}
                        {t.dueDate ? ` · due ${shortDate(t.dueDate)}` : ''}
                      </p>
                    </div>
                    <Chip
                      label={String(t.priority ?? 'MEDIUM')}
                      tone={priorityTone(String(t.priority ?? ''))}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </WidgetCard>
      ),
    },
    {
      id: 'calendar',
      category: 'people',
      node: (
        <WidgetCard title="Calendar" subtitle="Next 30 days">
          {data.calendar.length === 0 ? (
            <WidgetEmpty message="Nothing scheduled in the next 30 days" />
          ) : (
            <ul className="space-y-2">
              {data.calendar.slice(0, 5).map((row, i) => {
                const e = asObject(row);
                const type = String(e.type ?? 'EVENT');
                return (
                  <li key={String(e.id ?? i)} className="flex items-start gap-2">
                    <span className="text-text-muted text-[11px] tabular-nums w-14 flex-shrink-0 mt-0.5">
                      {shortDate(e.date)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-text-primary text-sm truncate">{String(e.title ?? '—')}</p>
                      {e.detail && (
                        <p className="text-text-muted text-[11px] truncate">{String(e.detail)}</p>
                      )}
                    </div>
                    <Chip label={type} tone={CALENDAR_TONE[type] ?? 'default'} />
                  </li>
                );
              })}
            </ul>
          )}
        </WidgetCard>
      ),
    },
    {
      id: 'announcement',
      category: 'people',
      node: (
        <WidgetCard title="Announcements" subtitle="Currently published">
          {data.announcements.length === 0 ? (
            <WidgetEmpty message="No active announcements" />
          ) : (
            <ul className="space-y-2">
              {data.announcements.slice(0, 3).map((row, i) => {
                const a = asObject(row);
                return (
                  <li
                    key={String(a.id ?? i)}
                    className="border-b border-border-light last:border-0 pb-2 last:pb-0"
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-text-primary text-sm font-medium truncate">
                        {String(a.title ?? '—')}
                      </p>
                      {a.pinned === true && <Chip label="Pinned" tone="primary" />}
                    </div>
                    <p className="text-text-secondary text-[11px] line-clamp-2 mt-0.5">
                      {String(a.body ?? '')}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </WidgetCard>
      ),
    },
    {
      id: 'kpi',
      category: 'other',
      node: (
        <WidgetCard title="KPIs" subtitle="Top four from the HR summary">
          {hrKpis.length === 0 ? (
            <WidgetEmpty message="No KPIs returned" />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {hrKpis.slice(0, 4).map((kpi, i) => (
                <KpiTile
                  key={String(kpi?.key ?? i)}
                  kpi={kpi}
                  onClick={kpi?.page ? () => onNavigate(String(kpi.page)) : undefined}
                />
              ))}
            </div>
          )}
        </WidgetCard>
      ),
    },
    {
      id: 'charts',
      category: 'attendance',
      node: (
        <WidgetCard title="Charts" subtitle="Attendance rate — last 30 days">
          {chartData.length === 0 ? (
            <WidgetEmpty message="No attendance history yet" />
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value) => [`${Number(value ?? 0)}%`, 'Present']}
                  />
                  <Area
                    type="monotone"
                    dataKey="presentPct"
                    stroke="var(--color-primary)"
                    fill="var(--color-primary)"
                    fillOpacity={0.15}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </WidgetCard>
      ),
    },
    {
      id: 'reports',
      category: 'other',
      node: (
        <WidgetCard title="Reports" subtitle="Jump to a detailed register">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Attendance register', page: 'attendance' },
              { label: 'HR & leave', page: 'hr' },
              { label: 'Payroll & payslips', page: 'payroll' },
              { label: 'Recruitment pipeline', page: 'recruitment' },
            ].map((r) => (
              <button
                key={r.page}
                type="button"
                onClick={() => onNavigate(r.page)}
                className="bg-bg-secondary border border-border-default rounded-md px-3 py-2 text-left text-xs text-text-secondary hover:bg-bg-hover hover:border-primary/30 transition-colors"
              >
                {r.label}
              </button>
            ))}
          </div>
        </WidgetCard>
      ),
    },
    {
      id: 'ai',
      category: 'other',
      node: (
        <WidgetCard title="AI assistant" subtitle="Insights and summaries">
          <WidgetUnavailable reason="AI features are not enabled for this workspace" />
        </WidgetCard>
      ),
    },
    {
      id: 'weather',
      category: 'other',
      node: (
        <WidgetCard title="Weather" subtitle="Local conditions">
          <WidgetUnavailable reason="No weather provider is configured" />
        </WidgetCard>
      ),
    },
    {
      id: 'custom',
      category: 'other',
      node: (
        <WidgetCard title="Custom widgets" subtitle="Workspace-defined panels">
          <WidgetUnavailable reason="Custom widgets are not configured yet" />
        </WidgetCard>
      ),
    },
  ];

  const visible = filter === 'all' ? cards : cards.filter((c) => c.category === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? 'bg-primary-light text-primary border-primary/30'
                    : 'bg-bg-secondary text-text-secondary border-border-default hover:bg-bg-hover'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <button type="button" className={BTN_SECONDARY} onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={`inline mr-1.5 -mt-0.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {visible.length === 0 ? (
        <WidgetEmpty message="No widgets in this category" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((c) => (
            <div key={c.id}>{c.node}</div>
          ))}
        </div>
      )}
    </div>
  );
}
