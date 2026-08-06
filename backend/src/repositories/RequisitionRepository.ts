import { BaseRepository } from './BaseRepository';

export interface RequisitionFilters {
  status?: string;
  departmentId?: number;
  limit?: number;
}

const REQ_SELECT = `SELECT r.*,
    p.title AS position_title,
    d.name AS department_name,
    jr.name AS job_role_name,
    re.full_name AS replacement_for_name
  FROM job_requisitions r
  LEFT JOIN positions p ON p.id = r.position_id
  LEFT JOIN departments d ON d.id = r.department_id
  LEFT JOIN job_roles jr ON jr.id = r.job_role_id
  LEFT JOIN employees re ON re.id = r.replacement_for_employee_id`;

/** Data access for job_requisitions and the vacancy overview on positions. */
export class RequisitionRepository extends BaseRepository {
  async findAll(filters: RequisitionFilters): Promise<any[]> {
    const where: string[] = ['r.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.status) {
      where.push('r.status = ?');
      params.push(filters.status);
    }
    if (filters.departmentId) {
      where.push('r.department_id = ?');
      params.push(filters.departmentId);
    }
    // LIMIT cannot be bound in this stack; inline the sanitized number.
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 500), 1), 2000);
    return this.query<any[]>(
      `${REQ_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT ${limit}`,
      params,
    );
  }

  async findById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${REQ_SELECT} WHERE r.id = ? AND r.deleted_at IS NULL`, [id]);
    return rows[0] ?? null;
  }

  /**
   * Next sequence for REQ-<year>-<seq>. Scans every row (soft-deleted ones
   * included) so a deleted requisition can never free its number up again.
   */
  async nextSequence(year: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT MAX(CAST(SUBSTRING(req_code, 10) AS UNSIGNED)) AS max_seq
         FROM job_requisitions WHERE req_code LIKE ?`,
      [`REQ-${year}-%`],
    );
    return Number(rows[0]?.max_seq ?? 0) + 1;
  }

  async insert(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO job_requisitions (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }

  async update(id: number, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    await this.query(
      `UPDATE job_requisitions SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...keys.map((k) => fields[k]), id],
    );
  }

  /**
   * Vacancy overview: every OPEN budgeted position with how many working
   * employees are linked to it through employees.position_id.
   */
  async openPositionsWithFillCounts(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT p.id, p.code, p.title, p.department_id, d.name AS department_name,
              p.job_role_id, jr.name AS job_role_name,
              p.headcount_budgeted, p.budget_amount, p.status, p.employment_type,
              (SELECT COUNT(*) FROM employees e
                WHERE e.position_id = p.id AND e.deleted_at IS NULL AND e.work_status = 'WORKING') AS filled_count
         FROM positions p
         LEFT JOIN departments d ON d.id = p.department_id
         LEFT JOIN job_roles jr ON jr.id = p.job_role_id
        WHERE p.deleted_at IS NULL AND p.status = 'OPEN'
        ORDER BY p.id ASC`,
    );
  }

  /** Jobs hanging off a requisition that are not yet closed out. */
  async countUnfilledJobs(requisitionId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM internal_jobs
        WHERE requisition_id = ? AND deleted_at IS NULL
          AND status NOT IN ('FILLED', 'CANCELLED', 'ARCHIVED')`,
      [requisitionId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }
}
