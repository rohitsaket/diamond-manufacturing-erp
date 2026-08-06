import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import { InternalApplicationService } from '../services/InternalApplicationService';
import { ReferralService, ReferralCaller } from '../services/ReferralService';
import { JobCaller } from '../services/InternalJobService';
import { PerfActionContext } from '../types/performance';
import { env } from '../config/env';

/** Errors that are the caller's fault rather than the server's. */
function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/already|cannot be|cannot move|can only|only .* can|do not meet/i.test(message)) return 409;
  if (/required|must |invalid|unknown|not linked|cannot refer yourself|provide exactly/i.test(message)) return 400;
  return 500;
}

/**
 * Internal applications (ESS + staff pipeline + documents) and referrals.
 * Eligibility failures return the rule-by-rule details so an applicant sees
 * exactly what blocked them instead of a bare error string.
 */
export class InternalApplicationController {
  private applications = new InternalApplicationService();
  private referrals = new ReferralService();

  private ctx(req: Request): PerfActionContext {
    return {
      userId: req.user!.userId,
      userRole: req.user!.role,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    };
  }

  private caller(req: Request): JobCaller & ReferralCaller {
    return {
      userId: req.user!.userId,
      role: req.user!.role,
      employeeId: req.user!.employeeId ?? null,
    };
  }

  private fail(res: Response, err: any): void {
    const payload: any = { error: err.message };
    // Eligibility blocks carry the rule evaluations for the caller to render.
    if (err.eligibility) payload.eligibility = err.eligibility;
    res.status(statusFor(err.message ?? '')).json(payload);
  }

  // =========================================================================
  // ESS: apply / submit / withdraw / mine
  // =========================================================================

  apply = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.applications.apply(Number(req.params.id), req.body ?? {}, this.caller(req), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  submitDraft = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.applications.submitDraft(Number(req.params.id), this.caller(req), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  withdraw = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.applications.withdraw(Number(req.params.id), req.body?.reason ?? null, this.caller(req), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  myApplications = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.applications.myApplications(this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // Staff pipeline
  // =========================================================================

  listApplications = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.applications.staffList(
        {
          jobId: req.query.jobId ? Number(req.query.jobId) : undefined,
          status: req.query.status ? String(req.query.status) : undefined,
          employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
        },
        req.user!.role,
      ));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  getApplication = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.applications.staffGet(Number(req.params.id), req.user!.role));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.applications.updateStatus(Number(req.params.id), req.body ?? {}, req.user!.role, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  override = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.applications.override(Number(req.params.id), req.body?.reason ?? null, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // Documents
  // =========================================================================

  uploadDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'A file is required (multipart field "file")' });
        return;
      }
      res.status(201).json(await this.applications.addDocument(
        Number(req.params.id),
        { originalname: file.originalname, filename: file.filename, mimetype: file.mimetype, size: file.size },
        'internal-apps',
        this.caller(req),
        this.ctx(req),
      ));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  listDocuments = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.applications.listDocuments(Number(req.params.id), this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  downloadDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const doc = await this.applications.getDocumentForDownload(Number(req.params.id), this.caller(req));
      // Path-traversal guard: the resolved path must stay inside the uploads root.
      const base = path.resolve(env.uploadDir);
      const full = path.resolve(base, doc.filePath);
      if (!full.startsWith(base) || !fs.existsSync(full)) {
        res.status(404).json({ error: 'Stored file is missing on disk' });
        return;
      }
      res.setHeader('Content-Type', doc.mimeType ?? 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${doc.fileName.replace(/"/g, '')}"`);
      fs.createReadStream(full).pipe(res);
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // Referrals
  // =========================================================================

  createReferral = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.referrals.create(req.body ?? {}, this.caller(req), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  myReferrals = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.referrals.myReferrals(this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  listReferrals = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.referrals.list({
        status: req.query.status ? String(req.query.status) : undefined,
      }));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  reviewReferral = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.referrals.review(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  referralLeaderboard = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.referrals.leaderboard());
    } catch (err: any) {
      this.fail(res, err);
    }
  };
}
