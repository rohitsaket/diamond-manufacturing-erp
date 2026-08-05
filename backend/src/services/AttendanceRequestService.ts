import { AttendanceDayRepository } from '../repositories/AttendanceDayRepository';
import { AttendancePolicyRepository } from '../repositories/AttendancePolicyRepository';
import { AttendanceRequestRepository, RequestFilters } from '../repositories/AttendanceRequestRepository';
import { AttendanceAuditRepository } from '../repositories/AttendanceAuditRepository';
import { SchedulingRepository } from '../repositories/SchedulingRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { NotificationService } from './NotificationService';
import {
  ApprovalWorkflowStep, ApproverType, AttendanceRequest, AttendanceRequestType,
  AuditContext, Delegation, OvertimeRecord, Paged,
} from '../types/attendance';
import { AttendanceStatus } from '../types/hrms';
import { addDays, isValidDateString, todayString } from '../utils/dateUtils';
import { hhmmToMinutes, round2 } from '../utils/attendanceTime';

export interface CreateRequestInput {
  requestType: AttendanceRequestType;
  employeeId: number;
  attDate: string;
  toDate?: string | null;
  requestedValue?: Record<string, unknown> | null;
  requestedHours?: number | null;
  reason?: string | null;
  attachmentPath?: string | null;
  counterpartyEmployeeId?: number | null;
}

export interface DecisionInput {
  decision: 'APPROVE' | 'REJECT';
  comments?: string | null;
}

const REQUEST_TYPES: AttendanceRequestType[] = [
  'REGULARIZATION', 'MISSED_PUNCH', 'CORRECTION', 'OVERTIME', 'SHIFT_CHANGE', 'SHIFT_SWAP',
  'REMOTE_WORK', 'ON_DUTY', 'BREAK_EXTENSION', 'COMP_OFF', 'EARLY_EXIT', 'LATE_ARRIVAL',
];

/** Types that change a day once approved, so they need the window check. */
const CORRECTS_ATTENDANCE: AttendanceRequestType[] = ['REGULARIZATION', 'MISSED_PUNCH', 'CORRECTION'];

export class AttendanceRequestService {
  private repo = new AttendanceRequestRepository();
  private dayRepo = new AttendanceDayRepository();
  private policyRepo = new AttendancePolicyRepository();
  private schedRepo = new SchedulingRepository();
  private employeeRepo = new EmployeeRepository();
  private auditRepo = new AttendanceAuditRepository();
  private notifications = new NotificationService();

