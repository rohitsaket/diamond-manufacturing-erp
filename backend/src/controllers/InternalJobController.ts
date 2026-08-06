import { Request, Response } from 'express';
import { RequisitionService } from '../services/RequisitionService';
import { InternalJobService, JobCaller } from '../services/InternalJobService';
import { RecruitmentAuditService } from '../services/RecruitmentAuditService';
import { PerfActionContext } from '../types/performance';

/** Errors that are the caller's fault rather than the server's. */
function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/already|cannot be|can only|only .* can|do not meet/i.test(message)) return 409;
  if (/required|must |invalid|unknown|expected|not linked|cannot refer|provide exactly/i.test(message)) return 400;
  return 500;
}

/**
 * Requisitions, internal job postings, templates and the employee portal
 * (browse / featured / recent / recommended / saved). Every handler is an
 * arrow-function property so the router can pass it by reference.
 */
export class InternalJobController {
  private requisitions = new RequisitionService();
  private jobs = new InternalJobService();
  private audit = new RecruitmentAuditService();

  private ctx(req: Request): PerfActionContext {
    return {
      userId: req.user!.userId,
      userRole: req.user!.role,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    };
  }

  private caller(req: Request): JobCaller {
    return {
      userId: req.user!.userId,
      role: req.user!.role,
      employeeId: req.user!.employeeId ?? null,
    };
  }

  private fail(res: Response, err: any): void {
    res.status(statusFor(err.message ?? '')).json({ error: err.message });
  }

  // =========================================================================
  // Requisitions
  // =========================================================================

  listRequisitions = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requisitions.list({
        status: req.query.status ? String(req.query.status) : undefined,
        departmentId: req.query.departmentId ? Number(req.query.departmentId) : undefined,
      }));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  requisitionVacancies = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requisitions.vacancies());
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  getRequisition = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requisitions.getById(Number(req.params.id)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createRequisition = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.requisitions.create(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateRequisition = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requisitions.update(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  submitRequisition = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requisitions.submit(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  approveRequisition = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requisitions.approve(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  rejectRequisition = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requisitions.reject(Number(req.params.id), req.body?.reason ?? null, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  cancelRequisition = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requisitions.cancel(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  budgetApproveRequisition = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requisitions.budgetApprove(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // Jobs (staff)
  // =========================================================================

  listJobs = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.list({
        status: req.query.status ? String(req.query.status) : undefined,
        departmentId: req.query.departmentId ? Number(req.query.departmentId) : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
        workMode: req.query.workMode ? String(req.query.workMode) : undefined,
        employmentType: req.query.employmentType ? String(req.query.employmentType) : undefined,
      }));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  getJob = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.getById(Number(req.params.id)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createJob = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.jobs.create(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateJob = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.update(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  submitJob = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.submit(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  approveJob = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.approve(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  publishJob = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.publish(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  pauseJob = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.pause(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  resumeJob = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.resume(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  archiveJob = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.archive(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  cancelJob = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.cancel(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  fillJob = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.fill(Number(req.params.id), this.ctx(req), this.requisitions));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // Templates
  // =========================================================================

  listTemplates = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.listTemplates());
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createTemplate = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.jobs.createTemplate(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateTemplate = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.updateTemplate(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createJobFromTemplate = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.jobs.createFromTemplate(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // Portal
  // =========================================================================

  portalJobs = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.portalJobs(this.caller(req), {
        search: req.query.search ? String(req.query.search) : undefined,
        category: req.query.category ? String(req.query.category) : undefined,
        departmentId: req.query.departmentId ? Number(req.query.departmentId) : undefined,
        workMode: req.query.workMode ? String(req.query.workMode) : undefined,
        employmentType: req.query.employmentType ? String(req.query.employmentType) : undefined,
        featured: req.query.featured === 'true',
        // sort=recent is the only order the portal serves; declared for API clarity.
      }));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  portalFeatured = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.portalFeatured(this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  portalRecent = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.portalRecent(this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  portalRecommended = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.portalRecommended(this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  portalJobDetail = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.portalJobDetail(Number(req.params.id), this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  saveJob = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.saveJob(Number(req.params.id), this.caller(req), !!req.body?.favorite));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  unsaveJob = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.unsaveJob(Number(req.params.id), this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  listSaved = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.jobs.listSaved(this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // Audit
  // =========================================================================

  listAuditLogs = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.audit.list({
        entityType: req.query.entityType ? String(req.query.entityType) : undefined,
        entityId: req.query.entityId ? Number(req.query.entityId) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    } catch (err: any) {
      this.fail(res, err);
    }
  };
}
