import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { attendanceApi, hrDashboardApi } from '../../../api/hrms';
import type { AttendanceRecord, DashboardPayload, KpiCard } from '../../../types/hrms';
import {
  BTN_SECONDARY,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
} from '../../../components/common/HrmsUI';
import { KpiTile } from '../KpiTile';

// ---------------------------------------------------------------------------
// Defensive readers — every widget key on the payload may be missing or the
// wrong shape, so nothing below indexes into an unchecked value.
// ---------------------------------------------------------------------------
type AnyRec = Record<string, any>;

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function asObject(value: unknown): AnyRec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRec) : {};
}

function asArray<T = AnyRec>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

/** Local (not UTC) yyyy-mm-dd so an early-morning IST load stays on today. */
function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Attendance-percent tone: healthy above 90, watch above 75. */
function rateIntent(pct: number): KpiCard['intent'] {
  if (pct >= 90) return 'success';
  if (pct >= 75) return 'warning';
  return 'danger';
}

interface DerivedDay {
  present: number;
  absent: number;
  leave: number;
  halfDay: number;
  late: number;
  otHours: number;
  marked: number;
  attendancePct: number;
}

function deriveDay(records: AttendanceRecord[]): DerivedDay {
  let present = 0;
  let absent = 0;
  let leave = 0;
  let halfDay = 0;
  let late = 0;
  let otHours = 0;
  let marked = 0;

  for (const rec of records) {
    const status = rec?.status ?? null;
    if (status) marked += 1;
    if (status === 'PRESENT') present += 1;
    else if (status === 'ABSENT') absent += 1;
    else if (status === 'LEAVE') leave += 1;
    else if (status === 'HALF_DAY') halfDay += 1;
    if (rec?.isLate === true) late += 1;
    otHours += num(rec?.otHours);
  }

  const considered = present + halfDay + absent + leave;
  const attendancePct = considered > 0 ? round1(((present + 0.5 * halfDay) / considered) * 100) : 0;

  return { present, absent, leave, halfDay, late, otHours: round1(otHours), marked, attendancePct };
}

/**
 * The twelve headline KPIs. Attendance-side numbers are derived from the daily
 * attendance register for the selected date; the rest come from the HR
 * dashboard payload. Nothing is invented — metrics with no source render a dash.
 */
