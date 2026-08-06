import { BaseRepository } from './BaseRepository';

export interface JobFilters {
  status?: string;
  departmentId?: number;
  search?: string;
  workMode?: string;
  employmentType?: string;
  limit?: number;
}

export interface PortalJobFilters {
  search?: string;
  category?: string;
  departmentId?: number;
  workMode?: string;
  employmentType?: string;
  featured?: boolean;
  limit?: number;
}

const JOB_SELECT = `SELECT j.*,
    d.name AS department_name,
    jr.name AS job_role_name,
    hm.full_name AS hiring_manager_name
  FROM internal_jobs j
  LEFT JOIN departments d ON d.id = j.department_id
  LEFT JOIN job_roles jr ON jr.id = j.job_role_id
  LEFT JOIN employees hm ON hm.id = j.hiring_manager_employee_id`;

/**
 * Portal visibility, in SQL: never confidential, visibility ALL or the
 * caller's own department, and either already PUBLISHED or APPROVED with a
 * publish_at that has passed (the lazy resolver flips those on read).
 * Expiry is NOT filtered here on purpose: the resolver must see the stale
 * PUBLISHED row to persist its EXPIRED flip; the service drops it afterwards.
 */
const PORTAL_VISIBLE = `j.deleted_at IS NULL
    AND j.is_confidential = 0
    AND (j.visibility = 'ALL' OR (j.visibility = 'DEPARTMENT' AND j.visibility_department_id = ?))
    AND (j.status = 'PUBLISHED' OR (j.status = 'APPROVED' AND j.publish_at IS NOT NULL AND j.publish_at <= NOW()))`;

/** Data access for internal_jobs, templates and saved jobs. */
export class InternalJobRepository extends BaseRepository {
  // ==========================================================================
  // Staff reads
  // ==========================================================================

