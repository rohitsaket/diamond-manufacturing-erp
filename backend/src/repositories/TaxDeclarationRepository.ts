import { BaseRepository } from './BaseRepository';
import { toDateString } from '../utils/dateUtils';

/**
 * Income-tax configuration and employee declarations: regimes, slab tables,
 * declarable sections, the declarations themselves and the computed annual
 * projection (read-only here -- the engine owns writing it).
 */

export type DeclarationStatus = 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'LOCKED';
export type ProofStatus = 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface TaxRegimeResponse {
  id: number;
  code: string;
  name: string;
  country: string;
  financialYear: string;
  standardDeduction: number;
  rebateLimit: number | null;
  rebateAmount: number | null;
  cessPct: number;
  allowsExemptions: boolean;
  isDefault: boolean;
  isActive: boolean;
  slabs?: TaxSlabResponse[];
}

export interface TaxSlabResponse {
  id: number;
  regimeId: number;
  fromAmount: number;
  toAmount: number | null;
  ratePct: number;
  surchargePct: number;
  slabOrder: number;
}

export interface TaxSectionResponse {
  id: number;
  code: string;
  name: string;
  maxLimit: number | null;
  limitGroup: string | null;
  country: string;
  isActive: boolean;
}

export interface DeclarationItemResponse {
  id: number | null;
  sectionId: number;
  sectionCode: string;
  sectionName: string;
  maxLimit: number | null;
  limitGroup: string | null;
  declaredAmount: number;
  proofAmount: number;
  approvedAmount: number;
  documentId: number | null;
  proofStatus: ProofStatus;
  remarks: string | null;
}

export interface DeclarationResponse {
  id: number | null;
  employeeId: number;
  employeeName?: string | null;
  empCode?: string | null;
  financialYear: string;
  regimeId: number | null;
  regimeCode: string | null;
  status: DeclarationStatus;
  submittedAt: string | null;
  verifiedBy: number | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  items: DeclarationItemResponse[];
  totalDeclared: number;
  totalApproved: number;
  /** True when nothing has been persisted yet and this is an in-memory shell. */
  isDraftShell: boolean;
}

export interface TaxComputationResponse {
  id: number;
  employeeId: number;
  financialYear: string;
  regimeId: number | null;
  regimeCode: string | null;
  grossAnnual: number;
  exemptions: number;
  standardDeduction: number;
  chapterViaDeductions: number;
  taxableIncome: number;
  taxBeforeRebate: number;
  rebate: number;
  surcharge: number;
  cess: number;
  totalTax: number;
  taxPaidToDate: number;
  remainingTax: number;
  monthlyTds: number;
  monthsRemaining: number;
  computedAt: string | null;
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

const SECTION_COLUMNS: Record<string, string> = {
  code: 'code',
  name: 'name',
  maxLimit: 'max_limit',
  limitGroup: 'limit_group',
  country: 'country',
  isActive: 'is_active',
};

export class TaxDeclarationRepository extends BaseRepository {
  // -------------------------------------------------------------------------
  // Regimes and slabs
  // -------------------------------------------------------------------------

  async listRegimes(financialYear?: string, includeInactive = false): Promise<TaxRegimeResponse[]> {
    const where: string[] = ['1 = 1'];
    const params: any[] = [];
    if (financialYear) { where.push('financial_year = ?'); params.push(financialYear); }
    if (!includeInactive) where.push('is_active = true');

    const rows = await this.query<any[]>(
      `SELECT * FROM tax_regimes WHERE ${where.join(' AND ')}
       ORDER BY financial_year DESC, is_default DESC, code ASC`,
      params,
    );
    return rows.map((r) => this.toRegime(r));
  }

  async findRegimeById(id: number): Promise<TaxRegimeResponse | null> {
    const rows = await this.query<any[]>('SELECT * FROM tax_regimes WHERE id = ?', [id]);
    return rows[0] ? this.toRegime(rows[0]) : null;
  }

