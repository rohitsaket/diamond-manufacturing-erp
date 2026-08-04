import {
  BenefitPlanInput,
  BenefitPlanResponse,
  ClaimFilters,
  ClaimStatus,
  CreateClaimInput,
  CreateLoanInput,
  DueInstallment,
  EmployeeBenefitResponse,
  EmployeeLoanResponse,
  EnrolBenefitInput,
  EnrolmentFilters,
  LoanFilters,
  PayrollLoanRepository,
  ReimbursementClaimResponse,
  ReimbursementTypeInput,
  ReimbursementTypeResponse,
} from '../repositories/PayrollLoanRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { NotificationService } from './NotificationService';
import { isValidDateString, monthBounds, round2, todayString } from '../utils/dateUtils';
import { buildAmortisationSchedule, computeEmi } from '../utils/payrollMath';

const LOAN_TYPES = [
  'PERSONAL', 'MEDICAL', 'EDUCATION', 'HOUSING', 'VEHICLE', 'EMERGENCY', 'OTHER',
];
const BENEFIT_TYPES = ['INSURANCE', 'MEDICAL', 'RETIREMENT', 'WELLNESS', 'FLEXIBLE', 'PERK'];

/** Roles that should hear about a loan or claim awaiting a decision. */
const FINANCE_ROLES = ['admin', 'accountant'];

const MAX_TENURE_MONTHS = 120;
const MAX_INTEREST_PCT = 36;

function requireText(value: unknown, message: string): string {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(message);
  return text;
}

