import { BaseRepository } from './BaseRepository';
import {
  PayComponentRow,
  PayCycleRow,
  SalaryStructureRow,
  SalaryStructureLineRow,
  EmployeeSalaryRow,
  EmployeeSalaryComponentRow,
  EffectiveComponentLine,
  EmployeeCompensation,
  OvertimeRuleRow,
} from '../types/payroll';
import { toDateString } from '../utils/dateUtils';
import { num } from '../utils/payrollMath';

/**
 * Read side of the payroll master data the engine needs: components, structures,
 * employee compensation revisions and pay cycles.
 *
 * Every method is a *batch* read. The engine must never issue one query per
 * employee, so the assembly of the employee -> compensation map happens here in
 * four queries regardless of headcount.
 */
export class PayrollMasterRepository extends BaseRepository {
  /** Inline a list of ids safely: values are floored to positive integers. */
  private static idList(ids: number[]): string {
    const clean = ids
      .map((id) => Math.floor(Number(id)))
      .filter((id) => Number.isFinite(id) && id > 0);
    return clean.length ? clean.join(',') : '';
  }

  private async run<T = any[]>(sql: string, params: any[], conn?: any): Promise<T> {
    if (conn) {
      const [rows] = await conn.query(sql, params);
      return rows as T;
    }
    return this.query<T>(sql, params);
  }

  // -------------------------------------------------------------------------
  // Components
  // -------------------------------------------------------------------------

  /** Every active pay component, in the order they should appear on a payslip. */
  async getActiveComponents(conn?: any): Promise<PayComponentRow[]> {
    return this.run<PayComponentRow[]>(
      `SELECT * FROM pay_components
       WHERE is_active = true AND deleted_at IS NULL
       ORDER BY display_order ASC, id ASC`,
      [],
      conn,
    );
  }

