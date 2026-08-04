import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Gavel, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import { api } from '../../../api/client';
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

function claimTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'info';
    case 'PAID':
      return 'success';
    case 'REJECTED':
      return 'danger';
    case 'SUBMITTED':
    case 'PENDING_APPROVAL':
      return 'warning';
    default:
      return 'default';
  }
}

const CLAIM_STATUSES = ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID'];
const TODAY = new Date().toISOString().slice(0, 10);

/** Statuses the server still lets a reviewer decide on. */
function isPending(status: unknown): boolean {
  const s = String(status ?? '').toUpperCase();
  return s === 'SUBMITTED' || s === 'PENDING_APPROVAL' || s === 'DRAFT';
}

// ---------------------------------------------------------------------------
// Claims tab
// ---------------------------------------------------------------------------

function NewClaimPanel({
  types,
  onClose,
  onSaved,
}: {
  types: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { employees } = useApp();
  const [form, setForm] = useState({
    employeeId: '',
    typeId: types[0] ? String(types[0].id) : '',
    amount: '',
    expenseDate: TODAY,
    description: '',
  });
  const [saving, setSaving] = useState(false);

  const selectedType = types.find((t) => String(t.id) === form.typeId) ?? null;

  const save = () => {
    const employeeId = num(form.employeeId);
    const typeId = num(form.typeId);
    const amount = num(form.amount);
    if (employeeId === null) {
      window.alert('Pick an employee');
      return;
    }
    if (typeId === null) {
      window.alert('Pick a reimbursement type');
      return;
    }
    if (amount === null || amount <= 0) {
      window.alert('Enter an amount greater than zero');
      return;
    }
    setSaving(true);
    payrollLoanApi
      .createClaim({
        employeeId,
        typeId,
        amount,
        expenseDate: form.expenseDate,
        description: form.description.trim() || null,
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
          <h3 className="text-text-primary font-semibold text-sm">New reimbursement claim</h3>
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
            <label className={LABEL_CLS}>Type</label>
            <select
              className={INPUT_CLS}
              value={form.typeId}
              onChange={(e) => setForm({ ...form, typeId: e.target.value })}
            >
              <option value="">Select…</option>
              {types.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.code} — {t.name}
                </option>
              ))}
            </select>
            {selectedType && (
              <p className="text-[11px] text-text-muted mt-1">
                Limits — monthly {selectedType.monthlyLimit === null || selectedType.monthlyLimit === undefined ? 'none' : inr(Number(selectedType.monthlyLimit))} ·
                annual {selectedType.annualLimit === null || selectedType.annualLimit === undefined ? 'none' : inr(Number(selectedType.annualLimit))}
                {selectedType.requiresReceipt ? ' · receipt required' : ''}
              </p>
            )}
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
              <label className={LABEL_CLS}>Expense date</label>
              <input
                className={INPUT_CLS}
                type="date"
                value={form.expenseDate}
                onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Description</label>
            <textarea
              className={`${INPUT_CLS} h-24`}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border-default bg-bg-secondary flex items-center justify-end gap-2 flex-shrink-0">
          <button className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button className={BTN_PRIMARY} disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Submit claim'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function DecideModal({
  claim,
  onClose,
  onDecided,
}: {
  claim: any;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [approvedAmount, setApprovedAmount] = useState(String(num(claim.amount) ?? ''));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const decide = (status: 'APPROVED' | 'REJECTED') => {
    const amount = num(approvedAmount);
    if (status === 'APPROVED' && (amount === null || amount < 0)) {
      window.alert('Enter an approved amount');
      return;
    }
    setBusy(true);
    payrollLoanApi
      .decideClaim(Number(claim.id), {
        status,
        note: note.trim() || undefined,
        approvedAmount: status === 'APPROVED' ? (amount ?? 0) : undefined,
      })
      .then(() => onDecided())
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title={`Decide ${text(claim.claimNo)}`}
      subtitle={`${text(claim.employeeName)} · ${text(claim.typeName)} · claimed ${money(claim.amount)}`}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className={BTN_SECONDARY} disabled={busy} onClick={() => decide('REJECTED')}>
            Reject
          </button>
          <button className={BTN_PRIMARY} disabled={busy} onClick={() => decide('APPROVED')}>
            Approve
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className={LABEL_CLS}>Approved amount (₹)</label>
          <input
            className={INPUT_CLS}
            type="number"
            value={approvedAmount}
            onChange={(e) => setApprovedAmount(e.target.value)}
          />
          <p className="text-[11px] text-text-muted mt-1">
            Defaults to the claimed amount. Lower it to part-approve.
          </p>
        </div>
        <div>
          <label className={LABEL_CLS}>Note</label>
          <textarea className={`${INPUT_CLS} h-24`} value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="text-[11px] text-text-muted mt-1">A note is expected when rejecting.</p>
        </div>
        {claim.description && (
          <p className="text-xs text-text-secondary">
            <span className="text-text-muted">Claim description: </span>
            {String(claim.description)}
          </p>
        )}
      </div>
    </ModalShell>
  );
}

function ClaimsTab({ types }: { types: any[] }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [deciding, setDeciding] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    payrollLoanApi
      .claims({ status: status || undefined })
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
    let pendingCount = 0;
    let pendingValue = 0;
    let approvedValue = 0;
    for (const r of rows) {
      const s = String(r.status ?? '').toUpperCase();
      if (s === 'SUBMITTED' || s === 'PENDING_APPROVAL') {
        pendingCount += 1;
        pendingValue += num(r.amount) ?? 0;
      }
      if (s === 'APPROVED' || s === 'PAID') approvedValue += num(r.approvedAmount) ?? num(r.amount) ?? 0;
    }
    return { pendingCount, pendingValue, approvedValue };
  }, [rows]);

  if (loading && rows.length === 0) return <LoadingBlock label="Loading claims…" />;
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
        <StatCard
          label="Pending claims"
          value={stats.pendingCount}
          intent={stats.pendingCount > 0 ? 'warning' : 'default'}
        />
        <StatCard label="Pending value" value={inr(stats.pendingValue)} intent="warning" />
        <StatCard label="Approved this period" value={inr(stats.approvedValue)} intent="success" />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <TabBar
          tabs={[{ id: '', label: 'All' }, ...CLAIM_STATUSES.map((s) => ({ id: s, label: prettyEnum(s) }))]}
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
            New claim
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock message="No claims match this filter" />
      ) : (
        <TableShell
          headers={['Claim no', 'Employee', 'Type', 'Amount', 'Approved', 'Expense date', 'Status', 'Payout period', '']}
        >
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-xs font-mono text-text-primary">{text(row.claimNo)}</td>
              <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                {text(row.employeeName)}
                <span className="block text-[10px] text-text-muted font-mono">{text(row.empCode)}</span>
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary">{text(row.typeName)}</td>
              <td className="px-3 py-2 text-xs font-mono text-right text-text-primary">{money(row.amount)}</td>
              <td className="px-3 py-2 text-xs font-mono text-right text-success">{money(row.approvedAmount)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{fmtDate(row.expenseDate)}</td>
              <td className="px-3 py-2">
                <Chip label={prettyEnum(row.status)} tone={claimTone(row.status)} dot />
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary">
                {row.payoutPeriodId ? `#${row.payoutPeriodId}` : '—'}
              </td>
              <td className="px-3 py-2 text-right">
                {isPending(row.status) && (
                  <button
                    className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-primary"
                    title="Decide"
                    onClick={() => setDeciding(row)}
                  >
                    <Gavel size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {deciding && (
          <DecideModal
            claim={deciding}
            onClose={() => setDeciding(null)}
            onDecided={() => {
              setDeciding(null);
              load();
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {creating && (
          <NewClaimPanel
            types={types}
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

// ---------------------------------------------------------------------------
// Types tab
// ---------------------------------------------------------------------------

interface TypeForm {
  code: string;
  name: string;
  annualLimit: string;
  monthlyLimit: string;
  requiresReceipt: boolean;
  isTaxable: boolean;
  isActive: boolean;
}

const EMPTY_TYPE: TypeForm = {
  code: '',
  name: '',
  annualLimit: '',
  monthlyLimit: '',
  requiresReceipt: true,
  isTaxable: false,
  isActive: true,
};

function TypesTab({ types, loading, error, onReload }: {
  types: any[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const [editing, setEditing] = useState<{ row: any | null; form: TypeForm } | null>(null);
  const [saving, setSaving] = useState(false);

  const save = () => {
    if (!editing) return;
    const f = editing.form;
    const body = {
      code: f.code.trim().toUpperCase(),
      name: f.name.trim(),
      annualLimit: num(f.annualLimit),
      monthlyLimit: num(f.monthlyLimit),
      requiresReceipt: f.requiresReceipt,
      isTaxable: f.isTaxable,
      isActive: f.isActive,
    };
    setSaving(true);
    // payroll.ts exposes only the read helper for these, so the write goes
    // straight through the shared api client.
    const request = editing.row
      ? api.put<any>(`/payroll-loans/reimbursement-types/${editing.row.id}`, body)
      : api.post<any>('/payroll-loans/reimbursement-types', body);
    request
      .then(() => {
        setEditing(null);
        onReload();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setSaving(false));
  };

  if (loading && types.length === 0) return <LoadingBlock label="Loading reimbursement types…" />;
  if (error) {
    return (
      <div className="space-y-3">
        <ErrorBlock message={error} />
        <button className={BTN_SECONDARY} onClick={onReload}>
          Retry
        </button>
      </div>
    );
  }

  const f = editing?.form;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <button className={BTN_SECONDARY} onClick={onReload}>
          <RefreshCw size={14} className="inline mr-1.5" />
          Refresh
        </button>
        <button className={BTN_PRIMARY} onClick={() => setEditing({ row: null, form: { ...EMPTY_TYPE } })}>
          <Plus size={14} className="inline mr-1.5" />
          New type
        </button>
      </div>

      {types.length === 0 ? (
        <EmptyBlock message="No reimbursement types configured" />
      ) : (
        <TableShell headers={['Code', 'Name', 'Annual limit', 'Monthly limit', 'Receipt', 'Taxable', 'Active', '']}>
          {types.map((row) => (
            <tr key={row.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-xs font-mono text-text-primary">{text(row.code)}</td>
              <td className="px-3 py-2 text-xs text-text-primary">{text(row.name)}</td>
              <td className="px-3 py-2 text-xs font-mono text-right text-text-secondary">{money(row.annualLimit)}</td>
              <td className="px-3 py-2 text-xs font-mono text-right text-text-secondary">{money(row.monthlyLimit)}</td>
              <td className="px-3 py-2">
                <Chip label={row.requiresReceipt ? 'Required' : 'Optional'} tone={row.requiresReceipt ? 'warning' : 'default'} />
              </td>
              <td className="px-3 py-2">
                <Chip label={row.isTaxable ? 'Taxable' : 'Tax free'} tone={row.isTaxable ? 'danger' : 'success'} />
              </td>
              <td className="px-3 py-2">
                <Chip label={row.isActive ? 'Active' : 'Inactive'} tone={row.isActive ? 'success' : 'default'} />
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-primary"
                  title="Edit"
                  onClick={() =>
                    setEditing({
                      row,
                      form: {
                        code: String(row.code ?? ''),
                        name: String(row.name ?? ''),
                        annualLimit: num(row.annualLimit) === null ? '' : String(row.annualLimit),
                        monthlyLimit: num(row.monthlyLimit) === null ? '' : String(row.monthlyLimit),
                        requiresReceipt: !!row.requiresReceipt,
                        isTaxable: !!row.isTaxable,
                        isActive: row.isActive !== false,
                      },
                    })
                  }
                >
                  <Pencil size={14} />
                </button>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {editing && f && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex justify-end"
            onClick={() => setEditing(null)}
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
                <h3 className="text-text-primary font-semibold text-sm">
                  {editing.row ? `Edit ${editing.row.code}` : 'New reimbursement type'}
                </h3>
                <button
                  onClick={() => setEditing(null)}
                  aria-label="Close"
                  className="text-text-muted hover:text-text-primary"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
                <div>
                  <label className={LABEL_CLS}>Code</label>
                  <input
                    className={INPUT_CLS}
                    value={f.code}
                    onChange={(e) => setEditing({ ...editing, form: { ...f, code: e.target.value } })}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Name</label>
                  <input
                    className={INPUT_CLS}
                    value={f.name}
                    onChange={(e) => setEditing({ ...editing, form: { ...f, name: e.target.value } })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLS}>Annual limit (₹)</label>
                    <input
                      className={INPUT_CLS}
                      type="number"
                      value={f.annualLimit}
                      onChange={(e) => setEditing({ ...editing, form: { ...f, annualLimit: e.target.value } })}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Monthly limit (₹)</label>
                    <input
                      className={INPUT_CLS}
                      type="number"
                      value={f.monthlyLimit}
                      onChange={(e) => setEditing({ ...editing, form: { ...f, monthlyLimit: e.target.value } })}
                    />
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-border-light">
                  {(
                    [
                      ['requiresReceipt', 'Receipt required'],
                      ['isTaxable', 'Taxable'],
                      ['isActive', 'Active'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={f[key]}
                        onChange={(e) => setEditing({ ...editing, form: { ...f, [key]: e.target.checked } })}
                        className="accent-[var(--color-primary)]"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="px-4 py-3 border-t border-border-default bg-bg-secondary flex items-center justify-end gap-2 flex-shrink-0">
                <button className={BTN_SECONDARY} onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className={BTN_PRIMARY} disabled={saving} onClick={save}>
                  {saving ? 'Saving…' : 'Save type'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function ReimbursementsSection() {
  const [tab, setTab] = useState('claims');
  const [types, setTypes] = useState<any[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [typesError, setTypesError] = useState<string | null>(null);

  const loadTypes = useCallback(() => {
    setTypesLoading(true);
    payrollLoanApi
      .reimbursementTypes()
      .then((res) => {
        setTypes(Array.isArray(res) ? res : []);
        setTypesError(null);
      })
      .catch((err) => setTypesError(reason(err)))
      .finally(() => setTypesLoading(false));
  }, []);

  useEffect(() => {
    loadTypes();
  }, [loadTypes]);

  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { id: 'claims', label: 'Claims' },
          { id: 'types', label: 'Types', count: types.length },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'claims' && <ClaimsTab types={types} />}
      {tab === 'types' && (
        <TypesTab types={types} loading={typesLoading} error={typesError} onReload={loadTypes} />
      )}
    </div>
  );
}
