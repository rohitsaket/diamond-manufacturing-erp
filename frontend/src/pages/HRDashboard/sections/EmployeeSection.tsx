// Employee self-service dashboard section.
//
// Every widget here is rendered defensively: the /hr-dashboard/employee payload
// may omit any key, send null (todayAttendance when the day is unmarked) or an
// empty array. Nothing in this file fabricates a number — a missing widget
// renders an empty/unavailable state instead.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Award,
  Cake,
  CalendarDays,
  Clock,
  FileText,
  Link2,
  ListChecks,
  LogIn,
  LogOut,
  Megaphone,
  Package,
  Receipt,
  RefreshCw,
  Sparkles,
  Ticket,
  Wallet,
} from 'lucide-react';

import { KpiTile } from '../KpiTile';
import { WidgetCard, WidgetEmpty, WidgetUnavailable } from '../WidgetCard';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
  ErrorBlock,
  StatCard,
  TableShell,
  inr,
} from '../../../components/common/HrmsUI';
import { hrDashboardApi } from '../../../api/hrms';
import { api } from '../../../api/client';
import { useApp } from '../../../contexts/AppContext';
import { useAuth } from '../../../contexts/AuthContext';
import { ATTENDANCE_STYLE } from '../../../types/hrms';
import type { DashboardPayload, KpiCard } from '../../../types/hrms';

// ---------------------------------------------------------------------------
// Local helpers — date-fns is not installed, so keep these tiny and dependency
// free. All of them tolerate null/garbage input.
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const NEUTRAL_CHIP = 'bg-bg-hover text-text-muted border-border-default';

/** Narrow an unknown API value to an array without ever throwing. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Narrow an unknown API value to a plain object (null becomes `{}`). */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Read a numeric field defensively — strings from MySQL decimals included. */
function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** `pendingApprovals.leave` is an array on this backend, a count on others. */
function countOf(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** "05 Aug" — falls back to the raw string when the date will not parse. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/** Trims a "09:00:00" / ISO timestamp down to "09:00". */
function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  const hhmm = /(\d{1,2}):(\d{2})/.exec(value);
  if (hhmm) return `${hhmm[1].padStart(2, '0')}:${hhmm[2]}`;
  return String(value);
}

function truncate(text: string, max = 140): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function statusChipCls(status: string | null | undefined): string {
  if (!status) return NEUTRAL_CHIP;
  const styles = ATTENDANCE_STYLE as Record<string, { chip: string; label: string } | undefined>;
  return styles[status]?.chip ?? NEUTRAL_CHIP;
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Not marked yet';
  const styles = ATTENDANCE_STYLE as Record<string, { chip: string; label: string } | undefined>;
  return styles[status]?.label ?? status;
}

function priorityTone(priority: string | null | undefined): Tone {
  switch (String(priority ?? '').toUpperCase()) {
    case 'URGENT':
    case 'CRITICAL':
      return 'danger';
    case 'HIGH':
      return 'warning';
    case 'MEDIUM':
      return 'info';
    default:
      return 'default';
  }
}

function workStatusTone(status: string | null | undefined): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'APPROVED':
    case 'RESOLVED':
    case 'CLOSED':
    case 'DONE':
    case 'COMPLETED':
      return 'success';
    case 'PENDING':
    case 'OPEN':
      return 'warning';
    case 'REJECTED':
    case 'CANCELLED':
      return 'danger';
    case 'IN_PROGRESS':
      return 'info';
    default:
      return 'default';
  }
}

// ---------------------------------------------------------------------------
// Row shapes (documented from the live payload; still read defensively)
// ---------------------------------------------------------------------------