  // =========================================================================
  // Creation
  // =========================================================================
  async create(input: CreateRequestInput, userId: number, ctx: AuditContext = {}): Promise<AttendanceRequest> {
    if (!REQUEST_TYPES.includes(input.requestType)) {
      throw new Error(`Invalid request type "${input.requestType}". Allowed: ${REQUEST_TYPES.join(', ')}`);
    }
    if (!isValidDateString(input.attDate)) throw new Error('Invalid date');
    if (input.toDate && !isValidDateString(input.toDate)) throw new Error('Invalid end date');
    if (input.toDate && input.toDate < input.attDate) throw new Error('Invalid date range: end date is before the start date');

    const employee = await this.employeeRepo.findRowById(input.employeeId);
    if (!employee) throw new Error('Employee not found');

    const policy = await this.policyRepo.resolveForEmployee(input.employeeId, input.attDate);
    if (!policy) throw new Error('No attendance policy applies to this employee');

    // --- Type-specific rules ---------------------------------------------
    if (CORRECTS_ATTENDANCE.includes(input.requestType)) {
      if (!policy.regularizationEnabled) {
        throw new Error(`Policy "${policy.name}" does not allow attendance regularization`);
      }
      const ageDays = Math.floor(
        (Date.parse(`${todayString()}T00:00:00Z`) - Date.parse(`${input.attDate}T00:00:00Z`)) / 86400000,
      );
      if (ageDays > policy.regularizationWindowDays) {
        throw new Error(
          `${input.attDate} is ${ageDays} days ago, past the ${policy.regularizationWindowDays} day regularization window in policy "${policy.name}"`,
        );
      }
      if (ageDays < 0) throw new Error('Cannot regularize a future date');

      const used = await this.repo.countRegularizationsInMonth(input.employeeId, input.attDate.slice(0, 7));
      if (used >= policy.maxRegularizationsPerMonth) {
        throw new Error(
          `${employee.full_name} has already used ${used} of ${policy.maxRegularizationsPerMonth} regularizations allowed in ${input.attDate.slice(0, 7)}`,
        );
      }

      const day = await this.dayRepo.findDetail(input.employeeId, input.attDate);
      if (day?.isLocked) {
        throw new Error(`${input.attDate} is locked for payroll (${day.lockedReason ?? 'no reason recorded'}) and cannot be regularized`);
      }
    }

    if (input.requestType === 'OVERTIME') {
      if (!policy.otEnabled) throw new Error(`Policy "${policy.name}" does not allow overtime`);
      const hours = Number(input.requestedHours ?? 0);
      if (!Number.isFinite(hours) || hours <= 0) throw new Error('Overtime hours must be greater than zero');
      if (hours > policy.otMaxHoursPerDay) {
        throw new Error(`Policy "${policy.name}" caps overtime at ${policy.otMaxHoursPerDay} hours a day`);
      }
      const monthSoFar = await this.repo.monthlyOvertimeHours(input.employeeId, input.attDate.slice(0, 7));
      if (monthSoFar + hours > policy.otMaxHoursPerMonth) {
        throw new Error(
          `This would take ${employee.full_name} to ${round2(monthSoFar + hours)} overtime hours in ${input.attDate.slice(0, 7)}, past the ${policy.otMaxHoursPerMonth} hour monthly cap`,
        );
      }
    }

    if (input.requestType === 'SHIFT_SWAP') {
      if (!input.counterpartyEmployeeId) throw new Error('A colleague to swap with is required');
      if (input.counterpartyEmployeeId === input.employeeId) throw new Error('Cannot swap a shift with yourself');
      const other = await this.employeeRepo.findRowById(input.counterpartyEmployeeId);
      if (!other) throw new Error('The colleague named for the swap was not found');
    }

    if (input.requestType === 'REMOTE_WORK' && !policy.allowRemotePunch) {
      throw new Error(`Policy "${policy.name}" does not allow remote working`);
    }

    const duplicate = await this.repo.findDuplicate(input.employeeId, input.requestType, input.attDate);
    if (duplicate) {
      throw new Error(`An open ${input.requestType.toLowerCase().replace('_', ' ')} request already exists for ${input.attDate}`);
    }

    // --- Build the approval chain ----------------------------------------
    const steps = await this.resolveWorkflow(input.requestType, employee);
    const totalLevels = Math.max(1, steps.length);
    const firstSla = steps[0]?.slaHours ?? 48;
    const dueAt = new Date(Date.now() + firstSla * 3600000);

    const day = CORRECTS_ATTENDANCE.includes(input.requestType)
      ? await this.dayRepo.findDetail(input.employeeId, input.attDate)
      : null;

    const requestNo = await this.repo.nextRequestNo(Number(input.attDate.slice(0, 4)));

    const id = await this.repo.create({
      requestNo,
      requestType: input.requestType,
      employeeId: input.employeeId,
      attDate: input.attDate,
      toDate: input.toDate ?? null,
      attendanceId: day?.id ?? null,
      currentValue: day
        ? { status: day.status, inTime: day.inTime, outTime: day.outTime, workMode: day.workMode, otHours: day.otHours }
        : null,
      requestedValue: input.requestedValue ?? null,
      requestedHours: input.requestedHours ?? null,
      reason: input.reason ?? null,
      attachmentPath: input.attachmentPath ?? null,
      counterpartyEmployeeId: input.counterpartyEmployeeId ?? null,
      counterpartyResponse: input.requestType === 'SHIFT_SWAP' ? 'PENDING' : 'NOT_REQUIRED',
      status: 'PENDING',
      currentLevel: 1,
      totalLevels,
      dueAt: dueAt as any,
      companyId: employee.company_id ?? null,
      branchId: employee.branch_id ?? null,
      departmentId: employee.department_id ?? null,
      raisedBy: userId,
    } as any);

    await this.repo.createApprovals(
      id,
      await Promise.all(steps.map(async (step, index) => ({
        level: step.level || index + 1,
        approverType: step.approverType,
        approverEmployeeId: await this.resolveApprover(step, employee, input.requestType, input.attDate),
        approverRole: step.approverRole,
        dueAt: new Date(Date.now() + (step.slaHours ?? 48) * 3600000),
        delegatedFrom: null,
      }))),
    );

    await this.applyDelegations(id, input.requestType, input.attDate);

    await this.auditRepo.log({
      entityType: 'REQUEST', entityId: id, employeeId: input.employeeId, attDate: input.attDate,
      action: 'CREATE',
      summary: `${employee.full_name} raised ${requestNo} (${input.requestType}) for ${input.attDate}`,
      newValue: input.requestedValue ?? { hours: input.requestedHours },
      context: { ...ctx, userId },
    });

    await this.notifyApprovers(id, `${employee.full_name} raised ${input.requestType.replace('_', ' ').toLowerCase()} request ${requestNo}`);

    const created = await this.repo.findById(id);
    if (!created) throw new Error('Request not found after creation');
    return created;
  }

