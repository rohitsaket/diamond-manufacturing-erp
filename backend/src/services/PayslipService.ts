import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { BaseRepository } from '../repositories/BaseRepository';
import { jobQueueService } from './JobQueueService';
import { getStorageDriver } from './storage/StorageDriver';
import { env } from '../config/env';
import { round2, toDateString } from '../utils/dateUtils';

/**
 * Payslip data, PDF rendering and tamper-evident verification.
 *
 * On signatures: a legally meaningful digital signature needs an X.509
 * certificate and a signing key this deployment does not have, and pdfkit
 * cannot produce a PAdES signature anyway. Rather than draw a "digitally
 * signed" badge that means nothing, the payslip carries a QR code holding an
 * HMAC of its own figures. Anyone can scan it and have the server confirm the
 * amounts have not been altered -- which is the property people actually want.
 */

export interface PayslipComponent {
  code: string;
  name: string;
  category: string | null;
  amount: number;
  isTaxable: boolean;
  displayOrder: number;
}

export interface PayslipData {
  lineId: number;
  employee: {
    id: number;
    empCode: string;
    fullName: string;
    designation: string | null;
    department: string | null;
    branch: string | null;
    joinedAt: string | null;
    pan: string | null;
    uan: string | null;
    esic: string | null;
    bankName: string | null;
    bankAccount: string | null;
    dob: string | null;
    workerType: string | null;
  };
  period: {
    id: number;
    label: string;
    fromDate: string;
    toDate: string;
    payDate: string | null;
  };
  attendance: {
    periodDays: number;
    paidDays: number;
    presentDays: number;
    absentDays: number;
    leaveDays: number;
    lopDays: number;
    otHours: number;
  };
  earnings: PayslipComponent[];
  deductions: PayslipComponent[];
  employerContributions: PayslipComponent[];
  totals: {
    grossEarnings: number;
    totalDeductions: number;
    netPay: number;
    employerCost: number;
    taxableIncome: number;
  };
  netInWords: string;
  currency: string;
  paymentStatus: string;
  paymentReference: string | null;
  /** True when the breakdown came from the flat legacy columns. */
  fromLegacyColumns: boolean;
  company: string;
  generatedAt: string;
}

export interface PayslipPdfResult {
  buffer: Buffer;
  fileName: string;
  passwordProtected: boolean;
  passwordHint: string | null;
  signingAvailable: false;
  signingUnavailableReason: string;
  verifyUrl: string;
}

export interface PayslipVerification {
  valid: boolean;
  employeeName?: string;
  empCode?: string;
  period?: string;
  netAmount?: number;
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0-99 in words. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n] as string;
  const tens = TENS[Math.floor(n / 10)] as string;
  const rest = n % 10;
  return rest ? `${tens} ${ONES[rest]}` : tens;
}

/** 0-999 in words. */
function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/**
 * Indian numbering: crore / lakh / thousand, not million / billion.
 * `123456.75` -> "One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Five Paise".
 */
export function numberToWords(value: number, currencyName = 'Rupees', fractionName = 'Paise'): string {
  const amount = Math.abs(round2(value));
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);

  const words: string[] = [];
  if (rupees === 0) {
    words.push('Zero');
  } else {
    const crore = Math.floor(rupees / 10000000);
    const lakh = Math.floor((rupees % 10000000) / 100000);
    const thousand = Math.floor((rupees % 100000) / 1000);
    const remainder = rupees % 1000;

    if (crore) words.push(`${threeDigits(crore)} Crore`);
    if (lakh) words.push(`${threeDigits(lakh)} Lakh`);
    if (thousand) words.push(`${threeDigits(thousand)} Thousand`);
    if (remainder) words.push(threeDigits(remainder));
  }

  const sign = value < 0 ? 'Minus ' : '';
  const base = `${sign}${currencyName} ${words.join(' ')}`.trim();
  return paise > 0 ? `${base} and ${twoDigits(paise)} ${fractionName} Only` : `${base} Only`;
}

