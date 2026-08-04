import { useCallback, useEffect, useState } from 'react';
import { Info, RefreshCw } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { payrollAdminApi } from '../../../api/payroll';
import {
  BTN_SECONDARY,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
  StatCard,
  TableShell,
  inr,
} from '../../../components/common/HrmsUI';
import { TabBar } from '../../../components/common/TabBar';
import { useApp } from '../../../contexts/AppContext';
import { WidgetCard, WidgetEmpty, WidgetUnavailable } from '../../HRDashboard/WidgetCard';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : inr(n);
}

function count(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : n.toLocaleString('en-IN');
}

function pctText(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : `${n.toFixed(1)}%`;
}

/** Relative timestamp without pulling in date-fns. */
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
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthsAgoISO(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function unavailableReason(payload: any): string | null {
  if (payload && typeof payload === 'object' && payload.available === false) {
    return String(payload.reason ?? '');
  }
  return null;
}

const AXIS_TICK = { fontSize: 11 };
const AXIS_STROKE = 'var(--color-text-muted)';
const GRID_STROKE = 'var(--color-border-light)';

const TOOLTIP_STYLE = {
  background: 'var(--color-bg-card)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 6,
  fontSize: 12,
};

const TABS = [
  { id: 'cost', label: 'Cost' },
  { id: 'trends', label: 'Trends' },
  { id: 'increments', label: 'Increments' },
  { id: 'overtime', label: 'Overtime' },
  { id: 'bonus', label: 'Bonus' },
  { id: 'forecast', label: 'Forecast' },
];

/** Bar chart over `{bucket, ...}` rows, empty-safe. */
function BucketBars({
  rows,
  dataKey,
  name,
  fill,
  formatter,
}: {
  rows: any[];
  dataKey: string;
  name: string;
  fill: string;
  formatter?: (value: any) => string;
}) {
  if (rows.length === 0) return <WidgetEmpty />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="bucket" tick={AXIS_TICK} stroke={AXIS_STROKE} interval={0} angle={-15} textAnchor="end" height={48} />
        <YAxis tick={AXIS_TICK} stroke={AXIS_STROKE} width={64} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => (formatter ? formatter(v) : inr(Number(v)))} />
        <Bar dataKey={dataKey} name={name} fill={fill} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Payroll analytics: cost breakdowns, salary trends, increment history,
 * overtime and bonus spend, and a deliberately modest cost projection.
 */
export function PayrollAnalyticsSection() {
  const { employees } = useApp();

  const [tab, setTab] = useState('cost');
  const [from, setFrom] = useState(monthsAgoISO(11));
  const [to, setTo] = useState(todayISO());
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [months, setMonths] = useState(6);

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    let request: Promise<any>;
    switch (tab) {
      case 'cost':
        request = payrollAdminApi.costAnalytics({ from, to });
        break;
      case 'trends':
        request = payrollAdminApi.salaryTrends(employeeId ?? undefined);
        break;
      case 'increments':
        request = payrollAdminApi.incrementAnalysis();
        break;
      case 'overtime':
        request = payrollAdminApi.overtimeAnalysis({ from, to });
        break;
      case 'bonus':
        request = payrollAdminApi.bonusAnalysis({ from, to });
        break;
      case 'forecast':
        request = payrollAdminApi.forecast(months);
        break;
      default:
        request = Promise.resolve(null);
    }

    request
      .then((res) => {
        setData(res ?? null);
        setLoadedAt(new Date().toISOString());
      })
      .catch((err: any) => setError(err?.message ?? 'Could not load analytics'))
      .finally(() => setLoading(false));
  }, [tab, from, to, employeeId, months]);

  useEffect(() => {
    setData(null);
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const rangeBar = (
    <div className="flex items-end gap-3 flex-wrap">
      <div>
        <label className={LABEL_CLS} htmlFor="an-from">
          From
        </label>
        <input id="an-from" type="date" className={INPUT_CLS} value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div>
        <label className={LABEL_CLS} htmlFor="an-to">
          To
        </label>
        <input id="an-to" type="date" className={INPUT_CLS} value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
    </div>
  );

  const unavailable = unavailableReason(data);

  const body = () => {
    if (loading && !data) return <LoadingBlock label="Loading analytics…" />;
    if (error) {
      return (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button onClick={load} className={BTN_SECONDARY}>
            Retry
          </button>
        </div>
      );
    }
    if (unavailable !== null) return <WidgetUnavailable reason={unavailable} />;
    if (!data) return <EmptyBlock message="No analytics data" />;

    if (tab === 'cost') {
      const byDepartment: any[] = Array.isArray(data.byDepartment) ? data.byDepartment : [];
      const byBranch: any[] = Array.isArray(data.byBranch) ? data.byBranch : [];
      const byGrade: any[] = Array.isArray(data.byGrade) ? data.byGrade : [];
      const trend: any[] = Array.isArray(data.monthlyTrend) ? data.monthlyTrend : [];
      const totals = data.totals ?? {};

      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Gross" value={money(totals.gross)} />
            <StatCard label="Deductions" value={money(totals.deductions)} intent="warning" />
            <StatCard label="Net" value={money(totals.net)} intent="success" />
            <StatCard label="Employer cost" value={money(totals.employerCost)} intent="info" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <WidgetCard title="Cost by department" subtitle="Gross for the selected range">
              <BucketBars rows={byDepartment} dataKey="gross" name="Gross" fill="var(--color-primary)" />
            </WidgetCard>
            <WidgetCard title="Cost by branch" subtitle="Gross for the selected range">
              <BucketBars rows={byBranch} dataKey="gross" name="Gross" fill="var(--color-success)" />
            </WidgetCard>
          </div>

          <WidgetCard title="Cost by grade">
            {byGrade.length === 0 ? (
              <WidgetEmpty />
            ) : (
              <TableShell headers={['Grade', 'Employees', 'Gross', 'Deductions', 'Net', 'Employer cost', 'Share']}>
                {byGrade.map((r: any, i: number) => (
                  <tr key={`${r?.bucket}-${i}`}>
                    <td className="px-3 py-2 text-sm text-text-primary">{String(r?.bucket ?? '—')}</td>
                    <td className="px-3 py-2 text-sm text-right font-mono text-text-secondary">{count(r?.employees)}</td>
                    <td className="px-3 py-2 text-sm text-right font-mono text-text-secondary">{money(r?.gross)}</td>
                    <td className="px-3 py-2 text-sm text-right font-mono text-text-secondary">{money(r?.deductions)}</td>
                    <td className="px-3 py-2 text-sm text-right font-mono text-text-primary">{money(r?.net)}</td>
                    <td className="px-3 py-2 text-sm text-right font-mono text-text-secondary">{money(r?.employerCost)}</td>
                    <td className="px-3 py-2 text-sm text-right font-mono text-text-muted">{pctText(r?.sharePct)}</td>
                  </tr>
                ))}
              </TableShell>
            )}
          </WidgetCard>

          <WidgetCard title="Last 12 periods" subtitle="Gross, net, deductions and employer cost">
            {trend.length === 0 ? (
              <WidgetEmpty />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={trend.map((t: any) => ({
                    label: String(t?.periodLabel ?? ''),
                    gross: num(t?.gross) ?? 0,
                    net: num(t?.net) ?? 0,
                    deductions: num(t?.deductions) ?? 0,
                    employerCost: num(t?.employerCost) ?? 0,
                  }))}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} stroke={AXIS_STROKE} />
                  <YAxis tick={AXIS_TICK} stroke={AXIS_STROKE} width={64} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => inr(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="gross" name="Gross" stroke="var(--color-primary)" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="net" name="Net" stroke="var(--color-success)" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="deductions" name="Deductions" stroke="var(--color-danger)" dot={false} strokeWidth={2} />
                  <Line
                    type="monotone"
                    dataKey="employerCost"
                    name="Employer cost"
                    stroke="var(--color-primary)"
                    strokeDasharray="4 3"
                    dot={false}
                    strokeWidth={1.5}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </WidgetCard>
        </div>
      );
    }

    if (tab === 'trends') {
      const points: any[] = Array.isArray(data.points) ? data.points : [];
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Periods" value={count(points.length)} />
            <StatCard
              label="Change across window"
              value={pctText(data.changePct)}
              intent={(num(data.changePct) ?? 0) >= 0 ? 'success' : 'danger'}
            />
            <StatCard label="Scope" value={employeeId ? 'One employee' : 'All employees'} />
          </div>
          <WidgetCard title="Salary over time" subtitle={employeeId ? 'Selected employee' : 'Company wide'}>
            {points.length === 0 ? (
              <WidgetEmpty message="No salary history in range" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={points.map((p: any) => ({
                    label: String(p?.periodLabel ?? ''),
                    gross: num(p?.gross) ?? 0,
                    net: num(p?.net) ?? 0,
                  }))}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} stroke={AXIS_STROKE} />
                  <YAxis tick={AXIS_TICK} stroke={AXIS_STROKE} width={64} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => inr(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="gross" name="Gross" stroke="var(--color-primary)" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="net" name="Net" stroke="var(--color-success)" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </WidgetCard>
        </div>
      );
    }

    if (tab === 'increments') {
      const byGrade: any[] = Array.isArray(data.byGrade) ? data.byGrade : [];
      const byType: any[] = Array.isArray(data.byType) ? data.byType : [];
      const overall = data.overall ?? {};

      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Revisions" value={count(overall.revisions)} />
            <StatCard label="Average increase" value={pctText(overall.avgPct)} intent="info" />
            <StatCard label="Grades covered" value={count(byGrade.length)} />
          </div>

          <WidgetCard title="Average increase by grade">
            {byGrade.length === 0 ? (
              <WidgetEmpty message="No salary revisions recorded" />
            ) : (
              <TableShell headers={['Grade', 'Revisions', 'Average %', 'Average amount']}>
                {byGrade.map((r: any, i: number) => (
                  <tr key={`${r?.bucket}-${i}`}>
                    <td className="px-3 py-2 text-sm text-text-primary">{String(r?.bucket ?? '—')}</td>
                    <td className="px-3 py-2 text-sm text-right font-mono text-text-secondary">{count(r?.revisions)}</td>
                    <td className="px-3 py-2 text-sm text-right font-mono text-text-primary">{pctText(r?.avgPct)}</td>
                    <td className="px-3 py-2 text-sm text-right font-mono text-text-secondary">{money(r?.avgAmount)}</td>
                  </tr>
                ))}
              </TableShell>
            )}
          </WidgetCard>

          <WidgetCard title="Average increase by revision type">
            {byType.length === 0 ? (
              <WidgetEmpty message="No salary revisions recorded" />
            ) : (
              <TableShell headers={['Revision type', 'Revisions', 'Average %', 'Average amount']}>
                {byType.map((r: any, i: number) => (
                  <tr key={`${r?.bucket}-${i}`}>
                    <td className="px-3 py-2 text-sm text-text-primary">{String(r?.bucket ?? '—')}</td>
                    <td className="px-3 py-2 text-sm text-right font-mono text-text-secondary">{count(r?.revisions)}</td>
                    <td className="px-3 py-2 text-sm text-right font-mono text-text-primary">{pctText(r?.avgPct)}</td>
                    <td className="px-3 py-2 text-sm text-right font-mono text-text-secondary">{money(r?.avgAmount)}</td>
                  </tr>
                ))}
              </TableShell>
            )}
          </WidgetCard>
        </div>
      );
    }

    if (tab === 'overtime') {
      const totals = data.totals ?? {};
      const byDepartment: any[] = Array.isArray(data.byDepartment) ? data.byDepartment : [];
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Overtime hours" value={count(totals.hours)} />
            <StatCard label="Overtime cost" value={money(totals.amount)} intent="warning" />
            <StatCard label="Employees with OT" value={count(totals.employees)} />
            <StatCard label="Average hourly rate" value={money(data.averageHourlyRate)} intent="info" />
          </div>
          <WidgetCard title="Overtime cost by department">
            <BucketBars rows={byDepartment} dataKey="amount" name="OT amount" fill="var(--color-danger)" />
          </WidgetCard>
        </div>
      );
    }

    if (tab === 'bonus') {
      const paid = data.paidThroughPayroll ?? {};
      const byDepartment: any[] = Array.isArray(data.byDepartment) ? data.byDepartment : [];
      const byAwardClass: any[] = Array.isArray(data.byAwardClass) ? data.byAwardClass : [];
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Bonus paid" value={money(paid.bonus)} />
            <StatCard label="Incentive paid" value={money(paid.incentive)} />
            <StatCard label="Variable pay" value={money(paid.variable)} />
            <StatCard label="Total paid" value={money(data.totalPaid)} intent="success" />
          </div>
          <WidgetCard title="Variable pay by department">
            <BucketBars rows={byDepartment} dataKey="amount" name="Amount" fill="var(--color-primary)" />
          </WidgetCard>
          <WidgetCard title="Awards by class and status">
            {byAwardClass.length === 0 ? (
              <WidgetEmpty message="No awards in this range" />
            ) : (
              <TableShell headers={['Class', 'Status', 'Awards', 'Amount']}>
                {byAwardClass.map((r: any, i: number) => (
                  <tr key={`${r?.bucket}-${r?.status}-${i}`}>
                    <td className="px-3 py-2 text-sm text-text-primary">{String(r?.bucket ?? '—')}</td>
                    <td className="px-3 py-2 text-sm text-text-secondary">{String(r?.status ?? '—')}</td>
                    <td className="px-3 py-2 text-sm text-right font-mono text-text-secondary">{count(r?.awards)}</td>
                    <td className="px-3 py-2 text-sm text-right font-mono text-text-primary">{money(r?.amount)}</td>
                  </tr>
                ))}
              </TableShell>
            )}
          </WidgetCard>
        </div>
      );
    }

    // forecast
    const projections: any[] = Array.isArray(data.projections) ? data.projections : [];
    const method = data.method ? String(data.method) : null;
    return (
      <div className="space-y-4">
        <div className="px-4 py-3 rounded-md bg-bg-secondary border border-border-default flex items-start gap-2">
          <Info size={16} className="text-text-muted flex-shrink-0 mt-0.5" />
          <div className="text-text-muted text-xs space-y-1">
            <p className="font-medium text-text-secondary">
              Naive projection from the trailing 3-period average — not a forecasting model.
            </p>
            {method && <p>Backend method: {method}.</p>}
            {data.caveat && <p>{String(data.caveat)}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label="Base monthly cost" value={money(data.baseMonthlyCost)} />
          <StatCard label="Headcount growth" value={pctText(data.headcountGrowthPct)} />
          <StatCard label="Total projected cost" value={money(data.totalProjectedCost)} intent="info" />
        </div>

        <WidgetCard title="Projected payroll cost" subtitle={`${months} month horizon`}>
          {projections.length === 0 ? (
            <WidgetEmpty message="Not enough history to project" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart
                data={projections.map((p: any) => ({
                  label: `M+${num(p?.monthIndex) ?? 0}`,
                  cost: num(p?.projectedCost) ?? 0,
                }))}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} stroke={AXIS_STROKE} />
                <YAxis tick={AXIS_TICK} stroke={AXIS_STROKE} width={64} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => inr(Number(v))} />
                <Line
                  type="monotone"
                  dataKey="cost"
                  name="Projected cost"
                  stroke="var(--color-primary)"
                  strokeDasharray="5 4"
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </WidgetCard>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <TabBar tabs={TABS} active={tab} onChange={setTab} />
        <div className="flex items-center gap-3">
          {loadedAt && <span className="text-text-muted text-[11px]">Updated {timeAgo(loadedAt)}</span>}
          <button onClick={load} className={BTN_SECONDARY} disabled={loading}>
            <RefreshCw size={14} className={`inline mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {(tab === 'cost' || tab === 'overtime' || tab === 'bonus') && rangeBar}

      {tab === 'trends' && (
        <div>
          <label className={LABEL_CLS} htmlFor="an-employee">
            Employee (optional)
          </label>
          <select
            id="an-employee"
            className={`${INPUT_CLS} max-w-sm`}
            value={employeeId ?? ''}
            onChange={(e) => setEmployeeId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">All employees</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.empCode} — {emp.fullName}
              </option>
            ))}
          </select>
        </div>
      )}

      {tab === 'forecast' && (
        <div className="flex items-center gap-2">
          <span className={LABEL_CLS}>Horizon</span>
          {[3, 6, 12].map((m) => (
            <button
              key={m}
              onClick={() => setMonths(m)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                months === m
                  ? 'bg-primary-light border-primary/30 text-primary'
                  : 'border-border-default text-text-muted hover:border-text-muted'
              }`}
            >
              {m} months
            </button>
          ))}
        </div>
      )}

      {body()}
    </div>
  );
}
