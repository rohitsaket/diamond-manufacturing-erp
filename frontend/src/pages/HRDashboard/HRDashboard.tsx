import { useCallback, useEffect, useMemo, useState } from 'react';
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
import type { DashboardPayload } from '../../types/hrms';
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

const TABS = [
  { id: 'hr', label: 'HR Overview' },
  { id: 'executive', label: 'Executive' },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function HRDashboard({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [tab, setTab] = useState('hr');
  const [cache, setCache] = useState<Record<string, DashboardPayload>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payload = cache[tab];

  const load = useCallback(
    async (key: string, force = false) => {
      if (!force && cache[key]) return;
      setLoading(true);
      setError(null);
      try {
        const data = key === 'executive' ? await hrDashboardApi.executive() : await hrDashboardApi.hr();
        setCache((prev) => ({ ...prev, [key]: data }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load the dashboard');
      } finally {
        setLoading(false);
      }
    },
    [cache],
  );

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  const kpis = useMemo(() => asArray(payload?.kpis), [payload]);
  const widgets = useMemo(() => asObject(payload?.widgets), [payload]);

  const header = (
    <PageHeader
      title="HR Dashboard"
      subtitle="Workforce, attendance, payroll and compliance at a glance"
      actions={
        <button
          onClick={() => void load(tab, true)}
          disabled={loading}
          className={`${BTN_SECONDARY} flex items-center gap-2`}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      }
    />
  );

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

      <TabBar tabs={TABS} active={tab} onChange={setTab} />

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
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | string) => [`${v}%`, 'Present']} />
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
    </div>
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
                formatter={(v: number | string) => inr(Number(v))}
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
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | string) => [`${v}%`, 'Attendance']} />
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
    </div>
  );
}
