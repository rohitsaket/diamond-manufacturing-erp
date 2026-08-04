import { BaseRepository } from '../repositories/BaseRepository';
import {
  TaxComputationResult,
  TaxRegimeRow,
  TaxSlabRow,
} from '../types/payroll';
import { round2, toDateString, todayString } from '../utils/dateUtils';
import { num } from '../utils/payrollMath';

interface DeclarationRow {
  id: number;
  employee_id: number;
  financial_year: string;
  regime_id: number | null;
  status: 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'LOCKED';
}

interface DeclarationItemRow {
  declaration_id: number;
  section_id: number;
  section_code: string;
  declared_amount: number;
  approved_amount: number;
  max_limit: number | null;
  limit_group: string | null;
}

interface YtdRow {
  employeeId: number;
  gross: number;
  taxPaid: number;
  months: number;
}

/**
 * Everything the tax engine needs for one financial year, loaded once.
 *
 * A payroll run over 100k employees must not issue four queries per employee, so
 * the engine calls `loadContext` once and passes it into every computation.
 */
export interface TaxContext {
  financialYear: string;
  defaultRegime: TaxRegimeRow | null;
  regimesById: Map<number, TaxRegimeRow>;
  slabsByRegime: Map<number, TaxSlabRow[]>;
  declarationByEmployee: Map<number, DeclarationRow>;
  itemsByDeclaration: Map<number, DeclarationItemRow[]>;
  ytdByEmployee: Map<number, YtdRow>;
}

export interface ComputeAnnualTaxOptions {
  /**
   * Gross the employee is expected to earn each remaining month. Omit it to
   * project on year-to-date earnings alone (what a standalone recompute from the
   * declaration screen wants).
   */
  monthlyGross?: number;
  /** Date the projection is made from; defaults to today. */
  asOfDate?: string;
  /** Period being computed right now — excluded from year-to-date figures. */
  excludePeriodId?: number;
  /** Preloaded context; built on demand for a single employee when omitted. */
  context?: TaxContext;
  /** Write the result into `tax_computations`. Simulations pass false. */
  persist?: boolean;
  /** Override the projection horizon (defaults to the months left in the FY). */
  monthsRemaining?: number;
}

class TaxRepository extends BaseRepository {
  private static idList(ids: number[]): string {
    const clean = ids
      .map((id) => Math.floor(Number(id)))
      .filter((id) => Number.isFinite(id) && id > 0);
    return clean.length ? clean.join(',') : '';
  }

  async getRegimes(financialYear: string): Promise<TaxRegimeRow[]> {
    return this.query<TaxRegimeRow[]>(
      `SELECT * FROM tax_regimes WHERE financial_year = ? AND is_active = true ORDER BY is_default DESC, id ASC`,
      [financialYear],
    );
  }

  async getSlabs(regimeIds: number[]): Promise<TaxSlabRow[]> {
    const list = TaxRepository.idList(regimeIds);
    if (!list) return [];
    return this.query<TaxSlabRow[]>(
      `SELECT * FROM tax_slabs WHERE regime_id IN (${list}) ORDER BY regime_id ASC, slab_order ASC, from_amount ASC`,
      [],
    );
  }

  async getDeclarations(financialYear: string, employeeIds?: number[]): Promise<DeclarationRow[]> {
    let sql = `SELECT id, employee_id, financial_year, regime_id, status
               FROM tax_declarations WHERE financial_year = ?`;
    if (employeeIds && employeeIds.length > 0) {
      const list = TaxRepository.idList(employeeIds);
      if (!list) return [];
      sql += ` AND employee_id IN (${list})`;
    }
    return this.query<DeclarationRow[]>(sql, [financialYear]);
  }

  async getDeclarationItems(declarationIds: number[]): Promise<DeclarationItemRow[]> {
    const list = TaxRepository.idList(declarationIds);
    if (!list) return [];
    const rows = await this.query<any[]>(
      `SELECT di.declaration_id, di.section_id, di.declared_amount, di.approved_amount,
              s.code AS section_code, s.max_limit, s.limit_group
       FROM tax_declaration_items di
       JOIN tax_declaration_sections s ON s.id = di.section_id
       WHERE di.declaration_id IN (${list}) AND s.is_active = true`,
      [],
    );
    return rows.map((r) => ({
      declaration_id: Number(r.declaration_id),
      section_id: Number(r.section_id),
      section_code: r.section_code,
      declared_amount: num(r.declared_amount),
      approved_amount: num(r.approved_amount),
      max_limit: r.max_limit === null ? null : num(r.max_limit),
      limit_group: r.limit_group ?? null,
    }));
  }

