import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { performanceApi, talentApi } from '../../../api/performance';
import { openAuthenticatedFile } from '../../../api/payroll';
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

// ---------------------------------------------------------------------------
// Report catalogue — 'performance' reports live under /performance/reports,
// 'talent' reports under /talent/reports; both share the same payload shape.
// ---------------------------------------------------------------------------

interface ReportDef {
  type: string;
  label: string;
  api: 'performance' | 'talent';
  /** Whether the cycle select applies to this report. */
  cycleParam: boolean;
  note?: string;
}

const GROUPS: { group: string; reports: ReportDef[] }[] = [
  {
    group: 'Performance',
    reports: [
      { type: 'goal-achievement', label: 'Goal achievement', api: 'performance', cycleParam: true },
      { type: 'kpi-report', label: 'KPI report', api: 'performance', cycleParam: true },
      { type: 'kra-report', label: 'KRA report', api: 'performance', cycleParam: true },
      { type: 'okr-report', label: 'OKR report', api: 'performance', cycleParam: true },
    ],
  },
  {
    group: 'Talent',
    reports: [
      { type: 'review-status', label: 'Review status', api: 'talent', cycleParam: true },
      { type: 'feedback-360', label: '360° feedback', api: 'talent', cycleParam: true },
      { type: 'appraisal', label: 'Appraisal', api: 'talent', cycleParam: true },
      { type: 'promotion', label: 'Promotion', api: 'talent', cycleParam: true },
      { type: 'talent-review', label: 'Talent review', api: 'talent', cycleParam: true },
      { type: 'succession', label: 'Succession', api: 'talent', cycleParam: false },
      { type: 'calibration', label: 'Calibration', api: 'talent', cycleParam: true },
      {
        type: 'pip',
        label: 'PIP (confidential)',
        api: 'talent',
        cycleParam: false,
        note: 'Restricted to admin, HR and managers — other roles get an access error, shown as-is.',
      },
    ],
  },
];

const ALL_REPORTS: ReportDef[] = GROUPS.flatMap((g) => g.reports);
const MAX_DISPLAY_ROWS = 500;

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Numbers (and number-shaped strings) read better right-aligned and monospaced. */
function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string' || value.trim() === '') return false;
  return /^-?[\d,]+(\.\d+)?%?$/.test(value.trim());
}

function cellText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ---------------------------------------------------------------------------

export function PerformanceReportsSection() {
  const [type, setType] = useState('goal-achievement');
  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState('');

  const [report, setReport] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const def = ALL_REPORTS.find((r) => r.type === type) ?? (ALL_REPORTS[0] as ReportDef);

  useEffect(() => {
    performanceApi
      .cycles()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setCycles(list);
        const active = list.find((c) => String(c?.status) === 'ACTIVE') ?? list[0];
        if (active) setCycleId(String(active.id));
      })
      .catch(() => {});
  }, []);

  // A parameter the selected report does not read must not be sent.
  const params = useMemo((): Record<string, string | number | undefined> => {
    const out: Record<string, string | number | undefined> = {};
    if (def.cycleParam && cycleId !== '') out.cycleId = Number(cycleId);
    return out;
  }, [def, cycleId]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const call = def.api === 'performance' ? performanceApi.report(type, params) : talentApi.report(type, params);
    call
      .then((res) => setReport(res ?? null))
      // A PIP 403 (or any other refusal) lands here and is rendered in place
      // of the table rather than crashing the section.
      .catch((err: any) => {
        setReport(null);
        setError(err?.message ?? 'Could not build this report');
      })
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [type, def.api, params]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = () => {
    setExporting(true);
    const url =
      def.api === 'performance'
        ? performanceApi.reportExportUrl(type, params)
        : talentApi.reportExportUrl(type, params);
    openAuthenticatedFile(url, `${type}.csv`)
      .catch((err: any) => window.alert(err?.message ?? 'Export failed'))
      .finally(() => setExporting(false));
  };

  const columns: { key: string; label: string }[] = Array.isArray(report?.columns)
    ? report.columns.map((c: any) =>
        typeof c === 'string'
          ? { key: c, label: c }
          : { key: String(c?.key ?? ''), label: String(c?.label ?? c?.key ?? '') },
      )
    : [];
  const rows: Record<string, unknown>[] = Array.isArray(report?.rows) ? report.rows : [];
  const shown = rows.slice(0, MAX_DISPLAY_ROWS);

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
            {def.cycleParam && (
              <div>
                <label className={LABEL_CLS} htmlFor="pr-cycle">
                  Cycle
                </label>
                <select
                  id="pr-cycle"
                  className={`${INPUT_CLS} w-64`}
                  value={cycleId}
                  onChange={(e) => setCycleId(e.target.value)}
                >
                  <option value="">All cycles</option>
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
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
            <button onClick={exportCsv} className={BTN_PRIMARY} disabled={exporting || !!error}>
              {exporting ? (
                <Loader2 size={14} className="inline mr-1.5 animate-spin" />
              ) : (
                <Download size={14} className="inline mr-1.5" />
              )}
              Export CSV
            </button>
            {def.note && <span className="text-text-muted text-[11px]">{def.note}</span>}
          </div>
        </div>

        {loading && firstLoad && <LoadingBlock label="Building report…" />}

        {error && (
          <div className="space-y-3">
            <ErrorBlock message={error} />
            <button onClick={load} className={BTN_SECONDARY}>
              Retry
            </button>
          </div>
        )}

        {!error && report && columns.length === 0 && !loading && (
          <EmptyBlock message="This report returned no columns" />
        )}

        {!error && report && columns.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Chip label={def.label} tone="primary" />
              <span className="text-text-muted text-xs">{rows.length.toLocaleString('en-IN')} row(s)</span>
              {report.reportType && (
                <span className="text-text-muted text-xs font-mono">· {String(report.reportType)}</span>
              )}
            </div>

            {rows.length === 0 ? (
              <EmptyBlock message="No rows for these parameters" />
            ) : (
              <div className="overflow-x-auto">
                <TableShell headers={columns.map((c) => c.label)}>
                  {shown.map((row, ri) => (
                    <tr key={ri} className="hover:bg-bg-hover transition-colors">
                      {columns.map((c) => {
                        const value = row?.[c.key];
                        return (
                          <td
                            key={c.key}
                            className={`px-3 py-2 text-sm whitespace-nowrap ${
                              isNumeric(value) ? 'text-right font-mono text-text-primary' : 'text-text-secondary'
                            }`}
                          >
                            {cellText(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </TableShell>
              </div>
            )}

            {rows.length > MAX_DISPLAY_ROWS && (
              <p className="text-text-muted text-xs">
                Showing first {MAX_DISPLAY_ROWS} of {rows.length.toLocaleString('en-IN')} — export for the full
                report.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
