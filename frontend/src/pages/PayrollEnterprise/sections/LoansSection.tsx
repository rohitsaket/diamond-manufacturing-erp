import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Plus, RefreshCw, X } from 'lucide-react';
import { payrollLoanApi } from '../../../api/payroll';
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
import { TabBar } from '../../../components/common/TabBar';
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

function loanTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'ACTIVE':
    case 'APPROVED':
      return 'success';
    case 'PENDING_APPROVAL':
      return 'warning';
    case 'REJECTED':
    case 'WRITTEN_OFF':
      return 'danger';
    case 'CLOSED':
    case 'FORECLOSED':
      return 'info';
    default:
      return 'default';
  }
}

function installmentTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'RECOVERED':
      return 'success';
    case 'SKIPPED':
      return 'warning';
    case 'WAIVED':
      return 'info';
    default:
      return 'default';
  }
}

/** Standard amortisation. A 0% loan is simply principal spread over the tenure. */
function estimateEmi(principal: number, annualRatePct: number, months: number): number {
  if (months <= 0) return 0;
  if (annualRatePct <= 0) return principal / months;
  const r = annualRatePct / 12 / 100;
  const factor = Math.pow(1 + r, months);
  return (principal * r * factor) / (factor - 1);
}

const LOAN_TYPES = ['PERSONAL', 'MEDICAL', 'EDUCATION', 'HOUSING', 'VEHICLE', 'EMERGENCY', 'OTHER'];
const LOAN_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'CLOSED', 'FORECLOSED', 'REJECTED'];
const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Create panel
// ---------------------------------------------------------------------------

interface LoanForm {
  employeeId: string;
  loanType: string;
  principal: string;
  interestRatePct: string;
  tenureMonths: string;
  firstEmiDate: string;
  purpose: string;
}

const EMPTY_LOAN: LoanForm = {
  employeeId: '',
  loanType: 'PERSONAL',
  principal: '',
  interestRatePct: '0',
  tenureMonths: '12',
  firstEmiDate: TODAY,
  purpose: '',
};

function NewLoanPanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { employees } = useApp();
  const [form, setForm] = useState<LoanForm>({ ...EMPTY_LOAN });
  const [saving, setSaving] = useState(false);

  const principal = num(form.principal) ?? 0;
  const rate = num(form.interestRatePct) ?? 0;
  const tenure = num(form.tenureMonths) ?? 0;
  const emi = principal > 0 && tenure > 0 ? estimateEmi(principal, rate, tenure) : null;

  const save = () => {
    const employeeId = num(form.employeeId);
    if (employeeId === null) {
      window.alert('Pick an employee');
      return;
    }
    if (principal <= 0) {
      window.alert('Principal must be greater than zero');
      return;
    }
    if (tenure < 1) {
      window.alert('Tenure must be at least one month');
      return;
    }
    setSaving(true);
    payrollLoanApi
      .createLoan({
        employeeId,
        loanType: form.loanType,
        principal,
        interestRatePct: rate,
        tenureMonths: tenure,
        firstEmiDate: form.firstEmiDate || null,
        purpose: form.purpose.trim() || null,
      })
      .then(() => onSaved())
      .catch((err) => window.alert(reason(err)))
      .finally(() => setSaving(false));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex justify-end"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <motion.div
        initial={{ x: 420 }}
        animate={{ x: 0 }}
        exit={{ x: 420 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="relative bg-bg-card border-l border-border-default w-full max-w-md h-full flex flex-col shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border-default flex items-center justify-between flex-shrink-0">
          <h3 className="text-text-primary font-semibold text-sm">New loan</h3>
          <button onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text-primary">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
          <div>
            <label className={LABEL_CLS}>Employee</label>
            <select
              className={INPUT_CLS}
              value={form.employeeId}
              onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
            >
              <option value="">Select…</option>
              {employees.map((e) => (
                <option key={e.id} value={String(e.id)}>
                  {e.fullName} ({e.empCode})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_CLS}>Loan type</label>
            <select
              className={INPUT_CLS}
              value={form.loanType}
              onChange={(e) => setForm({ ...form, loanType: e.target.value })}
            >
              {LOAN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {prettyEnum(t)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Principal (₹)</label>
              <input
                className={INPUT_CLS}
                type="number"
                value={form.principal}
                onChange={(e) => setForm({ ...form, principal: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Interest rate (% p.a.)</label>
              <input
                className={INPUT_CLS}
                type="number"
                step="0.1"
                value={form.interestRatePct}
                onChange={(e) => setForm({ ...form, interestRatePct: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Tenure (months)</label>
              <input
                className={INPUT_CLS}
                type="number"
                value={form.tenureMonths}
                onChange={(e) => setForm({ ...form, tenureMonths: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>First EMI date</label>
              <input
                className={INPUT_CLS}
                type="date"
                value={form.firstEmiDate}
                onChange={(e) => setForm({ ...form, firstEmiDate: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Purpose</label>
            <textarea
              className={`${INPUT_CLS} h-20`}
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
          </div>

          <div className="rounded-md bg-bg-secondary border border-border-light p-3">
            <p className={LABEL_CLS}>EMI</p>
            <p className="text-xl font-semibold font-mono text-text-primary">
              {emi === null ? '—' : inr(Math.round(emi))}
            </p>
            <p className="text-[11px] text-text-muted mt-1">estimate, confirmed on approval</p>
            {emi !== null && (
              <p className="text-[11px] text-text-secondary mt-1">
                Total repayable {inr(Math.round(emi * tenure))} · interest {inr(Math.round(emi * tenure - principal))}
              </p>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border-default bg-bg-secondary flex items-center justify-end gap-2 flex-shrink-0">
          <button className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button className={BTN_PRIMARY} disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Create loan'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Detail modal
// ---------------------------------------------------------------------------

function LoanDetailModal({
  loanId,
  onClose,
  onChanged,
}: {
  loanId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [loan, setLoan] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [repay, setRepay] = useState({ amount: '', date: TODAY, remarks: '' });

  const load = useCallback(() => {
    setLoading(true);
    payrollLoanApi
      .loan(loanId)
      .then((res) => {
        setLoan(res ?? null);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [loanId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = (fn: Promise<any>) => {
    setBusy(true);
    fn.then(() => {
      load();
      onChanged();
    })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const addRepayment = () => {
    const amount = num(repay.amount);
    if (amount === null || amount <= 0) {
      window.alert('Enter a repayment amount greater than zero');
      return;
    }
    setBusy(true);
    payrollLoanApi
      .addRepayment(loanId, { amount, date: repay.date || undefined, remarks: repay.remarks || undefined })
      .then(() => {
        setRepay({ amount: '', date: TODAY, remarks: '' });
        load();
        onChanged();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const schedule: any[] = (loan?.schedule ?? []) as any[];
  // The first still-pending installment is what payroll will recover next.
  const nextDueSeq = schedule.find((s) => String(s.status ?? '').toUpperCase() === 'PENDING')?.seq ?? null;
  const status = String(loan?.status ?? '').toUpperCase();

  return (
    <ModalShell
      title={loan ? `Loan #${loan.id} — ${text(loan.employeeName)}` : 'Loan'}
      subtitle={loan ? `${prettyEnum(loan.loanType)} · ${prettyEnum(loan.status)}` : null}
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      {loading && <LoadingBlock label="Loading loan…" />}
      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && loan && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Principal" value={money(loan.principal)} />
            <StatCard label="EMI" value={money(loan.emiAmount)} />
            <StatCard label="Recovered" value={money(loan.totalRecovered)} intent="success" />
            <StatCard label="Outstanding" value={money(loan.outstanding)} intent="danger" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs">
            <span className="text-text-muted">Interest rate</span>
            <span className="text-text-secondary">{num(loan.interestRatePct) ?? '—'}% p.a.</span>
            <span className="text-text-muted">Tenure</span>
            <span className="text-text-secondary">{num(loan.tenureMonths) ?? '—'} months</span>
            <span className="text-text-muted">Disbursed on</span>
            <span className="text-text-secondary">{fmtDate(loan.disbursedOn)}</span>
            <span className="text-text-muted">First EMI</span>
            <span className="text-text-secondary">{fmtDate(loan.firstEmiDate)}</span>
            <span className="text-text-muted">Purpose</span>
            <span className="text-text-secondary md:col-span-3">{text(loan.purpose)}</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {status === 'PENDING_APPROVAL' && (
              <>
                <button
                  className={BTN_PRIMARY}
                  disabled={busy}
                  onClick={() => act(payrollLoanApi.approveLoan(loanId))}
                  title="Approving generates the full EMI schedule"
                >
                  <Check size={14} className="inline mr-1.5" />
                  Approve
                </button>
                <button
                  className={BTN_SECONDARY}
                  disabled={busy}
                  onClick={() => act(payrollLoanApi.rejectLoan(loanId, window.prompt('Rejection reason') ?? ''))}
                >
                  Reject
                </button>
              </>
            )}
            {(status === 'APPROVED' || status === 'ACTIVE') && (
              <button
                className={BTN_SECONDARY}
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Foreclose this loan? Remaining installments will be closed out.')) {
                    act(payrollLoanApi.forecloseLoan(loanId));
                  }
                }}
              >
                Foreclose
              </button>
            )}
          </div>
          {status === 'PENDING_APPROVAL' && (
            <p className="text-[11px] text-text-muted">
              Approving generates the EMI schedule below from the principal, rate and tenure.
            </p>
          )}

          <div>
            <h4 className="text-text-primary text-xs font-semibold uppercase tracking-wider mb-2">
              Amortisation schedule
            </h4>
            {schedule.length === 0 ? (
              <EmptyBlock
                message="No schedule yet"
                hint="The schedule is generated when the loan is approved"
              />
            ) : (
              <TableShell headers={['#', 'Due date', 'Principal', 'Interest', 'EMI', 'Outstanding after', 'Status']}>
                {schedule.map((row) => {
                  const isNext = nextDueSeq !== null && row.seq === nextDueSeq;
                  return (
                    <tr key={row.id ?? row.seq} className={isNext ? 'bg-bg-selected' : 'hover:bg-bg-hover'}>
                      <td className="px-3 py-2 text-xs text-text-muted tabular-nums">{num(row.seq) ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                        {fmtDate(row.dueDate)}
                        {isNext && <span className="ml-2 text-[10px] text-primary font-medium">next due</span>}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-right text-text-secondary">
                        {money(row.principalComponent)}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-right text-text-secondary">
                        {money(row.interestComponent)}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-right text-text-primary font-semibold">
                        {money(row.emiAmount)}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-right text-text-secondary">
                        {money(row.outstandingAfter)}
                      </td>
                      <td className="px-3 py-2">
                        <Chip label={prettyEnum(row.status)} tone={installmentTone(row.status)} />
                      </td>
                    </tr>
                  );
                })}
              </TableShell>
            )}
          </div>

          <div className="rounded-md border border-border-default bg-bg-secondary p-3">
            <h4 className="text-text-primary text-xs font-semibold uppercase tracking-wider mb-2">
              Record a manual repayment
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label className={LABEL_CLS}>Amount (₹)</label>
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={repay.amount}
                  onChange={(e) => setRepay({ ...repay, amount: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Date</label>
                <input
                  className={INPUT_CLS}
                  type="date"
                  value={repay.date}
                  onChange={(e) => setRepay({ ...repay, date: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Remarks</label>
                <input
                  className={INPUT_CLS}
                  value={repay.remarks}
                  onChange={(e) => setRepay({ ...repay, remarks: e.target.value })}
                />
              </div>
              <button className={BTN_PRIMARY} disabled={busy} onClick={addRepayment}>
                Record repayment
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function LoansSection() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    payrollLoanApi
      .loans({ status: status || undefined })
      .then((res) => {
        setRows(Array.isArray(res) ? res : []);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    let outstanding = 0;
    let active = 0;
    let recovered = 0;
    for (const r of rows) {
      outstanding += num(r.outstanding) ?? 0;
      recovered += num(r.totalRecovered) ?? 0;
      const s = String(r.status ?? '').toUpperCase();
      if (s === 'ACTIVE' || s === 'APPROVED') active += 1;
    }
    return { outstanding, active, recovered };
  }, [rows]);

  if (loading && rows.length === 0) return <LoadingBlock label="Loading loans…" />;
  if (error) {
    return (
      <div className="space-y-3">
        <ErrorBlock message={error} />
        <button className={BTN_SECONDARY} onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total outstanding" value={inr(stats.outstanding)} intent="danger" />
        <StatCard label="Active loans" value={stats.active} />
        <StatCard label="Recovered to date" value={inr(stats.recovered)} intent="success" />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <TabBar
          tabs={[{ id: '', label: 'All' }, ...LOAN_STATUSES.map((s) => ({ id: s, label: prettyEnum(s) }))]}
          active={status}
          onChange={setStatus}
        />
        <div className="flex items-center gap-2">
          <button className={BTN_SECONDARY} onClick={load}>
            <RefreshCw size={14} className="inline mr-1.5" />
            Refresh
          </button>
          <button className={BTN_PRIMARY} onClick={() => setCreating(true)}>
            <Plus size={14} className="inline mr-1.5" />
            New loan
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock message="No loans match this filter" />
      ) : (
        <TableShell
          headers={['Employee', 'Type', 'Principal', 'Rate', 'Tenure', 'EMI', 'Recovered', 'Outstanding', 'Status']}
        >
          {rows.map((row) => (
            <tr
              key={row.id}
              className="hover:bg-bg-hover transition-colors cursor-pointer"
              onClick={() => setDetailId(Number(row.id))}
            >
              <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                {text(row.employeeName)}
                <span className="block text-[10px] text-text-muted font-mono">{text(row.empCode)}</span>
              </td>
              <td className="px-3 py-2">
                <Chip label={prettyEnum(row.loanType)} tone="primary" />
              </td>
              <td className="px-3 py-2 text-xs font-mono text-right text-text-primary">{money(row.principal)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary tabular-nums text-right">
                {num(row.interestRatePct) ?? '—'}%
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary tabular-nums text-right">
                {num(row.tenureMonths) ?? '—'}m
              </td>
              <td className="px-3 py-2 text-xs font-mono text-right text-text-secondary">{money(row.emiAmount)}</td>
              <td className="px-3 py-2 text-xs font-mono text-right text-success">{money(row.totalRecovered)}</td>
              <td className="px-3 py-2 text-xs font-mono text-right text-danger">{money(row.outstanding)}</td>
              <td className="px-3 py-2">
                <Chip label={prettyEnum(row.status)} tone={loanTone(row.status)} dot />
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {detailId !== null && (
          <LoanDetailModal loanId={detailId} onClose={() => setDetailId(null)} onChanged={load} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {creating && (
          <NewLoanPanel
            onClose={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
