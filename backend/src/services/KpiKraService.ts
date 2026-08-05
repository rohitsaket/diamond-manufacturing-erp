import { KpiKraRepository, KpiAssignmentFilters, EmployeeKraFilters } from '../repositories/KpiKraRepository';
import { PerformanceCycleRepository } from '../repositories/PerformanceCycleRepository';
import {
  EmployeeKraResponse,
  KpiAssignmentResponse,
  KpiResponse,
  KraResponse,
  PerfActionContext,
} from '../types/performance';
import { maxDate, minDate, monthBounds, round2, toDateString } from '../utils/dateUtils';
import { evaluateFormula, num } from '../utils/payrollMath';
import { isStaffRole, PerfActor } from './GoalService';
import { NotificationService } from './NotificationService';
import { PerfAuditService } from './PerfAuditService';

const KPI_CATEGORIES = new Set(['PRODUCTION', 'QUALITY', 'ATTENDANCE', 'FINANCE', 'PEOPLE', 'CUSTOM']);
const KPI_DIRECTIONS = new Set(['HIGHER_BETTER', 'LOWER_BETTER', 'TARGET_BAND']);
const KPI_SOURCES = new Set(['NONE', 'PRODUCTION_PIECES', 'PRODUCTION_VALUE', 'ATTENDANCE_PCT', 'OT_HOURS']);
const SCOPES = new Set(['INDIVIDUAL', 'TEAM', 'DEPARTMENT', 'ORGANIZATION']);
const PERIOD_KEY = /^\d{4}-\d{2}$/;

/** Units whose monthly values average rather than sum into the actual. */
function unitAverages(unit: string | null): boolean {
  const u = String(unit ?? '').trim().toLowerCase();
  return u === '%' || u === 'score';
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return num(value);
}

export function toKpiResponse(row: any): KpiResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    category: row.category,
    unit: row.unit ?? null,
    direction: row.direction,
    formula: row.formula ?? null,
    autoSource: row.auto_source,
    isActive: !!row.is_active,
  };
}

export function toKpiAssignmentResponse(row: any): KpiAssignmentResponse {
  return {
    id: row.id,
    kpiId: row.kpi_id,
    kpiCode: row.kpi_code,
    kpiName: row.kpi_name,
    unit: row.kpi_unit ?? null,
    direction: row.kpi_direction,
    autoSource: row.kpi_auto_source,
    cycleId: row.cycle_id,
    scope: row.scope,
    employeeId: row.employee_id ?? null,
    employeeName: row.employee_name ?? null,
    teamId: row.team_id ?? null,
    departmentId: row.department_id ?? null,
    departmentName: row.department_name ?? null,
    weightagePct: num(row.weightage_pct),
    targetValue: numOrNull(row.target_value),
    thresholdValue: numOrNull(row.threshold_value),
    stretchValue: numOrNull(row.stretch_value),
    actualValue: numOrNull(row.actual_value),
    achievementPct: numOrNull(row.achievement_pct),
    score: numOrNull(row.score),
    lastComputedAt: isoOrNull(row.last_computed_at),
    status: row.status,
  };
}

export function toKraResponse(row: any): KraResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    departmentId: row.department_id ?? null,
    departmentName: row.department_name ?? null,
    defaultWeightagePct: num(row.default_weightage_pct),
    isActive: !!row.is_active,
  };
}

export function toEmployeeKraResponse(row: any): EmployeeKraResponse {
  return {
    id: row.id,
    kraId: row.kra_id,
    kraCode: row.kra_code,
    kraName: row.kra_name,
    employeeId: row.employee_id,
    employeeName: row.employee_name ?? null,
    cycleId: row.cycle_id,
    weightagePct: num(row.weightage_pct),
    selfScore: numOrNull(row.self_score),
    managerScore: numOrNull(row.manager_score),
    finalScore: numOrNull(row.final_score),
    remarks: row.remarks ?? null,
    status: row.status,
  };
}

