import { BaseRepository } from './BaseRepository';

/** Assessment catalogue and recorded results for internal applications. */
export class AssessmentRepository extends BaseRepository {
  async findAll(): Promise<any[]> {
    return this.query<any[]>(
      'SELECT * FROM assessments WHERE deleted_at IS NULL ORDER BY assessment_type, name',
    );
  }

  async findById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM assessments WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  async findByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM assessments WHERE code = ? AND deleted_at IS NULL',
      [code],
    );
    return rows[0] ?? null;
  }

  async insert(data: any, userId: number): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO assessments (code, name, assessment_type, description, max_score, pass_score, duration_minutes, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code, data.name, data.assessmentType, data.description ?? null,
        data.maxScore ?? 100, data.passScore ?? null, data.durationMinutes ?? null,
        data.isActive !== false, userId,
      ],
    );
    return Number(result.insertId);
  }

  async update(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE assessments SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  async findApplication(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT a.*, e.full_name AS employee_name
         FROM internal_applications a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.id = ? AND a.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findPendingResult(assessmentId: number, applicationId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM assessment_results WHERE assessment_id = ? AND application_id = ? LIMIT 1',
      [assessmentId, applicationId],
    );
    return rows[0] ?? null;
  }

  /**
   * Creates the PENDING result and moves the application to ASSESSMENT (with
   * its stage event) in one transaction.
   */
  async assign(
    data: { assessmentId: number; applicationId: number; employeeId: number },
    transitionFrom: string | null,
    userId: number,
  ): Promise<number> {
    return this.transaction(async (conn) => {
      const [result]: any = await conn.execute(
        `INSERT INTO assessment_results (assessment_id, application_id, employee_id, result)
         VALUES (?, ?, ?, 'PENDING')`,
        [data.assessmentId, data.applicationId, data.employeeId],
      );
      if (transitionFrom !== null) {
        await conn.execute(
          "UPDATE internal_applications SET status = 'ASSESSMENT' WHERE id = ?",
          [data.applicationId],
        );
        await conn.execute(
          `INSERT INTO application_stage_events (application_id, from_status, to_status, note, created_by)
           VALUES (?, ?, 'ASSESSMENT', 'Assessment assigned', ?)`,
          [data.applicationId, transitionFrom, userId],
        );
      }
      return Number(result.insertId);
    });
  }

  async findResultById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT r.*, s.name AS assessment_name, s.max_score, s.pass_score, e.full_name AS employee_name
         FROM assessment_results r
         JOIN assessments s ON s.id = r.assessment_id
         JOIN employees e ON e.id = r.employee_id
        WHERE r.id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async updateResult(id: number, score: number | null, result: string, notes: string | null, userId: number): Promise<void> {
    await this.query(
      'UPDATE assessment_results SET score = ?, result = ?, notes = ?, assessed_by = ?, assessed_at = NOW() WHERE id = ?',
      [score, result, notes, userId, id],
    );
  }

  async findResults(filters: { applicationId?: number; employeeId?: number }): Promise<any[]> {
    const where: string[] = ['1=1'];
    const params: any[] = [];
    if (filters.applicationId) { where.push('r.application_id = ?'); params.push(filters.applicationId); }
    if (filters.employeeId) { where.push('r.employee_id = ?'); params.push(filters.employeeId); }
    return this.query<any[]>(
      `SELECT r.*, s.name AS assessment_name, s.code AS assessment_code, s.max_score, s.pass_score,
              e.full_name AS employee_name
         FROM assessment_results r
         JOIN assessments s ON s.id = r.assessment_id
         JOIN employees e ON e.id = r.employee_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.id DESC
        LIMIT 500`,
      params,
    );
  }
}
