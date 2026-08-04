import {
  HraDeclarationRow,
  HraRowInput,
  ProofReviewStatus,
  ProofType,
  TaxProofRepository,
  TaxProofResponse,
  fyBounds,
} from '../repositories/TaxProofRepository';
import { ComplianceRepository } from '../repositories/ComplianceRepository';
import { NotificationService } from './NotificationService';
import { round2 } from '../utils/dateUtils';

export interface SubmitProofInput {
  declarationItemId?: number | null;
  proofType?: ProofType;
  title: string;
  claimedAmount: number;
  documentId?: number | null;
  financialYear: string;
}

export interface ReviewProofInput {
  status: ProofReviewStatus;
  verifiedAmount?: number;
  note?: string | null;
}

export interface HraWorkingRow {
  fromMonth: string;
  toMonth: string;
  months: number;
  city: string | null;
  isMetro: boolean;
  monthlyRent: number;
  rentPaid: number;
  salaryForPeriod: number;
  hraReceivedForPeriod: number;
  rentMinusTenPercentOfSalary: number;
  percentOfSalaryCap: number;
  capRatePct: number;
  leastOfThree: number;
  exemption: number;
  landlordPan: string | null;
  panRequired: boolean;
  panMissing: boolean;
}

export interface HraExemptionResult {
  available: boolean;
  reason?: string;
  employeeId: number;
  financialYear: string;
  basis: {
    annualSalaryForHra: number;
    annualHraReceived: number;
    monthsOnRecord: number;
    source: string;
    definition: string;
  };
  rows: HraWorkingRow[];
  totals: { annualRentPaid: number; exemption: number; panRequired: boolean; panMissingRows: number };
  rule: string;
  caveats: string[];
}

const PAN_THRESHOLD = 100000;
const METRO_RATE = 50;
const NON_METRO_RATE = 40;

const LEAST_OF_THREE_RULE =
  'The exemption is the least of: the HRA actually received, the rent paid less 10% of salary, and '
  + `${METRO_RATE}% of salary in a metro or ${NON_METRO_RATE}% elsewhere. "Salary" for this purpose is basic pay plus `
  + 'dearness allowance, and each rent period is worked out on its own share of the year.';

/** Inclusive month count between two `YYYY-MM` keys. */
function monthsBetween(fromMonth: string, toMonth: string): number {
  const fy = Number(fromMonth.slice(0, 4));
  const fm = Number(fromMonth.slice(5, 7));
  const ty = Number(toMonth.slice(0, 4));
  const tm = Number(toMonth.slice(5, 7));
  if (![fy, fm, ty, tm].every(Number.isFinite)) return 0;
  return (ty * 12 + tm) - (fy * 12 + fm) + 1;
}

/**
 * Investment proofs and HRA rent declarations.
 *
 * Approving a proof is not just a status change: the verified amount is written
 * back onto the declaration item's `approved_amount`, because the tax engine
 * only ever spends approved amounts. A partial approval says so explicitly
 * rather than silently approving less than was claimed.
 */
export class TaxProofService {
  private repo = new TaxProofRepository();
  private audit = new ComplianceRepository();
  private notifications = new NotificationService();

  // -------------------------------------------------------------------------
  // Proofs
  // -------------------------------------------------------------------------

  async listProofs(filters: {
    employeeId?: number;
    financialYear?: string;
    status?: string;
    proofType?: string;
    limit?: number;
  } = {}): Promise<TaxProofResponse[]> {
    const fy = filters.financialYear ? this.normaliseFy(filters.financialYear) : undefined;
    return this.repo.listProofs({ ...filters, financialYear: fy });
  }

  async getProof(id: number): Promise<TaxProofResponse> {
    const proof = await this.repo.findProofById(id);
    if (!proof) throw new Error('Tax proof not found');
    return proof;
  }

