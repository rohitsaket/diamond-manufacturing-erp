import { Request, Response } from 'express';
import { LeaveService } from '../services/LeaveService';
import { LeaveRequestFilters } from '../repositories/LeaveRepository';

const NOT_LINKED = 'This account is not linked to an employee record';

export class LeaveController {
  private service = new LeaveService();

  // -------------------------------------------------------------------------
  // Leave types
  // -------------------------------------------------------------------------
  listTypes = async (_req: Request, res: Response): Promise<void> => {
    try {
      const types = await this.service.getTypes();
      res.json(types);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createType = async (req: Request, res: Response): Promise<void> => {
    try {
      const { code, name, annualQuota, isPaid, color } = req.body ?? {};
      if (!code || !String(code).trim()) {
        res.status(400).json({ error: 'A leave type code is required' });
        return;
      }
      if (!name || !String(name).trim()) {
        res.status(400).json({ error: 'A leave type name is required' });
        return;
      }
      const type = await this.service.createType(
        { code, name, annualQuota, isPaid, color },
        req.user!.userId,
      );
      res.status(201).json(type);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateType = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'A valid leave type id is required' });
        return;
      }
      const { code, name, annualQuota, isPaid, color } = req.body ?? {};
      const type = await this.service.updateType(
        id,
        { code, name, annualQuota, isPaid, color },
        req.user!.userId,
      );
      res.json(type);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteType = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'A valid leave type id is required' });
        return;
      }
      await this.service.deleteType(id, req.user!.userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // -------------------------------------------------------------------------
  // Balances
  // -------------------------------------------------------------------------
  getBalances = async (req: Request, res: Response): Promise<void> => {
    try {
      const { year, employeeId } = req.query as Record<string, string>;
      const resolvedYear = year ? parseInt(year) : new Date().getUTCFullYear();
      if (Number.isNaN(resolvedYear)) {
        res.status(400).json({ error: 'year must be a four-digit number' });
        return;
      }
      const balances = await this.service.getBalances(
        resolvedYear,
        employeeId ? parseInt(employeeId) : undefined,
      );
      res.json(balances);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  initBalances = async (req: Request, res: Response): Promise<void> => {
    try {
      const year = parseInt(String(req.body?.year ?? ''));
      if (Number.isNaN(year)) {
        res.status(400).json({ error: 'A four-digit year is required' });
        return;
      }
      const result = await this.service.initYear(year, req.user!.userId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // -------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------
  listRequests = async (req: Request, res: Response): Promise<void> => {
    try {
      const { status, employeeId, from, to, limit } = req.query as Record<string, string>;
      const filters: LeaveRequestFilters = {};
      if (status) filters.status = status;
      if (employeeId) filters.employeeId = parseInt(employeeId);
      if (from) filters.from = from;
      if (to) filters.to = to;
      if (limit) filters.limit = parseInt(limit);

      const requests = await this.service.listRequests(filters);
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const { employeeId, leaveTypeId, fromDate, toDate, reason } = req.body ?? {};
      if (!employeeId) {
        res.status(400).json({ error: 'employeeId is required' });
        return;
      }
      if (!leaveTypeId) {
        res.status(400).json({ error: 'leaveTypeId is required' });
        return;
      }
      if (!fromDate || !toDate) {
        res.status(400).json({ error: 'fromDate and toDate are required' });
        return;
      }

      const request = await this.service.createRequest(
        {
          employeeId: parseInt(String(employeeId)),
          leaveTypeId: parseInt(String(leaveTypeId)),
          fromDate: String(fromDate),
          toDate: String(toDate),
          reason: reason ?? null,
          appliedBySelf: false,
        },
        req.user!.userId,
      );
      res.status(201).json(request);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  approveRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'A valid request id is required' });
        return;
      }
      const request = await this.service.approve(
        id,
        req.user!.userId,
        req.user!.name,
        req.body?.note ?? null,
      );
      res.json(request);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  rejectRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'A valid request id is required' });
        return;
      }
      const note = String(req.body?.note ?? '').trim();
      if (!note) {
        res.status(400).json({ error: 'A rejection note is required' });
        return;
      }
      const request = await this.service.reject(id, req.user!.userId, req.user!.name, note);
      res.json(request);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  cancelRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'A valid request id is required' });
        return;
      }
      const request = await this.service.cancel(id, req.user!.userId);
      res.json(request);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // -------------------------------------------------------------------------
  // Self-service
  // -------------------------------------------------------------------------
  myRequests = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: NOT_LINKED });
        return;
      }
      const { status, from, to } = req.query as Record<string, string>;
      const filters: LeaveRequestFilters = { employeeId };
      if (status) filters.status = status;
      if (from) filters.from = from;
      if (to) filters.to = to;

      const requests = await this.service.listRequests(filters);
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  myBalances = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: NOT_LINKED });
        return;
      }
      const { year } = req.query as Record<string, string>;
      const resolvedYear = year ? parseInt(year) : new Date().getUTCFullYear();
      if (Number.isNaN(resolvedYear)) {
        res.status(400).json({ error: 'year must be a four-digit number' });
        return;
      }
      const balances = await this.service.getBalances(resolvedYear, employeeId);
      res.json(balances);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createMyRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: NOT_LINKED });
        return;
      }
      const { leaveTypeId, fromDate, toDate, reason } = req.body ?? {};
      if (!leaveTypeId) {
        res.status(400).json({ error: 'leaveTypeId is required' });
        return;
      }
      if (!fromDate || !toDate) {
        res.status(400).json({ error: 'fromDate and toDate are required' });
        return;
      }

      const request = await this.service.createRequest(
        {
          employeeId,
          leaveTypeId: parseInt(String(leaveTypeId)),
          fromDate: String(fromDate),
          toDate: String(toDate),
          reason: reason ?? null,
          appliedBySelf: true,
        },
        req.user!.userId,
      );
      res.status(201).json(request);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
