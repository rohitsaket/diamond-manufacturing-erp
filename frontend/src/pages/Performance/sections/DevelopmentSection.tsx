import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { GraduationCap, Plus, Trash2 } from 'lucide-react';
import { performanceApi, talentApi } from '../../../api/performance';
import { api } from '../../../api/client';
import { orgApi } from '../../../api/organization';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------
// The talentApi helpers for plan items point at /talent/items/:id, but the
// backend actually serves /talent/development-plans/items/:id (and the plan
// detail GET has no helper at all). These wrappers use the verified routes.
// ---------------------------------------------------------------------------
const devApi = {
  planDetail: (id: number) => api.get<any>(`/talent/development-plans/${id}`),
  updateItem: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/talent/development-plans/items/${id}`, body),
  deleteItem: (id: number) => api.delete<any>(`/talent/development-plans/items/${id}`),
};

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const PLAN_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'];
const ITEM_TYPES = ['TRAINING', 'CERTIFICATION', 'MENTORING', 'PROJECT', 'READING', 'OTHER'];
const ITEM_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

const PLAN_TONE: Record<string, Tone> = {
  DRAFT: 'default',
  ACTIVE: 'info',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

const ITEM_TYPE_TONE: Record<string, Tone> = {
  TRAINING: 'info',
  CERTIFICATION: 'primary',
  MENTORING: 'success',
  PROJECT: 'warning',
  READING: 'default',
  OTHER: 'default',
};

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

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

// ---------------------------------------------------------------------------

export function DevelopmentSection() {
  const { employees } = useApp();
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('ALL');
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<any | null | 'new'>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    talentApi
      .developmentPlans({
        employeeId: employeeId ? Number(employeeId) : undefined,
        status: status === 'ALL' ? undefined : status,
      })
      .then((rows) => setPlans(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [employeeId, status]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingBlock label="Loading development plans…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="w-64">
            <label className={LABEL_CLS} htmlFor="dp-emp">
              Employee
            </label>
            <select id="dp-emp" className={INPUT_CLS} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">All employees</option>
              {(employees ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.empCode} · {emp.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 flex-wrap pb-0.5">
            {['ALL', ...PLAN_STATUSES].map((s) => (
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
        <button type="button" className={BTN_PRIMARY} onClick={() => setEditing('new')}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} /> New plan
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

      {!error && plans.length === 0 && (
        <EmptyBlock message="No development plans for these filters" hint="Create a plan to track an employee's growth path." />
      )}

      {!error && plans.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {plans.map((p) => {
            const progress = Math.max(0, Math.min(100, Number(p.progressPct ?? 0)));
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setDetailId(Number(p.id))}
                className="text-left bg-bg-card border border-border-default rounded-md p-4 hover:border-primary/40 transition-colors space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-text-primary text-sm font-semibold flex items-center gap-1.5">
                    <GraduationCap size={15} className="text-primary" /> {text(p.title)}
                  </p>
                  <Chip label={text(p.status)} tone={PLAN_TONE[p.status] ?? 'default'} dot />
                </div>
                <p className="text-text-secondary text-xs">{text(p.employeeName)}</p>
                <p className="text-text-muted text-xs">{text(p.careerGoal)}</p>
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-text-muted">
                  {p.targetRoleName && <Chip label={`Target: ${p.targetRoleName}`} tone="primary" />}
                  {p.mentorName && <span>Mentor: {p.mentorName}</span>}
                </div>
                <div>
                  <div className="flex items-center justify-between text-[11px] text-text-muted mb-1">
                    <span>
                      {fmtDate(p.startDate)} – {fmtDate(p.endDate)}
                    </span>
                    <span className="font-mono">{progress}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {editing !== null && (
          <PlanEditorModal
            plan={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        )}
        {detailId !== null && (
          <PlanDetailModal
            planId={detailId}
            onClose={() => setDetailId(null)}
            onChanged={load}
            onEdit={(plan) => {
              setDetailId(null);
              setEditing(plan);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit plan
// ---------------------------------------------------------------------------

function PlanEditorModal({
  plan,
  onClose,
  onSaved,
}: {
  plan: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { employees } = useApp();
  const [cycles, setCycles] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);

  const [employeeId, setEmployeeId] = useState(plan?.employeeId ? String(plan.employeeId) : '');
  const [title, setTitle] = useState<string>(plan?.title ?? '');
  const [careerGoal, setCareerGoal] = useState<string>(plan?.careerGoal ?? '');
  const [targetRoleId, setTargetRoleId] = useState(plan?.targetRoleId ? String(plan.targetRoleId) : '');
  const [mentorId, setMentorId] = useState(plan?.mentorEmployeeId ? String(plan.mentorEmployeeId) : '');
  const [cycleId, setCycleId] = useState(plan?.cycleId ? String(plan.cycleId) : '');
  const [startDate, setStartDate] = useState<string>(plan?.startDate ? String(plan.startDate).slice(0, 10) : '');
  const [endDate, setEndDate] = useState<string>(plan?.endDate ? String(plan.endDate).slice(0, 10) : '');
  const [status, setStatus] = useState<string>(plan?.status ?? 'DRAFT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    performanceApi
      .cycles()
      .then((rows) => setCycles(Array.isArray(rows) ? rows : []))
      .catch(() => setCycles([]));
    orgApi.jobRoles
      .list()
      .then((rows: any) => setRoles(Array.isArray(rows) ? rows : []))
      .catch(() => setRoles([]));
  }, []);

  const save = () => {
    setBusy(true);
    setError(null);
    const body = {
      employeeId: Number(employeeId),
      title: title.trim(),
      careerGoal: careerGoal.trim() || null,
      targetRoleId: targetRoleId ? Number(targetRoleId) : null,
      mentorEmployeeId: mentorId ? Number(mentorId) : null,
      cycleId: cycleId ? Number(cycleId) : null,
      startDate: startDate || null,
      endDate: endDate || null,
      status,
    };
    const call = plan ? talentApi.updateDevelopmentPlan(Number(plan.id), body) : talentApi.createDevelopmentPlan(body);
    call
      .then(() => onSaved())
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title={plan ? `Edit plan — ${plan.title}` : 'New development plan'}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !employeeId || !title.trim()} onClick={save}>
            {busy ? 'Saving…' : 'Save plan'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBlock message={error} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Employee</label>
            <select className={INPUT_CLS} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={!!plan}>
              <option value="">Select…</option>
              {(employees ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.empCode} · {emp.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Title</label>
            <input className={INPUT_CLS} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL_CLS}>Career goal</label>
            <input className={INPUT_CLS} value={careerGoal} onChange={(e) => setCareerGoal(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Target role (optional)</label>
            <select className={INPUT_CLS} value={targetRoleId} onChange={(e) => setTargetRoleId(e.target.value)}>
              <option value="">None</option>
              {roles.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name ?? r.code ?? `Role #${r.id}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Mentor (optional)</label>
            <select className={INPUT_CLS} value={mentorId} onChange={(e) => setMentorId(e.target.value)}>
              <option value="">None</option>
              {(employees ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.empCode} · {emp.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Cycle (optional)</label>
            <select className={INPUT_CLS} value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
              <option value="">None</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Status</label>
            <select className={INPUT_CLS} value={status} onChange={(e) => setStatus(e.target.value)}>
              {PLAN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Start date</label>
            <input type="date" className={INPUT_CLS} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>End date</label>
            <input type="date" className={INPUT_CLS} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Plan detail: items
// ---------------------------------------------------------------------------

function PlanDetailModal({
  planId,
  onClose,
  onChanged,
  onEdit,
}: {
  planId: number;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (plan: any) => void;
}) {
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add item form
  const [itemType, setItemType] = useState('TRAINING');
  const [itemTitle, setItemTitle] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [trainingId, setTrainingId] = useState('');
  const [dueDate, setDueDate] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    devApi
      .planDetail(planId)
      .then((p) => setPlan(p ?? null))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = (fn: () => Promise<any>, after?: () => void) => {
    setBusy(true);
    setActionError(null);
    fn()
      // Completing an item recomputes the plan's progress server-side, so
      // both the detail and the card list are re-fetched.
      .then(() => {
        after?.();
        load();
        onChanged();
      })
      .catch((err) => setActionError(reason(err)))
      .finally(() => setBusy(false));
  };

  const addItem = () =>
    run(
      () =>
        talentApi.addPlanItem(planId, {
          itemType,
          title: itemTitle.trim(),
          description: itemDescription.trim() || null,
          trainingId: trainingId === '' ? null : Number(trainingId),
          dueDate: dueDate || null,
        }),
      () => {
        setItemTitle('');
        setItemDescription('');
        setTrainingId('');
        setDueDate('');
      },
    );

  const items: any[] = Array.isArray(plan?.items) ? plan.items : [];
  const progress = Math.max(0, Math.min(100, Number(plan?.progressPct ?? 0)));

  return (
    <ModalShell
      title={plan ? `Plan — ${text(plan.title)}` : 'Development plan'}
      subtitle={plan ? `${text(plan.employeeName)} · mentor ${text(plan.mentorName)}` : null}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        plan ? (
          <div className="flex items-center justify-end gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => onEdit(plan)}>
              Edit plan
            </button>
          </div>
        ) : null
      }
    >
      {loading ? (
        <LoadingBlock label="Loading the plan…" />
      ) : error ? (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      ) : plan ? (
        <div className="space-y-4">
          {actionError && <ErrorBlock message={actionError} />}

          <div className="flex items-center gap-2 flex-wrap">
            <Chip label={text(plan.status)} tone={PLAN_TONE[plan.status] ?? 'default'} dot />
            {plan.targetRoleName && <Chip label={`Target: ${plan.targetRoleName}`} tone="primary" />}
            <span className="text-text-muted text-xs">
              {fmtDate(plan.startDate)} – {fmtDate(plan.endDate)}
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] text-text-muted mb-1">
              <span>{text(plan.careerGoal)}</span>
              <span className="font-mono">{progress}% complete</span>
            </div>
            <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-text-muted text-[11px] mt-1">
              Progress is recomputed by the backend from completed items — it is not edited directly.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-text-primary text-sm font-semibold">Plan items</p>
            {items.length === 0 && <EmptyBlock message="No items in this plan yet" />}
            {items.map((it) => (
              <div key={it.id} className="rounded-md border border-border-light bg-bg-secondary p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Chip label={text(it.itemType)} tone={ITEM_TYPE_TONE[it.itemType] ?? 'default'} />
                    <p className="text-text-primary text-xs font-medium">{text(it.title)}</p>
                  </div>
                  {it.description && <p className="text-text-secondary text-[11px] mt-1">{it.description}</p>}
                  <p className="text-text-muted text-[11px] mt-1">
                    {it.trainingTitle ? `Training: ${it.trainingTitle} · ` : it.trainingId ? `Training #${it.trainingId} · ` : ''}
                    due {fmtDate(it.dueDate)}
                    {it.completedAt ? ` · completed ${fmtDate(it.completedAt)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <select
                    className={`${INPUT_CLS} py-1 w-36`}
                    value={it.status}
                    disabled={busy}
                    aria-label="Item status"
                    onChange={(e) => run(() => devApi.updateItem(Number(it.id), { status: e.target.value }))}
                  >
                    {ITEM_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label="Delete item"
                    className="text-text-muted hover:text-danger transition-colors"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Delete this development item?')) run(() => devApi.deleteItem(Number(it.id)));
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-border-default p-3 space-y-3">
            <p className="text-text-primary text-sm font-semibold">Add item</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Type</label>
                <select className={INPUT_CLS} value={itemType} onChange={(e) => setItemType(e.target.value)}>
                  {ITEM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Title</label>
                <input className={INPUT_CLS} value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL_CLS}>Description (optional)</label>
                <input className={INPUT_CLS} value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} />
              </div>
              <div>
                <label className={LABEL_CLS}>Training ID (optional)</label>
                <input
                  type="number"
                  min={1}
                  className={INPUT_CLS}
                  value={trainingId}
                  onChange={(e) => setTrainingId(e.target.value)}
                />
                <p className="text-text-muted text-[11px] mt-1">
                  Numeric ID of a training from Engagement → Trainings; linking pulls the training title into the item.
                </p>
              </div>
              <div>
                <label className={LABEL_CLS}>Due date (optional)</label>
                <input type="date" className={INPUT_CLS} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="button" className={BTN_PRIMARY} disabled={busy || !itemTitle.trim()} onClick={addItem}>
                {busy ? 'Saving…' : 'Add item'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ModalShell>
  );
}