  async submitProof(employeeId: number, data: SubmitProofInput, userId: number): Promise<TaxProofResponse> {
    const fy = this.normaliseFy(data.financialYear);
    if (!data.title || !String(data.title).trim()) throw new Error('A proof needs a title');
    const claimed = round2(Number(data.claimedAmount ?? 0));
    if (!Number.isFinite(claimed) || claimed < 0) throw new Error('Claimed amount must be a non-negative number');

    let declarationItemId: number | null = null;
    let declarationId: number;

    if (data.declarationItemId) {
      const item = await this.repo.findDeclarationItem(Number(data.declarationItemId));
      if (!item) throw new Error('Declaration item not found');
      if (item.employeeId !== employeeId) throw new Error('That declaration item belongs to another employee');
      if (item.financialYear !== fy) throw new Error('That declaration item belongs to another financial year');
      declarationItemId = item.id;
      declarationId = item.declarationId;
    } else {
      declarationId = await this.repo.ensureDeclaration(employeeId, fy);
    }

    if (data.documentId) {
      const exists = await this.repo.documentExists(Number(data.documentId));
      if (!exists) throw new Error('The uploaded document could not be found');
    }

    const id = await this.repo.createProof({
      declarationId,
      declarationItemId,
      employeeId,
      financialYear: fy,
      proofType: (data.proofType ?? 'INVESTMENT') as ProofType,
      title: String(data.title).trim().slice(0, 200),
      claimedAmount: claimed,
      documentId: data.documentId ?? null,
    });

    await this.audit.logAudit({
      entityType: 'tax_proofs',
      entityId: id,
      action: 'SUBMIT',
      summary: `Proof "${String(data.title).slice(0, 100)}" submitted for employee ${employeeId} (${fy}) claiming ${claimed}`,
      actorUserId: userId,
    });

    await this.notifications.notifyRoles(['admin', 'accountant', 'hr'], {
      category: 'PAYROLL',
      priority: 'NORMAL',
      title: 'Investment proof submitted for review',
      body: `${String(data.title).slice(0, 200)} claiming ${claimed} for ${fy}.`,
      linkPage: 'compliance',
      linkRefId: id,
    });

    return this.getProof(id);
  }

  /**
   * A partial approval is its own status. Approving less than was claimed
   * without saying so would leave the employee's payslip unexplainable.
   */
  async reviewProof(id: number, input: ReviewProofInput, userId: number): Promise<TaxProofResponse> {
    const proof = await this.getProof(id);
    const requested = String(input.status ?? '').toUpperCase();
    const allowed: ProofReviewStatus[] = ['UNDER_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED'];
    if (!allowed.includes(requested as ProofReviewStatus)) {
      throw new Error(`Status must be one of ${allowed.join(', ')}`);
    }

    let status = requested as ProofReviewStatus;
    let verified = input.verifiedAmount === undefined || input.verifiedAmount === null
      ? (status === 'APPROVED' ? proof.claimedAmount : 0)
      : round2(Number(input.verifiedAmount));
    if (!Number.isFinite(verified) || verified < 0) throw new Error('Verified amount must be a non-negative number');
    if (verified > proof.claimedAmount) throw new Error('Verified amount cannot exceed the amount claimed');

    if (status === 'APPROVED' && verified < proof.claimedAmount) {
      status = 'PARTIALLY_APPROVED';
    }
    if (status === 'REJECTED') verified = 0;

    await this.repo.reviewProof(id, {
      status,
      verifiedAmount: verified,
      note: input.note ? String(input.note).slice(0, 500) : null,
      reviewedBy: userId,
    });

    // The declaration item is what the tax engine reads, so the verified figure
    // has to land there too.
    if (proof.declarationItemId) {
      const item = await this.repo.findDeclarationItem(proof.declarationItemId);
      if (item) {
        const capped = item.maxLimit !== null ? Math.min(verified, item.maxLimit) : verified;
        const itemStatus = status === 'REJECTED' ? 'REJECTED' : capped > 0 ? 'APPROVED' : 'SUBMITTED';
        await this.repo.setItemApprovedAmount(item.id, round2(capped), itemStatus);
      }
    }

    await this.audit.logAudit({
      entityType: 'tax_proofs',
      entityId: id,
      action: 'REVIEW',
      summary: `Proof "${proof.title}" reviewed as ${status} with ${verified} verified against ${proof.claimedAmount} claimed`,
      fieldName: 'status',
      previousValue: proof.status,
      newValue: status,
      actorUserId: userId,
    });

    await this.notifications.notifyEmployee(proof.employeeId, {
      category: 'PAYROLL',
      priority: 'NORMAL',
      title: `Investment proof ${status.toLowerCase().replace('_', ' ')}`,
      body: `"${proof.title}": ${verified} of ${proof.claimedAmount} accepted.`
        + `${input.note ? ` ${String(input.note).slice(0, 200)}` : ''}`,
      linkPage: 'compliance',
      linkRefId: id,
    });

    return this.getProof(id);
  }

