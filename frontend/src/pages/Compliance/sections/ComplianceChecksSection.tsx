import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Cpu,
  Flag,
  Gauge,
  Hand,
  PlayCircle,
  RefreshCw,
} from 'lucide-react';
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
  TableShell,
} from '../../../components/common/HrmsUI';
import { TabBar } from '../../../components/common/TabBar';
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------
// Local helpers (date-fns is not installed)
// ---------------------------------------------------------------------------

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

function fyOptions(): string[] {
  const current = financialYearOf();
  const start = Number(current.slice(0, 4));
  return [start - 2, start - 1, start, start + 1].map((y) => `${y}-${y + 1}`);
}

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const RESULT_TONE: Record<string, Tone> = {
  PASS: 'success',
  FAIL: 'danger',
  WARNING: 'warning',
  NOT_APPLICABLE: 'default',
  MANUAL_REVIEW: 'info',
};

const RESULT_RANK: Record<string, number> = {
  FAIL: 0,
  WARNING: 1,
  MANUAL_REVIEW: 2,
  NOT_APPLICABLE: 3,
  PASS: 4,
};

const SEVERITY_TONE: Record<string, Tone> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'default',
};

const GRADE_TONE: Record<string, Tone> = { A: 'success', B: 'success', C: 'warning', D: 'danger' };

interface CheckResult {
  id: number;
  checklistItemId?: number | null;
  code?: string | null;
  title?: string | null;
  category?: string | null;
  severity?: string | null;
  ruleCode?: string | null;
  financialYear?: string | null;
  result: string;
  affectedCount?: number | null;
  detail?: string | null;
  evidence?: unknown[] | null;
  evidenceJson?: unknown[] | null;
  findingId?: number | null;
  checkedAt?: string | null;
}

interface ChecklistItem {
  id: number;
  code?: string | null;
  category?: string | null;
  title?: string | null;
  description?: string | null;
  severity?: string | null;
  ruleCode?: string | null;
  isAutomated?: boolean;
  isActive?: boolean;
  displayOrder?: number | null;
}

/** The evidence sample the backend stores is capped, so read it loosely. */
function evidenceOf(row: CheckResult): any[] {
  const raw = row.evidence ?? row.evidenceJson ?? [];
  return Array.isArray(raw) ? raw : [];
}

function evidenceLabel(sample: any): string {
  if (sample === null || sample === undefined) return '—';
  if (typeof sample === 'string' || typeof sample === 'number') return String(sample);
  const code = sample.empCode ?? sample.reference ?? null;
  const name = sample.name ?? null;
  const id = sample.employeeId ?? sample.recordId ?? null;
  if (code && name) return `${code} · ${name}`;
  if (code) return String(code);
  if (name) return String(name);
  if (id) return `#${id}`;
  return JSON.stringify(sample);
}

/**
 * The automated compliance checker's front end.
 *
 * The point of this screen is that it says exactly what is wrong: which rule,
 * how many records, and which ones. The score is shown with the weighting that
 * produced it, because a bare number nobody can reconstruct is not evidence.
 */
