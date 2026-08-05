import { BaseRepository } from './BaseRepository';

/**
 * Data access for review templates, review instances (the 360 machinery),
 * competencies and competency ratings. All reads join names so services never
 * make N+1 lookups; anonymity is enforced in the service mapper, never here --
 * the rows keep their reviewer columns so HR/admin can still see them.
 */
export class ReviewRepository extends BaseRepository {
  // ==========================================================================
  // Review templates
  // ==========================================================================

  async findTemplates(includeInactive = true): Promise<any[]> {
    const activeSql = includeInactive ? '' : 'AND is_active = true';
    return this.query<any[]>(
      `SELECT * FROM review_templates WHERE deleted_at IS NULL ${activeSql} ORDER BY id ASC`,
    );
  }

  async findTemplateById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM review_templates WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  async findTemplateByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM review_templates WHERE code = ? AND deleted_at IS NULL',
      [code],
    );
    return rows[0] ?? null;
  }

  /** The template `launch` falls back to when a review has none of its own. */
  async findDefaultTemplate(): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM review_templates
       WHERE deleted_at IS NULL AND is_active = true AND applies_to = 'ALL'
       ORDER BY id ASC LIMIT 1`,
    );
    return rows[0] ?? null;
  }

  async insertTemplate(data: {
    code: string;
    name: string;
    appliesTo: string;
    ratingScale: number;
    sectionsJson: string | null;
    isActive: boolean;
    createdBy: number;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO review_templates (code, name, applies_to, rating_scale, sections_json, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.code, data.name, data.appliesTo, data.ratingScale, data.sectionsJson, data.isActive, data.createdBy],
    );
    return Number(result.insertId);
  }

  async updateTemplate(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE review_templates SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  // ==========================================================================
  // Reviews
  // ==========================================================================

  private readonly reviewSelect = `
    SELECT r.*,
           c.name AS cycle_name,
           e.full_name AS employee_name,
           rev.full_name AS reviewer_name
      FROM perf_reviews r
      JOIN perf_cycles c ON c.id = r.cycle_id
      JOIN employees e ON e.id = r.employee_id
      LEFT JOIN employees rev ON rev.id = r.reviewer_employee_id
     WHERE r.deleted_at IS NULL`;

  async findReviews(filters: {
    cycleId?: number;
    employeeId?: number;
    reviewType?: string;
    status?: string;
    reviewerEmployeeId?: number;
  }): Promise<any[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.cycleId) { where.push('r.cycle_id = ?'); params.push(filters.cycleId); }
    if (filters.employeeId) { where.push('r.employee_id = ?'); params.push(filters.employeeId); }
    if (filters.reviewType) { where.push('r.review_type = ?'); params.push(filters.reviewType); }
    if (filters.status) { where.push('r.status = ?'); params.push(filters.status); }
    if (filters.reviewerEmployeeId) { where.push('r.reviewer_employee_id = ?'); params.push(filters.reviewerEmployeeId); }
    const whereSql = where.length ? ` AND ${where.join(' AND ')}` : '';
    return this.query<any[]>(`${this.reviewSelect}${whereSql} ORDER BY r.id DESC LIMIT 500`, params);
  }

  async findReviewById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${this.reviewSelect} AND r.id = ?`, [id]);
    return rows[0] ?? null;
  }

  async reviewExists(
    cycleId: number,
    employeeId: number,
    reviewType: string,
    reviewerEmployeeId: number | null,
  ): Promise<boolean> {
    // reviewer_employee_id is nullable, so the pair check is explicit rather
    // than trusting a unique key (MySQL treats NULLs as always-distinct).
    const rows = await this.query<any[]>(
      `SELECT id FROM perf_reviews
        WHERE cycle_id = ? AND employee_id = ? AND review_type = ?
          AND ${reviewerEmployeeId === null ? 'reviewer_employee_id IS NULL' : 'reviewer_employee_id = ?'}
          AND deleted_at IS NULL
        LIMIT 1`,
      reviewerEmployeeId === null ? [cycleId, employeeId, reviewType] : [cycleId, employeeId, reviewType, reviewerEmployeeId],
    );
    return rows.length > 0;
  }

  async insertReview(data: {
    cycleId: number;
    employeeId: number;
    reviewType: string;
    reviewerEmployeeId: number | null;
    reviewerUserId: number | null;
    externalReviewerName: string | null;
    templateId: number | null;
    isAnonymous: boolean;
    dueDate: string | null;
    requestedBy: number;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO perf_reviews
         (cycle_id, employee_id, review_type, reviewer_employee_id, reviewer_user_id,
          external_reviewer_name, template_id, is_anonymous, due_date, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.cycleId, data.employeeId, data.reviewType, data.reviewerEmployeeId, data.reviewerUserId,
        data.externalReviewerName, data.templateId, data.isAnonymous, data.dueDate, data.requestedBy,
      ],
    );
    return Number(result.insertId);
  }

  async updateReview(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE perf_reviews SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  async findResponses(reviewId: number): Promise<any[]> {
    return this.query<any[]>(
      'SELECT * FROM review_responses WHERE review_id = ? ORDER BY sort_order ASC, id ASC',
      [reviewId],
    );
  }

  /**
   * Replace-all response write plus the header fields, in one transaction so a
   * failed insert never leaves a review with half its answers gone.
   */
  async replaceResponses(
    reviewId: number,
    header: {
      overallRating: number | null | undefined;
      achievements: string | null | undefined;
      challenges: string | null | undefined;
      learnings: string | null | undefined;
      developmentNotes: string | null | undefined;
      markInProgress: boolean;
    },
    items: {
      section: string | null;
      question: string;
      responseText: string | null;
      rating: number | null;
      competencyId: number | null;
      sortOrder: number;
    }[],
  ): Promise<void> {
    await this.transaction(async (conn) => {
      const sets: string[] = [];
      const params: any[] = [];
      if (header.overallRating !== undefined) { sets.push('overall_rating = ?'); params.push(header.overallRating); }
      if (header.achievements !== undefined) { sets.push('achievements = ?'); params.push(header.achievements); }
      if (header.challenges !== undefined) { sets.push('challenges = ?'); params.push(header.challenges); }
      if (header.learnings !== undefined) { sets.push('learnings = ?'); params.push(header.learnings); }
      if (header.developmentNotes !== undefined) { sets.push('development_notes = ?'); params.push(header.developmentNotes); }
      if (header.markInProgress) sets.push("status = 'IN_PROGRESS'");
      if (sets.length > 0) {
        await conn.execute(`UPDATE perf_reviews SET ${sets.join(', ')} WHERE id = ?`, [...params, reviewId]);
      }
      await conn.execute('DELETE FROM review_responses WHERE review_id = ?', [reviewId]);
      for (const item of items) {
        await conn.execute(
          `INSERT INTO review_responses (review_id, section, question, response_text, rating, competency_id, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [reviewId, item.section, item.question, item.responseText, item.rating, item.competencyId, item.sortOrder],
        );
      }
    });
  }

  /**
   * Submission: flips status, stamps the time, and mirrors COMPETENCY-question
   * ratings into competency_ratings -- transactionally, so the 360 aggregates
   * can never see a submitted review whose competency rows are missing.
   */
  async submitReview(
    reviewId: number,
    competencyRows: {
      employeeId: number;
      competencyId: number;
      cycleId: number;
      rating: number;
      ratedByType: string;
      ratedBy: number | null;
    }[],
  ): Promise<void> {
    await this.transaction(async (conn) => {
      await conn.execute(
        "UPDATE perf_reviews SET status = 'SUBMITTED', submitted_at = NOW() WHERE id = ?",
        [reviewId],
      );
      await conn.execute('DELETE FROM competency_ratings WHERE review_id = ?', [reviewId]);
      for (const row of competencyRows) {
        await conn.execute(
          `INSERT INTO competency_ratings (employee_id, competency_id, cycle_id, review_id, rating, rated_by_type, rated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [row.employeeId, row.competencyId, row.cycleId, reviewId, row.rating, row.ratedByType, row.ratedBy],
        );
      }
    });
  }

  // ==========================================================================
  // Launch helpers
  // ==========================================================================

  async findWorkingEmployees(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT id, emp_code, full_name, grade, joined_at FROM employees
        WHERE work_status = 'WORKING' AND deleted_at IS NULL ORDER BY id ASC`,
    );
  }

  /** Primary manager today: is_primary first, then a DIRECT line. */
  async findPrimaryManager(employeeId: number, onDate: string): Promise<number | null> {
    const rows = await this.query<any[]>(
      `SELECT manager_employee_id FROM reporting_relationships
        WHERE employee_id = ?
          AND (is_primary = true OR relationship_type = 'DIRECT')
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
          AND deleted_at IS NULL
        ORDER BY is_primary DESC, (relationship_type = 'DIRECT') DESC, id ASC
        LIMIT 1`,
      [employeeId, onDate, onDate],
    );
    return rows.length > 0 ? Number(rows[0].manager_employee_id) : null;
  }

  async findUserIdForEmployee(employeeId: number): Promise<number | null> {
    const rows = await this.query<any[]>(
      'SELECT id FROM users WHERE employee_id = ? AND is_active = true AND deleted_at IS NULL LIMIT 1',
      [employeeId],
    );
    return rows.length > 0 ? Number(rows[0].id) : null;
  }

  async findEmployeeById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT id, emp_code, full_name, grade, work_status, joined_at FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  async findCycleById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM perf_cycles WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  // ==========================================================================
  // 360 aggregates
  // ==========================================================================

  async aggregate360ByType(employeeId: number, cycleId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT review_type,
              COUNT(*) AS count,
              SUM(status IN ('SUBMITTED', 'ACKNOWLEDGED')) AS submitted,
              AVG(CASE WHEN status IN ('SUBMITTED', 'ACKNOWLEDGED') THEN overall_rating END) AS avg_rating
         FROM perf_reviews
        WHERE employee_id = ? AND cycle_id = ? AND deleted_at IS NULL
        GROUP BY review_type`,
      [employeeId, cycleId],
    );
  }

  async competencyAverages360(employeeId: number, cycleId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT cr.competency_id, c.name, c.category,
              AVG(cr.rating) AS avg_rating, COUNT(*) AS raters
         FROM competency_ratings cr
         JOIN competencies c ON c.id = cr.competency_id
        WHERE cr.employee_id = ? AND cr.cycle_id = ?
        GROUP BY cr.competency_id, c.name, c.category
        ORDER BY c.category ASC, c.name ASC`,
      [employeeId, cycleId],
    );
  }

  // ==========================================================================
  // Attachments
  // ==========================================================================

  async insertAttachment(data: {
    reviewId: number;
    fileName: string;
    filePath: string;
    mimeType: string | null;
    fileSize: number | null;
    uploadedBy: number;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO review_attachments (review_id, file_name, file_path, mime_type, file_size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.reviewId, data.fileName, data.filePath, data.mimeType, data.fileSize, data.uploadedBy],
    );
    return Number(result.insertId);
  }

  async findAttachments(reviewId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT a.*, u.name AS uploaded_by_name FROM review_attachments a
        LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.review_id = ? ORDER BY a.id ASC`,
      [reviewId],
    );
  }

  async findAttachmentById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM review_attachments WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  // ==========================================================================
  // ESS
  // ==========================================================================

  /** Reviews where I am the reviewer, pending work first. */
  async findReviewsForReviewer(reviewerEmployeeId: number): Promise<any[]> {
    return this.query<any[]>(
      `${this.reviewSelect} AND r.reviewer_employee_id = ?
       ORDER BY (r.status IN ('REQUESTED', 'IN_PROGRESS')) DESC, r.due_date IS NULL ASC, r.due_date ASC, r.id DESC
       LIMIT 200`,
      [reviewerEmployeeId],
    );
  }

  /** Reviews about me that have been submitted (or acknowledged). */
  async findReviewHistoryForEmployee(employeeId: number): Promise<any[]> {
    return this.query<any[]>(
      `${this.reviewSelect} AND r.employee_id = ? AND r.status IN ('SUBMITTED', 'ACKNOWLEDGED')
       ORDER BY r.submitted_at DESC, r.id DESC LIMIT 200`,
      [employeeId],
    );
  }

  // ==========================================================================
  // Competencies
  // ==========================================================================

  async findCompetencies(includeInactive = true): Promise<any[]> {
    const activeSql = includeInactive ? '' : 'AND is_active = true';
    return this.query<any[]>(
      `SELECT * FROM competencies WHERE deleted_at IS NULL ${activeSql} ORDER BY category ASC, name ASC`,
    );
  }

  async findCompetencyById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM competencies WHERE id = ? AND deleted_at IS NULL', [id]);
    return rows[0] ?? null;
  }

  async findCompetencyByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM competencies WHERE code = ? AND deleted_at IS NULL', [code]);
    return rows[0] ?? null;
  }

  async insertCompetency(data: {
    code: string;
    name: string;
    category: string;
    description: string | null;
    levelsJson: string | null;
    isActive: boolean;
    createdBy: number;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO competencies (code, name, category, description, levels_json, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.code, data.name, data.category, data.description, data.levelsJson, data.isActive, data.createdBy],
    );
    return Number(result.insertId);
  }

  async updateCompetency(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE competencies SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  async findCompetencyRatings(filters: { employeeId?: number; cycleId?: number }): Promise<any[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.employeeId) { where.push('cr.employee_id = ?'); params.push(filters.employeeId); }
    if (filters.cycleId) { where.push('cr.cycle_id = ?'); params.push(filters.cycleId); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.query<any[]>(
      `SELECT cr.*, c.code AS competency_code, c.name AS competency_name, c.category,
              e.full_name AS employee_name
         FROM competency_ratings cr
         JOIN competencies c ON c.id = cr.competency_id
         JOIN employees e ON e.id = cr.employee_id
         ${whereSql}
        ORDER BY cr.id DESC LIMIT 500`,
      params,
    );
  }

  async insertCompetencyRating(data: {
    employeeId: number;
    competencyId: number;
    cycleId: number | null;
    reviewId: number | null;
    rating: number;
    ratedByType: string;
    ratedBy: number;
    note: string | null;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO competency_ratings (employee_id, competency_id, cycle_id, review_id, rating, rated_by_type, rated_by, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.employeeId, data.competencyId, data.cycleId, data.reviewId, data.rating, data.ratedByType, data.ratedBy, data.note],
    );
    return Number(result.insertId);
  }

  /**
   * Skill matrix rows: one per WORKING employee with the average competency
   * rating per category plus the head-count of rated skills from the existing
   * employee_skills table.
   */
  async skillMatrix(cycleId?: number): Promise<any[]> {
    const cycleSql = cycleId ? 'AND cr.cycle_id = ?' : '';
    const params = cycleId ? [cycleId] : [];
    return this.query<any[]>(
      `SELECT e.id AS employee_id, e.emp_code, e.full_name, e.grade,
              AVG(CASE WHEN c.category = 'TECHNICAL' THEN cr.rating END) AS avg_technical,
              AVG(CASE WHEN c.category = 'FUNCTIONAL' THEN cr.rating END) AS avg_functional,
              AVG(CASE WHEN c.category = 'LEADERSHIP' THEN cr.rating END) AS avg_leadership,
              AVG(CASE WHEN c.category = 'BEHAVIORAL' THEN cr.rating END) AS avg_behavioral,
              (SELECT COUNT(*) FROM employee_skills es WHERE es.employee_id = e.id) AS skill_count
         FROM employees e
         LEFT JOIN competency_ratings cr ON cr.employee_id = e.id ${cycleSql}
         LEFT JOIN competencies c ON c.id = cr.competency_id
        WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL
        GROUP BY e.id, e.emp_code, e.full_name, e.grade
        ORDER BY e.emp_code ASC`,
      params,
    );
  }
}
