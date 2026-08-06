import { Request, Response } from 'express';
import { InterviewService } from '../services/InterviewService';
import { AssessmentService } from '../services/AssessmentService';
import { STAFF_ROLES } from '../middleware/auth';
import { PerfActionContext } from '../types/performance';

function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/only|cannot|must be|required|needs|invalid|already|no pass score/i.test(message)) return 400;
  return 500;
}

export class InterviewController {
  private interviews = new InterviewService();
  private assessments = new AssessmentService();

  private ctx(req: Request): PerfActionContext {
    return {
      userId: req.user!.userId,
      userRole: req.user!.role,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    };
  }

  private fail(res: Response, err: any): void {
    res.status(statusFor(err.message ?? '')).json({ error: err.message });
  }

  // === Interviews ==========================================================

  schedule = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.interviews.schedule(req.body ?? {}, this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query as Record<string, string>;
      res.json(await this.interviews.list({
        applicationId: q.applicationId ? parseInt(q.applicationId) : undefined,
        status: q.status || undefined,
        from: q.from || undefined,
        to: q.to || undefined,
        upcoming: q.upcoming === 'true',
      }));
    } catch (err: any) { this.fail(res, err); }
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.interviews.getById(parseInt(req.params.id as string)));
    } catch (err: any) { this.fail(res, err); }
  };

  reschedule = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.interviews.reschedule(parseInt(req.params.id as string), req.body ?? {}, this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  cancel = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.interviews.cancel(parseInt(req.params.id as string), this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  complete = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.interviews.complete(parseInt(req.params.id as string), req.body?.outcome, this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  noShow = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.interviews.noShow(parseInt(req.params.id as string), this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  ics = async (req: Request, res: Response): Promise<void> => {
    try {
      const { fileName, content } = await this.interviews.icsFile(parseInt(req.params.id as string));
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(content);
    } catch (err: any) { this.fail(res, err); }
  };

  submitFeedback = async (req: Request, res: Response): Promise<void> => {
    try {
      const isStaff = (STAFF_ROLES as readonly string[]).includes(req.user!.role);
      res.json(await this.interviews.submitFeedback(parseInt(req.params.id as string), req.body ?? {}, {
        ...this.ctx(req),
        employeeId: req.user!.employeeId ?? undefined,
        isStaff,
      }));
    } catch (err: any) { this.fail(res, err); }
  };

  listFeedback = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.interviews.listFeedback(parseInt(req.params.id as string)));
    } catch (err: any) { this.fail(res, err); }
  };

  sendReminders = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.interviews.sendReminders());
    } catch (err: any) { this.fail(res, err); }
  };

  // === Assessments =========================================================

  listAssessments = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.assessments.list());
    } catch (err: any) { this.fail(res, err); }
  };

  createAssessment = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.assessments.create(req.body ?? {}, this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  updateAssessment = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.assessments.update(parseInt(req.params.id as string), req.body ?? {}, this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  assignAssessment = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.assessments.assign(
        parseInt(req.params.id as string),
        Math.trunc(Number(req.body?.applicationId)),
        this.ctx(req),
      ));
    } catch (err: any) { this.fail(res, err); }
  };

  recordAssessmentResult = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.assessments.recordResult(parseInt(req.params.id as string), req.body ?? {}, this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  listAssessmentResults = async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query as Record<string, string>;
      res.json(await this.assessments.listResults({
        applicationId: q.applicationId ? parseInt(q.applicationId) : undefined,
        employeeId: q.employeeId ? parseInt(q.employeeId) : undefined,
      }));
    } catch (err: any) { this.fail(res, err); }
  };
}
