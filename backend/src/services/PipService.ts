import { DevelopmentRepository } from '../repositories/DevelopmentRepository';
import { PerfAuditService } from './PerfAuditService';
import { NotificationService } from './NotificationService';
import { PerfActionContext, PipObjectiveResponse, PipResponse, PipReviewResponse } from '../types/performance';
import { NotificationCategory } from '../types/hrms';
import { toDateString } from '../utils/dateUtils';

const OBJECTIVE_STATUSES = ['PENDING', 'ON_TRACK', 'AT_RISK', 'MET', 'NOT_MET'];
const PROGRESS_VALUES = ['ON_TRACK', 'AT_RISK', 'OFF_TRACK'];
const OUTCOMES: Record<string, string> = {
  SUCCESSFUL: 'CLOSED_SUCCESSFUL',
  UNSUCCESSFUL: 'CLOSED_UNSUCCESSFUL',
  WITHDRAWN: 'WITHDRAWN',
};
const CLOSED_STATUSES = ['CLOSED_SUCCESSFUL', 'CLOSED_UNSUCCESSFUL', 'WITHDRAWN'];

const PERFORMANCE_CATEGORY = 'PERFORMANCE' as NotificationCategory;

/**
 * Performance improvement plans. PIPs are confidential: the routes restrict
 * every endpoint to admin/hr/manager and nothing here is ever exposed through
 * employee self-service.
 */
export class PipService {
  private repo = new DevelopmentRepository();
  private audit = new PerfAuditService();
  private notifications = new NotificationService();

  async list(filters: { status?: string; employeeId?: number }): Promise<PipResponse[]> {
    const rows = await this.repo.findPips(filters);
    return rows.map((r) => this.toResponse(r));
  }

  async get(id: number): Promise<PipResponse> {
    const row = await this.repo.findPipById(id);
    if (!row) throw new Error('PIP not found');
    const [objectives, reviews] = await Promise.all([
      this.repo.findPipObjectives(id),
      this.repo.findPipReviews(id),
    ]);
    const pip = this.toResponse(row);
    pip.objectives = objectives.map((o) => this.toObjectiveResponse(o));
    pip.reviews = reviews.map((r) => this.toReviewResponse(r));
    return pip;
  }

  async create(body: any, ctx: PerfActionContext): Promise<PipResponse> {
    const employeeId = Math.trunc(Number(body?.employeeId));
    if (!employeeId || !body?.reason || !body?.startDate || !body?.endDate) {
      throw new Error('employeeId, reason, startDate and endDate are required');
    }
    if (String(body.endDate) <= String(body.startDate)) throw new Error('endDate must be after startDate');
    const employee = await this.repo.findEmployeeById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const objectives = Array.isArray(body.objectives) ? body.objectives : [];
    const cleanObjectives = objectives.map((o: any, index: number) => {
      if (!o?.objective || !String(o.objective).trim()) throw new Error(`Objective ${index + 1} needs text`);
      return {
        objective: String(o.objective).trim(),
        successCriteria: o.successCriteria ? String(o.successCriteria) : null,
        sortOrder: index,
      };
    });

    const id = await this.repo.insertPip(
      {
        employeeId,
        cycleId: body.cycleId ? Math.trunc(Number(body.cycleId)) : null,
        reason: String(body.reason),
        startDate: String(body.startDate),
        endDate: String(body.endDate),
        status: 'DRAFT',
        openedBy: ctx.userId,
      },
      cleanObjectives,
    );
    await this.audit.record('PIP', id, 'CREATE', ctx, null, { employeeId, startDate: body.startDate, endDate: body.endDate, objectives: cleanObjectives.length });
    return this.get(id);
  }

