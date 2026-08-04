import { Request, Response } from 'express';
import { PayrollAnalyticsService } from '../services/PayrollAnalyticsService';
import { BankPaymentService } from '../services/BankPaymentService';
import { PayslipService } from '../services/PayslipService';
import { TaxDeclarationService } from '../services/TaxDeclarationService';
import { PayrollApprovalService } from '../services/PayrollApprovalService';

/** Errors that are the caller's fault rather than the server's. */
function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/cannot approve|only view|only access|not linked|permission/i.test(message)) return 403;
  if (/required|must |already|invalid|unknown|no active|overlap|locked|capped|no exchange|does not belong|nothing to/i.test(message)) return 400;
  return 500;
}

function intParam(req: Request, name: string): number {
  const value = parseInt(String(req.params[name]), 10);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function optionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Payroll back office: analytics, statutory reports, bank disbursement,
 * tax declarations, approvals, audit, payslips and employee self-service.
 */
export class PayrollAdminController {
  private analytics = new PayrollAnalyticsService();
  private bank = new BankPaymentService();
  private payslips = new PayslipService();
  private tax = new TaxDeclarationService();
  private approvals = new PayrollApprovalService();

  private fail = (res: Response, err: any): void => {
    const message = err?.message ?? 'Unexpected error';
    res.status(statusFor(String(message))).json({ error: message });
  };

  /** Employee id behind a self-service call, or null when the account is unlinked. */
  private selfEmployeeId(req: Request, res: Response): number | null {
    const employeeId = req.user?.employeeId;
    if (!employeeId) {
      res.status(403).json({ error: 'This account is not linked to an employee record' });
      return null;
    }
    return employeeId;
  }

  private auditContext(req: Request) {
    return {
      actorUserId: req.user?.userId ?? null,
      actorName: req.user?.name ?? null,
      actorRole: req.user?.role ?? null,
      ipAddress: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || null,
      userAgent: req.get('user-agent') ?? null,
    };
  }

  // =========================================================================
  // Analytics
  // =========================================================================

  getDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.getDashboard(optionalInt(req.query.periodId)));
    } catch (err) { this.fail(res, err); }
  };

  getCostAnalytics = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.getCostAnalytics({
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      }));
    } catch (err) { this.fail(res, err); }
  };

  getSalaryTrends = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.getSalaryTrends(optionalInt(req.query.employeeId)));
    } catch (err) { this.fail(res, err); }
  };

  getIncrementAnalysis = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.getIncrementAnalysis());
    } catch (err) { this.fail(res, err); }
  };

  getOvertimeAnalysis = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.getOvertimeAnalysis({
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      }));
    } catch (err) { this.fail(res, err); }
  };

  getBonusAnalysis = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.getBonusAnalysis({
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      }));
    } catch (err) { this.fail(res, err); }
  };

  getForecast = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.getForecast(optionalInt(req.query.months) ?? 6));
    } catch (err) { this.fail(res, err); }
  };

  getCompliance = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.getComplianceStatus(intParam(req, 'periodId')));
    } catch (err) { this.fail(res, err); }
  };

  // =========================================================================
  // Reports
  // =========================================================================

  private reportParams(req: Request) {
    return {
      periodId: optionalInt(req.query.periodId),
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      financialYear: req.query.financialYear ? String(req.query.financialYear) : undefined,
      employeeId: optionalInt(req.query.employeeId),
      limit: optionalInt(req.query.limit),
    };
  }

  getReport = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.generateReport(String(req.params.type), this.reportParams(req)));
    } catch (err) { this.fail(res, err); }
  };

  exportReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.analytics.exportCsv(String(req.params.type), this.reportParams(req));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
      res.send(result.csv);
    } catch (err) { this.fail(res, err); }
  };

  queueReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const params = { ...this.reportParams(req), ...(req.body ?? {}) };
      const job = await this.analytics.queueReport(String(req.params.type), params, req.user!.userId);
      res.status(202).json(job);
    } catch (err) { this.fail(res, err); }
  };

  // =========================================================================
  // Bank accounts
  // =========================================================================

  listBankAccounts = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.bank.listAccounts(req.query.includeInactive === 'true'));
    } catch (err) { this.fail(res, err); }
  };

  getBankAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.bank.getAccount(intParam(req, 'id')));
    } catch (err) { this.fail(res, err); }
  };

  createBankAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      const account = await this.bank.createAccount(req.body ?? {}, req.user!.userId);
      await this.analytics.logAudit({
        entityType: 'BANK_ACCOUNT',
        entityId: account.id,
        action: 'CREATE',
        summary: `Added bank account ${account.label}`,
        ...this.auditContext(req),
      });
      res.status(201).json(account);
    } catch (err) { this.fail(res, err); }
  };

  updateBankAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = intParam(req, 'id');
      const before = await this.bank.getAccount(id);
      const account = await this.bank.updateAccount(id, req.body ?? {});
      await this.analytics.logAudit({
        entityType: 'BANK_ACCOUNT',
        entityId: id,
        action: 'UPDATE',
        summary: `Updated bank account ${account.label}`,
        previousValue: before,
        newValue: account,
        ...this.auditContext(req),
      });
      res.json(account);
    } catch (err) { this.fail(res, err); }
  };

  deleteBankAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = intParam(req, 'id');
      await this.bank.deleteAccount(id);
      await this.analytics.logAudit({
        entityType: 'BANK_ACCOUNT',
        entityId: id,
        action: 'DELETE',
        summary: `Retired bank account ${id}`,
        ...this.auditContext(req),
      });
      res.json({ success: true });
    } catch (err) { this.fail(res, err); }
  };

  // =========================================================================
  // Payment batches
  // =========================================================================

  listBatches = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.bank.listBatches({
        periodId: optionalInt(req.query.periodId),
        status: req.query.status ? String(req.query.status) : undefined,
        limit: optionalInt(req.query.limit),
      }));
    } catch (err) { this.fail(res, err); }
  };

  createBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const { periodId, runId, bankAccountId, paymentMode, valueDate } = req.body ?? {};
      if (!periodId) {
        res.status(400).json({ error: 'periodId is required' });
        return;
      }
      const result = await this.bank.generateBatch(
        Number(periodId),
        {
          runId: runId ? Number(runId) : null,
          bankAccountId: bankAccountId ? Number(bankAccountId) : null,
          paymentMode,
          valueDate: valueDate ?? null,
        },
        req.user!.userId,
      );
      await this.analytics.logAudit({
        entityType: 'PAYMENT_BATCH',
        entityId: result.batch.id,
        periodId: Number(periodId),
        action: 'CREATE',
        summary: `Generated batch ${result.batch.batchNo}: ${result.batch.totalRecords} payable, ${result.invalidItems.length} excluded`,
        ...this.auditContext(req),
      });
      res.status(201).json(result);
    } catch (err) { this.fail(res, err); }
  };

  getBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.bank.getBatch(intParam(req, 'id')));
    } catch (err) { this.fail(res, err); }
  };

  exportBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = intParam(req, 'id');
      const file = await this.bank.exportBatchFile(id);
      await this.analytics.logAudit({
        entityType: 'PAYMENT_BATCH',
        entityId: id,
        action: 'EXPORT',
        summary: `Exported ${file.recordCount} records totalling ${file.totalAmount}`,
        ...this.auditContext(req),
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.send(file.csv);
    } catch (err) { this.fail(res, err); }
  };

  markBatchSent = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = intParam(req, 'id');
      const batch = await this.bank.markBatchSent(id);
      await this.analytics.logAudit({
        entityType: 'PAYMENT_BATCH',
        entityId: id,
        action: 'SEND',
        summary: `Marked batch ${batch.batchNo} as sent to the bank`,
        ...this.auditContext(req),
      });
      res.json(batch);
    } catch (err) { this.fail(res, err); }
  };

  recordBatchResults = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = intParam(req, 'id');
      const results = Array.isArray(req.body?.results) ? req.body.results : req.body;
      const batch = await this.bank.recordPaymentResults(id, results);
      await this.analytics.logAudit({
        entityType: 'PAYMENT_BATCH',
        entityId: id,
        action: 'RECONCILE',
        summary: `Recorded results for ${batch.batchNo}: ${batch.successCount} paid, ${batch.failedCount} failed`,
        ...this.auditContext(req),
      });
      res.json(batch);
    } catch (err) { this.fail(res, err); }
  };

  retryBatch = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = intParam(req, 'id');
      const result = await this.bank.retryFailed(id, req.user!.userId);
      await this.analytics.logAudit({
        entityType: 'PAYMENT_BATCH',
        entityId: result.batch.id,
        action: 'RETRY',
        summary: `Retried failed payments from batch ${id} as ${result.batch.batchNo}`,
        ...this.auditContext(req),
      });
      res.status(201).json(result);
    } catch (err) { this.fail(res, err); }
  };

  // =========================================================================
  // Currencies and exchange rates
  // =========================================================================

  listCurrencies = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.bank.listCurrencies(req.query.includeInactive === 'true'));
    } catch (err) { this.fail(res, err); }
  };

  listExchangeRates = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.bank.listRates({
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        limit: optionalInt(req.query.limit),
      }));
    } catch (err) { this.fail(res, err); }
  };

  upsertExchangeRate = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.bank.upsertRate(req.body ?? {}, req.user!.userId));
    } catch (err) { this.fail(res, err); }
  };

  convertCurrency = async (req: Request, res: Response): Promise<void> => {
    try {
      const amount = Number(req.query.amount);
      if (!Number.isFinite(amount)) {
        res.status(400).json({ error: 'amount must be a number' });
        return;
      }
      res.json(await this.bank.convert(
        amount,
        String(req.query.from ?? ''),
        String(req.query.to ?? ''),
        req.query.onDate ? String(req.query.onDate) : undefined,
      ));
    } catch (err) { this.fail(res, err); }
  };

  // =========================================================================
  // Tax configuration
  // =========================================================================

  listRegimes = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.tax.listRegimes(
        req.query.financialYear ? String(req.query.financialYear) : undefined,
        req.query.includeInactive === 'true',
      ));
    } catch (err) { this.fail(res, err); }
  };

  getRegime = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.tax.getRegime(intParam(req, 'id')));
    } catch (err) { this.fail(res, err); }
  };

  listSlabs = async (req: Request, res: Response): Promise<void> => {
    try {
      const regimeId = optionalInt(req.query.regimeId);
      if (!regimeId) {
        res.status(400).json({ error: 'regimeId is required' });
        return;
      }
      res.json(await this.tax.listSlabs(regimeId));
    } catch (err) { this.fail(res, err); }
  };

  createSlab = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.tax.createSlab(req.body ?? {}));
    } catch (err) { this.fail(res, err); }
  };

  updateSlab = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.tax.updateSlab(intParam(req, 'id'), req.body ?? {}));
    } catch (err) { this.fail(res, err); }
  };

  deleteSlab = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.tax.deleteSlab(intParam(req, 'id')));
    } catch (err) { this.fail(res, err); }
  };

  listSections = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.tax.listSections(req.query.includeInactive === 'true'));
    } catch (err) { this.fail(res, err); }
  };

  createSection = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.tax.createSection(req.body ?? {}));
    } catch (err) { this.fail(res, err); }
  };

  updateSection = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.tax.updateSection(intParam(req, 'id'), req.body ?? {}));
    } catch (err) { this.fail(res, err); }
  };

  deleteSection = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.tax.deleteSection(intParam(req, 'id')));
    } catch (err) { this.fail(res, err); }
  };

  // =========================================================================
  // Tax declarations
  // =========================================================================

  getDeclaration = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.tax.getDeclaration(intParam(req, 'employeeId'), String(req.params.fy)));
    } catch (err) { this.fail(res, err); }
  };

  saveDeclaration = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = intParam(req, 'employeeId');
      const fy = String(req.params.fy);
      const declaration = await this.tax.saveDeclaration(employeeId, fy, req.body ?? { items: [] }, req.user!.userId);
      await this.analytics.logAudit({
        entityType: 'TAX_DECLARATION',
        entityId: declaration.id,
        employeeId,
        action: 'SAVE',
        summary: `Saved ${fy} tax declaration, total declared ${declaration.totalDeclared}`,
        ...this.auditContext(req),
      });
      res.json(declaration);
    } catch (err) { this.fail(res, err); }
  };

  submitDeclaration = async (req: Request, res: Response): Promise<void> => {
    try {
      const declaration = await this.tax.submitById(intParam(req, 'id'));
      await this.analytics.logAudit({
        entityType: 'TAX_DECLARATION',
        entityId: declaration.id,
        employeeId: declaration.employeeId,
        action: 'SUBMIT',
        summary: `Submitted ${declaration.financialYear} tax declaration`,
        ...this.auditContext(req),
      });
      res.json(declaration);
    } catch (err) { this.fail(res, err); }
  };

  verifyDeclaration = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = intParam(req, 'id');
      const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : [];
      const declaration = await this.tax.verify(id, req.user!.userId, decisions);
      await this.analytics.logAudit({
        entityType: 'TAX_DECLARATION',
        entityId: id,
        employeeId: declaration.employeeId,
        action: 'VERIFY',
        summary: `Verified ${declaration.financialYear} declaration, approved ${declaration.totalApproved}`,
        ...this.auditContext(req),
      });
      res.json(declaration);
    } catch (err) { this.fail(res, err); }
  };

  rejectDeclaration = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = intParam(req, 'id');
      const declaration = await this.tax.reject(id, req.user!.userId, String(req.body?.reason ?? ''));
      await this.analytics.logAudit({
        entityType: 'TAX_DECLARATION',
        entityId: id,
        employeeId: declaration.employeeId,
        action: 'REJECT',
        summary: `Rejected ${declaration.financialYear} declaration`,
        newValue: req.body?.reason ?? null,
        ...this.auditContext(req),
      });
      res.json(declaration);
    } catch (err) { this.fail(res, err); }
  };

  listDeclarations = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.tax.listDeclarations({
        financialYear: req.query.financialYear ? String(req.query.financialYear) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        limit: optionalInt(req.query.limit),
      }));
    } catch (err) { this.fail(res, err); }
  };

  getComputation = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.tax.getComputation(intParam(req, 'employeeId'), String(req.params.fy)));
    } catch (err) { this.fail(res, err); }
  };

  recomputeTax = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.tax.recompute(intParam(req, 'employeeId'), String(req.params.fy)));
    } catch (err) { this.fail(res, err); }
  };

  getForm16 = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.tax.getForm16Data(intParam(req, 'employeeId'), String(req.params.fy)));
    } catch (err) { this.fail(res, err); }
  };

  // =========================================================================
  // Approvals
  // =========================================================================

  listPendingApprovals = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.approvals.listPending(req.user!.role, optionalInt(req.query.limit)));
    } catch (err) { this.fail(res, err); }
  };

  actOnApproval = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = intParam(req, 'id');
      const action = String(req.body?.action ?? '').toUpperCase();
      if (action !== 'APPROVE' && action !== 'REJECT') {
        res.status(400).json({ error: "Action must be either 'APPROVE' or 'REJECT'" });
        return;
      }
      const request = await this.approvals.act(id, action, req.user!.userId, req.user!.role, req.body?.comments ?? null);
      await this.analytics.logAudit({
        entityType: request.entityType,
        entityId: request.entityId,
        action,
        summary: `${action === 'APPROVE' ? 'Approved' : 'Rejected'} "${request.title}"`,
        ...this.auditContext(req),
      });
      res.json(request);
    } catch (err) { this.fail(res, err); }
  };

  getEntityApprovals = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.approvals.getForEntity(String(req.params.type).toUpperCase(), intParam(req, 'id')));
    } catch (err) { this.fail(res, err); }
  };

  cancelApproval = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.approvals.cancel(intParam(req, 'id'), req.user!.userId));
    } catch (err) { this.fail(res, err); }
  };

  // =========================================================================
  // Audit
  // =========================================================================

  listAudit = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.listAudit({
        entityType: req.query.entityType ? String(req.query.entityType) : undefined,
        entityId: optionalInt(req.query.entityId),
        employeeId: optionalInt(req.query.employeeId),
        periodId: optionalInt(req.query.periodId),
        action: req.query.action ? String(req.query.action) : undefined,
        actorUserId: optionalInt(req.query.actorUserId),
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        page: optionalInt(req.query.page),
        pageSize: optionalInt(req.query.pageSize),
      }));
    } catch (err) { this.fail(res, err); }
  };

  // =========================================================================
  // Payslips
  // =========================================================================

  getPayslip = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.payslips.getPayslipData(intParam(req, 'lineId')));
    } catch (err) { this.fail(res, err); }
  };

  getPayslipPdf = async (req: Request, res: Response): Promise<void> => {
    try {
      const lineId = intParam(req, 'lineId');
      const result = await this.payslips.generatePdf(lineId, { password: req.query.password === 'true' });
      this.streamPdf(res, result);
    } catch (err) { this.fail(res, err); }
  };

  bulkPayslips = async (req: Request, res: Response): Promise<void> => {
    try {
      const { periodId, employeeIds } = req.body ?? {};
      if (!periodId) {
        res.status(400).json({ error: 'periodId is required' });
        return;
      }
      const job = await this.payslips.bulkGenerate(
        Number(periodId),
        Array.isArray(employeeIds) ? employeeIds.map(Number) : undefined,
        req.user!.userId,
      );
      res.status(202).json(job);
    } catch (err) { this.fail(res, err); }
  };

  /**
   * Verification is mounted behind `authenticate` here. A genuinely public
   * scan-to-verify endpoint would have to be mounted outside this router.
   */
  verifyPayslip = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.payslips.verifyPayslip(String(req.params.token)));
    } catch (err) { this.fail(res, err); }
  };

  // =========================================================================
  // Employee self service
  // =========================================================================

  myPayslips = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.selfEmployeeId(req, res);
      if (employeeId === null) return;
      res.json(await this.analytics.listPayslipsForEmployee(employeeId, optionalInt(req.query.limit)));
    } catch (err) { this.fail(res, err); }
  };

  myPayslipPdf = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.selfEmployeeId(req, res);
      if (employeeId === null) return;
      const lineId = intParam(req, 'lineId');
      await this.analytics.assertLineBelongsTo(lineId, employeeId);
      // Self-service downloads are password protected by default: they travel
      // through personal inboxes far more often than the admin copies do.
      const result = await this.payslips.generatePdf(lineId, { password: req.query.password !== 'false' });
      this.streamPdf(res, result);
    } catch (err) { this.fail(res, err); }
  };

  myTaxDeclaration = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.selfEmployeeId(req, res);
      if (employeeId === null) return;
      res.json(await this.tax.getDeclaration(employeeId, String(req.params.fy)));
    } catch (err) { this.fail(res, err); }
  };

  saveMyTaxDeclaration = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.selfEmployeeId(req, res);
      if (employeeId === null) return;
      const fy = String(req.params.fy);
      const declaration = await this.tax.saveDeclaration(employeeId, fy, req.body ?? { items: [] }, req.user!.userId);
      await this.analytics.logAudit({
        entityType: 'TAX_DECLARATION',
        entityId: declaration.id,
        employeeId,
        action: 'SAVE',
        summary: `Employee saved their ${fy} tax declaration`,
        ...this.auditContext(req),
      });
      res.json(declaration);
    } catch (err) { this.fail(res, err); }
  };

  mySalaryHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.selfEmployeeId(req, res);
      if (employeeId === null) return;
      res.json(await this.analytics.getSalaryHistory(employeeId));
    } catch (err) { this.fail(res, err); }
  };

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private streamPdf(
    res: Response,
    result: { buffer: Buffer; fileName: string; passwordProtected: boolean; passwordHint: string | null },
  ): void {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.setHeader('Content-Length', String(result.buffer.length));
    // Headers, not body: the caller needs to know whether a password is set and
    // what it is derived from without opening the file first.
    res.setHeader('X-Payslip-Password-Protected', String(result.passwordProtected));
    if (result.passwordHint) res.setHeader('X-Payslip-Password-Hint', result.passwordHint);
    res.setHeader('X-Payslip-Digitally-Signed', 'false');
    res.end(result.buffer);
  }
}
