import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, ArrowRight, ShieldAlert } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import { hrDashboardApi } from '../../api/hrms';
import type { DashboardPayload, KpiCard } from '../../types/hrms';
import {
  PageHeader,
  Chip,
  TableShell,
  LoadingBlock,
  ErrorBlock,
  BTN_SECONDARY,
  inr,
} from '../../components/common/HrmsUI';
import { TabBar } from '../../components/common/TabBar';
import { KpiTile } from './KpiTile';
import { WidgetCard, WidgetEmpty, WidgetUnavailable } from './WidgetCard';
import { NotificationPanel } from './NotificationPanel';
import { ActivityFeed } from './ActivityFeed';
import { EmployeeSection } from './sections/EmployeeSection';
import { ManagerSection } from './sections/ManagerSection';
import { WidgetsSection } from './sections/WidgetsSection';
import { KpiCardsSection } from './sections/KpiCardsSection';
import { QuickActionsSection } from './sections/QuickActionsSection';
import { NotificationsSection } from './sections/NotificationsSection';
import { CalendarSection } from './sections/CalendarSection';
import { ActivitySection } from './sections/ActivitySection';

// ---------------------------------------------------------------------------
// Defensive readers. Every widget key may be absent, empty, the wrong shape or
// an explicit {available:false} marker — nothing below assumes otherwise.
// ---------------------------------------------------------------------------
type AnyRec = Record<string, any>;

function asArray<T = AnyRec>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asObject(value: unknown): AnyRec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRec) : {};
}

/** Returns the reason string when the backend marked a widget unavailable. */
function unavailableReason(value: unknown): string | null {
  const obj = asObject(value);
  if (obj.available === false) return typeof obj.reason === 'string' ? obj.reason : '';
  return null;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

interface Bucket {
  label: string;
  count: number;
}

/**
 * Distribution readers: the API returns some breakdowns as
 * `Record<label, count>` and others as `[{bucket|status, count}]`.
 */
function toBuckets(value: unknown): Bucket[] {
  if (Array.isArray(value)) {
    return value
      .map((row) => {
        const r = asObject(row);
        return {
          label: String(r.bucket ?? r.status ?? r.label ?? r.key ?? ''),
          count: num(r.count ?? r.cnt ?? r.value ?? 0),
        };
      })
      .filter((b) => b.label !== '');
  }
  const obj = asObject(value);
  if (obj.available === false) return [];
  return Object.entries(obj).map(([label, count]) => ({ label, count: num(count) }));
}

/** Recharts hands tooltip formatters a possibly-undefined ValueType. */
type TooltipValue = number | string | ReadonlyArray<number | string> | undefined;

const pctFormatter =
  (name: string) =>
  (value: TooltipValue): [string, string] =>
    [`${Number(value ?? 0)}%`, name];

const moneyFormatter = (value: TooltipValue): string => inr(Number(value ?? 0));

const AXIS = { fontSize: 11 } as const;
const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: -14 } as const;

const TOOLTIP_STYLE = {
  background: 'var(--color-bg-card)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 6,
  fontSize: 11,
  color: 'var(--color-text-primary)',
} as const;

const SERIES_COLORS = [
  'var(--color-primary)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-danger)',
  'var(--color-info)',
];

function shortMonth(value: unknown): string {
  const s = String(value ?? '');
  return s.length === 7 ? s.slice(2) : s;
}

function shortDate(value: unknown): string {
  const s = String(value ?? '');
  return s.length >= 10 ? s.slice(5) : s;
}

function attendanceTone(pct: number): string {
  if (pct >= 90) return 'text-success';
  if (pct >= 75) return 'text-warning';
  return 'text-danger';
}

