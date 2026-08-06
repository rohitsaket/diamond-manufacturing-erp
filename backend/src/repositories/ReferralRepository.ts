import { BaseRepository } from './BaseRepository';

const REFERRAL_SELECT = `SELECT r.*,
    j.title AS job_title, j.job_code, j.grade AS job_grade,
    re.full_name AS referrer_name,
    rd.full_name AS referred_name
  FROM referrals r
  LEFT JOIN internal_jobs j ON j.id = r.job_id
  JOIN employees re ON re.id = r.referrer_employee_id
  LEFT JOIN employees rd ON rd.id = r.referred_employee_id`;

/** Data access for referrals plus the candidates bridge for external ones. */
export class ReferralRepository extends BaseRepository {
  async findAll(filters: { status?: string; limit?: number }): Promise<any[]> {
    const where: string[] = ['r.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.status) {
      where.push('r.status = ?');
      params.push(filters.status);
    }
    // LIMIT cannot be bound in this stack; inline the sanitized number.
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 500), 1), 2000);
    return this.query<any[]>(
      `${REFERRAL_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT ${limit}`,
      params,
    );
  }

  async findById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${REFERRAL_SELECT} WHERE r.id = ? AND r.deleted_at IS NULL`, [id]);
    return rows[0] ?? null;
  }

  async findMine(referrerEmployeeId: number): Promise<any[]> {
    return this.query<any[]>(
      `${REFERRAL_SELECT} WHERE r.referrer_employee_id = ? AND r.deleted_at IS NULL ORDER BY r.id DESC`,
      [referrerEmployeeId],
    );
  }

  /** The referral an application should link to, if one exists. */
  async findLinkable(jobId: number, referredEmployeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM referrals
        WHERE job_id = ? AND referred_employee_id = ? AND deleted_at IS NULL
          AND application_id IS NULL
          AND status IN ('ACCEPTED', 'SUBMITTED', 'UNDER_REVIEW')
        ORDER BY id ASC LIMIT 1`,
      [jobId, referredEmployeeId],
    );
    return rows[0] ?? null;
  }

  async findByApplicationId(applicationId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM referrals WHERE application_id = ? AND deleted_at IS NULL LIMIT 1',
      [applicationId],
    );
    return rows[0] ?? null;
  }

  /**
   * Duplicate guard for internal referrals. job_id and referred_employee_id
   * are both nullable, so there is no unique key to lean on (MySQL treats
   * NULLs as distinct) - this check-then-insert is the honest alternative.
   */
  async duplicateInternalExists(jobId: number | null, referredEmployeeId: number): Promise<boolean> {
    const rows = await this.query<any[]>(
      `SELECT id FROM referrals
        WHERE referred_employee_id = ? AND ${jobId === null ? 'job_id IS NULL' : 'job_id = ?'}
          AND deleted_at IS NULL AND status IN ('SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED')
        LIMIT 1`,
      jobId === null ? [referredEmployeeId] : [referredEmployeeId, jobId],
    );
    return rows.length > 0;
  }

  async insert(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO referrals (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }

  async update(id: number, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    await this.query(
      `UPDATE referrals SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...keys.map((k) => fields[k]), id],
    );
  }

  /** Per-referrer totals: submissions, hires, and points from HIRED rows. */
  async leaderboard(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT r.referrer_employee_id, e.full_name AS referrer_name, e.emp_code,
              COUNT(*) AS total,
              COALESCE(SUM(r.status = 'HIRED'), 0) AS hired,
              COALESCE(SUM(CASE WHEN r.status = 'HIRED' THEN r.reward_points ELSE 0 END), 0) AS total_points
         FROM referrals r
         JOIN employees e ON e.id = r.referrer_employee_id
        WHERE r.deleted_at IS NULL
        GROUP BY r.referrer_employee_id, e.full_name, e.emp_code
        ORDER BY hired DESC, total_points DESC, total DESC, r.referrer_employee_id ASC`,
    );
  }

  async findEmployeeById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT id, emp_code, full_name, grade FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  async findJobById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT id, job_code, title, grade, status FROM internal_jobs WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  /** Accepted external referrals become rows in the existing candidates pipeline. */
  async insertCandidate(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO candidates (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }
}
