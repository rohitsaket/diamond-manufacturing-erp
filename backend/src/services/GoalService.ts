import { STAFF_ROLES } from '../middleware/auth';
import { GoalFilters, GoalRepository } from '../repositories/GoalRepository';
import {
  GoalMilestoneResponse,
  GoalResponse,
  GoalUpdateResponse,
  PerfActionContext,
} from '../types/performance';
import { isValidDateString, round2, toDateString } from '../utils/dateUtils';
import { num } from '../utils/payrollMath';
import { NotificationService } from './NotificationService';
import { PerfAuditService } from './PerfAuditService';
import { PerformanceCycleRepository } from '../repositories/PerformanceCycleRepository';

/** Who is acting: staff can touch anything, others only their own goals. */
export interface PerfActor extends PerfActionContext {
  employeeId: number | null;
}

const KINDS = new Set(['GOAL', 'OBJECTIVE', 'KEY_RESULT']);
const SCOPES = new Set(['INDIVIDUAL', 'TEAM', 'DEPARTMENT', 'ORGANIZATION']);
const PROGRESS_MODES = new Set(['MANUAL', 'METRIC', 'MILESTONES', 'CHILDREN']);
const PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const VISIBILITIES = new Set(['PRIVATE', 'MANAGER', 'ORGANIZATION']);
const TERMINAL_STATUSES = new Set(['COMPLETED', 'CANCELLED']);
const MAX_TREE_DEPTH = 6;

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function dateOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return toDateString(value);
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return num(value);
}

export function isStaffRole(role: string): boolean {
  return STAFF_ROLES.includes(role as (typeof STAFF_ROLES)[number]);
}

export function toGoalResponse(row: any): GoalResponse {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    kind: row.kind,
    scope: row.scope,
    employeeId: row.employee_id ?? null,
    employeeName: row.employee_name ?? null,
    teamId: row.team_id ?? null,
    teamName: row.team_name ?? null,
    departmentId: row.department_id ?? null,
    departmentName: row.department_name ?? null,
    parentGoalId: row.parent_goal_id ?? null,
    title: row.title,
    description: row.description ?? null,
    category: row.category ?? null,
    metricName: row.metric_name ?? null,
    metricUnit: row.metric_unit ?? null,
    startValue: numOrNull(row.start_value),
    targetValue: numOrNull(row.target_value),
    currentValue: numOrNull(row.current_value),
    weightagePct: num(row.weightage_pct),
    progressPct: num(row.progress_pct),
    progressMode: row.progress_mode,
    status: row.status,
    priority: row.priority,
    visibility: row.visibility,
    dueDate: dateOrNull(row.due_date),
    completedAt: isoOrNull(row.completed_at),
    approvedBy: row.approved_by ?? null,
    approvedAt: isoOrNull(row.approved_at),
    createdAt: isoOrNull(row.created_at) ?? '',
  };
}

export function toMilestoneResponse(row: any): GoalMilestoneResponse {
  return {
    id: row.id,
    goalId: row.goal_id,
    title: row.title,
    dueDate: dateOrNull(row.due_date),
    status: row.status,
    completedAt: isoOrNull(row.completed_at),
    sortOrder: num(row.sort_order),
  };
}

export function toGoalUpdateResponse(row: any): GoalUpdateResponse {
  return {
    id: row.id,
    goalId: row.goal_id,
    updateType: row.update_type,
    progressPct: numOrNull(row.progress_pct),
    currentValue: numOrNull(row.current_value),
    note: row.note ?? null,
    createdBy: row.created_by ?? null,
    actorName: row.actor_name ?? null,
    createdAt: isoOrNull(row.created_at) ?? '',
  };
}

/**
 * Goals and OKRs on one table: kind separates plain GOALs from OKR
 * OBJECTIVEs and their KEY_RESULTs. Progress recomputation follows the
 * goal's progress_mode and rolls up the parent chain (CHILDREN parents only,
 * capped at 6 hops so a bad parent link can never spin forever).
 */
export class GoalService {
  private repo = new GoalRepository();
  private cycles = new PerformanceCycleRepository();
  private audit = new PerfAuditService();
  private notifications = new NotificationService();

  // ==========================================================================
  // Reads
  // ==========================================================================

  async list(filters: GoalFilters): Promise<GoalResponse[]> {
    const rows = await this.repo.findAll(filters);
    return rows.map(toGoalResponse);
  }

