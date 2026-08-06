import { BaseRepository } from './BaseRepository';

export class RecruitmentAnalyticsRepository extends BaseRepository {
  async dashboardCounts(): Promise<any> {
    const [jobs] = await Promise.all([
      this.query<any[]>(
        `SELECT
           SUM(CASE WHEN status = 'PUBLISHED' OR (status = 'APPROVED' AND publish_at IS NOT NULL AND publish_at <= NOW()) THEN 1 ELSE 0 END) AS open_jobs,
           SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS draft_jobs
         FROM internal_jobs WHERE deleted_at IS NULL`,
      ),
    ]);
    const apps = await this.query<any[]>(
      `SELECT
         SUM(CASE WHEN status NOT IN ('HIRED', 'REJECTED', 'WITHDRAWN', 'DRAFT') THEN 1 ELSE 0 END) AS active_applications
       FROM internal_applications WHERE deleted_at IS NULL`,
    );
    const interviews = await this.query<any[]>(
      `SELECT COUNT(*) AS n FROM interview_rounds
        WHERE deleted_at IS NULL AND status IN ('SCHEDULED', 'RESCHEDULED')
          AND scheduled_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)`,
    );
    const offers = await this.query<any[]>(
      `SELECT
         SUM(CASE WHEN status IN ('RELEASED', 'ACCEPTED', 'EFFECTED') THEN 1 ELSE 0 END) AS released,
         SUM(CASE WHEN status IN ('ACCEPTED', 'EFFECTED') THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN status = 'EFFECTED' AND offer_type = 'INTERNAL_TRANSFER' THEN 1 ELSE 0 END) AS transfers,
         SUM(CASE WHEN status = 'EFFECTED' AND offer_type = 'PROMOTION' THEN 1 ELSE 0 END) AS promotions
       FROM internal_offers WHERE deleted_at IS NULL`,
    );
    const referrals = await this.query<any[]>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'HIRED' THEN 1 ELSE 0 END) AS hired
         FROM referrals WHERE deleted_at IS NULL`,
    );
    const pool = await this.query<any[]>(
      'SELECT COUNT(*) AS n FROM talent_pool_members WHERE removed_at IS NULL',
    );
    return {
      jobs: jobs[0], applications: apps[0], interviewsThisWeek: Number(interviews[0]?.n ?? 0),
      offers: offers[0], referrals: referrals[0], talentPoolSize: Number(pool[0]?.n ?? 0),
    };
  }

  async avgTimeToFillDays(): Promise<number | null> {
    const rows = await this.query<any[]>(
      `SELECT AVG(DATEDIFF(filled_at, published_at)) AS days
         FROM internal_jobs
        WHERE status = 'FILLED' AND filled_at IS NOT NULL AND published_at IS NOT NULL AND deleted_at IS NULL`,
    );
    const v = rows[0]?.days;
    return v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10;
  }

  async avgTimeToHireDays(): Promise<number | null> {
    const rows = await this.query<any[]>(
      `SELECT AVG(DATEDIFF(se.created_at, a.submitted_at)) AS days
         FROM application_stage_events se
         JOIN internal_applications a ON a.id = se.application_id
        WHERE se.to_status = 'HIRED' AND a.submitted_at IS NOT NULL`,
    );
    const v = rows[0]?.days;
    return v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10;
  }

  async funnel(jobId?: number): Promise<{ current: any[]; reached: any[] }> {
    const jobWhere = jobId ? 'AND a.job_id = ?' : '';
    const params = jobId ? [jobId] : [];
    const current = await this.query<any[]>(
      `SELECT a.status, COUNT(*) AS n
         FROM internal_applications a
        WHERE a.deleted_at IS NULL ${jobWhere}
        GROUP BY a.status`,
      params,
    );
    // Stage-reached counts come from the event stream so later stages still
    // count applications that have since moved on.
    const reached = await this.query<any[]>(
      `SELECT se.to_status AS status, COUNT(DISTINCT se.application_id) AS n
         FROM application_stage_events se
         JOIN internal_applications a ON a.id = se.application_id
        WHERE a.deleted_at IS NULL ${jobWhere}
        GROUP BY se.to_status`,
      params,
    );
    return { current, reached };
  }

  async byDepartment(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT d.name AS department,
              COUNT(DISTINCT j.id) AS jobs,
              COUNT(DISTINCT a.id) AS applications,
              COUNT(DISTINCT CASE WHEN a.status = 'HIRED' THEN a.id END) AS hires
         FROM internal_jobs j
         LEFT JOIN departments d ON d.id = j.department_id
         LEFT JOIN internal_applications a ON a.job_id = j.id AND a.deleted_at IS NULL
        WHERE j.deleted_at IS NULL
        GROUP BY d.name
        ORDER BY jobs DESC`,
    );
  }

  async referralsByMonth(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'HIRED' THEN 1 ELSE 0 END) AS hired
         FROM referrals
        WHERE deleted_at IS NULL
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
        ORDER BY month DESC
        LIMIT 12`,
    );
  }

  // -------------------------------------------------------------------------
  // Report row sources
  // -------------------------------------------------------------------------

  async vacancyRows(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT j.job_code, j.title, d.name AS department, j.employment_type, j.work_mode,
              j.openings, j.status, j.published_at, j.expires_at,
              COUNT(a.id) AS applications
         FROM internal_jobs j
         LEFT JOIN departments d ON d.id = j.department_id
         LEFT JOIN internal_applications a ON a.job_id = j.id AND a.deleted_at IS NULL
        WHERE j.deleted_at IS NULL
        GROUP BY j.id
        ORDER BY j.id DESC LIMIT 1000`,
    );
  }

  async applicationRows(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT a.id, j.job_code, j.title AS job_title, e.emp_code, e.full_name AS applicant,
              a.status, a.eligibility_passed, a.submitted_at, a.decided_at
         FROM internal_applications a
         JOIN internal_jobs j ON j.id = a.job_id
         JOIN employees e ON e.id = a.employee_id
        WHERE a.deleted_at IS NULL
        ORDER BY a.id DESC LIMIT 1000`,
    );
  }

  async interviewRows(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT r.id, j.title AS job_title, e.full_name AS applicant, r.round_no, r.round_type,
              r.scheduled_at, r.mode, r.status, r.outcome
         FROM interview_rounds r
         JOIN internal_applications a ON a.id = r.application_id
         JOIN internal_jobs j ON j.id = a.job_id
         JOIN employees e ON e.id = a.employee_id
        WHERE r.deleted_at IS NULL
        ORDER BY r.scheduled_at DESC LIMIT 1000`,
    );
  }

  async offerRows(filters: { offerType?: string; status?: string } = {}): Promise<any[]> {
    const where: string[] = ['o.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.offerType) { where.push('o.offer_type = ?'); params.push(filters.offerType); }
    if (filters.status) { where.push('o.status = ?'); params.push(filters.status); }
    return this.query<any[]>(
      `SELECT o.offer_code, e.full_name AS employee, j.title AS job_title, o.offer_type, o.title,
              o.to_grade, d.name AS to_department, o.status, o.released_at, o.responded_at, o.effected_at
         FROM internal_offers o
         JOIN internal_applications a ON a.id = o.application_id
         JOIN internal_jobs j ON j.id = a.job_id
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN departments d ON d.id = o.to_department_id
        WHERE ${where.join(' AND ')}
        ORDER BY o.id DESC LIMIT 1000`,
      params,
    );
  }

  async referralRows(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT r.id, ref.full_name AS referrer, COALESCE(cand.full_name, r.external_name) AS referred,
              CASE WHEN r.referred_employee_id IS NULL THEN 'EXTERNAL' ELSE 'INTERNAL' END AS referral_kind,
              j.title AS job_title, r.status, r.reward_points, r.created_at
         FROM referrals r
         JOIN employees ref ON ref.id = r.referrer_employee_id
         LEFT JOIN employees cand ON cand.id = r.referred_employee_id
         LEFT JOIN internal_jobs j ON j.id = r.job_id
        WHERE r.deleted_at IS NULL
        ORDER BY r.id DESC LIMIT 1000`,
    );
  }

  async talentPoolRows(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT p.name AS pool, p.pool_type, e.emp_code, e.full_name AS employee, m.note, m.added_at
         FROM talent_pool_members m
         JOIN talent_pools p ON p.id = m.pool_id
         JOIN employees e ON e.id = m.employee_id
        WHERE m.removed_at IS NULL AND p.deleted_at IS NULL
        ORDER BY p.name, e.full_name LIMIT 1000`,
    );
  }
}
