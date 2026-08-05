import { BaseRepository } from './BaseRepository';

export interface KpiAssignmentFilters {
  cycleId?: number;
  scope?: string;
  employeeId?: number;
  departmentId?: number;
  status?: string;
  limit?: number;
}

export interface EmployeeKraFilters {
  cycleId?: number;
  employeeId?: number;
  status?: string;
  limit?: number;
}

const ASSIGNMENT_SELECT = `SELECT a.*, k.code AS kpi_code, k.name AS kpi_name, k.unit AS kpi_unit,
       k.direction AS kpi_direction, k.auto_source AS kpi_auto_source,
       e.full_name AS employee_name, d.name AS department_name
    FROM kpi_assignments a
    JOIN kpi_library k ON k.id = a.kpi_id
    LEFT JOIN employees e ON e.id = a.employee_id
    LEFT JOIN departments d ON d.id = a.department_id`;

const EMPLOYEE_KRA_SELECT = `SELECT ek.*, kr.code AS kra_code, kr.name AS kra_name, e.full_name AS employee_name
    FROM employee_kras ek
    JOIN kra_library kr ON kr.id = ek.kra_id
    JOIN employees e ON e.id = ek.employee_id`;

/**
 * Data access for the KPI library, KPI assignments and their monthly values,
 * the KRA library and per-employee KRA scoring rows — plus the read-only
 * production/attendance aggregations the auto-compute engine draws from.
 */
export class KpiKraRepository extends BaseRepository {
  // ==========================================================================
  // KPI library
  // ==========================================================================

  async findKpis(): Promise<any[]> {
    return this.query<any[]>('SELECT * FROM kpi_library WHERE deleted_at IS NULL ORDER BY id ASC');
  }

