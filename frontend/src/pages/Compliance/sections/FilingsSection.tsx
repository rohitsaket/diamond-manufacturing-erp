import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AlertTriangle, Download, FileText, Info, RefreshCw, Upload } from 'lucide-react';
import { financialYearOf, statutoryApi } from '../../../api/compliance';
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
  StatCard,
  TableShell,
  inr,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const TYPE_FILTERS = [
  'ALL',
  'PF_ECR',
  'ESI_RETURN',
  'PT_RETURN',
  'LWF_RETURN',
  'TDS_24Q',
  'STATUTORY_REGISTER',
] as const;

const STATUS_FILTERS = ['ALL', 'GENERATED', 'FILED', 'ACKNOWLEDGED', 'OVERDUE', 'REJECTED'] as const;

const REGISTER_TYPES = ['WAGE_REGISTER', 'MUSTER_ROLL', 'PF_REGISTER', 'ESI_REGISTER', 'PT_REGISTER'] as const;

/** Human sentences for the machine validation codes the generators emit. */
const EXCLUSION_REASONS: Record<string, string> = {
  MISSING_IDENTIFIER: 'No UAN/IP number on record',
  INVALID_IDENTIFIER: 'The UAN/IP number on record is not a valid format',
  ZERO_WAGE: 'No wage in this period',
  MISSING_PAN: 'No PAN on record',
};

type GenKind = 'PF_ECR' | 'ESI_RETURN' | 'PT_RETURN' | 'LWF_RETURN' | 'TDS_24Q' | 'REGISTER';

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : inr(n);
}

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? '—' : s;
}

function fmtDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fyOptions(): string[] {
  const current = financialYearOf();
  const start = Number(current.slice(0, 4));
  const years: string[] = [];
  for (let offset = 1; offset >= -3; offset -= 1) {
    const y = start + offset;
    years.push(`${y}-${y + 1}`);
  }
  return years;
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

function statusTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'FILED':
    case 'ACKNOWLEDGED':
      return 'success';
    case 'GENERATED':
    case 'APPROVED':
      return 'info';
    case 'PENDING_APPROVAL':
    case 'DRAFT':
      return 'warning';
    case 'OVERDUE':
    case 'REJECTED':
      return 'danger';
    default:
      return 'default';
  }
}

function typeTone(filingType: unknown): Tone {
  switch (String(filingType ?? '').toUpperCase()) {
    case 'PF_ECR':
      return 'primary';
    case 'ESI_RETURN':
      return 'success';
    case 'PT_RETURN':
    case 'LWF_RETURN':
      return 'warning';
    case 'TDS_24Q':
      return 'danger';
    default:
      return 'default';
  }
}

const GENERATORS: { kind: GenKind; label: string; hint: string }[] = [
  { kind: 'PF_ECR', label: 'PF ECR', hint: 'Monthly EPFO electronic challan cum return' },
  { kind: 'ESI_RETURN', label: 'ESI return', hint: 'Monthly ESIC contribution file' },
  { kind: 'PT_RETURN', label: 'PT return', hint: 'Monthly professional tax return, per state' },
  { kind: 'LWF_RETURN', label: 'LWF return', hint: 'Labour welfare fund return, per state' },
  { kind: 'TDS_24Q', label: 'Form 24Q', hint: 'Quarterly TDS on salary figures' },
  { kind: 'REGISTER', label: 'Statutory register', hint: 'Registers kept for inspection' },
];

// ---------------------------------------------------------------------------

