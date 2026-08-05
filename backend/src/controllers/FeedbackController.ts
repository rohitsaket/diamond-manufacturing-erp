import { Request, Response } from 'express';
import { FeedbackRecognitionService, FeedbackCaller } from '../services/FeedbackRecognitionService';
import { PerfActionContext } from '../types/performance';

/** Errors that are the caller's fault rather than the server's. */
function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/insufficient|already|cannot be|can only|only (the|APPROVED)/i.test(message)) return 409;
  if (/required|must |invalid|needs |not linked/i.test(message)) return 400;
  return 500;
}

/**
 * Continuous feedback, recognitions and the reward-point economy. Feedback
 * anonymity is applied inside the service with the caller's role.
 */
export class FeedbackController {
  private service = new FeedbackRecognitionService();

  private ctx(req: Request): PerfActionContext {
    return {
      userId: req.user!.userId,
      userRole: req.user!.role,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };
  }

  private caller(req: Request): FeedbackCaller {
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
  // Feedback
  // =========================================================================

  listFeedback = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.listFeedback(
        {
          employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
          feedbackType: req.query.type ? String(req.query.type) : undefined,
        },
        this.caller(req),
      ));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createFeedback = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.service.createFeedback(req.body ?? {}, this.caller(req), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  deleteFeedback = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.deleteFeedback(Number(req.params.id), this.caller(req), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // Recognitions
  // =========================================================================

  listRecognitions = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.listRecognitions({
        employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
      }));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createRecognition = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.service.createRecognition(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // Rewards
  // =========================================================================

  rewardBalance = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.balance(Number(req.params.employeeId)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  requestRedemption = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.service.requestRedemption(req.body ?? {}, this.caller(req), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  listRedemptions = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.listRedemptions({
        status: req.query.status ? String(req.query.status) : undefined,
        employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
      }));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  decideRedemption = async (req: Request, res: Response): Promise<void> => {
    try {
      if (typeof req.body?.approve !== 'boolean') {
        res.status(400).json({ error: 'approve (boolean) is required' });
        return;
      }
      res.json(await this.service.decideRedemption(
        Number(req.params.id), req.body.approve, req.body.note ?? null, this.ctx(req),
      ));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  fulfillRedemption = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.fulfillRedemption(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // ESS
  // =========================================================================

  myFeedback = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.myFeedback(this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  myRecognitions = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.myRecognitions(this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  myRewards = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.myRewards(this.caller(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };
}