  // =========================================================================
  // Decisions
  // =========================================================================
  async decide(requestId: number, input: DecisionInput, userId: number, ctx: AuditContext = {}): Promise<AttendanceRequest> {
    const request = await this.repo.findById(requestId);
    if (!request) throw new Error('Request not found');
    if (request.status !== 'PENDING' && request.status !== 'ESCALATED') {
      throw new Error(`Request ${request.requestNo} is already ${request.status.toLowerCase()} and cannot be decided again`);
    }
    if (request.requestType === 'SHIFT_SWAP' && request.counterpartyResponse === 'PENDING') {
      throw new Error(`${request.counterpartyName ?? 'The other employee'} has not accepted the swap yet`);
    }
    if (request.requestType === 'SHIFT_SWAP' && request.counterpartyResponse === 'DECLINED') {
      throw new Error('The other employee declined the swap');
    }

    const level = request.currentLevel;
    const step = await this.repo.findPendingStep(requestId, level);
    if (!step) throw new Error(`No approval step is waiting at level ${level}`);
    if (step.decision !== 'PENDING') throw new Error(`Level ${level} has already been decided`);

    if (input.decision === 'REJECT') {
      await this.repo.recordDecision(requestId, level, 'REJECTED', userId, input.comments ?? null);
      await this.repo.updateStatus(requestId, 'REJECTED', level, input.comments ?? null);
      await this.auditRepo.log({
        entityType: 'REQUEST', entityId: requestId, employeeId: request.employeeId, attDate: request.attDate,
        action: 'REJECT', summary: `${request.requestNo} rejected at level ${level}`,
        newValue: { level, comments: input.comments ?? null }, context: { ...ctx, userId },
      });
      await this.notifyEmployee(request, `Your request ${request.requestNo} was rejected`);
      return (await this.repo.findById(requestId))!;
    }

    await this.repo.recordDecision(requestId, level, 'APPROVED', userId, input.comments ?? null);

    if (level < request.totalLevels) {
      await this.repo.updateStatus(requestId, 'PENDING', level + 1, input.comments ?? null);
      await this.auditRepo.log({
        entityType: 'REQUEST', entityId: requestId, employeeId: request.employeeId, attDate: request.attDate,
        action: 'APPROVE_LEVEL',
        summary: `${request.requestNo} cleared level ${level} of ${request.totalLevels}`,
        context: { ...ctx, userId },
      });
      await this.notifyApprovers(requestId, `${request.requestNo} needs your approval at level ${level + 1}`);
      return (await this.repo.findById(requestId))!;
    }

    // Final level: approve, then apply.
    await this.repo.updateStatus(requestId, 'APPROVED', level, input.comments ?? null);
    const applied = await this.apply(requestId, userId);

    await this.auditRepo.log({
      entityType: 'REQUEST', entityId: requestId, employeeId: request.employeeId, attDate: request.attDate,
      action: 'APPROVE',
      summary: `${request.requestNo} approved and ${applied ? 'applied' : 'recorded'}`,
      context: { ...ctx, userId },
    });
    await this.notifyEmployee(request, `Your request ${request.requestNo} was approved`);

    return (await this.repo.findById(requestId))!;
  }