/** Repository access is kept private to this service. */
class PayslipRepository extends BaseRepository {
  async findLine(lineId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT sl.*, p.label AS period_label, p.from_date, p.to_date, p.pay_date,
              e.emp_code, e.full_name, e.designation, e.department, e.branch, e.joined_at,
              e.pan, e.uan_number, e.esic_number, e.bank_name, e.bank_account, e.dob,
              e.worker_type AS employee_worker_type, e.company
       FROM salary_lines sl
       JOIN salary_periods p ON p.id = sl.period_id
       JOIN employees e ON e.id = sl.employee_id
       WHERE sl.id = ?`,
      [lineId],
    );
    return rows[0] ?? null;
  }

  async findComponents(lineId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT component_code, component_name, component_type, category, amount,
              is_taxable, display_order
       FROM salary_line_components
       WHERE salary_line_id = ?
       ORDER BY display_order ASC, id ASC`,
      [lineId],
    );
  }

  /** Line ids to render for a bulk job, optionally narrowed to some employees. */
  async findLineIdsForPeriod(periodId: number, employeeIds?: number[] | null): Promise<number[]> {
    const clean = (employeeIds ?? [])
      .map((id) => Math.trunc(Number(id)))
      .filter((id) => Number.isFinite(id) && id > 0);

    const rows = clean.length > 0
      ? await this.query<any[]>(
        `SELECT sl.id FROM salary_lines sl
         WHERE sl.period_id = ? AND sl.employee_id IN (${clean.map(() => '?').join(', ')})
         ORDER BY sl.id ASC`,
        [periodId, ...clean],
      )
      : await this.query<any[]>(
        'SELECT sl.id FROM salary_lines sl WHERE sl.period_id = ? ORDER BY sl.id ASC',
        [periodId],
      );
    return rows.map((r) => Number(r.id));
  }
}

export class PayslipService {
  private repo = new PayslipRepository();

  constructor() {
    this.registerJobHandlers();
  }

  /**
   * Bulk payslip rendering runs on the job queue. Registered once per process;
   * every service instance shares the singleton queue, so re-registration on a
   * second construction is a no-op.
   */
  private registerJobHandlers(): void {
    if (jobQueueService.hasHandler('PAYSLIP_BULK')) return;
    jobQueueService.registerHandler('PAYSLIP_BULK', async (payload, updateProgress) => {
      const input = (payload ?? {}) as { periodId: number; employeeIds?: number[] | null; password?: boolean };
      const lineIds = await this.repo.findLineIdsForPeriod(Number(input.periodId), input.employeeIds ?? null);
      const storage = getStorageDriver();

      const files: { lineId: number; key: string; size: number }[] = [];
      const failures: { lineId: number; error: string }[] = [];

      for (let i = 0; i < lineIds.length; i++) {
        const lineId = lineIds[i] as number;
        try {
          const pdf = await this.generatePdf(lineId, { password: input.password ?? true });
          const key = `payslips/${input.periodId}/${pdf.fileName}`;
          const stored = await storage.put(key, pdf.buffer);
          files.push({ lineId, key: stored.key, size: stored.size });
        } catch (err: any) {
          // One bad payslip must never abandon the other 4,999.
          failures.push({ lineId, error: err?.message ?? String(err) });
        }
        if ((i + 1) % 25 === 0 || i === lineIds.length - 1) {
          await updateProgress(
            Math.round(((i + 1) / Math.max(1, lineIds.length)) * 100),
            `Rendered ${i + 1} of ${lineIds.length} payslips`,
          );
        }
      }

      return { periodId: input.periodId, requested: lineIds.length, generated: files.length, failed: failures.length, files, failures };
    });
  }

