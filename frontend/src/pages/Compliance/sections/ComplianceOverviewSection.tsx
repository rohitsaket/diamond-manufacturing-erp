import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { complianceApi, financialYearOf, statutoryApi } from '../../../api/compliance';
import {
  BTN_SECONDARY,
  Chip,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
  inr,
} from '../../../components/common/HrmsUI';
import { KpiTile } from '../../HRDashboard/KpiTile';
import { WidgetCard, WidgetEmpty, WidgetUnavailable } from '../../HRDashboard/WidgetCard';
import type { KpiCard } from '../../../types/hrms';

// ---------------------------------------------------------------------------
// Local helpers (no date-fns in this project)
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : inr(n);
}

function countText(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : String(n);
}

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? '—' : s;
}

function fmtDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

/** Financial year options around the current one, newest first. */
function fyOptions(): string[] {
  const current = financialYearOf();
  const start = Number(current.slice(0, 4));
  const years: string[] = [];
  for (let offset = 1; offset >= -3; offset -= 1) {
    const y = start + offset;
    years.push(`${y}-${y + 1}`);
  }
  return years;
}

function gradeTone(grade: unknown): Tone {
  switch (String(grade ?? '').toUpperCase()) {
    case 'A':
      return 'success';
    case 'B':
      return 'info';
    case 'C':
      return 'warning';
    case 'D':
      return 'danger';
    default:
      return 'default';
  }
}

function severityTone(severity: unknown): Tone {
  switch (String(severity ?? '').toUpperCase()) {
    case 'CRITICAL':
      return 'danger';
    case 'HIGH':
      return 'danger';
    case 'MEDIUM':
      return 'warning';
    case 'LOW':
      return 'info';
    default:
      return 'default';
  }
}

const SCHEME_SERIES: { key: string; label: string; colour: string }[] = [
  { key: 'pf', label: 'PF / EPS / EDLI', colour: 'var(--color-primary)' },
  { key: 'esi', label: 'ESI', colour: 'var(--color-info)' },
  { key: 'pt', label: 'PT', colour: 'var(--color-success)' },
  { key: 'lwf', label: 'LWF', colour: 'var(--color-warning)' },
  { key: 'tds', label: 'TDS', colour: 'var(--color-danger)' },
];

// ---------------------------------------------------------------------------

