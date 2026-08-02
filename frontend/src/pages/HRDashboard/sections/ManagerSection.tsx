// Manager dashboard section.
//
// Reads /hr-dashboard/manager. Every widget is optional: the payload may omit a
// key, send null, or send an empty array (teamProductivity currently always
// does). Nothing here invents a value — empty data renders an empty state.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Cake,
  CalendarDays,
  ClipboardList,
  Clock,
  FileSpreadsheet,
  Inbox,
  RefreshCw,
  Sparkles,
  Ticket,
  Timer,
  Users,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { KpiTile } from '../KpiTile';
import { WidgetCard, WidgetEmpty, WidgetUnavailable } from '../WidgetCard';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  ErrorBlock,
  LoadingBlock,
  StatCard,
  TableShell,
  inr,
} from '../../../components/common/HrmsUI';
import { hrDashboardApi } from '../../../api/hrms';
import { useAuth } from '../../../contexts/AuthContext';
import { ATTENDANCE_STYLE } from '../../../types/hrms';
import type { DashboardPayload, KpiCard } from '../../../types/hrms';

// ---------------------------------------------------------------------------
// Local helpers (date-fns is not a dependency)
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const NEUTRAL_CHIP = 'bg-bg-hover text-text-muted border-border-default';

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Relative time without date-fns. Returns '—' for unusable input. */
function timeAgo(iso: string): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffSec = Math.round((Date.now() - then) / 1000);
  const future = diffSec < 0;
  const s = Math.abs(diffSec);
  const suffix = future ? 'from now' : 'ago';
  if (s < 45) return future ? 'in a moment' : 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ${suffix}`;
  if (s < 86400) return `${Math.round(s / 3600)}h ${suffix}`;
  if (s < 2592000) return `${Math.round(s / 86400)}d ${suffix}`;
  if (s < 31536000) return `${Math.round(s / 2592000)}mo ${suffix}`;
  return `${Math.round(s / 31536000)}y ${suffix}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function attendanceChipCls(status: string | null | undefined): string {
  if (!status) return NEUTRAL_CHIP;
  const styles = ATTENDANCE_STYLE as Record<string, { chip: string; label: string } | undefined>;
  return styles[status]?.chip ?? NEUTRAL_CHIP;
}

