import { Request, Response } from 'express';
import { CareerService } from '../services/CareerService';
import { PerfActionContext } from '../types/performance';

function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/must be|required|invalid/i.test(message)) return 400;
  return 500;
}

export class CareerController {
  private career = new CareerService();

  private ctx(req: Request): PerfActionContext {
    return {
      userId: req.user!.userId,
      userRole: req.user!.role,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    };
  }

  private fail(res: Response, err: any): void {
    res.status(statusFor(err.message ?? '')).json({ error: err.message });
  }

  getInterests = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.career.getInterests(parseInt(req.params.employeeId as string)));
    } catch (err: any) { this.fail(res, err); }
  };

  saveInterests = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.career.saveInterests(
        parseInt(req.params.employeeId as string),
        req.body ?? {},
        this.ctx(req),
      ));
    } catch (err: any) { this.fail(res, err); }
  };

  myDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(400).json({ error: 'This account is not linked to an employee record' });
        return;
      }
      res.json(await this.career.myDashboard(employeeId));
    } catch (err: any) { this.fail(res, err); }
  };

  roadmaps = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.career.allRoadmaps());
    } catch (err: any) { this.fail(res, err); }
  };
}
