import { Request, Response } from 'express';
import { LedgerService } from '../services/LedgerService';

export class LedgerController {
  private service = new LedgerService();

  getLots = async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, status, lab, sort, order, page, limit } = req.query as Record<string, string>;
      const result = await this.service.getLots({
        search,
        status: status as any,
        lab: lab as any,
        sort,
        order: order as 'asc' | 'desc',
        page: page ? parseInt(page) : 1,
        limit: limit ? parseInt(limit) : 100,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  exportCsv = async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, status, lab } = req.query as Record<string, string>;
      const csv = await this.service.exportCsv({
        search,
        status: status as any,
        lab: lab as any,
        limit: 10000,
        page: 1,
      });
      const date = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="master-ledger-${date}.csv"`);
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