/** Simple label + count + proportional bar row used by the diversity widget. */
function BreakdownList({ title, buckets }: { title: string; buckets: Bucket[] }) {
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
  return (
    <div>
      <p className="text-text-muted text-[10px] uppercase tracking-wider mb-2">{title}</p>
      {buckets.length === 0 ? (
        <p className="text-text-muted text-xs italic">No data</p>
      ) : (
        <div className="space-y-1.5">
          {buckets.map((b) => (
            <div key={b.label}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-secondary text-xs truncate">{b.label}</span>
                <span className="text-text-primary text-xs font-medium tabular-nums">{b.count}</span>
              </div>
              <div className="h-1 rounded-full bg-bg-secondary mt-1 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: max > 0 ? `${(b.count / max) * 100}%` : '0%' }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, tone = 'text-text-primary' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-md bg-bg-secondary px-3 py-2.5">
      <p className="text-text-muted text-[10px] uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-semibold tabular-nums mt-0.5 ${tone}`}>{value}</p>
    </div>
  );
}

function LinkAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
    >
      {label} <ArrowRight size={12} />
    </button>
  );
}

/**
 * Dashboard sections. The first four are role dashboards backed by their own
 * API payload; the rest are cross-cutting views that fetch their own data.
 */
export const DASHBOARD_SECTIONS = [
  { id: 'hr', label: 'HR Dashboard' },
  { id: 'employee', label: 'Employee Dashboard' },
  { id: 'manager', label: 'Manager Dashboard' },
  { id: 'executive', label: 'Executive Dashboard' },
  { id: 'widgets', label: 'Widgets' },
  { id: 'kpis', label: 'KPI Cards' },
  { id: 'actions', label: 'Quick Actions' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'activity', label: 'Activity Feed' },
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTIONS)[number]['id'];

/** Sections that load a role payload through this shell. */
const PAYLOAD_SECTIONS = new Set<string>(['hr', 'executive']);

const SECTION_SUBTITLE: Record<string, string> = {
  hr: 'Workforce, attendance, payroll and compliance at a glance',
  employee: 'What an individual worker sees about themselves',
  manager: 'Team attendance, approvals and workload',
  executive: 'Company-wide analytics and cost',
  widgets: 'Live widget gallery',
  kpis: 'Headline metrics across the workforce',
  actions: 'Common HR tasks in one click',
  notifications: 'Alerts, approvals and announcements',
  calendar: 'Holidays, leave, birthdays, training and events',
  activity: 'Who changed what, and when',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
interface HRDashboardProps {
  onNavigate: (page: string) => void;
  /** Section selected from the sidebar; the in-page tabs stay in sync with it. */
  section?: string;
  onSectionChange?: (section: string) => void;
}

export function HRDashboard({ onNavigate, section, onSectionChange }: HRDashboardProps) {
  const [localTab, setLocalTab] = useState<string>('hr');
  const tab = section ?? localTab;
  const setTab = useCallback(
    (next: string) => {
      setLocalTab(next);
      onSectionChange?.(next);
    },
    [onSectionChange],
  );

  const [cache, setCache] = useState<Record<string, DashboardPayload>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracked in a ref so `load` stays referentially stable — otherwise the
  // effect below would re-run every time the cache is written to.
  const fetched = useRef<Set<string>>(new Set());

  const usesPayload = PAYLOAD_SECTIONS.has(tab);
  const payload = cache[tab];

  const load = useCallback(async (key: string, force = false) => {
    if (!PAYLOAD_SECTIONS.has(key)) return;
    if (!force && fetched.current.has(key)) return;
    fetched.current.add(key);
    setLoading(true);
    setError(null);
    try {
      const data = key === 'executive' ? await hrDashboardApi.executive() : await hrDashboardApi.hr();
      setCache((prev) => ({ ...prev, [key]: data }));
    } catch (err) {
      fetched.current.delete(key);
      setError(err instanceof Error ? err.message : 'Failed to load the dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  const kpis = useMemo(() => asArray<KpiCard>(payload?.kpis), [payload]);
  const widgets = useMemo(() => asObject(payload?.widgets), [payload]);

  const header = (
    <PageHeader
      title="Dashboard"
      subtitle={SECTION_SUBTITLE[tab] ?? 'Workforce overview'}
      actions={
        usesPayload ? (
          <button
            onClick={() => void load(tab, true)}
            disabled={loading}
            className={`${BTN_SECONDARY} flex items-center gap-2`}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        ) : undefined
      }
    />
  );

  // Sections that fetch their own data render immediately; only the two
  // payload-backed role dashboards gate on this shell's loading state.
  if (!usesPayload) {
    return (
      <div className="space-y-5">
        {header}
        <TabBar tabs={DASHBOARD_SECTIONS as unknown as { id: string; label: string }[]} active={tab} onChange={setTab} />
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="space-y-4"
        >
          {tab === 'employee' && <EmployeeSection onNavigate={onNavigate} />}
          {tab === 'manager' && <ManagerSection onNavigate={onNavigate} />}
          {tab === 'widgets' && <WidgetsSection onNavigate={onNavigate} />}
          {tab === 'kpis' && <KpiCardsSection onNavigate={onNavigate} />}
          {tab === 'actions' && <QuickActionsSection onNavigate={onNavigate} />}
          {tab === 'notifications' && <NotificationsSection onNavigate={onNavigate} />}
          {tab === 'calendar' && <CalendarSection onNavigate={onNavigate} />}
          {tab === 'activity' && <ActivitySection onNavigate={onNavigate} />}
        </motion.div>
      </div>
    );
  }

  if (!payload && loading) {
    return (
      <div className="space-y-5">
        {header}
        <LoadingBlock label="Loading dashboard…" />
      </div>
    );
  }

  if (!payload && error) {
    return (
      <div className="space-y-5">
        {header}
        <ErrorBlock message={error} />
        <button onClick={() => void load(tab, true)} className={`${BTN_SECONDARY} flex items-center gap-2`}>
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}

      <TabBar tabs={DASHBOARD_SECTIONS as unknown as { id: string; label: string }[]} active={tab} onChange={setTab} />

      {error && <ErrorBlock message={error} />}

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="space-y-4"
      >
        {kpis.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {kpis.map((kpi) => (
              <KpiTile
                key={kpi.key}
                kpi={kpi}
                onClick={kpi.page ? () => onNavigate(kpi.page as string) : undefined}
              />
            ))}
          </div>
        )}

        {tab === 'hr' ? (
          <HrWidgets widgets={widgets} onNavigate={onNavigate} />
        ) : (
          <ExecutiveWidgets widgets={widgets} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <NotificationPanel onNavigate={onNavigate} />
          <ActivityFeed limit={15} />
        </div>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HR overview widgets
// ---------------------------------------------------------------------------
function HrWidgets({ widgets, onNavigate }: { widgets: AnyRec; onNavigate: (page: string) => void }) {
  const headcount = asObject(widgets.headcount);
  const headcountUnavailable = unavailableReason(widgets.headcount);
  const joinersLeavers = asArray(widgets.joinersLeavers);
  const attendanceRate = asArray(widgets.attendanceRate);
  const complianceAlerts = asArray(widgets.complianceAlerts);
  const leaveRequests = asArray(widgets.leaveRequests);
  const payrollStatus = asArray(widgets.payrollStatus);
  const recruitment = asObject(widgets.recruitment);
  const recruitmentStages = toBuckets(recruitment.byStatus ?? recruitment.candidatesByStatus);
  const departmentBreakdown = asArray(widgets.departmentBreakdown);
  const diversity = asObject(widgets.diversity);
  const docs = asObject(widgets.documentVerification);
  const docsUnavailable = unavailableReason(widgets.documentVerification);

  const headcountRows: { label: string; key: string; tone?: string }[] = [
    { label: 'Total', key: 'total' },
    { label: 'Working', key: 'working', tone: 'text-success' },
    { label: 'Resigned', key: 'resigned', tone: 'text-danger' },
    { label: 'Joined (mo)', key: 'joinedThisMonth', tone: 'text-info' },
    { label: 'Left (mo)', key: 'resignedThisMonth', tone: 'text-warning' },
    { label: 'With login', key: 'withLogin' },
  ];

  const docVerified = num(docs.verified);
  const docUnverified = num(docs.unverified);
  const docTotal = docVerified + docUnverified;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Headcount ---------------------------------------------------------*/}
      <WidgetCard title="Headcount" subtitle="Live employee register">
        {headcountUnavailable !== null ? (
          <WidgetUnavailable reason={headcountUnavailable} />
        ) : Object.keys(headcount).length === 0 ? (
          <WidgetEmpty message="No headcount data" />
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {headcountRows.map((row) => (
              <MiniStat key={row.key} label={row.label} value={num(headcount[row.key])} tone={row.tone} />
            ))}
          </div>
        )}
      </WidgetCard>

      {/* Joiners vs leavers ------------------------------------------------*/}
      <WidgetCard title="Joiners vs leavers" subtitle="Last 6 months" className="lg:col-span-2">
        {joinersLeavers.length === 0 ? (
          <WidgetEmpty message="No joiner or leaver history" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={joinersLeavers} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
              <XAxis dataKey="month" tick={AXIS} stroke="var(--color-text-muted)" tickFormatter={shortMonth} />
              <YAxis tick={AXIS} stroke="var(--color-text-muted)" allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-bg-hover)' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="joined" name="Joined" fill="var(--color-success)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="resigned" name="Resigned" fill="var(--color-danger)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </WidgetCard>

      {/* Attendance rate ---------------------------------------------------*/}
      <WidgetCard title="Attendance rate" subtitle="Last 30 days · % present" className="lg:col-span-2">
        {attendanceRate.length === 0 ? (
          <WidgetEmpty message="No attendance marked in this window" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={attendanceRate} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
              <XAxis dataKey="date" tick={AXIS} stroke="var(--color-text-muted)" tickFormatter={shortDate} minTickGap={18} />
              <YAxis tick={AXIS} stroke="var(--color-text-muted)" domain={[0, 100]} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={pctFormatter('Present')} />
              <Area
                type="monotone"
                dataKey="presentPct"
                name="Present %"
                stroke="var(--color-primary)"
                fill="var(--color-primary)"
                fillOpacity={0.15}
                strokeWidth={1.8}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </WidgetCard>

      {/* Compliance alerts -------------------------------------------------*/}
      <WidgetCard title="Compliance alerts" subtitle="Data gaps that block payroll or statutory filing">
        {complianceAlerts.length === 0 ? (
          <WidgetEmpty message="No compliance checks reported" />
        ) : (
          <div className="space-y-2">
            {complianceAlerts.map((alert, idx) => {
              const count = num(alert.count);
              const severity = String(alert.severity ?? '').toLowerCase();
              const tone: 'danger' | 'warning' | 'default' =
                severity === 'high' || severity === 'danger'
                  ? 'danger'
                  : severity === 'medium' || severity === 'warning'
                    ? 'warning'
                    : 'default';
              const numberTone =
                tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-text-muted';
              return (
                <div
                  key={String(alert.key ?? idx)}
                  className="flex items-center justify-between gap-3 rounded-md bg-bg-secondary px-3 py-2.5"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <ShieldAlert
                      size={14}
                      className={`flex-shrink-0 mt-0.5 ${count > 0 ? numberTone : 'text-text-muted'}`}
                    />
                    <span className="text-text-secondary text-xs">{String(alert.label ?? alert.key ?? '')}</span>
                  </div>
                  <span className={`text-xl font-semibold tabular-nums flex-shrink-0 ${numberTone}`}>
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </WidgetCard>

      {/* Pending leave requests --------------------------------------------*/}
      <WidgetCard
        title="Pending leave requests"
        subtitle="Awaiting a decision"
        actions={leaveRequests.length > 0 ? <LinkAction label="Open leave" onClick={() => onNavigate('hr')} /> : undefined}
      >
        {leaveRequests.length === 0 ? (
          <WidgetEmpty message="No pending leave requests" />
        ) : (
          <TableShell headers={['Employee', 'Type', 'Dates', 'Days', '']}>
            {leaveRequests.map((row, idx) => (
              <tr key={String(row.id ?? idx)} className="hover:bg-bg-hover transition-colors">
                <td className="px-3 py-2">
                  <p className="text-text-primary text-xs font-medium">{String(row.employeeName ?? '—')}</p>
                  <p className="text-text-muted text-[10px]">{String(row.empCode ?? '')}</p>
                </td>
                <td className="px-3 py-2 text-text-secondary text-xs">{String(row.leaveTypeName ?? '—')}</td>
                <td className="px-3 py-2 text-text-secondary text-xs whitespace-nowrap">
                  {String(row.fromDate ?? '')} → {String(row.toDate ?? '')}
                </td>
                <td className="px-3 py-2 text-text-primary text-xs tabular-nums">{num(row.days)}</td>
                <td className="px-3 py-2 text-right">
                  <LinkAction label="Review" onClick={() => onNavigate('hr')} />
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </WidgetCard>

      {/* Payroll status -----------------------------------------------------*/}
      <WidgetCard
        title="Payroll status"
        subtitle="Recent salary periods"
        actions={<LinkAction label="Open payroll" onClick={() => onNavigate('payroll')} />}
      >
        {payrollStatus.length === 0 ? (
          <WidgetEmpty message="No payroll periods yet" />
        ) : (
          <div className="space-y-2">
            {payrollStatus.map((row, idx) => {
              const status = String(row.status ?? '');
              const tone: 'warning' | 'info' | 'success' | 'default' =
                status === 'OPEN' ? 'warning' : status === 'LOCKED' ? 'info' : status === 'PAID' ? 'success' : 'default';
              return (
                <div
                  key={String(row.id ?? row.periodId ?? idx)}
                  className="flex items-center justify-between gap-3 rounded-md bg-bg-secondary px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-text-primary text-xs font-medium truncate">{String(row.label ?? '—')}</p>
                    <p className="text-text-muted text-[10px]">{num(row.lineCount)} lines</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-text-primary text-xs font-medium tabular-nums">{inr(num(row.totalNet))}</span>
                    <Chip label={status || 'UNKNOWN'} tone={tone} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </WidgetCard>

      {/* Recruitment --------------------------------------------------------*/}
      <WidgetCard
        title="Recruitment"
        subtitle="Candidate pipeline"
        actions={<LinkAction label="Open recruitment" onClick={() => onNavigate('recruitment')} />}
      >
        <div className="rounded-md bg-bg-secondary px-3 py-2.5 mb-3 flex items-center justify-between">
          <span className="text-text-secondary text-xs">Open positions</span>
          <span className="text-text-primary text-lg font-semibold tabular-nums">
            {num(recruitment.openPositions)}
          </span>
        </div>
        {recruitmentStages.length === 0 ? (
          <WidgetEmpty message="No candidates in the pipeline" />
        ) : (
          <div className="space-y-1.5">
            {recruitmentStages.map((stage) => (
              <div key={stage.label} className="flex items-center justify-between gap-2 px-1 py-1">
                <span className="text-text-secondary text-xs">{stage.label}</span>
                <Chip label={String(stage.count)} tone="primary" />
              </div>
            ))}
          </div>
        )}
      </WidgetCard>

      {/* Department breakdown -----------------------------------------------*/}
      <WidgetCard title="Department breakdown" subtitle="Headcount and attendance" className="lg:col-span-2">
        {departmentBreakdown.length === 0 ? (
          <WidgetEmpty message="No departments configured" />
        ) : (
          <TableShell headers={['Department', 'Headcount', 'Present today', 'Attendance %']}>
            {departmentBreakdown.map((row, idx) => {
              const head = num(row.headcount);
              const present = row.presentToday ?? row.working ?? null;
              const hasPresent = present !== null && present !== undefined;
              const pct =
                row.attendancePct !== undefined && row.attendancePct !== null
                  ? num(row.attendancePct)
                  : hasPresent && head > 0
                    ? (num(present) / head) * 100
                    : null;
              return (
                <tr key={String(row.department ?? idx)} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-text-primary text-xs font-medium">
                    {String(row.department ?? 'Unassigned')}
                  </td>
                  <td className="px-3 py-2 text-text-secondary text-xs tabular-nums">{head}</td>
                  <td className="px-3 py-2 text-text-secondary text-xs tabular-nums">
                    {hasPresent ? num(present) : '—'}
                  </td>
                  <td className={`px-3 py-2 text-xs font-medium tabular-nums ${pct === null ? 'text-text-muted' : attendanceTone(pct)}`}>
                    {pct === null ? '—' : `${pct.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </TableShell>
        )}
      </WidgetCard>

      {/* Documents ----------------------------------------------------------*/}
      <WidgetCard
        title="Documents"
        subtitle="KYC verification"
        actions={<LinkAction label="Open employees" onClick={() => onNavigate('employees')} />}
      >
        {docsUnavailable !== null ? (
          <WidgetUnavailable reason={docsUnavailable} />
        ) : docTotal === 0 ? (
          <WidgetEmpty message="No documents uploaded yet" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Verified" value={docVerified} tone="text-success" />
              <MiniStat label="Unverified" value={docUnverified} tone="text-warning" />
            </div>
            <div className="h-1.5 rounded-full bg-bg-secondary mt-3 overflow-hidden">
              <div
                className="h-full rounded-full bg-success"
                style={{ width: `${(docVerified / docTotal) * 100}%` }}
              />
            </div>
          </>
        )}
      </WidgetCard>

      {/* Diversity ----------------------------------------------------------*/}
      <WidgetCard title="Workforce mix" subtitle="Gender, grade and worker type" className="lg:col-span-2">
        {Object.keys(diversity).length === 0 ? (
          <WidgetEmpty message="No workforce mix data" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <BreakdownList title="Gender" buckets={toBuckets(diversity.gender)} />
            <BreakdownList title="Grade" buckets={toBuckets(diversity.grade)} />
            <BreakdownList title="Worker type" buckets={toBuckets(diversity.workerType)} />
          </div>
        )}
      </WidgetCard>

      <OnboardingCard widgets={widgets} onNavigate={onNavigate} />
      <OffboardingCard widgets={widgets} onNavigate={onNavigate} />
      <TrainingCard widgets={widgets} />

      <WidgetCard title="HR reports" subtitle="Export and drill-downs">
        <div className="grid grid-cols-1 gap-2">
          {[
            { label: 'Attendance register', page: 'attendance' },
            { label: 'Leave and advances', page: 'hr' },
            { label: 'Payroll and compliance', page: 'payroll' },
            { label: 'Recruitment pipeline', page: 'recruitment' },
          ].map((r) => (
            <button
              key={r.page}
              onClick={() => onNavigate(r.page)}
              className="flex items-center justify-between px-3 py-2 rounded-md border border-border-default text-text-secondary text-xs hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
              {r.label} <ArrowRight size={13} />
            </button>
          ))}
        </div>
      </WidgetCard>

      <WidgetCard title="AI insights">
        <WidgetUnavailable reason="AI features are not enabled for this workspace" />
      </WidgetCard>
    </div>
  );
}

/** Onboarding: candidates selected but not yet converted, plus new joiners missing KYC. */
function OnboardingCard({ widgets, onNavigate }: { widgets: AnyRec; onNavigate: (page: string) => void }) {
  const raw = widgets.pendingOnboarding;
  const reason = unavailableReason(raw);
  // The API returns either a flat list or {selectedCandidates, newJoinersMissingKyc}.
  const grouped = asObject(raw);
  const selected = asArray(Array.isArray(raw) ? raw : grouped.selectedCandidates);
  const missingKyc = asArray(grouped.newJoinersMissingKyc);
  const total = selected.length + missingKyc.length;

  return (
    <WidgetCard
      title="Onboarding status"
      subtitle="Waiting to join or complete paperwork"
      actions={
        <button onClick={() => onNavigate('recruitment')} className="text-primary text-xs hover:underline">
          Open
        </button>
      }
    >
      {reason ? (
        <WidgetUnavailable reason={reason} />
      ) : total === 0 ? (
        <WidgetEmpty message="Nothing pending" />
      ) : (
        <div className="space-y-3">
          {selected.length > 0 && (
            <div>
              <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Ready to convert</p>
              {selected.slice(0, 5).map((c: AnyRec, i: number) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <span className="text-text-primary text-xs truncate">{c.fullName ?? c.name ?? '—'}</span>
                  <Chip label="Selected" tone="warning" />
                </div>
              ))}
            </div>
          )}
          {missingKyc.length > 0 && (
            <div>
              <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1">New joiners missing KYC</p>
              {missingKyc.slice(0, 5).map((e: AnyRec, i: number) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <span className="text-text-primary text-xs truncate">{e.fullName ?? e.name ?? '—'}</span>
                  <Chip label="KYC" tone="danger" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

/** Offboarding: recently resigned employees still holding logins, assets or advances. */
function OffboardingCard({ widgets, onNavigate }: { widgets: AnyRec; onNavigate: (page: string) => void }) {
  const raw = widgets.pendingOffboarding;
  const reason = unavailableReason(raw);
  const rows = asArray(Array.isArray(raw) ? raw : asObject(raw).employees);

  return (
    <WidgetCard
      title="Offboarding status"
      subtitle="Resigned with open items"
      actions={
        <button onClick={() => onNavigate('employees')} className="text-primary text-xs hover:underline">
          Open
        </button>
      }
    >
      {reason ? (
        <WidgetUnavailable reason={reason} />
      ) : rows.length === 0 ? (
        <WidgetEmpty message="No pending offboarding" />
      ) : (
        <div className="space-y-1">
          {rows.slice(0, 6).map((r: AnyRec, i: number) => (
            <div key={i} className="flex items-center justify-between py-1">
              <div className="min-w-0">
                <p className="text-text-primary text-xs truncate">{r.fullName ?? r.name ?? '—'}</p>
                <p className="text-text-muted text-[10px] font-mono">{r.empCode ?? ''}</p>
              </div>
              {r.reason && <Chip label={String(r.reason)} tone="warning" />}
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

/** Training summary: the API returns either {byStatus,...} or a list of {status,...}. */
function TrainingCard({ widgets }: { widgets: AnyRec }) {
  const raw = widgets.trainingStatus;
  const reason = unavailableReason(raw);
  const buckets = Array.isArray(raw)
    ? raw
        .map((r: AnyRec) => ({
          label: String(r.status ?? r.bucket ?? ''),
          count: num(r.trainings ?? r.count ?? 0),
        }))
        .filter((b) => b.label !== '')
    : toBuckets(asObject(raw).byStatus);

  return (
    <WidgetCard title="Training summary" subtitle="Programmes by status">
      {reason ? (
        <WidgetUnavailable reason={reason} />
      ) : buckets.length === 0 ? (
        <WidgetEmpty message="No training programmes recorded" />
      ) : (
        <BreakdownList title="" buckets={buckets} />
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Executive widgets
// ---------------------------------------------------------------------------
function ExecutiveWidgets({ widgets }: { widgets: AnyRec }) {
  const overview = asObject(widgets.companyOverview);
  const payrollCost = asArray(widgets.payrollCost);
  const headcountTrend = asArray(widgets.headcountTrend);
  const attendanceAnalytics = asArray(widgets.attendanceAnalytics);
  const departmentPerformance = asArray(widgets.departmentPerformance);
  const hiringTrend = asArray(widgets.hiringTrend);
  const costAnalytics = asArray(widgets.costAnalytics);
  const planning = asObject(widgets.workforcePlanning);
  const satisfactionReason = unavailableReason(widgets.employeeSatisfaction);

  // hiringTrend rows carry a per-month {status: count} map; flatten it so one
  // bar can be drawn per status actually present in the data.
  const hiringStatuses = Array.from(
    new Set(hiringTrend.flatMap((row) => Object.keys(asObject(row.byStatus)))),
  );
  const hiringData = hiringTrend.map((row) => ({
    month: String(row.month ?? ''),
    ...Object.fromEntries(hiringStatuses.map((s) => [s, num(asObject(row.byStatus)[s])])),
  }));

  const retirements = asArray(planning.upcomingRetirements);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <WidgetCard title="Company overview" subtitle="Right now">
        {Object.keys(overview).length === 0 ? (
          <WidgetEmpty message="No overview data" />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Headcount" value={num(overview.headcount)} />
            <MiniStat label="Departments" value={num(overview.departments)} />
            <MiniStat label="Active lots" value={num(overview.activeLots)} tone="text-info" />
            <MiniStat label="Open periods" value={num(overview.openPayrollPeriods)} tone="text-warning" />
          </div>
        )}
      </WidgetCard>

      <WidgetCard title="Payroll cost" subtitle="Gross, deductions and net by period" className="lg:col-span-2">
        {payrollCost.length === 0 ? (
          <WidgetEmpty message="No payroll periods with lines" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={payrollCost} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
              <XAxis dataKey="label" tick={AXIS} stroke="var(--color-text-muted)" />
              <YAxis tick={AXIS} stroke="var(--color-text-muted)" width={64} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: 'var(--color-bg-hover)' }}
                formatter={moneyFormatter}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="gross" name="Gross" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="deductions" name="Deductions" fill="var(--color-warning)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="net" name="Net" fill="var(--color-success)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </WidgetCard>

      <WidgetCard title="Headcount trend" subtitle="Rolling months" className="lg:col-span-2">
        {headcountTrend.length === 0 ? (
          <WidgetEmpty message="No headcount history" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={headcountTrend} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
              <XAxis dataKey="month" tick={AXIS} stroke="var(--color-text-muted)" tickFormatter={shortMonth} />
              <YAxis tick={AXIS} stroke="var(--color-text-muted)" allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line
                type="monotone"
                dataKey="headcount"
                name="Headcount"
                stroke="var(--color-primary)"
                strokeWidth={1.8}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </WidgetCard>

      <WidgetCard title="Workforce planning" subtitle="Pipeline and retirements">
        {Object.keys(planning).length === 0 ? (
          <WidgetEmpty message="No planning data" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Open positions" value={num(planning.openPositions)} tone="text-info" />
              <MiniStat label="In pipeline" value={num(planning.candidatesInPipeline)} />
            </div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider mt-4 mb-2">
              Upcoming retirements
            </p>
            {retirements.length === 0 ? (
              <p className="text-text-muted text-xs italic">None in the next window</p>
            ) : (
              <div className="space-y-1.5">
                {retirements.map((r, idx) => (
                  <div key={String(r.employeeId ?? idx)} className="flex items-center justify-between gap-2">
                    <span className="text-text-secondary text-xs truncate">{String(r.fullName ?? '—')}</span>
                    <span className="text-text-muted text-[11px] tabular-nums">age {num(r.age)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </WidgetCard>

      <WidgetCard title="Attendance analytics" subtitle="Monthly attendance %" className="lg:col-span-2">
        {attendanceAnalytics.length === 0 ? (
          <WidgetEmpty message="No attendance history" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={attendanceAnalytics} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
              <XAxis dataKey="month" tick={AXIS} stroke="var(--color-text-muted)" tickFormatter={shortMonth} />
              <YAxis tick={AXIS} stroke="var(--color-text-muted)" domain={[0, 100]} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={pctFormatter('Attendance')} />
              <Area
                type="monotone"
                dataKey="attendancePct"
                name="Attendance %"
                stroke="var(--color-primary)"
                fill="var(--color-primary)"
                fillOpacity={0.15}
                strokeWidth={1.8}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </WidgetCard>

      <WidgetCard title="Employee satisfaction">
        {satisfactionReason !== null ? (
          <WidgetUnavailable reason={satisfactionReason} />
        ) : (
          <WidgetEmpty message="No satisfaction data" />
        )}
      </WidgetCard>

      <WidgetCard title="Department performance" subtitle="Attendance and labour produced" className="lg:col-span-2">
        {departmentPerformance.length === 0 ? (
          <WidgetEmpty message="No department metrics" />
        ) : (
          <TableShell headers={['Department', 'Headcount', 'Attendance %', 'Labour produced', 'Carats']}>
            {departmentPerformance.map((row, idx) => {
              const pct = num(row.attendancePct);
              return (
                <tr key={String(row.department ?? idx)} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-text-primary text-xs font-medium">
                    {String(row.department ?? 'Unassigned')}
                  </td>
                  <td className="px-3 py-2 text-text-secondary text-xs tabular-nums">{num(row.headcount)}</td>
                  <td className={`px-3 py-2 text-xs font-medium tabular-nums ${attendanceTone(pct)}`}>
                    {pct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-text-secondary text-xs tabular-nums">
                    {inr(num(row.labourProduced))}
                  </td>
                  <td className="px-3 py-2 text-text-secondary text-xs tabular-nums">
                    {num(row.totalCts).toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </TableShell>
        )}
      </WidgetCard>

      <WidgetCard title="Hiring trend" subtitle="Candidates by stage per month">
        {hiringData.length === 0 || hiringStatuses.length === 0 ? (
          <WidgetEmpty message="No hiring activity" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hiringData} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
              <XAxis dataKey="month" tick={AXIS} stroke="var(--color-text-muted)" tickFormatter={shortMonth} />
              <YAxis tick={AXIS} stroke="var(--color-text-muted)" allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-bg-hover)' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {hiringStatuses.map((status, idx) => (
                <Bar
                  key={status}
                  dataKey={status}
                  name={status}
                  stackId="hiring"
                  fill={SERIES_COLORS[idx % SERIES_COLORS.length]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </WidgetCard>

      <WidgetCard title="Cost analytics" subtitle="Earnings split by period" className="lg:col-span-3">
        {costAnalytics.length === 0 ? (
          <WidgetEmpty message="No cost breakdown available" />
        ) : (
          <TableShell headers={['Period', 'Piece rate', 'Fixed', 'Overtime', 'Statutory']}>
            {costAnalytics.map((row, idx) => (
              <tr key={String(row.periodId ?? row.label ?? idx)} className="hover:bg-bg-hover transition-colors">
                <td className="px-3 py-2 text-text-primary text-xs font-medium">{String(row.label ?? '—')}</td>
                <td className="px-3 py-2 text-text-secondary text-xs tabular-nums">{inr(num(row.piece))}</td>
                <td className="px-3 py-2 text-text-secondary text-xs tabular-nums">{inr(num(row.fixed))}</td>
                <td className="px-3 py-2 text-text-secondary text-xs tabular-nums">{inr(num(row.overtime))}</td>
                <td className="px-3 py-2 text-text-secondary text-xs tabular-nums">{inr(num(row.statutory))}</td>
              </tr>
            ))}
          </TableShell>
        )}
      </WidgetCard>

      <WidgetCard title="Budget analytics" subtitle="Payroll cost against period">
        {payrollCost.length === 0 ? (
          <WidgetUnavailable reason="No budget is configured — showing payroll cost only once periods are calculated" />
        ) : (
          <div className="space-y-2">
            {payrollCost.slice(-4).map((p: AnyRec, i: number) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-text-secondary text-xs truncate">{String(p.label ?? '—')}</span>
                <span className="text-text-primary text-xs font-mono">{inr(num(p.net))}</span>
              </div>
            ))}
            <p className="text-text-muted text-[10px] pt-1 border-t border-border-light">
              Budget targets are not configured, so variance is not shown.
            </p>
          </div>
        )}
      </WidgetCard>

      <WidgetCard title="Executive alerts" subtitle="Items needing attention">
        <ExecutiveAlerts widgets={widgets} />
      </WidgetCard>

      <WidgetCard title="Strategic reports">
        <div className="space-y-2">
          {[
            'Payroll cost by period',
            'Headcount and attrition',
            'Department performance',
            'Hiring funnel',
          ].map((label) => (
            <div
              key={label}
              className="flex items-center justify-between px-3 py-2 rounded-md border border-border-default text-text-secondary text-xs"
            >
              {label}
              <Chip label="On this page" tone="default" />
            </div>
          ))}
        </div>
      </WidgetCard>

      <WidgetCard title="AI executive insights">
        <WidgetUnavailable reason="AI features are not enabled for this workspace" />
      </WidgetCard>
    </div>
  );
}

/**
 * Derives executive alerts from figures already on the payload rather than
 * inventing an alert feed the backend does not have.
 */
function ExecutiveAlerts({ widgets }: { widgets: AnyRec }) {
  const overview = asObject(widgets.companyOverview);
  const payrollCost = asArray(widgets.payrollCost);
  const planning = asObject(widgets.workforcePlanning);

  const alerts: { label: string; tone: 'warning' | 'danger' | 'info'; detail: string }[] = [];

  const openPeriods = num(overview.openPeriods);
  if (openPeriods > 0) {
    alerts.push({
      label: 'Payroll period open',
      tone: 'warning',
      detail: `${openPeriods} period(s) still open and unpaid`,
    });
  }

  const openPositions = num(planning.openPositions);
  if (openPositions > 0) {
    alerts.push({
      label: 'Open positions',
      tone: 'info',
      detail: `${openPositions} role(s) currently being hired for`,
    });
  }

  const latest = payrollCost[payrollCost.length - 1] as AnyRec | undefined;
  const previous = payrollCost[payrollCost.length - 2] as AnyRec | undefined;
  if (latest && previous && num(previous.net) > 0) {
    const changePct = ((num(latest.net) - num(previous.net)) / num(previous.net)) * 100;
    if (Math.abs(changePct) >= 10) {
      alerts.push({
        label: 'Payroll cost movement',
        tone: changePct > 0 ? 'warning' : 'info',
        detail: `Net pay ${changePct > 0 ? 'up' : 'down'} ${Math.abs(changePct).toFixed(1)}% vs the previous period`,
      });
    }
  }

  if (alerts.length === 0) return <WidgetEmpty message="Nothing needs attention" />;

  return (
    <div className="space-y-2">
      {alerts.map((a, i) => (
        <div key={i} className="flex items-start gap-2">
          <ShieldAlert size={14} className="text-warning mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-text-primary text-xs font-medium">{a.label}</span>
              <Chip label={a.tone === 'danger' ? 'High' : a.tone === 'warning' ? 'Review' : 'Info'} tone={a.tone} />
            </div>
            <p className="text-text-muted text-[10px]">{a.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
