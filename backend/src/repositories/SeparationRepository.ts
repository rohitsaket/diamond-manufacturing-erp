import { BaseRepository } from './BaseRepository';

export interface SeparationFilters {
  status?: string;
  separationType?: string;
  employeeId?: number;
  search?: string;
  limit?: number;
}

/**
 * Separation cases, their append-only event timeline and the notice rules
 * configuration. The two heavyweight transactions of the lifecycle live here:
 * approval (which fans out every offboarding leg) and completion (which
 * flips the employee record, deactivates the login and registers the alumni
 * row in one atomic unit).
 */
export class SeparationRepository extends BaseRepository {
  // ==========================================================================
  // Cases
  // ==========================================================================

  private readonly baseSelect = `
    SELECT s.*, e.full_name AS employee_name, e.emp_code, e.grade, e.worker_type,
           e.department_id, d.name AS department_name
      FROM separations s
      JOIN employees e ON e.id = s.employee_id
      LEFT JOIN departments d ON d.id = e.department_id`;

  async findAll(filters: SeparationFilters): Promise<any[]> {
    const where: string[] = ['s.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.status) {
      where.push('s.status = ?');
      params.push(filters.status);
    }
    if (filters.separationType) {
      where.push('s.separation_type = ?');
      params.push(filters.separationType);
    }
    if (filters.employeeId) {
      where.push('s.employee_id = ?');
      params.push(filters.employeeId);
    }
    if (filters.search) {
      where.push('(e.full_name LIKE ? OR e.emp_code LIKE ? OR s.sep_code LIKE ?)');
      const like = `%${filters.search}%`;
      params.push(like, like, like);
    }
    // LIMIT cannot be bound in this stack; inline the sanitized number.
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 200), 1), 1000);
    return this.query<any[]>(
      `${this.baseSelect} WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT ${limit}`,
      params,
    );
  }

  async findById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `${this.baseSelect} WHERE s.id = ? AND s.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** A case that is still in flight: anything not in a terminal state. */
  async findActiveByEmployee(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `${this.baseSelect}
        WHERE s.employee_id = ? AND s.deleted_at IS NULL
          AND s.status NOT IN ('REJECTED', 'WITHDRAWN', 'COMPLETED', 'CANCELLED')
        ORDER BY s.id DESC LIMIT 1`,
      [employeeId],
    );
    return rows[0] ?? null;
  }

  async findLatestByEmployee(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `${this.baseSelect} WHERE s.employee_id = ? AND s.deleted_at IS NULL ORDER BY s.id DESC LIMIT 1`,
      [employeeId],
    );
    return rows[0] ?? null;
  }

  /** Next SEP-<year>-NNN sequence for the given year. */
  async nextSepCode(year: number): Promise<string> {
    const rows = await this.query<any[]>(
      `SELECT MAX(CAST(SUBSTRING_INDEX(sep_code, '-', -1) AS UNSIGNED)) AS max_seq
         FROM separations WHERE sep_code LIKE ?`,
      [`SEP-${year}-%`],
    );
    const next = Number(rows[0]?.max_seq ?? 0) + 1;
    return `SEP-${year}-${String(next).padStart(3, '0')}`;
  }

  async insert(fields: Record<string, any>): Promise<number> {
    const cols = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO separations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => fields[c]),
    );
    return Number(result.insertId);
  }

  async update(id: number, fields: Record<string, any>): Promise<void> {
    const cols = Object.keys(fields);
    if (cols.length === 0) return;
    await this.query(
      `UPDATE separations SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => fields[c]), id],
    );
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  async insertEvent(separationId: number, event: string, note: string | null, createdBy: number | null): Promise<void> {
    await this.query(
      'INSERT INTO separation_events (separation_id, event, note, created_by) VALUES (?, ?, ?, ?)',
      [separationId, event, note, createdBy],
    );
  }

  async findEvents(separationId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT ev.*, u.name AS actor_name
         FROM separation_events ev
         LEFT JOIN users u ON u.id = ev.created_by
        WHERE ev.separation_id = ?
        ORDER BY ev.id ASC`,
      [separationId],
    );
  }

  /** Used to block anonymous survey double-submits without storing the link. */
  async hasEvent(separationId: number, event: string): Promise<boolean> {
    const rows = await this.query<any[]>(
      'SELECT id FROM separation_events WHERE separation_id = ? AND event = ? LIMIT 1',
      [separationId, event],
    );
    return rows.length > 0;
  }

  // ==========================================================================
  // Employee / salary lookups the lifecycle needs
  // ==========================================================================

  async findEmployee(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT e.id, e.emp_code, e.full_name, e.grade, e.worker_type, e.department_id,
              d.name AS department_name, e.joined_at, e.whatsapp, e.work_status, e.resigned_at
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
        WHERE e.id = ? AND e.deleted_at IS NULL`,
      [employeeId],
    );
    return rows[0] ?? null;
  }

  /** Latest salary lines, newest period first, for the buyout per-day basis. */
  async findRecentSalaryLines(employeeId: number, count: number): Promise<any[]> {
    const limit = Math.min(Math.max(Math.trunc(count), 1), 12);
    return this.query<any[]>(
      `SELECT sl.id, sl.total_amount, sl.period_id
         FROM salary_lines sl
        WHERE sl.employee_id = ?
        ORDER BY sl.period_id DESC, sl.id DESC
        LIMIT ${limit}`,
      [employeeId],
    );
  }

  // ==========================================================================
  // Notice rules
  // ==========================================================================

  async findNoticeRules(activeOnly = false): Promise<any[]> {
    return this.query<any[]>(
      `SELECT * FROM notice_rules
        WHERE deleted_at IS NULL ${activeOnly ? 'AND is_active = 1' : ''}
        ORDER BY worker_type IS NULL, worker_type, grade IS NULL, grade`,
    );
  }

  async findNoticeRuleById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM notice_rules WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Best matching active rule for a worker: a row matching both worker type
   * and grade wins, then a grade-only row, then a worker-type row, then a
   * catch-all row with both NULL.
   */
  async findNoticeRuleFor(workerType: string | null, grade: string | null): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM notice_rules
        WHERE deleted_at IS NULL AND is_active = 1
          AND (worker_type IS NULL OR worker_type = ?)
          AND (grade IS NULL OR grade = ?)
        ORDER BY (worker_type IS NOT NULL AND grade IS NOT NULL) DESC,
                 (grade IS NOT NULL) DESC,
                 (worker_type IS NOT NULL) DESC,
                 id ASC
        LIMIT 1`,
      [workerType, grade],
    );
    return rows[0] ?? null;
  }

  async insertNoticeRule(fields: Record<string, any>): Promise<number> {
    const cols = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO notice_rules (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => fields[c]),
    );
    return Number(result.insertId);
  }

  async updateNoticeRule(id: number, fields: Record<string, any>): Promise<void> {
    const cols = Object.keys(fields);
    if (cols.length === 0) return;
    await this.query(
      `UPDATE notice_rules SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => fields[c]), id],
    );
  }

  // ==========================================================================
  // Approval: one transaction generates every offboarding leg
  // ==========================================================================

  async approveAndGenerate(args: {
    separationId: number;
    employeeId: number;
    newStatus: string;
    approvedBy: number;
    clearances: { department: string; sortOrder: number; tasks: string[] }[];
    accessCatalog: { systemName: string; isInternal: boolean }[];
  }): Promise<{ clearances: number; tasks: number; assetReturns: number; accessRevocations: number; interviews: number }> {
    return this.transaction(async (conn) => {
      await conn.execute(
        'UPDATE separations SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?',
        [args.newStatus, args.approvedBy, args.separationId],
      );

      let taskCount = 0;
      for (const c of args.clearances) {
        const [res]: any = await conn.execute(
          'INSERT INTO clearances (separation_id, department, status, sort_order) VALUES (?, ?, \'PENDING\', ?)',
          [args.separationId, c.department, c.sortOrder],
        );
        const clearanceId = Number(res.insertId);
        for (let i = 0; i < c.tasks.length; i++) {
          await conn.execute(
            'INSERT INTO clearance_tasks (clearance_id, task, status, sort_order) VALUES (?, ?, \'PENDING\', ?)',
            [clearanceId, c.tasks[i], i],
          );
          taskCount++;
        }
      }

      // One return row per still-open asset assignment of the employee.
      const [openAssignments]: any = await conn.execute(
        'SELECT id FROM asset_assignments WHERE employee_id = ? AND returned_on IS NULL',
        [args.employeeId],
      );
      for (const row of openAssignments as any[]) {
        await conn.execute(
          'INSERT INTO asset_returns (separation_id, asset_assignment_id, return_condition) VALUES (?, ?, \'PENDING\')',
          [args.separationId, row.id],
        );
      }

      for (const a of args.accessCatalog) {
        await conn.execute(
          'INSERT INTO access_revocations (separation_id, system_name, is_internal, status) VALUES (?, ?, ?, \'PENDING\')',
          [args.separationId, a.systemName, a.isInternal],
        );
      }

      await conn.execute(
        'INSERT INTO kt_plans (separation_id, status, created_by) VALUES (?, \'DRAFT\', ?)',
        [args.separationId, args.approvedBy],
      );

      for (const type of ['HR', 'MANAGER']) {
        await conn.execute(
          'INSERT INTO exit_interviews (separation_id, interview_type, status, created_by) VALUES (?, ?, \'PENDING\', ?)',
          [args.separationId, type, args.approvedBy],
        );
      }

      await conn.execute(
        'INSERT INTO separation_events (separation_id, event, note, created_by) VALUES (?, \'APPROVED\', ?, ?)',
        [
          args.separationId,
          `Approved; offboarding checklist generated. Case moved to ${args.newStatus}.`,
          args.approvedBy,
        ],
      );

      return {
        clearances: args.clearances.length,
        tasks: taskCount,
        assetReturns: (openAssignments as any[]).length,
        accessRevocations: args.accessCatalog.length,
        interviews: 2,
      };
    });
  }

  // ==========================================================================
  // Completion guards + the completion transaction
  // ==========================================================================

  async findUnclearedClearances(separationId: number): Promise<any[]> {
    return this.query<any[]>(
      'SELECT department, status FROM clearances WHERE separation_id = ? AND status <> \'CLEARED\'',
      [separationId],
    );
  }

  async findUnrevokedInternalAccess(separationId: number): Promise<any[]> {
    return this.query<any[]>(
      `SELECT system_name, status FROM access_revocations
        WHERE separation_id = ? AND is_internal = 1 AND status NOT IN ('REVOKED', 'NA')`,
      [separationId],
    );
  }

  /**
   * Completing a case is a single transaction: the employee record flips to
   * RESIGN, the linked login is deactivated (the one revocation this system
   * can genuinely perform), an EXIT timeline event is written, the alumni row
   * is registered (check-then-insert on employee_id) and the case closes.
   */
  async completeCase(args: {
    separationId: number;
    employeeId: number;
    lastWorkingDay: string;
    timelineTitle: string;
    timelineDetails: string | null;
    alumni: {
      exitDate: string | null;
      lastGrade: string | null;
      lastDepartment: string | null;
      contactPhone: string | null;
      rehireEligible: boolean | null;
    };
    userId: number;
  }): Promise<{ alumniCreated: boolean }> {
    return this.transaction(async (conn) => {
      await conn.execute(
        'UPDATE employees SET work_status = \'RESIGN\', resigned_at = ?, updated_by = ? WHERE id = ?',
        [args.lastWorkingDay, args.userId, args.employeeId],
      );
      await conn.execute(
        'UPDATE users SET is_active = 0 WHERE employee_id = ?',
        [args.employeeId],
      );
      await conn.execute(
        `INSERT INTO employee_timeline (employee_id, event_type, event_date, title, details, from_value, to_value, recorded_by)
         VALUES (?, 'EXIT', ?, ?, ?, 'WORKING', 'RESIGN', ?)`,
        [args.employeeId, args.lastWorkingDay, args.timelineTitle, args.timelineDetails, args.userId],
      );

      // Check-then-insert: the alumni table is keyed on employee_id and the
      // sibling stream may already have registered this person.
      const [existing]: any = await conn.execute(
        'SELECT id FROM alumni WHERE employee_id = ?',
        [args.employeeId],
      );
      let alumniCreated = false;
      if ((existing as any[]).length === 0) {
        await conn.execute(
          `INSERT INTO alumni (employee_id, separation_id, exit_date, last_grade, last_department, contact_phone, rehire_eligible)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            args.employeeId, args.separationId, args.alumni.exitDate, args.alumni.lastGrade,
            args.alumni.lastDepartment, args.alumni.contactPhone, args.alumni.rehireEligible,
          ],
        );
        alumniCreated = true;
      }

      await conn.execute(
        'UPDATE separations SET status = \'COMPLETED\', completed_at = NOW() WHERE id = ?',
        [args.separationId],
      );
      await conn.execute(
        'INSERT INTO separation_events (separation_id, event, note, created_by) VALUES (?, \'COMPLETED\', ?, ?)',
        [args.separationId, 'Offboarding completed; employee record closed and login deactivated.', args.userId],
      );
      return { alumniCreated };
    });
  }

  // ==========================================================================
  // Progress counts for SeparationProgress
  // ==========================================================================

  async progressCounts(separationId: number, employeeId: number): Promise<{
    clearances: { total: number; cleared: number; blocked: number };
    assetReturns: { total: number; returned: number; damagedOrLost: number };
    ktItems: { total: number; done: number };
    accessRevocations: { total: number; revoked: number };
    interviews: { total: number; completed: number };
    letters: { issued: number };
    settlementStatus: string | null;
  }> {
    const [clearance, assets, kt, access, interviews, letters, settlement] = await Promise.all([
      this.query<any[]>(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(status = 'CLEARED'), 0) AS cleared,
                COALESCE(SUM(status = 'BLOCKED'), 0) AS blocked
           FROM clearances WHERE separation_id = ?`,
        [separationId],
      ),
      this.query<any[]>(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(returned_at IS NOT NULL), 0) AS returned,
                COALESCE(SUM(return_condition IN ('DAMAGED', 'LOST')), 0) AS damaged_or_lost
           FROM asset_returns WHERE separation_id = ?`,
        [separationId],
      ),
      this.query<any[]>(
        `SELECT COUNT(*) AS total, COALESCE(SUM(i.status = 'DONE'), 0) AS done
           FROM kt_items i
           JOIN kt_plans p ON p.id = i.plan_id
          WHERE p.separation_id = ?`,
        [separationId],
      ),
      this.query<any[]>(
        `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'REVOKED'), 0) AS revoked
           FROM access_revocations WHERE separation_id = ?`,
        [separationId],
      ),
      this.query<any[]>(
        `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'COMPLETED'), 0) AS completed
           FROM exit_interviews WHERE separation_id = ? AND deleted_at IS NULL`,
        [separationId],
      ),
      // Sibling-owned tables, read-only here: letters issued and the latest
      // settlement status feed the case progress panel.
      this.query<any[]>(
        `SELECT COUNT(*) AS issued FROM exit_letters
          WHERE separation_id = ? AND status IN ('ISSUED', 'EMAILED') AND deleted_at IS NULL`,
        [separationId],
      ),
      this.query<any[]>(
        `SELECT status FROM final_settlements
          WHERE employee_id = ? AND deleted_at IS NULL
          ORDER BY id DESC LIMIT 1`,
        [employeeId],
      ),
    ]);

    return {
      clearances: {
        total: Number(clearance[0]?.total ?? 0),
        cleared: Number(clearance[0]?.cleared ?? 0),
        blocked: Number(clearance[0]?.blocked ?? 0),
      },
      assetReturns: {
        total: Number(assets[0]?.total ?? 0),
        returned: Number(assets[0]?.returned ?? 0),
        damagedOrLost: Number(assets[0]?.damaged_or_lost ?? 0),
      },
      ktItems: { total: Number(kt[0]?.total ?? 0), done: Number(kt[0]?.done ?? 0) },
      accessRevocations: {
        total: Number(access[0]?.total ?? 0),
        revoked: Number(access[0]?.revoked ?? 0),
      },
      interviews: {
        total: Number(interviews[0]?.total ?? 0),
        completed: Number(interviews[0]?.completed ?? 0),
      },
      letters: { issued: Number(letters[0]?.issued ?? 0) },
      settlementStatus: settlement[0]?.status ?? null,
    };
  }
}
