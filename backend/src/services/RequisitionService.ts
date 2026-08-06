import { RequisitionFilters, RequisitionRepository } from '../repositories/RequisitionRepository';
import { RecruitmentAuditService } from './RecruitmentAuditService';
import { NotificationService } from './NotificationService';
import { PerfActionContext } from '../types/performance';
import { RequisitionResponse, RequisitionStatus, RequisitionType } from '../types/internalRecruitment';

const REQUISITION_TYPES: RequisitionType[] = ['NEW_POSITION', 'REPLACEMENT', 'EXPANSION'];
const CANCELLABLE: RequisitionStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function toRequisitionResponse(r: any): RequisitionResponse {
  return {
    id: Number(r.id),
    reqCode: String(r.req_code),
    requisitionType: r.requisition_type,
    title: String(r.title),
    positionId: r.position_id === null ? null : Number(r.position_id),
    positionTitle: r.position_title ?? null,
    departmentId: r.department_id === null ? null : Number(r.department_id),
    departmentName: r.department_name ?? null,
    jobRoleId: r.job_role_id === null ? null : Number(r.job_role_id),
    jobRoleName: r.job_role_name ?? null,
    headcount: Number(r.headcount ?? 1),
    replacementForEmployeeId: r.replacement_for_employee_id === null ? null : Number(r.replacement_for_employee_id),
    replacementForName: r.replacement_for_name ?? null,
    justification: r.justification ?? null,
    budgetAmount: r.budget_amount === null || r.budget_amount === undefined ? null : Number(r.budget_amount),
    budgetApproved: !!r.budget_approved,
    status: r.status,
    requestedBy: r.requested_by === null ? null : Number(r.requested_by),
    approvedBy: r.approved_by === null ? null : Number(r.approved_by),
    approvedAt: isoOrNull(r.approved_at),
    createdAt: isoOrNull(r.created_at) ?? '',
  };
}

/**
 * Job requisitions: the approved hiring demand that internal postings hang
 * off. Lifecycle: DRAFT -> PENDING_APPROVAL -> APPROVED/REJECTED, with
 * CANCELLED available from any pre-fulfilment state and FULFILLED set by the
 * job-fill flow when every linked posting is closed out.
 */
export class RequisitionService {
  private repo = new RequisitionRepository();
  private audit = new RecruitmentAuditService();
  private notifications = new NotificationService();

  async list(filters: RequisitionFilters): Promise<RequisitionResponse[]> {
    const rows = await this.repo.findAll(filters);
    return rows.map((r) => toRequisitionResponse(r));
  }

