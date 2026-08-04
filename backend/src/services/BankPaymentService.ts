import {
  BankPaymentRepository,
  BankAccountInput,
  BankAccountResponse,
  BatchItemResponse,
  BatchItemStatus,
  BatchResponse,
  CurrencyResponse,
  ExchangeRateResponse,
  NewBatchItem,
  PaymentMode,
  ValidationStatus,
} from '../repositories/BankPaymentRepository';
import { generateCsv } from '../utils/csv';
import { round2, todayString } from '../utils/dateUtils';

/** Indian Financial System Code: 4 letters, a zero, then 6 alphanumerics. */
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export interface GenerateBatchInput {
  runId?: number | null;
  bankAccountId?: number | null;
  paymentMode?: PaymentMode;
  valueDate?: string | null;
}

export interface PaymentResultInput {
  itemId: number;
  status: BatchItemStatus;
  utrReference?: string | null;
  failureReason?: string | null;
}

export interface GenerateBatchResult {
  batch: BatchResponse;
  invalidItems: BatchItemResponse[];
}

export interface BankFileExport {
  fileName: string;
  csv: string;
  recordCount: number;
  totalAmount: number;
}

/**
 * Everything between "payroll is approved" and "money left the account":
 * beneficiary validation, bank-file generation, result reconciliation and retry.
 *
 * The core safety rule is that an item with bad beneficiary details is stored
 * but never counted and never exported. HR sees exactly who was skipped and
 * why, instead of discovering it from a bank rejection file three days later.
 */
export class BankPaymentService {
  private repo = new BankPaymentRepository();

  // -------------------------------------------------------------------------
  // Bank accounts
  // -------------------------------------------------------------------------

  async listAccounts(includeInactive = false): Promise<BankAccountResponse[]> {
    return this.repo.listAccounts(includeInactive);
  }

  async getAccount(id: number): Promise<BankAccountResponse> {
    const account = await this.repo.findAccountById(id);
    if (!account) throw new Error('Bank account not found');
    return account;
  }

  async createAccount(input: BankAccountInput, userId: number): Promise<BankAccountResponse> {
    if (!input.label || !input.bankName || !input.accountNumber) {
      throw new Error('Label, bank name and account number are required');
    }
    if (input.ifsc && !IFSC_PATTERN.test(String(input.ifsc).toUpperCase())) {
      throw new Error('IFSC must be 4 letters, a zero, then 6 alphanumeric characters');
    }
    const id = await this.repo.createAccount(
      { ...input, ifsc: input.ifsc ? String(input.ifsc).toUpperCase() : null },
      userId,
    );
    return this.getAccount(id);
  }

  async updateAccount(id: number, input: Partial<BankAccountInput>): Promise<BankAccountResponse> {
    await this.getAccount(id);
    if (input.ifsc && !IFSC_PATTERN.test(String(input.ifsc).toUpperCase())) {
      throw new Error('IFSC must be 4 letters, a zero, then 6 alphanumeric characters');
    }
    await this.repo.updateAccount(id, {
      ...input,
      ...(input.ifsc ? { ifsc: String(input.ifsc).toUpperCase() } : {}),
    });
    return this.getAccount(id);
  }

  /**
   * Bank accounts are soft-deleted, never removed: the batches they paid must
   * keep pointing at a real account for audit.
   */
  async deleteAccount(id: number): Promise<void> {
    await this.getAccount(id);
    await this.repo.softDeleteAccount(id);
  }

  // -------------------------------------------------------------------------
  // Currencies and rates
  // -------------------------------------------------------------------------

  async listCurrencies(includeInactive = false): Promise<CurrencyResponse[]> {
    return this.repo.listCurrencies(includeInactive);
  }

  async listRates(filters: { from?: string; to?: string; limit?: number } = {}): Promise<ExchangeRateResponse[]> {
    return this.repo.listRates(filters);
  }

