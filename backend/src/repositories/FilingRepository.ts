import { BaseRepository } from './BaseRepository';
import {
  ChallanFilters,
  FilingFilters,
  FilingItem,
  FilingItemInput,
  Form16Distribution,
  Form16Filters,
  Form16Record,
  RegulatoryFiling,
  StatutoryChallan,
} from '../types/compliance';
import { round2, toDateString, todayString } from '../utils/dateUtils';
import { num } from '../utils/payrollMath';

export interface ChallanInsert {
  challanNo: string;
  scheme: string;
  registrationId: number | null;
  periodId: number | null;
  monthKey: string | null;
  financialYear: string;
  quarter: number | null;
  stateCode: string | null;
  employeeCount: number;
  totalWages: number;
  employeeAmount: number;
  employerAmount: number;
  adminCharges: number;
  interestAmount: number;
  penaltyAmount: number;
  totalAmount: number;
  dueDate: string | null;
  status: string;
  remarks: string | null;
}

export interface FilingInsert {
  filingCode: string;
  filingType: string;
  scheme: string;
  registrationId: number | null;
  frequency: string;
  financialYear: string;
  monthKey: string | null;
  quarter: number | null;
  periodId: number | null;
  stateCode: string | null;
  dueDate: string | null;
  employeeCount: number;
  totalAmount: number;
  status: string;
  fileName: string | null;
  filePath: string | null;
  fileFormat: string | null;
  remarks: string | null;
}

export interface Form16Insert {
  employeeId: number;
  financialYear: string;
  assessmentYear: string | null;
  certificateNo: string | null;
  pan: string | null;
  tan: string | null;
  employerName: string | null;
  regimeCode: string | null;
  grossSalary: number;
  exemptAllowances: number;
  standardDeduction: number;
  professionalTax: number;
  chapterViaDeductions: number;
  taxableIncome: number;
  taxOnIncome: number;
  rebate: number;
  surcharge: number;
  cess: number;
  totalTax: number;
  tdsDeducted: number;
  taxPayable: number;
  refundDue: number;
  revisionNo: number;
  remarks: string | null;
}

/**
 * The payment side (`statutory_challans`) and the return side
 * (`regulatory_filings` + items), plus the Form 16 archive.
 *
 * Nothing here talks to a government portal. `submission_mode` is left at its
 * `PORTAL_MANUAL` default on every filing this repository writes, because that
 * is the truth: a person uploads the generated file.
 */
