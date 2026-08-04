import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, RefreshCw, Send } from 'lucide-react';
import { api } from '../../../api/client';
import { openAuthenticatedFile, payrollAdminApi } from '../../../api/payroll';
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
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------
// Report catalogue
// ---------------------------------------------------------------------------

type ParamKind = 'period' | 'range' | 'financialYear' | 'limit';

interface ReportDef {
  type: string;
  label: string;
  params: ParamKind[];
  /** Large enough that the queue is the sensible route. */
  heavy?: boolean;
}

const GROUPS: { group: string; reports: ReportDef[] }[] = [
  {
    group: 'Registers',
    reports: [
      { type: 'PAYROLL_REGISTER', label: 'Payroll register', params: ['period'], heavy: true },
      { type: 'SALARY_REGISTER', label: 'Salary register', params: ['period'], heavy: true },
      { type: 'PAYSLIP_SUMMARY', label: 'Payslip summary', params: ['period'], heavy: true },
    ],
  },
  {
    group: 'Statutory',
    reports: [
      { type: 'TAX', label: 'Income tax (TDS)', params: ['period', 'financialYear'] },
      { type: 'PF', label: 'Provident fund', params: ['period'] },
      { type: 'ESI', label: 'Employee state insurance', params: ['period'] },
      { type: 'PT', label: 'Professional tax', params: ['period'] },
      { type: 'COMPLIANCE', label: 'Compliance summary', params: ['period'] },
    ],
  },
  {
    group: 'Variable pay',
    reports: [
      { type: 'BONUS', label: 'Bonus', params: ['range'] },
      { type: 'INCENTIVE', label: 'Incentive', params: ['range'] },
      { type: 'OVERTIME', label: 'Overtime', params: ['period'] },
    ],
  },
  {
    group: 'Analysis',
    reports: [
      { type: 'COST_ANALYSIS', label: 'Cost analysis', params: ['range'], heavy: true },
      { type: 'FINAL_SETTLEMENT', label: 'Final settlements', params: ['range'] },
      { type: 'BANK_TRANSFER', label: 'Bank transfer', params: ['period'], heavy: true },
    ],
  },
  {
    group: 'Audit',
    reports: [{ type: 'AUDIT', label: 'Audit trail', params: ['range', 'period', 'limit'], heavy: true }],
  },
];

const ALL_REPORTS: ReportDef[] = GROUPS.flatMap((g) => g.reports);

