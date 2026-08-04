import { BaseRepository } from './BaseRepository';
import { toDateString } from '../utils/dateUtils';

/**
 * Company bank accounts, currencies and exchange rates, plus the payment
 * batches (bank files) that actually move salary out of the door.
 */

export type BankFileFormat = 'NEFT' | 'RTGS' | 'IMPS' | 'ACH' | 'GENERIC_CSV';
export type PaymentMode = 'NEFT' | 'RTGS' | 'IMPS' | 'CASH' | 'CHEQUE' | 'ACH';
export type BatchStatus =
  | 'DRAFT' | 'GENERATED' | 'SENT' | 'PROCESSING'
  | 'COMPLETED' | 'PARTIALLY_FAILED' | 'FAILED' | 'CANCELLED';
export type BatchItemStatus = 'PENDING' | 'SENT' | 'SUCCESS' | 'FAILED' | 'RETURNED';
export type ValidationStatus =
  | 'VALID' | 'MISSING_ACCOUNT' | 'MISSING_IFSC' | 'INVALID_IFSC' | 'ZERO_AMOUNT';

export interface BankAccountResponse {
  id: number;
  label: string;
  bankName: string;
  accountNumber: string;
  ifsc: string | null;
  branch: string | null;
  currency: string;
  company: string | null;
  fileFormat: BankFileFormat;
  corporateId: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface BankAccountInput {
  label: string;
  bankName: string;
  accountNumber: string;
  ifsc?: string | null;
  branch?: string | null;
  currency?: string;
  company?: string | null;
  fileFormat?: BankFileFormat;
  corporateId?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface CurrencyResponse {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
  isBase: boolean;
  isActive: boolean;
}

export interface ExchangeRateResponse {
  id: number;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  effectiveDate: string;
  source: string | null;
}

export interface PayableLineRow {
  salaryLineId: number;
  employeeId: number;
  empCode: string;
  beneficiaryName: string;
  accountNumber: string | null;
  ifsc: string | null;
  amount: number;
  currency: string;
}

export interface BatchItemResponse {
  id: number;
  batchId: number;
  salaryLineId: number | null;
  employeeId: number;
  empCode: string | null;
  beneficiaryName: string;
  accountNumber: string | null;
  ifsc: string | null;
  amount: number;
  currency: string;
  status: BatchItemStatus;
  utrReference: string | null;
  failureReason: string | null;
  validationStatus: ValidationStatus;
}

export interface BatchResponse {
  id: number;
  batchNo: string;
  periodId: number | null;
  periodLabel: string | null;
  runId: number | null;
  bankAccountId: number | null;
  bankAccountLabel: string | null;
  currency: string;
  paymentMode: PaymentMode;
  valueDate: string | null;
  totalRecords: number;
  totalAmount: number;
  successCount: number;
  failedCount: number;
  status: BatchStatus;
  fileName: string | null;
  generatedAt: string | null;
  createdBy: number | null;
  createdAt: string | null;
  items?: BatchItemResponse[];
}

export interface NewBatchItem {
  salaryLineId: number | null;
  employeeId: number;
  beneficiaryName: string;
  accountNumber: string | null;
  ifsc: string | null;
  amount: number;
  currency: string;
  validationStatus: ValidationStatus;
}

export interface NewBatchHeader {
  periodId: number | null;
  runId: number | null;
  bankAccountId: number | null;
  currency: string;
  paymentMode: PaymentMode;
  valueDate: string | null;
  createdBy: number | null;
}

const ACCOUNT_COLUMNS: Record<string, string> = {
  label: 'label',
  bankName: 'bank_name',
  accountNumber: 'account_number',
  ifsc: 'ifsc',
  branch: 'branch',
  currency: 'currency',
  company: 'company',
  fileFormat: 'file_format',
  corporateId: 'corporate_id',
  isDefault: 'is_default',
  isActive: 'is_active',
};

/** mysql2 cannot bind LIMIT, so it is sanitised and inlined. */
function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export class BankPaymentRepository extends BaseRepository {
  // -------------------------------------------------------------------------
  // Company bank accounts
  // -------------------------------------------------------------------------

  async listAccounts(includeInactive = false): Promise<BankAccountResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM company_bank_accounts
       WHERE deleted_at IS NULL ${includeInactive ? '' : 'AND is_active = true'}
       ORDER BY is_default DESC, label ASC`,
    );
    return rows.map((r) => this.toAccount(r));
  }

  async findAccountById(id: number): Promise<BankAccountResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM company_bank_accounts WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toAccount(rows[0]) : null;
  }

  async findDefaultAccount(): Promise<BankAccountResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM company_bank_accounts
       WHERE deleted_at IS NULL AND is_active = true
       ORDER BY is_default DESC, id ASC LIMIT 1`,
    );
    return rows[0] ? this.toAccount(rows[0]) : null;
  }