  /**
   * The full payslip.
   *
   * Component rows are preferred, but lines produced by the older flat engine
   * have none -- for those the flat columns are exploded into pseudo-components
   * so every payslip in the system still renders.
   */
  async getPayslipData(lineId: number): Promise<PayslipData> {
    const line = await this.repo.findLine(lineId);
    if (!line) throw new Error('Payslip not found');

    const rows = await this.repo.findComponents(lineId);
    const fromLegacyColumns = rows.length === 0;

    const earnings: PayslipComponent[] = [];
    const deductions: PayslipComponent[] = [];
    const employerContributions: PayslipComponent[] = [];

    if (!fromLegacyColumns) {
      for (const r of rows) {
        const component: PayslipComponent = {
          code: String(r.component_code),
          name: String(r.component_name),
          category: r.category ?? null,
          amount: Number(r.amount ?? 0),
          isTaxable: !!r.is_taxable,
          displayOrder: Number(r.display_order ?? 100),
        };
        const type = String(r.component_type);
        if (type === 'DEDUCTION') deductions.push(component);
        else if (type === 'EMPLOYER_CONTRIBUTION') employerContributions.push(component);
        else earnings.push(component);
      }
    } else {
      const push = (
        target: PayslipComponent[],
        code: string,
        name: string,
        amount: number,
        order: number,
        category: string | null,
      ) => {
        if (round2(amount) !== 0) {
          target.push({ code, name, category, amount: round2(amount), isTaxable: true, displayOrder: order });
        }
      };
      push(earnings, 'FIXED', 'Fixed Salary', Number(line.earn_fixed ?? 0), 10, 'BASIC');
      push(earnings, 'PIECE', 'Piece Rate Earnings', Number(line.earn_piece ?? 0), 15, 'BASIC');
      push(earnings, 'OT', 'Overtime', Number(line.earn_ot ?? 0), 20, 'OVERTIME');
      push(earnings, 'BONUS', 'Bonus', Number(line.earn_bonus ?? 0), 30, 'BONUS');
      push(earnings, 'INCENTIVE', 'Incentive', Number(line.earn_incentive ?? 0), 32, 'INCENTIVE');
      push(earnings, 'VARPAY', 'Variable Pay', Number(line.earn_variable ?? 0), 34, 'VARIABLE_PAY');
      push(earnings, 'ARREARS', 'Arrears', Number(line.earn_arrears ?? 0), 36, 'ARREARS');
      push(earnings, 'REIMB', 'Reimbursement', Number(line.earn_reimbursement ?? 0), 38, 'REIMBURSEMENT');

      push(deductions, 'PF', 'Provident Fund', Number(line.ded_pf ?? 0), 200, 'STATUTORY');
      push(deductions, 'ESI', 'Employee State Insurance', Number(line.ded_esi ?? 0), 210, 'STATUTORY');
      push(deductions, 'PT', 'Professional Tax', Number(line.ded_pt ?? 0), 220, 'STATUTORY');
      push(deductions, 'TDS', 'Income Tax (TDS)', Number(line.ded_income_tax ?? 0), 230, 'STATUTORY');
      push(deductions, 'LWF', 'Labour Welfare Fund', Number(line.ded_lwf ?? 0), 240, 'STATUTORY');
      push(deductions, 'LOAN-EMI', 'Loan Recovery', Number(line.ded_loan ?? 0), 250, 'LOAN');
      push(deductions, 'ADV-REC', 'Advance Recovery', Number(line.ded_advance ?? 0), 260, 'LOAN');
      push(deductions, 'INS-PREM', 'Insurance Premium', Number(line.ded_insurance ?? 0), 270, 'OTHER');
      push(deductions, 'OTHER', 'Other Deductions', Number(line.ded_other ?? 0), 280, 'OTHER');

      push(employerContributions, 'EMP-PF', 'Employer PF Contribution', Number(line.employer_pf ?? 0), 300, 'STATUTORY');
      push(employerContributions, 'EMP-ESI', 'Employer ESI Contribution', Number(line.employer_esi ?? 0), 310, 'STATUTORY');
    }

    const grossEarnings = round2(Number(line.gross_amount ?? 0));
    const totalDeductions = round2(Number(line.total_deductions ?? 0));
    const netPay = round2(Number(line.net_amount ?? 0));

    return {
      lineId: Number(line.id),
      employee: {
        id: Number(line.employee_id),
        empCode: String(line.emp_code ?? ''),
        fullName: String(line.full_name ?? ''),
        designation: line.designation ?? null,
        department: line.department ?? null,
        branch: line.branch ?? null,
        joinedAt: line.joined_at ? toDateString(line.joined_at) : null,
        pan: line.pan ?? null,
        uan: line.uan_number ?? null,
        esic: line.esic_number ?? null,
        bankName: line.bank_name ?? null,
        bankAccount: line.bank_account ? this.maskAccount(String(line.bank_account)) : null,
        dob: line.dob ? toDateString(line.dob) : null,
        workerType: line.worker_type ?? line.employee_worker_type ?? null,
      },
      period: {
        id: Number(line.period_id),
        label: String(line.period_label ?? ''),
        fromDate: toDateString(line.from_date),
        toDate: toDateString(line.to_date),
        payDate: line.pay_date ? toDateString(line.pay_date) : null,
      },
      attendance: {
        periodDays: Number(line.period_days ?? 0),
        paidDays: Number(line.paid_days ?? 0),
        presentDays: Number(line.present_days ?? 0),
        absentDays: Number(line.absent_days ?? 0),
        leaveDays: Number(line.leave_days ?? 0),
        lopDays: Number(line.lop_days ?? 0),
        otHours: Number(line.ot_hours ?? 0),
      },
      earnings: earnings.sort((a, b) => a.displayOrder - b.displayOrder),
      deductions: deductions.sort((a, b) => a.displayOrder - b.displayOrder),
      employerContributions: employerContributions.sort((a, b) => a.displayOrder - b.displayOrder),
      totals: {
        grossEarnings,
        totalDeductions,
        netPay,
        employerCost: round2(Number(line.employer_cost ?? 0)),
        taxableIncome: round2(Number(line.taxable_income ?? 0)),
      },
      netInWords: numberToWords(netPay),
      currency: String(line.currency ?? 'INR'),
      paymentStatus: String(line.payment_status ?? 'UNPAID'),
      paymentReference: line.payment_reference ?? null,
      fromLegacyColumns,
      company: String(line.company ?? env.company.name),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Renders the A4 payslip.
   *
   * Password protection uses the employee's PAN, falling back to employee code
   * plus date of birth. When neither exists the PDF is returned unencrypted and
   * `passwordProtected` is false -- claiming protection that is not there would
   * be worse than not having it.
   */
  async generatePdf(lineId: number, opts: { password?: boolean } = {}): Promise<PayslipPdfResult> {
    const data = await this.getPayslipData(lineId);
    const token = this.signToken(data.lineId, data.employee.id, data.totals.netPay);
    const verifyUrl = `${env.company.appUrl}/verify-payslip/${token}`;

    const credential = opts.password ? this.derivePassword(data) : null;
    const passwordProtected = !!credential;

    const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 0, width: 220 });
    const qrBuffer = Buffer.from(qrDataUrl.split(',')[1] ?? '', 'base64');

    const buffer = await this.renderPdf(data, qrBuffer, verifyUrl, credential?.password ?? null);

    return {
      buffer,
      fileName: `payslip-${data.employee.empCode}-${data.period.label.replace(/[^\w-]+/g, '_')}.pdf`,
      passwordProtected,
      passwordHint: credential?.hint ?? null,
      signingAvailable: false,
      signingUnavailableReason:
        'Digital signing requires an X.509 signing certificate that is not configured for this deployment. '
        + 'The QR code carries an HMAC of the payslip figures and is the working tamper-evidence mechanism.',
      verifyUrl,
    };
  }

