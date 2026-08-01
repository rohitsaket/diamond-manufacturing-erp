import { LeaveRepository, LeaveRequestFilters } from '../repositories/LeaveRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { HolidayRepository } from '../repositories/HolidayRepository';
import { AttendanceRepository } from '../repositories/AttendanceRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { NotificationService } from './NotificationService';
import {
  AttendanceUpsertEntry,
  LeaveBalanceResponse,
  LeaveRequestResponse,
  LeaveTypeResponse,
} from '../types/hrms';
import { dayOfWeek, eachDate, isValidDateString, toDateString } from '../utils/dateUtils';

export interface CreateLeaveTypePayload {
  code?: string;
  name?: string;
  annualQuota?: number;
  isPaid?: boolean;
  color?: string;
}

export interface CreateLeaveRequestPayload {
  employeeId: number;
  leaveTypeId: number;
  fromDate: string;
  toDate: string;
  reason?: string | null;
  appliedBySelf?: boolean;
}

/** An approved request plus any operational caveat worth surfacing in the UI. */
export interface LeaveApprovalResult extends LeaveRequestResponse {
  warning?: string;
}

/** Roles that should hear about a new leave request. */
const APPROVER_ROLES = ['admin', 'manager', 'hr'];

export class LeaveService {
  private repo = new LeaveRepository();
  private employeeRepo = new EmployeeRepository();
  private holidayRepo = new HolidayRepository();
  private attendanceRepo = new AttendanceRepository();
  private activityRepo = new ActivityRepository();
  private notifications = new NotificationService();

  // -------------------------------------------------------------------------
  // Leave types
  // -------------------------------------------------------------------------
  async getTypes(): Promise<LeaveTypeResponse[]> {
    return this.repo.findTypes();
  }

  async createType(data: CreateLeaveTypePayload, userId: number): Promise<LeaveTypeResponse> {
    const code = (data.code ?? '').trim().toUpperCase();
    const name = (data.name ?? '').trim();
    const annualQuota = Number(data.annualQuota ?? 0);

    if (!code) throw new Error('A leave type code is required');
    if (!name) throw new Error('A leave type name is required');
    if (!Number.isFinite(annualQuota) || annualQuota < 0) {
      throw new Error('Annual quota must be zero or more');
    }

    const existing = await this.repo.findTypeByCode(code);
    if (existing) throw new Error(`Leave type ${code} already exists`);

    const id = await this.repo.createType(
      { code, name, annualQuota, isPaid: data.isPaid, color: data.color },
      userId,
    );
    const created = await this.repo.findTypeById(id);
    if (!created) throw new Error('Leave type could not be created');
    return created;
  }

  async updateType(id: number, data: CreateLeaveTypePayload, userId: number): Promise<LeaveTypeResponse> {
    const existing = await this.repo.findTypeById(id);
    if (!existing) throw new Error('Leave type not found');

    const patch: CreateLeaveTypePayload = {};

    if (data.code !== undefined) {
      const code = String(data.code).trim().toUpperCase();
      if (!code) throw new Error('A leave type code is required');
      const clash = await this.repo.findTypeByCode(code);
      if (clash && clash.id !== id) throw new Error(`Leave type ${code} already exists`);
      patch.code = code;
    }
    if (data.name !== undefined) {
      const name = String(data.name).trim();
      if (!name) throw new Error('A leave type name is required');
      patch.name = name;
    }
    if (data.annualQuota !== undefined) {
      const quota = Number(data.annualQuota);
      if (!Number.isFinite(quota) || quota < 0) throw new Error('Annual quota must be zero or more');
      patch.annualQuota = quota;
    }
    if (data.isPaid !== undefined) patch.isPaid = !!data.isPaid;
    if (data.color !== undefined) patch.color = String(data.color);

    await this.repo.updateType(id, patch, userId);
    const updated = await this.repo.findTypeById(id);
    if (!updated) throw new Error('Leave type not found');
    return updated;
  }

  async deleteType(id: number, userId: number): Promise<void> {
    const existing = await this.repo.findTypeById(id);
    if (!existing) throw new Error('Leave type not found');

    const live = await this.repo.countLiveRequestsForType(id);
    if (live > 0) {
      throw new Error(
        `${existing.code} still has ${live} pending or approved request(s) and cannot be removed`,
      );
    }
    await this.repo.softDeleteType(id, userId);
  }

  // -------------------------------------------------------------------------
  // Balances
  // -------------------------------------------------------------------------
  async getBalances(year: number, employeeId?: number): Promise<LeaveBalanceResponse[]> {
    const resolved = Number.isFinite(year) && year > 1900 ? Math.floor(year) : new Date().getUTCFullYear();
    return this.repo.getBalances(resolved, employeeId);
  }

