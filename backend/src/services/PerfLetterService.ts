import PDFDocument from 'pdfkit';
import { toDateString, todayString } from '../utils/dateUtils';
import { ratingLabelFor } from './AppraisalService';

/**
 * Appraisal and promotion letters as A4 PDFs, rendered on the fly in the
 * PayslipService document style (Helvetica, ruled header, footer note).
 * Nothing is written to disk: the letter number lives on the record and the
 * PDF is reproducible from it at any time.
 */
export class PerfLetterService {
  private readonly company = 'Harene Diamond Pvt Ltd';

  /** `row` is the joined appraisal row (employee + cycle names included). */
  appraisalLetter(row: any): Promise<Buffer> {
    return this.render(`Appraisal Letter ${row.letter_number}`, (doc, layout) => {
      const { left, width } = layout;
      this.letterHead(doc, layout, 'PERFORMANCE APPRAISAL LETTER', String(row.letter_number ?? ''));

      doc.fontSize(10).font('Helvetica').fillColor('#000');
      doc.text(`Date: ${todayString()}`, left, doc.y);
      doc.moveDown(1);
      doc.font('Helvetica-Bold').text(`${row.employee_name} (${row.emp_code})`);
      doc.font('Helvetica').text(`Grade: ${row.grade ?? '-'}`);
      doc.moveDown(1);

      doc.text(`Dear ${row.employee_name},`, { width });
      doc.moveDown(0.6);
      doc.text(
        `This letter records the outcome of your performance appraisal for ${row.cycle_name}`
        + `${row.financial_year ? ` (FY ${row.financial_year})` : ''}.`,
        { width },
      );
      doc.moveDown(1);

      const finalRating = row.final_rating === null ? null : Number(row.final_rating);
      const label = row.rating_label ?? (finalRating !== null ? ratingLabelFor(finalRating) : '-');
      const lines: [string, string][] = [
        ['Final Rating', finalRating !== null ? `${finalRating.toFixed(2)} / 5.00` : '-'],
        ['Rating Band', String(label)],
      ];
      if (row.total_score !== null && row.total_score !== undefined) {
        lines.push(['Overall Score', `${Number(row.total_score).toFixed(2)} / 100`]);
      }
      if (row.salary_increase_pct !== null && row.salary_increase_pct !== undefined) {
        lines.push(['Recommended Salary Increase', `${Number(row.salary_increase_pct).toFixed(2)}%`]);
      }
      if (row.promotion_recommended) {
        lines.push(['Promotion', 'Recommended for consideration']);
      }
      this.detailBox(doc, layout, lines);

      if (row.remarks) {
        doc.moveDown(1);
        doc.font('Helvetica-Bold').fontSize(10).text('Remarks', left);
        doc.font('Helvetica').fontSize(9.5).text(String(row.remarks), { width });
      }

      if (row.salary_increase_pct !== null && row.salary_increase_pct !== undefined) {
        doc.moveDown(1);
        doc.fontSize(8.5).fillColor('#555').text(
          'Note: the salary increase above is a recommendation from the appraisal process. '
          + 'The actual revision is processed separately in the payroll module.',
          { width },
        );
        doc.fillColor('#000');
      }

      this.signatureAndFooter(doc, layout);
    });
  }

