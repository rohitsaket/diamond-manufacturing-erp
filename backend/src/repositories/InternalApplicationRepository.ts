import { BaseRepository } from './BaseRepository';

export interface ApplicationFilters {
  jobId?: number;
  status?: string;
  employeeId?: number;
  /** When false, applications on confidential jobs are filtered out. */
  includeConfidential: boolean;
  limit?: number;
}

const APP_SELECT = `SELECT a.*,
    j.job_code, j.title AS job_title, j.is_confidential, j.status AS job_status,
    e.full_name AS employee_name, e.emp_code, e.grade AS employee_grade
  FROM internal_applications a
  JOIN internal_jobs j ON j.id = a.job_id
  JOIN employees e ON e.id = a.employee_id`;

/** Data access for internal_applications, stage events and documents. */
export class InternalApplicationRepository extends BaseRepository {
  async findAll(filters: ApplicationFilters): Promise<any[]> {
    const where: string[] = ['a.deleted_at IS NULL'];
    const params: any[] = [];
    if (!filters.includeConfidential) where.push('j.is_confidential = 0');
    if (filters.jobId) {
      where.push('a.job_id = ?');
      params.push(filters.jobId);
    }
    if (filters.status) {
      where.push('a.status = ?');
      params.push(filters.status);
    }
    if (filters.employeeId) {
      where.push('a.employee_id = ?');
      params.push(filters.employeeId);
    }
    // LIMIT cannot be bound in this stack; inline the sanitized number.
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 500), 1), 2000);
    return this.query<any[]>(
      `${APP_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ${limit}`,
      params,
    );
  }

  async findById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${APP_SELECT} WHERE a.id = ? AND a.deleted_at IS NULL`, [id]);
    return rows[0] ?? null;
  }

  async findByJobAndEmployee(jobId: number, employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `${APP_SELECT} WHERE a.job_id = ? AND a.employee_id = ? AND a.deleted_at IS NULL`,
      [jobId, employeeId],
    );
    return rows[0] ?? null;
  }

  async findMine(employeeId: number): Promise<any[]> {
    return this.query<any[]>(
      `${APP_SELECT} WHERE a.employee_id = ? AND a.deleted_at IS NULL ORDER BY a.id DESC`,
      [employeeId],
    );
  }

  async insert(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO internal_applications (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }

  async update(id: number, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    await this.query(
      `UPDATE internal_applications SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...keys.map((k) => fields[k]), id],
    );
  }

  // ==========================================================================
  // Stage events (append-only timeline)
  // ==========================================================================

  async insertStageEvent(
    applicationId: number,
    fromStatus: string | null,
    toStatus: string,
    note: string | null,
    createdBy: number | null,
  ): Promise<void> {
    await this.query(
      `INSERT INTO application_stage_events (application_id, from_status, to_status, note, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [applicationId, fromStatus, toStatus, note, createdBy],
    );
  }

  async findStageEvents(applicationId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT ev.*, u.name AS actor_name
         FROM application_stage_events ev
         LEFT JOIN users u ON u.id = ev.created_by
        WHERE ev.application_id = ?
        ORDER BY ev.id ASC`,
      [applicationId],
    );
  }

  // ==========================================================================
  // Documents
  // ==========================================================================

  async insertDocument(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO application_documents (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }

  async findDocuments(applicationId: number): Promise<any[]> {
    return this.query<any[]>(
      'SELECT * FROM application_documents WHERE application_id = ? ORDER BY id ASC',
      [applicationId],
    );
  }

  async findDocumentById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM application_documents WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  /** Ownership check for resumeDocumentId: the document must be the caller's. */
  async employeeDocumentBelongsTo(documentId: number, employeeId: number): Promise<boolean> {
    const rows = await this.query<any[]>(
      'SELECT id FROM employee_documents WHERE id = ? AND employee_id = ? AND deleted_at IS NULL',
      [documentId, employeeId],
    );
    return rows.length > 0;
  }

  // ==========================================================================
  // Job context needed by the application flow
  // ==========================================================================

  async findJobById(jobId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT j.*, d.name AS department_name, jr.name AS job_role_name
         FROM internal_jobs j
         LEFT JOIN departments d ON d.id = j.department_id
         LEFT JOIN job_roles jr ON jr.id = j.job_role_id
        WHERE j.id = ? AND j.deleted_at IS NULL`,
      [jobId],
    );
    return rows[0] ?? null;
  }

  async findEmployeeDepartmentId(employeeId: number): Promise<number | null> {
    const rows = await this.query<any[]>(
      'SELECT department_id FROM employees WHERE id = ? AND deleted_at IS NULL',
      [employeeId],
    );
    return rows[0]?.department_id ? Number(rows[0].department_id) : null;
  }
}