  async update(id: number, body: any, ctx: PerfActionContext): Promise<PipResponse> {
    const before = await this.repo.findPipById(id);
    if (!before) throw new Error('PIP not found');
    if (CLOSED_STATUSES.includes(before.status)) throw new Error(`PIP cannot be edited once ${before.status}`);

    const sets: string[] = [];
    const params: any[] = [];
    if (body.reason !== undefined) { sets.push('reason = ?'); params.push(String(body.reason)); }
    if (body.startDate !== undefined) { sets.push('start_date = ?'); params.push(String(body.startDate)); }
    if (body.endDate !== undefined) { sets.push('end_date = ?'); params.push(String(body.endDate)); }
    if (body.cycleId !== undefined) { sets.push('cycle_id = ?'); params.push(body.cycleId ? Math.trunc(Number(body.cycleId)) : null); }
    if (body.status !== undefined && body.status === 'PENDING_APPROVAL') {
      if (before.status !== 'DRAFT') throw new Error('Only DRAFT PIPs can move to PENDING_APPROVAL');
      sets.push("status = 'PENDING_APPROVAL'");
    }
    if (sets.length === 0) throw new Error('Nothing to update');

    await this.repo.updatePip(id, sets, params);
    await this.audit.record('PIP', id, 'UPDATE', ctx, { status: before.status }, body);
    return this.get(id);
  }

  async activate(id: number, ctx: PerfActionContext): Promise<PipResponse> {
    const before = await this.repo.findPipById(id);
    if (!before) throw new Error('PIP not found');
    if (!['DRAFT', 'PENDING_APPROVAL'].includes(before.status)) {
      throw new Error(`PIP cannot be activated from status ${before.status}`);
    }
    await this.repo.updatePip(id, ["status = 'ACTIVE'", 'approved_by = ?', 'approved_at = NOW()'], [ctx.userId]);
    await this.audit.record('PIP', id, 'ACTIVATE', ctx, { status: before.status }, { status: 'ACTIVE' });

    // Confidential: only admin/hr are notified, never the wider org.
    try {
      await this.notifications.notifyRoles(['admin', 'hr'], {
        category: PERFORMANCE_CATEGORY,
        title: `PIP activated for ${before.employee_name} (${before.emp_code})`,
        body: `Runs ${toDateString(before.start_date)} to ${toDateString(before.end_date)}.`,
        linkPage: 'performance',
        linkRefId: id,
        createdBy: ctx.userId,
      });
    } catch (err) {
      console.error('pip-activated notification failed:', err);
    }
    return this.get(id);
  }

  async updateObjective(objectiveId: number, status: string, ctx: PerfActionContext): Promise<PipResponse> {
    if (!OBJECTIVE_STATUSES.includes(status)) {
      throw new Error(`status must be one of ${OBJECTIVE_STATUSES.join(', ')}`);
    }
    const before = await this.repo.findPipObjectiveById(objectiveId);
    if (!before) throw new Error('PIP objective not found');
    await this.repo.updatePipObjective(objectiveId, status);
    await this.audit.record('PIP_OBJECTIVE', objectiveId, 'UPDATE', ctx, { status: before.status }, { status });
    return this.get(Number(before.pip_id));
  }

  async addReview(pipId: number, body: any, ctx: PerfActionContext): Promise<PipResponse> {
    const pip = await this.repo.findPipById(pipId);
    if (!pip) throw new Error('PIP not found');
    if (!body?.reviewDate) throw new Error('reviewDate is required');
    const progress = body.progress ?? 'ON_TRACK';
    if (!PROGRESS_VALUES.includes(progress)) throw new Error(`progress must be one of ${PROGRESS_VALUES.join(', ')}`);

    const id = await this.repo.insertPipReview({
      pipId,
      reviewDate: String(body.reviewDate),
      progress,
      summary: body.summary ?? null,
      nextSteps: body.nextSteps ?? null,
      createdBy: ctx.userId,
    });
    await this.audit.record('PIP_REVIEW', id, 'CREATE', ctx, null, { pipId, reviewDate: body.reviewDate, progress });
    return this.get(pipId);
  }

  async close(id: number, outcome: string, note: string | null, ctx: PerfActionContext): Promise<PipResponse> {
    const before = await this.repo.findPipById(id);
    if (!before) throw new Error('PIP not found');
    const status = OUTCOMES[String(outcome ?? '').toUpperCase()];
    if (!status) throw new Error(`outcome must be one of ${Object.keys(OUTCOMES).join(', ')}`);
    if (CLOSED_STATUSES.includes(before.status)) throw new Error(`PIP is already ${before.status}`);

    await this.repo.updatePip(id, ['status = ?', 'outcome_note = ?', 'closed_at = NOW()'], [status, note ?? null]);
    await this.audit.record('PIP', id, 'CLOSE', ctx, { status: before.status }, { status, note });
    return this.get(id);
  }

