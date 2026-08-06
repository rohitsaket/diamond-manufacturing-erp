import { SeparationFilters, SeparationRepository } from '../repositories/SeparationRepository';
import {
  NoticeRuleResponse,
  SeparationEventResponse,
  SeparationProgress,
  SeparationResponse,
  SeparationStatus,
  SeparationType,
} from '../types/offboarding';
import { PerfActionContext } from '../types/performance';
import { addDays, isValidDateString, round2, toDateString, todayString } from '../utils/dateUtils';
import { ExitAuditService } from './ExitAuditService';
import { NotificationService } from './NotificationService';

/** Who is acting: staff can touch any case, ESS users only their own. */
export interface OffboardingActor extends PerfActionContext {
  employeeId: number | null;
}

const SEPARATION_TYPES = new Set<SeparationType>([
  'RESIGNATION', 'RETIREMENT', 'TERMINATION', 'LAYOFF', 'CONTRACT_END',
  'ABSCONDING', 'DEATH_IN_SERVICE', 'MUTUAL', 'ENTITY_TRANSFER',
]);
const TERMINAL_STATUSES = new Set<SeparationStatus>(['REJECTED', 'WITHDRAWN', 'COMPLETED', 'CANCELLED']);
const EDITABLE_STATUSES = new Set<SeparationStatus>(['DRAFT', 'PENDING_APPROVAL']);
const COMPLETABLE_STATUSES = new Set<SeparationStatus>(['IN_NOTICE', 'CLEARANCE', 'SETTLEMENT']);
const WORKER_TYPES = new Set(['PIECE_RATE', 'DHAR', 'MAXI']);

/** Event name that marks a survey submission on the case without linking the answers. */
export const SURVEY_SUBMITTED_EVENT = 'SURVEY_SUBMITTED';

/**
 * Default clearance checklist a diamond factory runs on every exit. Every
 * department gets 2-4 concrete tasks; HR can add more per case afterwards.
 */
const DEFAULT_CLEARANCES: { department: string; tasks: string[] }[] = [
  { department: 'HR', tasks: [
    'Schedule HR exit interview',
    'Verify leave balance for encashment in F&F',
    'Collect signed resignation acceptance acknowledgement',
  ] },
  { department: 'IT', tasks: [
    'Deactivate HRMS login',
    'Remove from device/face enrollment',
    'Collect email/WhatsApp group removals',
  ] },
  { department: 'FINANCE', tasks: [
    'Verify advances and loans recovered in F&F',
    'Close expense claims',
    'Confirm pending lot/piece-rate earnings posted to settlement',
  ] },
  { department: 'ADMIN', tasks: [
    'Collect locker key and uniform',
    'Cancel canteen and transport enrolment',
  ] },
  { department: 'SECURITY', tasks: [
    'Collect gate pass and ID card',
    'Remove from visitor escort list',
    'Surrender factory floor access tokens',
  ] },
  { department: 'MANAGER', tasks: [
    'Confirm lot handover complete',
    'Confirm KT plan approved',
    'Sign off pending quality checks on assigned stones',
  ] },
  { department: 'PROJECT', tasks: [
    'Reassign open lots and jobs to other workers',
    'Hand over work-in-progress documentation',
  ] },
  { department: 'FACILITY', tasks: [
    'Return issued tools, tang and loupe sets',
    'Vacate and inspect assigned workstation/bench',
  ] },
  { department: 'LEGAL', tasks: [
    'Confirm NDA and non-solicitation acknowledgement on file',
    'Verify no pending disputes or disciplinary actions',
  ] },
];

/**
 * Access checklist generated per case. is_internal entries are things this
 * HRMS can revoke itself; the rest are recorded manual steps.
 */
const ACCESS_CATALOG: { systemName: string; isInternal: boolean }[] = [
  { systemName: 'HRMS Login', isInternal: true },
  { systemName: 'Attendance device / face enrollment', isInternal: true },
  { systemName: 'Email account', isInternal: false },
  { systemName: 'WhatsApp work groups', isInternal: false },
  { systemName: 'Factory gate pass', isInternal: false },
  { systemName: 'Bank mandate for payouts', isInternal: false },
];

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function dateOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return toDateString(value);
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return Number(value);
}