interface LeaveBalanceRow {
  leaveTypeId?: number;
  code?: string;
  name?: string;
  isPaid?: boolean;
  allocated?: number;
  used?: number;
  balance?: number;
}
interface HolidayRow {
  id?: number;
  date?: string;
  name?: string;
  isOptional?: boolean;
}
interface SalaryRow {
  periodId?: number;
  periodLabel?: string;
  gross?: number;
  deductions?: number;
  net?: number;
}
interface TaskRow {
  id?: number;
  title?: string;
  priority?: string;
  status?: string;
  dueDate?: string | null;
}
interface AnnouncementRow {
  id?: number;
  title?: string;
  body?: string | null;
  category?: string | null;
  pinned?: boolean;
  publishFrom?: string | null;
}
interface PersonDateRow {
  employeeId?: number;
  name?: string;
  empCode?: string;
  date?: string;
  years?: number;
}
interface ActivityRow {
  id?: number;
  actorName?: string | null;
  summary?: string;
  entityType?: string;
  createdAt?: string;
}
interface TicketRow {
  id?: number;
  ticketNo?: string;
  category?: string;
  subject?: string;
  priority?: string;
  status?: string;
  createdAt?: string;
}
interface ExpenseGroupRow {
  status?: string;
  count?: number;
  amount?: number;
}
interface CalendarItem {
  key: string;
  date: string;
  label: string;
  type: string;
  tone: Tone;
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function EmployeeSection({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { employees } = useApp();
  const { user } = useAuth();

  const ownEmployeeId = user?.employeeId ?? null;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [punching, setPunching] = useState<'IN' | 'OUT' | null>(null);
  const [punchNote, setPunchNote] = useState<string | null>(null);

  // Staff logins are not linked to an employee row, so default to the user's
  // own record when there is one and otherwise preview the first employee.
  useEffect(() => {
    if (selectedId !== null) return;
    if (ownEmployeeId !== null && ownEmployeeId !== undefined) {
      setSelectedId(ownEmployeeId);
      return;
    }
    const first = employees[0];
    if (first) setSelectedId(first.id);
  }, [employees, ownEmployeeId, selectedId]);

  const load = useCallback(() => {
    if (selectedId === null) return;
    setLoading(true);
    hrDashboardApi
      .employee(selectedId)
      .then((res) => {
        setPayload(res ?? null);
        setError(null);
      })
      .catch((err: unknown) => {
        setPayload(null);
        setError(err instanceof Error ? err.message : 'Could not load the employee dashboard.');
      })
      .finally(() => setLoading(false));
  }, [selectedId]);

  useEffect(() => {
    load();
  }, [load]);

  const canPunch = ownEmployeeId !== null && ownEmployeeId !== undefined && ownEmployeeId === selectedId;

  const punch = useCallback(
    (kind: 'IN' | 'OUT') => {
      if (!canPunch || punching !== null) return;
      setPunching(kind);
      setPunchNote(null);
      api
        .post('/attendance/me/punch', { kind })
        .then(() => {
          setPunchNote(kind === 'IN' ? 'Punched in.' : 'Punched out.');
          load();
        })
        .catch((err: unknown) => {
          setPunchNote(err instanceof Error ? err.message : 'Punch failed.');
        })
        .finally(() => setPunching(null));
    },
    [canPunch, punching, load],
  );

  const widgets = asRecord(payload?.widgets);
  const kpis = asArray<KpiCard>(payload?.kpis);

  // Team calendar merges holidays, birthdays and anniversaries by date.
  const calendarItems = useMemo<CalendarItem[]>(() => {
    const w = asRecord(payload?.widgets);
    const out: CalendarItem[] = [];
    asArray<HolidayRow>(w.upcomingHolidays).forEach((h, i) => {
      if (!h?.date) return;
      out.push({
        key: `holiday-${h.id ?? i}`,
        date: h.date,
        label: h.name ?? 'Holiday',
        type: h.isOptional ? 'Optional' : 'Holiday',
        tone: 'primary',
      });
    });
    asArray<PersonDateRow>(w.birthdays).forEach((b, i) => {
      if (!b?.date) return;
      out.push({
        key: `bday-${b.employeeId ?? i}-${b.date}`,
        date: b.date,
        label: b.name ?? 'Birthday',
        type: 'Birthday',
        tone: 'info',
      });
    });
    asArray<PersonDateRow>(w.anniversaries).forEach((a, i) => {
      if (!a?.date) return;
      out.push({
        key: `anniv-${a.employeeId ?? i}-${a.date}`,
        date: a.date,
        label: `${a.name ?? 'Employee'} · ${num(a.years)} years`,
        type: 'Anniversary',
        tone: 'success',
      });
    });
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
  }, [payload]);

  const announcements = useMemo<AnnouncementRow[]>(() => {
    const rows = asArray<AnnouncementRow>(asRecord(payload?.widgets).announcements);
    return [...rows].sort((a, b) => {
      const pin = Number(Boolean(b?.pinned)) - Number(Boolean(a?.pinned));
      if (pin !== 0) return pin;
      return String(b?.publishFrom ?? '').localeCompare(String(a?.publishFrom ?? ''));
    });
  }, [payload]);

  const selectedEmployee = employees.find((e) => e.id === selectedId) ?? null;

  // -------------------------------------------------------------------------
  // Header (picker + refresh) is always rendered so the user can recover from
  // an error by switching employee or retrying.
  // -------------------------------------------------------------------------
  const header = (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div className="min-w-[220px]">
        <label className={LABEL_CLS} htmlFor="employee-section-picker">
          Viewing as
        </label>
        <select
          id="employee-section-picker"
          className={INPUT_CLS}
          value={selectedId ?? ''}
          onChange={(e) => {
            const next = e.target.value === '' ? null : Number(e.target.value);
            setPunchNote(null);
            setSelectedId(next);
          }}
        >
          {employees.length === 0 && <option value="">No employees loaded</option>}
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.empCode} — {emp.fullName}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        {selectedEmployee && (
          <span className="text-text-muted text-[11px] hidden sm:inline">
            {selectedEmployee.grade} · {selectedEmployee.workerType}
          </span>
        )}
        <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading || selectedId === null}>
          <span className="inline-flex items-center gap-2">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </span>
        </button>
      </div>
    </div>
  );

