import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  RefreshCw,
  Check,
  X,
  Info,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Pencil,
} from 'lucide-react';
import { orgApi } from '../../api/organization';
import type {
  OrgAuditEntry,
  OrgChangeRequest,
  OrgChangeStatus,
  OrgPolicy,
  ReportingRelationship,
  ReportingType,
} from '../../types/organization';
import { ORG_ENTITY_LABELS } from '../../types/organization';
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
import { TabBar, type TabItem } from '../../components/common/TabBar';
import { ModalShell } from '../../components/common/ModalShell';
import { useApp } from '../../contexts/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate, errMsg } from './orgUi';

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const REPORTING_TYPES: ReportingType[] = [
  'DIRECT',
  'MATRIX',
  'FUNCTIONAL',
  'ADMINISTRATIVE',
  'DOTTED_LINE',
  'ESCALATION',
  'DELEGATION',
];

const REPORTING_TONE: Record<string, Tone> = {
  DIRECT: 'default',
  MATRIX: 'primary',
  DOTTED_LINE: 'info',
  FUNCTIONAL: 'warning',
  ADMINISTRATIVE: 'warning',
  ESCALATION: 'default',
  DELEGATION: 'default',
};

const REQUEST_TONE: Record<string, Tone> = {
  DRAFT: 'default',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  APPLIED: 'info',
  CANCELLED: 'default',
};

const AUDIT_TONE: Record<string, Tone> = {
  CREATE: 'success',
  UPDATE: 'primary',
  DELETE: 'danger',
  RESTORE: 'info',
  ACTIVATE: 'success',
  DEACTIVATE: 'warning',
  REPARENT: 'info',
  TRANSFER: 'info',
  ASSIGN: 'primary',
  UNASSIGN: 'warning',
  IMPORT: 'default',
  APPROVE: 'success',
  REJECT: 'danger',
};

const REQUEST_STATUSES: OrgChangeStatus[] = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'CANCELLED'];

const REQUEST_TYPES = [
  'NEW_POSITION',
  'ROLE_CHANGE',
  'TRANSFER',
  'REPARENT',
  'DEPARTMENT_CHANGE',
  'HEADCOUNT_CHANGE',
  'ENTITY_CREATE',
  'ENTITY_CLOSE',
  'OTHER',
];

const PAGE_SIZE = 20;

function labelFor(entityType: string | null | undefined): string {
  const key = String(entityType ?? '');
  if (!key) return '—';
  return ORG_ENTITY_LABELS[key] ?? key.replace(/_/g, ' ');
}

function niceType(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  return raw.replace(/_/g, ' ');
}

