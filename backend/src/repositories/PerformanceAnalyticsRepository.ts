import { BaseRepository } from './BaseRepository';

/**
 * Read-only aggregation queries behind the performance analytics dashboard,
 * distribution, department roll-ups, trends, attrition correlation and the
 * tabular reports.
 *
 * Some queries read tables owned by the talent/reviews work stream
 * (perf_reviews, appraisals) — counts and ratings only, never writes.
 */
export class PerformanceAnalyticsRepository extends BaseRepository {
  async goalStats(cycleId: number): Promise<any> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status = 'COMPLETED'), 0) AS completed,
              COALESCE(SUM(status = 'ACTIVE'), 0) AS active,
              COALESCE(SUM(status = 'PENDING_APPROVAL'), 0) AS pending_approval,
              AVG(progress_pct) AS avg_progress
         FROM perf_goals
        WHERE cycle_id = ? AND deleted_at IS NULL`,
      [cycleId],
    );
    return rows[0] ?? {};
  }

  async kpiStats(cycleId: number): Promise<any> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS assignments,
              COALESCE(SUM(last_computed_at IS NOT NULL OR actual_value IS NOT NULL), 0) AS computed,
              AVG(achievement_pct) AS avg_achievement
         FROM kpi_assignments
        WHERE cycle_id = ? AND deleted_at IS NULL`,
      [cycleId],
    );
    return rows[0] ?? {};
  }

  async kraStats(cycleId: number): Promise<any> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS assigned,
              COALESCE(SUM(status = 'SELF_SCORED'), 0) AS self_scored,
              COALESCE(SUM(status = 'REVIEWED'), 0) AS reviewed,
              COALESCE(SUM(status = 'FINALIZED'), 0) AS finalized
         FROM employee_kras
        WHERE cycle_id = ? AND deleted_at IS NULL`,
      [cycleId],
    );
    return rows[0] ?? {};
  }

  async okrStats(cycleId: number): Promise<any> {
    const rows = await this.query<any[]>(
      `SELECT COALESCE(SUM(kind = 'OBJECTIVE'), 0) AS objectives,
              COALESCE(SUM(kind = 'KEY_RESULT'), 0) AS key_results,
              AVG(CASE WHEN kind = 'OBJECTIVE' THEN progress_pct END) AS avg_objective_progress
         FROM perf_goals
        WHERE cycle_id = ? AND deleted_at IS NULL`,
      [cycleId],
    );
    return rows[0] ?? {};
  }

  /** Read-only counts over the sibling work stream's perf_reviews table. */
  async reviewCountsByStatus(cycleId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT status, COUNT(*) AS count
         FROM perf_reviews
        WHERE cycle_id = ? AND deleted_at IS NULL
        GROUP BY status`,
      [cycleId],
    );
  }

  /** Read-only counts over the sibling work stream's appraisals table. */
  async appraisalCountsByStatus(cycleId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT status, COUNT(*) AS count
         FROM appraisals
        WHERE cycle_id = ? AND deleted_at IS NULL
        GROUP BY status`,
      [cycleId],
    );
  }

  /** Employees ranked by appraisal rating (final, else calibrated, else manager). */
  async performersByAppraisalRating(cycleId: number, order: 'DESC' | 'ASC', limit: number): Promise<any[]> {
    const capped = Math.min(Math.max(Math.trunc(limit), 1), 50);
    return this.query<any[]>(
      `SELECT a.employee_id, e.full_name, e.emp_code,
              COALESCE(a.final_rating, a.calibrated_rating, a.manager_rating) AS rating
         FROM appraisals a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.cycle_id = ? AND a.deleted_at IS NULL
          AND COALESCE(a.final_rating, a.calibrated_rating, a.manager_rating) IS NOT NULL
        ORDER BY rating ${order}, e.full_name ASC
        LIMIT ${capped}`,
      [cycleId],
    );
  }

  /** Employees ranked by average progress of their individual goals. */
  async performersByGoalProgress(cycleId: number, order: 'DESC' | 'ASC', limit: number): Promise<any[]> {
    const capped = Math.min(Math.max(Math.trunc(limit), 1), 50);
    return this.query<any[]>(
      `SELECT g.employee_id, e.full_name, e.emp_code, AVG(g.progress_pct) AS avg_progress
         FROM perf_goals g
         JOIN employees e ON e.id = g.employee_id
        WHERE g.cycle_id = ? AND g.deleted_at IS NULL AND g.employee_id IS NOT NULL
          AND g.status NOT IN ('CANCELLED', 'REJECTED')
        GROUP BY g.employee_id, e.full_name, e.emp_code
        ORDER BY avg_progress ${order}, e.full_name ASC
        LIMIT ${capped}`,
      [cycleId],
    );
  }

  /** All effective appraisal ratings of a cycle (for the distribution buckets). */
  async appraisalRatings(cycleId: number): Promise<number[]> {
    const rows = await this.query<any[]>(
      `SELECT COALESCE(a.final_rating, a.manager_rating) AS rating
         FROM appraisals a
        WHERE a.cycle_id = ? AND a.deleted_at IS NULL
          AND COALESCE(a.final_rating, a.manager_rating) IS NOT NULL`,
      [cycleId],
    );
    return rows.map((r) => Number(r.rating));
  }

  /**
   * Per-department goal aggregates. A goal belongs to a department either
   * directly (department-scoped goal) or through its employee's department.
   */
  async departmentGoalStats(cycleId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT dept.id AS department_id, dept.name AS department_name,
              COUNT(DISTINCT g.employee_id) AS headcount_with_goals,
              COUNT(g.id) AS goal_count,
              AVG(g.progress_pct) AS avg_goal_progress
         FROM departments dept
         LEFT JOIN perf_goals g
           ON g.cycle_id = ? AND g.deleted_at IS NULL
          AND (g.department_id = dept.id
               OR g.employee_id IN (SELECT id FROM employees WHERE department_id = dept.id AND deleted_at IS NULL))
        WHERE dept.deleted_at IS NULL
        GROUP BY dept.id, dept.name
        ORDER BY dept.name ASC`,
      [cycleId],
    );
  }

  async departmentKpiStats(cycleId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT dept.id AS department_id,
              COUNT(a.id) AS assignment_count,
              AVG(a.achievement_pct) AS avg_kpi_achievement
         FROM departments dept
         LEFT JOIN kpi_assignments a
           ON a.cycle_id = ? AND a.deleted_at IS NULL
          AND (a.department_id = dept.id
               OR a.employee_id IN (SELECT id FROM employees WHERE department_id = dept.id AND deleted_at IS NULL))
        WHERE dept.deleted_at IS NULL
        GROUP BY dept.id`,
      [cycleId],
    );
  }

  async monthlyGoalUpdateTrend(fromDate: string): Promise<any[]> {
    return this.query<any[]>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
              COUNT(*) AS updates,
              AVG(progress_pct) AS avg_progress
         FROM goal_updates
        WHERE update_type = 'PROGRESS' AND created_at >= ?
        GROUP BY month
        ORDER BY month ASC`,
      [fromDate],
    );
  }

  async monthlyKpiValueTrend(fromPeriod: string): Promise<any[]> {
    return this.query<any[]>(
      `SELECT period_key AS month, COUNT(*) AS values_recorded
         FROM kpi_values
        WHERE period_key >= ?
        GROUP BY period_key
        ORDER BY period_key ASC`,
      [fromPeriod],
    );
  }

  /** Rating vs work_status rows for the attrition correlation. */
  async ratingWorkStatusRows(cycleId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT COALESCE(a.final_rating, a.calibrated_rating, a.manager_rating) AS rating,
              e.work_status
         FROM appraisals a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.cycle_id = ? AND a.deleted_at IS NULL
          AND COALESCE(a.final_rating, a.calibrated_rating, a.manager_rating) IS NOT NULL`,
      [cycleId],
    );
  }

  // ==========================================================================
  // Report rows
  // ==========================================================================

  async goalReportRows(cycleId?: number): Promise<any[]> {
    const where: string[] = ['g.deleted_at IS NULL'];
    const params: any[] = [];
    if (cycleId) {
      where.push('g.cycle_id = ?');
      params.push(cycleId);
    }
    return this.query<any[]>(
      `SELECT g.id, c.code AS cycle_code, g.kind, g.scope, g.title, g.status, g.priority,
              g.weightage_pct, g.progress_pct, g.due_date,
              e.full_name AS employee_name, t.name AS team_name, d.name AS department_name
         FROM perf_goals g
         JOIN perf_cycles c ON c.id = g.cycle_id
         LEFT JOIN employees e ON e.id = g.employee_id
         LEFT JOIN teams t ON t.id = g.team_id
         LEFT JOIN departments d ON d.id = g.department_id
        WHERE ${where.join(' AND ')}
        ORDER BY g.id ASC
        LIMIT 2000`,
      params,
    );
  }

  async kpiReportRows(cycleId?: number): Promise<any[]> {
    const where: string[] = ['a.deleted_at IS NULL'];
    const params: any[] = [];
    if (cycleId) {
      where.push('a.cycle_id = ?');
      params.push(cycleId);
    }
    return this.query<any[]>(
      `SELECT a.id, c.code AS cycle_code, k.code AS kpi_code, k.name AS kpi_name, k.unit,
              a.scope, e.full_name AS employee_name, d.name AS department_name,
              a.weightage_pct, a.target_value, a.actual_value, a.achievement_pct, a.score, a.status
         FROM kpi_assignments a
         JOIN kpi_library k ON k.id = a.kpi_id
         JOIN perf_cycles c ON c.id = a.cycle_id
         LEFT JOIN employees e ON e.id = a.employee_id
         LEFT JOIN departments d ON d.id = a.department_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.id ASC
        LIMIT 2000`,
      params,
    );
  }

  async kraReportRows(cycleId?: number): Promise<any[]> {
    const where: string[] = ['ek.deleted_at IS NULL'];
    const params: any[] = [];
    if (cycleId) {
      where.push('ek.cycle_id = ?');
      params.push(cycleId);
    }
    return this.query<any[]>(
      `SELECT ek.id, c.code AS cycle_code, kr.code AS kra_code, kr.name AS kra_name,
              e.full_name AS employee_name, e.emp_code,
              ek.weightage_pct, ek.self_score, ek.manager_score, ek.final_score, ek.status
         FROM employee_kras ek
         JOIN kra_library kr ON kr.id = ek.kra_id
         JOIN employees e ON e.id = ek.employee_id
         JOIN perf_cycles c ON c.id = ek.cycle_id
        WHERE ${where.join(' AND ')}
        ORDER BY e.full_name ASC, ek.id ASC
        LIMIT 2000`,
      params,
    );
  }

  async okrReportRows(cycleId?: number): Promise<any[]> {
    const where: string[] = ["g.deleted_at IS NULL", "g.kind IN ('OBJECTIVE', 'KEY_RESULT')"];
    const params: any[] = [];
    if (cycleId) {
      where.push('g.cycle_id = ?');
      params.push(cycleId);
    }
    return this.query<any[]>(
      `SELECT g.id, c.code AS cycle_code, g.kind, g.scope, g.title, g.status,
              g.weightage_pct, g.progress_pct, g.target_value, g.current_value, g.metric_unit,
              p.title AS objective_title
         FROM perf_goals g
         JOIN perf_cycles c ON c.id = g.cycle_id
         LEFT JOIN perf_goals p ON p.id = g.parent_goal_id
        WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(g.parent_goal_id, g.id) ASC, g.kind DESC, g.id ASC
        LIMIT 2000`,
      params,
    );
  }
}