/** Whole days from a to b (positive when b is after a). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function toSeparationResponse(row: any): SeparationResponse {
  return {
    id: row.id,
    sepCode: row.sep_code,
    employeeId: row.employee_id,
    employeeName: row.employee_name ?? null,
    empCode: row.emp_code ?? null,
    grade: row.grade ?? null,
    workerType: row.worker_type ?? null,
    departmentName: row.department_name ?? null,
    separationType: row.separation_type,
    status: row.status,
    reason: row.reason ?? null,
    resignationDate: dateOrNull(row.resignation_date),
    noticeDays: numOrNull(row.notice_days),
    noticeStart: dateOrNull(row.notice_start),
    noticeEnd: dateOrNull(row.notice_end),
    lastWorkingDay: dateOrNull(row.last_working_day),
    earlyReleaseRequested: !!row.early_release_requested,
    earlyReleaseDate: dateOrNull(row.early_release_date),
    earlyReleaseReason: row.early_release_reason ?? null,
    noticeBuyoutDays: numOrNull(row.notice_buyout_days),
    noticeBuyoutAmount: numOrNull(row.notice_buyout_amount),
    noticeWaived: !!row.notice_waived,
    noticeWaiverReason: row.notice_waiver_reason ?? null,
    gardenLeave: !!row.garden_leave,
    managerReviewedAt: isoOrNull(row.manager_reviewed_at),
    managerNote: row.manager_note ?? null,
    hrReviewedAt: isoOrNull(row.hr_reviewed_at),
    hrNote: row.hr_note ?? null,
    approvedBy: row.approved_by ?? null,
    approvedAt: isoOrNull(row.approved_at),
    rejectionReason: row.rejection_reason ?? null,
    withdrawnAt: isoOrNull(row.withdrawn_at),
    withdrawReason: row.withdraw_reason ?? null,
    rehireEligible: row.rehire_eligible === null || row.rehire_eligible === undefined ? null : !!row.rehire_eligible,
    rehireNote: row.rehire_note ?? null,
    completedAt: isoOrNull(row.completed_at),
    createdAt: isoOrNull(row.created_at) ?? '',
  };
}

export function toEventResponse(row: any): SeparationEventResponse {
  return {
    id: row.id,
    separationId: row.separation_id,
    event: row.event,
    note: row.note ?? null,
    createdBy: row.created_by ?? null,
    actorName: row.actor_name ?? null,
    createdAt: isoOrNull(row.created_at) ?? '',
  };
}

export function toNoticeRuleResponse(row: any): NoticeRuleResponse {
  return {
    id: row.id,
    workerType: row.worker_type ?? null,
    grade: row.grade ?? null,
    noticeDays: Number(row.notice_days),
    buyoutAllowed: !!row.buyout_allowed,
    buyoutRateBasis: row.buyout_rate_basis,
    description: row.description ?? null,
    isActive: !!row.is_active,
  };
}

/**
 * The separation lifecycle: ESS resignation intake, staff-opened cases,
 * reviews, the approval that fans out every offboarding leg, notice
 * management (early release, buyout, waiver, garden leave) and the guarded
 * completion that closes the employee record.
 */
export class SeparationService {
  private repo = new SeparationRepository();
  private audit = new ExitAuditService();
  private notifications = new NotificationService();

  // ==========================================================================
  // ESS: my resignation / my case
  // ==========================================================================

  async createResignation(
    actor: OffboardingActor,
    input: { reason?: string; resignationDate?: string; draft?: boolean },
  ): Promise<SeparationResponse> {
    const employeeId = this.mustBeLinked(actor);
    if (!input?.reason || !String(input.reason).trim()) throw new Error('A resignation reason is required');
    const resignationDate = input.resignationDate ? String(input.resignationDate) : todayString();
    if (!isValidDateString(resignationDate)) throw new Error('resignationDate must be a valid YYYY-MM-DD date');

    const active = await this.repo.findActiveByEmployee(employeeId);
    if (active) {
      throw new Error(`An active separation case already exists for this employee (${active.sep_code}, ${active.status})`);
    }

    const employee = await this.mustFindEmployee(employeeId);
    const notice = await this.computeNotice(employee);
    const status: SeparationStatus = input.draft === true ? 'DRAFT' : 'PENDING_APPROVAL';
    const sepCode = await this.repo.nextSepCode(new Date().getFullYear());

    const id = await this.repo.insert({
      sep_code: sepCode,
      employee_id: employeeId,
      separation_type: 'RESIGNATION',
      status,
      reason: String(input.reason).trim(),
      resignation_date: resignationDate,
      notice_days: notice.noticeDays,
      notice_start: notice.noticeStart,
      notice_end: notice.noticeEnd,
      last_working_day: notice.noticeEnd,
      created_by: actor.userId,
    });

    if (status === 'DRAFT') {
      await this.repo.insertEvent(id, 'DRAFT_CREATED', 'Resignation saved as draft.', actor.userId);
    } else {
      await this.repo.insertEvent(
        id, 'SUBMITTED',
        `Resignation submitted; ${notice.noticeDays}-day notice runs ${notice.noticeStart} to ${notice.noticeEnd}.`,
        actor.userId,
      );
      await this.safeNotifyRoles(
        ['admin', 'hr'],
        `Resignation submitted: ${employee.full_name}`,
        `${employee.full_name} (${employee.emp_code}) submitted a resignation (${sepCode}). Notice runs ${notice.noticeStart} to ${notice.noticeEnd}.`,
        id,
      );
    }

    const created = await this.get(id);
    await this.audit.record('SEPARATION', id, 'CREATE', actor, null, created);
    return created;
  }

  async submitMyResignation(actor: OffboardingActor): Promise<SeparationResponse> {
    const employeeId = this.mustBeLinked(actor);
    const row = await this.repo.findActiveByEmployee(employeeId);
    if (!row) throw new Error('No separation case was found for this employee');
    if (row.status !== 'DRAFT') {
      throw new Error(`Only a DRAFT resignation can be submitted (this case is ${row.status})`);
    }

    // Dates are recomputed at submission: the notice clock starts now, not
    // when the draft was parked.
    const employee = await this.mustFindEmployee(employeeId);
    const notice = await this.computeNotice(employee);
    await this.repo.update(row.id, {
      status: 'PENDING_APPROVAL',
      notice_days: notice.noticeDays,
      notice_start: notice.noticeStart,
      notice_end: notice.noticeEnd,
      last_working_day: notice.noticeEnd,
    });
    await this.repo.insertEvent(
      row.id, 'SUBMITTED',
      `Resignation submitted; ${notice.noticeDays}-day notice runs ${notice.noticeStart} to ${notice.noticeEnd}.`,
      actor.userId,
    );
    await this.safeNotifyRoles(
      ['admin', 'hr'],
      `Resignation submitted: ${employee.full_name}`,
      `${employee.full_name} (${employee.emp_code}) submitted resignation ${row.sep_code}.`,
      row.id,
    );
    const after = await this.get(row.id);
    await this.audit.record('SEPARATION', row.id, 'SUBMIT', actor, { status: row.status }, { status: 'PENDING_APPROVAL' });
    return after;
  }