  /**
   * Apply an approved request to the underlying data.
   *
   * Returns false when a request type is approved but has nothing to write --
   * the caller reports that honestly rather than implying a change was made.
   */
  private async apply(requestId: number, userId: number): Promise<boolean> {
    const request = await this.repo.findById(requestId);
    if (!request) return false;

    switch (request.requestType) {
      case 'REGULARIZATION':
      case 'MISSED_PUNCH':
      case 'CORRECTION':
      case 'LATE_ARRIVAL':
      case 'EARLY_EXIT': {
        const value = (request.requestedValue ?? {}) as Record<string, any>;
        const attendanceId = request.attendanceId
          ?? (await this.dayRepo.ensureDay(request.employeeId, request.attDate, userId));

        const patch: Record<string, any> = {};
        if (value.status) patch.status = value.status as AttendanceStatus;
        if (value.inTime !== undefined) patch.inTime = value.inTime;
        if (value.outTime !== undefined) patch.outTime = value.outTime;
        if (value.workMode) patch.workMode = value.workMode;
        if (value.remarks) patch.remarks = value.remarks;

        // Recompute worked hours from the corrected pair rather than trusting
        // whatever the requester typed.
        if (patch.inTime && patch.outTime) {
          const inMin = hhmmToMinutes(patch.inTime);
          const outMin = hhmmToMinutes(patch.outTime);
          if (inMin !== null && outMin !== null && outMin > inMin) {
            const day = await this.dayRepo.findDetail(request.employeeId, request.attDate);
            const breakMinutes = day?.breakMinutes ?? 60;
            patch.workedHours = round2(Math.max(0, (outMin - inMin - breakMinutes) / 60));
          }
        }

        await this.dayRepo.applyCorrection(attendanceId, patch, requestId, userId);
        await this.repo.markApplied(requestId);
        return true;
      }

      case 'OVERTIME': {
        const hours = Number(request.requestedHours ?? 0);
        const employee = await this.employeeRepo.findRowById(request.employeeId);
        const policy = await this.policyRepo.resolveForEmployee(request.employeeId, request.attDate);
        const day = await this.dayRepo.findDetail(request.employeeId, request.attDate);

        const otType = day?.otType && day.otType !== 'NONE' ? day.otType : 'WEEKDAY';
        const multiplier = policy
          ? (otType === 'HOLIDAY' ? policy.otMultiplierHoliday
            : otType === 'WEEK_OFF' ? policy.otMultiplierWeekoff
              : otType === 'NIGHT' ? policy.otMultiplierNight
                : policy.otMultiplierWeekday)
          : 1;

        await this.repo.upsertOvertime({
          employeeId: request.employeeId,
          attDate: request.attDate,
          attendanceId: day?.id ?? null,
          requestId,
          otType,
          derivedHours: day?.otHours ?? 0,
          requestedHours: hours,
          approvedHours: hours,
          multiplier,
          status: 'APPROVED',
          reason: request.reason,
          approvedBy: userId,
          companyId: employee?.company_id ?? null,
          branchId: employee?.branch_id ?? null,
          departmentId: employee?.department_id ?? null,
          userId,
        });
        await this.dayRepo.setOvertimeDecision(request.employeeId, request.attDate, hours, 'APPROVED', userId);
        await this.repo.markApplied(requestId);
        return true;
      }

      case 'SHIFT_CHANGE': {
        const value = (request.requestedValue ?? {}) as Record<string, any>;
        const shiftId = Number(value.shiftId);
        if (!Number.isFinite(shiftId)) return false;
        await this.schedRepo.closeOpenAssignments(request.employeeId, request.attDate);
        await this.schedRepo.createAssignment({
          employeeId: request.employeeId,
          shiftId,
          effectiveFrom: request.attDate,
          effectiveTo: request.toDate ?? null,
          isPrimary: true,
          assignmentReason: `Approved shift change ${request.requestNo}`,
          ...( { requestId } as any),
        }, userId);
        await this.repo.markApplied(requestId);
        return true;
      }

      case 'SHIFT_SWAP': {
        const value = (request.requestedValue ?? {}) as Record<string, any>;
        if (value.entryIdA && value.entryIdB) {
          await this.schedRepo.swapRosterEntries(Number(value.entryIdA), Number(value.entryIdB));
          await this.repo.markApplied(requestId);
          return true;
        }
        // Without roster entries there is nothing to move, so the approval is
        // recorded as a decision only and says so.
        await this.repo.updateStatus(
          requestId, 'APPROVED', request.currentLevel,
          'Approved. No published roster entries were supplied, so no shift was moved automatically.',
        );
        return false;
      }

      case 'REMOTE_WORK':
      case 'ON_DUTY': {
        const mode = request.requestType === 'REMOTE_WORK' ? 'REMOTE' : 'BUSINESS_TRAVEL';
        const last = request.toDate ?? request.attDate;
        for (let date = request.attDate; date <= last; date = addDays(date, 1)) {
          const attendanceId = await this.dayRepo.ensureDay(request.employeeId, date, userId);
          await this.dayRepo.applyCorrection(attendanceId, { workMode: mode as any }, requestId, userId);
        }
        await this.repo.markApplied(requestId);
        return true;
      }

      case 'COMP_OFF':
      case 'BREAK_EXTENSION':
      default:
        // Recorded as an approved decision. Compensatory off draws on the leave
        // module's balances, which this module does not own, so granting one
        // here would create a balance nothing else knows about.
        await this.repo.updateStatus(
          requestId, 'APPROVED', request.currentLevel,
          `Approved and recorded. ${request.requestType === 'COMP_OFF'
            ? 'Credit the compensatory day in the leave module -- attendance does not hold leave balances.'
            : 'No attendance record was changed by this request type.'}`,
        );
        return false;
    }
  }

