import { ContributionRepository, LedgerSourceRow } from '../repositories/ContributionRepository';
import { StatutoryRepository } from '../repositories/StatutoryRepository';
import {
  ContributionRecord,
  ContributionRowInput,
  ContributionScheme,
  GratuityComputeResult,
  GratuityProvision,
  LedgerBuildResult,
  LedgerFilters,
  PfAccountEntry,
  SchemeSummary,
  StatutoryConfigRow,
} from '../types/compliance';
import { monthKey as toMonthKey, round2, toDateString, todayString } from '../utils/dateUtils';
import { num, yearsOfService } from '../utils/payrollMath';
import {
  computeEsiSplit,
  computeGratuityProvision,
  computePfSplit,
  financialYearBounds,
  financialYearOf,
  isGratuityEligible,
  resolveConfig,
  resolveLwfAmount,
  resolvePtAmount,
} from '../utils/statutoryRules';

export interface BuildLedgerOptions {
  /** Restrict the rebuild to a subset of employees. */
  employeeIds?: number[];
  /**
   * Rebuild rows that are already attached to a challan or marked paid/filed.
   * Off by default: a remitted figure must not move under a filed return.
   */
  force?: boolean;
}

export interface PostPfEntriesResult {
  periodId: number;
  monthKey: string;
  financialYear: string;
  entriesPosted: number;
  skipped: number;
  totalCredited: number;
}

export interface PfInterestResult {
  financialYear: string;
  ratePct: number;
  entriesPosted: number;
  skipped: number;
  totalInterest: number;
}

/** Employees are processed in blocks of this size, never all at once. */
const CHUNK_SIZE = 500;

/** Beyond this the warning list is summarised rather than printed in full. */
const MAX_WARNINGS = 200;

/**
 * Builds and maintains the statutory contribution ledger.
 *
 * `statutory_contributions` is what every challan, register and return is later
 * assembled from, so this service is the single place PF, EPS, EDLI, VPF, ESI,
 * PT and LWF amounts are derived. It derives nothing it can read: TDS rows are
 * copied from `salary_lines.ded_income_tax` (computed by
 * `TaxComputationService` during the payroll run) and are never recomputed here,
 * because two independent tax engines producing two different Form 24Q figures
 * is a filing defect waiting to happen.
 *
 * Every rate, ceiling and slab comes from the configuration tables. When one is
 * missing the scheme is skipped and the reason is returned as a warning; no
 * statutory rate is ever assumed.
 */
export class StatutoryContributionService {
  private repo = new ContributionRepository();
  private master = new StatutoryRepository();

  // =========================================================================
  // Ledger construction
  // =========================================================================

