import { Request, Response } from 'express';
import { CompensationService } from '../services/CompensationService';
import { PayAwardService } from '../services/PayAwardService';
import { ComponentFilters, StructureFilters } from '../repositories/CompensationRepository';
import { PayAwardFilters } from '../repositories/PayAwardRepository';

const INVALID_ID = 'Invalid id';

/** Parses a path parameter into a positive integer, or null when malformed. */
function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
}

/** Parses a `true`/`false` query string into a boolean, or undefined. */
function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).toLowerCase();
  if (['true', '1', 'yes'].includes(text)) return true;
  if (['false', '0', 'no'].includes(text)) return false;
  return undefined;
}

export class CompensationController {
  private service = new CompensationService();
  private awards = new PayAwardService();

  // =========================================================================
  // Pay components
  // =========================================================================
  listComponents = async (req: Request, res: Response): Promise<void> => {
    try {
      const { componentType, category, isActive, search, limit } = req.query as Record<string, string>;
      const filters: ComponentFilters = {};
      if (componentType) filters.componentType = componentType.toUpperCase();
      if (category) filters.category = category.toUpperCase();
      const active = parseBool(isActive);
      if (active !== undefined) filters.isActive = active;
      if (search) filters.search = search;
      if (limit) filters.limit = parseInt(limit, 10);

      res.json(await this.service.listComponents(filters));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getComponent = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.getComponent(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createComponent = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!String(body.code ?? '').trim()) {
        res.status(400).json({ error: 'A component code is required' });
        return;
      }
      if (!String(body.name ?? '').trim()) {
        res.status(400).json({ error: 'A component name is required' });
        return;
      }
      res.status(201).json(await this.service.createComponent(body, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateComponent = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.updateComponent(id, req.body ?? {}, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteComponent = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      await this.service.deleteComponent(id, req.user!.userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Salary structures
  // =========================================================================
  listStructures = async (req: Request, res: Response): Promise<void> => {
    try {
      const { grade, department, branch, workerType, isActive, limit } = req.query as Record<string, string>;
      const filters: StructureFilters = {};
      if (grade) filters.grade = grade;
      if (department) filters.department = department;
      if (branch) filters.branch = branch;
      if (workerType) filters.workerType = workerType.toUpperCase();
      const active = parseBool(isActive);
      if (active !== undefined) filters.isActive = active;
      if (limit) filters.limit = parseInt(limit, 10);

      res.json(await this.service.listStructures(filters));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getStructure = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.getStructure(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createStructure = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!String(body.code ?? '').trim()) {
        res.status(400).json({ error: 'A structure code is required' });
        return;
      }
      if (!String(body.name ?? '').trim()) {
        res.status(400).json({ error: 'A structure name is required' });
        return;
      }
      if (!String(body.effectiveFrom ?? '').trim()) {
        res.status(400).json({ error: 'effectiveFrom is required' });
        return;
      }
      res.status(201).json(await this.service.createStructure(body, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateStructure = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.updateStructure(id, req.body ?? {}, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteStructure = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      await this.service.deleteStructure(id, req.user!.userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  cloneStructure = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      const { code, name } = req.body ?? {};
      if (!String(code ?? '').trim()) {
        res.status(400).json({ error: 'A code for the new structure is required' });
        return;
      }
      if (!String(name ?? '').trim()) {
        res.status(400).json({ error: 'A name for the new structure is required' });
        return;
      }
      res.status(201).json(
        await this.service.cloneStructure(id, String(code), String(name), req.user!.userId),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  setStructureLines = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      const lines = (req.body ?? {}).lines ?? req.body;
      if (!Array.isArray(lines)) {
        res.status(400).json({ error: 'lines must be an array' });
        return;
      }
      res.json(await this.service.setStructureLines(id, lines, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  previewStructure = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      const annualCtc = Number((req.query as Record<string, string>).annualCtc);
      if (!Number.isFinite(annualCtc) || annualCtc <= 0) {
        res.status(400).json({ error: 'annualCtc must be a number greater than zero' });
        return;
      }
      res.json(await this.service.previewStructure(id, annualCtc));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Pay cycles
  // =========================================================================
  listCycles = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.listCycles(parseBool((req.query as Record<string, string>).isActive)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getCycle = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.getCycle(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createCycle = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!String(body.code ?? '').trim()) {
        res.status(400).json({ error: 'A pay cycle code is required' });
        return;
      }
      if (!String(body.name ?? '').trim()) {
        res.status(400).json({ error: 'A pay cycle name is required' });
        return;
      }
      res.status(201).json(await this.service.createCycle(body, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateCycle = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.updateCycle(id, req.body ?? {}, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteCycle = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      await this.service.deleteCycle(id, req.user!.userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  setDefaultCycle = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.setDefaultCycle(id, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Overtime rules
  // =========================================================================
  listOvertimeRules = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(
        await this.service.listOvertimeRules(parseBool((req.query as Record<string, string>).isActive)),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createOvertimeRule = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!String(body.code ?? '').trim()) {
        res.status(400).json({ error: 'An overtime rule code is required' });
        return;
      }
      if (!String(body.name ?? '').trim()) {
        res.status(400).json({ error: 'An overtime rule name is required' });
        return;
      }
      res.status(201).json(await this.service.createOvertimeRule(body, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateOvertimeRule = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.updateOvertimeRule(id, req.body ?? {}, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteOvertimeRule = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      await this.service.deleteOvertimeRule(id, req.user!.userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Employee compensation
  // =========================================================================
  getEmployeeSalary = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.getCurrentSalary(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getEmployeeSalaryHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.getSalaryHistory(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createRevision = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      const body = req.body ?? {};
      if (!String(body.effectiveFrom ?? '').trim()) {
        res.status(400).json({ error: 'effectiveFrom is required' });
        return;
      }
      if (body.annualCtc === undefined || body.annualCtc === null || body.annualCtc === '') {
        res.status(400).json({ error: 'annualCtc is required' });
        return;
      }
      res.status(201).json(await this.service.createRevision(id, body, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  approveRevision = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.approveRevision(id, req.user!.userId, req.user!.name));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  rejectRevision = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      const reason = String((req.body ?? {}).reason ?? (req.body ?? {}).note ?? '').trim();
      if (!reason) {
        res.status(400).json({ error: 'A rejection reason is required' });
        return;
      }
      res.json(await this.service.rejectRevision(id, req.user!.userId, reason, req.user!.name));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Awards (bonus / incentive / variable pay)
  // =========================================================================
  listAwards = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.awards.list(this.awardFilters(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getAward = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.awards.get(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  listEmployeeAwards = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      const filters = this.awardFilters(req);
      filters.employeeId = id;
      res.json(await this.awards.list(filters));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createAward = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!body.employeeId) {
        res.status(400).json({ error: 'employeeId is required' });
        return;
      }
      if (!String(body.title ?? '').trim()) {
        res.status(400).json({ error: 'A title is required' });
        return;
      }
      if (body.amount === undefined || body.amount === null || body.amount === '') {
        res.status(400).json({ error: 'amount is required' });
        return;
      }
      res.status(201).json(await this.awards.create(body, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateAward = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.awards.update(id, req.body ?? {}, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  bulkCreateAwards = async (req: Request, res: Response): Promise<void> => {
    try {
      const rows = (req.body ?? {}).rows ?? req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: 'rows must be a non-empty array' });
        return;
      }
      res.status(201).json(await this.awards.bulkCreate(rows, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  submitAward = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.awards.submitForApproval(id, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  approveAward = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.awards.approve(id, req.user!.userId, req.user!.name));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  rejectAward = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      const note = String((req.body ?? {}).note ?? (req.body ?? {}).reason ?? '').trim();
      if (!note) {
        res.status(400).json({ error: 'A rejection note is required' });
        return;
      }
      res.json(await this.awards.reject(id, req.user!.userId, note, req.user!.name));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  cancelAward = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.awards.cancel(id, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  markAwardsPaid = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      const ids = Array.isArray(body.ids) ? body.ids.map((i: unknown) => Number(i)) : [];
      if (ids.length === 0) {
        res.status(400).json({ error: 'ids must be a non-empty array' });
        return;
      }
      const periodId = body.periodId ? Math.floor(Number(body.periodId)) : null;
      res.json(await this.awards.markPaid(ids, periodId, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  private awardFilters(req: Request): PayAwardFilters {
    const { employeeId, awardClass, status, periodId, payoutPeriodId, from, to, limit } =
      req.query as Record<string, string>;
    const filters: PayAwardFilters = {};
    if (employeeId) filters.employeeId = parseInt(employeeId, 10);
    if (awardClass) filters.awardClass = awardClass.toUpperCase();
    if (status) filters.status = status.toUpperCase();
    if (periodId) filters.periodId = parseInt(periodId, 10);
    if (payoutPeriodId) filters.payoutPeriodId = parseInt(payoutPeriodId, 10);
    if (from) filters.from = from;
    if (to) filters.to = to;
    if (limit) filters.limit = parseInt(limit, 10);
    return filters;
  }
}
