import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { complianceApi, financialYearOf } from '../../../api/compliance';
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
// Report catalogue
// ---------------------------------------------------------------------------

type ParamKind = 'financialYear' | 'month' | 'status' | 'auditId';

interface ReportDef {
  type: string;
  label: string;
  params: ParamKind[];
  statusOptions?: string[];
  note?: string;
}

const GROUPS: { group: string; reports: ReportDef[] }[] = [
  {
    group: 'Registers',
    reports: [
      { type: 'PF_REGISTER', label: 'PF register', params: ['financialYear', 'month'] },
      { type: 'ESI_REGISTER', label: 'ESI register', params: ['financialYear', 'month'] },
      { type: 'PT_REGISTER', label: 'PT register', params: ['financialYear', 'month'] },
      { type: 'TDS_REGISTER', label: 'TDS register', params: ['financialYear', 'month'] },
    ],
  },
  {
    group: 'Tax',
    reports: [
      { type: 'FORM16_REPORT', label: 'Form 16', params: ['financialYear'] },
      { type: 'TAX_LIABILITY', label: 'Tax liability', params: ['financialYear'] },
      { type: 'INVESTMENT_DECLARATION', label: 'Investment declaration', params: ['financialYear'] },
      {
        type: 'PROOF_VERIFICATION',
        label: 'Proof verification',
        params: ['financialYear', 'status'],
        statusOptions: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED'],
      },
    ],
  },
  {
    group: 'Compliance',
    reports: [
      {
        type: 'COMPLIANCE_STATUS',
        label: 'Compliance status',
        params: ['financialYear', 'status'],
        statusOptions: ['UPCOMING', 'DUE_SOON', 'OVERDUE', 'COMPLETED', 'WAIVED', 'NOT_APPLICABLE'],
      },
      { type: 'AUDIT_REPORT', label: 'Audit report', params: ['financialYear', 'auditId'] },
      {
        type: 'STATUTORY_FILING',
        label: 'Statutory filing',
        params: ['financialYear', 'status'],
        statusOptions: ['PENDING', 'GENERATED', 'FILED', 'ACKNOWLEDGED', 'REJECTED'],
      },
    ],
  },
];

const ALL_REPORTS: ReportDef[] = GROUPS.flatMap((g) => g.reports);

const MAX_DISPLAY_ROWS = 500;

// ---------------------------------------------------------------------------
// Local helpers (date-fns is not installed)
// ---------------------------------------------------------------------------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fyOptions(): string[] {
  const current = financialYearOf();
  const start = Number(current.slice(0, 4));
  return [start - 2, start - 1, start, start + 1].map((y) => `${y}-${y + 1}`);
}

function fyMonths(fy: string): string[] {
  const startYear = Number(String(fy).slice(0, 4));
  if (!Number.isFinite(startYear)) return [];
  return Array.from({ length: 12 }, (_, i) => {
    const month = ((3 + i) % 12) + 1;
    const year = i < 9 ? startYear : startYear + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  });
}

