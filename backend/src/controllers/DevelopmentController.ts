import { Request, Response } from 'express';
import { DevelopmentPlanService } from '../services/DevelopmentPlanService';
import { PipService } from '../services/PipService';
import { PerfActionContext } from '../types/performance';

/** Errors that are the caller's fault rather than the server's. */
function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/already |cannot be|can only|only DRAFT/i.test(message)) return 409;
  if (/required|must |invalid|needs |nothing to update|not linked|does not exist/i.test(message)) return 400;
  return 500;
}

/**
 * Individual development plans and PIPs. PIP endpoints are role-gated to
 * admin/hr/manager in the router; nothing PIP-shaped is reachable from ESS.
 */
export class DevelopmentController {
  private plans = new DevelopmentPlanService();
  private pips = new PipService();

  private ctx(req: Request): PerfActionContext {
    return {
      userId: req.user!.userId,
      userRole: req.user!.role,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };
  }

  private fail(res: Response, err: any): void {
    res.status(statusFor(err.message ?? '')).json({ error: err.message });
  }

  // =========================================================================
  // Development plans
  // =========================================================================

  listPlans = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.plans.list({
        employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
      }));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  getPlan = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.plans.get(Number(req.params.id)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createPlan = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.plans.create(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updatePlan = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.plans.update(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  addPlanItem = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.plans.addItem(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updatePlanItem = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.plans.updateItem(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  deletePlanItem = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.plans.deleteItem(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  myPlan = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: 'This account is not linked to an employee record' });
        return;
      }
      const plan = await this.plans.myPlan(employeeId);
      if (!plan) {
        res.status(404).json({ error: 'No development plan exists for you yet' });
        return;
      }
      res.json(plan);
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // PIPs (confidential; router restricts to admin/hr/manager)
  // =========================================================================

  listPips = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.pips.list({
        status: req.query.status ? String(req.query.status) : undefined,
        employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
      }));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  getPip = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.pips.get(Number(req.params.id)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createPip = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.pips.create(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updatePip = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.pips.update(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  activatePip = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.pips.activate(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updatePipObjective = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.pips.updateObjective(Number(req.params.id), String(req.body?.status ?? ''), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  addPipReview = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.pips.addReview(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  closePip = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.pips.close(Number(req.params.id), req.body?.outcome ?? '', req.body?.note ?? null, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  extendPip = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.pips.extend(Number(req.params.id), req.body?.newEndDate ?? '', req.body?.reason ?? '', this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  escalatePip = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.pips.escalate(Number(req.params.id), req.body?.reason ?? '', this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };
}
