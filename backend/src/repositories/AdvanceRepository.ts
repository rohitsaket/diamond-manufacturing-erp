import { BaseRepository } from './BaseRepository';
import {
  AdvanceRow,
  AdvanceResponse,
  AdvanceRecoveryResponse,
  AdvanceType,
  AdvanceStatus,
  RecoverySource,
} from '../types/hrms';
import { toDateString } from '../utils/dateUtils';

export interface CreateAdvanceInput {
  employeeId: number;
  advanceType: AdvanceType;
  amount: number;
  advanceDate: string;
  reason?: string | null;
  installmentAmount: number;
}

export interface AdvanceFilters {
  employeeId?: number;
  status?: AdvanceStatus | string;
}

export interface InsertRecoveryInput {
  advanceId: number;
  periodId?: number | null;
  salaryLineId?: number | null;
  amount: number;
  recoveredOn: string;
  source: RecoverySource;
  remarks?: string | null;
}

/** Minimal shape the payroll engine needs to schedule an installment. */
export interface ActiveAdvanceForRecovery {
  id: number;
  employeeId: number;
  advanceType: AdvanceType;
  amount: number;
  installmentAmount: number;
  recovered: number;
  outstanding: number;
}

/** Recovered-to-date, computed rather than stored so it can never drift. */
const RECOVERED_SUBQUERY = `COALESCE((SELECT SUM(r.amount) FROM advance_recoveries r WHERE r.advance_id = a.id), 0)`;

/**
 * Advances and loans plus their recovery ledger.
 *
 * Every method the payroll engine may call while holding a transaction accepts
 * an optional `conn` and routes through it, so recoveries written during a
 * recalculation are read back consistently before the commit.
 */
