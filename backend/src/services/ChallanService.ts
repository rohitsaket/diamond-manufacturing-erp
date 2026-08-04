import { ContributionRepository } from '../repositories/ContributionRepository';
import { FilingRepository } from '../repositories/FilingRepository';
import { StatutoryRepository } from '../repositories/StatutoryRepository';
import {
  ChallanFilters,
  ChallanScheme,
  ContributionRecord,
  ContributionScheme,
  StatutoryChallan,
} from '../types/compliance';
import { generateCsv } from '../utils/csv';
import { round2, toDateString } from '../utils/dateUtils';
import { num } from '../utils/payrollMath';
import { dueDateForMonth, financialYearOf, resolveConfig, resolveStateRule } from '../utils/statutoryRules';

export interface GenerateChallanOptions {
  /** Two-letter state code; required for PT and LWF, ignored otherwise. */
  stateCode?: string | null;
  registrationId?: number | null;
  /** Overrides the due date resolved from the scheme's `filing_due_day`. */
  dueDate?: string | null;
  interestAmount?: number;
  penaltyAmount?: number;
  remarks?: string | null;
}

export interface MarkPaidInput {
  paidOn: string;
  paymentReference?: string | null;
  bankName?: string | null;
}

export interface AcknowledgeInput {
  acknowledgementNo: string;
  acknowledgedOn?: string | null;
}

/**
 * Which ledger schemes roll into which challan.
 *
 * A PF challan is one payment covering the provident fund, the pension
 * diversion, the insurance premium and any voluntary contribution — that is how
 * EPFO bills it, so that is how it is aggregated.
 */
const CHALLAN_SCHEMES: Record<ChallanScheme, ContributionScheme[]> = {
  PF: ['PF', 'EPS', 'EDLI', 'VPF'],
  ESI: ['ESI'],
  PT: ['PT'],
  LWF: ['LWF'],
  TDS: ['TDS'],
};

/** The scheme whose wage base is reported as the challan's total wages. */
const PRIMARY_SCHEME: Record<ChallanScheme, ContributionScheme> = {
  PF: 'PF',
  ESI: 'ESI',
  PT: 'PT',
  LWF: 'LWF',
  TDS: 'TDS',
};

const VALID_SCHEMES = new Set<string>(['PF', 'ESI', 'PT', 'LWF', 'TDS']);

/**
 * Statutory payment challans.
 *
 * A challan is the remittance side of compliance: it freezes a month's ledger
 * rows into one payable figure, stamps them `CHALLAN_GENERATED`, and from then
 * on those rows are protected from a ledger rebuild. Only one live challan may
 * exist per scheme and month — a second one would double-count the remittance.
 *
 * Nothing here initiates a payment. The figures are prepared for a person to
 * pay on the EPFO / ESIC / state portal and record back here.
 */
export class ChallanService {
  private repo = new FilingRepository();
  private contributions = new ContributionRepository();
  private master = new StatutoryRepository();