  async cancel(requestId: number, userId: number, ctx: AuditContext = {}): Promise<AttendanceRequest> {
    const request = await this.repo.findById(requestId);
    if (!request) throw new Error('Request not found');
    if (request.status === 'APPLIED') throw new Error('This request has already been applied and cannot be cancelled');
    if (request.status === 'CANCELLED') throw new Error('This request is already cancelled');

    await this.repo.updateStatus(requestId, 'CANCELLED', request.currentLevel, 'Cancelled by the requester');
    await this.auditRepo.log({
      entityType: 'REQUEST', entityId: requestId, employeeId: request.employeeId, attDate: request.attDate,
      action: 'CANCEL', summary: `${request.requestNo} cancelled`, context: { ...ctx, userId },
    });
    return (await this.repo.findById(requestId))!;
  }

  async respondToSwap(requestId: number, accept: boolean, employeeId: number): Promise<AttendanceRequest> {
    const request = await this.repo.findById(requestId);
    if (!request) throw new Error('Request not found');
    if (request.requestType !== 'SHIFT_SWAP') throw new Error('This request is not a shift swap');
    if (request.counterpartyEmployeeId !== employeeId) {
      throw new Error('Only the colleague named in the swap can respond to it');
    }
    if (request.counterpartyResponse !== 'PENDING') {
      throw new Error(`The swap was already ${request.counterpartyResponse.toLowerCase()}`);
    }

    await this.repo.setCounterpartyResponse(requestId, accept ? 'ACCEPTED' : 'DECLINED');
    if (!accept) {
      await this.repo.updateStatus(requestId, 'REJECTED', request.currentLevel, 'Declined by the other employee');
    }
    return (await this.repo.findById(requestId))!;
  }

