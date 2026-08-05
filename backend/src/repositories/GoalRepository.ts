import { BaseRepository } from './BaseRepository';

export interface GoalFilters {
  cycleId?: number;
  scope?: string;
  kind?: string;
  status?: string;
  employeeId?: number;
  departmentId?: number;
  teamId?: number;
  search?: string;
  limit?: number;
}

const GOAL_SELECT = `SELECT g.*, e.full_name AS employee_name, t.name AS team_name, d.name AS department_name
    FROM perf_goals g
    LEFT JOIN employees e ON e.id = g.employee_id
    LEFT JOIN teams t ON t.id = g.team_id
    LEFT JOIN departments d ON d.id = g.department_id`;

/**
 * Data access for goals/OKRs (`perf_goals`), their milestones, the append-only
 * `goal_updates` history and `goal_templates`.
 */
export class GoalRepository extends BaseRepository {
  async findAll(filters: GoalFilters): Promise<any[]> {
    const where: string[] = ['g.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.cycleId) {
      where.push('g.cycle_id = ?');
      params.push(filters.cycleId);
    }
    if (filters.scope) {
      where.push('g.scope = ?');
      params.push(filters.scope);
    }
    if (filters.kind) {
      where.push('g.kind = ?');
      params.push(filters.kind);
    }
    if (filters.status) {
      where.push('g.status = ?');
      params.push(filters.status);
    }
    if (filters.employeeId) {
      where.push('g.employee_id = ?');
      params.push(filters.employeeId);
    }
    if (filters.departmentId) {
      where.push('g.department_id = ?');
      params.push(filters.departmentId);
    }
    if (filters.teamId) {
      where.push('g.team_id = ?');
      params.push(filters.teamId);
    }
    if (filters.search) {
      where.push('g.title LIKE ?');
      params.push(`%${filters.search}%`);
    }
    // LIMIT cannot be bound in this stack; inline the sanitized number.
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 500), 1), 2000);
    return this.query<any[]>(
      `${GOAL_SELECT} WHERE ${where.join(' AND ')} ORDER BY g.id ASC LIMIT ${limit}`,
      params,
    );
  }

  async findById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${GOAL_SELECT} WHERE g.id = ? AND g.deleted_at IS NULL`, [id]);
    return rows[0] ?? null;
  }

  /** Every live goal of one cycle — the tree endpoint assembles these in JS. */
  async findByCycle(cycleId: number): Promise<any[]> {
    return this.query<any[]>(
      `${GOAL_SELECT} WHERE g.cycle_id = ? AND g.deleted_at IS NULL ORDER BY g.id ASC`,
      [cycleId],
    );
  }

  async findChildren(parentGoalId: number): Promise<any[]> {
    return this.query<any[]>(
      `${GOAL_SELECT} WHERE g.parent_goal_id = ? AND g.deleted_at IS NULL ORDER BY g.id ASC`,
      [parentGoalId],
    );
  }

  async insert(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO perf_goals (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }

  async update(id: number, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    await this.query(
      `UPDATE perf_goals SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...keys.map((k) => fields[k]), id],
    );
  }

  async softDelete(id: number): Promise<void> {
    await this.query('UPDATE perf_goals SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL', [id]);
  }

  /**
   * Total weightage of an employee's ACTIVE + PENDING_APPROVAL goals for a
   * cycle; the 100% budget these two statuses share.
   */
  async weightageTotal(cycleId: number, employeeId: number, excludeGoalId?: number): Promise<number> {
    const params: any[] = [cycleId, employeeId];
    let excludeSql = '';
    if (excludeGoalId) {
      excludeSql = ' AND id != ?';
      params.push(excludeGoalId);
    }
    const rows = await this.query<any[]>(
      `SELECT COALESCE(SUM(weightage_pct), 0) AS total FROM perf_goals
        WHERE cycle_id = ? AND employee_id = ? AND deleted_at IS NULL
          AND status IN ('ACTIVE', 'PENDING_APPROVAL')${excludeSql}`,
      params,
    );
    return Number(rows[0]?.total ?? 0);
  }

  async titleExists(cycleId: number, employeeId: number, title: string): Promise<boolean> {
    const rows = await this.query<any[]>(
      'SELECT id FROM perf_goals WHERE cycle_id = ? AND employee_id = ? AND title = ? AND deleted_at IS NULL LIMIT 1',
      [cycleId, employeeId, title],
    );
    return rows.length > 0;
  }

  // ==========================================================================
  // Updates (append-only history)
  // ==========================================================================

  async insertUpdate(
    goalId: number,
    updateType: string,
    progressPct: number | null,
    currentValue: number | null,
    note: string | null,
    createdBy: number | null,
  ): Promise<void> {
    await this.query(
      `INSERT INTO goal_updates (goal_id, update_type, progress_pct, current_value, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [goalId, updateType, progressPct, currentValue, note, createdBy],
    );
  }

  async findUpdates(goalId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT gu.*, u.name AS actor_name
         FROM goal_updates gu
         LEFT JOIN users u ON u.id = gu.created_by
        WHERE gu.goal_id = ?
        ORDER BY gu.id DESC`,
      [goalId],
    );
  }

  // ==========================================================================
  // Milestones
  // ==========================================================================

  async findMilestones(goalId: number): Promise<any[]> {
    return this.query<any[]>(
      'SELECT * FROM goal_milestones WHERE goal_id = ? ORDER BY sort_order ASC, id ASC',
      [goalId],
    );
  }

  async findMilestoneById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM goal_milestones WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async insertMilestone(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO goal_milestones (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }

  async updateMilestone(id: number, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    await this.query(
      `UPDATE goal_milestones SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
      [...keys.map((k) => fields[k]), id],
    );
  }

  async deleteMilestone(id: number): Promise<void> {
    await this.query('DELETE FROM goal_milestones WHERE id = ?', [id]);
  }

  // ==========================================================================
  // Templates
  // ==========================================================================

  async findTemplates(): Promise<any[]> {
    return this.query<any[]>('SELECT * FROM goal_templates WHERE deleted_at IS NULL ORDER BY id ASC');
  }

  async findTemplateById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM goal_templates WHERE id = ? AND deleted_at IS NULL', [id]);
    return rows[0] ?? null;
  }

  async findTemplateByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM goal_templates WHERE code = ? AND deleted_at IS NULL', [code]);
    return rows[0] ?? null;
  }

  async insertTemplate(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO goal_templates (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }

  async updateTemplate(id: number, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    await this.query(
      `UPDATE goal_templates SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...keys.map((k) => fields[k]), id],
    );
  }

  // ==========================================================================
  // Cross-table lookups the goal service needs
  // ==========================================================================

  async findEmployeesByIds(ids: number[]): Promise<any[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    return this.query<any[]>(
      `SELECT id, full_name, work_status FROM employees WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      ids,
    );
  }
}