  async upsertRate(
    input: { fromCurrency: string; toCurrency: string; rate: number; effectiveDate?: string; source?: string | null },
    userId: number,
  ): Promise<ExchangeRateResponse[]> {
    const from = String(input.fromCurrency ?? '').toUpperCase();
    const to = String(input.toCurrency ?? '').toUpperCase();
    const rate = Number(input.rate);
    if (from.length !== 3 || to.length !== 3) throw new Error('Currency codes must be 3 letters');
    if (from === to) throw new Error('The source and target currency must differ');
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Rate must be a positive number');

    await this.repo.upsertRate(from, to, rate, input.effectiveDate ?? todayString(), input.source ?? 'Manual', userId);
    return this.repo.listRates({ from, to, limit: 20 });
  }

  /**
   * Converts using the latest rate effective on or before `onDate`.
   *
   * Identity conversion short-circuits. A missing pair throws rather than
   * silently returning the input amount, because a wrong salary figure is far
   * more expensive than a failed request.
   */
  async convert(amount: number, from: string, to: string, onDate?: string): Promise<{
    amount: number;
    rate: number;
    from: string;
    to: string;
    rateDate: string;
  }> {
    const src = String(from ?? '').toUpperCase();
    const dst = String(to ?? '').toUpperCase();
    const date = onDate ?? todayString();

    if (src === dst) return { amount: round2(amount), rate: 1, from: src, to: dst, rateDate: date };

    const direct = await this.repo.findRateOn(src, dst, date);
    if (direct) {
      return {
        amount: round2(amount * direct.rate),
        rate: direct.rate,
        from: src,
        to: dst,
        rateDate: direct.effectiveDate,
      };
    }

    // A pair is often stored one way only (USD->INR but not INR->USD).
    const inverse = await this.repo.findRateOn(dst, src, date);
    if (inverse && inverse.rate > 0) {
      const rate = 1 / inverse.rate;
      return {
        amount: round2(amount * rate),
        rate,
        from: src,
        to: dst,
        rateDate: inverse.effectiveDate,
      };
    }

    throw new Error(`No exchange rate is configured for ${src} to ${dst} on or before ${date}`);
  }

  // -------------------------------------------------------------------------
  // Batches
  // -------------------------------------------------------------------------

  /**
   * Builds a payment batch for a period.
   *
   * Every payable line is validated before it can reach the bank; invalid rows
   * are recorded on the batch but excluded from the totals and the export.
   */
  async generateBatch(
    periodId: number,
    input: GenerateBatchInput,
    userId: number,
  ): Promise<GenerateBatchResult> {
    if (!periodId) throw new Error('A period is required');

    const account = input.bankAccountId
      ? await this.repo.findAccountById(input.bankAccountId)
      : await this.repo.findDefaultAccount();
    if (!account) throw new Error('No company bank account is configured');

    const lines = await this.repo.findPayableLines(periodId, input.runId ?? null);
    if (lines.length === 0) throw new Error('There are no unpaid salary lines to pay for this period');

    const items: NewBatchItem[] = lines.map((line) => ({
      salaryLineId: line.salaryLineId,
      employeeId: line.employeeId,
      beneficiaryName: line.beneficiaryName,
      accountNumber: line.accountNumber,
      ifsc: line.ifsc ? line.ifsc.toUpperCase() : null,
      amount: round2(line.amount),
      currency: line.currency || account.currency,
      validationStatus: this.validateBeneficiary(line.accountNumber, line.ifsc, line.amount),
    }));

    const { batchId } = await this.repo.createBatchWithItems(
      {
        periodId,
        runId: input.runId ?? null,
        bankAccountId: account.id,
        currency: account.currency,
        paymentMode: input.paymentMode ?? (account.fileFormat === 'GENERIC_CSV' ? 'NEFT' : (account.fileFormat as PaymentMode)),
        valueDate: input.valueDate ?? todayString(),
        createdBy: userId,
      },
      items,
    );

    const batch = await this.getBatch(batchId);
    const invalidItems = (batch.items ?? []).filter((i) => i.validationStatus !== 'VALID');
    return { batch, invalidItems };
  }

