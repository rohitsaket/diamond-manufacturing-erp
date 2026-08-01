import { BaseRepository } from './BaseRepository';
import { EmployeeRow, EmployeeSpecialistRow, EmployeeResponse } from '../types';
import { EmployeeProfileResponse } from '../types/hrms';
import { toDateString } from '../utils/dateUtils';

export interface CreateEmployeeInput {
  empCode: string;
  fullName: string;
  shortName: string;
  grade: string;
  workerType: string;
  joinedAt: string;
  whatsapp?: string | null;
  department?: string | null;
  designation?: string | null;
  monthlySalary?: number | null;
  shiftId?: number | null;
}

export interface UpdateProfileInput {
  fullName?: string;
  shortName?: string;
  grade?: string;
  whatsapp?: string | null;
  address?: string | null;
  city?: string | null;
  dob?: string | null;
  gender?: string | null;
  bloodGroup?: string | null;
  aadhaarNumber?: string | null;
  pan?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  bankIfsc?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  department?: string | null;
  designation?: string | null;
  reportingManagerId?: number | null;
  monthlySalary?: number | null;
  pfApplicable?: boolean;
  esiApplicable?: boolean;
  shiftId?: number | null;
  photoUrl?: string | null;
}

/** Columns that updateProfile is allowed to write, mapped to their DB names. */
const PROFILE_COLUMNS: Record<keyof UpdateProfileInput, string> = {
  fullName: 'full_name',
  shortName: 'short_name',
  grade: 'grade',
  whatsapp: 'whatsapp',
  address: 'address',
  city: 'city',
  dob: 'dob',
  gender: 'gender',
  bloodGroup: 'blood_group',
  aadhaarNumber: 'aadhaar_number',
  pan: 'pan',
  bankName: 'bank_name',
  bankAccount: 'bank_account',
  bankIfsc: 'bank_ifsc',
  emergencyContactName: 'emergency_contact_name',
  emergencyContactPhone: 'emergency_contact_phone',
  department: 'department',
  designation: 'designation',
  reportingManagerId: 'reporting_manager_id',
  monthlySalary: 'monthly_salary',
  pfApplicable: 'pf_applicable',
  esiApplicable: 'esi_applicable',
  shiftId: 'shift_id',
  photoUrl: 'photo_url',
};

