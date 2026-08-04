import PDFDocument from 'pdfkit';
import { env } from '../config/env';
import { ContributionRepository } from '../repositories/ContributionRepository';
import { FilingRepository } from '../repositories/FilingRepository';
import { StatutoryRepository } from '../repositories/StatutoryRepository';
import {
  Form16BulkResult,
  Form16Channel,
  Form16Distribution,
  Form16DistributionStatus,
  Form16Filters,
  Form16Record,
} from '../types/compliance';
import { round2 } from '../utils/dateUtils';
import { num } from '../utils/payrollMath';
import { financialYearBounds } from '../utils/statutoryRules';
import { EmailService } from './EmailService';
import { taxComputationService } from './TaxComputationService';

/** Employees are generated in blocks of this size. */
const BULK_CHUNK = 100;

/**
 * The disclaimer printed on every certificate and returned with every payload.
 *
 * Part A of a Form 16 — the quarterly TDS deposited against the employer's TAN —
 * is issued by TRACES from the accepted 24Q returns and carries a digital
 * signature. This system holds no digital signature certificate and has no
 * TRACES connection, so what it produces is Part B: the salary and tax
 * computation. Saying otherwise on a tax certificate would be a lie with legal
 * consequences for the employee who relies on it.
 */
const PART_B_BANNER =
  'Part B figures only. This is not a digitally signed statutory Form 16 — download that from TRACES.';

export class Form16Service {
  private repo = new FilingRepository();
  private contributions = new ContributionRepository();
  private master = new StatutoryRepository();

  // =========================================================================
  // Generation
  // =========================================================================

