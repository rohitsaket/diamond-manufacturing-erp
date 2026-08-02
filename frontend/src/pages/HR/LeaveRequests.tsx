import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, X, Check, Ban } from 'lucide-react';
import {
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
import { leaveApi } from '../../api/hrms';
import type { LeaveBalance, LeaveRequest, LeaveRequestStatus, LeaveType } from '../../types/hrms';
import { useApp } from '../../contexts/AppContext';

type StatusFilter = 'ALL' | LeaveRequestStatus;

const STATUS_FILTERS: StatusFilter[] = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

const TODAY = new Date().toISOString().slice(0, 10);

const STATUS_TONE: Record<LeaveRequestStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'default',
};

const errMsg = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

const fmtDate = (value: string): string => (value ? value.slice(0, 10) : '—');

// ---------------------------------------------------------------------------
// New request slide-in panel
// ---------------------------------------------------------------------------
interface RequestForm {
  employeeId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  reason: string;
}

function NewRequestPanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { employees } = useApp();
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<RequestForm>({
    employeeId: '',
    leaveTypeId: '',
    fromDate: TODAY,
    toDate: TODAY,
    reason: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof RequestForm, string>>>({});

  useEffect(() => {
    leaveApi
      .types()
      .then(setTypes)
      .catch((err: unknown) => window.alert(errMsg(err, 'Failed to load leave types')));
  }, []);

  useEffect(() => {
    if (!form.employeeId) {
      setBalances([]);
      return;
    }
    let cancelled = false;
    setBalanceLoading(true);
    leaveApi
      .balances(new Date().getFullYear(), Number(form.employeeId))
      .then((rows) => {
        if (!cancelled) setBalances(rows);
      })
      .catch(() => {
        if (!cancelled) setBalances([]);
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.employeeId]);

  const set = <K extends keyof RequestForm>(key: K, value: RequestForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const e: Partial<Record<keyof RequestForm, string>> = {};
    if (!form.employeeId) e.employeeId = 'Required';
    if (!form.leaveTypeId) e.leaveTypeId = 'Required';
    if (!form.fromDate) e.fromDate = 'Required';
    if (!form.toDate) e.toDate = 'Required';
    else if (form.fromDate && form.toDate < form.fromDate) e.toDate = 'Must be on or after the from date';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await leaveApi.createRequest({
        employeeId: Number(form.employeeId),
        leaveTypeId: Number(form.leaveTypeId),
        fromDate: form.fromDate,
        toDate: form.toDate,
        ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
      });
      onCreated();
      onClose();
    } catch (err) {
      window.alert(errMsg(err, 'Failed to create the leave request'));
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
          <h3 className="text-text-primary font-semibold text-sm">New Leave Request</h3>
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

          {form.employeeId && (
            <div className="rounded-md border border-border-light bg-bg-secondary p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1.5">
                Balance this year
              </p>
              {balanceLoading ? (
                <p className="text-text-muted text-[11px]">Loading balances…</p>
              ) : balances.length === 0 ? (
                <p className="text-text-muted text-[11px]">No balances allocated yet.</p>
              ) : (
                <div className="space-y-1">
                  {balances.map((b) => (
                    <div key={b.leaveTypeId} className="flex items-center justify-between">
                      <span className="text-text-secondary text-[11px] font-mono">{b.leaveTypeCode}</span>
                      <span className="text-text-primary text-[11px] font-mono">
                        {Number(b.balance).toFixed(1)} / {Number(b.allocated).toFixed(1)} left
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className={LABEL_CLS}>Leave Type</label>
            <select
              value={form.leaveTypeId}
              onChange={(e) => set('leaveTypeId', e.target.value)}
              className={`${INPUT_CLS} ${errors.leaveTypeId ? 'border-danger' : ''}`}
            >
              <option value="">Select type…</option>
              {types.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.code} — {t.name}
                </option>
              ))}
            </select>
            {errors.leaveTypeId && <p className="text-danger text-[9px] mt-0.5">{errors.leaveTypeId}</p>}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={LABEL_CLS}>From</label>
              <input
                type="date"
                value={form.fromDate}
                onChange={(e) => set('fromDate', e.target.value)}
                className={`${INPUT_CLS} ${errors.fromDate ? 'border-danger' : ''}`}
              />
              {errors.fromDate && <p className="text-danger text-[9px] mt-0.5">{errors.fromDate}</p>}
            </div>
            <div>
              <label className={LABEL_CLS}>To</label>
              <input
                type="date"
                value={form.toDate}
                onChange={(e) => set('toDate', e.target.value)}
                className={`${INPUT_CLS} ${errors.toDate ? 'border-danger' : ''}`}
              />
              {errors.toDate && <p className="text-danger text-[9px] mt-0.5">{errors.toDate}</p>}
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Reason</label>
            <textarea
              rows={3}
              value={form.reason}
              placeholder="Optional note for the approver"
              onChange={(e) => set('reason', e.target.value)}
              className={`${INPUT_CLS} resize-none`}
            />
          </div>
        </div>

        <div className="p-4 border-t border-border-default">
          <button onClick={submit} disabled={saving} className={`${BTN_PRIMARY} w-full`}>
            {saving ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Leave requests tab
// ---------------------------------------------------------------------------
export function LeaveRequests({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [rows, setRows] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    leaveApi
      .requests(status === 'ALL' ? {} : { status })
      .then(setRows)
      .catch((err: unknown) => setError(errMsg(err, 'Failed to load leave requests')))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const afterMutation = () => {
    load();
    onChanged?.();
  };

  const approve = async (req: LeaveRequest) => {
    setBusyId(req.id);
    try {
      const res = await leaveApi.approve(req.id);
      if (res.warning) window.alert(res.warning);
      afterMutation();
    } catch (err) {
      window.alert(errMsg(err, 'Failed to approve the request'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    const note = rejectNote.trim();
    if (!note) {
      window.alert('A reason is required to reject a leave request.');
      return;
    }
    setBusyId(rejecting.id);
    try {
      await leaveApi.reject(rejecting.id, note);
      setRejecting(null);
      setRejectNote('');
      afterMutation();
    } catch (err) {
      window.alert(errMsg(err, 'Failed to reject the request'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
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
              {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <button onClick={() => setShowPanel(true)} className={`${BTN_PRIMARY} flex items-center gap-2`}>
          <Plus size={14} />
          New request
        </button>
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading leave requests…" />
      ) : rows.length === 0 ? (
        <EmptyBlock
          message="No leave requests found"
          hint={status === 'ALL' ? 'Raise one with “New request”.' : 'Try a different status filter.'}
        />
      ) : (
        <TableShell headers={['Worker', 'Type', 'From → To', 'Days', 'Reason', 'Status', 'Actions']}>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2.5">
                <p className="text-text-primary text-sm font-medium">{r.employeeName}</p>
                <p className="text-text-muted text-[10px] font-mono">{r.empCode}</p>
              </td>
              <td className="px-3 py-2.5">
                <Chip label={r.leaveTypeCode} tone={r.isPaid ? 'info' : 'warning'} />
              </td>
              <td className="px-3 py-2.5 text-text-secondary text-xs font-mono whitespace-nowrap">
                {fmtDate(r.fromDate)} → {fmtDate(r.toDate)}
              </td>
              <td className="px-3 py-2.5 text-text-primary text-sm font-mono font-semibold">
                {Number(r.days).toFixed(1)}
              </td>
              <td className="px-3 py-2.5 text-text-secondary text-xs max-w-[220px] truncate">
                {r.reason || '—'}
              </td>
              <td className="px-3 py-2.5">
                <Chip label={r.status.charAt(0) + r.status.slice(1).toLowerCase()} tone={STATUS_TONE[r.status]} />
              </td>
              <td className="px-3 py-2.5">
                {r.status === 'PENDING' ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => approve(r)}
                      disabled={busyId === r.id}
                      className="text-success border border-success/30 hover:bg-success-light px-2 py-1 rounded text-xs transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <Check size={12} />
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        setRejecting(r);
                        setRejectNote('');
                      }}
                      disabled={busyId === r.id}
                      className="text-danger border border-danger/30 hover:bg-danger-light px-2 py-1 rounded text-xs transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <Ban size={12} />
                      Reject
                    </button>
                  </div>
                ) : (
                  <span className="text-text-muted text-[11px]">{r.decisionNote || '—'}</span>
                )}
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {showPanel && (
          <NewRequestPanel key="new-leave" onClose={() => setShowPanel(false)} onCreated={afterMutation} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {rejecting && (
          <ModalShell
            key="reject"
            title="Reject leave request"
            subtitle={`${rejecting.employeeName} · ${fmtDate(rejecting.fromDate)} → ${fmtDate(rejecting.toDate)}`}
            maxWidth="max-w-md"
            onClose={() => setRejecting(null)}
            footer={
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setRejecting(null)} className={BTN_SECONDARY}>
                  Cancel
                </button>
                <button
                  onClick={confirmReject}
                  disabled={busyId === rejecting.id}
                  className="px-4 py-2 rounded-md bg-danger text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  Reject request
                </button>
              </div>
            }
          >
            <label className={LABEL_CLS}>Reason (required)</label>
            <textarea
              rows={4}
              autoFocus
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Explain why this request is being rejected"
              className={`${INPUT_CLS} resize-none`}
            />
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