const MAX_DISPLAY_ROWS = 500;

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthsAgoISO(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

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

/** Numbers (and number-shaped strings) read better right-aligned and monospaced. */
function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string' || value.trim() === '') return false;
  return /^-?[\d,]+(\.\d+)?%?$/.test(value.trim());
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Financial year label for a date, e.g. 2026-2027. */
function financialYearOf(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

/**
 * Payroll reporting: the fifteen server-side reports, rendered as-is with the
 * columns the backend chose, plus authenticated CSV export and a queue path
 * for the ones that are too big for a request cycle.
 */
export function PayrollReportsSection() {
  const { salaryPeriods } = useApp();

  const [type, setType] = useState('PAYROLL_REGISTER');
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [from, setFrom] = useState(monthsAgoISO(11));
  const [to, setTo] = useState(todayISO());
  const [financialYear, setFinancialYear] = useState(financialYearOf(todayISO()));
  const [limit, setLimit] = useState(500);
  const [department, setDepartment] = useState('');

  const [report, setReport] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [queuedJob, setQueuedJob] = useState<{ jobId: number; at: string } | null>(null);

  const def = ALL_REPORTS.find((r) => r.type === type) ?? ALL_REPORTS[0]!;

  useEffect(() => {
    if (periodId !== null || salaryPeriods.length === 0) return;
    const open = salaryPeriods.find((p) => p.status === 'OPEN');
    const newest = [...salaryPeriods].sort((a, b) => b.fromDate.localeCompare(a.fromDate))[0];
    setPeriodId(open?.id ?? newest?.id ?? null);
  }, [salaryPeriods, periodId]);

  /** Only the parameters this particular report actually reads. */
  const params = useMemo((): Record<string, string | number | undefined> => {
    const out: Record<string, string | number | undefined> = {};
    if (def.params.includes('period') && periodId) out.periodId = periodId;
    if (def.params.includes('range')) {
      out.from = from;
      out.to = to;
    }
    if (def.params.includes('financialYear') && financialYear) out.financialYear = financialYear;
    if (def.params.includes('limit')) out.limit = limit;
    return out;
  }, [def, periodId, from, to, financialYear, limit]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    payrollAdminApi
      .report(type, params)
      .then((res) => setReport(res ?? null))
      .catch((err: any) => setError(err?.message ?? 'Could not build this report'))
      .finally(() => setLoading(false));
  }, [type, params]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = () => {
    setExporting(true);
    openAuthenticatedFile(payrollAdminApi.reportExportUrl(type, params), `${type.toLowerCase()}.csv`)
      .catch((err: any) => window.alert(err?.message ?? 'Export failed'))
      .finally(() => setExporting(false));
  };

  const queueReport = () => {
    setQueueing(true);
    api
      .post<any>(`/payroll-admin/reports/${type}/queue`, params)
      .then((res) => {
        const jobId = Number(res?.jobId);
        if (Number.isFinite(jobId)) setQueuedJob({ jobId, at: new Date().toISOString() });
        else window.alert('The report was accepted but the server did not return a job id.');
      })
      .catch((err: any) => window.alert(err?.message ?? 'Could not queue this report'))
      .finally(() => setQueueing(false));
  };

  const columns: string[] = Array.isArray(report?.columns) ? report.columns.map(String) : [];
  const allRows: any[][] = Array.isArray(report?.rows) ? report.rows : [];

  // The backend has no department parameter, so this narrows what is displayed
  // rather than pretending it changed the query.
  const departmentIndex = columns.findIndex((c) => c.toLowerCase() === 'department');
  const filteredRows =
    department && departmentIndex >= 0
      ? allRows.filter((r) => String(r?.[departmentIndex] ?? '').toLowerCase() === department.toLowerCase())
      : allRows;

  const shownRows = filteredRows.slice(0, MAX_DISPLAY_ROWS);

  const departmentOptions = useMemo(() => {
    if (departmentIndex < 0) return [];
    const set = new Set<string>();
    for (const r of allRows) {
      const v = String(r?.[departmentIndex] ?? '').trim();
      if (v) set.add(v);
    }
    return [...set].sort();
  }, [allRows, departmentIndex]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-4">
      {/* Left rail --------------------------------------------------------- */}
      <nav className="bg-bg-card border border-border-default rounded-md p-2 h-fit space-y-3">
        {GROUPS.map((g) => (
          <div key={g.group}>
            <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-text-muted font-semibold">{g.group}</p>
            <ul>
              {g.reports.map((r) => (
                <li key={r.type}>
                  <button
                    onClick={() => setType(r.type)}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                      r.type === type
                        ? 'bg-bg-selected text-primary font-medium'
                        : 'text-text-secondary hover:bg-bg-hover'
                    }`}
                  >
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Right pane -------------------------------------------------------- */}
      <div className="space-y-4 min-w-0">
        <div className="bg-bg-card border border-border-default rounded-md p-4 space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            {def.params.includes('period') && (
              <div>
                <label className={LABEL_CLS} htmlFor="rep-period">
                  Period
                </label>
                <select
                  id="rep-period"
                  className={`${INPUT_CLS} min-w-[180px]`}
                  value={periodId ?? ''}
                  onChange={(e) => setPeriodId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Latest period</option>
                  {salaryPeriods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.status})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {def.params.includes('range') && (
              <>
                <div>
                  <label className={LABEL_CLS} htmlFor="rep-from">
                    From
                  </label>
                  <input
                    id="rep-from"
                    type="date"
                    className={INPUT_CLS}
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="rep-to">
                    To
                  </label>
                  <input id="rep-to" type="date" className={INPUT_CLS} value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </>
            )}

            {def.params.includes('financialYear') && (
              <div>
                <label className={LABEL_CLS} htmlFor="rep-fy">
                  Financial year
                </label>
                <input
                  id="rep-fy"
                  className={`${INPUT_CLS} w-32`}
                  value={financialYear}
                  onChange={(e) => setFinancialYear(e.target.value)}
                  placeholder="2026-2027"
                />
              </div>
            )}

            {def.params.includes('limit') && (
              <div>
                <label className={LABEL_CLS} htmlFor="rep-limit">
                  Row limit
                </label>
                <select
                  id="rep-limit"
                  className={INPUT_CLS}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                >
                  {[100, 250, 500].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {departmentIndex >= 0 && (
              <div>
                <label className={LABEL_CLS} htmlFor="rep-dept">
                  Department
                </label>
                <select
                  id="rep-dept"
                  className={INPUT_CLS}
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                >
                  <option value="">All departments</option>
                  {departmentOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={load} className={BTN_SECONDARY} disabled={loading}>
              <RefreshCw size={14} className={`inline mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button onClick={exportCsv} className={BTN_PRIMARY} disabled={exporting}>
              {exporting ? (
                <Loader2 size={14} className="inline mr-1.5 animate-spin" />
              ) : (
                <Download size={14} className="inline mr-1.5" />
              )}
              Export CSV
            </button>
            {def.heavy && (
              <button onClick={queueReport} className={BTN_SECONDARY} disabled={queueing}>
                {queueing ? (
                  <Loader2 size={14} className="inline mr-1.5 animate-spin" />
                ) : (
                  <Send size={14} className="inline mr-1.5" />
                )}
                Queue report
              </button>
            )}
            {departmentIndex >= 0 && department && (
              <span className="text-text-muted text-[11px]">
                Department filter applies to the displayed rows only — the export contains every row.
              </span>
            )}
          </div>

          {queuedJob && (
            <div className="px-3 py-2 rounded-md bg-info-light border border-info/30 text-info text-xs">
              Queued as job #{queuedJob.jobId} ({timeAgo(queuedJob.at)}). It renders in the background and lands in
              storage — you do not need to keep this page open.
            </div>
          )}
        </div>

        {loading && !report && <LoadingBlock label="Building report…" />}

        {error && (
          <div className="space-y-3">
            <ErrorBlock message={error} />
            <button onClick={load} className={BTN_SECONDARY}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && report && columns.length === 0 && (
          <EmptyBlock message="This report returned no columns" />
        )}

        {!error && report && columns.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Chip label={def.label} tone="primary" />
              <span className="text-text-muted text-xs">
                {filteredRows.length.toLocaleString('en-IN')} row(s)
              </span>
              {report.meta?.period?.label && (
                <span className="text-text-muted text-xs">· {String(report.meta.period.label)}</span>
              )}
            </div>

            {filteredRows.length === 0 ? (
              <EmptyBlock message="No rows for these parameters" />
            ) : (
              <>
                <TableShell headers={columns}>
                  {shownRows.map((row, ri) => (
                    <tr key={ri} className="hover:bg-bg-hover transition-colors">
                      {columns.map((_c, ci) => {
                        const value = row?.[ci];
                        return (
                          <td
                            key={ci}
                            className={`px-3 py-2 text-sm whitespace-nowrap ${
                              isNumeric(value)
                                ? 'text-right font-mono text-text-primary'
                                : 'text-text-secondary'
                            }`}
                          >
                            {cellText(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </TableShell>

                {filteredRows.length > MAX_DISPLAY_ROWS && (
                  <p className="text-text-muted text-xs">
                    Showing first {MAX_DISPLAY_ROWS} of {filteredRows.length.toLocaleString('en-IN')} — export for the
                    full report.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
