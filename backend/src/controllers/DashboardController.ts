import { Request, Response } from 'express';
import { DashboardService } from '../services/DashboardService';

export class DashboardController {
  private service = new DashboardService();

  getKpis = async (_req: Request, res: Response): Promise<void> => {
    try {
      const kpis = await this.service.getKpis();
      res.json(kpis);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getYieldTrend = async (_req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.service.getYieldTrend();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getCaratFlow = async (_req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.service.getCaratFlow();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getStatusDistribution = async (_req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.service.getStatusDistribution();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getLeaderboard = async (_req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.service.getLeaderboard();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