  /**
   * Build the Part B figures for one employee-year.
   *
   * Regenerating never overwrites: the revision number is incremented and a new
   * row is written, so a certificate that has already reached an employee stays
   * exactly as it was issued and the change is visible as a revision.
   */
  async generate(employeeId: number, financialYear: string, userId: number): Promise<Form16Record> {
    if (!/^\d{4}-\d{4}$/.test(String(financialYear))) throw new Error('financialYear must look like 2026-2027');

    const details = await this.contributions.findSalaryLineDetails({ financialYear, employeeIds: [employeeId] });
    if (details.length === 0) {
      throw new Error(`Employee ${employeeId} has no salary lines in ${financialYear}`);
    }

    const grossSalary = round2(details.reduce((sum, d) => sum + d.grossAmount, 0));
    const payrollTds = round2(details.reduce((sum, d) => sum + d.dedIncomeTax, 0));
    const first = details[0];
    const pan = first?.pan ?? null;

    // Professional tax and TDS come from the contribution ledger, which is what
    // the challans and the 24Q were built from; falling back to the payslip
    // column only when the ledger has not been built.
    const yearly = await this.contributions.findYearlyTotals(financialYear, ['PT', 'TDS'], [employeeId]);
    const professionalTax = round2(yearly.filter((y) => y.scheme === 'PT').reduce((s, y) => s + y.employeeAmount, 0));
    const ledgerTds = round2(yearly.filter((y) => y.scheme === 'TDS').reduce((s, y) => s + y.employeeAmount, 0));
    const tdsDeducted = ledgerTds > 0 ? ledgerTds : payrollTds;

    // The annual tax computation is owned by TaxComputationService; it is read,
    // and only computed here when the year was never projected.
    let computation = await taxComputationService.getComputation(employeeId, financialYear);
    if (!computation) {
      const bounds = financialYearBounds(financialYear);
      await taxComputationService.computeAnnualTax(employeeId, financialYear, {
        monthlyGross: 0,
        asOfDate: bounds.to,
        monthsRemaining: 1,
        persist: true,
      });
      computation = await taxComputationService.getComputation(employeeId, financialYear);
    }

    const standardDeduction = round2(num(computation?.standard_deduction));
    const exemptions = round2(num(computation?.exemptions));
    // `tax_computations.exemptions` currently equals the standard deduction, so
    // anything above it is a genuine exempt allowance. No HRA/LTA exemption
    // engine exists, so this is normally zero rather than an invented figure.
    const exemptAllowances = round2(Math.max(0, exemptions - standardDeduction));

    const totalTax = round2(num(computation?.total_tax));
    const taxPayable = round2(Math.max(0, totalTax - tdsDeducted));
    const refundDue = round2(Math.max(0, tdsDeducted - totalTax));

    const startYear = Number(financialYear.slice(0, 4));
    const assessmentYear = `${startYear + 1}-${startYear + 2}`;
    const tanRegistration = await this.master.findActiveRegistration('TAN', null);

    const previous = await this.repo.findLatestForm16(employeeId, financialYear);
    const revisionNo = previous ? previous.revisionNo + 1 : 0;
    const certificateNo = `F16/${financialYear}/${first?.empCode ?? employeeId}/${revisionNo}`;

    const remarks: string[] = [];
    if (professionalTax > 0) {
      remarks.push(
        'Professional tax is stated as actually paid; the tax computation on record does not deduct it under section 16(iii).',
      );
    }
    if (ledgerTds === 0 && payrollTds > 0) {
      remarks.push('TDS was taken from the payslips because the contribution ledger has no TDS rows for this year.');
    }
    if (!pan) remarks.push('No PAN is on record for this employee.');

    // The salary total and the taxed total have to agree, or the certificate
    // shows a gross the tax below it was never computed on. Rather than quietly
    // reconciling them, the discrepancy is printed on the certificate.
    const computedGross = round2(num(computation?.gross_annual));
    if (computation && Math.abs(computedGross - grossSalary) >= 1) {
      remarks.push(
        `The tax computation on record was made on an annual gross of ${computedGross.toFixed(2)}, which differs from `
        + `the ${grossSalary.toFixed(2)} totalled from the payslips. Re-run the annual tax computation before issuing.`,
      );
    }

    const id = await this.repo.insertForm16(
      {
        employeeId,
        financialYear,
        assessmentYear,
        certificateNo,
        pan,
        tan: tanRegistration ? tanRegistration.registrationNo : null,
        employerName: tanRegistration?.legalEntity ?? env.company.name,
        regimeCode: null,
        grossSalary,
        exemptAllowances,
        standardDeduction,
        professionalTax,
        chapterViaDeductions: round2(num(computation?.chapter_via_deductions)),
        taxableIncome: round2(num(computation?.taxable_income)),
        taxOnIncome: round2(num(computation?.tax_before_rebate)),
        rebate: round2(num(computation?.rebate)),
        surcharge: round2(num(computation?.surcharge)),
        cess: round2(num(computation?.cess)),
        totalTax,
        tdsDeducted,
        taxPayable,
        refundDue,
        revisionNo,
        remarks: remarks.length > 0 ? remarks.join(' ').slice(0, 500) : null,
      },
      userId,
    );

    await this.master.logAudit({
      entityType: 'FORM16',
      entityId: id,
      employeeId,
      action: revisionNo === 0 ? 'GENERATE' : 'REVISE',
      summary: `Generated Form 16 Part B ${certificateNo}`,
      previousValue: previous ? { revisionNo: previous.revisionNo, totalTax: previous.totalTax } : null,
      newValue: { revisionNo, grossSalary, totalTax, tdsDeducted },
      actorUserId: userId,
    });

    const record = await this.repo.findForm16ById(id);
    if (!record) throw new Error('The Form 16 record was created but could not be read back');
    return record;
  }

