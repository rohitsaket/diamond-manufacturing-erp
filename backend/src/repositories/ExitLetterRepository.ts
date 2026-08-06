import { BaseRepository } from './BaseRepository';

/**
 * Data access for exit letters (exit_letters) plus the read-only context a
 * letter body needs: the separation, the employee, clearances, the latest
 * finalized appraisal and the settlement status.
 */
export class ExitLetterRepository extends BaseRepository {
  private readonly joinedSelect = `
    SELECT l.*, s.sep_code, s.employee_id, s.separation_type, s.status AS separation_status,
           s.resignation_date, s.notice_days, s.notice_start, s.notice_end, s.last_working_day,
           e.emp_code, e.full_name, e.grade, e.worker_type, e.joined_at,
           e.department AS department_name, e.designation
      FROM exit_letters l
      JOIN separations s ON s.id = l.separation_id
      JOIN employees e ON e.id = s.employee_id`;

  async findById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `${this.joinedSelect} WHERE l.id = ? AND l.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findByNumber(letterNumber: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      `${this.joinedSelect} WHERE l.letter_number = ? AND l.deleted_at IS NULL`,
      [letterNumber],
    );
    return rows[0] ?? null;
  }

  async findBySeparationAndType(separationId: number, letterType: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      `${this.joinedSelect} WHERE l.separation_id = ? AND l.letter_type = ? AND l.deleted_at IS NULL`,
      [separationId, letterType],
    );
    return rows[0] ?? null;
  }

  async findMany(filters: { separationId?: number; letterType?: string; status?: string; employeeId?: number; limit?: number }): Promise<any[]> {
    const where: string[] = ['l.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.separationId) {
      where.push('l.separation_id = ?');
      params.push(filters.separationId);
    }
    if (filters.letterType) {
      where.push('l.letter_type = ?');
      params.push(filters.letterType);
    }
    if (filters.status) {
      where.push('l.status = ?');
      params.push(filters.status);
    }
    if (filters.employeeId) {
      where.push('s.employee_id = ?');
      params.push(filters.employeeId);
    }
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 200), 1), 1000);
    return this.query<any[]>(
      `${this.joinedSelect} WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT ${limit}`,
      params,
    );
  }

  /** Insert with a placeholder number; the real number needs the row id. */
  async insertDraft(separationId: number, letterType: string, placeholder: string, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO exit_letters (separation_id, letter_type, letter_number, status, generated_by)
       VALUES (?, ?, ?, 'DRAFT', ?)`,
      [separationId, letterType, placeholder, userId],
    );
    return Number(result.insertId);
  }

  async finalizeIssue(id: number, letterNumber: string, verifyToken: string): Promise<void> {
    await this.query(
      `UPDATE exit_letters SET letter_number = ?, verify_token = ?, status = 'ISSUED', generated_at = NOW()
        WHERE id = ?`,
      [letterNumber, verifyToken, id],
    );
  }

  async markEmailed(id: number): Promise<void> {
    await this.query(
      `UPDATE exit_letters SET status = 'EMAILED', emailed_at = NOW(), email_error = NULL WHERE id = ?`,
      [id],
    );
  }

  async recordEmailError(id: number, error: string): Promise<void> {
    await this.query(
      `UPDATE exit_letters SET email_error = ? WHERE id = ?`,
      [error.slice(0, 500), id],
    );
  }

  async deleteRow(id: number): Promise<void> {
    // Hard delete is deliberate here: only used to clean up a draft whose
    // number assignment failed mid-generation.
    await this.query(`DELETE FROM exit_letters WHERE id = ? AND status = 'DRAFT'`, [id]);
  }

  // ---------------------------------------------------------------------------
  // Letter-body context (read-only)
  // ---------------------------------------------------------------------------

  async findSeparation(separationId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT s.*, e.emp_code, e.full_name, e.grade, e.worker_type, e.joined_at,
              e.department AS department_name, e.designation
         FROM separations s
         JOIN employees e ON e.id = s.employee_id
        WHERE s.id = ? AND s.deleted_at IS NULL`,
      [separationId],
    );
    return rows[0] ?? null;
  }

  async findClearances(separationId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT c.department, c.status, c.cleared_at, c.note, u.name AS cleared_by_name
         FROM clearances c
         LEFT JOIN users u ON u.id = c.cleared_by
        WHERE c.separation_id = ?
        ORDER BY c.sort_order ASC, c.id ASC`,
      [separationId],
    );
  }

  /** Latest finalized appraisal rating, or null — the letter must not invent one. */
  async findLatestFinalizedRating(employeeId: number): Promise<{ finalRating: number; cycleName: string | null } | null> {
    const rows = await this.query<any[]>(
      `SELECT a.final_rating, c.name AS cycle_name
         FROM appraisals a
         LEFT JOIN perf_cycles c ON c.id = a.cycle_id
        WHERE a.employee_id = ? AND a.final_rating IS NOT NULL
          AND a.status IN ('FINALIZED', 'LETTER_ISSUED', 'ACKNOWLEDGED')
        ORDER BY a.id DESC LIMIT 1`,
      [employeeId],
    );
    const row = rows[0];
    if (!row || row.final_rating === null || row.final_rating === undefined) return null;
    return { finalRating: Number(row.final_rating), cycleName: row.cycle_name ?? null };
  }

  /** The most advanced settlement on record for the employee, if any. */
  async findSettlementForEmployee(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT id, status FROM final_settlements
        WHERE employee_id = ? AND deleted_at IS NULL
        ORDER BY FIELD(status, 'PAID', 'APPROVED', 'PENDING_APPROVAL', 'CALCULATED', 'DRAFT', 'REJECTED'), id DESC
        LIMIT 1`,
      [employeeId],
    );
    return rows[0] ?? null;
  }

  async findEmployeeUser(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT id, email, name, is_active FROM users
        WHERE employee_id = ? AND deleted_at IS NULL LIMIT 1`,
      [employeeId],
    );
    return rows[0] ?? null;
  }
}
