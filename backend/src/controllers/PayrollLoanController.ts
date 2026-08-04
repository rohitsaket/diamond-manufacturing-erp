import { Request, Response } from 'express';
import { PayrollLoanService } from '../services/PayrollLoanService';
import {
  ClaimFilters,
  EnrolmentFilters,
  LoanFilters,
} from '../repositories/PayrollLoanRepository';

const INVALID_ID = 'Invalid id';
const NOT_LINKED = 'This account is not linked to an employee record';

/** Roles allowed to file or read a claim on someone else's behalf. */
const STAFF_ROLES = ['admin', 'manager', 'operator', 'accountant', 'hr'];

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
}

function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).toLowerCase();
  if (['true', '1', 'yes'].includes(text)) return true;
  if (['false', '0', 'no'].includes(text)) return false;
  return undefined;
}

export class PayrollLoanController {
  private service = new PayrollLoanService();

  // =========================================================================
  // Loans
  // =========================================================================
  listLoans = async (req: Request, res: Response): Promise<void> => {
    try {
      const { employeeId, status, loanType, limit } = req.query as Record<string, string>;
      const filters: LoanFilters = {};
      if (employeeId) filters.employeeId = parseInt(employeeId, 10);
      if (status) filters.status = status.toUpperCase();
      if (loanType) filters.loanType = loanType.toUpperCase();
      if (limit) filters.limit = parseInt(limit, 10);

      res.json(await this.service.listLoans(filters));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  myLoans = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: NOT_LINKED });
        return;
      }
      res.json(await this.service.listLoans({ employeeId }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getLoan = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.getLoan(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createLoan = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!body.employeeId) {
        res.status(400).json({ error: 'employeeId is required' });
        return;
      }
      if (body.principal === undefined || body.principal === null || body.principal === '') {
        res.status(400).json({ error: 'principal is required' });
        return;
      }
      if (!body.tenureMonths) {
        res.status(400).json({ error: 'tenureMonths is required' });
        return;
      }
      res.status(201).json(await this.service.createLoan(body, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  approveLoan = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.approveLoan(id, req.user!.userId, req.user!.name));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  rejectLoan = async (req: Request, res: Response): Promise<void> => {
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
      res.json(await this.service.rejectLoan(id, req.user!.userId, reason));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  forecloseLoan = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.forecloseLoan(id, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  recordRepayment = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      const body = req.body ?? {};
      if (body.amount === undefined || body.amount === null || body.amount === '') {
        res.status(400).json({ error: 'amount is required' });
        return;
      }
      res.json(
        await this.service.recordManualRepayment(
          id,
          Number(body.amount),
          String(body.date ?? ''),
          req.user!.userId,
        ),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Reimbursement types
  // =========================================================================
  listReimbursementTypes = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(
        await this.service.listReimbursementTypes(
          parseBool((req.query as Record<string, string>).isActive),
        ),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createReimbursementType = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!String(body.code ?? '').trim()) {
        res.status(400).json({ error: 'A reimbursement type code is required' });
        return;
      }
      if (!String(body.name ?? '').trim()) {
        res.status(400).json({ error: 'A reimbursement type name is required' });
        return;
      }
      res.status(201).json(await this.service.createReimbursementType(body, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateReimbursementType = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.updateReimbursementType(id, req.body ?? {}, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Claims
  // =========================================================================
  listClaims = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.listClaims(this.claimFilters(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  myClaims = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: NOT_LINKED });
        return;
      }
      const filters = this.claimFilters(req);
      filters.employeeId = employeeId;
      res.json(await this.service.listClaims(filters));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  /**
   * A self-service user may only claim for themselves; staff can file on
   * anyone's behalf by supplying an employeeId.
   */
  createClaim = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      const isStaff = STAFF_ROLES.includes(req.user!.role);

      let employeeId: number | null;
      if (isStaff) {
        employeeId = parseId(body.employeeId);
        if (employeeId === null) {
          res.status(400).json({ error: 'employeeId is required' });
          return;
        }
      } else {
        employeeId = req.user!.employeeId ?? null;
        if (!employeeId) {
          res.status(403).json({ error: NOT_LINKED });
          return;
        }
      }

      if (!body.typeId) {
        res.status(400).json({ error: 'typeId is required' });
        return;
      }
      if (body.amount === undefined || body.amount === null || body.amount === '') {
        res.status(400).json({ error: 'amount is required' });
        return;
      }
      if (!String(body.expenseDate ?? '').trim()) {
        res.status(400).json({ error: 'expenseDate is required' });
        return;
      }

      res.status(201).json(
        await this.service.createClaim({ ...body, employeeId }, req.user!.userId),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  decideClaim = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      const body = req.body ?? {};
      const status = String(body.status ?? '').trim().toUpperCase();
      if (status !== 'APPROVED' && status !== 'REJECTED') {
        res.status(400).json({ error: 'status must be APPROVED or REJECTED' });
        return;
      }
      res.json(
        await this.service.decideClaim(
          id,
          status,
          req.user!.userId,
          body.note ?? null,
          body.approvedAmount ?? null,
        ),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  markClaimsPaid = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      const ids = Array.isArray(body.ids) ? body.ids.map((i: unknown) => Number(i)) : [];
      if (ids.length === 0) {
        res.status(400).json({ error: 'ids must be a non-empty array' });
        return;
      }
      const periodId = body.periodId ? Math.floor(Number(body.periodId)) : null;
      res.json(await this.service.markClaimsPaid(ids, periodId, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Benefits
  // =========================================================================
  listBenefitPlans = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(
        await this.service.listBenefitPlans(parseBool((req.query as Record<string, string>).isActive)),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createBenefitPlan = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!String(body.code ?? '').trim()) {
        res.status(400).json({ error: 'A benefit plan code is required' });
        return;
      }
      if (!String(body.name ?? '').trim()) {
        res.status(400).json({ error: 'A benefit plan name is required' });
        return;
      }
      res.status(201).json(await this.service.createBenefitPlan(body, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateBenefitPlan = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.updateBenefitPlan(id, req.body ?? {}, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  listEnrolments = async (req: Request, res: Response): Promise<void> => {
    try {
      const { planId, status, employeeId, limit } = req.query as Record<string, string>;
      const filters: EnrolmentFilters = {};
      if (planId) filters.planId = parseInt(planId, 10);
      if (status) filters.status = status.toUpperCase();
      if (employeeId) filters.employeeId = parseInt(employeeId, 10);
      if (limit) filters.limit = parseInt(limit, 10);

      res.json(await this.service.listEnrolments(filters));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  listEmployeeBenefits = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      res.json(await this.service.listForEmployee(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  enrolBenefit = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      const employeeId = parseId(body.employeeId);
      if (employeeId === null) {
        res.status(400).json({ error: 'employeeId is required' });
        return;
      }
      const planId = parseId(body.planId);
      if (planId === null) {
        res.status(400).json({ error: 'planId is required' });
        return;
      }
      res.status(201).json(await this.service.enrol(employeeId, planId, body, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  endEnrolment = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: INVALID_ID });
        return;
      }
      const endedOn = String((req.body ?? {}).endedOn ?? '').trim();
      res.json(await this.service.endEnrolment(id, endedOn, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  private claimFilters(req: Request): ClaimFilters {
    const { employeeId, status, typeId, from, to, limit } = req.query as Record<string, string>;
    const filters: ClaimFilters = {};
    if (employeeId) filters.employeeId = parseInt(employeeId, 10);
    if (status) filters.status = status.toUpperCase();
    if (typeId) filters.typeId = parseInt(typeId, 10);
    if (from) filters.from = from;
    if (to) filters.to = to;
    if (limit) filters.limit = parseInt(limit, 10);
    return filters;
  }
}