export class EmployeeRepository extends BaseRepository {
  /**
   * Single-pass listing: aggregates come from grouped sub-selects rather than
   * per-employee round trips, so the query count stays constant as headcount grows.
   */
  async findAll(search?: string, workStatus?: string): Promise<EmployeeResponse[]> {
    let sql = `
      SELECT
        e.*,
        COALESCE(agg.lots_in_hand, 0)   AS lots_in_hand,
        COALESCE(agg.total_cts, 0)      AS total_cts,
        COALESCE(agg.total_issue, 0)    AS total_issue,
        COALESCE(agg.total_polished, 0) AS total_polished,
        COALESCE(sal.period_salary, 0)  AS period_salary,
        spec.codes                      AS specialist_codes
      FROM employees e
      LEFT JOIN (
        SELECT
          employee_id,
          SUM(CASE WHEN status IN ('ISSUED', 'IN_PROGRESS') THEN 1 ELSE 0 END) AS lots_in_hand,
          SUM(issue_weight) AS total_cts,
          SUM(CASE WHEN status IN ('RECEIVED', 'VERIFIED') THEN issue_weight ELSE 0 END) AS total_issue,
          SUM(CASE WHEN status IN ('RECEIVED', 'VERIFIED') THEN COALESCE(polished_wt, 0) ELSE 0 END) AS total_polished
        FROM lots
        WHERE deleted_at IS NULL
        GROUP BY employee_id
      ) agg ON agg.employee_id = e.id
      LEFT JOIN (
        SELECT sl.employee_id, sl.total_amount AS period_salary
        FROM salary_lines sl
        JOIN salary_periods sp ON sp.id = sl.period_id
        WHERE sp.status = 'OPEN' AND sp.deleted_at IS NULL
      ) sal ON sal.employee_id = e.id
      LEFT JOIN (
        SELECT employee_id, GROUP_CONCAT(specialist_code) AS codes
        FROM employee_specialists
        GROUP BY employee_id
      ) spec ON spec.employee_id = e.id
      WHERE e.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (workStatus && workStatus !== 'ALL') {
      sql += ' AND e.work_status = ?';
      params.push(workStatus);
    } else if (!workStatus) {
      sql += " AND e.work_status = 'WORKING'";
    }

    if (search) {
      sql += ' AND (e.full_name LIKE ? OR e.emp_code LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY e.full_name ASC';

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.rowToResponse(r));
  }

  async findById(id: number): Promise<EmployeeResponse | null> {
    const rows = await this.query<EmployeeRow[]>(
      'SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    if (!rows[0]) return null;
    return this.toResponse(rows[0]);
  }

  async findRowById(id: number): Promise<EmployeeRow | null> {
    const rows = await this.query<EmployeeRow[]>(
      'SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] || null;
  }

  async findWorkingEmployees(): Promise<EmployeeRow[]> {
    return this.query<EmployeeRow[]>(
      "SELECT * FROM employees WHERE work_status = 'WORKING' AND deleted_at IS NULL ORDER BY full_name",
    );
  }

  /**
   * Employees who were on the payroll for any part of a window, including
   * those who resigned mid-period (they still earn their final salary).
   */
  async findEmployableInWindow(from: string, to: string, conn?: any): Promise<EmployeeRow[]> {
    const sql = `SELECT * FROM employees
                 WHERE deleted_at IS NULL
                   AND joined_at <= ?
                   AND (resigned_at IS NULL OR resigned_at >= ?)
                 ORDER BY full_name`;
    if (conn) {
      const [rows] = await conn.query(sql, [to, from]);
      return rows as EmployeeRow[];
    }
    return this.query<EmployeeRow[]>(sql, [to, from]);
  }

  async findByEmpCode(empCode: string): Promise<EmployeeRow | null> {
    const rows = await this.query<EmployeeRow[]>(
      'SELECT * FROM employees WHERE emp_code = ? AND deleted_at IS NULL',
      [empCode],
    );
    return rows[0] || null;
  }

  /** emp_code -> id lookup used by the punch importer. */
  async getEmpCodeMap(): Promise<Map<string, { id: number; shiftId: number | null }>> {
    const rows = await this.query<any[]>(
      "SELECT id, emp_code, shift_id FROM employees WHERE deleted_at IS NULL AND work_status = 'WORKING'",
    );
    const map = new Map<string, { id: number; shiftId: number | null }>();
    for (const r of rows) map.set(String(r.emp_code).trim().toUpperCase(), { id: r.id, shiftId: r.shift_id });
    return map;
  }

  async create(data: CreateEmployeeInput, userId: number, conn?: any): Promise<number> {
    const sql = `INSERT INTO employees
        (emp_code, full_name, short_name, grade, worker_type, work_status, whatsapp, joined_at,
         department, designation, monthly_salary, shift_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, 'WORKING', ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      data.empCode,
      data.fullName,
      data.shortName,
      data.grade,
      data.workerType,
      data.whatsapp ?? null,
      data.joinedAt,
      data.department ?? null,
      data.designation ?? null,
      data.monthlySalary ?? null,
      data.shiftId ?? null,
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

  async updateProfile(id: number, data: UpdateProfileInput, userId: number): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(PROFILE_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value === '' ? null : value);
    }

    if (sets.length === 0) return;
    sets.push('updated_by = ?');
    params.push(userId, id);

    await this.query(`UPDATE employees SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params);
  }

  async markResigned(id: number, resignedAt: string, userId: number): Promise<void> {
    await this.query(
      "UPDATE employees SET work_status = 'RESIGN', resigned_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
      [resignedAt, userId, id],
    );
  }

  async getProfile(id: number): Promise<EmployeeProfileResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT e.*, s.name AS shift_name, m.full_name AS manager_name,
              (SELECT COUNT(*) FROM users u WHERE u.employee_id = e.id AND u.deleted_at IS NULL) AS login_count
       FROM employees e
       LEFT JOIN shifts s ON s.id = e.shift_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
       WHERE e.id = ? AND e.deleted_at IS NULL`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;

    return {
      employeeId: r.id,
      empCode: r.emp_code,
      fullName: r.full_name,
      shortName: r.short_name,
      grade: r.grade,
      workerType: r.worker_type,
      workStatus: r.work_status,
      whatsapp: r.whatsapp,
      joinedAt: toDateString(r.joined_at),
      resignedAt: r.resigned_at ? toDateString(r.resigned_at) : null,
      address: r.address,
      city: r.city,
      dob: r.dob ? toDateString(r.dob) : null,
      gender: r.gender,
      bloodGroup: r.blood_group,
      aadhaarMasked: maskAadhaar(r.aadhaar_number),
      hasAadhaar: !!r.aadhaar_number,
      pan: r.pan,
      bankName: r.bank_name,
      bankAccount: r.bank_account,
      bankIfsc: r.bank_ifsc,
      emergencyContactName: r.emergency_contact_name,
      emergencyContactPhone: r.emergency_contact_phone,
      photoUrl: r.photo_url,
      department: r.department,
      designation: r.designation,
      reportingManagerId: r.reporting_manager_id,
      reportingManagerName: r.manager_name,
      monthlySalary: r.monthly_salary === null ? null : Number(r.monthly_salary),
      pfApplicable: !!r.pf_applicable,
      esiApplicable: !!r.esi_applicable,
      shiftId: r.shift_id,
      shiftName: r.shift_name,
      hasLogin: Number(r.login_count) > 0,
    };
  }

  /** Headcount metrics used by the HR and executive dashboards. */
  async getHeadcountStats(): Promise<{
    total: number;
    working: number;
    resigned: number;
    joinedThisMonth: number;
    resignedThisMonth: number;
    withLogin: number;
  }> {
    const rows = await this.query<any[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(work_status = 'WORKING') AS working,
         SUM(work_status = 'RESIGN') AS resigned,
         SUM(joined_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS joined_this_month,
         SUM(resigned_at IS NOT NULL AND resigned_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS resigned_this_month,
         (SELECT COUNT(*) FROM users u WHERE u.employee_id IS NOT NULL AND u.deleted_at IS NULL) AS with_login
       FROM employees WHERE deleted_at IS NULL`,
    );
    const r = rows[0] ?? {};
    return {
      total: Number(r.total ?? 0),
      working: Number(r.working ?? 0),
      resigned: Number(r.resigned ?? 0),
      joinedThisMonth: Number(r.joined_this_month ?? 0),
      resignedThisMonth: Number(r.resigned_this_month ?? 0),
      withLogin: Number(r.with_login ?? 0),
    };
  }

  /** Upcoming birthdays and work anniversaries within the next `days` days. */
  async getUpcomingMilestones(days: number): Promise<{
    birthdays: { employeeId: number; name: string; empCode: string; date: string }[];
    anniversaries: { employeeId: number; name: string; empCode: string; date: string; years: number }[];
  }> {
    const birthdayRows = await this.query<any[]>(
      `SELECT id, full_name, emp_code, dob,
              DATE_FORMAT(dob, CONCAT(YEAR(CURDATE()), '-%m-%d')) AS this_year
       FROM employees
       WHERE deleted_at IS NULL AND work_status = 'WORKING' AND dob IS NOT NULL
       HAVING DATEDIFF(this_year, CURDATE()) BETWEEN 0 AND ?
       ORDER BY DATEDIFF(this_year, CURDATE())`,
      [days],
    );
    const anniversaryRows = await this.query<any[]>(
      `SELECT id, full_name, emp_code, joined_at,
              DATE_FORMAT(joined_at, CONCAT(YEAR(CURDATE()), '-%m-%d')) AS this_year,
              YEAR(CURDATE()) - YEAR(joined_at) AS years
       FROM employees
       WHERE deleted_at IS NULL AND work_status = 'WORKING'
       HAVING DATEDIFF(this_year, CURDATE()) BETWEEN 0 AND ? AND years > 0
       ORDER BY DATEDIFF(this_year, CURDATE())`,
      [days],
    );

    return {
      birthdays: birthdayRows.map((r) => ({
        employeeId: r.id,
        name: r.full_name,
        empCode: r.emp_code,
        date: toDateString(r.this_year),
      })),
      anniversaries: anniversaryRows.map((r) => ({
        employeeId: r.id,
        name: r.full_name,
        empCode: r.emp_code,
        date: toDateString(r.this_year),
        years: Number(r.years),
      })),
    };
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
      'SELECT COALESCE(SUM(issue_weight), 0) as total FROM lots WHERE employee_id = ? AND deleted_at IS NULL',
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

  /** Maps a row already carrying joined aggregates (no further queries). */
  private rowToResponse(r: any): EmployeeResponse {
    const totalIssue = Number(r.total_issue ?? 0);
    const totalPolished = Number(r.total_polished ?? 0);
    return {
      id: r.id,
      empCode: r.emp_code,
      fullName: r.full_name,
      shortName: r.short_name,
      grade: r.grade,
      specialist: r.specialist_codes ? String(r.specialist_codes).split(',') : [],
      workerType: r.worker_type,
      workStatus: r.work_status,
      lotsInHand: Number(r.lots_in_hand ?? 0),
      totalCts: Number(r.total_cts ?? 0),
      yieldPct: totalIssue === 0 ? 0 : Math.round((totalPolished / totalIssue) * 1000) / 10,
      periodSalary: Number(r.period_salary ?? 0),
      whatsapp: r.whatsapp,
      joinedAt: toDateString(r.joined_at),
    };
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
      joinedAt: toDateString(row.joined_at),
    };
  }
}

/** Aadhaar is stored in full but only ever leaves the server masked. */
export function maskAadhaar(value: string | null): string | null {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 4) return 'XXXX-XXXX-XXXX';
  return `XXXX-XXXX-${digits.slice(-4)}`;
}