  /**
   * Recompute the whole contribution ledger for a payroll period.
   *
   * Idempotent: rows are upserted on `(employee_id, period_id, scheme)` and any
   * scheme that no longer applies to an employee is deleted, so running it twice
   * leaves exactly the same ledger as running it once.
   */
  async buildLedger(periodId: number, userId: number, opts: BuildLedgerOptions = {}): Promise<LedgerBuildResult> {
    const period = await this.repo.findPeriod(periodId);
    if (!period) throw new Error(`Salary period ${periodId} was not found`);

    const onDate = period.toDate;
    const monthKey = toMonthKey(onDate);
    const financialYear = financialYearOf(onDate);

    // Rules are resolved ONCE for the period; a 10k-employee run must not issue
    // a configuration query per person.
    const [configs, ptRules, ptSlabs, lwfRules] = await Promise.all([
      this.master.findConfigs(),
      this.master.findPtRules(),
      this.master.findPtSlabs(),
      this.master.findLwfRules(),
    ]);

    const pfCfg = resolveConfig(configs, 'PF', onDate);
    const epsCfg = resolveConfig(configs, 'EPS', onDate);
    const edliCfg = resolveConfig(configs, 'EDLI', onDate);
    const esiCfg = resolveConfig(configs, 'ESI', onDate);

    const warnings: string[] = [];
    let suppressedWarnings = 0;
    const warn = (message: string): void => {
      if (warnings.length < MAX_WARNINGS) warnings.push(message);
      else suppressedWarnings += 1;
    };

    if (!pfCfg) warn(`No PF configuration is effective on ${onDate}; no provident fund was computed.`);
    if (!esiCfg) warn(`No ESI configuration is effective on ${onDate}; no ESI was computed.`);
    if (pfCfg && !epsCfg) warn(`No EPS configuration is effective on ${onDate}; the whole employer share was treated as provident fund.`);
    if (pfCfg && !edliCfg) warn(`No EDLI configuration is effective on ${onDate}; no insurance contribution was computed.`);

    let legacyGrossCount = 0;
    let netOfEpsFlagged = false;
    let employeesProcessed = 0;

    const locked = opts.force ? [] : await this.repo.findLockedContributions(periodId);
    const lockedKeys = new Set(locked.map((l) => `${l.employeeId}:${l.scheme}`));
    if (locked.length > 0) {
      const employees = new Set(locked.map((l) => l.employeeId));
      warn(
        `${locked.length} contribution row(s) across ${employees.size} employee(s) are attached to a challan or already `
        + 'paid/filed and were left untouched. Cancel the challan, or pass force, to rebuild them.',
      );
    }

    const total = await this.repo.countLedgerSource(periodId, opts.employeeIds);
    if (total === 0) {
      return { periodId, monthKey, financialYear, employeesProcessed: 0, byScheme: [], warnings: warnings.concat('This period has no salary lines.') };
    }

    await this.repo.withTransaction(async (conn) => {
      for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
        const rows = await this.repo.findLedgerSource(periodId, CHUNK_SIZE, offset, opts.employeeIds, conn);
        if (rows.length === 0) break;

        const pfWages = await this.repo.findPfApplicableWages(rows.map((r) => r.salaryLineId), conn);

        // Employees whose applicable scheme set is identical share one DELETE.
        const bySignature = new Map<string, { schemes: ContributionScheme[]; employeeIds: number[] }>();

        for (const row of rows) {
          if (row.grossFromLegacyTotal) legacyGrossCount += 1;

          const built = this.buildEmployeeRows(row, {
            periodId,
            monthKey,
            financialYear,
            pfWage: pfWages.get(row.salaryLineId),
            pfCfg,
            epsCfg,
            edliCfg,
            esiCfg,
            ptRules,
            ptSlabs,
            lwfRules,
            warn,
          });
          if (built.netOfEps) netOfEpsFlagged = true;

          for (const contribution of built.rows) {
            if (lockedKeys.has(`${row.employeeId}:${contribution.scheme}`)) continue;
            await this.repo.upsertContribution(conn, contribution);
          }

          const schemes = built.rows.map((r) => r.scheme).sort();
          const signature = schemes.join('|');
          const bucket = bySignature.get(signature) ?? { schemes, employeeIds: [] };
          bucket.employeeIds.push(row.employeeId);
          bySignature.set(signature, bucket);
          employeesProcessed += 1;
        }

        for (const bucket of bySignature.values()) {
          await this.repo.deleteSchemesNotIn(conn, periodId, bucket.employeeIds, bucket.schemes);
        }
      }
    });

    if (legacyGrossCount > 0) {
      warn(
        `${legacyGrossCount} salary line(s) carried gross_amount = 0, so the legacy total_amount column was used as the `
        + 'gross wage (migration 020 keeps the two equal). Re-run payroll to populate gross_amount properly.',
      );
    }
    if (netOfEpsFlagged && pfCfg && epsCfg) {
      warn(
        `The PF employer rate on record (${num(pfCfg.employer_rate_pct)}%) is smaller than the EPS diversion `
        + `(${num(epsCfg.diversion_rate_pct) || num(epsCfg.employer_rate_pct)}%), so it was read as already NET of the `
        + 'diversion and used as the employer provident fund share directly. Verify this against the EPFO circular: '
        + 'if the configured rate is meant to be the full employer rate, EPS is being counted twice.',
      );
    }
    if (suppressedWarnings > 0) warnings.push(`... and ${suppressedWarnings} further warning(s) not listed.`);

