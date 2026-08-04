import { Request, Response } from 'express';
import { ComplianceCalendarService } from '../services/ComplianceCalendarService';
import { ComplianceCheckService } from '../services/ComplianceCheckService';
import { ComplianceAuditService } from '../services/ComplianceAuditService';
import { ComplianceAnalyticsService } from '../services/ComplianceAnalyticsService';
import { TaxCalculatorService } from '../services/TaxCalculatorService';
import { TaxProofService } from '../services/TaxProofService';

/**
 * Rule violations the services raise deliberately are the caller's to fix, so
 * they come back as 4xx. Anything else is ours and comes back as 500.
 */
const CLIENT_ERROR = new RegExp(
  '^(A |An |At least|Annual|Approved|Bulk|Claimed|Close |Deductions|Each |Financial year|Month|No |Regime|Status|'
  + 'That |The |This |Unknown|Verified|Rent |\\d+ findings)',
);

function fail(res: Response, err: any): void {
  const message = err?.message ?? 'Unexpected error';
  if (/not found$/i.test(message)) { res.status(404).json({ error: message }); return; }
  if (CLIENT_ERROR.test(message)) { res.status(400).json({ error: message }); return; }
  res.status(500).json({ error: message });
}

function intParam(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function optionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function optionalBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'true' || value === true || value === '1' || value === 1) return true;
  if (value === 'false' || value === false || value === '0' || value === 0) return false;
  return undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const FY_PATTERN = /^\d{4}-\d{4}$/;

function requireFy(value: unknown): string {
  const fy = String(value ?? '').trim();
  if (!FY_PATTERN.test(fy)) throw new Error("Financial year must look like '2026-2027'");
  return fy;
}

function optionalFy(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireFy(value);
}

export class ComplianceController {
  private calendar = new ComplianceCalendarService();
  private checks = new ComplianceCheckService();
  private audits = new ComplianceAuditService();
  private analytics = new ComplianceAnalyticsService();
  private calculator = new TaxCalculatorService();
  private proofs = new TaxProofService();

  /** Rejects a path id that is not a number, before it ever reaches SQL. */
  private idOr400(res: Response, value: unknown, label = 'id'): number | null {
    const id = intParam(value);
    if (id === null || id <= 0) {
      res.status(400).json({ error: `A numeric ${label} is required` });
      return null;
    }
    return id;
  }

  /** Self-service endpoints only work for an account tied to an employee. */
  private employeeOr403(req: Request, res: Response): number | null {
    const employeeId = req.user?.employeeId;
    if (!employeeId) {
      res.status(403).json({ error: 'This account is not linked to an employee record' });
      return null;
    }
    return employeeId;
  }

  // =========================================================================
  // Analytics
  // =========================================================================

  getDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.getDashboard(optionalFy(req.query.financialYear)));
    } catch (err: any) { fail(res, err); }
  };

  getTaxAnalytics = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.getTaxAnalytics(requireFy(req.query.financialYear ?? req.query.fy)));
    } catch (err: any) { fail(res, err); }
  };

  getContributionTrends = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.getContributionTrends({
        from: str(req.query.from),
        to: str(req.query.to),
      }));
    } catch (err: any) { fail(res, err); }
  };

  getFilingStatusAnalytics = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.getFilingStatus(requireFy(req.query.financialYear ?? req.query.fy)));
    } catch (err: any) { fail(res, err); }
  };

  getForecast = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.getForecast(optionalInt(req.query.months) ?? 6));
    } catch (err: any) { fail(res, err); }
  };

  getScore = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.checks.getComplianceScore(requireFy(req.query.financialYear ?? req.query.fy)));
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Calendar
  // =========================================================================

  getCalendar = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.calendar.getCalendar({
        financialYear: optionalFy(req.query.financialYear ?? req.query.fy),
        month: str(req.query.month),
        status: str(req.query.status),
        category: str(req.query.category),
        obligationId: optionalInt(req.query.obligationId),
        ownerUserId: optionalInt(req.query.ownerUserId),
        limit: optionalInt(req.query.limit),
      }));
    } catch (err: any) { fail(res, err); }
  };

  generateCalendar = async (req: Request, res: Response): Promise<void> => {
    try {
      const fy = requireFy(req.body?.financialYear ?? req.query.financialYear);
      res.json(await this.calendar.generateCalendar(fy, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  refreshCalendar = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.calendar.refreshStatuses());
    } catch (err: any) { fail(res, err); }
  };

  getUpcoming = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.calendar.getUpcoming(optionalInt(req.query.days) ?? 30));
    } catch (err: any) { fail(res, err); }
  };

  getOverdue = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.calendar.getOverdue());
    } catch (err: any) { fail(res, err); }
  };

  completeCalendarEntry = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'calendar entry id');
    if (id === null) return;
    try {
      res.json(await this.calendar.markCompleted(id, {
        completedOn: str(req.body?.completedOn),
        filingId: optionalInt(req.body?.filingId) ?? null,
        challanId: optionalInt(req.body?.challanId) ?? null,
        remarks: req.body?.remarks ?? null,
      }, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  markCalendarNotApplicable = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'calendar entry id');
    if (id === null) return;
    try {
      res.json(await this.calendar.markNotApplicable(id, String(req.body?.reason ?? ''), req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  waiveCalendarEntry = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'calendar entry id');
    if (id === null) return;
    try {
      res.json(await this.calendar.waive(id, String(req.body?.reason ?? ''), req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  extendCalendarEntry = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'calendar entry id');
    if (id === null) return;
    try {
      res.json(await this.calendar.extend(
        id,
        String(req.body?.newDueDate ?? req.body?.dueDate ?? ''),
        String(req.body?.reason ?? ''),
        req.user!.userId,
      ));
    } catch (err: any) { fail(res, err); }
  };

  assignCalendarEntry = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'calendar entry id');
    if (id === null) return;
    const ownerUserId = intParam(req.body?.ownerUserId ?? req.body?.userId);
    if (ownerUserId === null || ownerUserId <= 0) {
      res.status(400).json({ error: 'A numeric owner user id is required' });
      return;
    }
    try {
      res.json(await this.calendar.assignOwner(id, ownerUserId, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  sendCalendarReminders = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.calendar.sendReminders());
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Obligations
  // =========================================================================

  listObligations = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.calendar.listObligations({
        category: str(req.query.category),
        frequency: str(req.query.frequency),
        isActive: optionalBool(req.query.isActive),
      }));
    } catch (err: any) { fail(res, err); }
  };

  createObligation = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.calendar.createObligation(req.body ?? {}, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  updateObligation = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'obligation id');
    if (id === null) return;
    try {
      res.json(await this.calendar.updateObligation(id, req.body ?? {}));
    } catch (err: any) { fail(res, err); }
  };

  deleteObligation = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'obligation id');
    if (id === null) return;
    try {
      res.json(await this.calendar.deleteObligation(id));
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Checklist engine
  // =========================================================================

  runChecks = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.checks.runChecks({
        periodId: optionalInt(req.body?.periodId),
        financialYear: optionalFy(req.body?.financialYear),
        auditId: optionalInt(req.body?.auditId),
      }, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  getCheckResults = async (req: Request, res: Response): Promise<void> => {
    try {
      const latestOnly = optionalBool(req.query.latest);
      if (latestOnly) {
        res.json(await this.checks.getLatestResults({
          financialYear: optionalFy(req.query.financialYear ?? req.query.fy),
          periodId: optionalInt(req.query.periodId),
        }));
        return;
      }
      res.json(await this.checks.listResults({
        financialYear: optionalFy(req.query.financialYear ?? req.query.fy),
        periodId: optionalInt(req.query.periodId),
        auditId: optionalInt(req.query.auditId),
        result: str(req.query.result),
        ruleCode: str(req.query.ruleCode),
        limit: optionalInt(req.query.limit),
      }));
    } catch (err: any) { fail(res, err); }
  };

  listChecklistItems = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.checks.listItems({
        category: str(req.query.category),
        isAutomated: optionalBool(req.query.isAutomated),
        isActive: optionalBool(req.query.isActive),
      }));
    } catch (err: any) { fail(res, err); }
  };

  createChecklistItem = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.checks.createItem(req.body ?? {}));
    } catch (err: any) { fail(res, err); }
  };

  updateChecklistItem = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'checklist item id');
    if (id === null) return;
    try {
      res.json(await this.checks.updateItem(id, req.body ?? {}));
    } catch (err: any) { fail(res, err); }
  };

  raiseFindings = async (req: Request, res: Response): Promise<void> => {
    try {
      const ids = Array.isArray(req.body?.resultIds) ? req.body.resultIds : [];
      res.json(await this.checks.autoRaiseFindings(ids, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Audits
  // =========================================================================

  listAudits = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.audits.listAudits({
        status: str(req.query.status),
        auditType: str(req.query.auditType),
        financialYear: optionalFy(req.query.financialYear ?? req.query.fy),
        limit: optionalInt(req.query.limit),
      }));
    } catch (err: any) { fail(res, err); }
  };

  createAudit = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.audits.createAudit(req.body ?? {}, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  getAudit = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'audit id');
    if (id === null) return;
    try {
      res.json(await this.audits.getAudit(id));
    } catch (err: any) { fail(res, err); }
  };

  updateAudit = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'audit id');
    if (id === null) return;
    try {
      res.json(await this.audits.updateAudit(id, req.body ?? {}, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  closeAudit = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'audit id');
    if (id === null) return;
    try {
      res.json(await this.audits.closeAudit(id, req.user!.userId, str(req.body?.summary)));
    } catch (err: any) { fail(res, err); }
  };

  deleteAudit = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'audit id');
    if (id === null) return;
    try {
      res.json(await this.audits.deleteAudit(id, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Findings and actions
  // =========================================================================

  listFindings = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.audits.listFindings({
        auditId: optionalInt(req.query.auditId),
        status: str(req.query.status),
        severity: str(req.query.severity),
        category: str(req.query.category),
        ruleCode: str(req.query.ruleCode),
        isAutomated: optionalBool(req.query.isAutomated),
        ownerUserId: optionalInt(req.query.ownerUserId),
        limit: optionalInt(req.query.limit),
      }));
    } catch (err: any) { fail(res, err); }
  };

  createFinding = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.audits.createFinding(req.body ?? {}, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  getFindingsSummary = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.audits.getFindingsSummary());
    } catch (err: any) { fail(res, err); }
  };

  getFinding = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'finding id');
    if (id === null) return;
    try {
      res.json(await this.audits.getFinding(id));
    } catch (err: any) { fail(res, err); }
  };

  updateFinding = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'finding id');
    if (id === null) return;
    try {
      res.json(await this.audits.updateFinding(id, req.body ?? {}, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  closeFinding = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'finding id');
    if (id === null) return;
    try {
      res.json(await this.audits.closeFinding(id, req.user!.userId, str(req.body?.note)));
    } catch (err: any) { fail(res, err); }
  };

  listActions = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'finding id');
    if (id === null) return;
    try {
      res.json(await this.audits.listActions(id, { status: str(req.query.status), limit: optionalInt(req.query.limit) }));
    } catch (err: any) { fail(res, err); }
  };

  createAction = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'finding id');
    if (id === null) return;
    try {
      res.status(201).json(await this.audits.createAction(id, req.body ?? {}, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  updateAction = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'action id');
    if (id === null) return;
    try {
      res.json(await this.audits.updateAction(id, req.body ?? {}, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Proofs
  // =========================================================================

  listProofs = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.proofs.listProofs({
        employeeId: optionalInt(req.query.employeeId),
        financialYear: optionalFy(req.query.financialYear ?? req.query.fy),
        status: str(req.query.status),
        proofType: str(req.query.proofType),
        limit: optionalInt(req.query.limit),
      }));
    } catch (err: any) { fail(res, err); }
  };

  reviewProof = async (req: Request, res: Response): Promise<void> => {
    const id = this.idOr400(res, req.params.id, 'proof id');
    if (id === null) return;
    try {
      res.json(await this.proofs.reviewProof(id, {
        status: req.body?.status,
        verifiedAmount: req.body?.verifiedAmount,
        note: req.body?.note ?? null,
      }, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  bulkReviewProofs = async (req: Request, res: Response): Promise<void> => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      res.json(await this.proofs.bulkReview(ids, String(req.body?.status ?? ''), req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  getProofPendingSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.proofs.getPendingSummary(optionalFy(req.query.financialYear ?? req.query.fy)));
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // HRA
  // =========================================================================

  getHra = async (req: Request, res: Response): Promise<void> => {
    const employeeId = this.idOr400(res, req.params.employeeId, 'employee id');
    if (employeeId === null) return;
    try {
      res.json(await this.proofs.getHraDeclaration(employeeId, String(req.params.fy)));
    } catch (err: any) { fail(res, err); }
  };

  saveHra = async (req: Request, res: Response): Promise<void> => {
    const employeeId = this.idOr400(res, req.params.employeeId, 'employee id');
    if (employeeId === null) return;
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : Array.isArray(req.body) ? req.body : [];
      res.json(await this.proofs.saveHraDeclaration(employeeId, String(req.params.fy), rows, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  getHraExemption = async (req: Request, res: Response): Promise<void> => {
    const employeeId = this.idOr400(res, req.params.employeeId, 'employee id');
    if (employeeId === null) return;
    try {
      res.json(await this.proofs.computeHraExemption(employeeId, String(req.params.fy)));
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Calculator
  // =========================================================================

  compareRegimes = async (req: Request, res: Response): Promise<void> => {
    const employeeId = this.idOr400(res, req.params.employeeId, 'employee id');
    if (employeeId === null) return;
    try {
      res.json(await this.calculator.compareRegimes(employeeId, String(req.params.fy)));
    } catch (err: any) { fail(res, err); }
  };

  calculate = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.calculator.calculate({
        annualGross: Number(req.body?.annualGross),
        regimeCode: str(req.body?.regimeCode),
        financialYear: String(req.body?.financialYear ?? ''),
        deductions: req.body?.deductions,
      }));
    } catch (err: any) { fail(res, err); }
  };

  getTakeHome = async (req: Request, res: Response): Promise<void> => {
    const employeeId = this.idOr400(res, req.params.employeeId, 'employee id');
    if (employeeId === null) return;
    try {
      res.json(await this.calculator.projectTakeHome(employeeId, String(req.params.fy)));
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Reports
  // =========================================================================

  getReport = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.generateReport(String(req.params.type), {
        financialYear: optionalFy(req.query.financialYear ?? req.query.fy),
        monthKey: str(req.query.month ?? req.query.monthKey),
        status: str(req.query.status),
        auditId: optionalInt(req.query.auditId),
        limit: optionalInt(req.query.limit),
      }));
    } catch (err: any) { fail(res, err); }
  };

  exportReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.analytics.exportCsv(String(req.params.type), {
        financialYear: optionalFy(req.query.financialYear ?? req.query.fy),
        monthKey: str(req.query.month ?? req.query.monthKey),
        status: str(req.query.status),
        auditId: optionalInt(req.query.auditId),
        limit: optionalInt(req.query.limit),
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
      res.send(result.csv);
    } catch (err: any) { fail(res, err); }
  };

  // =========================================================================
  // Employee self-service
  // =========================================================================

  getMyTaxSummary = async (req: Request, res: Response): Promise<void> => {
    const employeeId = this.employeeOr403(req, res);
    if (employeeId === null) return;
    try {
      const fy = requireFy(req.params.fy);
      const [takeHome, proofs, hra] = await Promise.all([
        this.calculator.projectTakeHome(employeeId, fy),
        this.proofs.listProofs({ employeeId, financialYear: fy }),
        this.proofs.computeHraExemption(employeeId, fy),
      ]);
      res.json({
        employeeId,
        financialYear: fy,
        takeHome,
        proofs: {
          total: proofs.length,
          pending: proofs.filter((p) => p.status === 'SUBMITTED' || p.status === 'UNDER_REVIEW').length,
          approved: proofs.filter((p) => p.status === 'APPROVED' || p.status === 'PARTIALLY_APPROVED').length,
          rejected: proofs.filter((p) => p.status === 'REJECTED').length,
          items: proofs,
        },
        hraExemption: hra,
      });
    } catch (err: any) { fail(res, err); }
  };

  getMyProofs = async (req: Request, res: Response): Promise<void> => {
    const employeeId = this.employeeOr403(req, res);
    if (employeeId === null) return;
    try {
      res.json(await this.proofs.listProofs({
        employeeId,
        financialYear: optionalFy(req.query.financialYear ?? req.query.fy),
        status: str(req.query.status),
      }));
    } catch (err: any) { fail(res, err); }
  };

  submitMyProof = async (req: Request, res: Response): Promise<void> => {
    const employeeId = this.employeeOr403(req, res);
    if (employeeId === null) return;
    try {
      res.status(201).json(await this.proofs.submitProof(employeeId, {
        declarationItemId: optionalInt(req.body?.declarationItemId) ?? null,
        proofType: req.body?.proofType,
        title: String(req.body?.title ?? ''),
        claimedAmount: Number(req.body?.claimedAmount ?? 0),
        documentId: optionalInt(req.body?.documentId) ?? null,
        financialYear: String(req.body?.financialYear ?? ''),
      }, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  getMyHra = async (req: Request, res: Response): Promise<void> => {
    const employeeId = this.employeeOr403(req, res);
    if (employeeId === null) return;
    try {
      const fy = requireFy(req.params.fy);
      const [rows, exemption] = await Promise.all([
        this.proofs.getHraDeclaration(employeeId, fy),
        this.proofs.computeHraExemption(employeeId, fy),
      ]);
      res.json({ rows, exemption });
    } catch (err: any) { fail(res, err); }
  };

  saveMyHra = async (req: Request, res: Response): Promise<void> => {
    const employeeId = this.employeeOr403(req, res);
    if (employeeId === null) return;
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : Array.isArray(req.body) ? req.body : [];
      res.json(await this.proofs.saveHraDeclaration(employeeId, String(req.params.fy), rows, req.user!.userId));
    } catch (err: any) { fail(res, err); }
  };

  getMyRegimeComparison = async (req: Request, res: Response): Promise<void> => {
    const employeeId = this.employeeOr403(req, res);
    if (employeeId === null) return;
    try {
      res.json(await this.calculator.compareRegimes(employeeId, String(req.params.fy)));
    } catch (err: any) { fail(res, err); }
  };
}
