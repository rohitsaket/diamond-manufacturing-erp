import { BaseRepository } from './BaseRepository';
import { toDateString } from '../utils/dateUtils';

// ---------------------------------------------------------------------------
// Enums mirrored from migrations 061 / 062 / 063
// ---------------------------------------------------------------------------
export type PayComponentType = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION' | 'REIMBURSEMENT';

export type PayComponentCategory =
  | 'BASIC' | 'ALLOWANCE' | 'BONUS' | 'INCENTIVE' | 'VARIABLE_PAY' | 'OVERTIME' | 'ARREARS'
  | 'STATUTORY' | 'LOAN' | 'ATTENDANCE' | 'REIMBURSEMENT' | 'OTHER';

export type CalculationType =
  | 'FIXED' | 'PERCENT_OF' | 'FORMULA' | 'ATTENDANCE_BASED' | 'SLAB' | 'PIECE_RATE' | 'MANUAL';

export type PercentBase = 'BASIC' | 'GROSS' | 'CTC' | 'NET';

export type WorkerType = 'PIECE_RATE' | 'DHAR' | 'MAXI';

export type PayFrequency = 'MONTHLY' | 'WEEKLY' | 'BI_WEEKLY' | 'DAILY' | 'SEMI_MONTHLY';

export type RoundingMode = 'NONE' | 'NEAREST' | 'UP' | 'DOWN';

export type LopBasis = 'CALENDAR_DAYS' | 'WORKING_DAYS' | 'FIXED_DAYS';

export type RevisionType =
  | 'INITIAL' | 'INCREMENT' | 'PROMOTION' | 'ANNUAL_REVISION'
  | 'MARKET_ADJUSTMENT' | 'SPECIAL' | 'CORRECTION';

export type RevisionStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'SUPERSEDED';

/** Revision states that count as "live" when resolving the package for a date. */
export const LIVE_REVISION_STATUSES: RevisionStatus[] = ['ACTIVE', 'APPROVED'];

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------
export interface PayComponentResponse {
  id: number;
  code: string;
  name: string;
  componentType: PayComponentType;
  category: PayComponentCategory;
  calculationType: CalculationType;
  percentOf: PercentBase | null;
  defaultValue: number | null;
  defaultPercent: number | null;
  formula: string | null;
  isTaxable: boolean;
  isPfApplicable: boolean;
  isEsiApplicable: boolean;
  isProrated: boolean;
  affectsGross: boolean;
  isStatutory: boolean;
  isSystem: boolean;
  displayOrder: number;
  isActive: boolean;
}

export interface SalaryStructureLineResponse {
  id: number;
  structureId: number;
  componentId: number;
  componentCode: string;
  componentName: string;
  componentType: PayComponentType;
  category: PayComponentCategory;
  calculationType: CalculationType | null;
  percentOf: PercentBase | null;
  amount: number | null;
  percentValue: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  displayOrder: number;
}

export interface SalaryStructureResponse {
  id: number;
  code: string;
  name: string;
  description: string | null;
  currency: string;
  country: string;
  grade: string | null;
  designation: string | null;
  department: string | null;
  branch: string | null;
  workerType: WorkerType | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  lineCount?: number;
  lines?: SalaryStructureLineResponse[];
}

export interface EmployeeSalaryComponentResponse {
  id: number;
  componentId: number;
  componentCode: string;
  componentName: string;
  componentType: PayComponentType;
  category: PayComponentCategory;
  amount: number | null;
  percentValue: number | null;
  calculationType: CalculationType | null;
  percentOf: PercentBase | null;
}

export interface EmployeeSalaryResponse {
  id: number;
  employeeId: number;
  employeeName?: string | null;
  empCode?: string | null;
  structureId: number | null;
  structureCode: string | null;
  structureName: string | null;
  currency: string;
  annualCtc: number | null;
  monthlyGross: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  revisionType: RevisionType;
  revisionReason: string | null;
  previousCtc: number | null;
  changePct: number | null;
  status: RevisionStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  components?: EmployeeSalaryComponentResponse[];
}