  /**
   * Aggregate a month of contributions into a challan.
   *
   * Refuses when a non-cancelled challan already exists for the scheme and
   * month, because two live challans mean two payments.
   */
  async generateChallan(
    scheme: string,
    monthKey: string,
    userId: number,
    opts: GenerateChallanOptions = {},
  ): Promise<{ challan: StatutoryChallan; contributionCount: number; warnings: string[] }> {
    const schemeCode = String(scheme).toUpperCase();
    if (!VALID_SCHEMES.has(schemeCode)) {
      throw new Error(`Unknown challan scheme "${scheme}"; expected one of PF, ESI, PT, LWF, TDS`);
    }
    if (!/^\d{4}-\d{2}$/.test(String(monthKey))) {
      throw new Error('monthKey must look like 2026-07');
    }
    const challanScheme = schemeCode as ChallanScheme;
    const stateCode = challanScheme === 'PT' || challanScheme === 'LWF'
      ? (opts.stateCode ? String(opts.stateCode).toUpperCase() : null)
      : null;

    if ((challanScheme === 'PT' || challanScheme === 'LWF') && !stateCode) {
      throw new Error(`A stateCode is required for a ${challanScheme} challan`);
    }

    const existing = await this.repo.findLiveChallan(challanScheme, monthKey, stateCode);
    if (existing) {
      throw new Error(`A challan already exists for ${challanScheme} ${monthKey}`);
    }

    const warnings: string[] = [];
    const rows = await this.contributions.findContributionsForMonth(
      monthKey,
      CHALLAN_SCHEMES[challanScheme],
      stateCode,
      true,
    );
    if (rows.length === 0) {
      throw new Error(`No unchallaned ${challanScheme} contributions were found for ${monthKey}`);
    }

    // --- totals -----------------------------------------------------------
    const primary = PRIMARY_SCHEME[challanScheme];
    const employees = new Set<number>();
    let totalWages = 0;
    let employeeAmount = 0;
    let employerAmount = 0;
    let adminCharges = 0;
    for (const row of rows) {
      employees.add(row.employeeId);
      if (row.scheme === primary) totalWages = round2(totalWages + row.wageBase);
      employeeAmount = round2(employeeAmount + row.employeeAmount);
      employerAmount = round2(employerAmount + row.employerAmount);
      adminCharges = round2(adminCharges + row.adminCharges);
    }

    // The minimum administrative charge is an establishment-level floor per
    // return, not a per-employee one, so it is applied here rather than in the
    // per-employee split.
    const configs = await this.master.findConfigs();
    const period = await this.contributions.findPeriodByMonth(monthKey);
    const onDate = period ? period.toDate : `${monthKey}-28`;
    if (challanScheme === 'PF') {
      const pfCfg = resolveConfig(configs, 'PF', onDate);
      const floor = pfCfg && pfCfg.min_admin_charge !== null ? num(pfCfg.min_admin_charge) : 0;
      if (floor > 0 && adminCharges < floor) {
        warnings.push(`Administrative charges were raised from ${adminCharges.toFixed(2)} to the configured minimum of ${floor.toFixed(2)}.`);
        adminCharges = round2(floor);
      }
    }

    const interestAmount = round2(Math.max(0, num(opts.interestAmount)));
    const penaltyAmount = round2(Math.max(0, num(opts.penaltyAmount)));
    const totalAmount = round2(employeeAmount + employerAmount + adminCharges + interestAmount + penaltyAmount);

    // --- due date ---------------------------------------------------------
    let dueDate: string | null = opts.dueDate ? toDateString(opts.dueDate) : null;
    if (!dueDate && (challanScheme === 'PF' || challanScheme === 'ESI')) {
      const cfg = resolveConfig(configs, challanScheme, onDate);
      dueDate = cfg ? dueDateForMonth(monthKey, cfg.filing_due_day) : null;
    }
    if (!dueDate && (challanScheme === 'PT' || challanScheme === 'LWF') && stateCode) {
      dueDate = await this.resolveStateDueDate(challanScheme, monthKey, stateCode, onDate);
    }
    if (!dueDate) {
      warnings.push(
        `No filing_due_day is configured for ${challanScheme}, so no due date was set. Record it manually — `
        + 'overdue detection cannot work without one.',
      );
    }

    // --- identity ---------------------------------------------------------
    const sequence = (await this.repo.countChallansForMonth(challanScheme, monthKey)) + 1;
    const challanNo = `${challanScheme}-${monthKey.replace('-', '')}-${String(sequence).padStart(3, '0')}`;
    const financialYear = financialYearOf(onDate);

    let registrationId = opts.registrationId ?? null;
    if (!registrationId) {
      const registration = await this.master.findActiveRegistration(challanScheme, stateCode);
      registrationId = registration ? registration.id : null;
      if (!registrationId) warnings.push(`No active ${challanScheme} registration is on record; the challan carries no establishment code.`);
    }

    const challanId = await this.repo.withTransaction(async (conn) => {
      const id = await this.repo.insertChallan(
        conn,
        {
          challanNo,
          scheme: challanScheme,
          registrationId,
          periodId: period ? period.id : null,
          monthKey,
          financialYear,
          quarter: null,
          stateCode,
          employeeCount: employees.size,
          totalWages,
          employeeAmount,
          employerAmount,
          adminCharges,
          interestAmount,
          penaltyAmount,
          totalAmount,
          dueDate,
          status: 'GENERATED',
          remarks: opts.remarks ?? null,
        },
        userId,
      );
      await this.contributions.attachToChallan(conn, id, rows.map((r) => r.id));
      return id;
    });

    const challan = await this.repo.findChallanById(challanId);
    if (!challan) throw new Error('The challan was created but could not be read back');

    await this.master.logAudit({
      entityType: 'STATUTORY_CHALLAN',
      entityId: challanId,
      periodId: period ? period.id : null,
      action: 'GENERATE',
      summary: `Generated ${challanScheme} challan ${challanNo} for ${monthKey}`,
      newValue: { totalAmount, employeeCount: employees.size },
      actorUserId: userId,
    });

    return { challan, contributionCount: rows.length, warnings };
  }

  /** Record that the challan was paid on the portal. */
  async markPaid(challanId: number, input: MarkPaidInput, userId: number): Promise<StatutoryChallan> {
    const challan = await this.requireChallan(challanId);
    if (challan.status === 'CANCELLED') throw new Error('A cancelled challan cannot be marked paid');
    if (!input.paidOn) throw new Error('paidOn is required');

    await this.repo.updateChallan(
      challanId,
      {
        status: 'PAID',
        paidOn: toDateString(input.paidOn),
        paymentReference: input.paymentReference ?? null,
        bankName: input.bankName ?? null,
      },
      userId,
    );
    await this.contributions.setStatusForChallan(challanId, 'PAID');

    await this.master.logAudit({
      entityType: 'STATUTORY_CHALLAN',
      entityId: challanId,
      action: 'MARK_PAID',
      summary: `Marked challan ${challan.challanNo} paid`,
      fieldName: 'status',
      previousValue: challan.status,
      newValue: 'PAID',
      actorUserId: userId,
    });
    return this.requireChallan(challanId);
  }

