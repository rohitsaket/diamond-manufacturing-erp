import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, RefreshCw, Sparkles, Wallet } from 'lucide-react';
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
import { internalHiringApi } from '../../../api/internalJobs';
import {
  BTN_SECONDARY,
  Chip,
  ErrorBlock,
  LoadingBlock,
  StatCard,
  TableShell,
} from '../../../components/common/HrmsUI';
import { WidgetCard, WidgetEmpty, WidgetUnavailable } from '../../HRDashboard/WidgetCard';

// ---------------------------------------------------------------------------
// Local helpers (no date-fns in this project)
// ---------------------------------------------------------------------------

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function countText(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : String(n);
}

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? '—' : s;
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

/** Sections reachable through the quick links row. */
const QUICK_LINKS: { section: string; label: string }[] = [
  { section: 'requisitions', label: 'Requisitions' },
  { section: 'jobs', label: 'Job Postings' },
  { section: 'applications', label: 'Applications' },
  { section: 'interviews', label: 'Interviews' },
  { section: 'assessments', label: 'Assessments' },
  { section: 'offers', label: 'Offers' },
  { section: 'referrals', label: 'Referrals' },
  { section: 'talentpool', label: 'Talent Pool' },
  { section: 'reports', label: 'Reports' },
];

// ---------------------------------------------------------------------------

