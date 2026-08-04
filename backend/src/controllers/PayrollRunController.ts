import { Request, Response } from 'express';
import { PayrollEngineV2Service } from '../services/PayrollEngineV2Service';
import { jobQueueService } from '../services/JobQueueService';
import { PayrollApprovalService } from '../services/PayrollApprovalService';
import { PayrollAnalyticsService } from '../services/PayrollAnalyticsService';

/** Approval entity type every payroll run is raised under. */
const RUN_ENTITY = 'PAYROLL_RUN';

/** Errors that are the caller's fault rather than the server's. */
function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/cannot approve|only access|only view|permission/i.test(message)) return 403;
  if (/required|must |already|invalid|unknown|no active|not attached|no step/i.test(message)) return 400;
  return 500;
}

/**
 * Payroll run lifecycle: start, simulate, retro, final settlement, and the
 * approval gate that stands between a computed run and money leaving.
 */
export class PayrollRunController {
  private engine = new PayrollEngineV2Service();
  private approvals = new PayrollApprovalService();
  private analytics = new PayrollAnalyticsService();

  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const runs = await this.analytics.listRuns({
        periodId: req.query.periodId ? parseInt(String(req.query.periodId), 10) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        runType: req.query.runType ? String(req.query.runType) : undefined,
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
      });
      res.json(runs);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  get = async (req: Request, res: Response): Promise<void> => {
    try {
      const run = await this.analytics.getRun(parseInt(req.params.id as string, 10));
      const approvals = await this.approvals.getForEntity(RUN_ENTITY, run.id);
      res.json({ ...run, approvals });
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  /**
   * Starts a payroll run. `async: true` hands it to the job queue and returns a
   * job id immediately -- which is what any run over a few hundred employees
   * should use, because HTTP timeouts do not care that payroll is important.
   */
  start = async (req: Request, res: Response): Promise<void> => {
    try {
      const { periodId, runType, employeeIds, filters, async: runAsync } = req.body ?? {};
      if (!periodId) {
        res.status(400).json({ error: 'periodId is required' });
        return;
      }

      const input = {
        periodId: Number(periodId),
        runType: runType ? String(runType) : 'REGULAR',
        employeeIds: Array.isArray(employeeIds) && employeeIds.length > 0 ? employeeIds.map(Number) : undefined,
        filters: filters ?? undefined,
        isSimulation: false,
        userId: req.user!.userId,
        actorName: req.user!.name,
      };

      if (runAsync) {
        const jobId = await this.engine.queueRun(input);
        await this.audit(req, 'PAYROLL_RUN', null, 'QUEUE', `Queued ${input.runType} payroll run`, Number(periodId));
        res.status(202).json({ jobId: Number(jobId), jobType: 'PAYROLL_RUN', status: 'QUEUED' });
        return;
      }

      const result = await this.engine.runPayroll(input);
      await this.audit(req, 'PAYROLL_RUN', result?.runId ?? null, 'RUN', `Ran ${input.runType} payroll`, Number(periodId));
      res.status(201).json(result);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  /** A simulation reports figures without writing salary lines. */
  simulate = async (req: Request, res: Response): Promise<void> => {
    try {
      const { periodId, runType, employeeIds, filters } = req.body ?? {};
      if (!periodId) {
        res.status(400).json({ error: 'periodId is required' });
        return;
      }
      const result = await this.engine.simulate({
        periodId: Number(periodId),
        runType: runType ? String(runType) : 'SIMULATION',
        employeeIds: Array.isArray(employeeIds) && employeeIds.length > 0 ? employeeIds.map(Number) : undefined,
        filters: filters ?? undefined,
        isSimulation: true,
        userId: req.user!.userId,
        actorName: req.user!.name,
      });
      res.json(result);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  retro = async (req: Request, res: Response): Promise<void> => {
    try {
      const { periodId, fromPeriodId, employeeIds } = req.body ?? {};
      if (!periodId || !fromPeriodId) {
        res.status(400).json({ error: 'periodId and fromPeriodId are required' });
        return;
      }
      const result = await this.engine.runRetro(
        Number(periodId),
        Number(fromPeriodId),
        Array.isArray(employeeIds) ? employeeIds.map(Number) : [],
        req.user!.userId,
        req.user!.name,
      );
      await this.audit(req, 'PAYROLL_RUN', result?.runId ?? null, 'RETRO', 'Ran retro payroll', Number(periodId));
      res.status(201).json(result);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  finalSettlement = async (req: Request, res: Response): Promise<void> => {
    try {
      const { employeeId, lastWorkingDate } = req.body ?? {};
      if (!employeeId || !lastWorkingDate) {
        res.status(400).json({ error: 'employeeId and lastWorkingDate are required' });
        return;
      }
      const result = await this.engine.runFinalSettlement(
        Number(employeeId),
        String(lastWorkingDate),
        req.user!.userId,
      );
      await this.audit(
        req,
        'FINAL_SETTLEMENT',
        result?.id ?? null,
        'CALCULATE',
        `Computed final settlement to ${lastWorkingDate}`,
        null,
        Number(employeeId),
      );
      res.status(201).json(result);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // -------------------------------------------------------------------------
  // Approval gate
  // -------------------------------------------------------------------------

  submitApproval = async (req: Request, res: Response): Promise<void> => {
    try {
      const runId = parseInt(req.params.id as string, 10);
      const run = await this.analytics.getRun(runId);
      if (run.isSimulation) {
        res.status(400).json({ error: 'A simulation cannot be submitted for approval' });
        return;
      }

      const request = await this.approvals.submit(RUN_ENTITY, runId, {
        title: req.body?.title || `Payroll run #${runId} - ${run.periodLabel ?? ''} (${run.runType})`.trim(),
        amount: run.totalNet,
        currency: run.currency,
        requestedBy: req.user!.userId,
        linkPage: 'payroll',
      });

      const updated = await this.analytics.setRunStatus(runId, 'PENDING_APPROVAL', req.user!.userId);
      await this.audit(req, 'PAYROLL_RUN', runId, 'SUBMIT_APPROVAL', 'Submitted payroll run for approval', run.periodId);
      res.json({ run: updated, approval: request });
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  approve = async (req: Request, res: Response): Promise<void> => {
    await this.decide(req, res, 'APPROVE');
  };

  reject = async (req: Request, res: Response): Promise<void> => {
    await this.decide(req, res, 'REJECT');
  };

  getJob = async (req: Request, res: Response): Promise<void> => {
    try {
      const job = await jobQueueService.getJob(parseInt(req.params.id as string, 10));
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      res.json(job);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Approve/reject share one path: the approval engine decides whether the step
   * advances, and the run status only changes once the ladder is finished.
   */
  private decide = async (req: Request, res: Response, action: 'APPROVE' | 'REJECT'): Promise<void> => {
    try {
      const runId = parseInt(req.params.id as string, 10);
      const run = await this.analytics.getRun(runId);

      const pending = (await this.approvals.getForEntity(RUN_ENTITY, runId)).find((r) => r.status === 'PENDING');
      if (!pending) {
        res.status(400).json({ error: 'This run has no pending approval request' });
        return;
      }

      const request = await this.approvals.act(
        pending.id,
        action,
        req.user!.userId,
        req.user!.role,
        req.body?.comments ?? null,
      );

      let updated = run;
      if (request.status === 'APPROVED') updated = await this.analytics.setRunStatus(runId, 'APPROVED', req.user!.userId);
      else if (request.status === 'REJECTED') updated = await this.analytics.setRunStatus(runId, 'REJECTED', req.user!.userId);

      await this.audit(
        req,
        'PAYROLL_RUN',
        runId,
        action,
        `${action === 'APPROVE' ? 'Approved' : 'Rejected'} payroll run at step ${pending.currentStep}`,
        run.periodId,
      );
      res.json({ run: updated, approval: request });
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  private async audit(
    req: Request,
    entityType: string,
    entityId: number | null,
    action: string,
    summary: string,
    periodId?: number | null,
    employeeId?: number | null,
  ): Promise<void> {
    await this.analytics.logAudit({
      entityType,
      entityId,
      periodId: periodId ?? null,
      employeeId: employeeId ?? null,
      action,
      summary,
      actorUserId: req.user?.userId ?? null,
      actorName: req.user?.name ?? null,
      actorRole: req.user?.role ?? null,
      ipAddress: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || null,
      userAgent: req.get('user-agent') ?? null,
    });
  }
}
