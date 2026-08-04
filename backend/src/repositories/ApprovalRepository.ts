import { BaseRepository } from './BaseRepository';

/**
 * Generic multi-level approval storage: workflows, their steps, the requests
 * raised against business entities and every action taken on them.
 *
 * The tables are deliberately entity-agnostic (`entity_type` + `entity_id`),
 * so a payroll run, a salary revision and a loan all share one engine.
 */

export type ApprovalEntityType =
  | 'PAYROLL_RUN'
  | 'SALARY_REVISION'
  | 'BONUS'
  | 'INCENTIVE'
  | 'LOAN'
  | 'REIMBURSEMENT'
  | 'FINAL_SETTLEMENT'
  | 'OVERTIME'
  | 'TAX_DECLARATION';

export type ApprovalRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type ApprovalActionType = 'APPROVED' | 'REJECTED' | 'DELEGATED' | 'COMMENTED';

export interface ApprovalWorkflowResponse {
  id: number;
  code: string;
  name: string;
  entityType: string;
  minAmount: number | null;
  isActive: boolean;
}

export interface ApprovalStepResponse {
  id: number;
  workflowId: number;
  stepOrder: number;
  name: string;
  approverRole: string;
  /** Application roles allowed to act, exploded from the stored CSV column. */
  allowedUserRoles: string[];
  isMandatory: boolean;
  canSkipIfBelow: number | null;
}

export interface ApprovalActionResponse {
  id: number;
  requestId: number;
  stepOrder: number;
  approverRole: string | null;
  action: ApprovalActionType;
  actedBy: number | null;
  actedByName: string | null;
  actedAt: string | null;
  comments: string | null;
}

export interface ApprovalRequestResponse {
  id: number;
  workflowId: number | null;
  workflowName: string | null;
  entityType: string;
  entityId: number;
  title: string;
  amount: number | null;
  currency: string;
  currentStep: number;
  status: ApprovalRequestStatus;
  requestedBy: number | null;
  requestedByName: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Populated by `findRequestById` / `findByEntity`; empty on list endpoints. */
  steps?: ApprovalStepResponse[];
  history?: ApprovalActionResponse[];
  currentStepName?: string | null;
  currentStepRoles?: string[];
}

export interface CreateApprovalRequestInput {
  workflowId: number | null;
  entityType: string;
  entityId: number;
  title: string;
  amount: number | null;
  currency?: string;
  requestedBy: number | null;
}

export interface RecordApprovalActionInput {
  requestId: number;
  stepOrder: number;
  approverRole: string | null;
  action: ApprovalActionType;
  actedBy: number | null;
  comments?: string | null;
}

