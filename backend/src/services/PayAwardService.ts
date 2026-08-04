import {
  AWARD_CLASSES,
  AwardStatus,
  PayAwardFilters,
  PayAwardInput,
  PayAwardRepository,
  PayAwardResponse,
} from '../repositories/PayAwardRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { NotificationService } from './NotificationService';
import { isValidDateString, round2, todayString } from '../utils/dateUtils';

/** Roles that should hear about an award submitted for sign-off. */
const APPROVER_ROLES = ['admin', 'accountant'];

export const APPROVED_AWARD_LOCKED = 'An approved award cannot be edited';

export interface BulkAwardRow extends PayAwardInput {
  /** Alternative to employeeId, for spreadsheet-style imports. */
  empCode?: string;
}

export interface BulkAwardSkip {
  row: number;
  reason: string;
  employeeId: number | null;
  empCode: string | null;
}

export interface BulkAwardResult {
  created: number;
  createdIds: number[];
  skipped: BulkAwardSkip[];
}

function requireText(value: unknown, message: string): string {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(message);
  return text;
}

/**
 * Bonus, incentives and variable pay.
 *
 * The lifecycle is deliberately narrow: DRAFT and PENDING_APPROVAL rows are
 * editable, APPROVED rows may only be cancelled, and PAID rows are immutable —
 * so an amount can never move after the money has left.
 */
export class PayAwardService {
  private repo = new PayAwardRepository();
  private activityRepo = new ActivityRepository();
  private notifications = new NotificationService();

  async list(filters: PayAwardFilters = {}): Promise<PayAwardResponse[]> {
    return this.repo.findAwards(filters);
  }

  async get(id: number): Promise<PayAwardResponse> {
    const award = await this.repo.findAwardById(id);
    if (!award) throw new Error('Award not found');
    return award;
  }

  async create(data: PayAwardInput, userId: number): Promise<PayAwardResponse> {
    const payload = await this.validate(data, true);
    const employee = await this.repo.findEmployeeBrief(payload.employeeId as number);
    if (!employee) throw new Error('Employee not found');

    const id = await this.repo.createAward(payload, userId);

    await this.activityRepo.log({
      actorUserId: userId,
      employeeId: payload.employeeId ?? null,
      entityType: 'PAY_AWARD',
      entityId: id,
      action: 'CREATE',
      summary: `Created ${payload.awardClass} "${payload.title}" of ${payload.amount} for ${employee.fullName}`,
      meta: { awardClass: payload.awardClass, amount: payload.amount },
    });

    if (payload.status === 'PENDING_APPROVAL') {
      await this.announceSubmission(id, employee.fullName, payload, userId);
    }
    return this.get(id);
  }

