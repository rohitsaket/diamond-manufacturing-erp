import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Eye, FileDown, Layers, MessageCircle, RefreshCw, Search } from 'lucide-react';
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
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function prettyEnum(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) return '—';
  return s
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

function payTone(line: any): Tone {
  if (line?.paidAt) return 'success';
  if (line?.accountVerified) return 'info';
  if (line?.managerVerified) return 'warning';
  return 'default';
}

function payLabel(line: any): string {
  if (line?.paidAt) return 'Paid';
  if (line?.accountVerified) return 'Account verified';
  if (line?.managerVerified) return 'Manager verified';
  return 'Pending';
}

/** Salary line as `/payroll/periods/:id/lines` returns it. */
interface PeriodLine {
  id: number;
  employeeId: number;
  employeeName: string;
  empCode: string;
  grossAmount?: number;
  totalDeductions?: number;
  netAmount?: number;
  totalAmount?: number;
  managerVerified?: boolean;
  accountVerified?: boolean;
  paidAt?: string | null;
  whatsapp?: string | null;
}

/** Same wa.me share pattern the legacy Payroll page uses. */
function shareOnWhatsApp(line: PeriodLine, periodLabel: string) {
  const msg = [
    `*Harene Diamond — Salary Slip*`,
    `Period: ${periodLabel}`,
    `Worker: ${line.employeeName} (${line.empCode})`,
    `Gross: ₹${Number(line.grossAmount ?? line.totalAmount ?? 0).toLocaleString('en-IN')}`,
    `Deductions: ₹${Number(line.totalDeductions ?? 0).toLocaleString('en-IN')}`,
    `Net Pay: ₹${Number(line.netAmount ?? line.totalAmount ?? 0).toLocaleString('en-IN')}`,
    `Status: ${line.paidAt ? '✅ Paid' : '⏳ Pending'}`,
    ``,
    `_Harene Diamond Manufacturing_`,
  ].join('\n');
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
}

// ---------------------------------------------------------------------------
// Payslip preview
// ---------------------------------------------------------------------------

function AmountRow({ label, value, muted = false }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-1.5">
      <span className={`text-xs ${muted ? 'text-text-muted' : 'text-text-secondary'}`}>{label}</span>
      <span className="text-xs font-mono text-right tabular-nums text-text-primary">{value}</span>
    </div>
  );
}

function ComponentColumn({ title, rows, total }: { title: string; rows: any[]; total: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border-default overflow-hidden">
      <div className="px-3 py-2 bg-bg-secondary border-b border-border-default">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{title}</p>
      </div>
      <div className="divide-y divide-border-light">
        {rows.length === 0 ? (
          <p className="px-3 py-3 text-xs text-text-muted">None</p>
        ) : (
          rows.map((r, i) => (
            <AmountRow key={`${r.code}-${i}`} label={`${text(r.name)} (${text(r.code)})`} value={money(r.amount)} />
          ))
        )}
      </div>
      <div className="px-3 py-2 bg-bg-secondary border-t border-border-default flex items-center justify-between gap-4">
        <span className="text-xs font-semibold text-text-primary">Total</span>
        <span className="text-xs font-mono font-semibold text-text-primary tabular-nums">{total}</span>
      </div>
    </div>
  );
}