export class AdvanceRepository extends BaseRepository {
  /** Public escape hatch so services can wrap multi-table writes in one txn. */
  async withTransaction<T>(fn: (connection: any) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  async findAll(filters: AdvanceFilters = {}): Promise<AdvanceResponse[]> {
    let sql = `
      SELECT a.*,
             e.full_name AS employee_name,
             e.emp_code  AS emp_code,
             ${RECOVERED_SUBQUERY} AS recovered
      FROM advances a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (filters.employeeId) {
      sql += ' AND a.employee_id = ?';
      params.push(filters.employeeId);
    }
    if (filters.status && filters.status !== 'ALL') {
      sql += ' AND a.status = ?';
      params.push(filters.status);
    }
    sql += ' ORDER BY a.advance_date DESC, a.id DESC';

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toResponse(r));
  }

  async findById(id: number, conn?: any): Promise<AdvanceResponse | null> {
    const sql = `
      SELECT a.*,
             e.full_name AS employee_name,
             e.emp_code  AS emp_code,
             ${RECOVERED_SUBQUERY} AS recovered
      FROM advances a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.id = ? AND a.deleted_at IS NULL
    `;
    let rows: any[];
    if (conn) {
      const [result] = await conn.query(sql, [id]);
      rows = result as any[];
    } else {
      rows = await this.query<any[]>(sql, [id]);
    }
    return rows[0] ? this.toResponse(rows[0]) : null;
  }

  /** Locks the advance row for the duration of the caller's transaction. */
  async findRowForUpdate(id: number, conn: any): Promise<AdvanceRow | null> {
    const [rows] = await conn.query(
      'SELECT * FROM advances WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [id],
    );
    return (rows as AdvanceRow[])[0] || null;
  }

  async getRecoveredTotal(advanceId: number, conn?: any): Promise<number> {
    const sql = 'SELECT COALESCE(SUM(amount), 0) AS total FROM advance_recoveries WHERE advance_id = ?';
    let rows: any[];
    if (conn) {
      const [result] = await conn.query(sql, [advanceId]);
      rows = result as any[];
    } else {
      rows = await this.query<any[]>(sql, [advanceId]);
    }
    return Number(rows[0]?.total ?? 0);
  }

  /** Open advances for one employee, oldest first, with outstanding computed. */
  async findActiveByEmployee(employeeId: number, conn?: any): Promise<ActiveAdvanceForRecovery[]> {
    const sql = `
      SELECT a.id, a.employee_id, a.advance_type, a.amount, a.installment_amount,
             ${RECOVERED_SUBQUERY} AS recovered
      FROM advances a
      WHERE a.employee_id = ? AND a.status = 'ACTIVE' AND a.deleted_at IS NULL
        AND ${RECOVERED_SUBQUERY} < a.amount
      ORDER BY a.advance_date ASC, a.id ASC
    `;
    let rows: any[];
    if (conn) {
      const [result] = await conn.query(sql, [employeeId]);
      rows = result as any[];
    } else {
      rows = await this.query<any[]>(sql, [employeeId]);
    }
    return rows.map((r) => {
      const amount = Number(r.amount ?? 0);
      const recovered = Number(r.recovered ?? 0);
      return {
        id: r.id,
        employeeId: r.employee_id,
        advanceType: r.advance_type,
        amount,
        installmentAmount: Number(r.installment_amount ?? 0),
        recovered,
        outstanding: Math.round((amount - recovered) * 100) / 100,
      };
    });
  }

  async create(data: CreateAdvanceInput, userId: number, conn?: any): Promise<number> {
    const sql = `INSERT INTO advances
        (employee_id, advance_type, amount, advance_date, reason, installment_amount,
         status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`;
    const params = [
      data.employeeId,
      data.advanceType,
      data.amount,
      data.advanceDate,
      data.reason ?? null,
      data.installmentAmount,
      userId,
      userId,
    ];
    if (conn) {
      const [result] = await conn.query(sql, params);
      return (result as any).insertId;
    }
    const result = await this.query<any>(sql, params);
    return result.insertId;
  }

  async close(id: number, userId: number, conn?: any): Promise<void> {
    const sql = `UPDATE advances SET status = 'CLOSED', closed_at = NOW(), updated_by = ?
                 WHERE id = ? AND deleted_at IS NULL`;
    const params = [userId, id];
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  async updateStatus(id: number, status: AdvanceStatus, conn?: any): Promise<void> {
    const sql = `UPDATE advances
                 SET status = ?, closed_at = CASE WHEN ? = 'ACTIVE' THEN NULL ELSE NOW() END
                 WHERE id = ? AND deleted_at IS NULL`;
    const params = [status, status, id];
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  async insertRecovery(data: InsertRecoveryInput, userId: number, conn?: any): Promise<number> {
    const sql = `INSERT INTO advance_recoveries
        (advance_id, period_id, salary_line_id, amount, recovered_on, source, remarks, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      data.advanceId,
      data.periodId ?? null,
      data.salaryLineId ?? null,
      data.amount,
      data.recoveredOn,
      data.source,
      data.remarks ?? null,
      userId,
    ];
    if (conn) {
      const [result] = await conn.query(sql, params);
      return (result as any).insertId;
    }
    const result = await this.query<any>(sql, params);
    return result.insertId;
  }

  /** Clears machine-generated recoveries so a period can be recalculated. */
  async deletePayrollRecoveriesForPeriod(periodId: number, conn?: any): Promise<number> {
    const sql = "DELETE FROM advance_recoveries WHERE period_id = ? AND source = 'PAYROLL'";
    if (conn) {
      const [result] = await conn.query(sql, [periodId]);
      return Number((result as any).affectedRows ?? 0);
    }
    const result = await this.query<any>(sql, [periodId]);
    return Number(result?.affectedRows ?? 0);
  }

  async getRecoveries(advanceId: number): Promise<AdvanceRecoveryResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT ar.*, sp.label AS period_label
       FROM advance_recoveries ar
       LEFT JOIN salary_periods sp ON sp.id = ar.period_id
       WHERE ar.advance_id = ?
       ORDER BY ar.recovered_on ASC, ar.id ASC`,
      [advanceId],
    );
    return rows.map((r) => ({
      id: r.id,
      advanceId: r.advance_id,
      periodId: r.period_id,
      periodLabel: r.period_label ?? null,
      amount: Number(r.amount ?? 0),
      recoveredOn: toDateString(r.recovered_on),
      source: r.source,
      remarks: r.remarks,
    }));
  }

  /** Recoveries attached to one salary line (payslip detail). */
  async getRecoveriesForSalaryLine(salaryLineId: number): Promise<AdvanceRecoveryResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT ar.*, sp.label AS period_label
       FROM advance_recoveries ar
       LEFT JOIN salary_periods sp ON sp.id = ar.period_id
       WHERE ar.salary_line_id = ?
       ORDER BY ar.id ASC`,
      [salaryLineId],
    );
    return rows.map((r) => ({
      id: r.id,
      advanceId: r.advance_id,
      periodId: r.period_id,
      periodLabel: r.period_label ?? null,
      amount: Number(r.amount ?? 0),
      recoveredOn: toDateString(r.recovered_on),
      source: r.source,
      remarks: r.remarks,
    }));
  }

  /** Company-wide money still out on active advances. */
  async getOutstandingTotal(): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COALESCE(SUM(a.amount - ${RECOVERED_SUBQUERY}), 0) AS total
       FROM advances a
       WHERE a.deleted_at IS NULL AND a.status = 'ACTIVE'`,
    );
    return Number(rows[0]?.total ?? 0);
  }

  async getRecoveredInPeriod(periodId: number): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM advance_recoveries WHERE period_id = ?',
      [periodId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  private toResponse(r: any): AdvanceResponse {
    const amount = Number(r.amount ?? 0);
    const recovered = Number(r.recovered ?? 0);
    return {
      id: r.id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      empCode: r.emp_code,
      advanceType: r.advance_type,
      amount,
      advanceDate: toDateString(r.advance_date),
      reason: r.reason,
      installmentAmount: Number(r.installment_amount ?? 0),
      recovered,
      outstanding: Math.round((amount - recovered) * 100) / 100,
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }
}
