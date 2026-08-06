import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { env } from '../config/env';
import { ExitLetterRepository } from '../repositories/ExitLetterRepository';
import { ExitLetterResponse, ExitLetterType } from '../types/offboarding';
import { PerfActionContext } from '../types/performance';
import { toDateString, todayString } from '../utils/dateUtils';
import { yearsOfService } from '../utils/payrollMath';
import { EmailService } from './EmailService';
import { ExitAuditService } from './ExitAuditService';
import { NotificationService } from './NotificationService';

/**
 * Exit letters: generation guards, A4 PDFs in the PerfLetterService style,
 * QR-backed verification and (optional) email delivery.
 *
 * On verification: the QR encodes {letterNumber, token} where the token is an
 * HMAC-SHA256 over the letter's identity — the same pattern PayslipService
 * uses. That is tamper-evidence, NOT a cryptographic digital signature, and
 * both the PDF caption and the verify payload say so.
 */

const LETTER_PREFIX: Record<ExitLetterType, string> = {
  ACCEPTANCE: 'ACC',
  EXPERIENCE: 'EXP',
  RELIEVING: 'REL',
  RECOMMENDATION: 'REC',
  CLEARANCE_CERT: 'CLR',
};

const POST_APPROVAL_STATUSES = ['APPROVED', 'IN_NOTICE', 'CLEARANCE', 'SETTLEMENT', 'COMPLETED'];

const QR_CAPTION = 'Scan to verify - QR-backed verification, not a cryptographic digital signature';

export class ExitLetterService {
  private repo = new ExitLetterRepository();
  private audit = new ExitAuditService();
  private notifications = new NotificationService();
  private readonly company = 'Harene Diamond Pvt Ltd';

  // ===========================================================================
  // Generate
  // ===========================================================================