/** mysql2 cannot bind LIMIT/OFFSET, so they are sanitised and inlined. */
function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function splitRoles(csv: unknown): string[] {
  return String(csv ?? '')
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter((r) => r.length > 0);
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export class ApprovalRepository extends BaseRepository {
  // -------------------------------------------------------------------------
  // Workflows and steps
  // -------------------------------------------------------------------------

  /**
   * The workflow that governs an entity at a given amount.
   *
   * Threshold workflows win over the catch-all: among the workflows whose
   * `min_amount` the amount clears, the highest threshold is the most specific.
   * A workflow with a NULL threshold is the fallback and sorts last.
   */
  async findWorkflowFor(entityType: string, amount: number | null): Promise<ApprovalWorkflowResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM approval_workflows
       WHERE entity_type = ? AND is_active = true AND deleted_at IS NULL
         AND (min_amount IS NULL OR min_amount <= ?)
       ORDER BY (min_amount IS NULL) ASC, min_amount DESC, id ASC
       LIMIT 1`,
      [entityType, amount ?? 0],
    );
    return rows[0] ? this.toWorkflow(rows[0]) : null;
  }

  async findWorkflowById(id: number): Promise<ApprovalWorkflowResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM approval_workflows WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toWorkflow(rows[0]) : null;
  }

  async listSteps(workflowId: number): Promise<ApprovalStepResponse[]> {
    const rows = await this.query<any[]>(
      'SELECT * FROM approval_workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC',
      [workflowId],
    );
    return rows.map((r) => this.toStep(r));
  }

  // -------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------

  async createRequest(input: CreateApprovalRequestInput): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO approval_requests
         (workflow_id, entity_type, entity_id, title, amount, currency, current_step, status, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'PENDING', ?)`,
      [
        input.workflowId,
        input.entityType,
        input.entityId,
        input.title,
        input.amount,
        input.currency ?? 'INR',
        input.requestedBy,
      ],
    );
    return Number(result.insertId);
  }

  async findRequestById(id: number): Promise<ApprovalRequestResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT r.*, w.name AS workflow_name, u.name AS requested_by_name
       FROM approval_requests r
       LEFT JOIN approval_workflows w ON w.id = r.workflow_id
       LEFT JOIN users u ON u.id = r.requested_by
       WHERE r.id = ?`,
      [id],
    );
    return rows[0] ? this.toRequest(rows[0]) : null;
  }

  async findByEntity(entityType: string, entityId: number): Promise<ApprovalRequestResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT r.*, w.name AS workflow_name, u.name AS requested_by_name
       FROM approval_requests r
       LEFT JOIN approval_workflows w ON w.id = r.workflow_id
       LEFT JOIN users u ON u.id = r.requested_by
       WHERE r.entity_type = ? AND r.entity_id = ?
       ORDER BY r.id DESC`,
      [entityType, entityId],
    );
    return rows.map((r) => this.toRequest(r));
  }

  /**
   * Pending requests whose CURRENT step admits the given application role.
   *
   * The role list is stored as a CSV string, so membership is tested with
   * FIND_IN_SET against the whitespace-stripped column rather than LIKE, which
   * would match 'hr' inside 'hr_admin'.
   */
  async listPendingForRole(role: string, limit = 200): Promise<ApprovalRequestResponse[]> {
    const capped = safeInt(limit, 200, 1, 1000);
    const rows = await this.query<any[]>(
      `SELECT r.*, w.name AS workflow_name, u.name AS requested_by_name,
              s.name AS current_step_name, s.allowed_user_roles AS current_step_roles
       FROM approval_requests r
       LEFT JOIN approval_workflows w ON w.id = r.workflow_id
       LEFT JOIN users u ON u.id = r.requested_by
       LEFT JOIN approval_workflow_steps s
              ON s.workflow_id = r.workflow_id AND s.step_order = r.current_step
       WHERE r.status = 'PENDING'
         AND FIND_IN_SET(?, REPLACE(LOWER(COALESCE(s.allowed_user_roles, '')), ' ', '')) > 0
       ORDER BY r.created_at ASC, r.id ASC
       LIMIT ${capped}`,
      [role.toLowerCase()],
    );
    return rows.map((r) => this.toRequest(r));
  }

  async listRequests(filters: {
    entityType?: string;
    status?: string;
    limit?: number;
  } = {}): Promise<ApprovalRequestResponse[]> {
    const where: string[] = ['1 = 1'];
    const params: any[] = [];
    if (filters.entityType) { where.push('r.entity_type = ?'); params.push(filters.entityType); }
    if (filters.status) { where.push('r.status = ?'); params.push(filters.status); }
    const capped = safeInt(filters.limit, 200, 1, 1000);

    const rows = await this.query<any[]>(
      `SELECT r.*, w.name AS workflow_name, u.name AS requested_by_name
       FROM approval_requests r
       LEFT JOIN approval_workflows w ON w.id = r.workflow_id
       LEFT JOIN users u ON u.id = r.requested_by
       WHERE ${where.join(' AND ')}
       ORDER BY r.id DESC
       LIMIT ${capped}`,
      params,
    );
    return rows.map((r) => this.toRequest(r));
  }

  async countPending(entityType?: string): Promise<number> {
    const rows = entityType
      ? await this.query<any[]>(
        "SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'PENDING' AND entity_type = ?",
        [entityType],
      )
      : await this.query<any[]>("SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'PENDING'");
    return Number(rows[0]?.n ?? 0);
  }

  async setCurrentStep(requestId: number, stepOrder: number): Promise<void> {
    await this.query('UPDATE approval_requests SET current_step = ? WHERE id = ?', [stepOrder, requestId]);
  }

  async completeRequest(requestId: number, status: ApprovalRequestStatus): Promise<void> {
    await this.query(
      'UPDATE approval_requests SET status = ?, completed_at = NOW() WHERE id = ?',
      [status, requestId],
    );
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async addAction(input: RecordApprovalActionInput): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO approval_actions
         (request_id, step_order, approver_role, action, acted_by, acted_at, comments)
       VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
      [
        input.requestId,
        input.stepOrder,
        input.approverRole,
        input.action,
        input.actedBy,
        input.comments ?? null,
      ],
    );
    return Number(result.insertId);
  }

  async listActions(requestId: number): Promise<ApprovalActionResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT a.*, u.name AS acted_by_name
       FROM approval_actions a
       LEFT JOIN users u ON u.id = a.acted_by
       WHERE a.request_id = ?
       ORDER BY a.step_order ASC, a.id ASC`,
      [requestId],
    );
    return rows.map((r) => this.toAction(r));
  }

  /** The most recent APPROVED action, used to block back-to-back self approval. */
  async findLastApproval(requestId: number): Promise<ApprovalActionResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT a.*, u.name AS acted_by_name
       FROM approval_actions a
       LEFT JOIN users u ON u.id = a.acted_by
       WHERE a.request_id = ? AND a.action = 'APPROVED'
       ORDER BY a.id DESC
       LIMIT 1`,
      [requestId],
    );
    return rows[0] ? this.toAction(rows[0]) : null;
  }

  // -------------------------------------------------------------------------
  // Mappers
  // -------------------------------------------------------------------------

  private toWorkflow(r: any): ApprovalWorkflowResponse {
    return {
      id: Number(r.id),
      code: String(r.code),
      name: String(r.name),
      entityType: String(r.entity_type),
      minAmount: r.min_amount === null || r.min_amount === undefined ? null : Number(r.min_amount),
      isActive: !!r.is_active,
    };
  }

  private toStep(r: any): ApprovalStepResponse {
    return {
      id: Number(r.id),
      workflowId: Number(r.workflow_id),
      stepOrder: Number(r.step_order),
      name: String(r.name),
      approverRole: String(r.approver_role),
      allowedUserRoles: splitRoles(r.allowed_user_roles),
      isMandatory: !!r.is_mandatory,
      canSkipIfBelow:
        r.can_skip_if_below === null || r.can_skip_if_below === undefined
          ? null
          : Number(r.can_skip_if_below),
    };
  }

  private toAction(r: any): ApprovalActionResponse {
    return {
      id: Number(r.id),
      requestId: Number(r.request_id),
      stepOrder: Number(r.step_order),
      approverRole: r.approver_role ?? null,
      action: r.action as ApprovalActionType,
      actedBy: r.acted_by === null || r.acted_by === undefined ? null : Number(r.acted_by),
      actedByName: r.acted_by_name ?? null,
      actedAt: toIsoOrNull(r.acted_at),
      comments: r.comments ?? null,
    };
  }

  private toRequest(r: any): ApprovalRequestResponse {
    const base: ApprovalRequestResponse = {
      id: Number(r.id),
      workflowId: r.workflow_id === null || r.workflow_id === undefined ? null : Number(r.workflow_id),
      workflowName: r.workflow_name ?? null,
      entityType: String(r.entity_type),
      entityId: Number(r.entity_id),
      title: String(r.title),
      amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
      currency: String(r.currency ?? 'INR'),
      currentStep: Number(r.current_step ?? 1),
      status: r.status as ApprovalRequestStatus,
      requestedBy: r.requested_by === null || r.requested_by === undefined ? null : Number(r.requested_by),
      requestedByName: r.requested_by_name ?? null,
      completedAt: toIsoOrNull(r.completed_at),
      createdAt: toIsoOrNull(r.created_at),
      updatedAt: toIsoOrNull(r.updated_at),
    };
    if (r.current_step_name !== undefined) base.currentStepName = r.current_step_name ?? null;
    if (r.current_step_roles !== undefined) base.currentStepRoles = splitRoles(r.current_step_roles);
    return base;
  }
}