  async findDefaultRegime(financialYear: string): Promise<TaxRegimeResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM tax_regimes WHERE financial_year = ? AND is_active = true
       ORDER BY is_default DESC, id ASC LIMIT 1`,
      [financialYear],
    );
    return rows[0] ? this.toRegime(rows[0]) : null;
  }

  async listSlabs(regimeId: number): Promise<TaxSlabResponse[]> {
    const rows = await this.query<any[]>(
      'SELECT * FROM tax_slabs WHERE regime_id = ? ORDER BY slab_order ASC, from_amount ASC',
      [regimeId],
    );
    return rows.map((r) => this.toSlab(r));
  }

  async createSlab(input: {
    regimeId: number;
    fromAmount: number;
    toAmount: number | null;
    ratePct: number;
    surchargePct?: number;
    slabOrder: number;
  }): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO tax_slabs (regime_id, from_amount, to_amount, rate_pct, surcharge_pct, slab_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.regimeId, input.fromAmount, input.toAmount, input.ratePct, input.surchargePct ?? 0, input.slabOrder],
    );
    return Number(result.insertId);
  }

  async updateSlab(id: number, input: {
    fromAmount?: number;
    toAmount?: number | null;
    ratePct?: number;
    surchargePct?: number;
    slabOrder?: number;
  }): Promise<void> {
    const columns: Record<string, string> = {
      fromAmount: 'from_amount',
      toAmount: 'to_amount',
      ratePct: 'rate_pct',
      surchargePct: 'surcharge_pct',
      slabOrder: 'slab_order',
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      const value = (input as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;
    params.push(id);
    await this.query(`UPDATE tax_slabs SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async findSlabById(id: number): Promise<TaxSlabResponse | null> {
    const rows = await this.query<any[]>('SELECT * FROM tax_slabs WHERE id = ?', [id]);
    return rows[0] ? this.toSlab(rows[0]) : null;
  }

  async deleteSlab(id: number): Promise<void> {
    await this.query('DELETE FROM tax_slabs WHERE id = ?', [id]);
  }

  // -------------------------------------------------------------------------
  // Declaration sections
  // -------------------------------------------------------------------------

  async listSections(includeInactive = false): Promise<TaxSectionResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM tax_declaration_sections ${includeInactive ? '' : 'WHERE is_active = true'}
       ORDER BY code ASC`,
    );
    return rows.map((r) => this.toSection(r));
  }

  async findSectionById(id: number): Promise<TaxSectionResponse | null> {
    const rows = await this.query<any[]>('SELECT * FROM tax_declaration_sections WHERE id = ?', [id]);
    return rows[0] ? this.toSection(rows[0]) : null;
  }

  async createSection(input: {
    code: string;
    name: string;
    maxLimit?: number | null;
    limitGroup?: string | null;
    country?: string;
    isActive?: boolean;
  }): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO tax_declaration_sections (code, name, max_limit, limit_group, country, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.code,
        input.name,
        input.maxLimit ?? null,
        input.limitGroup ?? null,
        input.country ?? 'IN',
        input.isActive ?? true,
      ],
    );
    return Number(result.insertId);
  }

  async updateSection(id: number, input: Record<string, unknown>): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(SECTION_COLUMNS)) {
      const value = input[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;
    params.push(id);
    await this.query(`UPDATE tax_declaration_sections SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async countSectionUsage(sectionId: number): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT COUNT(*) AS n FROM tax_declaration_items WHERE section_id = ?',
      [sectionId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Sections in use are retired rather than deleted, so history stays readable. */
  async deactivateSection(id: number): Promise<void> {
    await this.query('UPDATE tax_declaration_sections SET is_active = false WHERE id = ?', [id]);
  }

  async deleteSection(id: number): Promise<void> {
    await this.query('DELETE FROM tax_declaration_sections WHERE id = ?', [id]);
  }

  // -------------------------------------------------------------------------
  // Declarations
  // -------------------------------------------------------------------------

  async findDeclaration(employeeId: number, financialYear: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT d.*, r.code AS regime_code, e.full_name, e.emp_code
       FROM tax_declarations d
       LEFT JOIN tax_regimes r ON r.id = d.regime_id
       LEFT JOIN employees e ON e.id = d.employee_id
       WHERE d.employee_id = ? AND d.financial_year = ?`,
      [employeeId, financialYear],
    );
    return rows[0] ?? null;
  }

  async findDeclarationById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT d.*, r.code AS regime_code, e.full_name, e.emp_code
       FROM tax_declarations d
       LEFT JOIN tax_regimes r ON r.id = d.regime_id
       LEFT JOIN employees e ON e.id = d.employee_id
       WHERE d.id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listDeclarationItems(declarationId: number): Promise<DeclarationItemResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT i.*, s.code AS section_code, s.name AS section_name,
              s.max_limit, s.limit_group
       FROM tax_declaration_items i
       JOIN tax_declaration_sections s ON s.id = i.section_id
       WHERE i.declaration_id = ?
       ORDER BY s.code ASC`,
      [declarationId],
    );
    return rows.map((r) => this.toItem(r));
  }

