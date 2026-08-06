import { Request, Response } from 'express';
import { ExitSettlementService } from '../services/ExitSettlementService';
import { PerfActionContext } from '../types/performance';

/** Errors that are the caller's fault rather than the server's. */
function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/already exists|cannot be|never overwritten|only a |only DRAFT/i.test(message)) return 409;
  if (/required|must |invalid|unknown|expected/i.test(message)) return 400;
  return 500;
}

/**
 * Full-and-final settlement endpoints: compute, adjust, approval workflow,
 * the statement PDF and the employee's own read-only view.
 */
export class ExitSettlementController {
  private service = new ExitSettlementService();

  compute = async (req: Request, res: Response): Promise<void> => {
    try {
      const separationId = this.readId(req.body?.separationId);
      if (separationId === null) {
        res.status(400).json({ error: 'A numeric separationId is required' });
        return;
      }
      res.status(201).json(await this.service.compute(separationId, this.ctx(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  list = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.list({
        status: req.query.status ? String(req.query.status).toUpperCase() : undefined,
        separationId: req.query.separationId ? Number(req.query.separationId) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  get = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric settlement id is required' });
        return;
      }
      res.json(await this.service.get(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric settlement id is required' });
        return;
      }
      const body = req.body ?? {};
      res.json(await this.service.updateManual(id, {
        bonusPayable: body.bonusPayable === undefined ? undefined : Number(body.bonusPayable),
        otherEarnings: body.otherEarnings === undefined ? undefined : Number(body.otherEarnings),
        otherDeductions: body.otherDeductions === undefined ? undefined : Number(body.otherDeductions),
        notes: body.notes === undefined ? undefined : (body.notes === null ? null : String(body.notes)),
      }, this.ctx(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  submit = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric settlement id is required' });
        return;
      }
      res.json(await this.service.submit(id, this.ctx(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  approve = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric settlement id is required' });
        return;
      }
      res.json(await this.service.approve(id, this.ctx(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  reject = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric settlement id is required' });
        return;
      }
      res.json(await this.service.reject(id, String(req.body?.reason ?? ''), this.ctx(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  markPaid = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric settlement id is required' });
        return;
      }
      res.json(await this.service.markPaid(id, req.body?.paidAt ? String(req.body.paidAt) : undefined, this.ctx(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  statement = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric settlement id is required' });
        return;
      }
      const file = await this.service.generateStatementPdf(id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.send(file.buffer);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  /** ESS: the logged-in employee's own settlement, APPROVED/PAID only. */
  mySettlement = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user?.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: 'This account is not linked to an employee record' });
        return;
      }
      res.json(await this.service.getForEmployee(Number(employeeId)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // ---------------------------------------------------------------------------

  private readId(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || Math.floor(parsed) !== parsed) return null;
    return parsed;
  }

  private ctx(req: Request): PerfActionContext {
    return {
      userId: req.user?.userId ?? 0,
      userRole: req.user?.role ?? 'unknown',
      actorName: req.user?.name,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };
  }
}
