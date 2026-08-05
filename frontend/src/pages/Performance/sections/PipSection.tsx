import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AlertTriangle, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { talentApi } from '../../../api/performance';
import { api, ApiError } from '../../../api/client';
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
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------
// talentApi.updatePipObjective points at /talent/objectives/:id, but the
// backend serves /talent/pips/objectives/:id. This wrapper uses the verified
// route.
// ---------------------------------------------------------------------------
const pipFix = {
  updateObjective: (id: number, body: { status: string }) => api.put<any>(`/talent/pips/objectives/${id}`, body),
};

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const PIP_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'ACTIVE',
  'EXTENDED',
  'ESCALATED',
  'CLOSED_SUCCESSFUL',
  'CLOSED_UNSUCCESSFUL',
  'WITHDRAWN',
];

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'default',
  PENDING_APPROVAL: 'info',
  ACTIVE: 'warning',
  EXTENDED: 'warning',
  ESCALATED: 'danger',
  CLOSED_SUCCESSFUL: 'success',
  CLOSED_UNSUCCESSFUL: 'danger',
  WITHDRAWN: 'default',
};

const OBJECTIVE_STATUSES = ['PENDING', 'ON_TRACK', 'AT_RISK', 'MET', 'NOT_MET'];
const OBJECTIVE_TONE: Record<string, Tone> = {
  PENDING: 'default',
  ON_TRACK: 'info',
  AT_RISK: 'warning',
  MET: 'success',
  NOT_MET: 'danger',
};

const PROGRESS_VALUES = ['ON_TRACK', 'AT_RISK', 'OFF_TRACK'];
const PROGRESS_TONE: Record<string, Tone> = {
  ON_TRACK: 'success',
  AT_RISK: 'warning',
  OFF_TRACK: 'danger',
};

const OUTCOMES = ['SUCCESSFUL', 'UNSUCCESSFUL', 'WITHDRAWN'];

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

