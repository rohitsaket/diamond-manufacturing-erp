import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Ban, Check, Pencil, Plus, RefreshCw, Send, Upload, X } from 'lucide-react';
import { compensationApi } from '../../../api/payroll';
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

function statusTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'PENDING_APPROVAL':
      return 'warning';
    case 'APPROVED':
      return 'info';
    case 'PAID':
      return 'success';
    case 'REJECTED':
    case 'CANCELLED':
      return 'danger';
    default:
      return 'default';
  }
}

function achievementTone(pct: number): string {
  if (pct >= 100) return 'text-success';
  if (pct >= 80) return 'text-warning';
  return 'text-danger';
}

const AWARD_CLASSES = ['BONUS', 'INCENTIVE', 'VARIABLE_PAY'];
const AWARD_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'];
const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Create / edit panel
// ---------------------------------------------------------------------------

interface AwardForm {
  employeeId: string;
  awardClass: string;
  awardType: string;
  title: string;
  amount: string;
  effectiveDate: string;
  payoutPeriodId: string;
  targetValue: string;
  achievedValue: string;
  reason: string;
}

const EMPTY_AWARD: AwardForm = {
  employeeId: '',
  awardClass: 'BONUS',
  awardType: 'PERFORMANCE',
  title: '',
  amount: '',
  effectiveDate: TODAY,
  payoutPeriodId: '',
  targetValue: '',
  achievedValue: '',
  reason: '',
};