  // =========================================================================
  // Escalation
  // =========================================================================
  /**
   * Move requests past their SLA to the next approver.
   *
   * Escalation adds an approver rather than skipping one: the original level
   * stays open and is marked escalated, so nothing is auto-approved by the
   * passage of time unless a workflow explicitly asks for that.
   */
  async runEscalations(userId: number): Promise<{ escalated: number; autoApproved: number; details: string[] }> {
    const overdue = await this.repo.findOverdueForEscalation();
    const details: string[] = [];
    let escalated = 0;
    let autoApproved = 0;

    for (const item of overdue) {
      const request = await this.repo.findById(item.requestId);
      if (!request) continue;

      const employee = await this.employeeRepo.findRowById(request.employeeId);
      if (!employee) continue;

      const steps = await this.resolveWorkflow(request.requestType, employee);
      const step = steps.find((s) => s.level === item.level);
      if (!step) continue;

      if (step.autoApproveAfterHours) {
        const dueMs = request.dueAt ? Date.parse(request.dueAt) : Date.now();
        if (Date.now() - dueMs >= step.autoApproveAfterHours * 3600000) {
          await this.repo.recordDecision(item.requestId, item.level, 'AUTO_APPROVED', userId,
            `Auto-approved: no decision within ${step.autoApproveAfterHours} hours of the SLA.`);
          if (item.level < request.totalLevels) {
            await this.repo.updateStatus(item.requestId, 'PENDING', item.level + 1, null);
          } else {
            await this.repo.updateStatus(item.requestId, 'APPROVED', item.level, 'Auto-approved after SLA breach');
            await this.apply(item.requestId, userId);
          }
          autoApproved += 1;
          details.push(`${request.requestNo} auto-approved at level ${item.level}`);
          continue;
        }
      }

      if (!step.autoEscalate) continue;

      const escalateTo = await this.resolveEscalationTarget(step, employee);
      await this.repo.markEscalated(item.approvalId, escalateTo);
      await this.repo.updateStatus(item.requestId, 'ESCALATED', item.level,
        `Escalated: no decision within the ${step.slaHours} hour SLA.`);

      if (escalateTo) {
        await this.notifications.notifyEmployee(escalateTo, {
          category: 'ATTENDANCE',
          priority: 'HIGH',
          title: `Escalated: ${request.requestNo}`,
          body: `${request.employeeName}'s ${request.requestType.replace('_', ' ').toLowerCase()} request for ${request.attDate} passed its ${step.slaHours} hour SLA and has been escalated to you.`,
        }).catch(() => undefined);
      }

      escalated += 1;
      details.push(`${request.requestNo} escalated from level ${item.level}`);
    }

    return { escalated, autoApproved, details };
  }

  // =========================================================================
  // Reads
  // =========================================================================
  async list(filters: RequestFilters): Promise<Paged<AttendanceRequest>> {
    return this.repo.list(filters);
  }

  async findById(id: number): Promise<AttendanceRequest> {
    const request = await this.repo.findById(id);
    if (!request) throw new Error('Request not found');
    return request;
  }

  async summary(from?: string, to?: string): Promise<Record<string, number>> {
    return this.repo.countByStatus(from, to);
  }

  async listOvertime(filters: { from?: string; to?: string; employeeId?: number; status?: string; page?: number; pageSize?: number }): Promise<Paged<OvertimeRecord>> {
    return this.repo.listOvertime(filters);
  }