export function FilingsSection() {
  const [filingType, setFilingType] = useState<string>('ALL');
  const [status, setStatus] = useState<string>('ALL');

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Generation
  const [genKind, setGenKind] = useState<GenKind | null>(null);
  const [genMonth, setGenMonth] = useState<string>(currentMonthKey());
  const [genState, setGenState] = useState<string>('');
  const [genFy, setGenFy] = useState<string>(financialYearOf());
  const [genQuarter, setGenQuarter] = useState<number>(1);
  const [genRegister, setGenRegister] = useState<string>('WAGE_REGISTER');
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  // Mark filed
  const [filedFor, setFiledFor] = useState<number | null>(null);
  const [filedOn, setFiledOn] = useState<string>(todayIso());
  const [ackNo, setAckNo] = useState<string>('');
  const [filedBusy, setFiledBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    statutoryApi
      .filings({
        filingType: filingType === 'ALL' ? undefined : filingType,
        status: status === 'ALL' ? undefined : status,
      })
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [filingType, status]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const upper = (v: unknown) => String(v ?? '').toUpperCase();
    return {
      generated: rows.filter((r) => upper(r?.status) === 'GENERATED').length,
      filed: rows.filter((r) => upper(r?.status) === 'FILED' || upper(r?.status) === 'ACKNOWLEDGED').length,
      overdue: rows.filter((r) => upper(r?.status) === 'OVERDUE').length,
    };
  }, [rows]);

  const runGenerate = useCallback(() => {
    if (genKind === null) return;
    setGenBusy(true);
    setGenError(null);

    const call = (): Promise<any> => {
      switch (genKind) {
        case 'PF_ECR':
          return statutoryApi.generatePfEcr(genMonth);
        case 'ESI_RETURN':
          return statutoryApi.generateEsiReturn(genMonth);
        case 'PT_RETURN':
          return statutoryApi.generatePtReturn({ monthKey: genMonth, stateCode: genState.trim().toUpperCase() });
        case 'LWF_RETURN':
          return statutoryApi.generateLwfReturn({ period: genMonth, stateCode: genState.trim().toUpperCase() });
        case 'TDS_24Q':
          return statutoryApi.generate24Q({ financialYear: genFy, quarter: genQuarter });
        case 'REGISTER':
        default:
          return statutoryApi.generateRegister({ type: genRegister, financialYear: genFy, monthKey: genMonth });
      }
    };

    call()
      .then((res) => {
        setResult(res ?? null);
        setGenKind(null);
        load();
      })
      .catch((err) => setGenError(reason(err)))
      .finally(() => setGenBusy(false));
  }, [genKind, genMonth, genState, genFy, genQuarter, genRegister, load]);

  const download = useCallback((id: number) => {
    openAuthenticatedFile(statutoryApi.filingDownloadUrl(id)).catch((err) => window.alert(reason(err)));
  }, []);

  const markFiled = useCallback(() => {
    if (filedFor === null) return;
    setFiledBusy(true);
    statutoryApi
      .markFiled(filedFor, { filedOn, acknowledgementNo: ackNo || null })
      .then(() => {
        setFiledFor(null);
        setAckNo('');
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setFiledBusy(false));
  }, [filedFor, filedOn, ackNo, load]);

  // --- Generation result -----------------------------------------------------
  const fileContent = typeof result?.fileContent === 'string' ? result.fileContent : '';
  const previewLines = fileContent === '' ? [] : fileContent.split(/\r?\n/).slice(0, 15);
  const totalLines = fileContent === '' ? 0 : fileContent.split(/\r?\n/).length;
  const invalidItems: any[] = Array.isArray(result?.invalidItems) ? result.invalidItems : [];
  const resultFiling = result?.filing ?? null;

  if (firstLoad && loading) return <LoadingBlock label="Loading filings…" />;

  return (
    <div className="space-y-4">
      {/* Persistent manual-upload callout ---------------------------------- */}
      <div className="rounded-md bg-info-light border border-primary/20 px-4 py-3 flex items-start gap-2">
        <Info size={16} className="text-primary flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-text-primary text-sm font-medium">
            Files are prepared here for manual upload to the government portal. Nothing is submitted automatically.
          </p>
          <p className="text-text-secondary text-xs mt-0.5">
            Download the file, sign in to the EPFO, ESIC, state or TRACES portal, upload it there, then come back and
            record the acknowledgement against the filing.
          </p>
        </div>
      </div>

      {/* Controls ---------------------------------------------------------- */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {TYPE_FILTERS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilingType(t)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                  t === filingType
                    ? 'bg-primary-light border-primary/30 text-primary'
                    : 'border-border-default text-text-muted hover:border-text-muted'
                }`}
              >
                {t.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                  s === status
                    ? 'bg-primary-light border-primary/30 text-primary'
                    : 'border-border-default text-text-muted hover:border-text-muted'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
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

      {/* Stats -------------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Generated" value={stats.generated} intent="info" />
        <StatCard label="Filed" value={stats.filed} intent="success" />
        <StatCard label="Overdue" value={stats.overdue} intent={stats.overdue > 0 ? 'danger' : 'success'} />
      </div>

      {/* Generate panel ----------------------------------------------------- */}
      <div className="bg-bg-card border border-border-default rounded-md p-4">
        <p className="text-text-primary text-sm font-semibold mb-1">Generate a return file</p>
        <p className="text-text-muted text-[11px] mb-3">
          Every generator reads the contribution ledger for the period. Build the ledger first, or employees will be
          missing from the file.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {GENERATORS.map((g) => (
            <button
              key={g.kind}
              type="button"
              onClick={() => {
                setGenError(null);
                setGenKind(g.kind);
              }}
              className="text-left px-3 py-2 rounded-md border border-border-default bg-bg-secondary hover:bg-bg-hover hover:border-primary/30 transition-colors"
            >
              <span className="flex items-center gap-1.5 text-text-primary text-xs font-medium">
                <FileText size={14} className="text-text-muted" />
                {g.label}
              </span>
              <span className="block text-text-muted text-[10px] mt-0.5 leading-tight">{g.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Generation result --------------------------------------------------- */}
      {result && (
        <div className="space-y-3 border border-border-default rounded-md p-4 bg-bg-card">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-text-primary text-sm font-semibold">
                {text(result.fileName ?? resultFiling?.fileName)}
              </p>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {resultFiling?.filingCode && <Chip label={text(resultFiling.filingCode)} tone="primary" />}
                {resultFiling?.filingType && (
                  <Chip label={text(resultFiling.filingType)} tone={typeTone(resultFiling.filingType)} />
                )}
                {result.registerType && <Chip label={text(result.registerType)} tone="info" />}
                {num(result.includedCount) !== null && (
                  <Chip label={`${result.includedCount} included`} tone="success" />
                )}
                {num(result.excludedCount) !== null && (
                  <Chip
                    label={`${result.excludedCount} excluded`}
                    tone={(num(result.excludedCount) ?? 0) > 0 ? 'danger' : 'default'}
                  />
                )}
                {num(result.rowCount) !== null && <Chip label={`${result.rowCount} rows`} tone="default" />}
                {result.submissionMode && <Chip label={text(result.submissionMode)} tone="warning" />}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {num(resultFiling?.id) !== null && (
                <button type="button" className={BTN_SECONDARY} onClick={() => download(Number(resultFiling.id))}>
                  <span className="inline-flex items-center gap-2">
                    <Download size={14} />
                    Download
                  </span>
                </button>
              )}
              <button
                type="button"
                className="text-text-muted text-xs hover:text-text-primary"
                onClick={() => setResult(null)}
              >
                Dismiss
              </button>
            </div>
          </div>

          {typeof result.note === 'string' && result.note !== '' && (
            <p className="text-text-secondary text-xs">{result.note}</p>
          )}

          {/* Form 24Q carries the RPU/FVU caveat on the filing record itself. */}
          {typeof resultFiling?.remarks === 'string' && resultFiling.remarks !== '' && (
            <div className="rounded-md bg-warning-light border border-warning/30 px-3 py-2">
              <p className="text-warning text-xs font-medium">Before you file</p>
              <p className="text-text-secondary text-xs mt-0.5">{resultFiling.remarks}</p>
            </div>
          )}

          {/* Verbatim preview: the ECR is #~# delimited, so it must be shown
              exactly as generated for the user to eyeball it. */}
          {previewLines.length > 0 && (
            <div>
              <p className={LABEL_CLS}>
                File preview — first {previewLines.length} of {totalLines} lines
              </p>
              <pre className="bg-bg-secondary border border-border-default rounded-md p-3 text-[11px] font-mono text-text-secondary overflow-x-auto max-h-64 overflow-y-auto whitespace-pre">
                {previewLines.join('\n')}
              </pre>
            </div>
          )}

          {/* Excluded rows: a safety surface. Never collapsed, never hidden. */}
          <div className="rounded-md bg-danger-light border border-danger/30 p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={16} className="text-danger" />
              <p className="text-danger text-sm font-semibold">
                Excluded from this file
                {invalidItems.length > 0 ? ` (${invalidItems.length})` : ''}
              </p>
            </div>
            {invalidItems.length === 0 ? (
              <p className="text-text-secondary text-xs">
                Every eligible employee made it into this file. Nothing was dropped.
              </p>
            ) : (
              <>
                <ul className="space-y-1">
                  {invalidItems.map((item, index) => {
                    const code = String(item?.validationStatus ?? '').toUpperCase();
                    return (
                      <li
                        key={item?.id ?? index}
                        className="flex items-start justify-between gap-3 py-1 border-b border-danger/20 last:border-0"
                      >
                        <div className="min-w-0">
                          <p className="text-text-primary text-xs font-medium truncate">
                            {text(item?.employeeName)}
                            {item?.employeeCode ? (
                              <span className="text-text-muted font-mono ml-2">{item.employeeCode}</span>
                            ) : null}
                          </p>
                          <p className="text-text-secondary text-[11px]">
                            {EXCLUSION_REASONS[code] ?? text(item?.validationMessage ?? item?.validationStatus)}
                          </p>
                        </div>
                        <Chip label={code || 'EXCLUDED'} tone="danger" />
                      </li>
                    );
                  })}
                </ul>
                <p className="text-text-secondary text-xs mt-2">
                  Fix in Employee Profile → Statutory, then regenerate this file. These employees are not in the
                  return as it stands.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Table -------------------------------------------------------------- */}
      {rows.length === 0 ? (
        <EmptyBlock message="No filings match this filter" hint="Use the generators above to produce a return file." />
      ) : (
        <TableShell
          headers={[
            'Code',
            'Type',
            'Scheme',
            'Period',
            'Due date',
            'Employees',
            'Amount',
            'Status',
            'Submission',
            'Actions',
          ]}
        >
          {rows.map((r, index) => (
            <tr key={r?.id ?? index} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-xs text-text-primary font-mono whitespace-nowrap">
                {text(r?.filingCode)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip label={text(r?.filingType)} tone={typeTone(r?.filingType)} />
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(r?.scheme)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                {text(r?.monthKey ?? (r?.quarter ? `${r?.financialYear} Q${r.quarter}` : r?.financialYear))}
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{fmtDate(r?.dueDate)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                {text(r?.employeeCount)}
              </td>
              <td className="px-3 py-2 text-xs text-text-primary font-mono text-right whitespace-nowrap">
                {money(r?.totalAmount)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip label={text(r?.status)} tone={statusTone(r?.status)} />
              </td>
              <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{text(r?.submissionMode)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-primary text-xs font-medium hover:underline disabled:opacity-40"
                    disabled={num(r?.id) === null}
                    onClick={() => download(Number(r.id))}
                  >
                    <Download size={14} />
                    Download
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-text-secondary text-xs font-medium hover:text-text-primary disabled:opacity-40"
                    disabled={num(r?.id) === null}
                    onClick={() => {
                      setAckNo(String(r?.acknowledgementNo ?? ''));
                      setFiledOn(String(r?.filedOn ?? todayIso()).slice(0, 10));
                      setFiledFor(Number(r.id));
                    }}
                  >
                    <Upload size={14} />
                    Mark filed
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      {/* Generate modal ----------------------------------------------------- */}
      <AnimatePresence>
        {genKind !== null && (
          <ModalShell
            title={`Generate ${GENERATORS.find((g) => g.kind === genKind)?.label ?? 'file'}`}
            subtitle="Nothing is submitted — a file is produced for you to upload"
            onClose={() => setGenKind(null)}
            maxWidth="max-w-md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setGenKind(null)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={runGenerate} disabled={genBusy}>
                  {genBusy ? 'Generating…' : 'Generate'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {genError && <ErrorBlock message={genError} />}

              {(genKind === 'PF_ECR'
                || genKind === 'ESI_RETURN'
                || genKind === 'PT_RETURN'
                || genKind === 'LWF_RETURN'
                || genKind === 'REGISTER') && (
                <div>
                  <label className={LABEL_CLS} htmlFor="filing-month">
                    {genKind === 'LWF_RETURN' ? 'Period' : 'Month'}
                  </label>
                  <input
                    id="filing-month"
                    type="month"
                    className={INPUT_CLS}
                    value={genMonth}
                    onChange={(e) => setGenMonth(e.target.value)}
                  />
                </div>
              )}

              {(genKind === 'PT_RETURN' || genKind === 'LWF_RETURN') && (
                <div>
                  <label className={LABEL_CLS} htmlFor="filing-state">
                    State code
                  </label>
                  <input
                    id="filing-state"
                    className={INPUT_CLS}
                    placeholder="GJ"
                    value={genState}
                    onChange={(e) => setGenState(e.target.value)}
                  />
                </div>
              )}

              {(genKind === 'TDS_24Q' || genKind === 'REGISTER') && (
                <div>
                  <label className={LABEL_CLS} htmlFor="filing-fy">
                    Financial year
                  </label>
                  <select
                    id="filing-fy"
                    className={INPUT_CLS}
                    value={genFy}
                    onChange={(e) => setGenFy(e.target.value)}
                  >
                    {fyOptions().map((fy) => (
                      <option key={fy} value={fy}>
                        {fy}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {genKind === 'TDS_24Q' && (
                <>
                  <div>
                    <label className={LABEL_CLS} htmlFor="filing-quarter">
                      Quarter
                    </label>
                    <select
                      id="filing-quarter"
                      className={INPUT_CLS}
                      value={genQuarter}
                      onChange={(e) => setGenQuarter(Number(e.target.value))}
                    >
                      {[1, 2, 3, 4].map((q) => (
                        <option key={q} value={q}>
                          Q{q}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="rounded-md bg-warning-light border border-warning/30 px-3 py-2">
                    <p className="text-text-secondary text-xs">
                      This produces the Annexure I figures only. The{' '}
                      <span className="font-mono">.fvu</span> return itself must be prepared in the Income Tax
                      Department&apos;s Return Preparation Utility (RPU) and validated with the File Validation
                      Utility (FVU) before submission.
                    </p>
                  </div>
                </>
              )}

              {genKind === 'REGISTER' && (
                <div>
                  <label className={LABEL_CLS} htmlFor="filing-register">
                    Register type
                  </label>
                  <select
                    id="filing-register"
                    className={INPUT_CLS}
                    value={genRegister}
                    onChange={(e) => setGenRegister(e.target.value)}
                  >
                    {REGISTER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                  <p className="text-text-muted text-[11px] mt-1">
                    Registers are kept for inspection. They are not submitted to any authority, so no filing record is
                    raised.
                  </p>
                </div>
              )}
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Mark filed modal ---------------------------------------------------- */}
      <AnimatePresence>
        {filedFor !== null && (
          <ModalShell
            title="Mark the return filed"
            subtitle="Record what the portal gave you back"
            onClose={() => setFiledFor(null)}
            maxWidth="max-w-md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setFiledFor(null)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={markFiled} disabled={filedBusy}>
                  {filedBusy ? 'Saving…' : 'Mark filed'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              <div>
                <label className={LABEL_CLS} htmlFor="filed-on">
                  Filed on
                </label>
                <input
                  id="filed-on"
                  type="date"
                  className={INPUT_CLS}
                  value={filedOn}
                  onChange={(e) => setFiledOn(e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="filed-ack">
                  Acknowledgement no
                </label>
                <input
                  id="filed-ack"
                  className={INPUT_CLS}
                  value={ackNo}
                  onChange={(e) => setAckNo(e.target.value)}
                />
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
