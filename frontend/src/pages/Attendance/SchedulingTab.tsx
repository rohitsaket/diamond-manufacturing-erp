import { useMemo, useState } from 'react';
import { CalendarRange, Moon, Plus, Repeat, Trash2, Users } from 'lucide-react';
import { attendanceApi } from '../../api/attendance';
import { useApp } from '../../contexts/AppContext';
import {
  BTN_PRIMARY, BTN_SECONDARY, Chip, EmptyBlock, ErrorBlock, INPUT_CLS, LABEL_CLS,
  LoadingBlock, TableShell,
} from '../../components/common/HrmsUI';
import { ModalShell } from '../../components/common/ModalShell';
import { TabBar } from '../../components/common/TabBar';
import { SHIFT_TYPE_LABELS, WEEKDAY_LABELS } from '../../types/attendance';
import type { Roster, ShiftDetail, ShiftType } from '../../types/attendance';
import {
  ActionFeedback, RefreshButton, StatusChip, addDaysISO, formatDate, todayISO,
  useAction, useAsync,
} from './shared';

const SUB_TABS = [
  { id: 'shifts', label: 'Shift definitions' },
  { id: 'rotations', label: 'Rotation patterns' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'rosters', label: 'Rosters' },
];

export function SchedulingTab() {
  const [tab, setTab] = useState('shifts');
  return (
    <div className="space-y-4">
      <TabBar tabs={SUB_TABS} active={tab} onChange={setTab} />
      {tab === 'shifts' && <ShiftDefinitions />}
      {tab === 'rotations' && <Rotations />}
      {tab === 'assignments' && <Assignments />}
      {tab === 'rosters' && <Rosters />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shift definitions
// ---------------------------------------------------------------------------
function ShiftDefinitions() {
  const { data, loading, error, reload } = useAsync(() => attendanceApi.shiftDetails(true), []);
  const [editing, setEditing] = useState<ShiftDetail | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-text-secondary text-sm">
          The enterprise view of every shift, including the kinds the classic Shifts tab cannot express:
          cross-midnight nights, split shifts and flexible windows.
        </p>
        <div className="flex items-center gap-2">
          <RefreshButton onClick={reload} busy={loading} />
          <button onClick={() => setCreating(true)} className={BTN_PRIMARY}>
            <span className="flex items-center gap-1.5"><Plus size={14} /> New shift</span>
          </button>
        </div>
      </div>

      {loading && !data && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}

      {data && (data.length === 0 ? <EmptyBlock message="No shifts defined" /> : (
        <TableShell headers={['Code', 'Name', 'Type', 'Window', 'Break', 'Grace', 'Week off', 'Full day', 'OT', 'On shift', 'Status', '']}>
          {data.map((s) => (
            <tr key={s.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-sm text-text-muted tabular-nums">{s.code ?? '—'}</td>
              <td className="px-3 py-2 text-sm text-text-primary font-medium">
                <span className="flex items-center gap-1.5">
                  {s.color && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />}
                  {s.name}
                  {s.isDefault && <Chip label="default" tone="primary" />}
                </span>
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary">
                <span className="flex items-center gap-1.5">
                  {s.isNightShift && <Moon size={12} className="text-info" />}
                  {SHIFT_TYPE_LABELS[s.shiftType]}
                </span>
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary tabular-nums whitespace-nowrap">
                {s.startTime} – {s.endTime}
                {s.crossesMidnight && <span className="text-info text-[10px] ml-1.5">+1d</span>}
                {s.secondStartTime && (
                  <span className="block text-text-muted text-xs">{s.secondStartTime} – {s.secondEndTime}</span>
                )}
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">{s.breakMinutes}m</td>
              <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">{s.graceMinutes}m</td>
              <td className="px-3 py-2 text-xs text-text-secondary">
                {s.weekOffDays.map((d) => WEEKDAY_LABELS[d]).join(', ') || '—'}
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">{s.fullDayHours ?? '—'}</td>
              <td className="px-3 py-2 text-xs">{s.otEligible ? <Chip label="eligible" tone="info" /> : <span className="text-text-muted">No</span>}</td>
              <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">{s.assignedCount ?? 0}</td>
              <td className="px-3 py-2"><StatusChip value={s.status} /></td>
              <td className="px-3 py-2 text-right">
                <button onClick={() => setEditing(s)} className="text-primary text-xs font-medium hover:underline">Edit</button>
              </td>
            </tr>
          ))}
        </TableShell>
      ))}

      {(creating || editing) && (
        <ShiftModal
          shift={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function ShiftModal({ shift, onClose, onSaved }: { shift: ShiftDetail | null; onClose: () => void; onSaved: () => void }) {
  const { busy, error, notice, run } = useAction();
  const [form, setForm] = useState({
    code: shift?.code ?? '',
    name: shift?.name ?? '',
    shiftType: (shift?.shiftType ?? 'FIXED') as ShiftType,
    startTime: shift?.startTime ?? '09:00',
    endTime: shift?.endTime ?? '18:00',
    crossesMidnight: shift?.crossesMidnight ?? false,
    secondStartTime: shift?.secondStartTime ?? '',
    secondEndTime: shift?.secondEndTime ?? '',
    flexibleCoreStart: shift?.flexibleCoreStart ?? '',
    flexibleCoreEnd: shift?.flexibleCoreEnd ?? '',
    flexibleMinHours: shift?.flexibleMinHours ?? 8,
    breakMinutes: shift?.breakMinutes ?? 60,
    graceMinutes: shift?.graceMinutes ?? 15,
    fullDayHours: shift?.fullDayHours ?? 8,
    halfDayHours: shift?.halfDayHours ?? 4,
    weekOffDays: shift?.weekOffDays ?? [0],
    otEligible: shift?.otEligible ?? true,
    color: shift?.color ?? '#2563eb',
    maxEmployees: shift?.maxEmployees ?? '',
    status: shift?.status ?? 'ACTIVE',
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    const payload = {
      ...form,
      code: form.code || null,
      maxEmployees: form.maxEmployees === '' ? null : Number(form.maxEmployees),
      secondStartTime: form.secondStartTime || null,
      secondEndTime: form.secondEndTime || null,
      flexibleCoreStart: form.flexibleCoreStart || null,
      flexibleCoreEnd: form.flexibleCoreEnd || null,
    };
    const ok = await run(
      () => (shift ? attendanceApi.updateShiftDetail(shift.id, payload as never) : attendanceApi.createShiftDetail(payload as never)),
      shift ? 'Shift updated.' : 'Shift created.',
    );
    if (ok) window.setTimeout(onSaved, 600);
  };

  return (
    <ModalShell
      title={shift ? `Edit ${shift.name}` : 'New shift'}
      subtitle="A shift that ends before it starts must be marked as crossing midnight, and only a night shift may do so"
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
          <button onClick={submit} disabled={busy} className={BTN_PRIMARY}>{busy ? 'Saving…' : 'Save shift'}</button>
        </div>
      }
    >
      <div className="space-y-4">
        <ActionFeedback error={error} notice={notice} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Code</label>
            <input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} className={INPUT_CLS} placeholder="GEN" />
          </div>
          <div>
            <label className={LABEL_CLS}>Name</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Shift type</label>
            <select value={form.shiftType} onChange={(e) => set('shiftType', e.target.value as ShiftType)} className={INPUT_CLS}>
              {(Object.keys(SHIFT_TYPE_LABELS) as ShiftType[]).map((t) => (
                <option key={t} value={t}>{SHIFT_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Colour</label>
            <input type="color" value={form.color} onChange={(e) => set('color', e.target.value)} className={`${INPUT_CLS} h-[38px] p-1`} />
          </div>
          <div>
            <label className={LABEL_CLS}>Start</label>
            <input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>End</label>
            <input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} className={INPUT_CLS} />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input type="checkbox" checked={form.crossesMidnight} onChange={(e) => set('crossesMidnight', e.target.checked)} className="rounded" />
            This shift runs past midnight into the next day
          </label>

          {form.shiftType === 'SPLIT' && (
            <>
              <div>
                <label className={LABEL_CLS}>Second segment start</label>
                <input type="time" value={form.secondStartTime} onChange={(e) => set('secondStartTime', e.target.value)} className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>Second segment end</label>
                <input type="time" value={form.secondEndTime} onChange={(e) => set('secondEndTime', e.target.value)} className={INPUT_CLS} />
              </div>
            </>
          )}

          {form.shiftType === 'FLEXIBLE' && (
            <>
              <div>
                <label className={LABEL_CLS}>Core hours start</label>
                <input type="time" value={form.flexibleCoreStart} onChange={(e) => set('flexibleCoreStart', e.target.value)} className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>Core hours end</label>
                <input type="time" value={form.flexibleCoreEnd} onChange={(e) => set('flexibleCoreEnd', e.target.value)} className={INPUT_CLS} />
              </div>
            </>
          )}

          <div>
            <label className={LABEL_CLS}>Break minutes</label>
            <input type="number" min="0" value={form.breakMinutes} onChange={(e) => set('breakMinutes', Number(e.target.value))} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Grace minutes</label>
            <input type="number" min="0" max="240" value={form.graceMinutes} onChange={(e) => set('graceMinutes', Number(e.target.value))} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Full day hours</label>
            <input type="number" step="0.25" value={form.fullDayHours} onChange={(e) => set('fullDayHours', Number(e.target.value))} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Half day hours</label>
            <input type="number" step="0.25" value={form.halfDayHours} onChange={(e) => set('halfDayHours', Number(e.target.value))} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Headcount cap</label>
            <input
              type="number" min="0" value={form.maxEmployees}
              onChange={(e) => set('maxEmployees', e.target.value as never)}
              className={INPUT_CLS} placeholder="No cap"
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Status</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value as 'ACTIVE' | 'INACTIVE')} className={INPUT_CLS}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className={LABEL_CLS}>Weekly off days</label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, index) => {
                const on = form.weekOffDays.includes(index);
                return (
                  <button
                    key={label}
                    onClick={() => set('weekOffDays', on ? form.weekOffDays.filter((d) => d !== index) : [...form.weekOffDays, index].sort())}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                      on ? 'bg-primary-light border-primary/30 text-primary' : 'border-border-default text-text-muted hover:border-text-muted'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input type="checkbox" checked={form.otEligible} onChange={(e) => set('otEligible', e.target.checked)} className="rounded" />
            Hours past this shift count as overtime
          </label>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Rotation patterns
// ---------------------------------------------------------------------------
function Rotations() {
  const { data, loading, error, reload } = useAsync(() => attendanceApi.rotations(), []);
  const shifts = useAsync(() => attendanceApi.shiftDetails(true), []);
  const [creating, setCreating] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const action = useAction();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-text-secondary text-sm">
          A repeating cycle of shift codes. Every non-OFF entry must name a real shift, so a pattern
          can never quietly produce blank days once it is in use.
        </p>
        <div className="flex items-center gap-2">
          <RefreshButton onClick={reload} busy={loading} />
          <button onClick={() => setCreating(true)} className={BTN_PRIMARY}>
            <span className="flex items-center gap-1.5"><Plus size={14} /> New pattern</span>
          </button>
        </div>
      </div>

      <ActionFeedback error={action.error} notice={action.notice} />
      {loading && !data && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}

      {data && (data.length === 0 ? <EmptyBlock message="No rotation patterns defined" /> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.map((r) => (
            <div key={r.id} className="bg-bg-card border border-border-default rounded-md p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-text-primary text-sm font-semibold flex items-center gap-1.5">
                    <Repeat size={14} className="text-primary" /> {r.name}
                  </h4>
                  <p className="text-text-muted text-xs mt-0.5">{r.code} · {r.cycleDays} day cycle</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => setPreviewId(r.id)} className="text-primary text-xs font-medium hover:underline">Preview</button>
                  <button
                    onClick={() => action.run(async () => { await attendanceApi.deleteRotation(r.id); reload(); }, 'Pattern removed.')}
                    className="text-text-muted hover:text-danger transition-colors"
                    aria-label="Delete pattern"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {r.description && <p className="text-text-secondary text-xs mt-2">{r.description}</p>}
              <div className="flex flex-wrap gap-1 mt-3">
                {r.pattern.map((code, index) => (
                  <span
                    key={`${code}-${index}`}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                      code === 'OFF'
                        ? 'bg-bg-hover text-text-muted border-border-default'
                        : 'bg-primary-light text-primary border-primary/30'
                    }`}
                  >
                    {code}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {creating && (
        <RotationModal
          shiftCodes={(shifts.data ?? []).map((s) => s.code).filter(Boolean) as string[]}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); reload(); }}
        />
      )}
      {previewId !== null && <RotationPreviewModal id={previewId} onClose={() => setPreviewId(null)} />}
    </div>
  );
}

function RotationModal({ shiftCodes, onClose, onSaved }: { shiftCodes: string[]; onClose: () => void; onSaved: () => void }) {
  const { busy, error, notice, run } = useAction();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pattern, setPattern] = useState<string[]>(['OFF']);

  const submit = async () => {
    const ok = await run(
      () => attendanceApi.createRotation({ code, name, description: description || null, cycleDays: pattern.length, pattern }),
      'Rotation pattern created.',
    );
    if (ok) window.setTimeout(onSaved, 600);
  };

  return (
    <ModalShell
      title="New rotation pattern"
      subtitle="Build the cycle one day at a time"
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
          <button onClick={submit} disabled={busy || !code || !name} className={BTN_PRIMARY}>
            {busy ? 'Saving…' : 'Create pattern'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <ActionFeedback error={error} notice={notice} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Code</label>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={INPUT_CLS} placeholder="ROT-2X2" />
          </div>
          <div>
            <label className={LABEL_CLS}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLS} placeholder="Two day two night" />
          </div>
          <div className="col-span-2">
            <label className={LABEL_CLS}>Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT_CLS} />
          </div>
        </div>

        <div>
          <label className={LABEL_CLS}>Cycle ({pattern.length} days)</label>
          <div className="space-y-2">
            {pattern.map((entry, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="text-text-muted text-xs w-14 flex-shrink-0">Day {index + 1}</span>
                <select
                  value={entry}
                  onChange={(e) => setPattern((p) => p.map((v, i) => (i === index ? e.target.value : v)))}
                  className={`${INPUT_CLS} flex-1`}
                >
                  <option value="OFF">OFF — rest day</option>
                  {shiftCodes.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button
                  onClick={() => setPattern((p) => p.filter((_, i) => i !== index))}
                  disabled={pattern.length <= 1}
                  className="text-text-muted hover:text-danger disabled:opacity-30"
                  aria-label="Remove day"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button onClick={() => setPattern((p) => [...p, 'OFF'])} className={`${BTN_SECONDARY} mt-2 text-xs py-1.5`}>
            <span className="flex items-center gap-1.5"><Plus size={13} /> Add a day</span>
          </button>
          {!shiftCodes.length && (
            <p className="text-warning text-xs mt-2">
              No shifts have a code yet. Give a shift a code first, or every day here can only be OFF.
            </p>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function RotationPreviewModal({ id, onClose }: { id: number; onClose: () => void }) {
  const [from, setFrom] = useState(todayISO());
  const { data, loading, error } = useAsync(() => attendanceApi.previewRotation(id, from, 28), [id, from]);

  return (
    <ModalShell
      title="Rotation preview"
      subtitle={data ? `${data.pattern.name} projected onto real dates` : null}
      onClose={onClose}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-3">
        <div>
          <label className={LABEL_CLS}>Starting from</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${INPUT_CLS} w-44`} />
        </div>
        {loading && <LoadingBlock />}
        {error && <ErrorBlock message={error} />}
        {data && (
          <div className="grid grid-cols-7 gap-1.5">
            {data.days.map((d) => (
              <div
                key={d.date}
                className={`rounded-md border px-2 py-2 text-center ${
                  d.isOff
                    ? 'bg-bg-hover border-border-default text-text-muted'
                    : 'bg-primary-light border-primary/30 text-primary'
                }`}
              >
                <p className="text-[10px] opacity-70">{formatDate(d.date).slice(0, 6)}</p>
                <p className="text-xs font-semibold mt-0.5">{d.shiftCode}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Effective-dated assignments
// ---------------------------------------------------------------------------
function Assignments() {
  const { employees } = useApp();
  const [activeOn, setActiveOn] = useState(todayISO());
  const [showNew, setShowNew] = useState(false);
  const action = useAction();

  const { data, loading, error, reload } = useAsync(() => attendanceApi.shiftAssignments(undefined, activeOn), [activeOn]);
  const shifts = useAsync(() => attendanceApi.shiftDetails(true), []);
  const rotations = useAsync(() => attendanceApi.rotations(), []);

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <label className={LABEL_CLS}>Assignments in force on</label>
          <input type="date" value={activeOn} onChange={(e) => setActiveOn(e.target.value)} className={`${INPUT_CLS} w-44`} />
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton onClick={reload} busy={loading} />
          <button onClick={() => setShowNew(true)} className={BTN_PRIMARY}>
            <span className="flex items-center gap-1.5"><Plus size={14} /> Assign a shift</span>
          </button>
        </div>
      </div>

      <p className="text-text-secondary text-sm">
        Effective-dated, so "which shift was this employee on that day" has an answer for any past date.
        Assigning a new primary shift closes the previous one the day before it starts.
      </p>

      <ActionFeedback error={action.error} notice={action.notice} />
      {loading && !data && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}

      {data && (data.length === 0 ? (
        <EmptyBlock message="No assignments are in force on this date" />
      ) : (
        <TableShell headers={['Employee', 'Shift', 'Rotation', 'From', 'To', 'Primary', 'Reason', '']}>
          {data.map((a) => (
            <tr key={a.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-sm text-text-primary">
                {a.employeeName}
                <span className="text-text-muted text-xs ml-1.5">{a.empCode}</span>
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary">{a.shiftName ?? '—'}</td>
              <td className="px-3 py-2 text-sm text-text-secondary">{a.rotationPatternName ?? '—'}</td>
              <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">{formatDate(a.effectiveFrom)}</td>
              <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">{a.effectiveTo ? formatDate(a.effectiveTo) : 'Open'}</td>
              <td className="px-3 py-2">{a.isPrimary ? <Chip label="primary" tone="primary" /> : <span className="text-text-muted text-xs">—</span>}</td>
              <td className="px-3 py-2 text-xs text-text-muted max-w-xs truncate">{a.assignmentReason ?? '—'}</td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={() => action.run(async () => { await attendanceApi.deleteShiftAssignment(a.id); reload(); }, 'Assignment removed.')}
                  className="text-text-muted hover:text-danger transition-colors"
                  aria-label="Remove assignment"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </TableShell>
      ))}

      {showNew && (
        <AssignmentModal
          employees={employees.filter((e) => e.workStatus === 'WORKING').map((e) => ({ id: e.id, label: `${e.fullName} · ${e.empCode}` }))}
          shifts={shifts.data ?? []}
          rotations={(rotations.data ?? []).map((r) => ({ id: r.id, name: r.name }))}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); reload(); }}
        />
      )}
    </div>
  );
}

function AssignmentModal({
  employees, shifts, rotations, onClose, onSaved,
}: {
  employees: { id: number; label: string }[];
  shifts: ShiftDetail[];
  rotations: { id: number; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, error, notice, run } = useAction();
  const [employeeId, setEmployeeId] = useState<number | ''>('');
  const [mode, setMode] = useState<'shift' | 'rotation'>('shift');
  const [shiftId, setShiftId] = useState<number | ''>('');
  const [rotationPatternId, setRotationPatternId] = useState<number | ''>('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [effectiveTo, setEffectiveTo] = useState('');
  const [reason, setReason] = useState('');

  const submit = async () => {
    if (!employeeId) return;
    const ok = await run(
      () => attendanceApi.assignShift({
        employeeId: Number(employeeId),
        shiftId: mode === 'shift' && shiftId ? Number(shiftId) : null,
        rotationPatternId: mode === 'rotation' && rotationPatternId ? Number(rotationPatternId) : null,
        rotationAnchorDate: mode === 'rotation' ? effectiveFrom : null,
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        isPrimary: true,
        assignmentReason: reason || null,
      }),
      'Shift assigned.',
    );
    if (ok) window.setTimeout(onSaved, 600);
  };

  return (
    <ModalShell
      title="Assign a shift"
      onClose={onClose}
      maxWidth="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
          <button onClick={submit} disabled={busy || !employeeId} className={BTN_PRIMARY}>{busy ? 'Saving…' : 'Assign'}</button>
        </div>
      }
    >
      <div className="space-y-4">
        <ActionFeedback error={error} notice={notice} />
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={LABEL_CLS}>Employee</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))} className={INPUT_CLS}>
              <option value="">Select an employee</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <TabBar
              tabs={[{ id: 'shift', label: 'Fixed shift' }, { id: 'rotation', label: 'Rotation pattern' }]}
              active={mode}
              onChange={(id) => setMode(id as 'shift' | 'rotation')}
            />
          </div>
          {mode === 'shift' ? (
            <div className="col-span-2">
              <label className={LABEL_CLS}>Shift</label>
              <select value={shiftId} onChange={(e) => setShiftId(Number(e.target.value))} className={INPUT_CLS}>
                <option value="">Select a shift</option>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.startTime}–{s.endTime}){s.maxEmployees ? ` · cap ${s.maxEmployees}` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="col-span-2">
              <label className={LABEL_CLS}>Rotation pattern</label>
              <select value={rotationPatternId} onChange={(e) => setRotationPatternId(Number(e.target.value))} className={INPUT_CLS}>
                <option value="">Select a pattern</option>
                {rotations.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={LABEL_CLS}>Effective from</label>
            <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Effective to</label>
            <input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} className={INPUT_CLS} placeholder="Open ended" />
          </div>
          <div className="col-span-2">
            <label className={LABEL_CLS}>Reason</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT_CLS} placeholder="Why is this changing?" />
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Rosters
// ---------------------------------------------------------------------------
function Rosters() {
  const { data, loading, error, reload } = useAsync(() => attendanceApi.rosters(), []);
  const [showGenerate, setShowGenerate] = useState(false);
  const [open, setOpen] = useState<Roster | null>(null);
  const action = useAction();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-text-secondary text-sm">
          A roster projects the standing assignments, rotations, holidays and approved leave onto a date
          range. Days it cannot fill are left blank rather than padded with a default nobody chose.
        </p>
        <div className="flex items-center gap-2">
          <RefreshButton onClick={reload} busy={loading} />
          <button onClick={() => setShowGenerate(true)} className={BTN_PRIMARY}>
            <span className="flex items-center gap-1.5"><CalendarRange size={14} /> Generate roster</span>
          </button>
        </div>
      </div>

      <ActionFeedback error={action.error} notice={action.notice} />
      {loading && !data && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}

      {data && (data.length === 0 ? <EmptyBlock message="No rosters yet" /> : (
        <TableShell headers={['Code', 'Name', 'Range', 'Scope', 'Employees', 'Cells', 'Status', '']}>
          {data.map((r) => (
            <tr key={r.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-sm text-text-muted tabular-nums">{r.code}</td>
              <td className="px-3 py-2 text-sm text-text-primary font-medium">{r.name}</td>
              <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">
                {formatDate(r.fromDate)} → {formatDate(r.toDate)}
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary">{r.departmentName ?? r.branchName ?? 'All'}</td>
              <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">{r.employeeCount ?? 0}</td>
              <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">{r.entryCount ?? 0}</td>
              <td className="px-3 py-2"><StatusChip value={r.status} /></td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => setOpen(r)} className="text-primary text-xs font-medium hover:underline">Open</button>
                  {r.status === 'DRAFT' && (
                    <button
                      onClick={() => action.run(async () => { await attendanceApi.setRosterStatus(r.id, 'PUBLISHED'); reload(); }, `${r.code} published.`)}
                      className="text-success text-xs font-medium hover:underline"
                    >
                      Publish
                    </button>
                  )}
                  {r.status === 'PUBLISHED' && (
                    <button
                      onClick={() => action.run(async () => { await attendanceApi.setRosterStatus(r.id, 'LOCKED'); reload(); }, `${r.code} locked.`)}
                      className="text-text-secondary text-xs font-medium hover:underline"
                    >
                      Lock
                    </button>
                  )}
                  {r.status === 'DRAFT' && (
                    <button
                      onClick={() => action.run(async () => { await attendanceApi.deleteRoster(r.id); reload(); }, 'Draft removed.')}
                      className="text-text-muted hover:text-danger transition-colors"
                      aria-label="Delete roster"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      ))}

      {showGenerate && <GenerateRosterModal onClose={() => setShowGenerate(false)} onSaved={() => { setShowGenerate(false); reload(); }} />}
      {open && <RosterGridModal roster={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function GenerateRosterModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { busy, error, notice, run } = useAction();
  const [name, setName] = useState('');
  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(addDaysISO(todayISO(), 6));
  const [warnings, setWarnings] = useState<string[]>([]);

  const submit = async () => {
    setWarnings([]);
    const ok = await run(async () => {
      const result = await attendanceApi.generateRoster({ name, fromDate, toDate });
      setWarnings(result.warnings);
      return result;
    }, 'Roster generated as a draft. Review it, then publish.');
    if (ok) window.setTimeout(onSaved, 1400);
  };

  return (
    <ModalShell
      title="Generate a roster"
      subtitle="Projects what is already configured. It invents no coverage of its own."
      onClose={onClose}
      maxWidth="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
          <button onClick={submit} disabled={busy || !name} className={BTN_PRIMARY}>{busy ? 'Generating…' : 'Generate'}</button>
        </div>
      }
    >
      <div className="space-y-4">
        <ActionFeedback error={error} notice={notice} />
        {warnings.map((w) => (
          <div key={w} className="px-3 py-2 rounded-md bg-warning-light border border-warning/30 text-warning text-xs">{w}</div>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={LABEL_CLS}>Roster name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLS} placeholder="Polishing floor, week 34" />
          </div>
          <div>
            <label className={LABEL_CLS}>From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={INPUT_CLS} />
          </div>
        </div>
        <p className="text-text-muted text-xs leading-relaxed">
          A roster can cover at most 92 days and 40,000 cells. Generation always produces a draft —
          nothing affects shift coverage until it is published.
        </p>
      </div>
    </ModalShell>
  );
}

function RosterGridModal({ roster, onClose }: { roster: Roster; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => attendanceApi.roster(roster.id), [roster.id]);
  const capacity = useAsync(() => attendanceApi.rosterCapacity(roster.id), [roster.id]);

  const { dates, byEmployee } = useMemo(() => {
    const entries = data?.entries ?? [];
    const dateSet = new Set<string>();
    const map = new Map<number, { name: string; code: string; cells: Map<string, (typeof entries)[number]> }>();
    for (const e of entries) {
      dateSet.add(e.workDate);
      let row = map.get(e.employeeId);
      if (!row) {
        row = { name: e.employeeName ?? '', code: e.empCode ?? '', cells: new Map() };
        map.set(e.employeeId, row);
      }
      row.cells.set(e.workDate, e);
    }
    return { dates: Array.from(dateSet).sort(), byEmployee: Array.from(map.entries()) };
  }, [data]);

  return (
    <ModalShell
      title={roster.name}
      subtitle={`${roster.code} · ${formatDate(roster.fromDate)} to ${formatDate(roster.toDate)} · ${roster.status.toLowerCase()}`}
      onClose={onClose}
      maxWidth="max-w-6xl"
    >
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-md border border-border-default">
            <table className="w-full">
              <thead className="bg-bg-secondary">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider sticky left-0 bg-bg-secondary z-10">
                    Employee
                  </th>
                  {dates.map((d) => (
                    <th key={d} className="px-1.5 py-2 text-center text-[10px] font-semibold text-text-muted uppercase whitespace-nowrap">
                      {d.slice(8)}
                      <span className="block font-normal opacity-70">
                        {WEEKDAY_LABELS[new Date(`${d}T00:00:00`).getDay()]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {byEmployee.map(([employeeId, row]) => (
                  <tr key={employeeId}>
                    <td className="px-3 py-2 text-sm text-text-primary whitespace-nowrap sticky left-0 bg-bg-card z-10">
                      {row.name}
                      <span className="text-text-muted text-xs ml-1.5">{row.code}</span>
                    </td>
                    {dates.map((d) => {
                      const cell = row.cells.get(d);
                      const off = cell?.isWeekOff || cell?.isHoliday || cell?.isLeave;
                      const label = cell?.isHoliday ? 'H' : cell?.isLeave ? 'L' : cell?.isWeekOff ? 'W' : cell?.shiftCode ?? '·';
                      return (
                        <td key={d} className="px-1 py-1.5 text-center">
                          <span
                            title={cell?.shiftName ?? (off ? 'Not working' : 'No shift resolved')}
                            className={`inline-flex items-center justify-center min-w-[30px] px-1.5 py-1 rounded text-[11px] font-medium border ${
                              off
                                ? 'bg-bg-hover text-text-muted border-border-default'
                                : cell?.shiftId
                                  ? 'bg-primary-light text-primary border-primary/30'
                                  : 'bg-warning-light text-warning border-warning/30'
                            }`}
                            style={cell?.shiftColor && !off ? { background: `${cell.shiftColor}1a`, color: cell.shiftColor, borderColor: `${cell.shiftColor}55` } : undefined}
                          >
                            {label}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {capacity.data && (
            <div>
              <h4 className="text-text-primary text-sm font-semibold mb-2 flex items-center gap-1.5">
                <Users size={14} className="text-primary" /> Planned headcount per shift
              </h4>
              <TableShell headers={['Date', 'Shift', 'Planned', 'Cap', 'Headroom', 'Not working']}>
                {capacity.data.days.flatMap((day) =>
                  (day.shifts.length ? day.shifts : [{ shiftId: null, shiftName: '—', planned: 0, capacity: null, gap: null }]).map((s, i) => (
                    <tr key={`${day.date}-${s.shiftId ?? 'none'}-${i}`}>
                      <td className="px-3 py-1.5 text-sm text-text-secondary whitespace-nowrap">{i === 0 ? formatDate(day.date) : ''}</td>
                      <td className="px-3 py-1.5 text-sm text-text-primary">{s.shiftName}</td>
                      <td className="px-3 py-1.5 text-sm text-text-secondary tabular-nums">{s.planned}</td>
                      <td className="px-3 py-1.5 text-sm text-text-muted tabular-nums">{s.capacity ?? '—'}</td>
                      <td className={`px-3 py-1.5 text-sm tabular-nums ${s.gap !== null && s.gap < 0 ? 'text-danger' : 'text-text-secondary'}`}>
                        {s.gap ?? '—'}
                      </td>
                      <td className="px-3 py-1.5 text-sm text-text-muted tabular-nums">{i === 0 ? day.off : ''}</td>
                    </tr>
                  )),
                )}
              </TableShell>
            </div>
          )}

          <p className="text-text-muted text-xs">
            An amber cell means no shift could be resolved for that employee that day — they have no
            assignment, rotation or standing shift covering it.
          </p>
        </div>
      )}
    </ModalShell>
  );
}