  /** Gross paid and TDS already deducted inside the financial year, per employee. */
  async getYtd(
    fyFrom: string,
    fyTo: string,
    employeeIds?: number[],
    excludePeriodId?: number,
  ): Promise<Map<number, YtdRow>> {
    let sql = `SELECT sl.employee_id,
                      COALESCE(SUM(sl.gross_amount), 0) AS gross,
                      COALESCE(SUM(sl.ded_income_tax), 0) AS tax_paid,
                      COUNT(*) AS months
               FROM salary_lines sl
               JOIN salary_periods p ON p.id = sl.period_id
               WHERE p.deleted_at IS NULL AND p.from_date >= ? AND p.to_date <= ?`;
    const params: any[] = [fyFrom, fyTo];
    if (excludePeriodId) {
      sql += ' AND p.id <> ?';
      params.push(excludePeriodId);
    }
    if (employeeIds && employeeIds.length > 0) {
      const list = TaxRepository.idList(employeeIds);
      if (!list) return new Map();
      sql += ` AND sl.employee_id IN (${list})`;
    }
    sql += ' GROUP BY sl.employee_id';

    const rows = await this.query<any[]>(sql, params);
    const map = new Map<number, YtdRow>();
    for (const r of rows) {
      map.set(Number(r.employee_id), {
        employeeId: Number(r.employee_id),
        gross: num(r.gross),
        taxPaid: num(r.tax_paid),
        months: Number(r.months) || 0,
      });
    }
    return map;
  }

  async upsertComputation(result: TaxComputationResult): Promise<void> {
    await this.query(
      `INSERT INTO tax_computations
        (employee_id, financial_year, regime_id, gross_annual, exemptions, standard_deduction,
         chapter_via_deductions, taxable_income, tax_before_rebate, rebate, surcharge, cess,
         total_tax, tax_paid_to_date, remaining_tax, monthly_tds, months_remaining, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         regime_id = VALUES(regime_id),
         gross_annual = VALUES(gross_annual),
         exemptions = VALUES(exemptions),
         standard_deduction = VALUES(standard_deduction),
         chapter_via_deductions = VALUES(chapter_via_deductions),
         taxable_income = VALUES(taxable_income),
         tax_before_rebate = VALUES(tax_before_rebate),
         rebate = VALUES(rebate),
         surcharge = VALUES(surcharge),
         cess = VALUES(cess),
         total_tax = VALUES(total_tax),
         tax_paid_to_date = VALUES(tax_paid_to_date),
         remaining_tax = VALUES(remaining_tax),
         monthly_tds = VALUES(monthly_tds),
         months_remaining = VALUES(months_remaining),
         computed_at = NOW()`,
      [
        result.employeeId,
        result.financialYear,
        result.regimeId,
        result.grossAnnual,
        result.exemptions,
        result.standardDeduction,
        result.chapterViaDeductions,
        result.taxableIncome,
        result.taxBeforeRebate,
        result.rebate,
        result.surcharge,
        result.cess,
        result.totalTax,
        result.taxPaidToDate,
        result.remainingTax,
        result.monthlyTds,
        Math.max(0, Math.min(255, result.monthsRemaining)),
      ],
    );
  }

  async getComputation(employeeId: number, financialYear: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM tax_computations WHERE employee_id = ? AND financial_year = ?',
      [employeeId, financialYear],
    );
    return rows[0] ?? null;
  }
}

/**
 * Indian income tax / TDS.
 *
 * The annual liability is projected from what the employee has already been paid
 * this financial year plus what they are expected to earn for the rest of it;
 * one twelfth-ish of the remaining liability becomes this month's TDS. Every
 * number that could be a legal figure — slabs, rates, rebate, cess, standard
 * deduction, section caps — comes from the database. Nothing is hard-coded, and
 * when the tables are empty the service reports zero tax with a warning instead
 * of inventing slabs.
 */
export class TaxComputationService {
  private repo = new TaxRepository();