/**
 * achievementPct: actual/target x 100 (LOWER_BETTER inverts to target/actual,
 * TARGET_BAND penalises distance from the target), clamped 0-200.
 */
export function computeAchievementPct(
  direction: string,
  actual: number | null,
  target: number | null,
): number | null {
  if (actual === null || target === null) return null;
  let pct: number;
  if (direction === 'LOWER_BETTER') {
    if (actual === 0) pct = target > 0 ? 200 : 100; // zero actual is the best a lower-is-better KPI gets
    else pct = (target / actual) * 100;
  } else if (direction === 'TARGET_BAND') {
    if (target === 0) return null;
    pct = 100 - (Math.abs(actual - target) / Math.abs(target)) * 100;
  } else {
    if (target === 0) return null;
    pct = (actual / target) * 100;
  }
  return round2(Math.min(200, Math.max(0, pct)));
}

/**
 * KPI library, assignments, tracked values, the auto-compute engine, and the
 * KRA library with per-employee scoring.
 */
export class KpiKraService {
  private repo = new KpiKraRepository();
  private cycles = new PerformanceCycleRepository();
  private audit = new PerfAuditService();
  private notifications = new NotificationService();

  // ==========================================================================
  // KPI library
  // ==========================================================================

  async listKpis(): Promise<KpiResponse[]> {
    const rows = await this.repo.findKpis();
    return rows.map(toKpiResponse);
  }

  async createKpi(input: any, ctx: PerfActionContext): Promise<KpiResponse> {
    if (!input?.code || !input?.name) throw new Error('code and name are required');
    const existing = await this.repo.findKpiByCode(String(input.code).trim());
    if (existing) throw new Error(`A KPI with code "${input.code}" already exists`);
    this.validateKpiFields(input);

    const id = await this.repo.insertKpi({
      code: String(input.code).trim(),
      name: String(input.name).trim(),
      description: input.description ?? null,
      category: input.category ?? 'CUSTOM',
      unit: input.unit ?? null,
      direction: input.direction ?? 'HIGHER_BETTER',
      formula: input.formula ?? null,
      auto_source: input.autoSource ?? 'NONE',
      is_active: input.isActive === undefined ? true : !!input.isActive,
      created_by: ctx.userId,
    });
    await this.audit.record('KPI', id, 'CREATE', ctx, null, input);
    const row = await this.repo.findKpiById(id);
    return toKpiResponse(row);
  }

  async updateKpi(id: number, input: any, ctx: PerfActionContext): Promise<KpiResponse> {
    const before = await this.repo.findKpiById(id);
    if (!before) throw new Error(`KPI ${id} was not found`);
    this.validateKpiFields(input);

    const fields: Record<string, any> = {};
    if (input.name !== undefined) fields.name = String(input.name).trim();
    if (input.description !== undefined) fields.description = input.description;
    if (input.category !== undefined) fields.category = input.category;
    if (input.unit !== undefined) fields.unit = input.unit;
    if (input.direction !== undefined) fields.direction = input.direction;
    if (input.formula !== undefined) fields.formula = input.formula;
    if (input.autoSource !== undefined) fields.auto_source = input.autoSource;
    if (input.isActive !== undefined) fields.is_active = !!input.isActive;
    if (Object.keys(fields).length === 0) throw new Error('No updatable fields were provided');

    await this.repo.updateKpi(id, fields);
    await this.audit.record('KPI', id, 'UPDATE', ctx, toKpiResponse(before), input);
    const row = await this.repo.findKpiById(id);
    return toKpiResponse(row);
  }