function stamp(value: string | null | undefined): string {
  const raw = String(value ?? '');
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(raw)} ${hh}:${mm}`;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-text-muted flex items-start gap-1.5">
      <Info size={12} className="mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function OrgGovernance() {
  const [tab, setTab] = useState<string>('reporting');

  const tabs: TabItem[] = [
    { id: 'reporting', label: 'Reporting lines' },
    { id: 'requests', label: 'Change requests' },
    { id: 'policies', label: 'Policies' },
    { id: 'audit', label: 'Audit log' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-text-primary text-base font-semibold">Organization governance</h3>
        <p className="text-text-secondary text-xs mt-0.5">
          Matrix reporting · change approvals · policies · audit trail
        </p>
      </div>
      <TabBar tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'reporting' && <ReportingLines />}
      {tab === 'requests' && <ChangeRequests />}
      {tab === 'policies' && <Policies />}
      {tab === 'audit' && <AuditLog />}
    </div>
  );
}

// ===========================================================================
// Reporting lines
// ===========================================================================
function ReportingLines() {
  const { employees } = useApp();
  const [rows, setRows] = useState<ReportingRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    employeeId: '',
    managerEmployeeId: '',
    relationshipType: 'MATRIX' as ReportingType,
    context: '',
    allocationPct: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
  });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    orgApi
      .reporting()
      .then((res) => setRows(asArray<ReportingRelationship>(res)))
      .catch((err: unknown) => {
        setError(errMsg(err, 'Failed to load reporting lines'));
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const people = useMemo(
    () =>
      (employees ?? [])
        .slice()
        .sort((a, b) => String(a?.fullName ?? '').localeCompare(String(b?.fullName ?? ''))),
    [employees],
  );

  const submit = () => {
    if (!form.employeeId || !form.managerEmployeeId) {
      window.alert('Pick both an employee and a manager.');
      return;
    }
    if (form.employeeId === form.managerEmployeeId) {
      window.alert('An employee cannot report to themselves.');
      return;
    }
    setSaving(true);
    orgApi
      .createReporting({
        employeeId: Number(form.employeeId),
        managerEmployeeId: Number(form.managerEmployeeId),
        relationshipType: form.relationshipType,
        context: form.context.trim() === '' ? null : form.context.trim(),
        allocationPct: form.allocationPct === '' ? null : Number(form.allocationPct),
        effectiveFrom: form.effectiveFrom,
      })
      .then(() => {
        setShowAdd(false);
        setForm((f) => ({ ...f, employeeId: '', managerEmployeeId: '', context: '', allocationPct: '' }));
        load();
      })
      .catch((err: unknown) => window.alert(errMsg(err, 'Failed to add the reporting line')))
      .finally(() => setSaving(false));
  };

  const remove = (row: ReportingRelationship) => {
    if (!window.confirm(`Remove the ${niceType(row?.relationshipType)} line from ${row?.employeeName ?? 'employee'} to ${row?.managerName ?? 'manager'}?`)) {
      return;
    }
    orgApi
      .deleteReporting(num(row?.id))
      .then(() => load())
      .catch((err: unknown) => window.alert(errMsg(err, 'Failed to delete the reporting line')));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <Note>
          The <span className="text-text-secondary font-medium">primary</span> manager lives on the employee record.
          This list holds the additional matrix and dotted-line relationships layered on top of it.
        </Note>
        <div className="flex items-center gap-2">
          <button className={BTN_SECONDARY} onClick={load}>
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw size={14} /> Refresh
            </span>
          </button>
          <button className={BTN_PRIMARY} onClick={() => setShowAdd(true)}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={14} /> Add line
            </span>
          </button>
        </div>
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading reporting lines…" />
      ) : rows.length === 0 ? (
        <EmptyBlock message="No additional reporting lines" hint="Add a matrix or dotted line to get started." />
      ) : (
        <TableShell
          headers={['Employee', 'Manager', 'Type', 'Context', 'Allocation', 'Effective from', 'Effective to', '']}
        >
          {rows.map((r) => (
            <tr key={r?.id} className="hover:bg-bg-hover">
              <td className="px-3 py-2 text-sm text-text-primary">
                {r?.employeeName ?? '—'}
                {r?.empCode && <span className="text-text-muted text-xs ml-1.5">{r.empCode}</span>}
                {r?.isPrimary && <span className="ml-1.5"><Chip label="Primary" tone="primary" /></span>}
              </td>
              <td className="px-3 py-2 text-sm text-text-primary">{r?.managerName ?? '—'}</td>
              <td className="px-3 py-2">
                <Chip
                  label={niceType(r?.relationshipType)}
                  tone={REPORTING_TONE[String(r?.relationshipType ?? '')] ?? 'default'}
                />
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary">{r?.context || '—'}</td>
              <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">
                {r?.allocationPct == null ? '—' : `${num(r.allocationPct)}%`}
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary">{formatDate(r?.effectiveFrom ?? '')}</td>
              <td className="px-3 py-2 text-sm text-text-secondary">
                {r?.effectiveTo ? formatDate(r.effectiveTo) : '—'}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={() => remove(r)}
                  aria-label="Delete reporting line"
                  className="text-text-muted hover:text-danger transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      {showAdd && (
        <ModalShell
          title="Add reporting line"
          subtitle="Matrix, functional or dotted-line relationship"
          onClose={() => setShowAdd(false)}
          maxWidth="max-w-lg"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button className={BTN_SECONDARY} onClick={() => setShowAdd(false)} disabled={saving}>
                Cancel
              </button>
              <button className={BTN_PRIMARY} onClick={submit} disabled={saving}>
                {saving ? 'Saving…' : 'Add line'}
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-1">
              <label className={LABEL_CLS} htmlFor="rl-emp">
                Employee
              </label>
              <select
                id="rl-emp"
                className={INPUT_CLS}
                value={form.employeeId}
                onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              >
                <option value="">Select…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} ({p.empCode})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="rl-mgr">
                Manager
              </label>
              <select
                id="rl-mgr"
                className={INPUT_CLS}
                value={form.managerEmployeeId}
                onChange={(e) => setForm({ ...form, managerEmployeeId: e.target.value })}
              >
                <option value="">Select…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} ({p.empCode})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="rl-type">
                Relationship type
              </label>
              <select
                id="rl-type"
                className={INPUT_CLS}
                value={form.relationshipType}
                onChange={(e) => setForm({ ...form, relationshipType: e.target.value as ReportingType })}
              >
                {REPORTING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {niceType(t)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="rl-alloc">
                Allocation %
              </label>
              <input
                id="rl-alloc"
                type="number"
                min={0}
                max={100}
                className={INPUT_CLS}
                value={form.allocationPct}
                onChange={(e) => setForm({ ...form, allocationPct: e.target.value })}
                placeholder="e.g. 30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL_CLS} htmlFor="rl-context">
                Context
              </label>
              <input
                id="rl-context"
                className={INPUT_CLS}
                value={form.context}
                onChange={(e) => setForm({ ...form, context: e.target.value })}
                placeholder="Project, function or reason for the line"
              />
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="rl-from">
                Effective from
              </label>
              <input
                id="rl-from"
                type="date"
                className={INPUT_CLS}
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              />
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

// ===========================================================================
// Change requests
// ===========================================================================
function ChangeRequests() {
  const { employees } = useApp();
  const { user } = useAuth();
  const canDecide = user?.role === 'admin' || user?.role === 'hr';

  const [rows, setRows] = useState<OrgChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rejecting, setRejecting] = useState<OrgChangeRequest | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const [form, setForm] = useState({
    requestType: 'NEW_POSITION',
    title: '',
    justification: '',
    effectiveDate: new Date().toISOString().slice(0, 10),
    employeeId: '',
  });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    orgApi
      .changeRequests(status ? { status } : {})
      .then((res) => setRows(asArray<OrgChangeRequest>(res)))
      .catch((err: unknown) => {
        setError(errMsg(err, 'Failed to load change requests'));
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const people = useMemo(() => employees ?? [], [employees]);

  const submit = () => {
    if (form.title.trim() === '') {
      window.alert('A title is required.');
      return;
    }
    setSaving(true);
    orgApi
      .createChangeRequest({
        requestType: form.requestType,
        title: form.title.trim(),
        justification: form.justification.trim() === '' ? null : form.justification.trim(),
        effectiveDate: form.effectiveDate || null,
        employeeId: form.employeeId === '' ? null : Number(form.employeeId),
      })
      .then(() => {
        setShowCreate(false);
        setForm((f) => ({ ...f, title: '', justification: '', employeeId: '' }));
        load();
      })
      .catch((err: unknown) => window.alert(errMsg(err, 'Failed to create the change request')))
      .finally(() => setSaving(false));
  };

  const decide = (row: OrgChangeRequest, decision: 'APPROVED' | 'REJECTED', note?: string) => {
    orgApi
      .decideChangeRequest(num(row?.id), decision, note)
      .then(() => {
        setRejecting(null);
        setRejectNote('');
        load();
      })
      .catch((err: unknown) => window.alert(errMsg(err, 'Failed to record the decision')));
  };

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of rows) map[String(r?.status ?? '')] = (map[String(r?.status ?? '')] ?? 0) + 1;
    return map;
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setStatus('')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
              status === '' ? 'bg-primary-light border-primary/30 text-primary' : 'border-border-default text-text-muted hover:border-text-muted'
            }`}
          >
            All ({rows.length})
          </button>
          {REQUEST_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                status === s ? 'bg-primary-light border-primary/30 text-primary' : 'border-border-default text-text-muted hover:border-text-muted'
              }`}
            >
              {niceType(s)}
              {status === '' && counts[s] ? <span className="ml-1.5 text-text-muted">({counts[s]})</span> : null}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button className={BTN_SECONDARY} onClick={load}>
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw size={14} /> Refresh
            </span>
          </button>
          <button className={BTN_PRIMARY} onClick={() => setShowCreate(true)}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={14} /> New request
            </span>
          </button>
        </div>
      </div>

      <Note>
        Approving a request <span className="text-text-secondary font-medium">records the decision only</span>. It does
        not itself apply the structural change — the corresponding entity, position or transfer must still be edited on
        its own page.
      </Note>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading change requests…" />
      ) : rows.length === 0 ? (
        <EmptyBlock message="No change requests" hint={status ? 'Try a different status filter.' : undefined} />
      ) : (
        <TableShell
          headers={['Type', 'Title', 'Entity', 'Employee', 'Effective', 'Status', 'Requested by', 'Decided by', '']}
        >
          {rows.map((r) => (
            <tr key={r?.id} className="hover:bg-bg-hover align-top">
              <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">{niceType(r?.requestType)}</td>
              <td className="px-3 py-2 text-sm text-text-primary">
                {r?.title ?? '—'}
                {r?.justification && <p className="text-text-muted text-xs mt-0.5 max-w-md">{r.justification}</p>}
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">
                {labelFor(r?.entityType)}
                {r?.entityId ? <span className="text-text-muted ml-1">#{r.entityId}</span> : null}
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary">{r?.employeeName ?? '—'}</td>
              <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">
                {r?.effectiveDate ? formatDate(r.effectiveDate) : '—'}
              </td>
              <td className="px-3 py-2">
                <Chip label={niceType(r?.status)} tone={REQUEST_TONE[String(r?.status ?? '')] ?? 'default'} dot />
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">
                {r?.requestedByName ?? '—'}
                <p className="text-text-muted text-[11px]">{stamp(r?.createdAt)}</p>
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">
                {r?.decidedByName ?? '—'}
                {r?.decidedAt && <p className="text-text-muted text-[11px]">{stamp(r.decidedAt)}</p>}
                {r?.decisionNote && <p className="text-text-muted text-[11px] max-w-[200px]">{r.decisionNote}</p>}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {canDecide && (r?.status === 'PENDING' || r?.status === 'DRAFT') && (
                  <span className="inline-flex items-center gap-1">
                    <button
                      onClick={() => decide(r, 'APPROVED')}
                      title="Approve"
                      aria-label="Approve"
                      className="p-1 rounded-md border border-border-default text-success hover:bg-success-light"
                    >
                      <Check size={13} />
                    </button>
                    <button
                      onClick={() => {
                        setRejecting(r);
                        setRejectNote('');
                      }}
                      title="Reject"
                      aria-label="Reject"
                      className="p-1 rounded-md border border-border-default text-danger hover:bg-danger-light"
                    >
                      <X size={13} />
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      {showCreate && (
        <ModalShell
          title="New change request"
          subtitle="Raise a structural change for approval"
          onClose={() => setShowCreate(false)}
          maxWidth="max-w-lg"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button className={BTN_SECONDARY} onClick={() => setShowCreate(false)} disabled={saving}>
                Cancel
              </button>
              <button className={BTN_PRIMARY} onClick={submit} disabled={saving}>
                {saving ? 'Saving…' : 'Submit request'}
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS} htmlFor="cr-type">
                Request type
              </label>
              <select
                id="cr-type"
                className={INPUT_CLS}
                value={form.requestType}
                onChange={(e) => setForm({ ...form, requestType: e.target.value })}
              >
                {REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {niceType(t)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="cr-date">
                Effective date
              </label>
              <input
                id="cr-date"
                type="date"
                className={INPUT_CLS}
                value={form.effectiveDate}
                onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL_CLS} htmlFor="cr-title">
                Title
              </label>
              <input
                id="cr-title"
                className={INPUT_CLS}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Add a QC supervisor seat in Polishing"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL_CLS} htmlFor="cr-just">
                Justification
              </label>
              <textarea
                id="cr-just"
                rows={4}
                className={INPUT_CLS}
                value={form.justification}
                onChange={(e) => setForm({ ...form, justification: e.target.value })}
                placeholder="Why is this change needed?"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL_CLS} htmlFor="cr-emp">
                Employee (optional)
              </label>
              <select
                id="cr-emp"
                className={INPUT_CLS}
                value={form.employeeId}
                onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              >
                <option value="">Not employee-specific</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} ({p.empCode})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </ModalShell>
      )}

      {rejecting && (
        <ModalShell
          title="Reject change request"
          subtitle={rejecting.title ?? null}
          onClose={() => setRejecting(null)}
          maxWidth="max-w-md"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button className={BTN_SECONDARY} onClick={() => setRejecting(null)}>
                Cancel
              </button>
              <button
                className={BTN_PRIMARY}
                disabled={rejectNote.trim() === ''}
                onClick={() => decide(rejecting, 'REJECTED', rejectNote.trim())}
              >
                Reject request
              </button>
            </div>
          }
        >
          <label className={LABEL_CLS} htmlFor="cr-reject">
            Reason for rejection
          </label>
          <textarea
            id="cr-reject"
            rows={4}
            className={INPUT_CLS}
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Explain why this request is being rejected"
          />
        </ModalShell>
      )}
    </div>
  );
}

// ===========================================================================
// Policies
// ===========================================================================
const POLICY_TYPES = ['HR', 'LEAVE', 'ATTENDANCE', 'PAYROLL', 'CODE_OF_CONDUCT', 'SAFETY', 'IT', 'FINANCE', 'OTHER'];

function Policies() {
  const [rows, setRows] = useState<OrgPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrgPolicy | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const blank = {
    policyType: 'HR',
    code: '',
    name: '',
    body: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: '',
    status: 'ACTIVE',
  };
  const [form, setForm] = useState(blank);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    orgApi
      .policies()
      .then((res) => setRows(asArray<OrgPolicy>(res)))
      .catch((err: unknown) => {
        setError(errMsg(err, 'Failed to load policies'));
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, OrgPolicy[]>();
    for (const p of rows) {
      const key = String(p?.policyType ?? 'OTHER');
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const openCreate = () => {
    setForm(blank);
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (p: OrgPolicy) => {
    setForm({
      policyType: String(p?.policyType ?? 'HR'),
      code: String(p?.code ?? ''),
      name: String(p?.name ?? ''),
      body: String(p?.body ?? ''),
      effectiveFrom: String(p?.effectiveFrom ?? '').slice(0, 10),
      effectiveTo: String(p?.effectiveTo ?? '').slice(0, 10),
      status: String(p?.status ?? 'ACTIVE'),
    });
    setCreating(false);
    setEditing(p);
  };

  const close = () => {
    setCreating(false);
    setEditing(null);
  };

  const submit = () => {
    if (form.name.trim() === '' || form.code.trim() === '') {
      window.alert('Code and name are required.');
      return;
    }
    const body: Partial<OrgPolicy> = {
      policyType: form.policyType,
      code: form.code.trim(),
      name: form.name.trim(),
      body: form.body.trim() === '' ? null : form.body,
      effectiveFrom: form.effectiveFrom || null,
      effectiveTo: form.effectiveTo || null,
      status: form.status,
    };
    setSaving(true);
    const req = editing ? orgApi.updatePolicy(num(editing.id), body) : orgApi.createPolicy(body);
    req
      .then(() => {
        close();
        load();
      })
      .catch((err: unknown) => window.alert(errMsg(err, 'Failed to save the policy')))
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Note>Policies are grouped by type. The effective window controls when a policy is in force.</Note>
        <div className="flex items-center gap-2">
          <button className={BTN_SECONDARY} onClick={load}>
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw size={14} /> Refresh
            </span>
          </button>
          <button className={BTN_PRIMARY} onClick={openCreate}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={14} /> New policy
            </span>
          </button>
        </div>
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading policies…" />
      ) : grouped.length === 0 ? (
        <EmptyBlock message="No policies recorded" hint="Create the first policy to start the handbook." />
      ) : (
        <div className="space-y-4">
          {grouped.map(([type, list]) => (
            <div key={type}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-text-primary text-sm font-semibold">{niceType(type)}</h3>
                <span className="text-text-muted text-xs">({list.length})</span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {list.map((p) => (
                  <div key={p?.id} className="bg-bg-card border border-border-default rounded-md p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-text-primary text-sm font-medium">{p?.name ?? '—'}</p>
                        <p className="text-text-muted text-xs mt-0.5">{p?.code ?? '—'}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Chip
                          label={niceType(p?.status)}
                          tone={String(p?.status ?? '') === 'ACTIVE' ? 'success' : 'default'}
                        />
                        <button
                          onClick={() => openEdit(p)}
                          aria-label="Edit policy"
                          className="text-text-muted hover:text-primary transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    </div>
                    <p className="text-text-muted text-[11px] mt-2">
                      {p?.effectiveFrom ? formatDate(p.effectiveFrom) : '—'} →{' '}
                      {p?.effectiveTo ? formatDate(p.effectiveTo) : 'open ended'}
                    </p>
                    {p?.body ? (
                      <p className="text-text-secondary text-xs mt-2 whitespace-pre-wrap line-clamp-6">{p.body}</p>
                    ) : (
                      <p className="text-text-muted text-xs mt-2 italic">No policy text recorded.</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ModalShell
          title={editing ? 'Edit policy' : 'New policy'}
          subtitle={editing ? (editing.code ?? null) : 'Add a policy to the handbook'}
          onClose={close}
          maxWidth="max-w-2xl"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button className={BTN_SECONDARY} onClick={close} disabled={saving}>
                Cancel
              </button>
              <button className={BTN_PRIMARY} onClick={submit} disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create policy'}
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS} htmlFor="pol-type">
                Policy type
              </label>
              <select
                id="pol-type"
                className={INPUT_CLS}
                value={form.policyType}
                onChange={(e) => setForm({ ...form, policyType: e.target.value })}
              >
                {POLICY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {niceType(t)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="pol-code">
                Code
              </label>
              <input
                id="pol-code"
                className={INPUT_CLS}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. HR-001"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL_CLS} htmlFor="pol-name">
                Name
              </label>
              <input
                id="pol-name"
                className={INPUT_CLS}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="pol-from">
                Effective from
              </label>
              <input
                id="pol-from"
                type="date"
                className={INPUT_CLS}
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="pol-to">
                Effective to
              </label>
              <input
                id="pol-to"
                type="date"
                className={INPUT_CLS}
                value={form.effectiveTo}
                onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="pol-status">
                Status
              </label>
              <select
                id="pol-status"
                className={INPUT_CLS}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL_CLS} htmlFor="pol-body">
                Policy text
              </label>
              <textarea
                id="pol-body"
                rows={8}
                className={INPUT_CLS}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

// ===========================================================================
// Audit log
// ===========================================================================
const AUDIT_ENTITY_FILTERS = Object.keys(ORG_ENTITY_LABELS);

function AuditLog() {
  const [rows, setRows] = useState<OrgAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(0);
  const [openRow, setOpenRow] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    orgApi
      .audit({ entityType: entityType || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then((res) => {
        setRows(asArray<OrgAuditEntry>(res?.rows));
        setTotal(num(res?.total));
      })
      .catch((err: unknown) => {
        setError(errMsg(err, 'Failed to load the audit trail'));
        setRows([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [entityType, page]);

  useEffect(() => {
    load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="w-56">
          <label className={LABEL_CLS} htmlFor="audit-entity">
            Entity type
          </label>
          <select
            id="audit-entity"
            className={INPUT_CLS}
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All entity types</option>
            {AUDIT_ENTITY_FILTERS.map((k) => (
              <option key={k} value={k}>
                {ORG_ENTITY_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <button className={BTN_SECONDARY} onClick={load}>
          <span className="inline-flex items-center gap-1.5">
            <RefreshCw size={14} /> Refresh
          </span>
        </button>
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading audit trail…" />
      ) : rows.length === 0 ? (
        <EmptyBlock message="No audit entries" hint={entityType ? 'Try a different entity type.' : undefined} />
      ) : (
        <>
          <TableShell headers={['', 'Action', 'Entity', 'Actor', 'Summary', 'IP', 'Device / browser', 'When']}>
            {rows.map((r) => {
              const id = num(r?.id);
              const hasDiff = Boolean(r?.previousValue) || Boolean(r?.newValue);
              const isOpen = openRow === id;
              return (
                <Fragment key={id}>
                  <tr className="hover:bg-bg-hover align-top">
                    <td className="px-2 py-2 w-8">
                      {hasDiff && (
                        <button
                          onClick={() => setOpenRow(isOpen ? null : id)}
                          aria-label={isOpen ? 'Hide change detail' : 'Show change detail'}
                          className="text-text-muted hover:text-primary"
                        >
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Chip label={niceType(r?.action)} tone={AUDIT_TONE[String(r?.action ?? '')] ?? 'default'} />
                    </td>
                    <td className="px-3 py-2 text-sm text-text-primary">
                      {labelFor(r?.entityType)}
                      <p className="text-text-muted text-[11px]">{r?.entityName ?? (r?.entityId ? `#${r.entityId}` : '—')}</p>
                    </td>
                    <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">
                      {r?.actorName ?? '—'}
                      {r?.actorRole && <p className="text-text-muted text-[11px]">{r.actorRole}</p>}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary max-w-sm">{r?.summary ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{r?.ipAddress ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">
                      {[r?.device, r?.browser].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{stamp(r?.createdAt)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-bg-secondary">
                      <td colSpan={8} className="px-3 py-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
                              Previous value
                            </p>
                            <pre className="text-[11px] text-text-secondary whitespace-pre-wrap break-all bg-bg-card border border-border-light rounded-md p-2 max-h-48 overflow-auto">
                              {r?.previousValue ?? '—'}
                            </pre>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
                              New value
                            </p>
                            <pre className="text-[11px] text-text-secondary whitespace-pre-wrap break-all bg-bg-card border border-border-light rounded-md p-2 max-h-48 overflow-auto">
                              {r?.newValue ?? '—'}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </TableShell>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-text-muted tabular-nums">
              Showing {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                className={BTN_SECONDARY}
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <span className="inline-flex items-center gap-1.5">
                  <ChevronLeft size={14} /> Previous
                </span>
              </button>
              <span className="text-xs text-text-muted tabular-nums">
                Page {page + 1} / {pageCount}
              </span>
              <button
                className={BTN_SECONDARY}
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                <span className="inline-flex items-center gap-1.5">
                  Next <ChevronRight size={14} />
                </span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