  /**
   * Creates the declaration header if needed and replaces its items in one
   * transaction, so a half-saved declaration can never be submitted.
   */
  async upsertDeclaration(
    employeeId: number,
    financialYear: string,
    regimeId: number | null,
    items: { sectionId: number; declaredAmount: number; proofAmount?: number; documentId?: number | null; remarks?: string | null }[],
  ): Promise<number> {
    return this.transaction(async (conn: any) => {
      await conn.query(
        `INSERT INTO tax_declarations (employee_id, financial_year, regime_id, status)
         VALUES (?, ?, ?, 'DRAFT')
         ON DUPLICATE KEY UPDATE regime_id = VALUES(regime_id)`,
        [employeeId, financialYear, regimeId],
      );
      const [idRows] = await conn.query(
        'SELECT id FROM tax_declarations WHERE employee_id = ? AND financial_year = ?',
        [employeeId, financialYear],
      );
      const declarationId = Number((idRows as any[])[0]?.id);

      for (const item of items) {
        await conn.query(
          `INSERT INTO tax_declaration_items
             (declaration_id, section_id, declared_amount, proof_amount, document_id, remarks, proof_status)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             declared_amount = VALUES(declared_amount),
             proof_amount    = VALUES(proof_amount),
             document_id     = VALUES(document_id),
             remarks         = VALUES(remarks),
             proof_status    = VALUES(proof_status)`,
          [
            declarationId,
            item.sectionId,
            item.declaredAmount,
            item.proofAmount ?? 0,
            item.documentId ?? null,
            item.remarks ?? null,
            (item.proofAmount ?? 0) > 0 ? 'SUBMITTED' : 'PENDING',
          ],
        );
      }

      // Sections dropped from the payload are removed, so the saved set always
      // mirrors exactly what the employee submitted.
      const keep = items.map((i) => i.sectionId);
      if (keep.length > 0) {
        await conn.query(
          `DELETE FROM tax_declaration_items
           WHERE declaration_id = ? AND section_id NOT IN (${keep.map(() => '?').join(', ')})`,
          [declarationId, ...keep],
        );
      } else {
        await conn.query('DELETE FROM tax_declaration_items WHERE declaration_id = ?', [declarationId]);
      }

      return declarationId;
    });
  }