export function HiringOverviewSection({
  onNavigate,
  onSectionChange,
}: {
  onNavigate: (p: string) => void;
  onSectionChange: (s: string) => void;
}) {
  const [dashboard, setDashboard] = useState<any>(null);
  const [funnel, setFunnel] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [referralTrend, setReferralTrend] = useState<any>(null);
  const [costSavings, setCostSavings] = useState<any>(null);
  const [aiInsights, setAiInsights] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      internalHiringApi.dashboard().catch((err) => {
        throw err;
      }),
      internalHiringApi.funnel().catch(() => null),
      internalHiringApi.departmentAnalytics().catch(() => [] as any[]),
      internalHiringApi.referralAnalytics().catch(() => null),
      internalHiringApi.costSavings().catch(() => null),
      internalHiringApi.aiInsights().catch(() => null),
    ])
      .then(([dash, fn, dept, ref, cost, ai]) => {
        setDashboard(dash ?? null);
        setFunnel(fn ?? null);
        setDepartments(Array.isArray(dept) ? dept : []);
        setReferralTrend(ref ?? null);
        setCostSavings(cost ?? null);
        setAiInsights(ai ?? null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stages: any[] = Array.isArray(funnel?.stages) ? funnel.stages : [];
  const maxReached = useMemo(
    () => stages.reduce((m, s) => Math.max(m, num(s?.reached) ?? 0), 0),
    [stages],
  );
  const terminal = (funnel?.terminal ?? {}) as Record<string, unknown>;

  const referralMonths: any[] = Array.isArray(referralTrend?.months) ? referralTrend.months : [];
  const referralData = useMemo(
    () =>
      referralMonths.map((m) => ({
        month: String(m?.month ?? ''),
        total: num(m?.total) ?? 0,
        hired: num(m?.hired) ?? 0,
      })),
    [referralMonths],
  );

  if (firstLoad && loading) return <LoadingBlock label="Loading the hiring dashboard…" />;

  const referrals = (dashboard?.referrals ?? {}) as Record<string, unknown>;
  const avgFill = num(dashboard?.avgTimeToFillDays);
  const avgHire = num(dashboard?.avgTimeToHireDays);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
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

      {/* Stat tiles ---------------------------------------------------------- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Open jobs" value={countText(dashboard?.openJobs)} intent="info" />
        <StatCard label="Active applications" value={countText(dashboard?.activeApplications)} />
        <StatCard label="Interviews this week" value={countText(dashboard?.interviewsThisWeek)} />
        <StatCard
          label="Offers released"
          value={countText(dashboard?.offersReleased)}
          hint={`${countText(dashboard?.offersAccepted)} accepted`}
        />
        <StatCard label="Transfers effected" value={countText(dashboard?.transfersEffected)} intent="success" />
        <StatCard label="Promotions effected" value={countText(dashboard?.promotionsEffected)} intent="success" />
        <StatCard
          label="Referrals"
          value={countText(referrals.total)}
          hint={`${countText(referrals.hired)} hired`}
        />
        <StatCard label="Talent pool" value={countText(dashboard?.talentPoolSize)} />
        {/* Both averages carry an explanatory note from the API when null. */}
        <StatCard
          label="Avg time to fill"
          value={avgFill === null ? '—' : `${avgFill}d`}
          hint={avgFill === null ? text(dashboard?.avgTimeToFillNote) : null}
        />
        <StatCard
          label="Avg time to hire"
          value={avgHire === null ? '—' : `${avgHire}d`}
          hint={avgHire === null ? text(dashboard?.avgTimeToHireNote) : null}
        />
        <StatCard label="Draft jobs" value={countText(dashboard?.draftJobs)} />
      </div>

      {/* Funnel + departments ------------------------------------------------ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WidgetCard title="Hiring funnel" subtitle="Applications that reached each stage">
          {funnel === null ? (
            <WidgetUnavailable reason="funnel analytics did not load" />
          ) : stages.length === 0 ? (
            <WidgetEmpty message="No applications have entered the funnel yet" />
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                {stages.map((s, index) => {
                  const reached = num(s?.reached) ?? 0;
                  const current = num(s?.current) ?? 0;
                  const conv = num(s?.conversionPctFromPrevious);
                  const widthPct = maxReached > 0 ? (reached / maxReached) * 100 : 0;
                  return (
                    <div key={s?.stage ?? index} className="flex items-center gap-3">
                      <span className="w-28 flex-shrink-0 text-text-secondary text-[11px] uppercase tracking-wide">
                        {text(s?.stage).replace(/_/g, ' ')}
                      </span>
                      <div className="flex-1 h-4 rounded-[4px] bg-bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-[4px] bg-primary"
                          style={{ width: `${Math.max(widthPct, reached > 0 ? 3 : 0)}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-text-primary text-xs font-mono tabular-nums flex-shrink-0">
                        {reached}
                      </span>
                      <span className="w-24 text-right text-text-muted text-[11px] flex-shrink-0">
                        {conv === null ? '—' : `${conv}% from prev`}
                        {current > 0 && <span className="text-primary"> · {current} now</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Chip label={`Rejected ${countText(terminal.rejected)}`} tone="default" />
                <Chip label={`Withdrawn ${countText(terminal.withdrawn)}`} tone="default" />
                <Chip label={`Draft ${countText(terminal.draft)}`} tone="default" />
              </div>
              {typeof funnel?.note === 'string' && (
                <p className="text-text-muted text-[11px]">{funnel.note}</p>
              )}
            </div>
          )}
        </WidgetCard>

        <WidgetCard title="By department" subtitle="Jobs, applications and hires">
          {departments.length === 0 ? (
            <WidgetEmpty message="No internal jobs have been posted yet" />
          ) : (
            <TableShell headers={['Department', 'Jobs', 'Applications', 'Hires']}>
              {departments.map((d, index) => (
                <tr key={d?.department ?? index} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{text(d?.department)}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {countText(d?.jobs)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {countText(d?.applications)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-primary font-mono font-semibold text-right whitespace-nowrap">
                    {countText(d?.hires)}
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </WidgetCard>

        {/* Referral trend ---------------------------------------------------- */}
        <WidgetCard title="Referral trend" subtitle="Referrals submitted and hired per month">
          {referralTrend === null ? (
            <WidgetUnavailable reason="referral analytics did not load" />
          ) : referralData.length === 0 ? (
            <WidgetEmpty message="No referrals have been submitted yet" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={referralData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-border-light)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" width={32} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="total" name="Referrals" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="hired" name="Hired" fill="var(--color-success)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </WidgetCard>

        {/* Cost savings — the API reports honestly when it cannot compute. --- */}
        <WidgetCard
          title="Cost savings"
          actions={<Wallet size={14} className="text-text-muted" />}
        >
          {costSavings === null ? (
            <WidgetUnavailable reason="cost savings analytics did not load" />
          ) : costSavings.available === false ? (
            <WidgetUnavailable reason={text(costSavings.reason)} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(costSavings as Record<string, unknown>)
                .filter(([k]) => k !== 'available')
                .map(([k, v]) => (
                  <div key={k}>
                    <p className="text-text-muted text-[10px] uppercase tracking-wider">{k}</p>
                    <p className="text-text-primary text-xs font-medium">{text(v)}</p>
                  </div>
                ))}
            </div>
          )}
        </WidgetCard>

        {/* AI insights — honest unavailability + pointer to rule-based match. */}
        <WidgetCard title="AI insights" actions={<Sparkles size={14} className="text-text-muted" />}>
          {aiInsights === null ? (
            <WidgetUnavailable reason="AI insights did not load" />
          ) : aiInsights.available === false ? (
            <div className="space-y-2">
              <WidgetUnavailable reason={text(aiInsights.reason)} />
              {typeof aiInsights.note === 'string' && (
                <p className="text-text-secondary text-xs px-1">{aiInsights.note}</p>
              )}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {(Array.isArray(aiInsights.insights) ? aiInsights.insights : []).map(
                (i: any, index: number) => (
                  <li key={index} className="text-text-secondary text-xs">
                    {text(typeof i === 'string' ? i : (i?.text ?? i?.message))}
                  </li>
                ),
              )}
            </ul>
          )}
        </WidgetCard>
      </div>

      {/* Quick links --------------------------------------------------------- */}
      <div className="bg-bg-card border border-border-default rounded-md p-4">
        <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold mb-2">Quick links</p>
        <div className="flex items-center gap-2 flex-wrap">
          {QUICK_LINKS.map((l) => (
            <button
              key={l.section}
              type="button"
              className={BTN_SECONDARY}
              onClick={() => onSectionChange(l.section)}
            >
              <span className="inline-flex items-center gap-1.5">
                {l.label} <ArrowUpRight size={13} />
              </span>
            </button>
          ))}
          <button type="button" className={BTN_SECONDARY} onClick={() => onNavigate('hrdashboard')}>
            <span className="inline-flex items-center gap-1.5">
              HR dashboard <ArrowUpRight size={13} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