function PayslipModal({ lineId, onClose }: { lineId: number; onClose: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    payrollAdminApi
      .payslip(lineId)
      .then((res) => {
        setData(res ?? null);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [lineId]);

  useEffect(() => {
    load();
  }, [load]);

  const earnings: any[] = (data?.earnings ?? []) as any[];
  const deductions: any[] = (data?.deductions ?? []) as any[];
  const employer: any[] = (data?.employerContributions ?? []) as any[];
  const totals = data?.totals ?? {};
  const employee = data?.employee ?? {};
  const period = data?.period ?? {};
  const attendance = data?.attendance ?? {};

  const downloadPdf = () => {
    setBusy(true);
    openAuthenticatedFile(payrollAdminApi.payslipPdfUrl(lineId), `payslip-${lineId}.pdf`)
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title={data ? `Payslip — ${text(employee.fullName)}` : 'Payslip'}
      subtitle={data ? `${text(period.label)} · ${text(data.company)}` : null}
      onClose={onClose}
      maxWidth="max-w-4xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className={BTN_SECONDARY} disabled={busy} onClick={downloadPdf}>
            <FileDown size={14} className="inline mr-1.5" />
            Download PDF
          </button>
          <button className={BTN_SECONDARY} onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      {loading && <LoadingBlock label="Loading payslip…" />}
      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-4">
          <div className="text-center pb-3 border-b border-border-default">
            <p className="text-text-primary text-base font-semibold">{text(data.company)}</p>
            <p className="text-text-muted text-xs">
              Payslip for {text(period.label)} · {fmtDate(period.fromDate)} to {fmtDate(period.toDate)}
            </p>
          </div>

          {data.fromLegacyColumns && (
            <p className="text-[11px] text-text-muted italic">
              This line predates component-level detail, so the breakdown is derived from the legacy summary columns.
            </p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs">
            <span className="text-text-muted">Employee</span>
            <span className="text-text-secondary">{text(employee.fullName)}</span>
            <span className="text-text-muted">Code</span>
            <span className="text-text-secondary font-mono">{text(employee.empCode)}</span>
            <span className="text-text-muted">Designation</span>
            <span className="text-text-secondary">{text(employee.designation)}</span>
            <span className="text-text-muted">Department</span>
            <span className="text-text-secondary">{text(employee.department)}</span>
            <span className="text-text-muted">PAN</span>
            <span className="text-text-secondary font-mono">{text(employee.pan)}</span>
            <span className="text-text-muted">UAN</span>
            <span className="text-text-secondary font-mono">{text(employee.uan)}</span>
            <span className="text-text-muted">Bank</span>
            <span className="text-text-secondary">{text(employee.bankName)}</span>
            <span className="text-text-muted">Joined</span>
            <span className="text-text-secondary">{fmtDate(employee.joinedAt)}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ComponentColumn title="Earnings" rows={earnings} total={money(totals.grossEarnings)} />
            <ComponentColumn title="Deductions" rows={deductions} total={money(totals.totalDeductions)} />
          </div>

          {employer.length > 0 && (
            <ComponentColumn
              title="Employer contributions"
              rows={employer}
              total={money(
                employer.reduce((sum: number, r: any) => sum + (num(r.amount) ?? 0), 0),
              )}
            />
          )}

          <div className="rounded-md border border-border-default divide-y divide-border-light">
            <AmountRow label="Gross earnings" value={money(totals.grossEarnings)} />
            <AmountRow label="Total deductions" value={money(totals.totalDeductions)} />
            <AmountRow label="Net pay" value={money(totals.netPay)} />
            <AmountRow label="Employer cost" value={money(totals.employerCost)} muted />
            <AmountRow label="Taxable income" value={money(totals.taxableIncome)} muted />
          </div>

          {data.netInWords && (
            <p className="text-xs text-text-secondary">
              <span className="text-text-muted">Net in words: </span>
              {String(data.netInWords)}
            </p>
          )}

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">Attendance</p>
            <div className="grid grid-cols-3 md:grid-cols-7 gap-2 text-center">
              {(
                [
                  ['Period days', attendance.periodDays],
                  ['Paid days', attendance.paidDays],
                  ['Present', attendance.presentDays],
                  ['Absent', attendance.absentDays],
                  ['Leave', attendance.leaveDays],
                  ['LOP', attendance.lopDays],
                  ['OT hours', attendance.otHours],
                ] as [string, unknown][]
              ).map(([label, value]) => (
                <div key={label} className="rounded-md border border-border-light bg-bg-secondary p-2">
                  <p className="text-[10px] text-text-muted">{label}</p>
                  <p className="text-sm font-mono text-text-primary tabular-nums">{num(value) ?? '—'}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Chip label={prettyEnum(data.paymentStatus)} tone={data.paymentStatus === 'PAID' ? 'success' : 'default'} />
            {data.paymentReference && (
              <span className="text-[11px] text-text-muted font-mono">Ref {String(data.paymentReference)}</span>
            )}
            {data.generatedAt && (
              <span className="text-[11px] text-text-muted">Generated {fmtDate(data.generatedAt)}</span>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function PayslipsSection() {
  const { salaryPeriods } = useApp();

  const [periodId, setPeriodId] = useState<number | null>(null);
  const [lines, setLines] = useState<PeriodLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [viewingLineId, setViewingLineId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkJob, setBulkJob] = useState<any | null>(null);

  useEffect(() => {
    if (periodId === null && salaryPeriods.length > 0) setPeriodId(salaryPeriods[0]!.id);
  }, [salaryPeriods, periodId]);

  const load = useCallback(() => {
    if (periodId === null) return;
    setLoading(true);
    api
      .get<PeriodLine[]>(`/payroll/periods/${periodId}/lines`)
      .then((res) => {
        setLines(Array.isArray(res) ? res : []);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [periodId]);

  useEffect(() => {
    load();
  }, [load]);

  const period = salaryPeriods.find((p) => p.id === periodId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (l) =>
        String(l.employeeName ?? '').toLowerCase().includes(q) ||
        String(l.empCode ?? '').toLowerCase().includes(q),
    );
  }, [lines, query]);

  const totals = useMemo(() => {
    let gross = 0;
    let net = 0;
    for (const l of filtered) {
      gross += num(l.grossAmount) ?? num(l.totalAmount) ?? 0;
      net += num(l.netAmount) ?? num(l.totalAmount) ?? 0;
    }
    return { gross, net, count: filtered.length };
  }, [filtered]);

  const bulkGenerate = () => {
    if (periodId === null) return;
    setBulkBusy(true);
    payrollAdminApi
      .bulkPayslips({ periodId })
      .then((res) => setBulkJob(res ?? null))
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBulkBusy(false));
  };

  const downloadPdf = (lineId: number) => {
    openAuthenticatedFile(payrollAdminApi.payslipPdfUrl(lineId), `payslip-${lineId}.pdf`).catch((err) =>
      window.alert(reason(err)),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className={LABEL_CLS}>Period</label>
            <select
              className={`${INPUT_CLS} w-auto min-w-52`}
              value={periodId === null ? '' : String(periodId)}
              onChange={(e) => setPeriodId(num(e.target.value))}
            >
              <option value="">Select…</option>
              {salaryPeriods.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Employee</label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                className={`${INPUT_CLS} pl-8 w-56`}
                placeholder="Name or code…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className={BTN_SECONDARY} onClick={load} disabled={periodId === null}>
            <RefreshCw size={14} className="inline mr-1.5" />
            Refresh
          </button>
          <button className={BTN_PRIMARY} disabled={bulkBusy || periodId === null} onClick={bulkGenerate}>
            <Layers size={14} className="inline mr-1.5" />
            {bulkBusy ? 'Queuing…' : 'Bulk generate'}
          </button>
        </div>
      </div>

      {bulkJob && (
        <div className="rounded-md border border-border-default bg-bg-secondary p-3">
          <p className="text-xs text-text-primary">
            Bulk payslip job queued
            {bulkJob.id || bulkJob.jobId ? (
              <>
                {' '}
                — id <span className="font-mono">{String(bulkJob.id ?? bulkJob.jobId)}</span>
              </>
            ) : null}
            .
          </p>
          <p className="text-[11px] text-text-muted mt-1">
            It runs in the background; the PDFs appear once the job finishes.
          </p>
        </div>
      )}

      {periodId === null && <EmptyBlock message="Pick a period to list its salary lines" />}
      {loading && firstLoad && <LoadingBlock label="Loading salary lines…" />}
      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!error && !firstLoad && periodId !== null && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard label="Lines" value={totals.count} />
            <StatCard label="Gross" value={inr(totals.gross)} />
            <StatCard label="Net payable" value={inr(totals.net)} intent="success" />
          </div>

          {filtered.length === 0 ? (
            <EmptyBlock message="No salary lines for this period" />
          ) : (
            <TableShell headers={['Employee', 'Gross', 'Deductions', 'Net', 'Payment status', '']}>
              {filtered.map((line) => (
                <tr key={line.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                    {text(line.employeeName)}
                    <span className="block text-[10px] text-text-muted font-mono">{text(line.empCode)}</span>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-right text-text-primary">
                    {money(line.grossAmount ?? line.totalAmount)}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-right text-danger">
                    {money(line.totalDeductions)}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-right text-text-primary font-semibold">
                    {money(line.netAmount ?? line.totalAmount)}
                  </td>
                  <td className="px-3 py-2">
                    <Chip label={payLabel(line)} tone={payTone(line)} dot />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-primary"
                        title="View payslip"
                        onClick={() => setViewingLineId(Number(line.id))}
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-primary"
                        title="Download PDF"
                        onClick={() => downloadPdf(Number(line.id))}
                      >
                        <FileDown size={14} />
                      </button>
                      <button
                        className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-success"
                        title="Share on WhatsApp"
                        onClick={() => shareOnWhatsApp(line, period?.label ?? '')}
                      >
                        <MessageCircle size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </>
      )}

      <AnimatePresence>
        {viewingLineId !== null && (
          <PayslipModal lineId={viewingLineId} onClose={() => setViewingLineId(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