  async recordAcknowledgement(challanId: number, input: AcknowledgeInput, userId: number): Promise<StatutoryChallan> {
    const challan = await this.requireChallan(challanId);
    if (!input.acknowledgementNo) throw new Error('acknowledgementNo is required');
    if (challan.status === 'CANCELLED') throw new Error('A cancelled challan cannot be acknowledged');

    await this.repo.updateChallan(
      challanId,
      {
        status: 'ACKNOWLEDGED',
        acknowledgementNo: String(input.acknowledgementNo).slice(0, 80),
        acknowledgedOn: input.acknowledgedOn ? toDateString(input.acknowledgedOn) : null,
      },
      userId,
    );
    await this.master.logAudit({
      entityType: 'STATUTORY_CHALLAN',
      entityId: challanId,
      action: 'ACKNOWLEDGE',
      summary: `Recorded acknowledgement ${input.acknowledgementNo} for challan ${challan.challanNo}`,
      previousValue: challan.status,
      newValue: 'ACKNOWLEDGED',
      actorUserId: userId,
    });
    return this.requireChallan(challanId);
  }

  /**
   * Cancel a challan and release its contribution rows.
   *
   * Refused once the challan is paid: money has left, and a cancellation would
   * detach the ledger rows from the payment that covered them.
   */
  async cancel(challanId: number, reason: string, userId: number): Promise<StatutoryChallan> {
    const challan = await this.requireChallan(challanId);
    if (challan.status === 'PAID' || challan.status === 'ACKNOWLEDGED') {
      throw new Error(`Challan ${challan.challanNo} is already ${challan.status.toLowerCase()} and cannot be cancelled`);
    }
    if (!reason) throw new Error('A cancellation reason is required');

    await this.repo.withTransaction(async (conn) => {
      await this.contributions.detachFromChallan(conn, challanId);
      await this.repo.updateChallan(challanId, { status: 'CANCELLED', remarks: String(reason).slice(0, 500) }, userId, conn);
    });

    await this.master.logAudit({
      entityType: 'STATUTORY_CHALLAN',
      entityId: challanId,
      action: 'CANCEL',
      summary: `Cancelled challan ${challan.challanNo}: ${reason}`,
      previousValue: challan.status,
      newValue: 'CANCELLED',
      actorUserId: userId,
    });
    return this.requireChallan(challanId);
  }

  async list(filters: ChallanFilters): Promise<StatutoryChallan[]> {
    return this.repo.findChallans(filters);
  }

  async get(challanId: number): Promise<{ challan: StatutoryChallan; contributions: ContributionRecord[] }> {
    const challan = await this.requireChallan(challanId);
    const contributions = await this.contributions.findContributionsByChallan(challanId);
    return { challan, contributions };
  }

  async getOverdue(): Promise<StatutoryChallan[]> {
    return this.repo.findOverdueChallans();
  }

  /** Per-employee breakdown behind a challan, for reconciliation. */
  async exportChallanCsv(challanId: number): Promise<{ fileName: string; content: string }> {
    const challan = await this.requireChallan(challanId);
    const rows = await this.contributions.findContributionsByChallan(challanId);

    const headers = [
      'Employee Code', 'Employee Name', 'UAN', 'ESI IP Number', 'Scheme', 'Wage Base',
      'Uncapped Wage', 'Employee Amount', 'Employer Amount', 'Admin Charges', 'Total',
      'NCP Days', 'Paid Days', 'State',
    ];
    const data = rows.map((r) => [
      r.employeeCode ?? '',
      r.employeeName ?? '',
      r.uan ?? '',
      r.esiIpNumber ?? '',
      r.scheme,
      r.wageBase.toFixed(2),
      r.uncappedWage.toFixed(2),
      r.employeeAmount.toFixed(2),
      r.employerAmount.toFixed(2),
      r.adminCharges.toFixed(2),
      r.totalAmount.toFixed(2),
      r.ncpDays.toFixed(2),
      r.paidDays.toFixed(2),
      r.stateCode ?? '',
    ]);

    return {
      fileName: `challan_${challan.challanNo}.csv`,
      content: generateCsv(headers, data),
    };
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private async requireChallan(challanId: number): Promise<StatutoryChallan> {
    const challan = await this.repo.findChallanById(challanId);
    if (!challan) throw new Error(`Challan ${challanId} was not found`);
    return challan;
  }

  /**
   * PT / LWF due dates live on the state rule rather than `statutory_config`.
   *
   * TDS has no configuration row anywhere in this schema, so its due date stays
   * null unless the caller supplies one — a guessed statutory deadline is worse
   * than an obvious blank.
   */
  async resolveStateDueDate(scheme: 'PT' | 'LWF', monthKey: string, stateCode: string, onDate: string): Promise<string | null> {
    if (scheme === 'PT') {
      const rules = await this.master.findPtRules(stateCode);
      const rule = resolveStateRule(rules, stateCode, onDate);
      return rule ? dueDateForMonth(monthKey, rule.filing_due_day) : null;
    }
    const rules = await this.master.findLwfRules(stateCode);
    const rule = resolveStateRule(rules, stateCode, onDate);
    return rule ? dueDateForMonth(monthKey, rule.filing_due_day) : null;
  }
}