  async withdrawMyResignation(actor: OffboardingActor, reason: string): Promise<SeparationResponse> {
    const employeeId = this.mustBeLinked(actor);
    if (!reason || !String(reason).trim()) throw new Error('A withdrawal reason is required');
    const row = await this.repo.findActiveByEmployee(employeeId);
    if (!row) throw new Error('No active separation case was found for this employee');
    if (row.status === 'COMPLETED' || row.status === 'CANCELLED') {
      throw new Error(`A ${row.status} case cannot be withdrawn`);
    }

    await this.repo.update(row.id, {
      status: 'WITHDRAWN',
      withdrawn_at: new Date(),
      withdraw_reason: String(reason).trim(),
    });
    await this.repo.insertEvent(row.id, 'WITHDRAWN', `Withdrawn by the employee: ${String(reason).trim()}`, actor.userId);
    await this.safeNotifyRoles(
      ['admin', 'hr'],
      `Resignation withdrawn: ${row.employee_name}`,
      `${row.employee_name} (${row.emp_code}) withdrew ${row.sep_code}: ${String(reason).trim()}`,
      row.id,
    );
    const after = await this.get(row.id);
    await this.audit.record('SEPARATION', row.id, 'WITHDRAW', actor, { status: row.status }, { status: 'WITHDRAWN', reason });
    return after;
  }

  async getMyCase(actor: OffboardingActor): Promise<SeparationResponse> {
    const employeeId = this.mustBeLinked(actor);
    const row = await this.repo.findLatestByEmployee(employeeId);
    if (!row) throw new Error('No separation case was found for this employee');
    return this.withDetail(row);
  }

  // ==========================================================================
  // Staff reads and case management
  // ==========================================================================

  async list(filters: SeparationFilters): Promise<SeparationResponse[]> {
    const rows = await this.repo.findAll(filters);
    return rows.map(toSeparationResponse);
  }

  async get(id: number): Promise<SeparationResponse> {
    const row = await this.mustFind(id);
    return this.withDetail(row);
  }

  async createByStaff(
    input: { employeeId?: number; separationType?: string; reason?: string; resignationDate?: string; noticeDays?: number; lastWorkingDay?: string },
    ctx: PerfActionContext,
  ): Promise<SeparationResponse> {
    const employeeId = Number(input?.employeeId);
    if (!employeeId || !Number.isInteger(employeeId)) throw new Error('A numeric employeeId is required');
    const separationType = String(input?.separationType ?? '').toUpperCase();
    if (!SEPARATION_TYPES.has(separationType as SeparationType)) {
      throw new Error(`Invalid separationType "${input?.separationType}"`);
    }
    if (separationType === 'RESIGNATION') {
      throw new Error('Resignations must be raised by the employee through self-service; staff open the other separation types');
    }

    const active = await this.repo.findActiveByEmployee(employeeId);
    if (active) {
      throw new Error(`An active separation case already exists for this employee (${active.sep_code}, ${active.status})`);
    }
    const employee = await this.mustFindEmployee(employeeId);

    // Notice defaults come from the rules; staff may override either figure.
    const notice = await this.computeNotice(employee);
    let noticeDays = notice.noticeDays;
    if (input.noticeDays !== undefined) {
      noticeDays = Math.trunc(Number(input.noticeDays));
      if (!Number.isFinite(noticeDays) || noticeDays < 0) throw new Error('noticeDays must be zero or a positive number');
    }
    const noticeStart = notice.noticeStart;
    const noticeEnd = noticeDays > 0 ? addDays(noticeStart, noticeDays - 1) : noticeStart;
    let lastWorkingDay = noticeEnd;
    if (input.lastWorkingDay !== undefined) {
      if (!isValidDateString(String(input.lastWorkingDay))) throw new Error('lastWorkingDay must be a valid YYYY-MM-DD date');
      lastWorkingDay = String(input.lastWorkingDay);
    }

    const sepCode = await this.repo.nextSepCode(new Date().getFullYear());
    const id = await this.repo.insert({
      sep_code: sepCode,
      employee_id: employeeId,
      separation_type: separationType,
      status: 'PENDING_APPROVAL',
      reason: input.reason ? String(input.reason).trim() : null,
      resignation_date: input.resignationDate && isValidDateString(String(input.resignationDate)) ? input.resignationDate : todayString(),
      notice_days: noticeDays,
      notice_start: noticeStart,
      notice_end: noticeEnd,
      last_working_day: lastWorkingDay,
      created_by: ctx.userId,
    });
    await this.repo.insertEvent(
      id, 'SUBMITTED',
      `${separationType} case opened by staff for ${employee.full_name}; last working day ${lastWorkingDay}.`,
      ctx.userId,
    );

    const created = await this.get(id);
    await this.audit.record('SEPARATION', id, 'CREATE', ctx, null, created);
    return created;
  }

