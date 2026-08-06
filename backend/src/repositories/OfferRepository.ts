import { BaseRepository } from './BaseRepository';

const BASE_SELECT = `
  SELECT o.*, a.employee_id, a.job_id, a.status AS application_status,
         j.title AS job_title, j.job_code, j.openings, j.requisition_id,
         e.full_name AS employee_name, e.emp_code, e.grade AS employee_grade,
         e.department_id AS employee_department_id,
         d.name AS to_department_name, r.name AS to_role_name
    FROM internal_offers o
    JOIN internal_applications a ON a.id = o.application_id
    JOIN internal_jobs j ON j.id = a.job_id
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN departments d ON d.id = o.to_department_id
    LEFT JOIN job_roles r ON r.id = o.to_role_id`;

/** Internal offers: transfer, promotion, salary revision, gig assignment. */
export class OfferRepository extends BaseRepository {
  async nextSequence(year: number): Promise<number> {
    const rows = await this.query<any[]>(
      "SELECT COUNT(*) AS n FROM internal_offers WHERE offer_code LIKE ?",
      [`OFR-${year}-%`],
    );
    return Number(rows[0]?.n ?? 0) + 1;
  }

  async findApplication(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT a.*, j.title AS job_title, j.grade AS job_grade, j.department_id AS job_department_id,
              e.full_name AS employee_name, e.grade AS employee_grade
         FROM internal_applications a
         JOIN internal_jobs j ON j.id = a.job_id
         JOIN employees e ON e.id = a.employee_id
        WHERE a.id = ? AND a.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async insert(data: any, offerCode: string, userId: number): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO internal_offers
         (offer_code, application_id, offer_type, title, to_department_id, to_team_id, to_role_id,
          to_position_id, to_grade, salary_revision_pct, salary_revision_amount, effective_date,
          valid_until, terms, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
      [
        offerCode, data.applicationId, data.offerType, data.title,
        data.toDepartmentId ?? null, data.toTeamId ?? null, data.toRoleId ?? null,
        data.toPositionId ?? null, data.toGrade ?? null,
        data.salaryRevisionPct ?? null, data.salaryRevisionAmount ?? null,
        data.effectiveDate ?? null, data.validUntil ?? null, data.terms ?? null, userId,
      ],
    );
    return Number(result.insertId);
  }

