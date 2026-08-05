import { BaseRepository } from './BaseRepository';

/**
 * Data access for continuous feedback, recognition awards, the reward-point
 * ledger and redemptions. Ledger arithmetic is a plain SUM over signed rows;
 * the redemption decision re-checks that sum inside its transaction so two
 * simultaneous approvals cannot push a balance below zero.
 */
export class FeedbackRepository extends BaseRepository {
  // ==========================================================================
  // Continuous feedback
  // ==========================================================================

  private readonly feedbackSelect = `
    SELECT f.*, te.full_name AS to_employee_name,
           COALESCE(fe.full_name, fu.name) AS from_name
      FROM continuous_feedback f
      JOIN employees te ON te.id = f.to_employee_id
      LEFT JOIN employees fe ON fe.id = f.from_employee_id
      LEFT JOIN users fu ON fu.id = f.from_user_id
     WHERE f.deleted_at IS NULL`;

  /**
   * `restrictTo` implements the non-staff visibility rule: PUBLIC rows plus
   * anything addressed to the caller's own employee record.
   */
  async findFeedback(filters: {
    employeeId?: number;
    feedbackType?: string;
    restrictTo?: { ownEmployeeId: number | null };
  }): Promise<any[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.employeeId) { where.push('f.to_employee_id = ?'); params.push(filters.employeeId); }
    if (filters.feedbackType) { where.push('f.feedback_type = ?'); params.push(filters.feedbackType); }
    if (filters.restrictTo) {
      if (filters.restrictTo.ownEmployeeId) {
        where.push("(f.visibility = 'PUBLIC' OR f.to_employee_id = ?)");
        params.push(filters.restrictTo.ownEmployeeId);
      } else {
        where.push("f.visibility = 'PUBLIC'");
      }
    }
    const whereSql = where.length ? ` AND ${where.join(' AND ')}` : '';
    return this.query<any[]>(`${this.feedbackSelect}${whereSql} ORDER BY f.id DESC LIMIT 500`, params);
  }

  async findFeedbackById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${this.feedbackSelect} AND f.id = ?`, [id]);
    return rows[0] ?? null;
  }

  async findFeedbackReceived(employeeId: number): Promise<any[]> {
    return this.query<any[]>(
      `${this.feedbackSelect} AND f.to_employee_id = ? ORDER BY f.id DESC LIMIT 200`,
      [employeeId],
    );
  }

  async insertFeedback(data: {
    toEmployeeId: number;
    fromEmployeeId: number | null;
    fromUserId: number;
    feedbackType: string;
    message: string;
    visibility: string;
    isAnonymous: boolean;
    relatedGoalId: number | null;
  }): Promise<number> {
    const result: any = await this.query(
      `INSERT INTO continuous_feedback
         (to_employee_id, from_employee_id, from_user_id, feedback_type, message, visibility, is_anonymous, related_goal_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.toEmployeeId, data.fromEmployeeId, data.fromUserId, data.feedbackType,
        data.message, data.visibility, data.isAnonymous, data.relatedGoalId,
      ],
    );
    return Number(result.insertId);
  }

  async softDeleteFeedback(id: number): Promise<void> {
    await this.query('UPDATE continuous_feedback SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  async goalExists(id: number): Promise<boolean> {
    const rows = await this.query<any[]>('SELECT id FROM perf_goals WHERE id = ? AND deleted_at IS NULL', [id]);
    return rows.length > 0;
  }

  async findEmployeeById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT id, emp_code, full_name, work_status FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  // ==========================================================================
  // Recognitions
  // ==========================================================================

  private readonly recognitionSelect = `
    SELECT r.*, e.full_name AS employee_name, e.emp_code, u.name AS awarded_by_name
      FROM recognitions r
      JOIN employees e ON e.id = r.employee_id
      LEFT JOIN users u ON u.id = r.awarded_by
     WHERE r.deleted_at IS NULL`;

  async findRecognitions(filters: { employeeId?: number }): Promise<any[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.employeeId) { where.push('r.employee_id = ?'); params.push(filters.employeeId); }
    const whereSql = where.length ? ` AND ${where.join(' AND ')}` : '';
    return this.query<any[]>(`${this.recognitionSelect}${whereSql} ORDER BY r.id DESC LIMIT 500`, params);
  }

  async findRecognitionById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${this.recognitionSelect} AND r.id = ?`, [id]);
    return rows[0] ?? null;
  }

  /**
   * Recognition and its EARNED ledger entry are one atomic write: an award
   * whose points never reached the ledger would be a silent theft.
   */
  async insertRecognitionWithPoints(data: {
    employeeId: number;
    awardType: string;
    title: string;
    citation: string | null;
    points: number;
    monetaryAmount: number | null;
    cycleId: number | null;
    isPublic: boolean;
    awardedBy: number;
    awardedAt: string;
  }): Promise<number> {
    return this.transaction(async (conn) => {
      const [result]: any = await conn.execute(
        `INSERT INTO recognitions
           (employee_id, award_type, title, citation, points, monetary_amount, cycle_id, is_public, awarded_by, awarded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.employeeId, data.awardType, data.title, data.citation, data.points,
          data.monetaryAmount, data.cycleId, data.isPublic, data.awardedBy, data.awardedAt,
        ],
      );
      const recognitionId = Number(result.insertId);
      if (data.points > 0) {
        await conn.execute(
          `INSERT INTO reward_ledger (employee_id, entry_type, points, recognition_id, reference, created_by)
           VALUES (?, 'EARNED', ?, ?, ?, ?)`,
          [data.employeeId, data.points, recognitionId, data.title, data.awardedBy],
        );
      }
      return recognitionId;
    });
  }

  // ==========================================================================
  // Reward ledger & redemptions
  // ==========================================================================

  async ledgerBalance(employeeId: number): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT COALESCE(SUM(points), 0) AS balance FROM reward_ledger WHERE employee_id = ?',
      [employeeId],
    );
    return Number(rows[0]?.balance ?? 0);
  }

  async ledgerEntries(employeeId: number, limit = 50): Promise<any[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
    return this.query<any[]>(
      `SELECT * FROM reward_ledger WHERE employee_id = ? ORDER BY id DESC LIMIT ${safeLimit}`,
      [employeeId],
    );
  }

  private readonly redemptionSelect = `
    SELECT rd.*, e.full_name AS employee_name, e.emp_code
      FROM reward_redemptions rd
      JOIN employees e ON e.id = rd.employee_id
     WHERE 1 = 1`;

  async findRedemptions(filters: { status?: string; employeeId?: number }): Promise<any[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.status) { where.push('rd.status = ?'); params.push(filters.status); }
    if (filters.employeeId) { where.push('rd.employee_id = ?'); params.push(filters.employeeId); }
    const whereSql = where.length ? ` AND ${where.join(' AND ')}` : '';
    return this.query<any[]>(`${this.redemptionSelect}${whereSql} ORDER BY rd.id DESC LIMIT 500`, params);
  }

  async findRedemptionById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${this.redemptionSelect} AND rd.id = ?`, [id]);
    return rows[0] ?? null;
  }

  async insertRedemption(employeeId: number, points: number, rewardItem: string): Promise<number> {
    const result: any = await this.query(
      "INSERT INTO reward_redemptions (employee_id, points, reward_item, status) VALUES (?, ?, ?, 'REQUESTED')",
      [employeeId, points, rewardItem],
    );
    return Number(result.insertId);
  }

  /**
   * Approve or reject in one transaction. Approval re-reads the balance with
   * the redemption row locked, writes the negative REDEEMED entry and flips
   * the status; a stale balance seen outside the transaction cannot slip a
   * negative balance through.
   */
  async decideRedemption(
    id: number,
    approve: boolean,
    note: string | null,
    userId: number,
  ): Promise<{ status: string; balanceAfter: number | null }> {
    return this.transaction(async (conn) => {
      const [rows]: any = await conn.execute(
        'SELECT * FROM reward_redemptions WHERE id = ? FOR UPDATE',
        [id],
      );
      const redemption = rows[0];
      if (!redemption) throw new Error('Redemption not found');
      if (redemption.status !== 'REQUESTED') {
        throw new Error(`Redemption cannot be decided from status ${redemption.status}`);
      }

      if (!approve) {
        await conn.execute(
          "UPDATE reward_redemptions SET status = 'REJECTED', note = ?, decided_by = ?, decided_at = NOW() WHERE id = ?",
          [note, userId, id],
        );
        return { status: 'REJECTED', balanceAfter: null };
      }

      const [balRows]: any = await conn.execute(
        'SELECT COALESCE(SUM(points), 0) AS balance FROM reward_ledger WHERE employee_id = ?',
        [redemption.employee_id],
      );
      const balance = Number(balRows[0]?.balance ?? 0);
      const points = Number(redemption.points);
      if (points > balance) {
        throw new Error(`Insufficient reward balance: employee has ${balance} points, redemption needs ${points}`);
      }

      await conn.execute(
        `INSERT INTO reward_ledger (employee_id, entry_type, points, redemption_id, reference, note, created_by)
         VALUES (?, 'REDEEMED', ?, ?, ?, ?, ?)`,
        [redemption.employee_id, -points, id, redemption.reward_item, note, userId],
      );
      await conn.execute(
        "UPDATE reward_redemptions SET status = 'APPROVED', note = ?, decided_by = ?, decided_at = NOW() WHERE id = ?",
        [note, userId, id],
      );
      return { status: 'APPROVED', balanceAfter: balance - points };
    });
  }

  async fulfillRedemption(id: number): Promise<void> {
    await this.query("UPDATE reward_redemptions SET status = 'FULFILLED' WHERE id = ?", [id]);
  }
}
