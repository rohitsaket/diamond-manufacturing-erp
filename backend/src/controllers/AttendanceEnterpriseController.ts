import { Request, Response } from 'express';
import { AttendancePolicyService } from '../services/AttendancePolicyService';
import { AttendanceRequestService } from '../services/AttendanceRequestService';
import { AttendanceAnalyticsService } from '../services/AttendanceAnalyticsService';
import { AttendanceComplianceService } from '../services/AttendanceComplianceService';
import { AttendanceDeviceService } from '../services/AttendanceDeviceService';
import { AttendanceLiveService } from '../services/AttendanceLiveService';
import { AttendanceReportService } from '../services/AttendanceReportService';
import { PunchEngineService } from '../services/PunchEngineService';
import { SchedulingService } from '../services/SchedulingService';
import { VisitorService } from '../services/VisitorService';
import { AttendanceAuditRepository } from '../repositories/AttendanceAuditRepository';
import { AttendanceDayRepository } from '../repositories/AttendanceDayRepository';
import { AttendancePunchRepository } from '../repositories/AttendancePunchRepository';
import { AuditContext } from '../types/attendance';
import { parseUserAgent } from '../utils/attendanceGeo';
import { todayString } from '../utils/dateUtils';

/**
 * Service faults are 500; everything a caller can fix is 4xx. The prefixes
 * below are the openings the services actually use for rule violations.
 */
const CLIENT_ERROR = new RegExp(
  '^(Invalid|Cannot|Missing|Unknown|Duplicate|At least|A |An |Each |Both |Only |No |Two |Wait |This |That |The |Policy|Shift|Device|Card|Employee|Visitor|Overtime|Approved|Analytics|Compliance|Report|Punch refused|Face|QR|Rest|Weekly|Blacklist|Fence|Longitude|Latitude|Pattern|Cycle|Break|Grace|Week off|Core hours|Output|Scanning|Waiving|Check the|Publish|Generation|Rotation)',
);

function fail(res: Response, err: any): void {
  const message = err?.message ?? 'Unexpected error';
  if (/not found$/i.test(message)) { res.status(404).json({ error: message }); return; }
  if (/authentication failed/i.test(message)) { res.status(401).json({ error: message }); return; }
  if (/not implemented|needs a vendor driver|is not configured/i.test(message)) {
    // The capability genuinely is not wired up. 501 says that plainly instead
    // of dressing a missing integration up as a bad request.
    res.status(501).json({ error: message });
    return;
  }
  if (CLIENT_ERROR.test(message)) { res.status(400).json({ error: message }); return; }
  res.status(500).json({ error: message });
}

function auditContext(req: Request): AuditContext {
  const ua = req.get('user-agent') ?? null;
  const agent = parseUserAgent(ua);
  return {
    userId: req.user?.userId ?? null,
    actorRole: req.user?.role ?? null,
    ipAddress: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || null,
    userAgent: ua,
    browser: agent.browser,
    device: agent.os,
  };
}