  /**
   * Bulk review is deliberately all-or-nothing per proof: it can approve in
   * full or reject outright, but a partial amount has to be entered one proof
   * at a time, because there is no sensible bulk answer to "how much".
   */
  async bulkReview(ids: number[], status: string, userId: number): Promise<{
    requested: number;
    updated: number;
    status: ProofReviewStatus;
    skipped: { id: number; reason: string }[];
  }> {
    const clean = (Array.isArray(ids) ? ids : [])
      .map((id) => Math.floor(Number(id)))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (clean.length === 0) throw new Error('At least one proof id is required');

    const requested = String(status ?? '').toUpperCase();
    const allowed: ProofReviewStatus[] = ['UNDER_REVIEW', 'APPROVED', 'REJECTED'];
    if (!allowed.includes(requested as ProofReviewStatus)) {
      throw new Error(`Bulk review accepts only ${allowed.join(', ')}; a partial approval must be reviewed individually`);
    }
    const target = requested as ProofReviewStatus;

    const proofs = await this.repo.findProofsByIds(clean);
    const found = new Set(proofs.map((p) => p.id));
    const skipped = clean.filter((id) => !found.has(id)).map((id) => ({ id, reason: 'Proof not found' }));

    const updated = await this.repo.bulkSetStatus(proofs.map((p) => p.id), target, userId);

    if (target !== 'UNDER_REVIEW') {
      for (const proof of proofs) {
        if (!proof.declarationItemId) continue;
        const item = await this.repo.findDeclarationItem(proof.declarationItemId);
        if (!item) continue;
        const amount = target === 'APPROVED'
          ? (item.maxLimit !== null ? Math.min(proof.claimedAmount, item.maxLimit) : proof.claimedAmount)
          : 0;
        await this.repo.setItemApprovedAmount(item.id, round2(amount), target === 'APPROVED' ? 'APPROVED' : 'REJECTED');
      }
    }

    await this.audit.logAudit({
      entityType: 'tax_proofs',
      action: 'BULK_REVIEW',
      summary: `${updated} tax proofs set to ${target}`,
      actorUserId: userId,
    });

    return { requested: clean.length, updated, status: target, skipped };
  }

  async getPendingSummary(financialYear?: string): Promise<{
    financialYear: string | null;
    employees: Awaited<ReturnType<TaxProofRepository['getPendingSummary']>>;
    totalPending: number;
  }> {
    const fy = financialYear ? this.normaliseFy(financialYear) : undefined;
    const employees = await this.repo.getPendingSummary(fy);
    return {
      financialYear: fy ?? null,
      employees,
      totalPending: employees.reduce((sum, e) => sum + e.pending, 0),
    };
  }

  // -------------------------------------------------------------------------
  // HRA
  // -------------------------------------------------------------------------

  async getHraDeclaration(employeeId: number, financialYear: string): Promise<HraDeclarationRow[]> {
    return this.repo.listHra(employeeId, this.normaliseFy(financialYear));
  }

