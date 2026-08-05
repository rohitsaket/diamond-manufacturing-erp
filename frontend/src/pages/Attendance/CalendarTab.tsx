import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { attendanceApi } from '../../api/attendance';
import { useApp } from '../../contexts/AppContext';
import {
  BTN_SECONDARY, EmptyBlock, ErrorBlock, INPUT_CLS, LABEL_CLS, LoadingBlock, TableShell,
} from '../../components/common/HrmsUI';
import { ModalShell } from '../../components/common/ModalShell';
import type { DailyAttendanceDetail } from '../../types/attendance';
import { CAPTURE_METHOD_LABELS, PUNCH_TYPE_LABELS, WEEKDAY_LABELS, WORK_MODE_LABELS } from '../../types/attendance';
import {
  ExceptionChips, StatusChip, formatHours, formatMinutes, monthEndISO, monthStartISO,
  todayISO, useAsync,
} from './shared';

/** Single-letter cell styling, matching the monthly register's colour language. */
const CELL: Record<string, { letter: string; cls: string; label: string }> = {
  PRESENT: { letter: 'P', cls: 'bg-success-light text-success border-success/30', label: 'Present' },
  ABSENT: { letter: 'A', cls: 'bg-danger-light text-danger border-danger/30', label: 'Absent' },
  HALF_DAY: { letter: '½', cls: 'bg-warning-light text-warning border-warning/30', label: 'Half day' },
  LEAVE: { letter: 'L', cls: 'bg-info-light text-info border-info/30', label: 'Leave' },
  HOLIDAY: { letter: 'H', cls: 'bg-primary-light text-primary border-primary/30', label: 'Holiday' },
  WEEK_OFF: { letter: 'W', cls: 'bg-bg-hover text-text-muted border-border-default', label: 'Week off' },
};

/**
 * Month calendar for one employee, with a day drill-down.
 *
 * This is the per-person view the monthly register cannot give: the register is
 * one row per employee across the month, this is one employee across a grid
 * with the punch trail behind each day.
 */