  async update(
    id: number,
    input: { reason?: string; resignationDate?: string; noticeDays?: number },
    ctx: PerfActionContext,
  ): Promise<SeparationResponse> {
    const before = await this.mustFind(id);
    if (!EDITABLE_STATUSES.has(before.status)) {
      throw new Error(`Only a DRAFT or PENDING_APPROVAL case can be edited (this one is ${before.status})`);
    }

    const fields: Record<string, any> = {};
    if (input.reason !== undefined) fields.reason = input.reason === null ? null : String(input.reason).trim();
    if (input.resignationDate !== undefined) {
      if (!isValidDateString(String(input.resignationDate))) throw new Error('resignationDate must be a valid YYYY-MM-DD date');
      fields.resignation_date = input.resignationDate;
    }
    if (input.noticeDays !== undefined) {
      const days = Math.trunc(Number(input.noticeDays));
      if (!Number.isFinite(days) || days < 0) throw new Error('noticeDays must be zero or a positive number');
      const start = dateOrNull(before.notice_start) ?? addDays(todayString(), 1);
      const end = days > 0 ? addDays(start, days - 1) : start;
      fields.notice_days = days;
      fields.notice_start = start;
      fields.notice_end = end;
      fields.last_working_day = end;
    }
    if (Object.keys(fields).length === 0) throw new Error('No updatable fields were provided');

    await this.repo.update(id, fields);
    await this.repo.insertEvent(id, 'UPDATED', 'Case details updated.', ctx.userId);
    const after = await this.get(id);
    await this.audit.record('SEPARATION', id, 'UPDATE', ctx, toSeparationResponse(before), after);
    return after;
  }

  // ==========================================================================
  // Reviews, approval, rejection, cancellation
  // ==========================================================================

  async managerReview(id: number, note: string, ctx: PerfActionContext): Promise<SeparationResponse> {
    const before = await this.mustFind(id);
    if (TERMINAL_STATUSES.has(before.status)) throw new Error(`A ${before.status} case cannot be reviewed`);
    await this.repo.update(id, {
      manager_reviewed_by: ctx.userId,
      manager_reviewed_at: new Date(),
      manager_note: note ? String(note).trim() : null,
    });
    await this.repo.insertEvent(id, 'MANAGER_REVIEWED', note ? String(note).trim() : null, ctx.userId);
    const after = await this.get(id);
    await this.audit.record('SEPARATION', id, 'MANAGER_REVIEW', ctx, { managerNote: before.manager_note }, { managerNote: note });
    return after;
  }

  async hrReview(id: number, note: string, ctx: PerfActionContext): Promise<SeparationResponse> {
    const before = await this.mustFind(id);
    if (TERMINAL_STATUSES.has(before.status)) throw new Error(`A ${before.status} case cannot be reviewed`);
    await this.repo.update(id, {
      hr_reviewed_by: ctx.userId,
      hr_reviewed_at: new Date(),
      hr_note: note ? String(note).trim() : null,
    });
    await this.repo.insertEvent(id, 'HR_REVIEWED', note ? String(note).trim() : null, ctx.userId);
    const after = await this.get(id);
    await this.audit.record('SEPARATION', id, 'HR_REVIEW', ctx, { hrNote: before.hr_note }, { hrNote: note });
    return after;
  }

  /**
   * Approval fans out every offboarding leg in one transaction: nine
   * departmental clearances with their default tasks, an asset-return row per
   * open assignment, the access-revocation catalogue, a DRAFT KT plan and the
   * two exit interviews.
   */
  async approve(id: number, ctx: PerfActionContext): Promise<SeparationResponse & { generated: Record<string, number> }> {
    const before = await this.mustFind(id);
    if (before.status !== 'PENDING_APPROVAL') {
      throw new Error(`Only a PENDING_APPROVAL case can be approved (this one is ${before.status})`);
    }

    const lwd = dateOrNull(before.last_working_day);
    const newStatus = lwd && lwd <= todayString() ? 'CLEARANCE' : 'IN_NOTICE';
    const generated = await this.repo.approveAndGenerate({
      separationId: id,
      employeeId: before.employee_id,
      newStatus,
      approvedBy: ctx.userId,
      clearances: DEFAULT_CLEARANCES.map((c, i) => ({ department: c.department, sortOrder: i, tasks: c.tasks })),
      accessCatalog: ACCESS_CATALOG,
    });

    await this.safeNotifyEmployee(
      before.employee_id,
      `Separation ${before.sep_code} approved`,
      `Your separation has been approved. Last working day: ${lwd ?? 'to be confirmed'}. The exit checklist (clearances, asset returns, knowledge transfer and exit interviews) is now open.`,
      id,
    );
    const after = await this.get(id);
    await this.audit.record('SEPARATION', id, 'APPROVE', ctx, { status: before.status }, { status: newStatus, generated });
    return { ...after, generated: generated as unknown as Record<string, number> };
  }

  async reject(id: number, reason: string, ctx: PerfActionContext): Promise<SeparationResponse> {
    if (!reason || !String(reason).trim()) throw new Error('A rejection reason is required');
    const before = await this.mustFind(id);
    if (before.status !== 'PENDING_APPROVAL') {
      throw new Error(`Only a PENDING_APPROVAL case can be rejected (this one is ${before.status})`);
    }
    await this.repo.update(id, { status: 'REJECTED', rejection_reason: String(reason).trim() });
    await this.repo.insertEvent(id, 'REJECTED', String(reason).trim(), ctx.userId);
    await this.safeNotifyEmployee(
      before.employee_id,
      `Separation ${before.sep_code} rejected`,
      `Your separation request was rejected: ${String(reason).trim()}`,
      id,
    );
    const after = await this.get(id);
    await this.audit.record('SEPARATION', id, 'REJECT', ctx, { status: before.status }, { status: 'REJECTED', reason });
    return after;
  }