  /** Generate for a whole year, in chunks, collecting per-employee failures. */
  async bulkGenerate(financialYear: string, employeeIds: number[] | undefined, userId: number): Promise<Form16BulkResult> {
    if (!/^\d{4}-\d{4}$/.test(String(financialYear))) throw new Error('financialYear must look like 2026-2027');

    let targets = employeeIds && employeeIds.length > 0 ? employeeIds.map(Number) : [];
    const nameById = new Map<number, string>();
    if (targets.length === 0) {
      const details = await this.contributions.findSalaryLineDetails({ financialYear });
      const seen = new Set<number>();
      for (const detail of details) {
        nameById.set(detail.employeeId, detail.fullName);
        if (!seen.has(detail.employeeId)) {
          seen.add(detail.employeeId);
          targets.push(detail.employeeId);
        }
      }
    }

    const failures: Form16BulkResult['failures'] = [];
    let generated = 0;

    for (let offset = 0; offset < targets.length; offset += BULK_CHUNK) {
      const chunk = targets.slice(offset, offset + BULK_CHUNK);
      for (const employeeId of chunk) {
        try {
          await this.generate(employeeId, financialYear, userId);
          generated += 1;
        } catch (err: any) {
          failures.push({
            employeeId,
            employeeName: nameById.get(employeeId) ?? null,
            reason: err?.message ?? String(err),
          });
        }
      }
    }

    return { financialYear, requested: targets.length, generated, failures };
  }

  // =========================================================================
  // PDF
  // =========================================================================

  /**
   * Render the certificate as a PDF laid out as Part B.
   *
   * The banner is printed at the top and repeated in the footer so it survives
   * a page being forwarded on its own.
   */
  async generatePdf(form16Id: number): Promise<{ buffer: Buffer; fileName: string }> {
    const record = await this.requireRecord(form16Id);
    const buffer = await this.renderPdf(record);
    const safeCode = String(record.employeeCode ?? record.employeeId).replace(/[^a-zA-Z0-9._-]/g, '_');
    return {
      buffer,
      fileName: `Form16_PartB_${safeCode}_${record.financialYear}.pdf`,
    };
  }

