import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { BadgeCheck, Plus, RefreshCw } from 'lucide-react';
import { internalJobsApi } from '../../../api/internalJobs';
import { orgApi } from '../../../api/organization';
import { useApp } from '../../../contexts/AppContext';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
  TableShell,
  inr,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';
import { WidgetCard, WidgetEmpty } from '../../HRDashboard/WidgetCard';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const STATUS_FILTERS = ['ALL', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED'] as const;
const REQUISITION_TYPES = ['NEW_POSITION', 'REPLACEMENT', 'EXPANSION'] as const;

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

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

function statusTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'info';
    case 'FULFILLED':
      return 'success';
    case 'PENDING_APPROVAL':
      return 'warning';
    case 'REJECTED':
    case 'CANCELLED':
      return 'danger';
    default:
      return 'default';
  }
}

function typeTone(type: unknown): Tone {
  switch (String(type ?? '').toUpperCase()) {
    case 'NEW_POSITION':
      return 'primary';
    case 'REPLACEMENT':
      return 'warning';
    case 'EXPANSION':
      return 'info';
    default:
      return 'default';
  }
}

const EMPTY_FORM = {
  requisitionType: 'NEW_POSITION',
  title: '',
  departmentId: '',
  jobRoleId: '',
  headcount: '1',
  replacementForEmployeeId: '',
  justification: '',
  budgetAmount: '',
};

// ---------------------------------------------------------------------------

