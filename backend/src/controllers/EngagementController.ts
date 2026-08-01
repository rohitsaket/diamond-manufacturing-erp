import { Request, Response } from 'express';
import { EngagementService } from '../services/EngagementService';
import { STAFF_ROLES } from '../middleware/auth';

export class EngagementController {
  private service = new EngagementService();

  /**
   * Resolves the caller's own employee id, answering 403 when the login is not
   * linked to an employee record. Returns null once the response is sent.
   */
  private selfEmployeeId(req: Request, res: Response): number | null {
    const employeeId = req.user?.employeeId;
    if (!employeeId) {
      res.status(403).json({ error: 'This account is not linked to an employee record' });
      return null;
    }
    return employeeId;
  }

  private isStaff(req: Request): boolean {
    return STAFF_ROLES.includes(req.user?.role as (typeof STAFF_ROLES)[number]);
  }

  // =========================================================================
  // TASKS
  // =========================================================================
  listTasks = async (req: Request, res: Response): Promise<void> => {
    try {
      const { employeeId, status, limit } = req.query as Record<string, string>;
      const tasks = await this.service.listTasks({
        employeeId: employeeId ? parseInt(employeeId) : undefined,
        status: status || undefined,
        limit: limit ? parseInt(limit) : undefined,
      });
      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  myTasks = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.selfEmployeeId(req, res);
      if (!employeeId) return;
      const { status } = req.query as Record<string, string>;
      const tasks = await this.service.listTasks({ employeeId, status: status || undefined });
      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createTask = async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, description, employeeId, priority, dueDate } = req.body ?? {};
      if (!title) {
        res.status(400).json({ error: 'A task title is required' });
        return;
      }
      if (!employeeId) {
        res.status(400).json({ error: 'An employee is required' });
        return;
      }

      const task = await this.service.createTask(
        { title, description, employeeId: Number(employeeId), priority, dueDate },
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateTaskStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const { status } = req.body ?? {};
      if (!status) {
        res.status(400).json({ error: 'A status is required' });
        return;
      }
      const task = await this.service.updateTaskStatus(id, String(status), req.user!.userId);
      res.json(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // TICKETS
  // =========================================================================
  listTickets = async (req: Request, res: Response): Promise<void> => {
    try {
      const { employeeId, status, limit } = req.query as Record<string, string>;
      const tickets = await this.service.listTickets({
        employeeId: employeeId ? parseInt(employeeId) : undefined,
        status: status || undefined,
        limit: limit ? parseInt(limit) : undefined,
      });
      res.json(tickets);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  myTickets = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.selfEmployeeId(req, res);
      if (!employeeId) return;
      const tickets = await this.service.listTickets({ employeeId });
      res.json(tickets);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      const { subject, description, category, priority } = req.body ?? {};
      if (!subject) {
        res.status(400).json({ error: 'A ticket subject is required' });
        return;
      }

      let employeeId: number | null;
      if (this.isStaff(req)) {
        const raw = req.body?.employeeId ?? req.user!.employeeId;
        employeeId = raw ? Number(raw) : null;
        if (!employeeId) {
          res.status(400).json({ error: 'An employee is required' });
          return;
        }
      } else {
        employeeId = this.selfEmployeeId(req, res);
        if (!employeeId) return;
      }

      const ticket = await this.service.createTicket(
        { employeeId, subject, description, category, priority },
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(ticket);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateTicketStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const { status, resolution } = req.body ?? {};
      if (!status) {
        res.status(400).json({ error: 'A status is required' });
        return;
      }
      const ticket = await this.service.updateTicketStatus(id, String(status), resolution, req.user!.userId);
      res.json(ticket);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // EXPENSE CLAIMS
  // =========================================================================
  listExpenses = async (req: Request, res: Response): Promise<void> => {
    try {
      const { employeeId, status, limit } = req.query as Record<string, string>;
      const expenses = await this.service.listExpenses({
        employeeId: employeeId ? parseInt(employeeId) : undefined,
        status: status || undefined,
        limit: limit ? parseInt(limit) : undefined,
      });
      res.json(expenses);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  myExpenses = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.selfEmployeeId(req, res);
      if (!employeeId) return;
      const expenses = await this.service.listExpenses({ employeeId });
      res.json(expenses);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createExpense = async (req: Request, res: Response): Promise<void> => {
    try {
      const { amount, expenseDate, category, description } = req.body ?? {};
      if (amount === undefined || amount === null || amount === '') {
        res.status(400).json({ error: 'A claim amount is required' });
        return;
      }
      if (!expenseDate) {
        res.status(400).json({ error: 'An expense date is required' });
        return;
      }

      let employeeId: number | null;
      if (this.isStaff(req)) {
        const raw = req.body?.employeeId ?? req.user!.employeeId;
        employeeId = raw ? Number(raw) : null;
        if (!employeeId) {
          res.status(400).json({ error: 'An employee is required' });
          return;
        }
      } else {
        employeeId = this.selfEmployeeId(req, res);
        if (!employeeId) return;
      }

      const expense = await this.service.createExpense(
        { employeeId, amount: Number(amount), expenseDate, category, description },
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(expense);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  decideExpense = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const { status, note } = req.body ?? {};
      if (!status) {
        res.status(400).json({ error: 'A decision status is required' });
        return;
      }
      const expense = await this.service.decideExpense(
        id,
        String(status).toUpperCase() as 'APPROVED' | 'REJECTED' | 'REIMBURSED',
        req.user!.userId,
        note,
      );
      res.json(expense);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // ASSETS
  // =========================================================================
  listAssets = async (req: Request, res: Response): Promise<void> => {
    try {
      const { status, limit } = req.query as Record<string, string>;
      const assets = await this.service.listAssets({
        status: status || undefined,
        limit: limit ? parseInt(limit) : undefined,
      });
      res.json(assets);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  myAssets = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.selfEmployeeId(req, res);
      if (!employeeId) return;
      const assets = await this.service.listAssetsByEmployee(employeeId);
      res.json(assets);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createAsset = async (req: Request, res: Response): Promise<void> => {
    try {
      const { assetCode, name, category, serialNo, purchaseDate, purchaseCost } = req.body ?? {};
      if (!assetCode) {
        res.status(400).json({ error: 'An asset code is required' });
        return;
      }
      if (!name) {
        res.status(400).json({ error: 'An asset name is required' });
        return;
      }
      const asset = await this.service.createAsset(
        { assetCode, name, category, serialNo, purchaseDate, purchaseCost },
        req.user!.userId,
      );
      res.status(201).json(asset);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  assignAsset = async (req: Request, res: Response): Promise<void> => {
    try {
      const assetId = parseInt(req.params.id as string);
      const { employeeId, assignedOn } = req.body ?? {};
      if (!employeeId) {
        res.status(400).json({ error: 'An employee is required' });
        return;
      }
      const result = await this.service.assignAsset(
        assetId,
        Number(employeeId),
        assignedOn,
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  returnAsset = async (req: Request, res: Response): Promise<void> => {
    try {
      const assignmentId = parseInt(req.params.id as string);
      const { returnedOn, conditionNote } = req.body ?? {};
      const asset = await this.service.returnAsset(assignmentId, returnedOn, req.user!.userId, conditionNote);
      res.json(asset);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // ANNOUNCEMENTS
  // =========================================================================
  listAnnouncements = async (req: Request, res: Response): Promise<void> => {
    try {
      const { activeOnly, audience, limit } = req.query as Record<string, string>;
      const announcements = await this.service.listAnnouncements({
        activeOnly: activeOnly === undefined ? true : activeOnly !== 'false',
        audience: audience || undefined,
        limit: limit ? parseInt(limit) : undefined,
      });
      res.json(announcements);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createAnnouncement = async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, body, category, pinned, publishFrom, publishTo, audience, notifyAll } = req.body ?? {};
      if (!title) {
        res.status(400).json({ error: 'An announcement title is required' });
        return;
      }
      if (!body) {
        res.status(400).json({ error: 'Announcement body text is required' });
        return;
      }
      const created = await this.service.createAnnouncement(
        { title, body, category, pinned, publishFrom, publishTo, audience, notifyAll: !!notifyAll },
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateAnnouncement = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const { title, body, category, pinned, publishFrom, publishTo, audience } = req.body ?? {};
      const updated = await this.service.updateAnnouncement(
        id,
        { title, body, category, pinned, publishFrom, publishTo, audience },
        req.user!.userId,
      );
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  removeAnnouncement = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      await this.service.removeAnnouncement(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // COMPANY EVENTS
  // =========================================================================
  listEvents = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to } = req.query as Record<string, string>;
      const events = await this.service.listEvents(from || undefined, to || undefined);
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createEvent = async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, eventType, startAt, endAt, location, description } = req.body ?? {};
      if (!title) {
        res.status(400).json({ error: 'An event title is required' });
        return;
      }
      if (!startAt) {
        res.status(400).json({ error: 'A start date/time is required' });
        return;
      }
      const created = await this.service.createEvent(
        { title, eventType, startAt, endAt, location, description },
        req.user!.userId,
      );
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  removeEvent = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      await this.service.removeEvent(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // TRAININGS
  // =========================================================================
  listTrainings = async (req: Request, res: Response): Promise<void> => {
    try {
      const { status, limit } = req.query as Record<string, string>;
      const trainings = await this.service.listTrainings({
        status: status || undefined,
        limit: limit ? parseInt(limit) : undefined,
      });
      res.json(trainings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  myTrainings = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.selfEmployeeId(req, res);
      if (!employeeId) return;
      const enrollments = await this.service.listEnrollmentsByEmployee(employeeId);
      res.json(enrollments);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createTraining = async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, description, trainer, startDate, endDate } = req.body ?? {};
      if (!title) {
        res.status(400).json({ error: 'A training title is required' });
        return;
      }
      if (!startDate) {
        res.status(400).json({ error: 'A start date is required' });
        return;
      }
      const created = await this.service.createTraining(
        { title, description, trainer, startDate, endDate },
        req.user!.userId,
      );
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateTrainingStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const { status } = req.body ?? {};
      if (!status) {
        res.status(400).json({ error: 'A status is required' });
        return;
      }
      const training = await this.service.updateTrainingStatus(id, String(status), req.user!.userId);
      res.json(training);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  enrollTraining = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const { employeeIds } = req.body ?? {};
      if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
        res.status(400).json({ error: 'employeeIds must be a non-empty array' });
        return;
      }
      const result = await this.service.enroll(
        id,
        employeeIds.map((v: any) => Number(v)),
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  setEnrollmentStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const { employeeId, status, score } = req.body ?? {};
      if (!employeeId) {
        res.status(400).json({ error: 'An employee is required' });
        return;
      }
      if (!status) {
        res.status(400).json({ error: 'A status is required' });
        return;
      }
      const training = await this.service.setEnrollmentStatus(id, Number(employeeId), String(status), score);
      res.json(training);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