  private renderPdf(record: Form16Record): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 40,
          info: {
            Title: `Form 16 Part B ${record.employeeCode ?? ''} ${record.financialYear}`,
            Author: record.employerName ?? env.company.name,
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const left = 40;
        const right = 555;
        const width = right - left;
        const money = (n: number) => n.toFixed(2);

        // --- warning banner, first thing on the page -------------------------
        doc.rect(left, 36, width, 30).fillAndStroke('#fff4e5', '#b45309');
        doc.fillColor('#7c2d12').fontSize(8.5).font('Helvetica-Bold')
          .text(PART_B_BANNER, left + 8, 44, { width: width - 16 });
        doc.fillColor('#000');

        // --- header ---------------------------------------------------------
        doc.fontSize(15).font('Helvetica-Bold')
          .text(record.employerName ?? env.company.name, left, 78, { width, align: 'center' });
        doc.fontSize(11).font('Helvetica')
          .text('FORM 16 — PART B', { width, align: 'center' });
        doc.fontSize(8).fillColor('#666')
          .text(
            `Financial Year ${record.financialYear}   ·   Assessment Year ${record.assessmentYear ?? '-'}`
            + `   ·   Certificate ${record.certificateNo ?? '-'}`
            + (record.revisionNo > 0 ? `   ·   Revision ${record.revisionNo}` : ''),
            { width, align: 'center' },
          );
        doc.fillColor('#000');
        doc.moveTo(left, doc.y + 8).lineTo(right, doc.y + 8).stroke();
        doc.moveDown(1.2);

        // --- parties ---------------------------------------------------------
        const blockTop = doc.y;
        const col2 = left + width / 2;
        const detail = (label: string, value: string, x: number, y: number) => {
          doc.fontSize(8).font('Helvetica').fillColor('#666').text(label, x, y, { width: width / 2 - 10 });
          doc.fontSize(9).font('Helvetica-Bold').fillColor('#000')
            .text(value || '-', x, y + 10, { width: width / 2 - 10 });
        };
        detail('Employee', `${record.employeeName ?? ''} (${record.employeeCode ?? record.employeeId})`, left, blockTop);
        detail('PAN of employee', record.pan ?? 'Not on record', col2, blockTop);
        detail('Employer', record.employerName ?? env.company.name, left, blockTop + 28);
        detail('TAN of employer', record.tan ?? 'Not on record', col2, blockTop + 28);

        doc.y = blockTop + 60;
        doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke();
        doc.moveDown(0.6);

        // --- computation ------------------------------------------------------
        let cursor = doc.y;
        const lineHeight = 16;
        const row = (label: string, value: number, opts: { bold?: boolean; indent?: number; negative?: boolean } = {}) => {
          doc.fontSize(9).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000');
          doc.text(label, left + 4 + (opts.indent ?? 0), cursor, { width: width - 130 });
          doc.text(`${opts.negative ? '(-) ' : ''}${money(value)}`, right - 120, cursor, { width: 116, align: 'right' });
          cursor += lineHeight;
        };
        const heading = (text: string) => {
          cursor += 4;
          doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#111').text(text, left, cursor, { width });
          cursor += lineHeight;
        };

        heading('1. Gross salary');
        row('Salary as per section 17(1)', record.grossSalary);
        row('Less: allowances exempt under section 10', record.exemptAllowances, { indent: 10, negative: true });

        const grossAfterExempt = round2(record.grossSalary - record.exemptAllowances);
        row('Balance', grossAfterExempt, { bold: true });

        heading('2. Deductions under section 16');
        row('Standard deduction — section 16(ia)', record.standardDeduction, { indent: 10, negative: true });
        row('Tax on employment (professional tax) — section 16(iii)', record.professionalTax, { indent: 10, negative: true });

        heading('3. Deductions under Chapter VI-A');
        row('Aggregate of deductible amounts', record.chapterViaDeductions, { indent: 10, negative: true });

        heading('4. Total taxable income');
        row('Taxable income', record.taxableIncome, { bold: true });

        heading('5. Tax computation');
        row('Tax on total income', record.taxOnIncome);
        row('Less: rebate under section 87A', record.rebate, { indent: 10, negative: true });
        row('Add: surcharge', record.surcharge, { indent: 10 });
        row('Add: health and education cess', record.cess, { indent: 10 });
        row('Total tax liability', record.totalTax, { bold: true });

        heading('6. Tax deducted at source');
        row('TDS deducted by the employer', record.tdsDeducted);
        row('Balance tax payable', record.taxPayable, { bold: true });
        row('Refund due', record.refundDue);

        // --- caveats ----------------------------------------------------------
        cursor += 10;
        doc.moveTo(left, cursor).lineTo(right, cursor).stroke();
        cursor += 8;
        doc.fontSize(7.5).font('Helvetica').fillColor('#444');
        doc.text(
          'Part A of Form 16 — the quarterly summary of tax deducted and deposited against the employer TAN — is '
          + 'issued by TRACES and carries a digital signature. It is not reproduced here and this document is not a '
          + 'substitute for it. Figures above are computed from the payroll records held in this system.',
          left,
          cursor,
          { width },
        );
        cursor = doc.y + 6;
        if (record.remarks) {
          doc.fontSize(7.5).fillColor('#7c2d12').text(`Note: ${record.remarks}`, left, cursor, { width });
          cursor = doc.y + 6;
        }
        doc.fontSize(7).fillColor('#666').text(
          `Status: ${record.status}${record.isStatutorySigned ? '' : ' · not digitally signed'}`
          + `${record.hasPartA ? '' : ' · Part A not attached'}`,
          left,
          cursor,
          { width },
        );

        // --- footer banner ----------------------------------------------------
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#b45309')
          .text(PART_B_BANNER, left, 780, { width, align: 'center' });

        doc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // =========================================================================
  // Issue and distribution
  // =========================================================================

  async issue(form16Id: number, userId: number): Promise<Form16Record> {
    const record = await this.requireRecord(form16Id);
    if (record.status === 'CANCELLED') throw new Error('A cancelled certificate cannot be issued');

    await this.repo.updateForm16(form16Id, { status: 'ISSUED', issuedAt: new Date() }, userId);
    await this.master.logAudit({
      entityType: 'FORM16',
      entityId: form16Id,
      employeeId: record.employeeId,
      action: 'ISSUE',
      summary: `Issued Form 16 ${record.certificateNo ?? form16Id}`,
      previousValue: record.status,
      newValue: 'ISSUED',
      actorUserId: userId,
    });
    return this.requireRecord(form16Id);
  }

  async recordDistribution(
    form16Id: number,
    channel: Form16Channel,
    recipient: string | null,
    status: Form16DistributionStatus,
    errorMessage: string | null = null,
    userId: number | null = null,
  ): Promise<Form16Distribution[]> {
    await this.requireRecord(form16Id);
    await this.repo.insertDistribution({
      form16Id,
      channel,
      recipient,
      status,
      errorMessage,
      actorUserId: userId,
    });
    return this.repo.findDistributions(form16Id);
  }

  /**
   * Email the certificate to the employee.
   *
   * With no SMTP host configured the attempt is recorded as FAILED with that
   * reason. It is never recorded as sent: an employee who believes their Form 16
   * was emailed and finds nothing has been actively misled.
   */
  async emailToEmployee(form16Id: number, userId: number): Promise<{ sent: boolean; recipient: string | null; reason: string | null }> {
    const record = await this.requireRecord(form16Id);
    const recipient = await this.repo.findEmployeeEmail(record.employeeId);

    if (!recipient) {
      const reason = 'No email address is on record for this employee';
      await this.repo.insertDistribution({ form16Id, channel: 'EMAIL', recipient: null, status: 'FAILED', errorMessage: reason, actorUserId: userId });
      return { sent: false, recipient: null, reason };
    }
    if (!EmailService.isEnabled()) {
      const reason = 'SMTP is not configured, so nothing was sent';
      await this.repo.insertDistribution({ form16Id, channel: 'EMAIL', recipient, status: 'FAILED', errorMessage: reason, actorUserId: userId });
      return { sent: false, recipient, reason };
    }

    try {
      await EmailService.send(
        recipient,
        `Form 16 (Part B) for ${record.financialYear}`,
        `Dear ${record.employeeName ?? 'colleague'},\n\n`
        + `Your Form 16 Part B for the financial year ${record.financialYear} is available in the employee portal.\n\n`
        + `Gross salary: ${record.grossSalary.toFixed(2)}\n`
        + `Total tax liability: ${record.totalTax.toFixed(2)}\n`
        + `Tax deducted at source: ${record.tdsDeducted.toFixed(2)}\n\n`
        + `${PART_B_BANNER}\n`,
      );
      await this.repo.insertDistribution({ form16Id, channel: 'EMAIL', recipient, status: 'SENT', errorMessage: null, actorUserId: userId });
      await this.master.logAudit({
        entityType: 'FORM16',
        entityId: form16Id,
        employeeId: record.employeeId,
        action: 'EMAIL',
        summary: `Emailed Form 16 ${record.certificateNo ?? form16Id} to ${recipient}`,
        actorUserId: userId,
      });
      return { sent: true, recipient, reason: null };
    } catch (err: any) {
      const reason = err?.message ?? String(err);
      await this.repo.insertDistribution({ form16Id, channel: 'EMAIL', recipient, status: 'FAILED', errorMessage: reason, actorUserId: userId });
      return { sent: false, recipient, reason };
    }
  }

  // =========================================================================
  // Reads
  // =========================================================================

  async list(filters: Form16Filters): Promise<Form16Record[]> {
    return this.repo.findForm16s(filters);
  }

  async get(form16Id: number): Promise<{ record: Form16Record; distributions: Form16Distribution[]; note: string }> {
    const record = await this.requireRecord(form16Id);
    const distributions = await this.repo.findDistributions(form16Id);
    return { record, distributions, note: PART_B_BANNER };
  }

  async getForEmployee(employeeId: number, financialYear?: string): Promise<Form16Record[]> {
    return this.repo.findForm16s({ employeeId, financialYear, limit: 50 });
  }

  private async requireRecord(form16Id: number): Promise<Form16Record> {
    const record = await this.repo.findForm16ById(form16Id);
    if (!record) throw new Error(`Form 16 record ${form16Id} was not found`);
    return record;
  }
}
