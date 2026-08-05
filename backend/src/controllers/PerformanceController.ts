import { Request, Response } from 'express';
import { GoalService, PerfActor } from '../services/GoalService';
import { KpiKraService } from '../services/KpiKraService';
import { PerfAuditService } from '../services/PerfAuditService';
import { PerformanceAnalyticsService } from '../services/PerformanceAnalyticsService';
import { PerformanceCycleService } from '../services/PerformanceCycleService';
import { PerfActionContext } from '../types/performance';

/** Errors that are the caller's fault rather than the server's. */
function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/already exists|already assigned|already .*(FINALIZED|CLOSED|COMPLETED|CANCELLED)|cannot be|cannot move|can only|only a /i.test(message)) return 409;
  if (/required|must |invalid|unknown|expected|exceed|not linked|no updatable|outside the cycle/i.test(message)) return 400;
  return 500;
}

function intOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = parseInt(String(value), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Performance management core: cycles, goals/OKRs, KPI, KRA, analytics and
 * reports. Every handler is an arrow-function property so the router can pass
 * it by reference; every meaningful write flows through PerfAuditService
 * inside the services.
 */
export class PerformanceController {
  private cycleService = new PerformanceCycleService();
  private goalService = new GoalService();
  private kpiKraService = new KpiKraService();
  private analytics = new PerformanceAnalyticsService();
  private auditService = new PerfAuditService();

  private ctx(req: Request): PerfActionContext {
    return {
      userId: req.user!.userId,
      userRole: req.user!.role,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    };
  }

  private actor(req: Request): PerfActor {
    return { ...this.ctx(req), employeeId: req.user?.employeeId ?? null };
  }

  private readId(raw: unknown): number | null {
    const id = parseInt(String(raw), 10);
    return Number.isNaN(id) || id <= 0 ? null : id;
  }

  private fail(res: Response, err: any): void {
    res.status(statusFor(String(err?.message ?? ''))).json({ error: err.message });
  }

  private idOr400(req: Request, res: Response, param = 'id'): number | null {
    const id = this.readId(req.params[param]);
    if (id === null) res.status(400).json({ error: `A numeric ${param} is required` });
    return id;
  }

  // ==========================================================================
  // Cycles
  // ==========================================================================

  listCycles = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.cycleService.list(req.query.status ? String(req.query.status) : undefined));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  getCycle = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.cycleService.get(id));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createCycle = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.cycleService.create(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateCycle = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.cycleService.update(id, req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  changeCycleStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.cycleService.changeStatus(id, String(req.body?.status ?? ''), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  cycleCalendar = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.cycleService.calendar(id));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // ==========================================================================
  // Goals & OKRs
  // ==========================================================================

  listGoals = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(
        await this.goalService.list({
          cycleId: intOrUndefined(req.query.cycleId),
          scope: req.query.scope ? String(req.query.scope) : undefined,
          kind: req.query.kind ? String(req.query.kind) : undefined,
          status: req.query.status ? String(req.query.status) : undefined,
          employeeId: intOrUndefined(req.query.employeeId),
          departmentId: intOrUndefined(req.query.departmentId),
          teamId: intOrUndefined(req.query.teamId),
          search: req.query.search ? String(req.query.search) : undefined,
          limit: intOrUndefined(req.query.limit),
        }),
      );
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  goalTree = async (req: Request, res: Response): Promise<void> => {
    try {
      const cycleId = intOrUndefined(req.query.cycleId);
      if (!cycleId) {
        res.status(400).json({ error: 'A numeric cycleId query parameter is required' });
        return;
      }
      res.json(await this.goalService.tree(cycleId));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  getGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.goalService.get(id));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.goalService.create(req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.goalService.update(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  deleteGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      await this.goalService.softDelete(id, this.actor(req));
      res.json({ success: true });
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  submitGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.goalService.submit(id, this.actor(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  approveGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.goalService.approve(id, this.actor(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  rejectGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.goalService.reject(id, String(req.body?.reason ?? ''), this.actor(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  recordGoalProgress = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.goalService.recordProgress(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  completeGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.goalService.complete(id, this.actor(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  cancelGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.goalService.cancel(id, this.actor(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  goalUpdates = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.goalService.updates(id));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  addMilestone = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.status(201).json(await this.goalService.addMilestone(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateMilestone = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.goalService.updateMilestone(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  deleteMilestone = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      await this.goalService.deleteMilestone(id, this.actor(req));
      res.json({ success: true });
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  listGoalTemplates = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.goalService.listTemplates());
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createGoalTemplate = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.goalService.createTemplate(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateGoalTemplate = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.goalService.updateTemplate(id, req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  bulkGoalsFromTemplate = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.goalService.bulkFromTemplate(req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  myGoals = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.goalService.myGoals(req.user?.employeeId ?? null, intOrUndefined(req.query.cycleId)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // ==========================================================================
  // KPI
  // ==========================================================================

  listKpis = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.kpiKraService.listKpis());
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createKpi = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.kpiKraService.createKpi(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateKpi = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.kpiKraService.updateKpi(id, req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  listKpiAssignments = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(
        await this.kpiKraService.listAssignments({
          cycleId: intOrUndefined(req.query.cycleId),
          scope: req.query.scope ? String(req.query.scope) : undefined,
          employeeId: intOrUndefined(req.query.employeeId),
          departmentId: intOrUndefined(req.query.departmentId),
          status: req.query.status ? String(req.query.status) : undefined,
          limit: intOrUndefined(req.query.limit),
        }),
      );
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createKpiAssignment = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.kpiKraService.createAssignment(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateKpiAssignment = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.kpiKraService.updateAssignment(id, req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  deleteKpiAssignment = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      await this.kpiKraService.deleteAssignment(id, this.ctx(req));
      res.json({ success: true });
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  recordKpiValue = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.kpiKraService.recordValue(id, req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  listKpiValues = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.kpiKraService.listValues(id));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  computeKpiAssignments = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.kpiKraService.computeAssignments(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  myKpis = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.kpiKraService.myKpis(req.user?.employeeId ?? null, intOrUndefined(req.query.cycleId)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // ==========================================================================
  // KRA
  // ==========================================================================

  listKras = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.kpiKraService.listKras());
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createKra = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.kpiKraService.createKra(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateKra = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.kpiKraService.updateKra(id, req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  listEmployeeKras = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(
        await this.kpiKraService.listEmployeeKras({
          cycleId: intOrUndefined(req.query.cycleId),
          employeeId: intOrUndefined(req.query.employeeId),
          status: req.query.status ? String(req.query.status) : undefined,
          limit: intOrUndefined(req.query.limit),
        }),
      );
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  assignEmployeeKra = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.kpiKraService.assignKra(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  bulkAssignEmployeeKras = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.kpiKraService.bulkAssignKras(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  selfScoreKra = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.kpiKraService.selfScore(id, req.body ?? {}, this.actor(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  managerScoreKra = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.kpiKraService.managerScore(id, req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  finalizeKra = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOr400(req, res);
      if (id === null) return;
      res.json(await this.kpiKraService.finalize(id, req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  myKras = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.kpiKraService.myKras(req.user?.employeeId ?? null, intOrUndefined(req.query.cycleId)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // ==========================================================================
  // Analytics & reports
  // ==========================================================================

  private requireCycleId(req: Request, res: Response): number | null {
    const cycleId = intOrUndefined(req.query.cycleId);
    if (!cycleId) {
      res.status(400).json({ error: 'A numeric cycleId query parameter is required' });
      return null;
    }
    return cycleId;
  }

  analyticsDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
      const cycleId = this.requireCycleId(req, res);
      if (cycleId === null) return;
      res.json(await this.analytics.dashboard(cycleId));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  analyticsDistribution = async (req: Request, res: Response): Promise<void> => {
    try {
      const cycleId = this.requireCycleId(req, res);
      if (cycleId === null) return;
      res.json(await this.analytics.distribution(cycleId));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  analyticsDepartments = async (req: Request, res: Response): Promise<void> => {
    try {
      const cycleId = this.requireCycleId(req, res);
      if (cycleId === null) return;
      res.json(await this.analytics.departments(cycleId));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  analyticsTrends = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.trends(intOrUndefined(req.query.months) ?? 6));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  analyticsAttrition = async (req: Request, res: Response): Promise<void> => {
    try {
      const cycleId = this.requireCycleId(req, res);
      if (cycleId === null) return;
      res.json(await this.analytics.attrition(cycleId));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  /**
   * Honesty pattern: nothing in this deployment calls an LLM, so these
   * endpoints say so instead of returning canned text dressed up as AI.
   */
  aiInsights = async (_req: Request, res: Response): Promise<void> => {
    res.json({ available: false, reason: 'AI-assisted suggestions are not configured in this deployment.' });
  };

  aiSuggestGoals = async (_req: Request, res: Response): Promise<void> => {
    res.json({ available: false, reason: 'AI-assisted suggestions are not configured in this deployment.' });
  };

  report = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.report(String(req.params.type), intOrUndefined(req.query.cycleId)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  reportExport = async (req: Request, res: Response): Promise<void> => {
    try {
      const { filename, csv } = await this.analytics.reportCsv(
        String(req.params.type),
        intOrUndefined(req.query.cycleId),
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  auditLogs = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(
        await this.auditService.list({
          entityType: req.query.entityType ? String(req.query.entityType) : undefined,
          entityId: intOrUndefined(req.query.entityId),
          limit: intOrUndefined(req.query.limit),
        }),
      );
    } catch (err: any) {
      this.fail(res, err);
    }
  };
}