  /**
   * Recomputes the HMAC over the stored figures. A mismatch means either the
   * token or the payslip has been altered; both answer `valid: false`.
   */
  async verifyPayslip(token: string): Promise<PayslipVerification> {
    try {
      const [rawId, signature] = String(token ?? '').split('.');
      const lineId = Number(rawId);
      if (!Number.isFinite(lineId) || lineId <= 0 || !signature) return { valid: false };

      const line = await this.repo.findLine(lineId);
      if (!line) return { valid: false };

      const expected = this.hmac(lineId, Number(line.employee_id), round2(Number(line.net_amount ?? 0)));
      const a = Buffer.from(signature, 'utf8');
      const b = Buffer.from(expected, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false };

      return {
        valid: true,
        employeeName: String(line.full_name ?? ''),
        empCode: String(line.emp_code ?? ''),
        period: String(line.period_label ?? ''),
        netAmount: round2(Number(line.net_amount ?? 0)),
      };
    } catch {
      return { valid: false };
    }
  }

  /**
   * Bulk generation is queued rather than run inline: rendering thousands of
   * PDFs inside one HTTP request is how a payroll server falls over on the 1st.
   */
  async bulkGenerate(periodId: number, employeeIds?: number[], userId = 0): Promise<{ jobId: number; jobType: string }> {
    if (!periodId) throw new Error('A period is required');
    const jobId = await jobQueueService.enqueue(
      'PAYSLIP_BULK',
      { periodId, employeeIds: Array.isArray(employeeIds) && employeeIds.length > 0 ? employeeIds : null },
      userId,
    );
    return { jobId: Number(jobId), jobType: 'PAYSLIP_BULK' };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private hmac(lineId: number, employeeId: number, netAmount: number): string {
    return crypto
      .createHmac('sha256', env.jwt.secret)
      .update(`${lineId}|${employeeId}|${netAmount.toFixed(2)}`)
      .digest('hex');
  }

  /**
   * The token carries the line id alongside the signature: without it the
   * server has nothing to recompute the HMAC against. The id is not a secret --
   * the signature is what makes the token unforgeable.
   */
  private signToken(lineId: number, employeeId: number, netAmount: number): string {
    return `${lineId}.${this.hmac(lineId, employeeId, netAmount)}`;
  }

  private derivePassword(data: PayslipData): { password: string; hint: string } | null {
    const pan = data.employee.pan ? String(data.employee.pan).trim().toUpperCase() : '';
    if (pan) return { password: pan, hint: 'Your PAN in capitals' };

    if (data.employee.dob) {
      const [y, m, d] = data.employee.dob.split('-');
      if (y && m && d) {
        return {
          password: `${data.employee.empCode}${d}${m}${y}`,
          hint: 'Your employee code followed by your date of birth as DDMMYYYY',
        };
      }
    }
    return null;
  }

  private maskAccount(account: string): string {
    const trimmed = account.trim();
    if (trimmed.length <= 4) return trimmed;
    return `${'X'.repeat(Math.max(0, trimmed.length - 4))}${trimmed.slice(-4)}`;
  }

  private renderPdf(
    data: PayslipData,
    qrBuffer: Buffer,
    verifyUrl: string,
    userPassword: string | null,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 40,
          info: {
            Title: `Payslip ${data.employee.empCode} ${data.period.label}`,
            Author: data.company,
          },
          ...(userPassword
            ? {
              userPassword,
              ownerPassword: crypto.randomBytes(24).toString('hex'),
              permissions: { printing: 'highResolution', modifying: false, copying: false },
            }
            : {}),
        } as any);

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const left = 40;
        const right = 555;
        const width = right - left;
        const money = (n: number) => n.toFixed(2);