  async cancel(id: number, ctx: PerfActionContext): Promise<SeparationResponse> {
    const before = await this.mustFind(id);
    if (TERMINAL_STATUSES.has(before.status)) throw new Error(`A ${before.status} case cannot be cancelled`);
    await this.repo.update(id, { status: 'CANCELLED' });
    await this.repo.insertEvent(id, 'CANCELLED', 'Case cancelled by staff.', ctx.userId);
    const after = await this.get(id);
    await this.audit.record('SEPARATION', id, 'CANCEL', ctx, { status: before.status }, { status: 'CANCELLED' });
    return after;
  }

  // ==========================================================================
  // Notice management
  // ==========================================================================

  async updateNotice(
    id: number,
    input: { noticeDays?: number; noticeEnd?: string },
    ctx: PerfActionContext,
  ): Promise<SeparationResponse> {
    const before = await this.mustFind(id);
    if (TERMINAL_STATUSES.has(before.status)) throw new Error(`A ${before.status} case's notice cannot be changed`);
    const start = dateOrNull(before.notice_start) ?? addDays(todayString(), 1);

    let noticeDays: number;
    let noticeEnd: string;
    if (input.noticeDays !== undefined) {
      noticeDays = Math.trunc(Number(input.noticeDays));
      if (!Number.isFinite(noticeDays) || noticeDays < 0) throw new Error('noticeDays must be zero or a positive number');
      noticeEnd = noticeDays > 0 ? addDays(start, noticeDays - 1) : start;
    } else if (input.noticeEnd !== undefined) {
      if (!isValidDateString(String(input.noticeEnd))) throw new Error('noticeEnd must be a valid YYYY-MM-DD date');
      noticeEnd = String(input.noticeEnd);
      if (noticeEnd < start) throw new Error('noticeEnd cannot be before the notice start date');
      noticeDays = daysBetween(start, noticeEnd) + 1;
    } else {
      throw new Error('Provide noticeDays or noticeEnd');
    }

    await this.repo.update(id, {
      notice_days: noticeDays,
      notice_start: start,
      notice_end: noticeEnd,
      last_working_day: noticeEnd,
    });
    await this.repo.insertEvent(
      id, 'NOTICE_UPDATED',
      `Notice set to ${noticeDays} days (${start} to ${noticeEnd}); last working day is now ${noticeEnd}.`,
      ctx.userId,
    );
    const after = await this.get(id);
    await this.audit.record(
      'SEPARATION', id, 'NOTICE_UPDATE', ctx,
      { noticeDays: numOrNull(before.notice_days), noticeEnd: dateOrNull(before.notice_end) },
      { noticeDays, noticeEnd },
    );
    return after;
  }

  async requestEarlyRelease(
    id: number,
    input: { earlyReleaseDate?: string; reason?: string },
    actor: OffboardingActor,
    isStaff: boolean,
  ): Promise<SeparationResponse> {
    const before = await this.mustFind(id);
    if (!isStaff && before.employee_id !== actor.employeeId) {
      throw new Error('You can only request early release on your own case');
    }
    if (TERMINAL_STATUSES.has(before.status)) throw new Error(`A ${before.status} case cannot take an early release request`);
    if (!input?.earlyReleaseDate || !isValidDateString(String(input.earlyReleaseDate))) {
      throw new Error('earlyReleaseDate must be a valid YYYY-MM-DD date');
    }
    if (!input.reason || !String(input.reason).trim()) throw new Error('An early release reason is required');
    const noticeEnd = dateOrNull(before.notice_end);
    if (noticeEnd && String(input.earlyReleaseDate) >= noticeEnd) {
      throw new Error(`earlyReleaseDate must be before the notice end date (${noticeEnd})`);
    }

    await this.repo.update(id, {
      early_release_requested: 1,
      early_release_date: input.earlyReleaseDate,
      early_release_reason: String(input.reason).trim(),
      early_release_approved_by: null,
    });
    await this.repo.insertEvent(
      id, 'EARLY_RELEASE_REQUESTED',
      `Early release requested for ${input.earlyReleaseDate}: ${String(input.reason).trim()}`,
      actor.userId,
    );
    const after = await this.get(id);
    await this.audit.record('SEPARATION', id, 'EARLY_RELEASE_REQUEST', actor, null, {
      earlyReleaseDate: input.earlyReleaseDate, reason: input.reason,
    });
    return after;
  }