  private validateKpiFields(input: any): void {
    if (input.category !== undefined && !KPI_CATEGORIES.has(input.category)) {
      throw new Error(`Invalid KPI category "${input.category}"`);
    }
    if (input.direction !== undefined && !KPI_DIRECTIONS.has(input.direction)) {
      throw new Error(`Invalid KPI direction "${input.direction}"`);
    }
    if (input.autoSource !== undefined && !KPI_SOURCES.has(input.autoSource)) {
      throw new Error(`Invalid KPI autoSource "${input.autoSource}"`);
    }
    // A formula is data run through the safe expression parser — never eval.
    // Reject anything the grammar cannot parse, using a dummy variable map.
    if (input.formula !== undefined && input.formula !== null && String(input.formula).trim() !== '') {
      try {
        evaluateFormula(String(input.formula), { ACTUAL: 1, TARGET: 1, VALUE: 1, WEIGHT: 1 });
      } catch (err: any) {
        throw new Error(`Invalid KPI formula: ${err.message}`);
      }
    }
  }

  // ==========================================================================
  // KPI assignments
  // ==========================================================================

  async listAssignments(filters: KpiAssignmentFilters): Promise<KpiAssignmentResponse[]> {
    const rows = await this.repo.findAssignments(filters);
    return rows.map(toKpiAssignmentResponse);
  }

  async myKpis(employeeId: number | null, cycleId?: number): Promise<KpiAssignmentResponse[]> {
    if (!employeeId) {
      throw new Error('This account is not linked to an employee record, so it has no KPI assignments');
    }
    return this.listAssignments({ employeeId, cycleId });
  }

  async createAssignment(input: any, ctx: PerfActionContext): Promise<KpiAssignmentResponse> {
    if (!input?.kpiId || !input?.cycleId) throw new Error('kpiId and cycleId are required');
    const kpi = await this.repo.findKpiById(Number(input.kpiId));
    if (!kpi) throw new Error(`KPI ${input.kpiId} was not found`);
    const cycle = await this.cycles.findById(Number(input.cycleId));
    if (!cycle) throw new Error(`Performance cycle ${input.cycleId} was not found`);

    const scope = input.scope ?? 'INDIVIDUAL';
    if (!SCOPES.has(scope)) throw new Error(`Invalid scope "${scope}"`);
    const employeeId = input.employeeId ? Number(input.employeeId) : null;
    const teamId = input.teamId ? Number(input.teamId) : null;
    const departmentId = input.departmentId ? Number(input.departmentId) : null;
    if (scope === 'INDIVIDUAL' && !employeeId) throw new Error('An INDIVIDUAL assignment requires an employeeId');
    if (scope === 'TEAM' && !teamId) throw new Error('A TEAM assignment requires a teamId');
    if (scope === 'DEPARTMENT' && !departmentId) throw new Error('A DEPARTMENT assignment requires a departmentId');

    const weightagePct = input.weightagePct === undefined ? 100 : num(input.weightagePct);
    if (weightagePct < 0 || weightagePct > 100) throw new Error('weightagePct must be between 0 and 100');

    // The unique key cannot police nullable scope columns (MySQL never
    // dedupes NULLs), so the duplicate check lives here.
    const duplicate = await this.repo.findDuplicateAssignment(
      Number(input.kpiId),
      Number(input.cycleId),
      scope,
      employeeId,
      teamId,
      departmentId,
    );
    if (duplicate) {
      throw new Error(`KPI "${kpi.code}" is already assigned to this ${scope.toLowerCase()} for the cycle`);
    }

    const id = await this.repo.insertAssignment({
      kpi_id: Number(input.kpiId),
      cycle_id: Number(input.cycleId),
      scope,
      employee_id: employeeId,
      team_id: teamId,
      department_id: departmentId,
      weightage_pct: weightagePct,
      target_value: input.targetValue ?? null,
      threshold_value: input.thresholdValue ?? null,
      stretch_value: input.stretchValue ?? null,
      created_by: ctx.userId,
    });
    await this.audit.record('KPI_ASSIGNMENT', id, 'CREATE', ctx, null, input);
    const row = await this.repo.findAssignmentById(id);
    return toKpiAssignmentResponse(row);
  }