export function ComplianceChecksSection({ onSectionChange }: { onSectionChange: (section: string) => void }) {
  const { salaryPeriods } = useApp();

  const [financialYear, setFinancialYear] = useState<string>(financialYearOf());
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [tab, setTab] = useState<'results' | 'items'>('results');

  const [results, setResults] = useState<CheckResult[]>([]);
  const [score, setScore] = useState<any | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [raising, setRaising] = useState(false);
  const [runSummary, setRunSummary] = useState<any | null>(null);
  const [raiseSummary, setRaiseSummary] = useState<any | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      complianceApi.checkResults({ financialYear }).catch((err: any) => {
        throw err;
      }),
      complianceApi.score(financialYear).catch(() => null),
      complianceApi.checkItems().catch(() => []),
    ])
      .then(([rows, scoreRes, itemRows]) => {
        setResults(Array.isArray(rows) ? (rows as CheckResult[]) : []);
        setScore(scoreRes ?? null);
        setItems(Array.isArray(itemRows) ? (itemRows as ChecklistItem[]) : []);
      })
      .catch((err: any) => setError(err?.message ?? 'Could not load compliance check results'))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [financialYear]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * `/checks/results` returns every run, so the same checklist item appears
   * once per run. Only the newest result per item is meaningful here.
   */
  const latest = useMemo(() => {
    const byItem = new Map<number, CheckResult>();
    for (const row of results) {
      const key = Number(row.checklistItemId ?? row.id);
      const existing = byItem.get(key);
      if (!existing || Number(row.id) > Number(existing.id)) byItem.set(key, row);
    }
    return [...byItem.values()].sort((a, b) => {
      const rank = (RESULT_RANK[a.result] ?? 9) - (RESULT_RANK[b.result] ?? 9);
      if (rank !== 0) return rank;
      return Number(b.affectedCount ?? 0) - Number(a.affectedCount ?? 0);
    });
  }, [results]);

  const failures = useMemo(() => latest.filter((r) => r.result === 'FAIL'), [latest]);

  const lastRunAt = useMemo(() => {
    let newest: string | null = null;
    for (const r of results) {
      if (r.checkedAt && (!newest || String(r.checkedAt) > newest)) newest = String(r.checkedAt);
    }
    return newest;
  }, [results]);

  const runChecks = () => {
    setRunning(true);
    complianceApi
      .runChecks({ financialYear, periodId: periodId ?? undefined })
      .then((res) => {
        setRunSummary(res ?? null);
        setRaiseSummary(null);
        load();
      })
      .catch((err: any) => window.alert(err?.message ?? 'The check run failed'))
      .finally(() => setRunning(false));
  };

  const raiseFindings = () => {
    const ids = failures.map((f) => Number(f.id)).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return;
    setRaising(true);
    complianceApi
      .raiseFindings(ids)
      .then((res) => {
        setRaiseSummary(res ?? null);
        load();
      })
      .catch((err: any) => window.alert(err?.message ?? 'Findings could not be raised'))
      .finally(() => setRaising(false));
  };

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Controls ---------------------------------------------------------- */}
      <div className="bg-bg-card border border-border-default rounded-md p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className={LABEL_CLS} htmlFor="chk-fy">
              Financial year
            </label>
            <select
              id="chk-fy"
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
          <div>
            <label className={LABEL_CLS} htmlFor="chk-period">
              Payroll period (optional)
            </label>
            <select
              id="chk-period"
              className={`${INPUT_CLS} min-w-[190px]`}
              value={periodId ?? ''}
              onChange={(e) => setPeriodId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Whole financial year</option>
              {(salaryPeriods ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.status})
                </option>
              ))}
            </select>
          </div>
          <button onClick={runChecks} className={BTN_PRIMARY} disabled={running}>
            <PlayCircle size={14} className={`inline mr-1.5 ${running ? 'animate-pulse' : ''}`} />
            {running ? 'Running checks…' : 'Run checks'}
          </button>
          <button onClick={load} className={BTN_SECONDARY} disabled={loading}>
            <RefreshCw size={14} className={`inline mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <span className="text-text-muted text-[11px]">Last run {timeAgo(lastRunAt)}</span>
        </div>

        {runSummary && (
          <div className="mt-3 px-3 py-2 rounded-md bg-bg-secondary border border-border-light text-xs text-text-secondary space-y-1">
            <p className="text-text-primary font-medium">
              {Number(runSummary.evaluated ?? 0)} check(s) evaluated for {String(runSummary.financialYear ?? financialYear)} —{' '}
              {Number(runSummary.passed ?? 0)} passed, {Number(runSummary.failed ?? 0)} failed,{' '}
              {Number(runSummary.warnings ?? 0)} warning(s), {Number(runSummary.notApplicable ?? 0)} not applicable.
            </p>
            {Array.isArray(runSummary.unimplemented) && runSummary.unimplemented.length > 0 && (
              <p className="text-text-muted">
                Not machine-checked (no rule code): {runSummary.unimplemented.map(String).join(', ')}.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Score ------------------------------------------------------------- */}
      <ScoreCard score={score} />

      <TabBar
        tabs={[
          { id: 'results', label: 'Check results', count: latest.length },
          { id: 'items', label: 'Checklist items', count: items.length },
        ]}
        active={tab}
        onChange={(id) => setTab(id === 'items' ? 'items' : 'results')}
      />

      {loading && firstLoad && <LoadingBlock label="Loading checks…" />}

      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button onClick={load} className={BTN_SECONDARY}>
            Retry
          </button>
        </div>
      )}

      {/* Results ----------------------------------------------------------- */}
      {!error && tab === 'results' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={raiseFindings} className={BTN_PRIMARY} disabled={raising || failures.length === 0}>
              <Flag size={14} className="inline mr-1.5" />
              {raising ? 'Raising…' : `Raise findings (${failures.length})`}
            </button>
            <span className="text-text-muted text-[11px]">
              A finding is created for each failure, except where a finding for the same rule code is already open —
              those are skipped so the first one does not get buried.
            </span>
          </div>

          {raiseSummary && (
            <div className="px-3 py-2 rounded-md bg-info-light border border-info/30 text-info text-xs space-y-1">
              <p className="font-medium">
                {(raiseSummary.raised ?? []).length} finding(s) created, {(raiseSummary.skipped ?? []).length} skipped.
              </p>
              {Array.isArray(raiseSummary.skipped) && raiseSummary.skipped.length > 0 && (
                <ul className="list-disc pl-4">
                  {raiseSummary.skipped.map((s: any, i: number) => (
                    <li key={i}>
                      {String(s?.ruleCode ?? 'result')} — {String(s?.reason ?? '')}
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={() => onSectionChange('audit')}
                className="inline-flex items-center gap-1 text-info font-medium hover:underline"
              >
                Open Audit &amp; Findings <ArrowRight size={12} />
              </button>
            </div>
          )}

          {!firstLoad && latest.length === 0 && (
            <EmptyBlock
              message="No check results for this financial year"
              hint="Run the checks to evaluate every automated checklist item."
            />
          )}

          <div className="space-y-2">
            {latest.map((row) => {
              const open = expanded.has(row.id);
              const affected = Number(row.affectedCount ?? 0);
              const sample = evidenceOf(row);
              const capped = affected > sample.length;
              return (
                <div key={row.id} className="bg-bg-card border border-border-default rounded-md">
                  <button
                    onClick={() => toggle(row.id)}
                    className="w-full text-left px-4 py-3 hover:bg-bg-hover transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-text-muted mt-0.5 flex-shrink-0">
                        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Chip label={String(row.result).replace(/_/g, ' ')} tone={RESULT_TONE[row.result] ?? 'default'} dot />
                          <span className="text-text-primary text-sm font-medium">{row.title ?? row.code ?? '—'}</span>
                          {row.category && <Chip label={String(row.category).replace(/_/g, ' ')} tone="primary" />}
                          {row.severity && (
                            <Chip label={String(row.severity)} tone={SEVERITY_TONE[String(row.severity)] ?? 'default'} />
                          )}
                          {row.ruleCode && (
                            <span className="text-text-muted text-[11px] font-mono">{row.ruleCode}</span>
                          )}
                          {row.findingId && <Chip label={`Finding #${row.findingId}`} tone="info" />}
                        </div>

                        <div className="flex items-baseline gap-2">
                          <span
                            className={
                              affected > 0
                                ? 'text-danger text-xl font-semibold tabular-nums'
                                : 'text-text-muted text-xl font-semibold tabular-nums'
                            }
                          >
                            {affected}
                          </span>
                          <span className="text-text-muted text-[11px]">record(s) affected</span>
                          <span className="text-text-muted text-[11px]">· checked {timeAgo(row.checkedAt)}</span>
                        </div>

                        {/* The detail explains WHY — never truncated. */}
                        <p className="text-text-secondary text-xs leading-relaxed">{row.detail ?? '—'}</p>
                      </div>
                    </div>
                  </button>

                  {open && (
                    <div className="px-4 pb-4 pt-1 border-t border-border-light space-y-2">
                      {sample.length === 0 ? (
                        <p className="text-text-muted text-xs">
                          No evidence sample was stored for this result.
                        </p>
                      ) : (
                        <>
                          <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">
                            Offending records
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {sample.map((s, i) => (
                              <span
                                key={i}
                                title={typeof s === 'object' && s !== null && s.detail ? String(s.detail) : undefined}
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border border-border-default bg-bg-secondary text-text-secondary"
                              >
                                {evidenceLabel(s)}
                              </span>
                            ))}
                          </div>
                          {capped && (
                            <p className="text-text-muted text-[11px] italic">
                              Showing the first {sample.length} of {affected} — the evidence sample is capped at 50
                              records so a large breach does not become unreadable.
                            </p>
                          )}
                        </>
                      )}
                      <p className="text-text-muted text-[11px]">
                        Fix in Employee Profile → open the employee above and correct the field this rule checks
                        ({row.ruleCode ?? 'see the rule code'}), then re-run the checks. This screen only navigates
                        within Tax &amp; Compliance, so the jump has to be made from the Employees page.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Checklist items --------------------------------------------------- */}
      {!error && tab === 'items' && (
        <div className="space-y-2">
          <p className="text-text-muted text-xs">
            Every item the compliance checklist defines. Only the automated ones with a rule code are evaluated by
            <span className="text-text-primary"> Run checks</span> — the rest need a person.
          </p>
          {items.length === 0 && !firstLoad ? (
            <EmptyBlock message="No checklist items are configured" />
          ) : (
            <TableShell headers={['Code', 'Title', 'Category', 'Severity', 'Rule code', 'Automated', 'Active']}>
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs font-mono text-text-secondary whitespace-nowrap">
                    {item.code ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-sm text-text-primary">
                    {item.title ?? '—'}
                    {item.description && (
                      <span className="block text-text-muted text-[11px]">{item.description}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {item.category ? <Chip label={String(item.category).replace(/_/g, ' ')} tone="primary" /> : '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {item.severity ? (
                      <Chip label={String(item.severity)} tone={SEVERITY_TONE[String(item.severity)] ?? 'default'} />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-text-secondary whitespace-nowrap">
                    {item.ruleCode ?? '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {item.isAutomated ? (
                      <span className="inline-flex items-center gap-1 text-success text-xs">
                        <Cpu size={13} /> Automated
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-text-muted text-xs">
                        <Hand size={13} /> Manual
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={item.isActive ? 'Active' : 'Inactive'} tone={item.isActive ? 'success' : 'default'} />
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score card
// ---------------------------------------------------------------------------

function ScoreCard({ score }: { score: any | null }) {
  if (!score) {
    return (
      <div className="bg-bg-card border border-border-default rounded-md p-4 text-text-muted text-sm">
        No compliance score yet — run the checks for this financial year.
      </div>
    );
  }

  const value = Number(score.score ?? 0);
  const grade = String(score.grade ?? '—');
  const weights = (score.weighting?.weights ?? {}) as Record<string, unknown>;

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-5">
      <div className="flex items-start gap-6 flex-wrap">
        <div className="flex items-center gap-4">
          <Gauge size={28} className="text-primary" />
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">Compliance score</p>
            <div className="flex items-end gap-3">
              <span
                className={`text-5xl font-semibold tabular-nums ${
                  value >= 90 ? 'text-success' : value >= 75 ? 'text-success' : value >= 60 ? 'text-warning' : 'text-danger'
                }`}
              >
                {value.toFixed(1)}
              </span>
              <span className="mb-2">
                <Chip label={`Grade ${grade}`} tone={GRADE_TONE[grade] ?? 'default'} />
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider">Passed</p>
            <p className="text-2xl font-semibold text-success tabular-nums">{Number(score.passed ?? 0)}</p>
          </div>
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider">Failed</p>
            <p className="text-2xl font-semibold text-danger tabular-nums">{Number(score.failed ?? 0)}</p>
          </div>
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider">Warnings</p>
            <p className="text-2xl font-semibold text-warning tabular-nums">{Number(score.warnings ?? 0)}</p>
          </div>
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider">Evaluated</p>
            <p className="text-2xl font-semibold text-text-primary tabular-nums">{Number(score.evaluated ?? 0)}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-border-light space-y-1.5">
        <p className="text-text-secondary text-xs leading-relaxed">
          {score.weighting?.explanation
            ? String(score.weighting.explanation)
            : 'The score weights each item by its severity, so a critical failure costs far more than a medium one.'}
        </p>
        {score.weighting?.gradeBands && (
          <p className="text-text-muted text-[11px]">Grade bands: {String(score.weighting.gradeBands)}</p>
        )}
        {Object.keys(weights).length > 0 && (
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {Object.entries(weights).map(([severity, weight]) => (
              <Chip
                key={severity}
                label={`${severity} ×${String(weight)}`}
                tone={SEVERITY_TONE[severity] ?? 'default'}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