  async createAccount(input: BankAccountInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO company_bank_accounts
         (label, bank_name, account_number, ifsc, branch, currency, company,
          file_format, corporate_id, is_default, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.label,
        input.bankName,
        input.accountNumber,
        input.ifsc ?? null,
        input.branch ?? null,
        input.currency ?? 'INR',
        input.company ?? null,
        input.fileFormat ?? 'NEFT',
        input.corporateId ?? null,
        input.isDefault ?? false,
        input.isActive ?? true,
        userId,
      ],
    );
    const id = Number(result.insertId);
    if (input.isDefault) await this.clearOtherDefaults(id);
    return id;
  }

  async updateAccount(id: number, input: Partial<BankAccountInput>): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(ACCOUNT_COLUMNS)) {
      const value = (input as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;
    params.push(id);
    await this.query(
      `UPDATE company_bank_accounts SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
    if (input.isDefault) await this.clearOtherDefaults(id);
  }

  async softDeleteAccount(id: number): Promise<void> {
    await this.query(
      'UPDATE company_bank_accounts SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
  }

  async countBatchesForAccount(accountId: number): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT COUNT(*) AS n FROM payment_batches WHERE bank_account_id = ?',
      [accountId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  private async clearOtherDefaults(keepId: number): Promise<void> {
    await this.query(
      'UPDATE company_bank_accounts SET is_default = false WHERE id <> ? AND deleted_at IS NULL',
      [keepId],
    );
  }

  // -------------------------------------------------------------------------
  // Currencies and exchange rates
  // -------------------------------------------------------------------------

  async listCurrencies(includeInactive = false): Promise<CurrencyResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM currencies ${includeInactive ? '' : 'WHERE is_active = true'}
       ORDER BY is_base DESC, code ASC`,
    );
    return rows.map((r) => ({
      code: String(r.code),
      name: String(r.name),
      symbol: String(r.symbol),
      decimalPlaces: Number(r.decimal_places ?? 2),
      isBase: !!r.is_base,
      isActive: !!r.is_active,
    }));
  }

  async listRates(filters: { from?: string; to?: string; limit?: number } = {}): Promise<ExchangeRateResponse[]> {
    const where: string[] = ['1 = 1'];
    const params: any[] = [];
    if (filters.from) { where.push('from_currency = ?'); params.push(filters.from.toUpperCase()); }
    if (filters.to) { where.push('to_currency = ?'); params.push(filters.to.toUpperCase()); }
    const capped = safeInt(filters.limit, 200, 1, 2000);

    const rows = await this.query<any[]>(
      `SELECT * FROM exchange_rates WHERE ${where.join(' AND ')}
       ORDER BY effective_date DESC, id DESC LIMIT ${capped}`,
      params,
    );
    return rows.map((r) => this.toRate(r));
  }

  async upsertRate(
    fromCurrency: string,
    toCurrency: string,
    rate: number,
    effectiveDate: string,
    source: string | null,
    userId: number,
  ): Promise<void> {
    await this.query(
      `INSERT INTO exchange_rates (from_currency, to_currency, rate, effective_date, source, created_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rate = VALUES(rate), source = VALUES(source)`,
      [fromCurrency.toUpperCase(), toCurrency.toUpperCase(), rate, effectiveDate, source, userId],
    );
  }

  /** Latest rate effective on or before `onDate`; null when the pair is unknown. */
  async findRateOn(fromCurrency: string, toCurrency: string, onDate: string): Promise<ExchangeRateResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM exchange_rates
       WHERE from_currency = ? AND to_currency = ? AND effective_date <= ?
       ORDER BY effective_date DESC, id DESC LIMIT 1`,
      [fromCurrency.toUpperCase(), toCurrency.toUpperCase(), onDate],
    );
    return rows[0] ? this.toRate(rows[0]) : null;
  }

  // -------------------------------------------------------------------------
  // Payable lines
  // -------------------------------------------------------------------------

  /**
   * Salary lines for a period that have not been paid and are not already
   * sitting in a live batch, joined to the employee's beneficiary details.
   *
   * Lines already queued in a DRAFT/GENERATED/SENT batch are excluded so a
   * second click never double-pays anyone.
   */
  async findPayableLines(periodId: number, runId?: number | null): Promise<PayableLineRow[]> {
    const where: string[] = [
      'sl.period_id = ?',
      "sl.payment_status IN ('UNPAID', 'FAILED')",
      'sl.net_amount > 0',
      'e.deleted_at IS NULL',
    ];
    const params: any[] = [periodId];
    if (runId) { where.push('sl.run_id = ?'); params.push(runId); }

    const rows = await this.query<any[]>(
      `SELECT sl.id AS salary_line_id, sl.net_amount, sl.currency,
              e.id AS employee_id, e.emp_code, e.full_name,
              e.bank_account, e.bank_ifsc
       FROM salary_lines sl
       JOIN employees e ON e.id = sl.employee_id
       WHERE ${where.join(' AND ')}
         AND NOT EXISTS (
           SELECT 1 FROM payment_batch_items bi
           JOIN payment_batches b ON b.id = bi.batch_id
           WHERE bi.salary_line_id = sl.id
             AND bi.validation_status = 'VALID'
             AND bi.status <> 'FAILED'
             AND b.status NOT IN ('CANCELLED', 'FAILED')
         )
       ORDER BY e.emp_code ASC`,
      params,
    );

    return rows.map((r) => ({
      salaryLineId: Number(r.salary_line_id),
      employeeId: Number(r.employee_id),
      empCode: String(r.emp_code ?? ''),
      beneficiaryName: String(r.full_name ?? ''),
      accountNumber: r.bank_account ? String(r.bank_account).trim() : null,
      ifsc: r.bank_ifsc ? String(r.bank_ifsc).trim() : null,
      amount: Number(r.net_amount ?? 0),
      currency: String(r.currency ?? 'INR'),
    }));
  }

  // -------------------------------------------------------------------------
  // Batches
  // -------------------------------------------------------------------------

  /**
   * Creates the batch header and all of its items in one transaction, so a
   * crash mid-write can never leave a batch that claims to pay people it has no
   * rows for. The batch number is allocated inside the same transaction.
   */
  async createBatchWithItems(
    header: NewBatchHeader,
    items: NewBatchItem[],
  ): Promise<{ batchId: number; batchNo: string }> {
    return this.transaction(async (conn: any) => {
      const stamp = toDateString(new Date()).replace(/-/g, '');
      const prefix = `PAY-${stamp}-`;
      const [seqRows] = await conn.query(
        `SELECT batch_no FROM payment_batches
         WHERE batch_no LIKE ? ORDER BY batch_no DESC LIMIT 1 FOR UPDATE`,
        [`${prefix}%`],
      );
      const last = (seqRows as any[])[0]?.batch_no as string | undefined;
      const nextSeq = last ? Number(last.slice(prefix.length)) + 1 : 1;
      const batchNo = `${prefix}${String(Number.isFinite(nextSeq) ? nextSeq : 1).padStart(3, '0')}`;

      const valid = items.filter((i) => i.validationStatus === 'VALID');
      const totalAmount = valid.reduce((sum, i) => sum + i.amount, 0);

      const [result] = await conn.query(
        `INSERT INTO payment_batches
           (batch_no, period_id, run_id, bank_account_id, currency, payment_mode, value_date,
            total_records, total_amount, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
        [
          batchNo,
          header.periodId,
          header.runId,
          header.bankAccountId,
          header.currency,
          header.paymentMode,
          header.valueDate,
          valid.length,
          Math.round(totalAmount * 100) / 100,
          header.createdBy,
        ],
      );
      const batchId = Number((result as any).insertId);

      if (items.length > 0) {
        const placeholders = items.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const params: any[] = [];
        for (const item of items) {
          params.push(
            batchId,
            item.salaryLineId,
            item.employeeId,
            item.beneficiaryName,
            item.accountNumber,
            item.ifsc,
            item.amount,
            item.currency,
            item.validationStatus,
          );
        }
        await conn.query(
          `INSERT INTO payment_batch_items
             (batch_id, salary_line_id, employee_id, beneficiary_name,
              account_number, ifsc, amount, currency, validation_status)
           VALUES ${placeholders}`,
          params,
        );

        const validLineIds = valid.map((i) => i.salaryLineId).filter((id): id is number => id !== null);
        if (validLineIds.length > 0) {
          await conn.query(
            `UPDATE salary_lines SET payment_status = 'QUEUED'
             WHERE id IN (${validLineIds.map(() => '?').join(', ')})`,
            validLineIds,
          );
        }
      }

      return { batchId, batchNo };
    });
  }

  async listBatches(filters: { periodId?: number; status?: string; limit?: number } = {}): Promise<BatchResponse[]> {
    const where: string[] = ['1 = 1'];
    const params: any[] = [];
    if (filters.periodId) { where.push('b.period_id = ?'); params.push(filters.periodId); }
    if (filters.status) { where.push('b.status = ?'); params.push(filters.status); }
    const capped = safeInt(filters.limit, 100, 1, 500);

    const rows = await this.query<any[]>(
      `SELECT b.*, p.label AS period_label, a.label AS bank_account_label
       FROM payment_batches b
       LEFT JOIN salary_periods p ON p.id = b.period_id
       LEFT JOIN company_bank_accounts a ON a.id = b.bank_account_id
       WHERE ${where.join(' AND ')}
       ORDER BY b.id DESC LIMIT ${capped}`,
      params,
    );
    return rows.map((r) => this.toBatch(r));
  }

  async findBatchById(id: number): Promise<BatchResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT b.*, p.label AS period_label, a.label AS bank_account_label
       FROM payment_batches b
       LEFT JOIN salary_periods p ON p.id = b.period_id
       LEFT JOIN company_bank_accounts a ON a.id = b.bank_account_id
       WHERE b.id = ?`,
      [id],
    );
    return rows[0] ? this.toBatch(rows[0]) : null;
  }

  async listBatchItems(batchId: number, onlyValid = false): Promise<BatchItemResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT bi.*, e.emp_code
       FROM payment_batch_items bi
       LEFT JOIN employees e ON e.id = bi.employee_id
       WHERE bi.batch_id = ? ${onlyValid ? "AND bi.validation_status = 'VALID'" : ''}
       ORDER BY e.emp_code ASC, bi.id ASC`,
      [batchId],
    );
    return rows.map((r) => this.toItem(r));
  }

  async markBatchGenerated(batchId: number, fileName: string): Promise<void> {
    await this.query(
      `UPDATE payment_batches SET status = 'GENERATED', file_name = ?, generated_at = NOW()
       WHERE id = ?`,
      [fileName, batchId],
    );
  }

  async markBatchSent(batchId: number): Promise<void> {
    await this.transaction(async (conn: any) => {
      await conn.query("UPDATE payment_batches SET status = 'SENT' WHERE id = ?", [batchId]);
      await conn.query(
        `UPDATE payment_batch_items SET status = 'SENT'
         WHERE batch_id = ? AND validation_status = 'VALID' AND status = 'PENDING'`,
        [batchId],
      );
    });
  }

  async updateBatchStatus(batchId: number, status: BatchStatus): Promise<void> {
    await this.query('UPDATE payment_batches SET status = ? WHERE id = ?', [status, batchId]);
  }

  /**
   * Applies bank results to items, recomputes the batch counters and writes the
   * outcome back onto the salary lines, all in one transaction so the batch and
   * the payroll ledger can never disagree.
   */
  async applyPaymentResults(
    batchId: number,
    results: { itemId: number; status: BatchItemStatus; utrReference?: string | null; failureReason?: string | null }[],
  ): Promise<{ successCount: number; failedCount: number; status: BatchStatus }> {
    return this.transaction(async (conn: any) => {
      for (const r of results) {
        await conn.query(
          `UPDATE payment_batch_items
           SET status = ?, utr_reference = ?, failure_reason = ?
           WHERE id = ? AND batch_id = ?`,
          [r.status, r.utrReference ?? null, r.failureReason ?? null, r.itemId, batchId],
        );
      }

      const [countRows] = await conn.query(
        `SELECT
           COALESCE(SUM(status = 'SUCCESS'), 0) AS success_count,
           COALESCE(SUM(status IN ('FAILED', 'RETURNED')), 0) AS failed_count,
           COALESCE(SUM(status NOT IN ('SUCCESS', 'FAILED', 'RETURNED')), 0) AS open_count
         FROM payment_batch_items
         WHERE batch_id = ? AND validation_status = 'VALID'`,
        [batchId],
      );
      const counts = (countRows as any[])[0] ?? {};
      const successCount = Number(counts.success_count ?? 0);
      const failedCount = Number(counts.failed_count ?? 0);
      const openCount = Number(counts.open_count ?? 0);

      let status: BatchStatus;
      if (openCount > 0) status = 'PROCESSING';
      else if (failedCount === 0 && successCount > 0) status = 'COMPLETED';
      else if (successCount === 0 && failedCount > 0) status = 'FAILED';
      else if (failedCount > 0) status = 'PARTIALLY_FAILED';
      else status = 'COMPLETED';

      await conn.query(
        'UPDATE payment_batches SET success_count = ?, failed_count = ?, status = ? WHERE id = ?',
        [successCount, failedCount, status, batchId],
      );

      // Push the outcome back onto the payroll ledger.
      await conn.query(
        `UPDATE salary_lines sl
         JOIN payment_batch_items bi ON bi.salary_line_id = sl.id
         SET sl.payment_status = 'PAID',
             sl.payment_reference = bi.utr_reference,
             sl.payment_failed_reason = NULL
         WHERE bi.batch_id = ? AND bi.status = 'SUCCESS'`,
        [batchId],
      );
      await conn.query(
        `UPDATE salary_lines sl
         JOIN payment_batch_items bi ON bi.salary_line_id = sl.id
         SET sl.payment_status = 'FAILED',
             sl.payment_failed_reason = bi.failure_reason
         WHERE bi.batch_id = ? AND bi.status IN ('FAILED', 'RETURNED')`,
        [batchId],
      );

      return { successCount, failedCount, status };
    });
  }

  async listFailedItems(batchId: number): Promise<BatchItemResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT bi.*, e.emp_code
       FROM payment_batch_items bi
       LEFT JOIN employees e ON e.id = bi.employee_id
       WHERE bi.batch_id = ? AND bi.status IN ('FAILED', 'RETURNED')
       ORDER BY bi.id ASC`,
      [batchId],
    );
    return rows.map((r) => this.toItem(r));
  }

  /** Bank-transfer report rows: every item raised for a period. */
  async listItemsForPeriod(periodId: number): Promise<(BatchItemResponse & { batchNo: string; batchStatus: string })[]> {
    const rows = await this.query<any[]>(
      `SELECT bi.*, e.emp_code, b.batch_no, b.status AS batch_status
       FROM payment_batch_items bi
       JOIN payment_batches b ON b.id = bi.batch_id
       LEFT JOIN employees e ON e.id = bi.employee_id
       WHERE b.period_id = ?
       ORDER BY b.id ASC, e.emp_code ASC`,
      [periodId],
    );
    return rows.map((r) => ({
      ...this.toItem(r),
      batchNo: String(r.batch_no ?? ''),
      batchStatus: String(r.batch_status ?? ''),
    }));
  }

  // -------------------------------------------------------------------------
  // Mappers
  // -------------------------------------------------------------------------

  private toAccount(r: any): BankAccountResponse {
    return {
      id: Number(r.id),
      label: String(r.label),
      bankName: String(r.bank_name),
      accountNumber: String(r.account_number),
      ifsc: r.ifsc ?? null,
      branch: r.branch ?? null,
      currency: String(r.currency ?? 'INR'),
      company: r.company ?? null,
      fileFormat: (r.file_format ?? 'NEFT') as BankFileFormat,
      corporateId: r.corporate_id ?? null,
      isDefault: !!r.is_default,
      isActive: !!r.is_active,
    };
  }

  private toRate(r: any): ExchangeRateResponse {
    return {
      id: Number(r.id),
      fromCurrency: String(r.from_currency),
      toCurrency: String(r.to_currency),
      rate: Number(r.rate ?? 0),
      effectiveDate: toDateString(r.effective_date),
      source: r.source ?? null,
    };
  }

  private toItem(r: any): BatchItemResponse {
    return {
      id: Number(r.id),
      batchId: Number(r.batch_id),
      salaryLineId: r.salary_line_id === null || r.salary_line_id === undefined ? null : Number(r.salary_line_id),
      employeeId: Number(r.employee_id),
      empCode: r.emp_code ?? null,
      beneficiaryName: String(r.beneficiary_name ?? ''),
      accountNumber: r.account_number ?? null,
      ifsc: r.ifsc ?? null,
      amount: Number(r.amount ?? 0),
      currency: String(r.currency ?? 'INR'),
      status: (r.status ?? 'PENDING') as BatchItemStatus,
      utrReference: r.utr_reference ?? null,
      failureReason: r.failure_reason ?? null,
      validationStatus: (r.validation_status ?? 'VALID') as ValidationStatus,
    };
  }

  private toBatch(r: any): BatchResponse {
    return {
      id: Number(r.id),
      batchNo: String(r.batch_no),
      periodId: r.period_id === null || r.period_id === undefined ? null : Number(r.period_id),
      periodLabel: r.period_label ?? null,
      runId: r.run_id === null || r.run_id === undefined ? null : Number(r.run_id),
      bankAccountId: r.bank_account_id === null || r.bank_account_id === undefined ? null : Number(r.bank_account_id),
      bankAccountLabel: r.bank_account_label ?? null,
      currency: String(r.currency ?? 'INR'),
      paymentMode: (r.payment_mode ?? 'NEFT') as PaymentMode,
      valueDate: r.value_date ? toDateString(r.value_date) : null,
      totalRecords: Number(r.total_records ?? 0),
      totalAmount: Number(r.total_amount ?? 0),
      successCount: Number(r.success_count ?? 0),
      failedCount: Number(r.failed_count ?? 0),
      status: (r.status ?? 'DRAFT') as BatchStatus,
      fileName: r.file_name ?? null,
      generatedAt: toIsoOrNull(r.generated_at),
      createdBy: r.created_by === null || r.created_by === undefined ? null : Number(r.created_by),
      createdAt: toIsoOrNull(r.created_at),
    };
  }
}
