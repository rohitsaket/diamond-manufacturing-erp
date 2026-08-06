import { BaseRepository } from './BaseRepository';

/** Career interests and the read-side of the career development dashboard. */
export class CareerRepository extends BaseRepository {
  async findInterests(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT ci.*, e.full_name AS employee_name
         FROM career_interests ci
         JOIN employees e ON e.id = ci.employee_id
        WHERE ci.employee_id = ?`,
      [employeeId],
    );
    return rows[0] ?? null;
  }

  /** uk_career_interest(employee_id) is NOT NULL, so the upsert is safe. */
  async upsertInterests(employeeId: number, data: any, userId: number): Promise<void> {
    await this.query(
      `INSERT INTO career_interests
         (employee_id, preferred_roles, preferred_departments, work_mode_preference,
          willing_to_relocate, open_to_gigs, career_statement, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         preferred_roles = VALUES(preferred_roles),
         preferred_departments = VALUES(preferred_departments),
         work_mode_preference = VALUES(work_mode_preference),
         willing_to_relocate = VALUES(willing_to_relocate),
         open_to_gigs = VALUES(open_to_gigs),
         career_statement = VALUES(career_statement),
         updated_by = VALUES(updated_by)`,
      [
        employeeId,
        JSON.stringify(data.preferredRoles ?? []),
        JSON.stringify(data.preferredDepartments ?? []),
        data.workModePreference ?? 'ANY',
        !!data.willingToRelocate,
        data.openToGigs !== false,
        data.careerStatement ?? null,
        userId,
      ],
    );
  }

  async findEmployee(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  async applicationCounts(employeeId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT status, COUNT(*) AS n
         FROM internal_applications
        WHERE employee_id = ? AND deleted_at IS NULL
        GROUP BY status`,
      [employeeId],
    );
  }

  async savedJobCount(employeeId: number): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT COUNT(*) AS n FROM saved_jobs WHERE employee_id = ?',
      [employeeId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async openOffers(employeeId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT o.id, o.offer_code, o.title, o.offer_type, o.status, o.valid_until
         FROM internal_offers o
         JOIN internal_applications a ON a.id = o.application_id
        WHERE a.employee_id = ? AND o.status = 'RELEASED' AND o.deleted_at IS NULL`,
      [employeeId],
    );
  }

  /** Latest succession readiness rows naming this employee as a candidate. */
  async successionReadiness(employeeId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT sc.readiness, sc.ranking, sp.criticality,
              p.title AS position_title, r.name AS role_name
         FROM succession_candidates sc
         JOIN succession_plans sp ON sp.id = sc.plan_id AND sp.deleted_at IS NULL
         LEFT JOIN positions p ON p.id = sp.position_id
         LEFT JOIN job_roles r ON r.id = sp.role_id
        WHERE sc.employee_id = ?`,
      [employeeId],
    );
  }

  /** Most recent 9-box assessment for this employee, if any. */
  async latestTalentAssessment(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT ta.*, c.name AS cycle_name
         FROM talent_assessments ta
         JOIN perf_cycles c ON c.id = ta.cycle_id
        WHERE ta.employee_id = ?
        ORDER BY ta.updated_at DESC
        LIMIT 1`,
      [employeeId],
    );
    return rows[0] ?? null;
  }

  /**
   * Career paths reachable from the roles whose job grade matches the
   * employee's grade string. Empty when no grade<->job_grade mapping exists.
   */
  async roadmapForGrade(grade: string): Promise<any[]> {
    return this.query<any[]>(
      `SELECT cp.id, cp.typical_years, cp.notes,
              fr.name AS from_role, tr.name AS to_role,
              tg.code AS to_grade_code
         FROM career_paths cp
         JOIN job_roles fr ON fr.id = cp.from_role_id
         JOIN job_roles tr ON tr.id = cp.to_role_id
         JOIN job_grades fg ON fg.id = fr.job_grade_id
         LEFT JOIN job_grades tg ON tg.id = tr.job_grade_id
        WHERE fg.code = ?`,
      [grade],
    );
  }

  async allRoadmaps(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT cp.id, cp.typical_years, cp.notes,
              fr.name AS from_role, fr.code AS from_role_code,
              tr.name AS to_role, tr.code AS to_role_code
         FROM career_paths cp
         JOIN job_roles fr ON fr.id = cp.from_role_id
         JOIN job_roles tr ON tr.id = cp.to_role_id
        ORDER BY fr.name, tr.name`,
    );
  }
}
