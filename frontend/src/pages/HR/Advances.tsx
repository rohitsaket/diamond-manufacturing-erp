import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, X, ChevronRight } from 'lucide-react';
import {
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
  inr,
} from '../../components/common/HrmsUI';
import { ModalShell } from '../../components/common/ModalShell';
import { advanceApi } from '../../api/hrms';
import type { Advance, AdvanceRecovery, AdvanceStatus, AdvanceType } from '../../types/hrms';
import { useApp } from '../../contexts/AppContext';

type StatusFilter = 'ALL' | 'ACTIVE' | 'CLOSED';

const STATUS_FILTERS: StatusFilter[] = ['ALL', 'ACTIVE', 'CLOSED'];

const TODAY = new Date().toISOString().slice(0, 10);

const STATUS_TONE: Record<AdvanceStatus, 'success' | 'danger' | 'info'> = {
  ACTIVE: 'info',
  CLOSED: 'success',
  WRITTEN_OFF: 'danger',
};

const errMsg = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

const fmtDate = (value: string | null): string => (value ? value.slice(0, 10) : '—');

const label = (value: string): string =>
  value
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');

// ---------------------------------------------------------------------------
// Detail modal
// ---------------------------------------------------------------------------
function AdvanceDetailModal({
  advanceId,
  onClose,
  onMutated,
}: {
  advanceId: number;
  onClose: () => void;
  onMutated: () => void;
}) {
  const [advance, setAdvance] = useState<Advance | null>(null);
  const [recoveries, setRecoveries] = useState<AdvanceRecovery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [amount, setAmount] = useState('');
  const [recoveredOn, setRecoveredOn] = useState(TODAY);
  const [remarks, setRemarks] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    advanceApi
      .detail(advanceId)
      .then((res) => {
        setAdvance(res.advance);
        setRecoveries(res.recoveries);
      })
      .catch((err: unknown) => setError(errMsg(err, 'Failed to load the advance')))
      .finally(() => setLoading(false));
  }, [advanceId]);

  useEffect(() => {
    load();
  }, [load]);

  const addRecovery = async () => {
    const value = Number(amount);
    if (!amount || Number.isNaN(value) || value <= 0) {
      window.alert('Enter a recovery amount greater than zero.');
      return;
    }
    setBusy(true);
    try {
      await advanceApi.addRecovery(advanceId, {
        amount: value,
        recoveredOn: recoveredOn || TODAY,
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      });
      setAmount('');
      setRemarks('');
      load();
      onMutated();
    } catch (err) {
      window.alert(errMsg(err, 'Failed to record the recovery'));
    } finally {
      setBusy(false);
    }
  };

  const closeAdvance = async () => {
    if (!window.confirm('Close this advance? No further recoveries can be recorded against it.')) return;
    setBusy(true);
    try {
      await advanceApi.close(advanceId);
      load();
      onMutated();
    } catch (err) {
      window.alert(errMsg(err, 'Failed to close the advance'));
    } finally {
      setBusy(false);
    }
  };

  const stats: { label: string; value: string }[] = advance
    ? [
        { label: 'Amount', value: inr(Number(advance.amount)) },
        { label: 'Recovered', value: inr(Number(advance.recovered)) },
        { label: 'Outstanding', value: inr(Number(advance.outstanding)) },
        { label: 'Installment', value: inr(Number(advance.installmentAmount)) },
      ]
    : [];

  return (
    <ModalShell
      title={advance ? `${advance.employeeName} · ${label(advance.advanceType)}` : 'Advance detail'}
      subtitle={advance ? `${advance.empCode} · raised ${fmtDate(advance.advanceDate)}` : null}
      onClose={onClose}
      footer={
        <div className="space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1.5">
              Record manual recovery
            </p>
            <div className="flex items-end gap-2 flex-wrap">
              <div className="w-32">
                <label className={LABEL_CLS}>Amount</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="2000"
                  className={INPUT_CLS}
                />
              </div>
              <div className="w-40">
                <label className={LABEL_CLS}>Date</label>
                <input
                  type="date"
                  value={recoveredOn}
                  onChange={(e) => setRecoveredOn(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className={LABEL_CLS}>Remarks</label>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Cash repayment"
                  className={INPUT_CLS}
                />
              </div>
              <button
                onClick={addRecovery}
                disabled={busy || !advance || advance.status !== 'ACTIVE'}
                className={BTN_PRIMARY}
              >
                Add
              </button>
            </div>
          </div>

          {advance?.status === 'ACTIVE' && (
            <div className="flex justify-end">
              <button onClick={closeAdvance} disabled={busy} className={BTN_SECONDARY}>
                Close advance
              </button>
            </div>
          )}
        </div>
      }
    >
      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading advance…" />
      ) : !advance ? (
        <EmptyBlock message="Advance not found" />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="bg-bg-secondary border border-border-light rounded-md p-3">
                <p className="text-text-muted text-[10px] uppercase tracking-wider">{s.label}</p>
                <p
                  className={`text-sm font-mono font-semibold mt-0.5 ${
                    s.label === 'Outstanding' ? 'text-danger' : 'text-text-primary'
                  }`}
                >
                  {s.value}
                </p>
              </div>
            ))}
          </div>

          {advance.reason && (
            <p className="text-text-secondary text-xs">
              <span className="text-text-muted">Reason: </span>
              {advance.reason}
            </p>
          )}

          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">
              Recovery history
            </p>
            {recoveries.length === 0 ? (
              <EmptyBlock message="No recoveries yet" hint="Payroll deductions and manual entries appear here." />
            ) : (
              <TableShell headers={['Date', 'Period', 'Amount', 'Source', 'Remarks']}>
                {recoveries.map((r) => (
                  <tr key={r.id} className="hover:bg-bg-hover transition-colors">
                    <td className="px-3 py-2.5 text-text-secondary text-xs font-mono">{fmtDate(r.recoveredOn)}</td>
                    <td className="px-3 py-2.5 text-text-secondary text-xs">{r.periodLabel ?? '—'}</td>
                    <td className="px-3 py-2.5 text-text-primary text-sm font-mono font-semibold">
                      {inr(Number(r.amount))}
                    </td>
                    <td className="px-3 py-2.5">
                      <Chip label={label(r.source)} tone={r.source === 'PAYROLL' ? 'info' : 'default'} />
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary text-xs">{r.remarks ?? '—'}</td>
                  </tr>
                ))}
              </TableShell>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// New advance slide-in panel
// ---------------------------------------------------------------------------
interface AdvanceForm {
  employeeId: string;
  advanceType: AdvanceType;
  amount: string;
  installmentAmount: string;
  advanceDate: string;
  reason: string;
}

function NewAdvancePanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { employees } = useApp();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AdvanceForm>({
    employeeId: '',
    advanceType: 'ADVANCE',
    amount: '',
    installmentAmount: '',
    advanceDate: TODAY,
    reason: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof AdvanceForm, string>>>({});

  const set = <K extends keyof AdvanceForm>(key: K, value: AdvanceForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const e: Partial<Record<keyof AdvanceForm, string>> = {};
    const amount = Number(form.amount);
    const installment = Number(form.installmentAmount);
    if (!form.employeeId) e.employeeId = 'Required';
    if (!form.amount || Number.isNaN(amount) || amount <= 0) e.amount = 'Must be greater than zero';
    if (!form.installmentAmount || Number.isNaN(installment) || installment <= 0)
      e.installmentAmount = 'Must be greater than zero';
    else if (!Number.isNaN(amount) && amount > 0 && installment > amount)
      e.installmentAmount = 'Installment cannot exceed the advance amount';
    if (!form.advanceDate) e.advanceDate = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await advanceApi.create({
        employeeId: Number(form.employeeId),
        advanceType: form.advanceType,
        amount: Number(form.amount),
        advanceDate: form.advanceDate,
        installmentAmount: Number(form.installmentAmount),
        ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
      });
      onCreated();
      onClose();
    } catch (err) {
      window.alert(errMsg(err, 'Failed to create the advance'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: 320, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 320, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed right-0 top-0 bottom-0 z-50 w-80 bg-bg-card border-l border-border-default flex flex-col"
      >
        <div className="p-4 border-b border-border-default flex items-center justify-between">
          <h3 className="text-text-primary font-semibold text-sm">New Advance / Loan</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
          <div>
            <label className={LABEL_CLS}>Employee</label>
            <select
              value={form.employeeId}
              onChange={(e) => set('employeeId', e.target.value)}
              className={`${INPUT_CLS} ${errors.employeeId ? 'border-danger' : ''}`}
            >
              <option value="">Select employee…</option>
              {employees
                .filter((e) => e.workStatus === 'WORKING')
                .map((e) => (
                  <option key={e.id} value={String(e.id)}>
                    {e.fullName} ({e.empCode})
                  </option>
                ))}
            </select>
            {errors.employeeId && <p className="text-danger text-[9px] mt-0.5">{errors.employeeId}</p>}
          </div>

          <div>
            <label className={LABEL_CLS}>Type</label>
            <select
              value={form.advanceType}
              onChange={(e) => set('advanceType', e.target.value as AdvanceType)}
              className={INPUT_CLS}
            >
              <option value="ADVANCE">Advance</option>
              <option value="LOAN">Loan</option>
            </select>
          </div>

          <div>
            <label className={LABEL_CLS}>Amount</label>
            <input
              type="number"
              min="0"
              step="1"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              placeholder="20000"
              className={`${INPUT_CLS} ${errors.amount ? 'border-danger' : ''}`}
            />
            {errors.amount && <p className="text-danger text-[9px] mt-0.5">{errors.amount}</p>}
          </div>

          <div>
            <label className={LABEL_CLS}>Monthly Installment</label>
            <input
              type="number"
              min="0"
              step="1"
              value={form.installmentAmount}
              onChange={(e) => set('installmentAmount', e.target.value)}
              placeholder="2000"
              className={`${INPUT_CLS} ${errors.installmentAmount ? 'border-danger' : ''}`}
            />
            {errors.installmentAmount && (
              <p className="text-danger text-[9px] mt-0.5">{errors.installmentAmount}</p>
            )}
          </div>

          <div>
            <label className={LABEL_CLS}>Date</label>
            <input
              type="date"
              value={form.advanceDate}
              onChange={(e) => set('advanceDate', e.target.value)}
              className={`${INPUT_CLS} ${errors.advanceDate ? 'border-danger' : ''}`}
            />
            {errors.advanceDate && <p className="text-danger text-[9px] mt-0.5">{errors.advanceDate}</p>}
          </div>

          <div>
            <label className={LABEL_CLS}>Reason</label>
            <textarea
              rows={3}
              value={form.reason}
              onChange={(e) => set('reason', e.target.value)}
              placeholder="Optional note"
              className={`${INPUT_CLS} resize-none`}
            />
          </div>
        </div>

        <div className="p-4 border-t border-border-default">
          <button onClick={submit} disabled={saving} className={`${BTN_PRIMARY} w-full`}>
            {saving ? 'Saving…' : 'Create Advance'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Advances tab
// ---------------------------------------------------------------------------
export function Advances() {
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [rows, setRows] = useState<Advance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    advanceApi
      .list(status === 'ALL' ? {} : { status })
      .then(setRows)
      .catch((err: unknown) => setError(errMsg(err, 'Failed to load advances')))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    let outstanding = 0;
    let recovered = 0;
    let active = 0;
    for (const a of rows) {
      outstanding += Number(a.outstanding) || 0;
      recovered += Number(a.recovered) || 0;
      if (a.status === 'ACTIVE') active += 1;
    }
    return { outstanding, recovered, active };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total outstanding" value={inr(totals.outstanding)} intent="danger" />
        <StatCard label="Active advances" value={totals.active} hint={`${rows.length} in view`} />
        <StatCard label="Recovered to date" value={inr(totals.recovered)} intent="success" />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                status === s
                  ? 'bg-primary-light border-primary/30 text-primary'
                  : 'border-border-default text-text-muted hover:border-text-muted'
              }`}
            >
              {s === 'ALL' ? 'All' : label(s)}
            </button>
          ))}
        </div>
        <button onClick={() => setShowPanel(true)} className={`${BTN_PRIMARY} flex items-center gap-2`}>
          <Plus size={14} />
          New advance
        </button>
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading advances…" />
      ) : rows.length === 0 ? (
        <EmptyBlock
          message="No advances found"
          hint={status === 'ALL' ? 'Issue one with “New advance”.' : 'Try a different status filter.'}
        />
      ) : (
        <TableShell
          headers={['Worker', 'Type', 'Date', 'Amount', 'Installment', 'Recovered', 'Outstanding', 'Status', '']}
        >
          {rows.map((a) => (
            <tr
              key={a.id}
              onClick={() => setDetailId(a.id)}
              className="hover:bg-bg-hover transition-colors cursor-pointer"
            >
              <td className="px-3 py-2.5">
                <p className="text-text-primary text-sm font-medium">{a.employeeName}</p>
                <p className="text-text-muted text-[10px] font-mono">{a.empCode}</p>
              </td>
              <td className="px-3 py-2.5">
                <Chip label={label(a.advanceType)} tone={a.advanceType === 'LOAN' ? 'warning' : 'info'} />
              </td>
              <td className="px-3 py-2.5 text-text-secondary text-xs font-mono">{fmtDate(a.advanceDate)}</td>
              <td className="px-3 py-2.5 text-text-primary text-sm font-mono">{inr(Number(a.amount))}</td>
              <td className="px-3 py-2.5 text-text-secondary text-xs font-mono">
                {inr(Number(a.installmentAmount))}
              </td>
              <td className="px-3 py-2.5 text-success text-xs font-mono">{inr(Number(a.recovered))}</td>
              <td className="px-3 py-2.5 font-mono text-danger font-semibold text-sm">
                {inr(Number(a.outstanding))}
              </td>
              <td className="px-3 py-2.5">
                <Chip label={label(a.status)} tone={STATUS_TONE[a.status]} />
              </td>
              <td className="px-3 py-2.5 text-text-muted">
                <ChevronRight size={16} />
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {showPanel && (
          <NewAdvancePanel key="new-advance" onClose={() => setShowPanel(false)} onCreated={load} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detailId !== null && (
          <AdvanceDetailModal
            key={detailId}
            advanceId={detailId}
            onClose={() => setDetailId(null)}
            onMutated={load}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
