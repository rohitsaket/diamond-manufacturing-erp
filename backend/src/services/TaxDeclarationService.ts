import {
  TaxDeclarationRepository,
  DeclarationItemResponse,
  DeclarationResponse,
  DeclarationStatus,
  ProofStatus,
  TaxComputationResponse,
  TaxRegimeResponse,
  TaxSectionResponse,
  TaxSlabResponse,
} from '../repositories/TaxDeclarationRepository';
import { TaxComputationService } from './TaxComputationService';
import { round2 } from '../utils/dateUtils';

export interface SaveDeclarationInput {
  regimeId?: number | null;
  items: {
    sectionId: number;
    declaredAmount: number;
    proofAmount?: number;
    documentId?: number | null;
    remarks?: string | null;
  }[];
}

export interface VerifyDecision {
  itemId: number;
  approvedAmount: number;
  proofStatus?: ProofStatus;
  remarks?: string | null;
}

export interface Form16Data {
  employee: {
    id: number;
    empCode: string;
    fullName: string;
    pan: string | null;
    designation: string | null;
    joinedAt: string | null;
  };
  financialYear: string;
  regime: string | null;
  partB: {
    grossSalary: number;
    bonusAndVariable: number;
    arrears: number;
    exemptions: number;
    standardDeduction: number;
    professionalTax: number;
    chapterViaDeductions: number;
    taxableIncome: number;
    taxPayable: number;
    rebate: number;
    surcharge: number;
    cess: number;
    totalTax: number;
    tdsDeducted: number;
    balancePayable: number;
  };
  quarterlyTds: { period: string; from: string; to: string; gross: number; tds: number }[];
  deductionBreakup: { code: string; name: string; declared: number; approved: number }[];
  /**
   * A statutory Form 16 is issued from the TRACES portal with a digital
   * signature and a certificate number. This is the underlying data only.
   */
  isStatutoryForm: false;
  disclaimer: string;
}