  async decideOvertime(
    employeeId: number,
    attDate: string,
    approvedHours: number,
    approve: boolean,
    userId: number,
    ctx: AuditContext = {},
  ): Promise<{ employeeId: number; attDate: string; approvedHours: number; status: string }> {
    if (!isValidDateString(attDate)) throw new Error('Invalid date');
    const day = await this.dayRepo.findDetail(employeeId, attDate);
    if (!day) throw new Error('No attendance record exists for that day');
    if (day.isLocked) throw new Error(`${attDate} is locked for payroll and its overtime cannot be changed`);

    const hours = approve ? round2(Number(approvedHours)) : 0;
    if (approve && (!Number.isFinite(hours) || hours < 0)) throw new Error('Approved hours must be zero or more');
    if (approve && hours > day.otHours) {
      throw new Error(`Cannot approve ${hours} hours when only ${day.otHours} were derived from the punches`);
    }

    const policy = await this.policyRepo.resolveForEmployee(employeeId, attDate);
    const employee = await this.employeeRepo.findRowById(employeeId);
    const otType = day.otType === 'NONE' ? 'WEEKDAY' : day.otType;
    const multiplier = policy
      ? (otType === 'HOLIDAY' ? policy.otMultiplierHoliday
        : otType === 'WEEK_OFF' ? policy.otMultiplierWeekoff
          : otType === 'NIGHT' ? policy.otMultiplierNight
            : policy.otMultiplierWeekday)
      : 1;

    await this.repo.upsertOvertime({
      employeeId, attDate, attendanceId: day.id, otType,
      derivedHours: day.otHours, requestedHours: day.otHours, approvedHours: hours,
      multiplier, status: approve ? 'APPROVED' : 'REJECTED', approvedBy: userId,
      companyId: employee?.company_id ?? null, branchId: employee?.branch_id ?? null,
      departmentId: employee?.department_id ?? null, userId,
    });
    await this.dayRepo.setOvertimeDecision(employeeId, attDate, hours, approve ? 'APPROVED' : 'REJECTED', userId);

    await this.auditRepo.log({
      entityType: 'OVERTIME', employeeId, attDate,
      action: approve ? 'APPROVE' : 'REJECT',
      summary: `${approve ? 'Approved' : 'Rejected'} overtime for ${day.employeeName} on ${attDate}`,
      previousValue: { approvedHours: day.otApprovedHours, status: day.otStatus },
      newValue: { approvedHours: hours, status: approve ? 'APPROVED' : 'REJECTED' },
      context: { ...ctx, userId },
    });

    return { employeeId, attDate, approvedHours: hours, status: approve ? 'APPROVED' : 'REJECTED' };
  }

  // -------------------------------------------------------------------------
  // Workflow configuration
  // -------------------------------------------------------------------------
  async listWorkflows(requestType?: AttendanceRequestType): Promise<ApprovalWorkflowStep[]> {
    return this.repo.listWorkflows(requestType);
  }

  async createWorkflowStep(data: Partial<ApprovalWorkflowStep>, userId: number): Promise<ApprovalWorkflowStep[]> {
    if (!data.requestType || !REQUEST_TYPES.includes(data.requestType)) throw new Error('A valid request type is required');
    if (!data.approverType) throw new Error('An approver type is required');
    if (data.approverType === 'SPECIFIC_EMPLOYEE' && !data.approverEmployeeId) {
      throw new Error('A specific approver requires an employee');
    }
    await this.repo.createWorkflowStep(data, userId);
    return this.repo.listWorkflows(data.requestType);
  }

  async deleteWorkflowStep(id: number): Promise<{ success: true }> {
    await this.repo.deleteWorkflowStep(id);
    return { success: true };
  }

  async listDelegations(employeeId?: number): Promise<Delegation[]> {
    return this.repo.listDelegations(employeeId);
  }

  async createDelegation(data: Partial<Delegation>, userId: number, ctx: AuditContext = {}): Promise<Delegation[]> {
    if (!data.fromEmployeeId || !data.toEmployeeId) throw new Error('Both the delegating and covering employees are required');
    if (data.fromEmployeeId === data.toEmployeeId) throw new Error('Cannot delegate approvals to yourself');
    if (!data.fromDate || !data.toDate) throw new Error('A delegation needs a start and end date');
    if (data.toDate < data.fromDate) throw new Error('The delegation end date is before its start date');

    await this.repo.createDelegation(data, userId);
    await this.auditRepo.log({
      entityType: 'APPROVAL', employeeId: data.fromEmployeeId, action: 'DELEGATE',
      summary: `Approvals delegated from employee ${data.fromEmployeeId} to ${data.toEmployeeId} for ${data.fromDate} to ${data.toDate}`,
      context: { ...ctx, userId },
    });
    return this.repo.listDelegations(data.fromEmployeeId);
  }