  async findKpiById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM kpi_library WHERE id = ? AND deleted_at IS NULL', [id]);
    return rows[0] ?? null;
  }

  async findKpiByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM kpi_library WHERE code = ? AND deleted_at IS NULL', [code]);
    return rows[0] ?? null;
  }

  async insertKpi(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO kpi_library (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }

  async updateKpi(id: number, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    await this.query(
      `UPDATE kpi_library SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...keys.map((k) => fields[k]), id],
    );
  }

  // ==========================================================================
  // KPI assignments
  // ==========================================================================

  async findAssignments(filters: KpiAssignmentFilters): Promise<any[]> {
    const where: string[] = ['a.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.cycleId) {
      where.push('a.cycle_id = ?');
      params.push(filters.cycleId);
    }
    if (filters.scope) {
      where.push('a.scope = ?');
      params.push(filters.scope);
    }
    if (filters.employeeId) {
      where.push('a.employee_id = ?');
      params.push(filters.employeeId);
    }
    if (filters.departmentId) {
      where.push('a.department_id = ?');
      params.push(filters.departmentId);
    }
    if (filters.status) {
      where.push('a.status = ?');
      params.push(filters.status);
    }
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 500), 1), 2000);
    return this.query<any[]>(
      `${ASSIGNMENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.id ASC LIMIT ${limit}`,
      params,
    );
  }

  async findAssignmentById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${ASSIGNMENT_SELECT} WHERE a.id = ? AND a.deleted_at IS NULL`, [id]);
    return rows[0] ?? null;
  }

  /**
   * Duplicate probe with NULL-safe comparison: MySQL unique keys cannot police
   * nullable scope columns, so the service checks-then-inserts through this.
   */
  async findDuplicateAssignment(
    kpiId: number,
    cycleId: number,
    scope: string,
    employeeId: number | null,
    teamId: number | null,
    departmentId: number | null,
  ): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT id FROM kpi_assignments
        WHERE kpi_id = ? AND cycle_id = ? AND scope = ?
          AND employee_id <=> ? AND team_id <=> ? AND department_id <=> ?
          AND deleted_at IS NULL LIMIT 1`,
      [kpiId, cycleId, scope, employeeId, teamId, departmentId],
    );
    return rows[0] ?? null;
  }

  /** ACTIVE assignments of a cycle whose KPI declares an auto source. */
  async findAutoAssignments(cycleId: number): Promise<any[]> {
    return this.query<any[]>(
      `${ASSIGNMENT_SELECT}
        WHERE a.cycle_id = ? AND a.status = 'ACTIVE' AND a.deleted_at IS NULL
          AND k.auto_source != 'NONE' AND k.deleted_at IS NULL
        ORDER BY a.id ASC`,
      [cycleId],
    );
  }

  async insertAssignment(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO kpi_assignments (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }

  async updateAssignment(id: number, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    await this.query(
      `UPDATE kpi_assignments SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...keys.map((k) => fields[k]), id],
    );
  }

  async softDeleteAssignment(id: number): Promise<void> {
    await this.query('UPDATE kpi_assignments SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL', [id]);
  }

  // ==========================================================================
  // KPI values (kpi_values has a real unique key on non-nullable columns, so
  // ON DUPLICATE KEY UPDATE is safe here)
  // ==========================================================================

  async upsertValue(
    assignmentId: number,
    periodKey: string,
    value: number,
    source: 'MANUAL' | 'AUTO',
    note: string | null,
    createdBy: number | null,
  ): Promise<void> {
    await this.query(
      `INSERT INTO kpi_values (assignment_id, period_key, value, source, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), source = VALUES(source), note = VALUES(note)`,
      [assignmentId, periodKey, value, source, note, createdBy],
    );
  }

  async findValues(assignmentId: number): Promise<any[]> {
    return this.query<any[]>(
      'SELECT * FROM kpi_values WHERE assignment_id = ? ORDER BY period_key ASC',
      [assignmentId],
    );
  }

  // ==========================================================================
  // KRA library
  // ==========================================================================

  async findKras(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT kr.*, d.name AS department_name
         FROM kra_library kr
         LEFT JOIN departments d ON d.id = kr.department_id
        WHERE kr.deleted_at IS NULL ORDER BY kr.id ASC`,
    );
  }

  async findKraById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT kr.*, d.name AS department_name
         FROM kra_library kr
         LEFT JOIN departments d ON d.id = kr.department_id
        WHERE kr.id = ? AND kr.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findKraByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM kra_library WHERE code = ? AND deleted_at IS NULL', [code]);
    return rows[0] ?? null;
  }

  async insertKra(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO kra_library (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }

  async updateKra(id: number, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    await this.query(
      `UPDATE kra_library SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...keys.map((k) => fields[k]), id],
    );
  }

  // ==========================================================================
  // Employee KRAs
  // ==========================================================================

  async findEmployeeKras(filters: EmployeeKraFilters): Promise<any[]> {
    const where: string[] = ['ek.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.cycleId) {
      where.push('ek.cycle_id = ?');
      params.push(filters.cycleId);
    }
    if (filters.employeeId) {
      where.push('ek.employee_id = ?');
      params.push(filters.employeeId);
    }
    if (filters.status) {
      where.push('ek.status = ?');
      params.push(filters.status);
    }
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 500), 1), 2000);
    return this.query<any[]>(
      `${EMPLOYEE_KRA_SELECT} WHERE ${where.join(' AND ')} ORDER BY ek.id ASC LIMIT ${limit}`,
      params,
    );
  }

  async findEmployeeKraById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(`${EMPLOYEE_KRA_SELECT} WHERE ek.id = ? AND ek.deleted_at IS NULL`, [id]);
    return rows[0] ?? null;
  }

  async findEmployeeKra(kraId: number, employeeId: number, cycleId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT id FROM employee_kras WHERE kra_id = ? AND employee_id = ? AND cycle_id = ? AND deleted_at IS NULL LIMIT 1',
      [kraId, employeeId, cycleId],
    );
    return rows[0] ?? null;
  }

  async insertEmployeeKra(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO employee_kras (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }

  async updateEmployeeKra(id: number, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    await this.query(
      `UPDATE employee_kras SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...keys.map((k) => fields[k]), id],
    );
  }

  // ==========================================================================
  // Auto-compute sources (read-only over live ERP tables)
  // ==========================================================================

  /**
   * Production for a set of employees inside a date window. Mirrors the master
   * ledger convention: a lot counts once it is RECEIVED or VERIFIED, dated by
   * `received_date`; pieces are `qty`, value is `labour_amount`.
   */
  async productionAggregate(
    employeeIds: number[],
    from: string,
    to: string,
  ): Promise<{ pieces: number; value: number }> {
    if (employeeIds.length === 0) return { pieces: 0, value: 0 };
    const placeholders = employeeIds.map(() => '?').join(', ');
    const rows = await this.query<any[]>(
      `SELECT COALESCE(SUM(qty), 0) AS pieces, COALESCE(SUM(labour_amount), 0) AS value_amount
         FROM lots
        WHERE employee_id IN (${placeholders})
          AND status IN ('RECEIVED', 'VERIFIED')
          AND received_date BETWEEN ? AND ?
          AND deleted_at IS NULL`,
      [...employeeIds, from, to],
    );
    return { pieces: Number(rows[0]?.pieces ?? 0), value: Number(rows[0]?.value_amount ?? 0) };
  }

  /**
   * Attendance aggregate matching the corrected company formula:
   * worked = PRESENT + HALF_DAY x 0.5, expected = PRESENT + ABSENT + HALF_DAY
   * + LEAVE (HOLIDAY and WEEK_OFF stay out of the denominator).
   */
  async attendanceAggregate(
    employeeIds: number[],
    from: string,
    to: string,
  ): Promise<{ worked: number; expected: number; otHours: number }> {
    if (employeeIds.length === 0) return { worked: 0, expected: 0, otHours: 0 };
    const placeholders = employeeIds.map(() => '?').join(', ');
    const rows = await this.query<any[]>(
      `SELECT COALESCE(SUM(status = 'PRESENT'), 0) + COALESCE(SUM(status = 'HALF_DAY'), 0) * 0.5 AS worked,
              COALESCE(SUM(status IN ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE')), 0) AS expected,
              COALESCE(SUM(ot_hours), 0) AS ot_hours
         FROM attendance_records
        WHERE employee_id IN (${placeholders})
          AND att_date BETWEEN ? AND ?
          AND deleted_at IS NULL`,
      [...employeeIds, from, to],
    );
    return {
      worked: Number(rows[0]?.worked ?? 0),
      expected: Number(rows[0]?.expected ?? 0),
      otHours: Number(rows[0]?.ot_hours ?? 0),
    };
  }

  async employeeIdsForTeam(teamId: number): Promise<number[]> {
    const rows = await this.query<any[]>(
      `SELECT tm.employee_id
         FROM team_members tm
         JOIN employees e ON e.id = tm.employee_id
        WHERE tm.team_id = ? AND tm.left_on IS NULL
          AND e.work_status = 'WORKING' AND e.deleted_at IS NULL`,
      [teamId],
    );
    return rows.map((r) => Number(r.employee_id));
  }

  /** Uses the employees.department_id link added by migration 050. */
  async employeeIdsForDepartment(departmentId: number): Promise<number[]> {
    const rows = await this.query<any[]>(
      `SELECT id FROM employees
        WHERE department_id = ? AND work_status = 'WORKING' AND deleted_at IS NULL`,
      [departmentId],
    );
    return rows.map((r) => Number(r.id));
  }

  async allWorkingEmployeeIds(): Promise<number[]> {
    const rows = await this.query<any[]>(
      "SELECT id FROM employees WHERE work_status = 'WORKING' AND deleted_at IS NULL",
    );
    return rows.map((r) => Number(r.id));
  }

  async findEmployeeById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT id, full_name, work_status FROM employees WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }
}
