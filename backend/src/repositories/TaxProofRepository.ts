import { BaseRepository } from './BaseRepository';
import { toDateString } from '../utils/dateUtils';
import { num } from '../utils/payrollMath';

export type ProofType =
  | 'INVESTMENT' | 'INSURANCE' | 'HOME_LOAN' | 'RENT_RECEIPT' | 'MEDICAL'
  | 'EDUCATION_LOAN' | 'DONATION' | 'NPS' | 'OTHER';

export type ProofReviewStatus =
  | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED';

export type ItemProofStatus = 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface TaxProofResponse {
  id: number;
  declarationId: number;
  declarationItemId: number | null;
  sectionCode: string | null;
  sectionName: string | null;
  employeeId: number;
  empCode: string | null;
  employeeName: string | null;
  financialYear: string;
  proofType: ProofType;
  title: string;
  claimedAmount: number;
  verifiedAmount: number;
  documentId: number | null;
  documentName: string | null;
  status: ProofReviewStatus;
  reviewedBy: number | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string | null;
}

export interface HraDeclarationRow {
  id: number;
  declarationId: number;
  employeeId: number;
  financialYear: string;
  fromMonth: string;
  toMonth: string;
  monthlyRent: number;
  city: string | null;
  isMetro: boolean;
  landlordName: string | null;
  landlordPan: string | null;
  landlordAddress: string | null;
  panRequired: boolean;
  documentId: number | null;
  proofStatus: ItemProofStatus;
  approvedExemption: number;
  remarks: string | null;
}

export interface HraRowInput {
  fromMonth: string;
  toMonth: string;
  monthlyRent: number;
  city?: string | null;
  isMetro?: boolean;
  landlordName?: string | null;
  landlordPan?: string | null;
  landlordAddress?: string | null;
  documentId?: number | null;
  remarks?: string | null;
}

export interface DeclarationItemRef {
  id: number;
  declarationId: number;
  employeeId: number;
  financialYear: string;
  sectionCode: string;
  sectionName: string;
  declaredAmount: number;
  approvedAmount: number;
  maxLimit: number | null;
}

export interface SalaryBasis {
  basicAndDa: number;
  hraReceived: number;
  months: number;
  source: 'PAYROLL_COMPONENTS' | 'SALARY_PACKAGE' | 'MONTHLY_SALARY' | 'NONE';
}

