import { BaseRepository } from './BaseRepository';

/**
 * Alumni registry, rehire reviews and boomerang tracking.
 * The directory is internal-only: there is no external alumni portal.
 */
export class AlumniRepository extends BaseRepository {
  private readonly joinedSelect = `
    SELECT a.*, e.emp_code, e.full_name, e.grade AS employee_grade, e.worker_type,
           e.joined_at, s.sep_code, s.separation_type
      FROM alumni a
      JOIN employees e ON e.id = a.employee_id
      LEFT JOIN separations s ON s.id = a.separation_id`;

  async findById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `${this.joinedSelect} WHERE a.id = ? AND a.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findMany(filters: { rehireEligible?: boolean; search?: string; limit?: number }): Promise<any[]> {
    const where: string[] = ['a.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.rehireEligible !== undefined) {
      where.push('a.rehire_eligible = ?');
      params.push(filters.rehireEligible ? 1 : 0);
    }
    if (filters.search) {
      where.push('(e.full_name LIKE ? OR e.emp_code LIKE ?)');
      const like = `%${filters.search}%`;
      params.push(like, like);
    }
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 200), 1), 1000);
    return this.query<any[]>(
      `${this.joinedSelect} WHERE ${where.join(' AND ')} ORDER BY a.exit_date DESC, a.id DESC LIMIT ${limit}`,
      params,
    );
  }

  async updateContact(
    id: number,
    fields: { contactEmail?: string | null; contactPhone?: string | null; inAlumniNetwork?: boolean; notes?: string | null },
  ): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (fields.contactEmail !== undefined) {
      sets.push('contact_email = ?');
      params.push(fields.contactEmail);
    }
    if (fields.contactPhone !== undefined) {
      sets.push('contact_phone = ?');
      params.push(fields.contactPhone);
    }
    if (fields.inAlumniNetwork !== undefined) {
      sets.push('in_alumni_network = ?');
      params.push(fields.inAlumniNetwork ? 1 : 0);
    }
    if (fields.notes !== undefined) {
      sets.push('notes = ?');
      params.push(fields.notes);
    }
    if (sets.length === 0) return;
    params.push(id);
    await this.query(`UPDATE alumni SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params);
  }

  // ---------------------------------------------------------------------------
  // Rehire reviews
  // ---------------------------------------------------------------------------

  async insertReview(alumniId: number, decision: string, reason: string | null, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO rehire_reviews (alumni_id, decision, reason, decided_by) VALUES (?, ?, ?, ?)`,
      [alumniId, decision, reason, userId],
    );
    return Number(result.insertId);
  }

  async findLatestReview(alumniId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT r.*, u.name AS decided_by_name
         FROM rehire_reviews r
         LEFT JOIN users u ON u.id = r.decided_by
        WHERE r.alumni_id = ?
        ORDER BY r.id DESC LIMIT 1`,
      [alumniId],
    );
    return rows[0] ?? null;
  }

  async findReviews(alumniId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT r.*, u.name AS decided_by_name
         FROM rehire_reviews r
         LEFT JOIN users u ON u.id = r.decided_by
        WHERE r.alumni_id = ?
        ORDER BY r.id DESC`,
      [alumniId],
    );
  }

  /** Sync the registry flags with the latest explicit decision. */
  async syncRehireDecision(alumniId: number, eligible: boolean, restrictionNote: string | null): Promise<void> {
    await this.query(
      `UPDATE alumni SET rehire_eligible = ?, rehire_restriction_note = ? WHERE id = ? AND deleted_at IS NULL`,
      [eligible ? 1 : 0, restrictionNote, alumniId],
    );
  }

  async markBoomerang(alumniId: number, rehiredEmployeeId: number, rehiredAt: string): Promise<void> {
    await this.query(
      `UPDATE alumni SET is_boomerang = 1, rehired_employee_id = ?, rehired_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [rehiredEmployeeId, rehiredAt, alumniId],
    );
  }

  // ---------------------------------------------------------------------------
  // Previous-employment context
  // ---------------------------------------------------------------------------

  async findTimelineEvents(employeeId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT id, event_type, event_date, title, details, from_value, to_value
         FROM employee_timeline
        WHERE employee_id = ? AND deleted_at IS NULL
        ORDER BY event_date DESC, id DESC
        LIMIT 100`,
      [employeeId],
    );
  }

  async findSeparationHistory(employeeId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT id, sep_code, separation_type, status, resignation_date, last_working_day, reason, completed_at
         FROM separations
        WHERE employee_id = ? AND deleted_at IS NULL
        ORDER BY id DESC`,
      [employeeId],
    );
  }

  async findEmployee(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT id, emp_code, full_name, work_status FROM employees WHERE id = ? AND deleted_at IS NULL`,
      [employeeId],
    );
    return rows[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  async stats(): Promise<{ total: number; rehireEligible: number; boomerangs: number; inNetwork: number }> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN rehire_eligible = 1 THEN 1 ELSE 0 END), 0) AS rehire_eligible,
              COALESCE(SUM(CASE WHEN is_boomerang = 1 THEN 1 ELSE 0 END), 0) AS boomerangs,
              COALESCE(SUM(CASE WHEN in_alumni_network = 1 THEN 1 ELSE 0 END), 0) AS in_network
         FROM alumni
        WHERE deleted_at IS NULL`,
    );
    const row = rows[0] ?? {};
    return {
      total: Number(row.total ?? 0),
      rehireEligible: Number(row.rehire_eligible ?? 0),
      boomerangs: Number(row.boomerangs ?? 0),
      inNetwork: Number(row.in_network ?? 0),
    };
  }
}
