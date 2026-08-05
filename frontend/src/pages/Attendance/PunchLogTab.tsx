import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { attendanceApi } from '../../api/attendance';
import { useApp } from '../../contexts/AppContext';
import {
  BTN_PRIMARY, BTN_SECONDARY, EmptyBlock, ErrorBlock, INPUT_CLS, LABEL_CLS,
  LoadingBlock, TableShell,
} from '../../components/common/HrmsUI';
import { ModalShell } from '../../components/common/ModalShell';
import { TabBar } from '../../components/common/TabBar';
import { CAPTURE_METHOD_LABELS, PUNCH_TYPE_LABELS, WORK_MODE_LABELS } from '../../types/attendance';
import type { CaptureMethod, PunchType, WorkMode } from '../../types/attendance';
import {
  ActionFeedback, DateRangePicker, RefreshButton, StatusChip, addDaysISO,
  formatDateTime, todayISO, useAction, useAsync,
} from './shared';

const METHODS: CaptureMethod[] = ['WEB', 'MOBILE', 'KIOSK', 'BIOMETRIC', 'QR', 'NFC', 'MANUAL', 'IMPORT', 'AUTO'];
const TYPES: PunchType[] = ['IN', 'OUT', 'BREAK_OUT', 'BREAK_IN'];
const MODES: WorkMode[] = ['OFFICE', 'REMOTE', 'HYBRID', 'CLIENT_SITE', 'FIELD', 'WORK_SITE', 'BUSINESS_TRAVEL'];