  async generate(separationId: number, letterType: string, ctx: PerfActionContext): Promise<ExitLetterResponse> {
    const type = String(letterType ?? '').toUpperCase() as ExitLetterType;
    if (!LETTER_PREFIX[type]) {
      throw new Error(`Unknown letterType "${letterType}"; expected one of ${Object.keys(LETTER_PREFIX).join(', ')}`);
    }

    const sep = await this.repo.findSeparation(separationId);
    if (!sep) throw new Error(`Separation ${separationId} was not found`);

    const status = String(sep.status);
    if (type === 'ACCEPTANCE' || type === 'RECOMMENDATION') {
      if (!POST_APPROVAL_STATUSES.includes(status)) {
        throw new Error(`A ${type} letter cannot be generated while the separation is ${status}; it requires an approved case`);
      }
    } else if (status !== 'COMPLETED') {
      throw new Error(`A ${type} letter cannot be generated while the separation is ${status}; it requires a COMPLETED separation`);
    }

    if (type === 'RELIEVING') {
      // Honest guard: a relieving letter asserts dues are settled. When a
      // settlement exists it must be approved or paid; when none exists the
      // letter can still issue (small units often settle outside the module).
      const settlement = await this.repo.findSettlementForEmployee(Number(sep.employee_id));
      if (settlement && !['APPROVED', 'PAID'].includes(String(settlement.status))) {
        throw new Error(
          `A relieving letter cannot be issued: final settlement ${settlement.id} exists but is ${settlement.status}. `
          + 'It must be APPROVED or PAID first, because the letter asserts dues are settled.',
        );
      }
    }

    const existing = await this.repo.findBySeparationAndType(separationId, type);
    if (existing) {
      throw new Error(`A ${type} letter already exists for this separation (${existing.letter_number})`);
    }

    const placeholder = `PENDING-${separationId}-${type}-${Date.now()}`;
    const id = await this.repo.insertDraft(separationId, type, placeholder, ctx.userId);
    try {
      const letterNumber = `${LETTER_PREFIX[type]}/${new Date().getFullYear()}/${String(id).padStart(4, '0')}`;
      const token = this.hmac(letterNumber, Number(sep.employee_id), type);
      await this.repo.finalizeIssue(id, letterNumber, token);
    } catch (err) {
      await this.repo.deleteRow(id).catch(() => undefined);
      throw err;
    }

    await this.audit.record('EXIT_LETTER', id, 'GENERATE', ctx, null, { separationId, letterType: type });

    // Letter-issued notification; a notification outage never fails the write.
    try {
      const user = await this.repo.findEmployeeUser(Number(sep.employee_id));
      if (user && (user.is_active === 1 || user.is_active === true)) {
        await this.notifications.notify({
          userId: Number(user.id),
          category: 'OFFBOARDING',
          title: `Your ${type.toLowerCase().replace('_', ' ')} letter has been issued`,
          body: 'You can download it from the employee portal.',
        });
      }
    } catch (err) {
      console.error('exit letter notification failed:', err);
    }

    const row = await this.repo.findById(id);
    if (!row) throw new Error('The letter was created but could not be read back');
    return this.toResponse(row);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async list(filters: { separationId?: number; letterType?: string; status?: string; limit?: number }): Promise<ExitLetterResponse[]> {
    const rows = await this.repo.findMany(filters);
    return rows.map((r) => this.toResponse(r));
  }

  /** ESS: the employee's own letters, drafts excluded. */
  async listForEmployee(employeeId: number): Promise<ExitLetterResponse[]> {
    const rows = await this.repo.findMany({ employeeId, limit: 100 });
    return rows.filter((r) => String(r.status) !== 'DRAFT').map((r) => this.toResponse(r));
  }

  // ===========================================================================
  // Verify
  // ===========================================================================

  async verify(letterNumber: string, token: string): Promise<{ valid: boolean; note: string; letter?: { type: string; employeeName: string; issuedAt: string | null } }> {
    const note = QR_CAPTION;
    try {
      if (!letterNumber || !token) return { valid: false, note };
      const row = await this.repo.findByNumber(String(letterNumber));
      if (!row || String(row.status) === 'DRAFT') return { valid: false, note };

      const expected = this.hmac(String(row.letter_number), Number(row.employee_id), String(row.letter_type));
      const a = Buffer.from(String(token), 'utf8');
      const b = Buffer.from(expected, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false, note };

      return {
        valid: true,
        note,
        letter: {
          type: String(row.letter_type),
          employeeName: String(row.full_name ?? ''),
          issuedAt: row.generated_at instanceof Date ? row.generated_at.toISOString() : (row.generated_at ? String(row.generated_at) : null),
        },
      };
    } catch {
      return { valid: false, note };
    }
  }

  // ===========================================================================
  // Email
  // ===========================================================================

  async email(id: number, ctx: PerfActionContext): Promise<{ sent: boolean; recipient: string | null; reason: string | null }> {
    const row = await this.requireRow(id);
    if (String(row.status) === 'DRAFT') throw new Error('A draft letter cannot be emailed');

    const user = await this.repo.findEmployeeUser(Number(row.employee_id));
    const recipient = user?.email ? String(user.email) : null;
    if (!recipient) {
      const reason = 'No email address is on record for this employee';
      await this.repo.recordEmailError(id, reason);
      return { sent: false, recipient: null, reason };
    }
    if (!EmailService.isEnabled()) {
      const reason = 'SMTP is not configured, so nothing was sent';
      await this.repo.recordEmailError(id, reason);
      return { sent: false, recipient, reason };
    }

    try {
      await EmailService.send(
        recipient,
        `${this.letterHeading(String(row.letter_type))} — ${row.letter_number}`,
        `Dear ${row.full_name ?? 'colleague'},\n\n`
        + `Your ${this.letterHeading(String(row.letter_type)).toLowerCase()} (${row.letter_number}) has been issued. `
        + 'You can download the PDF from the employee portal; the QR code on it lets anyone verify the letter against our records.\n',
      );
      await this.repo.markEmailed(id);
      await this.audit.record('EXIT_LETTER', id, 'EMAIL', ctx, null, { recipient });
      return { sent: true, recipient, reason: null };
    } catch (err: any) {
      const reason = err?.message ?? String(err);
      await this.repo.recordEmailError(id, reason);
      return { sent: false, recipient, reason };
    }
  }

  // ===========================================================================
  // PDF
  // ===========================================================================

  async generatePdf(id: number, restrictToEmployeeId?: number): Promise<{ buffer: Buffer; fileName: string }> {
    const row = await this.requireRow(id);
    if (restrictToEmployeeId !== undefined) {
      if (Number(row.employee_id) !== restrictToEmployeeId) throw new Error(`Letter ${id} was not found`);
      if (String(row.status) === 'DRAFT') throw new Error(`Letter ${id} was not found`);
    }

    const qrPayload = JSON.stringify({ letterNumber: row.letter_number, token: row.verify_token });
    const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 0, width: 220 });
    const qrBuffer = Buffer.from(qrDataUrl.split(',')[1] ?? '', 'base64');

    const clearances = String(row.letter_type) === 'CLEARANCE_CERT'
      ? await this.repo.findClearances(Number(row.separation_id))
      : [];
    const rating = String(row.letter_type) === 'RECOMMENDATION'
      ? await this.repo.findLatestFinalizedRating(Number(row.employee_id))
      : null;

