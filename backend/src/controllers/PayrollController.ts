import { Request, Response } from 'express';
import { PayrollService } from '../services/PayrollService';

export class PayrollController {
  private service = new PayrollService();

  getPeriods = async (_req: Request, res: Response): Promise<void> => {
    try {
      const periods = await this.service.getPeriods();
      res.json(periods);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createPeriod = async (req: Request, res: Response): Promise<void> => {
    try {
      const { label, fromDate, toDate } = req.body;
      if (!label || !fromDate || !toDate) {
        res.status(400).json({ error: 'Label, fromDate, and toDate are required' });
        return;
      }
      const period = await this.service.createPeriod({
        label, fromDate, toDate, createdBy: req.user!.userId,
      });
      res.status(201).json(period);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getPeriodLines = async (req: Request, res: Response): Promise<void> => {
    try {
      const periodId = parseInt(req.params.id as string);
      const lines = await this.service.getPeriodLines(periodId);
      res.json(lines);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  lockPeriod = async (req: Request, res: Response): Promise<void> => {
    try {
      const periodId = parseInt(req.params.id as string);
      const period = await this.service.lockPeriod(periodId, req.user!.userId);
      res.json(period);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  markPaid = async (req: Request, res: Response): Promise<void> => {
    try {
      const periodId = parseInt(req.params.id as string);
      const period = await this.service.markPaid(periodId, req.user!.userId);
      res.json(period);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  managerVerify = async (req: Request, res: Response): Promise<void> => {
    try {
      const lineId = parseInt(req.params.id as string);
      const { verify } = req.body;
      if (verify) {
        await this.service.managerVerify(lineId, req.user!.userId);
      } else {
        await this.service.managerUnverify(lineId);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  accountVerify = async (req: Request, res: Response): Promise<void> => {
    try {
      const lineId = parseInt(req.params.id as string);
      const { verify } = req.body;
      if (verify) {
        await this.service.accountVerify(lineId, req.user!.userId);
      } else {
        await this.service.accountUnverify(lineId);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  exportCsv = async (req: Request, res: Response): Promise<void> => {
    try {
      const periodId = parseInt(req.params.id as string);
      const csv = await this.service.exportCsv(periodId);
      const period = await this.service.getPeriods();
      const label = period.find((p) => p.id === periodId)?.label || 'payout';
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="payout-register-${label}.csv"`);
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
