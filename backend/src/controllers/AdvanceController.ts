import { Request, Response } from 'express';
import { AdvanceService } from '../services/AdvanceService';
import { AdvanceFilters } from '../repositories/AdvanceRepository';

const NOT_LINKED = 'This account is not linked to an employee record';

export class AdvanceController {
  private service = new AdvanceService();

  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const { employeeId, status } = req.query as Record<string, string>;
      const filters: AdvanceFilters = {};
      if (employeeId) filters.employeeId = parseInt(employeeId);
      if (status) filters.status = status;

      const advances = await this.service.list(filters);
      res.json(advances);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'A valid advance id is required' });
        return;
      }
      const advance = await this.service.getById(id);
      if (!advance) {
        res.status(404).json({ error: 'Advance not found' });
        return;
      }
      const recoveries = await this.service.getRecoveries(id);
      res.json({ advance, recoveries });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getSchedule = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'A valid advance id is required' });
        return;
      }
      const schedule = await this.service.getSchedulePreview(id);
      res.json(schedule);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const { employeeId, advanceType, amount, advanceDate, reason, installmentAmount } = req.body ?? {};
      if (!employeeId) {
        res.status(400).json({ error: 'employeeId is required' });
        return;
      }
      if (amount === undefined || amount === null || amount === '') {
        res.status(400).json({ error: 'amount is required' });
        return;
      }
      if (installmentAmount === undefined || installmentAmount === null || installmentAmount === '') {
        res.status(400).json({ error: 'installmentAmount is required' });
        return;
      }

      const advance = await this.service.create(
        {
          employeeId: parseInt(String(employeeId)),
          advanceType,
          amount: Number(amount),
          advanceDate,
          reason: reason ?? null,
          installmentAmount: Number(installmentAmount),
        },
        req.user!.userId,
      );
      res.status(201).json(advance);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  close = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'A valid advance id is required' });
        return;
      }
      const advance = await this.service.close(id, req.user!.userId);
      res.json(advance);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  writeOff = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'A valid advance id is required' });
        return;
      }
      const advance = await this.service.writeOff(id, req.user!.userId);
      res.json(advance);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  addRecovery = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'A valid advance id is required' });
        return;
      }
      const { amount, recoveredOn, remarks } = req.body ?? {};
      if (amount === undefined || amount === null || amount === '') {
        res.status(400).json({ error: 'amount is required' });
        return;
      }

      const result = await this.service.addManualRecovery(
        id,
        Number(amount),
        recoveredOn ? String(recoveredOn) : '',
        req.user!.userId,
        remarks ?? null,
      );
      res.status(201).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  myAdvances = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: NOT_LINKED });
        return;
      }
      const { status } = req.query as Record<string, string>;
      const filters: AdvanceFilters = { employeeId };
      if (status) filters.status = status;

      const advances = await this.service.list(filters);
      res.json(advances);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
