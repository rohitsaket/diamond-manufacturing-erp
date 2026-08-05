import { DevelopmentRepository } from '../repositories/DevelopmentRepository';
import { PerfAuditService } from './PerfAuditService';
import { DevelopmentPlanItemResponse, DevelopmentPlanResponse, PerfActionContext } from '../types/performance';
import { toDateString } from '../utils/dateUtils';

const PLAN_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'];
const ITEM_TYPES = ['TRAINING', 'CERTIFICATION', 'MENTORING', 'PROJECT', 'READING', 'OTHER'];
const ITEM_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

/**
 * Individual development plans. Plan progress is always derived
 * (completed / total items) and recomputed on every item change -- it is a
 * cache, never an input.
 */
export class DevelopmentPlanService {
  private repo = new DevelopmentRepository();
  private audit = new PerfAuditService();

  async list(filters: { employeeId?: number; status?: string }): Promise<DevelopmentPlanResponse[]> {
    const rows = await this.repo.findPlans(filters);
    return rows.map((r) => this.toResponse(r));
  }

  async get(id: number): Promise<DevelopmentPlanResponse> {
    const row = await this.repo.findPlanById(id);
    if (!row) throw new Error('Development plan not found');
    const items = await this.repo.findPlanItems(id);
    const plan = this.toResponse(row);
    plan.items = items.map((i) => this.toItemResponse(i));
    return plan;
  }

  async create(body: any, ctx: PerfActionContext): Promise<DevelopmentPlanResponse> {
    const employeeId = Math.trunc(Number(body?.employeeId));
    if (!employeeId || !body?.title) throw new Error('employeeId and title are required');
    const employee = await this.repo.findEmployeeById(employeeId);
    if (!employee) throw new Error('Employee not found');
    const status = body.status ?? 'DRAFT';
    if (!PLAN_STATUSES.includes(status)) throw new Error(`status must be one of ${PLAN_STATUSES.join(', ')}`);
    if (body.mentorEmployeeId) {
      const mentor = await this.repo.findEmployeeById(Math.trunc(Number(body.mentorEmployeeId)));
      if (!mentor) throw new Error('Mentor employee not found');
    }

    const id = await this.repo.insertPlan({
      employeeId,
      cycleId: body.cycleId ? Math.trunc(Number(body.cycleId)) : null,
      title: String(body.title),
      careerGoal: body.careerGoal ?? null,
      targetRoleId: body.targetRoleId ? Math.trunc(Number(body.targetRoleId)) : null,
      mentorEmployeeId: body.mentorEmployeeId ? Math.trunc(Number(body.mentorEmployeeId)) : null,
      status,
      startDate: body.startDate ?? null,
      endDate: body.endDate ?? null,
      reviewNotes: body.reviewNotes ?? null,
      createdBy: ctx.userId,
    });

    if (Array.isArray(body.items)) {
      let sortOrder = 0;
      for (const item of body.items) {
        await this.addItemInternal(id, item, sortOrder++);
      }
      await this.repo.recomputePlanProgress(id);
    }

    await this.audit.record('DEV_PLAN', id, 'CREATE', ctx, null, { employeeId, title: body.title, items: body.items?.length ?? 0 });
    return this.get(id);
  }

  async update(id: number, body: any, ctx: PerfActionContext): Promise<DevelopmentPlanResponse> {
    const before = await this.repo.findPlanById(id);
    if (!before) throw new Error('Development plan not found');

    const sets: string[] = [];
    const params: any[] = [];
    if (body.title !== undefined) { sets.push('title = ?'); params.push(String(body.title)); }
    if (body.careerGoal !== undefined) { sets.push('career_goal = ?'); params.push(body.careerGoal ?? null); }
    if (body.targetRoleId !== undefined) { sets.push('target_role_id = ?'); params.push(body.targetRoleId ? Math.trunc(Number(body.targetRoleId)) : null); }
    if (body.mentorEmployeeId !== undefined) {
      if (body.mentorEmployeeId) {
        const mentor = await this.repo.findEmployeeById(Math.trunc(Number(body.mentorEmployeeId)));
        if (!mentor) throw new Error('Mentor employee not found');
      }
      sets.push('mentor_employee_id = ?'); params.push(body.mentorEmployeeId ? Math.trunc(Number(body.mentorEmployeeId)) : null);
    }
    if (body.status !== undefined) {
      if (!PLAN_STATUSES.includes(body.status)) throw new Error(`status must be one of ${PLAN_STATUSES.join(', ')}`);
      sets.push('status = ?'); params.push(body.status);
    }
    if (body.cycleId !== undefined) { sets.push('cycle_id = ?'); params.push(body.cycleId ? Math.trunc(Number(body.cycleId)) : null); }
    if (body.startDate !== undefined) { sets.push('start_date = ?'); params.push(body.startDate ?? null); }
    if (body.endDate !== undefined) { sets.push('end_date = ?'); params.push(body.endDate ?? null); }
    if (body.reviewNotes !== undefined) { sets.push('review_notes = ?'); params.push(body.reviewNotes ?? null); }
    if (sets.length === 0) throw new Error('Nothing to update');

    await this.repo.updatePlan(id, sets, params);
    await this.audit.record('DEV_PLAN', id, 'UPDATE', ctx, this.toResponse(before), body);
    return this.get(id);
  }

