import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Info, RefreshCw, Sparkles } from 'lucide-react';
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
import { performanceApi } from '../../../api/performance';
import {
  BTN_SECONDARY,
  Chip,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
} from '../../../components/common/HrmsUI';
import { KpiTile } from '../../HRDashboard/KpiTile';
import { WidgetCard, WidgetEmpty, WidgetUnavailable } from '../../HRDashboard/WidgetCard';
import type { KpiCard } from '../../../types/hrms';

// ---------------------------------------------------------------------------
// Local helpers (date-fns is not installed)
// ---------------------------------------------------------------------------

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pctText(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : `${n.toFixed(1)}%`;
}

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? '—' : s;
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

const TOOLTIP_STYLE = {
  background: 'var(--color-bg-card)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 6,
  fontSize: 12,
} as const;

const QUICK_LINKS: { section: string; label: string }[] = [
  { section: 'goals', label: 'Goals & OKRs' },
  { section: 'kpis', label: 'KPIs' },
  { section: 'kras', label: 'KRAs' },
  { section: 'reviews', label: 'Reviews' },
  { section: 'appraisals', label: 'Appraisals' },
  { section: 'reports', label: 'Reports' },
];

const BASIS_LABEL: Record<string, string> = {
  appraisal_rating: 'ranked by appraisal rating',
  goal_progress: 'ranked by goal progress (no rated appraisals yet)',
};

// ---------------------------------------------------------------------------