  async getComponentByCode(code: string, conn?: any): Promise<PayComponentRow | null> {
    const rows = await this.run<PayComponentRow[]>(
      'SELECT * FROM pay_components WHERE code = ? AND deleted_at IS NULL LIMIT 1',
      [code],
      conn,
    );
    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // Pay cycles
  // -------------------------------------------------------------------------

  async getDefaultCycle(conn?: any): Promise<PayCycleRow | null> {
    const rows = await this.run<PayCycleRow[]>(
      `SELECT * FROM pay_cycles
       WHERE is_active = true AND deleted_at IS NULL
       ORDER BY is_default DESC, id ASC
       LIMIT 1`,
      [],
      conn,
    );
    return rows[0] ?? null;
  }

  /** The cycle attached to a period, falling back to the default cycle. */
  async getCycleForPeriod(periodId: number, conn?: any): Promise<PayCycleRow | null> {
    const rows = await this.run<PayCycleRow[]>(
      `SELECT pc.* FROM salary_periods sp
       JOIN pay_cycles pc ON pc.id = sp.cycle_id
       WHERE sp.id = ? AND pc.deleted_at IS NULL
       LIMIT 1`,
      [periodId],
      conn,
    );
    if (rows[0]) return rows[0];
    return this.getDefaultCycle(conn);
  }

  // -------------------------------------------------------------------------
  // Structures
  // -------------------------------------------------------------------------

  async getStructuresByIds(structureIds: number[], conn?: any): Promise<SalaryStructureRow[]> {
    const list = PayrollMasterRepository.idList(structureIds);
    if (!list) return [];
    return this.run<SalaryStructureRow[]>(
      `SELECT * FROM salary_structures WHERE id IN (${list}) AND deleted_at IS NULL`,
      [],
      conn,
    );
  }

  async getStructureLines(structureIds: number[], conn?: any): Promise<SalaryStructureLineRow[]> {
    const list = PayrollMasterRepository.idList(structureIds);
    if (!list) return [];
    return this.run<SalaryStructureLineRow[]>(
      `SELECT * FROM salary_structure_lines
       WHERE structure_id IN (${list})
       ORDER BY structure_id ASC, display_order ASC, id ASC`,
      [],
      conn,
    );
  }

  // -------------------------------------------------------------------------
  // Employee compensation
  // -------------------------------------------------------------------------

  /**
   * The compensation revision in force on `asOfDate` for every employee (or a
   * subset), assembled with its component lines.
   *
   * A revision qualifies when it is ACTIVE or APPROVED and its window covers the
   * date. When several qualify, the latest `effective_from` (then the highest id)
   * wins — that is the most recent revision.
   */
  async getCompensationMap(
    asOfDate: string,
    employeeIds?: number[],
    conn?: any,
  ): Promise<Map<number, EmployeeCompensation>> {
    let sql = `SELECT * FROM employee_salary
               WHERE deleted_at IS NULL
                 AND status IN ('ACTIVE', 'APPROVED')
                 AND effective_from <= ?
                 AND (effective_to IS NULL OR effective_to >= ?)`;
    const params: any[] = [asOfDate, asOfDate];

    if (employeeIds && employeeIds.length > 0) {
      const list = PayrollMasterRepository.idList(employeeIds);
      if (!list) return new Map();
      sql += ` AND employee_id IN (${list})`;
    }
    sql += ' ORDER BY employee_id ASC, effective_from ASC, id ASC';

    const revisions = await this.run<any[]>(sql, params, conn);
    if (revisions.length === 0) return new Map();

    // Later rows overwrite earlier ones, so the newest revision survives.
    const latestByEmployee = new Map<number, EmployeeSalaryRow>();
    for (const r of revisions) {
      latestByEmployee.set(Number(r.employee_id), {
        id: Number(r.id),
        employee_id: Number(r.employee_id),
        structure_id: r.structure_id === null ? null : Number(r.structure_id),
        currency: r.currency ?? 'INR',
        annual_ctc: r.annual_ctc === null ? null : num(r.annual_ctc),
        monthly_gross: r.monthly_gross === null ? null : num(r.monthly_gross),
        effective_from: toDateString(r.effective_from),
        effective_to: r.effective_to ? toDateString(r.effective_to) : null,
        revision_type: r.revision_type,
        status: r.status,
      });
    }

    const salaryIds = [...latestByEmployee.values()].map((s) => s.id);
    const structureIds = [...new Set(
      [...latestByEmployee.values()]
        .map((s) => s.structure_id)
        .filter((id): id is number => typeof id === 'number' && id > 0),
    )];

    const [overrideRows, structures, structureLines] = await Promise.all([
      this.getSalaryComponents(salaryIds, conn),
      this.getStructuresByIds(structureIds, conn),
      this.getStructureLines(structureIds, conn),
    ]);

    const overridesBySalary = new Map<number, EmployeeSalaryComponentRow[]>();
    for (const row of overrideRows) {
      const list = overridesBySalary.get(row.employee_salary_id) ?? [];
      list.push(row);
      overridesBySalary.set(row.employee_salary_id, list);
    }

    const structureById = new Map<number, SalaryStructureRow>();
    for (const s of structures) structureById.set(Number(s.id), s);

    const linesByStructure = new Map<number, SalaryStructureLineRow[]>();
    for (const line of structureLines) {
      const list = linesByStructure.get(Number(line.structure_id)) ?? [];
      list.push(line);
      linesByStructure.set(Number(line.structure_id), list);
    }

    const result = new Map<number, EmployeeCompensation>();
    for (const [employeeId, salary] of latestByEmployee) {
      const structure = salary.structure_id ? structureById.get(salary.structure_id) ?? null : null;
      const lines = this.mergeLines(
        overridesBySalary.get(salary.id) ?? [],
        salary.structure_id ? linesByStructure.get(salary.structure_id) ?? [] : [],
      );

      const monthlyCtc = salary.annual_ctc ? num(salary.annual_ctc) / 12 : num(salary.monthly_gross);
      const monthlyGross = salary.monthly_gross ? num(salary.monthly_gross) : monthlyCtc;

      result.set(employeeId, {
        employeeId,
        salary,
        structure,
        lines,
        monthlyCtc: Math.round(monthlyCtc * 100) / 100,
        monthlyGross: Math.round(monthlyGross * 100) / 100,
      });
    }

    return result;
  }

  async getSalaryComponents(salaryIds: number[], conn?: any): Promise<EmployeeSalaryComponentRow[]> {
    const list = PayrollMasterRepository.idList(salaryIds);
    if (!list) return [];
    const rows = await this.run<any[]>(
      `SELECT * FROM employee_salary_components WHERE employee_salary_id IN (${list}) ORDER BY id ASC`,
      [],
      conn,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      employee_salary_id: Number(r.employee_salary_id),
      component_id: Number(r.component_id),
      amount: r.amount === null ? null : num(r.amount),
      percent_value: r.percent_value === null ? null : num(r.percent_value),
      calculation_type: r.calculation_type ?? null,
      percent_of: r.percent_of ?? null,
    }));
  }

  /**
   * Employee overrides win over the structure's template line for the same
   * component; components the employee has no override for come from the
   * structure unchanged.
   */
  private mergeLines(
    overrides: EmployeeSalaryComponentRow[],
    structureLines: SalaryStructureLineRow[],
  ): EffectiveComponentLine[] {
    const byComponent = new Map<number, EffectiveComponentLine>();

    for (const line of structureLines) {
      byComponent.set(Number(line.component_id), {
        componentId: Number(line.component_id),
        calculationType: line.calculation_type ?? null,
        percentOf: line.percent_of ?? null,
        amount: line.amount === null ? null : num(line.amount),
        percentValue: line.percent_value === null ? null : num(line.percent_value),
        minAmount: line.min_amount === null ? null : num(line.min_amount),
        maxAmount: line.max_amount === null ? null : num(line.max_amount),
        displayOrder: Number(line.display_order) || 100,
        source: 'STRUCTURE',
      });
    }

    for (const ov of overrides) {
      const existing = byComponent.get(ov.component_id);
      byComponent.set(ov.component_id, {
        componentId: ov.component_id,
        calculationType: ov.calculation_type ?? existing?.calculationType ?? null,
        percentOf: ov.percent_of ?? existing?.percentOf ?? null,
        amount: ov.amount !== null ? ov.amount : existing?.amount ?? null,
        percentValue: ov.percent_value !== null ? ov.percent_value : existing?.percentValue ?? null,
        minAmount: existing?.minAmount ?? null,
        maxAmount: existing?.maxAmount ?? null,
        displayOrder: existing?.displayOrder ?? 100,
        source: 'EMPLOYEE',
      });
    }

    return [...byComponent.values()].sort((a, b) => a.displayOrder - b.displayOrder || a.componentId - b.componentId);
  }

  /** Single-employee lookup, used by final settlement rather than a payroll run. */
  async getCompensationForEmployee(
    employeeId: number,
    asOfDate: string,
    conn?: any,
  ): Promise<EmployeeCompensation | null> {
    const map = await this.getCompensationMap(asOfDate, [employeeId], conn);
    return map.get(employeeId) ?? null;
  }

  // -------------------------------------------------------------------------
  // Overtime rules
  // -------------------------------------------------------------------------

  async getOvertimeRules(conn?: any): Promise<OvertimeRuleRow[]> {
    return this.run<OvertimeRuleRow[]>(
      `SELECT * FROM overtime_rules
       WHERE is_active = true AND deleted_at IS NULL
       ORDER BY grade IS NULL ASC, branch IS NULL ASC, id ASC`,
      [],
      conn,
    );
  }
}
