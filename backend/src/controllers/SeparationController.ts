import { Request, Response } from 'express';
import { STAFF_ROLES } from '../middleware/auth';
import { ExitAuditService } from '../services/ExitAuditService';
import { OffboardingActor, SeparationService } from '../services/SeparationService';

/** Errors that are the caller's fault rather than the server's. */
function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/already exists|already been|already .*(submitted|approved|completed|cancelled|withdrawn|revoked)|already has|case already/i.test(message)) return 409;
  if (/your own|not linked to an employee/i.test(message)) return 403;
  if (/required|must |invalid|cannot|only |provide|expects|no updatable|not allowed|unknown/i.test(message)) return 400;
  return 500;
}

/**
 * The separation lifecycle: ESS resignation intake, staff case management,
 * reviews and approval, notice mechanics (early release, buyout, waiver,
 * garden leave), guarded completion, notice rules and the audit trail.
 *
 * Every handler is an arrow-function property so the router can pass it by
 * reference; every failure maps through statusFor into a {error} body.
 */
export class SeparationController {
  private service = new SeparationService();
  private auditService = new ExitAuditService();

  // =========================================================================
  // ESS self-service
  // =========================================================================

  createMyResignation = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.service.createResignation(this.actor(req), req.body ?? {});
      res.status(201).json(result);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  submitMyResignation = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.submitMyResignation(this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  withdrawMyResignation = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.withdrawMyResignation(this.actor(req), String(req.body?.reason ?? '')));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  getMyCase = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.getMyCase(this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Staff case management
  // =========================================================================

  list = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.list({
        status: req.query.status ? String(req.query.status).toUpperCase() : undefined,
        separationType: req.query.separationType ? String(req.query.separationType).toUpperCase() : undefined,
        employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
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
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      res.json(await this.service.get(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  create = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.service.createByStaff(req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      res.json(await this.service.update(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Reviews and decisions
  // =========================================================================

  managerReview = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      res.json(await this.service.managerReview(id, String(req.body?.note ?? ''), this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  hrReview = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      res.json(await this.service.hrReview(id, String(req.body?.note ?? ''), this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  approve = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      res.json(await this.service.approve(id, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  reject = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      res.json(await this.service.reject(id, String(req.body?.reason ?? ''), this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  cancel = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      res.json(await this.service.cancel(id, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Notice management
  // =========================================================================

  updateNotice = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      res.json(await this.service.updateNotice(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  requestEarlyRelease = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      const isStaff = !!req.user && STAFF_ROLES.includes(req.user.role as (typeof STAFF_ROLES)[number]);
      res.json(await this.service.requestEarlyRelease(id, req.body ?? {}, this.actor(req), isStaff));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  decideEarlyRelease = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      if (typeof req.body?.approve !== 'boolean') {
        res.status(400).json({ error: 'approve must be true or false' });
        return;
      }
      res.json(await this.service.decideEarlyRelease(id, req.body.approve, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  buyout = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      res.json(await this.service.buyout(id, Number(req.body?.days), this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  waiveNotice = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      res.json(await this.service.waiveNotice(id, String(req.body?.reason ?? ''), this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  gardenLeave = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      if (typeof req.body?.enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be true or false' });
        return;
      }
      res.json(await this.service.setGardenLeave(id, req.body.enabled, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Completion and rehire flag
  // =========================================================================

  complete = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      res.json(await this.service.complete(id, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  setRehireFlag = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      res.json(await this.service.setRehireFlag(id, {
        rehireEligible: req.body?.rehireEligible,
        note: req.body?.note,
      }, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Notice rules
  // =========================================================================

  listNoticeRules = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.listNoticeRules());
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  createNoticeRule = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.service.createNoticeRule(req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  updateNoticeRule = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric notice rule id is required' });
        return;
      }
      res.json(await this.service.updateNoticeRule(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Audit trail
  // =========================================================================

  listAuditLogs = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.auditService.list({
        entityType: req.query.entityType ? String(req.query.entityType).toUpperCase() : undefined,
        entityId: req.query.entityId ? Number(req.query.entityId) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Internals
  // =========================================================================

  /** A positive integer id, or null when the value is not one. */
  private readId(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || Math.floor(parsed) !== parsed) return null;
    return parsed;
  }

  /** Who is acting, from where - fed to both the services and the audit trail. */
  private actor(req: Request): OffboardingActor {
    return {
      userId: req.user!.userId,
      userRole: req.user!.role,
      actorName: req.user!.name,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
      employeeId: req.user!.employeeId ?? null,
    };
  }
}
