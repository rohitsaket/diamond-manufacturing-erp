import { BaseRepository } from './BaseRepository';

/**
 * Data access for individual development plans (IDPs) and performance
 * improvement plans (PIPs). PIP rows are confidential -- the repository
 * returns them plainly and the route layer restricts who can ask.
 */
export class DevelopmentRepository extends BaseRepository {
  // ==========================================================================
  // Development plans
  // ==========================================================================

  private readonly planSelect = `
    SELECT p.*, e.full_name AS employee_name, e.emp_code,
           m.full_name AS mentor_name, jr.name AS target_role_name
      FROM development_plans p
      JOIN employees e ON e.id = p.employee_id
      LEFT JOIN employees m ON m.id = p.mentor_employee_id
      LEFT JOIN job_roles jr ON jr.id = p.target_role_id
     WHERE p.deleted_at IS NULL`;

  async findPlans(filters: { employeeId?: number; status?: string }): Promise<any[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.employeeId) { where.push('p.employee_id = ?'); params.push(filters.employeeId); }
    if (filters.status) { where.push('p.status = ?'); params.push(filters.status); }
    const whereSql = where.length ? ` AND ${where.join(' AND ')}` : '';
    return this.query<any[]>(`${this.planSelect}${whereSql} ORDER BY p.id DESC LIMIT 500`, params);
  }

  async findPlanById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${this.planSelect} AND p.id = ?`, [id]);
    return rows[0] ?? null;
  }

  /** ESS: the latest ACTIVE plan, else the latest plan of any status. */
  async findLatestPlanForEmployee(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `${this.planSelect} AND p.employee_id = ?
       ORDER BY (p.status = 'ACTIVE') DESC, p.id DESC LIMIT 1`,
      [employeeId],
    );
    return rows[0] ?? null;
  }

  async findPlanItems(planId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT i.*, t.title AS training_title
         FROM development_plan_items i
         LEFT JOIN trainings t ON t.id = i.training_id
        WHERE i.plan_id = ?
        ORDER BY i.sort_order ASC, i.id ASC`,
      [planId],
    );
  }

  async findPlanItemById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM development_plan_items WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async insertPlan(data: {
    employeeId: number;
    cycleId: number | null;
    title: string;
    careerGoal: string | null;
    targetRoleId: number | null;
    mentorEmployeeId: number | null;
    status: string;
    startDate: string | null;
    endDate: string | null;
    reviewNotes: string | null;
    createdBy: number;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO development_plans
         (employee_id, cycle_id, title, career_goal, target_role_id, mentor_employee_id,
          status, start_date, end_date, review_notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.employeeId, data.cycleId, data.title, data.careerGoal, data.targetRoleId,
        data.mentorEmployeeId, data.status, data.startDate, data.endDate, data.reviewNotes, data.createdBy,
      ],
    );
    return Number(result.insertId);
  }

  async updatePlan(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE development_plans SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  async insertPlanItem(data: {
    planId: number;
    itemType: string;
    title: string;
    description: string | null;
    trainingId: number | null;
    dueDate: string | null;
    sortOrder: number;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO development_plan_items (plan_id, item_type, title, description, training_id, due_date, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.planId, data.itemType, data.title, data.description, data.trainingId, data.dueDate, data.sortOrder],
    );
    return Number(result.insertId);
  }

  async updatePlanItem(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE development_plan_items SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  async deletePlanItem(id: number): Promise<void> {
    await this.query('DELETE FROM development_plan_items WHERE id = ?', [id]);
  }

  /** progress = completed / total items, as a percentage stored on the plan. */
  async recomputePlanProgress(planId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS total, SUM(status = 'COMPLETED') AS completed
         FROM development_plan_items WHERE plan_id = ?`,
      [planId],
    );
    const total = Number(rows[0]?.total ?? 0);
    const completed = Number(rows[0]?.completed ?? 0);
    const progress = total > 0 ? Math.round((completed / total) * 10000) / 100 : 0;
    await this.query('UPDATE development_plans SET progress_pct = ? WHERE id = ?', [progress, planId]);
    return progress;
  }

  async trainingExists(id: number): Promise<boolean> {
    const rows = await this.query<any[]>('SELECT id FROM trainings WHERE id = ? AND deleted_at IS NULL', [id]);
    return rows.length > 0;
  }

  async findEmployeeById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT id, emp_code, full_name, grade, work_status FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  // ==========================================================================
  // PIPs
  // ==========================================================================

  private readonly pipSelect = `
    SELECT p.*, e.full_name AS employee_name, e.emp_code
      FROM pips p
      JOIN employees e ON e.id = p.employee_id
     WHERE p.deleted_at IS NULL`;

  async findPips(filters: { status?: string; employeeId?: number }): Promise<any[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.status) { where.push('p.status = ?'); params.push(filters.status); }
    if (filters.employeeId) { where.push('p.employee_id = ?'); params.push(filters.employeeId); }
    const whereSql = where.length ? ` AND ${where.join(' AND ')}` : '';
    return this.query<any[]>(`${this.pipSelect}${whereSql} ORDER BY p.id DESC LIMIT 500`, params);
  }

  async findPipById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${this.pipSelect} AND p.id = ?`, [id]);
    return rows[0] ?? null;
  }

  async findPipObjectives(pipId: number): Promise<any[]> {
    return this.query<any[]>(
      'SELECT * FROM pip_objectives WHERE pip_id = ? ORDER BY sort_order ASC, id ASC',
      [pipId],
    );
  }

  async findPipObjectiveById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM pip_objectives WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async findPipReviews(pipId: number): Promise<any[]> {
    return this.query<any[]>(
      'SELECT * FROM pip_reviews WHERE pip_id = ? ORDER BY review_date ASC, id ASC',
      [pipId],
    );
  }

  /** A PIP is created with its objectives atomically. */
  async insertPip(
    data: {
      employeeId: number;
      cycleId: number | null;
      reason: string;
      startDate: string;
      endDate: string;
      status: string;
      openedBy: number;
    },
    objectives: { objective: string; successCriteria: string | null; sortOrder: number }[],
  ): Promise<number> {
    return this.transaction(async (conn) => {
      const [result]: any = await conn.execute(
        `INSERT INTO pips (employee_id, cycle_id, reason, start_date, end_date, status, opened_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [data.employeeId, data.cycleId, data.reason, data.startDate, data.endDate, data.status, data.openedBy],
      );
      const pipId = Number(result.insertId);
      for (const obj of objectives) {
        await conn.execute(
          'INSERT INTO pip_objectives (pip_id, objective, success_criteria, sort_order) VALUES (?, ?, ?, ?)',
          [pipId, obj.objective, obj.successCriteria, obj.sortOrder],
        );
      }
      return pipId;
    });
  }

  async updatePip(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE pips SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  async insertPipObjective(data: {
    pipId: number;
    objective: string;
    successCriteria: string | null;
    sortOrder: number;
  }): Promise<number> {
    const result: any = await this.query(
      'INSERT INTO pip_objectives (pip_id, objective, success_criteria, sort_order) VALUES (?, ?, ?, ?)',
      [data.pipId, data.objective, data.successCriteria, data.sortOrder],
    );
    return Number(result.insertId);
  }

  async updatePipObjective(id: number, status: string): Promise<void> {
    await this.query('UPDATE pip_objectives SET status = ? WHERE id = ?', [status, id]);
  }

  async insertPipReview(data: {
    pipId: number;
    reviewDate: string;
    progress: string;
    summary: string | null;
    nextSteps: string | null;
    createdBy: number;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO pip_reviews (pip_id, review_date, progress, summary, next_steps, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.pipId, data.reviewDate, data.progress, data.summary, data.nextSteps, data.createdBy],
    );
    return Number(result.insertId);
  }
}