function fmtMonth(key: string): string {
  const parts = key.split('-');
  if (parts.length !== 2) return key;
  const monthIndex = Number(parts[1]) - 1;
  return `${MONTH_NAMES[monthIndex] ?? parts[1]} ${parts[0]}`;
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
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function metaLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function metaValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The eleven statutory and compliance reports, rendered with the columns the
 * backend chose. Export goes through the authenticated file helper because a
 * bare anchor cannot carry the bearer token.
 */
export function ComplianceReportsSection() {
  const [type, setType] = useState('PF_REGISTER');
  const [financialYear, setFinancialYear] = useState<string>(financialYearOf());
  const [month, setMonth] = useState('');
  const [status, setStatus] = useState('');
  const [auditId, setAuditId] = useState('');

  const [report, setReport] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const def = ALL_REPORTS.find((r) => r.type === type) ?? (ALL_REPORTS[0] as ReportDef);

  // A parameter the selected report does not read must not be sent.
  const params = useMemo((): Record<string, string | number | undefined> => {
    const out: Record<string, string | number | undefined> = {};
    if (def.params.includes('financialYear') && financialYear) out.financialYear = financialYear;
    if (def.params.includes('month') && month) out.month = month;
    if (def.params.includes('status') && status) out.status = status;
    if (def.params.includes('auditId') && auditId) out.auditId = Number(auditId);
    return out;
  }, [def, financialYear, month, status, auditId]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    complianceApi
      .report(type, params)
      .then((res) => setReport(res ?? null))
      .catch((err: any) => setError(err?.message ?? 'Could not build this report'))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [type, params]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = () => {
    setExporting(true);
    openAuthenticatedFile(complianceApi.reportExportUrl(type, params), `${type.toLowerCase()}.csv`)
      .catch((err: any) => window.alert(err?.message ?? 'Export failed'))
      .finally(() => setExporting(false));
  };

  const columns: { key: string; label: string }[] = Array.isArray(report?.columns)
    ? report.columns.map((c: any) =>
        typeof c === 'string' ? { key: c, label: c } : { key: String(c?.key ?? ''), label: String(c?.label ?? c?.key ?? '') },
      )
    : [];
  const rows: Record<string, unknown>[] = Array.isArray(report?.rows) ? report.rows : [];
  const shown = rows.slice(0, MAX_DISPLAY_ROWS);
  const meta = (report?.meta ?? {}) as Record<string, unknown>;

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
        <div className="bg-bg-card border border-border-default rounded-md p-4 space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            {def.params.includes('financialYear') && (
              <div>
                <label className={LABEL_CLS} htmlFor="cr-fy">
                  Financial year
                </label>
                <select
                  id="cr-fy"
                  className={`${INPUT_CLS} w-36`}
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
            )}

            {def.params.includes('month') && (
              <div>
                <label className={LABEL_CLS} htmlFor="cr-month">
                  Month
                </label>
                <select id="cr-month" className={`${INPUT_CLS} w-36`} value={month} onChange={(e) => setMonth(e.target.value)}>
                  <option value="">Whole year</option>
                  {fyMonths(financialYear).map((m) => (
                    <option key={m} value={m}>
                      {fmtMonth(m)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {def.params.includes('status') && (
              <div>
                <label className={LABEL_CLS} htmlFor="cr-status">
                  Status
                </label>
                <select id="cr-status" className={`${INPUT_CLS} w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All statuses</option>
                  {(def.statusOptions ?? []).map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {def.params.includes('auditId') && (
              <div>
                <label className={LABEL_CLS} htmlFor="cr-audit">
                  Audit id
                </label>
                <input
                  id="cr-audit"
                  className={`${INPUT_CLS} w-28`}
                  value={auditId}
                  onChange={(e) => setAuditId(e.target.value.replace(/\D/g, ''))}
                  placeholder="all audits"
                />
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
            <span className="text-text-muted text-[11px]">
              Only the parameters this report reads are sent — a payroll period is not one of them, these reports are
              scoped by financial year and month.
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

        {!error && report && columns.length === 0 && !loading && (
          <EmptyBlock message="This report returned no columns" />
        )}

        {!error && report && columns.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Chip label={def.label} tone="primary" />
              <span className="text-text-muted text-xs">{rows.length.toLocaleString('en-IN')} row(s)</span>
              {report.type && <span className="text-text-muted text-xs font-mono">· {String(report.type)}</span>}
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
                Showing first {MAX_DISPLAY_ROWS} of {rows.length.toLocaleString('en-IN')} — export for the full report.
              </p>
            )}

            {/* Provenance: an exported register has to be traceable. */}
            {Object.keys(meta).length > 0 && (
              <div className="rounded-md border border-border-light bg-bg-secondary p-3">
                <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold mb-2">
                  Report metadata
                  {meta.generatedAt ? ` · generated ${timeAgo(String(meta.generatedAt))}` : ''}
                </p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
                  {Object.entries(meta).map(([key, value]) => (
                    <div key={key} className="flex items-baseline justify-between gap-2 min-w-0">
                      <dt className="text-text-muted text-[11px] flex-shrink-0">{metaLabel(key)}</dt>
                      <dd className="text-text-secondary text-[11px] font-mono truncate">{metaValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
