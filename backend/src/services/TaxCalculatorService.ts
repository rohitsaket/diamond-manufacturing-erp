import { TaxComputationService, TaxContext } from './TaxComputationService';
import { TaxProofRepository, fyBounds } from '../repositories/TaxProofRepository';
import { TaxRegimeRow, TaxSlabRow } from '../types/payroll';
import { round2 } from '../utils/dateUtils';
import { num } from '../utils/payrollMath';

export interface RegimeComputation {
  regimeId: number;
  regimeCode: string;
  regimeName: string;
  grossAnnual: number;
  standardDeduction: number;
  chapterViaDeductions: number;
  taxableIncome: number;
  taxBeforeRebate: number;
  rebate: number;
  surcharge: number;
  cess: number;
  totalTax: number;
  effectiveRatePct: number;
  allowsExemptions: boolean;
  notes: string[];
}

export interface RegimeComparison {
  available: boolean;
  reason?: string;
  employeeId: number;
  financialYear: string;
  grossAnnual: number;
  grossSource: string;
  old: RegimeComputation | null;
  new: RegimeComputation | null;
  recommended: string | null;
  recommendationNote: string;
  saving: number;
  currentRegimeCode: string | null;
  disclaimer: string;
}

export interface StandaloneCalculationInput {
  annualGross: number;
  regimeCode?: string;
  financialYear: string;
  deductions?: number | Record<string, number>;
}

export interface TakeHomeProjection {
  available: boolean;
  reason?: string;
  employeeId: number;
  financialYear: string;
  monthlyGross: number;
  grossSource: string;
  monthsRemaining: number;
  statutoryDeductions: { pf: number; esi: number; pt: number; lwf: number; source: string };
  monthlyTds: number;
  monthlyNet: number;
  remainingGross: number;
  remainingNet: number;
  annual: {
    grossAnnual: number;
    totalTax: number;
    taxPaidToDate: number;
    remainingTax: number;
    regimeCode: string | null;
  };
  caveats: string[];
}

const COMPARISON_DISCLAIMER =
  'This comparison is arithmetic on the figures already on record: the projected annual gross and the '
  + 'investments declared for the year. It is not tax advice. Anything not declared here -- house property '
  + 'loss, other income, a mid-year change of employer, or a deduction the employee has not entered -- is '
  + 'not in these numbers and can reverse the recommendation.';

/**
 * Regime comparison, a standalone what-if calculator, and a take-home
 * projection.
 *
 * The annual projection comes from `TaxComputationService` so the numbers here
 * agree with the ones payroll actually deducts. That service picks the regime
 * from the employee's declaration and offers no override, so the slab
 * arithmetic is repeated here -- once per regime, against the same projected
 * gross -- in the same order the Act applies it: standard deduction, then
 * Chapter VI-A where the regime allows it, then slabs, rebate, surcharge, cess.
 *
 * Nothing is ever assumed about the slabs. When a financial year has no regime
 * configured, this reports that plainly instead of inventing rates.
 */
export class TaxCalculatorService {
  private tax = new TaxComputationService();
  private repo = new TaxProofRepository();

  // -------------------------------------------------------------------------
  // Regime comparison
  // -------------------------------------------------------------------------