  async decideEarlyRelease(id: number, approve: boolean, ctx: PerfActionContext): Promise<SeparationResponse> {
    const before = await this.mustFind(id);
    if (!before.early_release_requested) throw new Error('No early release request is pending on this case');
    if (TERMINAL_STATUSES.has(before.status)) throw new Error(`A ${before.status} case cannot be decided`);

    if (approve) {
      const earlyDate = dateOrNull(before.early_release_date)!;
      const noticeEnd = dateOrNull(before.notice_end);
      const shortfall = noticeEnd ? Math.max(0, daysBetween(earlyDate, noticeEnd)) : 0;
      await this.repo.update(id, {
        last_working_day: earlyDate,
        early_release_approved_by: ctx.userId,
      });
      await this.repo.insertEvent(
        id, 'EARLY_RELEASE_APPROVED',
        `Early release approved; last working day moved to ${earlyDate}` +
          (shortfall > 0 ? ` (notice shortfall of ${shortfall} days).` : '.'),
        ctx.userId,
      );
      await this.safeNotifyEmployee(before.employee_id, `Early release approved (${before.sep_code})`,
        `Your early release was approved. New last working day: ${earlyDate}.`, id);
      const after = await this.get(id);
      await this.audit.record('SEPARATION', id, 'EARLY_RELEASE_APPROVE', ctx,
        { lastWorkingDay: dateOrNull(before.last_working_day) },
        { lastWorkingDay: earlyDate, noticeShortfallDays: shortfall });
      return after;
    }

    await this.repo.update(id, { early_release_requested: 0 });
    await this.repo.insertEvent(id, 'EARLY_RELEASE_REJECTED', 'Early release request declined.', ctx.userId);
    await this.safeNotifyEmployee(before.employee_id, `Early release declined (${before.sep_code})`,
      'Your early release request was declined; the original notice period stands.', id);
    const after = await this.get(id);
    await this.audit.record('SEPARATION', id, 'EARLY_RELEASE_REJECT', ctx,
      { earlyReleaseDate: dateOrNull(before.early_release_date) }, { rejected: true });
    return after;
  }