function truncate(value: unknown, max = 70): string {
  const s = text(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ---------------------------------------------------------------------------

export function PipSection() {
  const [status, setStatus] = useState('ALL');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    talentApi
      .pips(status === 'ALL' ? {} : { status })
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch((err) => {
        // A non-privileged role gets a 403: render it in place, never crash.
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        setError(reason(err));
      })
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = rows.filter((r) => status === 'ALL' || r?.status === status);

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-danger-light border border-danger/30 px-4 py-3 flex items-start gap-2">
        <ShieldAlert size={16} className="text-danger flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-text-primary text-sm font-medium">Performance improvement plans are confidential.</p>
          <p className="text-text-secondary text-xs mt-0.5">
            Visible to admin, HR and managers only — PIPs are never surfaced through employee self-service.
          </p>
        </div>
      </div>

      {forbidden ? (
        <div className="rounded-md border border-border-default bg-bg-card p-6 text-center space-y-2">
          <AlertTriangle size={20} className="text-warning mx-auto" />
          <p className="text-text-primary text-sm font-medium">You do not have access to PIP records.</p>
          <p className="text-text-muted text-xs">The server said: {error}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {['ALL', ...PIP_STATUSES].map((s) => (
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
                  {s.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
            <button type="button" className={BTN_PRIMARY} onClick={() => setCreateOpen(true)}>
              <span className="inline-flex items-center gap-1.5">
                <Plus size={14} /> New PIP
              </span>
            </button>
          </div>

          {loading && <LoadingBlock label="Loading PIPs…" />}

          {error && !loading && (
            <div className="space-y-2">
              <ErrorBlock message={error} />
              <button type="button" className={BTN_SECONDARY} onClick={load}>
                Retry
              </button>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && <EmptyBlock message="No PIPs for this filter" />}

          {!loading && filtered.length > 0 && (
            <TableShell headers={['Employee', 'Reason', 'Period', 'Status']}>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="hover:bg-bg-hover transition-colors cursor-pointer"
                  onClick={() => setDetailId(Number(r.id))}
                >
                  <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{text(r.employeeName)}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary">{truncate(r.reason)}</td>
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">
                    {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(r.status).replace(/_/g, ' ')} tone={STATUS_TONE[r.status] ?? 'default'} dot />
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </>
      )}

      <AnimatePresence>
        {createOpen && (
          <CreatePipModal
            onClose={() => setCreateOpen(false)}
            onSaved={() => {
              setCreateOpen(false);
              load();
            }}
          />
        )}
        {detailId !== null && <PipDetailModal pipId={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function CreatePipModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { employees } = useApp();
  const [employeeId, setEmployeeId] = useState('');
  const [pipReason, setPipReason] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [objectives, setObjectives] = useState<{ objective: string; successCriteria: string }[]>([
    { objective: '', successCriteria: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (i: number, changes: Partial<{ objective: string; successCriteria: string }>) =>
    setObjectives((prev) => prev.map((o, j) => (j === i ? { ...o, ...changes } : o)));

  const save = () => {
    setBusy(true);
    setError(null);
    talentApi
      .createPip({
        employeeId: Number(employeeId),
        reason: pipReason.trim(),
        startDate,
        endDate,
        objectives: objectives
          .filter((o) => o.objective.trim() !== '')
          .map((o) => ({ objective: o.objective.trim(), successCriteria: o.successCriteria.trim() || null })),
      })
      .then(() => onSaved())
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title="New performance improvement plan"
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy || !employeeId || !pipReason.trim() || !startDate || !endDate}
            onClick={save}
          >
            {busy ? 'Creating…' : 'Create PIP (draft)'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBlock message={error} />}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={LABEL_CLS}>Employee</label>
            <select className={INPUT_CLS} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select…</option>
              {(employees ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.empCode} · {emp.fullName}
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
        <div>
          <label className={LABEL_CLS}>Reason</label>
          <textarea className={INPUT_CLS} rows={2} value={pipReason} onChange={(e) => setPipReason(e.target.value)} />
        </div>
        <div className="space-y-2">
          <p className={LABEL_CLS}>Objectives</p>
          {objectives.map((o, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  className={INPUT_CLS}
                  placeholder="Objective"
                  value={o.objective}
                  onChange={(e) => patch(i, { objective: e.target.value })}
                />
                <input
                  className={INPUT_CLS}
                  placeholder="Success criteria"
                  value={o.successCriteria}
                  onChange={(e) => patch(i, { successCriteria: e.target.value })}
                />
              </div>
              <button
                type="button"
                aria-label="Remove objective"
                className="text-text-muted hover:text-danger transition-colors mt-2"
                onClick={() => setObjectives((prev) => prev.filter((_, j) => j !== i))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-primary text-xs font-medium hover:underline"
            onClick={() => setObjectives((prev) => [...prev, { objective: '', successCriteria: '' }])}
          >
            + Add objective
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function PipDetailModal({
  pipId,
  onClose,
  onChanged,
}: {
  pipId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pip, setPip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'none' | 'extend' | 'close' | 'escalate'>('none');

  // Panels
  const [newEndDate, setNewEndDate] = useState('');
  const [extendReason, setExtendReason] = useState('');
  const [outcome, setOutcome] = useState('SUCCESSFUL');
  const [outcomeNote, setOutcomeNote] = useState('');
  const [escalateReason, setEscalateReason] = useState('');

  // Add review
  const [reviewDate, setReviewDate] = useState('');
  const [progress, setProgress] = useState('ON_TRACK');
  const [summary, setSummary] = useState('');
  const [nextSteps, setNextSteps] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    talentApi
      .pip(pipId)
      .then((p) => setPip(p ?? null))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [pipId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = (fn: () => Promise<any>, after?: () => void) => {
    setBusy(true);
    setActionError(null);
    fn()
      .then(() => {
        after?.();
        setPanel('none');
        load();
        onChanged();
      })
      .catch((err) => setActionError(reason(err)))
      .finally(() => setBusy(false));
  };

  const objectives: any[] = Array.isArray(pip?.objectives) ? pip.objectives : [];
  const reviews: any[] = Array.isArray(pip?.reviews) ? pip.reviews : [];
  const status = String(pip?.status ?? '');
  const isClosed = ['CLOSED_SUCCESSFUL', 'CLOSED_UNSUCCESSFUL', 'WITHDRAWN'].includes(status);
  const canActivate = ['DRAFT', 'PENDING_APPROVAL'].includes(status);
  const canExtend = ['ACTIVE', 'EXTENDED', 'ESCALATED'].includes(status);
  const canEscalate = ['ACTIVE', 'EXTENDED'].includes(status);

  return (
    <ModalShell
      title={pip ? `PIP — ${text(pip.employeeName)}` : 'PIP'}
      subtitle={pip ? `${fmtDate(pip.startDate)} – ${fmtDate(pip.endDate)}` : null}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        pip && !isClosed ? (
          <div className="flex items-center justify-end gap-2 flex-wrap">
            {canEscalate && (
              <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => setPanel('escalate')}>
                Escalate
              </button>
            )}
            {canExtend && (
              <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => setPanel('extend')}>
                Extend
              </button>
            )}
            {!canActivate && (
              <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => setPanel('close')}>
                Close
              </button>
            )}
            {canActivate && (
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={busy}
                onClick={() => run(() => talentApi.activatePip(pipId))}
              >
                Activate
              </button>
            )}
          </div>
        ) : null
      }
    >
      {loading ? (
        <LoadingBlock label="Loading the PIP…" />
      ) : error ? (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      ) : pip ? (
        <div className="space-y-4">
          {actionError && <ErrorBlock message={actionError} />}

          <div className="flex items-center gap-2 flex-wrap">
            <Chip label={status.replace(/_/g, ' ')} tone={STATUS_TONE[status] ?? 'default'} dot />
            {pip.closedAt && <span className="text-text-muted text-xs">closed {fmtDate(pip.closedAt)}</span>}
          </div>

          <div>
            <p className={LABEL_CLS}>Reason</p>
            <p className="text-text-secondary text-xs whitespace-pre-wrap">{text(pip.reason)}</p>
          </div>

          {pip.outcomeNote && (
            <div className="rounded-md bg-bg-secondary border border-border-default px-3 py-2">
              <p className={LABEL_CLS}>Outcome note</p>
              <p className="text-text-secondary text-xs">{pip.outcomeNote}</p>
            </div>
          )}

          {panel === 'extend' && (
            <div className="rounded-md border border-border-default bg-bg-secondary p-3 space-y-2">
              <p className="text-text-primary text-sm font-semibold">Extend the PIP</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>New end date</label>
                  <input type="date" className={INPUT_CLS} value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Reason</label>
                  <input className={INPUT_CLS} value={extendReason} onChange={(e) => setExtendReason(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setPanel('none')}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={busy || !newEndDate || !extendReason.trim()}
                  onClick={() => run(() => talentApi.extendPip(pipId, { newEndDate, reason: extendReason.trim() }))}
                >
                  Extend
                </button>
              </div>
            </div>
          )}

          {panel === 'close' && (
            <div className="rounded-md border border-border-default bg-bg-secondary p-3 space-y-2">
              <p className="text-text-primary text-sm font-semibold">Close the PIP</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Outcome</label>
                  <select className={INPUT_CLS} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                    {OUTCOMES.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Note (optional)</label>
                  <input className={INPUT_CLS} value={outcomeNote} onChange={(e) => setOutcomeNote(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setPanel('none')}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={busy}
                  onClick={() => run(() => talentApi.closePip(pipId, { outcome, note: outcomeNote.trim() || undefined }))}
                >
                  Close PIP
                </button>
              </div>
            </div>
          )}

          {panel === 'escalate' && (
            <div className="rounded-md border border-border-default bg-bg-secondary p-3 space-y-2">
              <p className="text-text-primary text-sm font-semibold">Escalate the PIP</p>
              <div>
                <label className={LABEL_CLS}>Reason</label>
                <textarea
                  className={INPUT_CLS}
                  rows={2}
                  value={escalateReason}
                  onChange={(e) => setEscalateReason(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setPanel('none')}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={busy || !escalateReason.trim()}
                  onClick={() => run(() => talentApi.escalatePip(pipId, escalateReason.trim()))}
                >
                  Escalate
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-text-primary text-sm font-semibold">Objectives</p>
            {objectives.length === 0 && <EmptyBlock message="No objectives recorded" />}
            {objectives.map((o) => (
              <div
                key={o.id}
                className="rounded-md border border-border-light bg-bg-secondary p-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-text-primary text-xs font-medium">{text(o.objective)}</p>
                  {o.successCriteria && (
                    <p className="text-text-muted text-[11px] mt-0.5">Success criteria: {o.successCriteria}</p>
                  )}
                </div>
                <select
                  className={`${INPUT_CLS} py-1 w-32 flex-shrink-0`}
                  value={o.status}
                  disabled={busy || isClosed}
                  aria-label="Objective status"
                  onChange={(e) => run(() => pipFix.updateObjective(Number(o.id), { status: e.target.value }))}
                >
                  {OBJECTIVE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="flex items-center gap-2 flex-wrap">
              {OBJECTIVE_STATUSES.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 text-[10px] text-text-muted">
                  <Chip label={s.replace(/_/g, ' ')} tone={OBJECTIVE_TONE[s]} />
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-text-primary text-sm font-semibold">Check-in reviews</p>
            {reviews.length === 0 && <p className="text-text-muted text-xs">No check-ins recorded yet.</p>}
            <div className="space-y-2">
              {reviews.map((r) => (
                <div key={r.id} className="rounded-md border border-border-light bg-bg-card p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-text-primary text-xs font-medium">{fmtDate(r.reviewDate)}</span>
                    <Chip label={text(r.progress).replace(/_/g, ' ')} tone={PROGRESS_TONE[r.progress] ?? 'default'} />
                  </div>
                  {r.summary && <p className="text-text-secondary text-xs mt-1">{r.summary}</p>}
                  {r.nextSteps && <p className="text-text-muted text-[11px] mt-1">Next steps: {r.nextSteps}</p>}
                </div>
              ))}
            </div>

            {!isClosed && (
              <div className="rounded-md border border-border-default p-3 space-y-3">
                <p className={LABEL_CLS}>Add check-in review</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLS}>Review date</label>
                    <input type="date" className={INPUT_CLS} value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Progress</label>
                    <select className={INPUT_CLS} value={progress} onChange={(e) => setProgress(e.target.value)}>
                      {PROGRESS_VALUES.map((p) => (
                        <option key={p} value={p}>
                          {p.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Summary</label>
                    <input className={INPUT_CLS} value={summary} onChange={(e) => setSummary(e.target.value)} />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Next steps</label>
                    <input className={INPUT_CLS} value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className={BTN_PRIMARY}
                    disabled={busy || !reviewDate}
                    onClick={() =>
                      run(
                        () =>
                          talentApi.addPipReview(pipId, {
                            reviewDate,
                            progress,
                            summary: summary.trim() || null,
                            nextSteps: nextSteps.trim() || null,
                          }),
                        () => {
                          setReviewDate('');
                          setSummary('');
                          setNextSteps('');
                        },
                      )
                    }
                  >
                    {busy ? 'Saving…' : 'Add review'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </ModalShell>
  );
}