  async saveHraDeclaration(
    employeeId: number,
    financialYear: string,
    rows: HraRowInput[],
    userId: number,
  ): Promise<HraDeclarationRow[]> {
    const fy = this.normaliseFy(financialYear);
    const input = Array.isArray(rows) ? rows : [];
    const cleaned: (HraRowInput & { panRequired: boolean })[] = [];
    let annualRent = 0;

    for (const row of input) {
      const fromMonth = String(row.fromMonth ?? '').trim();
      const toMonth = String(row.toMonth ?? '').trim();
      if (!/^\d{4}-\d{2}$/.test(fromMonth) || !/^\d{4}-\d{2}$/.test(toMonth)) {
        throw new Error("Each rent period needs a from and to month formatted '2026-04'");
      }
      const months = monthsBetween(fromMonth, toMonth);
      if (months <= 0) throw new Error(`Rent period ${fromMonth} to ${toMonth} ends before it starts`);
      const monthlyRent = round2(Number(row.monthlyRent ?? 0));
      if (!Number.isFinite(monthlyRent) || monthlyRent < 0) throw new Error('Monthly rent must be a non-negative number');
      if (row.documentId) {
        const exists = await this.repo.documentExists(Number(row.documentId));
        if (!exists) throw new Error('The uploaded rent receipt could not be found');
      }
      annualRent = round2(annualRent + monthlyRent * months);
      cleaned.push({
        fromMonth,
        toMonth,
        monthlyRent,
        city: row.city ?? null,
        isMetro: !!row.isMetro,
        landlordName: row.landlordName ?? null,
        landlordPan: row.landlordPan ? String(row.landlordPan).trim().toUpperCase().slice(0, 10) : null,
        landlordAddress: row.landlordAddress ?? null,
        documentId: row.documentId ?? null,
        remarks: row.remarks ?? null,
        panRequired: false,
      });
    }

    // The landlord's PAN becomes mandatory once annual rent crosses the
    // statutory threshold, so it is a property of the whole year, not of a row.
    const panRequired = annualRent > PAN_THRESHOLD;
    for (const row of cleaned) row.panRequired = panRequired;

    const declarationId = await this.repo.ensureDeclaration(employeeId, fy);
    await this.repo.replaceHra(employeeId, fy, declarationId, cleaned);

    await this.audit.logAudit({
      entityType: 'hra_declarations',
      entityId: employeeId,
      action: 'SAVE',
      summary: `HRA declaration saved for employee ${employeeId} (${fy}): ${cleaned.length} period(s), `
        + `annual rent ${annualRent}${panRequired ? ', landlord PAN required' : ''}`,
      actorUserId: userId,
    });

    return this.repo.listHra(employeeId, fy);
  }

