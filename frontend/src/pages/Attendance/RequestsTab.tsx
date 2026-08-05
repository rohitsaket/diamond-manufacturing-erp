import { useState } from 'react';
import { AlertCircle, Check, Plus, X, Zap } from 'lucide-react';
import { attendanceApi } from '../../api/attendance';
import { useApp } from '../../contexts/AppContext';
import {
  BTN_PRIMARY, BTN_SECONDARY, Chip, EmptyBlock, ErrorBlock, INPUT_CLS, LABEL_CLS,
  LoadingBlock, TableShell,
} from '../../components/common/HrmsUI';
import { ModalShell } from '../../components/common/ModalShell';
import { TabBar } from '../../components/common/TabBar';
import { REQUEST_TYPE_LABELS } from '../../types/attendance';
import type { AttendanceRequest, AttendanceRequestType } from '../../types/attendance';
import {
  ActionFeedback, RefreshButton, StatusChip, addDaysISO, formatDate, formatDateTime,
  todayISO, useAction, useAsync,
} from './shared';

const STATUS_TABS = [
  { id: 'PENDING', label: 'Pending' },
  { id: 'ESCALATED', label: 'Escalated' },
  { id: 'APPLIED', label: 'Applied' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: '', label: 'All' },
];

const REQUEST_TYPES = Object.keys(REQUEST_TYPE_LABELS) as AttendanceRequestType[];

/** The approval queue: everything an employee can ask to change about a day. */
export function RequestsTab() {
  const [status, setStatus] = useState('PENDING');
  const [requestType, setRequestType] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<AttendanceRequest | null>(null);
  const [showNew, setShowNew] = useState(false);
  const escalate = useAction();

  const { data, loading, error, reload } = useAsync(
    () => attendanceApi.requests({
      status: status || undefined, requestType: requestType || undefined,
      overdueOnly: overdueOnly || undefined, search: search || undefined, pageSize: 100,
    }),
    [status, requestType, overdueOnly, search],
  );
  const summary = useAsync(() => attendanceApi.requestSummary(), []);

  const counts = summary.data ?? {};

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <TabBar
          tabs={STATUS_TABS.map((t) => ({ ...t, count: t.id ? counts[t.id] ?? 0 : undefined }))}
          active={status}
          onChange={setStatus}
        />
        <div className="flex items-center gap-2">
          <RefreshButton onClick={() => { reload(); summary.reload(); }} busy={loading} />
          <button
            onClick={() => escalate.run(
              async () => {
                const r = await attendanceApi.runEscalations();
                reload();
                if (!r.escalated && !r.autoApproved) throw new Error('Nothing is past its SLA right now.');
                return r;
              },
              'Escalations processed.',
            )}
            disabled={escalate.busy}
            className={BTN_SECONDARY}
            title="Move anything past its approval SLA to the next approver"
          >
            <span className="flex items-center gap-1.5"><Zap size={14} /> Run escalations</span>
          </button>
          <button onClick={() => setShowNew(true)} className={BTN_PRIMARY}>
            <span className="flex items-center gap-1.5"><Plus size={14} /> New request</span>
          </button>
        </div>
      </div>

      <ActionFeedback error={escalate.error} notice={escalate.notice} />

      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className={LABEL_CLS}>Type</label>
          <select value={requestType} onChange={(e) => setRequestType(e.target.value)} className={`${INPUT_CLS} w-48`}>
            <option value="">All types</option>
            {REQUEST_TYPES.map((t) => <option key={t} value={t}>{REQUEST_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Search</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, code or request no" className={`${INPUT_CLS} w-56`} />
        </div>
        <label className="flex items-center gap-2 text-xs text-text-secondary pb-2.5 cursor-pointer">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} className="rounded" />
          Past SLA only
        </label>
      </div>

      {loading && !data && <LoadingBlock label="Loading requests…" />}
      {error && <ErrorBlock message={error} />}

      {data && (data.rows.length === 0 ? (
        <EmptyBlock message="No requests match these filters" />
      ) : (
        <TableShell headers={['Request', 'Type', 'Employee', 'For date', 'Level', 'Raised', 'Due', 'Status', '']}>
          {data.rows.map((r) => (
            <tr key={r.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-sm text-text-primary font-medium tabular-nums">{r.requestNo}</td>
              <td className="px-3 py-2 text-sm text-text-secondary">{REQUEST_TYPE_LABELS[r.requestType]}</td>
              <td className="px-3 py-2 text-sm text-text-primary">
                {r.employeeName}
                <span className="text-text-muted text-xs ml-1.5">{r.empCode}</span>
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">
                {formatDate(r.attDate)}
                {r.toDate && r.toDate !== r.attDate && <span className="text-text-muted"> → {formatDate(r.toDate)}</span>}
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">{r.currentLevel}/{r.totalLevels}</td>
              <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{formatDateTime(r.submittedAt)}</td>
              <td className="px-3 py-2 text-xs whitespace-nowrap">
                {r.dueAt ? (
                  <span className={r.isOverdue ? 'text-danger font-medium' : 'text-text-muted'}>
                    {r.isOverdue && <AlertCircle size={11} className="inline mr-1 -mt-0.5" />}
                    {formatDateTime(r.dueAt)}
                  </span>
                ) : <span className="text-text-muted">—</span>}
              </td>
              <td className="px-3 py-2"><StatusChip value={r.status} /></td>
              <td className="px-3 py-2 text-right">
                <button onClick={() => setOpen(r)} className="text-primary text-xs font-medium hover:underline">Open</button>
              </td>
            </tr>
          ))}
        </TableShell>
      ))}

      {open && (
        <RequestDetailModal
          request={open}
          onClose={() => setOpen(null)}
          onChanged={() => { setOpen(null); reload(); summary.reload(); }}
        />
      )}
      {showNew && <NewRequestModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); reload(); summary.reload(); }} />}
    </div>
  );
}