function requireEnum(value: unknown, allowed: string[], label: string): string {
  const text = String(value ?? '').trim().toUpperCase();
  if (!allowed.includes(text)) throw new Error(`${label} must be one of ${allowed.join(', ')}`);
  return text;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** First day of the month after `from` — the default first EMI date. */
function firstOfNextMonth(from: string): string {
  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

function isDuplicateKey(err: any): boolean {
  return err?.code === 'ER_DUP_ENTRY' || Number(err?.errno) === 1062;
}

/**
 * Loans, reimbursements and benefits — the deduction and payout side of
 * payroll master data.
 *
 * Amortisation is never computed here: `computeEmi` and
 * `buildAmortisationSchedule` in `utils/payrollMath` are the single source of
 * truth, so a schedule generated at approval matches the figures the payroll
 * engine recovers month after month.
 */
export class PayrollLoanService {
  private repo = new PayrollLoanRepository();
  private activityRepo = new ActivityRepository();
  private notifications = new NotificationService();

  // =========================================================================
  // Loans
  // =========================================================================
  async listLoans(filters: LoanFilters = {}): Promise<EmployeeLoanResponse[]> {
    return this.repo.findLoans(filters);
  }

  /** A loan plus its full amortisation schedule. */
  async getLoan(id: number): Promise<EmployeeLoanResponse> {
    const loan = await this.repo.findLoanById(id);
    if (!loan) throw new Error('Loan not found');
    loan.schedule = await this.repo.findSchedule(id);
    return loan;
  }

  async createLoan(data: Partial<CreateLoanInput>, userId: number): Promise<EmployeeLoanResponse> {
    const employeeId = Math.floor(Number(data.employeeId));
    if (!Number.isFinite(employeeId) || employeeId <= 0) throw new Error('employeeId is required');

    const employee = await this.repo.findEmployeeBrief(employeeId);
    if (!employee) throw new Error('Employee not found');

    const principal = Number(data.principal);
    if (!Number.isFinite(principal) || principal <= 0) {
      throw new Error('principal must be greater than zero');
    }
    const tenureMonths = Math.floor(Number(data.tenureMonths));
    if (!Number.isFinite(tenureMonths) || tenureMonths < 1 || tenureMonths > MAX_TENURE_MONTHS) {
      throw new Error(`tenureMonths must be between 1 and ${MAX_TENURE_MONTHS}`);
    }
    const interestRatePct = Number(data.interestRatePct ?? 0);
    if (!Number.isFinite(interestRatePct) || interestRatePct < 0 || interestRatePct > MAX_INTEREST_PCT) {
      throw new Error(`interestRatePct must be between 0 and ${MAX_INTEREST_PCT}`);
    }

    const loanType = requireEnum(data.loanType ?? 'PERSONAL', LOAN_TYPES, 'loanType') as CreateLoanInput['loanType'];

    for (const key of ['disbursedOn', 'firstEmiDate'] as const) {
      const value = data[key];
      if (value !== undefined && value !== null && value !== '' && !isValidDateString(String(value))) {
        throw new Error(`${key} must be a valid YYYY-MM-DD date`);
      }
    }

    const emiAmount = round2(computeEmi(round2(principal), interestRatePct, tenureMonths));

    const id = await this.repo.createLoan(
      {
        employeeId,
        loanType,
        principal: round2(principal),
        interestRatePct,
        tenureMonths,
        emiAmount,
        currency: data.currency ? String(data.currency).toUpperCase() : 'INR',
        disbursedOn: data.disbursedOn ? String(data.disbursedOn) : null,
        firstEmiDate: data.firstEmiDate ? String(data.firstEmiDate) : null,
        purpose: data.purpose ? String(data.purpose).trim().slice(0, 500) : null,
        status: 'PENDING_APPROVAL',
      },
      userId,
    );

    await this.notifications.notifyRoles(FINANCE_ROLES, {
      category: 'PAYROLL',
      priority: 'NORMAL',
      title: `Loan request from ${employee.fullName}`,
      body: `${loanType} loan of ${round2(principal)} over ${tenureMonths} month(s); EMI ${emiAmount}.`,
      linkPage: 'payroll',
      linkRefId: id,
      createdBy: userId,
    });

    await this.activityRepo.log({
      actorUserId: userId,
      employeeId,
      entityType: 'EMPLOYEE_LOAN',
      entityId: id,
      action: 'CREATE',
      summary: `Raised a ${loanType} loan of ${round2(principal)} for ${employee.fullName}`,
      meta: { principal: round2(principal), tenureMonths, interestRatePct, emiAmount },
    });

    return this.getLoan(id);
  }

  /**
   * Approves a loan and materialises its whole EMI schedule in one
   * transaction, so an approved loan always has installments to recover.
   */
  async approveLoan(id: number, userId: number, actorName?: string): Promise<EmployeeLoanResponse> {
    const outcome = await this.repo.withTransaction(async (conn) => {
      const loan = await this.repo.findLoanRowById(id, conn);
      if (!loan) throw new Error('Loan not found');
      if (loan.status !== 'DRAFT' && loan.status !== 'PENDING_APPROVAL') {
        throw new Error('Only draft or pending loans can be approved');
      }

      const principal = Number(loan.principal);
      const rate = Number(loan.interest_rate_pct ?? 0);
      const tenure = Math.floor(Number(loan.tenure_months));
      const firstEmiDate = loan.first_emi_date
        ? String(loan.first_emi_date).slice(0, 10)
        : firstOfNextMonth(todayString());

      const emiAmount = round2(computeEmi(principal, rate, tenure));
      const schedule = buildAmortisationSchedule(principal, rate, tenure, firstEmiDate).map((row) => ({
        seq: row.seq,
        dueDate: row.dueDate,
        principalComponent: round2(row.principalComponent),
        interestComponent: round2(row.interestComponent),
        emiAmount: round2(row.emiAmount),
        outstandingAfter: round2(row.outstandingAfter),
      }));

      // A re-approval must not leave stale rows behind.
      await this.repo.deleteSchedule(id, conn);
      await this.repo.insertSchedule(id, schedule, conn);
      await this.repo.setLoanStatus(id, 'ACTIVE', userId, conn, {
        emiAmount,
        firstEmiDate,
        disbursedOn: loan.disbursed_on ? String(loan.disbursed_on).slice(0, 10) : todayString(),
      });

      await this.activityRepo.log(
        {
          actorUserId: userId,
          actorName: actorName ?? null,
          employeeId: Number(loan.employee_id),
          entityType: 'EMPLOYEE_LOAN',
          entityId: id,
          action: 'APPROVE',
          summary: `Approved loan ${id}: ${schedule.length} installment(s) of ${emiAmount} from ${firstEmiDate}`,
          meta: { emiAmount, firstEmiDate, installments: schedule.length },
        },
        conn,
      );

      return { employeeId: Number(loan.employee_id), emiAmount, firstEmiDate, count: schedule.length };
    });

    await this.notifications.notifyEmployee(outcome.employeeId, {
      category: 'PAYROLL',
      priority: 'NORMAL',
      title: 'Your loan was approved',
      body: `${outcome.count} monthly installment(s) of ${outcome.emiAmount} starting ${outcome.firstEmiDate}.`,
      linkPage: 'payroll',
      linkRefId: id,
      email: true,
      createdBy: userId,
    });

    return this.getLoan(id);
  }

  async rejectLoan(id: number, userId: number, reason: string): Promise<EmployeeLoanResponse> {
    const note = requireText(reason, 'A rejection reason is required');

    const loan = await this.repo.findLoanById(id);
    if (!loan) throw new Error('Loan not found');
    if (loan.status !== 'DRAFT' && loan.status !== 'PENDING_APPROVAL') {
      throw new Error('Only draft or pending loans can be rejected');
    }

    await this.repo.setLoanStatus(id, 'REJECTED', userId);

    await this.notifications.notifyEmployee(loan.employeeId, {
      category: 'PAYROLL',
      priority: 'HIGH',
      title: 'Your loan request was rejected',
      body: `${loan.loanType} loan of ${loan.principal}. Reason: ${note}`,
      linkPage: 'payroll',
      linkRefId: id,
      createdBy: userId,
    });

    await this.activityRepo.log({
      actorUserId: userId,
      employeeId: loan.employeeId,
      entityType: 'EMPLOYEE_LOAN',
      entityId: id,
      action: 'REJECT',
      summary: `Rejected loan ${id}`,
      meta: { reason: note },
    });

    return this.getLoan(id);
  }

  /** Waives every pending installment and closes the loan. */
  async forecloseLoan(id: number, userId: number): Promise<EmployeeLoanResponse> {
    await this.repo.withTransaction(async (conn) => {
      const loan = await this.repo.findLoanRowById(id, conn);
      if (!loan) throw new Error('Loan not found');
      if (loan.status !== 'ACTIVE' && loan.status !== 'APPROVED') {
        throw new Error('Only an active loan can be foreclosed');
      }

      const count = await this.repo.waivePendingInstallments(id, conn);
      await this.repo.setLoanStatus(id, 'FORECLOSED', userId, conn);

      await this.activityRepo.log(
        {
          actorUserId: userId,
          employeeId: Number(loan.employee_id),
          entityType: 'EMPLOYEE_LOAN',
          entityId: id,
          action: 'FORECLOSE',
          summary: `Foreclosed loan ${id}, waiving ${count} pending installment(s)`,
          meta: { waived: count },
        },
        conn,
      );
    });

    return this.getLoan(id);
  }

  /**
   * Applies an off-payroll repayment to the oldest pending installments.
   * Capped at the outstanding balance so a loan can never go negative.
   */
  async recordManualRepayment(
    loanId: number,
    amount: number,
    date: string,
    userId: number,
  ): Promise<EmployeeLoanResponse> {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new Error('amount must be greater than zero');

    const paidOn = String(date ?? '').trim() || todayString();
    if (!isValidDateString(paidOn)) throw new Error('date must be a valid YYYY-MM-DD date');

    await this.repo.withTransaction(async (conn) => {
      const loan = await this.repo.findLoanRowById(loanId, conn);
      if (!loan) throw new Error('Loan not found');
      if (loan.status !== 'ACTIVE' && loan.status !== 'APPROVED') {
        throw new Error('Only an active loan can accept a repayment');
      }

      const pending = await this.repo.findPendingInstallments(loanId, conn);
      const outstanding = round2(
        pending.reduce(
          (sum, i) => sum + (Number(i.emi_amount ?? 0) - Number(i.recovered_amount ?? 0)),
          0,
        ),
      );
      if (outstanding <= 0) throw new Error('This loan has no outstanding installments');

      const payment = round2(value);
      if (payment > outstanding) {
        throw new Error(`Repayment exceeds the outstanding balance of ${outstanding}`);
      }

      let left = payment;
      for (const installment of pending) {
        if (left <= 0) break;
        const due = round2(Number(installment.emi_amount ?? 0) - Number(installment.recovered_amount ?? 0));
        if (due <= 0) continue;
        const applied = round2(Math.min(left, due));
        await this.repo.applyRepayment(
          Number(installment.id),
          applied,
          paidOn,
          applied >= due,
          conn,
        );
        left = round2(left - applied);
      }

      const stillPending = await this.repo.findPendingInstallments(loanId, conn);
      if (stillPending.length === 0) {
        await this.repo.setLoanStatus(loanId, 'CLOSED', userId, conn);
      }

      await this.activityRepo.log(
        {
          actorUserId: userId,
          employeeId: Number(loan.employee_id),
          entityType: 'EMPLOYEE_LOAN',
          entityId: loanId,
          action: 'REPAYMENT',
          summary: `Recorded a manual repayment of ${payment} on loan ${loanId}`,
          meta: { amount: payment, date: paidOn, outstandingBefore: outstanding },
        },
        conn,
      );
    });

    return this.getLoan(loanId);
  }

  /** PENDING installments due on or before a date — consumed by the engine. */
  async getDueInstallments(periodId: number | null, dueBy: string): Promise<DueInstallment[]> {
    const cutoff = String(dueBy ?? '').trim() || todayString();
    if (!isValidDateString(cutoff)) throw new Error('dueBy must be a valid YYYY-MM-DD date');
    return this.repo.getDueInstallments(periodId, cutoff);
  }

  /** Marks installments recovered; accepts the engine's own connection. */
  async markInstallmentsRecovered(
    installmentIds: number[],
    salaryLineId: number | null,
    periodId: number | null,
    conn?: any,
  ): Promise<number> {
    return this.repo.markInstallmentsRecovered(installmentIds, salaryLineId, periodId, conn);
  }

  // =========================================================================
  // Reimbursement types
  // =========================================================================
  async listReimbursementTypes(isActive?: boolean): Promise<ReimbursementTypeResponse[]> {
    return this.repo.findReimbursementTypes(isActive);
  }

  async createReimbursementType(
    data: ReimbursementTypeInput,
    userId: number,
  ): Promise<ReimbursementTypeResponse> {
    const payload = this.validateReimbursementType(data, true);

    const clash = await this.repo.findReimbursementTypeByCode(payload.code as string);
    if (clash) throw new Error(`Reimbursement type ${payload.code} already exists`);

    const id = await this.repo.createReimbursementType(payload);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'REIMBURSEMENT_TYPE',
      entityId: id,
      action: 'CREATE',
      summary: `Created reimbursement type ${payload.code}`,
    });
    return this.getReimbursementType(id);
  }

  async updateReimbursementType(
    id: number,
    data: ReimbursementTypeInput,
    userId: number,
  ): Promise<ReimbursementTypeResponse> {
    const existing = await this.repo.findReimbursementTypeById(id);
    if (!existing) throw new Error('Reimbursement type not found');

    const payload = this.validateReimbursementType(data, false);
    if (payload.code !== undefined && payload.code !== existing.code) {
      const clash = await this.repo.findReimbursementTypeByCode(payload.code);
      if (clash && Number(clash.id) !== id) {
        throw new Error(`Reimbursement type ${payload.code} already exists`);
      }
    }

    await this.repo.updateReimbursementType(id, payload);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'REIMBURSEMENT_TYPE',
      entityId: id,
      action: 'UPDATE',
      summary: `Updated reimbursement type ${existing.code}`,
    });
    return this.getReimbursementType(id);
  }

  private async getReimbursementType(id: number): Promise<ReimbursementTypeResponse> {
    const types = await this.repo.findReimbursementTypes();
    const found = types.find((t) => t.id === id);
    if (!found) throw new Error('Reimbursement type not found');
    return found;
  }

  private validateReimbursementType(
    data: ReimbursementTypeInput,
    isCreate: boolean,
  ): ReimbursementTypeInput {
    const out: ReimbursementTypeInput = {};

    if (data.code !== undefined || isCreate) {
      out.code = requireText(data.code, 'A reimbursement type code is required').toUpperCase();
    }
    if (data.name !== undefined || isCreate) {
      out.name = requireText(data.name, 'A reimbursement type name is required');
    }
    for (const key of ['annualLimit', 'monthlyLimit'] as const) {
      if (data[key] === undefined) continue;
      const value = optionalNumber(data[key]);
      if (value !== null && value <= 0) throw new Error(`${key} must be greater than zero`);
      out[key] = value;
    }
    if (data.componentId !== undefined) {
      out.componentId = data.componentId ? Math.floor(Number(data.componentId)) : null;
    }
    if (data.requiresReceipt !== undefined) out.requiresReceipt = !!data.requiresReceipt;
    if (data.isTaxable !== undefined) out.isTaxable = !!data.isTaxable;
    if (data.isActive !== undefined) out.isActive = !!data.isActive;

    return out;
  }

  // =========================================================================
  // Reimbursement claims
  // =========================================================================
  async listClaims(filters: ClaimFilters = {}): Promise<ReimbursementClaimResponse[]> {
    return this.repo.findClaims(filters);
  }

  async getClaim(id: number): Promise<ReimbursementClaimResponse> {
    const claim = await this.repo.findClaimById(id);
    if (!claim) throw new Error('Reimbursement claim not found');
    return claim;
  }

  /**
   * Files a claim after checking it against the type's monthly and annual
   * limits. The claim number is allocated inside the insert transaction, with
   * one retry so two concurrent filings on the same day cannot collide.
   */
  async createClaim(
    data: Partial<CreateClaimInput>,
    userId: number,
  ): Promise<ReimbursementClaimResponse> {
    const employeeId = Math.floor(Number(data.employeeId));
    if (!Number.isFinite(employeeId) || employeeId <= 0) throw new Error('employeeId is required');

    const employee = await this.repo.findEmployeeBrief(employeeId);
    if (!employee) throw new Error('Employee not found');

    const typeId = Math.floor(Number(data.typeId));
    if (!Number.isFinite(typeId) || typeId <= 0) throw new Error('typeId is required');

    const type = await this.repo.findReimbursementTypeById(typeId);
    if (!type) throw new Error('Reimbursement type not found');
    if (!type.is_active) throw new Error(`${type.name} is no longer accepting claims`);

    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be greater than zero');

    const expenseDate = requireText(data.expenseDate, 'expenseDate is required');
    if (!isValidDateString(expenseDate)) {
      throw new Error('expenseDate must be a valid YYYY-MM-DD date');
    }

    const claimAmount = round2(amount);

    const monthlyLimit = type.monthly_limit === null ? null : Number(type.monthly_limit);
    if (monthlyLimit !== null) {
      const { from, to } = monthBounds(expenseDate.slice(0, 7));
      const used = await this.repo.sumClaimedBetween(employeeId, typeId, from, to);
      if (round2(used + claimAmount) > monthlyLimit) {
        throw new Error(`This claim exceeds the monthly limit of ${monthlyLimit} for ${type.name}`);
      }
    }

    const annualLimit = type.annual_limit === null ? null : Number(type.annual_limit);
    if (annualLimit !== null) {
      const year = expenseDate.slice(0, 4);
      const used = await this.repo.sumClaimedBetween(employeeId, typeId, `${year}-01-01`, `${year}-12-31`);
      if (round2(used + claimAmount) > annualLimit) {
        throw new Error(`This claim exceeds the annual limit of ${annualLimit} for ${type.name}`);
      }
    }

    const payload: CreateClaimInput = {
      employeeId,
      typeId,
      amount: claimAmount,
      currency: data.currency ? String(data.currency).toUpperCase() : 'INR',
      expenseDate,
      description: data.description ? String(data.description).trim().slice(0, 500) : null,
      documentId: data.documentId ? Math.floor(Number(data.documentId)) : null,
      status: 'SUBMITTED',
    };

    let id: number;
    try {
      id = await this.insertClaimWithNumber(payload, userId);
    } catch (err: any) {
      if (!isDuplicateKey(err)) throw err;
      id = await this.insertClaimWithNumber(payload, userId);
    }

    await this.notifications.notifyRoles(['admin', 'accountant', 'hr'], {
      category: 'PAYROLL',
      priority: 'NORMAL',
      title: `Reimbursement claim from ${employee.fullName}`,
      body: `${type.name}: ${claimAmount} for ${expenseDate}.`,
      linkPage: 'payroll',
      linkRefId: id,
      createdBy: userId,
    });

    await this.activityRepo.log({
      actorUserId: userId,
      employeeId,
      entityType: 'REIMBURSEMENT_CLAIM',
      entityId: id,
      action: 'CREATE',
      summary: `Filed a ${type.code} claim of ${claimAmount} for ${employee.fullName}`,
      meta: { typeId, amount: claimAmount, expenseDate },
    });

    return this.getClaim(id);
  }

  private async insertClaimWithNumber(data: CreateClaimInput, userId: number): Promise<number> {
    return this.repo.withTransaction(async (conn) => {
      const datePart = todayString().replace(/-/g, '');
      const seq = await this.repo.nextClaimSequence(datePart, conn);
      const claimNo = `RMB-${datePart}-${String(seq).padStart(4, '0')}`;
      return this.repo.insertClaim(claimNo, data, userId, conn);
    });
  }

  async decideClaim(
    id: number,
    status: string,
    userId: number,
    note: string | null,
    approvedAmount?: number | null,
  ): Promise<ReimbursementClaimResponse> {
    const decision = String(status ?? '').trim().toUpperCase();
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new Error('status must be APPROVED or REJECTED');
    }

    const claim = await this.repo.findClaimById(id);
    if (!claim) throw new Error('Reimbursement claim not found');
    if (!['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL'].includes(claim.status)) {
      throw new Error('Only a submitted claim can be decided');
    }
    if (decision === 'REJECTED' && !String(note ?? '').trim()) {
      throw new Error('A rejection note is required');
    }

    let settled: number | null = null;
    if (decision === 'APPROVED') {
      const requested = optionalNumber(approvedAmount);
      settled = requested === null ? claim.amount : round2(requested);
      if (settled <= 0) throw new Error('approvedAmount must be greater than zero');
      if (settled > claim.amount) throw new Error('approvedAmount cannot exceed the claimed amount');
    }

    await this.repo.decideClaim(
      id,
      decision as ClaimStatus,
      userId,
      note ? String(note).trim().slice(0, 500) : null,
      settled,
    );

    await this.notifications.notifyEmployee(claim.employeeId, {
      category: 'PAYROLL',
      priority: decision === 'APPROVED' ? 'NORMAL' : 'HIGH',
      title: `Your reimbursement claim was ${decision.toLowerCase()}`,
      body:
        decision === 'APPROVED'
          ? `${claim.claimNo}: ${settled} approved for payout.`
          : `${claim.claimNo} was rejected. ${note ?? ''}`.trim(),
      linkPage: 'payroll',
      linkRefId: id,
      email: true,
      createdBy: userId,
    });

    await this.activityRepo.log({
      actorUserId: userId,
      employeeId: claim.employeeId,
      entityType: 'REIMBURSEMENT_CLAIM',
      entityId: id,
      action: decision,
      summary: `${decision === 'APPROVED' ? 'Approved' : 'Rejected'} claim ${claim.claimNo}`,
      meta: { approvedAmount: settled, note: note ?? null },
    });

    return this.getClaim(id);
  }

  async markClaimsPaid(
    ids: number[],
    periodId: number | null,
    userId: number,
  ): Promise<{ updated: number }> {
    if (!Array.isArray(ids) || ids.length === 0) throw new Error('At least one claim id is required');
    const updated = await this.repo.markClaimsPaid(ids, periodId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'REIMBURSEMENT_CLAIM',
      action: 'MARK_PAID',
      summary: `Marked ${updated} reimbursement claim(s) as paid`,
      meta: { periodId, ids },
    });
    return { updated };
  }

  /** Approved claims the payroll engine should pay in a period. */
  async getApprovedForPeriod(periodId: number): Promise<ReimbursementClaimResponse[]> {
    return this.repo.getApprovedForPeriod(periodId);
  }

  // =========================================================================
  // Benefits
  // =========================================================================
  async listBenefitPlans(isActive?: boolean): Promise<BenefitPlanResponse[]> {
    return this.repo.findBenefitPlans(isActive);
  }

  async createBenefitPlan(data: BenefitPlanInput, userId: number): Promise<BenefitPlanResponse> {
    const payload = this.validateBenefitPlan(data, true);

    const clash = await this.repo.findBenefitPlanByCode(payload.code as string);
    if (clash) throw new Error(`Benefit plan ${payload.code} already exists`);

    const id = await this.repo.createBenefitPlan(payload, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'BENEFIT_PLAN',
      entityId: id,
      action: 'CREATE',
      summary: `Created benefit plan ${payload.code}`,
    });
    return this.getBenefitPlan(id);
  }

  async updateBenefitPlan(
    id: number,
    data: BenefitPlanInput,
    userId: number,
  ): Promise<BenefitPlanResponse> {
    const existing = await this.repo.findBenefitPlanById(id);
    if (!existing) throw new Error('Benefit plan not found');

    const payload = this.validateBenefitPlan(data, false);
    if (payload.code !== undefined && payload.code !== existing.code) {
      const clash = await this.repo.findBenefitPlanByCode(payload.code);
      if (clash && Number(clash.id) !== id) throw new Error(`Benefit plan ${payload.code} already exists`);
    }

    await this.repo.updateBenefitPlan(id, payload);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'BENEFIT_PLAN',
      entityId: id,
      action: 'UPDATE',
      summary: `Updated benefit plan ${existing.code}`,
    });
    return this.getBenefitPlan(id);
  }

  private async getBenefitPlan(id: number): Promise<BenefitPlanResponse> {
    const plans = await this.repo.findBenefitPlans();
    const found = plans.find((p) => p.id === id);
    if (!found) throw new Error('Benefit plan not found');
    return found;
  }

  private validateBenefitPlan(data: BenefitPlanInput, isCreate: boolean): BenefitPlanInput {
    const out: BenefitPlanInput = {};

    if (data.code !== undefined || isCreate) {
      out.code = requireText(data.code, 'A benefit plan code is required').toUpperCase();
    }
    if (data.name !== undefined || isCreate) {
      out.name = requireText(data.name, 'A benefit plan name is required');
    }
    if (data.benefitType !== undefined || isCreate) {
      out.benefitType = requireEnum(
        data.benefitType ?? 'INSURANCE',
        BENEFIT_TYPES,
        'benefitType',
      ) as BenefitPlanInput['benefitType'];
    }
    for (const key of ['employerContribution', 'employeeContribution'] as const) {
      if (data[key] === undefined) continue;
      const value = Number(data[key]);
      if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be zero or more`);
      out[key] = round2(value);
    }
    if (data.coverageAmount !== undefined) {
      const value = optionalNumber(data.coverageAmount);
      if (value !== null && value <= 0) throw new Error('coverageAmount must be greater than zero');
      out.coverageAmount = value;
    }
    for (const key of ['effectiveFrom', 'effectiveTo'] as const) {
      if (data[key] === undefined) continue;
      if (!data[key]) {
        out[key] = null;
        continue;
      }
      const value = String(data[key]);
      if (!isValidDateString(value)) throw new Error(`${key} must be a valid YYYY-MM-DD date`);
      out[key] = value;
    }
    if (out.effectiveFrom && out.effectiveTo && out.effectiveTo <= out.effectiveFrom) {
      throw new Error('effectiveTo must be after effectiveFrom');
    }
    if (data.componentId !== undefined) {
      out.componentId = data.componentId ? Math.floor(Number(data.componentId)) : null;
    }
    if (data.provider !== undefined) out.provider = data.provider ? String(data.provider).trim() : null;
    if (data.description !== undefined) {
      out.description = data.description ? String(data.description).trim().slice(0, 1000) : null;
    }
    if (data.currency !== undefined) out.currency = String(data.currency).trim().toUpperCase();
    if (data.isActive !== undefined) out.isActive = !!data.isActive;

    return out;
  }

  async enrol(
    employeeId: number,
    planId: number,
    data: EnrolBenefitInput,
    userId: number,
  ): Promise<EmployeeBenefitResponse> {
    const employee = await this.repo.findEmployeeBrief(employeeId);
    if (!employee) throw new Error('Employee not found');

    const plan = await this.repo.findBenefitPlanById(planId);
    if (!plan) throw new Error('Benefit plan not found');
    if (!plan.is_active) throw new Error(`${plan.name} is no longer open for enrolment`);

    const existing = await this.repo.findActiveEnrolment(employeeId, planId);
    if (existing) throw new Error(`${employee.fullName} is already enrolled in ${plan.name}`);

    const enrolledOn = String(data.enrolledOn ?? '').trim() || todayString();
    if (!isValidDateString(enrolledOn)) {
      throw new Error('enrolledOn must be a valid YYYY-MM-DD date');
    }

    const employeeContribution = optionalNumber(data.employeeContribution);
    const employerContribution = optionalNumber(data.employerContribution);
    if (employeeContribution !== null && employeeContribution < 0) {
      throw new Error('employeeContribution must be zero or more');
    }
    if (employerContribution !== null && employerContribution < 0) {
      throw new Error('employerContribution must be zero or more');
    }

    const id = await this.repo.createEnrolment(
      employeeId,
      planId,
      {
        enrolledOn,
        nomineeName: data.nomineeName ? String(data.nomineeName).trim() : null,
        policyNumber: data.policyNumber ? String(data.policyNumber).trim() : null,
        // Fall back to the plan's standard contributions.
        employeeContribution: employeeContribution ?? Number(plan.employee_contribution ?? 0),
        employerContribution: employerContribution ?? Number(plan.employer_contribution ?? 0),
      },
      userId,
    );

    await this.activityRepo.log({
      actorUserId: userId,
      employeeId,
      entityType: 'EMPLOYEE_BENEFIT',
      entityId: id,
      action: 'ENROL',
      summary: `Enrolled ${employee.fullName} in ${plan.name} from ${enrolledOn}`,
      meta: { planId, enrolledOn },
    });

    const created = await this.repo.findEnrolmentById(id);
    if (!created) throw new Error('Enrolment could not be created');
    return created;
  }

  async endEnrolment(id: number, endedOn: string, userId: number): Promise<EmployeeBenefitResponse> {
    const enrolment = await this.repo.findEnrolmentById(id);
    if (!enrolment) throw new Error('Enrolment not found');
    if (enrolment.status === 'ENDED') throw new Error('This enrolment has already ended');

    const endDate = String(endedOn ?? '').trim() || todayString();
    if (!isValidDateString(endDate)) throw new Error('endedOn must be a valid YYYY-MM-DD date');
    if (endDate < enrolment.enrolledOn) {
      throw new Error('endedOn cannot be before the enrolment date');
    }

    await this.repo.endEnrolment(id, endDate);
    await this.activityRepo.log({
      actorUserId: userId,
      employeeId: enrolment.employeeId,
      entityType: 'EMPLOYEE_BENEFIT',
      entityId: id,
      action: 'END',
      summary: `Ended enrolment in ${enrolment.planName ?? 'a benefit plan'} on ${endDate}`,
    });

    const updated = await this.repo.findEnrolmentById(id);
    if (!updated) throw new Error('Enrolment not found');
    return updated;
  }

  async listForEmployee(employeeId: number): Promise<EmployeeBenefitResponse[]> {
    return this.repo.findEnrolments({ employeeId });
  }

  async listEnrolments(filters: EnrolmentFilters = {}): Promise<EmployeeBenefitResponse[]> {
    return this.repo.findEnrolments(filters);
  }
}