  /**
   * Renders the bank file. Column layout follows the account's `file_format`
   * because every bank wants its own order; only VALID items are exported.
   */
  async exportBatchFile(batchId: number): Promise<BankFileExport> {
    const batch = await this.repo.findBatchById(batchId);
    if (!batch) throw new Error('Payment batch not found');
    if (batch.status === 'CANCELLED') throw new Error('This batch has been cancelled');

    const account = batch.bankAccountId ? await this.repo.findAccountById(batch.bankAccountId) : null;
    const format = account?.fileFormat ?? 'GENERIC_CSV';
    const items = await this.repo.listBatchItems(batchId, true);
    if (items.length === 0) throw new Error('This batch has no valid records to export');

    const { headers, rows } = this.layoutFor(format, batch, items, account?.accountNumber ?? null);
    const csv = generateCsv(headers, rows);
    const fileName = `${batch.batchNo}-${format}.csv`;

    await this.repo.markBatchGenerated(batchId, fileName);

    return {
      fileName,
      csv,
      recordCount: items.length,
      totalAmount: round2(items.reduce((sum, i) => sum + i.amount, 0)),
    };
  }

  async markBatchSent(batchId: number): Promise<BatchResponse> {
    const batch = await this.repo.findBatchById(batchId);
    if (!batch) throw new Error('Payment batch not found');
    if (batch.status !== 'GENERATED' && batch.status !== 'DRAFT') {
      throw new Error(`A batch in status ${batch.status} cannot be marked as sent`);
    }
    await this.repo.markBatchSent(batchId);
    return this.getBatch(batchId);
  }

  /**
   * Applies the bank's response file. Recomputes counters, sets the batch
   * status and writes the outcome back to the salary lines.
   */
  async recordPaymentResults(batchId: number, results: PaymentResultInput[]): Promise<BatchResponse> {
    const batch = await this.repo.findBatchById(batchId);
    if (!batch) throw new Error('Payment batch not found');
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error('At least one payment result is required');
    }

    const allowed: BatchItemStatus[] = ['PENDING', 'SENT', 'SUCCESS', 'FAILED', 'RETURNED'];
    const known = new Set((await this.repo.listBatchItems(batchId)).map((i) => i.id));
    for (const r of results) {
      if (!known.has(Number(r.itemId))) throw new Error(`Item ${r.itemId} does not belong to this batch`);
      if (!allowed.includes(r.status)) throw new Error(`Unknown payment status '${r.status}'`);
      if ((r.status === 'FAILED' || r.status === 'RETURNED') && !r.failureReason) {
        throw new Error('A failure reason is required for failed payments');
      }
    }