function intOf(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function requireInt(value: unknown, label: string): number {
  const n = intOf(value);
  if (n === undefined) throw new Error(`A numeric ${label} is required`);
  return n;
}

export class AttendanceEnterpriseController {
  private policies = new AttendancePolicyService();
  private requests = new AttendanceRequestService();
  private analytics = new AttendanceAnalyticsService();
  private compliance = new AttendanceComplianceService();
  private devices = new AttendanceDeviceService();
  private reports = new AttendanceReportService();
  private engine = new PunchEngineService();
  private scheduling = new SchedulingService();
  private visitors = new VisitorService();
  private auditRepo = new AttendanceAuditRepository();
  private dayRepo = new AttendanceDayRepository();
  private punchRepo = new AttendancePunchRepository();

  // =========================================================================
  // Dashboard and analytics
  // =========================================================================
  getDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.dashboard(req.query.date as string | undefined));
    } catch (err: any) { fail(res, err); }
  };

  getLiveBoard = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.liveBoard(req.query.date as string | undefined));
    } catch (err: any) { fail(res, err); }
  };

  getAnalytics = async (req: Request, res: Response): Promise<void> => {
    try {
      const to = (req.query.to as string) || todayString();
      const from = (req.query.from as string) || to;
      const granularity = (req.query.granularity as 'day' | 'week' | 'month') || 'day';
      res.json(await this.analytics.analytics({
        from, to,
        branchId: intOf(req.query.branchId),
        departmentId: intOf(req.query.departmentId),
        employeeId: intOf(req.query.employeeId),
      }, granularity));
    } catch (err: any) { fail(res, err); }
  };

  /** Server-sent punch feed. Held open until the client disconnects. */
  streamLive = async (req: Request, res: Response): Promise<void> => {
    try {
      const unsubscribe = AttendanceLiveService.shared().subscribe(res, intOf(req.query.sinceId));
      req.on('close', unsubscribe);
    } catch (err: any) {
      res.status(503).json({ error: err?.message ?? 'The live feed is unavailable' });
    }
  };

  // =========================================================================
  // Punches
  // =========================================================================
  recordPunch = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      const result = await this.engine.punch(body, { ...auditContext(req), userId: req.user!.userId });
      res.status(201).json(result);
    } catch (err: any) { fail(res, err); }
  };

  /** Self-service punch: the employee id always comes from the token. */
  recordSelfPunch = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: 'This account is not linked to an employee record' });
        return;
      }
      const body = req.body ?? {};
      const result = await this.engine.punch(
        { ...body, employeeId },
        { ...auditContext(req), userId: req.user!.userId },
      );
      res.status(201).json(result);
    } catch (err: any) { fail(res, err); }
  };

  getSelfStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: 'This account is not linked to an employee record' });
        return;
      }
      res.json(await this.engine.getSelfStatus(employeeId));
    } catch (err: any) { fail(res, err); }
  };

  listPunches = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.punchRepo.list({
        employeeId: intOf(req.query.employeeId),
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        deviceId: intOf(req.query.deviceId),
        punchType: req.query.punchType as any,
        captureMethod: req.query.captureMethod as any,
        status: req.query.status as any,
        geoStatus: req.query.geoStatus as any,
        branchId: intOf(req.query.branchId),
        departmentId: intOf(req.query.departmentId),
        search: req.query.search as string | undefined,
        page: intOf(req.query.page),
        pageSize: intOf(req.query.pageSize),
      }));
    } catch (err: any) { fail(res, err); }
  };

  deletePunch = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'punch id');
      const reason = String((req.body ?? {}).reason ?? '').trim();
      if (!reason) { res.status(400).json({ error: 'A reason is required to remove a punch' }); return; }

      const punch = await this.punchRepo.findById(id);
      if (!punch) { res.status(404).json({ error: 'Punch not found' }); return; }

      await this.punchRepo.softDelete(id, reason);
      await this.engine.recomputeDay(punch.employeeId, punch.punchDate, req.user!.userId);
      await this.auditRepo.log({
        entityType: 'PUNCH', entityId: id, employeeId: punch.employeeId, attDate: punch.punchDate,
        action: 'DELETE', summary: `Removed a ${punch.punchType} punch at ${punch.punchTime}: ${reason}`,
        previousValue: punch as any, context: auditContext(req),
      });
      res.json({ success: true, recomputed: { employeeId: punch.employeeId, date: punch.punchDate } });
    } catch (err: any) { fail(res, err); }
  };

  syncOffline = async (req: Request, res: Response): Promise<void> => {
    try {
      const entries = (req.body ?? {}).punches;
      if (!Array.isArray(entries)) { res.status(400).json({ error: 'punches must be an array' }); return; }
      if (entries.length > 500) { res.status(400).json({ error: 'An offline batch is limited to 500 punches' }); return; }
      res.json(await this.engine.syncOfflineBatch(entries, { ...auditContext(req), userId: req.user!.userId }));
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Days
  // =========================================================================
  getDayDetail = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = requireInt(req.params.employeeId, 'employee id');
      const date = (req.query.date as string) || todayString();
      res.json(await this.engine.getDayDetail(employeeId, date));
    } catch (err: any) { fail(res, err); }
  };

  listDays = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.dayRepo.list({
        date: req.query.date as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        employeeId: intOf(req.query.employeeId),
        branchId: intOf(req.query.branchId),
        departmentId: intOf(req.query.departmentId),
        shiftId: intOf(req.query.shiftId),
        status: req.query.status as any,
        workMode: req.query.workMode as any,
        exception: req.query.exception as any,
        search: req.query.search as string | undefined,
        page: intOf(req.query.page),
        pageSize: intOf(req.query.pageSize),
      }));
    } catch (err: any) { fail(res, err); }
  };

  recompute = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to, employeeId } = req.body ?? {};
      if (!from) { res.status(400).json({ error: 'from is required (YYYY-MM-DD)' }); return; }
      const result = await this.engine.recomputeRange(from, to || from, req.user!.userId, intOf(employeeId));
      await this.auditRepo.log({
        entityType: 'ATTENDANCE', action: 'RECOMPUTE',
        summary: `Recomputed ${result.days} employee-day(s) from ${from} to ${to || from}`,
        newValue: result, context: auditContext(req),
      });
      res.json(result);
    } catch (err: any) { fail(res, err); }
  };

  autoPunchOut = async (req: Request, res: Response): Promise<void> => {
    try {
      const date = (req.body ?? {}).date || todayString();
      res.json(await this.engine.autoPunchOut(date, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  autoMarkAbsent = async (req: Request, res: Response): Promise<void> => {
    try {
      const date = (req.body ?? {}).date;
      if (!date) { res.status(400).json({ error: 'date is required (YYYY-MM-DD)' }); return; }
      res.json(await this.engine.autoMarkAbsent(date, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  setLock = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to, locked, reason } = req.body ?? {};
      if (!from || !to) { res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' }); return; }
      if (locked && !reason) { res.status(400).json({ error: 'A reason is required when locking a period' }); return; }
      const affected = await this.dayRepo.setLock(from, to, !!locked, reason ?? null, req.user!.userId);
      await this.auditRepo.log({
        entityType: 'ATTENDANCE', action: locked ? 'LOCK' : 'UNLOCK',
        summary: `${locked ? 'Locked' : 'Unlocked'} ${affected} attendance day(s) from ${from} to ${to}`,
        newValue: { from, to, locked: !!locked, reason: reason ?? null }, context: auditContext(req),
      });
      res.json({ affected, from, to, locked: !!locked });
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Policies and breaks
  // =========================================================================
  listPolicies = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.policies.list(req.query.includeInactive === 'true'));
    } catch (err: any) { fail(res, err); }
  };

  getPolicy = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.policies.get(requireInt(req.params.id, 'policy id')));
    } catch (err: any) { fail(res, err); }
  };

  createPolicy = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.policies.create(req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  updatePolicy = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'policy id');
      res.json(await this.policies.update(id, req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  deletePolicy = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.policies.remove(requireInt(req.params.id, 'policy id'), req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  resolvePolicy = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = requireInt(req.params.employeeId, 'employee id');
      const date = (req.query.date as string) || todayString();
      res.json(await this.policies.resolveForEmployee(employeeId, date));
    } catch (err: any) { fail(res, err); }
  };

  listPolicyAssignments = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.policies.listAssignments(intOf(req.query.policyId)));
    } catch (err: any) { fail(res, err); }
  };

  createPolicyAssignment = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.policies.assign(req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  deletePolicyAssignment = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.policies.unassign(requireInt(req.params.id, 'assignment id')));
    } catch (err: any) { fail(res, err); }
  };

  listBreakTypes = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.policies.listBreakTypes(req.query.includeInactive === 'true'));
    } catch (err: any) { fail(res, err); }
  };

  createBreakType = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.policies.createBreakType(req.body ?? {}, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  updateBreakType = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.policies.updateBreakType(requireInt(req.params.id, 'break type id'), req.body ?? {}));
    } catch (err: any) { fail(res, err); }
  };

  deleteBreakType = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.policies.deleteBreakType(requireInt(req.params.id, 'break type id')));
    } catch (err: any) { fail(res, err); }
  };

  listBreaks = async (req: Request, res: Response): Promise<void> => {
    try {
      const from = req.query.from as string;
      const to = (req.query.to as string) || from;
      if (!from) { res.status(400).json({ error: 'from is required (YYYY-MM-DD)' }); return; }
      res.json(await this.punchRepo.findBreaksForRange(from, to, intOf(req.query.employeeId)));
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Requests and overtime
  // =========================================================================
  listRequests = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requests.list({
        status: req.query.status as any,
        requestType: req.query.requestType as any,
        employeeId: intOf(req.query.employeeId),
        approverEmployeeId: intOf(req.query.approverEmployeeId),
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        overdueOnly: req.query.overdueOnly === 'true',
        search: req.query.search as string | undefined,
        page: intOf(req.query.page),
        pageSize: intOf(req.query.pageSize),
      }));
    } catch (err: any) { fail(res, err); }
  };

  getRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requests.findById(requireInt(req.params.id, 'request id')));
    } catch (err: any) { fail(res, err); }
  };

  createRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.requests.create(req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  /** Self-service: the employee is taken from the token, never the body. */
  createSelfRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: 'This account is not linked to an employee record' });
        return;
      }
      const body = { ...(req.body ?? {}), employeeId };
      res.status(201).json(await this.requests.create(body, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  decideRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'request id');
      const decision = String((req.body ?? {}).decision ?? '').toUpperCase();
      if (decision !== 'APPROVE' && decision !== 'REJECT') {
        res.status(400).json({ error: "decision must be 'APPROVE' or 'REJECT'" });
        return;
      }
      res.json(await this.requests.decide(
        id, { decision: decision as 'APPROVE' | 'REJECT', comments: (req.body ?? {}).comments ?? null },
        req.user!.userId, auditContext(req),
      ));
    } catch (err: any) { fail(res, err); }
  };

  cancelRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requests.cancel(requireInt(req.params.id, 'request id'), req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  respondToSwap = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: 'This account is not linked to an employee record' });
        return;
      }
      const accept = (req.body ?? {}).accept === true;
      res.json(await this.requests.respondToSwap(requireInt(req.params.id, 'request id'), accept, employeeId));
    } catch (err: any) { fail(res, err); }
  };

  getRequestSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requests.summary(req.query.from as string | undefined, req.query.to as string | undefined));
    } catch (err: any) { fail(res, err); }
  };

  runEscalations = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requests.runEscalations(req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  listWorkflows = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requests.listWorkflows(req.query.requestType as any));
    } catch (err: any) { fail(res, err); }
  };

  createWorkflowStep = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.requests.createWorkflowStep(req.body ?? {}, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  deleteWorkflowStep = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requests.deleteWorkflowStep(requireInt(req.params.id, 'workflow step id')));
    } catch (err: any) { fail(res, err); }
  };

  listDelegations = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requests.listDelegations(intOf(req.query.employeeId)));
    } catch (err: any) { fail(res, err); }
  };

  createDelegation = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.requests.createDelegation(req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  cancelDelegation = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requests.cancelDelegation(requireInt(req.params.id, 'delegation id')));
    } catch (err: any) { fail(res, err); }
  };

  listOvertime = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.requests.listOvertime({
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        employeeId: intOf(req.query.employeeId),
        status: req.query.status as string | undefined,
        page: intOf(req.query.page),
        pageSize: intOf(req.query.pageSize),
      }));
    } catch (err: any) { fail(res, err); }
  };

  decideOvertime = async (req: Request, res: Response): Promise<void> => {
    try {
      const { employeeId, attDate, approvedHours, approve } = req.body ?? {};
      if (!employeeId || !attDate) {
        res.status(400).json({ error: 'employeeId and attDate are required' });
        return;
      }
      res.json(await this.requests.decideOvertime(
        Number(employeeId), attDate, Number(approvedHours ?? 0), approve !== false,
        req.user!.userId, auditContext(req),
      ));
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Scheduling
  // =========================================================================
  listShiftDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.scheduling.listShifts(req.query.includeInactive === 'true'));
    } catch (err: any) { fail(res, err); }
  };

  createShiftDetail = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.scheduling.createShift(req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  updateShiftDetail = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'shift id');
      res.json(await this.scheduling.updateShift(id, req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  listRotations = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.scheduling.listRotations());
    } catch (err: any) { fail(res, err); }
  };

  createRotation = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.scheduling.createRotation(req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  deleteRotation = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.scheduling.deleteRotation(requireInt(req.params.id, 'rotation id')));
    } catch (err: any) { fail(res, err); }
  };

  previewRotation = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'rotation id');
      const from = (req.query.from as string) || todayString();
      res.json(await this.scheduling.previewRotation(
        id, from, intOf(req.query.days) ?? 14, req.query.anchorDate as string | undefined,
      ));
    } catch (err: any) { fail(res, err); }
  };

  listShiftAssignments = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.scheduling.listAssignments(
        intOf(req.query.employeeId), req.query.activeOn as string | undefined,
      ));
    } catch (err: any) { fail(res, err); }
  };

  createShiftAssignment = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.scheduling.assignShift(req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  deleteShiftAssignment = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.scheduling.deleteAssignment(requireInt(req.params.id, 'assignment id')));
    } catch (err: any) { fail(res, err); }
  };

  resolveShifts = async (req: Request, res: Response): Promise<void> => {
    try {
      const date = (req.query.date as string) || todayString();
      res.json(await this.scheduling.resolveForDate(date));
    } catch (err: any) { fail(res, err); }
  };

  listRosters = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.scheduling.listRosters({
        branchId: intOf(req.query.branchId),
        departmentId: intOf(req.query.departmentId),
        status: req.query.status as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      }));
    } catch (err: any) { fail(res, err); }
  };

  getRoster = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.scheduling.getRoster(requireInt(req.params.id, 'roster id')));
    } catch (err: any) { fail(res, err); }
  };

  generateRoster = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!body.name || !body.fromDate || !body.toDate) {
        res.status(400).json({ error: 'name, fromDate and toDate are required' });
        return;
      }
      res.status(201).json(await this.scheduling.generateRoster(body, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  updateRosterEntries = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'roster id');
      const entries = (req.body ?? {}).entries;
      if (!Array.isArray(entries)) { res.status(400).json({ error: 'entries must be an array' }); return; }
      res.json(await this.scheduling.updateRosterEntries(id, entries, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  setRosterStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'roster id');
      const status = String((req.body ?? {}).status ?? '').toUpperCase();
      const allowed = ['DRAFT', 'PUBLISHED', 'LOCKED', 'ARCHIVED'];
      if (!allowed.includes(status)) {
        res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });
        return;
      }
      res.json(await this.scheduling.setRosterStatus(id, status as any, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  deleteRoster = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.scheduling.deleteRoster(requireInt(req.params.id, 'roster id')));
    } catch (err: any) { fail(res, err); }
  };

  getRosterCapacity = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.scheduling.capacity(requireInt(req.params.id, 'roster id')));
    } catch (err: any) { fail(res, err); }
  };

  swapRosterEntries = async (req: Request, res: Response): Promise<void> => {
    try {
      const { entryIdA, entryIdB } = req.body ?? {};
      if (!entryIdA || !entryIdB) { res.status(400).json({ error: 'entryIdA and entryIdB are required' }); return; }
      res.json(await this.scheduling.swapEntries(Number(entryIdA), Number(entryIdB), req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Devices and credentials
  // =========================================================================
  listDevices = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.list({
        deviceType: req.query.deviceType as string | undefined,
        branchId: intOf(req.query.branchId),
        status: req.query.status as string | undefined,
        healthStatus: req.query.healthStatus as any,
        search: req.query.search as string | undefined,
      }));
    } catch (err: any) { fail(res, err); }
  };

  getDevice = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.get(requireInt(req.params.id, 'device id')));
    } catch (err: any) { fail(res, err); }
  };

  createDevice = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.devices.create(req.body ?? {}, req.user!.userId, auditContext(req));
      res.status(201).json({
        ...result,
        notice: 'The API key is shown once and only its hash is stored. Copy it now.',
      });
    } catch (err: any) { fail(res, err); }
  };

  updateDevice = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'device id');
      res.json(await this.devices.update(id, req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  deleteDevice = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.remove(requireInt(req.params.id, 'device id'), req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  rotateDeviceKey = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'device id');
      const apiKey = await this.devices.rotateApiKey(id, req.user!.userId, auditContext(req));
      res.json({ apiKey, notice: 'The previous key stopped working immediately. Copy this one now.' });
    } catch (err: any) { fail(res, err); }
  };

  getDeviceHealth = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.healthSummary());
    } catch (err: any) { fail(res, err); }
  };

  listSyncLogs = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.listSyncLogs(intOf(req.query.deviceId), intOf(req.query.limit) ?? 50));
    } catch (err: any) { fail(res, err); }
  };

  pullDevice = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.devices.pull(requireInt(req.params.id, 'device id'), req.user!.userId);
    } catch (err: any) { fail(res, err); }
  };

  /**
   * Device push endpoint. Authenticated by device code and key rather than a
   * user token, because a terminal has no user session.
   */
  deviceSync = async (req: Request, res: Response): Promise<void> => {
    try {
      const code = (req.get('x-device-code') || (req.body ?? {}).deviceCode || '').toString();
      const key = (req.get('x-device-key') || (req.body ?? {}).apiKey || '').toString();
      if (!code || !key) {
        res.status(401).json({ error: 'Device authentication failed: send x-device-code and x-device-key' });
        return;
      }
      const device = await this.devices.authenticateDevice(code, key);
      const punches = (req.body ?? {}).punches ?? [];
      res.json(await this.devices.ingest(device, punches, null, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  deviceHeartbeat = async (req: Request, res: Response): Promise<void> => {
    try {
      const code = (req.get('x-device-code') || (req.body ?? {}).deviceCode || '').toString();
      const key = (req.get('x-device-key') || (req.body ?? {}).apiKey || '').toString();
      if (!code || !key) {
        res.status(401).json({ error: 'Device authentication failed: send x-device-code and x-device-key' });
        return;
      }
      const device = await this.devices.authenticateDevice(code, key);
      res.json(await this.devices.heartbeat(device, (req.body ?? {}).note ?? null));
    } catch (err: any) { fail(res, err); }
  };

  listEnrollments = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.listEnrollments(intOf(req.query.deviceId), intOf(req.query.employeeId)));
    } catch (err: any) { fail(res, err); }
  };

  createEnrollment = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.devices.enroll(req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  deleteEnrollment = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.removeEnrollment(requireInt(req.params.id, 'enrolment id')));
    } catch (err: any) { fail(res, err); }
  };

  listGeofences = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.listGeofences(req.query.includeInactive === 'true'));
    } catch (err: any) { fail(res, err); }
  };

  createGeofence = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.devices.createGeofence(req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  updateGeofence = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'geofence id');
      res.json(await this.devices.updateGeofence(id, req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  deleteGeofence = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.deleteGeofence(requireInt(req.params.id, 'geofence id'), req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  assignGeofence = async (req: Request, res: Response): Promise<void> => {
    try {
      const { employeeId, geofenceId } = req.body ?? {};
      if (!employeeId || !geofenceId) { res.status(400).json({ error: 'employeeId and geofenceId are required' }); return; }
      res.json(await this.devices.assignGeofence(Number(employeeId), Number(geofenceId), req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  unassignGeofence = async (req: Request, res: Response): Promise<void> => {
    try {
      const { employeeId, geofenceId } = req.body ?? {};
      if (!employeeId || !geofenceId) { res.status(400).json({ error: 'employeeId and geofenceId are required' }); return; }
      res.json(await this.devices.unassignGeofence(Number(employeeId), Number(geofenceId)));
    } catch (err: any) { fail(res, err); }
  };

  issueQr = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.issueQr(requireInt(req.params.id, 'device id'), req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  listCards = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.listCards({
        employeeId: intOf(req.query.employeeId),
        status: req.query.status as string | undefined,
        search: req.query.search as string | undefined,
      }));
    } catch (err: any) { fail(res, err); }
  };

  createCard = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.devices.createCard(req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  updateCardStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'card id');
      const { status, notes } = req.body ?? {};
      if (!status) { res.status(400).json({ error: 'status is required' }); return; }
      res.json(await this.devices.setCardStatus(id, String(status).toUpperCase(), notes ?? null, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  deleteCard = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.deleteCard(requireInt(req.params.id, 'card id')));
    } catch (err: any) { fail(res, err); }
  };

  listFaceEnrollments = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.listFaceEnrollments(intOf(req.query.employeeId)));
    } catch (err: any) { fail(res, err); }
  };

  enrollFace = async (req: Request, res: Response): Promise<void> => {
    try {
      const { employeeId, imageRefs } = req.body ?? {};
      if (!employeeId) { res.status(400).json({ error: 'employeeId is required' }); return; }
      res.json(await this.devices.enrollFace(Number(employeeId), Array.isArray(imageRefs) ? imageRefs : [], req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  listIpRules = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.listIpRules(req.query.includeInactive === 'true'));
    } catch (err: any) { fail(res, err); }
  };

  createIpRule = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.devices.createIpRule(req.body ?? {}, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  deleteIpRule = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.devices.deleteIpRule(requireInt(req.params.id, 'IP rule id')));
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Compliance
  // =========================================================================
  listComplianceRules = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.compliance.listRules(req.query.includeInactive === 'true'));
    } catch (err: any) { fail(res, err); }
  };

  createComplianceRule = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.compliance.createRule(req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  updateComplianceRule = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'rule id');
      res.json(await this.compliance.updateRule(id, req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  deleteComplianceRule = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.compliance.deleteRule(requireInt(req.params.id, 'rule id')));
    } catch (err: any) { fail(res, err); }
  };

  runComplianceScan = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to } = req.body ?? {};
      if (!from) { res.status(400).json({ error: 'from is required (YYYY-MM-DD)' }); return; }
      res.json(await this.compliance.scan(from, to || from, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  listViolations = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.compliance.listViolations({
        status: req.query.status as any,
        severity: req.query.severity as any,
        ruleId: intOf(req.query.ruleId),
        employeeId: intOf(req.query.employeeId),
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        page: intOf(req.query.page),
        pageSize: intOf(req.query.pageSize),
      }));
    } catch (err: any) { fail(res, err); }
  };

  resolveViolation = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'violation id');
      const { status, note } = req.body ?? {};
      if (!status) { res.status(400).json({ error: 'status is required' }); return; }
      res.json(await this.compliance.resolveViolation(
        id, String(status).toUpperCase() as any, note ?? null, req.user!.userId, auditContext(req),
      ));
    } catch (err: any) { fail(res, err); }
  };

  getComplianceSummary = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.compliance.summary());
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Visitors
  // =========================================================================
  listVisitors = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.visitors.listVisitors({
        visitorType: req.query.visitorType as string | undefined,
        search: req.query.search as string | undefined,
        onSiteOnly: req.query.onSiteOnly === 'true',
      }));
    } catch (err: any) { fail(res, err); }
  };

  createVisitor = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.visitors.createVisitor(req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  updateVisitor = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'visitor id');
      res.json(await this.visitors.updateVisitor(id, req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  deleteVisitor = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.visitors.deleteVisitor(requireInt(req.params.id, 'visitor id')));
    } catch (err: any) { fail(res, err); }
  };

  listVisits = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.visitors.listVisits({
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        visitorId: intOf(req.query.visitorId),
        status: req.query.status as string | undefined,
        visitorType: req.query.visitorType as string | undefined,
        branchId: intOf(req.query.branchId),
        page: intOf(req.query.page),
        pageSize: intOf(req.query.pageSize),
      }));
    } catch (err: any) { fail(res, err); }
  };

  createVisit = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.visitors.scheduleVisit(req.body ?? {}, req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  checkInVisit = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.visitors.checkIn(requireInt(req.params.id, 'visit id'), req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  checkOutVisit = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.visitors.checkOut(requireInt(req.params.id, 'visit id'), req.user!.userId, auditContext(req)));
    } catch (err: any) { fail(res, err); }
  };

  setVisitStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = requireInt(req.params.id, 'visit id');
      const { status, remarks } = req.body ?? {};
      if (!status) { res.status(400).json({ error: 'status is required' }); return; }
      res.json(await this.visitors.setStatus(id, String(status).toUpperCase(), remarks ?? null, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  deleteVisit = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.visitors.deleteVisit(requireInt(req.params.id, 'visit id')));
    } catch (err: any) { fail(res, err); }
  };

  getVisitorBoard = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.visitors.board(req.query.date as string | undefined));
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Reports and audit
  // =========================================================================
  listReports = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(this.reports.catalogue());
    } catch (err: any) { fail(res, err); }
  };

  runReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const slug = String(req.params.slug ?? '');
      const params = {
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        employeeId: intOf(req.query.employeeId),
        branchId: intOf(req.query.branchId),
        departmentId: intOf(req.query.departmentId),
        status: req.query.status as string | undefined,
      };
      const result = await this.reports.run(slug, params);

      if (req.query.format === 'csv') {
        const filename = `attendance-${slug}-${result.from}-to-${result.to}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(this.reports.toCsv(result));
        return;
      }
      res.json(result);
    } catch (err: any) { fail(res, err); }
  };

  listAudit = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.auditRepo.list({
        entityType: req.query.entityType as any,
        entityId: intOf(req.query.entityId),
        employeeId: intOf(req.query.employeeId),
        action: req.query.action as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        page: intOf(req.query.page),
        pageSize: intOf(req.query.pageSize),
      }));
    } catch (err: any) { fail(res, err); }
  };

  /** What is switched on in this deployment, and what is not. */
  getCapabilities = async (_req: Request, res: Response): Promise<void> => {
    try {
      const { faceProvider } = await import('../services/FaceRecognitionProvider');
      const { env } = await import('../config/env');
      res.json({
        face: faceProvider.status(),
        qr: { configured: true, rotationSeconds: env.attendance.qrRotationSeconds },
        geofencing: { configured: true, note: 'Distances are computed in process. No external mapping service is called.' },
        nfc: { configured: true, note: 'Cards are matched by UID against the card registry.' },
        biometric: {
          configured: true,
          note: 'Terminals push punches to POST /api/attendance/devices/sync with a device key. No vendor SDK is bundled, so pull sync is unavailable.',
        },
        offlineSync: { configured: true, note: 'Batches replay idempotently on a client-supplied punch id.' },
        realtime: {
          configured: true, transport: 'SSE',
          note: 'Server-sent events at GET /api/attendance/live/stream. Subscribers are held per process, so a multi-instance deployment needs a broker to fan out.',
        },
        notifications: {
          inApp: true,
          email: env.smtp.enabled,
          sms: false,
          whatsapp: false,
          push: false,
          note: env.smtp.enabled
            ? 'In-app and email are live. SMS, WhatsApp and push are not configured.'
            : 'In-app notifications are live. Email needs SMTP_HOST. SMS, WhatsApp and push are not configured.',
        },
        exports: {
          csv: true, pdf: false, excel: false,
          note: 'CSV export is native. PDF and native Excel would each need a document library that is not installed.',
        },
        caching: {
          redis: false,
          note: 'No Redis is configured. Aggregates are computed in SQL with covering indexes rather than cached.',
        },
      });
    } catch (err: any) { fail(res, err); }
  };
}