  /** `row` is the joined promotion row (employee + role names included). */
  promotionLetter(row: any): Promise<Buffer> {
    return this.render(`Promotion Letter ${row.letter_number}`, (doc, layout) => {
      const { left, width } = layout;
      this.letterHead(doc, layout, 'PROMOTION LETTER', String(row.letter_number ?? ''));

      doc.fontSize(10).font('Helvetica').fillColor('#000');
      doc.text(`Date: ${todayString()}`, left, doc.y);
      doc.moveDown(1);
      doc.font('Helvetica-Bold').text(`${row.employee_name} (${row.emp_code})`);
      doc.moveDown(1);

      doc.font('Helvetica').text(`Dear ${row.employee_name},`, { width });
      doc.moveDown(0.6);
      doc.text(
        'We are pleased to confirm your promotion in recognition of your performance and contribution.',
        { width },
      );
      doc.moveDown(1);

      const lines: [string, string][] = [
        ['From Grade', row.from_grade ?? '-'],
        ['To Grade', row.to_grade ?? '-'],
      ];
      if (row.from_role_name || row.to_role_name) {
        lines.push(['Role', `${row.from_role_name ?? '-'}  →  ${row.to_role_name ?? '-'}`]);
      }
      if (row.effective_date) lines.push(['Effective Date', toDateString(row.effective_date)]);
      if (row.salary_impact_pct !== null && row.salary_impact_pct !== undefined) {
        lines.push(['Salary Impact', `${Number(row.salary_impact_pct).toFixed(2)}%`]);
      }
      this.detailBox(doc, layout, lines);

      if (row.justification) {
        doc.moveDown(1);
        doc.font('Helvetica-Bold').fontSize(10).text('Citation', left);
        doc.font('Helvetica').fontSize(9.5).text(String(row.justification), { width });
      }

      doc.moveDown(1);
      doc.fontSize(9.5).text('We congratulate you and wish you continued success in your new grade.', { width });

      this.signatureAndFooter(doc, layout);
    });
  }

  // ---------------------------------------------------------------------------

  private render(
    title: string,
    body: (doc: PDFKit.PDFDocument, layout: { left: number; right: number; width: number }) => void,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: title, Author: this.company } });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        body(doc, { left: 40, right: 555, width: 515 });
        doc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private letterHead(
    doc: PDFKit.PDFDocument,
    layout: { left: number; right: number; width: number },
    heading: string,
    letterNumber: string,
  ): void {
    const { left, right, width } = layout;
    doc.fontSize(18).font('Helvetica-Bold').text(this.company, left, 40, { width, align: 'center' });
    doc.fontSize(8).font('Helvetica').fillColor('#666')
      .text('Surat, Gujarat, India', { width, align: 'center' });
    doc.moveTo(left, doc.y + 8).lineTo(right, doc.y + 8).stroke();
    doc.moveDown(1.5);
    doc.fillColor('#000').fontSize(12).font('Helvetica-Bold').text(heading, left, doc.y, { width, align: 'center' });
    doc.fontSize(9).font('Helvetica').fillColor('#444')
      .text(`Letter No: ${letterNumber}`, { width, align: 'center' });
    doc.fillColor('#000');
    doc.moveDown(1.5);
  }

  private detailBox(
    doc: PDFKit.PDFDocument,
    layout: { left: number; right: number; width: number },
    lines: [string, string][],
  ): void {
    const { left, width } = layout;
    const rowHeight = 20;
    const top = doc.y;
    const boxHeight = lines.length * rowHeight + 12;
    doc.rect(left, top, width, boxHeight).fillAndStroke('#f2f4f7', '#999');
    doc.fillColor('#000');
    let y = top + 8;
    for (const [label, value] of lines) {
      doc.fontSize(9).font('Helvetica').fillColor('#555').text(label, left + 12, y, { width: 200 });
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#000').text(value, left + 220, y, { width: width - 235 });
      y += rowHeight;
    }
    doc.y = top + boxHeight + 4;
  }

  private signatureAndFooter(doc: PDFKit.PDFDocument, layout: { left: number; right: number; width: number }): void {
    const { left, width } = layout;
    doc.moveDown(3);
    doc.fontSize(10).font('Helvetica').text('For ' + this.company + ',', left);
    doc.moveDown(2.5);
    doc.font('Helvetica-Bold').text('Authorised Signatory', left);
    doc.fontSize(7).font('Helvetica').fillColor('#666').text(
      'This is a computer generated letter; the letter number above can be verified against the HR record.',
      left,
      780,
      { width, align: 'center' },
    );
    doc.fillColor('#000');
  }
}
