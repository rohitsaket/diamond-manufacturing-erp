import { Request, Response } from 'express';
import { StatutoryRepository } from '../repositories/StatutoryRepository';
import { ChallanService } from '../services/ChallanService';
import { Form16Service } from '../services/Form16Service';
import { RegulatoryFilingService } from '../services/RegulatoryFilingService';
import { StatutoryContributionService } from '../services/StatutoryContributionService';
import { ComplianceAuditInput } from '../types/compliance';
import { todayString } from '../utils/dateUtils';

const MONTH_KEY = /^\d{4}-\d{2}$/;
const FINANCIAL_YEAR = /^\d{4}-\d{4}$/;

/** Errors that are the caller's fault rather than the server's. */
function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/already exists|already been filed|already .*(paid|acknowledged)|cannot be/i.test(message)) return 409;
  if (/required|must |invalid|unknown|expected|no .*(configuration|contributions|salary lines|payroll data)/i.test(message)) return 400;
  return 500;
}

/**
 * Statutory compliance: configuration, the contribution ledger, challans,
 * government return files and Form 16.
 *
 * Every handler is an arrow-function property so the router can pass it by
 * reference, and every write is mirrored into `payroll_audit_logs` with the
 * actor, their address and their user agent — these figures go to government
 * portals, so who changed what has to be answerable years later.
 */
export class StatutoryController {
  private master = new StatutoryRepository();
  private ledger = new StatutoryContributionService();
  private challans = new ChallanService();
  private filings = new RegulatoryFilingService();
  private form16 = new Form16Service();

  // =========================================================================
  // Scheme configuration
  // =========================================================================

  listConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const scheme = req.query.scheme ? String(req.query.scheme) : undefined;
      res.json(await this.master.findConfigs(scheme));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  createConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!body.scheme || !body.effectiveFrom) {
        res.status(400).json({ error: 'scheme and effectiveFrom are required' });
        return;
      }
      const id = await this.master.createConfig(body, req.user!.userId);
      await this.audit(req, { entityType: 'STATUTORY_CONFIG', entityId: id, action: 'CREATE', summary: `Created ${body.scheme} configuration effective ${body.effectiveFrom}`, newValue: body });
      res.status(201).json(await this.master.findConfigById(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  updateConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id ?? req.body?.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric configuration id is required' });
        return;
      }
      const before = await this.master.findConfigById(id);
      if (!before) {
        res.status(404).json({ error: `Statutory configuration ${id} was not found` });
        return;
      }
      await this.master.updateConfig(id, req.body ?? {});
      await this.audit(req, { entityType: 'STATUTORY_CONFIG', entityId: id, action: 'UPDATE', summary: `Updated ${before.scheme} configuration`, previousValue: before, newValue: req.body });
      res.json(await this.master.findConfigById(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Professional tax
  // =========================================================================

  listPtRules = async (req: Request, res: Response): Promise<void> => {
    try {
      const stateCode = req.query.stateCode ? String(req.query.stateCode).toUpperCase() : undefined;
      const rules = await this.master.findPtRules(stateCode);
      const slabs = await this.master.findPtSlabs();
      res.json(rules.map((rule) => ({ ...rule, slabs: slabs.filter((s) => s.rule_id === rule.id) })));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  createPtRule = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!body.stateCode || !body.stateName || !body.effectiveFrom) {
        res.status(400).json({ error: 'stateCode, stateName and effectiveFrom are required' });
        return;
      }
      const id = await this.master.createPtRule(body, req.user!.userId);
      if (Array.isArray(body.slabs) && body.slabs.length > 0) await this.master.replacePtSlabs(id, body.slabs);
      await this.audit(req, { entityType: 'PT_RULE', entityId: id, action: 'CREATE', summary: `Created professional tax rule for ${body.stateCode}`, newValue: body });
      res.status(201).json(await this.master.findPtRuleById(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  updatePtRule = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id ?? req.body?.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric rule id is required' });
        return;
      }
      const before = await this.master.findPtRuleById(id);
      if (!before) {
        res.status(404).json({ error: `Professional tax rule ${id} was not found` });
        return;
      }
      await this.master.updatePtRule(id, req.body ?? {});
      await this.audit(req, { entityType: 'PT_RULE', entityId: id, action: 'UPDATE', summary: `Updated professional tax rule for ${before.state_code}`, previousValue: before, newValue: req.body });
      res.json(await this.master.findPtRuleById(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  listPtSlabs = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric rule id is required' });
        return;
      }
      res.json(await this.master.findPtSlabs(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  replacePtSlabs = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric rule id is required' });
        return;
      }
      const slabs = Array.isArray(req.body?.slabs) ? req.body.slabs : req.body;
      if (!Array.isArray(slabs)) {
        res.status(400).json({ error: 'A slabs array is required' });
        return;
      }
      const before = await this.master.findPtSlabs(id);
      await this.master.replacePtSlabs(id, slabs);
      await this.audit(req, { entityType: 'PT_SLAB', entityId: id, action: 'REPLACE', summary: `Replaced the professional tax slab table of rule ${id}`, previousValue: before, newValue: slabs });
      res.json(await this.master.findPtSlabs(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Labour welfare fund and minimum wage
  // =========================================================================

  listLwfRules = async (req: Request, res: Response): Promise<void> => {
    try {
      const stateCode = req.query.stateCode ? String(req.query.stateCode).toUpperCase() : undefined;
      res.json(await this.master.findLwfRules(stateCode));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  createLwfRule = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!body.stateCode || !body.stateName || !body.effectiveFrom) {
        res.status(400).json({ error: 'stateCode, stateName and effectiveFrom are required' });
        return;
      }
      const id = await this.master.createLwfRule(body, req.user!.userId);
      await this.audit(req, { entityType: 'LWF_RULE', entityId: id, action: 'CREATE', summary: `Created labour welfare fund rule for ${body.stateCode}`, newValue: body });
      const rules = await this.master.findLwfRules(body.stateCode);
      res.status(201).json(rules.find((r) => r.id === id) ?? null);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  updateLwfRule = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id ?? req.body?.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric rule id is required' });
        return;
      }
      await this.master.updateLwfRule(id, req.body ?? {});
      await this.audit(req, { entityType: 'LWF_RULE', entityId: id, action: 'UPDATE', summary: `Updated labour welfare fund rule ${id}`, newValue: req.body });
      const rules = await this.master.findLwfRules();
      res.json(rules.find((r) => r.id === id) ?? null);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  listMinimumWage = async (req: Request, res: Response): Promise<void> => {
    try {
      const stateCode = req.query.stateCode ? String(req.query.stateCode).toUpperCase() : undefined;
      res.json(await this.master.findMinimumWageRules(stateCode));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  createMinimumWage = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!body.stateCode || !body.stateName || !body.effectiveFrom || body.monthlyMinimum === undefined) {
        res.status(400).json({ error: 'stateCode, stateName, effectiveFrom and monthlyMinimum are required' });
        return;
      }
      const id = await this.master.createMinimumWageRule(body, req.user!.userId);
      await this.audit(req, { entityType: 'MINIMUM_WAGE', entityId: id, action: 'CREATE', summary: `Created minimum wage floor for ${body.stateCode} ${body.skillLevel ?? 'SKILLED'}`, newValue: body });
      const rules = await this.master.findMinimumWageRules(body.stateCode);
      res.status(201).json(rules.find((r) => r.id === id) ?? null);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  updateMinimumWage = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id ?? req.body?.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric rule id is required' });
        return;
      }
      await this.master.updateMinimumWageRule(id, req.body ?? {});
      await this.audit(req, { entityType: 'MINIMUM_WAGE', entityId: id, action: 'UPDATE', summary: `Updated minimum wage rule ${id}`, newValue: req.body });
      const rules = await this.master.findMinimumWageRules();
      res.json(rules.find((r) => r.id === id) ?? null);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Registrations
  // =========================================================================

  listRegistrations = async (req: Request, res: Response): Promise<void> => {
    try {
      const regType = req.query.regType ? String(req.query.regType).toUpperCase() : undefined;
      res.json(await this.master.findRegistrations(regType));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  createRegistration = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!body.regType || !body.registrationNo) {
        res.status(400).json({ error: 'regType and registrationNo are required' });
        return;
      }
      const id = await this.master.createRegistration(body, req.user!.userId);
      await this.audit(req, { entityType: 'STATUTORY_REGISTRATION', entityId: id, action: 'CREATE', summary: `Registered ${body.regType} ${body.registrationNo}`, newValue: body });
      res.status(201).json(await this.master.findRegistrationById(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  updateRegistration = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id ?? req.body?.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric registration id is required' });
        return;
      }
      const before = await this.master.findRegistrationById(id);
      if (!before) {
        res.status(404).json({ error: `Registration ${id} was not found` });
        return;
      }
      await this.master.updateRegistration(id, req.body ?? {}, req.user!.userId);
      await this.audit(req, { entityType: 'STATUTORY_REGISTRATION', entityId: id, action: 'UPDATE', summary: `Updated ${before.regType} registration ${before.registrationNo}`, previousValue: before, newValue: req.body });
      res.json(await this.master.findRegistrationById(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  deleteRegistration = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric registration id is required' });
        return;
      }
      const before = await this.master.findRegistrationById(id);
      if (!before) {
        res.status(404).json({ error: `Registration ${id} was not found` });
        return;
      }
      await this.master.softDeleteRegistration(id, req.user!.userId);
      await this.audit(req, { entityType: 'STATUTORY_REGISTRATION', entityId: id, action: 'DELETE', summary: `Removed ${before.regType} registration ${before.registrationNo}`, previousValue: before });
      res.json({ success: true });
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Employee enrolment, nominees and PF claims
  // =========================================================================

  getEmployeeStatutory = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric employee id is required' });
        return;
      }
      const record = await this.master.findEmployeeStatutory(id);
      if (!record) {
        res.status(404).json({ error: `No statutory enrolment is on record for employee ${id}` });
        return;
      }
      res.json(record);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  saveEmployeeStatutory = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric employee id is required' });
        return;
      }
      const before = await this.master.findEmployeeStatutory(id);
      await this.master.upsertEmployeeStatutory(id, req.body ?? {}, req.user!.userId);
      await this.audit(req, { entityType: 'EMPLOYEE_STATUTORY', entityId: id, employeeId: id, action: 'UPDATE', summary: `Updated statutory enrolment for employee ${id}`, previousValue: before, newValue: req.body });
      res.json(await this.master.findEmployeeStatutory(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  listNominees = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric employee id is required' });
        return;
      }
      res.json(await this.master.findNominees(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  createNominee = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric employee id is required' });
        return;
      }
      const body = req.body ?? {};
      if (!body.nomineeName || !body.relation) {
        res.status(400).json({ error: 'nomineeName and relation are required' });
        return;
      }
      const nomineeId = await this.master.createNominee(id, body, req.user!.userId);
      await this.audit(req, { entityType: 'STATUTORY_NOMINEE', entityId: nomineeId, employeeId: id, action: 'CREATE', summary: `Added ${body.scheme ?? 'PF'} nominee ${body.nomineeName}`, newValue: body });
      res.status(201).json((await this.master.findNominees(id)).find((n) => n.id === nomineeId) ?? null);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  updateNominee = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric nominee id is required' });
        return;
      }
      const nominee = await this.master.findNomineeById(id);
      if (!nominee) {
        res.status(404).json({ error: `Nominee ${id} was not found` });
        return;
      }
      await this.master.updateNominee(id, req.body ?? {});
      await this.audit(req, { entityType: 'STATUTORY_NOMINEE', entityId: id, employeeId: nominee.employeeId, action: 'UPDATE', summary: `Updated nominee ${id}`, newValue: req.body });
      res.json((await this.master.findNominees(nominee.employeeId)).find((n) => n.id === id) ?? null);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  deleteNominee = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric nominee id is required' });
        return;
      }
      const nominee = await this.master.findNomineeById(id);
      if (!nominee) {
        res.status(404).json({ error: `Nominee ${id} was not found` });
        return;
      }
      await this.master.softDeleteNominee(id);
      await this.audit(req, { entityType: 'STATUTORY_NOMINEE', entityId: id, employeeId: nominee.employeeId, action: 'DELETE', summary: `Removed nominee ${id}` });
      res.json({ success: true });
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  listPfClaims = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.master.findPfClaims({
        employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  createPfClaim = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!body.employeeId || !body.claimType) {
        res.status(400).json({ error: 'employeeId and claimType are required' });
        return;
      }
      const id = await this.master.createPfClaim(body, req.user!.userId);
      await this.audit(req, { entityType: 'PF_CLAIM', entityId: id, employeeId: Number(body.employeeId), action: 'CREATE', summary: `Raised ${body.claimType} PF claim`, newValue: body });
      res.status(201).json((await this.master.findPfClaims({ employeeId: Number(body.employeeId) })).find((c) => c.id === id) ?? null);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  updatePfClaim = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric claim id is required' });
        return;
      }
      await this.master.updatePfClaim(id, req.body ?? {}, req.user!.userId);
      await this.audit(req, { entityType: 'PF_CLAIM', entityId: id, action: 'UPDATE', summary: `Updated PF claim ${id}`, newValue: req.body });
      const claims = await this.master.findPfClaims({});
      res.json(claims.find((c) => c.id === id) ?? null);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  getPfAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric employee id is required' });
        return;
      }
      const financialYear = req.query.financialYear ? String(req.query.financialYear) : undefined;
      if (financialYear && !FINANCIAL_YEAR.test(financialYear)) {
        res.status(400).json({ error: 'financialYear must look like 2026-2027' });
        return;
      }
      res.json(await this.ledger.getPfAccount(id, financialYear));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Contribution ledger
  // =========================================================================

  listContributions = async (req: Request, res: Response): Promise<void> => {
    try {
      const financialYear = req.query.financialYear ? String(req.query.financialYear) : undefined;
      if (financialYear && !FINANCIAL_YEAR.test(financialYear)) {
        res.status(400).json({ error: 'financialYear must look like 2026-2027' });
        return;
      }
      const monthKey = req.query.monthKey ? String(req.query.monthKey) : undefined;
      if (monthKey && !MONTH_KEY.test(monthKey)) {
        res.status(400).json({ error: 'monthKey must look like 2026-07' });
        return;
      }
      res.json(await this.ledger.getLedger({
        periodId: req.query.periodId ? Number(req.query.periodId) : undefined,
        scheme: req.query.scheme ? String(req.query.scheme).toUpperCase() : undefined,
        financialYear,
        monthKey,
        employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
        status: req.query.status ? String(req.query.status).toUpperCase() : undefined,
        stateCode: req.query.stateCode ? String(req.query.stateCode).toUpperCase() : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  buildContributions = async (req: Request, res: Response): Promise<void> => {
    try {
      const periodId = this.readId(req.body?.periodId);
      if (periodId === null) {
        res.status(400).json({ error: 'A numeric periodId is required' });
        return;
      }
      const result = await this.ledger.buildLedger(periodId, req.user!.userId, {
        employeeIds: Array.isArray(req.body?.employeeIds) ? req.body.employeeIds.map(Number) : undefined,
        force: req.body?.force === true,
      });
      await this.audit(req, { entityType: 'STATUTORY_LEDGER', entityId: periodId, periodId, action: 'BUILD_REQUEST', summary: `Requested a contribution ledger rebuild for period ${periodId}`, newValue: { employeesProcessed: result.employeesProcessed } });
      res.status(201).json(result);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  contributionSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const periodId = this.readId(req.params.periodId);
      if (periodId === null) {
        res.status(400).json({ error: 'A numeric periodId is required' });
        return;
      }
      res.json(await this.ledger.getSummary(periodId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Gratuity and PF interest
  // =========================================================================

  listGratuityProvisions = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.ledger.getGratuityProvisions({
        asOfDate: req.query.asOfDate ? String(req.query.asOfDate) : undefined,
        financialYear: req.query.financialYear ? String(req.query.financialYear) : undefined,
        employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  computeGratuity = async (req: Request, res: Response): Promise<void> => {
    try {
      const asOfDate = req.body?.asOfDate ? String(req.body.asOfDate) : todayString();
      const result = await this.ledger.computeGratuityProvisions(asOfDate, req.user!.userId);
      res.status(201).json(result);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  postPfContributions = async (req: Request, res: Response): Promise<void> => {
    try {
      const periodId = this.readId(req.body?.periodId);
      if (periodId === null) {
        res.status(400).json({ error: 'A numeric periodId is required' });
        return;
      }
      res.status(201).json(await this.ledger.postPfEntries(periodId, req.user!.userId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  creditPfInterest = async (req: Request, res: Response): Promise<void> => {
    try {
      const financialYear = String(req.body?.financialYear ?? '');
      if (!FINANCIAL_YEAR.test(financialYear)) {
        res.status(400).json({ error: 'financialYear must look like 2026-2027' });
        return;
      }
      const ratePct = Number(req.body?.ratePct);
      if (!Number.isFinite(ratePct) || ratePct <= 0) {
        res.status(400).json({ error: 'A positive ratePct is required; the EPFO declared rate must be supplied explicitly' });
        return;
      }
      res.status(201).json(await this.ledger.creditPfInterest(financialYear, ratePct, req.user!.userId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Challans
  // =========================================================================

  listChallans = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.challans.list({
        scheme: req.query.scheme ? String(req.query.scheme).toUpperCase() : undefined,
        status: req.query.status ? String(req.query.status).toUpperCase() : undefined,
        monthKey: req.query.monthKey ? String(req.query.monthKey) : undefined,
        financialYear: req.query.financialYear ? String(req.query.financialYear) : undefined,
        stateCode: req.query.stateCode ? String(req.query.stateCode).toUpperCase() : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  overdueChallans = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.challans.getOverdue());
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  getChallan = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric challan id is required' });
        return;
      }
      res.json(await this.challans.get(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  generateChallan = async (req: Request, res: Response): Promise<void> => {
    try {
      const scheme = String(req.body?.scheme ?? '').toUpperCase();
      const monthKey = String(req.body?.monthKey ?? '');
      if (!MONTH_KEY.test(monthKey)) {
        res.status(400).json({ error: 'monthKey must look like 2026-07' });
        return;
      }
      const result = await this.challans.generateChallan(scheme, monthKey, req.user!.userId, {
        stateCode: req.body?.stateCode ?? null,
        registrationId: req.body?.registrationId ?? null,
        dueDate: req.body?.dueDate ?? null,
        interestAmount: req.body?.interestAmount,
        penaltyAmount: req.body?.penaltyAmount,
        remarks: req.body?.remarks ?? null,
      });
      res.status(201).json(result);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  markChallanPaid = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric challan id is required' });
        return;
      }
      res.json(await this.challans.markPaid(id, {
        paidOn: String(req.body?.paidOn ?? ''),
        paymentReference: req.body?.paymentReference ?? null,
        bankName: req.body?.bankName ?? null,
      }, req.user!.userId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  acknowledgeChallan = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric challan id is required' });
        return;
      }
      res.json(await this.challans.recordAcknowledgement(id, {
        acknowledgementNo: String(req.body?.acknowledgementNo ?? ''),
        acknowledgedOn: req.body?.acknowledgedOn ?? null,
      }, req.user!.userId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  cancelChallan = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric challan id is required' });
        return;
      }
      res.json(await this.challans.cancel(id, String(req.body?.reason ?? ''), req.user!.userId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  exportChallan = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric challan id is required' });
        return;
      }
      const file = await this.challans.exportChallanCsv(id);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.send(file.content);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Regulatory filings
  // =========================================================================

  listFilings = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.filings.list({
        filingType: req.query.filingType ? String(req.query.filingType).toUpperCase() : undefined,
        status: req.query.status ? String(req.query.status).toUpperCase() : undefined,
        financialYear: req.query.financialYear ? String(req.query.financialYear) : undefined,
        monthKey: req.query.monthKey ? String(req.query.monthKey) : undefined,
        quarter: req.query.quarter ? Number(req.query.quarter) : undefined,
        stateCode: req.query.stateCode ? String(req.query.stateCode).toUpperCase() : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  overdueFilings = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.filings.getOverdue());
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  getFiling = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric filing id is required' });
        return;
      }
      res.json(await this.filings.get(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  downloadFiling = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric filing id is required' });
        return;
      }
      const file = await this.filings.getFile(id);
      res.setHeader('Content-Type', file.format === 'CSV' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.send(file.content);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  markFilingFiled = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric filing id is required' });
        return;
      }
      res.json(await this.filings.markFiled(id, {
        filedOn: String(req.body?.filedOn ?? ''),
        acknowledgementNo: req.body?.acknowledgementNo ?? null,
      }, req.user!.userId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  generatePfEcr = async (req: Request, res: Response): Promise<void> => {
    try {
      const monthKey = String(req.body?.monthKey ?? '');
      if (!MONTH_KEY.test(monthKey)) {
        res.status(400).json({ error: 'monthKey must look like 2026-07' });
        return;
      }
      res.status(201).json(await this.filings.generatePfEcr(monthKey, req.user!.userId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  generateEsiReturn = async (req: Request, res: Response): Promise<void> => {
    try {
      const monthKey = String(req.body?.monthKey ?? '');
      if (!MONTH_KEY.test(monthKey)) {
        res.status(400).json({ error: 'monthKey must look like 2026-07' });
        return;
      }
      res.status(201).json(await this.filings.generateEsiReturn(monthKey, req.user!.userId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  generatePtReturn = async (req: Request, res: Response): Promise<void> => {
    try {
      const monthKey = String(req.body?.monthKey ?? '');
      if (!MONTH_KEY.test(monthKey)) {
        res.status(400).json({ error: 'monthKey must look like 2026-07' });
        return;
      }
      res.status(201).json(await this.filings.generatePtReturn(monthKey, String(req.body?.stateCode ?? ''), req.user!.userId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  generateLwfReturn = async (req: Request, res: Response): Promise<void> => {
    try {
      const period = String(req.body?.period ?? req.body?.monthKey ?? '');
      if (!MONTH_KEY.test(period)) {
        res.status(400).json({ error: 'period must look like 2026-06' });
        return;
      }
      res.status(201).json(await this.filings.generateLwfReturn(period, String(req.body?.stateCode ?? ''), req.user!.userId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  generate24Q = async (req: Request, res: Response): Promise<void> => {
    try {
      const financialYear = String(req.body?.financialYear ?? '');
      if (!FINANCIAL_YEAR.test(financialYear)) {
        res.status(400).json({ error: 'financialYear must look like 2026-2027' });
        return;
      }
      const quarter = Number(req.body?.quarter);
      if (!Number.isFinite(quarter) || quarter < 1 || quarter > 4) {
        res.status(400).json({ error: 'quarter must be 1, 2, 3 or 4' });
        return;
      }
      res.status(201).json(await this.filings.generate24Q(financialYear, quarter, req.user!.userId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  generateRegister = async (req: Request, res: Response): Promise<void> => {
    try {
      const type = String(req.body?.type ?? '');
      const financialYear = req.body?.financialYear ? String(req.body.financialYear) : undefined;
      if (financialYear && !FINANCIAL_YEAR.test(financialYear)) {
        res.status(400).json({ error: 'financialYear must look like 2026-2027' });
        return;
      }
      const monthKey = req.body?.monthKey ? String(req.body.monthKey) : undefined;
      if (monthKey && !MONTH_KEY.test(monthKey)) {
        res.status(400).json({ error: 'monthKey must look like 2026-07' });
        return;
      }
      const periodId = req.body?.periodId === undefined ? undefined : this.readId(req.body.periodId);
      if (req.body?.periodId !== undefined && periodId === null) {
        res.status(400).json({ error: 'periodId must be numeric' });
        return;
      }
      const result = await this.filings.generateStatutoryRegister(type, {
        periodId: periodId ?? undefined,
        monthKey,
        financialYear,
      });
      await this.audit(req, { entityType: 'STATUTORY_REGISTER', action: 'GENERATE', summary: `Generated ${result.registerType} with ${result.rowCount} rows`, newValue: { fileName: result.fileName } });

      if (String(req.query.format ?? '').toLowerCase() === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
        res.send(result.fileContent);
        return;
      }
      res.status(201).json(result);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  // =========================================================================
  // Form 16
  // =========================================================================

  listForm16 = async (req: Request, res: Response): Promise<void> => {
    try {
      const financialYear = req.query.financialYear ? String(req.query.financialYear) : undefined;
      if (financialYear && !FINANCIAL_YEAR.test(financialYear)) {
        res.status(400).json({ error: 'financialYear must look like 2026-2027' });
        return;
      }
      res.json(await this.form16.list({
        financialYear,
        status: req.query.status ? String(req.query.status).toUpperCase() : undefined,
        employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  getForm16 = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric Form 16 id is required' });
        return;
      }
      res.json(await this.form16.get(id));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  downloadForm16Pdf = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric Form 16 id is required' });
        return;
      }
      const file = await this.form16.generatePdf(id);
      await this.form16.recordDistribution(id, 'DOWNLOAD', req.user?.email ?? null, 'DOWNLOADED', null, req.user?.userId ?? null);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.send(file.buffer);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  generateForm16 = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.readId(req.body?.employeeId);
      const financialYear = String(req.body?.financialYear ?? '');
      if (employeeId === null) {
        res.status(400).json({ error: 'A numeric employeeId is required' });
        return;
      }
      if (!FINANCIAL_YEAR.test(financialYear)) {
        res.status(400).json({ error: 'financialYear must look like 2026-2027' });
        return;
      }
      res.status(201).json(await this.form16.generate(employeeId, financialYear, req.user!.userId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  bulkGenerateForm16 = async (req: Request, res: Response): Promise<void> => {
    try {
      const financialYear = String(req.body?.financialYear ?? '');
      if (!FINANCIAL_YEAR.test(financialYear)) {
        res.status(400).json({ error: 'financialYear must look like 2026-2027' });
        return;
      }
      const employeeIds = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds.map(Number) : undefined;
      const result = await this.form16.bulkGenerate(financialYear, employeeIds, req.user!.userId);
      await this.audit(req, { entityType: 'FORM16', action: 'BULK_GENERATE', summary: `Generated ${result.generated} Form 16 certificates for ${financialYear}`, newValue: { generated: result.generated, failures: result.failures.length } });
      res.status(201).json(result);
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  issueForm16 = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric Form 16 id is required' });
        return;
      }
      res.json(await this.form16.issue(id, req.user!.userId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  emailForm16 = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric Form 16 id is required' });
        return;
      }
      res.status(201).json(await this.form16.emailToEmployee(id, req.user!.userId));
    } catch (err: any) {
      res.status(statusFor(err.message)).json({ error: err.message });
    }
  };

  employeeForm16 = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.readId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A numeric employee id is required' });
        return;
      }
      const financialYear = req.query.financialYear ? String(req.query.financialYear) : undefined;
      if (financialYear && !FINANCIAL_YEAR.test(financialYear)) {
        res.status(400).json({ error: 'financialYear must look like 2026-2027' });
        return;
      }
      res.json(await this.form16.getForEmployee(id, financialYear));
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

  /**
   * Compliance-grade audit row: who, from where, on what, before and after.
   * Failures are swallowed inside the repository so an audit outage never
   * rolls back the statutory action itself.
   */
  private async audit(
    req: Request,
    entry: Omit<ComplianceAuditInput, 'actorUserId' | 'actorName' | 'actorRole' | 'ipAddress' | 'userAgent'>,
  ): Promise<void> {
    await this.master.logAudit({
      ...entry,
      actorUserId: req.user?.userId ?? null,
      actorName: req.user?.name ?? null,
      actorRole: req.user?.role ?? null,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }
}