  async addItem(planId: number, body: any, ctx: PerfActionContext): Promise<DevelopmentPlanResponse> {
    const plan = await this.repo.findPlanById(planId);
    if (!plan) throw new Error('Development plan not found');
    const existing = await this.repo.findPlanItems(planId);
    const itemId = await this.addItemInternal(planId, body, existing.length);
    await this.repo.recomputePlanProgress(planId);
    await this.audit.record('DEV_PLAN_ITEM', itemId, 'CREATE', ctx, null, body);
    return this.get(planId);
  }

  private async addItemInternal(planId: number, body: any, defaultSortOrder: number): Promise<number> {
    if (!body?.title) throw new Error('Every development item needs a title');
    const itemType = body.itemType ?? 'TRAINING';
    if (!ITEM_TYPES.includes(itemType)) throw new Error(`itemType must be one of ${ITEM_TYPES.join(', ')}`);
    let trainingId: number | null = null;
    if (body.trainingId) {
      trainingId = Math.trunc(Number(body.trainingId));
      if (!(await this.repo.trainingExists(trainingId))) {
        throw new Error(`Training ${trainingId} does not exist in the trainings catalogue`);
      }
    }
    return this.repo.insertPlanItem({
      planId,
      itemType,
      title: String(body.title),
      description: body.description ?? null,
      trainingId,
      dueDate: body.dueDate ?? null,
      sortOrder: Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : defaultSortOrder,
    });
  }

  async updateItem(itemId: number, body: any, ctx: PerfActionContext): Promise<DevelopmentPlanResponse> {
    const before = await this.repo.findPlanItemById(itemId);
    if (!before) throw new Error('Development plan item not found');

    const sets: string[] = [];
    const params: any[] = [];
    if (body.title !== undefined) { sets.push('title = ?'); params.push(String(body.title)); }
    if (body.description !== undefined) { sets.push('description = ?'); params.push(body.description ?? null); }
    if (body.itemType !== undefined) {
      if (!ITEM_TYPES.includes(body.itemType)) throw new Error(`itemType must be one of ${ITEM_TYPES.join(', ')}`);
      sets.push('item_type = ?'); params.push(body.itemType);
    }
    if (body.trainingId !== undefined) {
      let trainingId: number | null = null;
      if (body.trainingId) {
        trainingId = Math.trunc(Number(body.trainingId));
        if (!(await this.repo.trainingExists(trainingId))) {
          throw new Error(`Training ${trainingId} does not exist in the trainings catalogue`);
        }
      }
      sets.push('training_id = ?'); params.push(trainingId);
    }
    if (body.dueDate !== undefined) { sets.push('due_date = ?'); params.push(body.dueDate ?? null); }
    if (body.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(Math.trunc(Number(body.sortOrder))); }
    if (body.status !== undefined) {
      if (!ITEM_STATUSES.includes(body.status)) throw new Error(`status must be one of ${ITEM_STATUSES.join(', ')}`);
      sets.push('status = ?'); params.push(body.status);
      // Status flips maintain completed_at in both directions.
      if (body.status === 'COMPLETED') sets.push('completed_at = NOW()');
      else sets.push('completed_at = NULL');
    }
    if (sets.length === 0) throw new Error('Nothing to update');

    await this.repo.updatePlanItem(itemId, sets, params);
    const progress = await this.repo.recomputePlanProgress(Number(before.plan_id));
    await this.audit.record('DEV_PLAN_ITEM', itemId, 'UPDATE', ctx, { status: before.status }, { ...body, planProgressPct: progress });
    return this.get(Number(before.plan_id));
  }

  async deleteItem(itemId: number, ctx: PerfActionContext): Promise<DevelopmentPlanResponse> {
    const before = await this.repo.findPlanItemById(itemId);
    if (!before) throw new Error('Development plan item not found');
    await this.repo.deletePlanItem(itemId);
    await this.repo.recomputePlanProgress(Number(before.plan_id));
    await this.audit.record('DEV_PLAN_ITEM', itemId, 'DELETE', ctx, { title: before.title }, null);
    return this.get(Number(before.plan_id));
  }

  /** ESS: latest ACTIVE plan, else the latest plan. */
  async myPlan(employeeId: number): Promise<DevelopmentPlanResponse | null> {
    const row = await this.repo.findLatestPlanForEmployee(employeeId);
    if (!row) return null;
    return this.get(Number(row.id));
  }

  private toResponse(r: any): DevelopmentPlanResponse {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      cycleId: r.cycle_id === null ? null : Number(r.cycle_id),
      title: String(r.title),
      careerGoal: r.career_goal ?? null,
      targetRoleId: r.target_role_id === null ? null : Number(r.target_role_id),
      targetRoleName: r.target_role_name ?? null,
      mentorEmployeeId: r.mentor_employee_id === null ? null : Number(r.mentor_employee_id),
      mentorName: r.mentor_name ?? null,
      status: r.status,
      startDate: r.start_date ? toDateString(r.start_date) : null,
      endDate: r.end_date ? toDateString(r.end_date) : null,
      progressPct: Number(r.progress_pct ?? 0),
      reviewNotes: r.review_notes ?? null,
    };
  }

  private toItemResponse(r: any): DevelopmentPlanItemResponse {
    return {
      id: Number(r.id),
      planId: Number(r.plan_id),
      itemType: r.item_type,
      title: String(r.title),
      description: r.description ?? null,
      trainingId: r.training_id === null ? null : Number(r.training_id),
      trainingTitle: r.training_title ?? null,
      dueDate: r.due_date ? toDateString(r.due_date) : null,
      status: r.status,
      completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
      sortOrder: Number(r.sort_order ?? 0),
    };
  }
}