  async updateAssignment(id: number, input: any, ctx: PerfActionContext): Promise<KpiAssignmentResponse> {
    const before = await this.repo.findAssignmentById(id);
    if (!before) throw new Error(`KPI assignment ${id} was not found`);

    const fields: Record<string, any> = {};
    if (input.weightagePct !== undefined) {
      const w = num(input.weightagePct);
      if (w < 0 || w > 100) throw new Error('weightagePct must be between 0 and 100');
      fields.weightage_pct = w;
    }
    if (input.targetValue !== undefined) fields.target_value = input.targetValue;
    if (input.thresholdValue !== undefined) fields.threshold_value = input.thresholdValue;
    if (input.stretchValue !== undefined) fields.stretch_value = input.stretchValue;
    if (input.status !== undefined) {
      if (!['ACTIVE', 'CLOSED'].includes(input.status)) throw new Error(`Invalid status "${input.status}"`);
      fields.status = input.status;
    }
    if (Object.keys(fields).length === 0) throw new Error('No updatable fields were provided');

    await this.repo.updateAssignment(id, fields);
    if (fields.target_value !== undefined || fields.weightage_pct !== undefined) {
      await this.recomputeAssignment(id);
    }
    await this.audit.record('KPI_ASSIGNMENT', id, 'UPDATE', ctx, toKpiAssignmentResponse(before), input);
    const row = await this.repo.findAssignmentById(id);
    return toKpiAssignmentResponse(row);
  }

  async deleteAssignment(id: number, ctx: PerfActionContext): Promise<void> {
    const before = await this.repo.findAssignmentById(id);
    if (!before) throw new Error(`KPI assignment ${id} was not found`);
    await this.repo.softDeleteAssignment(id);
    await this.audit.record('KPI_ASSIGNMENT', id, 'DELETE', ctx, toKpiAssignmentResponse(before), null);
  }

  // ==========================================================================
  // Values & scoring
  // ==========================================================================

  async recordValue(
    id: number,
    input: { periodKey?: string; value?: number; note?: string | null },
    ctx: PerfActionContext,
  ): Promise<KpiAssignmentResponse> {
    const assignment = await this.repo.findAssignmentById(id);
    if (!assignment) throw new Error(`KPI assignment ${id} was not found`);
    if (!input.periodKey || !PERIOD_KEY.test(String(input.periodKey))) {
      throw new Error('periodKey must look like 2026-07');
    }
    if (input.value === undefined || input.value === null || Number.isNaN(Number(input.value))) {
      throw new Error('A numeric value is required');
    }

    await this.repo.upsertValue(id, String(input.periodKey), num(input.value), 'MANUAL', input.note ?? null, ctx.userId);
    await this.recomputeAssignment(id);
    await this.audit.record('KPI_ASSIGNMENT', id, 'VALUE_RECORDED', ctx, null, {
      periodKey: input.periodKey,
      value: num(input.value),
      note: input.note ?? null,
    });
    const row = await this.repo.findAssignmentById(id);
    return toKpiAssignmentResponse(row);
  }

  async listValues(assignmentId: number): Promise<any[]> {
    const assignment = await this.repo.findAssignmentById(assignmentId);
    if (!assignment) throw new Error(`KPI assignment ${assignmentId} was not found`);
    const rows = await this.repo.findValues(assignmentId);
    return rows.map((r) => ({
      id: r.id,
      assignmentId: r.assignment_id,
      periodKey: r.period_key,
      value: num(r.value),
      source: r.source,
      note: r.note ?? null,
      createdAt: isoOrNull(r.created_at),
    }));
  }

  /**
   * Rebuild the assignment's aggregate from its tracked values: percentages
   * and scores average, counts and amounts sum. Then re-derive achievement
   * and score.
   */
  private async recomputeAssignment(id: number): Promise<void> {
    const assignment = await this.repo.findAssignmentById(id);
    if (!assignment) return;
    const values = await this.repo.findValues(id);
    if (values.length === 0) return;

    const nums = values.map((v) => num(v.value));
    const sum = nums.reduce((s, v) => s + v, 0);
    const actual = round2(unitAverages(assignment.kpi_unit) ? sum / nums.length : sum);
    await this.applyActual(assignment, actual);
  }