  async setDeclarationStatus(
    id: number,
    status: DeclarationStatus,
    opts: { verifiedBy?: number | null; rejectionReason?: string | null } = {},
  ): Promise<void> {
    const sets = ['status = ?'];
    const params: any[] = [status];
    if (status === 'SUBMITTED') sets.push('submitted_at = NOW()');
    if (status === 'VERIFIED' || status === 'REJECTED') {
      sets.push('verified_by = ?', 'verified_at = NOW()');
      params.push(opts.verifiedBy ?? null);
    }
    sets.push('rejection_reason = ?');
    params.push(opts.rejectionReason ?? null);
    params.push(id);
    await this.query(`UPDATE tax_declarations SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async setItemDecisions(
    declarationId: number,
    decisions: { itemId: number; approvedAmount: number; proofStatus: ProofStatus; remarks?: string | null }[],
  ): Promise<void> {
    await this.transaction(async (conn: any) => {
      for (const d of decisions) {
        await conn.query(
          `UPDATE tax_declaration_items
           SET approved_amount = ?, proof_status = ?, remarks = COALESCE(?, remarks)
           WHERE id = ? AND declaration_id = ?`,
          [d.approvedAmount, d.proofStatus, d.remarks ?? null, d.itemId, declarationId],
        );
      }
    });
  }

  async listDeclarations(filters: { financialYear?: string; status?: string; limit?: number } = {}): Promise<any[]> {
    const where: string[] = ['1 = 1'];
    const params: any[] = [];
    if (filters.financialYear) { where.push('d.financial_year = ?'); params.push(filters.financialYear); }
    if (filters.status) { where.push('d.status = ?'); params.push(filters.status); }
    const capped = Math.min(500, Math.max(1, Math.trunc(Number(filters.limit) || 200)));

    return this.query<any[]>(
      `SELECT d.*, r.code AS regime_code, e.full_name, e.emp_code
       FROM tax_declarations d
       LEFT JOIN tax_regimes r ON r.id = d.regime_id
       LEFT JOIN employees e ON e.id = d.employee_id
       WHERE ${where.join(' AND ')}
       ORDER BY d.id DESC LIMIT ${capped}`,
      params,
    );
  }

  // -------------------------------------------------------------------------
  // Computations (read-only; TaxComputationService owns the writes)
  // -------------------------------------------------------------------------

  async findComputation(employeeId: number, financialYear: string): Promise<TaxComputationResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT tc.*, r.code AS regime_code
       FROM tax_computations tc
       LEFT JOIN tax_regimes r ON r.id = tc.regime_id
       WHERE tc.employee_id = ? AND tc.financial_year = ?`,
      [employeeId, financialYear],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      financialYear: String(r.financial_year),
      regimeId: r.regime_id === null || r.regime_id === undefined ? null : Number(r.regime_id),
      regimeCode: r.regime_code ?? null,
      grossAnnual: Number(r.gross_annual ?? 0),
      exemptions: Number(r.exemptions ?? 0),
      standardDeduction: Number(r.standard_deduction ?? 0),
      chapterViaDeductions: Number(r.chapter_via_deductions ?? 0),
      taxableIncome: Number(r.taxable_income ?? 0),
      taxBeforeRebate: Number(r.tax_before_rebate ?? 0),
      rebate: Number(r.rebate ?? 0),
      surcharge: Number(r.surcharge ?? 0),
      cess: Number(r.cess ?? 0),
      totalTax: Number(r.total_tax ?? 0),
      taxPaidToDate: Number(r.tax_paid_to_date ?? 0),
      remainingTax: Number(r.remaining_tax ?? 0),
      monthlyTds: Number(r.monthly_tds ?? 0),
      monthsRemaining: Number(r.months_remaining ?? 0),
      computedAt: toIsoOrNull(r.computed_at),
    };
  }

  /** Per-period salary and TDS inside a financial year, for Form 16 Part B. */
  async findYearSalaryLines(employeeId: number, fromDate: string, toDate: string): Promise<any[]> {
    const rows = await this.query<any[]>(
      `SELECT p.id AS period_id, p.label AS period_label, p.from_date, p.to_date,
              sl.gross_amount, sl.total_deductions, sl.net_amount, sl.taxable_income,
              sl.ded_income_tax, sl.ded_pf, sl.ded_pt, sl.ded_esi,
              sl.earn_bonus, sl.earn_incentive, sl.earn_variable, sl.earn_arrears
       FROM salary_lines sl
       JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
       WHERE sl.employee_id = ? AND p.from_date >= ? AND p.to_date <= ?
       ORDER BY p.from_date ASC`,
      [employeeId, fromDate, toDate],
    );
    return rows.map((r) => ({
      periodId: Number(r.period_id),
      periodLabel: String(r.period_label ?? ''),
      fromDate: toDateString(r.from_date),
      toDate: toDateString(r.to_date),
      grossAmount: Number(r.gross_amount ?? 0),
      totalDeductions: Number(r.total_deductions ?? 0),
      netAmount: Number(r.net_amount ?? 0),
      taxableIncome: Number(r.taxable_income ?? 0),
      tds: Number(r.ded_income_tax ?? 0),
      pf: Number(r.ded_pf ?? 0),
      professionalTax: Number(r.ded_pt ?? 0),
      esi: Number(r.ded_esi ?? 0),
      bonus: Number(r.earn_bonus ?? 0),
      incentive: Number(r.earn_incentive ?? 0),
      variablePay: Number(r.earn_variable ?? 0),
      arrears: Number(r.earn_arrears ?? 0),
    }));
  }