  /**
   * The standard least-of-three HRA exemption, returned with its working.
   *
   * A reviewer has to be able to check the number, not just accept it, so every
   * intermediate figure is in the payload: the salary the percentages were taken
   * on, the rent paid, and each of the three candidate amounts per rent period.
   */
  async computeHraExemption(employeeId: number, financialYear: string): Promise<HraExemptionResult> {
    const fy = this.normaliseFy(financialYear);
    const bounds = fyBounds(fy);
    const [rows, basis] = await Promise.all([
      this.repo.listHra(employeeId, fy),
      this.repo.getSalaryBasis(employeeId, bounds.from, bounds.to),
    ]);

    const caveats: string[] = [];
    if (basis.source === 'SALARY_PACKAGE') {
      caveats.push('Salary is taken from the assigned compensation package, not from processed payslips, '
        + 'so the exemption will move once payroll runs for the year.');
    } else if (basis.source === 'MONTHLY_SALARY') {
      caveats.push('No basic or dearness allowance breakdown exists, so the flat monthly salary was used as the '
        + 'salary base. Basic plus DA is normally lower, which would reduce both the 10% offset and the 50/40% cap.');
    }

    const emptyResult = (reason: string): HraExemptionResult => ({
      available: false,
      reason,
      employeeId,
      financialYear: fy,
      basis: {
        annualSalaryForHra: round2(basis.basicAndDa),
        annualHraReceived: round2(basis.hraReceived),
        monthsOnRecord: basis.months,
        source: basis.source,
        definition: 'Basic pay plus dearness allowance.',
      },
      rows: [],
      totals: { annualRentPaid: 0, exemption: 0, panRequired: false, panMissingRows: 0 },
      rule: LEAST_OF_THREE_RULE,
      caveats,
    });

    if (rows.length === 0) return emptyResult('No rent periods have been declared for this financial year.');
    if (basis.source === 'NONE') {
      return emptyResult('No salary is on record for this employee, so the 10% and 50/40% limbs of the rule cannot be computed.');
    }
    if (basis.hraReceived <= 0) {
      caveats.push('No house rent allowance was paid in this year, so the exemption is nil regardless of the rent paid: '
        + 'the exemption can never exceed the HRA actually received.');
    }

    const working: HraWorkingRow[] = [];
    let annualRent = 0;
    let totalExemption = 0;
    let panMissing = 0;

    for (const row of rows) {
      const months = monthsBetween(row.fromMonth, row.toMonth);
      const share = months / 12;
      const rentPaid = round2(row.monthlyRent * months);
      const salaryForPeriod = round2(basis.basicAndDa * share);
      const hraForPeriod = round2(basis.hraReceived * share);
      const rentLessTenPct = round2(Math.max(0, rentPaid - salaryForPeriod * 0.1));
      const capRate = row.isMetro ? METRO_RATE : NON_METRO_RATE;
      const percentCap = round2((salaryForPeriod * capRate) / 100);
      const least = round2(Math.max(0, Math.min(hraForPeriod, rentLessTenPct, percentCap)));

      const missingPan = row.panRequired && !row.landlordPan;
      if (missingPan) panMissing++;

      annualRent = round2(annualRent + rentPaid);
      totalExemption = round2(totalExemption + least);

      working.push({
        fromMonth: row.fromMonth,
        toMonth: row.toMonth,
        months,
        city: row.city,
        isMetro: row.isMetro,
        monthlyRent: row.monthlyRent,
        rentPaid,
        salaryForPeriod,
        hraReceivedForPeriod: hraForPeriod,
        rentMinusTenPercentOfSalary: rentLessTenPct,
        percentOfSalaryCap: percentCap,
        capRatePct: capRate,
        leastOfThree: least,
        exemption: least,
        landlordPan: row.landlordPan,
        panRequired: row.panRequired,
        panMissing: missingPan,
      });
    }

    if (annualRent > PAN_THRESHOLD && panMissing > 0) {
      caveats.push(`Annual rent of ${annualRent} exceeds ${PAN_THRESHOLD}, so the landlord's PAN is mandatory. `
        + `${panMissing} period(s) have no PAN on record and the claim will not stand without it.`);
    }

    return {
      available: true,
      employeeId,
      financialYear: fy,
      basis: {
        annualSalaryForHra: round2(basis.basicAndDa),
        annualHraReceived: round2(basis.hraReceived),
        monthsOnRecord: basis.months,
        source: basis.source,
        definition: 'Basic pay plus dearness allowance.',
      },
      rows: working,
      totals: {
        annualRentPaid: annualRent,
        exemption: totalExemption,
        panRequired: annualRent > PAN_THRESHOLD,
        panMissingRows: panMissing,
      },
      rule: LEAST_OF_THREE_RULE,
      caveats,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private normaliseFy(financialYear: string): string {
    const fy = String(financialYear ?? '').trim();
    if (!/^\d{4}-\d{4}$/.test(fy)) throw new Error("Financial year must look like '2026-2027'");
    return fy;
  }
}
