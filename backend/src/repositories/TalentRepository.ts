import { BaseRepository } from './BaseRepository';

/**
 * Data access for appraisals, promotions, 9-box talent assessments, talent
 * pools, succession plans and calibration sessions. Appraisal generation READS
 * the goal/KPI/KRA tables owned by the core performance stream but never
 * writes them.
 */
export class TalentRepository extends BaseRepository {
  // ==========================================================================
  // Appraisals
  // ==========================================================================

  private readonly appraisalSelect = `
    SELECT a.*, c.name AS cycle_name, c.financial_year,
           e.full_name AS employee_name, e.emp_code, e.grade
      FROM appraisals a
      JOIN perf_cycles c ON c.id = a.cycle_id
      JOIN employees e ON e.id = a.employee_id
     WHERE a.deleted_at IS NULL`;

  async findAppraisals(filters: { cycleId?: number; status?: string; employeeId?: number }): Promise<any[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.cycleId) { where.push('a.cycle_id = ?'); params.push(filters.cycleId); }
    if (filters.status) { where.push('a.status = ?'); params.push(filters.status); }
    if (filters.employeeId) { where.push('a.employee_id = ?'); params.push(filters.employeeId); }
    const whereSql = where.length ? ` AND ${where.join(' AND ')}` : '';
    return this.query<any[]>(`${this.appraisalSelect}${whereSql} ORDER BY a.id DESC LIMIT 500`, params);
  }

  async findAppraisalById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${this.appraisalSelect} AND a.id = ?`, [id]);
    return rows[0] ?? null;
  }

  async findAppraisalEmployeeIds(cycleId: number): Promise<Set<number>> {
    const rows = await this.query<any[]>(
      'SELECT employee_id FROM appraisals WHERE cycle_id = ? AND deleted_at IS NULL',
      [cycleId],
    );
    return new Set(rows.map((r) => Number(r.employee_id)));
  }

  async insertAppraisal(data: {
    cycleId: number;
    employeeId: number;
    goalScore: number | null;
    kraScore: number | null;
    kpiScore: number | null;
    competencyScore: number | null;
    totalScore: number | null;
    selfRating: number | null;
    managerRating: number | null;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO appraisals
         (cycle_id, employee_id, goal_score, kra_score, kpi_score, competency_score,
          total_score, self_rating, manager_rating, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        data.cycleId, data.employeeId, data.goalScore, data.kraScore, data.kpiScore,
        data.competencyScore, data.totalScore, data.selfRating, data.managerRating,
      ],
    );
    return Number(result.insertId);
  }

  async updateAppraisal(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE appraisals SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  // --------------------------------------------------------------------------
  // Component score reads (tables owned by the core performance stream)
  // --------------------------------------------------------------------------

  /** Weightage-weighted average progressPct of ACTIVE/COMPLETED individual goals, per employee. */
  async goalProgressByEmployee(cycleId: number): Promise<Map<number, number>> {
    const rows = await this.query<any[]>(
      `SELECT employee_id,
              SUM(weightage_pct * progress_pct) / NULLIF(SUM(weightage_pct), 0) AS weighted_progress
         FROM perf_goals
        WHERE cycle_id = ? AND scope = 'INDIVIDUAL' AND employee_id IS NOT NULL
          AND status IN ('ACTIVE', 'COMPLETED') AND deleted_at IS NULL
        GROUP BY employee_id`,
      [cycleId],
    );
    const map = new Map<number, number>();
    for (const r of rows) {
      if (r.weighted_progress !== null) map.set(Number(r.employee_id), Number(r.weighted_progress));
    }
    return map;
  }

  /** Weighted average KRA score (final, falling back to manager then self), per employee. */
  async kraScoreByEmployee(cycleId: number): Promise<Map<number, number>> {
    const rows = await this.query<any[]>(
      `SELECT employee_id,
              SUM(weightage_pct * COALESCE(final_score, manager_score, self_score))
                / NULLIF(SUM(weightage_pct), 0) AS weighted_score
         FROM employee_kras
        WHERE cycle_id = ? AND COALESCE(final_score, manager_score, self_score) IS NOT NULL
        GROUP BY employee_id`,
      [cycleId],
    );
    const map = new Map<number, number>();
    for (const r of rows) {
      if (r.weighted_score !== null) map.set(Number(r.employee_id), Number(r.weighted_score));
    }
    return map;
  }

  /** Raw scored individual KPI assignments; the ratio/clamp math stays in the service. */
  async scoredKpiAssignments(cycleId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT employee_id, weightage_pct, score
         FROM kpi_assignments
        WHERE cycle_id = ? AND scope = 'INDIVIDUAL' AND employee_id IS NOT NULL
          AND score IS NOT NULL AND weightage_pct > 0`,
      [cycleId],
    );
  }

  async competencyAvgByEmployee(cycleId: number): Promise<Map<number, number>> {
    const rows = await this.query<any[]>(
      `SELECT employee_id, AVG(rating) AS avg_rating
         FROM competency_ratings WHERE cycle_id = ? GROUP BY employee_id`,
      [cycleId],
    );
    const map = new Map<number, number>();
    for (const r of rows) {
      if (r.avg_rating !== null) map.set(Number(r.employee_id), Number(r.avg_rating));
    }
    return map;
  }

  /** Latest submitted SELF/MANAGER overall ratings per employee for a cycle. */
  async reviewRatingsByEmployee(cycleId: number): Promise<Map<number, { self: number | null; manager: number | null }>> {
    const rows = await this.query<any[]>(
      `SELECT employee_id, review_type, overall_rating
         FROM perf_reviews
        WHERE cycle_id = ? AND review_type IN ('SELF', 'MANAGER')
          AND status IN ('SUBMITTED', 'ACKNOWLEDGED')
          AND overall_rating IS NOT NULL AND deleted_at IS NULL
        ORDER BY submitted_at ASC, id ASC`,
      [cycleId],
    );
    const map = new Map<number, { self: number | null; manager: number | null }>();
    for (const r of rows) {
      const entry = map.get(Number(r.employee_id)) ?? { self: null, manager: null };
      // Later rows overwrite earlier ones, so the latest submission wins.
      if (r.review_type === 'SELF') entry.self = Number(r.overall_rating);
      else entry.manager = Number(r.overall_rating);
      map.set(Number(r.employee_id), entry);
    }
    return map;
  }

  async findWorkingEmployees(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT id, emp_code, full_name, grade, joined_at FROM employees
        WHERE work_status = 'WORKING' AND deleted_at IS NULL ORDER BY id ASC`,
    );
  }

  async findEmployeeById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT id, emp_code, full_name, grade, work_status, joined_at FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  async findCycleById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM perf_cycles WHERE id = ? AND deleted_at IS NULL', [id]);
    return rows[0] ?? null;
  }

  // ==========================================================================
  // Promotions
  // ==========================================================================

  private readonly promotionSelect = `
    SELECT p.*, e.full_name AS employee_name, e.emp_code,
           fr.name AS from_role_name, tr.name AS to_role_name
      FROM promotions p
      JOIN employees e ON e.id = p.employee_id
      LEFT JOIN job_roles fr ON fr.id = p.from_role_id
      LEFT JOIN job_roles tr ON tr.id = p.to_role_id
     WHERE p.deleted_at IS NULL`;

  async findPromotions(filters: { status?: string; employeeId?: number }): Promise<any[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.status) { where.push('p.status = ?'); params.push(filters.status); }
    if (filters.employeeId) { where.push('p.employee_id = ?'); params.push(filters.employeeId); }
    const whereSql = where.length ? ` AND ${where.join(' AND ')}` : '';
    return this.query<any[]>(`${this.promotionSelect}${whereSql} ORDER BY p.id DESC LIMIT 500`, params);
  }

  async findPromotionById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${this.promotionSelect} AND p.id = ?`, [id]);
    return rows[0] ?? null;
  }

  async insertPromotion(data: {
    employeeId: number;
    appraisalId: number | null;
    fromGrade: string | null;
    toGrade: string;
    fromRoleId: number | null;
    toRoleId: number | null;
    fromPositionId: number | null;
    toPositionId: number | null;
    salaryImpactPct: number | null;
    salaryImpactAmount: number | null;
    effectiveDate: string | null;
    justification: string | null;
    requestedBy: number;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO promotions
         (employee_id, appraisal_id, from_grade, to_grade, from_role_id, to_role_id,
          from_position_id, to_position_id, salary_impact_pct, salary_impact_amount,
          effective_date, justification, status, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
      [
        data.employeeId, data.appraisalId, data.fromGrade, data.toGrade, data.fromRoleId, data.toRoleId,
        data.fromPositionId, data.toPositionId, data.salaryImpactPct, data.salaryImpactAmount,
        data.effectiveDate, data.justification, data.requestedBy,
      ],
    );
    return Number(result.insertId);
  }

  async updatePromotion(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE promotions SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  /**
   * Effecting a promotion is one transaction: the employee's grade changes,
   * a career-timeline event is written, and the case flips to EFFECTED.
   */
  async effectPromotion(
    promotionId: number,
    employeeId: number,
    toGrade: string,
    timeline: { eventDate: string; title: string; details: string | null; fromValue: string | null; toValue: string },
    userId: number,
  ): Promise<void> {
    await this.transaction(async (conn) => {
      await conn.execute('UPDATE employees SET grade = ?, updated_by = ? WHERE id = ?', [toGrade, userId, employeeId]);
      await conn.execute(
        `INSERT INTO employee_timeline (employee_id, event_type, event_date, title, details, from_value, to_value, recorded_by)
         VALUES (?, 'PROMOTION', ?, ?, ?, ?, ?, ?)`,
        [employeeId, timeline.eventDate, timeline.title, timeline.details, timeline.fromValue, timeline.toValue, userId],
      );
      await conn.execute(
        "UPDATE promotions SET status = 'EFFECTED', effected_at = NOW() WHERE id = ?",
        [promotionId],
      );
    });
  }

  /** Appraisal-based promotion eligibility for a cycle. */
  async promotionEligibility(cycleId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT e.id AS employee_id, e.emp_code, e.full_name, e.grade, e.joined_at,
              a.id AS appraisal_id, a.final_rating, a.promotion_recommended, a.rating_label
         FROM employees e
         JOIN appraisals a ON a.employee_id = e.id AND a.cycle_id = ? AND a.deleted_at IS NULL
        WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL
          AND (a.final_rating >= 4 OR a.promotion_recommended = true)
        ORDER BY a.final_rating DESC, e.emp_code ASC`,
      [cycleId],
    );
  }

  // ==========================================================================
  // 9-box talent assessments
  // ==========================================================================

  async findAssessments(cycleId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT t.*, e.full_name AS employee_name, e.emp_code, e.grade
         FROM talent_assessments t
         JOIN employees e ON e.id = t.employee_id
        WHERE t.cycle_id = ?
        ORDER BY t.box_position DESC, e.emp_code ASC`,
      [cycleId],
    );
  }

  async findUnassessedEmployees(cycleId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT e.id AS employee_id, e.emp_code, e.full_name, e.grade
         FROM employees e
        WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM talent_assessments t WHERE t.employee_id = e.id AND t.cycle_id = ?)
        ORDER BY e.emp_code ASC`,
      [cycleId],
    );
  }

  async findAssessment(cycleId: number, employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT t.*, e.full_name AS employee_name, e.emp_code, e.grade
         FROM talent_assessments t JOIN employees e ON e.id = t.employee_id
        WHERE t.cycle_id = ? AND t.employee_id = ?`,
      [cycleId, employeeId],
    );
    return rows[0] ?? null;
  }

  /** Safe upsert: both unique-key columns are NOT NULL, so ON DUPLICATE works. */
  async upsertAssessment(data: {
    cycleId: number;
    employeeId: number;
    performanceScore: number;
    potentialScore: number;
    boxPosition: number;
    isHipo: boolean;
    attritionRisk: string | null;
    assessmentNote: string | null;
    assessedBy: number;
  }): Promise<void> {
    await this.query(
      `INSERT INTO talent_assessments
         (cycle_id, employee_id, performance_score, potential_score, box_position,
          is_hipo, attrition_risk, assessment_note, assessed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         performance_score = VALUES(performance_score),
         potential_score = VALUES(potential_score),
         box_position = VALUES(box_position),
         is_hipo = VALUES(is_hipo),
         attrition_risk = VALUES(attrition_risk),
         assessment_note = VALUES(assessment_note),
         assessed_by = VALUES(assessed_by)`,
      [
        data.cycleId, data.employeeId, data.performanceScore, data.potentialScore, data.boxPosition,
        data.isHipo, data.attritionRisk, data.assessmentNote, data.assessedBy,
      ],
    );
  }

  // ==========================================================================
  // Talent pools
  // ==========================================================================

  async findPools(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT p.*,
              (SELECT COUNT(*) FROM talent_pool_members m WHERE m.pool_id = p.id AND m.removed_at IS NULL) AS member_count
         FROM talent_pools p
        WHERE p.deleted_at IS NULL
        ORDER BY p.id ASC`,
    );
  }

  async findPoolById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM talent_pools WHERE id = ? AND deleted_at IS NULL', [id]);
    return rows[0] ?? null;
  }

  async findPoolByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM talent_pools WHERE code = ? AND deleted_at IS NULL', [code]);
    return rows[0] ?? null;
  }

  async findPoolMembers(poolId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT m.*, e.full_name AS employee_name, e.emp_code
         FROM talent_pool_members m JOIN employees e ON e.id = m.employee_id
        WHERE m.pool_id = ? AND m.removed_at IS NULL
        ORDER BY m.added_at ASC`,
      [poolId],
    );
  }

  async insertPool(data: {
    code: string;
    name: string;
    poolType: string;
    description: string | null;
    isActive: boolean;
    createdBy: number;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO talent_pools (code, name, pool_type, description, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.code, data.name, data.poolType, data.description, data.isActive, data.createdBy],
    );
    return Number(result.insertId);
  }

  async updatePool(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE talent_pools SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  /** Any membership row for the pair, removed or not (unique key covers both). */
  async findMembership(poolId: number, employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM talent_pool_members WHERE pool_id = ? AND employee_id = ?',
      [poolId, employeeId],
    );
    return rows[0] ?? null;
  }

  async findMembershipById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM talent_pool_members WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async insertMember(poolId: number, employeeId: number, note: string | null, addedBy: number): Promise<number> {
    const result: any = await this.query(
      'INSERT INTO talent_pool_members (pool_id, employee_id, note, added_by) VALUES (?, ?, ?, ?)',
      [poolId, employeeId, note, addedBy],
    );
    return Number(result.insertId);
  }

  async reactivateMember(id: number, note: string | null, addedBy: number): Promise<void> {
    await this.query(
      'UPDATE talent_pool_members SET removed_at = NULL, note = ?, added_by = ?, added_at = NOW() WHERE id = ?',
      [note, addedBy, id],
    );
  }

  /** History-preserving removal: the row stays, removed_at marks the exit. */
  async removeMember(id: number): Promise<void> {
    await this.query('UPDATE talent_pool_members SET removed_at = NOW() WHERE id = ?', [id]);
  }

  // ==========================================================================
  // Succession plans
  // ==========================================================================

  private readonly successionSelect = `
    SELECT s.*, pos.title AS position_name, jr.name AS role_name, e.full_name AS incumbent_name
      FROM succession_plans s
      LEFT JOIN positions pos ON pos.id = s.position_id
      LEFT JOIN job_roles jr ON jr.id = s.role_id
      LEFT JOIN employees e ON e.id = s.incumbent_employee_id
     WHERE s.deleted_at IS NULL`;

  async findSuccessionPlans(status?: string): Promise<any[]> {
    const params: any[] = [];
    let sql = this.successionSelect;
    if (status) { sql += ' AND s.status = ?'; params.push(status); }
    return this.query<any[]>(`${sql} ORDER BY s.id ASC`, params);
  }

  async findSuccessionPlanById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${this.successionSelect} AND s.id = ?`, [id]);
    return rows[0] ?? null;
  }

  async findSuccessionCandidates(planIds: number[]): Promise<any[]> {
    if (planIds.length === 0) return [];
    const placeholders = planIds.map(() => '?').join(', ');
    return this.query<any[]>(
      `SELECT sc.*, e.full_name AS employee_name, e.emp_code
         FROM succession_candidates sc JOIN employees e ON e.id = sc.employee_id
        WHERE sc.plan_id IN (${placeholders})
        ORDER BY sc.plan_id ASC, sc.ranking IS NULL ASC, sc.ranking ASC, sc.id ASC`,
      planIds,
    );
  }

  async findSuccessionCandidateById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM succession_candidates WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async insertSuccessionPlan(data: {
    positionId: number | null;
    roleId: number | null;
    incumbentEmployeeId: number | null;
    criticality: string;
    riskOfLoss: string;
    notes: string | null;
    createdBy: number;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO succession_plans (position_id, role_id, incumbent_employee_id, criticality, risk_of_loss, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.positionId, data.roleId, data.incumbentEmployeeId, data.criticality, data.riskOfLoss, data.notes, data.createdBy],
    );
    return Number(result.insertId);
  }

  async updateSuccessionPlan(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE succession_plans SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  async findCandidatePair(planId: number, employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM succession_candidates WHERE plan_id = ? AND employee_id = ?',
      [planId, employeeId],
    );
    return rows[0] ?? null;
  }

  async insertSuccessionCandidate(data: {
    planId: number;
    employeeId: number;
    readiness: string;
    ranking: number | null;
    developmentNote: string | null;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO succession_candidates (plan_id, employee_id, readiness, ranking, development_note)
       VALUES (?, ?, ?, ?, ?)`,
      [data.planId, data.employeeId, data.readiness, data.ranking, data.developmentNote],
    );
    return Number(result.insertId);
  }

  async updateSuccessionCandidate(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE succession_candidates SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  async deleteSuccessionCandidate(id: number): Promise<void> {
    await this.query('DELETE FROM succession_candidates WHERE id = ?', [id]);
  }

  // ==========================================================================
  // Calibration
  // ==========================================================================

  private readonly sessionSelect = `
    SELECT s.*, c.name AS cycle_name, d.name AS department_name
      FROM calibration_sessions s
      JOIN perf_cycles c ON c.id = s.cycle_id
      LEFT JOIN departments d ON d.id = s.department_id
     WHERE s.deleted_at IS NULL`;

  async findCalibrationSessions(cycleId?: number): Promise<any[]> {
    const params: any[] = [];
    let sql = this.sessionSelect;
    if (cycleId) { sql += ' AND s.cycle_id = ?'; params.push(cycleId); }
    return this.query<any[]>(`${sql} ORDER BY s.id DESC`, params);
  }

  async findCalibrationSessionById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${this.sessionSelect} AND s.id = ?`, [id]);
    return rows[0] ?? null;
  }

  async findAdjustmentsForSession(sessionId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT adj.*, e.full_name AS employee_name
         FROM calibration_adjustments adj
         JOIN appraisals a ON a.id = adj.appraisal_id
         JOIN employees e ON e.id = a.employee_id
        WHERE adj.session_id = ?
        ORDER BY adj.id ASC`,
      [sessionId],
    );
  }

  async insertCalibrationSession(data: {
    cycleId: number;
    name: string;
    sessionDate: string | null;
    departmentId: number | null;
    committeeJson: string | null;
    notes: string | null;
    createdBy: number;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO calibration_sessions (cycle_id, name, session_date, department_id, committee_json, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.cycleId, data.name, data.sessionDate, data.departmentId, data.committeeJson, data.notes, data.createdBy],
    );
    return Number(result.insertId);
  }

  async updateCalibrationSession(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE calibration_sessions SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  /**
   * A calibration adjustment and its effect on the appraisal move together:
   * the adjustment row records what the rating was, the appraisal takes the
   * new calibrated rating and the CALIBRATED status.
   */
  async applyAdjustment(
    sessionId: number,
    appraisalId: number,
    previousRating: number | null,
    adjustedRating: number,
    reason: string | null,
    userId: number,
  ): Promise<number> {
    return this.transaction(async (conn) => {
      const [result]: any = await conn.execute(
        `INSERT INTO calibration_adjustments (session_id, appraisal_id, previous_rating, adjusted_rating, reason, adjusted_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, appraisalId, previousRating, adjustedRating, reason, userId],
      );
      await conn.execute(
        "UPDATE appraisals SET calibrated_rating = ?, status = 'CALIBRATED' WHERE id = ?",
        [adjustedRating, appraisalId],
      );
      return Number(result.insertId);
    });
  }
}