  async initYear(year: number, userId: number): Promise<{ year: number; rowsAffected: number }> {
    if (!Number.isFinite(year) || year < 2000 || year > 2999) {
      throw new Error('A valid four-digit year is required');
    }
    const rowsAffected = await this.repo.initYear(Math.floor(year), userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'LEAVE_BALANCE',
      action: 'INIT_YEAR',
      summary: `Initialised leave balances for ${year}`,
      meta: { year, rowsAffected },
    });
    return { year: Math.floor(year), rowsAffected };
  }

  // -------------------------------------------------------------------------
  // Day counting
  // -------------------------------------------------------------------------
  /** Dates in [from, to] that actually consume leave for this employee. */
  private async countableDates(employeeId: number, from: string, to: string): Promise<string[]> {
    const holidays = await this.holidayRepo.findDateSet(from, to);
    const weekOff = await this.repo.getWeekOffDay(employeeId);
    return eachDate(from, to).filter((d) => !holidays.has(d) && dayOfWeek(d) !== weekOff);
  }

  /** Working-day count for a range, excluding holidays and the shift week-off. */
  async countLeaveDays(employeeId: number, from: string, to: string): Promise<number> {
    if (!isValidDateString(from) || !isValidDateString(to)) {
      throw new Error('Both fromDate and toDate must be valid YYYY-MM-DD dates');
    }
    if (to < from) throw new Error('toDate cannot be before fromDate');
    const dates = await this.countableDates(employeeId, from, to);
    return dates.length;
  }

  // -------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------
  async listRequests(filters: LeaveRequestFilters = {}): Promise<LeaveRequestResponse[]> {
    return this.repo.findRequests(filters);
  }

  async getRequest(id: number): Promise<LeaveRequestResponse | null> {
    return this.repo.findRequestById(id);
  }

  async countPending(): Promise<number> {
    return this.repo.countPending();
  }

  async createRequest(
    payload: CreateLeaveRequestPayload,
    userId: number,
  ): Promise<LeaveRequestResponse> {
    const { employeeId, leaveTypeId } = payload;
    const fromDate = String(payload.fromDate ?? '');
    const toDate = String(payload.toDate ?? '');

    if (!employeeId) throw new Error('An employee is required');
    if (!leaveTypeId) throw new Error('A leave type is required');
    if (!isValidDateString(fromDate) || !isValidDateString(toDate)) {
      throw new Error('Both fromDate and toDate must be valid YYYY-MM-DD dates');
    }
    if (toDate < fromDate) throw new Error('toDate cannot be before fromDate');

    const employee = await this.employeeRepo.findRowById(employeeId);
    if (!employee) throw new Error('Employee not found');
    if (employee.work_status !== 'WORKING') {
      throw new Error(`${employee.full_name} is not an active employee`);
    }

    const leaveType = await this.repo.findTypeRowById(leaveTypeId);
    if (!leaveType) throw new Error('Leave type not found');

    const dates = await this.countableDates(employeeId, fromDate, toDate);
    const days = dates.length;
    if (days <= 0) throw new Error('Selected dates contain no working days');

    const overlapping = await this.repo.findOverlapping(employeeId, fromDate, toDate);
    if (overlapping.length > 0) {
      throw new Error('This employee already has a leave request covering those dates');
    }

    if (leaveType.is_paid) {
      const year = Number(fromDate.slice(0, 4));
      const balance = await this.repo.getBalanceFor(employeeId, leaveTypeId, year);
      const remaining = balance ? balance.balance : 0;
      if (remaining < days) {
        throw new Error(
          `Insufficient ${leaveType.code} balance: ${remaining} day(s) remaining, ${days} requested`,
        );
      }
    }

    const id = await this.repo.createRequest(
      {
        employeeId,
        leaveTypeId,
        fromDate,
        toDate,
        days,
        reason: payload.reason ?? null,
        appliedBySelf: !!payload.appliedBySelf,
      },
      userId,
    );

    const created = await this.repo.findRequestById(id);
    if (!created) throw new Error('Leave request could not be created');

    await this.notifications.notifyRoles(APPROVER_ROLES, {
      category: 'LEAVE',
      priority: 'NORMAL',
      title: `Leave request from ${employee.full_name}`,
      body: `${leaveType.name} (${leaveType.code}) — ${fromDate} to ${toDate}, ${days} day(s).`,
      linkPage: 'hr',
      linkRefId: id,
      createdBy: userId,
    });

    await this.activityRepo.log({
      actorUserId: userId,
      employeeId,
      entityType: 'LEAVE_REQUEST',
      entityId: id,
      action: 'CREATE',
      summary: `Applied ${leaveType.code} leave for ${employee.full_name}: ${fromDate} to ${toDate} (${days} day(s))`,
      meta: { leaveTypeId, fromDate, toDate, days, appliedBySelf: !!payload.appliedBySelf },
    });

    return created;
  }

  /**
   * Approves a request, debits the paid-leave balance and stamps LEAVE onto the
   * attendance register for every countable date — all in one transaction so a
   * half-applied approval can never be observed.
   */
  async approve(
    requestId: number,
    userId: number,
    actorName: string,
    note?: string | null,
  ): Promise<LeaveApprovalResult> {
    const outcome = await this.repo.withTransaction(async (conn) => {
      const row = await this.repo.findRequestRowForUpdate(requestId, conn);
      if (!row) throw new Error('Leave request not found');
      if (row.status !== 'PENDING') throw new Error('Only pending requests can be approved');

      const leaveType = await this.repo.findTypeRowById(row.leave_type_id, conn);
      if (!leaveType) throw new Error('Leave type not found');

      const fromDate = toDateString(row.from_date);
      const toDate = toDateString(row.to_date);
      const dates = await this.countableDates(row.employee_id, fromDate, toDate);

      // Capture clashes before we overwrite them so the caller can be warned.
      const existing = await this.repo.findNonLeaveAttendanceDates(
        row.employee_id,
        fromDate,
        toDate,
        conn,
      );
      const overwritten = dates.filter((d) => existing.has(d)).length;

      await this.repo.decide(requestId, 'APPROVED', userId, note ?? null, conn);

      if (leaveType.is_paid && dates.length > 0) {
        await this.repo.addUsed(
          row.employee_id,
          row.leave_type_id,
          Number(fromDate.slice(0, 4)),
          dates.length,
          conn,
        );
      }

      if (dates.length > 0) {
        const entries: AttendanceUpsertEntry[] = dates.map((attDate) => ({
          employeeId: row.employee_id,
          attDate,
          status: 'LEAVE',
          leaveTypeId: row.leave_type_id,
          source: 'LEAVE_SYNC',
          remarks: `Leave: ${leaveType.name}`,
        }));
        await this.attendanceRepo.bulkUpsert(entries, userId, conn);
      }

      await this.activityRepo.log(
        {
          actorUserId: userId,
          actorName,
          employeeId: row.employee_id,
          entityType: 'LEAVE_REQUEST',
          entityId: requestId,
          action: 'APPROVE',
          summary: `Approved ${leaveType.code} leave ${fromDate} to ${toDate} (${dates.length} day(s))`,
          meta: { fromDate, toDate, days: dates.length, overwritten },
        },
        conn,
      );

      return {
        employeeId: row.employee_id,
        leaveTypeName: leaveType.name,
        leaveTypeCode: leaveType.code,
        fromDate,
        toDate,
        days: dates.length,
        overwritten,
      };
    });

    await this.notifications.notifyEmployee(outcome.employeeId, {
      category: 'LEAVE',
      priority: 'NORMAL',
      title: 'Your leave request was approved',
      body: `${outcome.leaveTypeName} (${outcome.leaveTypeCode}) from ${outcome.fromDate} to ${outcome.toDate} — ${outcome.days} day(s).${note ? ` Note: ${note}` : ''}`,
      linkPage: 'hr',
      linkRefId: requestId,
      email: true,
      createdBy: userId,
    });

    const updated = await this.repo.findRequestById(requestId);
    if (!updated) throw new Error('Leave request not found');

    const result: LeaveApprovalResult = { ...updated };
    if (outcome.overwritten > 0) {
      result.warning = `${outcome.overwritten} existing attendance record(s) in this range were overwritten with LEAVE`;
    }
    return result;
  }

  async reject(
    requestId: number,
    userId: number,
    actorName: string,
    note: string,
  ): Promise<LeaveRequestResponse> {
    const reason = (note ?? '').trim();
    if (!reason) throw new Error('A rejection note is required');

    const request = await this.repo.findRequestById(requestId);
    if (!request) throw new Error('Leave request not found');
    if (request.status !== 'PENDING') throw new Error('Only pending requests can be rejected');

    await this.repo.decide(requestId, 'REJECTED', userId, reason);

    await this.notifications.notifyEmployee(request.employeeId, {
      category: 'LEAVE',
      priority: 'HIGH',
      title: 'Your leave request was rejected',
      body: `${request.leaveTypeName} (${request.leaveTypeCode}) from ${request.fromDate} to ${request.toDate}. Reason: ${reason}`,
      linkPage: 'hr',
      linkRefId: requestId,
      email: true,
      createdBy: userId,
    });

    await this.activityRepo.log({
      actorUserId: userId,
      actorName,
      employeeId: request.employeeId,
      entityType: 'LEAVE_REQUEST',
      entityId: requestId,
      action: 'REJECT',
      summary: `Rejected ${request.leaveTypeCode} leave ${request.fromDate} to ${request.toDate}`,
      meta: { note: reason },
    });

    const updated = await this.repo.findRequestById(requestId);
    if (!updated) throw new Error('Leave request not found');
    return updated;
  }

  async cancel(requestId: number, userId: number): Promise<LeaveRequestResponse> {
    const request = await this.repo.findRequestById(requestId);
    if (!request) throw new Error('Leave request not found');
    if (request.status !== 'PENDING') throw new Error('Only pending requests can be cancelled');

    await this.repo.decide(requestId, 'CANCELLED', userId, null);

    await this.activityRepo.log({
      actorUserId: userId,
      employeeId: request.employeeId,
      entityType: 'LEAVE_REQUEST',
      entityId: requestId,
      action: 'CANCEL',
      summary: `Cancelled ${request.leaveTypeCode} leave ${request.fromDate} to ${request.toDate}`,
    });

    const updated = await this.repo.findRequestById(requestId);
    if (!updated) throw new Error('Leave request not found');
    return updated;
  }
}