/** Financial year for a date, Indian convention: April to March. */
function financialYearFor(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

/** `2026-2027` -> the 1 April / 31 March window it covers. */
function fyBounds(financialYear: string): { from: string; to: string } {
  const start = Number(String(financialYear).slice(0, 4));
  if (!Number.isFinite(start)) throw new Error("Financial year must look like '2026-2027'");
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/**
 * Tax configuration and employee investment declarations.
 *
 * Declarations are stored per (employee, financial year). Reading a year that
 * has never been saved returns a DRAFT shell built in memory -- nothing is
 * written until the employee actually saves, so the table only ever holds real
 * declarations.
 */
export class TaxDeclarationService {
  private repo = new TaxDeclarationRepository();
  private computation = new TaxComputationService();

  // -------------------------------------------------------------------------
  // Regimes and slabs
  // -------------------------------------------------------------------------

  async listRegimes(financialYear?: string, includeInactive = false): Promise<TaxRegimeResponse[]> {
    const regimes = await this.repo.listRegimes(financialYear, includeInactive);
    for (const regime of regimes) {
      regime.slabs = await this.repo.listSlabs(regime.id);
    }
    return regimes;
  }

  async getRegime(id: number): Promise<TaxRegimeResponse> {
    const regime = await this.repo.findRegimeById(id);
    if (!regime) throw new Error('Tax regime not found');
    regime.slabs = await this.repo.listSlabs(id);
    return regime;
  }

  async listSlabs(regimeId: number): Promise<TaxSlabResponse[]> {
    await this.getRegime(regimeId);
    return this.repo.listSlabs(regimeId);
  }

  async createSlab(input: {
    regimeId: number;
    fromAmount: number;
    toAmount?: number | null;
    ratePct: number;
    surchargePct?: number;
    slabOrder?: number;
  }): Promise<TaxSlabResponse[]> {
    await this.getRegime(input.regimeId);
    const existing = await this.repo.listSlabs(input.regimeId);
    const candidate: TaxSlabResponse = {
      id: 0,
      regimeId: input.regimeId,
      fromAmount: Number(input.fromAmount),
      toAmount: input.toAmount === undefined || input.toAmount === null ? null : Number(input.toAmount),
      ratePct: Number(input.ratePct),
      surchargePct: Number(input.surchargePct ?? 0),
      slabOrder: Number(input.slabOrder ?? existing.length + 1),
    };
    this.assertSlabsValid([...existing, candidate]);

    await this.repo.createSlab({
      regimeId: candidate.regimeId,
      fromAmount: candidate.fromAmount,
      toAmount: candidate.toAmount,
      ratePct: candidate.ratePct,
      surchargePct: candidate.surchargePct,
      slabOrder: candidate.slabOrder,
    });
    return this.repo.listSlabs(input.regimeId);
  }

  async updateSlab(id: number, input: {
    fromAmount?: number;
    toAmount?: number | null;
    ratePct?: number;
    surchargePct?: number;
    slabOrder?: number;
  }): Promise<TaxSlabResponse[]> {
    const slab = await this.repo.findSlabById(id);
    if (!slab) throw new Error('Tax slab not found');

    const existing = await this.repo.listSlabs(slab.regimeId);
    const merged = existing.map((s) => (s.id === id ? { ...s, ...this.cleanSlabPatch(input) } : s));
    this.assertSlabsValid(merged);

    await this.repo.updateSlab(id, input);
    return this.repo.listSlabs(slab.regimeId);
  }

  async deleteSlab(id: number): Promise<TaxSlabResponse[]> {
    const slab = await this.repo.findSlabById(id);
    if (!slab) throw new Error('Tax slab not found');
    await this.repo.deleteSlab(id);
    return this.repo.listSlabs(slab.regimeId);
  }

  // -------------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------------

  async listSections(includeInactive = false): Promise<TaxSectionResponse[]> {
    return this.repo.listSections(includeInactive);
  }

  async createSection(input: {
    code: string;
    name: string;
    maxLimit?: number | null;
    limitGroup?: string | null;
    country?: string;
    isActive?: boolean;
  }): Promise<TaxSectionResponse> {
    if (!input.code || !input.name) throw new Error('Section code and name are required');
    const id = await this.repo.createSection(input);
    const section = await this.repo.findSectionById(id);
    if (!section) throw new Error('Section could not be created');
    return section;
  }

  async updateSection(id: number, input: Record<string, unknown>): Promise<TaxSectionResponse> {
    const existing = await this.repo.findSectionById(id);
    if (!existing) throw new Error('Declaration section not found');
    await this.repo.updateSection(id, input);
    const section = await this.repo.findSectionById(id);
    if (!section) throw new Error('Declaration section not found');
    return section;
  }

  /**
   * A section already claimed against is deactivated rather than deleted:
   * removing it would silently rewrite past declarations.
   */
  async deleteSection(id: number): Promise<{ deleted: boolean; deactivated: boolean }> {
    const existing = await this.repo.findSectionById(id);
    if (!existing) throw new Error('Declaration section not found');
    const used = await this.repo.countSectionUsage(id);
    if (used > 0) {
      await this.repo.deactivateSection(id);
      return { deleted: false, deactivated: true };
    }
    await this.repo.deleteSection(id);
    return { deleted: true, deactivated: false };
  }

  // -------------------------------------------------------------------------
  // Declarations
  // -------------------------------------------------------------------------

  /**
   * The employee's declaration for a year. When nothing has been saved yet a
   * DRAFT shell is assembled in memory from the active sections -- no row is
   * inserted, so simply opening the screen never creates a declaration.
   */
  async getDeclaration(employeeId: number, financialYear: string): Promise<DeclarationResponse> {
    const fy = this.normaliseFy(financialYear);
    const row = await this.repo.findDeclaration(employeeId, fy);

    if (!row) {
      const sections = await this.repo.listSections();
      const regime = await this.repo.findDefaultRegime(fy);
      return {
        id: null,
        employeeId,
        financialYear: fy,
        regimeId: regime?.id ?? null,
        regimeCode: regime?.code ?? null,
        status: 'DRAFT',
        submittedAt: null,
        verifiedBy: null,
        verifiedAt: null,
        rejectionReason: null,
        items: sections.map((s) => this.emptyItem(s)),
        totalDeclared: 0,
        totalApproved: 0,
        isDraftShell: true,
      };
    }

    const items = await this.repo.listDeclarationItems(Number(row.id));
    return this.toDeclaration(row, items);
  }

  /**
   * Upserts the declaration and its items.
   *
   * LOCKED declarations are the year-end freeze: once payroll has computed the
   * final TDS on them, changing the inputs would make the numbers unexplainable.
   */
  async saveDeclaration(
    employeeId: number,
    financialYear: string,
    input: SaveDeclarationInput,
    _userId: number,
  ): Promise<DeclarationResponse> {
    const fy = this.normaliseFy(financialYear);
    const existing = await this.repo.findDeclaration(employeeId, fy);
    if (existing && String(existing.status) === 'LOCKED') {
      throw new Error('This declaration is locked and can no longer be edited');
    }

    const items = Array.isArray(input.items) ? input.items : [];
    const sections = await this.repo.listSections(true);
    const byId = new Map(sections.map((s) => [s.id, s]));

    const cleaned: SaveDeclarationInput['items'] = [];
    for (const item of items) {
      const section = byId.get(Number(item.sectionId));
      if (!section) throw new Error(`Unknown declaration section ${item.sectionId}`);
      const declared = Number(item.declaredAmount ?? 0);
      const proof = Number(item.proofAmount ?? 0);
      if (declared < 0 || proof < 0) throw new Error(`Amounts for ${section.code} cannot be negative`);
      cleaned.push({
        sectionId: section.id,
        declaredAmount: round2(declared),
        proofAmount: round2(proof),
        documentId: item.documentId ?? null,
        remarks: item.remarks ?? null,
      });
    }

    let regimeId = input.regimeId ?? existing?.regime_id ?? null;
    if (regimeId) {
      const regime = await this.repo.findRegimeById(Number(regimeId));
      if (!regime) throw new Error('Tax regime not found');
      regimeId = regime.id;
    } else {
      regimeId = (await this.repo.findDefaultRegime(fy))?.id ?? null;
    }

    await this.repo.upsertDeclaration(employeeId, fy, regimeId, cleaned);
    return this.getDeclaration(employeeId, fy);
  }

  async submit(employeeId: number, financialYear: string): Promise<DeclarationResponse> {
    const fy = this.normaliseFy(financialYear);
    const row = await this.repo.findDeclaration(employeeId, fy);
    if (!row) throw new Error('There is nothing to submit: save the declaration first');
    if (String(row.status) === 'LOCKED') throw new Error('This declaration is locked and can no longer be edited');
    if (String(row.status) === 'SUBMITTED') throw new Error('This declaration has already been submitted');

    const items = await this.repo.listDeclarationItems(Number(row.id));
    if (items.length === 0) throw new Error('Declare at least one section before submitting');

    await this.repo.setDeclarationStatus(Number(row.id), 'SUBMITTED');
    return this.getDeclaration(employeeId, fy);
  }

  /** Submit addressed by declaration id, for the admin-side routes. */
  async submitById(declarationId: number): Promise<DeclarationResponse> {
    const row = await this.repo.findDeclarationById(declarationId);
    if (!row) throw new Error('Tax declaration not found');
    return this.submit(Number(row.employee_id), String(row.financial_year));
  }

  /**
   * Payroll verifies the proofs: each item gets an approved amount and a proof
   * status. Only approved amounts feed the tax computation.
   */
  async verify(declarationId: number, userId: number, decisions: VerifyDecision[]): Promise<DeclarationResponse> {
    const row = await this.repo.findDeclarationById(declarationId);
    if (!row) throw new Error('Tax declaration not found');
    if (String(row.status) === 'DRAFT') throw new Error('This declaration has not been submitted yet');

    const items = await this.repo.listDeclarationItems(declarationId);
    const byId = new Map(items.map((i) => [i.id, i]));

    const prepared = (Array.isArray(decisions) ? decisions : []).map((d) => {
      const item = byId.get(Number(d.itemId));
      if (!item) throw new Error(`Item ${d.itemId} does not belong to this declaration`);
      const approved = Number(d.approvedAmount ?? 0);
      if (approved < 0) throw new Error('Approved amount cannot be negative');
      if (item.maxLimit !== null && approved > item.maxLimit) {
        throw new Error(`${item.sectionCode} is capped at ${item.maxLimit}`);
      }
      return {
        itemId: Number(d.itemId),
        approvedAmount: round2(approved),
        proofStatus: (d.proofStatus ?? (approved > 0 ? 'APPROVED' : 'REJECTED')) as ProofStatus,
        remarks: d.remarks ?? null,
      };
    });

    if (prepared.length > 0) await this.repo.setItemDecisions(declarationId, prepared);
    await this.repo.setDeclarationStatus(declarationId, 'VERIFIED', { verifiedBy: userId });

    const refreshed = await this.repo.findDeclarationById(declarationId);
    const refreshedItems = await this.repo.listDeclarationItems(declarationId);
    return this.toDeclaration(refreshed, refreshedItems);
  }

  async reject(declarationId: number, userId: number, reason: string): Promise<DeclarationResponse> {
    if (!reason) throw new Error('A rejection reason is required');
    const row = await this.repo.findDeclarationById(declarationId);
    if (!row) throw new Error('Tax declaration not found');
    await this.repo.setDeclarationStatus(declarationId, 'REJECTED', { verifiedBy: userId, rejectionReason: reason });
    const refreshed = await this.repo.findDeclarationById(declarationId);
    const items = await this.repo.listDeclarationItems(declarationId);
    return this.toDeclaration(refreshed, items);
  }

  async listDeclarations(filters: { financialYear?: string; status?: string; limit?: number } = {}): Promise<DeclarationResponse[]> {
    const rows = await this.repo.listDeclarations(filters);
    const out: DeclarationResponse[] = [];
    for (const row of rows) {
      const items = await this.repo.listDeclarationItems(Number(row.id));
      out.push(this.toDeclaration(row, items));
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Computation
  // -------------------------------------------------------------------------

  async getComputation(employeeId: number, financialYear: string): Promise<TaxComputationResponse | null> {
    return this.repo.findComputation(employeeId, this.normaliseFy(financialYear));
  }

  async recompute(employeeId: number, financialYear: string): Promise<TaxComputationResponse | null> {
    const fy = this.normaliseFy(financialYear);
    await this.computation.computeAnnualTax(employeeId, fy, { persist: true });
    return this.repo.findComputation(employeeId, fy);
  }

  /**
   * Assembles the figures that appear on Form 16 Part B.
   *
   * Deliberately data only: a legally valid Form 16 is generated and digitally
   * signed through the TRACES portal against the employer's TAN. Nothing this
   * system produces can substitute for that, so the payload says so explicitly.
   */
  async getForm16Data(employeeId: number, financialYear: string): Promise<Form16Data> {
    const fy = this.normaliseFy(financialYear);
    const employee = await this.repo.findEmployeeBasics(employeeId);
    if (!employee) throw new Error('Employee not found');

    const { from, to } = fyBounds(fy);
    const [lines, computation, declaration] = await Promise.all([
      this.repo.findYearSalaryLines(employeeId, from, to),
      this.repo.findComputation(employeeId, fy),
      this.getDeclaration(employeeId, fy),
    ]);

    const grossSalary = round2(lines.reduce((s, l) => s + l.grossAmount, 0));
    const bonusAndVariable = round2(lines.reduce((s, l) => s + l.bonus + l.incentive + l.variablePay, 0));
    const arrears = round2(lines.reduce((s, l) => s + l.arrears, 0));
    const professionalTax = round2(lines.reduce((s, l) => s + l.professionalTax, 0));
    const tdsDeducted = round2(lines.reduce((s, l) => s + l.tds, 0));

    const chapterVia = round2(
      declaration.items.reduce((s, i) => s + (i.approvedAmount > 0 ? i.approvedAmount : 0), 0),
    );

    const standardDeduction = computation?.standardDeduction ?? 0;
    const exemptions = computation?.exemptions ?? 0;
    const taxableIncome = computation
      ? computation.taxableIncome
      : Math.max(0, round2(grossSalary - exemptions - standardDeduction - professionalTax - chapterVia));
    const totalTax = computation?.totalTax ?? 0;

    return {
      employee: {
        id: employee.id,
        empCode: employee.empCode,
        fullName: employee.fullName,
        pan: employee.pan,
        designation: employee.designation,
        joinedAt: employee.joinedAt,
      },
      financialYear: fy,
      regime: computation?.regimeCode ?? declaration.regimeCode,
      partB: {
        grossSalary,
        bonusAndVariable,
        arrears,
        exemptions,
        standardDeduction,
        professionalTax,
        chapterViaDeductions: computation?.chapterViaDeductions ?? chapterVia,
        taxableIncome,
        taxPayable: computation?.taxBeforeRebate ?? 0,
        rebate: computation?.rebate ?? 0,
        surcharge: computation?.surcharge ?? 0,
        cess: computation?.cess ?? 0,
        totalTax,
        tdsDeducted,
        balancePayable: round2(Math.max(0, totalTax - tdsDeducted)),
      },
      quarterlyTds: lines.map((l) => ({
        period: l.periodLabel,
        from: l.fromDate,
        to: l.toDate,
        gross: l.grossAmount,
        tds: l.tds,
      })),
      deductionBreakup: declaration.items
        .filter((i) => i.declaredAmount > 0 || i.approvedAmount > 0)
        .map((i) => ({
          code: i.sectionCode,
          name: i.sectionName,
          declared: i.declaredAmount,
          approved: i.approvedAmount,
        })),
      isStatutoryForm: false,
      disclaimer:
        'These are the underlying Part B figures only. A statutory Form 16 must be downloaded and '
        + 'digitally signed through the TRACES portal against the employer TAN; this system cannot issue one.',
    };
  }

  /** Current financial year, for callers that do not want to compute it. */
  currentFinancialYear(): string {
    return financialYearFor(new Date());
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private cleanSlabPatch(input: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) out[key] = value;
    }
    return out;
  }

  /**
   * Slab bands must be ascending, contiguous and non-overlapping, and only the
   * final band may be open-ended. A gap or an overlap silently mis-taxes an
   * entire income bracket, so this is validated on write rather than on use.
   */
  private assertSlabsValid(slabs: TaxSlabResponse[]): void {
    const sorted = [...slabs].sort((a, b) => a.fromAmount - b.fromAmount || a.slabOrder - b.slabOrder);
    const OVERLAP = 'Slab bands overlap or are out of order';

    for (let i = 0; i < sorted.length; i++) {
      const slab = sorted[i] as TaxSlabResponse;
      if (slab.fromAmount < 0) throw new Error(OVERLAP);
      if (slab.toAmount !== null && slab.toAmount <= slab.fromAmount) throw new Error(OVERLAP);
      if (slab.toAmount === null && i !== sorted.length - 1) throw new Error(OVERLAP);
      if (i > 0) {
        const previous = sorted[i - 1] as TaxSlabResponse;
        if (previous.toAmount === null || previous.toAmount !== slab.fromAmount) throw new Error(OVERLAP);
      }
    }
  }

  private normaliseFy(financialYear: string): string {
    const fy = String(financialYear ?? '').trim();
    if (!/^\d{4}-\d{4}$/.test(fy)) throw new Error("Financial year must look like '2026-2027'");
    return fy;
  }

  private emptyItem(section: TaxSectionResponse): DeclarationItemResponse {
    return {
      id: null,
      sectionId: section.id,
      sectionCode: section.code,
      sectionName: section.name,
      maxLimit: section.maxLimit,
      limitGroup: section.limitGroup,
      declaredAmount: 0,
      proofAmount: 0,
      approvedAmount: 0,
      documentId: null,
      proofStatus: 'PENDING',
      remarks: null,
    };
  }

  private toDeclaration(row: any, items: DeclarationItemResponse[]): DeclarationResponse {
    return {
      id: Number(row.id),
      employeeId: Number(row.employee_id),
      employeeName: row.full_name ?? null,
      empCode: row.emp_code ?? null,
      financialYear: String(row.financial_year),
      regimeId: row.regime_id === null || row.regime_id === undefined ? null : Number(row.regime_id),
      regimeCode: row.regime_code ?? null,
      status: String(row.status) as DeclarationStatus,
      submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
      verifiedBy: row.verified_by === null || row.verified_by === undefined ? null : Number(row.verified_by),
      verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
      rejectionReason: row.rejection_reason ?? null,
      items,
      totalDeclared: round2(items.reduce((s, i) => s + i.declaredAmount, 0)),
      totalApproved: round2(items.reduce((s, i) => s + i.approvedAmount, 0)),
      isDraftShell: false,
    };
  }
}
