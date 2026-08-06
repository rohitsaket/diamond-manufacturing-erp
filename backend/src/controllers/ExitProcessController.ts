import { Request, Response } from 'express';
import { ClearanceService } from '../services/ClearanceService';
import { ExitInterviewService } from '../services/ExitInterviewService';
import { ExitProcessService } from '../services/ExitProcessService';
import { OffboardingActor } from '../services/SeparationService';

/** Errors that are the caller's fault rather than the server's. */
function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/already/i.test(message)) return 409;
  if (/your own|not linked to an employee/i.test(message)) return 403;
  if (/required|must |invalid|cannot|only |provide|expects|no updatable|not allowed|not open|unknown/i.test(message)) return 400;
  return 500;
}

/**
 * The offboarding legs behind an approved case: exit interviews, the exit
 * survey (with its anonymity contract), departmental clearances, asset
 * returns, knowledge transfer and access revocations.
 */
export class ExitProcessController {
  private interviews = new ExitInterviewService();
  private clearances = new ClearanceService();
  private process = new ExitProcessService();

  // =========================================================================
  // Exit interviews
  // =========================================================================

  listInterviews = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.interviews.listInterviews({
        separationId: req.query.separationId ? Number(req.query.separationId) : undefined,
        status: req.query.status ? String(req.query.status).toUpperCase() : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  scheduleInterview = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric interview id is required' });
        return;
      }
      res.json(await this.interviews.schedule(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  completeInterview = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric interview id is required' });
        return;
      }
      res.json(await this.interviews.complete(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  cancelInterview = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric interview id is required' });
        return;
      }
      res.json(await this.interviews.cancelInterview(id, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Exit survey
  // =========================================================================

  listSurveyQuestions = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.interviews.listQuestions(true));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  createSurveyQuestion = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.interviews.createQuestion(req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  updateSurveyQuestion = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric question id is required' });
        return;
      }
      res.json(await this.interviews.updateQuestion(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  submitMySurvey = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.interviews.submitMySurvey(this.actor(req), req.body ?? {}));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  surveyResults = async (req: Request, res: Response): Promise<void> => {
    try {
      const questionId = req.query.questionId ? Number(req.query.questionId) : undefined;
      res.json(await this.interviews.surveyResults(questionId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Clearances
  // =========================================================================

  listClearances = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.clearances.list({
        separationId: req.query.separationId ? Number(req.query.separationId) : undefined,
        department: req.query.department ? String(req.query.department).toUpperCase() : undefined,
        status: req.query.status ? String(req.query.status).toUpperCase() : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  updateClearance = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric clearance id is required' });
        return;
      }
      res.json(await this.clearances.updateClearance(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  updateClearanceTask = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric task id is required' });
        return;
      }
      res.json(await this.clearances.updateTask(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  addClearanceTask = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric clearance id is required' });
        return;
      }
      res.status(201).json(await this.clearances.addTask(id, String(req.body?.task ?? ''), this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Asset returns
  // =========================================================================

  listAssetReturns = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.process.listAssetReturns({
        separationId: req.query.separationId ? Number(req.query.separationId) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  verifyAssetReturn = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric asset return id is required' });
        return;
      }
      res.json(await this.process.verifyAssetReturn(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Knowledge transfer
  // =========================================================================

  getKtPlan = async (req: Request, res: Response): Promise<void> => {
    try {
      const separationId = this.readId(req.params.separationId);
      if (separationId === null) {
        res.status(400).json({ error: 'A numeric separation id is required' });
        return;
      }
      res.json(await this.process.getKtPlan(separationId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  updateKtPlan = async (req: Request, res: Response): Promise<void> => {
    try {
      const planId = this.readId(req.params.planId);
      if (planId === null) {
        res.status(400).json({ error: 'A numeric KT plan id is required' });
        return;
      }
      res.json(await this.process.updateKtPlan(planId, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  addKtItem = async (req: Request, res: Response): Promise<void> => {
    try {
      const planId = this.readId(req.params.planId);
      if (planId === null) {
        res.status(400).json({ error: 'A numeric KT plan id is required' });
        return;
      }
      res.status(201).json(await this.process.addKtItem(planId, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  updateKtItem = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric KT item id is required' });
        return;
      }
      res.json(await this.process.updateKtItem(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  deleteKtItem = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric KT item id is required' });
        return;
      }
      await this.process.deleteKtItem(id, this.actor(req));
      res.json({ success: true });
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  approveKtPlan = async (req: Request, res: Response): Promise<void> => {
    try {
      const planId = this.readId(req.params.planId);
      if (planId === null) {
        res.status(400).json({ error: 'A numeric KT plan id is required' });
        return;
      }
      res.json(await this.process.approveKtPlan(planId, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Access revocations
  // =========================================================================

  listAccessRevocations = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.process.listAccessRevocations({
        separationId: req.query.separationId ? Number(req.query.separationId) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  updateAccessRevocation = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric access revocation id is required' });
        return;
      }
      res.json(await this.process.updateAccessRevocation(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Reminders
  // =========================================================================

  sendReminders = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.process.sendReminders(this.actor(req)));
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