  async update(id: number, data: PayAwardInput, userId: number): Promise<PayAwardResponse> {
    const existing = await this.repo.findAwardById(id);
    if (!existing) throw new Error('Award not found');
    if (existing.status === 'APPROVED') throw new Error(APPROVED_AWARD_LOCKED);
    if (existing.status === 'PAID') throw new Error('A paid award cannot be edited');
    if (existing.status === 'CANCELLED') throw new Error('A cancelled award cannot be edited');

    const payload = await this.validate(data, false);
    // employeeId and status are not patchable: reassigning either would sidestep
    // the approval trail this table exists to keep.
    delete payload.employeeId;
    delete payload.status;

    await this.repo.updateAward(id, payload, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      employeeId: existing.employeeId,
      entityType: 'PAY_AWARD',
      entityId: id,
      action: 'UPDATE',
      summary: `Updated ${existing.awardClass} "${existing.title}"`,
    });
    return this.get(id);
  }

  async submitForApproval(id: number, userId: number): Promise<PayAwardResponse> {
    const existing = await this.repo.findAwardById(id);
    if (!existing) throw new Error('Award not found');
    if (existing.status !== 'DRAFT') throw new Error('Only draft awards can be submitted for approval');

    await this.repo.setAwardStatus(id, 'PENDING_APPROVAL', userId);
    await this.announceSubmission(id, existing.employeeName ?? 'an employee', existing, userId);

    await this.activityRepo.log({
      actorUserId: userId,
      employeeId: existing.employeeId,
      entityType: 'PAY_AWARD',
      entityId: id,
      action: 'SUBMIT',
      summary: `Submitted ${existing.awardClass} "${existing.title}" for approval`,
    });
    return this.get(id);
  }

  async approve(id: number, userId: number, actorName?: string): Promise<PayAwardResponse> {
    const existing = await this.repo.findAwardById(id);
    if (!existing) throw new Error('Award not found');
    if (existing.status !== 'DRAFT' && existing.status !== 'PENDING_APPROVAL') {
      throw new Error('Only draft or pending awards can be approved');
    }

    await this.repo.setAwardStatus(id, 'APPROVED', userId);

    await this.notifications.notifyEmployee(existing.employeeId, {
      category: 'PAYROLL',
      priority: 'NORMAL',
      title: `Your ${existing.awardClass.toLowerCase().replace('_', ' ')} was approved`,
      body: `${existing.title}: ${existing.amount} ${existing.currency}, effective ${existing.effectiveDate}.`,
      linkPage: 'payroll',
      linkRefId: id,
      email: true,
      createdBy: userId,
    });

    await this.activityRepo.log({
      actorUserId: userId,
      actorName: actorName ?? null,
      employeeId: existing.employeeId,
      entityType: 'PAY_AWARD',
      entityId: id,
      action: 'APPROVE',
      summary: `Approved ${existing.awardClass} "${existing.title}" of ${existing.amount}`,
    });
    return this.get(id);
  }

  async reject(
    id: number,
    userId: number,
    note: string,
    actorName?: string,
  ): Promise<PayAwardResponse> {
    const reason = requireText(note, 'A rejection note is required');

    const existing = await this.repo.findAwardById(id);
    if (!existing) throw new Error('Award not found');
    if (existing.status !== 'DRAFT' && existing.status !== 'PENDING_APPROVAL') {
      throw new Error('Only draft or pending awards can be rejected');
    }

    await this.repo.setAwardStatus(id, 'REJECTED', userId, reason);

    await this.notifications.notifyEmployee(existing.employeeId, {
      category: 'PAYROLL',
      priority: 'HIGH',
      title: 'A variable pay item was rejected',
      body: `${existing.title}. Reason: ${reason}`,
      linkPage: 'payroll',
      linkRefId: id,
      createdBy: userId,
    });

    await this.activityRepo.log({
      actorUserId: userId,
      actorName: actorName ?? null,
      employeeId: existing.employeeId,
      entityType: 'PAY_AWARD',
      entityId: id,
      action: 'REJECT',
      summary: `Rejected ${existing.awardClass} "${existing.title}"`,
      meta: { reason },
    });
    return this.get(id);
  }

  async cancel(id: number, userId: number): Promise<PayAwardResponse> {
    const existing = await this.repo.findAwardById(id);
    if (!existing) throw new Error('Award not found');
    if (existing.status === 'PAID') throw new Error('A paid award cannot be cancelled');
    if (existing.status === 'CANCELLED') throw new Error('This award is already cancelled');

    await this.repo.setAwardStatus(id, 'CANCELLED', userId);
    await this.activityRepo.log({
      actorUserId: userId,
      employeeId: existing.employeeId,
      entityType: 'PAY_AWARD',
      entityId: id,
      action: 'CANCEL',
      summary: `Cancelled ${existing.awardClass} "${existing.title}"`,
    });
    return this.get(id);
  }

  /** Flags approved awards as paid once payroll has disbursed them. */
  async markPaid(ids: number[], periodId: number | null, userId: number): Promise<{ updated: number }> {
    if (!Array.isArray(ids) || ids.length === 0) throw new Error('At least one award id is required');
    const updated = await this.repo.markPaid(ids, periodId, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'PAY_AWARD',
      action: 'MARK_PAID',
      summary: `Marked ${updated} award(s) as paid`,
      meta: { periodId, ids },
    });
    return { updated };
  }

  /** Approved awards the payroll engine should pay out in a period. */
  async getPendingForPeriod(periodId: number): Promise<PayAwardResponse[]> {
    return this.repo.getPendingForPeriod(periodId);
  }

  /**
   * Imports many awards at once. Every row is validated individually inside one
   * transaction, so a single malformed row is reported back rather than
   * aborting the batch.
   */
  async bulkCreate(rows: BulkAwardRow[], userId: number): Promise<BulkAwardResult> {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('At least one row is required');
    if (rows.length > 2000) throw new Error('A bulk import is limited to 2000 rows');

    const skipped: BulkAwardSkip[] = [];
    const createdIds: number[] = [];

    await this.repo.withTransaction(async (conn) => {
      for (const [index, row] of rows.entries()) {
        const rowNo = index + 1;
        const empCode = row.empCode ? String(row.empCode).trim() : null;
        let employeeId = row.employeeId ? Math.floor(Number(row.employeeId)) : null;

        try {
          if (!employeeId && empCode) {
            employeeId = await this.repo.findEmployeeIdByCode(empCode, conn);
          }
          if (!employeeId || !Number.isFinite(employeeId)) {
            throw new Error(empCode ? `No employee with code ${empCode}` : 'employeeId is required');
          }
          const employee = await this.repo.findEmployeeBrief(employeeId, conn);
          if (!employee) throw new Error('Employee not found');

          const payload = await this.validate({ ...row, employeeId }, true, true);
          const id = await this.repo.createAward(payload, userId, conn);
          createdIds.push(id);
        } catch (err: any) {
          skipped.push({
            row: rowNo,
            reason: err?.message ?? 'Row could not be imported',
            employeeId: employeeId ?? null,
            empCode,
          });
        }
      }

      await this.activityRepo.log(
        {
          actorUserId: userId,
          entityType: 'PAY_AWARD',
          action: 'BULK_CREATE',
          summary: `Bulk-created ${createdIds.length} award(s), skipped ${skipped.length}`,
          meta: { created: createdIds.length, skipped: skipped.length },
        },
        conn,
      );
    });

    return { created: createdIds.length, createdIds, skipped };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  private async announceSubmission(
    id: number,
    employeeName: string,
    award: { awardClass?: string; title?: string; amount?: number },
    userId: number,
  ): Promise<void> {
    await this.notifications.notifyRoles(APPROVER_ROLES, {
      category: 'PAYROLL',
      priority: 'NORMAL',
      title: `${award.awardClass ?? 'Award'} awaiting approval: ${employeeName}`,
      body: `${award.title ?? 'Variable pay'} — ${award.amount ?? 0}.`,
      linkPage: 'payroll',
      linkRefId: id,
      createdBy: userId,
    });
  }

  /**
   * Shared validation. `skipEmployeeCheck` is set for bulk rows, where the
   * employee has already been resolved and verified by the caller.
   */
  private async validate(
    data: PayAwardInput,
    isCreate: boolean,
    skipEmployeeCheck = false,
  ): Promise<PayAwardInput> {
    const out: PayAwardInput = {};

    if (isCreate) {
      const employeeId = Math.floor(Number(data.employeeId));
      if (!Number.isFinite(employeeId) || employeeId <= 0) throw new Error('employeeId is required');
      out.employeeId = employeeId;

      if (!skipEmployeeCheck) {
        const employee = await this.repo.findEmployeeBrief(employeeId);
        if (!employee) throw new Error('Employee not found');
      }
    }

    if (data.awardClass !== undefined || isCreate) {
      const awardClass = String(data.awardClass ?? '').trim().toUpperCase();
      if (!AWARD_CLASSES.includes(awardClass as any)) {
        throw new Error(`awardClass must be one of ${AWARD_CLASSES.join(', ')}`);
      }
      out.awardClass = awardClass as PayAwardInput['awardClass'];
    }
    if (data.awardType !== undefined || isCreate) {
      out.awardType = (data.awardType ? String(data.awardType).trim() : 'GENERAL').slice(0, 60);
    }
    if (data.title !== undefined || isCreate) {
      out.title = requireText(data.title, 'A title is required').slice(0, 200);
    }
    if (data.amount !== undefined || isCreate) {
      const amount = Number(data.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be greater than zero');
      out.amount = round2(amount);
    }
    if (data.effectiveDate !== undefined || isCreate) {
      const date = String(data.effectiveDate ?? '').trim() || todayString();
      if (!isValidDateString(date)) throw new Error('effectiveDate must be a valid YYYY-MM-DD date');
      out.effectiveDate = date;
    }

    for (const key of ['targetValue', 'achievedValue'] as const) {
      if (data[key] === undefined) continue;
      const raw = data[key] as unknown;
      const value = raw === null || raw === '' ? null : Number(raw);
      if (value !== null && !Number.isFinite(value)) throw new Error(`${key} must be a number`);
      out[key] = value;
    }
    // Achievement is derived when both sides of the target are present.
    const target = out.targetValue ?? null;
    const achieved = out.achievedValue ?? null;
    if (data.achievementPct !== undefined) {
      const pct = data.achievementPct === null ? null : Number(data.achievementPct);
      if (pct !== null && (!Number.isFinite(pct) || pct < 0)) {
        throw new Error('achievementPct must be zero or more');
      }
      out.achievementPct = pct;
    } else if (target !== null && target > 0 && achieved !== null) {
      out.achievementPct = round2((achieved / target) * 100);
    }

    for (const key of ['componentId', 'periodId', 'payoutPeriodId'] as const) {
      if (data[key] === undefined) continue;
      if (data[key] === null || (data[key] as any) === '') {
        out[key] = null;
        continue;
      }
      const value = Math.floor(Number(data[key]));
      if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be a valid id`);
      out[key] = value;
    }

    if (data.currency !== undefined) out.currency = String(data.currency).trim().toUpperCase();
    if (data.isTaxable !== undefined) out.isTaxable = !!data.isTaxable;
    if (data.reason !== undefined) out.reason = data.reason ? String(data.reason).trim().slice(0, 500) : null;

    if (isCreate) {
      const status = String(data.status ?? 'DRAFT').toUpperCase() as AwardStatus;
      if (!['DRAFT', 'PENDING_APPROVAL'].includes(status)) {
        throw new Error('A new award must start as DRAFT or PENDING_APPROVAL');
      }
      out.status = status;
    }

    return out;
  }
}
