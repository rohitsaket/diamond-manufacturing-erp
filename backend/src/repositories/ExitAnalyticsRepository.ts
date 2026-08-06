import { BaseRepository } from './BaseRepository';

/** Statuses that mean a case is still moving. */
const ACTIVE_CASE = `s.status NOT IN ('REJECTED', 'WITHDRAWN', 'COMPLETED', 'CANCELLED') AND s.deleted_at IS NULL`;

/**
 * Read-only aggregate queries for offboarding analytics and reports. Reads the
 * sibling stream's separation-lifecycle tables (separations, clearances,
 * asset_returns, exit_interviews, kt_plans/kt_items, exit_survey_responses)
 * with plain SQL and never writes to them.
 */
export class ExitAnalyticsRepository extends BaseRepository {
  // ---------------------------------------------------------------------------
  // Dashboard counters
  // ---------------------------------------------------------------------------

  async countSeparationsByStatus(): Promise<Record<string, number>> {
    const rows = await this.query<any[]>(
      `SELECT status, COUNT(*) AS n FROM separations s WHERE s.deleted_at IS NULL GROUP BY status`,
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.status)] = Number(r.n);
    return out;
  }

  async countActiveCases(): Promise<number> {
    const rows = await this.query<any[]>(`SELECT COUNT(*) AS n FROM separations s WHERE ${ACTIVE_CASE}`);
    return Number(rows[0]?.n ?? 0);
  }

  async countPendingClearances(): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS n
         FROM clearances c
         JOIN separations s ON s.id = c.separation_id
        WHERE c.status IN ('PENDING', 'BLOCKED') AND ${ACTIVE_CASE}`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async countPendingAssetReturns(): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS n
         FROM asset_returns ar
         JOIN separations s ON s.id = ar.separation_id
        WHERE ar.return_condition = 'PENDING' AND ${ACTIVE_CASE}`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async countPendingInterviews(): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS n
         FROM exit_interviews ei
         JOIN separations s ON s.id = ei.separation_id
        WHERE ei.deleted_at IS NULL AND ei.status IN ('PENDING', 'SCHEDULED') AND ${ACTIVE_CASE}`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async countSettlementsByStatus(): Promise<Record<string, number>> {
    const rows = await this.query<any[]>(
      `SELECT status, COUNT(*) AS n FROM final_settlements WHERE deleted_at IS NULL GROUP BY status`,
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.status)] = Number(r.n);
    return out;
  }

  async countLettersByType(): Promise<Record<string, number>> {
    const rows = await this.query<any[]>(
      `SELECT letter_type, COUNT(*) AS n FROM exit_letters
        WHERE deleted_at IS NULL AND status IN ('ISSUED', 'EMAILED')
        GROUP BY letter_type`,
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.letter_type)] = Number(r.n);
    return out;
  }

  async countCompletedSeparationsSince(sinceDate: string): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS n FROM separations s
        WHERE s.deleted_at IS NULL AND s.status = 'COMPLETED' AND s.completed_at >= ?`,
      [sinceDate],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async countEmployees(): Promise<number> {
    const rows = await this.query<any[]>(`SELECT COUNT(*) AS n FROM employees WHERE deleted_at IS NULL`);
    return Number(rows[0]?.n ?? 0);
  }

  async countRehireEligible(): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS n FROM alumni WHERE deleted_at IS NULL AND rehire_eligible = 1`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  // ---------------------------------------------------------------------------
  // Attrition
  // ---------------------------------------------------------------------------

  async completedByMonth(sinceDate: string): Promise<any[]> {
    return this.query<any[]>(
      `SELECT DATE_FORMAT(s.completed_at, '%Y-%m') AS month, COUNT(*) AS n
         FROM separations s
        WHERE s.deleted_at IS NULL AND s.status = 'COMPLETED' AND s.completed_at >= ?
        GROUP BY month
        ORDER BY month ASC`,
      [sinceDate],
    );
  }

  async completedByType(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT s.separation_type, COUNT(*) AS n
         FROM separations s
        WHERE s.deleted_at IS NULL AND s.status = 'COMPLETED'
        GROUP BY s.separation_type`,
    );
  }

  async completedByDepartment(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT COALESCE(d.name, e.department, 'Unassigned') AS department, COUNT(*) AS n
         FROM separations s
         JOIN employees e ON e.id = s.employee_id
         LEFT JOIN departments d ON d.id = e.department_id
        WHERE s.deleted_at IS NULL AND s.status = 'COMPLETED'
        GROUP BY COALESCE(d.name, e.department, 'Unassigned')`,
    );
  }

  /** Flat completed-separation rows (also the attrition report). */
  async completedSeparationRows(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT s.id, s.sep_code, s.separation_type, s.reason, s.resignation_date, s.last_working_day,
              s.completed_at, e.emp_code, e.full_name, e.joined_at, e.worker_type, e.grade,
              COALESCE(d.name, e.department, 'Unassigned') AS department
         FROM separations s
         JOIN employees e ON e.id = s.employee_id
         LEFT JOIN departments d ON d.id = e.department_id
        WHERE s.deleted_at IS NULL AND s.status = 'COMPLETED'
        ORDER BY s.completed_at DESC`,
    );
  }

  /** CHOICE answers from the exit survey, grouped per question/choice. */
  async choiceDistribution(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT q.question, r.choice, COUNT(*) AS n
         FROM exit_survey_responses r
         JOIN exit_survey_questions q ON q.id = r.question_id AND q.kind = 'CHOICE'
        WHERE r.choice IS NOT NULL AND r.choice <> ''
        GROUP BY q.question, r.choice
        ORDER BY q.question ASC, n DESC`,
    );
  }

  async countFreeTextReasons(): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS n FROM separations s
        WHERE s.deleted_at IS NULL AND s.reason IS NOT NULL AND s.reason <> ''`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  // ---------------------------------------------------------------------------
  // Report rows
  // ---------------------------------------------------------------------------

  async reportResignations(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT s.sep_code, e.emp_code, e.full_name, s.separation_type, s.status,
              s.resignation_date, s.notice_days, s.notice_start, s.notice_end,
              s.last_working_day, s.reason
         FROM separations s
         JOIN employees e ON e.id = s.employee_id
        WHERE s.deleted_at IS NULL
        ORDER BY s.id DESC`,
    );
  }

  async reportExitInterviews(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT s.sep_code, e.emp_code, e.full_name, ei.interview_type, ei.status,
              ei.scheduled_at, ei.completed_at, ei.key_reasons, ei.would_recommend_company,
              u.name AS interviewer_name
         FROM exit_interviews ei
         JOIN separations s ON s.id = ei.separation_id
         JOIN employees e ON e.id = s.employee_id
         LEFT JOIN users u ON u.id = ei.interviewer_user_id
        WHERE ei.deleted_at IS NULL
        ORDER BY ei.id DESC`,
    );
  }

  async reportAssetReturns(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT s.sep_code, e.emp_code, e.full_name, a.asset_code, a.name AS asset_name,
              a.category AS asset_category, ar.return_condition, ar.damage_note,
              ar.damage_charge, ar.returned_at
         FROM asset_returns ar
         JOIN separations s ON s.id = ar.separation_id
         JOIN employees e ON e.id = s.employee_id
         JOIN asset_assignments aa ON aa.id = ar.asset_assignment_id
         JOIN assets a ON a.id = aa.asset_id
        ORDER BY ar.id DESC`,
    );
  }

  async reportClearances(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT s.sep_code, e.emp_code, e.full_name, c.department, c.status, c.note,
              c.cleared_at, u.name AS cleared_by_name
         FROM clearances c
         JOIN separations s ON s.id = c.separation_id
         JOIN employees e ON e.id = s.employee_id
         LEFT JOIN users u ON u.id = c.cleared_by
        ORDER BY c.id DESC`,
    );
  }

  async reportSettlements(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT fs.id, e.emp_code, e.full_name, fs.settlement_type, fs.status, fs.last_working_date,
              fs.pending_salary, fs.leave_encashment_amount, fs.gratuity_amount,
              fs.gross_payable, fs.total_recovery, fs.net_settlement, fs.paid_at
         FROM final_settlements fs
         JOIN employees e ON e.id = fs.employee_id
        WHERE fs.deleted_at IS NULL
        ORDER BY fs.id DESC`,
    );
  }

  async reportLetters(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT l.letter_number, l.letter_type, l.status, s.sep_code, e.emp_code, e.full_name,
              l.generated_at, l.emailed_at, l.email_error
         FROM exit_letters l
         JOIN separations s ON s.id = l.separation_id
         JOIN employees e ON e.id = s.employee_id
        WHERE l.deleted_at IS NULL
        ORDER BY l.id DESC`,
    );
  }

  async reportRehire(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT e.emp_code, e.full_name, a.exit_date, a.last_grade, a.last_department,
              a.rehire_eligible, a.rehire_restriction_note, a.is_boomerang, a.in_alumni_network,
              (SELECT r.decision FROM rehire_reviews r WHERE r.alumni_id = a.id ORDER BY r.id DESC LIMIT 1) AS latest_decision
         FROM alumni a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.deleted_at IS NULL
        ORDER BY a.id DESC`,
    );
  }

  async reportKt(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT s.sep_code, e.emp_code, e.full_name, p.status AS plan_status,
              se.full_name AS successor_name, i.item_type, i.title, i.status AS item_status,
              i.due_date, i.completed_at
         FROM kt_plans p
         JOIN separations s ON s.id = p.separation_id
         JOIN employees e ON e.id = s.employee_id
         LEFT JOIN employees se ON se.id = p.successor_employee_id
         LEFT JOIN kt_items i ON i.plan_id = p.id
        ORDER BY p.id DESC, i.sort_order ASC`,
    );
  }
}
