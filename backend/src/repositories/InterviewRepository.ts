import { BaseRepository } from './BaseRepository';

/**
 * Interview rounds and per-interviewer feedback for internal applications.
 * Scheduling the first round of an application moves the application to
 * INTERVIEW inside the same transaction that inserts the round.
 */
export class InterviewRepository extends BaseRepository {
  /** Application row joined with its job and applicant, for validation and display. */
  async findApplicationById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT a.*, j.title AS job_title, j.job_code, j.openings, j.requisition_id,
              e.full_name AS employee_name, e.emp_code
         FROM internal_applications a
         JOIN internal_jobs j ON j.id = a.job_id
         JOIN employees e ON e.id = a.employee_id
        WHERE a.id = ? AND a.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async nextRoundNo(applicationId: number): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT COALESCE(MAX(round_no), 0) + 1 AS next_no FROM interview_rounds WHERE application_id = ? AND deleted_at IS NULL',
      [applicationId],
    );
    return Number(rows[0]?.next_no ?? 1);
  }

  /**
   * Inserts the round and, when `transitionFrom` is given, moves the
   * application to INTERVIEW with its stage event in the same transaction.
   */
  async insertRound(
    data: {
      applicationId: number;
      roundNo: number;
      roundType: string;
      scheduledAt: Date;
      durationMinutes: number;
      mode: string;
      location: string | null;
      meetingLink: string | null;
      panelJson: string | null;
      createdBy: number;
    },
    transitionFrom: string | null,
  ): Promise<number> {
    return this.transaction(async (conn) => {
      const [result]: any = await conn.execute(
        `INSERT INTO interview_rounds
           (application_id, round_no, round_type, scheduled_at, duration_minutes, mode, location, meeting_link, panel_json, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?)`,
        [
          data.applicationId, data.roundNo, data.roundType, data.scheduledAt, data.durationMinutes,
          data.mode, data.location, data.meetingLink, data.panelJson, data.createdBy,
        ],
      );
      if (transitionFrom !== null) {
        await conn.execute(
          "UPDATE internal_applications SET status = 'INTERVIEW' WHERE id = ?",
          [data.applicationId],
        );
        await conn.execute(
          `INSERT INTO application_stage_events (application_id, from_status, to_status, note, created_by)
           VALUES (?, ?, 'INTERVIEW', ?, ?)`,
          [data.applicationId, transitionFrom, `Interview round ${data.roundNo} (${data.roundType}) scheduled`, data.createdBy],
        );
      }
      return Number(result.insertId);
    });
  }

  async findRounds(filters: {
    applicationId?: number;
    status?: string;
    from?: string;
    to?: string;
    upcoming?: boolean;
  }): Promise<any[]> {
    const where: string[] = ['r.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.applicationId) { where.push('r.application_id = ?'); params.push(filters.applicationId); }
    if (filters.status) { where.push('r.status = ?'); params.push(filters.status); }
    if (filters.from) { where.push('r.scheduled_at >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('r.scheduled_at <= ?'); params.push(filters.to); }
    if (filters.upcoming) { where.push("r.scheduled_at >= NOW() AND r.status IN ('SCHEDULED', 'RESCHEDULED')"); }
    return this.query<any[]>(
      `SELECT r.*, j.title AS job_title, e.full_name AS applicant_name, e.emp_code
         FROM interview_rounds r
         JOIN internal_applications a ON a.id = r.application_id
         JOIN internal_jobs j ON j.id = a.job_id
         JOIN employees e ON e.id = a.employee_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.scheduled_at ASC, r.id ASC
        LIMIT 500`,
      params,
    );
  }

  async findRoundById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT r.*, j.title AS job_title, e.full_name AS applicant_name, e.emp_code,
              a.employee_id AS applicant_employee_id, a.status AS application_status
         FROM interview_rounds r
         JOIN internal_applications a ON a.id = r.application_id
         JOIN internal_jobs j ON j.id = a.job_id
         JOIN employees e ON e.id = a.employee_id
        WHERE r.id = ? AND r.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async updateRound(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE interview_rounds SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  // ==========================================================================
  // Feedback (one row per interviewer per round)
  // ==========================================================================

  async findFeedbackByRound(roundId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT f.*, COALESCE(e.full_name, u.name) AS interviewer_name
         FROM interview_feedback f
         LEFT JOIN employees e ON e.id = f.interviewer_employee_id
         LEFT JOIN users u ON u.id = f.interviewer_user_id
        WHERE f.round_id = ?
        ORDER BY f.id ASC`,
      [roundId],
    );
  }

  async findFeedbackByRoundAndUser(roundId: number, userId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM interview_feedback WHERE round_id = ? AND interviewer_user_id = ? LIMIT 1',
      [roundId, userId],
    );
    return rows[0] ?? null;
  }

  async insertFeedback(data: {
    roundId: number;
    interviewerEmployeeId: number | null;
    interviewerUserId: number;
    scorecardJson: string | null;
    overallScore: number | null;
    recommendation: string | null;
    comments: string | null;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO interview_feedback
         (round_id, interviewer_employee_id, interviewer_user_id, scorecard_json, overall_score, recommendation, comments, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        data.roundId, data.interviewerEmployeeId, data.interviewerUserId,
        data.scorecardJson, data.overallScore, data.recommendation, data.comments,
      ],
    );
    return Number(result.insertId);
  }

  async updateFeedback(id: number, data: {
    scorecardJson: string | null;
    overallScore: number | null;
    recommendation: string | null;
    comments: string | null;
  }): Promise<void> {
    await this.query(
      `UPDATE interview_feedback
          SET scorecard_json = ?, overall_score = ?, recommendation = ?, comments = ?, submitted_at = NOW()
        WHERE id = ?`,
      [data.scorecardJson, data.overallScore, data.recommendation, data.comments, id],
    );
  }

  /** SCHEDULED/RESCHEDULED rounds starting within the next `hours` hours. */
  async findRoundsForReminders(hours: number): Promise<any[]> {
    const window = Math.min(Math.max(Math.trunc(hours), 1), 168); // LIMIT-style inlining after sanitizing
    return this.query<any[]>(
      `SELECT r.*, a.employee_id AS applicant_employee_id, e.full_name AS applicant_name, j.title AS job_title
         FROM interview_rounds r
         JOIN internal_applications a ON a.id = r.application_id
         JOIN internal_jobs j ON j.id = a.job_id
         JOIN employees e ON e.id = a.employee_id
        WHERE r.deleted_at IS NULL
          AND r.status IN ('SCHEDULED', 'RESCHEDULED')
          AND r.scheduled_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ${window} HOUR)
        ORDER BY r.scheduled_at ASC`,
    );
  }
}