export function PerformanceOverviewSection({
  onNavigate,
  onSectionChange,
}: {
  onNavigate: (p: string) => void;
  onSectionChange: (s: string) => void;
}) {
  void onNavigate; // reserved for cross-page links; sections navigate via onSectionChange today

  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);

  const [dashboard, setDashboard] = useState<any>(null);
  const [distribution, setDistribution] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [trends, setTrends] = useState<any>(null);
  const [attrition, setAttrition] = useState<any>(null);
  const [insights, setInsights] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cycle list once; default to the first ACTIVE cycle.
  useEffect(() => {
    performanceApi
      .cycles()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setCycles(list);
        const active = list.find((c) => String(c?.status) === 'ACTIVE') ?? list[0];
        setCycleId(active ? Number(active.id) : null);
        if (!active) {
          setLoading(false);
          setFirstLoad(false);
        }
      })
      .catch((err) => {
        setError(reason(err));
        setLoading(false);
        setFirstLoad(false);
      });
  }, []);

  const load = useCallback(() => {
    if (cycleId === null) return;
    setLoading(true);
    setError(null);

    Promise.all([
      performanceApi.dashboard(cycleId),
      performanceApi.distribution(cycleId).catch(() => null),
      performanceApi.departmentAnalytics(cycleId).catch(() => null),
      performanceApi.trends(6).catch(() => null),
      performanceApi.attrition(cycleId).catch(() => null),
      performanceApi.aiInsights().catch(() => null),
    ])
      .then(([dash, dist, dept, tr, attr, ai]) => {
        setDashboard(dash ?? null);
        setDistribution(dist ?? null);
        setDepartments(Array.isArray(dept) ? dept : []);
        setTrends(tr ?? null);
        setAttrition(attr ?? null);
        setInsights(ai ?? null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [cycleId]);

  useEffect(() => {
    load();
  }, [load]);

  // --- KPI tiles -------------------------------------------------------------
  const kpis: KpiCard[] = useMemo(() => {
    const gc = (dashboard?.goalCompletion ?? {}) as Record<string, unknown>;
    const ka = (dashboard?.kpiAchievement ?? {}) as Record<string, unknown>;
    const ks = (dashboard?.kraStatus ?? {}) as Record<string, unknown>;
    const okr = (dashboard?.okr ?? {}) as Record<string, unknown>;
    const rp = (dashboard?.reviewProgress ?? {}) as Record<string, unknown>;
    const ap = (dashboard?.appraisals ?? {}) as Record<string, unknown>;

    const goalTotal = num(gc.total) ?? 0;
    const goalDone = num(gc.completed) ?? 0;
    const completionPct = goalTotal === 0 ? null : (goalDone / goalTotal) * 100;

    const reviewTotal =
      (num(rp.requested) ?? 0) +
      (num(rp.inProgress) ?? 0) +
      (num(rp.submitted) ?? 0) +
      (num(rp.acknowledged) ?? 0) +
      (num(rp.declined) ?? 0);
    const reviewDone = (num(rp.submitted) ?? 0) + (num(rp.acknowledged) ?? 0);

    const appraisalTotal = Object.values(ap).reduce<number>((s, v) => s + (num(v) ?? 0), 0);
    const appraisalFinal =
      (num(ap.finalized) ?? 0) + (num(ap.letterIssued) ?? 0) + (num(ap.acknowledged) ?? 0);

    return [
      {
        key: 'completion',
        label: 'Goal completion',
        value: completionPct === null ? '—' : `${completionPct.toFixed(0)}%`,
        comparisonLabel: goalTotal === 0 ? 'no goals in this cycle' : `${goalDone} of ${goalTotal} goals completed`,
        intent: completionPct !== null && completionPct >= 75 ? 'success' : 'default',
      },
      {
        key: 'progress',
        label: 'Avg goal progress',
        value: pctText(gc.avgProgressPct),
        comparisonLabel: `${num(gc.active) ?? 0} active · ${num(gc.pendingApproval) ?? 0} pending approval`,
        intent: 'info',
      },
      {
        key: 'kpi',
        label: 'KPI achievement avg',
        value: pctText(ka.avgAchievementPct),
        comparisonLabel: `${num(ka.computed) ?? 0} of ${num(ka.assignments) ?? 0} assignments computed`,
        intent: (num(ka.avgAchievementPct) ?? 0) >= 80 ? 'success' : 'default',
      },
      {
        key: 'kra',
        label: 'KRAs finalized',
        value: `${num(ks.finalized) ?? 0}/${num(ks.assigned) ?? 0}`,
        comparisonLabel: `${num(ks.selfScored) ?? 0} self-scored · ${num(ks.reviewed) ?? 0} reviewed`,
        intent: 'default',
      },
      {
        key: 'reviews',
        label: 'Review progress',
        value: reviewTotal === 0 ? '—' : `${reviewDone}/${reviewTotal}`,
        comparisonLabel: reviewTotal === 0 ? 'no reviews launched in this cycle' : 'submitted or acknowledged / total',
        intent: 'default',
      },
      {
        key: 'appraisals',
        label: 'Appraisals finalized',
        value: appraisalTotal === 0 ? '—' : `${appraisalFinal}/${appraisalTotal}`,
        comparisonLabel: `${num(ap.pending) ?? 0} pending · ${num(ap.calibrated) ?? 0} calibrated`,
        intent: (num(ap.pending) ?? 0) > 0 ? 'warning' : 'default',
      },
      {
        key: 'okr',
        label: 'Objectives / key results',
        value: `${num(okr.objectives) ?? 0} / ${num(okr.keyResults) ?? 0}`,
        comparisonLabel: `OKR avg progress ${pctText(okr.avgProgressPct)}`,
        intent: 'info',
      },
    ];
  }, [dashboard]);

  const goalStatusData = useMemo(() => {
    const gc = (dashboard?.goalCompletion ?? {}) as Record<string, unknown>;
    return [
      { name: 'Completed', count: num(gc.completed) ?? 0 },
      { name: 'Active', count: num(gc.active) ?? 0 },
      { name: 'Pending approval', count: num(gc.pendingApproval) ?? 0 },
    ];
  }, [dashboard]);

  const distributionBuckets: any[] = Array.isArray(distribution?.buckets) ? distribution.buckets : [];
  const sampleSize = num(distribution?.sampleSize) ?? 0;

  const trendData = useMemo(() => {
    const series: any[] = Array.isArray(trends?.series) ? trends.series : [];
    return series.map((m) => ({
      month: text(m?.month),
      avgProgress: num(m?.avgReportedProgressPct),
      updates: num(m?.goalProgressUpdates) ?? 0,
      kpiValues: num(m?.kpiValuesRecorded) ?? 0,
    }));
  }, [trends]);

  const highPerformers: any[] = Array.isArray(dashboard?.highPerformers) ? dashboard.highPerformers : [];
  const lowPerformers: any[] = Array.isArray(dashboard?.lowPerformers) ? dashboard.lowPerformers : [];
  const basis = String(dashboard?.basis ?? '');
  const basisCaption = BASIS_LABEL[basis] ?? (basis ? `basis: ${basis}` : null);

  const attritionGroups: any[] = Array.isArray(attrition?.groups) ? attrition.groups : [];

  const cycleLabel = useMemo(() => {
    const c = cycles.find((x) => Number(x?.id) === cycleId);
    return c ? `${c.code} · ${c.name}` : null;
  }, [cycles, cycleId]);

  if (firstLoad && loading) return <LoadingBlock label="Loading the performance dashboard…" />;

  return (
    <div className="space-y-4">
      {/* Controls ---------------------------------------------------------- */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="w-72">
          <label className={LABEL_CLS} htmlFor="perf-ov-cycle">
            Performance cycle
          </label>
          <select
            id="perf-ov-cycle"
            className={INPUT_CLS}
            value={cycleId ?? ''}
            onChange={(e) => setCycleId(e.target.value === '' ? null : Number(e.target.value))}
          >
            {cycles.length === 0 && <option value="">No cycles</option>}
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name} ({c.status})
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {QUICK_LINKS.map((l) => (
            <button
              key={l.section}
              type="button"
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-border-default text-text-secondary hover:bg-bg-hover transition-colors inline-flex items-center gap-1"
              onClick={() => onSectionChange(l.section)}
            >
              {l.label} <ArrowUpRight size={12} />
            </button>
          ))}
          <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
            <span className="inline-flex items-center gap-2">
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
              Refresh
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {/* KPI row ----------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((kpi) => (
          <KpiTile
            key={kpi.key}
            kpi={kpi}
            onClick={
              kpi.key === 'kpi'
                ? () => onSectionChange('kpis')
                : kpi.key === 'kra'
                  ? () => onSectionChange('kras')
                  : kpi.key === 'reviews'
                    ? () => onSectionChange('reviews')
                    : kpi.key === 'appraisals'
                      ? () => onSectionChange('appraisals')
                      : () => onSectionChange('goals')
            }
          />
        ))}
      </div>

      {/* AI insights — the backend answers honestly when it cannot help. ---- */}
      {insights && insights.available === false && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-md bg-bg-card border border-border-default">
          <Sparkles size={15} className="text-text-muted flex-shrink-0 mt-0.5" />
          <p className="text-text-muted text-xs">
            AI insights — {text(insights.reason)}
          </p>
        </div>
      )}
      {insights && insights.available === true && Array.isArray(insights.insights) && (
        <WidgetCard title="AI insights" subtitle={cycleLabel}>
          <ul className="space-y-2">
            {insights.insights.map((i: any, index: number) => (
              <li key={index} className="text-text-secondary text-xs flex items-start gap-2">
                <Sparkles size={13} className="text-primary flex-shrink-0 mt-0.5" />
                {typeof i === 'string' ? i : text(i?.text ?? i?.message)}
              </li>
            ))}
          </ul>
        </WidgetCard>
      )}

      {/* Widgets ----------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WidgetCard title="Goal status breakdown" subtitle={cycleLabel}>
          {goalStatusData.every((d) => d.count === 0) ? (
            <WidgetEmpty message="No goals in this cycle yet" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={goalStatusData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-border-light)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" width={32} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" name="Goals" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </WidgetCard>

        <WidgetCard
          title="Rating distribution"
          subtitle={sampleSize > 0 ? `${sampleSize} rated appraisal(s)` : null}
        >
          {distribution === null ? (
            <WidgetUnavailable reason="the rating distribution did not load" />
          ) : sampleSize === 0 ? (
            <WidgetEmpty message="No rated appraisals in this cycle yet — there is no distribution to draw" />
          ) : (
            <div className="space-y-3">
              {distribution.smallSampleWarning === true && (
                <div className="px-3 py-2 rounded-md bg-warning-light border border-warning/30">
                  <p className="text-warning text-xs font-medium">{text(distribution.note)}</p>
                </div>
              )}
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={distributionBuckets} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--color-border-light)" vertical={false} />
                  <XAxis dataKey="range" tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" width={28} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="count" name="Employees" fill="var(--color-info)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </WidgetCard>

        <WidgetCard
          title="High / low performers"
          subtitle={basisCaption}
          actions={
            <button
              type="button"
              className="text-primary text-xs font-medium hover:underline"
              onClick={() => onSectionChange('appraisals')}
            >
              Open appraisals
            </button>
          }
        >
          {highPerformers.length === 0 && lowPerformers.length === 0 ? (
            <WidgetEmpty message="No rated employees in this cycle yet" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold mb-2">Top</p>
                <ul className="space-y-1.5">
                  {highPerformers.slice(0, 5).map((p, index) => (
                    <li key={p?.employeeId ?? index} className="flex items-center justify-between gap-2">
                      <span className="text-text-primary text-xs truncate">
                        {text(p?.employeeName)}{' '}
                        <span className="text-text-muted font-mono">{text(p?.empCode)}</span>
                      </span>
                      <Chip label={String(num(p?.value) ?? '—')} tone="success" />
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold mb-2">Bottom</p>
                <ul className="space-y-1.5">
                  {lowPerformers.slice(0, 5).map((p, index) => (
                    <li key={p?.employeeId ?? index} className="flex items-center justify-between gap-2">
                      <span className="text-text-primary text-xs truncate">
                        {text(p?.employeeName)}{' '}
                        <span className="text-text-muted font-mono">{text(p?.empCode)}</span>
                      </span>
                      <Chip label={String(num(p?.value) ?? '—')} tone="warning" />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </WidgetCard>

        <WidgetCard title="Progress trend" subtitle="Goal updates and KPI values by month">
          {trends === null ? (
            <WidgetUnavailable reason="trend analytics did not load" />
          ) : trendData.length === 0 ? (
            <WidgetEmpty message="No activity in this window" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-border-light)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" width={32} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="avgProgress"
                  name="Avg reported progress %"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="updates"
                  name="Progress updates"
                  stroke="var(--color-success)"
                  strokeWidth={1.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="kpiValues"
                  name="KPI values recorded"
                  stroke="var(--color-warning)"
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </WidgetCard>

        <WidgetCard
          title="Department analytics"
          className="lg:col-span-2"
          subtitle="Goal progress and KPI achievement by department"
        >
          {departments.length === 0 ? (
            <WidgetEmpty message="No department analytics for this cycle" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    {['Department', 'Employees with goals', 'Goals', 'Avg goal progress', 'KPI assignments', 'Avg KPI achievement'].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {departments.map((d, index) => (
                    <tr key={d?.departmentId ?? index} className="hover:bg-bg-hover transition-colors">
                      <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                        {text(d?.departmentName)}
                      </td>
                      <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                        {num(d?.headcountWithGoals) ?? 0}
                      </td>
                      <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                        {num(d?.goalCount) ?? 0}
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {num(d?.avgGoalProgress) === null ? (
                          <span className="text-text-muted italic">
                            — {d?.avgGoalProgressNote ? `(${text(d.avgGoalProgressNote)})` : ''}
                          </span>
                        ) : (
                          <span className="text-text-primary font-mono">{pctText(d.avgGoalProgress)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                        {num(d?.kpiAssignments) ?? 0}
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {num(d?.avgKpiAchievement) === null ? (
                          <span className="text-text-muted italic">
                            — {d?.avgKpiAchievementNote ? `(${text(d.avgKpiAchievementNote)})` : ''}
                          </span>
                        ) : (
                          <span className="text-text-primary font-mono">{pctText(d.avgKpiAchievement)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </WidgetCard>

        <WidgetCard title="Rating vs attrition" subtitle={attrition?.note ? text(attrition.note) : null}>
          {attrition === null ? (
            <WidgetUnavailable reason="attrition analytics did not load" />
          ) : attrition.available === false ? (
            <div className="flex items-start gap-2 py-6 text-text-muted">
              <Info size={16} className="flex-shrink-0 mt-0.5" />
              <p className="text-xs italic">{text(attrition.reason)}</p>
            </div>
          ) : attritionGroups.length === 0 ? (
            <WidgetEmpty message="No rated employees to group" />
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={attritionGroups} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-border-light)" vertical={false} />
                <XAxis dataKey="ratingBand" tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" width={28} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="working" name="Working" stackId="a" fill="var(--color-success)" />
                <Bar dataKey="resigned" name="Resigned" stackId="a" fill="var(--color-danger)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </WidgetCard>
      </div>
    </div>
  );
}
