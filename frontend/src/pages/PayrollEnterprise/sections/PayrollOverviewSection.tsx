import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { payrollAdminApi } from '../../../api/payroll';
import { BTN_SECONDARY, Chip, ErrorBlock, LoadingBlock, inr } from '../../../components/common/HrmsUI';
import { useApp } from '../../../contexts/AppContext';
import { KpiTile } from '../../HRDashboard/KpiTile';
import { WidgetCard, WidgetEmpty, WidgetUnavailable } from '../../HRDashboard/WidgetCard';
import type { KpiCard } from '../../../types/hrms';

// ---------------------------------------------------------------------------
// Local helpers — every payload key is treated as optional on purpose.
// ---------------------------------------------------------------------------

/** Number when the key is genuinely present, null when it is not. */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Money, or an em dash when the backend never sent the figure. */
function money(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : inr(n);
}

/** Plain count, or an em dash. Never silently renders a missing key as zero. */
function count(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : n.toLocaleString('en-IN');
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

function duration(ms: unknown): string {
  const n = num(ms);
  if (n === null) return '—';
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)} s`;
  return `${Math.floor(n / 60_000)}m ${Math.round((n % 60_000) / 1000)}s`;
}

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

function periodTone(status: string | null | undefined): Tone {
  if (status === 'OPEN') return 'warning';
  if (status === 'LOCKED') return 'info';
  if (status === 'PAID') return 'success';
  return 'default';
}

function runTone(status: string | null | undefined): Tone {
  const s = String(status ?? '').toUpperCase();
  if (s === 'COMPLETED' || s === 'APPROVED') return 'success';
  if (s === 'RUNNING' || s === 'PENDING_APPROVAL') return 'info';
  if (s === 'FAILED' || s === 'REJECTED') return 'danger';
  return 'default';
}

/** `{available:false, reason}` is the backend's way of saying "no data source". */
function unavailableReason(payload: any): string | null {
  if (payload && typeof payload === 'object' && payload.available === false) {
    return String(payload.reason ?? '');
  }
  return null;
}

const CHART_AXIS = { fontSize: 11 };

interface Props {
  onNavigate: (page: string) => void;
  onSectionChange: (section: string) => void;
}

/**
 * Payroll control tower: what this period costs, whether the run finished,
 * whether it can legally be filed, and what is still waiting on a human.
 */
export function PayrollOverviewSection({ onNavigate, onSectionChange }: Props) {
  const { salaryPeriods } = useApp();

  const [periodId, setPeriodId] = useState<number | null>(null);
  const [dashboard, setDashboard] = useState<any | null>(null);
  const [compliance, setCompliance] = useState<any | null>(null);
  const [cost, setCost] = useState<any | null>(null);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Default to the OPEN period; failing that, the newest one we know about.
  useEffect(() => {
    if (periodId !== null || salaryPeriods.length === 0) return;
    const open = salaryPeriods.find((p) => p.status === 'OPEN');
    const newest = [...salaryPeriods].sort((a, b) => b.fromDate.localeCompare(a.fromDate))[0];
    setPeriodId(open?.id ?? newest?.id ?? null);
  }, [salaryPeriods, periodId]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    const dash = payrollAdminApi.dashboard(periodId ?? undefined);
    const comp = periodId ? payrollAdminApi.compliance(periodId) : Promise.resolve(null);

    Promise.all([
      dash.catch((err: any) => {
        throw err;
      }),
      comp.catch(() => null),
      payrollAdminApi.costAnalytics({}).catch(() => null),
      payrollAdminApi.pendingApprovals().catch(() => []),
    ])
      .then(([d, c, k, a]) => {
        setDashboard(d ?? null);
        setCompliance(c ?? null);
        setCost(k ?? null);
        setApprovals(Array.isArray(a) ? a : []);
      })
      .catch((err: any) => setError(err?.message ?? 'Could not load the payroll dashboard'))
      .finally(() => setLoading(false));
  }, [periodId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !dashboard) return <LoadingBlock label="Loading payroll dashboard…" />;

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

  const d = dashboard ?? {};
  const statutory = d.statutory ?? {};
  const bank = d.bankTransfer ?? {};
  const latestRun = d.latestRun ?? null;

  const kpis: KpiCard[] = [
    { key: 'cost', label: 'Total payroll cost', value: money(d.totalPayrollCost), intent: 'info' },
    { key: 'processed', label: 'Employees processed', value: count(d.employeesProcessed) },
    { key: 'net', label: 'Net paid', value: money(d.totalNet), intent: 'success' },
    {
      key: 'approvals',
      label: 'Pending approvals',
      value: count(d.pendingApprovals),
      intent: num(d.pendingApprovals) ? 'warning' : 'default',
    },
    { key: 'bonus', label: 'Bonus paid', value: money(d.bonusPaid) },
    {
      key: 'ot',
      label: 'Overtime cost',
      value: money(d.overtimeCost),
      comparisonLabel: num(d.overtimeHours) === null ? null : `${num(d.overtimeHours)} h`,
    },
    { key: 'tax', label: 'Tax liability', value: money(d.taxLiability) },
    {
      key: 'errors',
      label: 'Payroll errors',
      value: count(d.payrollErrors),
      intent: num(d.payrollErrors) ? 'danger' : 'default',
    },
  ];

  const trend: any[] = Array.isArray(cost?.monthlyTrend) ? cost.monthlyTrend : [];
  const chartData = trend.slice(-8).map((t: any) => ({
    label: String(t?.periodLabel ?? ''),
    gross: num(t?.gross) ?? 0,
    deductions: num(t?.deductions) ?? 0,
    net: num(t?.net) ?? 0,
  }));

  const missing = compliance?.missingData ?? {};
  const compTotals = compliance?.totals ?? {};
  const complianceUnavailable = unavailableReason(compliance);

  const selectedPeriod = salaryPeriods.find((p) => p.id === periodId) ?? null;

  return (
    <div className="space-y-5">
      {/* Period pills ------------------------------------------------------ */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {salaryPeriods.length === 0 && (
            <span className="text-text-muted text-xs">No salary periods configured yet</span>
          )}
          {salaryPeriods.map((p) => {
            const active = p.id === periodId;
            return (
              <button
                key={p.id}
                onClick={() => setPeriodId(p.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                  active
                    ? 'bg-primary-light border-primary/30 text-primary'
                    : 'border-border-default text-text-muted hover:border-text-muted'
                }`}
              >
                {p.label}
              </button>
            );
          })}
          {selectedPeriod && <Chip label={selectedPeriod.status} tone={periodTone(selectedPeriod.status)} dot />}
        </div>

        <button onClick={load} className={BTN_SECONDARY} disabled={loading}>
          <RefreshCw size={14} className={`inline mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* KPI row ----------------------------------------------------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <KpiTile key={kpi.key} kpi={kpi} />
        ))}
      </div>

      {/* Widgets ----------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WidgetCard
          title="Latest payroll run"
          subtitle={d.period?.label ?? selectedPeriod?.label ?? null}
          actions={
            <button
              onClick={() => onSectionChange('runs')}
              className="text-primary text-xs font-medium hover:underline inline-flex items-center gap-1"
            >
              Go to runs <ArrowRight size={14} />
            </button>
          }
        >
          {!latestRun ? (
            <WidgetEmpty message="No payroll run for this period yet" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Chip label={String(latestRun.runType ?? 'RUN')} tone="primary" />
                <Chip label={String(latestRun.status ?? 'UNKNOWN')} tone={runTone(latestRun.status)} dot />
                {latestRun.isSimulation && <Chip label="Simulation" tone="warning" />}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-text-muted text-[11px] uppercase tracking-wider">Processed</dt>
                  <dd className="text-text-primary tabular-nums">
                    {count(latestRun.processedEmployees)} / {count(latestRun.totalEmployees)}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted text-[11px] uppercase tracking-wider">Failed</dt>
                  <dd className={`tabular-nums ${num(latestRun.failedEmployees) ? 'text-danger' : 'text-text-primary'}`}>
                    {count(latestRun.failedEmployees)}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted text-[11px] uppercase tracking-wider">Duration</dt>
                  <dd className="text-text-primary tabular-nums">{duration(latestRun.durationMs)}</dd>
                </div>
                <div>
                  <dt className="text-text-muted text-[11px] uppercase tracking-wider">Started</dt>
                  <dd className="text-text-primary">{timeAgo(latestRun.startedAt)}</dd>
                </div>
              </dl>
              {latestRun.errorMessage && (
                <p className="text-danger text-xs flex items-start gap-1.5">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  {String(latestRun.errorMessage)}
                </p>
              )}
            </div>
          )}
        </WidgetCard>

        <WidgetCard
          title="Compliance status"
          subtitle={compliance?.readyToFile === true ? 'Ready to file' : 'Statutory position for this period'}
          actions={
            <button
              onClick={() => onNavigate('hrprofile')}
              className="text-primary text-xs font-medium hover:underline inline-flex items-center gap-1"
            >
              Fix in Employee Profile <ArrowRight size={14} />
            </button>
          }
        >
          {complianceUnavailable !== null ? (
            <WidgetUnavailable reason={complianceUnavailable} />
          ) : !compliance ? (
            <WidgetEmpty message="No compliance data for this period" />
          ) : (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-text-muted text-[11px] uppercase tracking-wider">Provident fund</dt>
                  <dd className="text-text-primary tabular-nums">{money(compTotals.pfTotal ?? statutory.pf)}</dd>
                </div>
                <div>
                  <dt className="text-text-muted text-[11px] uppercase tracking-wider">ESI</dt>
                  <dd className="text-text-primary tabular-nums">{money(compTotals.esiTotal ?? statutory.esi)}</dd>
                </div>
                <div>
                  <dt className="text-text-muted text-[11px] uppercase tracking-wider">Professional tax</dt>
                  <dd className="text-text-primary tabular-nums">
                    {money(compTotals.professionalTax ?? statutory.pt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted text-[11px] uppercase tracking-wider">TDS</dt>
                  <dd className="text-text-primary tabular-nums">{money(compTotals.tds ?? statutory.tds)}</dd>
                </div>
              </dl>

              <div className="pt-3 border-t border-border-light grid grid-cols-2 gap-2">
                {[
                  { label: 'Missing UAN', value: missing.missingUan },
                  { label: 'Missing ESIC', value: missing.missingEsic },
                  { label: 'Missing PAN', value: missing.missingPan },
                  { label: 'Missing bank', value: missing.missingBank },
                ].map((row) => {
                  const n = num(row.value);
                  return (
                    <div key={row.label} className="flex items-center justify-between gap-2">
                      <span className="text-text-secondary text-xs">{row.label}</span>
                      <span
                        className={`text-sm font-semibold tabular-nums ${n ? 'text-danger' : 'text-text-muted'}`}
                      >
                        {count(row.value)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {Array.isArray(compliance.filingBlockers) && compliance.filingBlockers.length > 0 && (
                <ul className="pt-2 space-y-1">
                  {compliance.filingBlockers.map((b: string, i: number) => (
                    <li key={i} className="text-danger text-xs flex items-start gap-1.5">
                      <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                      {b}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </WidgetCard>

        <WidgetCard
          title="Bank transfer status"
          subtitle={num(bank.batches) === null ? null : `${count(bank.batches)} batch(es)`}
          actions={
            <button
              onClick={() => onSectionChange('bank')}
              className="text-primary text-xs font-medium hover:underline inline-flex items-center gap-1"
            >
              Open transfers <ArrowRight size={14} />
            </button>
          }
        >
          {!d.bankTransfer ? (
            <WidgetEmpty message="No disbursement data yet" />
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Paid', value: bank.paid, tone: 'text-success' },
                { label: 'Queued', value: bank.queued, tone: 'text-info' },
                { label: 'Unpaid', value: bank.unpaid, tone: 'text-text-primary' },
                { label: 'Failed', value: bank.failed, tone: 'text-danger' },
                { label: 'On hold', value: bank.onHold, tone: 'text-warning' },
                { label: 'Batches', value: bank.batches, tone: 'text-text-secondary' },
              ].map((row) => (
                <div key={row.label} className="bg-bg-secondary rounded-md px-3 py-2">
                  <p className="text-text-muted text-[10px] uppercase tracking-wider">{row.label}</p>
                  <p className={`text-lg font-semibold tabular-nums ${row.tone}`}>{count(row.value)}</p>
                </div>
              ))}
            </div>
          )}
        </WidgetCard>

        <WidgetCard
          title="Pending approvals"
          subtitle={`${approvals.length} waiting`}
          actions={
            <button
              onClick={() => onSectionChange('approvals')}
              className="text-primary text-xs font-medium hover:underline inline-flex items-center gap-1"
            >
              Review <ArrowRight size={14} />
            </button>
          }
        >
          {approvals.length === 0 ? (
            <WidgetEmpty message="Nothing waiting on an approver" />
          ) : (
            <ul className="divide-y divide-border-light -my-1">
              {approvals.slice(0, 6).map((a: any) => (
                <li key={a?.id ?? Math.random()} className="py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-text-primary text-sm truncate">{String(a?.title ?? 'Approval request')}</p>
                    <p className="text-text-muted text-[11px]">
                      {String(a?.entityType ?? '—')} · step {count(a?.currentStep)} · {timeAgo(a?.createdAt)}
                    </p>
                  </div>
                  <span className="text-text-secondary text-sm tabular-nums flex-shrink-0">{money(a?.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>
      </div>

      {/* Cost split -------------------------------------------------------- */}
      <WidgetCard title="Cost split by period" subtitle="Gross, deductions and net across recent periods">
        {chartData.length === 0 ? (
          <WidgetEmpty message="No period cost history yet" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--color-border-light)" vertical={false} />
              <XAxis dataKey="label" tick={CHART_AXIS} stroke="var(--color-text-muted)" />
              <YAxis tick={CHART_AXIS} stroke="var(--color-text-muted)" width={64} />
              <Tooltip
                formatter={(value: any) => inr(Number(value))}
                contentStyle={{
                  background: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border-default)',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="gross" name="Gross" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="deductions" name="Deductions" fill="var(--color-danger)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="net" name="Net" fill="var(--color-success)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </WidgetCard>
    </div>
  );
}
