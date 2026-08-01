import { AdvanceRepository, AdvanceFilters } from '../repositories/AdvanceRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { NotificationService } from './NotificationService';
import { AdvanceRecoveryResponse, AdvanceResponse, AdvanceType } from '../types/hrms';
import { isValidDateString, round2, todayString } from '../utils/dateUtils';

export interface CreateAdvancePayload {
  employeeId: number;
  advanceType?: AdvanceType | string;
  amount: number;
  advanceDate?: string;
  reason?: string | null;
  installmentAmount: number;
}

export interface AdvanceInstallment {
  seq: number;
  amount: number;
}

/** Guard so a pathological installment size cannot generate an endless preview. */
const MAX_PREVIEW_INSTALLMENTS = 240;

export class AdvanceService {
  private repo = new AdvanceRepository();
  private employeeRepo = new EmployeeRepository();
  private activityRepo = new ActivityRepository();
  private notifications = new NotificationService();

  async list(filters: AdvanceFilters = {}): Promise<AdvanceResponse[]> {
    return this.repo.findAll(filters);
  }

  async getById(id: number): Promise<AdvanceResponse | null> {
    return this.repo.findById(id);
  }

  async getRecoveries(id: number): Promise<AdvanceRecoveryResponse[]> {
    return this.repo.getRecoveries(id);
  }

  async getWithRecoveries(
    id: number,
  ): Promise<{ advance: AdvanceResponse; recoveries: AdvanceRecoveryResponse[] }> {
    const advance = await this.repo.findById(id);
    if (!advance) throw new Error('Advance not found');
    const recoveries = await this.repo.getRecoveries(id);
    return { advance, recoveries };
  }

  async create(payload: CreateAdvancePayload, userId: number): Promise<AdvanceResponse> {
    const employeeId = Number(payload.employeeId);
    const amount = round2(Number(payload.amount));
    const installmentAmount = round2(Number(payload.installmentAmount));
    const advanceDate = payload.advanceDate ? String(payload.advanceDate) : todayString();
    const advanceType: AdvanceType = payload.advanceType === 'LOAN' ? 'LOAN' : 'ADVANCE';

    if (!employeeId) throw new Error('An employee is required');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than zero');
    if (!Number.isFinite(installmentAmount) || installmentAmount <= 0) {
      throw new Error('Installment amount must be greater than zero');
    }
    if (installmentAmount > amount) throw new Error('Installment cannot exceed the advance amount');
    if (!isValidDateString(advanceDate)) throw new Error('advanceDate must be a valid YYYY-MM-DD date');

    const employee = await this.employeeRepo.findRowById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const id = await this.repo.create(
      { employeeId, advanceType, amount, advanceDate, reason: payload.reason ?? null, installmentAmount },
      userId,
    );

    const created = await this.repo.findById(id);
    if (!created) throw new Error('Advance could not be created');

    await this.notifications.notifyEmployee(employeeId, {
      category: 'PAYROLL',
      priority: 'NORMAL',
      title: advanceType === 'LOAN' ? 'A loan was recorded for you' : 'An advance was recorded for you',
      body: `₹${amount.toFixed(2)} dated ${advanceDate}, recovered at ₹${installmentAmount.toFixed(2)} per payroll run.`,
      linkPage: 'payroll',
      linkRefId: id,
      createdBy: userId,
    });

    await this.activityRepo.log({
      actorUserId: userId,
      employeeId,
      entityType: 'ADVANCE',
      entityId: id,
      action: 'CREATE',
      summary: `Recorded ${advanceType.toLowerCase()} of ₹${amount.toFixed(2)} for ${employee.full_name}`,
      meta: { advanceType, amount, installmentAmount, advanceDate },
    });

    return created;
  }

  async close(id: number, userId: number): Promise<AdvanceResponse> {
    const advance = await this.repo.findById(id);
    if (!advance) throw new Error('Advance not found');
    if (advance.status !== 'ACTIVE') throw new Error('Only active advances can be closed');

    await this.repo.close(id, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      employeeId: advance.employeeId,
      entityType: 'ADVANCE',
      entityId: id,
      action: 'CLOSE',
      summary: `Closed advance #${id} with ₹${advance.outstanding.toFixed(2)} outstanding`,
      meta: { outstanding: advance.outstanding },
    });