function attendanceLabel(status: string | null | undefined): string {
  if (!status) return 'Unmarked';
  const styles = ATTENDANCE_STYLE as Record<string, { chip: string; label: string } | undefined>;
  return styles[status]?.label ?? String(status).replace(/_/g, ' ');
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

function kindTone(kind: string | null | undefined): Tone {
  switch (String(kind ?? '').toUpperCase()) {
    case 'LEAVE':
      return 'info';
    case 'EXPENSE':
      return 'warning';
    default:
      return 'default';
  }
}

/** Shortens "Jayesh Kumar Arora" to "Jayesh A." for chart axis labels. */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface TeamMemberRow {
  employeeId?: number;
  name?: string;
  empCode?: string;
  department?: string | null;
  status?: string | null;
}
interface LeaveRow {
  id?: number;
  employeeId?: number;
  name?: string;
  empCode?: string;
  leaveTypeName?: string;
  fromDate?: string;
  toDate?: string;
  days?: number;
  reason?: string | null;
}
interface ExpenseRow {
  id?: number;
  employeeId?: number;
  name?: string;
  empCode?: string;
  category?: string;
  amount?: number;
  expenseDate?: string;
}
interface ShiftStatusRow {
  shiftName?: string;
  count?: number;
}
interface WorkloadRow {
  employeeId?: number;
  name?: string;
  empCode?: string;
  openLots?: number;
  openCts?: number;
}
interface TicketRow {
  id?: number;
  ticketNo?: string;
  employeeName?: string;
  category?: string;
  subject?: string;
  priority?: string;
  status?: string;
  createdAt?: string;
}
interface DepartmentRow {
  department?: string | null;
  headcount?: number;
  presentToday?: number;
  attendancePct?: number;
}
interface TopOtRow {
  employeeId?: number;
  name?: string;
  empCode?: string;
  otHours?: number;
}
interface RequestRow {
  kind?: string;
  id?: number;
  employeeName?: string;
  status?: string;
  detail?: string;
  createdAt?: string;
}
interface BirthdayRow {
  employeeId?: number;
  name?: string;
  empCode?: string;
  date?: string;
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function ManagerSection({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const managerEmployeeId = user?.employeeId ?? undefined;

  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    hrDashboardApi
      .manager(managerEmployeeId ?? undefined)
      .then((res) => {
        setPayload(res ?? null);
        setError(null);
      })
      .catch((err: unknown) => {
        setPayload(null);
        setError(err instanceof Error ? err.message : 'Could not load the manager dashboard.');
      })
      .finally(() => setLoading(false));
  }, [managerEmployeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const widgets = asRecord(payload?.widgets);
  const kpis = asArray<KpiCard>(payload?.kpis);

  const workloadChartData = useMemo(() => {
    const rows = asArray<WorkloadRow>(asRecord(payload?.widgets).teamWorkload);
    return rows
      .filter((r) => r && (r.name ?? '') !== '')
      .map((r) => ({ name: shortName(String(r.name)), openLots: num(r.openLots) }));
  }, [payload]);

  const header = (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <p className="text-text-muted text-xs">
        {managerEmployeeId === undefined
          ? 'Showing the whole workforce — this login is not linked to an employee record.'
          : 'Showing your reporting team.'}
      </p>
      <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
        <span className="inline-flex items-center gap-2">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </span>
      </button>
    </div>
  );

  if (loading && payload === null && error === null) {
    return (
      <div className="space-y-4">
        {header}
        <LoadingBlock label="Loading manager dashboard…" />
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
  const teamAttendance = asRecord(widgets.teamAttendance);
  const hasTeamAttendance = widgets.teamAttendance !== null && widgets.teamAttendance !== undefined;
  const attendanceCounts = asRecord(teamAttendance.counts);
  const attendanceRows = asArray<TeamMemberRow>(teamAttendance.employees);
  const teamSize = num(teamAttendance.teamSize);
  const listTruncated = Boolean(teamAttendance.listTruncated);

  const availability = asRecord(widgets.employeeAvailability);
  const hasAvailability = widgets.employeeAvailability !== null && widgets.employeeAvailability !== undefined;

  const approvals = asRecord(widgets.pendingApprovals);
  const approvalLeave = asArray<LeaveRow>(approvals.leave);
  const approvalExpenses = asArray<ExpenseRow>(approvals.expenses);
  const leaveCount = num(approvals.leaveCount);
  const expenseCount = num(approvals.expenseCount);

  const teamLeave = asRecord(widgets.teamLeave);
  const onLeaveToday = asArray<LeaveRow>(teamLeave.onLeaveToday);
  const leavePending = asArray<LeaveRow>(teamLeave.pending);

  const workload = asArray<WorkloadRow>(widgets.teamWorkload);
  const productivity = asArray<Record<string, unknown>>(widgets.teamProductivity);
  const departments = asArray<DepartmentRow>(widgets.departmentKpis);
  const shiftStatus = asArray<ShiftStatusRow>(widgets.shiftStatus);
  const overtime = asRecord(widgets.overtimeSummary);
  const hasOvertime = widgets.overtimeSummary !== null && widgets.overtimeSummary !== undefined;
  const topOt = asArray<TopOtRow>(overtime.topEmployees);
  const openTickets = asArray<TicketRow>(widgets.openTickets);
  const requests = asArray<RequestRow>(widgets.employeeRequests);
  const birthdays = asArray<BirthdayRow>(widgets.birthdays);

  const departmentsHaveMarks = departments.some((d) => num(d?.presentToday) > 0);

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
        {/* ---------------- Team attendance ---------------- */}
        <WidgetCard
          title="Team attendance"
          subtitle={hasTeamAttendance ? `${fmtDate(String(teamAttendance.date ?? ''))} · ${teamSize} in team` : null}
          className="lg:col-span-2"
          actions={
            <button
              type="button"
              className="text-primary text-xs font-medium hover:underline"
              onClick={() => onNavigate('attendance')}
            >
              Open register
            </button>
          }
        >
          {!hasTeamAttendance ? (
            <WidgetEmpty message="No attendance snapshot available" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                {Object.keys(attendanceCounts).length === 0 ? (
                  <span className="text-text-muted text-xs">No attendance marked today</span>
                ) : (
                  Object.entries(attendanceCounts).map(([status, count]) => (
                    <span
                      key={status}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${attendanceChipCls(
                        status,
                      )}`}
                    >
                      {attendanceLabel(status)}
                      <span className="tabular-nums font-semibold">{num(count)}</span>
                    </span>
                  ))
                )}
              </div>

              {attendanceRows.length === 0 ? (
                <WidgetEmpty message="No team members to show" />
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                  {attendanceRows.map((row, i) => (
                    <div
                      key={row?.employeeId ?? `team-${i}`}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-bg-hover"
                    >
                      <span className="min-w-0">
                        <span className="text-text-primary text-sm truncate block">{row?.name ?? '—'}</span>
                        <span className="text-text-muted text-[11px]">
                          {row?.empCode ?? ''}
                          {row?.department ? ` · ${row.department}` : ''}
                        </span>
                      </span>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border flex-shrink-0 ${attendanceChipCls(
                          row?.status,
                        )}`}
                      >
                        {attendanceLabel(row?.status)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {listTruncated && (
                <p className="text-text-muted text-[11px]">Showing first 500 of {teamSize}</p>
              )}
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Employee availability ---------------- */}
        <WidgetCard title="Employee availability">
          {!hasAvailability ? (
            <WidgetEmpty message="No availability snapshot available" />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Team size" value={num(availability.teamSize)} />
              <StatCard label="Working" value={num(availability.working)} intent="success" />
              <StatCard label="On leave" value={num(availability.onLeave)} intent="info" />
              <StatCard label="Absent" value={num(availability.absent)} intent="danger" />
              <StatCard label="Holiday" value={num(availability.holiday)} />
              <StatCard
                label="Unmarked"
                value={num(availability.unmarked)}
                intent={num(availability.unmarked) > 0 ? 'warning' : 'default'}
              />
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Pending approvals ---------------- */}
        <WidgetCard
          title="Pending approvals"
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
              <StatCard label="Leave requests" value={leaveCount} intent={leaveCount > 0 ? 'warning' : 'default'} />
              <StatCard
                label="Expense claims"
                value={expenseCount}
                intent={expenseCount > 0 ? 'warning' : 'default'}
              />
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">Leave</p>
              {approvalLeave.length === 0 ? (
                <WidgetEmpty message="No leave requests waiting" />
              ) : (
                <div className="space-y-2">
                  {approvalLeave.map((row, i) => (
                    <div
                      key={row?.id ?? `apl-${i}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-border-light px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-text-primary text-sm truncate">
                          {row?.name ?? '—'}
                          <span className="text-text-muted text-[11px] ml-1.5">{row?.empCode ?? ''}</span>
                        </p>
                        <p className="text-text-muted text-[11px]">
                          {row?.leaveTypeName ?? 'Leave'} · {fmtDate(row?.fromDate)}–{fmtDate(row?.toDate)} ·{' '}
                          {num(row?.days)} day(s)
                        </p>
                      </div>
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline flex-shrink-0"
                        onClick={() => onNavigate('hr')}
                      >
                        Review
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">Expenses</p>
              {approvalExpenses.length === 0 ? (
                <WidgetEmpty message="No expense claims waiting" />
              ) : (
                <div className="space-y-2">
                  {approvalExpenses.map((row, i) => (
                    <div
                      key={row?.id ?? `ape-${i}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-border-light px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-text-primary text-sm truncate">
                          {row?.name ?? '—'}
                          <span className="text-text-muted text-[11px] ml-1.5">{row?.empCode ?? ''}</span>
                        </p>
                        <p className="text-text-muted text-[11px]">
                          {row?.category ?? '—'} · {inr(row?.amount)} · {fmtDate(row?.expenseDate)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline flex-shrink-0"
                        onClick={() => onNavigate('hr')}
                      >
                        Review
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </WidgetCard>

        {/* ---------------- Team leave ---------------- */}
        <WidgetCard title="Team leave">
          <div className="space-y-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">On leave today</p>
              {onLeaveToday.length === 0 ? (
                <p className="text-text-muted text-xs">Nobody is on leave today.</p>
              ) : (
                <div className="space-y-1.5">
                  {onLeaveToday.map((row, i) => (
                    <div key={row?.id ?? `olt-${i}`} className="flex items-center justify-between gap-3">
                      <span className="text-text-primary text-sm truncate">{row?.name ?? '—'}</span>
                      <Chip label={String(row?.leaveTypeName ?? 'Leave')} tone="info" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">Upcoming / pending</p>
              {leavePending.length === 0 ? (
                <p className="text-text-muted text-xs">No pending leave requests.</p>
              ) : (
                <div className="space-y-2">
                  {leavePending.map((row, i) => (
                    <div key={row?.id ?? `tlp-${i}`} className="rounded-md border border-border-light px-3 py-2">
                      <p className="text-text-primary text-sm truncate">{row?.name ?? '—'}</p>
                      <p className="text-text-muted text-[11px]">
                        {row?.leaveTypeName ?? 'Leave'} · {fmtDate(row?.fromDate)}–{fmtDate(row?.toDate)} ·{' '}
                        {num(row?.days)} day(s)
                      </p>
                      {row?.reason && <p className="text-text-secondary text-[11px] mt-0.5">{row.reason}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </WidgetCard>

        {/* ---------------- Team workload ---------------- */}
        <WidgetCard
          title="Team workload"
          subtitle="Open lots in hand"
          className="lg:col-span-2"
          actions={<ClipboardList size={16} className="text-text-muted" />}
        >
          {workload.length === 0 ? (
            <WidgetEmpty message="No open lots assigned to the team" />
          ) : (
            <TableShell headers={['Employee', 'Code', 'Open lots', 'Open cts']}>
              {workload.map((row, i) => (
                <tr key={row?.employeeId ?? `wl-${i}`} className="hover:bg-bg-hover">
                  <td className="px-3 py-2 text-sm text-text-primary whitespace-nowrap">{row?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">{row?.empCode ?? '—'}</td>
                  <td className="px-3 py-2 text-sm text-text-primary tabular-nums whitespace-nowrap">
                    {num(row?.openLots)}
                  </td>
                  <td className="px-3 py-2 text-sm text-text-secondary tabular-nums whitespace-nowrap">
                    {num(row?.openCts).toFixed(2)}
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </WidgetCard>

        {/* ---------------- Productivity ---------------- */}
        <WidgetCard title="Productivity" subtitle="Production recorded this month">
          {productivity.length === 0 ? (
            <WidgetEmpty message="No production recorded for this month yet" />
          ) : (
            <div className="space-y-1.5">
              {productivity.map((row, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <span className="text-text-primary text-sm truncate">{String(row?.name ?? '—')}</span>
                  <span className="text-text-secondary text-sm tabular-nums">{num(row?.pieces ?? row?.cts)}</span>
                </div>
              ))}
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Team performance (chart) ---------------- */}
        {workloadChartData.length > 0 && (
          <WidgetCard
            title="Team performance"
            subtitle="Open lots per employee"
            className="lg:col-span-2"
            actions={<BarChart3 size={16} className="text-text-muted" />}
          >
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={workloadChartData} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                    stroke="var(--color-border-default)"
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={54}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                    stroke="var(--color-border-default)"
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--color-bg-hover)' }}
                    contentStyle={{
                      background: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border-default)',
                      borderRadius: 6,
                      fontSize: 12,
                      color: 'var(--color-text-primary)',
                    }}
                    labelStyle={{ color: 'var(--color-text-secondary)' }}
                  />
                  <Bar dataKey="openLots" name="Open lots" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </WidgetCard>
        )}

        {/* ---------------- Department KPIs ---------------- */}
        <WidgetCard title="Department KPIs" className="lg:col-span-2">
          {departments.length === 0 ? (
            <WidgetEmpty message="No departments configured" />
          ) : (
            <>
              <TableShell headers={['Department', 'Headcount', 'Present today', 'Attendance']}>
                {departments.map((row, i) => {
                  const pct = num(row?.attendancePct);
                  const present = num(row?.presentToday);
                  const unmarked = pct === 0 && present === 0;
                  const tone = pct >= 90 ? 'text-success' : pct >= 75 ? 'text-warning' : 'text-danger';
                  return (
                    <tr key={row?.department ?? `dept-${i}`} className="hover:bg-bg-hover">
                      <td className="px-3 py-2 text-sm text-text-primary whitespace-nowrap">
                        {row?.department ?? 'Unassigned'}
                      </td>
                      <td className="px-3 py-2 text-sm text-text-secondary tabular-nums whitespace-nowrap">
                        {num(row?.headcount)}
                      </td>
                      <td className="px-3 py-2 text-sm text-text-secondary tabular-nums whitespace-nowrap">
                        {present}
                      </td>
                      <td
                        className={`px-3 py-2 text-sm font-medium tabular-nums whitespace-nowrap ${
                          unmarked ? 'text-text-muted' : tone
                        }`}
                      >
                        {unmarked ? '—' : `${pct}%`}
                      </td>
                    </tr>
                  );
                })}
              </TableShell>
              {!departmentsHaveMarks && (
                <p className="text-text-muted text-[11px] mt-2">— means attendance not marked</p>
              )}
            </>
          )}
        </WidgetCard>

        {/* ---------------- Shift schedule ---------------- */}
        <WidgetCard
          title="Shift schedule"
          actions={
            <button
              type="button"
              className="text-primary text-xs font-medium hover:underline"
              onClick={() => onNavigate('attendance')}
            >
              Manage shifts
            </button>
          }
        >
          {shiftStatus.length === 0 ? (
            <WidgetEmpty message="No shifts assigned" />
          ) : (
            <div className="space-y-2">
              {shiftStatus.map((row, i) => (
                <div
                  key={row?.shiftName ?? `shift-${i}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border-light px-3 py-2"
                >
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <Clock size={14} className="text-text-muted flex-shrink-0" />
                    <span className="text-text-primary text-sm truncate">{row?.shiftName ?? '—'}</span>
                  </span>
                  <span className="text-text-primary text-sm font-semibold tabular-nums flex-shrink-0">
                    {num(row?.count)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Overtime summary ---------------- */}
        <WidgetCard
          title="Overtime summary"
          subtitle={hasOvertime ? String(overtime.month ?? '') : null}
          actions={<Timer size={16} className="text-text-muted" />}
        >
          {!hasOvertime ? (
            <WidgetEmpty message="No overtime summary available" />
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-text-muted text-xs uppercase tracking-wider">Total OT hours</p>
                <p className="text-3xl font-semibold tabular-nums text-text-primary">
                  {num(overtime.totalOtHours)}
                </p>
              </div>
              {topOt.length === 0 ? (
                <p className="text-text-muted text-xs">No overtime logged this month.</p>
              ) : (
                <div className="space-y-1.5">
                  {topOt.map((row, i) => (
                    <div key={row?.employeeId ?? `ot-${i}`} className="flex items-center justify-between gap-3">
                      <span className="text-text-primary text-sm truncate">{row?.name ?? '—'}</span>
                      <span className="text-text-secondary text-sm tabular-nums flex-shrink-0">
                        {num(row?.otHours)} h
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Open tickets ---------------- */}
        <WidgetCard
          title="Open tickets"
          className="lg:col-span-2"
          actions={<Ticket size={16} className="text-text-muted" />}
        >
          {openTickets.length === 0 ? (
            <WidgetEmpty message="No open helpdesk tickets" />
          ) : (
            <TableShell headers={['Ticket', 'Employee', 'Subject', 'Category', 'Priority', 'Status']}>
              {openTickets.map((row, i) => (
                <tr key={row?.id ?? `tkt-${i}`} className="hover:bg-bg-hover">
                  <td className="px-3 py-2 text-[11px] text-text-muted whitespace-nowrap">{row?.ticketNo ?? '—'}</td>
                  <td className="px-3 py-2 text-sm text-text-primary whitespace-nowrap">
                    {row?.employeeName ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-sm text-text-secondary max-w-[240px] truncate">
                    {row?.subject ?? '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={String(row?.category ?? '—')} tone="default" />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={String(row?.priority ?? '—')} tone={priorityTone(row?.priority)} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip
                      label={String(row?.status ?? '—').replace(/_/g, ' ')}
                      tone={workStatusTone(row?.status)}
                    />
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </WidgetCard>

        {/* ---------------- Employee requests timeline ---------------- */}
        <WidgetCard title="Employee requests" subtitle="Leave, expense and ticket activity">
          {requests.length === 0 ? (
            <WidgetEmpty message="No employee requests yet" />
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
              {requests.map((row, i) => (
                <div
                  key={`${row?.kind ?? 'req'}-${row?.id ?? i}`}
                  className="rounded-md border border-border-light px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <Chip label={String(row?.kind ?? 'REQUEST')} tone={kindTone(row?.kind)} />
                      <span className="text-text-primary text-sm truncate">{row?.employeeName ?? '—'}</span>
                    </span>
                    <span className="flex-shrink-0">
                      <Chip label={String(row?.status ?? '—').replace(/_/g, ' ')} tone={workStatusTone(row?.status)} />
                    </span>
                  </div>
                  <p className="text-text-secondary text-xs mt-1 truncate">{row?.detail ?? ''}</p>
                  <p className="text-text-muted text-[11px] mt-0.5">
                    {row?.createdAt ? timeAgo(String(row.createdAt)) : '—'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Team calendar ---------------- */}
        <WidgetCard title="Team calendar" subtitle="Upcoming birthdays — full calendar lives in the Calendar section">
          {birthdays.length === 0 ? (
            <WidgetEmpty message="Nothing coming up" />
          ) : (
            <div className="space-y-2">
              {birthdays.map((row, i) => (
                <div key={row?.employeeId ?? `bd-${i}`} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <Cake size={14} className="text-primary flex-shrink-0" />
                    <span className="text-text-primary text-sm truncate">{row?.name ?? '—'}</span>
                    <span className="text-text-muted text-[11px]">{row?.empCode ?? ''}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-text-muted text-[11px] tabular-nums flex-shrink-0">
                    <CalendarDays size={14} /> {fmtDate(row?.date)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </WidgetCard>

        {/* ---------------- Team tasks ---------------- */}
        <WidgetCard title="Team tasks" actions={<Inbox size={16} className="text-text-muted" />}>
          <WidgetUnavailable reason="Team-wide task rollups are not part of the manager feed — open HR to see individual tasks" />
          <button type="button" className={BTN_SECONDARY} onClick={() => onNavigate('hr')}>
            <span className="inline-flex items-center gap-2">
              <Users size={14} /> Open HR
            </span>
          </button>
        </WidgetCard>

        {/* ---------------- Reports ---------------- */}
        <WidgetCard title="Reports" actions={<FileSpreadsheet size={16} className="text-text-muted" />}>
          <div className="grid grid-cols-1 gap-2">
            {[
              { page: 'attendance', label: 'Attendance register' },
              { page: 'hr', label: 'Leave report' },
              { page: 'payroll', label: 'Payroll export' },
            ].map((report) => (
              <button
                key={report.page}
                type="button"
                onClick={() => onNavigate(report.page)}
                className="flex items-center gap-2 rounded-md border border-border-default bg-bg-secondary px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
              >
                <FileSpreadsheet size={16} className="text-text-muted flex-shrink-0" />
                <span className="truncate">{report.label}</span>
              </button>
            ))}
          </div>
        </WidgetCard>

        {/* ---------------- AI insights ---------------- */}
        <WidgetCard title="AI insights" actions={<Sparkles size={16} className="text-text-muted" />}>
          <WidgetUnavailable reason="AI insights are not enabled for this workspace" />
          <p className="text-text-muted text-[11px] flex items-start gap-1.5">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            Enable an AI provider in workspace settings to surface anomalies here.
          </p>
        </WidgetCard>
      </div>
    </div>
  );
}
