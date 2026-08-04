import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AlertTriangle, Download, Mail, RefreshCw, Send, Users } from 'lucide-react';
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
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const STATUS_FILTERS = ['ALL', 'DRAFT', 'GENERATED', 'ISSUED', 'REVISED', 'CANCELLED'] as const;

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
    case 'ISSUED':
      return 'success';
    case 'GENERATED':
      return 'info';
    case 'REVISED':
      return 'warning';
    case 'CANCELLED':
      return 'danger';
    default:
      return 'default';
  }
}

/** One right-aligned monospace line of the Part B working. */
function LadderRow({
  label,
  value,
  emphasis = false,
  negative = false,
}: {
  label: string;
  value: unknown;
  emphasis?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-6 py-1.5 ${
        emphasis ? 'border-t border-border-default mt-1 pt-2' : ''
      }`}
    >
      <span className={`text-xs ${emphasis ? 'text-text-primary font-semibold' : 'text-text-secondary'}`}>
        {label}
      </span>
      <span
        className={`text-xs font-mono tabular-nums text-right ${
          emphasis ? 'text-text-primary font-semibold' : negative ? 'text-text-muted' : 'text-text-secondary'
        }`}
      >
        {negative && num(value) !== null && (num(value) ?? 0) > 0 ? `(${money(value)})` : money(value)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Form16Section() {
  const { employees } = useApp();

  const [financialYear, setFinancialYear] = useState<string>(financialYearOf());
  const [status, setStatus] = useState<string>('ALL');

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Generate
  const [genOpen, setGenOpen] = useState(false);
  const [genEmployeeId, setGenEmployeeId] = useState<string>('');
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<any>(null);

  // Detail
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [actionBusy, setActionBusy] = useState(false);
  const [emailOutcome, setEmailOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    statutoryApi
      .form16List({ financialYear, status: status === 'ALL' ? undefined : status })
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [financialYear, status]);

  useEffect(() => {
    load();
  }, [load]);

  const loadDetail = useCallback((id: number) => {
    setDetailLoading(true);
    setDetailError(null);
    statutoryApi
      .form16(id)
      .then((d) => setDetail(d ?? null))
      .catch((err) => setDetailError(reason(err)))
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    if (detailId === null) {
      setDetail(null);
      setEmailOutcome(null);
      return;
    }
    loadDetail(detailId);
  }, [detailId, loadDetail]);

  const stats = useMemo(() => {
    const upper = (v: unknown) => String(v ?? '').toUpperCase();
    const issued = rows.filter((r) => upper(r?.status) === 'ISSUED').length;
    return {
      generated: rows.length,
      issued,
      pending: rows.length - issued,
    };
  }, [rows]);

  const runGenerate = useCallback(() => {
    const employeeId = Number(genEmployeeId);
    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      setGenError('Pick an employee first');
      return;
    }
    setGenBusy(true);
    setGenError(null);
    statutoryApi
      .generateForm16({ employeeId, financialYear })
      .then(() => {
        setGenOpen(false);
        load();
      })
      .catch((err) => setGenError(reason(err)))
      .finally(() => setGenBusy(false));
  }, [genEmployeeId, financialYear, load]);

  const runBulk = useCallback(() => {
    setBulkBusy(true);
    statutoryApi
      .bulkForm16({ financialYear })
      .then((res) => {
        setBulkResult(res ?? null);
        setBulkOpen(false);
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBulkBusy(false));
  }, [financialYear, load]);

  const downloadPdf = useCallback((id: number) => {
    openAuthenticatedFile(statutoryApi.form16PdfUrl(id), 'form16.pdf').catch((err) => window.alert(reason(err)));
  }, []);

  const issue = useCallback(
    (id: number) => {
      setActionBusy(true);
      statutoryApi
        .issueForm16(id)
        .then(() => {
          if (detailId === id) loadDetail(id);
          load();
        })
        .catch((err) => window.alert(reason(err)))
        .finally(() => setActionBusy(false));
    },
    [detailId, load, loadDetail],
  );

  // The backend records a FAILED distribution with a reason when mail is off;
  // that reason is the truth and must be shown rather than a success toast.
  const email = useCallback(
    (id: number) => {
      setActionBusy(true);
      setEmailOutcome(null);
      statutoryApi
        .emailForm16(id)
        .then((res) => {
          const sent = res?.sent === true;
          const message = sent
            ? `Sent to ${text(res?.recipient)}`
            : String(res?.reason ?? 'The email was not sent and no reason was returned');
          setEmailOutcome({ ok: sent, message });
          if (!sent) window.alert(message);
          if (detailId === id) loadDetail(id);
        })
        .catch((err) => window.alert(reason(err)))
        .finally(() => setActionBusy(false));
    },
    [detailId, loadDetail],
  );

  if (firstLoad && loading) return <LoadingBlock label="Loading Form 16 certificates…" />;

  const record = detail?.record ?? null;
  const distributions: any[] = Array.isArray(detail?.distributions) ? detail.distributions : [];
  const bulkFailures: any[] = Array.isArray(bulkResult?.failures) ? bulkResult.failures : [];

  return (
    <div className="space-y-4">
      {/* Part B callout ---------------------------------------------------- */}
      <div className="rounded-md bg-warning-light border border-warning/30 px-4 py-3 flex items-start gap-2">
        <AlertTriangle size={16} className="text-warning flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-text-primary text-sm font-medium">
            Part B figures only. This is not a digitally signed statutory Form 16 — download that from TRACES.
          </p>
          <p className="text-text-secondary text-xs mt-0.5">
            Part A (the TDS deposit summary against the TAN) is issued by TRACES and is not generated here. Attach it
            before handing the certificate to an employee.
          </p>
        </div>
      </div>

      {/* Controls ---------------------------------------------------------- */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="w-44">
            <label className={LABEL_CLS} htmlFor="f16-fy">
              Financial year
            </label>
            <select
              id="f16-fy"
              className={INPUT_CLS}
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
          <div className="flex items-center gap-2 flex-wrap pb-0.5">
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
        <div className="flex items-center gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
            <span className="inline-flex items-center gap-2">
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
              Refresh
            </span>
          </button>
          <button type="button" className={BTN_SECONDARY} onClick={() => setBulkOpen(true)}>
            <span className="inline-flex items-center gap-2">
              <Users size={14} />
              Bulk generate
            </span>
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={() => {
              setGenError(null);
              setGenOpen(true);
            }}
          >
            Generate
          </button>
        </div>
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
        <StatCard label="Generated" value={stats.generated} />
        <StatCard label="Issued" value={stats.issued} intent="success" />
        <StatCard label="Pending issue" value={stats.pending} intent={stats.pending > 0 ? 'warning' : 'success'} />
      </div>

      {/* Bulk result --------------------------------------------------------- */}
      {bulkResult && (
        <div className="rounded-md border border-border-default bg-bg-card p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <p className="text-text-primary text-sm font-semibold">
              {text(bulkResult.generated)} of {text(bulkResult.requested)} certificates generated for{' '}
              {text(bulkResult.financialYear)}
            </p>
            <button
              type="button"
              className="text-text-muted text-xs hover:text-text-primary"
              onClick={() => setBulkResult(null)}
            >
              Dismiss
            </button>
          </div>
          {bulkFailures.length > 0 && (
            <div className="rounded-md bg-danger-light border border-danger/30 p-3">
              <p className="text-danger text-xs font-semibold mb-1">
                {bulkFailures.length} employee{bulkFailures.length === 1 ? '' : 's'} could not be generated
              </p>
              <ul className="space-y-0.5">
                {bulkFailures.map((f, index) => (
                  <li key={f?.employeeId ?? index} className="text-text-secondary text-xs">
                    {text(f?.employeeName ?? `Employee ${f?.employeeId}`)} — {text(f?.reason)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Table -------------------------------------------------------------- */}
      {rows.length === 0 ? (
        <EmptyBlock
          message="No Form 16 certificates for this year"
          hint="Generate one for an employee, or bulk generate for everyone with computed tax."
        />
      ) : (
        <TableShell
          headers={[
            'Employee',
            'PAN',
            'FY',
            'Certificate no',
            'Gross salary',
            'Taxable income',
            'Total tax',
            'TDS deducted',
            'Rev',
            'Status',
            'Actions',
          ]}
        >
          {rows.map((r, index) => (
            <tr
              key={r?.id ?? index}
              onClick={() => (num(r?.id) === null ? undefined : setDetailId(Number(r.id)))}
              className="hover:bg-bg-hover transition-colors cursor-pointer"
            >
              <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <span>{text(r?.employeeName)}</span>
                  {r?.hasPartA === false && <Chip label="Part A: not attached" tone="warning" />}
                </div>
                <span className="text-text-muted font-mono text-[11px]">{text(r?.employeeCode)}</span>
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary font-mono whitespace-nowrap">{text(r?.pan)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(r?.financialYear)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary font-mono whitespace-nowrap">
                {text(r?.certificateNo)}
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                {money(r?.grossSalary)}
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                {money(r?.taxableIncome)}
              </td>
              <td className="px-3 py-2 text-xs text-text-primary font-mono text-right whitespace-nowrap">
                {money(r?.totalTax)}
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                {money(r?.tdsDeducted)}
              </td>
              <td className="px-3 py-2 text-xs text-text-muted font-mono text-right whitespace-nowrap">
                {text(r?.revisionNo)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip label={text(r?.status)} tone={statusTone(r?.status)} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-primary text-xs font-medium hover:underline disabled:opacity-40"
                    disabled={num(r?.id) === null}
                    onClick={() => downloadPdf(Number(r.id))}
                  >
                    <Download size={14} />
                    PDF
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-text-secondary text-xs font-medium hover:text-text-primary disabled:opacity-40"
                    disabled={num(r?.id) === null || actionBusy}
                    onClick={() => issue(Number(r.id))}
                  >
                    <Send size={14} />
                    Issue
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-text-secondary text-xs font-medium hover:text-text-primary disabled:opacity-40"
                    disabled={num(r?.id) === null || actionBusy}
                    onClick={() => email(Number(r.id))}
                  >
                    <Mail size={14} />
                    Email
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      {/* Generate modal ----------------------------------------------------- */}
      <AnimatePresence>
        {genOpen && (
          <ModalShell
            title="Generate a Form 16"
            subtitle={`Part B working for ${financialYear}`}
            onClose={() => setGenOpen(false)}
            maxWidth="max-w-md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setGenOpen(false)}>
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
              <div>
                <label className={LABEL_CLS} htmlFor="f16-employee">
                  Employee
                </label>
                <select
                  id="f16-employee"
                  className={INPUT_CLS}
                  value={genEmployeeId}
                  onChange={(e) => setGenEmployeeId(e.target.value)}
                >
                  <option value="">Select an employee</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fullName} ({emp.empCode})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Bulk modal ---------------------------------------------------------- */}
      <AnimatePresence>
        {bulkOpen && (
          <ModalShell
            title="Bulk generate Form 16"
            subtitle={financialYear}
            onClose={() => setBulkOpen(false)}
            maxWidth="max-w-md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setBulkOpen(false)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={runBulk} disabled={bulkBusy}>
                  {bulkBusy ? 'Generating…' : 'Generate for the year'}
                </button>
              </div>
            }
          >
            <p className="text-text-secondary text-sm">
              Generates a Part B certificate for every employee with computed tax in {financialYear}. Employees
              missing a PAN or a tax computation are reported back as failures rather than being skipped silently.
            </p>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Detail modal --------------------------------------------------------- */}
      <AnimatePresence>
        {detailId !== null && (
          <ModalShell
            title={`Form 16 — ${text(record?.employeeName)}`}
            subtitle={
              record ? `${text(record.financialYear)} · ${text(record.certificateNo)} · PAN ${text(record.pan)}` : null
            }
            onClose={() => setDetailId(null)}
            maxWidth="max-w-2xl"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => downloadPdf(detailId)}>
                  <span className="inline-flex items-center gap-2">
                    <Download size={14} />
                    PDF
                  </span>
                </button>
                <button
                  type="button"
                  className={BTN_SECONDARY}
                  onClick={() => email(detailId)}
                  disabled={actionBusy}
                >
                  <span className="inline-flex items-center gap-2">
                    <Mail size={14} />
                    Email
                  </span>
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={() => issue(detailId)} disabled={actionBusy}>
                  Issue
                </button>
              </div>
            }
          >
            {detailLoading ? (
              <LoadingBlock label="Loading the certificate…" />
            ) : detailError ? (
              <div className="space-y-2">
                <ErrorBlock message={detailError} />
                <button type="button" className={BTN_SECONDARY} onClick={() => loadDetail(detailId)}>
                  Retry
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {typeof detail?.note === 'string' && detail.note !== '' && (
                  <div className="rounded-md bg-warning-light border border-warning/30 px-3 py-2">
                    <p className="text-text-secondary text-xs">{detail.note}</p>
                  </div>
                )}

                {emailOutcome && (
                  <div
                    className={`rounded-md px-3 py-2 border ${
                      emailOutcome.ok
                        ? 'bg-success-light border-success/30 text-success'
                        : 'bg-danger-light border-danger/30 text-danger'
                    }`}
                  >
                    <p className="text-xs font-medium">{emailOutcome.message}</p>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <Chip label={text(record?.status)} tone={statusTone(record?.status)} dot />
                  {record?.hasPartA === false && <Chip label="Part A: not attached" tone="warning" />}
                  {record?.isStatutorySigned === false && <Chip label="Not digitally signed" tone="warning" />}
                  {record?.regimeCode && <Chip label={`Regime ${text(record.regimeCode)}`} tone="info" />}
                  {record?.tan && <Chip label={`TAN ${text(record.tan)}`} tone="default" />}
                </div>

                {/* Part B ladder */}
                <div className="rounded-md border border-border-default bg-bg-secondary p-4">
                  <p className={LABEL_CLS}>Part B working</p>
                  <LadderRow label="Gross salary" value={record?.grossSalary} />
                  <LadderRow label="Less: exempt allowances" value={record?.exemptAllowances} negative />
                  <LadderRow label="Less: standard deduction" value={record?.standardDeduction} negative />
                  <LadderRow label="Less: professional tax" value={record?.professionalTax} negative />
                  <LadderRow label="Less: Chapter VI-A deductions" value={record?.chapterViaDeductions} negative />
                  <LadderRow label="Taxable income" value={record?.taxableIncome} emphasis />
                  <LadderRow label="Tax on income" value={record?.taxOnIncome} />
                  <LadderRow label="Less: rebate" value={record?.rebate} negative />
                  <LadderRow label="Add: surcharge" value={record?.surcharge} />
                  <LadderRow label="Add: health and education cess" value={record?.cess} />
                  <LadderRow label="Total tax" value={record?.totalTax} emphasis />
                  <LadderRow label="Tax deducted at source" value={record?.tdsDeducted} />
                  <LadderRow label="Tax payable" value={record?.taxPayable} emphasis />
                  <LadderRow label="Refund due" value={record?.refundDue} />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                  <div>
                    <p className={LABEL_CLS}>Employer</p>
                    <p className="text-text-secondary">{text(record?.employerName)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Assessment year</p>
                    <p className="text-text-secondary">{text(record?.assessmentYear)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Generated</p>
                    <p className="text-text-secondary">{fmtDate(record?.generatedAt)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Issued</p>
                    <p className="text-text-secondary">{fmtDate(record?.issuedAt)}</p>
                  </div>
                </div>

                {distributions.length > 0 && (
                  <div>
                    <p className="text-text-primary text-sm font-semibold mb-2">Distribution history</p>
                    <TableShell headers={['Channel', 'Recipient', 'Status', 'Sent', 'Message']}>
                      {distributions.map((d, index) => (
                        <tr key={d?.id ?? index} className="hover:bg-bg-hover transition-colors">
                          <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                            {text(d?.channel)}
                          </td>
                          <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                            {text(d?.recipient)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <Chip
                              label={text(d?.status)}
                              tone={
                                String(d?.status ?? '').toUpperCase() === 'FAILED'
                                  ? 'danger'
                                  : String(d?.status ?? '').toUpperCase() === 'SENT'
                                    ? 'success'
                                    : 'default'
                              }
                            />
                          </td>
                          <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDate(d?.sentAt)}</td>
                          <td className="px-3 py-2 text-xs text-text-secondary">{text(d?.errorMessage)}</td>
                        </tr>
                      ))}
                    </TableShell>
                  </div>
                )}
              </div>
            )}
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
