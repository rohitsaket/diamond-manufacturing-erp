import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarPlus,
  LogIn,
  LogOut,
  ClipboardEdit,
  FileDown,
  LifeBuoy,
  Receipt,
  Laptop,
  CheckCheck,
  UserPlus,
  BarChart3,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '../../../api/client';
import { engagementApi, leaveApi } from '../../../api/hrms';
import type { LeaveType } from '../../../types/hrms';
import { useApp } from '../../../contexts/AppContext';
import { useAuth } from '../../../contexts/AuthContext';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';
import { WidgetCard } from '../WidgetCard';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Shared form modal — all three action forms are field lists over the same
// validate / submit / spinner behaviour, so they share one component.
// ---------------------------------------------------------------------------
interface SelectOption {
  value: string;
  label: string;
}

interface FormField {
  name: string;
  label: string;
  kind: 'text' | 'textarea' | 'date' | 'number' | 'select';
  required?: boolean;
  options?: SelectOption[];
  placeholder?: string;
  max?: string;
  min?: string;
  /** Half-width on md+ so date pairs sit side by side. */
  half?: boolean;
}

type FormValues = Record<string, string>;

function FormModal({
  title,
  subtitle,
  fields,
  initial,
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  subtitle?: string | null;
  fields: FormField[];
  initial?: FormValues;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (values: FormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<FormValues>(() => {
    const base: FormValues = {};
    for (const f of fields) base[f.name] = initial?.[f.name] ?? '';
    return base;
  });
  const [errors, setErrors] = useState<FormValues>({});
  const [busy, setBusy] = useState(false);

  const set = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: '' } : prev));
  };

  const validate = (): boolean => {
    const next: FormValues = {};
    for (const f of fields) {
      const raw = (values[f.name] ?? '').trim();
      if (f.required && !raw) next[f.name] = `${f.label} is required`;
      else if (f.kind === 'number' && raw && !(Number(raw) > 0))
        next[f.name] = `${f.label} must be greater than zero`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (busy) return;
    if (!validate()) return;
    setBusy(true);
    try {
      await onSubmit(values);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={title}
      subtitle={subtitle}
      onClose={busy ? () => undefined : onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={BTN_PRIMARY} onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 size={14} className="inline animate-spin mr-1.5 -mt-0.5" />}
            {submitLabel}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {fields.map((f) => {
          const err = errors[f.name];
          return (
            <div key={f.name} className={f.half ? 'md:col-span-1' : 'md:col-span-2'}>
              <label className={LABEL_CLS} htmlFor={`qa-${f.name}`}>
                {f.label}
                {f.required && <span className="text-danger ml-0.5">*</span>}
              </label>

              {f.kind === 'select' ? (
                <select
                  id={`qa-${f.name}`}
                  className={INPUT_CLS}
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                  disabled={busy}
                >
                  <option value="">Select…</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.kind === 'textarea' ? (
                <textarea
                  id={`qa-${f.name}`}
                  rows={3}
                  className={INPUT_CLS}
                  placeholder={f.placeholder}
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                  disabled={busy}
                />
              ) : (
                <input
                  id={`qa-${f.name}`}
                  type={f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'}
                  className={INPUT_CLS}
                  placeholder={f.placeholder}
                  max={f.max}
                  min={f.min}
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                  disabled={busy}
                />
              )}

              {err && <p className="text-danger text-[10px] mt-1">{err}</p>}
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Action button
// ---------------------------------------------------------------------------
function ActionButton({
  icon: Icon,
  title,
  description,
  onClick,
  disabled = false,
  muted = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick?: () => void;
  /** Truly not invokable (no endpoint reachable for this user). */
  disabled?: boolean;
  /** Looks unavailable but still opens a fallback flow. */
  muted?: boolean;
}) {
  const dim = disabled || muted;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={dim || undefined}
      className={`bg-bg-card border border-border-default rounded-md p-4 flex flex-col items-start gap-2 transition-colors text-left ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : muted
            ? 'opacity-70 hover:border-primary/30 hover:bg-bg-hover'
            : 'hover:border-primary/30 hover:bg-bg-hover'
      }`}
    >
      <span className="w-9 h-9 rounded-md bg-primary-light text-primary flex items-center justify-center">
        <Icon size={18} />
      </span>
      <span className="text-sm font-medium text-text-primary">{title}</span>
      <span className="text-text-muted text-[11px]">{description}</span>
    </button>
  );
}

type ModalKind = 'leave' | 'ticket' | 'expense' | null;

const TICKET_CATEGORIES: SelectOption[] = ['HR', 'PAYROLL', 'IT', 'FACILITY', 'OTHER'].map((v) => ({
  value: v,
  label: v,
}));
const EXPENSE_CATEGORIES: SelectOption[] = ['TRAVEL', 'FOOD', 'TOOLS', 'MEDICAL', 'OTHER'].map(
  (v) => ({ value: v, label: v }),
);
const PRIORITIES: SelectOption[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((v) => ({
  value: v,
  label: v,
}));

/**
 * Launcher for the actions HR staff and workers use most. Actions with no
 * backing endpoint are shown greyed with an explanation rather than hidden or
 * faked.
 */
export function QuickActionsSection({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { employees } = useApp();
  const { user } = useAuth();

  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalKind>(null);
  const [ticketPreset, setTicketPreset] = useState<FormValues>({});

  const load = useCallback(async () => {
    setLoading(true);
    let failure: string | null = null;
    const types = await leaveApi.types().catch((err: unknown) => {
      failure = errMsg(err);
      return [] as LeaveType[];
    });
    setLeaveTypes(Array.isArray(types) ? types : []);
    setError(failure);
    setLoading(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const employeeOptions = useMemo<SelectOption[]>(
    () =>
      (employees ?? []).map((e) => ({
        value: String(e.id),
        label: `${e.empCode} · ${e.fullName}`,
      })),
    [employees],
  );

  const leaveTypeOptions = useMemo<SelectOption[]>(
    () => (leaveTypes ?? []).map((t) => ({ value: String(t.id), label: `${t.code} · ${t.name}` })),
    [leaveTypes],
  );

  const today = localIso(new Date());
  const selfEmployeeId =
    typeof user?.employeeId === 'number' && user.employeeId > 0 ? user.employeeId : null;
  const canPunch = selfEmployeeId !== null;

  const punch = useCallback(async (kind: 'IN' | 'OUT') => {
    try {
      await api.post('/attendance/me/punch', { kind });
      window.alert(`Punch ${kind} recorded.`);
    } catch (err) {
      window.alert(errMsg(err));
    }
  }, []);

  const openTicket = useCallback((preset: FormValues = {}) => {
    setTicketPreset(preset);
    setModal('ticket');
  }, []);

  if (loading && !loaded) return <LoadingBlock label="Loading quick actions…" />;

  if (error) {
    return (
      <div className="space-y-3">
        <ErrorBlock message={error} />
        <button type="button" className={BTN_SECONDARY} onClick={() => void load()}>
          <RefreshCw size={14} className="inline mr-1.5 -mt-0.5" />
          Retry
        </button>
      </div>
    );
  }

  const gridCls = 'grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3';

  return (
    <div className="space-y-4">
      <WidgetCard title="For me" subtitle="Everyday self-service actions">
        <div className={gridCls}>
          <ActionButton
            icon={LogIn}
            title="Punch In"
            description={canPunch ? 'Record your shift start' : "Available on a worker's own login"}
            disabled={!canPunch}
            onClick={canPunch ? () => void punch('IN') : undefined}
          />
          <ActionButton
            icon={LogOut}
            title="Punch Out"
            description={canPunch ? 'Record your shift end' : "Available on a worker's own login"}
            disabled={!canPunch}
            onClick={canPunch ? () => void punch('OUT') : undefined}
          />
          <ActionButton
            icon={CalendarPlus}
            title="Apply Leave"
            description="Raise a leave request for approval"
            onClick={() => setModal('leave')}
          />
          <ActionButton
            icon={FileDown}
            title="Download Payslip"
            description="Open payroll to fetch a payslip"
            onClick={() => onNavigate('payroll')}
          />
          <ActionButton
            icon={LifeBuoy}
            title="Raise Ticket"
            description="Log an HR, payroll, IT or facility issue"
            onClick={() => openTicket({})}
          />
          <ActionButton
            icon={Receipt}
            title="Submit Expense"
            description="Claim a reimbursable expense"
            onClick={() => setModal('expense')}
          />
          <ActionButton
            icon={Laptop}
            title="Request Asset"
            description="Not tracked yet — raise a helpdesk ticket instead"
            muted
            onClick={() => openTicket({ category: 'OTHER' })}
          />
        </div>
      </WidgetCard>

      <WidgetCard title="For the team" subtitle="Supervisor and HR actions">
        <div className={gridCls}>
          <ActionButton
            icon={CheckCheck}
            title="Approve Requests"
            description="Review pending leave and approvals"
            onClick={() => onNavigate('hr')}
          />
          <ActionButton
            icon={UserPlus}
            title="Add Employee"
            description="Create a new employee record"
            onClick={() => onNavigate('employees')}
          />
          <ActionButton
            icon={ClipboardEdit}
            title="Attendance Correction"
            description="Fix a wrongly marked attendance day"
            onClick={() => onNavigate('attendance')}
          />
          <ActionButton
            icon={BarChart3}
            title="Generate Reports"
            description="Open the attendance register and exports"
            onClick={() => onNavigate('attendance')}
          />
        </div>
      </WidgetCard>

      {modal === 'leave' && (
        <FormModal
          title="Apply for leave"
          subtitle="Creates a pending request for HR approval"
          submitLabel="Submit request"
          onClose={() => setModal(null)}
          initial={{ fromDate: today, toDate: today }}
          fields={[
            { name: 'employeeId', label: 'Employee', kind: 'select', required: true, options: employeeOptions },
            {
              name: 'leaveTypeId',
              label: 'Leave type',
              kind: 'select',
              required: true,
              options: leaveTypeOptions,
            },
            { name: 'fromDate', label: 'From date', kind: 'date', required: true, half: true },
            { name: 'toDate', label: 'To date', kind: 'date', required: true, half: true },
            { name: 'reason', label: 'Reason', kind: 'textarea', placeholder: 'Optional note' },
          ]}
          onSubmit={async (values) => {
            try {
              await leaveApi.createRequest({
                employeeId: Number(values.employeeId),
                leaveTypeId: Number(values.leaveTypeId),
                fromDate: values.fromDate,
                toDate: values.toDate,
                reason: values.reason?.trim() || undefined,
              });
              window.alert('Leave request submitted.');
              setModal(null);
            } catch (err) {
              window.alert(errMsg(err));
            }
          }}
        />
      )}

      {modal === 'ticket' && (
        <FormModal
          title="Raise a helpdesk ticket"
          subtitle="Goes to the HR helpdesk queue"
          submitLabel="Raise ticket"
          onClose={() => setModal(null)}
          initial={{ category: 'HR', priority: 'MEDIUM', ...ticketPreset }}
          fields={[
            { name: 'employeeId', label: 'Employee', kind: 'select', required: true, options: employeeOptions },
            {
              name: 'category',
              label: 'Category',
              kind: 'select',
              required: true,
              options: TICKET_CATEGORIES,
              half: true,
            },
            {
              name: 'priority',
              label: 'Priority',
              kind: 'select',
              required: true,
              options: PRIORITIES,
              half: true,
            },
            { name: 'subject', label: 'Subject', kind: 'text', required: true, placeholder: 'Short summary' },
            { name: 'description', label: 'Description', kind: 'textarea', placeholder: 'Optional detail' },
          ]}
          onSubmit={async (values) => {
            try {
              await engagementApi.createTicket({
                employeeId: Number(values.employeeId),
                category: values.category,
                subject: values.subject.trim(),
                description: values.description?.trim() || null,
                priority: values.priority,
              });
              window.alert('Ticket raised.');
              setModal(null);
            } catch (err) {
              window.alert(errMsg(err));
            }
          }}
        />
      )}

      {modal === 'expense' && (
        <FormModal
          title="Submit an expense claim"
          subtitle="Sent to HR for a decision"
          submitLabel="Submit claim"
          onClose={() => setModal(null)}
          initial={{ category: 'TRAVEL', expenseDate: today }}
          fields={[
            { name: 'employeeId', label: 'Employee', kind: 'select', required: true, options: employeeOptions },
            {
              name: 'category',
              label: 'Category',
              kind: 'select',
              required: true,
              options: EXPENSE_CATEGORIES,
              half: true,
            },
            { name: 'amount', label: 'Amount (₹)', kind: 'number', required: true, min: '0', half: true },
            { name: 'expenseDate', label: 'Expense date', kind: 'date', required: true, max: today },
            { name: 'description', label: 'Description', kind: 'textarea', placeholder: 'What was it for?' },
          ]}
          onSubmit={async (values) => {
            try {
              await engagementApi.createExpense({
                employeeId: Number(values.employeeId),
                category: values.category,
                amount: Number(values.amount),
                expenseDate: values.expenseDate,
                description: values.description?.trim() || null,
              });
              window.alert('Expense claim submitted.');
              setModal(null);
            } catch (err) {
              window.alert(errMsg(err));
            }
          }}
        />
      )}
    </div>
  );
}