function AwardPanel({
  initial,
  isEdit,
  onClose,
  onSubmit,
  saving,
}: {
  initial: AwardForm;
  isEdit: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const { employees, salaryPeriods } = useApp();
  const [form, setForm] = useState<AwardForm>(initial);

  const submit = () => {
    const employeeId = num(form.employeeId);
    const amount = num(form.amount);
    if (employeeId === null) {
      window.alert('Pick an employee');
      return;
    }
    if (amount === null || amount <= 0) {
      window.alert('Enter an amount greater than zero');
      return;
    }
    onSubmit({
      employeeId,
      awardClass: form.awardClass,
      awardType: form.awardType.trim().toUpperCase() || 'PERFORMANCE',
      title: form.title.trim() || `${prettyEnum(form.awardClass)} award`,
      amount,
      effectiveDate: form.effectiveDate,
      payoutPeriodId: num(form.payoutPeriodId),
      targetValue: num(form.targetValue),
      achievedValue: num(form.achievedValue),
      reason: form.reason.trim() || null,
    });
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
          <h3 className="text-text-primary font-semibold text-sm">{isEdit ? 'Edit award' : 'New award'}</h3>
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Class</label>
              <select
                className={INPUT_CLS}
                value={form.awardClass}
                onChange={(e) => setForm({ ...form, awardClass: e.target.value })}
              >
                {AWARD_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {prettyEnum(c)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Type</label>
              <input
                className={INPUT_CLS}
                value={form.awardType}
                onChange={(e) => setForm({ ...form, awardType: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Title</label>
            <input
              className={INPUT_CLS}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Amount (₹)</label>
              <input
                className={INPUT_CLS}
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Effective date</label>
              <input
                className={INPUT_CLS}
                type="date"
                value={form.effectiveDate}
                onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Payout period</label>
            <select
              className={INPUT_CLS}
              value={form.payoutPeriodId}
              onChange={(e) => setForm({ ...form, payoutPeriodId: e.target.value })}
            >
              <option value="">Not scheduled</option>
              {salaryPeriods.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Target</label>
              <input
                className={INPUT_CLS}
                type="number"
                value={form.targetValue}
                onChange={(e) => setForm({ ...form, targetValue: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Achieved</label>
              <input
                className={INPUT_CLS}
                type="number"
                value={form.achievedValue}
                onChange={(e) => setForm({ ...form, achievedValue: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Reason / note</label>
            <textarea
              className={`${INPUT_CLS} h-20`}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border-default bg-bg-secondary flex items-center justify-end gap-2 flex-shrink-0">
          <button className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button className={BTN_PRIMARY} disabled={saving} onClick={submit}>
            {saving ? 'Saving…' : 'Save award'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Bulk create modal
// ---------------------------------------------------------------------------

function BulkAwardModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const { employees, salaryPeriods } = useApp();
  const [raw, setRaw] = useState('');
  const [awardClass, setAwardClass] = useState('BONUS');
  const [awardType, setAwardType] = useState('PERFORMANCE');
  const [title, setTitle] = useState('Bulk award');
  const [payoutPeriodId, setPayoutPeriodId] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; notes: string[] } | null>(null);

  const byCode = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of employees) map.set(String(e.empCode).trim().toUpperCase(), e.id);
    return map;
  }, [employees]);

  const run = async () => {
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      window.alert('Paste at least one line of "employee code, amount"');
      return;
    }

    setRunning(true);
    let created = 0;
    let skipped = 0;
    const notes: string[] = [];

    for (const line of lines) {
      const parts = line.split(/[,\t;\s]+/).filter(Boolean);
      const code = String(parts[0] ?? '').toUpperCase();
      const amount = num(parts[1]);
      const employeeId = byCode.get(code);
      if (!employeeId || amount === null || amount <= 0) {
        skipped += 1;
        notes.push(`${line} — ${employeeId ? 'invalid amount' : 'unknown employee code'}`);
        continue;
      }
      try {
        await compensationApi.createAward({
          employeeId,
          awardClass,
          awardType: awardType.trim().toUpperCase() || 'PERFORMANCE',
          title: title.trim() || 'Bulk award',
          amount,
          effectiveDate: TODAY,
          payoutPeriodId: num(payoutPeriodId),
        });
        created += 1;
      } catch (err) {
        skipped += 1;
        notes.push(`${code} — ${reason(err)}`);
      }
    }

    setResult({ created, skipped, notes });
    setRunning(false);
    onDone();
  };

  return (
    <ModalShell
      title="Bulk create awards"
      subtitle="One line per award: employee code then amount"
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className={BTN_SECONDARY} onClick={onClose}>
            Close
          </button>
          <button className={BTN_PRIMARY} disabled={running} onClick={() => void run()}>
            {running ? 'Creating…' : 'Create awards'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Class</label>
            <select className={INPUT_CLS} value={awardClass} onChange={(e) => setAwardClass(e.target.value)}>
              {AWARD_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {prettyEnum(c)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Type</label>
            <input className={INPUT_CLS} value={awardType} onChange={(e) => setAwardType(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Title</label>
            <input className={INPUT_CLS} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Payout period</label>
            <select
              className={INPUT_CLS}
              value={payoutPeriodId}
              onChange={(e) => setPayoutPeriodId(e.target.value)}
            >
              <option value="">Not scheduled</option>
              {salaryPeriods.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={LABEL_CLS}>Pasted list</label>
          <textarea
            className={`${INPUT_CLS} font-mono h-40`}
            placeholder={'EMP001, 15000\nEMP002, 12500'}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        </div>

        {result && (
          <div className="rounded-md border border-border-default bg-bg-secondary p-3 space-y-1">
            <p className="text-xs text-text-primary">
              <span className="text-success font-semibold">{result.created}</span> created ·{' '}
              <span className={result.skipped > 0 ? 'text-danger font-semibold' : 'text-text-secondary'}>
                {result.skipped}
              </span>{' '}
              skipped
            </p>
            {result.notes.map((n, i) => (
              <p key={i} className="text-[11px] text-text-muted font-mono">
                {n}
              </p>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function AwardsSection() {
  const { salaryPeriods } = useApp();

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [awardClass, setAwardClass] = useState('');
  const [status, setStatus] = useState('');
  const [periodId, setPeriodId] = useState('');

  const [panel, setPanel] = useState<{ row: any | null; form: AwardForm } | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    compensationApi
      .awards({
        awardClass: awardClass || undefined,
        status: status || undefined,
        periodId: num(periodId) ?? undefined,
      })
      .then((res) => {
        setRows(Array.isArray(res) ? res : []);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [awardClass, status, periodId]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    let approvedValue = 0;
    let pending = 0;
    let paidThisPeriod = 0;
    const filterPeriod = num(periodId);
    for (const r of rows) {
      const amount = num(r.amount) ?? 0;
      const s = String(r.status ?? '').toUpperCase();
      if (s === 'APPROVED' || s === 'PAID') approvedValue += amount;
      if (s === 'PENDING_APPROVAL') pending += 1;
      if (s === 'PAID' && (filterPeriod === null || num(r.payoutPeriodId) === filterPeriod)) {
        paidThisPeriod += amount;
      }
    }
    return { approvedValue, pending, paidThisPeriod };
  }, [rows, periodId]);

  const act = (fn: Promise<any>) => {
    fn.then(() => load()).catch((err) => window.alert(reason(err)));
  };

  const submitAward = (body: Record<string, unknown>) => {
    if (!panel) return;
    setSaving(true);
    const request = panel.row
      ? compensationApi.updateAward(Number(panel.row.id), body)
      : compensationApi.createAward(body);
    request
      .then(() => {
        setPanel(null);
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setSaving(false));
  };

  if (loading && rows.length === 0) return <LoadingBlock label="Loading awards…" />;
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
        <StatCard label="Approved value" value={inr(stats.approvedValue)} intent="success" />
        <StatCard label="Pending approval" value={stats.pending} intent={stats.pending > 0 ? 'warning' : 'default'} />
        <StatCard label="Paid this period" value={inr(stats.paidThisPeriod)} intent="info" />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <TabBar
            tabs={[{ id: '', label: 'All classes' }, ...AWARD_CLASSES.map((c) => ({ id: c, label: prettyEnum(c) }))]}
            active={awardClass}
            onChange={setAwardClass}
          />
          <TabBar
            tabs={[{ id: '', label: 'Any status' }, ...AWARD_STATUSES.map((s) => ({ id: s, label: prettyEnum(s) }))]}
            active={status}
            onChange={setStatus}
          />
          <select
            className={`${INPUT_CLS} w-auto py-1.5 text-xs`}
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
          >
            <option value="">All periods</option>
            {salaryPeriods.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button className={BTN_SECONDARY} onClick={load}>
            <RefreshCw size={14} className="inline mr-1.5" />
            Refresh
          </button>
          <button className={BTN_SECONDARY} onClick={() => setBulkOpen(true)}>
            <Upload size={14} className="inline mr-1.5" />
            Bulk create
          </button>
          <button className={BTN_PRIMARY} onClick={() => setPanel({ row: null, form: { ...EMPTY_AWARD } })}>
            <Plus size={14} className="inline mr-1.5" />
            New award
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock message="No awards match these filters" />
      ) : (
        <TableShell
          headers={['Employee', 'Class', 'Type', 'Title', 'Amount', 'Target / achieved', 'Payout period', 'Status', '']}
        >
          {rows.map((row) => {
            const target = num(row.targetValue);
            const achieved = num(row.achievedValue);
            const pct = num(row.achievementPct) ?? (target && target > 0 && achieved !== null ? (achieved / target) * 100 : null);
            const s = String(row.status ?? '').toUpperCase();
            return (
              <tr key={row.id} className="hover:bg-bg-hover transition-colors">
                <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                  {text(row.employeeName)}
                  <span className="block text-[10px] text-text-muted font-mono">{text(row.empCode)}</span>
                </td>
                <td className="px-3 py-2">
                  <Chip label={prettyEnum(row.awardClass)} tone="primary" />
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary">{prettyEnum(row.awardType)}</td>
                <td className="px-3 py-2 text-xs text-text-primary">{text(row.title)}</td>
                <td className="px-3 py-2 text-xs font-mono text-text-primary text-right">{money(row.amount)}</td>
                <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                  {target === null && achieved === null ? (
                    '—'
                  ) : (
                    <>
                      <span className="font-mono">
                        {target === null ? '—' : target.toLocaleString('en-IN')} /{' '}
                        {achieved === null ? '—' : achieved.toLocaleString('en-IN')}
                      </span>
                      {pct !== null && (
                        <span className={`ml-2 font-semibold ${achievementTone(pct)}`}>{pct.toFixed(0)}%</span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary">
                  {text(row.payoutPeriodLabel)}
                  <span className="block text-[10px] text-text-muted">{fmtDate(row.effectiveDate)}</span>
                </td>
                <td className="px-3 py-2">
                  <Chip label={prettyEnum(row.status)} tone={statusTone(row.status)} dot />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 justify-end">
                    {s !== 'APPROVED' && s !== 'PAID' && (
                      <button
                        className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-primary"
                        title="Edit"
                        onClick={() =>
                          setPanel({
                            row,
                            form: {
                              employeeId: String(row.employeeId ?? ''),
                              awardClass: String(row.awardClass ?? 'BONUS'),
                              awardType: String(row.awardType ?? ''),
                              title: String(row.title ?? ''),
                              amount: String(num(row.amount) ?? ''),
                              effectiveDate: String(row.effectiveDate ?? TODAY).slice(0, 10),
                              payoutPeriodId: row.payoutPeriodId ? String(row.payoutPeriodId) : '',
                              targetValue: num(row.targetValue) === null ? '' : String(row.targetValue),
                              achievedValue: num(row.achievedValue) === null ? '' : String(row.achievedValue),
                              reason: String(row.reason ?? ''),
                            },
                          })
                        }
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {s === 'DRAFT' && (
                      <button
                        className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-primary"
                        title="Submit for approval"
                        onClick={() => act(compensationApi.submitAward(Number(row.id)))}
                      >
                        <Send size={14} />
                      </button>
                    )}
                    {s === 'PENDING_APPROVAL' && (
                      <>
                        <button
                          className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-success"
                          title="Approve"
                          onClick={() => act(compensationApi.approveAward(Number(row.id)))}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-danger"
                          title="Reject"
                          onClick={() =>
                            act(compensationApi.rejectAward(Number(row.id), window.prompt('Rejection note') ?? ''))
                          }
                        >
                          <X size={14} />
                        </button>
                      </>
                    )}
                    {s !== 'PAID' && (
                      <button
                        className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-danger"
                        title="Cancel"
                        onClick={() => {
                          if (window.confirm('Cancel this award?')) act(compensationApi.cancelAward(Number(row.id)));
                        }}
                      >
                        <Ban size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </TableShell>
      )}

      <AnimatePresence>
        {panel && (
          <AwardPanel
            initial={panel.form}
            isEdit={!!panel.row}
            saving={saving}
            onClose={() => setPanel(null)}
            onSubmit={submitAward}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {bulkOpen && <BulkAwardModal onClose={() => setBulkOpen(false)} onDone={load} />}
      </AnimatePresence>
    </div>
  );
}