export function KpiCardsSection({ onNavigate }: { onNavigate: (page: string) => void }) {
  const today = localIso(new Date());

  const [date, setDate] = useState<string>(today);
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [daily, setDaily] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<string | null>(null);

  const load = useCallback(async (forDate: string) => {
    setLoading(true);
    const failures: string[] = [];

    const [hr, records] = await Promise.all([
      hrDashboardApi.hr().catch((err: unknown) => {
        failures.push(`HR summary: ${errMsg(err)}`);
        return null;
      }),
      attendanceApi.daily(forDate).catch((err: unknown) => {
        failures.push(`Attendance for ${forDate}: ${errMsg(err)}`);
        return [] as AttendanceRecord[];
      }),
    ]);

    setPayload(hr);
    setDaily(asArray<AttendanceRecord>(records));
    setError(failures.length >= 2 ? failures[0] : null);
    setPartial(failures.length === 1 ? failures[0] : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(date);
  }, [load, date]);

  if (loading && !payload && daily.length === 0) return <LoadingBlock label="Loading KPIs…" />;

  if (error) {
    return (
      <div className="space-y-3">
        <ErrorBlock message={error} />
        <button type="button" className={BTN_SECONDARY} onClick={() => void load(date)}>
          <RefreshCw size={14} className="inline mr-1.5 -mt-0.5" />
          Retry
        </button>
      </div>
    );
  }

  const widgets = asObject(payload?.widgets);
  const headcount = asObject(widgets.headcount);
  const recruitment = asObject(widgets.recruitment);
  const leaveRequests = asArray(widgets.leaveRequests);
  const payrollStatus = asArray(widgets.payrollStatus);
  const latestPeriod = asObject(payrollStatus[0]);
  const hrKpis = asArray<KpiCard>(payload?.kpis);

  const day = deriveDay(daily);
  const isToday = date === today;
  const dayLabel = isToday ? 'today' : date;

  // Attrition: prefer the server-computed KPI, fall back to a guarded ratio.
  const attritionKpi = hrKpis.find((k) => /attrition/i.test(String(k?.key ?? '')));
  const working = num(headcount.working);
  const resignedThisMonth = num(headcount.resignedThisMonth);
  const attritionPct =
    attritionKpi && attritionKpi.value !== null && attritionKpi.value !== undefined
      ? num(attritionKpi.value)
      : working > 0
        ? round1((resignedThisMonth / working) * 100)
        : 0;

  const pendingApprovals = leaveRequests.length;
  const openPositions = num(recruitment.openPositions);
  const payrollLabel = latestPeriod.label ? String(latestPeriod.label) : null;
  const payrollState = latestPeriod.status ? String(latestPeriod.status) : null;

  const cards: KpiCard[] = [
    {
      key: 'attendancePct',
      label: 'Attendance %',
      value: day.attendancePct,
      unit: '%',
      intent: day.marked > 0 ? rateIntent(day.attendancePct) : 'default',
      comparisonLabel: `Marked register for ${dayLabel}`,
      page: 'attendance',
    },
    {
      key: 'present',
      label: 'Present',
      value: day.present,
      intent: 'success',
      comparisonLabel: `${day.marked} of ${daily.length} marked`,
      page: 'attendance',
    },
    {
      key: 'absent',
      label: 'Absent',
      value: day.absent,
      intent: day.absent > 0 ? 'danger' : 'success',
      comparisonLabel: day.halfDay > 0 ? `${day.halfDay} half day` : null,
      page: 'attendance',
    },
    {
      key: 'late',
      label: 'Late',
      value: day.late,
      intent: day.late > 0 ? 'warning' : 'success',
      comparisonLabel: `Late arrivals on ${dayLabel}`,
      page: 'attendance',
    },
    {
      key: 'onLeave',
      label: 'Leave',
      value: day.leave,
      intent: day.leave > 0 ? 'info' : 'default',
      comparisonLabel: `Approved leave on ${dayLabel}`,
      page: 'attendance',
    },
    {
      key: 'activeEmployees',
      label: 'Active Employees',
      value: working,
      intent: 'success',
      comparisonLabel: `${num(headcount.total)} on record`,
      page: 'employees',
    },
    {
      key: 'payrollStatus',
      label: 'Payroll Status',
      value: payrollLabel && payrollState ? `${payrollLabel} · ${payrollState}` : '—',
      intent: payrollState === 'PAID' ? 'success' : payrollState ? 'warning' : 'default',
      comparisonLabel: payrollState ? `${num(latestPeriod.lineCount)} lines` : 'No payroll period yet',
      page: 'payroll',
    },
    {
      key: 'openPositions',
      label: 'Open Positions',
      value: openPositions,
      intent: openPositions > 0 ? 'info' : 'default',
      comparisonLabel: `${num(recruitment.openOpenings)} openings`,
      page: 'recruitment',
    },
    {
      key: 'pendingApprovals',
      label: 'Pending Approvals',
      value: pendingApprovals,
      intent: pendingApprovals > 0 ? 'warning' : 'success',
      comparisonLabel: 'Leave requests awaiting a decision',
      page: 'hr',
    },
    {
      key: 'overtimeHours',
      label: 'Overtime Hours',
      value: day.otHours,
      unit: 'h',
      intent: day.otHours > 0 ? 'info' : 'default',
      comparisonLabel: `Logged on ${dayLabel}`,
      page: 'attendance',
    },
    {
      key: 'attritionPct',
      label: 'Attrition %',
      value: attritionPct,
      unit: '%',
      intent: attritionPct >= 5 ? 'danger' : attritionPct >= 2 ? 'warning' : 'success',
      comparisonLabel:
        attritionKpi?.comparisonLabel ?? `${resignedThisMonth} resigned of ${working} working`,
      page: 'employees',
    },
    {
      key: 'employeeSatisfaction',
      label: 'Employee Satisfaction',
      value: '—',
      intent: 'default',
      comparisonLabel: 'No survey data collected',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <label className={LABEL_CLS} htmlFor="kpi-date">
            Attendance date
          </label>
          <input
            id="kpi-date"
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value || today)}
            className={`${INPUT_CLS} w-auto`}
          />
        </div>
        <div className="flex items-center gap-2">
          {!isToday && (
            <button type="button" className={BTN_SECONDARY} onClick={() => setDate(today)}>
              Back to today
            </button>
          )}
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={() => void load(date)}
            disabled={loading}
          >
            <RefreshCw size={14} className={`inline mr-1.5 -mt-0.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {partial && <p className="text-text-muted text-[11px]">Partial data — {partial}</p>}

      {day.marked === 0 && (
        <p className="text-text-muted text-[11px]">
          No attendance has been marked for {dayLabel}
          {daily.length > 0 ? ` (${daily.length} working employees on the register)` : ''} — the
          attendance KPIs below read zero for that reason.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {cards.map((kpi) => (
          <KpiTile
            key={kpi.key}
            kpi={kpi}
            onClick={kpi.page ? () => onNavigate(kpi.page as string) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