export function ComplianceOverviewSection({
  onNavigate,
  onSectionChange,
}: {
  onNavigate: (page: string) => void;
  onSectionChange: (section: string) => void;
}) {
  const [financialYear, setFinancialYear] = useState<string>(financialYearOf());
  const [dashboard, setDashboard] = useState<any>(null);
  const [score, setScore] = useState<any>(null);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [overdueFilings, setOverdueFilings] = useState<any[]>([]);
  const [overdueChallans, setOverdueChallans] = useState<any[]>([]);
  const [filingStatus, setFilingStatus] = useState<any>(null);
  const [trends, setTrends] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    const jobs = Promise.all([
      complianceApi.dashboard(financialYear).catch((err) => {
        throw err;
      }),
      complianceApi.score(financialYear).catch(() => null),
      complianceApi.upcoming(30).catch(() => [] as any[]),
      complianceApi.filingStatus(financialYear).catch(() => null),
      complianceApi.contributionTrends().catch(() => null),
      // These two live on the statutory side of the API but the dashboard is
      // the only place that shows both together.
      statutoryApi.overdueFilings().catch(() => [] as any[]),
      statutoryApi.overdueChallans().catch(() => [] as any[]),
    ]);

    jobs
      .then(([dash, sc, up, fs, tr, of_, oc]) => {
        setDashboard(dash ?? null);
        setScore(sc ?? null);
        setUpcoming(Array.isArray(up) ? up : []);
        setFilingStatus(fs ?? null);
        setTrends(tr ?? null);
        setOverdueFilings(Array.isArray(of_) ? of_ : []);
        setOverdueChallans(Array.isArray(oc) ? oc : []);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [financialYear]);

  useEffect(() => {
    load();
  }, [load]);

  const contributions = (dashboard?.contributions ?? {}) as Record<string, unknown>;
  const taxLiability = (dashboard?.taxLiability ?? {}) as Record<string, unknown>;
  const findings: any[] = Array.isArray(dashboard?.openAuditFindings) ? dashboard.openAuditFindings : [];

  const kpis: KpiCard[] = useMemo(() => {
    const pfTotal = num(contributions.pf);
    const eps = num(contributions.eps);
    const edli = num(contributions.edli);
    const pfBucket =
      pfTotal === null && eps === null && edli === null ? null : (pfTotal ?? 0) + (eps ?? 0) + (edli ?? 0);

    const openFindings = findings.reduce((sum, f) => sum + (num(f?.count) ?? 0), 0);

    return [
      {
        key: 'liability',
        label: 'Total tax liability',
        value: money(taxLiability.totalAnnualTax),
        comparisonLabel:
          num(taxLiability.employeesComputed) === null
            ? null
            : `${taxLiability.employeesComputed} employees computed`,
        intent: 'default',
      },
      {
        key: 'pf',
        label: 'PF contributions',
        value: pfBucket === null ? '—' : inr(pfBucket),
        comparisonLabel: 'PF + EPS + EDLI',
        intent: 'info',
      },
      {
        key: 'esi',
        label: 'ESI contributions',
        value: money(contributions.esi),
        intent: 'info',
      },
      {
        key: 'pt',
        label: 'Professional tax',
        value: money(contributions.pt),
        intent: 'info',
      },
      {
        key: 'tds',
        label: 'TDS',
        value: money(contributions.tds),
        comparisonLabel:
          num(taxLiability.tdsDeductedToDate) === null
            ? null
            : `${money(taxLiability.tdsDeductedToDate)} deducted to date`,
        intent: 'default',
      },
      {
        key: 'proofs',
        label: 'Pending investment proofs',
        value: countText(dashboard?.pendingInvestmentProofs),
        intent: (num(dashboard?.pendingInvestmentProofs) ?? 0) > 0 ? 'warning' : 'success',
      },
      {
        key: 'form16',
        label: 'Form 16 generated',
        value: countText(dashboard?.form16Generated),
        intent: 'default',
      },
      {
        key: 'findings',
        label: 'Open findings',
        value: findings.length === 0 ? '—' : String(openFindings),
        intent: openFindings > 0 ? 'danger' : 'success',
      },
    ];
  }, [contributions, taxLiability, dashboard, findings]);

  const trendData = useMemo(() => {
    const months: any[] = Array.isArray(trends?.months) ? trends.months : [];
    return months.map((m) => ({
      monthKey: String(m?.monthKey ?? ''),
      pf: num(m?.pf) ?? 0,
      esi: num(m?.esi) ?? 0,
      pt: num(m?.pt) ?? 0,
      lwf: num(m?.lwf) ?? 0,
      tds: num(m?.tds) ?? 0,
    }));
  }, [trends]);

  const trendHasValues = trendData.some((d) => d.pf + d.esi + d.pt + d.lwf + d.tds > 0);

  if (firstLoad && loading) return <LoadingBlock label="Loading the compliance dashboard…" />;

  return (
    <div className="space-y-4">
      {/* Controls ---------------------------------------------------------- */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="w-48">
          <label className={LABEL_CLS} htmlFor="overview-fy">
            Financial year
          </label>
          <select
            id="overview-fy"
            className={INPUT_CLS}
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
        <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
          <span className="inline-flex items-center gap-2">
            <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
            Refresh
          </span>
        </button>
      </div>

      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {/* Source note ------------------------------------------------------- */}
      {typeof contributions.source === 'string' && (
        <p className="text-text-muted text-[11px]">Contribution figures sourced from {String(contributions.source)}.</p>
      )}

      {/* KPI row ----------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((kpi) => (
          <KpiTile
            key={kpi.key}
            kpi={kpi}
            onClick={
              kpi.key === 'proofs'
                ? () => onSectionChange('proofs')
                : kpi.key === 'form16'
                  ? () => onSectionChange('form16')
                  : kpi.key === 'findings'
                    ? () => onSectionChange('audit')
                    : kpi.key === 'tds'
                      ? () => onSectionChange('filings')
                      : () => onSectionChange('contributions')
            }
          />
        ))}
      </div>

      {/* Compliance score -------------------------------------------------- */}
      <div className="bg-bg-card border border-border-default rounded-md p-5">
        {score === null ? (
          <WidgetUnavailable reason="the compliance score could not be loaded for this year" />
        ) : (
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="flex items-start gap-5">
              <div className="flex items-center justify-center w-24 h-24 rounded-full border-4 border-border-light">
                <span className="text-3xl font-semibold tabular-nums text-text-primary">
                  {num(score.score) === null ? '—' : Number(score.score).toFixed(1)}
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-text-muted" />
                  <h3 className="text-text-primary font-semibold text-sm">Compliance score</h3>
                  <Chip label={`Grade ${text(score.grade)}`} tone={gradeTone(score.grade)} dot />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Chip label={`${countText(score.passed)} passed`} tone="success" />
                  <Chip label={`${countText(score.failed)} failed`} tone="danger" />
                  <Chip label={`${countText(score.warnings)} warnings`} tone="warning" />
                  <Chip label={`${countText(score.evaluated)} evaluated`} tone="default" />
                </div>
                {typeof score?.weighting?.explanation === 'string' && (
                  <p className="text-text-secondary text-xs max-w-2xl">{score.weighting.explanation}</p>
                )}
                {typeof score?.weighting?.gradeBands === 'string' && (
                  <p className="text-text-muted text-[11px]">{score.weighting.gradeBands}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              className={BTN_SECONDARY}
              onClick={() => onSectionChange('checks')}
            >
              <span className="inline-flex items-center gap-2">
                Review checks <ArrowUpRight size={14} />
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Widgets ----------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WidgetCard
          title="Upcoming due dates"
          subtitle="Next 30 days"
          actions={
            <button
              type="button"
              className="text-primary text-xs font-medium hover:underline"
              onClick={() => onSectionChange('calendar')}
            >
              Open calendar
            </button>
          }
        >
          {upcoming.length === 0 ? (
            <WidgetEmpty message="Nothing falls due in the next 30 days" />
          ) : (
            <ul className="divide-y divide-border-light">
              {upcoming.slice(0, 8).map((entry, index) => {
                const days = num(entry?.daysToDue);
                const urgent = days !== null && days <= 3;
                return (
                  <li
                    key={entry?.id ?? index}
                    className="py-2 flex items-center justify-between gap-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-text-primary text-xs font-medium truncate">
                        {text(entry?.obligationName ?? entry?.name)}
                      </p>
                      <p className="text-text-muted text-[11px] truncate">
                        {text(entry?.obligationCode ?? entry?.obligation)} · {text(entry?.periodLabel)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-text-secondary text-[11px]">{fmtDate(entry?.dueDate)}</p>
                      <p
                        className={`text-[11px] font-medium ${urgent ? 'text-danger' : 'text-text-muted'}`}
                      >
                        {days === null ? '—' : days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </WidgetCard>

        <WidgetCard
          title="Overdue filings and challans"
          subtitle="Past their statutory due date"
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-primary text-xs font-medium hover:underline"
                onClick={() => onSectionChange('filings')}
              >
                Filings
              </button>
              <button
                type="button"
                className="text-primary text-xs font-medium hover:underline"
                onClick={() => onSectionChange('challans')}
              >
                Challans
              </button>
            </div>
          }
        >
          {overdueFilings.length === 0 && overdueChallans.length === 0 ? (
            <WidgetEmpty message="Nothing is overdue" />
          ) : (
            <div className="space-y-2">
              {overdueFilings.slice(0, 5).map((f, index) => (
                <div
                  key={`f-${f?.id ?? index}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-danger-light border border-danger/30"
                >
                  <div className="min-w-0">
                    <p className="text-danger text-xs font-medium truncate">{text(f?.filingCode)}</p>
                    <p className="text-text-secondary text-[11px] truncate">
                      {text(f?.filingType)} · {text(f?.monthKey ?? f?.financialYear)}
                    </p>
                  </div>
                  <p className="text-danger text-[11px] flex-shrink-0">{fmtDate(f?.dueDate)}</p>
                </div>
              ))}
              {overdueChallans.slice(0, 5).map((c, index) => (
                <div
                  key={`c-${c?.id ?? index}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-danger-light border border-danger/30"
                >
                  <div className="min-w-0">
                    <p className="text-danger text-xs font-mono font-medium truncate">{text(c?.challanNo)}</p>
                    <p className="text-text-secondary text-[11px] truncate">
                      {text(c?.scheme)} · {text(c?.monthKey)} · {money(c?.totalAmount)}
                    </p>
                  </div>
                  <p className="text-danger text-[11px] flex-shrink-0">{fmtDate(c?.dueDate)}</p>
                </div>
              ))}
            </div>
          )}
        </WidgetCard>

        <WidgetCard
          title="Filing status"
          subtitle={
            filingStatus?.overall
              ? `${countText(filingStatus.overall.completed)} of ${countText(filingStatus.overall.applicable)} obligations completed`
              : null
          }
        >
          {filingStatus === null ? (
            <WidgetUnavailable reason="filing status analytics did not load" />
          ) : (Array.isArray(filingStatus.obligations) ? filingStatus.obligations : []).length === 0 ? (
            <WidgetEmpty message="No obligations are scheduled for this year" />
          ) : (
            <ul className="space-y-3">
              {(filingStatus.obligations as any[]).slice(0, 8).map((o, index) => {
                const pct = Math.max(0, Math.min(100, num(o?.completionPct) ?? 0));
                const overdue = num(o?.overdue) ?? 0;
                return (
                  <li key={o?.obligationId ?? index} className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-text-primary text-xs truncate">{text(o?.name)}</p>
                      <p className="text-text-muted text-[11px] flex-shrink-0 tabular-nums">
                        {countText(o?.completed)}/{countText(o?.applicable)}
                        {overdue > 0 && <span className="text-danger ml-2">{overdue} overdue</span>}
                      </p>
                    </div>
                    <div className="h-1.5 rounded-full bg-bg-secondary overflow-hidden">
                      <div
                        className={`h-full rounded-full ${overdue > 0 ? 'bg-danger' : 'bg-primary'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </WidgetCard>

        <WidgetCard
          title="Contribution trend"
          subtitle={trends?.from && trends?.to ? `${text(trends.from)} to ${text(trends.to)}` : null}
          actions={
            <button
              type="button"
              className="text-primary text-xs font-medium hover:underline"
              onClick={() => onNavigate('payrollenterprise')}
            >
              Open payroll
            </button>
          }
        >
          {trends === null ? (
            <WidgetUnavailable reason="contribution trend analytics did not load" />
          ) : !trendHasValues ? (
            <WidgetEmpty message="No contributions have been posted in this window" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-border-light)" vertical={false} />
                <XAxis dataKey="monthKey" tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" width={56} />
                <Tooltip
                  formatter={(value: any, name: any) => [inr(Number(value) || 0), String(name)]}
                  contentStyle={{
                    background: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {SCHEME_SERIES.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} stackId="schemes" fill={s.colour} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </WidgetCard>

        <WidgetCard
          title="Open findings by severity"
          actions={
            <button
              type="button"
              className="text-primary text-xs font-medium hover:underline"
              onClick={() => onSectionChange('audit')}
            >
              Open findings
            </button>
          }
        >
          {findings.length === 0 ? (
            <WidgetEmpty message="No open audit findings" />
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {findings.map((f, index) => (
                <Chip
                  key={f?.severity ?? index}
                  label={`${text(f?.severity)} · ${countText(f?.count)}`}
                  tone={severityTone(f?.severity)}
                  dot
                />
              ))}
            </div>
          )}
        </WidgetCard>

        <WidgetCard title="Calendar status" subtitle="Entries by state for this financial year">
          {!dashboard?.complianceStatus ? (
            <WidgetUnavailable reason="the calendar has not been generated for this year" />
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {Object.entries(dashboard.complianceStatus as Record<string, unknown>).map(([key, value]) => (
                <Chip
                  key={key}
                  label={`${key.replace(/_/g, ' ')} · ${countText(value)}`}
                  tone={
                    key === 'OVERDUE'
                      ? 'danger'
                      : key === 'COMPLETED'
                        ? 'success'
                        : key === 'DUE_SOON'
                          ? 'warning'
                          : 'default'
                  }
                />
              ))}
              {(num(dashboard.overdueCount) ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1.5 text-danger text-xs">
                  <AlertTriangle size={14} />
                  {countText(dashboard.overdueCount)} overdue
                </span>
              )}
              {(num(dashboard.overdueCount) ?? 0) === 0 && (
                <span className="inline-flex items-center gap-1.5 text-text-muted text-xs">
                  <CalendarClock size={14} />
                  Nothing overdue
                </span>
              )}
            </div>
          )}
        </WidgetCard>
      </div>
    </div>
  );
}