  if (selectedId === null) {
    return (
      <div className="space-y-4">
        {header}
        <LoadingBlock label="Waiting for the employee list…" />
      </div>
    );
  }

  if (loading && payload === null && error === null) {
    return (
      <div className="space-y-4">
        {header}
        <LoadingBlock label="Loading employee dashboard…" />
      </div>
    );
  }

  if (error !== null && payload === null) {
    return (
      <div className="space-y-4">
        {header}
        <ErrorBlock message={error} />
        <button type="button" className={BTN_PRIMARY} onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  // ---- widget slices ------------------------------------------------------
  const todayRaw = widgets.todayAttendance;
  const today = asRecord(todayRaw);
  const hasToday = todayRaw !== null && todayRaw !== undefined;
  const shift = asRecord(widgets.todayShift);
  const hasShift = widgets.todayShift !== null && widgets.todayShift !== undefined;
  const hours = asRecord(widgets.workingHours);
  const hasHours = widgets.workingHours !== null && widgets.workingHours !== undefined;
  const leaveBalances = asArray<LeaveBalanceRow>(widgets.leaveBalances);
  const salary = asArray<SalaryRow>(widgets.salarySummary);
  const tasks = asArray<TaskRow>(widgets.tasks);
  const tickets = asArray<TicketRow>(widgets.tickets);
  const expenseGroups = asArray<ExpenseGroupRow>(widgets.expenses);
  const approvals = asRecord(widgets.pendingApprovals);
  const leavePending = countOf(approvals.leave);
  const expensePending = countOf(approvals.expenses);
  const documents = asRecord(widgets.documents);
  const hasDocuments = widgets.documents !== null && widgets.documents !== undefined;
  const birthdays = asArray<PersonDateRow>(widgets.birthdays);
  const anniversaries = asArray<PersonDateRow>(widgets.anniversaries);
  const recentActivity = asArray<ActivityRow>(widgets.recentActivity);

  return (
    <div className="space-y-4">
      {header}

      {error !== null && <ErrorBlock message={error} />}

      {kpis.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => (
            <KpiTile
              key={kpi?.key ?? `kpi-${i}`}
              kpi={kpi}
              onClick={kpi?.page ? () => onNavigate(String(kpi.page)) : undefined}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ---------------- My attendance / punch in-out ---------------- */}
        <WidgetCard
          title="My attendance"
          subtitle={hasShift ? `${shift.name ?? 'Shift'} · ${fmtTime(String(shift.startTime ?? ''))}–${fmtTime(String(shift.endTime ?? ''))}` : 'Today'}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusChipCls(
                  hasToday ? (today.status as string | null) : null,
                )}`}
              >
                {statusLabel(hasToday ? (today.status as string | null) : null)}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-bg-secondary py-2">
                <p className="text-[10px] uppercase tracking-wider text-text-muted">In</p>
                <p className="text-sm font-semibold text-text-primary tabular-nums">
                  {hasToday ? fmtTime(today.inTime as string | null) : '—'}
                </p>
              </div>
              <div className="rounded-md bg-bg-secondary py-2">
                <p className="text-[10px] uppercase tracking-wider text-text-muted">Out</p>
                <p className="text-sm font-semibold text-text-primary tabular-nums">
                  {hasToday ? fmtTime(today.outTime as string | null) : '—'}
                </p>
              </div>
              <div className="rounded-md bg-bg-secondary py-2">
                <p className="text-[10px] uppercase tracking-wider text-text-muted">OT</p>
                <p className="text-sm font-semibold text-text-primary tabular-nums">
                  {hasToday ? `${num(today.otHours)} h` : '—'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={!canPunch || punching !== null}
                title={canPunch ? 'Punch in for today' : "Only the employee's own login can punch"}
                onClick={() => punch('IN')}
              >
                <span className="inline-flex items-center gap-2">
                  <LogIn size={14} /> {punching === 'IN' ? 'Punching…' : 'Punch In'}
                </span>
              </button>
              <button
                type="button"
                className={BTN_SECONDARY}
                disabled={!canPunch || punching !== null}
                title={canPunch ? 'Punch out for today' : "Only the employee's own login can punch"}
                onClick={() => punch('OUT')}
              >
                <span className="inline-flex items-center gap-2">
                  <LogOut size={14} /> {punching === 'OUT' ? 'Punching…' : 'Punch Out'}
                </span>
              </button>
            </div>

            {!canPunch && (
              <p className="text-text-muted text-[11px]">
                Self punch is disabled while previewing another employee.
              </p>
            )}
            {punchNote !== null && <p className="text-text-secondary text-[11px]">{punchNote}</p>}
          </div>
        </WidgetCard>

        {/* ---------------- Working hours ---------------- */}
        <WidgetCard
          title="Working hours"
          subtitle={hasHours ? String(hours.month ?? '') : null}
          className="lg:col-span-2"
        >
          {!hasHours ? (
            <WidgetEmpty message="No working-hour summary for this month yet" />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard label="Worked hrs" value={num(hours.workedHours)} />
              <StatCard label="OT hrs" value={num(hours.otHours)} intent="warning" />
              <StatCard label="Present" value={num(hours.presentDays)} intent="success" />
              <StatCard label="Absent" value={num(hours.absentDays)} intent="danger" />
              <StatCard label="Leave" value={num(hours.leaveDays)} intent="info" />
              <StatCard label="Marked days" value={num(hours.markedDays)} />
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Leave balance ---------------- */}
        <WidgetCard
          title="Leave balance"
          actions={
            <button
              type="button"
              className="text-primary text-xs font-medium hover:underline"
              onClick={() => onNavigate('hr')}
            >
              Apply leave
            </button>
          }
        >
          {leaveBalances.length === 0 ? (
            <WidgetEmpty message="No leave balances allocated yet" />
          ) : (
            <div className="space-y-2">
              {leaveBalances.map((row, i) => (
                <div
                  key={row?.leaveTypeId ?? `leave-${i}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border-light px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-text-primary text-sm font-medium truncate">
                      {row?.code ?? '—'}
                      <span className="text-text-muted font-normal"> · {row?.name ?? ''}</span>
                    </p>
                    <p className="text-text-muted text-[11px]">
                      {num(row?.used)} used of {num(row?.allocated)} allocated
                    </p>
                  </div>
                  <p className="text-xl font-semibold tabular-nums text-text-primary flex-shrink-0">
                    {num(row?.balance)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Salary snapshot / payslip ---------------- */}
        <WidgetCard
          title="Salary snapshot"
          subtitle="Recent payroll periods"
          className="lg:col-span-2"
          actions={
            <button
              type="button"
              className="text-primary text-xs font-medium hover:underline"
              onClick={() => onNavigate('payroll')}
            >
              Open payroll
            </button>
          }
        >
          {salary.length === 0 ? (
            <WidgetEmpty message="No processed payroll yet" />
          ) : (
            <TableShell headers={['Period', 'Gross', 'Deductions', 'Net', '']}>
              {salary.map((row, i) => (
                <tr key={row?.periodId ?? `sal-${i}`} className="hover:bg-bg-hover">
                  <td className="px-3 py-2 text-sm text-text-primary whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <Wallet size={14} className="text-text-muted" />
                      {row?.periodLabel ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-text-secondary tabular-nums whitespace-nowrap">
                    {inr(row?.gross)}
                  </td>
                  <td className="px-3 py-2 text-sm text-text-secondary tabular-nums whitespace-nowrap">
                    {inr(row?.deductions)}
                  </td>
                  <td className="px-3 py-2 text-sm font-semibold text-success tabular-nums whitespace-nowrap">
                    {inr(row?.net)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="text-primary text-xs font-medium hover:underline"
                      onClick={() => onNavigate('payroll')}
                    >
                      Payslip
                    </button>
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </WidgetCard>

        {/* ---------------- My tasks ---------------- */}
        <WidgetCard title="My tasks">
          {tasks.length === 0 ? (
            <WidgetEmpty message="No tasks assigned" />
          ) : (
            <div className="space-y-2">
              {tasks.map((task, i) => (
                <div key={task?.id ?? `task-${i}`} className="rounded-md border border-border-light px-3 py-2">
                  <p className="text-text-primary text-sm flex items-start gap-2">
                    <ListChecks size={14} className="text-text-muted mt-0.5 flex-shrink-0" />
                    <span className="min-w-0">{task?.title ?? 'Untitled task'}</span>
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {task?.priority && <Chip label={String(task.priority)} tone={priorityTone(task.priority)} />}
                    {task?.status && <Chip label={String(task.status).replace(/_/g, ' ')} tone={workStatusTone(task.status)} />}
                    {task?.dueDate && <span className="text-text-muted text-[11px]">Due {fmtDate(task.dueDate)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Requests, claims and tickets ---------------- */}
        <WidgetCard
          title="Requests & claims"
          subtitle="Leave requests, expense claims and helpdesk tickets"
          className="lg:col-span-2"
          actions={
            <button
              type="button"
              className="text-primary text-xs font-medium hover:underline"
              onClick={() => onNavigate('hr')}
            >
              Open HR
            </button>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Leave awaiting approval"
                value={leavePending}
                intent={leavePending > 0 ? 'warning' : 'default'}
              />
              <StatCard
                label="Expenses awaiting approval"
                value={expensePending}
                intent={expensePending > 0 ? 'warning' : 'default'}
              />
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">
                Expense claims
              </p>
              {expenseGroups.length === 0 ? (
                <WidgetEmpty message="No expense claims filed" />
              ) : (
                <div className="space-y-2">
                  {expenseGroups.map((row, i) => (
                    <div
                      key={row?.status ?? `exp-${i}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-border-light px-3 py-2"
                    >
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <Receipt size={14} className="text-text-muted flex-shrink-0" />
                        <Chip label={String(row?.status ?? '—')} tone={workStatusTone(row?.status)} />
                        <span className="text-text-muted text-[11px]">{num(row?.count)} claim(s)</span>
                      </span>
                      <span className="text-text-primary text-sm font-medium tabular-nums flex-shrink-0">
                        {inr(row?.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">
                Helpdesk tickets
              </p>
              {tickets.length === 0 ? (
                <WidgetEmpty message="No helpdesk tickets raised" />
              ) : (
                <div className="space-y-2">
                  {tickets.map((t, i) => (
                    <div key={t?.id ?? `tkt-${i}`} className="rounded-md border border-border-light px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-text-primary text-sm min-w-0 truncate flex items-center gap-2">
                          <Ticket size={14} className="text-text-muted flex-shrink-0" />
                          {t?.subject ?? 'Ticket'}
                        </p>
                        <span className="flex-shrink-0">
                          <Chip label={String(t?.status ?? '—').replace(/_/g, ' ')} tone={workStatusTone(t?.status)} />
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-text-muted text-[11px]">{t?.ticketNo ?? ''}</span>
                        {t?.category && <Chip label={String(t.category)} tone="default" />}
                        {t?.priority && <Chip label={String(t.priority)} tone={priorityTone(t.priority)} />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </WidgetCard>

        {/* ---------------- My documents ---------------- */}
        <WidgetCard
          title="My documents"
          actions={
            <button
              type="button"
              className="text-primary text-xs font-medium hover:underline"
              onClick={() => onNavigate('employees')}
            >
              Manage
            </button>
          }
        >
          {!hasDocuments ? (
            <WidgetEmpty message="No document summary available" />
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Total" value={num(documents.total)} />
              <StatCard label="Verified" value={num(documents.verified)} intent="success" />
              <StatCard
                label="Unverified"
                value={num(documents.unverified)}
                intent={num(documents.unverified) > 0 ? 'warning' : 'default'}
              />
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Team calendar ---------------- */}
        <WidgetCard title="Team calendar" subtitle="Holidays, birthdays and anniversaries">
          {calendarItems.length === 0 ? (
            <WidgetEmpty message="Nothing coming up" />
          ) : (
            <div className="space-y-2">
              {calendarItems.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <CalendarDays size={14} className="text-text-muted flex-shrink-0" />
                    <span className="text-text-primary text-sm truncate">{item.label}</span>
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <Chip label={item.type} tone={item.tone} />
                    <span className="text-text-muted text-[11px] tabular-nums">{fmtDate(item.date)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Company news ---------------- */}
        <WidgetCard title="Company news" className="lg:col-span-2">
          {announcements.length === 0 ? (
            <WidgetEmpty message="No announcements published" />
          ) : (
            <div className="space-y-3">
              {announcements.map((a, i) => (
                <div key={a?.id ?? `ann-${i}`} className="rounded-md border border-border-light px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-text-primary text-sm font-medium min-w-0 flex items-center gap-2">
                      <Megaphone size={14} className="text-text-muted flex-shrink-0" />
                      <span className="truncate">{a?.title ?? 'Announcement'}</span>
                    </p>
                    <span className="flex items-center gap-2 flex-shrink-0">
                      {a?.pinned && <Chip label="Pinned" tone="primary" />}
                      {a?.category && <Chip label={String(a.category)} tone="info" />}
                    </span>
                  </div>
                  {a?.body && (
                    <p className="text-text-secondary text-xs mt-1.5 leading-relaxed">{truncate(String(a.body))}</p>
                  )}
                  {a?.publishFrom && (
                    <p className="text-text-muted text-[11px] mt-1">{fmtDate(a.publishFrom)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Birthdays ---------------- */}
        <WidgetCard title="Birthdays">
          {birthdays.length === 0 ? (
            <WidgetEmpty message="No birthdays coming up" />
          ) : (
            <div className="space-y-2">
              {birthdays.map((b, i) => (
                <div key={b?.employeeId ?? `bd-${i}`} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <Cake size={14} className="text-primary flex-shrink-0" />
                    <span className="text-text-primary text-sm truncate">{b?.name ?? '—'}</span>
                    <span className="text-text-muted text-[11px]">{b?.empCode ?? ''}</span>
                  </span>
                  <span className="text-text-muted text-[11px] tabular-nums flex-shrink-0">{fmtDate(b?.date)}</span>
                </div>
              ))}
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Work anniversaries ---------------- */}
        <WidgetCard title="Work anniversaries">
          {anniversaries.length === 0 ? (
            <WidgetEmpty message="No work anniversaries coming up" />
          ) : (
            <div className="space-y-2">
              {anniversaries.map((a, i) => (
                <div key={a?.employeeId ?? `an-${i}`} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <Award size={14} className="text-success flex-shrink-0" />
                    <span className="text-text-primary text-sm truncate">{a?.name ?? '—'}</span>
                    <span className="text-text-muted text-[11px]">{num(a?.years)} years</span>
                  </span>
                  <span className="text-text-muted text-[11px] tabular-nums flex-shrink-0">{fmtDate(a?.date)}</span>
                </div>
              ))}
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Recent activity ---------------- */}
        <WidgetCard title="Recent activity">
          {recentActivity.length === 0 ? (
            <WidgetEmpty message="No recent activity recorded" />
          ) : (
            <div className="space-y-2">
              {recentActivity.map((row, i) => (
                <div key={row?.id ?? `act-${i}`} className="flex items-start gap-2">
                  <Activity size={14} className="text-text-muted mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-text-primary text-sm">{row?.summary ?? '—'}</p>
                    <p className="text-text-muted text-[11px]">
                      {row?.actorName ?? 'System'}
                      {row?.createdAt ? ` · ${fmtDate(row.createdAt)}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Asset requests (no backend) ---------------- */}
        <WidgetCard title="Asset requests">
          <WidgetUnavailable reason="Asset requests are not tracked yet — raise a helpdesk ticket instead" />
          <button type="button" className={BTN_SECONDARY} onClick={() => onNavigate('hr')}>
            <span className="inline-flex items-center gap-2">
              <Package size={14} /> Raise a ticket
            </span>
          </button>
        </WidgetCard>

        {/* ---------------- Quick links ---------------- */}
        <WidgetCard title="Quick links">
          <div className="grid grid-cols-2 gap-2">
            {[
              { page: 'attendance', label: 'Attendance', icon: Clock },
              { page: 'hr', label: 'HR & leave', icon: FileText },
              { page: 'payroll', label: 'Payroll', icon: Wallet },
              { page: 'employees', label: 'My profile', icon: Link2 },
            ].map((link) => (
              <button
                key={link.page}
                type="button"
                onClick={() => onNavigate(link.page)}
                className="flex items-center gap-2 rounded-md border border-border-default bg-bg-secondary px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
              >
                <link.icon size={16} className="text-text-muted flex-shrink-0" />
                <span className="truncate">{link.label}</span>
              </button>
            ))}
          </div>
        </WidgetCard>

        {/* ---------------- AI assistant ---------------- */}
        <WidgetCard
          title="AI assistant"
          actions={<Sparkles size={16} className="text-text-muted" />}
        >
          <WidgetUnavailable reason="The AI assistant is not enabled for this workspace" />
        </WidgetCard>
      </div>
    </div>
  );
}
