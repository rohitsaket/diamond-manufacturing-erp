import { BaseRepository } from './BaseRepository';
import {
  AnnouncementResponse,
  AssetResponse,
  AssetStatus,
  CompanyEventResponse,
  ExpenseCategory,
  ExpenseResponse,
  ExpenseStatus,
  Priority,
  TaskResponse,
  TaskStatus,
  TicketCategory,
  TicketResponse,
  TicketStatus,
  TrainingResponse,
  TrainingStatus,
} from '../types/hrms';
import { toDateString, todayString } from '../utils/dateUtils';

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Asset plus the id of its currently open assignment (needed to return it). */
export interface AssetWithAssignment extends AssetResponse {
  assignmentId: number | null;
}

export type EnrollmentStatus = 'ENROLLED' | 'ATTENDED' | 'COMPLETED' | 'DROPPED';

export interface TrainingEnrollmentResponse {
  id: number;
  trainingId: number;
  employeeId: number;
  employeeName: string;
  title: string;
  trainer: string | null;
  startDate: string;
  endDate: string | null;
  trainingStatus: TrainingStatus;
  status: EnrollmentStatus;
  score: number | null;
  completedAt: string | null;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  employeeId: number;
  priority?: Priority;
  dueDate?: string | null;
}

export interface CreateTicketInput {
  employeeId: number;
  category?: TicketCategory;
  subject: string;
  description?: string | null;
  priority?: Priority;
}

export interface CreateExpenseInput {
  employeeId: number;
  category?: ExpenseCategory;
  amount: number;
  expenseDate: string;
  description?: string | null;
  receiptPath?: string | null;
}

export interface CreateAssetInput {
  assetCode: string;
  name: string;
  category?: string;
  serialNo?: string | null;
  purchaseDate?: string | null;
  purchaseCost?: number | null;
}

export interface CreateAnnouncementInput {
  title: string;
  body: string;
  category?: string;
  pinned?: boolean;
  publishFrom: string;
  publishTo?: string | null;
  audience?: string;
}

export interface UpdateAnnouncementInput {
  title?: string;
  body?: string;
  category?: string;
  pinned?: boolean;
  publishFrom?: string;
  publishTo?: string | null;
  audience?: string;
}

export interface CreateEventInput {
  title: string;
  eventType?: string;
  startAt: string;
  endAt?: string | null;
  location?: string | null;
  description?: string | null;
}

export interface CreateTrainingInput {
  title: string;
  description?: string | null;
  trainer?: string | null;
  startDate: string;
  endDate?: string | null;
}

const ANNOUNCEMENT_COLUMNS: Record<keyof UpdateAnnouncementInput, string> = {
  title: 'title',
  body: 'body',
  category: 'category',
  pinned: 'pinned',
  publishFrom: 'publish_from',
  publishTo: 'publish_to',
  audience: 'audience',
};

/**
 * Employee engagement store: tasks, helpdesk tickets, expense claims, the asset
 * register, announcements, company events and trainings. One repository keeps
 * the cross-entity dashboard counters in a single round-trip-friendly place.
 */
