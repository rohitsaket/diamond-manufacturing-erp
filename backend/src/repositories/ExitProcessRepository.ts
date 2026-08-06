import { BaseRepository } from './BaseRepository';

/**
 * Every offboarding leg that hangs off a separation case: exit interviews,
 * the exit survey, departmental clearances and their tasks, asset returns
 * (with the real asset-module handshake), knowledge-transfer plans and the
 * access-revocation checklist.
 */
export class ExitProcessRepository extends BaseRepository {
  // ==========================================================================
  // Exit interviews
  // ==========================================================================

  async findInterviews(filters: { separationId?: number; status?: string; limit?: number }): Promise<any[]> {
    const where: string[] = ['i.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.separationId) {
      where.push('i.separation_id = ?');
      params.push(filters.separationId);
    }
    if (filters.status) {
      where.push('i.status = ?');
      params.push(filters.status);
    }
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 200), 1), 1000);
    return this.query<any[]>(
      `SELECT i.*, e.full_name AS employee_name, u.name AS interviewer_name
         FROM exit_interviews i
         JOIN separations s ON s.id = i.separation_id
         JOIN employees e ON e.id = s.employee_id
         LEFT JOIN users u ON u.id = i.interviewer_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY i.id DESC
        LIMIT ${limit}`,
      params,
    );
  }

  async findInterviewById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT i.*, s.employee_id, s.sep_code, e.full_name AS employee_name, u.name AS interviewer_name
         FROM exit_interviews i
         JOIN separations s ON s.id = i.separation_id
         JOIN employees e ON e.id = s.employee_id
         LEFT JOIN users u ON u.id = i.interviewer_user_id
        WHERE i.id = ? AND i.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async updateInterview(id: number, fields: Record<string, any>): Promise<void> {
    const cols = Object.keys(fields);
    if (cols.length === 0) return;
    await this.query(
      `UPDATE exit_interviews SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => fields[c]), id],
    );
  }

  // ==========================================================================
  // Exit survey
  // ==========================================================================

  async findSurveyQuestions(activeOnly: boolean): Promise<any[]> {
    return this.query<any[]>(
      `SELECT * FROM exit_survey_questions
        WHERE deleted_at IS NULL ${activeOnly ? 'AND is_active = 1' : ''}
        ORDER BY sort_order ASC, id ASC`,
    );
  }

  async findSurveyQuestionById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM exit_survey_questions WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  async insertSurveyQuestion(fields: Record<string, any>): Promise<number> {
    const cols = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO exit_survey_questions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => fields[c]),
    );
    return Number(result.insertId);
  }

  async updateSurveyQuestion(id: number, fields: Record<string, any>): Promise<void> {
    const cols = Object.keys(fields);
    if (cols.length === 0) return;
    await this.query(
      `UPDATE exit_survey_questions SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => fields[c]), id],
    );
  }

  /**
   * One transaction stores every answer of a submission. For anonymous
   * submissions separation_id arrives as NULL and only department + tenure
   * band are retained - the caller also stamps a SURVEY_SUBMITTED event on
   * the case so double-submits stay blocked without a person link.
   */
  async insertSurveyResponses(rows: {
    separationId: number | null;
    departmentId: number | null;
    tenureBand: string | null;
    questionId: number;
    responseText: string | null;
    rating: number | null;
    choice: string | null;
  }[]): Promise<void> {
    await this.transaction(async (conn) => {
      for (const r of rows) {
        await conn.execute(
          `INSERT INTO exit_survey_responses
             (separation_id, department_id, tenure_band, question_id, response_text, rating, choice)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [r.separationId, r.departmentId, r.tenureBand, r.questionId, r.responseText, r.rating, r.choice],
        );
      }
    });
  }

  /** Non-anonymous double-submit check: answers already linked to the case. */
  async hasSurveyResponses(separationId: number): Promise<boolean> {
    const rows = await this.query<any[]>(
      'SELECT id FROM exit_survey_responses WHERE separation_id = ? LIMIT 1',
      [separationId],
    );
    return rows.length > 0;
  }

  async findSurveyResponses(questionId?: number): Promise<any[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (questionId) {
      where.push('r.question_id = ?');
      params.push(questionId);
    }
    return this.query<any[]>(
      `SELECT r.*, d.name AS department_name
         FROM exit_survey_responses r
         LEFT JOIN departments d ON d.id = r.department_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY r.question_id ASC, r.id ASC`,
      params,
    );
  }

  // ==========================================================================
  // Clearances and their tasks
  // ==========================================================================

  async findClearances(filters: { separationId?: number; department?: string; status?: string; limit?: number }): Promise<any[]> {
    const where: string[] = ['1=1'];
    const params: any[] = [];
    if (filters.separationId) {
      where.push('c.separation_id = ?');
      params.push(filters.separationId);
    }
    if (filters.department) {
      where.push('c.department = ?');
      params.push(filters.department);
    }
    if (filters.status) {
      where.push('c.status = ?');
      params.push(filters.status);
    }
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 500), 1), 2000);
    return this.query<any[]>(
      `SELECT c.*, u.name AS cleared_by_name, s.sep_code, e.full_name AS employee_name
         FROM clearances c
         JOIN separations s ON s.id = c.separation_id
         JOIN employees e ON e.id = s.employee_id
         LEFT JOIN users u ON u.id = c.cleared_by
        WHERE ${where.join(' AND ')}
        ORDER BY c.separation_id DESC, c.sort_order ASC
        LIMIT ${limit}`,
      params,
    );
  }

  async findClearanceById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT c.*, u.name AS cleared_by_name, s.status AS case_status, s.last_working_day, s.employee_id, s.sep_code
         FROM clearances c
         JOIN separations s ON s.id = c.separation_id
         LEFT JOIN users u ON u.id = c.cleared_by
        WHERE c.id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async updateClearance(id: number, fields: Record<string, any>): Promise<void> {
    const cols = Object.keys(fields);
    if (cols.length === 0) return;
    await this.query(
      `UPDATE clearances SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => fields[c]), id],
    );
  }

  async findTasks(clearanceId: number): Promise<any[]> {
    return this.query<any[]>(
      'SELECT * FROM clearance_tasks WHERE clearance_id = ? ORDER BY sort_order ASC, id ASC',
      [clearanceId],
    );
  }

  async findTasksForClearances(clearanceIds: number[]): Promise<any[]> {
    if (clearanceIds.length === 0) return [];
    const placeholders = clearanceIds.map(() => '?').join(', ');
    return this.query<any[]>(
      `SELECT * FROM clearance_tasks WHERE clearance_id IN (${placeholders}) ORDER BY sort_order ASC, id ASC`,
      clearanceIds,
    );
  }

  async findTaskById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM clearance_tasks WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async updateTask(id: number, fields: Record<string, any>): Promise<void> {
    const cols = Object.keys(fields);
    if (cols.length === 0) return;
    await this.query(
      `UPDATE clearance_tasks SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => fields[c]), id],
    );
  }

  async insertTask(clearanceId: number, task: string, sortOrder: number): Promise<number> {
    const result: any = await this.query(
      'INSERT INTO clearance_tasks (clearance_id, task, status, sort_order) VALUES (?, ?, \'PENDING\', ?)',
      [clearanceId, task, sortOrder],
    );
    return Number(result.insertId);
  }

  /** Tasks that still block a CLEARED verdict (neither DONE nor NA). */
  async findPendingTasks(clearanceId: number): Promise<any[]> {
    return this.query<any[]>(
      'SELECT id, task, status FROM clearance_tasks WHERE clearance_id = ? AND status = \'PENDING\'',
      [clearanceId],
    );
  }

  async countUnclearedClearances(separationId: number): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT COUNT(*) AS open_count FROM clearances WHERE separation_id = ? AND status <> \'CLEARED\'',
      [separationId],
    );
    return Number(rows[0]?.open_count ?? 0);
  }

  // ==========================================================================
  // Asset returns
  // ==========================================================================

  async findAssetReturns(filters: { separationId?: number; limit?: number }): Promise<any[]> {
    const where: string[] = ['1=1'];
    const params: any[] = [];
    if (filters.separationId) {
      where.push('r.separation_id = ?');
      params.push(filters.separationId);
    }
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 500), 1), 2000);
    return this.query<any[]>(
      `SELECT r.*, aa.assigned_on, aa.asset_id, a.name AS asset_name, a.asset_code AS asset_tag, a.category AS asset_category
         FROM asset_returns r
         JOIN asset_assignments aa ON aa.id = r.asset_assignment_id
         JOIN assets a ON a.id = aa.asset_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.id ASC
        LIMIT ${limit}`,
      params,
    );
  }

  async findAssetReturnById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT r.*, aa.asset_id, aa.returned_on AS assignment_returned_on, a.name AS asset_name, a.asset_code AS asset_tag, a.category AS asset_category
         FROM asset_returns r
         JOIN asset_assignments aa ON aa.id = r.asset_assignment_id
         JOIN assets a ON a.id = aa.asset_id
        WHERE r.id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Verifying a return is the real asset-module integration, in one
   * transaction: the return row is stamped, the open assignment is closed
   * (returned_on + condition_note) and the asset's own status follows the
   * condition (GOOD -> AVAILABLE, DAMAGED -> REPAIR, LOST -> RETIRED).
   */
  async verifyAssetReturn(args: {
    returnId: number;
    assetAssignmentId: number;
    assetId: number;
    returnCondition: string;
    damageNote: string | null;
    damageCharge: number | null;
    verifiedBy: number;
    returnedOn: string;
  }): Promise<void> {
    const assetStatus =
      args.returnCondition === 'GOOD' ? 'AVAILABLE' : args.returnCondition === 'DAMAGED' ? 'REPAIR' : 'RETIRED';
    await this.transaction(async (conn) => {
      await conn.execute(
        `UPDATE asset_returns
            SET return_condition = ?, damage_note = ?, damage_charge = ?, returned_at = NOW(), verified_by = ?
          WHERE id = ?`,
        [args.returnCondition, args.damageNote, args.damageCharge, args.verifiedBy, args.returnId],
      );
      await conn.execute(
        'UPDATE asset_assignments SET returned_on = ?, condition_note = ? WHERE id = ?',
        [args.returnedOn, args.damageNote ?? `Returned ${args.returnCondition} on exit`, args.assetAssignmentId],
      );
      await conn.execute(
        'UPDATE assets SET status = ?, updated_by = ? WHERE id = ?',
        [assetStatus, args.verifiedBy, args.assetId],
      );
    });
  }

  // ==========================================================================
  // Knowledge transfer
  // ==========================================================================

  async findKtPlanBySeparation(separationId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT p.*, e.full_name AS employee_name, se.full_name AS successor_name
         FROM kt_plans p
         JOIN separations s ON s.id = p.separation_id
         JOIN employees e ON e.id = s.employee_id
         LEFT JOIN employees se ON se.id = p.successor_employee_id
        WHERE p.separation_id = ?`,
      [separationId],
    );
    return rows[0] ?? null;
  }

  async findKtPlanById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT p.*, e.full_name AS employee_name, se.full_name AS successor_name
         FROM kt_plans p
         JOIN separations s ON s.id = p.separation_id
         JOIN employees e ON e.id = s.employee_id
         LEFT JOIN employees se ON se.id = p.successor_employee_id
        WHERE p.id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async updateKtPlan(id: number, fields: Record<string, any>): Promise<void> {
    const cols = Object.keys(fields);
    if (cols.length === 0) return;
    await this.query(
      `UPDATE kt_plans SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => fields[c]), id],
    );
  }

  async findKtItems(planId: number): Promise<any[]> {
    return this.query<any[]>(
      'SELECT * FROM kt_items WHERE plan_id = ? ORDER BY sort_order ASC, id ASC',
      [planId],
    );
  }

  async findKtItemById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM kt_items WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async insertKtItem(fields: Record<string, any>): Promise<number> {
    const cols = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO kt_items (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => fields[c]),
    );
    return Number(result.insertId);
  }

  async updateKtItem(id: number, fields: Record<string, any>): Promise<void> {
    const cols = Object.keys(fields);
    if (cols.length === 0) return;
    await this.query(
      `UPDATE kt_items SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => fields[c]), id],
    );
  }

  async deleteKtItem(id: number): Promise<void> {
    await this.query('DELETE FROM kt_items WHERE id = ?', [id]);
  }

  async countPendingKtItems(planId: number): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT COUNT(*) AS pending FROM kt_items WHERE plan_id = ? AND status <> \'DONE\'',
      [planId],
    );
    return Number(rows[0]?.pending ?? 0);
  }

  // ==========================================================================
  // Access revocations
  // ==========================================================================

  async findAccessRevocations(filters: { separationId?: number; limit?: number }): Promise<any[]> {
    const where: string[] = ['1=1'];
    const params: any[] = [];
    if (filters.separationId) {
      where.push('ar.separation_id = ?');
      params.push(filters.separationId);
    }
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 500), 1), 2000);
    return this.query<any[]>(
      `SELECT ar.*, u.name AS revoked_by_name
         FROM access_revocations ar
         LEFT JOIN users u ON u.id = ar.revoked_by
        WHERE ${where.join(' AND ')}
        ORDER BY ar.separation_id DESC, ar.is_internal DESC, ar.id ASC
        LIMIT ${limit}`,
      params,
    );
  }

  async findAccessRevocationById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT ar.*, s.status AS case_status, s.employee_id
         FROM access_revocations ar
         JOIN separations s ON s.id = ar.separation_id
        WHERE ar.id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async updateAccessRevocation(id: number, fields: Record<string, any>): Promise<void> {
    const cols = Object.keys(fields);
    if (cols.length === 0) return;
    await this.query(
      `UPDATE access_revocations SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => fields[c]), id],
    );
  }

  /**
   * The HRMS Login row is the one revocation this system can truly perform:
   * marking it REVOKED deactivates the linked user account in the same
   * transaction.
   */
  async revokeHrmsLogin(args: { revocationId: number; employeeId: number; note: string | null; revokedBy: number }): Promise<void> {
    await this.transaction(async (conn) => {
      await conn.execute(
        'UPDATE access_revocations SET status = \'REVOKED\', note = ?, revoked_by = ?, revoked_at = NOW() WHERE id = ?',
        [args.note, args.revokedBy, args.revocationId],
      );
      await conn.execute('UPDATE users SET is_active = 0 WHERE employee_id = ?', [args.employeeId]);
    });
  }

  // ==========================================================================
  // Reminders
  // ==========================================================================

  /** Live cases with anything still pending, plus who to nudge. */
  async findCasesNeedingReminders(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT s.id, s.sep_code, s.employee_id, s.status, s.last_working_day,
              e.full_name AS employee_name, e.emp_code,
              (SELECT COUNT(*) FROM clearances c WHERE c.separation_id = s.id AND c.status NOT IN ('CLEARED')) AS pending_clearances,
              (SELECT COUNT(*) FROM asset_returns ar WHERE ar.separation_id = s.id AND ar.returned_at IS NULL) AS pending_assets,
              (SELECT COUNT(*) FROM exit_interviews i WHERE i.separation_id = s.id AND i.deleted_at IS NULL AND i.status IN ('PENDING', 'SCHEDULED')) AS pending_interviews
         FROM separations s
         JOIN employees e ON e.id = s.employee_id
        WHERE s.deleted_at IS NULL AND s.status IN ('IN_NOTICE', 'CLEARANCE')
        ORDER BY s.last_working_day ASC`,
    );
  }
}
