import { BaseRepository } from '../repositories/BaseRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { KpiCard } from '../types/hrms';
import { addDays, monthBounds, monthKey, round2, todayString } from '../utils/dateUtils';

export interface RoleDashboardResponse {
  kpis: KpiCard[];
  widgets: Record<string, unknown>;
}

/** Thin raw-SQL surface for the aggregate dashboards. */
class DashboardQueryRepository extends BaseRepository {
  async run<T = any[]>(sql: string, params: any[] = []): Promise<T> {
    return this.query<T>(sql, params);
  }
}

/** Employee list caps: aggregate counts stay exact, only the drill-down lists are capped. */
const TEAM_LIST_CAP = 500;

/**
 * Role-scoped dashboards (employee / manager / HR / executive).
 *
 * Every number here comes from a single set-based aggregate — there is no
 * per-employee looping anywhere, so the queries stay flat at 100k employees.
 * Metrics with no data source in this system return `{ available: false, reason }`
 * rather than a fabricated value.
 */
export class DashboardAggregateService {
  private db = new DashboardQueryRepository();
  private employeeRepo = new EmployeeRepository();
  private activityRepo = new ActivityRepository();

  // -------------------------------------------------------------------------
  // Employee (self-service)
  // -------------------------------------------------------------------------
  async getEmployeeDashboard(employeeId: number): Promise<RoleDashboardResponse> {
    if (!employeeId || employeeId < 1) throw new Error('An employee id is required');

    const today = todayString();
    const { from: monthFrom, to: monthTo } = monthBounds(monthKey(today));
    const year = Number(today.slice(0, 4));

    const [
      monthAtt,
      todayAtt,
      balanceRows,
      taskCount,
      taskRows,
      salaryRows,
      holidayRows,
      shiftRows,
      pendingLeave,
      pendingExpense,
      announcementRows,
      milestones,
      activity,
      docRows,
      ticketRows,
      expenseGroups,
    ] = await Promise.all([
      this.db.run<any[]>(
        `SELECT COUNT(*) AS marked,
                SUM(status = 'PRESENT') AS present_days,
                SUM(status = 'HALF_DAY') AS half_days,
                SUM(status = 'ABSENT') AS absent_days,
                SUM(status = 'LEAVE') AS leave_days,
                SUM(status IN ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE')) AS considered,
                COALESCE(SUM(worked_hours), 0) AS worked_hours,
                COALESCE(SUM(ot_hours), 0) AS ot_hours
           FROM attendance_records
          WHERE employee_id = ? AND deleted_at IS NULL AND att_date BETWEEN ? AND ?`,
        [employeeId, monthFrom, monthTo],
      ),
      this.db.run<any[]>(
        `SELECT status, in_time, out_time, ot_hours, worked_hours
           FROM attendance_records
          WHERE employee_id = ? AND att_date = ? AND deleted_at IS NULL
          LIMIT 1`,
        [employeeId, today],
      ),
      this.db.run<any[]>(
        `SELECT lt.id, lt.code, lt.name, lt.is_paid,
                COALESCE(lb.allocated, lt.annual_quota) AS allocated,
                COALESCE(lb.used, 0) AS used
           FROM leave_types lt
           LEFT JOIN leave_balances lb
                  ON lb.leave_type_id = lt.id AND lb.employee_id = ? AND lb.year = ?
          WHERE lt.deleted_at IS NULL
          ORDER BY lt.code`,
        [employeeId, year],
      ),
      this.db.run<any[]>(
        `SELECT COUNT(*) AS cnt FROM tasks
          WHERE employee_id = ? AND status IN ('PENDING', 'IN_PROGRESS') AND deleted_at IS NULL`,
        [employeeId],
      ),
      this.db.run<any[]>(
        `SELECT id, title, priority, status, due_date, created_at
           FROM tasks
          WHERE employee_id = ? AND status IN ('PENDING', 'IN_PROGRESS') AND deleted_at IS NULL
          ORDER BY (due_date IS NULL), due_date ASC, id DESC
          LIMIT 10`,
        [employeeId],
      ),
      this.db.run<any[]>(
        `SELECT sp.id AS period_id, sp.label, sp.to_date,
                sl.gross_amount, sl.net_amount, sl.total_deductions
           FROM salary_lines sl
           JOIN salary_periods sp ON sp.id = sl.period_id AND sp.deleted_at IS NULL
          WHERE sl.employee_id = ?
          ORDER BY sp.to_date DESC
          LIMIT 3`,
        [employeeId],
      ),
      this.db.run<any[]>(
        `SELECT id, holiday_date, name, is_optional
           FROM holidays
          WHERE deleted_at IS NULL AND holiday_date >= ?
          ORDER BY holiday_date ASC
          LIMIT 5`,
        [today],
      ),
      this.db.run<any[]>(
        `SELECT id, name, start_time, end_time, break_minutes, grace_minutes, week_off_day, is_default
           FROM shifts
          WHERE deleted_at IS NULL
            AND (id = (SELECT shift_id FROM employees WHERE id = ?) OR is_default = 1)
          ORDER BY (id = (SELECT shift_id FROM employees WHERE id = ?)) DESC, is_default DESC
          LIMIT 1`,
        [employeeId, employeeId],
      ),
      this.db.run<any[]>(
        `SELECT lr.id, lr.from_date, lr.to_date, lr.days, lr.status, lr.created_at,
                lt.name AS leave_type_name
           FROM leave_requests lr
           JOIN leave_types lt ON lt.id = lr.leave_type_id
          WHERE lr.employee_id = ? AND lr.status = 'PENDING' AND lr.deleted_at IS NULL
          ORDER BY lr.from_date DESC
          LIMIT 10`,
        [employeeId],
      ),
      this.db.run<any[]>(
        `SELECT id, category, amount, expense_date, status, created_at
           FROM expense_claims
          WHERE employee_id = ? AND status = 'PENDING' AND deleted_at IS NULL
          ORDER BY expense_date DESC
          LIMIT 10`,
        [employeeId],
      ),
      this.db.run<any[]>(
        `SELECT id, title, body, category, pinned, publish_from
           FROM announcements
          WHERE deleted_at IS NULL AND publish_from <= ?
            AND (publish_to IS NULL OR publish_to >= ?)
          ORDER BY pinned DESC, publish_from DESC
          LIMIT 5`,
        [today, today],
      ),
      this.employeeRepo.getUpcomingMilestones(30),
      this.activityRepo.findRecent({ employeeId, limit: 10 }),
      this.db.run<any[]>(
        `SELECT COUNT(*) AS total, SUM(verified = 0) AS unverified
           FROM employee_documents
          WHERE employee_id = ? AND deleted_at IS NULL`,
        [employeeId],
      ),
      this.db.run<any[]>(
        `SELECT id, ticket_no, category, subject, priority, status, created_at
           FROM tickets
          WHERE employee_id = ? AND status <> 'CLOSED' AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT 10`,
        [employeeId],
      ),
      this.db.run<any[]>(
        `SELECT status, COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS amount
           FROM expense_claims
          WHERE employee_id = ? AND deleted_at IS NULL
          GROUP BY status`,
        [employeeId],
      ),
    ]);

    const att = monthAtt[0] ?? {};
    const presentDays = num(att.present_days) + num(att.half_days) * 0.5;
    const considered = num(att.considered);
    const attendancePct = pct1(presentDays, considered);

    const leaveBalances = balanceRows.map((r) => ({
      leaveTypeId: Number(r.id),
      code: r.code,
      name: r.name,
      isPaid: !!r.is_paid,
      year,
      allocated: round2(num(r.allocated)),
      used: round2(num(r.used)),
      balance: round2(num(r.allocated) - num(r.used)),
    }));
    const paidBalance = round2(
      leaveBalances.filter((b) => b.isPaid).reduce((sum, b) => sum + b.balance, 0),
    );

    const pendingTasks = num(taskCount[0]?.cnt);
    const salarySummary = salaryRows.map((r) => ({
      periodId: Number(r.period_id),
      periodLabel: r.label,
      gross: round2(num(r.gross_amount)),
      deductions: round2(num(r.total_deductions)),
      net: round2(num(r.net_amount)),
    }));
    const lastNet = salarySummary.length > 0 ? (salarySummary[0] as { net: number }).net : 0;

    const kpis: KpiCard[] = [
      {
        key: 'attendanceThisMonth',
        label: 'Attendance This Month',
        value: attendancePct,
        unit: '%',
        intent: rateIntent(attendancePct, considered),
        comparisonLabel: `${round2(presentDays)} of ${considered} marked days`,
        page: 'hr',
      },
      {
        key: 'leaveBalance',
        label: 'Leave Balance',
        value: paidBalance,
        unit: 'days',
        intent: 'info',
        comparisonLabel: `Paid leave, ${year}`,
        page: 'hr',
      },
      {
        key: 'pendingTasks',
        label: 'Pending Tasks',
        value: pendingTasks,
        intent: pendingTasks > 0 ? 'warning' : 'success',
        page: 'hr',
      },
      {
        key: 'lastNetSalary',
        label: 'Last Net Salary',
        value: lastNet,
        unit: '₹',
        intent: 'default',
        comparisonLabel: salarySummary[0]?.periodLabel ?? 'No payroll yet',
        page: 'payroll',
      },
    ];

    const todayRow = todayAtt[0];
    const shiftRow = shiftRows[0];
    const docRow = docRows[0] ?? {};

    return {
      kpis,
      widgets: {
        todayAttendance: todayRow
          ? {
              date: today,
              status: todayRow.status,
              inTime: timeOnly(todayRow.in_time),
              outTime: timeOnly(todayRow.out_time),
              otHours: round2(num(todayRow.ot_hours)),
              workedHours: todayRow.worked_hours === null ? null : round2(num(todayRow.worked_hours)),
            }
          : null,
        workingHours: {
          month: monthKey(today),
          workedHours: round2(num(att.worked_hours)),
          otHours: round2(num(att.ot_hours)),
          presentDays: round2(presentDays),
          absentDays: num(att.absent_days),
          leaveDays: num(att.leave_days),
          markedDays: num(att.marked),
        },
        leaveBalances,
        upcomingHolidays: holidayRows.map((r) => ({
          id: Number(r.id),
          date: dateOnly(r.holiday_date),
          name: r.name,
          isOptional: !!r.is_optional,
        })),
        salarySummary,
        todayShift: shiftRow
          ? {
              id: Number(shiftRow.id),
              name: shiftRow.name,
              startTime: timeOnly(shiftRow.start_time),
              endTime: timeOnly(shiftRow.end_time),
              breakMinutes: num(shiftRow.break_minutes),
              graceMinutes: num(shiftRow.grace_minutes),
              weekOffDay: num(shiftRow.week_off_day),
              isDefault: !!shiftRow.is_default,
            }
          : null,
        tasks: taskRows.map((r) => ({
          id: Number(r.id),
          title: r.title,
          priority: r.priority,
          status: r.status,
          dueDate: r.due_date ? dateOnly(r.due_date) : null,
        })),
        pendingApprovals: {
          leave: pendingLeave.map((r) => ({
            id: Number(r.id),
            leaveTypeName: r.leave_type_name,
            fromDate: dateOnly(r.from_date),
            toDate: dateOnly(r.to_date),
            days: num(r.days),
            status: r.status,
          })),
          expenses: pendingExpense.map((r) => ({
            id: Number(r.id),
            category: r.category,
            amount: round2(num(r.amount)),
            expenseDate: dateOnly(r.expense_date),
            status: r.status,
          })),
          total: pendingLeave.length + pendingExpense.length,
        },
        announcements: announcementRows.map((r) => ({
          id: Number(r.id),
          title: r.title,
          body: r.body,
          category: r.category,
          pinned: !!r.pinned,
          publishFrom: dateOnly(r.publish_from),
        })),
        birthdays: milestones.birthdays,
        anniversaries: milestones.anniversaries,
        recentActivity: activity,
        documents: {
          total: num(docRow.total),
          unverified: num(docRow.unverified),
          verified: num(docRow.total) - num(docRow.unverified),
        },
        tickets: ticketRows.map((r) => ({
          id: Number(r.id),
          ticketNo: r.ticket_no,
          category: r.category,
          subject: r.subject,
          priority: r.priority,
          status: r.status,
        })),
        expenses: expenseGroups.map((r) => ({
          status: r.status,
          count: num(r.cnt),
          amount: round2(num(r.amount)),
        })),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Manager
  // -------------------------------------------------------------------------
  async getManagerDashboard(managerEmployeeId?: number): Promise<RoleDashboardResponse> {
    const today = todayString();
    const { from: monthFrom, to: monthTo } = monthBounds(monthKey(today));

    // Managers without a linked employee record supervise everyone.
    const scopeSql = managerEmployeeId
      ? 'e.deleted_at IS NULL AND e.reporting_manager_id = ?'
      : "e.deleted_at IS NULL AND e.work_status = 'WORKING'";
    const scopeParams: any[] = managerEmployeeId ? [managerEmployeeId] : [];

    const [
      attCounts,
      attList,
      approvalCounts,
      onLeaveToday,
      otTotal,
      otTop,
      leaveToday,
      pendingLeaveRows,
      pendingExpenseRows,
      shiftRows,
      birthdayRows,
      workloadRows,
      productivityRows,
      ticketRows,
      deptRows,
      recentLeave,
      recentExpense,
      recentTickets,
    ] = await Promise.all([
      this.db.run<any[]>(
        `SELECT COALESCE(ar.status, 'UNMARKED') AS status, COUNT(*) AS cnt
           FROM employees e
           LEFT JOIN attendance_records ar
                  ON ar.employee_id = e.id AND ar.att_date = ? AND ar.deleted_at IS NULL
          WHERE ${scopeSql}
          GROUP BY COALESCE(ar.status, 'UNMARKED')`,
        [today, ...scopeParams],
      ),
      this.db.run<any[]>(
        `SELECT e.id, e.full_name, e.emp_code, e.department,
                ar.status, ar.in_time, ar.out_time, ar.ot_hours
           FROM employees e
           LEFT JOIN attendance_records ar
                  ON ar.employee_id = e.id AND ar.att_date = ? AND ar.deleted_at IS NULL
          WHERE ${scopeSql}
          ORDER BY e.full_name ASC
          LIMIT ${TEAM_LIST_CAP}`,
        [today, ...scopeParams],
      ),
      this.db.run<any[]>(
        `SELECT
           (SELECT COUNT(*) FROM leave_requests lr
              JOIN employees e ON e.id = lr.employee_id
             WHERE lr.status = 'PENDING' AND lr.deleted_at IS NULL AND ${scopeSql}) AS leave_pending,
           (SELECT COUNT(*) FROM expense_claims ec
              JOIN employees e ON e.id = ec.employee_id
             WHERE ec.status = 'PENDING' AND ec.deleted_at IS NULL AND ${scopeSql}) AS expense_pending`,
        [...scopeParams, ...scopeParams],
      ),
      this.db.run<any[]>(
        `SELECT COUNT(DISTINCT lr.employee_id) AS cnt
           FROM leave_requests lr
           JOIN employees e ON e.id = lr.employee_id
          WHERE lr.status = 'APPROVED' AND lr.deleted_at IS NULL
            AND ? BETWEEN lr.from_date AND lr.to_date AND ${scopeSql}`,
        [today, ...scopeParams],
      ),
      this.db.run<any[]>(
        `SELECT COALESCE(SUM(ar.ot_hours), 0) AS ot_hours
           FROM attendance_records ar
           JOIN employees e ON e.id = ar.employee_id
          WHERE ar.deleted_at IS NULL AND ar.att_date BETWEEN ? AND ? AND ${scopeSql}`,
        [monthFrom, monthTo, ...scopeParams],
      ),
      this.db.run<any[]>(
        `SELECT e.id, e.full_name, e.emp_code, COALESCE(SUM(ar.ot_hours), 0) AS ot_hours
           FROM attendance_records ar
           JOIN employees e ON e.id = ar.employee_id
          WHERE ar.deleted_at IS NULL AND ar.att_date BETWEEN ? AND ? AND ${scopeSql}
          GROUP BY e.id, e.full_name, e.emp_code
         HAVING ot_hours > 0
          ORDER BY ot_hours DESC
          LIMIT 5`,
        [monthFrom, monthTo, ...scopeParams],
      ),
      this.db.run<any[]>(
        `SELECT lr.id, e.id AS employee_id, e.full_name, e.emp_code,
                lt.name AS leave_type_name, lr.from_date, lr.to_date, lr.days
           FROM leave_requests lr
           JOIN employees e ON e.id = lr.employee_id
           JOIN leave_types lt ON lt.id = lr.leave_type_id
          WHERE lr.status = 'APPROVED' AND lr.deleted_at IS NULL
            AND ? BETWEEN lr.from_date AND lr.to_date AND ${scopeSql}
          ORDER BY e.full_name ASC
          LIMIT 50`,
        [today, ...scopeParams],
      ),
      this.db.run<any[]>(
        `SELECT lr.id, e.id AS employee_id, e.full_name, e.emp_code,
                lt.name AS leave_type_name, lr.from_date, lr.to_date, lr.days, lr.reason, lr.created_at
           FROM leave_requests lr
           JOIN employees e ON e.id = lr.employee_id
           JOIN leave_types lt ON lt.id = lr.leave_type_id
          WHERE lr.status = 'PENDING' AND lr.deleted_at IS NULL AND ${scopeSql}
          ORDER BY lr.created_at DESC
          LIMIT 20`,
        scopeParams,
      ),
      this.db.run<any[]>(
        `SELECT ec.id, e.id AS employee_id, e.full_name, e.emp_code,
                ec.category, ec.amount, ec.expense_date, ec.created_at
           FROM expense_claims ec
           JOIN employees e ON e.id = ec.employee_id
          WHERE ec.status = 'PENDING' AND ec.deleted_at IS NULL AND ${scopeSql}
          ORDER BY ec.created_at DESC
          LIMIT 20`,
        scopeParams,
      ),
      this.db.run<any[]>(
        `SELECT COALESCE(s.name, 'Unassigned') AS shift_name, COUNT(*) AS cnt
           FROM employees e
           LEFT JOIN shifts s ON s.id = e.shift_id AND s.deleted_at IS NULL
          WHERE ${scopeSql}
          GROUP BY COALESCE(s.name, 'Unassigned')
          ORDER BY cnt DESC`,
        scopeParams,
      ),
      this.db.run<any[]>(
        `SELECT e.id, e.full_name, e.emp_code,
                DATE_FORMAT(e.dob, CONCAT(YEAR(CURDATE()), '-%m-%d')) AS this_year
           FROM employees e
          WHERE ${scopeSql} AND e.dob IS NOT NULL
         HAVING DATEDIFF(this_year, CURDATE()) BETWEEN 0 AND 30
          ORDER BY DATEDIFF(this_year, CURDATE()) ASC
          LIMIT 20`,
        scopeParams,
      ),
      this.db.run<any[]>(
        `SELECT e.id, e.full_name, e.emp_code,
                COUNT(l.id) AS open_lots,
                COALESCE(SUM(l.issue_weight), 0) AS open_cts
           FROM employees e
           JOIN lots l ON l.employee_id = e.id AND l.deleted_at IS NULL
                      AND l.status IN ('ISSUED', 'IN_PROGRESS')
          WHERE ${scopeSql}
          GROUP BY e.id, e.full_name, e.emp_code
          ORDER BY open_lots DESC
          LIMIT 10`,
        scopeParams,
      ),
      this.db.run<any[]>(
        `SELECT e.id, e.full_name, e.emp_code,
                COUNT(l.id) AS lots_received,
                COALESCE(SUM(l.polished_wt), 0) AS total_cts,
                COALESCE(SUM(l.labour_amount), 0) AS labour_amount
           FROM employees e
           JOIN lots l ON l.employee_id = e.id AND l.deleted_at IS NULL
                      AND l.status IN ('RECEIVED', 'VERIFIED')
                      AND l.received_date BETWEEN ? AND ?
          WHERE ${scopeSql}
          GROUP BY e.id, e.full_name, e.emp_code
          ORDER BY labour_amount DESC
          LIMIT 10`,
        [monthFrom, monthTo, ...scopeParams],
      ),
      this.db.run<any[]>(
        `SELECT t.id, t.ticket_no, e.id AS employee_id, e.full_name, t.category,
                t.subject, t.priority, t.status, t.created_at
           FROM tickets t
           JOIN employees e ON e.id = t.employee_id
          WHERE t.status <> 'CLOSED' AND t.deleted_at IS NULL AND ${scopeSql}
          ORDER BY t.created_at DESC
          LIMIT 20`,
        scopeParams,
      ),
      this.db.run<any[]>(
        `SELECT COALESCE(e.department, 'Unassigned') AS department,
                COUNT(*) AS headcount,
                SUM(ar.status = 'PRESENT') AS present,
                SUM(ar.status = 'HALF_DAY') AS half_day,
                SUM(ar.status IN ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE')) AS considered
           FROM employees e
           LEFT JOIN attendance_records ar
                  ON ar.employee_id = e.id AND ar.att_date = ? AND ar.deleted_at IS NULL
          WHERE ${scopeSql}
          GROUP BY COALESCE(e.department, 'Unassigned')
          ORDER BY headcount DESC`,
        [today, ...scopeParams],
      ),
      this.db.run<any[]>(
        `SELECT lr.id, e.full_name, lr.status, lr.created_at,
                CONCAT(lt.name, ' · ', lr.days, ' day(s)') AS detail
           FROM leave_requests lr
           JOIN employees e ON e.id = lr.employee_id
           JOIN leave_types lt ON lt.id = lr.leave_type_id
          WHERE lr.deleted_at IS NULL AND ${scopeSql}
          ORDER BY lr.created_at DESC
          LIMIT 15`,
        scopeParams,
      ),
      this.db.run<any[]>(
        `SELECT ec.id, e.full_name, ec.status, ec.created_at,
                CONCAT(ec.category, ' · ', ec.amount) AS detail
           FROM expense_claims ec
           JOIN employees e ON e.id = ec.employee_id
          WHERE ec.deleted_at IS NULL AND ${scopeSql}
          ORDER BY ec.created_at DESC
          LIMIT 15`,
        scopeParams,
      ),
      this.db.run<any[]>(
        `SELECT t.id, e.full_name, t.status, t.created_at, t.subject AS detail
           FROM tickets t
           JOIN employees e ON e.id = t.employee_id
          WHERE t.deleted_at IS NULL AND ${scopeSql}
          ORDER BY t.created_at DESC
          LIMIT 15`,
        scopeParams,
      ),
    ]);

    const statusCounts: Record<string, number> = {};
    let teamSize = 0;
    for (const r of attCounts) {
      statusCounts[String(r.status)] = num(r.cnt);
      teamSize += num(r.cnt);
    }
    const presentCount = (statusCounts.PRESENT ?? 0) + (statusCounts.HALF_DAY ?? 0) * 0.5;
    const presentPct = pct1(presentCount, teamSize);
    const leavePending = num(approvalCounts[0]?.leave_pending);
    const expensePending = num(approvalCounts[0]?.expense_pending);
    const onLeave = num(onLeaveToday[0]?.cnt);
    const teamOt = round2(num(otTotal[0]?.ot_hours));

    const kpis: KpiCard[] = [
      {
        key: 'teamPresentToday',
        label: 'Team Present Today',
        value: presentPct,
        unit: '%',
        intent: rateIntent(presentPct, teamSize),
        comparisonLabel: `${round2(presentCount)} of ${teamSize}`,
        page: 'hr',
      },
      {
        key: 'pendingApprovals',
        label: 'Pending Approvals',
        value: leavePending + expensePending,
        intent: leavePending + expensePending > 0 ? 'warning' : 'success',
        comparisonLabel: `${leavePending} leave · ${expensePending} expense`,
        page: 'hr',
      },
      {
        key: 'teamOnLeaveToday',
        label: 'Team On Leave Today',
        value: onLeave,
        intent: onLeave > 0 ? 'info' : 'default',
        page: 'hr',
      },
      {
        key: 'teamOtHoursThisMonth',
        label: 'Team OT Hours This Month',
        value: teamOt,
        unit: 'hrs',
        intent: 'default',
        comparisonLabel: monthKey(today),
        page: 'hr',
      },
    ];

    const employeeRequests = [
      ...recentLeave.map((r) => ({
        kind: 'LEAVE' as const,
        id: Number(r.id),
        employeeName: r.full_name,
        status: r.status,
        detail: r.detail,
        createdAt: isoOrNull(r.created_at),
      })),
      ...recentExpense.map((r) => ({
        kind: 'EXPENSE' as const,
        id: Number(r.id),
        employeeName: r.full_name,
        status: r.status,
        detail: r.detail,
        createdAt: isoOrNull(r.created_at),
      })),
      ...recentTickets.map((r) => ({
        kind: 'TICKET' as const,
        id: Number(r.id),
        employeeName: r.full_name,
        status: r.status,
        detail: r.detail,
        createdAt: isoOrNull(r.created_at),
      })),
    ]
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
      .slice(0, 15);

    return {
      kpis,
      widgets: {
        teamAttendance: {
          date: today,
          teamSize,
          counts: statusCounts,
          listTruncated: attList.length >= TEAM_LIST_CAP,
          employees: attList.map((r) => ({
            employeeId: Number(r.id),
            name: r.full_name,
            empCode: r.emp_code,
            department: r.department,
            status: r.status ?? null,
            inTime: timeOnly(r.in_time),
            outTime: timeOnly(r.out_time),
            otHours: round2(num(r.ot_hours)),
          })),
        },
        teamLeave: {
          onLeaveToday: leaveToday.map((r) => ({
            id: Number(r.id),
            employeeId: Number(r.employee_id),
            name: r.full_name,
            empCode: r.emp_code,
            leaveTypeName: r.leave_type_name,
            fromDate: dateOnly(r.from_date),
            toDate: dateOnly(r.to_date),
            days: num(r.days),
          })),
          pending: pendingLeaveRows.map((r) => ({
            id: Number(r.id),
            employeeId: Number(r.employee_id),
            name: r.full_name,
            empCode: r.emp_code,
            leaveTypeName: r.leave_type_name,
            fromDate: dateOnly(r.from_date),
            toDate: dateOnly(r.to_date),
            days: num(r.days),
            reason: r.reason,
          })),
        },
        pendingApprovals: {
          leaveCount: leavePending,
          expenseCount: expensePending,
          leave: pendingLeaveRows.map((r) => ({
            id: Number(r.id),
            employeeId: Number(r.employee_id),
            name: r.full_name,
            empCode: r.emp_code,
            leaveTypeName: r.leave_type_name,
            fromDate: dateOnly(r.from_date),
            toDate: dateOnly(r.to_date),
            days: num(r.days),
          })),
          expenses: pendingExpenseRows.map((r) => ({
            id: Number(r.id),
            employeeId: Number(r.employee_id),
            name: r.full_name,
            empCode: r.emp_code,
            category: r.category,
            amount: round2(num(r.amount)),
            expenseDate: dateOnly(r.expense_date),
          })),
        },
        shiftStatus: shiftRows.map((r) => ({ shiftName: r.shift_name, count: num(r.cnt) })),
        employeeAvailability: {
          teamSize,
          working: (statusCounts.PRESENT ?? 0) + (statusCounts.HALF_DAY ?? 0),
          onLeave: statusCounts.LEAVE ?? 0,
          absent: statusCounts.ABSENT ?? 0,
          holiday: (statusCounts.HOLIDAY ?? 0) + (statusCounts.WEEK_OFF ?? 0),
          unmarked: statusCounts.UNMARKED ?? 0,
        },
        birthdays: birthdayRows.map((r) => ({
          employeeId: Number(r.id),
          name: r.full_name,
          empCode: r.emp_code,
          date: dateOnly(r.this_year),
        })),
        teamWorkload: workloadRows.map((r) => ({
          employeeId: Number(r.id),
          name: r.full_name,
          empCode: r.emp_code,
          openLots: num(r.open_lots),
          openCts: round2(num(r.open_cts)),
        })),
        teamProductivity: productivityRows.map((r) => ({
          employeeId: Number(r.id),
          name: r.full_name,
          empCode: r.emp_code,
          lotsReceived: num(r.lots_received),
          totalCts: round2(num(r.total_cts)),
          labourEarned: round2(num(r.labour_amount)),
        })),
        openTickets: ticketRows.map((r) => ({
          id: Number(r.id),
          ticketNo: r.ticket_no,
          employeeId: Number(r.employee_id),
          employeeName: r.full_name,
          category: r.category,
          subject: r.subject,
          priority: r.priority,
          status: r.status,
        })),
        departmentKpis: deptRows.map((r) => {
          const present = num(r.present) + num(r.half_day) * 0.5;
          return {
            department: r.department,
            headcount: num(r.headcount),
            presentToday: present,
            attendancePct: pct1(present, num(r.considered)),
          };
        }),
        overtimeSummary: {
          month: monthKey(today),
          totalOtHours: teamOt,
          topEmployees: otTop.map((r) => ({
            employeeId: Number(r.id),
            name: r.full_name,
            empCode: r.emp_code,
            otHours: round2(num(r.ot_hours)),
          })),
        },
        employeeRequests,
      },
    };
  }

  // -------------------------------------------------------------------------
  // HR
  // -------------------------------------------------------------------------
  async getHrDashboard(): Promise<RoleDashboardResponse> {
    const today = todayString();
    const { from: monthFrom, to: monthTo } = monthBounds(monthKey(today));
    const sixMonthsAgo = monthBounds(shiftMonth(monthKey(today), -5)).from;
    const thirtyDaysAgo = addDays(today, -29);
    const sevenDaysAgo = addDays(today, -6);

    const [
      headcount,
      attritionRow,
      attMonth,
      pendingLeaveCount,
      openingsRow,
      latestPeriod,
      joinersLeavers,
      dailyAttendance,
      pendingLeaveList,
      payrollPeriods,
      candidateStatus,
      trainingRows,
      complianceRow,
      docVerification,
      onboardingCandidates,
      onboardingEmployees,
      offboardingRows,
      genderRows,
      gradeRows,
      workerTypeRows,
      departmentRows,
    ] = await Promise.all([
      this.employeeRepo.getHeadcountStats(),
      this.db.run<any[]>(
        `SELECT
           (SELECT COUNT(*) FROM employees
             WHERE deleted_at IS NULL AND joined_at < ?
               AND (resigned_at IS NULL OR resigned_at >= ?)) AS active_at_start,
           (SELECT COUNT(*) FROM employees
             WHERE deleted_at IS NULL AND resigned_at BETWEEN ? AND ?) AS resigned_this_month`,
        [monthFrom, monthFrom, monthFrom, monthTo],
      ),
      this.db.run<any[]>(
        `SELECT SUM(status = 'PRESENT') AS present, SUM(status = 'HALF_DAY') AS half_day,
                SUM(status IN ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE')) AS considered
           FROM attendance_records
          WHERE deleted_at IS NULL AND att_date BETWEEN ? AND ?`,
        [monthFrom, monthTo],
      ),
      this.db.run<any[]>(
        "SELECT COUNT(*) AS cnt FROM leave_requests WHERE status = 'PENDING' AND deleted_at IS NULL",
      ),
      this.db.run<any[]>(
        `SELECT COUNT(*) AS openings_count, COALESCE(SUM(openings), 0) AS positions
           FROM job_openings WHERE status = 'OPEN' AND deleted_at IS NULL`,
      ),
      this.db.run<any[]>(
        `SELECT id, label, status, from_date, to_date FROM salary_periods
          WHERE deleted_at IS NULL ORDER BY to_date DESC LIMIT 1`,
      ),
      this.db.run<any[]>(
        `SELECT month, SUM(joined) AS joined, SUM(resigned) AS resigned FROM (
            SELECT DATE_FORMAT(joined_at, '%Y-%m') AS month, 1 AS joined, 0 AS resigned
              FROM employees WHERE deleted_at IS NULL AND joined_at >= ?
            UNION ALL
            SELECT DATE_FORMAT(resigned_at, '%Y-%m'), 0, 1
              FROM employees WHERE deleted_at IS NULL AND resigned_at IS NOT NULL AND resigned_at >= ?
          ) t
          GROUP BY month ORDER BY month ASC`,
        [sixMonthsAgo, sixMonthsAgo],
      ),
      this.db.run<any[]>(
        `SELECT att_date, SUM(status = 'PRESENT') AS present, SUM(status = 'HALF_DAY') AS half_day,
                SUM(status IN ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE')) AS considered
           FROM attendance_records
          WHERE deleted_at IS NULL AND att_date BETWEEN ? AND ?
          GROUP BY att_date ORDER BY att_date ASC`,
        [thirtyDaysAgo, today],
      ),
      this.db.run<any[]>(
        `SELECT lr.id, e.id AS employee_id, e.full_name, e.emp_code, lt.name AS leave_type_name,
                lr.from_date, lr.to_date, lr.days, lr.reason, lr.created_at
           FROM leave_requests lr
           JOIN employees e ON e.id = lr.employee_id
           JOIN leave_types lt ON lt.id = lr.leave_type_id
          WHERE lr.status = 'PENDING' AND lr.deleted_at IS NULL
          ORDER BY lr.created_at DESC LIMIT 15`,
      ),
      this.db.run<any[]>(
        `SELECT sp.id, sp.label, sp.status, sp.from_date, sp.to_date,
                COUNT(sl.id) AS line_count,
                COALESCE(SUM(sl.gross_amount), 0) AS total_gross,
                COALESCE(SUM(sl.net_amount), 0) AS total_net,
                COALESCE(SUM(sl.manager_verified = 1), 0) AS manager_verified,
                COALESCE(SUM(sl.account_verified = 1), 0) AS account_verified
           FROM salary_periods sp
           LEFT JOIN salary_lines sl ON sl.period_id = sp.id
          WHERE sp.deleted_at IS NULL
          GROUP BY sp.id, sp.label, sp.status, sp.from_date, sp.to_date
          ORDER BY sp.to_date DESC LIMIT 3`,
      ),
      this.db.run<any[]>(
        'SELECT status, COUNT(*) AS cnt FROM candidates WHERE deleted_at IS NULL GROUP BY status',
      ),
      this.db.run<any[]>(
        `SELECT t.status, COUNT(DISTINCT t.id) AS trainings, COUNT(te.id) AS enrollments
           FROM trainings t
           LEFT JOIN training_enrollments te ON te.training_id = t.id
          WHERE t.deleted_at IS NULL
          GROUP BY t.status`,
      ),
      this.db.run<any[]>(
        `SELECT
           (SELECT COUNT(*) FROM employees
             WHERE deleted_at IS NULL AND work_status = 'WORKING'
               AND (bank_account IS NULL OR bank_account = '')) AS missing_bank,
           (SELECT COUNT(*) FROM employees
             WHERE deleted_at IS NULL AND work_status = 'WORKING'
               AND (aadhaar_number IS NULL OR aadhaar_number = '')) AS missing_aadhaar,
           (SELECT COUNT(*) FROM employees
             WHERE deleted_at IS NULL AND work_status = 'WORKING'
               AND worker_type IN ('DHAR', 'MAXI')
               AND (monthly_salary IS NULL OR monthly_salary = 0)) AS missing_salary,
           (SELECT COUNT(*) FROM employee_documents
             WHERE deleted_at IS NULL AND verified = 0) AS unverified_docs,
           (SELECT COUNT(*) FROM employees e
             WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING'
               AND NOT EXISTS (SELECT 1 FROM attendance_records ar
                                WHERE ar.employee_id = e.id AND ar.deleted_at IS NULL
                                  AND ar.att_date >= ?)) AS no_attendance_7d`,
        [sevenDaysAgo],
      ),
      this.db.run<any[]>(
        `SELECT COALESCE(SUM(verified = 1), 0) AS verified, COALESCE(SUM(verified = 0), 0) AS unverified
           FROM employee_documents WHERE deleted_at IS NULL`,
      ),
      this.db.run<any[]>(
        `SELECT id, full_name, phone, position_grade, interview_date
           FROM candidates
          WHERE deleted_at IS NULL AND status = 'SELECTED' AND converted_employee_id IS NULL
          ORDER BY updated_at DESC LIMIT 20`,
      ),
      this.db.run<any[]>(
        `SELECT id, emp_code, full_name, joined_at,
                (aadhaar_number IS NULL OR aadhaar_number = '') AS missing_aadhaar,
                (bank_account IS NULL OR bank_account = '') AS missing_bank
           FROM employees
          WHERE deleted_at IS NULL AND joined_at >= ?
            AND (aadhaar_number IS NULL OR aadhaar_number = ''
                 OR bank_account IS NULL OR bank_account = '')
          ORDER BY joined_at DESC LIMIT 20`,
        [thirtyDaysAgo],
      ),
      this.db.run<any[]>(
        `SELECT e.id, e.emp_code, e.full_name, e.resigned_at,
                EXISTS(SELECT 1 FROM users u
                        WHERE u.employee_id = e.id AND u.is_active = 1 AND u.deleted_at IS NULL) AS has_login,
                (SELECT COUNT(*) FROM asset_assignments aa
                  WHERE aa.employee_id = e.id AND aa.returned_on IS NULL) AS open_assets,
                (SELECT COUNT(*) FROM advances a
                  WHERE a.employee_id = e.id AND a.status = 'ACTIVE' AND a.deleted_at IS NULL) AS open_advances
           FROM employees e
          WHERE e.deleted_at IS NULL AND e.work_status = 'RESIGN' AND e.resigned_at >= ?
         HAVING has_login = 1 OR open_assets > 0 OR open_advances > 0
          ORDER BY e.resigned_at DESC LIMIT 50`,
        [thirtyDaysAgo],
      ),
      this.db.run<any[]>(
        `SELECT COALESCE(gender, 'UNSPECIFIED') AS bucket, COUNT(*) AS cnt
           FROM employees WHERE deleted_at IS NULL AND work_status = 'WORKING'
          GROUP BY COALESCE(gender, 'UNSPECIFIED')`,
      ),
      this.db.run<any[]>(
        `SELECT grade AS bucket, COUNT(*) AS cnt
           FROM employees WHERE deleted_at IS NULL AND work_status = 'WORKING'
          GROUP BY grade ORDER BY cnt DESC`,
      ),
      this.db.run<any[]>(
        `SELECT worker_type AS bucket, COUNT(*) AS cnt
           FROM employees WHERE deleted_at IS NULL AND work_status = 'WORKING'
          GROUP BY worker_type`,
      ),
      this.db.run<any[]>(
        `SELECT COALESCE(department, 'Unassigned') AS department, COUNT(*) AS headcount,
                COALESCE(SUM(work_status = 'WORKING'), 0) AS working
           FROM employees WHERE deleted_at IS NULL
          GROUP BY COALESCE(department, 'Unassigned') ORDER BY headcount DESC`,
      ),
    ]);

    const activeAtStart = num(attritionRow[0]?.active_at_start);
    const resignedThisMonth = num(attritionRow[0]?.resigned_this_month);
    const attritionPct = pct1(resignedThisMonth, activeAtStart);

    const attPresent = num(attMonth[0]?.present) + num(attMonth[0]?.half_day) * 0.5;
    const attendancePct = pct1(attPresent, num(attMonth[0]?.considered));

    const pendingLeave = num(pendingLeaveCount[0]?.cnt);
    const openPositions = num(openingsRow[0]?.positions);
    const period = latestPeriod[0];

    const kpis: KpiCard[] = [
      { key: 'totalEmployees', label: 'Total Employees', value: headcount.total, intent: 'default', page: 'employees' },
      { key: 'activeEmployees', label: 'Active Employees', value: headcount.working, intent: 'success', page: 'employees' },
      {
        key: 'newJoiners',
        label: 'New Joiners',
        value: headcount.joinedThisMonth,
        intent: 'info',
        comparisonLabel: monthKey(today),
        page: 'employees',
      },
      {
        key: 'attritionRate',
        label: 'Attrition Rate',
        value: attritionPct,
        unit: '%',
        intent: attritionPct >= 5 ? 'danger' : attritionPct >= 2 ? 'warning' : 'success',
        comparisonLabel: `${resignedThisMonth} of ${activeAtStart} at month start`,
        page: 'employees',
      },
      {
        key: 'attendanceRate',
        label: 'Attendance Rate',
        value: attendancePct,
        unit: '%',
        intent: rateIntent(attendancePct, num(attMonth[0]?.considered)),
        comparisonLabel: monthKey(today),
        page: 'hr',
      },
      {
        key: 'pendingLeaveRequests',
        label: 'Pending Leave Requests',
        value: pendingLeave,
        intent: pendingLeave > 0 ? 'warning' : 'success',
        page: 'hr',
      },
      {
        key: 'openPositions',
        label: 'Open Positions',
        value: openPositions,
        intent: 'info',
        comparisonLabel: `${num(openingsRow[0]?.openings_count)} openings`,
        page: 'hr',
      },
      {
        key: 'payrollStatus',
        label: 'Payroll Status',
        value: period ? `${period.label} · ${period.status}` : 'No period',
        intent: period?.status === 'PAID' ? 'success' : period ? 'warning' : 'default',
        page: 'payroll',
      },
    ];

    const months = lastMonths(monthKey(today), 6);
    const jlMap = new Map<string, { joined: number; resigned: number }>();
    for (const r of joinersLeavers) {
      jlMap.set(String(r.month), { joined: num(r.joined), resigned: num(r.resigned) });
    }

    const compliance = complianceRow[0] ?? {};
    const complianceAlerts = [
      { key: 'missingBank', label: 'Employees missing bank account', count: num(compliance.missing_bank), severity: severity(num(compliance.missing_bank)) },
      { key: 'missingAadhaar', label: 'Employees missing Aadhaar', count: num(compliance.missing_aadhaar), severity: severity(num(compliance.missing_aadhaar)) },
      { key: 'missingMonthlySalary', label: 'DHAR/MAXI employees missing monthly salary', count: num(compliance.missing_salary), severity: severity(num(compliance.missing_salary)) },
      { key: 'unverifiedDocuments', label: 'Unverified documents', count: num(compliance.unverified_docs), severity: severity(num(compliance.unverified_docs)) },
      { key: 'noRecentAttendance', label: 'No attendance marked in the last 7 days', count: num(compliance.no_attendance_7d), severity: severity(num(compliance.no_attendance_7d)) },
    ];

    return {
      kpis,
      widgets: {
        headcount,
        joinersLeavers: months.map((m) => ({
          month: m,
          joined: jlMap.get(m)?.joined ?? 0,
          resigned: jlMap.get(m)?.resigned ?? 0,
        })),
        attendanceRate: dailyAttendance.map((r) => {
          const present = num(r.present) + num(r.half_day) * 0.5;
          return {
            date: dateOnly(r.att_date),
            presentPct: pct1(present, num(r.considered)),
            present,
            considered: num(r.considered),
          };
        }),
        leaveRequests: pendingLeaveList.map((r) => ({
          id: Number(r.id),
          employeeId: Number(r.employee_id),
          employeeName: r.full_name,
          empCode: r.emp_code,
          leaveTypeName: r.leave_type_name,
          fromDate: dateOnly(r.from_date),
          toDate: dateOnly(r.to_date),
          days: num(r.days),
          reason: r.reason,
        })),
        payrollStatus: payrollPeriods.map((r) => ({
          periodId: Number(r.id),
          label: r.label,
          status: r.status,
          fromDate: dateOnly(r.from_date),
          toDate: dateOnly(r.to_date),
          lineCount: num(r.line_count),
          totalGross: round2(num(r.total_gross)),
          totalNet: round2(num(r.total_net)),
          managerVerified: num(r.manager_verified),
          accountVerified: num(r.account_verified),
        })),
        recruitment: {
          candidatesByStatus: candidateStatus.map((r) => ({ status: r.status, count: num(r.cnt) })),
          openOpenings: num(openingsRow[0]?.openings_count),
          openPositions,
        },
        trainingStatus: trainingRows.map((r) => ({
          status: r.status,
          trainings: num(r.trainings),
          enrollments: num(r.enrollments),
        })),
        complianceAlerts,
        documentVerification: {
          verified: num(docVerification[0]?.verified),
          unverified: num(docVerification[0]?.unverified),
        },
        pendingOnboarding: {
          selectedCandidates: onboardingCandidates.map((r) => ({
            id: Number(r.id),
            fullName: r.full_name,
            phone: r.phone,
            positionGrade: r.position_grade,
            interviewDate: r.interview_date ? isoOrNull(r.interview_date) : null,
          })),
          newJoinersMissingKyc: onboardingEmployees.map((r) => ({
            employeeId: Number(r.id),
            empCode: r.emp_code,
            fullName: r.full_name,
            joinedAt: dateOnly(r.joined_at),
            missingAadhaar: !!Number(r.missing_aadhaar),
            missingBank: !!Number(r.missing_bank),
          })),
        },
        pendingOffboarding: offboardingRows.map((r) => ({
          employeeId: Number(r.id),
          empCode: r.emp_code,
          fullName: r.full_name,
          resignedAt: r.resigned_at ? dateOnly(r.resigned_at) : null,
          hasActiveLogin: !!Number(r.has_login),
          unreturnedAssets: num(r.open_assets),
          openAdvances: num(r.open_advances),
        })),
        diversity: {
          gender: genderRows.map((r) => ({ bucket: r.bucket, count: num(r.cnt) })),
          grade: gradeRows.map((r) => ({ bucket: r.bucket, count: num(r.cnt) })),
          workerType: workerTypeRows.map((r) => ({ bucket: r.bucket, count: num(r.cnt) })),
        },
        departmentBreakdown: departmentRows.map((r) => ({
          department: r.department,
          headcount: num(r.headcount),
          working: num(r.working),
        })),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Executive
  // -------------------------------------------------------------------------
  async getExecutiveDashboard(): Promise<RoleDashboardResponse> {
    const today = todayString();
    const currentMonth = monthKey(today);
    const { from: monthFrom, to: monthTo } = monthBounds(currentMonth);
    const twelveMonthsAgo = addDays(today, -364);
    const thirtyDaysAgo = addDays(today, -29);
    const sixMonthsFrom = monthBounds(shiftMonth(currentMonth, -5)).from;
    const trendMonths = lastMonths(currentMonth, 12);
    // Month labels are generated here (never user input) and re-validated, so
    // inlining them is safe and avoids placeholders inside a derived table.
    const monthsUnion = trendMonths
      .map((m, i) => {
        if (!/^\d{4}-\d{2}$/.test(m)) throw new Error('Failed to build the headcount trend window');
        return `SELECT '${m}'${i === 0 ? ' AS month' : ''}`;
      })
      .join(' UNION ALL ');

    const [
      overviewRow,
      attritionRow,
      latestClosedPeriod,
      attMonth,
      labourRow,
      headcountTrend,
      payrollCost,
      attendanceMonths,
      deptAttendance,
      deptLabour,
      hiringTrend,
      costAnalytics,
      planningRow,
      retirementRows,
    ] = await Promise.all([
      this.db.run<any[]>(
        `SELECT
           (SELECT COUNT(*) FROM employees WHERE deleted_at IS NULL AND work_status = 'WORKING') AS headcount,
           (SELECT COUNT(DISTINCT department) FROM employees
             WHERE deleted_at IS NULL AND department IS NOT NULL AND department <> '') AS departments,
           (SELECT COUNT(*) FROM lots WHERE deleted_at IS NULL AND status IN ('ISSUED', 'IN_PROGRESS')) AS active_lots,
           (SELECT COUNT(*) FROM salary_periods WHERE deleted_at IS NULL AND status = 'OPEN') AS open_periods`,
      ),
      this.db.run<any[]>(
        `SELECT
           (SELECT COUNT(*) FROM employees
             WHERE deleted_at IS NULL AND resigned_at BETWEEN ? AND ?) AS resigned_12m,
           (SELECT COUNT(*) FROM employees
             WHERE deleted_at IS NULL AND joined_at < ?
               AND (resigned_at IS NULL OR resigned_at >= ?)) AS active_at_window_start`,
        [twelveMonthsAgo, today, twelveMonthsAgo, twelveMonthsAgo],
      ),
      this.db.run<any[]>(
        `SELECT sp.id, sp.label, sp.status, COALESCE(SUM(sl.net_amount), 0) AS total_net,
                COALESCE(SUM(sl.gross_amount), 0) AS total_gross
           FROM salary_periods sp
           LEFT JOIN salary_lines sl ON sl.period_id = sp.id
          WHERE sp.deleted_at IS NULL AND sp.status IN ('LOCKED', 'PAID')
          GROUP BY sp.id, sp.label, sp.status, sp.to_date
          ORDER BY sp.to_date DESC LIMIT 1`,
      ),
      this.db.run<any[]>(
        `SELECT SUM(status = 'PRESENT') AS present, SUM(status = 'HALF_DAY') AS half_day,
                SUM(status IN ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE')) AS considered
           FROM attendance_records
          WHERE deleted_at IS NULL AND att_date BETWEEN ? AND ?`,
        [monthFrom, monthTo],
      ),
      this.db.run<any[]>(
        `SELECT COALESCE(SUM(labour_amount), 0) AS labour_amount, COUNT(*) AS lots
           FROM lots
          WHERE deleted_at IS NULL AND received_date BETWEEN ? AND ?`,
        [thirtyDaysAgo, today],
      ),
      this.db.run<any[]>(
        `SELECT m.month, COUNT(e.id) AS headcount
           FROM (${monthsUnion}) m
           LEFT JOIN employees e
                  ON e.deleted_at IS NULL
                 AND e.joined_at <= LAST_DAY(CONCAT(m.month, '-01'))
                 AND (e.resigned_at IS NULL OR e.resigned_at > LAST_DAY(CONCAT(m.month, '-01')))
          GROUP BY m.month ORDER BY m.month ASC`,
      ),
      this.db.run<any[]>(
        `SELECT sp.id, sp.label, sp.status, sp.to_date,
                COALESCE(SUM(sl.gross_amount), 0) AS gross,
                COALESCE(SUM(sl.total_deductions), 0) AS deductions,
                COALESCE(SUM(sl.net_amount), 0) AS net
           FROM salary_periods sp
           LEFT JOIN salary_lines sl ON sl.period_id = sp.id
          WHERE sp.deleted_at IS NULL
          GROUP BY sp.id, sp.label, sp.status, sp.to_date
          ORDER BY sp.to_date DESC LIMIT 6`,
      ),
      this.db.run<any[]>(
        `SELECT DATE_FORMAT(att_date, '%Y-%m') AS month,
                SUM(status = 'PRESENT') AS present, SUM(status = 'HALF_DAY') AS half_day,
                SUM(status IN ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE')) AS considered
           FROM attendance_records
          WHERE deleted_at IS NULL AND att_date >= ?
          GROUP BY DATE_FORMAT(att_date, '%Y-%m') ORDER BY month ASC`,
        [sixMonthsFrom],
      ),
      this.db.run<any[]>(
        `SELECT COALESCE(e.department, 'Unassigned') AS department,
                COUNT(DISTINCT e.id) AS headcount,
                SUM(ar.status = 'PRESENT') AS present, SUM(ar.status = 'HALF_DAY') AS half_day,
                SUM(ar.status IN ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE')) AS considered
           FROM employees e
           LEFT JOIN attendance_records ar
                  ON ar.employee_id = e.id AND ar.deleted_at IS NULL AND ar.att_date BETWEEN ? AND ?
          WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING'
          GROUP BY COALESCE(e.department, 'Unassigned')`,
        [monthFrom, monthTo],
      ),
      this.db.run<any[]>(
        `SELECT COALESCE(e.department, 'Unassigned') AS department,
                COALESCE(SUM(l.labour_amount), 0) AS labour_amount,
                COALESCE(SUM(l.polished_wt), 0) AS total_cts
           FROM employees e
           JOIN lots l ON l.employee_id = e.id AND l.deleted_at IS NULL
                      AND l.received_date BETWEEN ? AND ?
          WHERE e.deleted_at IS NULL
          GROUP BY COALESCE(e.department, 'Unassigned')`,
        [monthFrom, monthTo],
      ),
      this.db.run<any[]>(
        `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, status, COUNT(*) AS cnt
           FROM candidates
          WHERE deleted_at IS NULL AND created_at >= ?
          GROUP BY DATE_FORMAT(created_at, '%Y-%m'), status
          ORDER BY month ASC`,
        [sixMonthsFrom],
      ),
      this.db.run<any[]>(
        `SELECT sp.id, sp.label, sp.to_date,
                COALESCE(SUM(sl.earn_piece), 0) AS earn_piece,
                COALESCE(SUM(sl.earn_fixed), 0) AS earn_fixed,
                COALESCE(SUM(sl.earn_ot), 0) AS earn_ot,
                COALESCE(SUM(sl.ded_pf + sl.ded_esi + sl.ded_pt), 0) AS statutory
           FROM salary_periods sp
           LEFT JOIN salary_lines sl ON sl.period_id = sp.id
          WHERE sp.deleted_at IS NULL
          GROUP BY sp.id, sp.label, sp.to_date
          ORDER BY sp.to_date DESC LIMIT 6`,
      ),
      this.db.run<any[]>(
        `SELECT
           (SELECT COALESCE(SUM(openings), 0) FROM job_openings
             WHERE status = 'OPEN' AND deleted_at IS NULL) AS open_positions,
           (SELECT COUNT(*) FROM candidates
             WHERE deleted_at IS NULL AND status IN ('APPLIED', 'INTERVIEW', 'SELECTED')) AS pipeline`,
      ),
      this.db.run<any[]>(
        `SELECT id, emp_code, full_name, dob, TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age
           FROM employees
          WHERE deleted_at IS NULL AND work_status = 'WORKING' AND dob IS NOT NULL
            AND TIMESTAMPDIFF(YEAR, dob, CURDATE()) >= 57
          ORDER BY dob ASC LIMIT 20`,
      ),
    ]);

    const overview = overviewRow[0] ?? {};
    const workingHeadcount = num(overview.headcount);
    const resigned12m = num(attritionRow[0]?.resigned_12m);
    const activeAtWindowStart = num(attritionRow[0]?.active_at_window_start);
    const attrition12m = pct1(resigned12m, activeAtWindowStart);

    const attPresent = num(attMonth[0]?.present) + num(attMonth[0]?.half_day) * 0.5;
    const attendancePct = pct1(attPresent, num(attMonth[0]?.considered));

    const labourValue = round2(num(labourRow[0]?.labour_amount));
    const labourPerEmployee = workingHeadcount > 0 ? round2(labourValue / workingHeadcount) : 0;
    const closedPeriod = latestClosedPeriod[0];

    const kpis: KpiCard[] = [
      { key: 'headcount', label: 'Headcount', value: workingHeadcount, intent: 'default', page: 'employees' },
      {
        key: 'attritionRate12m',
        label: 'Attrition Rate',
        value: attrition12m,
        unit: '%',
        intent: attrition12m >= 20 ? 'danger' : attrition12m >= 10 ? 'warning' : 'success',
        comparisonLabel: 'Rolling 12 months',
        page: 'employees',
      },
      {
        key: 'payrollCost',
        label: 'Payroll Cost',
        value: closedPeriod ? round2(num(closedPeriod.total_net)) : 0,
        unit: '₹',
        intent: 'default',
        comparisonLabel: closedPeriod ? `${closedPeriod.label} (${closedPeriod.status})` : 'No locked period yet',
        page: 'payroll',
      },
      {
        key: 'attendanceAnalytics',
        label: 'Attendance Analytics',
        value: attendancePct,
        unit: '%',
        intent: rateIntent(attendancePct, num(attMonth[0]?.considered)),
        comparisonLabel: currentMonth,
        page: 'hr',
      },
      {
        key: 'labourValuePerEmployee',
        // This system has no revenue table; labour value produced is the closest
        // real figure, so it is labelled for what it is rather than as revenue.
        label: 'Labour Value / Employee',
        value: labourPerEmployee,
        unit: '₹',
        intent: 'info',
        comparisonLabel: `Last 30 days · ${workingHeadcount} working`,
        page: 'ledger',
      },
    ];

    const deptMap = new Map<string, { headcount: number; attendancePct: number; labourProduced: number; totalCts: number }>();
    for (const r of deptAttendance) {
      const present = num(r.present) + num(r.half_day) * 0.5;
      deptMap.set(String(r.department), {
        headcount: num(r.headcount),
        attendancePct: pct1(present, num(r.considered)),
        labourProduced: 0,
        totalCts: 0,
      });
    }
    for (const r of deptLabour) {
      const key = String(r.department);
      const entry = deptMap.get(key) ?? { headcount: 0, attendancePct: 0, labourProduced: 0, totalCts: 0 };
      entry.labourProduced = round2(num(r.labour_amount));
      entry.totalCts = round2(num(r.total_cts));
      deptMap.set(key, entry);
    }

    const hiringMonths = lastMonths(currentMonth, 6);
    const hiringMap = new Map<string, Record<string, number>>();
    for (const r of hiringTrend) {
      const bucket = hiringMap.get(String(r.month)) ?? {};
      bucket[String(r.status)] = num(r.cnt);
      hiringMap.set(String(r.month), bucket);
    }

    const attMonthMap = new Map<string, number>();
    for (const r of attendanceMonths) {
      const present = num(r.present) + num(r.half_day) * 0.5;
      attMonthMap.set(String(r.month), pct1(present, num(r.considered)));
    }

    return {
      kpis,
      widgets: {
        companyOverview: {
          headcount: workingHeadcount,
          departments: num(overview.departments),
          activeLots: num(overview.active_lots),
          openPayrollPeriods: num(overview.open_periods),
        },
        headcountTrend: headcountTrend.map((r) => ({ month: String(r.month), headcount: num(r.headcount) })),
        payrollCost: payrollCost
          .map((r) => ({
            periodId: Number(r.id),
            label: r.label,
            status: r.status,
            gross: round2(num(r.gross)),
            deductions: round2(num(r.deductions)),
            net: round2(num(r.net)),
          }))
          .reverse(),
        attendanceAnalytics: lastMonths(currentMonth, 6).map((m) => ({
          month: m,
          attendancePct: attMonthMap.get(m) ?? 0,
        })),
        departmentPerformance: Array.from(deptMap.entries())
          .map(([department, v]) => ({ department, ...v }))
          .sort((a, b) => b.headcount - a.headcount),
        hiringTrend: hiringMonths.map((m) => ({ month: m, byStatus: hiringMap.get(m) ?? {} })),
        costAnalytics: costAnalytics
          .map((r) => ({
            periodId: Number(r.id),
            label: r.label,
            piece: round2(num(r.earn_piece)),
            fixed: round2(num(r.earn_fixed)),
            overtime: round2(num(r.earn_ot)),
            statutory: round2(num(r.statutory)),
          }))
          .reverse(),
        workforcePlanning: {
          openPositions: num(planningRow[0]?.open_positions),
          candidatesInPipeline: num(planningRow[0]?.pipeline),
          upcomingRetirements: retirementRows.map((r) => ({
            employeeId: Number(r.id),
            empCode: r.emp_code,
            fullName: r.full_name,
            dob: dateOnly(r.dob),
            age: num(r.age),
          })),
        },
        // Deliberately not fabricated: no survey/feedback table exists.
        employeeSatisfaction: { available: false, reason: 'No survey data is collected yet' },
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------
function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Percentage to one decimal, always guarded against a zero denominator. */
function pct1(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Traffic light for a rate. With no denominator there is nothing to judge, so
 * it stays neutral rather than showing a red alarm for missing data.
 */
function rateIntent(pct: number, denominator: number): 'default' | 'success' | 'warning' | 'danger' {
  if (!denominator || denominator <= 0) return 'default';
  if (pct >= 90) return 'success';
  if (pct >= 75) return 'warning';
  return 'danger';
}

function severity(count: number): 'info' | 'warning' | 'danger' {
  if (count === 0) return 'info';
  return count >= 10 ? 'danger' : 'warning';
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value ?? '');
  return s.length > 10 ? s.slice(0, 10) : s;
}

function timeOnly(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  const match = String(value).match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Shift a `YYYY-MM` bucket by a signed number of months. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y as number, (m as number) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The last `count` `YYYY-MM` buckets ending at `month`, oldest first. */
function lastMonths(month: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(shiftMonth(month, -i));
  return out;
}
