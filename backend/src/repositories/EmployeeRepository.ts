import { BaseRepository } from './BaseRepository';
import { EmployeeRow, EmployeeSpecialistRow, EmployeeResponse } from '../types';

export class EmployeeRepository extends BaseRepository {
  async findAll(search?: string, workStatus?: string): Promise<EmployeeResponse[]> {
    let sql = `
      SELECT e.* FROM employees e
      WHERE e.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (workStatus && workStatus !== 'ALL') {
      sql += ' AND e.work_status = ?';
      params.push(workStatus);
    } else {
      sql += " AND e.work_status = 'WORKING'";
    }

    if (search) {
      sql += ' AND (e.full_name LIKE ? OR e.emp_code LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY e.full_name ASC';

    const rows = await this.query<EmployeeRow[]>(sql, params);
    return Promise.all(rows.map((r) => this.toResponse(r)));
  }

  async findById(id: number): Promise<EmployeeResponse | null> {
    const rows = await this.query<EmployeeRow[]>(
      'SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    if (!rows[0]) return null;
    return this.toResponse(rows[0]);
  }

  async findWorkingEmployees(): Promise<EmployeeRow[]> {
    return this.query<EmployeeRow[]>(
      "SELECT * FROM employees WHERE work_status = 'WORKING' AND deleted_at IS NULL ORDER BY full_name",
    );
  }

  async getSpecialists(employeeId: number): Promise<string[]> {
    const rows = await this.query<EmployeeSpecialistRow[]>(
      'SELECT specialist_code FROM employee_specialists WHERE employee_id = ?',
      [employeeId],
    );
    return rows.map((r) => r.specialist_code);
  }

  async getActiveLotCount(employeeId: number): Promise<number> {
    const rows = await this.query<any[]>(
      "SELECT COUNT(*) as cnt FROM lots WHERE employee_id = ? AND status IN ('ISSUED', 'IN_PROGRESS') AND deleted_at IS NULL",
      [employeeId],
    );
    return rows[0]?.cnt ?? 0;
  }

  async getTotalCts(employeeId: number): Promise<number> {
    const rows = await this.query<any[]>(
      "SELECT COALESCE(SUM(issue_weight), 0) as total FROM lots WHERE employee_id = ? AND deleted_at IS NULL",
      [employeeId],
    );
    return rows[0]?.total ?? 0;
  }

  async getYieldPct(employeeId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT 
        COALESCE(SUM(issue_weight), 0) as total_issue,
        COALESCE(SUM(polished_wt), 0) as total_polished
      FROM lots 
      WHERE employee_id = ? AND status IN ('VERIFIED', 'RECEIVED') AND deleted_at IS NULL`,
      [employeeId],
    );
    const r = rows[0];
    if (!r || r.total_issue === 0) return 0;
    return Math.round((r.total_polished / r.total_issue) * 1000) / 10;
  }

  async getPeriodSalary(employeeId: number, periodId: number): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT total_amount FROM salary_lines WHERE employee_id = ? AND period_id = ?',
      [employeeId, periodId],
    );
    return rows[0]?.total_amount ?? 0;
  }

  async getOpenPeriodSalary(employeeId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT sl.total_amount FROM salary_lines sl
       JOIN salary_periods sp ON sl.period_id = sp.id
       WHERE sl.employee_id = ? AND sp.status = 'OPEN' AND sp.deleted_at IS NULL
       LIMIT 1`,
      [employeeId],
    );
    return rows[0]?.total_amount ?? 0;
  }

  private async toResponse(row: EmployeeRow): Promise<EmployeeResponse> {
    const specialists = await this.getSpecialists(row.id);
    const lotsInHand = await this.getActiveLotCount(row.id);
    const totalCts = await this.getTotalCts(row.id);
    const yieldPct = await this.getYieldPct(row.id);
    const periodSalary = await this.getOpenPeriodSalary(row.id);

    return {
      id: row.id,
      empCode: row.emp_code,
      fullName: row.full_name,
      shortName: row.short_name,
      grade: row.grade,
      specialist: specialists,
      workerType: row.worker_type,
      workStatus: row.work_status,
      lotsInHand,
      totalCts,
      yieldPct,
      periodSalary,
      whatsapp: row.whatsapp,
      joinedAt: (row as any).joined_at instanceof Date
        ? (row as any).joined_at.toISOString().split('T')[0]
        : String(row.joined_at),
    };
  }
}