  private async applyActual(assignmentRow: any, actual: number): Promise<void> {
    const target = numOrNull(assignmentRow.target_value);
    const achievement = computeAchievementPct(assignmentRow.kpi_direction, actual, target);
    const score = achievement === null ? null : round2((achievement / 100) * num(assignmentRow.weightage_pct));
    await this.repo.updateAssignment(assignmentRow.id, {
      actual_value: actual,
      achievement_pct: achievement,
      score,
      last_computed_at: new Date(),
    });
  }

  // ==========================================================================
  // Auto-compute engine
  // ==========================================================================

  /**
   * Fill every ACTIVE auto-sourced assignment of a cycle from live ERP data.
   * The window is the cycle span, intersected with the periodKey month when
   * one is given. Anything that cannot be computed is skipped with a reason —
   * never silently, never with an invented number.
   */
  async computeAssignments(
    input: { cycleId?: number; periodKey?: string },
    ctx: PerfActionContext,
  ): Promise<{ computed: number; skipped: { assignmentId: number; reason: string }[] }> {
    if (!input.cycleId) throw new Error('cycleId is required');
    const cycle = await this.cycles.findById(Number(input.cycleId));
    if (!cycle) throw new Error(`Performance cycle ${input.cycleId} was not found`);

    let from = toDateString(cycle.start_date);
    let to = toDateString(cycle.end_date);
    if (input.periodKey !== undefined && input.periodKey !== null && input.periodKey !== '') {
      if (!PERIOD_KEY.test(String(input.periodKey))) throw new Error('periodKey must look like 2026-07');
      const bounds = monthBounds(String(input.periodKey));
      from = maxDate(from, bounds.from);
      to = minDate(to, bounds.to);
      if (from > to) {
        throw new Error(`periodKey ${input.periodKey} lies entirely outside the cycle window ${toDateString(cycle.start_date)}..${toDateString(cycle.end_date)}`);
      }
    }

    const assignments = await this.repo.findAutoAssignments(Number(input.cycleId));
    let computed = 0;
    const skipped: { assignmentId: number; reason: string }[] = [];

    for (const a of assignments) {
      try {
        const employeeIds = await this.resolveEmployees(a);
        if (typeof employeeIds === 'string') {
          skipped.push({ assignmentId: a.id, reason: employeeIds });
          continue;
        }

        let value: number | null = null;
        switch (a.kpi_auto_source) {
          case 'PRODUCTION_PIECES': {
            const agg = await this.repo.productionAggregate(employeeIds, from, to);
            value = agg.pieces;
            break;
          }
          case 'PRODUCTION_VALUE': {
            const agg = await this.repo.productionAggregate(employeeIds, from, to);
            value = round2(agg.value);
            break;
          }
          case 'ATTENDANCE_PCT': {
            const agg = await this.repo.attendanceAggregate(employeeIds, from, to);
            if (agg.expected === 0) {
              skipped.push({ assignmentId: a.id, reason: `no attendance records in the window ${from}..${to}` });
              continue;
            }
            value = round2((agg.worked / agg.expected) * 100);
            break;
          }
          case 'OT_HOURS': {
            const agg = await this.repo.attendanceAggregate(employeeIds, from, to);
            value = round2(agg.otHours);
            break;
          }
          default:
            skipped.push({ assignmentId: a.id, reason: `unsupported auto source "${a.kpi_auto_source}"` });
            continue;
        }

        if (input.periodKey) {
          // Month slice: store it as that month's tracked value, then rebuild
          // the aggregate the same way a manual entry would.
          await this.repo.upsertValue(a.id, String(input.periodKey), value, 'AUTO', null, ctx.userId);
          await this.recomputeAssignment(a.id);
        } else {
          // Whole-cycle window: the figure IS the actual.
          await this.applyActual(a, value);
        }
        computed += 1;
      } catch (err: any) {
        skipped.push({ assignmentId: a.id, reason: `compute failed: ${err.message}` });
      }
    }

    await this.audit.record('KPI_COMPUTE', Number(input.cycleId), 'AUTO_COMPUTE', ctx, null, {
      cycleId: Number(input.cycleId),
      periodKey: input.periodKey ?? null,
      window: { from, to },
      computed,
      skipped,
    });
    return { computed, skipped };
  }

