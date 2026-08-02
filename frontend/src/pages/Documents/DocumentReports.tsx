import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileWarning,
  CalendarClock,
  ShieldCheck,
  Upload,
  Download,
  History,
  HardDrive,
  UserCheck,
  Play,
  FileDown,
  Server,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { documentApi } from '../../api/documents';
import {
  PageHeader,
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
import { useApp } from '../../contexts/AppContext';
import { fetchBlobUrl } from './documentUi';

const MAX_ROWS = 500;

type ParamKey = 'dateRange' | 'days' | 'scope';

interface ReportDef {
  name: string;
  title: string;
  description: string;
  icon: LucideIcon;
  params: ParamKey;
}

const REPORTS: ReportDef[] = [
  {
    name: 'missing-documents',
    title: 'Missing documents',
    description: 'Required documents that have never been supplied, by employee.',
    icon: FileWarning,
    params: 'scope',
  },
  {
    name: 'expiring',
    title: 'Expiring documents',
    description: 'Documents whose validity lapses inside a chosen window.',
    icon: CalendarClock,
    params: 'days',
  },
  {
    name: 'verification-status',
    title: 'Verification status',
    description: 'Where each document sits in the verify and approve workflow.',
    icon: ShieldCheck,
    params: 'scope',
  },
  {
    name: 'upload-history',
    title: 'Upload history',
    description: 'Every document added in a date range, with who uploaded it.',
    icon: Upload,
    params: 'dateRange',
  },
  {
    name: 'download-history',
    title: 'Download history',
    description: 'Who downloaded which document, and when.',
    icon: Download,
    params: 'dateRange',
  },
  {
    name: 'audit-history',
    title: 'Audit history',
    description: 'The full audit trail of document actions in a date range.',
    icon: History,
    params: 'dateRange',
  },
  {
    name: 'storage-usage',
    title: 'Storage usage',
    description: 'Bytes and file counts broken down by category and type.',
    icon: HardDrive,
    params: 'scope',
  },
  {
    name: 'completeness',
    title: 'Employee completeness',
    description: 'How complete each employee document file is, with required, present, missing and expired counts.',
    icon: UserCheck,
    params: 'scope',
  },
];

/** camelCase / snake_case key -> "Camel case". */
function humanise(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
  if (!spaced) return key;
  const lower = spaced.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('en-IN') : '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function orgField(employee: unknown, key: 'department' | 'branch'): string | null {
  if (typeof employee !== 'object' || employee === null) return null;
  const value = (employee as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function StorageDrivers() {
  const [drivers, setDrivers] = useState<{ name: string; available: boolean; reason?: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    documentApi
      .storageDrivers()
      .then((rows) => {
        if (!cancelled) setDrivers(rows ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load storage drivers');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4">
      <div className="flex items-center gap-2 mb-1">
        <Server size={16} className="text-text-muted" />
        <h3 className="text-sm font-semibold text-text-primary">Storage drivers</h3>
      </div>
      <p className="text-text-muted text-xs mb-3">
        Only drivers marked available can accept uploads. Anything else is not configured on this server.
      </p>

      {error ? (
        <ErrorBlock message={error} />
      ) : drivers === null ? (
        <LoadingBlock label="Checking storage drivers…" />
      ) : drivers.length === 0 ? (
        <EmptyBlock message="No storage drivers reported" />
      ) : (
        <div className="space-y-2">
          {drivers.map((driver) => (
            <div
              key={driver.name}
              className="flex items-start justify-between gap-3 px-3 py-2 rounded-md border border-border-light bg-bg-secondary"
            >
              <div className="min-w-0">
                <p className="text-sm text-text-primary font-mono">{driver.name}</p>
                {driver.reason && <p className="text-[11px] text-text-muted mt-0.5">{driver.reason}</p>}
              </div>
              <Chip
                label={driver.available ? 'Available' : 'Not configured'}
                tone={driver.available ? 'success' : 'default'}
                dot
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DocumentReports() {
  const { employees } = useApp();

  const [selected, setSelected] = useState<ReportDef | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [days, setDays] = useState('30');
  const [department, setDepartment] = useState('');
  const [branch, setBranch] = useState('');

  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

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

  const buildParams = useCallback((): Record<string, unknown> => {
    if (!selected) return {};
    if (selected.params === 'dateRange') return { from: from || undefined, to: to || undefined };
    if (selected.params === 'days') return { days: days.trim() === '' ? undefined : Number(days) };
    return { department: department || undefined, branch: branch || undefined };
  }, [selected, from, to, days, department, branch]);

  const pick = (report: ReportDef) => {
    setSelected(report);
    setRows(null);
    setError(null);
  };

  const run = () => {
    if (!selected) return;
    setRunning(true);
    setError(null);
    documentApi
      .report(selected.name, buildParams())
      // The endpoint wraps its rows in {report, generatedAt, headers, rows, total}.
      .then((result) => setRows(result?.rows ?? []))
      .catch((err: unknown) => {
        setRows(null);
        setError(err instanceof Error ? err.message : 'Failed to run the report');
      })
      .finally(() => setRunning(false));
  };

  const downloadCsv = () => {
    if (!selected) return;
    // reportUrl is absolute; fetchBlobUrl expects a path relative to the API base.
    const absolute = documentApi.reportUrl(selected.name, buildParams());
    const marker = '/documents/reports/';
    const idx = absolute.indexOf(marker);
    const relative = idx >= 0 ? absolute.slice(idx) : absolute;

    setDownloading(true);
    fetchBlobUrl(relative)
      .then((blobUrl) => {
        const anchor = document.createElement('a');
        anchor.href = blobUrl;
        anchor.download = `${selected.name}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      })
      .catch((err: unknown) => window.alert(err instanceof Error ? err.message : 'Failed to download the CSV'))
      .finally(() => setDownloading(false));
  };

  const columns = useMemo(() => {
    const first = rows?.[0];
    if (!first) return [];
    return Object.keys(first);
  }, [rows]);

  const visibleRows = rows ? rows.slice(0, MAX_ROWS) : [];
  const truncated = rows ? rows.length > MAX_ROWS : false;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Document reports"
        subtitle="Run an operational report, review it here, then export the full result set as CSV"
      />

      {/* Report picker ---------------------------------------------------*/}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {REPORTS.map((report) => {
          const Icon = report.icon;
          const isActive = selected?.name === report.name;
          return (
            <button
              key={report.name}
              onClick={() => pick(report)}
              className={`text-left p-4 rounded-md border transition-colors ${
                isActive
                  ? 'bg-bg-selected border-primary/40'
                  : 'bg-bg-card border-border-default hover:bg-bg-hover hover:border-text-muted'
              }`}
            >
              <div className="flex items-start gap-3">
                <Icon size={18} className={isActive ? 'text-primary' : 'text-text-muted'} />
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${isActive ? 'text-primary' : 'text-text-primary'}`}>
                    {report.title}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">{report.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Parameters and run ----------------------------------------------*/}
      {selected && (
        <div className="bg-bg-card border border-border-default rounded-md p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{selected.title}</h3>
            <p className="text-text-muted text-xs mt-0.5">{selected.description}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {selected.params === 'dateRange' && (
              <>
                <div>
                  <label className={LABEL_CLS} htmlFor="report-from">
                    From
                  </label>
                  <input
                    id="report-from"
                    type="date"
                    className={INPUT_CLS}
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="report-to">
                    To
                  </label>
                  <input
                    id="report-to"
                    type="date"
                    className={INPUT_CLS}
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </div>
                <p className="text-text-muted text-[11px] self-end pb-2">
                  Leave both blank for the server default window.
                </p>
              </>
            )}

            {selected.params === 'days' && (
              <div>
                <label className={LABEL_CLS} htmlFor="report-days">
                  Expiring within (days)
                </label>
                <input
                  id="report-days"
                  type="number"
                  min={1}
                  className={INPUT_CLS}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
            )}

            {selected.params === 'scope' && (
              <>
                <div>
                  <label className={LABEL_CLS} htmlFor="report-department">
                    Department
                  </label>
                  <select
                    id="report-department"
                    className={INPUT_CLS}
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                  >
                    <option value="">All departments</option>
                    {departments.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="report-branch">
                    Branch
                  </label>
                  <select
                    id="report-branch"
                    className={INPUT_CLS}
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                  >
                    <option value="">All branches</option>
                    {branches.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                {departments.length === 0 && branches.length === 0 && (
                  <p className="text-text-muted text-[11px] self-end pb-2">
                    No departments or branches on the employee master — the report runs company-wide.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={run} disabled={running} className={`${BTN_PRIMARY} inline-flex items-center gap-2`}>
              <Play size={14} /> {running ? 'Running…' : 'Run report'}
            </button>
            <button
              onClick={downloadCsv}
              disabled={downloading}
              className={`${BTN_SECONDARY} inline-flex items-center gap-2`}
            >
              <FileDown size={14} /> {downloading ? 'Preparing…' : 'Download CSV'}
            </button>
            <span className="text-text-muted text-[11px]">The CSV always contains the full result set.</span>
          </div>
        </div>
      )}

      {/* Results ----------------------------------------------------------*/}
      {error && <ErrorBlock message={error} />}

      {selected && running && <LoadingBlock label={`Running ${selected.title.toLowerCase()}…`} />}

      {selected && !running && rows !== null && (
        <div className="space-y-2">
          {rows.length === 0 ? (
            <EmptyBlock message="The report returned no rows" hint="Try widening the parameters" />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-text-secondary text-xs">
                  {rows.length.toLocaleString('en-IN')} row{rows.length === 1 ? '' : 's'}
                  {truncated && ` · showing the first ${MAX_ROWS}`}
                </p>
              </div>
              <TableShell headers={columns.map(humanise)}>
                {visibleRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-bg-hover transition-colors">
                    {columns.map((column) => (
                      <td key={column} className="px-3 py-2 text-sm text-text-secondary align-top">
                        <span className="block max-w-[280px] truncate" title={renderCell(row[column])}>
                          {renderCell(row[column])}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </TableShell>
              {truncated && (
                <p className="text-text-muted text-[11px]">
                  Display is capped at {MAX_ROWS} rows. Download the CSV for the complete result.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {!selected && <EmptyBlock message="Select a report above" hint="Parameters and results appear once one is chosen" />}

      <StorageDrivers />
    </div>
  );
}
