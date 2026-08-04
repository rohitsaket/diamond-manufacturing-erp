import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { payrollAdminApi } from '../../../api/payroll';
import {
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
// Local helpers
// ---------------------------------------------------------------------------

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

function stamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

function actionTone(action: string | null | undefined): Tone {
  const a = String(action ?? '').toUpperCase();
  if (a === 'CREATE' || a === 'APPROVE' || a === 'APPROVED') return 'success';
  if (a === 'DELETE' || a === 'REJECT' || a === 'REJECTED' || a === 'FAIL') return 'danger';
  if (a === 'UPDATE' || a === 'SAVE' || a === 'VERIFY' || a === 'RECONCILE') return 'warning';
  if (a === 'RUN' || a === 'QUEUE' || a === 'RETRO' || a === 'EXPORT' || a === 'SEND') return 'info';
  return 'default';
}

/** Audit values arrive as JSON strings, plain strings or objects. */
function valueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const ENTITY_TYPES = [
  'PAYROLL_RUN',
  'SALARY_LINE',
  'PAY_AWARD',
  'EMPLOYEE_SALARY',
  'PAYMENT_BATCH',
  'BANK_ACCOUNT',
  'TAX_DECLARATION',
  'FINAL_SETTLEMENT',
  'LOAN',
  'REIMBURSEMENT',
];

/**
 * Payroll audit trail.
 *
 * This is a compliance record, so the request context (IP, device, browser) is
 * shown rather than tucked away — "who changed this" is only half an answer
 * without "from where".
 */
export function PayrollAuditSection() {
  const { salaryPeriods } = useApp();

  const [entityType, setEntityType] = useState('');
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [limit, setLimit] = useState(100);
  const [search, setSearch] = useState('');

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    payrollAdminApi
      .audit({
        entityType: entityType || undefined,
        periodId: periodId ?? undefined,
        limit,
      })
      .then((res) => {
        // The endpoint is paginated, but a bare array is handled too.
        if (Array.isArray(res)) {
          setRows(res);
          setTotal(res.length);
        } else {
          const list = Array.isArray(res?.rows) ? res.rows : [];
          setRows(list);
          setTotal(num(res?.total) ?? list.length);
        }
      })
      .catch((err: any) => setError(err?.message ?? 'Could not load the audit trail'))
      .finally(() => setLoading(false));
  }, [entityType, periodId, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r: any) => {
      const haystack = `${r?.summary ?? ''} ${r?.actorName ?? ''} ${r?.actorRole ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search]);

  const entityOptions = useMemo(() => {
    const set = new Set<string>(ENTITY_TYPES);
    for (const r of rows) {
      const t = String(r?.entityType ?? '').trim();
      if (t) set.add(t);
    }
    return [...set].sort();
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* Filters ------------------------------------------------------------ */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className={LABEL_CLS} htmlFor="audit-entity">
              Entity type
            </label>
            <select
              id="audit-entity"
              className={`${INPUT_CLS} min-w-[180px]`}
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
            >
              <option value="">All entities</option>
              {entityOptions.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_CLS} htmlFor="audit-period">
              Period
            </label>
            <select
              id="audit-period"
              className={`${INPUT_CLS} min-w-[170px]`}
              value={periodId ?? ''}
              onChange={(e) => setPeriodId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All periods</option>
              {salaryPeriods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_CLS} htmlFor="audit-limit">
              Rows
            </label>
            <select
              id="audit-limit"
              className={INPUT_CLS}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              {[50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_CLS} htmlFor="audit-search">
              Search summary or actor
            </label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                id="audit-search"
                className={`${INPUT_CLS} pl-8 min-w-[220px]`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="e.g. approved, rohit"
              />
            </div>
          </div>
        </div>

        <button onClick={load} className={BTN_SECONDARY} disabled={loading}>
          <RefreshCw size={14} className={`inline mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading && rows.length === 0 && <LoadingBlock label="Loading audit trail…" />}

      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button onClick={load} className={BTN_SECONDARY}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <EmptyBlock
          message="No audit entries for these filters"
          hint="Every payroll write is logged — an empty trail means nothing has been changed in this scope."
        />
      )}

      {!error && filtered.length > 0 && (
        <>
          <p className="text-text-muted text-xs">
            Showing {filtered.length.toLocaleString('en-IN')}
            {total !== null && total !== filtered.length ? ` of ${total.toLocaleString('en-IN')}` : ''} entries
          </p>

          <TableShell headers={['', 'When', 'Actor', 'Action', 'Entity', 'Summary', 'Before → after']}>
            {filtered.map((r: any, i: number) => {
              const key = num(r?.id) ?? i;
              const isOpen = expanded === key;
              return [
                <tr
                  key={`row-${key}`}
                  onClick={() => setExpanded(isOpen ? null : key)}
                  className="hover:bg-bg-hover transition-colors cursor-pointer"
                >
                  <td className="px-2 py-2 text-text-muted w-6">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap" title={stamp(r?.createdAt)}>
                    {timeAgo(r?.createdAt)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="text-sm text-text-primary mr-2">{String(r?.actorName ?? 'System')}</span>
                    {r?.actorRole && <Chip label={String(r.actorRole)} tone="default" />}
                  </td>
                  <td className="px-3 py-2">
                    <Chip label={String(r?.action ?? '—')} tone={actionTone(r?.action)} />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                    {String(r?.entityType ?? '—')}
                    {num(r?.entityId) !== null && <span className="text-text-muted"> #{num(r?.entityId)}</span>}
                  </td>
                  <td className="px-3 py-2 text-sm text-text-secondary">{String(r?.summary ?? '')}</td>
                  <td className="px-3 py-2 text-xs">
                    {r?.fieldName ? (
                      <span className="whitespace-nowrap">
                        <span className="text-text-muted mr-1">{String(r.fieldName)}:</span>
                        <span className="text-danger line-through">{valueText(r?.previousValue) || '∅'}</span>
                        <span className="text-text-muted mx-1">→</span>
                        <span className="text-success">{valueText(r?.newValue) || '∅'}</span>
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                </tr>,
                isOpen ? (
                  <tr key={`detail-${key}`} className="bg-bg-secondary">
                    <td colSpan={7} className="px-4 py-3">
                      <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                        <div>
                          <dt className="text-text-muted uppercase tracking-wider text-[10px]">Timestamp</dt>
                          <dd className="text-text-primary">{stamp(r?.createdAt)}</dd>
                        </div>
                        <div>
                          <dt className="text-text-muted uppercase tracking-wider text-[10px]">IP address</dt>
                          <dd className="text-text-primary font-mono">{String(r?.ipAddress ?? '—')}</dd>
                        </div>
                        <div>
                          <dt className="text-text-muted uppercase tracking-wider text-[10px]">Device</dt>
                          <dd className="text-text-primary">{String(r?.device ?? '—')}</dd>
                        </div>
                        <div>
                          <dt className="text-text-muted uppercase tracking-wider text-[10px]">Browser</dt>
                          <dd className="text-text-primary">{String(r?.browser ?? '—')}</dd>
                        </div>
                        {r?.employeeName && (
                          <div>
                            <dt className="text-text-muted uppercase tracking-wider text-[10px]">Employee</dt>
                            <dd className="text-text-primary">{String(r.employeeName)}</dd>
                          </div>
                        )}
                        {num(r?.periodId) !== null && (
                          <div>
                            <dt className="text-text-muted uppercase tracking-wider text-[10px]">Period id</dt>
                            <dd className="text-text-primary font-mono">{num(r?.periodId)}</dd>
                          </div>
                        )}
                        {num(r?.runId) !== null && (
                          <div>
                            <dt className="text-text-muted uppercase tracking-wider text-[10px]">Run id</dt>
                            <dd className="text-text-primary font-mono">#{num(r?.runId)}</dd>
                          </div>
                        )}
                        {num(r?.actorUserId) !== null && (
                          <div>
                            <dt className="text-text-muted uppercase tracking-wider text-[10px]">Actor user id</dt>
                            <dd className="text-text-primary font-mono">{num(r?.actorUserId)}</dd>
                          </div>
                        )}
                      </dl>

                      {(r?.previousValue || r?.newValue) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                          <div>
                            <p className="text-text-muted uppercase tracking-wider text-[10px] mb-1">Previous</p>
                            <pre className="text-[11px] font-mono text-danger bg-bg-card border border-border-light rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                              {valueText(r?.previousValue) || '—'}
                            </pre>
                          </div>
                          <div>
                            <p className="text-text-muted uppercase tracking-wider text-[10px] mb-1">New</p>
                            <pre className="text-[11px] font-mono text-success bg-bg-card border border-border-light rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                              {valueText(r?.newValue) || '—'}
                            </pre>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </TableShell>
        </>
      )}
    </div>
  );
}