  /** Employee set behind an assignment's scope, or a skip reason string. */
  private async resolveEmployees(assignmentRow: any): Promise<number[] | string> {
    switch (assignmentRow.scope) {
      case 'INDIVIDUAL':
        if (!assignmentRow.employee_id) return 'assignment has no employee linked';
        return [Number(assignmentRow.employee_id)];
      case 'TEAM': {
        if (!assignmentRow.team_id) return 'assignment has no team linked';
        const ids = await this.repo.employeeIdsForTeam(Number(assignmentRow.team_id));
        return ids.length > 0 ? ids : 'team has no active working members';
      }
      case 'DEPARTMENT': {
        if (!assignmentRow.department_id) return 'assignment has no department linked';
        const ids = await this.repo.employeeIdsForDepartment(Number(assignmentRow.department_id));
        return ids.length > 0 ? ids : 'no working employees are mapped to this department';
      }
      case 'ORGANIZATION': {
        const ids = await this.repo.allWorkingEmployeeIds();
        return ids.length > 0 ? ids : 'no working employees exist';
      }
      default:
        return `unknown scope "${assignmentRow.scope}"`;
    }
  }

  // ==========================================================================
  // KRA library
  // ==========================================================================

  async listKras(): Promise<KraResponse[]> {
    const rows = await this.repo.findKras();
    return rows.map(toKraResponse);
  }

  async createKra(input: any, ctx: PerfActionContext): Promise<KraResponse> {
    if (!input?.code || !input?.name) throw new Error('code and name are required');
    const existing = await this.repo.findKraByCode(String(input.code).trim());
    if (existing) throw new Error(`A KRA with code "${input.code}" already exists`);
    const weight = input.defaultWeightagePct === undefined ? 25 : num(input.defaultWeightagePct);
    if (weight < 0 || weight > 100) throw new Error('defaultWeightagePct must be between 0 and 100');

    const id = await this.repo.insertKra({
      code: String(input.code).trim(),
      name: String(input.name).trim(),
      description: input.description ?? null,
      department_id: input.departmentId ?? null,
      default_weightage_pct: weight,
      is_active: input.isActive === undefined ? true : !!input.isActive,
      created_by: ctx.userId,
    });
    await this.audit.record('KRA', id, 'CREATE', ctx, null, input);
    const row = await this.repo.findKraById(id);
    return toKraResponse(row);
  }

  async updateKra(id: number, input: any, ctx: PerfActionContext): Promise<KraResponse> {
    const before = await this.repo.findKraById(id);
    if (!before) throw new Error(`KRA ${id} was not found`);

    const fields: Record<string, any> = {};
    if (input.name !== undefined) fields.name = String(input.name).trim();
    if (input.description !== undefined) fields.description = input.description;
    if (input.departmentId !== undefined) fields.department_id = input.departmentId;
    if (input.defaultWeightagePct !== undefined) {
      const w = num(input.defaultWeightagePct);
      if (w < 0 || w > 100) throw new Error('defaultWeightagePct must be between 0 and 100');
      fields.default_weightage_pct = w;
    }
    if (input.isActive !== undefined) fields.is_active = !!input.isActive;
    if (Object.keys(fields).length === 0) throw new Error('No updatable fields were provided');

    await this.repo.updateKra(id, fields);
    await this.audit.record('KRA', id, 'UPDATE', ctx, toKraResponse(before), input);
    const row = await this.repo.findKraById(id);
    return toKraResponse(row);
  }

  // ==========================================================================
  // Employee KRAs
  // ==========================================================================

  async listEmployeeKras(filters: EmployeeKraFilters): Promise<EmployeeKraResponse[]> {
    const rows = await this.repo.findEmployeeKras(filters);
    return rows.map(toEmployeeKraResponse);
  }