  /**
   * Notice buyout: amount = days x per-day rate, where the per-day rate is the
   * average of the employee's last three salary lines' total_amount divided by
   * 26 working days. When no salary history exists the amount is null with an
   * explicit reason - a figure is never invented.
   */
  async buyout(
    id: number,
    days: number,
    ctx: PerfActionContext,
  ): Promise<SeparationResponse & { buyout: { days: number; perDayRate: number | null; amount: number | null; basis: string } }> {
    const before = await this.mustFind(id);
    if (TERMINAL_STATUSES.has(before.status)) throw new Error(`A ${before.status} case cannot take a buyout`);
    const buyoutDays = Math.trunc(Number(days));
    if (!Number.isFinite(buyoutDays) || buyoutDays <= 0) throw new Error('days must be a positive number');

    const rule = await this.repo.findNoticeRuleFor(before.worker_type ?? null, before.grade ?? null);
    if (rule && !rule.buyout_allowed) {
      throw new Error(`Notice buyout is not allowed by the applicable notice rule (${rule.description ?? `rule #${rule.id}`})`);
    }

    const lines = await this.repo.findRecentSalaryLines(before.employee_id, 3);
    let perDayRate: number | null = null;
    let amount: number | null = null;
    let basis: string;
    if (lines.length === 0) {
      basis = 'No salary history exists for this employee, so no per-day rate could be derived; the buyout amount is left empty for manual entry.';
    } else {
      const avg = lines.reduce((s, l) => s + Number(l.total_amount), 0) / lines.length;
      perDayRate = round2(avg / 26);
      amount = round2(buyoutDays * perDayRate);
      basis = `Average gross of the last ${lines.length} salary line(s) (${round2(avg)}) / 26 working days = ${perDayRate} per day x ${buyoutDays} days.`;
    }

    await this.repo.update(id, { notice_buyout_days: buyoutDays, notice_buyout_amount: amount });
    await this.repo.insertEvent(
      id, 'NOTICE_BUYOUT',
      amount === null
        ? `Buyout of ${buyoutDays} days recorded without an amount: no salary history.`
        : `Buyout of ${buyoutDays} days recorded at ${amount} (${basis})`,
      ctx.userId,
    );
    const after = await this.get(id);
    await this.audit.record('SEPARATION', id, 'NOTICE_BUYOUT', ctx,
      { noticeBuyoutDays: numOrNull(before.notice_buyout_days), noticeBuyoutAmount: numOrNull(before.notice_buyout_amount) },
      { noticeBuyoutDays: buyoutDays, noticeBuyoutAmount: amount, basis });
    return { ...after, buyout: { days: buyoutDays, perDayRate, amount, basis } };
  }

  async waiveNotice(id: number, reason: string, ctx: PerfActionContext): Promise<SeparationResponse> {
    const before = await this.mustFind(id);
    if (TERMINAL_STATUSES.has(before.status)) throw new Error(`A ${before.status} case cannot have its notice waived`);
    if (!reason || !String(reason).trim()) throw new Error('A waiver reason is required');
    await this.repo.update(id, { notice_waived: 1, notice_waiver_reason: String(reason).trim() });
    await this.repo.insertEvent(id, 'NOTICE_WAIVED', String(reason).trim(), ctx.userId);
    const after = await this.get(id);
    await this.audit.record('SEPARATION', id, 'NOTICE_WAIVE', ctx, { noticeWaived: !!before.notice_waived }, { noticeWaived: true, reason });
    return after;
  }

  async setGardenLeave(id: number, enabled: boolean, ctx: PerfActionContext): Promise<SeparationResponse> {
    const before = await this.mustFind(id);
    if (TERMINAL_STATUSES.has(before.status)) throw new Error(`A ${before.status} case cannot be put on garden leave`);
    await this.repo.update(id, { garden_leave: enabled ? 1 : 0 });
    await this.repo.insertEvent(id, enabled ? 'GARDEN_LEAVE_ENABLED' : 'GARDEN_LEAVE_DISABLED', null, ctx.userId);
    const after = await this.get(id);
    await this.audit.record('SEPARATION', id, 'GARDEN_LEAVE', ctx, { gardenLeave: !!before.garden_leave }, { gardenLeave: enabled });
    return after;
  }

  // ==========================================================================
  // Completion
  // ==========================================================================

  async complete(id: number, ctx: PerfActionContext): Promise<SeparationResponse & { alumniCreated: boolean }> {
    const before = await this.mustFind(id);
    if (!COMPLETABLE_STATUSES.has(before.status)) {
      throw new Error(`Only an IN_NOTICE, CLEARANCE or SETTLEMENT case can be completed (this one is ${before.status})`);
    }
    const lwd = dateOrNull(before.last_working_day);
    if (!lwd) throw new Error('The case must have a last working day before it can be completed');

    // Guard 1: every departmental clearance must be CLEARED.
    const uncleared = await this.repo.findUnclearedClearances(id);
    if (uncleared.length > 0) {
      const list = uncleared.map((c) => `${c.department}: ${c.status}`).join(', ');
      throw new Error(`Cannot complete: ${uncleared.length} clearance(s) are not CLEARED (${list})`);
    }
    // Guard 2: every internal access revocation must be actioned.
    const openAccess = await this.repo.findUnrevokedInternalAccess(id);
    if (openAccess.length > 0) {
      const list = openAccess.map((a) => `${a.system_name}: ${a.status}`).join(', ');
      throw new Error(`Cannot complete: internal access revocations are still pending (${list})`);
    }

    const employee = await this.mustFindEmployee(before.employee_id);

    // Pre-deactivation: the employee's notification is created while their
    // login still exists; the transaction below then deactivates it.
    await this.safeNotifyEmployee(
      before.employee_id,
      `Offboarding completed (${before.sep_code})`,
      `Your offboarding is complete. Exit date: ${lwd}. Thank you for your service - your settlement and exit letters follow through HR.`,
      id,
    );

    const { alumniCreated } = await this.repo.completeCase({
      separationId: id,
      employeeId: before.employee_id,
      lastWorkingDay: lwd,
      timelineTitle: `Exit: ${before.separation_type}`,
      timelineDetails: `Separation ${before.sep_code} completed; last working day ${lwd}.`,
      alumni: {
        exitDate: lwd,
        lastGrade: employee.grade ?? null,
        lastDepartment: employee.department_name ?? null,
        contactPhone: employee.whatsapp ?? null,
        rehireEligible: before.rehire_eligible === null || before.rehire_eligible === undefined ? null : !!before.rehire_eligible,
      },
      userId: ctx.userId,
    });

    await this.safeNotifyRoles(
      ['admin', 'hr'],
      `Offboarding completed: ${employee.full_name}`,
      `${employee.full_name} (${employee.emp_code}) exited on ${lwd}; the employee record is closed, the login deactivated and the alumni entry ${alumniCreated ? 'created' : 'already existed'}.`,
      id,
    );

    const after = await this.get(id);
    await this.audit.record('SEPARATION', id, 'COMPLETE', ctx,
      { status: before.status, workStatus: employee.work_status },
      { status: 'COMPLETED', workStatus: 'RESIGN', resignedAt: lwd, alumniCreated });
    return { ...after, alumniCreated };
  }

  async setRehireFlag(
    id: number,
    input: { rehireEligible?: boolean | null; note?: string | null },
    ctx: PerfActionContext,
  ): Promise<SeparationResponse> {
    const before = await this.mustFind(id);
    if (input.rehireEligible === undefined) throw new Error('rehireEligible is required (true, false or null)');
    await this.repo.update(id, {
      rehire_eligible: input.rehireEligible === null ? null : input.rehireEligible ? 1 : 0,
      rehire_note: input.note === undefined ? before.rehire_note : input.note,
    });
    await this.repo.insertEvent(
      id, 'REHIRE_FLAG_SET',
      `Rehire eligibility set to ${input.rehireEligible === null ? 'undecided' : input.rehireEligible ? 'eligible' : 'not eligible'}${input.note ? `: ${input.note}` : ''}`,
      ctx.userId,
    );
    const after = await this.get(id);
    await this.audit.record('SEPARATION', id, 'REHIRE_FLAG', ctx,
      { rehireEligible: before.rehire_eligible, rehireNote: before.rehire_note },
      { rehireEligible: input.rehireEligible, rehireNote: input.note ?? null });
    return after;
  }

  // ==========================================================================
  // Notice rules
  // ==========================================================================

  async listNoticeRules(): Promise<NoticeRuleResponse[]> {
    const rows = await this.repo.findNoticeRules();
    return rows.map(toNoticeRuleResponse);
  }

  async createNoticeRule(input: any, ctx: PerfActionContext): Promise<NoticeRuleResponse> {
    const noticeDays = Math.trunc(Number(input?.noticeDays));
    if (!Number.isFinite(noticeDays) || noticeDays < 0) throw new Error('noticeDays must be zero or a positive number');
    const workerType = input.workerType ? String(input.workerType).toUpperCase() : null;
    if (workerType && !WORKER_TYPES.has(workerType)) throw new Error(`Invalid workerType "${input.workerType}"`);
    const basis = input.buyoutRateBasis ? String(input.buyoutRateBasis).toUpperCase() : 'PER_DAY_GROSS';
    if (!['PER_DAY_GROSS', 'PER_DAY_BASIC'].includes(basis)) throw new Error(`Invalid buyoutRateBasis "${input.buyoutRateBasis}"`);

    const id = await this.repo.insertNoticeRule({
      worker_type: workerType,
      grade: input.grade ? String(input.grade).trim() : null,
      notice_days: noticeDays,
      buyout_allowed: input.buyoutAllowed === undefined ? 1 : input.buyoutAllowed ? 1 : 0,
      buyout_rate_basis: basis,
      description: input.description ?? null,
      is_active: input.isActive === undefined ? 1 : input.isActive ? 1 : 0,
      created_by: ctx.userId,
    });
    await this.audit.record('NOTICE_RULE', id, 'CREATE', ctx, null, input);
    const row = await this.repo.findNoticeRuleById(id);
    return toNoticeRuleResponse(row);
  }

  async updateNoticeRule(id: number, input: any, ctx: PerfActionContext): Promise<NoticeRuleResponse> {
    const before = await this.repo.findNoticeRuleById(id);
    if (!before) throw new Error(`Notice rule ${id} was not found`);

    const fields: Record<string, any> = {};
    if (input.workerType !== undefined) {
      const wt = input.workerType === null ? null : String(input.workerType).toUpperCase();
      if (wt && !WORKER_TYPES.has(wt)) throw new Error(`Invalid workerType "${input.workerType}"`);
      fields.worker_type = wt;
    }
    if (input.grade !== undefined) fields.grade = input.grade === null ? null : String(input.grade).trim();
    if (input.noticeDays !== undefined) {
      const days = Math.trunc(Number(input.noticeDays));
      if (!Number.isFinite(days) || days < 0) throw new Error('noticeDays must be zero or a positive number');
      fields.notice_days = days;
    }
    if (input.buyoutAllowed !== undefined) fields.buyout_allowed = input.buyoutAllowed ? 1 : 0;
    if (input.buyoutRateBasis !== undefined) {
      const basis = String(input.buyoutRateBasis).toUpperCase();
      if (!['PER_DAY_GROSS', 'PER_DAY_BASIC'].includes(basis)) throw new Error(`Invalid buyoutRateBasis "${input.buyoutRateBasis}"`);
      fields.buyout_rate_basis = basis;
    }
    if (input.description !== undefined) fields.description = input.description;
    if (input.isActive !== undefined) fields.is_active = input.isActive ? 1 : 0;
    if (Object.keys(fields).length === 0) throw new Error('No updatable fields were provided');

    await this.repo.updateNoticeRule(id, fields);
    await this.audit.record('NOTICE_RULE', id, 'UPDATE', ctx, toNoticeRuleResponse(before), input);
    const row = await this.repo.findNoticeRuleById(id);
    return toNoticeRuleResponse(row);
  }

  // ==========================================================================
  // Progress
  // ==========================================================================

  /** Per-leg completion counts, including the sibling stream's letters and settlement. */
  async getProgress(separationId: number, employeeId: number): Promise<SeparationProgress> {
    return this.repo.progressCounts(separationId, employeeId);
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private async withDetail(row: any): Promise<SeparationResponse> {
    const response = toSeparationResponse(row);
    const [events, progress] = await Promise.all([
      this.repo.findEvents(row.id),
      this.getProgress(row.id, row.employee_id),
    ]);
    response.events = events.map(toEventResponse);
    response.progress = progress;
    return response;
  }

  private async mustFind(id: number): Promise<any> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error(`Separation ${id} was not found`);
    return row;
  }

  private mustBeLinked(actor: OffboardingActor): number {
    if (!actor.employeeId) throw new Error('This account is not linked to an employee record');
    return actor.employeeId;
  }

  private async mustFindEmployee(employeeId: number): Promise<any> {
    const employee = await this.repo.findEmployee(employeeId);
    if (!employee) throw new Error(`Employee ${employeeId} was not found`);
    return employee;
  }

  /** Notice figures from the best-matching rule; 30 days when none is configured. */
  private async computeNotice(employee: any): Promise<{ noticeDays: number; noticeStart: string; noticeEnd: string }> {
    const rule = await this.repo.findNoticeRuleFor(employee.worker_type ?? null, employee.grade ?? null);
    const noticeDays = rule ? Number(rule.notice_days) : 30;
    const noticeStart = addDays(todayString(), 1);
    const noticeEnd = noticeDays > 0 ? addDays(noticeStart, noticeDays - 1) : noticeStart;
    return { noticeDays, noticeStart, noticeEnd };
  }

  /** In-app notifications never fail the write they accompany. */
  private async safeNotifyRoles(roles: string[], title: string, body: string, refId: number): Promise<void> {
    try {
      await this.notifications.notifyRoles(roles, {
        category: 'OFFBOARDING', title, body, linkPage: 'offboarding', linkRefId: refId,
      });
    } catch (err) {
      console.error(`offboarding notification to roles failed for separation #${refId}:`, err);
    }
  }

  private async safeNotifyEmployee(employeeId: number, title: string, body: string, refId: number): Promise<void> {
    try {
      await this.notifications.notifyEmployee(employeeId, {
        category: 'OFFBOARDING', title, body, linkPage: 'offboarding', linkRefId: refId,
      });
    } catch (err) {
      console.error(`offboarding notification to employee #${employeeId} failed:`, err);
    }
  }
}