/** The raw event stream behind every attendance figure. */
export function PunchLogTab() {
  const [from, setFrom] = useState(addDaysISO(todayISO(), -7));
  const [to, setTo] = useState(todayISO());
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('');
  const [type, setType] = useState('');
  const [geoStatus, setGeoStatus] = useState('');
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [deleting, setDeleting] = useState<{ id: number; label: string } | null>(null);

  const { data, loading, error, reload } = useAsync(
    () => attendanceApi.punches({
      from, to, search: search || undefined, captureMethod: method || undefined,
      punchType: type || undefined, geoStatus: geoStatus || undefined, page, pageSize: 50,
    }),
    [from, to, search, method, type, geoStatus, page],
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-2 flex-wrap">
          <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); setPage(1); }} />
          <div>
            <label className={LABEL_CLS}>Search</label>
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Name or code"
              className={`${INPUT_CLS} w-44`}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Type</label>
            <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className={`${INPUT_CLS} w-36`}>
              <option value="">All</option>
              {TYPES.map((t) => <option key={t} value={t}>{PUNCH_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Method</label>
            <select value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }} className={`${INPUT_CLS} w-36`}>
              <option value="">All</option>
              {METHODS.map((m) => <option key={m} value={m}>{CAPTURE_METHOD_LABELS[m]}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Location</label>
            <select value={geoStatus} onChange={(e) => { setGeoStatus(e.target.value); setPage(1); }} className={`${INPUT_CLS} w-36`}>
              <option value="">All</option>
              <option value="INSIDE">Inside fence</option>
              <option value="OUTSIDE">Outside fence</option>
              <option value="NO_FIX">No fix</option>
              <option value="LOW_ACCURACY">Low accuracy</option>
              <option value="NOT_REQUIRED">Not checked</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton onClick={reload} busy={loading} />
          <button onClick={() => setShowAdd(true)} className={BTN_PRIMARY}>
            <span className="flex items-center gap-1.5"><Plus size={14} /> Add punch</span>
          </button>
        </div>
      </div>

      {loading && !data && <LoadingBlock label="Loading punches…" />}
      {error && <ErrorBlock message={error} />}

      {data && (data.rows.length === 0 ? (
        <EmptyBlock message="No punches match these filters" hint="Widen the date range or clear a filter." />
      ) : (
        <>
          <TableShell headers={['When', 'Employee', 'Type', 'Method', 'Mode', 'Device', 'Location', 'Source', '']}>
            {data.rows.map((p) => (
              <tr key={p.id} className="hover:bg-bg-hover transition-colors">
                <td className="px-3 py-2 text-sm text-text-primary whitespace-nowrap">
                  <span className="tabular-nums">{p.punchDate}</span>
                  <span className="text-text-muted ml-2 tabular-nums">{p.punchTime}</span>
                </td>
                <td className="px-3 py-2 text-sm text-text-primary">
                  {p.employeeName}
                  <span className="text-text-muted text-xs ml-1.5">{p.empCode}</span>
                </td>
                <td className="px-3 py-2 text-sm text-text-secondary">{PUNCH_TYPE_LABELS[p.punchType]}</td>
                <td className="px-3 py-2 text-sm text-text-secondary">{CAPTURE_METHOD_LABELS[p.captureMethod]}</td>
                <td className="px-3 py-2 text-sm text-text-secondary">{WORK_MODE_LABELS[p.workMode]}</td>
                <td className="px-3 py-2 text-sm text-text-muted">{p.deviceName ?? '—'}</td>
                <td className="px-3 py-2">
                  {p.geoStatus === 'NOT_REQUIRED'
                    ? <span className="text-text-muted text-xs">Not checked</span>
                    : (
                      <span className="inline-flex items-center gap-1.5">
                        <StatusChip value={p.geoStatus} />
                        {p.distanceM !== null && <span className="text-text-muted text-xs tabular-nums">{p.distanceM} m</span>}
                      </span>
                    )}
                </td>
                <td className="px-3 py-2 text-xs text-text-muted">
                  {p.isOffline ? 'Offline sync' : p.isManualEntry ? 'Manual' : 'Live'}
                  {p.clientPunchId && <span className="block text-[10px] opacity-70">{p.clientPunchId}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setDeleting({ id: p.id, label: `${p.employeeName} · ${p.punchDate} ${p.punchTime}` })}
                    className="text-text-muted hover:text-danger transition-colors"
                    aria-label="Remove punch"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </TableShell>

          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>{data.total.toLocaleString('en-IN')} punch(es) · page {data.page} of {totalPages}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className={`${BTN_SECONDARY} py-1 px-3 text-xs`}>Previous</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className={`${BTN_SECONDARY} py-1 px-3 text-xs`}>Next</button>
            </div>
          </div>
        </>
      ))}

      {showAdd && <AddPunchModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); reload(); }} />}
      {deleting && (
        <DeletePunchModal
          punch={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); reload(); }}
        />
      )}
    </div>
  );
}

function AddPunchModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { employees } = useApp();
  const working = employees.filter((e) => e.workStatus === 'WORKING');
  const { busy, error, notice, run } = useAction();

  const [tab, setTab] = useState('single');
  const [employeeId, setEmployeeId] = useState<number | ''>('');
  const [punchType, setPunchType] = useState<PunchType>('IN');
  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>('MANUAL');
  const [workMode, setWorkMode] = useState<WorkMode>('OFFICE');
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState('09:00');
  const [remarks, setRemarks] = useState('');
  const [batchJson, setBatchJson] = useState('');

  const submitSingle = async () => {
    if (!employeeId) return;
    const ok = await run(
      () => attendanceApi.recordPunch({
        employeeId: Number(employeeId), punchType, captureMethod, workMode,
        capturedAt: new Date(`${date}T${time}:00`).toISOString(),
        remarks: remarks || undefined,
      }),
      'Punch recorded and the day recomputed.',
    );
    if (ok) window.setTimeout(onSaved, 600);
  };

  const submitBatch = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(batchJson);
    } catch {
      await run(() => Promise.reject(new Error('That is not valid JSON')));
      return;
    }
    if (!Array.isArray(parsed)) {
      await run(() => Promise.reject(new Error('The batch must be a JSON array of punch objects')));
      return;
    }
    const ok = await run(async () => {
      const result = await attendanceApi.syncOffline(parsed as Record<string, unknown>[]);
      if (result.rejected.length) {
        throw new Error(
          `${result.accepted} accepted, ${result.duplicates} duplicate, ${result.rejected.length} rejected. First problem: row ${result.rejected[0]!.index} — ${result.rejected[0]!.reason}`,
        );
      }
      return result;
    }, 'Batch replayed. Every row was accepted or already present.');
    if (ok) window.setTimeout(onSaved, 900);
  };

  return (
    <ModalShell
      title="Add a punch"
      subtitle="Recorded through the same engine as a device punch, so policy and geofencing apply identically"
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
          <button onClick={tab === 'single' ? submitSingle : submitBatch} disabled={busy} className={BTN_PRIMARY}>
            {busy ? 'Saving…' : tab === 'single' ? 'Record punch' : 'Replay batch'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <TabBar
          tabs={[{ id: 'single', label: 'Single punch' }, { id: 'batch', label: 'Offline batch' }]}
          active={tab}
          onChange={setTab}
        />
        <ActionFeedback error={error} notice={notice} />

        {tab === 'single' ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={LABEL_CLS}>Employee</label>
              <select value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))} className={INPUT_CLS}>
                <option value="">Select an employee</option>
                {working.map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.empCode}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Punch type</label>
              <select value={punchType} onChange={(e) => setPunchType(e.target.value as PunchType)} className={INPUT_CLS}>
                {TYPES.map((t) => <option key={t} value={t}>{PUNCH_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Capture method</label>
              <select value={captureMethod} onChange={(e) => setCaptureMethod(e.target.value as CaptureMethod)} className={INPUT_CLS}>
                {METHODS.map((m) => <option key={m} value={m}>{CAPTURE_METHOD_LABELS[m]}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Time</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Work mode</label>
              <select value={workMode} onChange={(e) => setWorkMode(e.target.value as WorkMode)} className={INPUT_CLS}>
                {MODES.map((m) => <option key={m} value={m}>{WORK_MODE_LABELS[m]}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Remarks</label>
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={INPUT_CLS} placeholder="Optional" />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-text-secondary text-xs leading-relaxed">
              Paste a JSON array of punches captured while a client was offline. Each row needs a
              <code className="mx-1 px-1 rounded bg-bg-hover text-text-primary">clientPunchId</code>
              so replaying the same batch is a no-op rather than a duplicate.
            </p>
            <textarea
              value={batchJson}
              onChange={(e) => setBatchJson(e.target.value)}
              rows={10}
              spellCheck={false}
              className={`${INPUT_CLS} font-mono text-xs`}
              placeholder={`[\n  {"employeeId": 1, "punchType": "IN", "captureMethod": "MOBILE", "clientPunchId": "abc-1", "capturedAt": "${todayISO()}T09:05:00.000Z"}\n]`}
            />
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function DeletePunchModal({
  punch, onClose, onDeleted,
}: {
  punch: { id: number; label: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();

  const submit = async () => {
    const ok = await run(() => attendanceApi.deletePunch(punch.id, reason));
    if (ok) onDeleted();
  };

  return (
    <ModalShell
      title="Remove this punch"
      subtitle={punch.label}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
          <button onClick={submit} disabled={busy || !reason.trim()} className={`${BTN_PRIMARY} bg-danger hover:bg-danger`}>
            {busy ? 'Removing…' : 'Remove punch'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <ActionFeedback error={error} notice={null} />
        <p className="text-text-secondary text-sm leading-relaxed">
          The punch is soft-deleted and the day is recomputed from what remains, so the attendance
          figures stay consistent with the events behind them. The removal is written to the audit log.
        </p>
        <div>
          <label className={LABEL_CLS}>Reason (required)</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={INPUT_CLS}
            placeholder="Why is this punch being removed?"
          />
        </div>
      </div>
    </ModalShell>
  );
}

export { formatDateTime };