export interface PayCycleResponse {
  id: number;
  code: string;
  name: string;
  frequency: PayFrequency;
  currency: string;
  country: string;
  company: string | null;
  branch: string | null;
  cycleStartDay: number;
  cutoffDay: number | null;
  payDay: number | null;
  roundingMode: RoundingMode;
  roundingPrecision: number;
  lopBasis: LopBasis;
  fixedDaysPerMonth: number | null;
  isDefault: boolean;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Write inputs
// ---------------------------------------------------------------------------
export interface PayComponentInput {
  code?: string;
  name?: string;
  componentType?: PayComponentType;
  category?: PayComponentCategory;
  calculationType?: CalculationType;
  percentOf?: PercentBase | null;
  defaultValue?: number | null;
  defaultPercent?: number | null;
  formula?: string | null;
  isTaxable?: boolean;
  isPfApplicable?: boolean;
  isEsiApplicable?: boolean;
  isProrated?: boolean;
  affectsGross?: boolean;
  isStatutory?: boolean;
  displayOrder?: number;
  isActive?: boolean;
}

export interface SalaryStructureInput {
  code?: string;
  name?: string;
  description?: string | null;
  currency?: string;
  country?: string;
  grade?: string | null;
  designation?: string | null;
  department?: string | null;
  branch?: string | null;
  workerType?: WorkerType | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  isActive?: boolean;
}

export interface SalaryStructureLineInput {
  componentId: number;
  calculationType?: CalculationType | null;
  percentOf?: PercentBase | null;
  amount?: number | null;
  percentValue?: number | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  displayOrder?: number;
}

export interface EmployeeSalaryComponentInput {
  componentId: number;
  amount?: number | null;
  percentValue?: number | null;
  calculationType?: CalculationType | null;
  percentOf?: PercentBase | null;
}

export interface CreateRevisionInput {
  structureId?: number | null;
  currency?: string;
  annualCtc?: number | null;
  monthlyGross?: number | null;
  effectiveFrom: string;
  revisionType?: RevisionType;
  revisionReason?: string | null;
  status?: RevisionStatus;
  previousCtc?: number | null;
  changePct?: number | null;
  components?: EmployeeSalaryComponentInput[];
}

export interface PayCycleInput {
  code?: string;
  name?: string;
  frequency?: PayFrequency;
  currency?: string;
  country?: string;
  company?: string | null;
  branch?: string | null;
  cycleStartDay?: number;
  cutoffDay?: number | null;
  payDay?: number | null;
  roundingMode?: RoundingMode;
  roundingPrecision?: number;
  lopBasis?: LopBasis;
  fixedDaysPerMonth?: number | null;
  isActive?: boolean;
}

export interface ComponentFilters {
  componentType?: string;
  category?: string;
  isActive?: boolean;
  search?: string;
  limit?: number;
}

export interface StructureFilters {
  grade?: string;
  department?: string;
  branch?: string;
  workerType?: string;
  isActive?: boolean;
  limit?: number;
}

const COMPONENT_COLUMNS: Record<string, string> = {
  code: 'code',
  name: 'name',
  componentType: 'component_type',
  category: 'category',
  calculationType: 'calculation_type',
  percentOf: 'percent_of',
  defaultValue: 'default_value',
  defaultPercent: 'default_percent',
  formula: 'formula',
  isTaxable: 'is_taxable',
  isPfApplicable: 'is_pf_applicable',
  isEsiApplicable: 'is_esi_applicable',
  isProrated: 'is_prorated',
  affectsGross: 'affects_gross',
  isStatutory: 'is_statutory',
  displayOrder: 'display_order',
  isActive: 'is_active',
};

const STRUCTURE_COLUMNS: Record<string, string> = {
  code: 'code',
  name: 'name',
  description: 'description',
  currency: 'currency',
  country: 'country',
  grade: 'grade',
  designation: 'designation',
  department: 'department',
  branch: 'branch',
  workerType: 'worker_type',
  effectiveFrom: 'effective_from',
  effectiveTo: 'effective_to',
  isActive: 'is_active',
};

const CYCLE_COLUMNS: Record<string, string> = {
  code: 'code',
  name: 'name',
  frequency: 'frequency',
  currency: 'currency',
  country: 'country',
  company: 'company',
  branch: 'branch',
  cycleStartDay: 'cycle_start_day',
  cutoffDay: 'cutoff_day',
  payDay: 'pay_day',
  roundingMode: 'rounding_mode',
  roundingPrecision: 'rounding_precision',
  lopBasis: 'lop_basis',
  fixedDaysPerMonth: 'fixed_days_per_month',
  isActive: 'is_active',
};

/** Booleans arrive from JSON as true/false; MySQL wants 1/0. */
function boolParam(value: unknown): number {
  return value ? 1 : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function limitOf(value: number | undefined, fallback: number, ceiling: number): number {
  return Math.min(ceiling, Math.max(1, Math.floor(Number(value ?? fallback) || fallback)));
}

/**
 * Pay components, salary structures, employee compensation revisions and pay
 * cycles: the master data every payroll run is built from.
 *
 * All money columns are DECIMAL and come back as JS numbers (`decimalNumbers`
 * is set on the pool), but mappers still coerce with `Number(...)` so a driver
 * config change can never silently turn arithmetic into string concatenation.
 */
export class CompensationRepository extends BaseRepository {
  /** Public escape hatch so services can wrap multi-table writes in one txn. */
  async withTransaction<T>(fn: (connection: any) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  // -------------------------------------------------------------------------
  // Pay components
  // -------------------------------------------------------------------------
  async findComponents(filters: ComponentFilters = {}): Promise<PayComponentResponse[]> {
    let sql = 'SELECT * FROM pay_components WHERE deleted_at IS NULL';
    const params: any[] = [];

    if (filters.componentType) {
      sql += ' AND component_type = ?';
      params.push(filters.componentType);
    }
    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters.isActive !== undefined) {
      sql += ' AND is_active = ?';
      params.push(boolParam(filters.isActive));
    }
    if (filters.search) {
      sql += ' AND (code LIKE ? OR name LIKE ?)';
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    const limit = limitOf(filters.limit, 500, 2000);
    sql += ` ORDER BY display_order ASC, code ASC LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.componentToResponse(r));
  }

  async findComponentById(id: number): Promise<PayComponentResponse | null> {
    const row = await this.findComponentRowById(id);
    return row ? this.componentToResponse(row) : null;
  }

  async findComponentRowById(id: number, conn?: any): Promise<any | null> {
    const sql = 'SELECT * FROM pay_components WHERE id = ? AND deleted_at IS NULL';
    if (conn) {
      const [rows] = await conn.query(sql, [id]);
      return (rows as any[])[0] || null;
    }
    const rows = await this.query<any[]>(sql, [id]);
    return rows[0] || null;
  }

  async findComponentByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM pay_components WHERE code = ? AND deleted_at IS NULL',
      [code],
    );
    return rows[0] || null;
  }

  /** Component rows for a set of ids, keyed by id — used to validate lines. */
  async findComponentsByIds(ids: number[]): Promise<Map<number, PayComponentResponse>> {
    const clean = Array.from(new Set(ids.map((i) => Math.floor(Number(i))).filter((i) => Number.isFinite(i) && i > 0)));
    const out = new Map<number, PayComponentResponse>();
    if (clean.length === 0) return out;

    // Ids are sanitised integers, so inlining them keeps this a single statement.
    const rows = await this.query<any[]>(
      `SELECT * FROM pay_components WHERE deleted_at IS NULL AND id IN (${clean.join(',')})`,
    );
    for (const row of rows) out.set(Number(row.id), this.componentToResponse(row));
    return out;
  }

  async createComponent(data: PayComponentInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO pay_components
         (code, name, component_type, category, calculation_type, percent_of,
          default_value, default_percent, formula, is_taxable, is_pf_applicable,
          is_esi_applicable, is_prorated, affects_gross, is_statutory, is_system,
          display_order, is_active, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, ?, ?, ?, ?)`,
      [
        data.code,
        data.name,
        data.componentType ?? 'EARNING',
        data.category ?? 'OTHER',
        data.calculationType ?? 'FIXED',
        data.percentOf ?? null,
        nullableNumber(data.defaultValue),
        nullableNumber(data.defaultPercent),
        data.formula ?? null,
        boolParam(data.isTaxable ?? true),
        boolParam(data.isPfApplicable ?? false),
        boolParam(data.isEsiApplicable ?? false),
        boolParam(data.isProrated ?? true),
        boolParam(data.affectsGross ?? true),
        boolParam(data.isStatutory ?? false),
        Math.floor(Number(data.displayOrder ?? 100)),
        boolParam(data.isActive ?? true),
        userId,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateComponent(id: number, data: PayComponentInput, userId: number): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(COMPONENT_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      if (['isTaxable', 'isPfApplicable', 'isEsiApplicable', 'isProrated', 'affectsGross', 'isStatutory', 'isActive'].includes(key)) {
        params.push(boolParam(value));
      } else if (['defaultValue', 'defaultPercent'].includes(key)) {
        params.push(nullableNumber(value));
      } else {
        params.push(value);
      }
    }
    if (sets.length === 0) return;

    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(
      `UPDATE pay_components SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async softDeleteComponent(id: number, userId: number): Promise<void> {
    await this.query(
      'UPDATE pay_components SET deleted_at = NOW(), updated_by = ? WHERE id = ? AND deleted_at IS NULL',
      [userId, id],
    );
  }

  /** Structures still referencing a component, blocking its removal. */
  async countStructureLinesForComponent(componentId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt
       FROM salary_structure_lines l
       JOIN salary_structures s ON s.id = l.structure_id AND s.deleted_at IS NULL
       WHERE l.component_id = ?`,
      [componentId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  // -------------------------------------------------------------------------
  // Salary structures
  // -------------------------------------------------------------------------
  async findStructures(filters: StructureFilters = {}): Promise<SalaryStructureResponse[]> {
    let sql = `
      SELECT s.*, (SELECT COUNT(*) FROM salary_structure_lines l WHERE l.structure_id = s.id) AS line_count
      FROM salary_structures s
      WHERE s.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (filters.grade) {
      sql += ' AND s.grade = ?';
      params.push(filters.grade);
    }
    if (filters.department) {
      sql += ' AND s.department = ?';
      params.push(filters.department);
    }
    if (filters.branch) {
      sql += ' AND s.branch = ?';
      params.push(filters.branch);
    }
    if (filters.workerType) {
      sql += ' AND s.worker_type = ?';
      params.push(filters.workerType);
    }
    if (filters.isActive !== undefined) {
      sql += ' AND s.is_active = ?';
      params.push(boolParam(filters.isActive));
    }

    const limit = limitOf(filters.limit, 200, 1000);
    sql += ` ORDER BY s.code ASC LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.structureToResponse(r));
  }

  async findStructureById(id: number): Promise<SalaryStructureResponse | null> {
    const row = await this.findStructureRowById(id);
    return row ? this.structureToResponse(row) : null;
  }

  async findStructureRowById(id: number, conn?: any): Promise<any | null> {
    const sql = 'SELECT * FROM salary_structures WHERE id = ? AND deleted_at IS NULL';
    if (conn) {
      const [rows] = await conn.query(sql, [id]);
      return (rows as any[])[0] || null;
    }
    const rows = await this.query<any[]>(sql, [id]);
    return rows[0] || null;
  }

  async findStructureByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM salary_structures WHERE code = ? AND deleted_at IS NULL',
      [code],
    );
    return rows[0] || null;
  }

  async findStructureLines(structureId: number, conn?: any): Promise<SalaryStructureLineResponse[]> {
    const sql = `
      SELECT l.*, c.code AS component_code, c.name AS component_name,
             c.component_type, c.category,
             c.calculation_type AS component_calculation_type,
             c.percent_of AS component_percent_of,
             c.default_value, c.default_percent
      FROM salary_structure_lines l
      JOIN pay_components c ON c.id = l.component_id
      WHERE l.structure_id = ? AND c.deleted_at IS NULL
      ORDER BY l.display_order ASC, c.display_order ASC, l.id ASC
    `;
    let rows: any[];
    if (conn) {
      const [result] = await conn.query(sql, [structureId]);
      rows = result as any[];
    } else {
      rows = await this.query<any[]>(sql, [structureId]);
    }
    return rows.map((r) => this.structureLineToResponse(r));
  }

  async createStructure(data: SalaryStructureInput, userId: number, conn?: any): Promise<number> {
    const sql = `INSERT INTO salary_structures
        (code, name, description, currency, country, grade, designation, department,
         branch, worker_type, effective_from, effective_to, is_active, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      data.code,
      data.name,
      data.description ?? null,
      data.currency ?? 'INR',
      data.country ?? 'IN',
      data.grade ?? null,
      data.designation ?? null,
      data.department ?? null,
      data.branch ?? null,
      data.workerType ?? null,
      data.effectiveFrom,
      data.effectiveTo ?? null,
      boolParam(data.isActive ?? true),
      userId,
      userId,
    ];
    if (conn) {
      const [result] = await conn.query(sql, params);
      return Number((result as any).insertId);
    }
    const result = await this.query<any>(sql, params);
    return Number(result.insertId);
  }

  async updateStructure(id: number, data: SalaryStructureInput, userId: number): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(STRUCTURE_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(key === 'isActive' ? boolParam(value) : value);
    }
    if (sets.length === 0) return;

    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(
      `UPDATE salary_structures SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async softDeleteStructure(id: number, userId: number): Promise<void> {
    await this.query(
      'UPDATE salary_structures SET deleted_at = NOW(), updated_by = ? WHERE id = ? AND deleted_at IS NULL',
      [userId, id],
    );
  }

  /** Live compensation rows pinned to a structure, blocking its removal. */
  async countSalariesForStructure(structureId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM employee_salary
       WHERE structure_id = ? AND deleted_at IS NULL AND status IN ('ACTIVE', 'APPROVED')`,
      [structureId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /** Replaces the whole line set for a structure. Caller supplies the txn. */
  async replaceStructureLines(
    structureId: number,
    lines: SalaryStructureLineInput[],
    conn: any,
  ): Promise<void> {
    await conn.query('DELETE FROM salary_structure_lines WHERE structure_id = ?', [structureId]);
    let order = 10;
    for (const line of lines) {
      await conn.query(
        `INSERT INTO salary_structure_lines
           (structure_id, component_id, calculation_type, percent_of, amount,
            percent_value, min_amount, max_amount, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          structureId,
          line.componentId,
          line.calculationType ?? null,
          line.percentOf ?? null,
          nullableNumber(line.amount),
          nullableNumber(line.percentValue),
          nullableNumber(line.minAmount),
          nullableNumber(line.maxAmount),
          Math.floor(Number(line.displayOrder ?? order)),
        ],
      );
      order += 10;
    }
  }

  /** Copies a structure header and every line under a new code/name. */
  async cloneStructure(
    sourceId: number,
    newCode: string,
    newName: string,
    userId: number,
  ): Promise<number> {
    return this.transaction(async (conn) => {
      const source = await this.findStructureRowById(sourceId, conn);
      if (!source) throw new Error('Salary structure not found');

      const newId = await this.createStructure(
        {
          code: newCode,
          name: newName,
          description: source.description,
          currency: source.currency,
          country: source.country,
          grade: source.grade,
          designation: source.designation,
          department: source.department,
          branch: source.branch,
          workerType: source.worker_type,
          effectiveFrom: toDateString(source.effective_from),
          effectiveTo: source.effective_to ? toDateString(source.effective_to) : null,
          isActive: !!source.is_active,
        },
        userId,
        conn,
      );

      await conn.query(
        `INSERT INTO salary_structure_lines
           (structure_id, component_id, calculation_type, percent_of, amount,
            percent_value, min_amount, max_amount, display_order)
         SELECT ?, component_id, calculation_type, percent_of, amount,
                percent_value, min_amount, max_amount, display_order
         FROM salary_structure_lines WHERE structure_id = ?`,
        [newId, sourceId],
      );

      return newId;
    });
  }

  // -------------------------------------------------------------------------
  // Employee compensation & revisions
  // -------------------------------------------------------------------------
  private readonly SALARY_SELECT = `
    SELECT es.*, e.full_name AS employee_name, e.emp_code AS emp_code,
           s.code AS structure_code, s.name AS structure_name,
           u.name AS approved_by_name
    FROM employee_salary es
    JOIN employees e ON e.id = es.employee_id
    LEFT JOIN salary_structures s ON s.id = es.structure_id
    LEFT JOIN users u ON u.id = es.approved_by
  `;

  /** The revision whose window covers `onDate` (defaults to today). */
  async findCurrentSalary(employeeId: number, onDate: string): Promise<EmployeeSalaryResponse | null> {
    const rows = await this.query<any[]>(
      `${this.SALARY_SELECT}
       WHERE es.employee_id = ? AND es.deleted_at IS NULL
         AND es.status IN ('ACTIVE', 'APPROVED')
         AND es.effective_from <= ?
         AND (es.effective_to IS NULL OR es.effective_to >= ?)
       ORDER BY es.effective_from DESC, es.id DESC
       LIMIT 1`,
      [employeeId, onDate, onDate],
    );
    return rows[0] ? this.salaryToResponse(rows[0]) : null;
  }

  async findSalaryHistory(employeeId: number): Promise<EmployeeSalaryResponse[]> {
    const rows = await this.query<any[]>(
      `${this.SALARY_SELECT}
       WHERE es.employee_id = ? AND es.deleted_at IS NULL
       ORDER BY es.effective_from DESC, es.id DESC
       LIMIT 500`,
      [employeeId],
    );
    return rows.map((r) => this.salaryToResponse(r));
  }

  async findSalaryById(id: number): Promise<EmployeeSalaryResponse | null> {
    const rows = await this.query<any[]>(
      `${this.SALARY_SELECT} WHERE es.id = ? AND es.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.salaryToResponse(rows[0]) : null;
  }

  async findSalaryRowById(id: number, conn?: any): Promise<any | null> {
    const sql = 'SELECT * FROM employee_salary WHERE id = ? AND deleted_at IS NULL';
    if (conn) {
      const [rows] = await conn.query(sql, [id]);
      return (rows as any[])[0] || null;
    }
    const rows = await this.query<any[]>(sql, [id]);
    return rows[0] || null;
  }

  /** Newest revision by effective date, locked when a connection is supplied. */
  async findLatestRevisionRow(employeeId: number, conn?: any): Promise<any | null> {
    const base = `SELECT * FROM employee_salary
                  WHERE employee_id = ? AND deleted_at IS NULL AND status <> 'REJECTED'
                  ORDER BY effective_from DESC, id DESC LIMIT 1`;
    if (conn) {
      const [rows] = await conn.query(`${base} FOR UPDATE`, [employeeId]);
      return (rows as any[])[0] || null;
    }
    const rows = await this.query<any[]>(base, [employeeId]);
    return rows[0] || null;
  }

  async closeRevision(id: number, effectiveTo: string, conn: any): Promise<void> {
    await conn.query(
      `UPDATE employee_salary
       SET effective_to = ?, status = 'SUPERSEDED'
       WHERE id = ? AND deleted_at IS NULL`,
      [effectiveTo, id],
    );
  }

  async insertRevision(
    employeeId: number,
    data: CreateRevisionInput,
    userId: number,
    conn: any,
  ): Promise<number> {
    const [result] = await conn.query(
      `INSERT INTO employee_salary
         (employee_id, structure_id, currency, annual_ctc, monthly_gross, effective_from,
          effective_to, revision_type, revision_reason, previous_ctc, change_pct, status,
          created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employeeId,
        data.structureId ?? null,
        data.currency ?? 'INR',
        nullableNumber(data.annualCtc),
        nullableNumber(data.monthlyGross),
        data.effectiveFrom,
        null,
        data.revisionType ?? 'INITIAL',
        data.revisionReason ?? null,
        nullableNumber(data.previousCtc),
        nullableNumber(data.changePct),
        data.status ?? 'ACTIVE',
        userId,
        userId,
      ],
    );
    return Number((result as any).insertId);
  }

  async insertSalaryComponents(
    salaryId: number,
    components: EmployeeSalaryComponentInput[],
    conn: any,
  ): Promise<void> {
    for (const c of components) {
      await conn.query(
        `INSERT INTO employee_salary_components
           (employee_salary_id, component_id, amount, percent_value, calculation_type, percent_of)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE amount = VALUES(amount), percent_value = VALUES(percent_value),
           calculation_type = VALUES(calculation_type), percent_of = VALUES(percent_of)`,
        [
          salaryId,
          c.componentId,
          nullableNumber(c.amount),
          nullableNumber(c.percentValue),
          c.calculationType ?? null,
          c.percentOf ?? null,
        ],
      );
    }
  }

  async findSalaryComponents(salaryId: number): Promise<EmployeeSalaryComponentResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT esc.*, c.code AS component_code, c.name AS component_name,
              c.component_type, c.category, c.display_order
       FROM employee_salary_components esc
       JOIN pay_components c ON c.id = esc.component_id
       WHERE esc.employee_salary_id = ?
       ORDER BY c.display_order ASC, c.code ASC`,
      [salaryId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      componentId: Number(r.component_id),
      componentCode: r.component_code,
      componentName: r.component_name,
      componentType: r.component_type,
      category: r.category,
      amount: r.amount === null ? null : Number(r.amount),
      percentValue: r.percent_value === null ? null : Number(r.percent_value),
      calculationType: r.calculation_type ?? null,
      percentOf: r.percent_of ?? null,
    }));
  }

  async setRevisionStatus(
    id: number,
    status: RevisionStatus,
    userId: number,
    reason: string | null,
  ): Promise<void> {
    const sets = ['status = ?', 'updated_by = ?'];
    const params: any[] = [status, userId];

    if (status === 'APPROVED' || status === 'ACTIVE') {
      sets.push('approved_by = ?', 'approved_at = NOW()');
      params.push(userId);
    }
    if (reason) {
      sets.push("revision_reason = TRIM(BOTH ' | ' FROM CONCAT(COALESCE(revision_reason, ''), ' | ', ?))");
      params.push(reason);
    }
    params.push(id);
    await this.query(
      `UPDATE employee_salary SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  /** Minimal employee lookup so this repository stays self-contained. */
  async findEmployeeBrief(
    employeeId: number,
    conn?: any,
  ): Promise<{ id: number; fullName: string; empCode: string; workStatus: string } | null> {
    const sql = `SELECT id, full_name, emp_code, work_status
                 FROM employees WHERE id = ? AND deleted_at IS NULL`;
    let rows: any[];
    if (conn) {
      const [result] = await conn.query(sql, [employeeId]);
      rows = result as any[];
    } else {
      rows = await this.query<any[]>(sql, [employeeId]);
    }
    const row = rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      fullName: row.full_name,
      empCode: row.emp_code,
      workStatus: row.work_status,
    };
  }

  // -------------------------------------------------------------------------
  // Pay cycles
  // -------------------------------------------------------------------------
  async findCycles(isActive?: boolean): Promise<PayCycleResponse[]> {
    let sql = 'SELECT * FROM pay_cycles WHERE deleted_at IS NULL';
    const params: any[] = [];
    if (isActive !== undefined) {
      sql += ' AND is_active = ?';
      params.push(boolParam(isActive));
    }
    sql += ' ORDER BY is_default DESC, code ASC LIMIT 200';
    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.cycleToResponse(r));
  }

  async findCycleById(id: number): Promise<PayCycleResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM pay_cycles WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.cycleToResponse(rows[0]) : null;
  }