    const buffer = await this.render(row, qrBuffer, clearances, rating);
    const safeCode = String(row.emp_code ?? row.employee_id).replace(/[^a-zA-Z0-9._-]/g, '_');
    return { buffer, fileName: `${LETTER_PREFIX[String(row.letter_type) as ExitLetterType]}_${safeCode}_${id}.pdf` };
  }

  private letterHeading(type: string): string {
    switch (type) {
      case 'ACCEPTANCE': return 'Resignation Acceptance Letter';
      case 'EXPERIENCE': return 'Experience Certificate';
      case 'RELIEVING': return 'Relieving Letter';
      case 'RECOMMENDATION': return 'Letter of Recommendation';
      case 'CLEARANCE_CERT': return 'Clearance Certificate';
      default: return 'Letter';
    }
  }

  private render(
    row: any,
    qrBuffer: Buffer,
    clearances: any[],
    rating: { finalRating: number; cycleName: string | null } | null,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 40,
          info: { Title: `${this.letterHeading(String(row.letter_type))} ${row.letter_number}`, Author: this.company },
        });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const left = 40;
        const right = 555;
        const width = 515;

        // --- letterhead (PerfLetterService style) ------------------------------
        doc.fontSize(18).font('Helvetica-Bold').text(this.company, left, 40, { width, align: 'center' });
        doc.fontSize(8).font('Helvetica').fillColor('#666').text('Surat, Gujarat, India', { width, align: 'center' });
        doc.moveTo(left, doc.y + 8).lineTo(right, doc.y + 8).stroke();
        doc.moveDown(1.5);
        doc.fillColor('#000').fontSize(12).font('Helvetica-Bold')
          .text(this.letterHeading(String(row.letter_type)).toUpperCase(), left, doc.y, { width, align: 'center' });
        doc.fontSize(9).font('Helvetica').fillColor('#444')
          .text(`Letter No: ${row.letter_number}`, { width, align: 'center' });
        doc.fillColor('#000');
        doc.moveDown(1.5);

        doc.fontSize(10).font('Helvetica').text(`Date: ${todayString()}`, left, doc.y);
        doc.moveDown(1);

        const name = String(row.full_name ?? '');
        const empCode = String(row.emp_code ?? row.employee_id);
        const joined = row.joined_at ? toDateString(row.joined_at) : null;
        const lwd = row.last_working_day ? toDateString(row.last_working_day) : null;
        const tenureYears = joined && lwd ? yearsOfService(joined, lwd) : null;
        const tenureLine = joined && lwd
          ? `from ${joined} to ${lwd} (${tenureYears} years)`
          : 'for the period on record';

        const body = (text: string) => {
          doc.fontSize(10).font('Helvetica').fillColor('#000').text(text, left, doc.y, { width, lineGap: 2 });
          doc.moveDown(0.8);
        };

        switch (String(row.letter_type)) {
          case 'EXPERIENCE': {
            body('TO WHOMSOEVER IT MAY CONCERN');
            body(
              `This is to certify that ${name} (Employee Code: ${empCode}) was employed with ${this.company} ${tenureLine}, `
              + `most recently in grade ${row.grade ?? '-'}${row.department_name ? ` in the ${row.department_name} department` : ''}.`,
            );
            body('During their tenure, their conduct and performance of duties were found to be satisfactory and professional.');
            body('We wish them success in their future endeavours.');
            break;
          }
          case 'RELIEVING': {
            body(`Dear ${name},`);
            body(
              `This is to confirm that you have been relieved from the services of ${this.company} at the close of business on `
              + `${lwd ?? 'your last working day'}, following the acceptance of your ${String(row.separation_type).toLowerCase().replace(/_/g, ' ')}.`,
            );
            body('Your handover has been recorded as complete and there are no duties pending against your name.');
            body('We thank you for your contribution and wish you well.');
            break;
          }
          case 'ACCEPTANCE': {
            body(`Dear ${name},`);
            body(
              `We acknowledge and accept your resignation${row.resignation_date ? ` dated ${toDateString(row.resignation_date)}` : ''}.`,
            );
            body(
              `Your notice period of ${row.notice_days ?? '-'} day(s) runs`
              + `${row.notice_start ? ` from ${toDateString(row.notice_start)}` : ''}`
              + `${row.notice_end ? ` to ${toDateString(row.notice_end)}` : ''}, and your last working day is ${lwd ?? 'to be confirmed'}.`,
            );
            body('Please coordinate with HR for clearances, asset returns and handover during the notice period.');
            break;
          }
          case 'RECOMMENDATION': {
            body('TO WHOMSOEVER IT MAY CONCERN');
            body(
              `It is my pleasure to recommend ${name} (Employee Code: ${empCode}), who served ${this.company} ${tenureLine} `
              + `in grade ${row.grade ?? '-'}.`,
            );
            if (rating) {
              // Printed only because a finalized appraisal exists on record.
              body(
                `In their most recent finalized appraisal${rating.cycleName ? ` (${rating.cycleName})` : ''}, they achieved a rating of `
                + `${rating.finalRating.toFixed(2)} out of 5.00.`,
              );
            }
            body('They proved to be a dependable and skilled colleague, and I am confident they will be an asset to any organisation they join.');
            break;
          }
          case 'CLEARANCE_CERT': {
            body(`This certifies the departmental clearance status recorded for ${name} (Employee Code: ${empCode}) on separation ${row.sep_code}.`);
            if (clearances.length === 0) {
              body('No departmental clearance rows are on record for this separation.');
            } else {
              const top = doc.y;
              const rowHeight = 18;
              const boxHeight = clearances.length * rowHeight + 26;
              doc.rect(left, top, width, boxHeight).fillAndStroke('#f2f4f7', '#999');
              doc.fillColor('#000').fontSize(9).font('Helvetica-Bold');
              doc.text('Department', left + 12, top + 8, { width: 140 });
              doc.text('Status', left + 170, top + 8, { width: 100 });
              doc.text('Cleared on', left + 290, top + 8, { width: 180 });
              let y = top + 26;
              doc.font('Helvetica').fontSize(9);
              for (const c of clearances) {
                doc.text(String(c.department), left + 12, y, { width: 140 });
                doc.text(String(c.status), left + 170, y, { width: 100 });
                doc.text(c.cleared_at ? toDateString(c.cleared_at) : '-', left + 290, y, { width: 180 });
                y += rowHeight;
              }
              doc.y = top + boxHeight + 10;
            }
            break;
          }
          default:
            body('Letter content unavailable.');
        }

        // --- signature -----------------------------------------------------------
        doc.moveDown(2);
        doc.fontSize(10).font('Helvetica').text(`For ${this.company},`, left);
        doc.moveDown(2.5);
        doc.font('Helvetica-Bold').text('Authorised Signatory', left);

        // --- QR verification block -------------------------------------------------
        const qrY = 660;
        try {
          doc.image(qrBuffer, right - 90, qrY, { width: 80, height: 80 });
        } catch {
          // A QR that failed to encode must never block the letter itself.
        }
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text('Verify this letter', left, qrY + 10, { width: width - 120 });
        doc.fontSize(7.5).font('Helvetica').fillColor('#444')
          .text(QR_CAPTION, left, qrY + 22, { width: width - 120 });
        doc.fontSize(7).fillColor('#666')
          .text(
            `The QR encodes the letter number and a keyed token; POST them to ${env.company.appUrl.replace(/\/$/, '')} `
            + 'exit letter verification to confirm this letter against the HR record.',
            left, qrY + 42, { width: width - 120 },
          );

        doc.fontSize(7).fillColor('#666').text(
          'This is a computer generated letter; the letter number above can be verified against the HR record.',
          left, 780, { width, align: 'center' },
        );
        doc.fillColor('#000');
        doc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private hmac(letterNumber: string, employeeId: number, letterType: string): string {
    return crypto
      .createHmac('sha256', env.jwt.secret)
      .update(`${letterNumber}|${employeeId}|${letterType}`)
      .digest('hex');
  }

  private async requireRow(id: number): Promise<any> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error(`Letter ${id} was not found`);
    return row;
  }

  private toResponse(row: any): ExitLetterResponse & { empCode?: string | null; sepCode?: string | null; separationStatus?: string | null } {
    return {
      id: Number(row.id),
      separationId: Number(row.separation_id),
      employeeName: row.full_name ?? null,
      letterType: String(row.letter_type) as ExitLetterType,
      letterNumber: String(row.letter_number),
      status: String(row.status) as ExitLetterResponse['status'],
      generatedAt: row.generated_at instanceof Date ? row.generated_at.toISOString() : (row.generated_at ? String(row.generated_at) : null),
      emailedAt: row.emailed_at instanceof Date ? row.emailed_at.toISOString() : (row.emailed_at ? String(row.emailed_at) : null),
      emailError: row.email_error ?? null,
      empCode: row.emp_code ?? null,
      sepCode: row.sep_code ?? null,
      separationStatus: row.separation_status ?? null,
    };
  }
}
