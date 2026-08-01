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

  recalculatePeriod = async (req: Request, res: Response): Promise<void> => {
    try {
      const periodId = parseInt(req.params.id as string);
      const result = await this.service.recalculatePeriod(
        periodId,
        req.user!.userId,
        req.user!.name,
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getCompliance = async (req: Request, res: Response): Promise<void> => {
    try {
      const periodId = parseInt(req.params.id as string);
      const summary = await this.service.getComplianceSummary(periodId);
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getPayslip = async (req: Request, res: Response): Promise<void> => {
    try {
      const lineId = parseInt(req.params.id as string);
      const payslip = await this.service.getPayslip(lineId);
      res.json(payslip);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getMyPayslips = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: 'This account is not linked to an employee record' });
        return;
      }
      const limit = req.query.limit ? parseInt(String(req.query.limit)) : undefined;
      const payslips = await this.service.getMyPayslips(employeeId, limit);
      res.json(payslips);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getMyPayslip = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: 'This account is not linked to an employee record' });
        return;
      }
      const lineId = parseInt(req.params.lineId as string);
      const payslip = await this.service.getMyPayslip(employeeId, lineId);
      res.json(payslip);
    } catch (err: any) {
      // Ownership failure is a permission problem, not a server fault.
      const status = err.message === 'You can only view your own payslips' ? 403 : 500;
      res.status(status).json({ error: err.message });
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
