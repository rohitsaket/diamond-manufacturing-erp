import { LotRepository } from '../repositories/LotRepository';
import { LotFilterParams } from '../types';
import { generateCsv } from '../utils/csv';

export class LedgerService {
  private lotRepo = new LotRepository();

  async getLots(params: LotFilterParams) {
    return this.lotRepo.findAll(params);
  }

  async exportCsv(params: LotFilterParams): Promise<string> {
    params.limit = 10000;
    params.page = 1;
    const { rows } = await this.lotRepo.findAll(params);

    const headers = [
      'Lot Name', 'Lot ID', 'Worker', 'Shape', 'Qty', 'Issue Wt (ct)',
      'Est Wt (ct)', 'Polished Wt (ct)', 'Issue Date', 'Received Date',
      'Days', 'Color', 'Clarity', 'Cut', 'Lab', 'Labour Head',
      'Labour Amount (₹)', 'Weight Diff (ct)', 'Status',
    ];

    const data = rows.map((r) => [
      r.lotName, r.lotId, r.employeeName, r.shape, r.qty, r.issueWeight,
      r.estimateWt, r.polishedWt ?? '', r.issueDate, r.receivedDate ?? '',
      r.daysConsumed ?? '', r.color ?? '', r.clarity ?? '', r.cut ?? '',
      r.lab ?? '', r.labourHead, r.labourAmount ?? '', r.weightDiff ?? '', r.status,
    ]);

    return generateCsv(headers, data);
  }
}