  async getById(id: number): Promise<RequisitionResponse> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error('Requisition not found');
    return toRequisitionResponse(row);
  }

  async create(body: any, ctx: PerfActionContext): Promise<RequisitionResponse> {
    if (!body?.title || !String(body.title).trim()) throw new Error('title is required');
    const requisitionType = body.requisitionType ?? 'NEW_POSITION';
    if (!REQUISITION_TYPES.includes(requisitionType)) {
      throw new Error(`requisitionType must be one of ${REQUISITION_TYPES.join(', ')}`);
    }
    const headcount = Math.trunc(Number(body.headcount ?? 1));
    if (!Number.isFinite(headcount) || headcount < 1) throw new Error('headcount must be a positive integer');
    if (requisitionType === 'REPLACEMENT' && !body.replacementForEmployeeId) {
      throw new Error('replacementForEmployeeId is required for a REPLACEMENT requisition');
    }

    const year = new Date().getUTCFullYear();
    const seq = await this.repo.nextSequence(year);
    const reqCode = `REQ-${year}-${String(seq).padStart(3, '0')}`;

    const id = await this.repo.insert({
      req_code: reqCode,
      requisition_type: requisitionType,
      title: String(body.title).trim(),
      position_id: body.positionId ? Math.trunc(Number(body.positionId)) : null,
      department_id: body.departmentId ? Math.trunc(Number(body.departmentId)) : null,
      job_role_id: body.jobRoleId ? Math.trunc(Number(body.jobRoleId)) : null,
      headcount,
      replacement_for_employee_id: body.replacementForEmployeeId
        ? Math.trunc(Number(body.replacementForEmployeeId))
        : null,
      justification: body.justification ?? null,
      budget_amount: body.budgetAmount === undefined || body.budgetAmount === null ? null : Number(body.budgetAmount),
      status: 'DRAFT',
      requested_by: ctx.userId,
    });
    await this.audit.record('REQUISITION', id, 'CREATE', ctx, null, { reqCode, title: body.title, requisitionType, headcount });
    return this.getById(id);
  }

  /** Only DRAFT requisitions are editable; everything after is audit trail. */
  async update(id: number, body: any, ctx: PerfActionContext): Promise<RequisitionResponse> {
    const before = await this.repo.findById(id);
    if (!before) throw new Error('Requisition not found');
    if (before.status !== 'DRAFT') throw new Error(`Only DRAFT requisitions can be edited (current: ${before.status})`);

    const fields: Record<string, any> = {};
    if (body.title !== undefined) {
      if (!String(body.title).trim()) throw new Error('title cannot be empty');
      fields.title = String(body.title).trim();
    }
    if (body.requisitionType !== undefined) {
      if (!REQUISITION_TYPES.includes(body.requisitionType)) {
        throw new Error(`requisitionType must be one of ${REQUISITION_TYPES.join(', ')}`);
      }
      fields.requisition_type = body.requisitionType;
    }
    if (body.headcount !== undefined) {
      const headcount = Math.trunc(Number(body.headcount));
      if (!Number.isFinite(headcount) || headcount < 1) throw new Error('headcount must be a positive integer');
      fields.headcount = headcount;
    }
    if (body.positionId !== undefined) fields.position_id = body.positionId ? Math.trunc(Number(body.positionId)) : null;
    if (body.departmentId !== undefined) fields.department_id = body.departmentId ? Math.trunc(Number(body.departmentId)) : null;
    if (body.jobRoleId !== undefined) fields.job_role_id = body.jobRoleId ? Math.trunc(Number(body.jobRoleId)) : null;
    if (body.replacementForEmployeeId !== undefined) {
      fields.replacement_for_employee_id = body.replacementForEmployeeId
        ? Math.trunc(Number(body.replacementForEmployeeId))
        : null;
    }
    if (body.justification !== undefined) fields.justification = body.justification ?? null;
    if (body.budgetAmount !== undefined) fields.budget_amount = body.budgetAmount === null ? null : Number(body.budgetAmount);

    await this.repo.update(id, fields);
    await this.audit.record('REQUISITION', id, 'UPDATE', ctx, { title: before.title, status: before.status }, body);
    return this.getById(id);
  }

  async submit(id: number, ctx: PerfActionContext): Promise<RequisitionResponse> {
    const before = await this.repo.findById(id);
    if (!before) throw new Error('Requisition not found');
    if (before.status !== 'DRAFT') throw new Error(`Only DRAFT requisitions can be submitted (current: ${before.status})`);
    await this.repo.update(id, { status: 'PENDING_APPROVAL' });
    await this.audit.record('REQUISITION', id, 'SUBMIT', ctx, { status: before.status }, { status: 'PENDING_APPROVAL' });
    return this.getById(id);
  }

  async approve(id: number, ctx: PerfActionContext): Promise<RequisitionResponse> {
    const before = await this.repo.findById(id);
    if (!before) throw new Error('Requisition not found');
    if (before.status !== 'PENDING_APPROVAL') {
      throw new Error(`Only PENDING_APPROVAL requisitions can be approved (current: ${before.status})`);
    }
    await this.repo.update(id, { status: 'APPROVED', approved_by: ctx.userId, approved_at: new Date() });
    await this.audit.record('REQUISITION', id, 'APPROVE', ctx, { status: before.status }, { status: 'APPROVED' });
    await this.notifyRequester(before, `Requisition ${before.req_code} approved`, `"${before.title}" has been approved and can now carry internal job postings.`, ctx);
    return this.getById(id);
  }

  async reject(id: number, reason: string | null, ctx: PerfActionContext): Promise<RequisitionResponse> {
    const before = await this.repo.findById(id);
    if (!before) throw new Error('Requisition not found');
    if (before.status !== 'PENDING_APPROVAL') {
      throw new Error(`Only PENDING_APPROVAL requisitions can be rejected (current: ${before.status})`);
    }
    if (!reason || !String(reason).trim()) throw new Error('A rejection reason is required');
    await this.repo.update(id, { status: 'REJECTED', approved_by: ctx.userId, approved_at: new Date() });
    // The audit row carries the reason; there is no dedicated column for it.
    await this.audit.record('REQUISITION', id, 'REJECT', ctx, { status: before.status }, { status: 'REJECTED', reason: String(reason).trim() });
    await this.notifyRequester(before, `Requisition ${before.req_code} rejected`, `"${before.title}" was rejected: ${String(reason).trim()}`, ctx);
    return this.getById(id);
  }

  async cancel(id: number, ctx: PerfActionContext): Promise<RequisitionResponse> {
    const before = await this.repo.findById(id);
    if (!before) throw new Error('Requisition not found');
    if (!CANCELLABLE.includes(before.status)) {
      throw new Error(`A ${before.status} requisition cannot be cancelled`);
    }
    await this.repo.update(id, { status: 'CANCELLED' });
    await this.audit.record('REQUISITION', id, 'CANCEL', ctx, { status: before.status }, { status: 'CANCELLED' });
    return this.getById(id);
  }

  async budgetApprove(id: number, body: any, ctx: PerfActionContext): Promise<RequisitionResponse> {
    const before = await this.repo.findById(id);
    if (!before) throw new Error('Requisition not found');
    if (['REJECTED', 'CANCELLED', 'FULFILLED'].includes(before.status)) {
      throw new Error(`A ${before.status} requisition cannot receive budget approval`);
    }
    const fields: Record<string, any> = {
      budget_approved: 1,
      budget_approved_by: ctx.userId,
      budget_approved_at: new Date(),
    };
    if (body?.budgetAmount !== undefined && body.budgetAmount !== null) {
      const amount = Number(body.budgetAmount);
      if (!Number.isFinite(amount) || amount < 0) throw new Error('budgetAmount must be a non-negative number');
      fields.budget_amount = amount;
    }
    await this.repo.update(id, fields);
    await this.audit.record('REQUISITION', id, 'BUDGET_APPROVE', ctx, { budgetApproved: !!before.budget_approved, budgetAmount: before.budget_amount }, { budgetApproved: true, budgetAmount: fields.budget_amount ?? before.budget_amount });
    return this.getById(id);
  }

  /**
   * Vacancy overview across budgeted OPEN positions. Filled counts come from
   * employees.position_id links -- positions nobody has been linked to report
   * zero filled, which is stated in the note rather than papered over.
   */
  async vacancies(): Promise<{ note: string; positions: any[] }> {
    const rows = await this.repo.openPositionsWithFillCounts();
    return {
      note:
        'Filled counts come from employees.position_id links. A position with no linked employees reports 0 filled even if someone sits in it informally - the link, not this report, is the source of truth.',
      positions: rows.map((r) => {
        const budgeted = Number(r.headcount_budgeted ?? 1);
        const filled = Number(r.filled_count ?? 0);
        return {
          positionId: Number(r.id),
          code: String(r.code),
          title: String(r.title),
          departmentId: r.department_id === null ? null : Number(r.department_id),
          departmentName: r.department_name ?? null,
          jobRoleId: r.job_role_id === null ? null : Number(r.job_role_id),
          jobRoleName: r.job_role_name ?? null,
          employmentType: r.employment_type ?? null,
          status: r.status,
          budgetAmount: r.budget_amount === null ? null : Number(r.budget_amount),
          headcountBudgeted: budgeted,
          filled,
          vacancies: Math.max(0, budgeted - filled),
        };
      }),
    };
  }

  /** Called by the job-fill flow; marks the requisition FULFILLED when every linked posting is closed out. */
  async markFulfilledIfComplete(requisitionId: number, ctx: PerfActionContext): Promise<boolean> {
    const req = await this.repo.findById(requisitionId);
    if (!req || req.status !== 'APPROVED') return false;
    const unfilled = await this.repo.countUnfilledJobs(requisitionId);
    if (unfilled > 0) return false;
    await this.repo.update(requisitionId, { status: 'FULFILLED' });
    await this.audit.record('REQUISITION', requisitionId, 'FULFILL', ctx, { status: 'APPROVED' }, { status: 'FULFILLED' });
    return true;
  }

  private async notifyRequester(row: any, title: string, body: string, ctx: PerfActionContext): Promise<void> {
    if (!row.requested_by) return;
    try {
      await this.notifications.notify({
        userId: Number(row.requested_by),
        category: 'RECRUITMENT',
        title,
        body,
        linkPage: 'internal-jobs',
        linkRefId: Number(row.id),
        createdBy: ctx.userId,
      });
    } catch (err) {
      console.error('requisition notification failed:', err);
    }
  }
}
