import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Search, RefreshCw, ChevronLeft, ChevronRight, Upload } from 'lucide-react';
import { documentApi } from '../../api/documents';
import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategoryCode,
  type ComplianceScore,
  type MissingDocument,
} from '../../types/documents';
import {
  PageHeader,
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
} from '../../components/common/HrmsUI';
import { ModalShell } from '../../components/common/ModalShell';
import { useApp } from '../../contexts/AppContext';
import { formatDate } from './documentUi';

type ComplianceRow = ComplianceScore & { employeeName: string; empCode: string };

const PAGE_LIMIT = 25;

function pctTone(pct: number): { bar: string; text: string } {
  if (pct >= 90) return { bar: 'bg-success', text: 'text-success' };
  if (pct >= 70) return { bar: 'bg-warning', text: 'text-warning' };
  return { bar: 'bg-danger', text: 'text-danger' };
}

/**
 * The employee payload is shared with the production modules and does not
 * declare HR org fields, but the API may still return them. Read them
 * defensively rather than assuming either way.
 */
function orgField(employee: unknown, key: 'department' | 'branch'): string | null {
  if (typeof employee !== 'object' || employee === null) return null;
  const value = (employee as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function ComplianceBar({ pct }: { pct: number }) {
  const safe = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  const tone = pctTone(safe);
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${safe}%` }} />
      </div>
      <span className={`text-xs font-medium tabular-nums w-10 text-right ${tone.text}`}>{Math.round(safe)}%</span>
    </div>
  );
}

function EmployeeDetail({
  row,
  onClose,
  onNavigate,
}: {
  row: ComplianceRow;
  onClose: () => void;
  onNavigate: (page: string) => void;
}) {
  const [missing, setMissing] = useState<MissingDocument[] | null>(null);
  const [score, setScore] = useState<ComplianceScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([documentApi.missingFor(row.employeeId), documentApi.complianceFor(row.employeeId)])
      .then(([missingRows, complianceScore]) => {
        if (cancelled) return;
        setMissing(missingRows ?? []);
        setScore(complianceScore ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load compliance detail');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row.employeeId]);

  const effective = score ?? row;
  const rows = missing ?? [];

  return (
    <ModalShell
      title={row.employeeName || `Employee #${row.employeeId}`}
      subtitle={row.empCode ? `${row.empCode} · document compliance` : 'Document compliance'}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-text-muted text-xs">Uploads are made from the browse tab.</p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className={BTN_SECONDARY}>
              Close
            </button>
            <button onClick={() => onNavigate('documents')} className={`${BTN_PRIMARY} inline-flex items-center gap-2`}>
              <Upload size={14} /> Upload for this employee
            </button>
          </div>
        </div>
      }
    >
      {error && <ErrorBlock message={error} />}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard label="Required" value={effective.required ?? 0} />
        <StatCard label="Present" value={effective.present ?? 0} intent="success" />
        <StatCard
          label="Missing"
          value={effective.missing ?? 0}
          intent={(effective.missing ?? 0) > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Expired"
          value={effective.expired ?? 0}
          intent={(effective.expired ?? 0) > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="mb-4">
        <p className={LABEL_CLS}>Compliance</p>
        <ComplianceBar pct={Number(effective.pct ?? 0)} />
      </div>

      <h4 className="text-sm font-semibold text-text-primary mb-2">Missing documents</h4>
      {loading ? (
        <LoadingBlock label="Loading missing documents…" />
      ) : rows.length === 0 ? (
        <EmptyBlock message="Nothing missing" hint="Every required document for this employee is on file" />
      ) : (
        <div className="space-y-2">
          {rows.map((item) => (
            <div
              key={item.typeId}
              className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-md border border-border-light bg-bg-secondary"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary truncate">{item.typeName ?? item.typeCode ?? 'Untitled type'}</p>
                <p className="text-[11px] text-text-muted font-mono">{item.typeCode}</p>
              </div>
              <Chip label={DOCUMENT_CATEGORY_LABELS[item.category as DocumentCategoryCode] ?? item.category} />
              <span className="text-xs text-text-secondary whitespace-nowrap">
                {item.dueDate ? `Due ${formatDate(item.dueDate)}` : 'No due date'}
              </span>
              {item.overdue && <Chip label="Overdue" tone="danger" dot />}
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

export function DocumentCompliance({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { employees } = useApp();

  const [department, setDepartment] = useState('');
  const [branch, setBranch] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<ComplianceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ComplianceRow | null>(null);

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const employee of employees ?? []) {
      const value = orgField(employee, 'department');
      if (value) set.add(value);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [employees]);

  const branches = useMemo(() => {
    const set = new Set<string>();
    for (const employee of employees ?? []) {
      const value = orgField(employee, 'branch');
      if (value) set.add(value);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [employees]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    documentApi
      .compliance({ department: department || undefined, branch: branch || undefined, page, limit: PAGE_LIMIT })
      .then((payload) => {
        setRows(payload?.rows ?? []);
        setTotal(Number(payload?.total ?? 0));
      })
      .catch((err: unknown) => {
        setRows([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : 'Failed to load compliance scores');
      })
      .finally(() => setLoading(false));
  }, [department, branch, page]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (row) =>
        (row.employeeName ?? '').toLowerCase().includes(term) || (row.empCode ?? '').toLowerCase().includes(term),
    );
  }, [rows, search]);

  const pageStats = useMemo(() => {
    if (rows.length === 0) return null;
    const fully = rows.filter((row) => Number(row.pct ?? 0) >= 100).length;
    const avg = rows.reduce((sum, row) => sum + Number(row.pct ?? 0), 0) / rows.length;
    const missing = rows.reduce((sum, row) => sum + Number(row.missing ?? 0), 0);
    return { fully, avg, missing };
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const rangeFrom = total === 0 ? 0 : (page - 1) * PAGE_LIMIT + 1;
  const rangeTo = total === 0 ? 0 : Math.min(page * PAGE_LIMIT, rangeFrom + rows.length - 1);

  const resetTo = (updater: () => void) => {
    updater();
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Document compliance"
        subtitle="Required documents present, missing and expired for every employee"
        actions={
          <button onClick={load} disabled={loading} className={`${BTN_SECONDARY} inline-flex items-center gap-2`}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      {error && <ErrorBlock message={error} />}

      {/* Summary --------------------------------------------------------*/}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Employees covered"
          value={total.toLocaleString('en-IN')}
          hint={department || branch ? 'Matching the current filters' : 'Company-wide'}
        />
        <StatCard
          label="Fully compliant"
          value={pageStats ? pageStats.fully : '—'}
          intent={pageStats && pageStats.fully > 0 ? 'success' : 'default'}
          hint="On this page"
        />
        <StatCard
          label="Average compliance"
          value={pageStats ? `${Math.round(pageStats.avg)}%` : '—'}
          intent={
            pageStats ? (pageStats.avg >= 90 ? 'success' : pageStats.avg >= 70 ? 'warning' : 'danger') : 'default'
          }
          hint="On this page"
        />
        <StatCard
          label="Missing documents"
          value={pageStats ? pageStats.missing.toLocaleString('en-IN') : '—'}
          intent={pageStats && pageStats.missing > 0 ? 'danger' : 'default'}
          hint="On this page"
        />
      </div>

      {/* Filters --------------------------------------------------------*/}
      <div className="bg-bg-card border border-border-default rounded-md p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className={LABEL_CLS} htmlFor="compliance-department">
            Department
          </label>
          <select
            id="compliance-department"
            className={INPUT_CLS}
            value={department}
            onChange={(e) => resetTo(() => setDepartment(e.target.value))}
          >
            <option value="">All departments</option>
            {departments.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {departments.length === 0 && (
            <p className="text-text-muted text-[11px] mt-1">No departments found on the employee master.</p>
          )}
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="compliance-branch">
            Branch
          </label>
          <select
            id="compliance-branch"
            className={INPUT_CLS}
            value={branch}
            onChange={(e) => resetTo(() => setBranch(e.target.value))}
          >
            <option value="">All branches</option>
            {branches.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {branches.length === 0 && (
            <p className="text-text-muted text-[11px] mt-1">No branches found on the employee master.</p>
          )}
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="compliance-search">
            Search this page
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              id="compliance-search"
              className={`${INPUT_CLS} pl-8`}
              placeholder="Name or employee code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Table ----------------------------------------------------------*/}
      {loading ? (
        <LoadingBlock label="Loading compliance scores…" />
      ) : visible.length === 0 ? (
        <EmptyBlock
          message={rows.length === 0 ? 'No compliance data for these filters' : 'No employee on this page matches the search'}
          hint={rows.length === 0 ? 'Requirements must be configured before scores appear' : undefined}
        />
      ) : (
        <TableShell headers={['Employee', 'Required', 'Present', 'Missing', 'Expired', 'Compliance']}>
          {visible.map((row) => (
            <tr
              key={row.employeeId}
              onClick={() => setSelected(row)}
              className="hover:bg-bg-hover transition-colors cursor-pointer"
            >
              <td className="px-3 py-2">
                <p className="text-sm text-text-primary">{row.employeeName || `Employee #${row.employeeId}`}</p>
                {row.empCode && <p className="text-[11px] text-text-muted font-mono">{row.empCode}</p>}
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">{row.required ?? 0}</td>
              <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">{row.present ?? 0}</td>
              <td
                className={`px-3 py-2 text-sm tabular-nums ${(row.missing ?? 0) > 0 ? 'text-danger' : 'text-text-secondary'}`}
              >
                {row.missing ?? 0}
              </td>
              <td
                className={`px-3 py-2 text-sm tabular-nums ${(row.expired ?? 0) > 0 ? 'text-danger' : 'text-text-secondary'}`}
              >
                {row.expired ?? 0}
              </td>
              <td className="px-3 py-2">
                <ComplianceBar pct={Number(row.pct ?? 0)} />
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      {/* Pagination -----------------------------------------------------*/}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-text-muted text-xs">
          Showing {rangeFrom}–{rangeTo} of {total.toLocaleString('en-IN')}
          {search.trim() && visible.length !== rows.length && ` · ${visible.length} match the search`}
        </p>
        <div className="flex items-center gap-2">
          <button
            className={`${BTN_SECONDARY} inline-flex items-center gap-1`}
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft size={14} /> Previous
          </button>
          <span className="text-text-secondary text-xs tabular-nums">
            Page {page} of {totalPages}
          </span>
          <button
            className={`${BTN_SECONDARY} inline-flex items-center gap-1`}
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <EmployeeDetail row={selected} onClose={() => setSelected(null)} onNavigate={onNavigate} />
        )}
      </AnimatePresence>
    </div>
  );
}
