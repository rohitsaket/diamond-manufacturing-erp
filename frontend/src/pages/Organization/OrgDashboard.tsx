import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import { RefreshCw, Download, ArrowRight, Info, TrendingUp, Gauge } from 'lucide-react';
import { orgApi } from '../../api/organization';
import type { OrgDashboard as OrgDashboardPayload } from '../../types/organization';
import {
  StatCard,
  Chip,
  TableShell,
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  BTN_PRIMARY,
  BTN_SECONDARY,
  inr,
} from '../../components/common/HrmsUI';
import { errMsg } from './orgUi';

// ---------------------------------------------------------------------------
// Defensive readers — every key on the payload may be missing.
// ---------------------------------------------------------------------------
function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

const TOOLTIP_STYLE = {
  background: 'var(--color-bg-card)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 6,
  fontSize: 11,
  color: 'var(--color-text-primary)',
} as const;

const AXIS = { fontSize: 11, fill: 'var(--color-text-muted)' } as const;
const LEGEND_STYLE = { fontSize: 11, color: 'var(--color-text-secondary)' } as const;

function Card({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-text-primary text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-text-muted text-[11px] mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

const GROUP_BY_OPTIONS = [
  { value: 'department', label: 'Department' },
  { value: 'branch', label: 'Branch' },
  { value: 'region', label: 'Region' },
  { value: 'company', label: 'Company' },
  { value: 'division', label: 'Division' },
  { value: 'business_unit', label: 'Business unit' },
  { value: 'grade', label: 'Job grade' },
  { value: 'employment_type', label: 'Employment type' },
  { value: 'position', label: 'Position' },
];

interface WorkforceRow {
  key: string;
  label: string;
  headcount: number;
  planned: number | null;
  vacancies: number;
}

function downloadCsv(filename: string, header: string[], rows: (string | number)[][]): void {
  try {
    const esc = (cell: string | number) => `"${String(cell ?? '').replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(esc).join(',')).join('\r\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err: unknown) {
    window.alert(errMsg(err, 'CSV export failed'));
  }
}

export function OrgDashboard({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [data, setData] = useState<OrgDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [groupBy, setGroupBy] = useState('department');
  const [workforce, setWorkforce] = useState<WorkforceRow[]>([]);
  const [wfLoading, setWfLoading] = useState(false);
  const [wfError, setWfError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    orgApi
      .dashboard()
      .then((res) => setData(res ?? null))
      .catch((err: unknown) => {
        setError(errMsg(err, 'Failed to load organization analytics'));
        setData(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const loadWorkforce = useCallback((by: string) => {
    setWfLoading(true);
    setWfError(null);
    orgApi
      .workforce({ groupBy: by })
      .then((res) => setWorkforce(asArray<WorkforceRow>(res?.rows)))
      .catch((err: unknown) => {
        setWfError(errMsg(err, 'Failed to load the workforce breakdown'));
        setWorkforce([]);
      })
      .finally(() => setWfLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadWorkforce(groupBy);
  }, [groupBy, loadWorkforce]);

  const totals = data?.totals;
  const health = data?.healthScore;
  const factors = asArray<{ label: string; value: number; weight: number; detail: string }>(health?.factors);

  const byDepartment = useMemo(
    () =>
      asArray<{ name: string; headcount: number; planned: number | null; vacancies: number }>(
        data?.headcountByDepartment,
      ).map((r) => ({
        name: String(r?.name ?? '—'),
        headcount: num(r?.headcount),
        planned: num(r?.planned),
        vacancies: num(r?.vacancies),
      })),
    [data],
  );

  const growth = useMemo(
    () =>
      asArray<{ month: string; joined: number; resigned: number; net: number }>(data?.workforceGrowth).map((r) => ({
        month: String(r?.month ?? ''),
        joined: num(r?.joined),
        resigned: num(r?.resigned),
        net: num(r?.net),
      })),
    [data],
  );

  const byBranch = useMemo(
    () =>
      asArray<{ name: string; headcount: number }>(data?.headcountByBranch).map((r) => ({
        name: String(r?.name ?? '—'),
        headcount: num(r?.headcount),
      })),
    [data],
  );

  const byRegion = useMemo(
    () =>
      asArray<{ name: string; headcount: number }>(data?.headcountByRegion).map((r) => ({
        name: String(r?.name ?? '—'),
        headcount: num(r?.headcount),
      })),
    [data],
  );

  const spans = useMemo(
    () =>
      asArray<{ managerName: string; directReports: number }>(data?.spanOfControl)
        .map((r) => ({ managerName: String(r?.managerName ?? '—'), directReports: num(r?.directReports) }))
        .sort((a, b) => b.directReports - a.directReports),
    [data],
  );

  const maxSpan = spans.reduce((m, s) => Math.max(m, s.directReports), 0);

  const budget = useMemo(
    () =>
      asArray<{ name: string; budget: number; committed: number; pct: number }>(data?.budgetUtilisation).map((r) => ({
        name: String(r?.name ?? '—'),
        budget: num(r?.budget),
        committed: num(r?.committed),
        pct: num(r?.pct),
      })),
    [data],
  );

  const score = num(health?.score);
  const scoreTone = score >= 80 ? 'success' : score >= 60 ? 'warning' : 'danger';
  const scoreColor =
    scoreTone === 'success' ? 'var(--color-success)' : scoreTone === 'warning' ? 'var(--color-warning)' : 'var(--color-danger)';
  const scoreText = scoreTone === 'success' ? 'text-success' : scoreTone === 'warning' ? 'text-warning' : 'text-danger';

  const RING = 2 * Math.PI * 44;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-text-primary text-base font-semibold">Organization analytics</h3>
          <p className="text-text-secondary text-xs mt-0.5">Structure totals · health · headcount · budget</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className={BTN_SECONDARY} onClick={() => onNavigate('hrprofile')}>
            <span className="inline-flex items-center gap-1.5">
              People <ArrowRight size={14} />
            </span>
          </button>
          <button className={BTN_PRIMARY} onClick={load} disabled={loading}>
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </span>
          </button>
        </div>
      </div>

      {error && <ErrorBlock message={error} />}

      {loading && !data ? (
        <LoadingBlock label="Loading organization analytics…" />
      ) : !data ? (
        <EmptyBlock message="No analytics available" hint="The organization dashboard endpoint returned nothing." />
      ) : (
        <>
          {/* Totals ------------------------------------------------------- */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <StatCard label="Companies" value={num(totals?.companies)} />
            <StatCard label="Legal entities" value={num(totals?.legalEntities)} />
            <StatCard label="Business units" value={num(totals?.businessUnits)} />
            <StatCard label="Divisions" value={num(totals?.divisions)} />
            <StatCard label="Departments" value={num(totals?.departments)} />
            <StatCard label="Branches" value={num(totals?.branches)} />
            <StatCard label="Locations" value={num(totals?.locations)} />
            <StatCard label="Teams" value={num(totals?.teams)} />
            <StatCard label="Cost centres" value={num(totals?.costCenters)} />
            <StatCard label="Positions" value={num(totals?.positions)} />
            <StatCard label="Employees" value={num(totals?.employees)} intent="info" />
            <StatCard
              label="Vacant seats"
              value={num(totals?.vacantSeats)}
              intent={num(totals?.vacantSeats) > 0 ? 'warning' : 'default'}
            />
          </div>

          {/* Health score ------------------------------------------------- */}
          <div className="bg-bg-card border border-border-default rounded-md p-5">
            <div className="flex items-start gap-6 flex-wrap">
              <div className="relative flex-shrink-0">
                <svg width={112} height={112} viewBox="0 0 112 112" role="img" aria-label={`Health score ${score} of 100`}>
                  <circle cx={56} cy={56} r={44} fill="none" stroke="var(--color-border-default)" strokeWidth={10} />
                  <circle
                    cx={56}
                    cy={56}
                    r={44}
                    fill="none"
                    stroke={scoreColor}
                    strokeWidth={10}
                    strokeLinecap="round"
                    strokeDasharray={RING}
                    strokeDashoffset={RING * (1 - Math.max(0, Math.min(100, score)) / 100)}
                    transform="rotate(-90 56 56)"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-2xl font-semibold tabular-nums ${scoreText}`}>{Math.round(score)}</span>
                  <span className="text-[10px] text-text-muted">/ 100</span>
                </div>
              </div>

              <div className="flex-1 min-w-[240px]">
                <div className="flex items-center gap-2">
                  <Gauge size={16} className="text-text-muted" />
                  <h3 className="text-text-primary font-semibold">Organization health score</h3>
                  <Chip
                    label={scoreTone === 'success' ? 'Healthy' : scoreTone === 'warning' ? 'Needs attention' : 'At risk'}
                    tone={scoreTone}
                    dot
                  />
                </div>
                <p className="text-text-secondary text-xs mt-1">
                  A weighted roll-up of the factors below. Each factor contributes its value in proportion to its
                  weight — nothing here is hidden.
                </p>
                <div className="mt-3 h-2 rounded-full bg-bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: scoreColor }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-4">
              {factors.length === 0 ? (
                <EmptyBlock message="No score factors returned" hint="The score cannot be explained without factors." />
              ) : (
                <TableShell headers={['Factor', 'Value', 'Weight', 'What it measures']}>
                  {factors.map((f, i) => (
                    <tr key={`${f?.label ?? 'factor'}-${i}`} className="hover:bg-bg-hover">
                      <td className="px-3 py-2 text-sm text-text-primary">{f?.label ?? '—'}</td>
                      <td className="px-3 py-2 text-sm text-text-primary tabular-nums">{num(f?.value)}</td>
                      <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">{num(f?.weight)}</td>
                      <td className="px-3 py-2 text-xs text-text-muted">{f?.detail ?? '—'}</td>
                    </tr>
                  ))}
                </TableShell>
              )}
            </div>
          </div>

          {/* Headcount by department + workforce growth ------------------- */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Headcount by department" subtitle="Actual against planned — the gap is the vacancy">
              {byDepartment.length === 0 ? (
                <EmptyBlock message="No department headcount" />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(220, byDepartment.length * 34 + 40)}>
                  <BarChart data={byDepartment} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" horizontal={false} />
                    <XAxis type="number" tick={AXIS} stroke="var(--color-text-muted)" allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={AXIS}
                      stroke="var(--color-text-muted)"
                      width={130}
                      interval={0}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-bg-hover)' }} />
                    <Legend wrapperStyle={LEGEND_STYLE} />
                    <Bar dataKey="headcount" name="Headcount" fill="var(--color-primary)" radius={[0, 3, 3, 0]} />
                    <Bar dataKey="planned" name="Planned" fill="var(--color-text-muted)" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Workforce growth" subtitle="Joiners, leavers and the net movement per month">
              {growth.length === 0 ? (
                <EmptyBlock message="No workforce movement recorded" />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={growth} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
                    <XAxis dataKey="month" tick={AXIS} stroke="var(--color-text-muted)" />
                    <YAxis tick={AXIS} stroke="var(--color-text-muted)" allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={LEGEND_STYLE} />
                    <Area
                      type="monotone"
                      dataKey="joined"
                      name="Joined"
                      stroke="var(--color-success)"
                      fill="var(--color-success)"
                      fillOpacity={0.14}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="resigned"
                      name="Resigned"
                      stroke="var(--color-danger)"
                      fill="var(--color-danger)"
                      fillOpacity={0.14}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="net"
                      name="Net"
                      stroke="var(--color-primary)"
                      fill="var(--color-primary)"
                      fillOpacity={0.08}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {/* Branch + region ---------------------------------------------- */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Headcount by branch">
              {byBranch.length === 0 ? (
                <EmptyBlock message="No branch headcount" />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(200, byBranch.length * 30 + 36)}>
                  <BarChart data={byBranch} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" horizontal={false} />
                    <XAxis type="number" tick={AXIS} stroke="var(--color-text-muted)" allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={AXIS}
                      stroke="var(--color-text-muted)"
                      width={130}
                      interval={0}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-bg-hover)' }} />
                    <Bar dataKey="headcount" name="Headcount" fill="var(--color-info)" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Headcount by region">
              {byRegion.length === 0 ? (
                <EmptyBlock message="No region headcount" />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(200, byRegion.length * 30 + 36)}>
                  <BarChart data={byRegion} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" horizontal={false} />
                    <XAxis type="number" tick={AXIS} stroke="var(--color-text-muted)" allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={AXIS}
                      stroke="var(--color-text-muted)"
                      width={130}
                      interval={0}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-bg-hover)' }} />
                    <Bar dataKey="headcount" name="Headcount" fill="var(--color-primary)" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {/* Span of control ---------------------------------------------- */}
          <Card
            title="Span of control"
            subtitle="Direct reports per manager — above 10 is wide, 1–2 is narrow"
            actions={<TrendingUp size={16} className="text-text-muted" />}
          >
            {spans.length === 0 ? (
              <EmptyBlock message="No manager spans recorded" />
            ) : (
              <ul className="space-y-2">
                {spans.map((s, i) => {
                  const wide = s.directReports > 10;
                  const narrow = s.directReports >= 1 && s.directReports <= 2;
                  const pct = maxSpan > 0 ? (s.directReports / maxSpan) * 100 : 0;
                  return (
                    <li key={`${s.managerName}-${i}`} className="flex items-center gap-3">
                      <span className="w-44 text-sm text-text-primary truncate" title={s.managerName}>
                        {s.managerName}
                      </span>
                      <span className="flex-1 h-2 rounded-full bg-bg-secondary overflow-hidden">
                        <span
                          className={`block h-full rounded-full ${wide ? 'bg-warning' : 'bg-primary'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className="w-8 text-right text-sm text-text-primary tabular-nums">{s.directReports}</span>
                      <span className="w-20 text-right">
                        {wide ? (
                          <Chip label="Wide" tone="warning" />
                        ) : narrow ? (
                          <span className="text-[11px] text-text-muted">narrow</span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Budget utilisation ------------------------------------------- */}
          <Card title="Budget utilisation" subtitle="Committed salary cost against the allocated budget">
            {budget.length === 0 ? (
              <EmptyBlock message="No budget data" />
            ) : (
              <>
                <TableShell headers={['Cost centre / unit', 'Budget', 'Committed', 'Utilisation']}>
                  {budget.map((b, i) => {
                    const over = b.pct > 100;
                    return (
                      <tr key={`${b.name}-${i}`} className="hover:bg-bg-hover">
                        <td className="px-3 py-2 text-sm text-text-primary">{b.name}</td>
                        <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">{inr(b.budget)}</td>
                        <td className="px-3 py-2 text-sm text-text-primary tabular-nums">{inr(b.committed)}</td>
                        <td className="px-3 py-2 min-w-[180px]">
                          <div className="flex items-center gap-2">
                            <span className="flex-1 h-2 rounded-full bg-bg-secondary overflow-hidden">
                              <span
                                className={`block h-full rounded-full ${over ? 'bg-danger' : b.pct > 85 ? 'bg-warning' : 'bg-success'}`}
                                style={{ width: `${Math.max(0, Math.min(100, b.pct))}%` }}
                              />
                            </span>
                            <span
                              className={`text-xs tabular-nums w-14 text-right ${over ? 'text-danger font-medium' : 'text-text-secondary'}`}
                            >
                              {b.pct.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </TableShell>
                <p className="text-[11px] text-text-muted mt-2 flex items-start gap-1.5">
                  <Info size={12} className="mt-0.5 flex-shrink-0" />
                  Committed is estimated from fixed monthly salary only. Piece-rate labour cost is not represented in
                  this figure, so actual spend against budget will be higher wherever piece work is used.
                </p>
              </>
            )}
          </Card>

          {/* Workforce explorer ------------------------------------------- */}
          <Card
            title="Workforce explorer"
            subtitle="Headcount, planned and vacancies for any grouping"
            actions={
              <button
                className={BTN_SECONDARY}
                disabled={workforce.length === 0}
                onClick={() =>
                  downloadCsv(
                    `workforce-by-${groupBy}.csv`,
                    ['Label', 'Headcount', 'Planned', 'Vacancies'],
                    workforce.map((r) => [r.label ?? '', num(r.headcount), r.planned == null ? '' : num(r.planned), num(r.vacancies)]),
                  )
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  <Download size={14} /> Export CSV
                </span>
              </button>
            }
          >
            <div className="max-w-xs mb-3">
              <label className={LABEL_CLS} htmlFor="org-workforce-groupby">
                Group by
              </label>
              <select
                id="org-workforce-groupby"
                className={INPUT_CLS}
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
              >
                {GROUP_BY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {wfError && <ErrorBlock message={wfError} />}

            {wfLoading ? (
              <LoadingBlock label="Loading workforce breakdown…" />
            ) : workforce.length === 0 ? (
              <EmptyBlock message="No rows for this grouping" />
            ) : (
              <TableShell headers={['Label', 'Headcount', 'Planned', 'Vacancies']}>
                {workforce.map((r, i) => (
                  <tr key={`${r?.key ?? i}`} className="hover:bg-bg-hover">
                    <td className="px-3 py-2 text-sm text-text-primary">{r?.label ?? '—'}</td>
                    <td className="px-3 py-2 text-sm text-text-primary tabular-nums">{num(r?.headcount)}</td>
                    <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">
                      {r?.planned == null ? '—' : num(r.planned)}
                    </td>
                    <td
                      className={`px-3 py-2 text-sm tabular-nums ${num(r?.vacancies) > 0 ? 'text-warning font-medium' : 'text-text-secondary'}`}
                    >
                      {num(r?.vacancies)}
                    </td>
                  </tr>
                ))}
              </TableShell>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
