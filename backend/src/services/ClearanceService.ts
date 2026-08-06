import { ExitProcessRepository } from '../repositories/ExitProcessRepository';
import { SeparationRepository } from '../repositories/SeparationRepository';
import { ClearanceResponse, ClearanceTaskResponse } from '../types/offboarding';
import { PerfActionContext } from '../types/performance';
import { toDateString, todayString } from '../utils/dateUtils';
import { ExitAuditService } from './ExitAuditService';

const CLEARANCE_STATUSES = new Set(['PENDING', 'IN_PROGRESS', 'CLEARED', 'BLOCKED']);
const TASK_STATUSES = new Set(['PENDING', 'DONE', 'NA']);

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function toClearanceResponse(row: any): ClearanceResponse {
  return {
    id: row.id,
    separationId: row.separation_id,
    department: row.department,
    status: row.status,
    note: row.note ?? null,
    clearedBy: row.cleared_by ?? null,
    clearedByName: row.cleared_by_name ?? null,
    clearedAt: isoOrNull(row.cleared_at),
  };
}

export function toClearanceTaskResponse(row: any): ClearanceTaskResponse {
  return {
    id: row.id,
    clearanceId: row.clearance_id,
    task: row.task,
    status: row.status,
    note: row.note ?? null,
    doneBy: row.done_by ?? null,
    doneAt: isoOrNull(row.done_at),
    sortOrder: Number(row.sort_order),
  };
}

/**
 * Departmental clearances. CLEARED is earned, not declared: every task of
 * the clearance must be DONE or NA first. When the last clearance of a case
 * clears, the case itself advances to SETTLEMENT.
 */
export class ClearanceService {
  private repo = new ExitProcessRepository();
  private separations = new SeparationRepository();
  private audit = new ExitAuditService();

  async list(filters: { separationId?: number; department?: string; status?: string; limit?: number }): Promise<ClearanceResponse[]> {
    const rows = await this.repo.findClearances(filters);
    const tasks = await this.repo.findTasksForClearances(rows.map((r) => Number(r.id)));
    const byClearance = new Map<number, any[]>();
    for (const t of tasks) {
      const list = byClearance.get(Number(t.clearance_id)) ?? [];
      list.push(t);
      byClearance.set(Number(t.clearance_id), list);
    }
    return rows.map((row) => ({
      ...toClearanceResponse(row),
      tasks: (byClearance.get(Number(row.id)) ?? []).map(toClearanceTaskResponse),
    }));
  }

  async updateClearance(
    id: number,
    input: { status?: string; note?: string | null },
    ctx: PerfActionContext,
  ): Promise<ClearanceResponse> {
    const before = await this.mustFindClearance(id);
    const fields: Record<string, any> = {};
    let status: string | null = null;

    if (input.status !== undefined) {
      status = String(input.status).toUpperCase();
      if (!CLEARANCE_STATUSES.has(status)) throw new Error(`Invalid clearance status "${input.status}"`);

      if (status === 'CLEARED') {
        // The guard: a clearance cannot be CLEARED over pending tasks.
        const pending = await this.repo.findPendingTasks(id);
        if (pending.length > 0) {
          const list = pending.map((t) => `#${t.id} ${t.task}`).join('; ');
          throw new Error(
            `Cannot mark ${before.department} clearance CLEARED: ${pending.length} task(s) are still PENDING (${list})`,
          );
        }
        fields.cleared_by = ctx.userId;
        fields.cleared_at = new Date();
      } else {
        fields.cleared_by = null;
        fields.cleared_at = null;
      }
      fields.status = status;
    }
    if (input.note !== undefined) fields.note = input.note === null ? null : String(input.note).trim();
    if (Object.keys(fields).length === 0) throw new Error('Provide a status or a note');

    await this.repo.updateClearance(id, fields);
    if (status) {
      await this.separations.insertEvent(
        before.separation_id,
        status === 'CLEARED' ? 'CLEARANCE_CLEARED' : 'CLEARANCE_UPDATED',
        `${before.department} clearance ${status === 'CLEARED' ? 'cleared' : `set to ${status}`}${input.note ? `: ${input.note}` : '.'}`,
        ctx.userId,
      );
      if (status === 'CLEARED') await this.advanceCaseIfFullyCleared(before.separation_id, ctx);
    }
    await this.audit.record('CLEARANCE', id, 'UPDATE', ctx,
      { status: before.status, note: before.note }, { status: status ?? before.status, note: input.note ?? before.note });

    const after = await this.mustFindClearance(id);
    const tasks = await this.repo.findTasks(id);
    return { ...toClearanceResponse(after), tasks: tasks.map(toClearanceTaskResponse) };
  }