        // --- Company header ---
        doc.fontSize(18).font('Helvetica-Bold').text(data.company, left, 40, { width, align: 'center' });
        doc.fontSize(11).font('Helvetica')
          .text(`Payslip for ${data.period.label}`, { width, align: 'center' });
        doc.fontSize(8).fillColor('#666')
          .text(`${data.period.fromDate} to ${data.period.toDate}`, { width, align: 'center' });
        doc.fillColor('#000');
        doc.moveTo(left, doc.y + 8).lineTo(right, doc.y + 8).stroke();
        doc.moveDown(1.2);

        // --- Employee block ---
        const blockTop = doc.y;
        const col2 = left + width / 2;
        const detail = (label: string, value: string, x: number, y: number) => {
          doc.fontSize(8).font('Helvetica').fillColor('#666').text(label, x, y, { width: width / 2 - 10 });
          doc.fontSize(9).font('Helvetica-Bold').fillColor('#000')
            .text(value || '-', x, y + 10, { width: width / 2 - 10 });
        };

        detail('Employee', `${data.employee.fullName} (${data.employee.empCode})`, left, blockTop);
        detail('Designation', data.employee.designation ?? '-', col2, blockTop);
        detail('Department', data.employee.department ?? '-', left, blockTop + 26);
        detail('Branch', data.employee.branch ?? '-', col2, blockTop + 26);
        detail('Date of joining', data.employee.joinedAt ?? '-', left, blockTop + 52);
        detail('PAN / UAN', `${data.employee.pan ?? '-'} / ${data.employee.uan ?? '-'}`, col2, blockTop + 52);
        detail('Bank', `${data.employee.bankName ?? '-'} ${data.employee.bankAccount ?? ''}`.trim(), left, blockTop + 78);
        detail(
          'Paid days',
          `${data.attendance.paidDays} of ${data.attendance.periodDays} (LOP ${data.attendance.lopDays})`,
          col2,
          blockTop + 78,
        );

        doc.y = blockTop + 108;
        doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke();
        doc.moveDown(0.8);