  async compareRegimes(employeeId: number, financialYear: string): Promise<RegimeComparison> {
    const fy = this.normaliseFy(financialYear);
    const bounds = fyBounds(fy);
    const context = await this.tax.loadContext(fy, [employeeId]);

    const empty = (reason: string): RegimeComparison => ({
      available: false,
      reason,
      employeeId,
      financialYear: fy,
      grossAnnual: 0,
      grossSource: 'NONE',
      old: null,
      new: null,
      recommended: null,
      recommendationNote: reason,
      saving: 0,
      currentRegimeCode: null,
      disclaimer: COMPARISON_DISCLAIMER,
    });

    if (context.regimesById.size === 0) {
      return empty(`No tax regime is configured for ${fy}, so there is nothing to compare.`);
    }

    const estimate = await this.repo.getMonthlyGrossEstimate(employeeId, bounds.from, bounds.to);
    const baseline = await this.tax.computeAnnualTax(employeeId, fy, {
      monthlyGross: estimate.monthlyGross,
      context,
      persist: false,
    });
    const grossAnnual = baseline.grossAnnual;

    const declaration = context.declarationByEmployee.get(employeeId) ?? null;
    const declaredDeductions = this.chapterViaFor(context, declaration ? Number(declaration.id) : null,
      declaration?.status === 'VERIFIED');

    const computations: RegimeComputation[] = [];
    for (const regime of context.regimesById.values()) {
      const slabs = context.slabsByRegime.get(Number(regime.id)) ?? [];
      if (slabs.length === 0) continue;
      computations.push(this.computeForRegime(regime, slabs, grossAnnual, declaredDeductions));
    }
    if (computations.length === 0) {
      return empty(`No tax regime for ${fy} has any slabs configured, so no tax can be computed.`);
    }

    const oldRegime = computations.find((c) => c.allowsExemptions) ?? null;
    const newRegime = computations.find((c) => !c.allowsExemptions) ?? null;

    const cheapest = computations.reduce((best, c) => (c.totalTax < best.totalTax ? c : best), computations[0] as RegimeComputation);
    const dearest = computations.reduce((worst, c) => (c.totalTax > worst.totalTax ? c : worst), computations[0] as RegimeComputation);

    const currentRegime = declaration?.regime_id
      ? context.regimesById.get(Number(declaration.regime_id))?.code ?? null
      : context.defaultRegime?.code ?? null;

    const saving = round2(Math.max(0, dearest.totalTax - cheapest.totalTax));
    const recommendationNote = computations.length < 2
      ? `Only one regime is configured for ${fy}, so there is nothing to choose between.`
      : saving === 0
        ? 'Both regimes produce the same tax on these figures, so the choice makes no difference here. '
          + 'It can change the moment the projected gross or the declared investments do.'
        : `${cheapest.regimeCode} costs ${saving} less than ${dearest.regimeCode} on the figures currently on record.`;

    return {
      available: true,
      employeeId,
      financialYear: fy,
      grossAnnual,
      grossSource: estimate.source,
      old: oldRegime,
      new: newRegime,
      recommended: computations.length > 1 && saving > 0 ? cheapest.regimeCode : null,
      recommendationNote,
      saving,
      currentRegimeCode: currentRegime,
      disclaimer: COMPARISON_DISCLAIMER,
    };
  }

  // -------------------------------------------------------------------------
  // Standalone calculator
  // -------------------------------------------------------------------------

  /**
   * A calculator with no employee attached, for the "what if I earned X"
   * question. Same slab arithmetic, same refusal to guess at missing slabs.
   */
  async calculate(input: StandaloneCalculationInput): Promise<{
    available: boolean;
    reason?: string;
    financialYear: string;
    annualGross: number;
    deductionsApplied: number;
    results: RegimeComputation[];
    recommended: string | null;
    saving: number;
  }> {
    const fy = this.normaliseFy(input.financialYear);
    const annualGross = round2(Number(input.annualGross));
    if (!Number.isFinite(annualGross) || annualGross < 0) throw new Error('Annual gross must be a non-negative number');

    let deductions = 0;
    if (typeof input.deductions === 'number') {
      deductions = Number(input.deductions);
    } else if (input.deductions && typeof input.deductions === 'object') {
      deductions = Object.values(input.deductions).reduce((sum, value) => sum + (Number(value) || 0), 0);
    }
    if (deductions < 0) throw new Error('Deductions cannot be negative');
    deductions = round2(deductions);

    // No employee, so an empty id list is enough to load the year's tables.
    const context = await this.tax.loadContext(fy, []);
    if (context.regimesById.size === 0) {
      return {
        available: false,
        reason: `No tax regime is configured for ${fy}; no slabs exist to calculate against.`,
        financialYear: fy,
        annualGross,
        deductionsApplied: deductions,
        results: [],
        recommended: null,
        saving: 0,
      };
    }

    const wanted = input.regimeCode ? String(input.regimeCode).trim().toUpperCase() : null;
    const results: RegimeComputation[] = [];
    for (const regime of context.regimesById.values()) {
      if (wanted && String(regime.code).toUpperCase() !== wanted) continue;
      const slabs = context.slabsByRegime.get(Number(regime.id)) ?? [];
      if (slabs.length === 0) continue;
      results.push(this.computeForRegime(regime, slabs, annualGross, deductions));
    }

    if (results.length === 0) {
      return {
        available: false,
        reason: wanted
          ? `Regime ${wanted} has no slabs configured for ${fy}.`
          : `No regime for ${fy} has slabs configured.`,
        financialYear: fy,
        annualGross,
        deductionsApplied: deductions,
        results: [],
        recommended: null,
        saving: 0,
      };
    }

    const cheapest = results.reduce((best, c) => (c.totalTax < best.totalTax ? c : best), results[0] as RegimeComputation);
    const dearest = results.reduce((worst, c) => (c.totalTax > worst.totalTax ? c : worst), results[0] as RegimeComputation);
    return {
      available: true,
      financialYear: fy,
      annualGross,
      deductionsApplied: deductions,
      results,
      recommended: results.length > 1 ? cheapest.regimeCode : null,
      saving: round2(Math.max(0, dearest.totalTax - cheapest.totalTax)),
    };
  }

