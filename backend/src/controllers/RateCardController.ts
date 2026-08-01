import { Request, Response } from 'express';
import { RateCardService } from '../services/RateCardService';

export class RateCardController {
  private service = new RateCardService();

  getAll = async (req: Request, res: Response): Promise<void> => {
    try {
      const { shapeCategory } = req.query as Record<string, string>;
      const rates = await this.service.getAll(shapeCategory);
      res.json(rates);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateRate = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const { ratePerCt } = req.body;
      if (!ratePerCt || ratePerCt <= 0) {
        res.status(400).json({ error: 'Invalid rate' });
        return;
      }
      const updated = await this.service.updateRate(
        id,
        parseFloat(ratePerCt),
        req.user!.email,
        req.user!.userId,
      );
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  newVersion = async (req: Request, res: Response): Promise<void> => {
    try {
      const { effectiveFrom } = req.body;
      if (!effectiveFrom) {
        res.status(400).json({ error: 'Effective from date is required' });
        return;
      }
      await this.service.newVersion(
        effectiveFrom,
        req.user!.userId,
        req.user!.email,
      );
      const rates = await this.service.getAll();
      res.status(201).json(rates);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getAuditLogs = async (_req: Request, res: Response): Promise<void> => {
    try {
      const logs = await this.service.getAuditLogs();
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  computeImpact = async (req: Request, res: Response): Promise<void> => {
    try {
      const { rateId, newRate } = req.query;
      if (!rateId || !newRate) {
        res.status(400).json({ error: 'rateId and newRate are required' });
        return;
      }
      const impact = await this.service.computeImpact(
        parseInt(rateId as string),
        parseFloat(newRate as string),
      );
      res.json({ impact });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getLatestEffectiveDate = async (_req: Request, res: Response): Promise<void> => {
    try {
      const date = await this.service.getLatestEffectiveDate();
      res.json({ effectiveFrom: date });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
