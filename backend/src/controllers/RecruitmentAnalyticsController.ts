import { Request, Response } from 'express';
import { RecruitmentAnalyticsService } from '../services/RecruitmentAnalyticsService';

export class RecruitmentAnalyticsController {
  private analytics = new RecruitmentAnalyticsService();

  private fail(res: Response, err: any): void {
    const code = /unknown report/i.test(err.message ?? '') ? 400 : 500;
    res.status(code).json({ error: err.message });
  }

  dashboard = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.dashboard());
    } catch (err: any) { this.fail(res, err); }
  };

  funnel = async (req: Request, res: Response): Promise<void> => {
    try {
      const jobId = req.query.jobId ? parseInt(String(req.query.jobId)) : undefined;
      res.json(await this.analytics.funnel(jobId));
    } catch (err: any) { this.fail(res, err); }
  };

  departments = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.byDepartment());
    } catch (err: any) { this.fail(res, err); }
  };

  referrals = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.referralAnalytics());
    } catch (err: any) { this.fail(res, err); }
  };

  costSavings = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(this.analytics.costSavings());
    } catch (err: any) { this.fail(res, err); }
  };

  aiInsights = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(this.analytics.aiInsights());
    } catch (err: any) { this.fail(res, err); }
  };

  report = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.report(String(req.params.type)));
    } catch (err: any) { this.fail(res, err); }
  };

  exportReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const type = String(req.params.type);
      const report = await this.analytics.report(type);
      const csv = this.analytics.reportCsv(report);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-report.csv"`);
      res.send(csv);
    } catch (err: any) { this.fail(res, err); }
  };
}