export function RequisitionsSection() {
  const { employees } = useApp();

  const [status, setStatus] = useState<string>('ALL');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [departments, setDepartments] = useState<any[]>([]);
  const [jobRoles, setJobRoles] = useState<any[]>([]);

  // Vacancy panel.
  const [vacancies, setVacancies] = useState<any>(null);
  const [vacError, setVacError] = useState<string | null>(null);

  // Create / edit modal.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Detail modal.
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    orgApi.departments.list().then((d: any) => setDepartments(Array.isArray(d) ? d : [])).catch(() => {});
    orgApi.jobRoles.list().then((r: any) => setJobRoles(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      internalJobsApi.requisitions(status === 'ALL' ? {} : { status }),
      internalJobsApi.vacancies().catch((err) => {
        setVacError(reason(err));
        return null;
      }),
    ])
      .then(([list, vac]) => {
        setRows(Array.isArray(list) ? list : []);
        if (vac !== null) {
          setVacancies(vac);
          setVacError(null);
        }
      })
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const loadDetail = useCallback((id: number) => {
    setDetailLoading(true);
    setDetailError(null);
    internalJobsApi
      .requisition(id)
      .then((d) => setDetail(d ?? null))
      .catch((err) => setDetailError(reason(err)))
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    if (detailId === null) {
      setDetail(null);
      return;
    }
    loadDetail(detailId);
  }, [detailId, loadDetail]);

  // Lifecycle actions: any 403/400 from the API is shown verbatim in the modal.
  const act = (fn: () => Promise<any>) => {
    setActing(true);
    setDetailError(null);
    fn()
      .then(() => {
        if (detailId !== null) loadDetail(detailId);
        load();
      })
      .catch((err) => setDetailError(reason(err)))
      .finally(() => setActing(false));
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      requisitionType: String(r?.requisitionType ?? 'NEW_POSITION'),
      title: String(r?.title ?? ''),
      departmentId: r?.departmentId === null || r?.departmentId === undefined ? '' : String(r.departmentId),
      jobRoleId: r?.jobRoleId === null || r?.jobRoleId === undefined ? '' : String(r.jobRoleId),
      headcount: String(r?.headcount ?? 1),
      replacementForEmployeeId:
        r?.replacementForEmployeeId === null || r?.replacementForEmployeeId === undefined
          ? ''
          : String(r.replacementForEmployeeId),
      justification: String(r?.justification ?? ''),
      budgetAmount: r?.budgetAmount === null || r?.budgetAmount === undefined ? '' : String(r.budgetAmount),
    });
    setFormError(null);
    setFormOpen(true);
  };

  const save = () => {
    setSaving(true);
    setFormError(null);
    const body: Record<string, unknown> = {
      requisitionType: form.requisitionType,
      title: form.title.trim(),
      departmentId: form.departmentId === '' ? undefined : Number(form.departmentId),
      jobRoleId: form.jobRoleId === '' ? undefined : Number(form.jobRoleId),
      headcount: form.headcount === '' ? undefined : Number(form.headcount),
      replacementForEmployeeId:
        form.requisitionType === 'REPLACEMENT' && form.replacementForEmployeeId !== ''
          ? Number(form.replacementForEmployeeId)
          : undefined,
      justification: form.justification.trim() || undefined,
      budgetAmount: form.budgetAmount === '' ? undefined : Number(form.budgetAmount),
    };
    const call = editing
      ? internalJobsApi.updateRequisition(Number(editing.id), body)
      : internalJobsApi.createRequisition(body);
    call
      .then(() => {
        setFormOpen(false);
        load();
        if (editing && detailId !== null) loadDetail(detailId);
      })
      .catch((err) => setFormError(reason(err)))
      .finally(() => setSaving(false));
  };

  if (firstLoad && loading) return <LoadingBlock label="Loading requisitions…" />;

  const detailStatus = String(detail?.status ?? '');
  const vacPositions: any[] = Array.isArray(vacancies?.positions) ? vacancies.positions : [];

  return (
    <div className="space-y-4">
      {/* Controls ------------------------------------------------------------ */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
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
              {s === 'ALL' ? 'All statuses' : s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
            <span className="inline-flex items-center gap-2">
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
              Refresh
            </span>
          </button>
          <button type="button" className={BTN_PRIMARY} onClick={openCreate}>
            <span className="inline-flex items-center gap-2">
              <Plus size={14} />
              New requisition
            </span>
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

      {/* Table ---------------------------------------------------------------- */}
      {rows.length === 0 && !error ? (
        <EmptyBlock message="No requisitions match this filter" hint="Raise a requisition to start a hiring request." />
      ) : (
        <TableShell headers={['Req code', 'Type', 'Title', 'Department', 'Headcount', 'Budget', 'Status']}>
          {rows.map((r, index) => (
            <tr
              key={r?.id ?? index}
              className="hover:bg-bg-hover transition-colors cursor-pointer"
              onClick={() => (num(r?.id) === null ? undefined : setDetailId(Number(r.id)))}
            >
              <td className="px-3 py-2 text-xs text-text-primary font-mono whitespace-nowrap">{text(r?.reqCode)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip label={text(r?.requisitionType).replace(/_/g, ' ')} tone={typeTone(r?.requisitionType)} />
              </td>
              <td className="px-3 py-2 text-xs text-text-primary max-w-[280px]">
                <span className="line-clamp-2">{text(r?.title)}</span>
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(r?.departmentName)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                {text(r?.headcount)}
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                  {money(r?.budgetAmount)}
                  {!!r?.budgetApproved && <BadgeCheck size={13} className="text-success" />}
                </span>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip label={text(r?.status).replace(/_/g, ' ')} tone={statusTone(r?.status)} dot />
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      {/* Vacancy panel --------------------------------------------------------- */}
      <WidgetCard title="Position vacancies" subtitle="Budgeted headcount vs employees linked to each position">
        {vacError ? (
          <ErrorBlock message={vacError} />
        ) : vacancies === null ? (
          <WidgetEmpty message="Vacancy data has not loaded yet" />
        ) : (
          <div className="space-y-3">
            {typeof vacancies?.note === 'string' && (
              <p className="text-text-muted text-[11px]">{vacancies.note}</p>
            )}
            {vacPositions.length === 0 ? (
              <WidgetEmpty message="No open positions are tracked" />
            ) : (
              <TableShell
                headers={['Code', 'Title', 'Department', 'Role', 'Type', 'Status', 'Budgeted', 'Filled', 'Vacancies']}
              >
                {vacPositions.map((p, index) => (
                  <tr key={p?.positionId ?? index} className="hover:bg-bg-hover transition-colors">
                    <td className="px-3 py-2 text-xs text-text-muted font-mono whitespace-nowrap">{text(p?.code)}</td>
                    <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{text(p?.title)}</td>
                    <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                      {text(p?.departmentName)}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(p?.jobRoleName)}</td>
                    <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                      {text(p?.employmentType).replace(/_/g, ' ')}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Chip label={text(p?.status)} tone={String(p?.status) === 'OPEN' ? 'info' : 'default'} />
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                      {text(p?.headcountBudgeted)}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                      {text(p?.filled)}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-primary font-mono font-semibold text-right whitespace-nowrap">
                      {text(p?.vacancies)}
                    </td>
                  </tr>
                ))}
              </TableShell>
            )}
          </div>
        )}
      </WidgetCard>

      {/* Detail modal ---------------------------------------------------------- */}
      <AnimatePresence>
        {detailId !== null && (
          <ModalShell
            title={detail ? `${text(detail.reqCode)} · ${text(detail.title)}` : 'Requisition'}
            subtitle={detail ? `${text(detail.requisitionType).replace(/_/g, ' ')} · ${text(detail.departmentName)}` : null}
            onClose={() => setDetailId(null)}
            maxWidth="max-w-2xl"
          >
            {detailLoading && <LoadingBlock label="Loading the requisition…" />}
            {detailError && <ErrorBlock message={detailError} />}
            {!detailLoading && detail && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Chip label={text(detail.status).replace(/_/g, ' ')} tone={statusTone(detail.status)} dot />
                  <Chip
                    label={text(detail.requisitionType).replace(/_/g, ' ')}
                    tone={typeTone(detail.requisitionType)}
                  />
                  {!!detail.budgetApproved && <Chip label="Budget approved" tone="success" />}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-xs">
                  <div>
                    <p className={LABEL_CLS}>Department</p>
                    <p className="text-text-secondary">{text(detail.departmentName)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Job role</p>
                    <p className="text-text-secondary">{text(detail.jobRoleName)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Headcount</p>
                    <p className="text-text-secondary font-mono">{text(detail.headcount)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Budget</p>
                    <p className="text-text-secondary font-mono">{money(detail.budgetAmount)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Replacement for</p>
                    <p className="text-text-secondary">{text(detail.replacementForName)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Approved at</p>
                    <p className="text-text-secondary">{fmtDate(detail.approvedAt)}</p>
                  </div>
                </div>

                {detail.justification && (
                  <div>
                    <p className={LABEL_CLS}>Justification</p>
                    <p className="text-text-secondary text-xs">{String(detail.justification)}</p>
                  </div>
                )}

                {/* Lifecycle actions by status. Approve/reject need admin or hr —
                    a 403 from the API is surfaced verbatim above. */}
                <div className="flex items-center gap-2 flex-wrap">
                  {detailStatus === 'DRAFT' && (
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      disabled={acting}
                      onClick={() => act(() => internalJobsApi.submitRequisition(Number(detail.id)))}
                    >
                      Submit for approval
                    </button>
                  )}
                  {detailStatus === 'PENDING_APPROVAL' && (
                    <>
                      <button
                        type="button"
                        className={BTN_PRIMARY}
                        disabled={acting}
                        onClick={() => act(() => internalJobsApi.approveRequisition(Number(detail.id)))}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        disabled={acting}
                        onClick={() => {
                          const r = window.prompt('Reason for rejecting this requisition:');
                          if (r && r.trim())
                            act(() => internalJobsApi.rejectRequisition(Number(detail.id), r.trim()));
                        }}
                      >
                        Reject…
                      </button>
                    </>
                  )}
                  {(detailStatus === 'DRAFT' || detailStatus === 'PENDING_APPROVAL') && (
                    <button type="button" className={BTN_SECONDARY} onClick={() => openEdit(detail)}>
                      Edit
                    </button>
                  )}
                  {(detailStatus === 'DRAFT' ||
                    detailStatus === 'PENDING_APPROVAL' ||
                    detailStatus === 'APPROVED') && (
                    <button
                      type="button"
                      className={BTN_SECONDARY}
                      disabled={acting}
                      onClick={() => {
                        if (window.confirm('Cancel this requisition?'))
                          act(() => internalJobsApi.cancelRequisition(Number(detail.id)));
                      }}
                    >
                      Cancel requisition
                    </button>
                  )}
                </div>

                {!detail.budgetApproved &&
                  detailStatus !== 'CANCELLED' &&
                  detailStatus !== 'REJECTED' && (
                    <div className="rounded-md border border-border-default p-3 space-y-2">
                      <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">Budget</p>
                      <p className="text-text-muted text-[11px]">
                        Budget approval is recorded separately from the requisition approval and is stamped with
                        your login as the approver.
                      </p>
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        disabled={acting}
                        onClick={() => act(() => internalJobsApi.budgetApproveRequisition(Number(detail.id)))}
                      >
                        <span className="inline-flex items-center gap-2">
                          <BadgeCheck size={14} />
                          Approve budget
                        </span>
                      </button>
                    </div>
                  )}
              </div>
            )}
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Create / edit modal ---------------------------------------------------- */}
      <AnimatePresence>
        {formOpen && (
          <ModalShell
            title={editing ? `Edit ${text(editing.reqCode)}` : 'New requisition'}
            onClose={() => setFormOpen(false)}
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setFormOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={save}
                  disabled={saving || form.title.trim() === ''}
                >
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create requisition'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {formError && <ErrorBlock message={formError} />}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Type</label>
                  <select
                    className={INPUT_CLS}
                    value={form.requisitionType}
                    onChange={(e) => setForm((f) => ({ ...f, requisitionType: e.target.value }))}
                  >
                    {REQUISITION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Headcount</label>
                  <input
                    type="number"
                    min={1}
                    className={INPUT_CLS}
                    value={form.headcount}
                    onChange={(e) => setForm((f) => ({ ...f, headcount: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Title</label>
                <input
                  className={INPUT_CLS}
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Department</label>
                  <select
                    className={INPUT_CLS}
                    value={form.departmentId}
                    onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
                  >
                    <option value="">Select department…</option>
                    {departments.map((d: any) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Job role</label>
                  <select
                    className={INPUT_CLS}
                    value={form.jobRoleId}
                    onChange={(e) => setForm((f) => ({ ...f, jobRoleId: e.target.value }))}
                  >
                    <option value="">Select role…</option>
                    {jobRoles.map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {form.requisitionType === 'REPLACEMENT' && (
                <div>
                  <label className={LABEL_CLS}>Replacement for</label>
                  <select
                    className={INPUT_CLS}
                    value={form.replacementForEmployeeId}
                    onChange={(e) => setForm((f) => ({ ...f, replacementForEmployeeId: e.target.value }))}
                  >
                    <option value="">Select employee…</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName} ({e.empCode})
                      </option>
                    ))}
                  </select>
                  <p className="text-text-muted text-[11px] mt-1">
                    A REPLACEMENT requisition must name the employee being replaced.
                  </p>
                </div>
              )}
              <div>
                <label className={LABEL_CLS}>Justification</label>
                <textarea
                  className={`${INPUT_CLS} min-h-[60px]`}
                  value={form.justification}
                  onChange={(e) => setForm((f) => ({ ...f, justification: e.target.value }))}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Budget amount (annual, INR)</label>
                <input
                  type="number"
                  min={0}
                  className={INPUT_CLS}
                  value={form.budgetAmount}
                  onChange={(e) => setForm((f) => ({ ...f, budgetAmount: e.target.value }))}
                />
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