  /**
   * Status is deliberately NOT filtered in SQL: the effective-status resolver
   * runs after the fetch and may flip rows (APPROVED->PUBLISHED,
   * PUBLISHED->EXPIRED), so the service filters on the resolved status.
   */
  async findAll(filters: JobFilters): Promise<any[]> {
    const where: string[] = ['j.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.departmentId) {
      where.push('j.department_id = ?');
      params.push(filters.departmentId);
    }
    if (filters.workMode) {
      where.push('j.work_mode = ?');
      params.push(filters.workMode);
    }
    if (filters.employmentType) {
      where.push('j.employment_type = ?');
      params.push(filters.employmentType);
    }
    if (filters.search) {
      where.push('(j.title LIKE ? OR j.description LIKE ? OR j.job_code LIKE ?)');
      const like = `%${filters.search}%`;
      params.push(like, like, like);
    }
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 500), 1), 2000);
    return this.query<any[]>(
      `${JOB_SELECT} WHERE ${where.join(' AND ')} ORDER BY j.id DESC LIMIT ${limit}`,
      params,
    );
  }

  async findById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${JOB_SELECT} WHERE j.id = ? AND j.deleted_at IS NULL`, [id]);
    return rows[0] ?? null;
  }

  /** Non-draft applications only, so private drafts never inflate the count. */
  async applicationCount(jobId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM internal_applications
        WHERE job_id = ? AND deleted_at IS NULL AND status != 'DRAFT'`,
      [jobId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /** See RequisitionRepository.nextSequence for the deleted-rows rationale. */
  async nextSequence(year: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT MAX(CAST(SUBSTRING(job_code, 9) AS UNSIGNED)) AS max_seq
         FROM internal_jobs WHERE job_code LIKE ?`,
      [`IJ-${year}-%`],
    );
    return Number(rows[0]?.max_seq ?? 0) + 1;
  }

  async insert(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO internal_jobs (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }

  async update(id: number, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    await this.query(
      `UPDATE internal_jobs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...keys.map((k) => fields[k]), id],
    );
  }

  /**
   * Lazy persist for the effective-status resolver. Guarded on the previous
   * status so a concurrent flip (two readers at once) is harmless.
   */
  async persistStatusFlip(id: number, fromStatus: string, toStatus: string, publishedAt: Date | null): Promise<void> {
    if (publishedAt) {
      await this.query(
        `UPDATE internal_jobs SET status = ?, published_at = COALESCE(published_at, ?)
          WHERE id = ? AND status = ? AND deleted_at IS NULL`,
        [toStatus, publishedAt, id, fromStatus],
      );
    } else {
      await this.query(
        'UPDATE internal_jobs SET status = ? WHERE id = ? AND status = ? AND deleted_at IS NULL',
        [toStatus, id, fromStatus],
      );
    }
  }

  // ==========================================================================
  // Portal reads
  // ==========================================================================

  async findPortalVisible(departmentId: number | null, filters: PortalJobFilters): Promise<any[]> {
    const where: string[] = [PORTAL_VISIBLE];
    const params: any[] = [departmentId];
    if (filters.category) {
      where.push('j.category = ?');
      params.push(filters.category);
    }
    if (filters.departmentId) {
      where.push('j.department_id = ?');
      params.push(filters.departmentId);
    }
    if (filters.workMode) {
      where.push('j.work_mode = ?');
      params.push(filters.workMode);
    }
    if (filters.employmentType) {
      where.push('j.employment_type = ?');
      params.push(filters.employmentType);
    }
    if (filters.featured) {
      where.push('j.is_featured = 1');
    }
    if (filters.search) {
      where.push('(j.title LIKE ? OR j.description LIKE ?)');
      const like = `%${filters.search}%`;
      params.push(like, like);
    }
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 200), 1), 1000);
    return this.query<any[]>(
      `${JOB_SELECT} WHERE ${where.join(' AND ')}
        ORDER BY j.is_featured DESC, j.published_at DESC, j.id DESC LIMIT ${limit}`,
      params,
    );
  }

  async findRecentPublished(departmentId: number | null, limit: number): Promise<any[]> {
    const capped = Math.min(Math.max(Math.trunc(limit), 1), 50);
    return this.query<any[]>(
      `${JOB_SELECT} WHERE ${PORTAL_VISIBLE}
        ORDER BY j.published_at DESC, j.id DESC LIMIT ${capped}`,
      [departmentId],
    );
  }

  /** Same category OR department OR role; portal-visible; excludes the job itself. */
  async findSimilar(job: any, departmentId: number | null): Promise<any[]> {
    return this.query<any[]>(
      `${JOB_SELECT} WHERE ${PORTAL_VISIBLE} AND j.id != ?
          AND ((j.category IS NOT NULL AND j.category = ?)
            OR (j.department_id IS NOT NULL AND j.department_id = ?)
            OR (j.job_role_id IS NOT NULL AND j.job_role_id = ?))
        ORDER BY j.is_featured DESC, j.published_at DESC LIMIT 5`,
      [departmentId, job.id, job.category ?? null, job.department_id ?? null, job.job_role_id ?? null],
    );
  }

  // ==========================================================================
  // Per-employee annotations (saved / favorite / applied)
  // ==========================================================================

  async savedRows(employeeId: number): Promise<any[]> {
    return this.query<any[]>(
      'SELECT job_id, is_favorite FROM saved_jobs WHERE employee_id = ?',
      [employeeId],
    );
  }

  async appliedJobIds(employeeId: number): Promise<number[]> {
    const rows = await this.query<any[]>(
      'SELECT job_id FROM internal_applications WHERE employee_id = ? AND deleted_at IS NULL',
      [employeeId],
    );
    return rows.map((r) => Number(r.job_id));
  }

  /** uk_saved_job has no nullable columns, so the upsert is race-safe. */
  async saveJob(employeeId: number, jobId: number, favorite: boolean): Promise<void> {
    await this.query(
      `INSERT INTO saved_jobs (employee_id, job_id, is_favorite) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE is_favorite = VALUES(is_favorite)`,
      [employeeId, jobId, favorite ? 1 : 0],
    );
  }

  async unsaveJob(employeeId: number, jobId: number): Promise<number> {
    const result: any = await this.query(
      'DELETE FROM saved_jobs WHERE employee_id = ? AND job_id = ?',
      [employeeId, jobId],
    );
    return Number(result.affectedRows ?? 0);
  }

  async findSavedJobs(employeeId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT j.*, d.name AS department_name, jr.name AS job_role_name,
              hm.full_name AS hiring_manager_name, s.is_favorite, s.saved_at
         FROM saved_jobs s
         JOIN internal_jobs j ON j.id = s.job_id
         LEFT JOIN departments d ON d.id = j.department_id
         LEFT JOIN job_roles jr ON jr.id = j.job_role_id
         LEFT JOIN employees hm ON hm.id = j.hiring_manager_employee_id
        WHERE s.employee_id = ? AND j.deleted_at IS NULL AND j.is_confidential = 0
        ORDER BY s.saved_at DESC`,
      [employeeId],
    );
  }

  // ==========================================================================
  // Career interests + employee context for matching
  // ==========================================================================

  async findEmployeeById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT id, emp_code, full_name, grade, joined_at, department_id, job_role_id FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  async findCareerInterests(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM career_interests WHERE employee_id = ?',
      [employeeId],
    );
    return rows[0] ?? null;
  }

  async employeeSkillNames(employeeId: number): Promise<string[]> {
    const rows = await this.query<any[]>(
      `SELECT s.name FROM employee_skills es
         JOIN skills s ON s.id = es.skill_id AND s.deleted_at IS NULL
        WHERE es.employee_id = ?`,
      [employeeId],
    );
    return rows.map((r) => String(r.name));
  }

  // ==========================================================================
  // Templates
  // ==========================================================================

  async findTemplates(): Promise<any[]> {
    return this.query<any[]>(
      'SELECT * FROM internal_job_templates WHERE deleted_at IS NULL ORDER BY id ASC',
    );
  }

  async findTemplateById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM internal_job_templates WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  async findTemplateByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM internal_job_templates WHERE code = ? AND deleted_at IS NULL',
      [code],
    );
    return rows[0] ?? null;
  }

  async insertTemplate(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO internal_job_templates (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }

  async updateTemplate(id: number, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    await this.query(
      `UPDATE internal_job_templates SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...keys.map((k) => fields[k]), id],
    );
  }

  async findRequisitionById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM job_requisitions WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }
}