export class EngagementRepository extends BaseRepository {
  // =========================================================================
  // TASKS
  // =========================================================================
  async listTasks(
    filters: { employeeId?: number; status?: TaskStatus; limit?: number } = {},
  ): Promise<TaskResponse[]> {
    let sql = `
      SELECT t.*, e.full_name AS employee_name
      FROM tasks t
      JOIN employees e ON e.id = t.employee_id
      WHERE t.deleted_at IS NULL`;
    const params: any[] = [];

    if (filters.employeeId) {
      sql += ' AND t.employee_id = ?';
      params.push(filters.employeeId);
    }
    if (filters.status) {
      sql += ' AND t.status = ?';
      params.push(filters.status);
    }

    const limit = Math.min(500, Math.max(1, filters.limit || 100));
    sql += ` ORDER BY FIELD(t.status, 'IN_PROGRESS', 'PENDING', 'DONE', 'CANCELLED'),
                      t.due_date IS NULL, t.due_date ASC, t.id DESC
             LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.taskToResponse(r));
  }

  async findTaskById(id: number): Promise<TaskResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT t.*, e.full_name AS employee_name
       FROM tasks t
       JOIN employees e ON e.id = t.employee_id
       WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.taskToResponse(rows[0]) : null;
  }

  async createTask(data: CreateTaskInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO tasks
         (title, description, employee_id, priority, due_date, assigned_by, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.title,
        data.description ?? null,
        data.employeeId,
        data.priority ?? 'MEDIUM',
        data.dueDate ?? null,
        userId,
        userId,
        userId,
      ],
    );
    return result.insertId;
  }

  async updateTaskStatus(id: number, status: TaskStatus, userId: number): Promise<void> {
    await this.query(
      `UPDATE tasks
       SET status = ?,
           completed_at = CASE WHEN ? = 'DONE' THEN NOW() ELSE NULL END,
           updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [status, status, userId, id],
    );
  }

  async softDeleteTask(id: number): Promise<void> {
    await this.query('UPDATE tasks SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL', [id]);
  }

  async countPendingByEmployee(employeeId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM tasks
       WHERE employee_id = ? AND status IN ('PENDING', 'IN_PROGRESS') AND deleted_at IS NULL`,
      [employeeId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /** Total open tasks across a team; returns 0 for an empty roster. */
  async countPendingForEmployees(employeeIds: number[]): Promise<number> {
    if (employeeIds.length === 0) return 0;
    const placeholders = employeeIds.map(() => '?').join(', ');
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM tasks
       WHERE employee_id IN (${placeholders})
         AND status IN ('PENDING', 'IN_PROGRESS') AND deleted_at IS NULL`,
      employeeIds,
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  // =========================================================================
  // TICKETS (helpdesk)
  // =========================================================================
  async listTickets(
    filters: { employeeId?: number; status?: TicketStatus; limit?: number } = {},
  ): Promise<TicketResponse[]> {
    let sql = `
      SELECT t.*, e.full_name AS employee_name
      FROM tickets t
      JOIN employees e ON e.id = t.employee_id
      WHERE t.deleted_at IS NULL`;
    const params: any[] = [];

    if (filters.employeeId) {
      sql += ' AND t.employee_id = ?';
      params.push(filters.employeeId);
    }
    if (filters.status) {
      sql += ' AND t.status = ?';
      params.push(filters.status);
    }

    const limit = Math.min(500, Math.max(1, filters.limit || 100));
    sql += ` ORDER BY FIELD(t.status, 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'), t.id DESC
             LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.ticketToResponse(r));
  }

  async findTicketById(id: number): Promise<TicketResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT t.*, e.full_name AS employee_name
       FROM tickets t
       JOIN employees e ON e.id = t.employee_id
       WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.ticketToResponse(rows[0]) : null;
  }

  /**
   * Allocates the next `TKT-yyyymmdd-nnnn` number and inserts in one
   * transaction. A losing race hits the unique index, so we retry once.
   */
  async createTicket(data: CreateTicketInput, userId: number): Promise<number> {
    try {
      return await this.insertTicket(data, userId);
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') return this.insertTicket(data, userId);
      throw err;
    }
  }

  private async insertTicket(data: CreateTicketInput, userId: number): Promise<number> {
    return this.transaction(async (conn) => {
      const stamp = todayString().replace(/-/g, '');
      const [countRows] = await conn.query(
        'SELECT COUNT(*) AS cnt FROM tickets WHERE ticket_no LIKE ?',
        [`TKT-${stamp}-%`],
      );
      const next = Number((countRows as any[])[0]?.cnt ?? 0) + 1;
      const ticketNo = `TKT-${stamp}-${String(next).padStart(4, '0')}`;

      const [result] = await conn.query(
        `INSERT INTO tickets
           (ticket_no, employee_id, category, subject, description, priority, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ticketNo,
          data.employeeId,
          data.category ?? 'HR',
          data.subject,
          data.description ?? null,
          data.priority ?? 'MEDIUM',
          userId,
          userId,
        ],
      );
      return (result as any).insertId as number;
    });
  }

  async updateTicketStatus(
    id: number,
    status: TicketStatus,
    resolution: string | null,
    userId: number,
  ): Promise<void> {
    const closing = status === 'RESOLVED' || status === 'CLOSED';
    await this.query(
      `UPDATE tickets
       SET status = ?,
           resolution = COALESCE(?, resolution),
           resolved_at = ${closing ? 'COALESCE(resolved_at, NOW())' : 'NULL'},
           assigned_to = COALESCE(assigned_to, ?),
           updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [status, resolution, userId, userId, id],
    );
  }

  async countOpenTickets(): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM tickets
       WHERE status IN ('OPEN', 'IN_PROGRESS') AND deleted_at IS NULL`,
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  // =========================================================================
  // EXPENSE CLAIMS
  // =========================================================================
  async listExpenses(
    filters: { employeeId?: number; status?: ExpenseStatus; limit?: number } = {},
  ): Promise<ExpenseResponse[]> {
    let sql = `
      SELECT x.*, e.full_name AS employee_name
      FROM expense_claims x
      JOIN employees e ON e.id = x.employee_id
      WHERE x.deleted_at IS NULL`;
    const params: any[] = [];

    if (filters.employeeId) {
      sql += ' AND x.employee_id = ?';
      params.push(filters.employeeId);
    }
    if (filters.status) {
      sql += ' AND x.status = ?';
      params.push(filters.status);
    }

    const limit = Math.min(500, Math.max(1, filters.limit || 100));
    sql += ` ORDER BY FIELD(x.status, 'PENDING', 'APPROVED', 'REIMBURSED', 'REJECTED'),
                      x.expense_date DESC, x.id DESC
             LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.expenseToResponse(r));
  }

  async findExpenseById(id: number): Promise<ExpenseResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT x.*, e.full_name AS employee_name
       FROM expense_claims x
       JOIN employees e ON e.id = x.employee_id
       WHERE x.id = ? AND x.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.expenseToResponse(rows[0]) : null;
  }

  async createExpense(data: CreateExpenseInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO expense_claims
         (employee_id, category, amount, expense_date, description, receipt_path, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.employeeId,
        data.category ?? 'OTHER',
        data.amount,
        data.expenseDate,
        data.description ?? null,
        data.receiptPath ?? null,
        userId,
        userId,
      ],
    );
    return result.insertId;
  }

  async decideExpense(
    id: number,
    status: ExpenseStatus,
    userId: number,
    note: string | null,
  ): Promise<void> {
    await this.query(
      `UPDATE expense_claims
       SET status = ?, decided_by = ?, decided_at = NOW(), decision_note = ?, updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [status, userId, note, userId, id],
    );
  }

  async softDeleteExpense(id: number): Promise<void> {
    await this.query(
      'UPDATE expense_claims SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
  }

  async countPendingExpenses(): Promise<number> {
    const rows = await this.query<any[]>(
      "SELECT COUNT(*) AS cnt FROM expense_claims WHERE status = 'PENDING' AND deleted_at IS NULL",
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  async sumPendingExpenses(): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expense_claims
       WHERE status = 'PENDING' AND deleted_at IS NULL`,
    );
    return Number(rows[0]?.total ?? 0);
  }

  // =========================================================================
  // ASSETS
  // =========================================================================
  async listAssets(filters: { status?: AssetStatus; limit?: number } = {}): Promise<AssetWithAssignment[]> {
    let sql = `
      SELECT a.*,
             aa.id AS assignment_id,
             aa.employee_id AS assigned_to_id,
             aa.assigned_on AS assigned_on,
             e.full_name AS assigned_to_name
      FROM assets a
      LEFT JOIN asset_assignments aa ON aa.asset_id = a.id AND aa.returned_on IS NULL
      LEFT JOIN employees e ON e.id = aa.employee_id
      WHERE a.deleted_at IS NULL`;
    const params: any[] = [];

    if (filters.status) {
      sql += ' AND a.status = ?';
      params.push(filters.status);
    }

    const limit = Math.min(500, Math.max(1, filters.limit || 200));
    sql += ` ORDER BY a.asset_code ASC LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.assetToResponse(r));
  }

  async findAssetById(id: number): Promise<AssetWithAssignment | null> {
    const rows = await this.query<any[]>(
      `SELECT a.*,
              aa.id AS assignment_id,
              aa.employee_id AS assigned_to_id,
              aa.assigned_on AS assigned_on,
              e.full_name AS assigned_to_name
       FROM assets a
       LEFT JOIN asset_assignments aa ON aa.asset_id = a.id AND aa.returned_on IS NULL
       LEFT JOIN employees e ON e.id = aa.employee_id
       WHERE a.id = ? AND a.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.assetToResponse(rows[0]) : null;
  }

  async findAssetByCode(assetCode: string): Promise<{ id: number } | null> {
    const rows = await this.query<any[]>(
      'SELECT id FROM assets WHERE asset_code = ? AND deleted_at IS NULL',
      [assetCode],
    );
    return rows[0] ? { id: rows[0].id } : null;
  }

  async createAsset(data: CreateAssetInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO assets
         (asset_code, name, category, serial_no, purchase_date, purchase_cost, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.assetCode,
        data.name,
        data.category ?? 'TOOL',
        data.serialNo ?? null,
        data.purchaseDate ?? null,
        data.purchaseCost ?? null,
        userId,
        userId,
      ],
    );
    return result.insertId;
  }

  async updateAssetStatus(id: number, status: AssetStatus, userId: number): Promise<void> {
    await this.query(
      'UPDATE assets SET status = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL',
      [status, userId, id],
    );
  }

  /** Hands an asset over: row-locks the asset so two clerks cannot double-issue it. */
  async assignAsset(
    assetId: number,
    employeeId: number,
    assignedOn: string,
    userId: number,
  ): Promise<number> {
    return this.transaction(async (conn) => {
      const [assetRows] = await conn.query(
        'SELECT id, status FROM assets WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
        [assetId],
      );
      const asset = (assetRows as any[])[0];
      if (!asset) throw new Error('Asset not found');
      if (asset.status !== 'AVAILABLE') throw new Error('Asset is not available for assignment');

      const [empRows] = await conn.query(
        'SELECT id FROM employees WHERE id = ? AND deleted_at IS NULL',
        [employeeId],
      );
      if (!(empRows as any[])[0]) throw new Error('Employee not found');

      const [result] = await conn.query(
        `INSERT INTO asset_assignments (asset_id, employee_id, assigned_on, created_by)
         VALUES (?, ?, ?, ?)`,
        [assetId, employeeId, assignedOn, userId],
      );
      await conn.query(
        "UPDATE assets SET status = 'ASSIGNED', updated_by = ? WHERE id = ?",
        [userId, assetId],
      );
      return (result as any).insertId as number;
    });
  }

  async returnAsset(
    assignmentId: number,
    returnedOn: string,
    userId: number,
    conditionNote?: string | null,
  ): Promise<number> {
    return this.transaction(async (conn) => {
      const [rows] = await conn.query(
        'SELECT id, asset_id, returned_on FROM asset_assignments WHERE id = ? FOR UPDATE',
        [assignmentId],
      );
      const assignment = (rows as any[])[0];
      if (!assignment) throw new Error('Asset assignment not found');
      if (assignment.returned_on) throw new Error('This asset has already been returned');

      await conn.query(
        'UPDATE asset_assignments SET returned_on = ?, condition_note = COALESCE(?, condition_note) WHERE id = ?',
        [returnedOn, conditionNote ?? null, assignmentId],
      );
      await conn.query(
        "UPDATE assets SET status = 'AVAILABLE', updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        [userId, assignment.asset_id],
      );
      return assignment.asset_id as number;
    });
  }

  /** Assets currently held by an employee. */
  async listAssetsByEmployee(employeeId: number): Promise<AssetWithAssignment[]> {
    const rows = await this.query<any[]>(
      `SELECT a.*,
              aa.id AS assignment_id,
              aa.employee_id AS assigned_to_id,
              aa.assigned_on AS assigned_on,
              e.full_name AS assigned_to_name
       FROM asset_assignments aa
       JOIN assets a ON a.id = aa.asset_id AND a.deleted_at IS NULL
       JOIN employees e ON e.id = aa.employee_id
       WHERE aa.employee_id = ? AND aa.returned_on IS NULL
       ORDER BY aa.assigned_on DESC, aa.id DESC`,
      [employeeId],
    );
    return rows.map((r) => this.assetToResponse(r));
  }

  // =========================================================================
  // ANNOUNCEMENTS
  // =========================================================================
  async listAnnouncements(
    filters: { activeOnly?: boolean; audience?: string; limit?: number } = {},
  ): Promise<AnnouncementResponse[]> {
    let sql = 'SELECT * FROM announcements WHERE deleted_at IS NULL';
    const params: any[] = [];

    if (filters.activeOnly) {
      sql += ' AND publish_from <= CURDATE() AND (publish_to IS NULL OR publish_to >= CURDATE())';
    }
    if (filters.audience && filters.audience !== 'ALL') {
      sql += " AND audience IN ('ALL', ?)";
      params.push(filters.audience);
    }

    const limit = Math.min(500, Math.max(1, filters.limit || 100));
    sql += ` ORDER BY pinned DESC, publish_from DESC, id DESC LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.announcementToResponse(r));
  }

  async findAnnouncementById(id: number): Promise<AnnouncementResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM announcements WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.announcementToResponse(rows[0]) : null;
  }

  async createAnnouncement(data: CreateAnnouncementInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO announcements
         (title, body, category, pinned, publish_from, publish_to, audience, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.title,
        data.body,
        data.category ?? 'NEWS',
        data.pinned ? 1 : 0,
        data.publishFrom,
        data.publishTo ?? null,
        data.audience ?? 'ALL',
        userId,
        userId,
      ],
    );
    return result.insertId;
  }

  async updateAnnouncement(id: number, data: UpdateAnnouncementInput, userId: number): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(ANNOUNCEMENT_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      if (key === 'pinned') params.push(value ? 1 : 0);
      else params.push(value === '' ? null : value);
    }
    if (sets.length === 0) return;

    sets.push('updated_by = ?');
    params.push(userId, id);

    await this.query(
      `UPDATE announcements SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async softDeleteAnnouncement(id: number): Promise<void> {
    await this.query(
      'UPDATE announcements SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
  }

  // =========================================================================
  // COMPANY EVENTS
  // =========================================================================
  async listEvents(from?: string, to?: string): Promise<CompanyEventResponse[]> {
    let sql = 'SELECT * FROM company_events WHERE deleted_at IS NULL';
    const params: any[] = [];

    if (from) {
      sql += ' AND start_at >= ?';
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      sql += ' AND start_at <= ?';
      params.push(`${to} 23:59:59`);
    }
    sql += ' ORDER BY start_at ASC, id ASC LIMIT 500';

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.eventToResponse(r));
  }

  async findEventById(id: number): Promise<CompanyEventResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM company_events WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.eventToResponse(rows[0]) : null;
  }

  async createEvent(data: CreateEventInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO company_events
         (title, event_type, start_at, end_at, location, description, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.title,
        data.eventType ?? 'EVENT',
        data.startAt,
        data.endAt ?? null,
        data.location ?? null,
        data.description ?? null,
        userId,
        userId,
      ],
    );
    return result.insertId;
  }

  async softDeleteEvent(id: number): Promise<void> {
    await this.query(
      'UPDATE company_events SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
  }

  // =========================================================================
  // TRAININGS
  // =========================================================================
  async listTrainings(filters: { status?: TrainingStatus; limit?: number } = {}): Promise<TrainingResponse[]> {
    let sql = `
      SELECT t.*,
             (SELECT COUNT(*) FROM training_enrollments en WHERE en.training_id = t.id) AS enrolled_count,
             (SELECT COUNT(*) FROM training_enrollments en
               WHERE en.training_id = t.id AND en.status = 'COMPLETED') AS completed_count
      FROM trainings t
      WHERE t.deleted_at IS NULL`;
    const params: any[] = [];

    if (filters.status) {
      sql += ' AND t.status = ?';
      params.push(filters.status);
    }

    const limit = Math.min(500, Math.max(1, filters.limit || 100));
    sql += ` ORDER BY t.start_date DESC, t.id DESC LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.trainingToResponse(r));
  }

  async findTrainingById(id: number): Promise<TrainingResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT t.*,
              (SELECT COUNT(*) FROM training_enrollments en WHERE en.training_id = t.id) AS enrolled_count,
              (SELECT COUNT(*) FROM training_enrollments en
                WHERE en.training_id = t.id AND en.status = 'COMPLETED') AS completed_count
       FROM trainings t
       WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.trainingToResponse(rows[0]) : null;
  }

  async createTraining(data: CreateTrainingInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO trainings (title, description, trainer, start_date, end_date, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.title,
        data.description ?? null,
        data.trainer ?? null,
        data.startDate,
        data.endDate ?? null,
        userId,
        userId,
      ],
    );
    return result.insertId;
  }

  async updateTrainingStatus(id: number, status: TrainingStatus, userId: number): Promise<void> {
    await this.query(
      'UPDATE trainings SET status = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL',
      [status, userId, id],
    );
  }

  async softDeleteTraining(id: number): Promise<void> {
    await this.query(
      'UPDATE trainings SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
  }

  /** Bulk enrol; re-enrolling an existing row resets it to ENROLLED. */
  async enroll(trainingId: number, employeeIds: number[]): Promise<number> {
    if (employeeIds.length === 0) return 0;
    const values = employeeIds.map(() => '(?, ?, ?)').join(', ');
    const params: any[] = [];
    for (const employeeId of employeeIds) params.push(trainingId, employeeId, 'ENROLLED');

    const result = await this.query<any>(
      `INSERT INTO training_enrollments (training_id, employee_id, status)
       VALUES ${values}
       ON DUPLICATE KEY UPDATE status = VALUES(status)`,
      params,
    );
    return Number(result?.affectedRows ?? 0);
  }

  async setEnrollmentStatus(
    trainingId: number,
    employeeId: number,
    status: EnrollmentStatus,
    score?: number | null,
  ): Promise<void> {
    await this.query(
      `UPDATE training_enrollments
       SET status = ?,
           score = COALESCE(?, score),
           completed_at = CASE WHEN ? = 'COMPLETED' THEN CURDATE() ELSE NULL END
       WHERE training_id = ? AND employee_id = ?`,
      [status, score ?? null, status, trainingId, employeeId],
    );
  }

  async listEnrollmentsByEmployee(employeeId: number): Promise<TrainingEnrollmentResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT en.*, t.title, t.trainer, t.start_date, t.end_date, t.status AS training_status,
              e.full_name AS employee_name
       FROM training_enrollments en
       JOIN trainings t ON t.id = en.training_id AND t.deleted_at IS NULL
       JOIN employees e ON e.id = en.employee_id
       WHERE en.employee_id = ?
       ORDER BY t.start_date DESC, en.id DESC`,
      [employeeId],
    );
    return rows.map((r) => ({
      id: r.id,
      trainingId: r.training_id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      title: r.title,
      trainer: r.trainer,
      startDate: toDateString(r.start_date),
      endDate: r.end_date ? toDateString(r.end_date) : null,
      trainingStatus: r.training_status,
      status: r.status,
      score: r.score === null ? null : Number(r.score),
      completedAt: r.completed_at ? toDateString(r.completed_at) : null,
    }));
  }

  async listEnrollmentEmployeeIds(trainingId: number): Promise<number[]> {
    const rows = await this.query<any[]>(
      'SELECT employee_id FROM training_enrollments WHERE training_id = ?',
      [trainingId],
    );
    return rows.map((r) => Number(r.employee_id));
  }

  // =========================================================================
  // MAPPERS
  // =========================================================================
  private taskToResponse(r: any): TaskResponse {
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      priority: r.priority,
      status: r.status,
      dueDate: r.due_date ? toDateString(r.due_date) : null,
      completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  private ticketToResponse(r: any): TicketResponse {
    return {
      id: r.id,
      ticketNo: r.ticket_no,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      category: r.category,
      subject: r.subject,
      description: r.description,
      priority: r.priority,
      status: r.status,
      assignedTo: r.assigned_to,
      resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
      resolution: r.resolution,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  private expenseToResponse(r: any): ExpenseResponse {
    return {
      id: r.id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      category: r.category,
      amount: Number(r.amount ?? 0),
      expenseDate: toDateString(r.expense_date),
      description: r.description,
      status: r.status,
      decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
      decisionNote: r.decision_note,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  private assetToResponse(r: any): AssetWithAssignment {
    return {
      id: r.id,
      assetCode: r.asset_code,
      name: r.name,
      category: r.category,
      serialNo: r.serial_no,
      status: r.status,
      assignedToId: r.assigned_to_id ?? null,
      assignedToName: r.assigned_to_name ?? null,
      assignedOn: r.assigned_on ? toDateString(r.assigned_on) : null,
      assignmentId: r.assignment_id ?? null,
    };
  }

  private announcementToResponse(r: any): AnnouncementResponse {
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      category: r.category,
      pinned: !!r.pinned,
      publishFrom: toDateString(r.publish_from),
      publishTo: r.publish_to ? toDateString(r.publish_to) : null,
      audience: r.audience,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  private eventToResponse(r: any): CompanyEventResponse {
    return {
      id: r.id,
      title: r.title,
      eventType: r.event_type,
      startAt: new Date(r.start_at).toISOString(),
      endAt: r.end_at ? new Date(r.end_at).toISOString() : null,
      location: r.location,
      description: r.description,
    };
  }

  private trainingToResponse(r: any): TrainingResponse {
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      trainer: r.trainer,
      startDate: toDateString(r.start_date),
      endDate: r.end_date ? toDateString(r.end_date) : null,
      status: r.status,
      enrolledCount: Number(r.enrolled_count ?? 0),
      completedCount: Number(r.completed_count ?? 0),
    };
  }
}