function RequestDetailModal({
  request, onClose, onChanged,
}: {
  request: AttendanceRequest;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, loading } = useAsync(() => attendanceApi.request(request.id), [request.id]);
  const { busy, error, notice, run } = useAction();
  const [comments, setComments] = useState('');

  const full = data ?? request;
  const decidable = full.status === 'PENDING' || full.status === 'ESCALATED';

  const decide = async (decision: 'APPROVE' | 'REJECT') => {
    const ok = await run(
      () => attendanceApi.decideRequest(full.id, decision, comments || undefined),
      decision === 'APPROVE' ? 'Approved.' : 'Rejected.',
    );
    if (ok) window.setTimeout(onChanged, 700);
  };

  return (
    <ModalShell
      title={`${full.requestNo} · ${REQUEST_TYPE_LABELS[full.requestType]}`}
      subtitle={`${full.employeeName} · ${formatDate(full.attDate)}`}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={decidable ? (
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={BTN_SECONDARY}>Close</button>
          <button onClick={() => decide('REJECT')} disabled={busy} className={`${BTN_SECONDARY} text-danger border-danger/40`}>
            <span className="flex items-center gap-1.5"><X size={14} /> Reject</span>
          </button>
          <button onClick={() => decide('APPROVE')} disabled={busy} className={BTN_PRIMARY}>
            <span className="flex items-center gap-1.5"><Check size={14} /> Approve level {full.currentLevel}</span>
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-text-muted text-xs">
            {full.status === 'APPLIED' ? 'Approved and written to the attendance record.' : `This request is ${full.status.toLowerCase()}.`}
          </span>
          <button onClick={onClose} className={BTN_SECONDARY}>Close</button>
        </div>
      )}
    >
      {loading && !data && <LoadingBlock />}
      <div className="space-y-4">
        <ActionFeedback error={error} notice={notice} />

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="Status" value={<StatusChip value={full.status} />} />
          <Field label="Approval level" value={`${full.currentLevel} of ${full.totalLevels}`} />
          <Field label="Raised" value={formatDateTime(full.submittedAt)} />
          <Field label="Due" value={full.dueAt ? formatDateTime(full.dueAt) : '—'} />
          <Field label="Decided" value={formatDateTime(full.decidedAt)} />
          <Field label="Applied" value={formatDateTime(full.appliedAt)} />
        </div>

        {full.reason && (
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Reason given</p>
            <p className="text-text-primary text-sm leading-relaxed bg-bg-secondary rounded-md px-3 py-2">{full.reason}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Currently recorded</p>
            <ValueBlock value={full.currentValue} empty="No attendance record existed for this day." />
          </div>
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Requested</p>
            <ValueBlock
              value={full.requestedHours !== null ? { hours: full.requestedHours, ...(full.requestedValue ?? {}) } : full.requestedValue}
              empty="Nothing specified."
            />
          </div>
        </div>

        {full.counterpartyResponse !== 'NOT_REQUIRED' && (
          <div className="px-3 py-2.5 rounded-md bg-info-light border border-info/30">
            <p className="text-info text-xs font-semibold">
              Swap with {full.counterpartyName ?? 'a colleague'} — {full.counterpartyResponse.toLowerCase()}
            </p>
            <p className="text-text-secondary text-xs mt-0.5">
              A swap cannot be approved until the other employee accepts it.
            </p>
          </div>
        )}

        {full.decisionNote && (
          <div className="px-3 py-2.5 rounded-md bg-bg-secondary border border-border-default">
            <p className="text-text-muted text-[10px] uppercase tracking-wider mb-0.5">Decision note</p>
            <p className="text-text-secondary text-sm">{full.decisionNote}</p>
          </div>
        )}

        {!!full.approvals?.length && (
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1.5">Approval chain</p>
            <div className="space-y-2">
              {full.approvals.map((a) => (
                <div key={a.id} className="flex items-start gap-3 px-3 py-2 rounded-md border border-border-default">
                  <span className="w-6 h-6 rounded-full bg-bg-hover flex items-center justify-center text-xs font-semibold text-text-secondary flex-shrink-0">
                    {a.level}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-text-primary text-sm">
                        {a.approverName ?? a.approverRole ?? a.approverType.replace(/_/g, ' ').toLowerCase()}
                      </span>
                      <StatusChip value={a.decision} />
                      {a.delegatedFromName && <Chip label={`for ${a.delegatedFromName}`} tone="info" />}
                      {a.escalatedAt && <Chip label="escalated" tone="danger" />}
                    </div>
                    {a.comments && <p className="text-text-secondary text-xs mt-1">{a.comments}</p>}
                    <p className="text-text-muted text-[11px] mt-0.5">
                      {a.decidedAt ? `Decided ${formatDateTime(a.decidedAt)}${a.decidedByName ? ` by ${a.decidedByName}` : ''}`
                        : a.dueAt ? `Due ${formatDateTime(a.dueAt)}` : 'Waiting'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {decidable && (
          <div>
            <label className={LABEL_CLS}>Comment (optional)</label>
            <input value={comments} onChange={(e) => setComments(e.target.value)} className={INPUT_CLS} placeholder="Recorded against your decision" />
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-text-muted text-[10px] uppercase tracking-wider mb-0.5">{label}</p>
      <div className="text-text-primary text-sm">{value}</div>
    </div>
  );
}

function ValueBlock({ value, empty }: { value: Record<string, unknown> | null; empty: string }) {
  const entries = Object.entries(value ?? {}).filter(([, v]) => v !== null && v !== undefined);
  if (!entries.length) return <p className="text-text-muted text-xs bg-bg-secondary rounded-md px-3 py-2">{empty}</p>;
  return (
    <div className="bg-bg-secondary rounded-md px-3 py-2 space-y-1">
      {entries.map(([key, v]) => (
        <div key={key} className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-text-muted capitalize">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
          <span className="text-text-primary font-medium tabular-nums">{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

function NewRequestModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { employees } = useApp();
  const working = employees.filter((e) => e.workStatus === 'WORKING');
  const { busy, error, notice, run } = useAction();

  const [requestType, setRequestType] = useState<AttendanceRequestType>('REGULARIZATION');
  const [employeeId, setEmployeeId] = useState<number | ''>('');
  const [attDate, setAttDate] = useState(addDaysISO(todayISO(), -1));
  const [toDate, setToDate] = useState('');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('PRESENT');
  const [inTime, setInTime] = useState('09:00');
  const [outTime, setOutTime] = useState('19:00');
  const [hours, setHours] = useState('2');
  const [counterparty, setCounterparty] = useState<number | ''>('');

  const needsTimes = ['REGULARIZATION', 'MISSED_PUNCH', 'CORRECTION'].includes(requestType);
  const needsHours = requestType === 'OVERTIME';
  const needsRange = ['REMOTE_WORK', 'ON_DUTY'].includes(requestType);
  const needsCounterparty = requestType === 'SHIFT_SWAP';

  const submit = async () => {
    if (!employeeId) return;
    const requestedValue: Record<string, unknown> = {};
    if (needsTimes) {
      if (requestType === 'REGULARIZATION') requestedValue.status = status;
      requestedValue.inTime = inTime;
      requestedValue.outTime = outTime;
    }
    if (needsRange) requestedValue.workMode = requestType === 'REMOTE_WORK' ? 'REMOTE' : 'BUSINESS_TRAVEL';

    const ok = await run(
      () => attendanceApi.createRequest({
        requestType,
        employeeId: Number(employeeId),
        attDate,
        toDate: needsRange && toDate ? toDate : undefined,
        requestedValue: Object.keys(requestedValue).length ? requestedValue : undefined,
        requestedHours: needsHours ? Number(hours) : undefined,
        counterpartyEmployeeId: needsCounterparty && counterparty ? Number(counterparty) : undefined,
        reason: reason || undefined,
      }),
      'Request raised and routed to its first approver.',
    );
    if (ok) window.setTimeout(onSaved, 700);
  };

  return (
    <ModalShell
      title="Raise an attendance request"
      subtitle="Policy limits are enforced when it is raised, not when it is approved"
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
          <button onClick={submit} disabled={busy || !employeeId} className={BTN_PRIMARY}>
            {busy ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <ActionFeedback error={error} notice={notice} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Request type</label>
            <select value={requestType} onChange={(e) => setRequestType(e.target.value as AttendanceRequestType)} className={INPUT_CLS}>
              {REQUEST_TYPES.map((t) => <option key={t} value={t}>{REQUEST_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Employee</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))} className={INPUT_CLS}>
              <option value="">Select an employee</option>
              {working.map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.empCode}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>{needsRange ? 'From date' : 'Date'}</label>
            <input type="date" value={attDate} onChange={(e) => setAttDate(e.target.value)} className={INPUT_CLS} />
          </div>
          {needsRange && (
            <div>
              <label className={LABEL_CLS}>To date</label>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={INPUT_CLS} />
            </div>
          )}
          {requestType === 'REGULARIZATION' && (
            <div>
              <label className={LABEL_CLS}>Mark the day as</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT_CLS}>
                <option value="PRESENT">Present</option>
                <option value="HALF_DAY">Half day</option>
                <option value="LEAVE">Leave</option>
              </select>
            </div>
          )}
          {needsTimes && (
            <>
              <div>
                <label className={LABEL_CLS}>In time</label>
                <input type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>Out time</label>
                <input type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} className={INPUT_CLS} />
              </div>
            </>
          )}
          {needsHours && (
            <div>
              <label className={LABEL_CLS}>Overtime hours</label>
              <input type="number" step="0.25" min="0" value={hours} onChange={(e) => setHours(e.target.value)} className={INPUT_CLS} />
            </div>
          )}
          {needsCounterparty && (
            <div>
              <label className={LABEL_CLS}>Swap with</label>
              <select value={counterparty} onChange={(e) => setCounterparty(Number(e.target.value))} className={INPUT_CLS}>
                <option value="">Select a colleague</option>
                {working.filter((e) => e.id !== employeeId).map((e) => (
                  <option key={e.id} value={e.id}>{e.fullName} · {e.empCode}</option>
                ))}
              </select>
            </div>
          )}
          <div className="col-span-2">
            <label className={LABEL_CLS}>Reason</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={INPUT_CLS} placeholder="What happened, and what should the record say?" />
          </div>
        </div>
        {needsTimes && (
          <p className="text-text-muted text-xs leading-relaxed">
            Worked hours are recomputed from the corrected in/out pair on approval rather than taken
            from what is typed here.
          </p>
        )}
      </div>
    </ModalShell>
  );
}