export function CalendarTab() {
  const { employees } = useApp();
  const working = useMemo(
    () => employees.filter((e) => e.workStatus === 'WORKING').sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [employees],
  );

  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const effectiveId = employeeId ?? working[0]?.id ?? null;
  const from = monthStartISO(`${month}-01`);
  const to = monthEndISO(`${month}-01`);

  const { data, loading, error } = useAsync(
    () => (effectiveId
      ? attendanceApi.days({ from, to, employeeId: effectiveId, pageSize: 40 })
      : Promise.resolve(null)),
    [from, to, effectiveId],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, DailyAttendanceDetail>();
    for (const row of data?.rows ?? []) map.set(row.date, row);
    return map;
  }, [data]);

  // Leading blanks so the first of the month lands under its weekday.
  const grid = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y as number, (m as number) - 1, 1));
    const daysInMonth = new Date(Date.UTC(y as number, m as number, 0)).getUTCDate();
    const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
    for (let d = 1; d <= daysInMonth; d += 1) {
      cells.push(`${month}-${String(d).padStart(2, '0')}`);
    }
    return cells;
  }, [month]);

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y as number, (m as number) - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };

  const totals = useMemo(() => {
    const t = { present: 0, absent: 0, halfDay: 0, leave: 0, weekOff: 0, holiday: 0, otHours: 0, lateDays: 0 };
    for (const row of data?.rows ?? []) {
      switch (row.status) {
        case 'PRESENT': t.present += 1; break;
        case 'ABSENT': t.absent += 1; break;
        case 'HALF_DAY': t.halfDay += 1; break;
        case 'LEAVE': t.leave += 1; break;
        case 'WEEK_OFF': t.weekOff += 1; break;
        case 'HOLIDAY': t.holiday += 1; break;
      }
      t.otHours += row.otHours;
      if (row.isLate) t.lateDays += 1;
    }
    return t;
  }, [data]);

  if (!working.length) return <EmptyBlock message="No working employees to show a calendar for" />;

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className={LABEL_CLS}>Employee</label>
          <select
            value={effectiveId ?? ''}
            onChange={(e) => setEmployeeId(Number(e.target.value))}
            className={`${INPUT_CLS} w-64`}
          >
            {working.map((e) => (
              <option key={e.id} value={e.id}>{e.fullName} · {e.empCode}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Month</label>
          <div className="flex items-center gap-1">
            <button onClick={() => shiftMonth(-1)} className={`${BTN_SECONDARY} px-2 py-2`} aria-label="Previous month">
              <ChevronLeft size={15} />
            </button>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={`${INPUT_CLS} w-40`} />
            <button onClick={() => shiftMonth(1)} className={`${BTN_SECONDARY} px-2 py-2`} aria-label="Next month">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>

      {loading && <LoadingBlock label="Loading the month…" />}
      {error && <ErrorBlock message={error} />}

      {!loading && !error && (
        <>
          <div className="bg-bg-card border border-border-default rounded-md p-4">
            <div className="grid grid-cols-7 gap-1.5 mb-2">
              {WEEKDAY_LABELS.map((d) => (
                <div key={d} className="text-center text-[10px] uppercase tracking-wider text-text-muted font-semibold py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {grid.map((date, index) => {
                if (!date) return <div key={`blank-${index}`} />;
                const row = byDate.get(date);
                const cell = row?.status ? CELL[row.status] : null;
                const dayNumber = Number(date.slice(-2));
                const isToday = date === todayISO();

                return (
                  <button
                    key={date}
                    onClick={() => row && setOpenDay(date)}
                    disabled={!row}
                    title={row ? `${cell?.label ?? row.status}${row.otHours ? ` · ${row.otHours} h overtime` : ''}` : 'No record'}
                    className={`aspect-square rounded-md border p-1.5 flex flex-col items-center justify-center transition-colors ${
                      cell ? cell.cls : 'border-border-light text-text-muted'
                    } ${row ? 'hover:ring-1 hover:ring-primary/40 cursor-pointer' : 'cursor-default opacity-60'} ${
                      isToday ? 'ring-1 ring-primary' : ''
                    }`}
                  >
                    <span className="text-[10px] opacity-70 leading-none">{dayNumber}</span>
                    <span className="text-sm font-semibold leading-tight mt-0.5">{cell?.letter ?? '·'}</span>
                    {!!row?.otHours && <span className="text-[9px] leading-none mt-0.5">+{row.otHours}</span>}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-border-light">
              {Object.entries(CELL).map(([key, c]) => (
                <span key={key} className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <span className={`w-4 h-4 rounded border flex items-center justify-center text-[9px] font-semibold ${c.cls}`}>
                    {c.letter}
                  </span>
                  {c.label}
                </span>
              ))}
              <span className="text-[11px] text-text-muted">+n marks overtime hours</span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
            {[
              ['Present', totals.present], ['Half day', totals.halfDay], ['Absent', totals.absent],
              ['Leave', totals.leave], ['Week off', totals.weekOff], ['Holiday', totals.holiday],
              ['Late days', totals.lateDays], ['Overtime', `${Math.round(totals.otHours * 100) / 100} h`],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-bg-card border border-border-default rounded-md px-3 py-2.5">
                <p className="text-text-muted text-[10px] uppercase tracking-wider">{label}</p>
                <p className="text-text-primary text-lg font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {openDay && effectiveId && (
        <DayDetailModal employeeId={effectiveId} date={openDay} onClose={() => setOpenDay(null)} />
      )}
    </div>
  );
}

function DayDetailModal({ employeeId, date, onClose }: { employeeId: number; date: string; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => attendanceApi.dayDetail(employeeId, date), [employeeId, date]);

  return (
    <ModalShell title={`Attendance for ${date}`} subtitle={data?.employeeName ?? null} onClose={onClose} maxWidth="max-w-3xl">
      {loading && <LoadingBlock />}
      {error && <ErrorBlock message={error} />}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Status', <StatusChip key="s" value={data.status} />],
              ['Shift', data.shiftName ?? '—'],
              ['Work mode', WORK_MODE_LABELS[data.workMode]],
              ['First in', data.firstInTime ?? '—'],
              ['Last out', data.lastOutTime ?? '—'],
              ['Gross hours', formatHours(data.grossHours)],
              ['Worked hours', formatHours(data.workedHours)],
              ['Break', formatMinutes(data.breakMinutes)],
              ['Expected', formatHours(data.expectedHours)],
              ['Shortfall', formatHours(data.deficitHours)],
              ['Late by', formatMinutes(data.lateMinutes)],
              ['Left early by', formatMinutes(data.earlyExitMinutes)],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <p className="text-text-muted text-[10px] uppercase tracking-wider mb-0.5">{label}</p>
                <div className="text-text-primary text-sm">{value}</div>
              </div>
            ))}
          </div>

          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1">Exceptions</p>
            <ExceptionChips flags={data.exceptionFlags} />
          </div>

          {data.otHours > 0 && (
            <div className="px-3 py-2.5 rounded-md bg-info-light border border-info/30">
              <p className="text-info text-xs font-semibold">
                {data.otHours} h overtime derived, {data.otApprovedHours} h approved ({data.otStatus.toLowerCase()})
              </p>
              <p className="text-text-secondary text-xs mt-0.5">
                Payroll pays the approved figure, not the derived one.
              </p>
            </div>
          )}

          {data.isLocked && (
            <div className="px-3 py-2.5 rounded-md bg-warning-light border border-warning/30">
              <p className="text-warning text-xs font-semibold">This day is locked for payroll</p>
              <p className="text-text-secondary text-xs mt-0.5">{data.lockedReason ?? 'No reason recorded.'}</p>
            </div>
          )}

          <div>
            <h4 className="text-text-primary text-sm font-semibold mb-2">
              Punch trail {data.punches?.length ? `(${data.punches.length})` : ''}
            </h4>
            {!data.punches?.length ? (
              <p className="text-text-muted text-xs">No punches recorded for this day.</p>
            ) : (
              <TableShell headers={['Time', 'Type', 'Method', 'Device', 'Location']}>
                {data.punches.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 text-sm text-text-primary tabular-nums">{p.punchTime}</td>
                    <td className="px-3 py-2 text-sm text-text-secondary">{PUNCH_TYPE_LABELS[p.punchType]}</td>
                    <td className="px-3 py-2 text-sm text-text-secondary">{CAPTURE_METHOD_LABELS[p.captureMethod]}</td>
                    <td className="px-3 py-2 text-sm text-text-muted">{p.deviceName ?? '—'}</td>
                    <td className="px-3 py-2 text-sm">
                      {p.geoStatus === 'NOT_REQUIRED'
                        ? <span className="text-text-muted text-xs">Not checked</span>
                        : <StatusChip value={p.geoStatus} />}
                    </td>
                  </tr>
                ))}
              </TableShell>
            )}
          </div>

          {!!data.breaks?.length && (
            <div>
              <h4 className="text-text-primary text-sm font-semibold mb-2">Breaks</h4>
              <TableShell headers={['From', 'To', 'Minutes', 'Paid', 'Source']}>
                {data.breaks.map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2 text-sm text-text-primary tabular-nums">{b.startTime ?? '—'}</td>
                    <td className="px-3 py-2 text-sm text-text-primary tabular-nums">{b.endTime ?? '—'}</td>
                    <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">{b.minutes}</td>
                    <td className="px-3 py-2 text-sm text-text-secondary">{b.isPaid ? 'Paid' : 'Unpaid'}</td>
                    <td className="px-3 py-2 text-sm text-text-muted">{b.source.toLowerCase()}</td>
                  </tr>
                ))}
              </TableShell>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}