  async findCycleByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM pay_cycles WHERE code = ? AND deleted_at IS NULL',
      [code],
    );
    return rows[0] || null;
  }

  async createCycle(data: PayCycleInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO pay_cycles
         (code, name, frequency, currency, country, company, branch, cycle_start_day,
          cutoff_day, pay_day, rounding_mode, rounding_precision, lop_basis,
          fixed_days_per_month, is_default, is_active, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, ?, ?, ?)`,
      [
        data.code,
        data.name,
        data.frequency ?? 'MONTHLY',
        data.currency ?? 'INR',
        data.country ?? 'IN',
        data.company ?? null,
        data.branch ?? null,
        Math.floor(Number(data.cycleStartDay ?? 1)),
        nullableNumber(data.cutoffDay),
        nullableNumber(data.payDay),
        data.roundingMode ?? 'NEAREST',
        Math.floor(Number(data.roundingPrecision ?? 0)),
        data.lopBasis ?? 'CALENDAR_DAYS',
        nullableNumber(data.fixedDaysPerMonth),
        boolParam(data.isActive ?? true),
        userId,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateCycle(id: number, data: PayCycleInput, userId: number): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(CYCLE_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      if (key === 'isActive') params.push(boolParam(value));
      else if (['cutoffDay', 'payDay', 'fixedDaysPerMonth'].includes(key)) params.push(nullableNumber(value));
      else params.push(value);
    }
    if (sets.length === 0) return;

    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(
      `UPDATE pay_cycles SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async softDeleteCycle(id: number, userId: number): Promise<void> {
    await this.query(
      'UPDATE pay_cycles SET deleted_at = NOW(), updated_by = ? WHERE id = ? AND deleted_at IS NULL',
      [userId, id],
    );
  }

  /** Exactly one cycle carries the default flag; both writes share a txn. */
  async setDefaultCycle(id: number, userId: number): Promise<void> {
    await this.transaction(async (conn) => {
      await conn.query('UPDATE pay_cycles SET is_default = false WHERE deleted_at IS NULL AND id <> ?', [id]);
      await conn.query(
        'UPDATE pay_cycles SET is_default = true, updated_by = ? WHERE id = ? AND deleted_at IS NULL',
        [userId, id],
      );
    });
  }

  async countPeriodsForCycle(cycleId: number): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT COUNT(*) AS cnt FROM salary_periods WHERE cycle_id = ? AND deleted_at IS NULL',
      [cycleId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  // -------------------------------------------------------------------------
  // Mappers
  // -------------------------------------------------------------------------
  private componentToResponse(r: any): PayComponentResponse {
    return {
      id: Number(r.id),
      code: r.code,
      name: r.name,
      componentType: r.component_type,
      category: r.category,
      calculationType: r.calculation_type,
      percentOf: r.percent_of ?? null,
      defaultValue: r.default_value === null || r.default_value === undefined ? null : Number(r.default_value),
      defaultPercent: r.default_percent === null || r.default_percent === undefined ? null : Number(r.default_percent),
      formula: r.formula ?? null,
      isTaxable: !!r.is_taxable,
      isPfApplicable: !!r.is_pf_applicable,
      isEsiApplicable: !!r.is_esi_applicable,
      isProrated: !!r.is_prorated,
      affectsGross: !!r.affects_gross,
      isStatutory: !!r.is_statutory,
      isSystem: !!r.is_system,
      displayOrder: Number(r.display_order ?? 100),
      isActive: !!r.is_active,
    };
  }

  private structureToResponse(r: any): SalaryStructureResponse {
    const out: SalaryStructureResponse = {
      id: Number(r.id),
      code: r.code,
      name: r.name,
      description: r.description ?? null,
      currency: r.currency,
      country: r.country,
      grade: r.grade ?? null,
      designation: r.designation ?? null,
      department: r.department ?? null,
      branch: r.branch ?? null,
      workerType: r.worker_type ?? null,
      effectiveFrom: toDateString(r.effective_from),
      effectiveTo: r.effective_to ? toDateString(r.effective_to) : null,
      isActive: !!r.is_active,
    };
    if (r.line_count !== undefined) out.lineCount = Number(r.line_count);
    return out;
  }

  private structureLineToResponse(r: any): SalaryStructureLineResponse {
    return {
      id: Number(r.id),
      structureId: Number(r.structure_id),
      componentId: Number(r.component_id),
      componentCode: r.component_code,
      componentName: r.component_name,
      componentType: r.component_type,
      category: r.category,
      // A line may defer to the component's own calculation settings.
      calculationType: r.calculation_type ?? r.component_calculation_type ?? null,
      percentOf: r.percent_of ?? r.component_percent_of ?? null,
      amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
      percentValue:
        r.percent_value === null || r.percent_value === undefined ? null : Number(r.percent_value),
      minAmount: r.min_amount === null || r.min_amount === undefined ? null : Number(r.min_amount),
      maxAmount: r.max_amount === null || r.max_amount === undefined ? null : Number(r.max_amount),
      displayOrder: Number(r.display_order ?? 100),
    };
  }

  private salaryToResponse(r: any): EmployeeSalaryResponse {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      empCode: r.emp_code ?? null,
      structureId: r.structure_id === null || r.structure_id === undefined ? null : Number(r.structure_id),
      structureCode: r.structure_code ?? null,
      structureName: r.structure_name ?? null,
      currency: r.currency,
      annualCtc: r.annual_ctc === null || r.annual_ctc === undefined ? null : Number(r.annual_ctc),
      monthlyGross:
        r.monthly_gross === null || r.monthly_gross === undefined ? null : Number(r.monthly_gross),
      effectiveFrom: toDateString(r.effective_from),
      effectiveTo: r.effective_to ? toDateString(r.effective_to) : null,
      revisionType: r.revision_type,
      revisionReason: r.revision_reason ?? null,
      previousCtc: r.previous_ctc === null || r.previous_ctc === undefined ? null : Number(r.previous_ctc),
      changePct: r.change_pct === null || r.change_pct === undefined ? null : Number(r.change_pct),
      status: r.status,
      approvedBy: r.approved_by_name ?? null,
      approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  private cycleToResponse(r: any): PayCycleResponse {
    return {
      id: Number(r.id),
      code: r.code,
      name: r.name,
      frequency: r.frequency,
      currency: r.currency,
      country: r.country,
      company: r.company ?? null,
      branch: r.branch ?? null,
      cycleStartDay: Number(r.cycle_start_day ?? 1),
      cutoffDay: r.cutoff_day === null || r.cutoff_day === undefined ? null : Number(r.cutoff_day),
      payDay: r.pay_day === null || r.pay_day === undefined ? null : Number(r.pay_day),
      roundingMode: r.rounding_mode,
      roundingPrecision: Number(r.rounding_precision ?? 0),
      lopBasis: r.lop_basis,
      fixedDaysPerMonth:
        r.fixed_days_per_month === null || r.fixed_days_per_month === undefined
          ? null
          : Number(r.fixed_days_per_month),
      isDefault: !!r.is_default,
      isActive: !!r.is_active,
    };
  }
}