  async extend(id: number, newEndDate: string, reason: string, ctx: PerfActionContext): Promise<PipResponse> {
    const before = await this.repo.findPipById(id);
    if (!before) throw new Error('PIP not found');
    if (!newEndDate) throw new Error('newEndDate is required');
    if (!reason || !String(reason).trim()) throw new Error('A reason is required to extend a PIP');
    if (!['ACTIVE', 'EXTENDED', 'ESCALATED'].includes(before.status)) {
      throw new Error(`PIP cannot be extended from status ${before.status}`);
    }
    const currentEnd = toDateString(before.end_date);
    if (String(newEndDate) <= currentEnd) throw new Error(`newEndDate must be after the current end date (${currentEnd})`);

    await this.repo.updatePip(id, ['end_date = ?', "status = 'EXTENDED'"], [String(newEndDate)]);
    await this.audit.record('PIP', id, 'EXTEND', ctx, { endDate: currentEnd, status: before.status }, { endDate: newEndDate, reason: String(reason).trim() });
    return this.get(id);
  }

  async escalate(id: number, reason: string, ctx: PerfActionContext): Promise<PipResponse> {
    const before = await this.repo.findPipById(id);
    if (!before) throw new Error('PIP not found');
    if (!reason || !String(reason).trim()) throw new Error('A reason is required to escalate a PIP');
    if (!['ACTIVE', 'EXTENDED'].includes(before.status)) {
      throw new Error(`PIP cannot be escalated from status ${before.status}`);
    }
    await this.repo.updatePip(id, ["status = 'ESCALATED'"], []);
    await this.audit.record('PIP', id, 'ESCALATE', ctx, { status: before.status }, { status: 'ESCALATED', reason: String(reason).trim() });
    return this.get(id);
  }

  async report(): Promise<{ columns: { key: string; label: string }[]; rows: any[] }> {
    const rows = await this.repo.findPips({});
    return {
      columns: [
        { key: 'empCode', label: 'Emp Code' },
        { key: 'employeeName', label: 'Employee' },
        { key: 'startDate', label: 'Start' },
        { key: 'endDate', label: 'End' },
        { key: 'status', label: 'Status' },
        { key: 'closedAt', label: 'Closed' },
        { key: 'outcomeNote', label: 'Outcome Note' },
      ],
      rows: rows.map((r) => ({
        empCode: r.emp_code ?? '',
        employeeName: r.employee_name ?? '',
        startDate: toDateString(r.start_date),
        endDate: toDateString(r.end_date),
        status: r.status,
        closedAt: r.closed_at ? new Date(r.closed_at).toISOString().slice(0, 10) : '',
        outcomeNote: r.outcome_note ?? '',
      })),
    };
  }

  private toResponse(r: any): PipResponse {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      cycleId: r.cycle_id === null ? null : Number(r.cycle_id),
      reason: String(r.reason),
      startDate: toDateString(r.start_date),
      endDate: toDateString(r.end_date),
      status: r.status,
      outcomeNote: r.outcome_note ?? null,
      closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
      openedBy: r.opened_by === null ? null : Number(r.opened_by),
      approvedBy: r.approved_by === null ? null : Number(r.approved_by),
      approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
    };
  }

  private toObjectiveResponse(r: any): PipObjectiveResponse {
    return {
      id: Number(r.id),
      pipId: Number(r.pip_id),
      objective: String(r.objective),
      successCriteria: r.success_criteria ?? null,
      status: r.status,
      sortOrder: Number(r.sort_order ?? 0),
    };
  }

  private toReviewResponse(r: any): PipReviewResponse {
    return {
      id: Number(r.id),
      pipId: Number(r.pip_id),
      reviewDate: toDateString(r.review_date),
      progress: r.progress,
      summary: r.summary ?? null,
      nextSteps: r.next_steps ?? null,
      createdBy: r.created_by === null ? null : Number(r.created_by),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    };
  }
}