  async cancelDelegation(id: number): Promise<{ success: true }> {
    await this.repo.cancelDelegation(id);
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  private async resolveWorkflow(requestType: AttendanceRequestType, employee: any): Promise<ApprovalWorkflowStep[]> {
    const steps = await this.repo.findWorkflow(
      requestType,
      employee.company_id ?? null,
      employee.branch_id ?? null,
      employee.department_id ?? null,
    );
    if (steps.length) return steps;

    // No workflow configured: fall back to a single manager approval so a
    // request is never created with an empty chain that nobody can act on.
    return [{
      id: 0, requestType, companyId: null, branchId: null, departmentId: null, level: 1,
      approverType: 'REPORTING_MANAGER' as ApproverType, approverEmployeeId: null,
      approverRole: null, isMandatory: true, slaHours: 48, autoEscalate: false,
      escalateToType: null, escalateToEmployeeId: null, autoApproveAfterHours: null, status: 'ACTIVE',
    }];
  }

  /**
   * Turn an approver *type* into an actual person.
   * Returns null for role-based steps (HR, ADMIN) -- those are answered by
   * whoever holds the role rather than one named individual.
   */
  private async resolveApprover(
    step: ApprovalWorkflowStep,
    employee: any,
    _requestType: AttendanceRequestType,
    _date: string,
  ): Promise<number | null> {
    switch (step.approverType) {
      case 'SPECIFIC_EMPLOYEE':
        return step.approverEmployeeId;
      case 'REPORTING_MANAGER':
        return employee.reporting_manager_id ?? null;
      case 'DEPARTMENT_HEAD': {
        if (!employee.department_id) return null;
        const rows = await (this.employeeRepo as any).query(
          'SELECT head_employee_id FROM departments WHERE id = ? LIMIT 1', [employee.department_id],
        );
        return rows?.[0]?.head_employee_id ?? null;
      }
      case 'BRANCH_MANAGER': {
        if (!employee.branch_id) return null;
        const rows = await (this.employeeRepo as any).query(
          'SELECT manager_employee_id FROM branches WHERE id = ? LIMIT 1', [employee.branch_id],
        );
        return rows?.[0]?.manager_employee_id ?? null;
      }
      default:
        return null;
    }
  }

  private async resolveEscalationTarget(step: ApprovalWorkflowStep, employee: any): Promise<number | null> {
    switch (step.escalateToType) {
      case 'SPECIFIC_EMPLOYEE': return step.escalateToEmployeeId;
      case 'DEPARTMENT_HEAD': {
        if (!employee.department_id) return null;
        const rows = await (this.employeeRepo as any).query(
          'SELECT head_employee_id FROM departments WHERE id = ? LIMIT 1', [employee.department_id],
        );
        return rows?.[0]?.head_employee_id ?? null;
      }
      default: return null;
    }
  }

  /** Redirect any step whose approver is away onto their stand-in. */
  private async applyDelegations(requestId: number, requestType: AttendanceRequestType, date: string): Promise<void> {
    const approvals = await this.repo.listApprovals(requestId);
    for (const approval of approvals) {
      if (!approval.approverEmployeeId) continue;
      const delegate = await this.repo.findActiveDelegate(approval.approverEmployeeId, requestType, date);
      if (!delegate) continue;
      await this.repo.createApprovals(requestId, [{
        level: approval.level,
        approverType: approval.approverType,
        approverEmployeeId: delegate,
        approverRole: approval.approverRole,
        dueAt: approval.dueAt ? new Date(approval.dueAt) : null,
        delegatedFrom: approval.approverEmployeeId,
      }]);
    }
  }

  private async notifyApprovers(requestId: number, message: string): Promise<void> {
    const approvals = await this.repo.listApprovals(requestId);
    const request = await this.repo.findById(requestId);
    if (!request) return;
    const pending = approvals.filter((a) => a.level === request.currentLevel && a.decision === 'PENDING');

    for (const approval of pending) {
      if (!approval.approverEmployeeId) continue;
      await this.notifications.notifyEmployee(approval.approverEmployeeId, {
        category: 'ATTENDANCE',
        priority: 'NORMAL',
        title: 'Attendance approval needed',
        body: message,
      }).catch(() => undefined);
    }
  }

  private async notifyEmployee(request: AttendanceRequest, message: string): Promise<void> {
    await this.notifications.notifyEmployee(request.employeeId, {
      category: 'ATTENDANCE',
      priority: 'NORMAL',
      title: 'Attendance request update',
      body: message,
    }).catch(() => undefined);
  }
}