  /**
   * Indian financial year for a date: 1 April to 31 March, formatted `2026-2027`.
   */
  getFinancialYear(date: string): string {
    const d = toDateString(date);
    const year = Number(d.slice(0, 4));
    const month = Number(d.slice(5, 7));
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      const today = todayString();
      return this.getFinancialYear(today);
    }
    return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
  }

  /** First and last day of a financial year string. */
  getFinancialYearBounds(financialYear: string): { from: string; to: string } {
    const startYear = Number(financialYear.slice(0, 4));
    return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
  }

  /** Months left in the financial year, counting the month of `date` itself. */
  monthsRemainingInFy(date: string): number {
    const month = Number(toDateString(date).slice(5, 7));
    if (!Number.isFinite(month)) return 12;
    const indexInFy = month >= 4 ? month - 3 : month + 9; // April = 1 … March = 12
    return Math.max(1, 13 - indexInFy);
  }

  /** Load every FY-wide table once so a payroll run stays O(1) in queries. */
  async loadContext(
    financialYear: string,
    employeeIds: number[],
    excludePeriodId?: number,
  ): Promise<TaxContext> {
    const bounds = this.getFinancialYearBounds(financialYear);
    const regimes = await this.repo.getRegimes(financialYear);
    const regimeIds = regimes.map((r) => Number(r.id));
    const [slabs, declarations, ytdByEmployee] = await Promise.all([
      this.repo.getSlabs(regimeIds),
      this.repo.getDeclarations(financialYear, employeeIds),
      this.repo.getYtd(bounds.from, bounds.to, employeeIds, excludePeriodId),
    ]);
    const items = await this.repo.getDeclarationItems(declarations.map((d) => Number(d.id)));

    const regimesById = new Map<number, TaxRegimeRow>();
    for (const r of regimes) regimesById.set(Number(r.id), r);

    const slabsByRegime = new Map<number, TaxSlabRow[]>();
    for (const s of slabs) {
      const list = slabsByRegime.get(Number(s.regime_id)) ?? [];
      list.push(s);
      slabsByRegime.set(Number(s.regime_id), list);
    }

    const declarationByEmployee = new Map<number, DeclarationRow>();
    for (const d of declarations) declarationByEmployee.set(Number(d.employee_id), d);

    const itemsByDeclaration = new Map<number, DeclarationItemRow[]>();
    for (const i of items) {
      const list = itemsByDeclaration.get(i.declaration_id) ?? [];
      list.push(i);
      itemsByDeclaration.set(i.declaration_id, list);
    }

    const defaultRegime = regimes.find((r) => r.is_default === 1 || r.is_default === true) ?? regimes[0] ?? null;

    return {
      financialYear,
      defaultRegime,
      regimesById,
      slabsByRegime,
      declarationByEmployee,
      itemsByDeclaration,
      ytdByEmployee,
    };
  }

  /**
   * The taxable income at which a regime starts costing money: the standard
   * deduction plus the top of its zero-rate slab. The payroll engine uses this
   * to skip the whole tax path for employees who obviously owe nothing.
   */
  zeroTaxThreshold(context: TaxContext, regimeId?: number | null): number {
    const regime = (regimeId ? context.regimesById.get(regimeId) : null) ?? context.defaultRegime;
    if (!regime) return Number.POSITIVE_INFINITY;
    const slabs = context.slabsByRegime.get(Number(regime.id)) ?? [];
    let zeroTop = 0;
    for (const slab of slabs) {
      if (num(slab.rate_pct) === 0 && slab.to_amount !== null) zeroTop = Math.max(zeroTop, num(slab.to_amount));
    }
    // The rebate makes income up to `rebate_limit` tax free in practice too.
    const rebateLimit = regime.rebate_limit === null ? 0 : num(regime.rebate_limit);
    return num(regime.standard_deduction) + Math.max(zeroTop, rebateLimit);
  }

  /**
   * Project the annual liability and derive this month's TDS.
   *
   * Order of operations, which is the order the Income Tax Act applies them:
   *   projected gross -> standard deduction -> Chapter VI-A (old regime only)
   *   -> slabs -> rebate -> surcharge -> cess.
   */
  async computeAnnualTax(
    employeeId: number,
    financialYear: string,
    opts: ComputeAnnualTaxOptions,
  ): Promise<TaxComputationResult> {
    const warnings: string[] = [];
    const asOfDate = opts.asOfDate ?? todayString();
    const context = opts.context ?? (await this.loadContext(financialYear, [employeeId], opts.excludePeriodId));

    const declaration = context.declarationByEmployee.get(employeeId) ?? null;
    const regime = (declaration?.regime_id ? context.regimesById.get(Number(declaration.regime_id)) : null)
      ?? context.defaultRegime;

    const ytd = context.ytdByEmployee.get(employeeId) ?? { employeeId, gross: 0, taxPaid: 0, months: 0 };
    const monthsRemaining = Math.max(1, Math.floor(opts.monthsRemaining ?? this.monthsRemainingInFy(asOfDate)));
    const monthlyGross = round2(num(opts.monthlyGross));
    const grossAnnual = round2(ytd.gross + monthlyGross * monthsRemaining);

    const empty = (message: string): TaxComputationResult => ({
      employeeId,
      financialYear,
      regimeId: regime ? Number(regime.id) : null,
      regimeCode: regime?.code ?? null,
      grossAnnual,
      exemptions: 0,
      standardDeduction: 0,
      chapterViaDeductions: 0,
      taxableIncome: 0,
      taxBeforeRebate: 0,
      rebate: 0,
      surcharge: 0,
      cess: 0,
      totalTax: 0,
      taxPaidToDate: round2(ytd.taxPaid),
      remainingTax: 0,
      monthlyTds: 0,
      monthsRemaining,
      warnings: [message],
    });

    if (!regime) {
      return empty(`No active tax regime configured for ${financialYear}; no TDS was computed.`);
    }
    const slabs = context.slabsByRegime.get(Number(regime.id)) ?? [];
    if (slabs.length === 0) {
      return empty(`Tax regime ${regime.code} has no slabs for ${financialYear}; no TDS was computed.`);
    }

    // ---- deductions -------------------------------------------------------
    const standardDeduction = round2(num(regime.standard_deduction));
    let chapterVia = 0;
    const allowsExemptions = regime.allows_exemptions === 1 || regime.allows_exemptions === true;

    if (allowsExemptions && declaration) {
      const items = context.itemsByDeclaration.get(Number(declaration.id)) ?? [];
      const verified = declaration.status === 'VERIFIED';
      const groupTotals = new Map<string, number>();
      const groupCaps = new Map<string, number>();

      for (const item of items) {
        // A verified declaration is worth its approved proof; anything else is
        // still only a promise, so the declared figure is used.
        const claimed = verified ? item.approved_amount : item.declared_amount;
        const capped = item.max_limit !== null ? Math.min(claimed, item.max_limit) : claimed;
        if (capped <= 0) continue;

        if (item.limit_group) {
          groupTotals.set(item.limit_group, round2((groupTotals.get(item.limit_group) ?? 0) + capped));
          // Sections sharing a group compete for the smallest cap declared on it.
          if (item.max_limit !== null) {
            const current = groupCaps.get(item.limit_group);
            groupCaps.set(item.limit_group, current === undefined ? item.max_limit : Math.min(current, item.max_limit));
          }
        } else {
          chapterVia = round2(chapterVia + capped);
        }
      }

      for (const [group, total] of groupTotals) {
        const cap = groupCaps.get(group);
        chapterVia = round2(chapterVia + (cap === undefined ? total : Math.min(total, cap)));
      }
    } else if (declaration && !allowsExemptions) {
      warnings.push(`Regime ${regime.code} does not allow exemptions; declared investments were ignored.`);
    }

    const taxableIncome = round2(Math.max(0, grossAnnual - standardDeduction - chapterVia));

    // ---- slabs ------------------------------------------------------------
    let taxBeforeRebate = 0;
    let surchargePct = 0;
    for (const slab of slabs) {
      const from = num(slab.from_amount);
      const to = slab.to_amount === null ? Number.POSITIVE_INFINITY : num(slab.to_amount);
      if (taxableIncome <= from) continue;
      const slice = Math.min(taxableIncome, to) - from;
      if (slice <= 0) continue;
      taxBeforeRebate = round2(taxBeforeRebate + (slice * num(slab.rate_pct)) / 100);
      surchargePct = num(slab.surcharge_pct);
    }

    // ---- rebate, surcharge, cess -----------------------------------------
    let rebate = 0;
    if (regime.rebate_limit !== null && taxableIncome <= num(regime.rebate_limit)) {
      const cap = regime.rebate_amount === null ? taxBeforeRebate : num(regime.rebate_amount);
      rebate = round2(Math.min(taxBeforeRebate, cap));
    }

    const taxAfterRebate = round2(Math.max(0, taxBeforeRebate - rebate));
    const surcharge = round2((taxAfterRebate * surchargePct) / 100);
    const cess = round2(((taxAfterRebate + surcharge) * num(regime.cess_pct)) / 100);
    const totalTax = round2(taxAfterRebate + surcharge + cess);

    const taxPaidToDate = round2(ytd.taxPaid);
    const remainingTax = round2(Math.max(0, totalTax - taxPaidToDate));
    const monthlyTds = round2(remainingTax / Math.max(1, monthsRemaining));

    const result: TaxComputationResult = {
      employeeId,
      financialYear,
      regimeId: Number(regime.id),
      regimeCode: regime.code,
      grossAnnual,
      exemptions: standardDeduction,
      standardDeduction,
      chapterViaDeductions: chapterVia,
      taxableIncome,
      taxBeforeRebate,
      rebate,
      surcharge,
      cess,
      totalTax,
      taxPaidToDate,
      remainingTax,
      monthlyTds,
      monthsRemaining,
      warnings,
    };

    if (opts.persist !== false) {
      await this.repo.upsertComputation(result);
    }
    return result;
  }

  /** The stored projection, if one has been computed. */
  async getComputation(employeeId: number, financialYear: string): Promise<any | null> {
    return this.repo.getComputation(employeeId, financialYear);
  }
}

export const taxComputationService = new TaxComputationService();