    const updated = await this.repo.findById(id);
    if (!updated) throw new Error('Advance not found');
    return updated;
  }

  async writeOff(id: number, userId: number): Promise<AdvanceResponse> {
    const advance = await this.repo.findById(id);
    if (!advance) throw new Error('Advance not found');
    if (advance.status !== 'ACTIVE') throw new Error('Only active advances can be written off');

    await this.repo.updateStatus(id, 'WRITTEN_OFF');
    await this.activityRepo.log({
      actorUserId: userId,
      employeeId: advance.employeeId,
      entityType: 'ADVANCE',
      entityId: id,
      action: 'WRITE_OFF',
      summary: `Wrote off ₹${advance.outstanding.toFixed(2)} outstanding on advance #${id}`,
      meta: { outstanding: advance.outstanding },
    });

    const updated = await this.repo.findById(id);
    if (!updated) throw new Error('Advance not found');
    return updated;
  }

  /**
   * Records an off-payroll repayment. The advance row is locked for the whole
   * check-then-write so two concurrent recoveries cannot together overshoot.
   */
  async addManualRecovery(
    advanceId: number,
    amount: number,
    recoveredOn: string,
    userId: number,
    remarks?: string | null,
  ): Promise<{ advance: AdvanceResponse; recoveries: AdvanceRecoveryResponse[] }> {
    const value = round2(Number(amount));
    const onDate = recoveredOn ? String(recoveredOn) : todayString();

    if (!Number.isFinite(value) || value <= 0) throw new Error('Amount must be greater than zero');
    if (!isValidDateString(onDate)) throw new Error('recoveredOn must be a valid YYYY-MM-DD date');

    await this.repo.withTransaction(async (conn) => {
      const row = await this.repo.findRowForUpdate(advanceId, conn);
      if (!row) throw new Error('Advance not found');
      if (row.status !== 'ACTIVE') throw new Error('Only active advances can be recovered against');

      const recovered = await this.repo.getRecoveredTotal(advanceId, conn);
      const outstanding = round2(Number(row.amount) - recovered);
      if (value > outstanding) {
        throw new Error(`Recovery exceeds the outstanding balance of ${outstanding.toFixed(2)}`);
      }

      await this.repo.insertRecovery(
        {
          advanceId,
          amount: value,
          recoveredOn: onDate,
          source: 'MANUAL',
          remarks: remarks ?? null,
        },
        userId,
        conn,
      );

      if (round2(outstanding - value) <= 0) {
        await this.repo.close(advanceId, userId, conn);
      }

      await this.activityRepo.log(
        {
          actorUserId: userId,
          employeeId: row.employee_id,
          entityType: 'ADVANCE',
          entityId: advanceId,
          action: 'RECOVERY',
          summary: `Manual recovery of ₹${value.toFixed(2)} against advance #${advanceId}`,
          meta: { amount: value, recoveredOn: onDate, remainingAfter: round2(outstanding - value) },
        },
        conn,
      );
    });

    return this.getWithRecoveries(advanceId);
  }

  /**
   * Projects the remaining installments from the outstanding balance. Pure
   * computation — nothing is written, and the final entry is the remainder.
   */
  async getSchedulePreview(id: number): Promise<AdvanceInstallment[]> {
    const advance = await this.repo.findById(id);
    if (!advance) throw new Error('Advance not found');

    const installment = round2(advance.installmentAmount);
    let remaining = round2(advance.outstanding);
    if (advance.status !== 'ACTIVE' || remaining <= 0 || installment <= 0) return [];

    const schedule: AdvanceInstallment[] = [];
    let seq = 1;
    while (remaining > 0 && seq <= MAX_PREVIEW_INSTALLMENTS) {
      const amount = round2(Math.min(installment, remaining));
      schedule.push({ seq, amount });
      remaining = round2(remaining - amount);
      seq++;
    }
    return schedule;
  }
}
