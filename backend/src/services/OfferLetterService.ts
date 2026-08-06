import PDFDocument from 'pdfkit';
import { toDateString, todayString } from '../utils/dateUtils';

const TYPE_HEADINGS: Record<string, string> = {
  INTERNAL_TRANSFER: 'INTERNAL TRANSFER LETTER',
  PROMOTION: 'PROMOTION OFFER LETTER',
  SALARY_REVISION: 'SALARY REVISION LETTER',
  GIG_ASSIGNMENT: 'GIG ASSIGNMENT LETTER',
};

const TYPE_OPENINGS: Record<string, string> = {
  INTERNAL_TRANSFER: 'We are pleased to offer you an internal transfer following your application through the internal job portal.',
  PROMOTION: 'We are pleased to offer you a promotion following your application through the internal job portal.',
  SALARY_REVISION: 'This letter records the salary revision recommended for you through the internal mobility process.',
  GIG_ASSIGNMENT: 'We are pleased to confirm your selection for the following internal assignment.',
};

/**
 * Internal offer letters as A4 PDFs in the PerfLetterService document style.
 * Rendered on the fly from the offer row - nothing is written to disk, and
 * the letter is reproducible from its letter number at any time.
 */
export class OfferLetterService {
  private readonly company = 'Harene Diamond Pvt Ltd';

  /** `row` is the joined offer row from OfferRepository.findById. */
  offerLetter(row: any): Promise<Buffer> {
    const heading = TYPE_HEADINGS[row.offer_type] ?? 'INTERNAL OFFER LETTER';
    return this.render(`${heading} ${row.letter_number}`, (doc, layout) => {
      const { left, width } = layout;
      this.letterHead(doc, layout, heading, String(row.letter_number ?? ''));

      doc.fontSize(10).font('Helvetica').fillColor('#000');
      doc.text(`Date: ${todayString()}`, left, doc.y);
      doc.moveDown(1);
      doc.font('Helvetica-Bold').text(`${row.employee_name} (${row.emp_code})`);
      doc.moveDown(1);

      doc.font('Helvetica').text(`Dear ${row.employee_name},`, { width });
      doc.moveDown(0.6);
      doc.text(TYPE_OPENINGS[row.offer_type] ?? TYPE_OPENINGS.INTERNAL_TRANSFER, { width });
      doc.moveDown(1);

      const lines: [string, string][] = [
        ['Position', String(row.title)],
        ['Posting', `${row.job_title} (${row.job_code})`],
      ];
      if (row.offer_type === 'INTERNAL_TRANSFER') {
        lines.push(['New Department', row.to_department_name ?? '-']);
      }
      if (row.offer_type === 'PROMOTION') {
        lines.push(['From Grade', row.employee_grade ?? '-']);
        lines.push(['To Grade', row.to_grade ?? '-']);
      }
      if (row.to_role_name) lines.push(['Role', String(row.to_role_name)]);
      if (row.effective_date) lines.push(['Effective Date', toDateString(row.effective_date)]);
      if (row.valid_until) lines.push(['Offer Valid Until', toDateString(row.valid_until)]);
      if (row.salary_revision_pct !== null && row.salary_revision_pct !== undefined) {
        lines.push(['Recommended Salary Revision', `${Number(row.salary_revision_pct).toFixed(2)}%`]);
      }
      if (row.salary_revision_amount !== null && row.salary_revision_amount !== undefined) {
        lines.push(['Recommended Revision Amount', `Rs. ${Number(row.salary_revision_amount).toLocaleString('en-IN')}`]);
      }
      this.detailBox(doc, layout, lines);

      if (row.terms) {
        doc.moveDown(1);
        doc.font('Helvetica-Bold').fontSize(10).text('Terms', left);
        doc.font('Helvetica').fontSize(9.5).text(String(row.terms), { width });
      }

      if (row.salary_revision_pct !== null || row.salary_revision_amount !== null) {
        doc.moveDown(1);
        doc.fontSize(8.5).fillColor('#555').text(
          'Note: salary figures above are a recommendation from the internal hiring process. '
          + 'The actual revision is processed separately in the payroll module.',
          { width },
        );
        doc.fillColor('#000');
      }

      doc.moveDown(1);
      doc.fontSize(8.5).fillColor('#555').text(
        'Acceptance of this offer is recorded electronically in the HR system with the accepting '
        + 'user, timestamp and IP address. This record is an audit-backed acknowledgement, not a '
        + 'cryptographic digital signature.',
        { width },
      );
      doc.fillColor('#000');

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