    const byScheme = await this.repo.summaryByScheme(periodId);
    await this.master.logAudit({
      entityType: 'STATUTORY_LEDGER',
      entityId: periodId,
      periodId,
      action: 'BUILD',
      summary: `Built statutory contribution ledger for period ${periodId} (${monthKey})`,
      newValue: { employeesProcessed, schemes: byScheme.map((s) => `${s.scheme}:${s.total}`) },
      actorUserId: userId,
    });

    return { periodId, monthKey, financialYear, employeesProcessed, byScheme, warnings };
  }

  /**
   * The per-employee arithmetic, split out so the transaction loop above stays
   * readable. Pure apart from the `warn` callback.
   */
  private buildEmployeeRows(
    row: LedgerSourceRow,
    ctx: {
      periodId: number;
      monthKey: string;
      financialYear: string;
      pfWage: number | undefined;
      pfCfg: StatutoryConfigRow | null;
      epsCfg: StatutoryConfigRow | null;
      edliCfg: StatutoryConfigRow | null;
      esiCfg: StatutoryConfigRow | null;
      ptRules: any[];
      ptSlabs: any[];
      lwfRules: any[];
      warn: (message: string) => void;
    },
  ): { rows: ContributionRowInput[]; netOfEps: boolean } {
    const rows: ContributionRowInput[] = [];
    let netOfEps = false;

    const gross = row.grossAmount;
    // Non-contributory days: the ECR needs them, and they are simply the days of
    // the period the employee was not paid for.
    const ncpDays = round2(Math.max(0, row.periodDays - row.paidDays));

    const base = {
      employeeId: row.employeeId,
      periodId: ctx.periodId,
      salaryLineId: row.salaryLineId,
      runId: row.runId,
      financialYear: ctx.financialYear,
      monthKey: ctx.monthKey,
      ncpDays,
      paidDays: row.paidDays,
    };

    // --- provident fund ----------------------------------------------------
    const pfStatus = row.pfStatus ?? 'NOT_ENROLLED';
    if (pfStatus !== 'ACTIVE') {
      if (pfStatus === 'NOT_ENROLLED' || pfStatus === 'EXEMPT') {
        ctx.warn(`${row.empCode} ${row.fullName}: PF skipped, enrolment status is ${pfStatus}.`);
      }
    } else if (ctx.pfCfg) {
      // The PF wage is the sum of the PF-applicable earning components when a
      // component breakdown exists; otherwise the whole gross is used, which is
      // what this establishment's piece-rate lines carry.
      const pfWage = ctx.pfWage !== undefined ? ctx.pfWage : gross;
      const split = computePfSplit(
        pfWage,
        ctx.pfCfg,
        row.epsApplicable ? ctx.epsCfg : null,
        ctx.edliCfg,
        row.vpfPercent,
      );
      netOfEps = split.employerRateIsNetOfEps;

      if (split.totalWage > 0) {
        rows.push({
          ...base,
          scheme: 'PF',
          stateCode: null,
          wageBase: split.totalWage,
          uncappedWage: split.uncappedWage,
          employeeAmount: split.employeeShare,
          employerAmount: split.employerPf,
          adminCharges: split.adminCharges,
          totalAmount: round2(split.employeeShare + split.employerPf + split.adminCharges),
          rateApplied: num(ctx.pfCfg.employee_rate_pct),
          remarks: ctx.pfWage === undefined ? 'Wage base is gross pay; no PF-applicable component breakdown exists' : null,
        });

        if (row.epsApplicable && ctx.epsCfg) {
          rows.push({
            ...base,
            scheme: 'EPS',
            stateCode: null,
            wageBase: split.epsWage,
            uncappedWage: split.uncappedWage,
            employeeAmount: 0,
            employerAmount: split.employerEps,
            adminCharges: 0,
            totalAmount: split.employerEps,
            rateApplied: num(ctx.epsCfg.diversion_rate_pct) || num(ctx.epsCfg.employer_rate_pct),
            remarks: null,
          });
        }

        if (ctx.edliCfg) {
          rows.push({
            ...base,
            scheme: 'EDLI',
            stateCode: null,
            wageBase: split.edliWage,
            uncappedWage: split.uncappedWage,
            employeeAmount: 0,
            employerAmount: split.edli,
            adminCharges: 0,
            totalAmount: split.edli,
            rateApplied: num(ctx.edliCfg.employer_rate_pct),
            remarks: null,
          });
        }

        if (split.vpfShare > 0) {
          rows.push({
            ...base,
            scheme: 'VPF',
            stateCode: null,
            wageBase: split.totalWage,
            uncappedWage: split.uncappedWage,
            employeeAmount: split.vpfShare,
            employerAmount: 0,
            adminCharges: 0,
            totalAmount: split.vpfShare,
            rateApplied: row.vpfPercent,
            remarks: null,
          });
        }
      }
    }

    // --- ESI ---------------------------------------------------------------
    const esiStatus = row.esiStatus ?? 'NOT_ENROLLED';
    if (esiStatus !== 'ACTIVE') {
      if (esiStatus === 'NOT_ENROLLED') {
        ctx.warn(`${row.empCode} ${row.fullName}: ESI skipped, enrolment status is ${esiStatus}.`);
      }
    } else {
      const esi = computeEsiSplit(gross, ctx.esiCfg, true);
      if (esi.covered && esi.employeeAmount + esi.employerAmount > 0) {
        rows.push({
          ...base,
          scheme: 'ESI',
          stateCode: null,
          wageBase: esi.wageBase,
          uncappedWage: esi.wageBase,
          employeeAmount: esi.employeeAmount,
          employerAmount: esi.employerAmount,
          adminCharges: 0,
          totalAmount: round2(esi.employeeAmount + esi.employerAmount),
          rateApplied: ctx.esiCfg ? num(ctx.esiCfg.employee_rate_pct) : null,
          remarks: null,
        });
      } else if (!esi.covered && esi.reason) {
        ctx.warn(`${row.empCode} ${row.fullName}: ESI not computed - ${esi.reason}.`);
      }
    }

    // --- professional tax --------------------------------------------------
    const pt = resolvePtAmount(ctx.ptRules, ctx.ptSlabs, row.ptStateCode, gross, ctx.monthKey, row.gender);
    if (pt.amount > 0) {
      rows.push({
        ...base,
        scheme: 'PT',
        stateCode: pt.stateCode,
        wageBase: gross,
        uncappedWage: gross,
        employeeAmount: pt.amount,
        employerAmount: 0,
        adminCharges: 0,
        totalAmount: pt.amount,
        rateApplied: null,
        remarks: pt.slabId ? `PT slab ${pt.slabId}` : null,
      });
    } else if (row.ptStateCode && pt.ruleId === null) {
      ctx.warn(`${row.empCode} ${row.fullName}: no professional tax rule is effective for state ${row.ptStateCode}.`);
    }

    // --- labour welfare fund ----------------------------------------------
    const lwf = resolveLwfAmount(ctx.lwfRules, row.lwfStateCode, ctx.monthKey);
    if (lwf.applicableThisMonth && lwf.employeeAmount + lwf.employerAmount > 0) {
      rows.push({
        ...base,
        scheme: 'LWF',
        stateCode: row.lwfStateCode,
        wageBase: gross,
        uncappedWage: gross,
        employeeAmount: lwf.employeeAmount,
        employerAmount: lwf.employerAmount,
        adminCharges: 0,
        totalAmount: round2(lwf.employeeAmount + lwf.employerAmount),
        rateApplied: null,
        remarks: null,
      });
    }

    // --- TDS ---------------------------------------------------------------
    // Copied, never recomputed. TaxComputationService owns the tax figure.
    if (row.incomeTax > 0) {
      rows.push({
        ...base,
        scheme: 'TDS',
        stateCode: null,
        wageBase: gross,
        uncappedWage: gross,
        employeeAmount: round2(row.incomeTax),
        employerAmount: 0,
        adminCharges: 0,
        totalAmount: round2(row.incomeTax),
        rateApplied: null,
        remarks: 'Deducted per salary_lines.ded_income_tax',
      });
    }

    return { rows, netOfEps };
  }

  // =========================================================================
  // Ledger reads
  // =========================================================================

  async getLedger(filters: LedgerFilters): Promise<ContributionRecord[]> {
    return this.repo.findContributions(filters);
  }

  async getSummary(periodId: number): Promise<{ periodId: number; monthKey: string | null; byScheme: SchemeSummary[]; totals: { employeeAmount: number; employerAmount: number; adminCharges: number; total: number } }> {
    const period = await this.repo.findPeriod(periodId);
    if (!period) throw new Error(`Salary period ${periodId} was not found`);
    const byScheme = await this.repo.summaryByScheme(periodId);
    const totals = byScheme.reduce(
      (acc, s) => ({
        employeeAmount: round2(acc.employeeAmount + s.employeeAmount),
        employerAmount: round2(acc.employerAmount + s.employerAmount),
        adminCharges: round2(acc.adminCharges + s.adminCharges),
        total: round2(acc.total + s.total),
      }),
      { employeeAmount: 0, employerAmount: 0, adminCharges: 0, total: 0 },
    );
    return { periodId, monthKey: toMonthKey(period.toDate), byScheme, totals };
  }

  // =========================================================================
  // Gratuity
  // =========================================================================

  /**
   * Recompute the accrued gratuity liability for everyone still working.
   *
   * Piece-rate workers have no monthly wage on record. Their eligibility is
   * still recorded truthfully, but the provision is left at zero and they are
   * named in the warnings — inventing a wage for them would put a fabricated
   * liability on the balance sheet.
   */
  async computeGratuityProvisions(asOfDate: string, userId: number): Promise<GratuityComputeResult> {
    const date = toDateString(asOfDate || todayString());
    const financialYear = financialYearOf(date);
    const configs = await this.master.findConfigs('GRATUITY');
    const cfg = resolveConfig(configs, 'GRATUITY', date);

    const warnings: string[] = [];
    if (!cfg) {
      return {
        asOfDate: date,
        financialYear,
        employeesProcessed: 0,
        eligibleCount: 0,
        totalProvision: 0,
        totalIncremental: 0,
        warnings: [`No GRATUITY configuration is effective on ${date}; nothing was provided for.`],
      };
    }

    const [candidates, previous] = await Promise.all([
      this.repo.findGratuityCandidates(date),
      this.repo.findPreviousProvisions(date),
    ]);

    const noWage: string[] = [];
    let eligibleCount = 0;
    let totalProvision = 0;
    let totalIncremental = 0;

    await this.repo.withTransaction(async (conn) => {
      for (const candidate of candidates) {
        const years = yearsOfService(candidate.joinedAt, date);
        const eligible = candidate.gratuityEligible && isGratuityEligible(years, cfg);
        const wage = candidate.monthlySalary ?? 0;

        let provision = 0;
        if (eligible && wage > 0) {
          provision = computeGratuityProvision(wage, years, cfg);
        } else if (eligible && wage <= 0) {
          noWage.push(`${candidate.empCode} ${candidate.fullName}`);
        }

        const prev = previous.get(candidate.employeeId) ?? 0;
        const incremental = round2(provision - prev);

        await this.repo.upsertGratuityProvision(conn, {
          employeeId: candidate.employeeId,
          asOfDate: date,
          financialYear,
          yearsOfService: years,
          lastDrawnWage: round2(wage),
          isEligible: eligible,
          provisionAmount: provision,
          previousProvision: prev,
          incrementalProvision: incremental,
        });

        if (eligible) eligibleCount += 1;
        totalProvision = round2(totalProvision + provision);
        totalIncremental = round2(totalIncremental + incremental);
      }
    });

    if (noWage.length > 0) {
      const named = noWage.slice(0, 50).join(', ');
      warnings.push(
        `${noWage.length} eligible employee(s) have no monthly wage on record (piece-rate), so their provision is 0 `
        + `rather than an estimate: ${named}${noWage.length > 50 ? ', ...' : ''}.`,
      );
    }

    await this.master.logAudit({
      entityType: 'GRATUITY_PROVISION',
      action: 'COMPUTE',
      summary: `Computed gratuity provisions as at ${date}`,
      newValue: { employeesProcessed: candidates.length, totalProvision },
      actorUserId: userId,
    });

    return {
      asOfDate: date,
      financialYear,
      employeesProcessed: candidates.length,
      eligibleCount,
      totalProvision,
      totalIncremental,
      warnings,
    };
  }

  async getGratuityProvisions(filters: { asOfDate?: string; financialYear?: string; employeeId?: number; limit?: number }): Promise<GratuityProvision[]> {
    return this.repo.findGratuityProvisions(filters);
  }

  // =========================================================================
  // PF passbook
  // =========================================================================

  /**
   * Post this period's PF, EPS and VPF amounts into the member passbook,
   * carrying the running closing balance forward.
   *
   * Keyed on the reference `PERIOD-<id>`, so re-running skips employees who are
   * already posted instead of doubling their balance.
   */
  async postPfEntries(periodId: number, userId: number): Promise<PostPfEntriesResult> {
    const period = await this.repo.findPeriod(periodId);
    if (!period) throw new Error(`Salary period ${periodId} was not found`);

    const monthKey = toMonthKey(period.toDate);
    const financialYear = financialYearOf(period.toDate);
    const reference = `PERIOD-${periodId}`;

    const contributions = await this.repo.findContributions({ periodId, limit: 20000 });
    const relevant = contributions.filter((c) => c.scheme === 'PF' || c.scheme === 'EPS' || c.scheme === 'VPF');
    if (relevant.length === 0) {
      throw new Error(`Period ${periodId} has no PF contributions; build the ledger first`);
    }

    const byEmployee = new Map<number, { employeeShare: number; employerShare: number; pensionShare: number; vpfShare: number }>();
    for (const row of relevant) {
      const bucket = byEmployee.get(row.employeeId) ?? { employeeShare: 0, employerShare: 0, pensionShare: 0, vpfShare: 0 };
      if (row.scheme === 'PF') {
        bucket.employeeShare = round2(bucket.employeeShare + row.employeeAmount);
        bucket.employerShare = round2(bucket.employerShare + row.employerAmount);
      } else if (row.scheme === 'EPS') {
        bucket.pensionShare = round2(bucket.pensionShare + row.employerAmount);
      } else {
        bucket.vpfShare = round2(bucket.vpfShare + row.employeeAmount);
      }
      byEmployee.set(row.employeeId, bucket);
    }

    const employeeIds = Array.from(byEmployee.keys());
    const [already, balances] = await Promise.all([
      this.repo.findEntryReferences(reference),
      this.repo.findClosingBalances(employeeIds),
    ]);

    let entriesPosted = 0;
    let skipped = 0;
    let totalCredited = 0;

    await this.repo.withTransaction(async (conn) => {
      for (const [employeeId, shares] of byEmployee) {
        if (already.has(employeeId)) {
          skipped += 1;
          continue;
        }
        const credit = round2(shares.employeeShare + shares.employerShare + shares.pensionShare + shares.vpfShare);
        const closing = round2((balances.get(employeeId) ?? 0) + credit);
        await this.repo.insertPfEntry(
          conn,
          {
            employeeId,
            financialYear,
            monthKey,
            entryType: 'CONTRIBUTION',
            employeeShare: shares.employeeShare,
            employerShare: shares.employerShare,
            pensionShare: shares.pensionShare,
            vpfShare: shares.vpfShare,
            interestRatePct: null,
            closingBalance: closing,
            entryDate: period.toDate,
            reference,
            remarks: `Contribution for ${monthKey}`,
          },
          userId,
        );
        entriesPosted += 1;
        totalCredited = round2(totalCredited + credit);
      }
    });

    await this.master.logAudit({
      entityType: 'PF_ACCOUNT',
      entityId: periodId,
      periodId,
      action: 'POST_CONTRIBUTION',
      summary: `Posted ${entriesPosted} PF passbook entries for ${monthKey}`,
      newValue: { entriesPosted, skipped, totalCredited },
      actorUserId: userId,
    });

    return { periodId, monthKey, financialYear, entriesPosted, skipped, totalCredited };
  }

  /**
   * Credit interest on the closing balance for a financial year.
   *
   * The rate is a REQUIRED parameter. EPFO declares it every year and it is not
   * this application's place to remember or guess one, so there is no default
   * and no fallback.
   */
  async creditPfInterest(financialYear: string, ratePct: number, userId: number): Promise<PfInterestResult> {
    const rate = num(ratePct);
    if (!(rate > 0)) {
      throw new Error('A positive interest rate is required; the EPFO declared rate must be supplied explicitly');
    }
    if (!/^\d{4}-\d{4}$/.test(String(financialYear))) {
      throw new Error('financialYear must look like 2026-2027');
    }

    const reference = `INTEREST-${financialYear}`;
    const employeeIds = await this.repo.findEmployeesWithPfBalance(financialYear);
    if (employeeIds.length === 0) {
      return { financialYear, ratePct: rate, entriesPosted: 0, skipped: 0, totalInterest: 0 };
    }

    const [already, balances] = await Promise.all([
      this.repo.findEntryReferences(reference),
      this.repo.findClosingBalances(employeeIds),
    ]);
    const entryDate = financialYearBounds(financialYear).to;

    let entriesPosted = 0;
    let skipped = 0;
    let totalInterest = 0;

    await this.repo.withTransaction(async (conn) => {
      for (const employeeId of employeeIds) {
        if (already.has(employeeId)) {
          skipped += 1;
          continue;
        }
        const opening = balances.get(employeeId) ?? 0;
        if (opening <= 0) {
          skipped += 1;
          continue;
        }
        const interest = round2((opening * rate) / 100);
        await this.repo.insertPfEntry(
          conn,
          {
            employeeId,
            financialYear,
            monthKey: null,
            entryType: 'INTEREST',
            employeeShare: 0,
            employerShare: 0,
            pensionShare: 0,
            vpfShare: 0,
            interestRatePct: rate,
            closingBalance: round2(opening + interest),
            entryDate,
            reference,
            remarks: `Interest at ${rate}% on the closing balance for ${financialYear}`,
          },
          userId,
        );
        entriesPosted += 1;
        totalInterest = round2(totalInterest + interest);
      }
    });

    await this.master.logAudit({
      entityType: 'PF_ACCOUNT',
      action: 'CREDIT_INTEREST',
      summary: `Credited PF interest at ${rate}% for ${financialYear}`,
      newValue: { entriesPosted, skipped, totalInterest },
      actorUserId: userId,
    });

    return { financialYear, ratePct: rate, entriesPosted, skipped, totalInterest };
  }

  async getPfAccount(employeeId: number, financialYear?: string): Promise<{ employeeId: number; entries: PfAccountEntry[]; closingBalance: number }> {
    const entries = await this.repo.findPfEntries(employeeId, financialYear);
    const last = entries.length > 0 ? entries[entries.length - 1] : null;
    return { employeeId, entries, closingBalance: last ? last.closingBalance : 0 };
  }
}