  async findEmployeeBasics(employeeId: number): Promise<{
    id: number;
    empCode: string;
    fullName: string;
    pan: string | null;
    designation: string | null;
    department: string | null;
    joinedAt: string | null;
    company: string | null;
  } | null> {
    const rows = await this.query<any[]>(
      `SELECT id, emp_code, full_name, pan, designation, department, joined_at, company
       FROM employees WHERE id = ? AND deleted_at IS NULL`,
      [employeeId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      empCode: String(r.emp_code ?? ''),
      fullName: String(r.full_name ?? ''),
      pan: r.pan ?? null,
      designation: r.designation ?? null,
      department: r.department ?? null,
      joinedAt: r.joined_at ? toDateString(r.joined_at) : null,
      company: r.company ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Mappers
  // -------------------------------------------------------------------------

  private toRegime(r: any): TaxRegimeResponse {
    return {
      id: Number(r.id),
      code: String(r.code),
      name: String(r.name),
      country: String(r.country ?? 'IN'),
      financialYear: String(r.financial_year),
      standardDeduction: Number(r.standard_deduction ?? 0),
      rebateLimit: r.rebate_limit === null || r.rebate_limit === undefined ? null : Number(r.rebate_limit),
      rebateAmount: r.rebate_amount === null || r.rebate_amount === undefined ? null : Number(r.rebate_amount),
      cessPct: Number(r.cess_pct ?? 0),
      allowsExemptions: !!r.allows_exemptions,
      isDefault: !!r.is_default,
      isActive: !!r.is_active,
    };
  }

  private toSlab(r: any): TaxSlabResponse {
    return {
      id: Number(r.id),
      regimeId: Number(r.regime_id),
      fromAmount: Number(r.from_amount ?? 0),
      toAmount: r.to_amount === null || r.to_amount === undefined ? null : Number(r.to_amount),
      ratePct: Number(r.rate_pct ?? 0),
      surchargePct: Number(r.surcharge_pct ?? 0),
      slabOrder: Number(r.slab_order ?? 0),
    };
  }

  private toSection(r: any): TaxSectionResponse {
    return {
      id: Number(r.id),
      code: String(r.code),
      name: String(r.name),
      maxLimit: r.max_limit === null || r.max_limit === undefined ? null : Number(r.max_limit),
      limitGroup: r.limit_group ?? null,
      country: String(r.country ?? 'IN'),
      isActive: !!r.is_active,
    };
  }

  private toItem(r: any): DeclarationItemResponse {
    return {
      id: Number(r.id),
      sectionId: Number(r.section_id),
      sectionCode: String(r.section_code ?? ''),
      sectionName: String(r.section_name ?? ''),
      maxLimit: r.max_limit === null || r.max_limit === undefined ? null : Number(r.max_limit),
      limitGroup: r.limit_group ?? null,
      declaredAmount: Number(r.declared_amount ?? 0),
      proofAmount: Number(r.proof_amount ?? 0),
      approvedAmount: Number(r.approved_amount ?? 0),
      documentId: r.document_id === null || r.document_id === undefined ? null : Number(r.document_id),
      proofStatus: (r.proof_status ?? 'PENDING') as ProofStatus,
      remarks: r.remarks ?? null,
    };
  }
}
