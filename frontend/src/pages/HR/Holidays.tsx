import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Chip,
  TableShell,
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  BTN_PRIMARY,
} from '../../components/common/HrmsUI';
import { attendanceApi } from '../../api/hrms';
import type { Holiday } from '../../types/hrms';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

const errMsg = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

const dayName = (value: string): string => {
  const iso = (value ?? '').slice(0, 10);
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { weekday: 'long' });
};

/** Holiday calendar for a year, with an inline add row. */
export function Holidays() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [rows, setRows] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [isOptional, setIsOptional] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    attendanceApi
      .holidays(year)
      .then(setRows)
      .catch((err: unknown) => setError(errMsg(err, 'Failed to load holidays')))
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!date) {
      window.alert('Pick a date for the holiday.');
      return;
    }
    if (!name.trim()) {
      window.alert('Enter a name for the holiday.');
      return;
    }
    setSaving(true);
    try {
      await attendanceApi.createHoliday({ date, name: name.trim(), isOptional });
      setDate('');
      setName('');
      setIsOptional(false);
      load();
    } catch (err) {
      window.alert(errMsg(err, 'Failed to add the holiday'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (holiday: Holiday) => {
    if (!window.confirm(`Delete “${holiday.name}” from the holiday calendar?`)) return;
    try {
      await attendanceApi.deleteHoliday(holiday.id);
      load();
    } catch (err) {
      window.alert(errMsg(err, 'Failed to delete the holiday'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {YEARS.map((y) => (
          <button
            key={y}
            onClick={() => setYear(y)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
              year === y
                ? 'bg-primary-light border-primary/30 text-primary'
                : 'border-border-default text-text-muted hover:border-text-muted'
            }`}
          >
            {y}
          </button>
        ))}
      </div>

      <div className="bg-bg-secondary border border-border-default rounded-md p-3">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="w-44">
            <label className={LABEL_CLS}>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT_CLS} />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className={LABEL_CLS}>Holiday name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Diwali"
              className={INPUT_CLS}
            />
          </div>
          <label className="flex items-center gap-2 h-[38px] px-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isOptional}
              onChange={(e) => setIsOptional(e.target.checked)}
              className="accent-primary"
            />
            <span className="text-text-secondary text-xs">Optional</span>
          </label>
          <button onClick={add} disabled={saving} className={`${BTN_PRIMARY} flex items-center gap-2`}>
            <Plus size={14} />
            Add
          </button>
        </div>
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading holidays…" />
      ) : rows.length === 0 ? (
        <EmptyBlock message={`No holidays recorded for ${year}`} hint="Add the first one using the row above." />
      ) : (
        <TableShell headers={['Date', 'Name', 'Type', 'Actions']}>
          {rows.map((h) => (
            <tr key={h.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2.5">
                <p className="text-text-primary text-sm font-mono">{(h.date ?? '').slice(0, 10)}</p>
                <p className="text-text-muted text-[10px]">{dayName(h.date)}</p>
              </td>
              <td className="px-3 py-2.5 text-text-primary text-sm">{h.name}</td>
              <td className="px-3 py-2.5">
                <Chip label={h.isOptional ? 'Optional' : 'Public'} tone={h.isOptional ? 'warning' : 'info'} />
              </td>
              <td className="px-3 py-2.5">
                <button
                  onClick={() => remove(h)}
                  className="text-danger border border-danger/30 hover:bg-danger-light px-2 py-1 rounded text-xs transition-colors inline-flex items-center gap-1"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </TableShell>
      )}
    </div>
  );
}