  async findById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${BASE_SELECT} WHERE o.id = ? AND o.deleted_at IS NULL`, [id]);
    return rows[0] ?? null;
  }

  async findMany(filters: { status?: string; applicationId?: number; employeeId?: number }): Promise<any[]> {
    const where: string[] = ['o.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.status) { where.push('o.status = ?'); params.push(filters.status); }
    if (filters.applicationId) { where.push('o.application_id = ?'); params.push(filters.applicationId); }
    if (filters.employeeId) { where.push('a.employee_id = ?'); params.push(filters.employeeId); }
    return this.query<any[]>(
      `${BASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 500`,
      params,
    );
  }

  async update(id: number, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await this.query(`UPDATE internal_offers SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  /**
   * Releases the offer and moves the application to OFFERED (stage event
   * included) in one transaction.
   */
  async release(offerId: number, applicationId: number, fromStatus: string, userId: number): Promise<void> {
    await this.transaction(async (conn) => {
      await conn.execute(
        "UPDATE internal_offers SET status = 'RELEASED', released_at = NOW() WHERE id = ?",
        [offerId],
      );
      await conn.execute(
        "UPDATE internal_applications SET status = 'OFFERED' WHERE id = ?",
        [applicationId],
      );
      await conn.execute(
        `INSERT INTO application_stage_events (application_id, from_status, to_status, note, created_by)
         VALUES (?, ?, 'OFFERED', 'Offer released', ?)`,
        [applicationId, fromStatus, userId],
      );
    });
  }

  /**
   * Effects an ACCEPTED offer: the employee change, the timeline event, the
   * offer/application statuses and (when all openings are filled) the job and
   * requisition closure - all in ONE transaction. Returns fill info.
   */
  async effect(offer: any, userId: number): Promise<{ jobFilled: boolean; hiredCount: number }> {
    return this.transaction(async (conn) => {
      const employeeId = offer.employee_id;
      const today = new Date().toISOString().slice(0, 10);
      const effectiveDate = offer.effective_date
        ? new Date(offer.effective_date).toISOString().slice(0, 10)
        : today;

      if (offer.offer_type === 'INTERNAL_TRANSFER' && offer.to_department_id) {
        await conn.execute(
          'UPDATE employees SET department_id = ? WHERE id = ?',
          [offer.to_department_id, employeeId],
        );
        await conn.execute(
          `INSERT INTO employee_timeline (employee_id, event_type, event_date, title, details, from_value, to_value, recorded_by)
           VALUES (?, 'TRANSFER', ?, ?, ?, ?, ?, ?)`,
          [
            employeeId, effectiveDate,
            `Internal transfer - ${offer.job_title}`,
            `Offer ${offer.offer_code} effected`,
            offer.employee_department_id ? String(offer.employee_department_id) : null,
            String(offer.to_department_id),
            userId,
          ],
        );
      } else if (offer.offer_type === 'PROMOTION' && offer.to_grade) {
        await conn.execute(
          'UPDATE employees SET grade = ? WHERE id = ?',
          [offer.to_grade, employeeId],
        );
        await conn.execute(
          `INSERT INTO employee_timeline (employee_id, event_type, event_date, title, details, from_value, to_value, recorded_by)
           VALUES (?, 'PROMOTION', ?, ?, ?, ?, ?, ?)`,
          [
            employeeId, effectiveDate,
            `Promotion via internal job - ${offer.job_title}`,
            `Offer ${offer.offer_code} effected`,
            offer.employee_grade ?? null, offer.to_grade, userId,
          ],
        );
      } else if (offer.offer_type === 'GIG_ASSIGNMENT') {
        await conn.execute(
          `INSERT INTO employee_timeline (employee_id, event_type, event_date, title, details, from_value, to_value, recorded_by)
           VALUES (?, 'OTHER', ?, ?, ?, NULL, NULL, ?)`,
          [
            employeeId, effectiveDate,
            `Gig assignment - ${offer.job_title}`,
            `Offer ${offer.offer_code} effected`,
            userId,
          ],
        );
      } else if (offer.offer_type === 'SALARY_REVISION') {
        await conn.execute(
          `INSERT INTO employee_timeline (employee_id, event_type, event_date, title, details, from_value, to_value, amount, recorded_by)
           VALUES (?, 'SALARY_REVISION', ?, ?, ?, NULL, NULL, ?, ?)`,
          [
            employeeId, effectiveDate,
            `Salary revision recommended - ${offer.job_title}`,
            `Offer ${offer.offer_code}: recommendation only, applied in the payroll module`,
            offer.salary_revision_amount ?? null,
            userId,
          ],
        );
      }

      await conn.execute(
        "UPDATE internal_offers SET status = 'EFFECTED', effected_at = NOW() WHERE id = ?",
        [offer.id],
      );
      await conn.execute(
        "UPDATE internal_applications SET status = 'HIRED', decided_at = NOW() WHERE id = ?",
        [offer.application_id],
      );
      await conn.execute(
        `INSERT INTO application_stage_events (application_id, from_status, to_status, note, created_by)
         VALUES (?, ?, 'HIRED', ?, ?)`,
        [offer.application_id, offer.application_status, `Offer ${offer.offer_code} effected`, userId],
      );

      const [hiredRows]: any = await conn.execute(
        "SELECT COUNT(*) AS n FROM internal_applications WHERE job_id = ? AND status = 'HIRED' AND deleted_at IS NULL",
        [offer.job_id],
      );
      const hiredCount = Number(hiredRows[0]?.n ?? 0);
      const jobFilled = hiredCount >= Number(offer.openings ?? 1);
      if (jobFilled) {
        await conn.execute(
          "UPDATE internal_jobs SET status = 'FILLED', filled_at = NOW() WHERE id = ? AND status NOT IN ('FILLED', 'ARCHIVED', 'CANCELLED')",
          [offer.job_id],
        );
        if (offer.requisition_id) {
          await conn.execute(
            "UPDATE job_requisitions SET status = 'FULFILLED' WHERE id = ? AND status = 'APPROVED'",
            [offer.requisition_id],
          );
        }
      }
      return { jobFilled, hiredCount };
    });
  }

  /** Referral linked to this application, if any. */
  async findReferralByApplication(applicationId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM referrals WHERE application_id = ? AND deleted_at IS NULL LIMIT 1',
      [applicationId],
    );
    return rows[0] ?? null;
  }

  async markReferralHired(referralId: number, rewardPoints: number, recognitionId: number | null): Promise<void> {
    await this.query(
      "UPDATE referrals SET status = 'HIRED', reward_points = ?, reward_recognition_id = ? WHERE id = ?",
      [rewardPoints, recognitionId, referralId],
    );
  }
}
