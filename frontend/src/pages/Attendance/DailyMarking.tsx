import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, CheckCheck, Upload, Save, Loader2 } from 'lucide-react';
import { attendanceApi, leaveApi, type BulkMarkEntry } from '../../api/hrms';
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STYLE,
  type AttendanceRecord,
  type AttendanceStatus,
  type LeaveType,
} from '../../types/hrms';
import {
  StatCard,
  TableShell,
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  BTN_PRIMARY,
  BTN_SECONDARY,
} from '../../components/common/HrmsUI';
import { ImportModal } from './ImportModal';

interface DraftEntry {
  status: AttendanceStatus | null;
  otHours: number;
  remarks: string | null;
  leaveTypeId: number | null;
}

type Draft = Record<number, DraftEntry>;

// Compact in-table control. Built from the same tokens as INPUT_CLS but with its
// own width/padding so nothing collides with INPUT_CLS's `w-full px-3 py-2`.
const CELL_INPUT =
  'bg-bg-card border border-border-default rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 disabled:opacity-40 disabled:cursor-not-allowed';

/** Local (not UTC) YYYY-MM-DD so "today" matches the user's calendar. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + deltaDays);
  return toIsoDate(dt);
}

function draftFromRecords(records: AttendanceRecord[]): Draft {
  const next: Draft = {};
  for (const r of records) {
    next[r.employeeId] = {
      status: r.status,
      otHours: Number(r.otHours ?? 0),
      remarks: r.remarks,
      leaveTypeId: r.leaveTypeId,
    };
  }
  return next;
}

const errText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

export function DailyMarking() {
  const today = useMemo(() => toIsoDate(new Date()), []);

  const [date, setDate] = useState<string>(today);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const isFuture = date > today;

  const load = useCallback((forDate: string) => {
    setLoading(true);
    setError(null);
    attendanceApi
      .daily(forDate)
      .then((rows) => {
        setRecords(rows);
        setDraft(draftFromRecords(rows));
        setDirty(false);
      })
      .catch((err: unknown) => {
        setRecords([]);
        setDraft({});
        setError(errText(err, 'Could not load attendance for this day.'));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  useEffect(() => {
    leaveApi
      .types()
      .then(setLeaveTypes)
      .catch(() => setLeaveTypes([]));
  }, []);

  const confirmDiscard = (): boolean =>
    !dirty || window.confirm('You have unsaved attendance changes. Discard them?');

  const changeDate = (next: string) => {
    if (!next || next === date) return;
    if (next > today) return;
    if (!confirmDiscard()) return;
    setDate(next);
  };

  const patch = (employeeId: number, changes: Partial<DraftEntry>) => {
    setDraft((prev) => {
      const current: DraftEntry = prev[employeeId] ?? {
        status: null,
        otHours: 0,
        remarks: null,
        leaveTypeId: null,
      };
      return { ...prev, [employeeId]: { ...current, ...changes } };
    });
    setDirty(true);
  };

  const setStatus = (employeeId: number, status: AttendanceStatus) => {
    const keepsOt = status === 'PRESENT' || status === 'HALF_DAY';
    const current = draft[employeeId];
    patch(employeeId, {
      status,
      otHours: keepsOt ? Number(current?.otHours ?? 0) : 0,
      leaveTypeId: status === 'LEAVE' ? (current?.leaveTypeId ?? null) : null,
    });
  };

  const markAllPresent = () => {
    setDraft((prev) => {
      const next: Draft = { ...prev };
      for (const r of records) {
        const current = next[r.employeeId];
        next[r.employeeId] = {
          status: 'PRESENT',
          otHours: Number(current?.otHours ?? 0),
          remarks: current?.remarks ?? null,
          leaveTypeId: null,
        };
      }
      return next;
    });
    setDirty(true);
  };

  const handleSave = async () => {
    const entries: BulkMarkEntry[] = [];
    for (const r of records) {
      const d = draft[r.employeeId];
      if (!d || !d.status) continue;
      entries.push({
        employeeId: r.employeeId,
        status: d.status,
        otHours: d.otHours,
        remarks: d.remarks,
        leaveTypeId: d.status === 'LEAVE' ? d.leaveTypeId : null,
      });
    }
    if (entries.length === 0) {
      window.alert('Nothing to save — mark at least one worker first.');
      return;
    }
    setSaving(true);
    try {
      await attendanceApi.bulkMark(date, entries);
      load(date);
    } catch (err) {
      window.alert(errText(err, 'Failed to save attendance'));
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(() => {
    let present = 0;
    let absent = 0;
    let leave = 0;
    let ot = 0;
    for (const r of records) {
      const d = draft[r.employeeId];
      if (!d) continue;
      if (d.status === 'PRESENT') present += 1;
      else if (d.status === 'HALF_DAY') present += 1;
      else if (d.status === 'ABSENT') absent += 1;
      else if (d.status === 'LEAVE') leave += 1;
      ot += Number(d.otHours ?? 0);
    }
    return { present, absent, leave, ot };
  }, [records, draft]);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => changeDate(shiftDate(date, -1))}
            title="Previous day"
            className="p-2 rounded-md border border-border-default text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="w-44">
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => changeDate(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
          <button
            type="button"
            onClick={() => changeDate(shiftDate(date, 1))}
            disabled={date >= today}
            title="Next day"
            className="p-2 rounded-md border border-border-default text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <button
            type="button"
            onClick={markAllPresent}
            disabled={loading || records.length === 0 || isFuture}
            className={`${BTN_SECONDARY} flex items-center gap-2`}
          >
            <CheckCheck size={14} />
            Mark all present
          </button>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className={`${BTN_SECONDARY} flex items-center gap-2`}
          >
            <Upload size={14} />
            Import punches
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving || isFuture}
            className={`${BTN_PRIMARY} flex items-center gap-2`}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save day
          </button>
        </div>
      </div>

      {isFuture && (
        <ErrorBlock message="Attendance cannot be marked for a future date." />
      )}

      {/* Live counters */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Present" value={stats.present} intent="success" hint="Includes half days" />
        <StatCard label="Absent" value={stats.absent} intent="danger" />
        <StatCard label="On leave" value={stats.leave} intent="info" />
        <StatCard label="Total OT hours" value={stats.ot.toFixed(2)} intent="warning" />
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading attendance…" />
      ) : records.length === 0 && !error ? (
        <EmptyBlock message="No working employees found" hint="Add employees before marking attendance." />
      ) : records.length === 0 ? null : (
        <TableShell headers={['Worker', 'Code', 'Status', 'OT hrs', 'Note']}>
          {records.map((r) => {
            const d = draft[r.employeeId];
            const status = d?.status ?? null;
            const otEnabled = status === 'PRESENT' || status === 'HALF_DAY';
            return (
              <tr key={r.employeeId} className="hover:bg-bg-hover transition-colors">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-text-primary text-sm font-medium">{r.employeeName}</span>
                    {status === null && (
                      <span className="text-text-muted text-xs" title="Not marked yet">
                        —
                      </span>
                    )}
                  </div>
                  <span className="text-text-muted text-[10px]">{r.workerType.replace('_', ' ')}</span>
                </td>
                <td className="px-3 py-2 text-text-muted text-xs font-mono">{r.empCode}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    {ATTENDANCE_STATUSES.map((s) => {
                      const active = status === s;
                      const style = ATTENDANCE_STYLE[s];
                      return (
                        <button
                          key={s}
                          type="button"
                          title={style.label}
                          aria-label={style.label}
                          aria-pressed={active}
                          onClick={() => setStatus(r.employeeId, s)}
                          disabled={isFuture}
                          className={`w-7 h-7 rounded-md border text-[11px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                            active ? style.chip : 'border-border-default text-text-muted hover:border-text-muted'
                          }`}
                        >
                          {style.letter}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    max={24}
                    step={0.25}
                    value={d?.otHours ?? 0}
                    disabled={!otEnabled || isFuture}
                    onChange={(e) =>
                      patch(r.employeeId, { otHours: Number(e.target.value) || 0 })
                    }
                    className={`${CELL_INPUT} w-16 font-mono`}
                  />
                </td>
                <td className="px-3 py-2">
                  {status === 'LEAVE' ? (
                    <select
                      value={d?.leaveTypeId ?? ''}
                      disabled={isFuture}
                      onChange={(e) =>
                        patch(r.employeeId, {
                          leaveTypeId: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className={`${CELL_INPUT} w-44`}
                    >
                      <option value="">Leave type…</option>
                      {leaveTypes.map((lt) => (
                        <option key={lt.id} value={lt.id}>
                          {lt.code} · {lt.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={d?.remarks ?? ''}
                      placeholder="Note"
                      disabled={isFuture}
                      onChange={(e) =>
                        patch(r.employeeId, { remarks: e.target.value === '' ? null : e.target.value })
                      }
                      className={`${CELL_INPUT} w-44`}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </TableShell>
      )}

      <AnimatePresence>
        {showImport && (
          <ImportModal
            onClose={() => setShowImport(false)}
            onImported={() => load(date)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
