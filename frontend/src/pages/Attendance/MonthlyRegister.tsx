import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { attendanceApi } from '../../api/hrms';
import { ATTENDANCE_STATUSES, ATTENDANCE_STYLE, type RegisterRow } from '../../types/hrms';
import {
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  BTN_SECONDARY,
} from '../../components/common/HrmsUI';

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Days in a YYYY-MM string, leap years included. */
function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return 0;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function weekdayInitial(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return '';
  return WEEKDAY_INITIALS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()] ?? '';
}

const dayKey = (month: string, day: number): string => `${month}-${String(day).padStart(2, '0')}`;

function pctTone(pct: number): string {
  if (pct >= 90) return 'text-success';
  if (pct >= 75) return 'text-warning';
  return 'text-danger';
}

const csvEscape = (v: string | number): string => {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportRegisterCsv(month: string, rows: RegisterRow[], dayCount: number) {
  const days = Array.from({ length: dayCount }, (_, i) => i + 1);
  const headers = [
    'Worker',
    'Code',
    ...days.map((d) => String(d)),
    'Present',
    'Absent',
    'Half day',
    'Leave',
    'OT hrs',
    'Att %',
  ];
  const lines = [
    headers.join(','),
    ...rows.map((row) =>
      [
        row.employeeName,
        row.empCode,
        ...days.map((d) => {
          const cell = row.days[dayKey(month, d)];
          return cell ? ATTENDANCE_STYLE[cell.status].letter : '';
        }),
        row.totals.present,
        row.totals.absent,
        row.totals.halfDay,
        row.totals.leave,
        row.totals.otHours,
        row.totals.attendancePct,
      ]
        .map(csvEscape)
        .join(','),
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance-register-${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function MonthlyRegister() {
  const [month, setMonth] = useState<string>(currentMonth());
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    attendanceApi
      .register(month)
      .then((data) => {
        if (cancelled) return;
        setRows(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRows([]);
        setError(err instanceof Error ? err.message : 'Could not load the monthly register.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const dayCount = useMemo(() => daysInMonth(month), [month]);
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => i + 1), [dayCount]);

  const perDayPresent = useMemo(
    () =>
      days.map((d) => {
        const key = dayKey(month, d);
        return rows.reduce((sum, row) => {
          const cell = row.days[key];
          return sum + (cell && (cell.status === 'PRESENT' || cell.status === 'HALF_DAY') ? 1 : 0);
        }, 0);
      }),
    [days, month, rows],
  );

  const grand = useMemo(() => {
    const t = { present: 0, absent: 0, halfDay: 0, leave: 0, otHours: 0, pct: 0 };
    for (const row of rows) {
      t.present += row.totals.present;
      t.absent += row.totals.absent;
      t.halfDay += row.totals.halfDay;
      t.leave += row.totals.leave;
      t.otHours += Number(row.totals.otHours ?? 0);
      t.pct += Number(row.totals.attendancePct ?? 0);
    }
    t.pct = rows.length > 0 ? t.pct / rows.length : 0;
    return t;
  }, [rows]);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-48">
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className={INPUT_CLS}
          />
        </div>
        <button
          type="button"
          onClick={() => exportRegisterCsv(month, rows, dayCount)}
          disabled={rows.length === 0}
          className={`${BTN_SECONDARY} flex items-center gap-2 ml-auto`}
        >
          <Download size={14} />
          Export CSV
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 flex-wrap">
        {ATTENDANCE_STATUSES.map((s) => (
          <span
            key={s}
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${ATTENDANCE_STYLE[s].chip}`}
          >
            <span className="font-semibold">{ATTENDANCE_STYLE[s].letter}</span>
            {ATTENDANCE_STYLE[s].label}
          </span>
        ))}
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading register…" />
      ) : rows.length === 0 && !error ? (
        <EmptyBlock message="No attendance recorded for this month" hint="Mark a day on the Daily Marking tab." />
      ) : rows.length === 0 ? null : (
        <div className="rounded-md border border-border-default overflow-hidden bg-bg-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-bg-secondary">
                <tr>
                  <th className="sticky left-0 z-10 bg-bg-secondary px-3 py-2 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap">
                    Worker
                  </th>
                  {days.map((d) => (
                    <th key={d} className="px-0.5 py-1 text-center text-[10px] font-semibold text-text-secondary">
                      <div className="tabular-nums">{d}</div>
                      <div className="text-text-muted text-[9px] font-normal">{weekdayInitial(month, d)}</div>
                    </th>
                  ))}
                  {['P', 'A', '½', 'L', 'OT hrs', 'Att %'].map((h) => (
                    <th
                      key={h}
                      className="px-2 py-2 text-center text-[10px] font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {rows.map((row) => (
                  <tr key={row.employeeId} className="hover:bg-bg-hover transition-colors">
                    <td className="sticky left-0 z-10 bg-bg-card px-3 py-2 whitespace-nowrap border-r border-border-light">
                      <div className="text-text-primary text-xs font-semibold">{row.employeeName}</div>
                      <div className="text-text-muted text-[10px] font-mono">{row.empCode}</div>
                    </td>
                    {days.map((d) => {
                      const cell = row.days[dayKey(month, d)];
                      return (
                        <td key={d} className="px-0.5 py-1 text-center">
                          <span
                            className={`inline-block w-7 text-center text-[10px] font-semibold rounded py-0.5 ${
                              cell ? ATTENDANCE_STYLE[cell.status].cell : 'text-text-muted'
                            }`}
                            title={cell ? ATTENDANCE_STYLE[cell.status].label : 'No entry'}
                          >
                            {cell ? ATTENDANCE_STYLE[cell.status].letter : '·'}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-center text-text-primary text-xs font-mono">{row.totals.present}</td>
                    <td className="px-2 py-2 text-center text-text-primary text-xs font-mono">{row.totals.absent}</td>
                    <td className="px-2 py-2 text-center text-text-primary text-xs font-mono">{row.totals.halfDay}</td>
                    <td className="px-2 py-2 text-center text-text-primary text-xs font-mono">{row.totals.leave}</td>
                    <td className="px-2 py-2 text-center text-text-secondary text-xs font-mono">
                      {Number(row.totals.otHours ?? 0).toFixed(2)}
                    </td>
                    <td
                      className={`px-2 py-2 text-center text-xs font-mono font-semibold ${pctTone(Number(row.totals.attendancePct ?? 0))}`}
                    >
                      {Number(row.totals.attendancePct ?? 0).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-bg-secondary border-t border-border-default">
                <tr>
                  <td className="sticky left-0 z-10 bg-bg-secondary px-3 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap border-r border-border-light">
                    Present / day
                  </td>
                  {perDayPresent.map((count, i) => (
                    <td key={days[i]} className="px-0.5 py-2 text-center text-[10px] font-mono text-text-secondary">
                      {count || ''}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center text-xs font-mono font-bold text-text-primary">{grand.present}</td>
                  <td className="px-2 py-2 text-center text-xs font-mono font-bold text-text-primary">{grand.absent}</td>
                  <td className="px-2 py-2 text-center text-xs font-mono font-bold text-text-primary">{grand.halfDay}</td>
                  <td className="px-2 py-2 text-center text-xs font-mono font-bold text-text-primary">{grand.leave}</td>
                  <td className="px-2 py-2 text-center text-xs font-mono font-bold text-text-primary">
                    {grand.otHours.toFixed(2)}
                  </td>
                  <td className={`px-2 py-2 text-center text-xs font-mono font-bold ${pctTone(grand.pct)}`}>
                    {grand.pct.toFixed(1)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
