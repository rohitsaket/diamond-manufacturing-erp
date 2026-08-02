import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Pencil, Trash2, X, Loader2 } from 'lucide-react';
import { attendanceApi } from '../../api/hrms';
import type { Shift } from '../../types/hrms';
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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface ShiftForm {
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  graceMinutes: string;
  weekOffDay: number;
  isDefault: boolean;
}

const EMPTY_FORM: ShiftForm = {
  name: '',
  startTime: '09:00',
  endTime: '18:00',
  breakMinutes: '30',
  graceMinutes: '10',
  weekOffDay: 0,
  isDefault: false,
};

/** Backend may send HH:MM:SS; <input type="time"> wants HH:MM. */
const toTimeInput = (v: string | null | undefined): string => (v ? v.slice(0, 5) : '');

const minutesOfDay = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const errText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

export function ShiftsTab() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [form, setForm] = useState<ShiftForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    attendanceApi
      .shifts()
      .then(setShifts)
      .catch((err: unknown) => {
        setShifts([]);
        setError(errText(err, 'Could not load shifts.'));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setPanelOpen(true);
  };

  const openEdit = (shift: Shift) => {
    setEditing(shift);
    setForm({
      name: shift.name,
      startTime: toTimeInput(shift.startTime),
      endTime: toTimeInput(shift.endTime),
      breakMinutes: String(shift.breakMinutes ?? 0),
      graceMinutes: String(shift.graceMinutes ?? 0),
      weekOffDay: Number(shift.weekOffDay ?? 0),
      isDefault: Boolean(shift.isDefault),
    });
    setErrors({});
    setPanelOpen(true);
  };

  const closePanel = () => {
    setPanelOpen(false);
    setEditing(null);
    setErrors({});
  };

  const validate = (): Record<string, string> => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'Shift name is required';
    if (!form.startTime) next.startTime = 'Start time is required';
    if (!form.endTime) next.endTime = 'End time is required';
    if (form.startTime && form.endTime && minutesOfDay(form.endTime) <= minutesOfDay(form.startTime)) {
      next.endTime = 'End time must be after start time';
    }
    const brk = Number(form.breakMinutes);
    if (form.breakMinutes === '' || Number.isNaN(brk) || brk < 0) next.breakMinutes = 'Must be 0 or more';
    const grace = Number(form.graceMinutes);
    if (form.graceMinutes === '' || Number.isNaN(grace) || grace < 0) next.graceMinutes = 'Must be 0 or more';
    return next;
  };

  const handleSubmit = async () => {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const body = {
      name: form.name.trim(),
      startTime: form.startTime,
      endTime: form.endTime,
      breakMinutes: Number(form.breakMinutes),
      graceMinutes: Number(form.graceMinutes),
      weekOffDay: form.weekOffDay,
      isDefault: form.isDefault,
    };

    setSaving(true);
    try {
      if (editing) await attendanceApi.updateShift(editing.id, body);
      else await attendanceApi.createShift(body);
      closePanel();
      load();
    } catch (err) {
      window.alert(errText(err, 'Failed to save shift'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (shift: Shift) => {
    if (!window.confirm(`Delete shift "${shift.name}"? This cannot be undone.`)) return;
    try {
      await attendanceApi.deleteShift(shift.id);
      load();
    } catch (err) {
      window.alert(errText(err, 'Failed to delete shift'));
    }
  };

  // Drop the default border colour before appending border-danger, otherwise the
  // two border-* utilities collide and CSS source order decides the winner.
  const fieldCls = (key: string) =>
    errors[key] ? `${INPUT_CLS.replace('border-border-default', '')} border-danger` : INPUT_CLS;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-text-secondary text-sm">
          {shifts.length} shift{shifts.length === 1 ? '' : 's'} configured
        </p>
        <button type="button" onClick={openCreate} className={`${BTN_PRIMARY} flex items-center gap-2`}>
          <Plus size={14} />
          New shift
        </button>
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading shifts…" />
      ) : shifts.length === 0 && !error ? (
        <EmptyBlock message="No shifts defined yet" hint="Create a shift to set working hours and the weekly off." />
      ) : shifts.length === 0 ? null : (
        <TableShell
          headers={['Name', 'Start', 'End', 'Break (min)', 'Grace (min)', 'Week off', 'Default', 'Actions']}
        >
          {shifts.map((s) => (
            <tr key={s.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-text-primary text-sm font-medium">{s.name}</td>
              <td className="px-3 py-2 text-text-secondary text-xs font-mono">{toTimeInput(s.startTime)}</td>
              <td className="px-3 py-2 text-text-secondary text-xs font-mono">{toTimeInput(s.endTime)}</td>
              <td className="px-3 py-2 text-text-secondary text-xs font-mono">{s.breakMinutes}</td>
              <td className="px-3 py-2 text-text-secondary text-xs font-mono">{s.graceMinutes}</td>
              <td className="px-3 py-2 text-text-secondary text-xs">{WEEKDAYS[s.weekOffDay] ?? '—'}</td>
              <td className="px-3 py-2">{s.isDefault ? <Chip tone="primary" label="Default" /> : null}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openEdit(s)}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border-default text-text-muted hover:border-primary/30 hover:text-primary transition-colors"
                  >
                    <Pencil size={10} />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(s)}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border-default text-text-muted hover:border-danger/30 hover:text-danger transition-colors"
                  >
                    <Trash2 size={10} />
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {panelOpen && (
          <motion.div
            key="shift-panel"
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed right-0 top-0 h-full w-80 bg-bg-card border-l border-border-default z-40 p-5 overflow-y-auto shadow-modal"
          >
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h3 className="text-text-primary font-semibold text-base">
                  {editing ? 'Edit shift' : 'New shift'}
                </h3>
                <p className="text-text-muted text-xs mt-0.5">Working hours and weekly off</p>
              </div>
              <button
                type="button"
                onClick={closePanel}
                aria-label="Close"
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className={LABEL_CLS} htmlFor="shift-name">
                  Shift name
                </label>
                <input
                  id="shift-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="General"
                  className={fieldCls('name')}
                />
                {errors.name && <p className="text-danger text-[9px] mt-0.5">{errors.name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS} htmlFor="shift-start">
                    Start time
                  </label>
                  <input
                    id="shift-start"
                    type="time"
                    value={form.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                    className={fieldCls('startTime')}
                  />
                  {errors.startTime && <p className="text-danger text-[9px] mt-0.5">{errors.startTime}</p>}
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="shift-end">
                    End time
                  </label>
                  <input
                    id="shift-end"
                    type="time"
                    value={form.endTime}
                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                    className={fieldCls('endTime')}
                  />
                  {errors.endTime && <p className="text-danger text-[9px] mt-0.5">{errors.endTime}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS} htmlFor="shift-break">
                    Break (min)
                  </label>
                  <input
                    id="shift-break"
                    type="number"
                    min={0}
                    value={form.breakMinutes}
                    onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })}
                    className={fieldCls('breakMinutes')}
                  />
                  {errors.breakMinutes && <p className="text-danger text-[9px] mt-0.5">{errors.breakMinutes}</p>}
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="shift-grace">
                    Grace (min)
                  </label>
                  <input
                    id="shift-grace"
                    type="number"
                    min={0}
                    value={form.graceMinutes}
                    onChange={(e) => setForm({ ...form, graceMinutes: e.target.value })}
                    className={fieldCls('graceMinutes')}
                  />
                  {errors.graceMinutes && <p className="text-danger text-[9px] mt-0.5">{errors.graceMinutes}</p>}
                </div>
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="shift-weekoff">
                  Week off
                </label>
                <select
                  id="shift-weekoff"
                  value={form.weekOffDay}
                  onChange={(e) => setForm({ ...form, weekOffDay: Number(e.target.value) })}
                  className={INPUT_CLS}
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                  className="accent-primary"
                />
                <span className="text-text-secondary text-sm">Use as the default shift</span>
              </label>
            </div>

            <div className="flex items-center gap-2 mt-6">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                className={`${BTN_PRIMARY} flex items-center gap-2`}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editing ? 'Save changes' : 'Create shift'}
              </button>
              <button type="button" onClick={closePanel} className={BTN_SECONDARY}>
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