function boolOf(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

function isoOf(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function limitOf(value: unknown, fallback = 200, max = 2000): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function idList(ids: number[]): string {
  const clean = ids
    .map((id) => Math.floor(Number(id)))
    .filter((id) => Number.isFinite(id) && id > 0);
  return clean.length ? clean.join(',') : '';
}

/**
 * Investment proofs and HRA rent declarations.
 *
 * Proofs are the evidence behind a declared deduction: the declaration says
 * what the employee intends to invest, the proof says what they actually did.
 * Approving a proof writes the verified amount back onto the declaration item,
 * because the tax computation only ever spends approved amounts.
 */
export class TaxProofRepository extends BaseRepository {
  /** Public escape hatch so services can wrap multi-table writes in one txn. */
  async withTransaction<T>(fn: (connection: any) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  // =========================================================================
  // Proofs
  // =========================================================================

  async listProofs(filters: {
    employeeId?: number;
    financialYear?: string;
    status?: string;
    proofType?: string;
    declarationId?: number;
    limit?: number;
  } = {}): Promise<TaxProofResponse[]> {
    let sql = `${this.proofSelect()} WHERE p.deleted_at IS NULL`;
    const params: any[] = [];
    if (filters.employeeId) {
      sql += ' AND p.employee_id = ?';
      params.push(filters.employeeId);
    }
    if (filters.financialYear) {
      sql += ' AND p.financial_year = ?';
      params.push(filters.financialYear);
    }
    if (filters.status) {
      sql += ' AND p.status = ?';
      params.push(filters.status);
    }
    if (filters.proofType) {
      sql += ' AND p.proof_type = ?';
      params.push(filters.proofType);
    }
    if (filters.declarationId) {
      sql += ' AND p.declaration_id = ?';
      params.push(filters.declarationId);
    }
    sql += ` ORDER BY p.created_at DESC, p.id DESC LIMIT ${limitOf(filters.limit, 300)}`;
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toProof(r));
  }

  async findProofById(id: number): Promise<TaxProofResponse | null> {
    const rows = await this.query<any[]>(`${this.proofSelect()} WHERE p.id = ? AND p.deleted_at IS NULL`, [id]);
    return rows[0] ? this.toProof(rows[0]) : null;
  }

  async findProofsByIds(ids: number[]): Promise<TaxProofResponse[]> {
    const list = idList(ids);
    if (!list) return [];
    const rows = await this.query<any[]>(
      `${this.proofSelect()} WHERE p.id IN (${list}) AND p.deleted_at IS NULL`,
      [],
    );
    return rows.map((r) => this.toProof(r));
  }

  async createProof(data: {
    declarationId: number;
    declarationItemId: number | null;
    employeeId: number;
    financialYear: string;
    proofType: ProofType;
    title: string;
    claimedAmount: number;
    documentId: number | null;
  }): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO tax_proofs
        (declaration_item_id, declaration_id, employee_id, financial_year, proof_type, title,
         claimed_amount, verified_amount, document_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'SUBMITTED')`,
      [
        data.declarationItemId,
        data.declarationId,
        data.employeeId,
        data.financialYear,
        data.proofType,
        data.title,
        data.claimedAmount,
        data.documentId,
      ],
    );
    return Number(result.insertId);
  }

  async reviewProof(
    id: number,
    data: { status: ProofReviewStatus; verifiedAmount: number; note: string | null; reviewedBy: number },
  ): Promise<void> {
    await this.query(
      `UPDATE tax_proofs
       SET status = ?, verified_amount = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [data.status, data.verifiedAmount, data.note, data.reviewedBy, id],
    );
  }

  async bulkSetStatus(ids: number[], status: ProofReviewStatus, reviewedBy: number): Promise<number> {
    const list = idList(ids);
    if (!list) return 0;
    // An outright approval takes the claimed amount as verified; a rejection
    // zeroes it. Anything in between has to be reviewed one at a time.
    const verified = status === 'APPROVED' ? 'claimed_amount' : '0';
    const result = await this.query<any>(
      `UPDATE tax_proofs
       SET status = ?, verified_amount = ${verified}, reviewed_by = ?, reviewed_at = NOW()
       WHERE id IN (${list}) AND deleted_at IS NULL`,
      [status, reviewedBy],
    );
    return Number(result.affectedRows ?? 0);
  }

  async getPendingSummary(financialYear?: string): Promise<
    { employeeId: number; empCode: string; employeeName: string; pending: number; claimedAmount: number;
      oldestSubmittedAt: string | null }[]
  > {
    const params: any[] = [];
    let sql = `SELECT e.id AS employee_id, e.emp_code, e.full_name,
                      COUNT(*) AS pending,
                      COALESCE(SUM(p.claimed_amount), 0) AS claimed_amount,
                      MIN(p.created_at) AS oldest
               FROM tax_proofs p
               JOIN employees e ON e.id = p.employee_id AND e.deleted_at IS NULL
               WHERE p.deleted_at IS NULL AND p.status IN ('SUBMITTED', 'UNDER_REVIEW')`;
    if (financialYear) {
      sql += ' AND p.financial_year = ?';
      params.push(financialYear);
    }
    sql += ' GROUP BY e.id, e.emp_code, e.full_name ORDER BY pending DESC, e.emp_code ASC LIMIT 500';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({
      employeeId: Number(r.employee_id),
      empCode: String(r.emp_code),
      employeeName: String(r.full_name),
      pending: Number(r.pending ?? 0),
      claimedAmount: num(r.claimed_amount),
      oldestSubmittedAt: isoOf(r.oldest),
    }));
  }

  // =========================================================================
  // Declarations and their items
  // =========================================================================

  async findDeclarationItem(itemId: number): Promise<DeclarationItemRef | null> {
    const rows = await this.query<any[]>(
      `SELECT i.id, i.declaration_id, i.declared_amount, i.approved_amount,
              d.employee_id, d.financial_year, s.code, s.name, s.max_limit
       FROM tax_declaration_items i
       JOIN tax_declarations d ON d.id = i.declaration_id
       JOIN tax_declaration_sections s ON s.id = i.section_id
       WHERE i.id = ?`,
      [itemId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      declarationId: Number(row.declaration_id),
      employeeId: Number(row.employee_id),
      financialYear: String(row.financial_year),
      sectionCode: String(row.code),
      sectionName: String(row.name),
      declaredAmount: num(row.declared_amount),
      approvedAmount: num(row.approved_amount),
      maxLimit: row.max_limit === null || row.max_limit === undefined ? null : num(row.max_limit),
    };
  }

  async setItemApprovedAmount(itemId: number, approvedAmount: number, proofStatus: ItemProofStatus): Promise<void> {
    await this.query(
      'UPDATE tax_declaration_items SET approved_amount = ?, proof_status = ? WHERE id = ?',
      [approvedAmount, proofStatus, itemId],
    );
  }

  async findDeclaration(employeeId: number, financialYear: string): Promise<{ id: number; status: string } | null> {
    const rows = await this.query<any[]>(
      'SELECT id, status FROM tax_declarations WHERE employee_id = ? AND financial_year = ?',
      [employeeId, financialYear],
    );
    return rows[0] ? { id: Number(rows[0].id), status: String(rows[0].status) } : null;
  }

  /**
   * A proof or an HRA row has to hang off a declaration, so submitting either
   * before the employee has saved one creates the DRAFT shell rather than
   * failing with a message nobody can act on.
   */
  async ensureDeclaration(employeeId: number, financialYear: string): Promise<number> {
    const existing = await this.findDeclaration(employeeId, financialYear);
    if (existing) return existing.id;
    const regime = await this.query<any[]>(
      `SELECT id FROM tax_regimes WHERE financial_year = ? AND is_active = true
       ORDER BY is_default DESC, id ASC LIMIT 1`,
      [financialYear],
    );
    const result = await this.query<any>(
      `INSERT INTO tax_declarations (employee_id, financial_year, regime_id, status)
       VALUES (?, ?, ?, 'DRAFT')`,
      [employeeId, financialYear, regime[0]?.id ?? null],
    );
    return Number(result.insertId);
  }

  // =========================================================================
  // HRA
  // =========================================================================

  async listHra(employeeId: number, financialYear: string): Promise<HraDeclarationRow[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM hra_declarations WHERE employee_id = ? AND financial_year = ?
       ORDER BY from_month ASC, id ASC`,
      [employeeId, financialYear],
    );
    return rows.map((r) => this.toHra(r));
  }

  /**
   * The saved rows are the declaration: a rent history is edited as a whole, so
   * the set is replaced inside one transaction rather than diffed row by row.
   */
  async replaceHra(
    employeeId: number,
    financialYear: string,
    declarationId: number,
    rows: (HraRowInput & { panRequired: boolean })[],
  ): Promise<void> {
    await this.transaction(async (conn) => {
      await conn.query('DELETE FROM hra_declarations WHERE employee_id = ? AND financial_year = ?', [
        employeeId,
        financialYear,
      ]);
      for (const row of rows) {
        await conn.query(
          `INSERT INTO hra_declarations
            (declaration_id, employee_id, financial_year, from_month, to_month, monthly_rent, city,
             is_metro, landlord_name, landlord_pan, landlord_address, pan_required, document_id,
             proof_status, remarks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            declarationId,
            employeeId,
            financialYear,
            row.fromMonth,
            row.toMonth,
            row.monthlyRent,
            row.city ?? null,
            row.isMetro === undefined ? false : !!row.isMetro,
            row.landlordName ?? null,
            row.landlordPan ?? null,
            row.landlordAddress ?? null,
            row.panRequired,
            row.documentId ?? null,
            row.documentId ? 'SUBMITTED' : 'PENDING',
            row.remarks ?? null,
          ],
        );
      }
    });
  }

  async setHraApprovedExemption(employeeId: number, financialYear: string, amount: number): Promise<void> {
    await this.query(
      'UPDATE hra_declarations SET approved_exemption = ? WHERE employee_id = ? AND financial_year = ?',
      [amount, employeeId, financialYear],
    );
  }

  /**
   * Basic + DA and HRA actually paid inside the year, from the payslip
   * component breakdown. Falls back to the assigned salary package and then to
   * the flat monthly salary; the caller is told which was used, because an HRA
   * exemption computed off a proxy is not the same claim as one computed off
   * real payslips.
   */
  async getSalaryBasis(employeeId: number, fyFrom: string, fyTo: string): Promise<SalaryBasis> {
    const payrollRows = await this.query<any[]>(
      `SELECT COALESCE(SUM(CASE WHEN c.component_code IN ('BASIC', 'DA') THEN c.amount ELSE 0 END), 0) AS basic_da,
              COALESCE(SUM(CASE WHEN c.component_code = 'HRA' THEN c.amount ELSE 0 END), 0) AS hra,
              COUNT(DISTINCT sl.period_id) AS months
       FROM salary_lines sl
       JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
       LEFT JOIN salary_line_components c ON c.salary_line_id = sl.id
       WHERE sl.employee_id = ? AND p.from_date >= ? AND p.to_date <= ?`,
      [employeeId, fyFrom, fyTo],
    );
    const basicDa = num(payrollRows[0]?.basic_da);
    const hra = num(payrollRows[0]?.hra);
    const months = Number(payrollRows[0]?.months ?? 0);
    if (basicDa > 0 || hra > 0) {
      return { basicAndDa: basicDa, hraReceived: hra, months: months || 12, source: 'PAYROLL_COMPONENTS' };
    }

    const packageRows = await this.query<any[]>(
      `SELECT COALESCE(SUM(CASE WHEN pc.code IN ('BASIC', 'DA') THEN esc.amount ELSE 0 END), 0) AS basic_da,
              COALESCE(SUM(CASE WHEN pc.code = 'HRA' THEN esc.amount ELSE 0 END), 0) AS hra
       FROM employee_salary es
       JOIN employee_salary_components esc ON esc.employee_salary_id = es.id
       JOIN pay_components pc ON pc.id = esc.component_id
       WHERE es.employee_id = ? AND es.deleted_at IS NULL AND es.status = 'ACTIVE'
         AND es.effective_from <= ? AND (es.effective_to IS NULL OR es.effective_to >= ?)`,
      [employeeId, fyTo, fyFrom],
    );
    const pkgBasic = num(packageRows[0]?.basic_da);
    const pkgHra = num(packageRows[0]?.hra);
    if (pkgBasic > 0 || pkgHra > 0) {
      return { basicAndDa: pkgBasic * 12, hraReceived: pkgHra * 12, months: 12, source: 'SALARY_PACKAGE' };
    }

    const flatRows = await this.query<any[]>(
      'SELECT COALESCE(monthly_salary, 0) AS monthly_salary FROM employees WHERE id = ? AND deleted_at IS NULL',
      [employeeId],
    );
    const monthly = num(flatRows[0]?.monthly_salary);
    if (monthly > 0) {
      return { basicAndDa: monthly * 12, hraReceived: 0, months: 12, source: 'MONTHLY_SALARY' };
    }
    return { basicAndDa: 0, hraReceived: 0, months: 0, source: 'NONE' };
  }

  /**
   * What the employee is expected to gross each month, for a forward-looking
   * projection. Prefers what payroll has actually paid this year; falls back to
   * the assigned package and then the flat monthly figure. The caller is told
   * which, because a take-home projection built on a package is a quote, not a
   * measurement.
   */
  async getMonthlyGrossEstimate(
    employeeId: number,
    fyFrom: string,
    fyTo: string,
  ): Promise<{ monthlyGross: number; monthsPaid: number; source: 'PAYROLL' | 'SALARY_PACKAGE' | 'MONTHLY_SALARY' | 'NONE' }> {
    const paidRows = await this.query<any[]>(
      `SELECT COALESCE(SUM(sl.gross_amount), 0) AS gross, COUNT(*) AS months
       FROM salary_lines sl
       JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
       WHERE sl.employee_id = ? AND p.from_date >= ? AND p.to_date <= ? AND sl.gross_amount > 0`,
      [employeeId, fyFrom, fyTo],
    );
    const gross = num(paidRows[0]?.gross);
    const monthsPaid = Number(paidRows[0]?.months ?? 0);
    if (gross > 0 && monthsPaid > 0) {
      return { monthlyGross: gross / monthsPaid, monthsPaid, source: 'PAYROLL' };
    }

    const packageRows = await this.query<any[]>(
      `SELECT COALESCE(monthly_gross, 0) AS monthly_gross
       FROM employee_salary
       WHERE employee_id = ? AND deleted_at IS NULL AND status = 'ACTIVE'
         AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY effective_from DESC LIMIT 1`,
      [employeeId, fyTo, fyFrom],
    );
    const packaged = num(packageRows[0]?.monthly_gross);
    if (packaged > 0) return { monthlyGross: packaged, monthsPaid, source: 'SALARY_PACKAGE' };

    const flatRows = await this.query<any[]>(
      'SELECT COALESCE(monthly_salary, 0) AS monthly_salary FROM employees WHERE id = ? AND deleted_at IS NULL',
      [employeeId],
    );
    const flat = num(flatRows[0]?.monthly_salary);
    if (flat > 0) return { monthlyGross: flat, monthsPaid, source: 'MONTHLY_SALARY' };

    return { monthlyGross: 0, monthsPaid, source: 'NONE' };
  }

  /** The most recent processed payslip inside the year, for its deduction pattern. */
  async getLatestSalaryLine(
    employeeId: number,
    fyFrom: string,
    fyTo: string,
  ): Promise<{ periodLabel: string; gross: number; pf: number; esi: number; pt: number; lwf: number; tds: number; net: number } | null> {
    const rows = await this.query<any[]>(
      `SELECT p.label, sl.gross_amount, sl.ded_pf, sl.ded_esi, sl.ded_pt, sl.ded_lwf,
              sl.ded_income_tax, sl.net_amount
       FROM salary_lines sl
       JOIN salary_periods p ON p.id = sl.period_id AND p.deleted_at IS NULL
       WHERE sl.employee_id = ? AND p.from_date >= ? AND p.to_date <= ?
       ORDER BY p.to_date DESC LIMIT 1`,
      [employeeId, fyFrom, fyTo],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      periodLabel: String(row.label),
      gross: num(row.gross_amount),
      pf: num(row.ded_pf),
      esi: num(row.ded_esi),
      pt: num(row.ded_pt),
      lwf: num(row.ded_lwf),
      tds: num(row.ded_income_tax),
      net: num(row.net_amount),
    };
  }

  async findEmployeeBasics(employeeId: number): Promise<
    { id: number; empCode: string; fullName: string; city: string | null; state: string | null } | null
  > {
    const rows = await this.query<any[]>(
      'SELECT id, emp_code, full_name, city, state FROM employees WHERE id = ? AND deleted_at IS NULL',
      [employeeId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      empCode: String(row.emp_code),
      fullName: String(row.full_name),
      city: row.city ?? null,
      state: row.state ?? null,
    };
  }

  async documentExists(documentId: number): Promise<boolean> {
    const rows = await this.query<any[]>(
      'SELECT id FROM employee_documents WHERE id = ? AND deleted_at IS NULL',
      [documentId],
    );
    return rows.length > 0;
  }

  // =========================================================================
  // Mappers
  // =========================================================================

  private proofSelect(): string {
    return `SELECT p.*, e.emp_code, e.full_name, s.code AS section_code, s.name AS section_name,
                   d.file_name AS document_name, u.name AS reviewer_name
            FROM tax_proofs p
            JOIN employees e ON e.id = p.employee_id
            LEFT JOIN tax_declaration_items i ON i.id = p.declaration_item_id
            LEFT JOIN tax_declaration_sections s ON s.id = i.section_id
            LEFT JOIN employee_documents d ON d.id = p.document_id
            LEFT JOIN users u ON u.id = p.reviewed_by`;
  }

  private toProof(row: any): TaxProofResponse {
    return {
      id: Number(row.id),
      declarationId: Number(row.declaration_id),
      declarationItemId: row.declaration_item_id === null || row.declaration_item_id === undefined
        ? null
        : Number(row.declaration_item_id),
      sectionCode: row.section_code ?? null,
      sectionName: row.section_name ?? null,
      employeeId: Number(row.employee_id),
      empCode: row.emp_code ?? null,
      employeeName: row.full_name ?? null,
      financialYear: String(row.financial_year),
      proofType: String(row.proof_type) as ProofType,
      title: String(row.title),
      claimedAmount: num(row.claimed_amount),
      verifiedAmount: num(row.verified_amount),
      documentId: row.document_id === null || row.document_id === undefined ? null : Number(row.document_id),
      documentName: row.document_name ?? null,
      status: String(row.status) as ProofReviewStatus,
      reviewedBy: row.reviewed_by === null || row.reviewed_by === undefined ? null : Number(row.reviewed_by),
      reviewerName: row.reviewer_name ?? null,
      reviewedAt: isoOf(row.reviewed_at),
      reviewNote: row.review_note ?? null,
      createdAt: isoOf(row.created_at),
    };
  }

  private toHra(row: any): HraDeclarationRow {
    return {
      id: Number(row.id),
      declarationId: Number(row.declaration_id),
      employeeId: Number(row.employee_id),
      financialYear: String(row.financial_year),
      fromMonth: String(row.from_month),
      toMonth: String(row.to_month),
      monthlyRent: num(row.monthly_rent),
      city: row.city ?? null,
      isMetro: boolOf(row.is_metro),
      landlordName: row.landlord_name ?? null,
      landlordPan: row.landlord_pan ?? null,
      landlordAddress: row.landlord_address ?? null,
      panRequired: boolOf(row.pan_required),
      documentId: row.document_id === null || row.document_id === undefined ? null : Number(row.document_id),
      proofStatus: String(row.proof_status) as ItemProofStatus,
      approvedExemption: num(row.approved_exemption),
      remarks: row.remarks ?? null,
    };
  }
}

/** `2026-2027` -> the 1 April / 31 March window it covers. */
export function fyBounds(financialYear: string): { from: string; to: string } {
  const start = Number(String(financialYear).slice(0, 4));
  if (!Number.isFinite(start)) throw new Error("Financial year must look like '2026-2027'");
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/** Today as `YYYY-MM-DD`, kept here so the services share one clock. */
export function today(): string {
  return toDateString(new Date());
}