  async updateTask(
    id: number,
    input: { status?: string; note?: string | null },
    ctx: PerfActionContext,
  ): Promise<ClearanceTaskResponse> {
    const before = await this.repo.findTaskById(id);
    if (!before) throw new Error(`Clearance task ${id} was not found`);

    const fields: Record<string, any> = {};
    if (input.status !== undefined) {
      const status = String(input.status).toUpperCase();
      if (!TASK_STATUSES.has(status)) throw new Error(`Invalid task status "${input.status}"`);
      fields.status = status;
      fields.done_by = status === 'PENDING' ? null : ctx.userId;
      fields.done_at = status === 'PENDING' ? null : new Date();
    }
    if (input.note !== undefined) fields.note = input.note === null ? null : String(input.note).trim();
    if (Object.keys(fields).length === 0) throw new Error('Provide a status or a note');

    await this.repo.updateTask(id, fields);
    await this.audit.record('CLEARANCE_TASK', id, 'UPDATE', ctx,
      { status: before.status, note: before.note }, input);
    return toClearanceTaskResponse(await this.repo.findTaskById(id));
  }

  async addTask(clearanceId: number, task: string, ctx: PerfActionContext): Promise<ClearanceTaskResponse> {
    const clearance = await this.mustFindClearance(clearanceId);
    if (!task || !String(task).trim()) throw new Error('A task description is required');
    if (clearance.status === 'CLEARED') {
      throw new Error('Tasks cannot be added to a CLEARED clearance; reopen it first');
    }
    const existing = await this.repo.findTasks(clearanceId);
    const id = await this.repo.insertTask(clearanceId, String(task).trim(), existing.length);
    await this.audit.record('CLEARANCE_TASK', id, 'CREATE', ctx, null, { clearanceId, task });
    return toClearanceTaskResponse(await this.repo.findTaskById(id));
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  /**
   * When the last clearance clears, move the case to SETTLEMENT - from
   * CLEARANCE always, from IN_NOTICE only once the last working day has
   * passed (before that the person is still serving notice).
   */
  private async advanceCaseIfFullyCleared(separationId: number, ctx: PerfActionContext): Promise<void> {
    const open = await this.repo.countUnclearedClearances(separationId);
    if (open > 0) return;
    const separation = await this.separations.findById(separationId);
    if (!separation) return;

    const lwd = separation.last_working_day ? toDateString(separation.last_working_day) : null;
    const shouldAdvance =
      separation.status === 'CLEARANCE' ||
      (separation.status === 'IN_NOTICE' && lwd !== null && lwd <= todayString());
    if (!shouldAdvance) return;

    await this.separations.update(separationId, { status: 'SETTLEMENT' });
    await this.separations.insertEvent(
      separationId, 'ALL_CLEARANCES_CLEARED',
      'Every departmental clearance is cleared; case moved to SETTLEMENT.', ctx.userId,
    );
    await this.audit.record('SEPARATION', separationId, 'STATUS_ADVANCE', ctx,
      { status: separation.status }, { status: 'SETTLEMENT', trigger: 'ALL_CLEARANCES_CLEARED' });
  }

  private async mustFindClearance(id: number): Promise<any> {
    const row = await this.repo.findClearanceById(id);
    if (!row) throw new Error(`Clearance ${id} was not found`);
    return row;
  }
}