  async myKras(employeeId: number | null, cycleId?: number): Promise<EmployeeKraResponse[]> {
    if (!employeeId) {
      throw new Error('This account is not linked to an employee record, so it has no KRA assignments');
    }
    return this.listEmployeeKras({ employeeId, cycleId });
  }

  async assignKra(
    input: { kraId?: number; employeeId?: number; cycleId?: number; weightagePct?: number },
    ctx: PerfActionContext,
  ): Promise<EmployeeKraResponse> {
    if (!input.kraId || !input.employeeId || !input.cycleId) {
      throw new Error('kraId, employeeId and cycleId are required');
    }
    const kra = await this.repo.findKraById(Number(input.kraId));
    if (!kra) throw new Error(`KRA ${input.kraId} was not found`);
    const employee = await this.repo.findEmployeeById(Number(input.employeeId));
    if (!employee) throw new Error(`Employee ${input.employeeId} was not found`);
    const cycle = await this.cycles.findById(Number(input.cycleId));
    if (!cycle) throw new Error(`Performance cycle ${input.cycleId} was not found`);

    const weight = input.weightagePct === undefined ? num(kra.default_weightage_pct) : num(input.weightagePct);
    if (weight < 0 || weight > 100) throw new Error('weightagePct must be between 0 and 100');

    let id: number;
    try {
      id = await this.repo.insertEmployeeKra({
        kra_id: Number(input.kraId),
        employee_id: Number(input.employeeId),
        cycle_id: Number(input.cycleId),
        weightage_pct: weight,
        created_by: ctx.userId,
      });
    } catch (err: any) {
      // uk_employee_kra has no nullable columns, so the DB catches duplicates.
      if (err?.code === 'ER_DUP_ENTRY') {
        throw new Error(`KRA "${kra.code}" is already assigned to ${employee.full_name} for this cycle`);
      }
      throw err;
    }
    await this.audit.record('EMPLOYEE_KRA', id, 'ASSIGN', ctx, null, { ...input, weightagePct: weight });
    const row = await this.repo.findEmployeeKraById(id);
    return toEmployeeKraResponse(row);
  }

  async bulkAssignKras(
    input: { cycleId?: number; employeeIds?: number[]; kraIds?: number[] },
    ctx: PerfActionContext,
  ): Promise<{ created: number; skipped: { employeeId: number; kraId: number; reason: string }[] }> {
    if (!input.cycleId || !Array.isArray(input.employeeIds) || input.employeeIds.length === 0
      || !Array.isArray(input.kraIds) || input.kraIds.length === 0) {
      throw new Error('cycleId, employeeIds[] and kraIds[] are required');
    }
    const cycle = await this.cycles.findById(Number(input.cycleId));
    if (!cycle) throw new Error(`Performance cycle ${input.cycleId} was not found`);

    let created = 0;
    const skipped: { employeeId: number; kraId: number; reason: string }[] = [];
    for (const employeeId of input.employeeIds.map(Number)) {
      const employee = await this.repo.findEmployeeById(employeeId);
      for (const kraId of input.kraIds.map(Number)) {
        if (!employee) {
          skipped.push({ employeeId, kraId, reason: 'employee not found' });
          continue;
        }
        const kra = await this.repo.findKraById(kraId);
        if (!kra) {
          skipped.push({ employeeId, kraId, reason: 'KRA not found' });
          continue;
        }
        const existing = await this.repo.findEmployeeKra(kraId, employeeId, Number(input.cycleId));
        if (existing) {
          skipped.push({ employeeId, kraId, reason: 'already assigned for this cycle' });
          continue;
        }
        const id = await this.repo.insertEmployeeKra({
          kra_id: kraId,
          employee_id: employeeId,
          cycle_id: Number(input.cycleId),
          weightage_pct: num(kra.default_weightage_pct),
          created_by: ctx.userId,
        });
        await this.audit.record('EMPLOYEE_KRA', id, 'ASSIGN', ctx, null, {
          kraId,
          employeeId,
          cycleId: Number(input.cycleId),
        });
        created += 1;
      }
    }
    return { created, skipped };
  }