    await this.repo.applyPaymentResults(
      batchId,
      results.map((r) => ({
        itemId: Number(r.itemId),
        status: r.status,
        utrReference: r.utrReference ?? null,
        failureReason: r.failureReason ?? null,
      })),
    );
    return this.getBatch(batchId);
  }

  /**
   * Failed payments are retryable: a new batch is raised containing only the
   * failed items. The original batch keeps its history intact.
   */
  async retryFailed(batchId: number, userId: number): Promise<GenerateBatchResult> {
    const batch = await this.repo.findBatchById(batchId);
    if (!batch) throw new Error('Payment batch not found');

    const failed = await this.repo.listFailedItems(batchId);
    if (failed.length === 0) throw new Error('This batch has no failed payments to retry');

    const items: NewBatchItem[] = failed.map((item) => ({
      salaryLineId: item.salaryLineId,
      employeeId: item.employeeId,
      beneficiaryName: item.beneficiaryName,
      accountNumber: item.accountNumber,
      ifsc: item.ifsc ? item.ifsc.toUpperCase() : null,
      amount: round2(item.amount),
      currency: item.currency,
      validationStatus: this.validateBeneficiary(item.accountNumber, item.ifsc, item.amount),
    }));

    const { batchId: newBatchId } = await this.repo.createBatchWithItems(
      {
        periodId: batch.periodId,
        runId: batch.runId,
        bankAccountId: batch.bankAccountId,
        currency: batch.currency,
        paymentMode: batch.paymentMode,
        valueDate: todayString(),
        createdBy: userId,
      },
      items,
    );

    const created = await this.getBatch(newBatchId);
    return { batch: created, invalidItems: (created.items ?? []).filter((i) => i.validationStatus !== 'VALID') };
  }

  async listBatches(filters: { periodId?: number; status?: string; limit?: number } = {}): Promise<BatchResponse[]> {
    return this.repo.listBatches(filters);
  }

  async getBatch(id: number): Promise<BatchResponse> {
    const batch = await this.repo.findBatchById(id);
    if (!batch) throw new Error('Payment batch not found');
    batch.items = await this.repo.listBatchItems(id);
    return batch;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private validateBeneficiary(
    accountNumber: string | null,
    ifsc: string | null,
    amount: number,
  ): ValidationStatus {
    if (!(amount > 0)) return 'ZERO_AMOUNT';
    if (!accountNumber || accountNumber.trim() === '') return 'MISSING_ACCOUNT';
    if (!ifsc || ifsc.trim() === '') return 'MISSING_IFSC';
    if (!IFSC_PATTERN.test(ifsc.trim().toUpperCase())) return 'INVALID_IFSC';
    return 'VALID';
  }

  /** Per-bank column layouts. GENERIC_CSV is the safe fallback. */
  private layoutFor(
    format: string,
    batch: BatchResponse,
    items: BatchItemResponse[],
    debitAccount: string | null,
  ): { headers: string[]; rows: unknown[][] } {
    const valueDate = batch.valueDate ?? todayString();

    switch (format) {
      case 'NEFT':
      case 'RTGS':
        return {
          headers: [
            'Transaction Type', 'Debit Account', 'Beneficiary Name', 'Beneficiary Account',
            'IFSC', 'Amount', 'Value Date', 'Remarks', 'Reference',
          ],
          rows: items.map((i) => [
            format, debitAccount ?? '', i.beneficiaryName, i.accountNumber ?? '',
            i.ifsc ?? '', i.amount.toFixed(2), valueDate, `Salary ${batch.periodLabel ?? ''}`.trim(), batch.batchNo,
          ]),
        };
      case 'IMPS':
        return {
          headers: ['Beneficiary Name', 'Beneficiary Account', 'IFSC', 'Amount', 'Mobile', 'Reference'],
          rows: items.map((i) => [
            i.beneficiaryName, i.accountNumber ?? '', i.ifsc ?? '', i.amount.toFixed(2), '', batch.batchNo,
          ]),
        };
      case 'ACH':
        return {
          headers: [
            'Record Type', 'Sponsor Bank Account', 'Destination Account', 'IFSC',
            'Beneficiary Name', 'Amount', 'Settlement Date', 'UMRN', 'Reference',
          ],
          rows: items.map((i) => [
            'CR', debitAccount ?? '', i.accountNumber ?? '', i.ifsc ?? '',
            i.beneficiaryName, i.amount.toFixed(2), valueDate, '', batch.batchNo,
          ]),
        };
      default:
        return {
          headers: [
            'Batch No', 'Employee Code', 'Beneficiary Name', 'Account Number',
            'IFSC', 'Amount', 'Currency', 'Value Date',
          ],
          rows: items.map((i) => [
            batch.batchNo, i.empCode ?? '', i.beneficiaryName, i.accountNumber ?? '',
            i.ifsc ?? '', i.amount.toFixed(2), i.currency, valueDate,
          ]),
        };
    }
  }
}