export class FilingRepository extends BaseRepository {
  async withTransaction<T>(fn: (connection: any) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  // =========================================================================
  // Challans
  // =========================================================================

  /** Any challan for this scheme/month that has not been cancelled. */
  async findLiveChallan(scheme: string, monthKey: string, stateCode?: string | null): Promise<StatutoryChallan | null> {
    let sql = `SELECT * FROM statutory_challans
               WHERE deleted_at IS NULL AND scheme = ? AND month_key = ? AND status <> 'CANCELLED'`;
    const params: any[] = [scheme, monthKey];
    if (stateCode) {
      sql += ' AND state_code = ?';
      params.push(stateCode);
    }
    sql += ' ORDER BY id DESC LIMIT 1';
    const rows = await this.query<any[]>(sql, params);
    return rows[0] ? this.toChallan(rows[0]) : null;
  }

  /** How many challans (cancelled included) already exist for a scheme/month. */
  async countChallansForMonth(scheme: string, monthKey: string): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT COUNT(*) AS n FROM statutory_challans WHERE scheme = ? AND month_key = ?',
      [scheme, monthKey],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async insertChallan(conn: any, data: ChallanInsert, userId: number): Promise<number> {
    const [result] = await conn.query(
      `INSERT INTO statutory_challans
        (challan_no, scheme, registration_id, period_id, month_key, financial_year, quarter, state_code,
         employee_count, total_wages, employee_amount, employer_amount, admin_charges, interest_amount,
         penalty_amount, total_amount, due_date, status, remarks, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.challanNo,
        data.scheme,
        data.registrationId,
        data.periodId,
        data.monthKey,
        data.financialYear,
        data.quarter,
        data.stateCode,
        data.employeeCount,
        data.totalWages,
        data.employeeAmount,
        data.employerAmount,
        data.adminCharges,
        data.interestAmount,
        data.penaltyAmount,
        data.totalAmount,
        data.dueDate,
        data.status,
        data.remarks,
        userId,
        userId,
      ],
    );
    return Number((result as any).insertId);
  }

  async findChallanById(id: number): Promise<StatutoryChallan | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM statutory_challans WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toChallan(rows[0]) : null;
  }

  async findChallans(filters: ChallanFilters): Promise<StatutoryChallan[]> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.scheme) { where.push('scheme = ?'); params.push(filters.scheme); }
    if (filters.status) { where.push('status = ?'); params.push(filters.status); }
    if (filters.monthKey) { where.push('month_key = ?'); params.push(filters.monthKey); }
    if (filters.financialYear) { where.push('financial_year = ?'); params.push(filters.financialYear); }
    if (filters.stateCode) { where.push('state_code = ?'); params.push(filters.stateCode); }
    const limit = Math.min(2000, Math.max(1, Math.floor(Number(filters.limit) || 200)));
    const rows = await this.query<any[]>(
      `SELECT * FROM statutory_challans WHERE ${where.join(' AND ')}
       ORDER BY month_key DESC, scheme ASC, id DESC LIMIT ${limit}`,
      params,
    );
    return rows.map((r) => this.toChallan(r));
  }

  /** Unpaid challans whose due date has passed. */
  async findOverdueChallans(): Promise<StatutoryChallan[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM statutory_challans
       WHERE deleted_at IS NULL AND due_date IS NOT NULL AND due_date < ?
         AND status NOT IN ('PAID', 'ACKNOWLEDGED', 'CANCELLED')
       ORDER BY due_date ASC`,
      [todayString()],
    );
    return rows.map((r) => this.toChallan(r));
  }

  async updateChallan(id: number, data: Record<string, any>, userId: number, conn?: any): Promise<void> {
    const columns: Record<string, string> = {
      status: 'status',
      paidOn: 'paid_on',
      paymentReference: 'payment_reference',
      bankName: 'bank_name',
      acknowledgementNo: 'acknowledgement_no',
      acknowledgedOn: 'acknowledged_on',
      fileName: 'file_name',
      filePath: 'file_path',
      remarks: 'remarks',
      interestAmount: 'interest_amount',
      penaltyAmount: 'penalty_amount',
      totalAmount: 'total_amount',
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      const value = data[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;
    sets.push('updated_by = ?');
    params.push(userId, id);
    const sql = `UPDATE statutory_challans SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`;
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  // =========================================================================
  // Regulatory filings
  // =========================================================================

  /**
   * The existing filing for a (type, FY, month, quarter, state) key.
   *
   * Matches the table's own unique key, so regenerating a return updates the
   * row that is already there instead of colliding with it.
   */
  async findFilingByKey(
    filingType: string,
    financialYear: string,
    monthKey: string | null,
    quarter: number | null,
    stateCode: string | null,
  ): Promise<RegulatoryFiling | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM regulatory_filings
       WHERE deleted_at IS NULL AND filing_type = ? AND financial_year = ?
         AND (month_key <=> ?) AND (quarter <=> ?) AND (state_code <=> ?)
       ORDER BY id DESC LIMIT 1`,
      [filingType, financialYear, monthKey, quarter, stateCode],
    );
    return rows[0] ? this.toFiling(rows[0]) : null;
  }

  async insertFiling(conn: any, data: FilingInsert, userId: number): Promise<number> {
    const [result] = await conn.query(
      `INSERT INTO regulatory_filings
        (filing_code, filing_type, scheme, registration_id, frequency, financial_year, month_key,
         quarter, period_id, state_code, due_date, employee_count, total_amount, status,
         file_name, file_path, file_format, generated_at, submission_mode, remarks, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'PORTAL_MANUAL', ?, ?, ?)`,
      [
        data.filingCode,
        data.filingType,
        data.scheme,
        data.registrationId,
        data.frequency,
        data.financialYear,
        data.monthKey,
        data.quarter,
        data.periodId,
        data.stateCode,
        data.dueDate,
        data.employeeCount,
        data.totalAmount,
        data.status,
        data.fileName,
        data.filePath,
        data.fileFormat,
        data.remarks,
        userId,
        userId,
      ],
    );
    return Number((result as any).insertId);
  }

  /** Rewrite an existing filing header on regeneration. */
  async refreshFiling(conn: any, id: number, data: FilingInsert, userId: number): Promise<void> {
    await conn.query(
      `UPDATE regulatory_filings
       SET filing_code = ?, scheme = ?, registration_id = ?, frequency = ?, period_id = ?,
           due_date = ?, employee_count = ?, total_amount = ?, status = ?,
           file_name = ?, file_path = ?, file_format = ?, generated_at = NOW(),
           submission_mode = 'PORTAL_MANUAL', remarks = ?, updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        data.filingCode,
        data.scheme,
        data.registrationId,
        data.frequency,
        data.periodId,
        data.dueDate,
        data.employeeCount,
        data.totalAmount,
        data.status,
        data.fileName,
        data.filePath,
        data.fileFormat,
        data.remarks,
        userId,
        id,
      ],
    );
  }

  async deleteFilingItems(conn: any, filingId: number): Promise<void> {
    await conn.query('DELETE FROM regulatory_filing_items WHERE filing_id = ?', [filingId]);
  }

  async insertFilingItems(conn: any, filingId: number, items: FilingItemInput[]): Promise<void> {
    for (const item of items) {
      await conn.query(
        `INSERT INTO regulatory_filing_items
          (filing_id, employee_id, identifier, wage_base, employee_amount, employer_amount,
           total_amount, ncp_days, extra_json, validation_status, validation_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          filingId,
          item.employeeId,
          item.identifier,
          item.wageBase,
          item.employeeAmount,
          item.employerAmount,
          item.totalAmount,
          item.ncpDays,
          item.extra ? JSON.stringify(item.extra) : null,
          item.validationStatus,
          item.validationMessage,
        ],
      );
    }
  }

  async findFilingById(id: number): Promise<RegulatoryFiling | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM regulatory_filings WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toFiling(rows[0]) : null;
  }

  async findFilings(filters: FilingFilters): Promise<RegulatoryFiling[]> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.filingType) { where.push('filing_type = ?'); params.push(filters.filingType); }
    if (filters.status) { where.push('status = ?'); params.push(filters.status); }
    if (filters.financialYear) { where.push('financial_year = ?'); params.push(filters.financialYear); }
    if (filters.monthKey) { where.push('month_key = ?'); params.push(filters.monthKey); }
    if (filters.quarter) { where.push('quarter = ?'); params.push(filters.quarter); }
    if (filters.stateCode) { where.push('state_code = ?'); params.push(filters.stateCode); }
    const limit = Math.min(2000, Math.max(1, Math.floor(Number(filters.limit) || 200)));
    const rows = await this.query<any[]>(
      `SELECT * FROM regulatory_filings WHERE ${where.join(' AND ')}
       ORDER BY financial_year DESC, month_key DESC, id DESC LIMIT ${limit}`,
      params,
    );
    return rows.map((r) => this.toFiling(r));
  }

  async findOverdueFilings(): Promise<RegulatoryFiling[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM regulatory_filings
       WHERE deleted_at IS NULL AND due_date IS NOT NULL AND due_date < ?
         AND status NOT IN ('FILED', 'ACKNOWLEDGED')
       ORDER BY due_date ASC`,
      [todayString()],
    );
    return rows.map((r) => this.toFiling(r));
  }

  async findFilingItems(filingId: number, validationStatus?: string): Promise<FilingItem[]> {
    let sql = `SELECT i.*, e.emp_code, e.full_name
               FROM regulatory_filing_items i
               JOIN employees e ON e.id = i.employee_id
               WHERE i.filing_id = ?`;
    const params: any[] = [filingId];
    if (validationStatus) {
      sql += ' AND i.validation_status = ?';
      params.push(validationStatus);
    }
    sql += ' ORDER BY e.emp_code ASC';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toFilingItem(r));
  }

  /** Every item that could not go into the file. */
  async findInvalidFilingItems(filingId: number): Promise<FilingItem[]> {
    const rows = await this.query<any[]>(
      `SELECT i.*, e.emp_code, e.full_name
       FROM regulatory_filing_items i
       JOIN employees e ON e.id = i.employee_id
       WHERE i.filing_id = ? AND i.validation_status <> 'VALID'
       ORDER BY e.emp_code ASC`,
      [filingId],
    );
    return rows.map((r) => this.toFilingItem(r));
  }

  async updateFiling(id: number, data: Record<string, any>, userId: number): Promise<void> {
    const columns: Record<string, string> = {
      status: 'status',
      filedOn: 'filed_on',
      filedBy: 'filed_by',
      acknowledgementNo: 'acknowledgement_no',
      acknowledgedOn: 'acknowledged_on',
      challanId: 'challan_id',
      rejectionReason: 'rejection_reason',
      remarks: 'remarks',
      fileName: 'file_name',
      filePath: 'file_path',
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      const value = data[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;
    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(`UPDATE regulatory_filings SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params);
  }

  // =========================================================================
  // Form 16
  // =========================================================================

  /** Highest revision already issued for an employee-year, or null. */
  async findLatestForm16(employeeId: number, financialYear: string): Promise<Form16Record | null> {
    const rows = await this.query<any[]>(
      `SELECT f.*, e.emp_code, e.full_name
       FROM form16_records f
       JOIN employees e ON e.id = f.employee_id
       WHERE f.deleted_at IS NULL AND f.employee_id = ? AND f.financial_year = ?
       ORDER BY f.revision_no DESC LIMIT 1`,
      [employeeId, financialYear],
    );
    return rows[0] ? this.toForm16(rows[0]) : null;
  }

  async insertForm16(data: Form16Insert, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO form16_records
        (employee_id, financial_year, assessment_year, certificate_no, pan, tan, employer_name,
         regime_code, gross_salary, exempt_allowances, standard_deduction, professional_tax,
         chapter_via_deductions, taxable_income, tax_on_income, rebate, surcharge, cess, total_tax,
         tds_deducted, tax_payable, refund_due, has_part_a, is_statutory_signed, status,
         generated_at, revision_no, remarks, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               false, false, 'GENERATED', NOW(), ?, ?, ?, ?)`,
      [
        data.employeeId,
        data.financialYear,
        data.assessmentYear,
        data.certificateNo,
        data.pan,
        data.tan,
        data.employerName,
        data.regimeCode,
        data.grossSalary,
        data.exemptAllowances,
        data.standardDeduction,
        data.professionalTax,
        data.chapterViaDeductions,
        data.taxableIncome,
        data.taxOnIncome,
        data.rebate,
        data.surcharge,
        data.cess,
        data.totalTax,
        data.tdsDeducted,
        data.taxPayable,
        data.refundDue,
        data.revisionNo,
        data.remarks,
        userId,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async findForm16ById(id: number): Promise<Form16Record | null> {
    const rows = await this.query<any[]>(
      `SELECT f.*, e.emp_code, e.full_name
       FROM form16_records f
       JOIN employees e ON e.id = f.employee_id
       WHERE f.id = ? AND f.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.toForm16(rows[0]) : null;
  }

  async findForm16s(filters: Form16Filters): Promise<Form16Record[]> {
    const where: string[] = ['f.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.financialYear) { where.push('f.financial_year = ?'); params.push(filters.financialYear); }
    if (filters.status) { where.push('f.status = ?'); params.push(filters.status); }
    if (filters.employeeId) { where.push('f.employee_id = ?'); params.push(filters.employeeId); }
    const limit = Math.min(10000, Math.max(1, Math.floor(Number(filters.limit) || 500)));
    const rows = await this.query<any[]>(
      `SELECT f.*, e.emp_code, e.full_name
       FROM form16_records f
       JOIN employees e ON e.id = f.employee_id
       WHERE ${where.join(' AND ')}
       ORDER BY f.financial_year DESC, e.emp_code ASC, f.revision_no DESC
       LIMIT ${limit}`,
      params,
    );
    return rows.map((r) => this.toForm16(r));
  }

  async updateForm16(id: number, data: Record<string, any>, userId: number): Promise<void> {
    const columns: Record<string, string> = {
      status: 'status',
      issuedAt: 'issued_at',
      fileName: 'file_name',
      filePath: 'file_path',
      remarks: 'remarks',
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      const value = data[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;
    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(`UPDATE form16_records SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params);
  }

  async insertDistribution(data: {
    form16Id: number;
    channel: string;
    recipient: string | null;
    status: string;
    errorMessage: string | null;
    actorUserId: number | null;
  }): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO form16_distributions (form16_id, channel, recipient, status, error_message, sent_at, actor_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.form16Id,
        data.channel,
        data.recipient,
        data.status,
        data.errorMessage,
        data.status === 'SENT' ? new Date() : null,
        data.actorUserId,
      ],
    );
    return Number(result.insertId);
  }

  async findDistributions(form16Id: number): Promise<Form16Distribution[]> {
    const rows = await this.query<any[]>(
      'SELECT * FROM form16_distributions WHERE form16_id = ? ORDER BY id DESC',
      [form16Id],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      form16Id: Number(r.form16_id),
      channel: r.channel,
      recipient: r.recipient ?? null,
      status: r.status,
      errorMessage: r.error_message ?? null,
      sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
      actorUserId: r.actor_user_id === null ? null : Number(r.actor_user_id),
    }));
  }

  /** Best available delivery address for an employee. */
  async findEmployeeEmail(employeeId: number): Promise<string | null> {
    const rows = await this.query<any[]>(
      `SELECT e.official_email, e.personal_email, u.email AS login_email
       FROM employees e
       LEFT JOIN users u ON u.employee_id = e.id AND u.deleted_at IS NULL
       WHERE e.id = ? AND e.deleted_at IS NULL
       LIMIT 1`,
      [employeeId],
    );
    const r = rows[0];
    if (!r) return null;
    return r.official_email || r.personal_email || r.login_email || null;
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private toChallan(r: any): StatutoryChallan {
    return {
      id: Number(r.id),
      challanNo: String(r.challan_no),
      scheme: r.scheme,
      registrationId: r.registration_id === null ? null : Number(r.registration_id),
      periodId: r.period_id === null ? null : Number(r.period_id),
      monthKey: r.month_key ?? null,
      financialYear: String(r.financial_year),
      quarter: r.quarter === null ? null : Number(r.quarter),
      stateCode: r.state_code ?? null,
      employeeCount: Number(r.employee_count),
      totalWages: round2(num(r.total_wages)),
      employeeAmount: round2(num(r.employee_amount)),
      employerAmount: round2(num(r.employer_amount)),
      adminCharges: round2(num(r.admin_charges)),
      interestAmount: round2(num(r.interest_amount)),
      penaltyAmount: round2(num(r.penalty_amount)),
      totalAmount: round2(num(r.total_amount)),
      currency: String(r.currency ?? 'INR'),
      dueDate: r.due_date ? toDateString(r.due_date) : null,
      status: r.status,
      paidOn: r.paid_on ? toDateString(r.paid_on) : null,
      paymentReference: r.payment_reference ?? null,
      bankName: r.bank_name ?? null,
      fileName: r.file_name ?? null,
      filePath: r.file_path ?? null,
      acknowledgementNo: r.acknowledgement_no ?? null,
      acknowledgedOn: r.acknowledged_on ? toDateString(r.acknowledged_on) : null,
      remarks: r.remarks ?? null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    };
  }

  private toFiling(r: any): RegulatoryFiling {
    return {
      id: Number(r.id),
      filingCode: String(r.filing_code),
      filingType: r.filing_type,
      scheme: r.scheme,
      registrationId: r.registration_id === null ? null : Number(r.registration_id),
      frequency: r.frequency,
      financialYear: String(r.financial_year),
      monthKey: r.month_key ?? null,
      quarter: r.quarter === null ? null : Number(r.quarter),
      periodId: r.period_id === null ? null : Number(r.period_id),
      stateCode: r.state_code ?? null,
      dueDate: r.due_date ? toDateString(r.due_date) : null,
      employeeCount: Number(r.employee_count),
      totalAmount: round2(num(r.total_amount)),
      status: r.status,
      challanId: r.challan_id === null ? null : Number(r.challan_id),
      fileName: r.file_name ?? null,
      filePath: r.file_path ?? null,
      fileFormat: r.file_format ?? null,
      generatedAt: r.generated_at ? new Date(r.generated_at).toISOString() : null,
      filedOn: r.filed_on ? toDateString(r.filed_on) : null,
      acknowledgementNo: r.acknowledgement_no ?? null,
      acknowledgedOn: r.acknowledged_on ? toDateString(r.acknowledged_on) : null,
      submissionMode: r.submission_mode ?? 'PORTAL_MANUAL',
      rejectionReason: r.rejection_reason ?? null,
      remarks: r.remarks ?? null,
    };
  }

  private toFilingItem(r: any): FilingItem {
    let extra: Record<string, unknown> | null = null;
    if (r.extra_json) {
      try {
        extra = JSON.parse(r.extra_json);
      } catch {
        extra = null;
      }
    }
    return {
      id: Number(r.id),
      filingId: Number(r.filing_id),
      employeeId: Number(r.employee_id),
      employeeCode: r.emp_code ?? null,
      employeeName: r.full_name ?? null,
      identifier: r.identifier ?? null,
      wageBase: round2(num(r.wage_base)),
      employeeAmount: round2(num(r.employee_amount)),
      employerAmount: round2(num(r.employer_amount)),
      totalAmount: round2(num(r.total_amount)),
      ncpDays: num(r.ncp_days),
      extra,
      validationStatus: r.validation_status,
      validationMessage: r.validation_message ?? null,
    };
  }

  private toForm16(r: any): Form16Record {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeCode: r.emp_code ?? null,
      employeeName: r.full_name ?? null,
      financialYear: String(r.financial_year),
      assessmentYear: r.assessment_year ?? null,
      certificateNo: r.certificate_no ?? null,
      pan: r.pan ?? null,
      tan: r.tan ?? null,
      employerName: r.employer_name ?? null,
      regimeCode: r.regime_code ?? null,
      grossSalary: round2(num(r.gross_salary)),
      exemptAllowances: round2(num(r.exempt_allowances)),
      standardDeduction: round2(num(r.standard_deduction)),
      professionalTax: round2(num(r.professional_tax)),
      chapterViaDeductions: round2(num(r.chapter_via_deductions)),
      taxableIncome: round2(num(r.taxable_income)),
      taxOnIncome: round2(num(r.tax_on_income)),
      rebate: round2(num(r.rebate)),
      surcharge: round2(num(r.surcharge)),
      cess: round2(num(r.cess)),
      totalTax: round2(num(r.total_tax)),
      tdsDeducted: round2(num(r.tds_deducted)),
      taxPayable: round2(num(r.tax_payable)),
      refundDue: round2(num(r.refund_due)),
      hasPartA: !!r.has_part_a,
      partADocumentId: r.part_a_document_id === null ? null : Number(r.part_a_document_id),
      isStatutorySigned: !!r.is_statutory_signed,
      status: r.status,
      fileName: r.file_name ?? null,
      filePath: r.file_path ?? null,
      generatedAt: r.generated_at ? new Date(r.generated_at).toISOString() : null,
      issuedAt: r.issued_at ? new Date(r.issued_at).toISOString() : null,
      revisionNo: Number(r.revision_no),
      remarks: r.remarks ?? null,
    };
  }
}