  async selfScore(
    id: number,
    input: { score?: number; remarks?: string | null },
    actor: PerfActor,
  ): Promise<EmployeeKraResponse> {
    const row = await this.repo.findEmployeeKraById(id);
    if (!row) throw new Error(`Employee KRA ${id} was not found`);
    if (!isStaffRole(actor.userRole) && actor.employeeId !== row.employee_id) {
      throw new Error('You can only self-score your own KRAs');
    }
    if (row.status === 'FINALIZED') throw new Error('This KRA is already FINALIZED');
    const score = this.validScore(input.score);

    await this.repo.updateEmployeeKra(id, {
      self_score: score,
      remarks: input.remarks !== undefined ? input.remarks : row.remarks,
      status: row.status === 'ASSIGNED' || row.status === 'SELF_SCORED' ? 'SELF_SCORED' : row.status,
    });
    await this.audit.record('EMPLOYEE_KRA', id, 'SELF_SCORE', actor, toEmployeeKraResponse(row), {
      score,
      remarks: input.remarks ?? null,
    });
    return toEmployeeKraResponse(await this.repo.findEmployeeKraById(id));
  }

  async managerScore(
    id: number,
    input: { score?: number; remarks?: string | null },
    ctx: PerfActionContext,
  ): Promise<EmployeeKraResponse> {
    const row = await this.repo.findEmployeeKraById(id);
    if (!row) throw new Error(`Employee KRA ${id} was not found`);
    if (row.status === 'FINALIZED') throw new Error('This KRA is already FINALIZED');
    const score = this.validScore(input.score);

    await this.repo.updateEmployeeKra(id, {
      manager_score: score,
      remarks: input.remarks !== undefined ? input.remarks : row.remarks,
      status: 'REVIEWED',
    });
    await this.audit.record('EMPLOYEE_KRA', id, 'MANAGER_SCORE', ctx, toEmployeeKraResponse(row), {
      score,
      remarks: input.remarks ?? null,
    });
    return toEmployeeKraResponse(await this.repo.findEmployeeKraById(id));
  }

  async finalize(
    id: number,
    input: { finalScore?: number },
    ctx: PerfActionContext,
  ): Promise<EmployeeKraResponse> {
    const row = await this.repo.findEmployeeKraById(id);
    if (!row) throw new Error(`Employee KRA ${id} was not found`);
    if (row.status === 'FINALIZED') throw new Error('This KRA is already FINALIZED');

    let finalScore: number;
    if (input.finalScore !== undefined) {
      finalScore = this.validScore(input.finalScore);
    } else {
      const fallback = numOrNull(row.manager_score) ?? numOrNull(row.self_score);
      if (fallback === null) {
        throw new Error('No finalScore was given and neither a manager score nor a self score exists');
      }
      finalScore = fallback;
    }

    await this.repo.updateEmployeeKra(id, { final_score: finalScore, status: 'FINALIZED' });
    await this.audit.record('EMPLOYEE_KRA', id, 'FINALIZE', ctx, toEmployeeKraResponse(row), { finalScore });

    // In-app notification; never fails the write.
    try {
      await this.notifications.notifyEmployee(row.employee_id, {
        category: 'PERFORMANCE' as any,
        title: 'KRA finalized',
        body: `Your KRA "${row.kra_name}" has been finalized with a score of ${finalScore}.`,
        linkPage: 'performance',
        linkRefId: id,
      });
    } catch (err) {
      console.error(`KRA notification failed for employee_kra #${id}:`, err);
    }
    return toEmployeeKraResponse(await this.repo.findEmployeeKraById(id));
  }

  private validScore(score: unknown): number {
    if (score === undefined || score === null || Number.isNaN(Number(score))) {
      throw new Error('A numeric score is required');
    }
    const s = Number(score);
    if (s < 0 || s > 5) throw new Error('Scores use a 0-5 scale');
    return round2(s);
  }
}
