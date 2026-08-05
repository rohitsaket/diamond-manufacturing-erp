import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import { ReviewService, ReviewCaller } from '../services/ReviewService';
import { CompetencyService } from '../services/CompetencyService';
import { PerfActionContext } from '../types/performance';
import { env } from '../config/env';

/** Errors that are the caller's fault rather than the server's. */
function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/already exists|already requested|already a member|already been|cannot be|only the|you can only|no longer|not allowed/i.test(message)) return 409;
  if (/required|must |invalid|needs |nothing to update|not linked/i.test(message)) return 400;
  return 500;
}

/**
 * Review templates, reviews/360, competencies and the skill matrix. Every
 * handler is an arrow-function property; anonymity is enforced inside
 * ReviewService with the caller's role, never here.
 */
export class ReviewController {
  private reviews = new ReviewService();
  private competencies = new CompetencyService();

  private ctx(req: Request): PerfActionContext {
    return {
      userId: req.user!.userId,
      userRole: req.user!.role,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };
  }

  private caller(req: Request): ReviewCaller {
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
  // Review templates
  // =========================================================================

  listTemplates = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.reviews.listTemplates());
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createTemplate = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.reviews.createTemplate(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateTemplate = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.reviews.updateTemplate(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // Reviews
  // =========================================================================

  listReviews = async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query;
      res.json(await this.reviews.listReviews(
        {
          cycleId: q.cycleId ? Number(q.cycleId) : undefined,
          employeeId: q.employeeId ? Number(q.employeeId) : undefined,
          reviewType: q.reviewType ? String(q.reviewType) : undefined,
          status: q.status ? String(q.status) : undefined,
          reviewerEmployeeId: q.reviewerEmployeeId ? Number(q.reviewerEmployeeId) : undefined,
        },
        req.user!.role,
      ));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createReview = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.reviews.createReview(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  launch = async (req: Request, res: Response): Promise<void> => {
    try {
      const cycleId = Number(req.body?.cycleId);
      if (!cycleId) {
        res.status(400).json({ error: 'cycleId is required' });
        return;
      }
      res.json(await this.reviews.launch(cycleId, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  requestPeers = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.reviews.requestPeers(
        Number(req.params.id),
        req.body?.reviewerEmployeeIds ?? [],
        !!req.body?.isAnonymous,
        this.ctx(req),
      ));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  getReview = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.reviews.getReview(Number(req.params.id), this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  respond = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.reviews.respond(Number(req.params.id), req.body ?? {}, this.caller(req), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  submit = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.reviews.submit(Number(req.params.id), this.caller(req), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  acknowledge = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.reviews.acknowledge(Number(req.params.id), this.caller(req), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  decline = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.reviews.decline(Number(req.params.id), req.body?.reason ?? '', this.caller(req), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // 360
  // =========================================================================

  get360 = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.reviews.get360(
        Number(req.params.employeeId),
        Number(req.query.cycleId ?? 0),
        req.user!.role,
      ));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // Attachments
  // =========================================================================

  uploadAttachment = async (req: Request, res: Response): Promise<void> => {
    try {
      const file = (req as any).file as { originalname: string; filename: string; mimetype: string; size: number } | undefined;
      if (!file) {
        res.status(400).json({ error: 'A file is required (multipart field name: file)' });
        return;
      }
      res.status(201).json(await this.reviews.addAttachment(
        Number(req.params.id), file, 'perf-reviews', this.caller(req), this.ctx(req),
      ));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  listAttachments = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.reviews.listAttachments(Number(req.params.id), this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  downloadAttachment = async (req: Request, res: Response): Promise<void> => {
    try {
      const attachment = await this.reviews.getAttachmentForDownload(Number(req.params.id), this.caller(req));
      const base = path.resolve(env.uploadDir);
      const full = path.resolve(base, attachment.filePath);
      if (!full.startsWith(base) || !fs.existsSync(full)) {
        res.status(404).json({ error: 'Stored file is missing on disk' });
        return;
      }
      res.setHeader('Content-Type', attachment.mimeType ?? 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${attachment.fileName.replace(/"/g, '')}"`);
      fs.createReadStream(full).pipe(res);
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // ESS
  // =========================================================================

  myReviews = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.reviews.myReviews(this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  myReviewHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.reviews.myReviewHistory(this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // Competencies
  // =========================================================================

  listCompetencies = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.competencies.list());
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createCompetency = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.competencies.create(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateCompetency = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.competencies.update(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  listCompetencyRatings = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.competencies.listRatings({
        employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
        cycleId: req.query.cycleId ? Number(req.query.cycleId) : undefined,
      }));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createCompetencyRating = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.competencies.createRating(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  skillMatrix = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.competencies.skillMatrix(req.query.cycleId ? Number(req.query.cycleId) : undefined));
    } catch (err: any) {
      this.fail(res, err);
    }
  };
}
