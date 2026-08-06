import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { internalHiringApi } from '../../../api/internalJobs';
import { openAuthenticatedFile } from '../../../api/payroll';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  TableShell,
} from '../../../components/common/HrmsUI';

// ---------------------------------------------------------------------------
// Report catalogue — the nine types the backend serves.
// ---------------------------------------------------------------------------

interface ReportDef {
  type: string;
  label: string;
  note?: string;
}

const GROUPS: { group: string; reports: ReportDef[] }[] = [
  {
    group: 'Pipeline',
    reports: [
      { type: 'vacancy', label: 'Vacancies' },
      { type: 'applications', label: 'Applications' },
      { type: 'interviews', label: 'Interviews' },
      { type: 'offers', label: 'Offers' },
    ],
  },
  {
    group: 'Mobility',
    reports: [
      { type: 'transfers', label: 'Transfers' },
      { type: 'promotions', label: 'Promotions' },
    ],
  },
  {
    group: 'Programs',
    reports: [
      { type: 'referrals', label: 'Referrals' },
      { type: 'talent-pool', label: 'Talent pool' },
    ],
  },
  {
    group: 'KPIs',
    reports: [{ type: 'hiring-kpis', label: 'Hiring KPIs' }],
  },
];

const ALL_REPORTS: ReportDef[] = GROUPS.flatMap((g) => g.reports);
const MAX_DISPLAY_ROWS = 500;

// ---------------------------------------------------------------------------
// Cell helpers (mirrors the compliance report renderer)
// ---------------------------------------------------------------------------

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

/**
 * The nine recruitment and mobility reports, rendered with whatever columns
 * the backend chose. CSV export goes through the authenticated file helper
 * because a bare anchor cannot carry the bearer token.
 */
export function HiringReportsSection() {
  const [type, setType] = useState('vacancy');
  const [report, setReport] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const def = ALL_REPORTS.find((r) => r.type === type) ?? (ALL_REPORTS[0] as ReportDef);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    internalHiringApi
      .report(type)
      .then((res) => setReport(res ?? null))
      .catch((err: any) => setError(err?.message ?? 'Could not build this report'))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [type]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = () => {
    setExporting(true);
    openAuthenticatedFile(internalHiringApi.reportExportUrl(type), `${type}-report.csv`)
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
                      r.type === type ? 'bg-bg-selected text-primary font-medium' : 'text-text-secondary hover:bg-bg-hover'
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
        <div className="bg-bg-card border border-border-default rounded-md p-4">
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
            <span className="text-text-muted text-[11px]">
              These reports take no parameters — each is a full snapshot of the current recruitment data.
            </span>
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

        {!error && report && columns.length === 0 && !loading && <EmptyBlock message="This report returned no columns" />}

        {!error && report && columns.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Chip label={def.label} tone="primary" />
              <span className="text-text-muted text-xs">{rows.length.toLocaleString('en-IN')} row(s)</span>
              {report.reportType && <span className="text-text-muted text-xs font-mono">· {String(report.reportType)}</span>}
            </div>

            {rows.length === 0 ? (
              <EmptyBlock message="No rows in this report yet" />
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
                Showing first {MAX_DISPLAY_ROWS} of {rows.length.toLocaleString('en-IN')} — export for the full report.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