  /**
   * Whole-cycle goal tree from one query. Depth is capped at 6 and a visited
   * set guards against cyclic parent links (defensive: the write path already
   * refuses to create them).
   */
  async tree(cycleId: number): Promise<GoalResponse[]> {
    if (!cycleId) throw new Error('cycleId is required');
    const rows = await this.repo.findByCycle(cycleId);
    const nodes = new Map<number, GoalResponse>();
    for (const row of rows) {
      const node = toGoalResponse(row);
      node.children = [];
      nodes.set(node.id, node);
    }

    const roots: GoalResponse[] = [];
    for (const node of nodes.values()) {
      const parentId = node.parentGoalId;
      if (parentId && parentId !== node.id && nodes.has(parentId)) {
        nodes.get(parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    }

    // Prune with a visited set; anything unreachable from a root (a parent
    // cycle) is promoted to a root rather than silently dropped.
    const visited = new Set<number>();
    const prune = (node: GoalResponse, depth: number): void => {
      visited.add(node.id);
      if (depth >= MAX_TREE_DEPTH) {
        node.children = [];
        return;
      }
      node.children = (node.children ?? []).filter((c) => !visited.has(c.id));
      for (const child of node.children) prune(child, depth + 1);
    };
    for (const root of roots) prune(root, 1);
    for (const node of nodes.values()) {
      if (!visited.has(node.id)) {
        roots.push(node);
        prune(node, 1);
      }
    }
    return roots;
  }

  async get(id: number): Promise<GoalResponse> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error(`Goal ${id} was not found`);
    const goal = toGoalResponse(row);
    const milestones = await this.repo.findMilestones(id);
    goal.milestones = milestones.map(toMilestoneResponse);
    const children = await this.repo.findChildren(id);
    goal.children = children.map(toGoalResponse);
    return goal;
  }

  async updates(id: number): Promise<GoalUpdateResponse[]> {
    await this.mustFind(id);
    const rows = await this.repo.findUpdates(id);
    return rows.map(toGoalUpdateResponse);
  }

  async myGoals(employeeId: number | null, cycleId?: number): Promise<GoalResponse[]> {
    if (!employeeId) {
      throw new Error('This account is not linked to an employee record, so it has no personal goals');
    }
    return this.list({ employeeId, cycleId });
  }

  // ==========================================================================
  // Create / update / delete
  // ==========================================================================

  async create(input: any, actor: PerfActor): Promise<GoalResponse> {
    if (!input?.title || !input?.cycleId) throw new Error('title and cycleId are required');

    const cycle = await this.cycles.findById(Number(input.cycleId));
    if (!cycle) throw new Error(`Performance cycle ${input.cycleId} was not found`);
    if (cycle.status === 'CLOSED') throw new Error('Goals cannot be added to a CLOSED cycle');

    const kind = input.kind ?? 'GOAL';
    const scope = input.scope ?? 'INDIVIDUAL';
    if (!KINDS.has(kind)) throw new Error(`Invalid goal kind "${kind}"`);
    if (!SCOPES.has(scope)) throw new Error(`Invalid goal scope "${scope}"`);

    let employeeId = input.employeeId ? Number(input.employeeId) : null;
    const teamId = input.teamId ? Number(input.teamId) : null;
    const departmentId = input.departmentId ? Number(input.departmentId) : null;

    // Self-service users may only create their own individual goals.
    if (!isStaffRole(actor.userRole)) {
      if (!actor.employeeId) {
        throw new Error('This account is not linked to an employee record, so it cannot create goals');
      }
      if (scope !== 'INDIVIDUAL') throw new Error('Self-service users can only create INDIVIDUAL goals');
      if (employeeId && employeeId !== actor.employeeId) {
        throw new Error('You can only create goals for yourself');
      }
      employeeId = actor.employeeId;
    }

    if (scope === 'INDIVIDUAL' && !employeeId) throw new Error('An INDIVIDUAL goal requires an employeeId');
    if (scope === 'TEAM' && !teamId) throw new Error('A TEAM goal requires a teamId');
    if (scope === 'DEPARTMENT' && !departmentId) throw new Error('A DEPARTMENT goal requires a departmentId');

    const parentGoalId = input.parentGoalId ? Number(input.parentGoalId) : null;
    if (parentGoalId) {
      const parent = await this.repo.findById(parentGoalId);
      if (!parent) throw new Error(`Parent goal ${parentGoalId} was not found`);
      if (kind === 'KEY_RESULT' && parent.kind !== 'OBJECTIVE') {
        throw new Error('A KEY_RESULT must be attached to a parent OBJECTIVE');
      }
    } else if (kind === 'KEY_RESULT') {
      throw new Error('A KEY_RESULT requires a parent OBJECTIVE (parentGoalId)');
    }

    const weightagePct = input.weightagePct === undefined ? 100 : num(input.weightagePct);
    if (weightagePct < 0 || weightagePct > 100) throw new Error('weightagePct must be between 0 and 100');

    const progressMode = input.progressMode ?? 'MANUAL';
    if (!PROGRESS_MODES.has(progressMode)) throw new Error(`Invalid progressMode "${progressMode}"`);
    const priority = input.priority ?? 'MEDIUM';
    if (!PRIORITIES.has(priority)) throw new Error(`Invalid priority "${priority}"`);
    const visibility = input.visibility ?? 'MANAGER';
    if (!VISIBILITIES.has(visibility)) throw new Error(`Invalid visibility "${visibility}"`);
    if (input.dueDate && !isValidDateString(String(input.dueDate))) {
      throw new Error('dueDate must be a valid YYYY-MM-DD date');
    }

    // Weightage budget: an employee's ACTIVE + PENDING_APPROVAL goals for the
    // cycle share 100%.
    let status: string = 'DRAFT';
    if (isStaffRole(actor.userRole) && input.status === 'ACTIVE') status = 'ACTIVE';
    if (scope === 'INDIVIDUAL' && employeeId) {
      const total = await this.repo.weightageTotal(Number(input.cycleId), employeeId);
      if (total + weightagePct > 100) {
        throw new Error(
          `This goal's weightage of ${weightagePct}% would exceed 100%: the employee already has ` +
            `${round2(total)}% allocated across ACTIVE and PENDING_APPROVAL goals in this cycle`,
        );
      }
    }

    const id = await this.repo.insert({
      cycle_id: Number(input.cycleId),
      kind,
      scope,
      employee_id: employeeId,
      team_id: teamId,
      department_id: departmentId,
      parent_goal_id: parentGoalId,
      title: String(input.title).trim(),
      description: input.description ?? null,
      category: input.category ?? null,
      metric_name: input.metricName ?? null,
      metric_unit: input.metricUnit ?? null,
      start_value: input.startValue ?? null,
      target_value: input.targetValue ?? null,
      current_value: input.currentValue ?? null,
      weightage_pct: weightagePct,
      progress_mode: progressMode,
      status,
      priority,
      visibility,
      due_date: input.dueDate ?? null,
      template_id: input.templateId ?? null,
      created_by: actor.userId,
    });

    const created = await this.get(id);
    await this.audit.record('GOAL', id, 'CREATE', actor, null, created);
    return created;
  }

  async update(id: number, input: any, actor: PerfActor): Promise<GoalResponse> {
    const before = await this.mustFind(id);
    this.assertCanTouch(before, actor);
    if (TERMINAL_STATUSES.has(before.status)) {
      throw new Error(`A ${before.status} goal cannot be edited`);
    }

    const fields: Record<string, any> = {};
    if (input.title !== undefined) fields.title = String(input.title).trim();
    if (input.description !== undefined) fields.description = input.description;
    if (input.category !== undefined) fields.category = input.category;
    if (input.metricName !== undefined) fields.metric_name = input.metricName;
    if (input.metricUnit !== undefined) fields.metric_unit = input.metricUnit;
    if (input.startValue !== undefined) fields.start_value = input.startValue;
    if (input.targetValue !== undefined) fields.target_value = input.targetValue;
    if (input.currentValue !== undefined) fields.current_value = input.currentValue;
    if (input.dueDate !== undefined) {
      if (input.dueDate !== null && !isValidDateString(String(input.dueDate))) {
        throw new Error('dueDate must be a valid YYYY-MM-DD date');
      }
      fields.due_date = input.dueDate;
    }
    if (input.priority !== undefined) {
      if (!PRIORITIES.has(input.priority)) throw new Error(`Invalid priority "${input.priority}"`);
      fields.priority = input.priority;
    }
    if (input.visibility !== undefined) {
      if (!VISIBILITIES.has(input.visibility)) throw new Error(`Invalid visibility "${input.visibility}"`);
      fields.visibility = input.visibility;
    }
    if (input.progressMode !== undefined) {
      if (!PROGRESS_MODES.has(input.progressMode)) throw new Error(`Invalid progressMode "${input.progressMode}"`);
      fields.progress_mode = input.progressMode;
    }
    if (input.weightagePct !== undefined) {
      const w = num(input.weightagePct);
      if (w < 0 || w > 100) throw new Error('weightagePct must be between 0 and 100');
      if (before.scope === 'INDIVIDUAL' && before.employee_id && ['ACTIVE', 'PENDING_APPROVAL'].includes(before.status)) {
        const total = await this.repo.weightageTotal(before.cycle_id, before.employee_id, id);
        if (total + w > 100) {
          throw new Error(
            `Weightage of ${w}% would exceed 100%: the employee already has ${round2(total)}% ` +
              'allocated across other ACTIVE and PENDING_APPROVAL goals in this cycle',
          );
        }
      }
      fields.weightage_pct = w;
    }
    if (Object.keys(fields).length === 0) throw new Error('No updatable fields were provided');

    await this.repo.update(id, fields);

    // Metric inputs or the mode itself may have changed; recompute and roll up.
    const fresh = await this.mustFind(id);
    const pct = await this.computeProgress(fresh);
    if (pct !== num(fresh.progress_pct)) await this.repo.update(id, { progress_pct: pct });
    await this.rollUpParents(fresh.parent_goal_id);

    const after = await this.get(id);
    await this.audit.record('GOAL', id, 'UPDATE', actor, toGoalResponse(before), after);
    return after;
  }

  async softDelete(id: number, actor: PerfActor): Promise<void> {
    const before = await this.mustFind(id);
    this.assertCanTouch(before, actor);
    await this.repo.softDelete(id);
    await this.rollUpParents(before.parent_goal_id);
    await this.audit.record('GOAL', id, 'DELETE', actor, toGoalResponse(before), null);
  }

  // ==========================================================================
  // Lifecycle: submit / approve / reject / complete / cancel
  // ==========================================================================

  async submit(id: number, actor: PerfActor): Promise<GoalResponse> {
    const goal = await this.mustFind(id);
    this.assertCanTouch(goal, actor);
    if (goal.status !== 'DRAFT') throw new Error(`Only a DRAFT goal can be submitted (this one is ${goal.status})`);

    if (goal.scope === 'INDIVIDUAL' && goal.employee_id) {
      const total = await this.repo.weightageTotal(goal.cycle_id, goal.employee_id, id);
      const w = num(goal.weightage_pct);
      if (total + w > 100) {
        throw new Error(
          `Submitting would push the employee's weightage past 100%: ${round2(total)}% is already ` +
            `allocated and this goal carries ${w}%`,
        );
      }
    }

    await this.repo.update(id, { status: 'PENDING_APPROVAL' });
    await this.repo.insertUpdate(id, 'STATUS', null, null, 'Submitted for approval', actor.userId);
    await this.audit.record('GOAL', id, 'SUBMIT', actor, { status: goal.status }, { status: 'PENDING_APPROVAL' });
    return this.get(id);
  }

  async approve(id: number, actor: PerfActor): Promise<GoalResponse> {
    const goal = await this.mustFind(id);
    if (goal.status !== 'PENDING_APPROVAL') {
      throw new Error(`Only a PENDING_APPROVAL goal can be approved (this one is ${goal.status})`);
    }
    await this.repo.update(id, { status: 'ACTIVE', approved_by: actor.userId, approved_at: new Date() });
    await this.repo.insertUpdate(id, 'APPROVAL', null, null, 'Goal approved', actor.userId);
    await this.audit.record('GOAL', id, 'APPROVE', actor, { status: goal.status }, { status: 'ACTIVE' });
    await this.notifyGoalOwner(goal, 'Goal approved', `Your goal "${goal.title}" has been approved and is now active.`);
    return this.get(id);
  }

  async reject(id: number, reason: string, actor: PerfActor): Promise<GoalResponse> {
    if (!reason || !String(reason).trim()) throw new Error('A rejection reason is required');
    const goal = await this.mustFind(id);
    if (goal.status !== 'PENDING_APPROVAL') {
      throw new Error(`Only a PENDING_APPROVAL goal can be rejected (this one is ${goal.status})`);
    }
    await this.repo.update(id, { status: 'REJECTED' });
    await this.repo.insertUpdate(id, 'APPROVAL', null, null, `Rejected: ${String(reason).trim()}`, actor.userId);
    await this.audit.record('GOAL', id, 'REJECT', actor, { status: goal.status }, { status: 'REJECTED', reason });
    await this.notifyGoalOwner(goal, 'Goal rejected', `Your goal "${goal.title}" was rejected: ${String(reason).trim()}`);
    return this.get(id);
  }

  async complete(id: number, actor: PerfActor): Promise<GoalResponse> {
    const goal = await this.mustFind(id);
    this.assertCanTouch(goal, actor);
    if (TERMINAL_STATUSES.has(goal.status)) throw new Error(`This goal is already ${goal.status}`);
    await this.repo.update(id, { status: 'COMPLETED', completed_at: new Date(), progress_pct: 100 });
    await this.repo.insertUpdate(id, 'STATUS', 100, null, 'Goal completed', actor.userId);
    await this.rollUpParents(goal.parent_goal_id);
    await this.audit.record('GOAL', id, 'COMPLETE', actor, { status: goal.status }, { status: 'COMPLETED' });
    return this.get(id);
  }

  async cancel(id: number, actor: PerfActor): Promise<GoalResponse> {
    const goal = await this.mustFind(id);
    this.assertCanTouch(goal, actor);
    if (TERMINAL_STATUSES.has(goal.status)) throw new Error(`This goal is already ${goal.status}`);
    await this.repo.update(id, { status: 'CANCELLED' });
    await this.repo.insertUpdate(id, 'STATUS', null, null, 'Goal cancelled', actor.userId);
    await this.rollUpParents(goal.parent_goal_id);
    await this.audit.record('GOAL', id, 'CANCEL', actor, { status: goal.status }, { status: 'CANCELLED' });
    return this.get(id);
  }

  // ==========================================================================
  // Progress
  // ==========================================================================

  async recordProgress(
    id: number,
    input: { progressPct?: number; currentValue?: number; note?: string | null },
    actor: PerfActor,
  ): Promise<GoalResponse> {
    const goal = await this.mustFind(id);
    this.assertCanTouch(goal, actor);
    if (TERMINAL_STATUSES.has(goal.status) || goal.status === 'REJECTED') {
      throw new Error(`Progress cannot be recorded on a ${goal.status} goal`);
    }
    if (input.progressPct === undefined && input.currentValue === undefined && !input.note) {
      throw new Error('Provide progressPct, currentValue or a note');
    }

    const fields: Record<string, any> = {};
    if (input.currentValue !== undefined) fields.current_value = num(input.currentValue);
    if (Object.keys(fields).length > 0) await this.repo.update(id, fields);

    const fresh = await this.mustFind(id);
    const manualPct = input.progressPct === undefined ? undefined : Math.min(100, Math.max(0, num(input.progressPct)));
    const pct = await this.computeProgress(fresh, manualPct);
    await this.repo.update(id, { progress_pct: pct });

    await this.repo.insertUpdate(
      id,
      'PROGRESS',
      pct,
      input.currentValue === undefined ? null : num(input.currentValue),
      input.note ?? null,
      actor.userId,
    );
    await this.rollUpParents(fresh.parent_goal_id);
    await this.audit.record(
      'GOAL',
      id,
      'PROGRESS',
      actor,
      { progressPct: num(goal.progress_pct), currentValue: numOrNull(goal.current_value) },
      { progressPct: pct, currentValue: input.currentValue ?? numOrNull(fresh.current_value) },
    );
    return this.get(id);
  }

  /**
   * progress_pct by mode: MANUAL takes the caller's figure, METRIC derives
   * from (current-start)/(target-start), MILESTONES from completed/total,
   * CHILDREN from the weightage-weighted mean of live children.
   */
  private async computeProgress(goalRow: any, manualPct?: number): Promise<number> {
    switch (goalRow.progress_mode) {
      case 'MANUAL':
        return manualPct === undefined ? num(goalRow.progress_pct) : round2(manualPct);
      case 'METRIC': {
        const start = num(goalRow.start_value);
        const target = num(goalRow.target_value);
        const current = num(goalRow.current_value);
        if (target === start) return 0; // guard: no measurable distance
        return round2(Math.min(100, Math.max(0, ((current - start) / (target - start)) * 100)));
      }
      case 'MILESTONES': {
        const milestones = await this.repo.findMilestones(goalRow.id);
        if (milestones.length === 0) return 0;
        const completed = milestones.filter((m) => m.status === 'COMPLETED').length;
        return round2((completed / milestones.length) * 100);
      }
      case 'CHILDREN':
        return this.childrenWeightedProgress(goalRow.id);
      default:
        return num(goalRow.progress_pct);
    }
  }

  private async childrenWeightedProgress(goalId: number): Promise<number> {
    const children = (await this.repo.findChildren(goalId)).filter(
      (c) => c.status !== 'CANCELLED' && c.status !== 'REJECTED',
    );
    if (children.length === 0) return 0;
    const totalWeight = children.reduce((s, c) => s + num(c.weightage_pct), 0);
    if (totalWeight === 0) {
      return round2(children.reduce((s, c) => s + num(c.progress_pct), 0) / children.length);
    }
    return round2(children.reduce((s, c) => s + num(c.progress_pct) * num(c.weightage_pct), 0) / totalWeight);
  }

  /**
   * Walk up the parent chain (max 6 hops) recomputing every CHILDREN-mode
   * parent. Stops at the first parent whose progress is not child-derived,
   * because nothing above it can change either.
   */
  private async rollUpParents(parentGoalId: number | null): Promise<void> {
    let currentId = parentGoalId;
    const seen = new Set<number>();
    let hops = 0;
    while (currentId && hops < MAX_TREE_DEPTH && !seen.has(currentId)) {
      seen.add(currentId);
      hops += 1;
      const parent = await this.repo.findById(currentId);
      if (!parent || parent.progress_mode !== 'CHILDREN') break;
      const pct = await this.childrenWeightedProgress(parent.id);
      await this.repo.update(parent.id, { progress_pct: pct });
      currentId = parent.parent_goal_id ?? null;
    }
  }

  // ==========================================================================
  // Milestones
  // ==========================================================================

  async addMilestone(goalId: number, input: any, actor: PerfActor): Promise<GoalMilestoneResponse> {
    const goal = await this.mustFind(goalId);
    this.assertCanTouch(goal, actor);
    if (TERMINAL_STATUSES.has(goal.status)) throw new Error(`Milestones cannot be added to a ${goal.status} goal`);
    if (!input?.title) throw new Error('A milestone title is required');
    if (input.dueDate && !isValidDateString(String(input.dueDate))) {
      throw new Error('dueDate must be a valid YYYY-MM-DD date');
    }
    const id = await this.repo.insertMilestone({
      goal_id: goalId,
      title: String(input.title).trim(),
      due_date: input.dueDate ?? null,
      status: 'PENDING',
      sort_order: input.sortOrder ?? 0,
    });
    await this.refreshMilestoneProgress(goal);
    await this.audit.record('GOAL_MILESTONE', id, 'CREATE', actor, null, { goalId, title: input.title });
    const row = await this.repo.findMilestoneById(id);
    return toMilestoneResponse(row);
  }

  async updateMilestone(id: number, input: any, actor: PerfActor): Promise<GoalMilestoneResponse> {
    const before = await this.repo.findMilestoneById(id);
    if (!before) throw new Error(`Milestone ${id} was not found`);
    const goal = await this.mustFind(before.goal_id);
    this.assertCanTouch(goal, actor);

    const fields: Record<string, any> = {};
    if (input.title !== undefined) fields.title = String(input.title).trim();
    if (input.dueDate !== undefined) {
      if (input.dueDate !== null && !isValidDateString(String(input.dueDate))) {
        throw new Error('dueDate must be a valid YYYY-MM-DD date');
      }
      fields.due_date = input.dueDate;
    }
    if (input.sortOrder !== undefined) fields.sort_order = num(input.sortOrder);
    if (input.status !== undefined) {
      if (!['PENDING', 'COMPLETED', 'MISSED'].includes(input.status)) {
        throw new Error(`Invalid milestone status "${input.status}"`);
      }
      fields.status = input.status;
      // A status flip sets or clears completed_at.
      fields.completed_at = input.status === 'COMPLETED' ? new Date() : null;
    }
    if (Object.keys(fields).length === 0) throw new Error('No updatable fields were provided');

    await this.repo.updateMilestone(id, fields);
    await this.refreshMilestoneProgress(goal);
    await this.audit.record('GOAL_MILESTONE', id, 'UPDATE', actor, toMilestoneResponse(before), input);
    const row = await this.repo.findMilestoneById(id);
    return toMilestoneResponse(row);
  }

  async deleteMilestone(id: number, actor: PerfActor): Promise<void> {
    const before = await this.repo.findMilestoneById(id);
    if (!before) throw new Error(`Milestone ${id} was not found`);
    const goal = await this.mustFind(before.goal_id);
    this.assertCanTouch(goal, actor);
    await this.repo.deleteMilestone(id);
    await this.refreshMilestoneProgress(goal);
    await this.audit.record('GOAL_MILESTONE', id, 'DELETE', actor, toMilestoneResponse(before), null);
  }

  private async refreshMilestoneProgress(goalRow: any): Promise<void> {
    if (goalRow.progress_mode !== 'MILESTONES') return;
    const pct = await this.computeProgress(goalRow);
    await this.repo.update(goalRow.id, { progress_pct: pct });
    await this.rollUpParents(goalRow.parent_goal_id ?? null);
  }

  // ==========================================================================
  // Templates & bulk creation
  // ==========================================================================

  async listTemplates(): Promise<any[]> {
    const rows = await this.repo.findTemplates();
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      kind: r.kind,
      scope: r.scope,
      category: r.category ?? null,
      titleTemplate: r.title_template,
      descriptionTemplate: r.description_template ?? null,
      metricName: r.metric_name ?? null,
      metricUnit: r.metric_unit ?? null,
      suggestedWeightagePct: numOrNull(r.suggested_weightage_pct),
      isActive: !!r.is_active,
    }));
  }

  async createTemplate(input: any, ctx: PerfActionContext): Promise<any> {
    if (!input?.code || !input?.name || !input?.titleTemplate) {
      throw new Error('code, name and titleTemplate are required');
    }
    const existing = await this.repo.findTemplateByCode(String(input.code).trim());
    if (existing) throw new Error(`A goal template with code "${input.code}" already exists`);
    if (input.kind && !KINDS.has(input.kind)) throw new Error(`Invalid kind "${input.kind}"`);
    if (input.scope && !SCOPES.has(input.scope)) throw new Error(`Invalid scope "${input.scope}"`);

    const id = await this.repo.insertTemplate({
      code: String(input.code).trim(),
      name: String(input.name).trim(),
      kind: input.kind ?? 'GOAL',
      scope: input.scope ?? 'INDIVIDUAL',
      category: input.category ?? null,
      title_template: String(input.titleTemplate).trim(),
      description_template: input.descriptionTemplate ?? null,
      metric_name: input.metricName ?? null,
      metric_unit: input.metricUnit ?? null,
      suggested_weightage_pct: input.suggestedWeightagePct ?? null,
      is_active: input.isActive === undefined ? true : !!input.isActive,
      created_by: ctx.userId,
    });
    await this.audit.record('GOAL_TEMPLATE', id, 'CREATE', ctx, null, input);
    const all = await this.listTemplates();
    return all.find((t) => t.id === id);
  }

  async updateTemplate(id: number, input: any, ctx: PerfActionContext): Promise<any> {
    const before = await this.repo.findTemplateById(id);
    if (!before) throw new Error(`Goal template ${id} was not found`);

    const fields: Record<string, any> = {};
    if (input.name !== undefined) fields.name = String(input.name).trim();
    if (input.kind !== undefined) {
      if (!KINDS.has(input.kind)) throw new Error(`Invalid kind "${input.kind}"`);
      fields.kind = input.kind;
    }
    if (input.scope !== undefined) {
      if (!SCOPES.has(input.scope)) throw new Error(`Invalid scope "${input.scope}"`);
      fields.scope = input.scope;
    }
    if (input.category !== undefined) fields.category = input.category;
    if (input.titleTemplate !== undefined) fields.title_template = String(input.titleTemplate).trim();
    if (input.descriptionTemplate !== undefined) fields.description_template = input.descriptionTemplate;
    if (input.metricName !== undefined) fields.metric_name = input.metricName;
    if (input.metricUnit !== undefined) fields.metric_unit = input.metricUnit;
    if (input.suggestedWeightagePct !== undefined) fields.suggested_weightage_pct = input.suggestedWeightagePct;
    if (input.isActive !== undefined) fields.is_active = !!input.isActive;
    if (Object.keys(fields).length === 0) throw new Error('No updatable fields were provided');

    await this.repo.updateTemplate(id, fields);
    await this.audit.record('GOAL_TEMPLATE', id, 'UPDATE', ctx, before, input);
    const all = await this.listTemplates();
    return all.find((t) => t.id === id);
  }

  /**
   * Stamp one template across many employees as DRAFT individual goals.
   * Skips (with a reason) rather than fails: a missing employee or an
   * existing goal with the same title never blocks the rest of the batch.
   */
  async bulkFromTemplate(
    input: { templateId?: number; cycleId?: number; employeeIds?: number[]; targetValue?: number; dueDate?: string },
    actor: PerfActor,
  ): Promise<{ created: number; skipped: { employeeId: number; reason: string }[] }> {
    if (!input.templateId || !input.cycleId || !Array.isArray(input.employeeIds) || input.employeeIds.length === 0) {
      throw new Error('templateId, cycleId and a non-empty employeeIds array are required');
    }
    const template = await this.repo.findTemplateById(Number(input.templateId));
    if (!template) throw new Error(`Goal template ${input.templateId} was not found`);
    if (!template.is_active) throw new Error(`Goal template "${template.code}" is inactive`);
    const cycle = await this.cycles.findById(Number(input.cycleId));
    if (!cycle) throw new Error(`Performance cycle ${input.cycleId} was not found`);
    if (cycle.status === 'CLOSED') throw new Error('Goals cannot be added to a CLOSED cycle');
    if (input.dueDate && !isValidDateString(String(input.dueDate))) {
      throw new Error('dueDate must be a valid YYYY-MM-DD date');
    }

    const title = input.targetValue === undefined
      ? String(template.title_template)
      : String(template.title_template).replace(/\{target\}/g, String(input.targetValue));

    const ids = [...new Set(input.employeeIds.map((e) => Number(e)))];
    const employees = await this.repo.findEmployeesByIds(ids);
    const byId = new Map(employees.map((e) => [Number(e.id), e]));

    let created = 0;
    const skipped: { employeeId: number; reason: string }[] = [];
    for (const employeeId of ids) {
      const employee = byId.get(employeeId);
      if (!employee) {
        skipped.push({ employeeId, reason: 'employee not found' });
        continue;
      }
      if (await this.repo.titleExists(Number(input.cycleId), employeeId, title)) {
        skipped.push({ employeeId, reason: 'a goal with the same title already exists for this cycle' });
        continue;
      }
      const goalId = await this.repo.insert({
        cycle_id: Number(input.cycleId),
        kind: 'GOAL',
        scope: 'INDIVIDUAL',
        employee_id: employeeId,
        title,
        description: template.description_template ?? null,
        category: template.category ?? null,
        metric_name: template.metric_name ?? null,
        metric_unit: template.metric_unit ?? null,
        target_value: input.targetValue ?? null,
        weightage_pct: numOrNull(template.suggested_weightage_pct) ?? 100,
        progress_mode: template.metric_name ? 'METRIC' : 'MANUAL',
        status: 'DRAFT',
        due_date: input.dueDate ?? null,
        template_id: template.id,
        created_by: actor.userId,
      });
      await this.audit.record('GOAL', goalId, 'CREATE_FROM_TEMPLATE', actor, null, {
        templateId: template.id,
        employeeId,
        title,
      });
      created += 1;
    }
    return { created, skipped };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private async mustFind(id: number): Promise<any> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error(`Goal ${id} was not found`);
    return row;
  }

  /** Staff may act on any goal; self-service users only on their own. */
  private assertCanTouch(goalRow: any, actor: PerfActor): void {
    if (isStaffRole(actor.userRole)) return;
    if (actor.employeeId && goalRow.employee_id === actor.employeeId) return;
    throw new Error('You can only act on your own goals');
  }

  /** In-app notification; never fails the write it accompanies. */
  private async notifyGoalOwner(goalRow: any, title: string, body: string): Promise<void> {
    if (!goalRow.employee_id) return;
    try {
      await this.notifications.notifyEmployee(goalRow.employee_id, {
        category: 'PERFORMANCE' as any,
        title,
        body,
        linkPage: 'performance',
        linkRefId: goalRow.id,
      });
    } catch (err) {
      console.error(`goal notification failed for goal #${goalRow.id}:`, err);
    }
  }
}