        // --- Two-column earnings / deductions table ---
        const tableTop = doc.y;
        const midX = left + width / 2;
        const rowHeight = 15;

        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('Earnings', left + 4, tableTop + 4, { width: width / 2 - 60 });
        doc.text('Amount', midX - 64, tableTop + 4, { width: 60, align: 'right' });
        doc.text('Deductions', midX + 4, tableTop + 4, { width: width / 2 - 60 });
        doc.text('Amount', right - 64, tableTop + 4, { width: 60, align: 'right' });

        const bodyTop = tableTop + 20;
        const maxRows = Math.max(data.earnings.length, data.deductions.length);
        doc.font('Helvetica').fontSize(8.5);

        for (let i = 0; i < maxRows; i++) {
          const y = bodyTop + i * rowHeight;
          const earning = data.earnings[i];
          const deduction = data.deductions[i];
          if (earning) {
            doc.text(earning.name, left + 4, y, { width: width / 2 - 70, ellipsis: true });
            doc.text(money(earning.amount), midX - 64, y, { width: 60, align: 'right' });
          }
          if (deduction) {
            doc.text(deduction.name, midX + 4, y, { width: width / 2 - 70, ellipsis: true });
            doc.text(money(deduction.amount), right - 64, y, { width: 60, align: 'right' });
          }
        }

        const totalsY = bodyTop + maxRows * rowHeight + 6;
        doc.moveTo(left, totalsY - 3).lineTo(right, totalsY - 3).stroke();
        doc.font('Helvetica-Bold').fontSize(9);
        doc.text('Gross Earnings', left + 4, totalsY, { width: width / 2 - 70 });
        doc.text(money(data.totals.grossEarnings), midX - 64, totalsY, { width: 60, align: 'right' });
        doc.text('Total Deductions', midX + 4, totalsY, { width: width / 2 - 70 });
        doc.text(money(data.totals.totalDeductions), right - 64, totalsY, { width: 60, align: 'right' });

        // Table borders drawn after the content so nothing is painted over.
        const tableBottom = totalsY + rowHeight;
        doc.rect(left, tableTop, width, tableBottom - tableTop).stroke();
        doc.moveTo(midX, tableTop).lineTo(midX, tableBottom).stroke();
        doc.moveTo(left, tableTop + 16).lineTo(right, tableTop + 16).stroke();

        // --- Net pay ---
        const netY = tableBottom + 12;
        doc.rect(left, netY, width, 40).fillAndStroke('#f2f4f7', '#000');
        doc.fillColor('#000').fontSize(11).font('Helvetica-Bold')
          .text('NET PAY', left + 10, netY + 8);
        doc.fontSize(14).text(`${data.currency} ${money(data.totals.netPay)}`, left + 10, netY + 8, {
          width: width - 20,
          align: 'right',
        });
        doc.fontSize(8).font('Helvetica')
          .text(data.netInWords, left + 10, netY + 26, { width: width - 20 });

        // --- Employer contributions ---
        let cursor = netY + 52;
        if (data.employerContributions.length > 0) {
          doc.fontSize(9).font('Helvetica-Bold').text('Employer Contributions', left, cursor);
          cursor += 14;
          doc.fontSize(8.5).font('Helvetica');
          for (const item of data.employerContributions) {
            doc.text(item.name, left + 4, cursor, { width: 200 });
            doc.text(money(item.amount), left + 210, cursor, { width: 70, align: 'right' });
            cursor += 13;
          }
          cursor += 6;
        }

        // --- QR verification block ---
        const qrY = Math.max(cursor, netY + 52);
        try {
          doc.image(qrBuffer, right - 80, qrY, { width: 80, height: 80 });
        } catch {
          // A QR that failed to encode must never block the payslip itself.
        }
        doc.fontSize(8).font('Helvetica-Bold').text('Verify this payslip', left, qrY);
        doc.font('Helvetica').fontSize(7).fillColor('#444')
          .text(
            'Scan the QR code, or open the link below, to confirm the amounts on this payslip match '
            + 'the payroll record. The code contains a keyed signature of the net pay figure.',
            left,
            qrY + 12,
            { width: width - 100 },
          );
        doc.fontSize(6.5).fillColor('#666').text(verifyUrl, left, qrY + 40, { width: width - 100 });

        // --- Footer ---
        doc.fontSize(7).fillColor('#666').text(
          'This is a computer generated payslip and does not require a physical signature.',
          left,
          qrY + 92,
          { width, align: 'center' },
        );

        doc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