  // -------------------------------------------------------------------------
  // Take-home projection
  // -------------------------------------------------------------------------

  async projectTakeHome(employeeId: number, financialYear: string): Promise<TakeHomeProjection> {
    const fy = this.normaliseFy(financialYear);
    const bounds = fyBounds(fy);
    const [estimate, lastLine] = await Promise.all([
      this.repo.getMonthlyGrossEstimate(employeeId, bounds.from, bounds.to),
      this.repo.getLatestSalaryLine(employeeId, bounds.from, bounds.to),
    ]);

    const caveats: string[] = [];
    if (estimate.source === 'NONE') {
      return {
        available: false,
        reason: 'No processed payslip, salary package or monthly salary is on record for this employee, '
          + 'so there is nothing to project a take-home from.',
        employeeId,
        financialYear: fy,
        monthlyGross: 0,
        grossSource: estimate.source,
        monthsRemaining: 0,
        statutoryDeductions: { pf: 0, esi: 0, pt: 0, lwf: 0, source: 'NONE' },
        monthlyTds: 0,
        monthlyNet: 0,
        remainingGross: 0,
        remainingNet: 0,
        annual: { grossAnnual: 0, totalTax: 0, taxPaidToDate: 0, remainingTax: 0, regimeCode: null },
        caveats,
      };
    }
    if (estimate.source !== 'PAYROLL') {
      caveats.push('Monthly gross comes from the assigned salary rather than a processed payslip, so it is a quote, not a measurement.');
    }

    const computation = await this.tax.computeAnnualTax(employeeId, fy, {
      monthlyGross: estimate.monthlyGross,
      persist: false,
    });
    for (const warning of computation.warnings) caveats.push(warning);

    const deductions = lastLine
      ? { pf: lastLine.pf, esi: lastLine.esi, pt: lastLine.pt, lwf: lastLine.lwf, source: `last payslip (${lastLine.periodLabel})` }
      : { pf: 0, esi: 0, pt: 0, lwf: 0, source: 'none on record' };
    if (!lastLine) {
      caveats.push('No payslip exists for this year, so PF, ESI, PT and LWF are shown as zero rather than estimated.');
    }

    const monthlyGross = round2(estimate.monthlyGross);
    const monthlyStatutory = round2(deductions.pf + deductions.esi + deductions.pt + deductions.lwf);
    const monthlyTds = round2(computation.monthlyTds);
    const monthlyNet = round2(Math.max(0, monthlyGross - monthlyStatutory - monthlyTds));
    const monthsRemaining = computation.monthsRemaining;

    return {
      available: true,
      employeeId,
      financialYear: fy,
      monthlyGross,
      grossSource: estimate.source,
      monthsRemaining,
      statutoryDeductions: {
        pf: round2(deductions.pf),
        esi: round2(deductions.esi),
        pt: round2(deductions.pt),
        lwf: round2(deductions.lwf),
        source: deductions.source,
      },
      monthlyTds,
      monthlyNet,
      remainingGross: round2(monthlyGross * monthsRemaining),
      remainingNet: round2(monthlyNet * monthsRemaining),
      annual: {
        grossAnnual: computation.grossAnnual,
        totalTax: computation.totalTax,
        taxPaidToDate: computation.taxPaidToDate,
        remainingTax: computation.remainingTax,
        regimeCode: computation.regimeCode,
      },
      caveats,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * The Chapter VI-A total an employee has declared, capped section by section
   * and then by shared limit group -- the same rule the payroll tax engine
   * applies, so a comparison never shows a deduction payroll would refuse.
   */
  private chapterViaFor(context: TaxContext, declarationId: number | null, verified: boolean): number {
    if (!declarationId) return 0;
    const items = context.itemsByDeclaration.get(declarationId) ?? [];
    let total = 0;
    const groupTotals = new Map<string, number>();
    const groupCaps = new Map<string, number>();

    for (const item of items) {
      const claimed = verified ? item.approved_amount : item.declared_amount;
      const capped = item.max_limit !== null ? Math.min(claimed, item.max_limit) : claimed;
      if (capped <= 0) continue;
      if (item.limit_group) {
        groupTotals.set(item.limit_group, round2((groupTotals.get(item.limit_group) ?? 0) + capped));
        if (item.max_limit !== null) {
          const current = groupCaps.get(item.limit_group);
          groupCaps.set(item.limit_group, current === undefined ? item.max_limit : Math.min(current, item.max_limit));
        }
      } else {
        total = round2(total + capped);
      }
    }
    for (const [group, groupTotal] of groupTotals) {
      const cap = groupCaps.get(group);
      total = round2(total + (cap === undefined ? groupTotal : Math.min(groupTotal, cap)));
    }
    return total;
  }

  private computeForRegime(
    regime: TaxRegimeRow,
    slabs: TaxSlabRow[],
    grossAnnual: number,
    declaredDeductions: number,
  ): RegimeComputation {
    const notes: string[] = [];
    const allowsExemptions = regime.allows_exemptions === 1 || regime.allows_exemptions === true;
    const standardDeduction = round2(num(regime.standard_deduction));
    const chapterVia = allowsExemptions ? round2(declaredDeductions) : 0;
    if (!allowsExemptions && declaredDeductions > 0) {
      notes.push(`Regime ${regime.code} does not allow exemptions, so the ${round2(declaredDeductions)} declared was ignored.`);
    }

    const taxableIncome = round2(Math.max(0, grossAnnual - standardDeduction - chapterVia));

    let taxBeforeRebate = 0;
    let surchargePct = 0;
    const ordered = [...slabs].sort((a, b) => num(a.from_amount) - num(b.from_amount));
    for (const slab of ordered) {
      const from = num(slab.from_amount);
      const to = slab.to_amount === null ? Number.POSITIVE_INFINITY : num(slab.to_amount);
      if (taxableIncome <= from) continue;
      const slice = Math.min(taxableIncome, to) - from;
      if (slice <= 0) continue;
      taxBeforeRebate = round2(taxBeforeRebate + (slice * num(slab.rate_pct)) / 100);
      surchargePct = num(slab.surcharge_pct);
    }

    let rebate = 0;
    if (regime.rebate_limit !== null && taxableIncome <= num(regime.rebate_limit)) {
      const cap = regime.rebate_amount === null ? taxBeforeRebate : num(regime.rebate_amount);
      rebate = round2(Math.min(taxBeforeRebate, cap));
    }
    const afterRebate = round2(Math.max(0, taxBeforeRebate - rebate));
    const surcharge = round2((afterRebate * surchargePct) / 100);
    const cess = round2(((afterRebate + surcharge) * num(regime.cess_pct)) / 100);
    const totalTax = round2(afterRebate + surcharge + cess);

    return {
      regimeId: Number(regime.id),
      regimeCode: String(regime.code),
      regimeName: String(regime.name),
      grossAnnual: round2(grossAnnual),
      standardDeduction,
      chapterViaDeductions: chapterVia,
      taxableIncome,
      taxBeforeRebate,
      rebate,
      surcharge,
      cess,
      totalTax,
      effectiveRatePct: grossAnnual > 0 ? Math.round((totalTax / grossAnnual) * 1000) / 10 : 0,
      allowsExemptions,
      notes,
    };
  }

  private normaliseFy(financialYear: string): string {
    const fy = String(financialYear ?? '').trim();
    if (!/^\d{4}-\d{4}$/.test(fy)) throw new Error("Financial year must look like '2026-2027'");
    return fy;
  }
}
