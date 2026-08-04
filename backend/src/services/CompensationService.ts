import {
  CompensationRepository,
  ComponentFilters,
  CreateRevisionInput,
  EmployeeSalaryComponentInput,
  EmployeeSalaryResponse,
  PayComponentInput,
  PayComponentResponse,
  PayCycleInput,
  PayCycleResponse,
  SalaryStructureInput,
  SalaryStructureLineInput,
  SalaryStructureResponse,
  StructureFilters,
} from '../repositories/CompensationRepository';
import {
  OvertimeRuleInput,
  OvertimeRuleResponse,
  PayAwardRepository,
} from '../repositories/PayAwardRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { NotificationService } from './NotificationService';
import { addDays, isValidDateString, round2, todayString } from '../utils/dateUtils';

const COMPONENT_TYPES = ['EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION', 'REIMBURSEMENT'];
const COMPONENT_CATEGORIES = [
  'BASIC', 'ALLOWANCE', 'BONUS', 'INCENTIVE', 'VARIABLE_PAY', 'OVERTIME', 'ARREARS',
  'STATUTORY', 'LOAN', 'ATTENDANCE', 'REIMBURSEMENT', 'OTHER',
];
const CALCULATION_TYPES = [
  'FIXED', 'PERCENT_OF', 'FORMULA', 'ATTENDANCE_BASED', 'SLAB', 'PIECE_RATE', 'MANUAL',
];
const PERCENT_BASES = ['BASIC', 'GROSS', 'CTC', 'NET'];
const WORKER_TYPES = ['PIECE_RATE', 'DHAR', 'MAXI'];
const FREQUENCIES = ['MONTHLY', 'WEEKLY', 'BI_WEEKLY', 'DAILY', 'SEMI_MONTHLY'];
const ROUNDING_MODES = ['NONE', 'NEAREST', 'UP', 'DOWN'];
const LOP_BASES = ['CALENDAR_DAYS', 'WORKING_DAYS', 'FIXED_DAYS'];
const REVISION_TYPES = [
  'INITIAL', 'INCREMENT', 'PROMOTION', 'ANNUAL_REVISION', 'MARKET_ADJUSTMENT', 'SPECIAL', 'CORRECTION',
];
const OT_KINDS = ['REGULAR', 'WEEKEND', 'HOLIDAY', 'NIGHT_SHIFT'];
const OT_RATE_TYPES = ['FLAT_HOURLY', 'MULTIPLIER'];

/** Roles that should hear about a compensation revision awaiting sign-off. */
const APPROVER_ROLES = ['admin', 'hr', 'accountant'];

export interface StructurePreviewComponent {
  componentId: number;
  code: string;
  name: string;
  componentType: string;
  category: string;
  calculationType: string | null;
  percentOf: string | null;
  percentValue: number | null;
  monthlyAmount: number;
  annualAmount: number;
  /** True for the component that absorbed the residual gross. */
  isBalancing: boolean;
}

export interface StructurePreview {
  structureId: number;
  structureCode: string;
  structureName: string;
  currency: string;
  annualCtc: number;
  monthlyCtc: number;
  basicMonthly: number;
  earnings: StructurePreviewComponent[];
  deductions: StructurePreviewComponent[];
  employerContributions: StructurePreviewComponent[];
  monthlyGross: number;
  annualGross: number;
  monthlyDeductions: number;
  monthlyEmployerCost: number;
  monthlyNet: number;
  warnings: string[];
}

function requireText(value: unknown, message: string): string {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(message);
  return text;
}

function requireEnum(value: unknown, allowed: string[], label: string): string {
  const text = String(value ?? '').trim().toUpperCase();
  if (!allowed.includes(text)) {
    throw new Error(`${label} must be one of ${allowed.join(', ')}`);
  }
  return text;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Payroll master data: pay components, salary structures, employee compensation
 * revisions, pay cycles and overtime rules.
 *
 * Every money figure is passed through `round2` before it is stored or
 * returned, so a CTC breakdown shown in the UI is byte-identical to the one the
 * payroll engine later recomputes.
 */
export class CompensationService {
  private repo = new CompensationRepository();
  private awardRepo = new PayAwardRepository();
  private activityRepo = new ActivityRepository();
  private notifications = new NotificationService();

  // =========================================================================
  // Pay components
  // =========================================================================
  async listComponents(filters: ComponentFilters = {}): Promise<PayComponentResponse[]> {
    return this.repo.findComponents(filters);
  }

  async getComponent(id: number): Promise<PayComponentResponse> {
    const component = await this.repo.findComponentById(id);
    if (!component) throw new Error('Pay component not found');
    return component;
  }

  async createComponent(data: PayComponentInput, userId: number): Promise<PayComponentResponse> {
    const payload = this.validateComponent(data, null);

    const clash = await this.repo.findComponentByCode(payload.code as string);
    if (clash) throw new Error(`Pay component ${payload.code} already exists`);

    const id = await this.repo.createComponent(payload, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'PAY_COMPONENT',
      entityId: id,
      action: 'CREATE',
      summary: `Created pay component ${payload.code} (${payload.name})`,
    });
    return this.getComponent(id);
  }

  async updateComponent(
    id: number,
    data: PayComponentInput,
    userId: number,
  ): Promise<PayComponentResponse> {
    const existing = await this.repo.findComponentById(id);
    if (!existing) throw new Error('Pay component not found');

    const payload = this.validateComponent(data, existing);

    if (payload.code !== undefined && payload.code !== existing.code) {
      if (existing.isSystem) throw new Error('The code of a system component cannot be changed');
      const clash = await this.repo.findComponentByCode(payload.code);
      if (clash && Number(clash.id) !== id) {
        throw new Error(`Pay component ${payload.code} already exists`);
      }
    }

    await this.repo.updateComponent(id, payload, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'PAY_COMPONENT',
      entityId: id,
      action: 'UPDATE',
      summary: `Updated pay component ${existing.code}`,
    });
    return this.getComponent(id);
  }

  async deleteComponent(id: number, userId: number): Promise<void> {
    const existing = await this.repo.findComponentById(id);
    if (!existing) throw new Error('Pay component not found');
    if (existing.isSystem) throw new Error('System components cannot be deleted');

    const used = await this.repo.countStructureLinesForComponent(id);
    if (used > 0) {
      throw new Error(`${existing.code} is used by ${used} salary structure line(s) and cannot be removed`);
    }

    await this.repo.softDeleteComponent(id, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'PAY_COMPONENT',
      entityId: id,
      action: 'DELETE',
      summary: `Removed pay component ${existing.code}`,
    });
  }

  /**
   * Shared create/update validation. `existing` is null on create, so the
   * effective calculation settings fall back to what is already stored when a
   * partial update only touches one field.
   */
  private validateComponent(
    data: PayComponentInput,
    existing: PayComponentResponse | null,
  ): PayComponentInput {
    const out: PayComponentInput = {};

    if (data.code !== undefined || !existing) {
      out.code = requireText(data.code, 'A component code is required').toUpperCase();
    }
    if (data.name !== undefined || !existing) {
      out.name = requireText(data.name, 'A component name is required');
    }
    if (data.componentType !== undefined || !existing) {
      out.componentType = requireEnum(
        data.componentType ?? 'EARNING',
        COMPONENT_TYPES,
        'componentType',
      ) as PayComponentInput['componentType'];
    }
    if (data.category !== undefined || !existing) {
      out.category = requireEnum(
        data.category ?? 'OTHER',
        COMPONENT_CATEGORIES,
        'category',
      ) as PayComponentInput['category'];
    }
    if (data.calculationType !== undefined || !existing) {
      out.calculationType = requireEnum(
        data.calculationType ?? 'FIXED',
        CALCULATION_TYPES,
        'calculationType',
      ) as PayComponentInput['calculationType'];
    }

    if (data.percentOf !== undefined) {
      out.percentOf = data.percentOf
        ? (requireEnum(data.percentOf, PERCENT_BASES, 'percentOf') as PayComponentInput['percentOf'])
        : null;
    }
    if (data.defaultValue !== undefined) out.defaultValue = optionalNumber(data.defaultValue);
    if (data.defaultPercent !== undefined) out.defaultPercent = optionalNumber(data.defaultPercent);
    if (data.formula !== undefined) out.formula = data.formula ? String(data.formula).trim() : null;

    for (const flag of [
      'isTaxable', 'isPfApplicable', 'isEsiApplicable', 'isProrated', 'affectsGross', 'isStatutory', 'isActive',
    ] as const) {
      if (data[flag] !== undefined) out[flag] = !!data[flag];
    }
    if (data.displayOrder !== undefined) {
      const order = Number(data.displayOrder);
      if (!Number.isFinite(order) || order < 0) throw new Error('displayOrder must be zero or more');
      out.displayOrder = Math.floor(order);
    }

    // Effective settings: the patch wins, otherwise whatever is already stored.
    const calcType = out.calculationType ?? existing?.calculationType ?? 'FIXED';
    const percentOf = out.percentOf !== undefined ? out.percentOf : existing?.percentOf ?? null;
    const percent = out.defaultPercent !== undefined ? out.defaultPercent : existing?.defaultPercent ?? null;
    const formula = out.formula !== undefined ? out.formula : existing?.formula ?? null;

    if (calcType === 'PERCENT_OF') {
      if (!percentOf) throw new Error('A PERCENT_OF component requires percentOf (BASIC, GROSS, CTC or NET)');
      if (percent === null) throw new Error('A PERCENT_OF component requires defaultPercent');
      if (percent < 0 || percent > 100) throw new Error('defaultPercent must be between 0 and 100');
    }
    if (calcType === 'FORMULA' && !formula) {
      throw new Error('A FORMULA component requires a formula');
    }

    return out;
  }

  // =========================================================================
  // Salary structures
  // =========================================================================
  async listStructures(filters: StructureFilters = {}): Promise<SalaryStructureResponse[]> {
    return this.repo.findStructures(filters);
  }

  /** Structure header plus its lines, joined to component name and type. */
  async getStructure(id: number): Promise<SalaryStructureResponse> {
    const structure = await this.repo.findStructureById(id);
    if (!structure) throw new Error('Salary structure not found');
    structure.lines = await this.repo.findStructureLines(id);
    return structure;
  }

  async createStructure(data: SalaryStructureInput, userId: number): Promise<SalaryStructureResponse> {
    const payload = this.validateStructure(data, true);

    const clash = await this.repo.findStructureByCode(payload.code as string);
    if (clash) throw new Error(`Salary structure ${payload.code} already exists`);

    const id = await this.repo.createStructure(payload, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'SALARY_STRUCTURE',
      entityId: id,
      action: 'CREATE',
      summary: `Created salary structure ${payload.code} (${payload.name})`,
    });
    return this.getStructure(id);
  }

  async updateStructure(
    id: number,
    data: SalaryStructureInput,
    userId: number,
  ): Promise<SalaryStructureResponse> {
    const existing = await this.repo.findStructureById(id);
    if (!existing) throw new Error('Salary structure not found');

    const payload = this.validateStructure(data, false);

    const effectiveFrom = payload.effectiveFrom ?? existing.effectiveFrom;
    const effectiveTo = payload.effectiveTo !== undefined ? payload.effectiveTo : existing.effectiveTo;
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new Error('effectiveTo must be after effectiveFrom');
    }

    if (payload.code !== undefined && payload.code !== existing.code) {
      const clash = await this.repo.findStructureByCode(payload.code);
      if (clash && Number(clash.id) !== id) {
        throw new Error(`Salary structure ${payload.code} already exists`);
      }
    }

    await this.repo.updateStructure(id, payload, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'SALARY_STRUCTURE',
      entityId: id,
      action: 'UPDATE',
      summary: `Updated salary structure ${existing.code}`,
    });
    return this.getStructure(id);
  }

  async deleteStructure(id: number, userId: number): Promise<void> {
    const existing = await this.repo.findStructureById(id);
    if (!existing) throw new Error('Salary structure not found');

    const assigned = await this.repo.countSalariesForStructure(id);
    if (assigned > 0) {
      throw new Error(`${existing.code} is assigned to ${assigned} employee(s) and cannot be removed`);
    }

    await this.repo.softDeleteStructure(id, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'SALARY_STRUCTURE',
      entityId: id,
      action: 'DELETE',
      summary: `Removed salary structure ${existing.code}`,
    });
  }

  async cloneStructure(
    id: number,
    newCode: string,
    newName: string,
    userId: number,
  ): Promise<SalaryStructureResponse> {
    const source = await this.repo.findStructureById(id);
    if (!source) throw new Error('Salary structure not found');

    const code = requireText(newCode, 'A code for the new structure is required').toUpperCase();
    const name = requireText(newName, 'A name for the new structure is required');

    const clash = await this.repo.findStructureByCode(code);
    if (clash) throw new Error(`Salary structure ${code} already exists`);

    const newId = await this.repo.cloneStructure(id, code, name, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'SALARY_STRUCTURE',
      entityId: newId,
      action: 'CLONE',
      summary: `Cloned salary structure ${source.code} into ${code}`,
      meta: { sourceId: id, sourceCode: source.code },
    });
    return this.getStructure(newId);
  }

  /** Replaces every line on a structure in one transaction. */
  async setStructureLines(
    structureId: number,
    lines: SalaryStructureLineInput[],
    userId: number,
  ): Promise<SalaryStructureResponse> {
    const structure = await this.repo.findStructureById(structureId);
    if (!structure) throw new Error('Salary structure not found');
    if (!Array.isArray(lines)) throw new Error('lines must be an array');

    const clean = await this.validateStructureLines(lines);

    await this.repo.withTransaction(async (conn) => {
      await this.repo.replaceStructureLines(structureId, clean, conn);
    });

    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'SALARY_STRUCTURE',
      entityId: structureId,
      action: 'SET_LINES',
      summary: `Set ${clean.length} component line(s) on structure ${structure.code}`,
    });
    return this.getStructure(structureId);
  }

  private validateStructure(data: SalaryStructureInput, isCreate: boolean): SalaryStructureInput {
    const out: SalaryStructureInput = {};

    if (data.code !== undefined || isCreate) {
      out.code = requireText(data.code, 'A structure code is required').toUpperCase();
    }
    if (data.name !== undefined || isCreate) {
      out.name = requireText(data.name, 'A structure name is required');
    }
    if (data.effectiveFrom !== undefined || isCreate) {
      const from = requireText(data.effectiveFrom, 'effectiveFrom is required');
      if (!isValidDateString(from)) throw new Error('effectiveFrom must be a valid YYYY-MM-DD date');
      out.effectiveFrom = from;
    }
    if (data.effectiveTo !== undefined) {
      if (data.effectiveTo === null || data.effectiveTo === '') {
        out.effectiveTo = null;
      } else {
        const to = String(data.effectiveTo);
        if (!isValidDateString(to)) throw new Error('effectiveTo must be a valid YYYY-MM-DD date');
        out.effectiveTo = to;
      }
    }
    if (isCreate && out.effectiveTo && out.effectiveFrom && out.effectiveTo <= out.effectiveFrom) {
      throw new Error('effectiveTo must be after effectiveFrom');
    }
    if (data.workerType !== undefined) {
      out.workerType = data.workerType
        ? (requireEnum(data.workerType, WORKER_TYPES, 'workerType') as SalaryStructureInput['workerType'])
        : null;
    }

    for (const key of ['description', 'grade', 'designation', 'department', 'branch'] as const) {
      if (data[key] !== undefined) out[key] = data[key] ? String(data[key]).trim() : null;
    }
    if (data.currency !== undefined) out.currency = String(data.currency).trim().toUpperCase();
    if (data.country !== undefined) out.country = String(data.country).trim().toUpperCase();
    if (data.isActive !== undefined) out.isActive = !!data.isActive;

    return out;
  }

  /** Normalises lines and enforces the structure-level composition rules. */
  private async validateStructureLines(
    lines: SalaryStructureLineInput[],
  ): Promise<SalaryStructureLineInput[]> {
    const componentIds = lines.map((l) => Number(l.componentId));
    if (componentIds.some((id) => !Number.isFinite(id) || id <= 0)) {
      throw new Error('Every line requires a valid componentId');
    }
    if (new Set(componentIds).size !== componentIds.length) {
      throw new Error('A component can only appear once in a structure');
    }

    const components = await this.repo.findComponentsByIds(componentIds);
    const clean: SalaryStructureLineInput[] = [];
    let basicCount = 0;
    let ctcPercentTotal = 0;

    for (const [index, line] of lines.entries()) {
      const componentId = Number(line.componentId);
      const component = components.get(componentId);
      if (!component) throw new Error(`Pay component ${componentId} not found`);

      const calculationType = line.calculationType
        ? (requireEnum(line.calculationType, CALCULATION_TYPES, 'calculationType') as SalaryStructureLineInput['calculationType'])
        : component.calculationType;
      const percentOf = line.percentOf
        ? (requireEnum(line.percentOf, PERCENT_BASES, 'percentOf') as SalaryStructureLineInput['percentOf'])
        : component.percentOf;
      const percentValue = optionalNumber(line.percentValue) ?? component.defaultPercent;
      const amount = optionalNumber(line.amount) ?? component.defaultValue;

      if (component.category === 'BASIC') basicCount++;

      if (calculationType === 'PERCENT_OF') {
        if (!percentOf) throw new Error(`${component.code} is percentage-based and requires percentOf`);
        if (percentValue === null) throw new Error(`${component.code} requires a percentage value`);
        if (percentValue < 0 || percentValue > 100) {
          throw new Error(`${component.code}: percentage must be between 0 and 100`);
        }
        if (percentOf === 'CTC') ctcPercentTotal += percentValue;
      }
      if (calculationType === 'FIXED' && amount !== null && amount < 0) {
        throw new Error(`${component.code}: amount cannot be negative`);
      }

      const minAmount = optionalNumber(line.minAmount);
      const maxAmount = optionalNumber(line.maxAmount);
      if (minAmount !== null && maxAmount !== null && maxAmount < minAmount) {
        throw new Error(`${component.code}: maxAmount cannot be below minAmount`);
      }

      clean.push({
        componentId,
        calculationType,
        percentOf,
        amount,
        percentValue,
        minAmount,
        maxAmount,
        displayOrder: Math.floor(Number(line.displayOrder ?? (index + 1) * 10)),
      });
    }

    if (basicCount > 1) {
      throw new Error('A salary structure can only contain one BASIC component');
    }
    const totalPct = round2(ctcPercentTotal);
    if (totalPct > 100) {
      throw new Error(`Percentage components of CTC total ${totalPct}%, which exceeds 100%`);
    }

    return clean;
  }

  // =========================================================================
  // CTC breakdown preview
  // =========================================================================
  /**
   * Component-by-component monthly breakdown for a CTC, without persisting
   * anything. Resolution order is BASIC, then percent-of-BASIC, then FIXED,
   * and finally a single FORMULA/SPECIAL component absorbs the residual so the
   * earnings sum exactly to the monthly gross.
   */
  async previewStructure(structureId: number, annualCtc: number): Promise<StructurePreview> {
    const structure = await this.repo.findStructureById(structureId);
    if (!structure) throw new Error('Salary structure not found');

    const ctc = Number(annualCtc);
    if (!Number.isFinite(ctc) || ctc <= 0) throw new Error('annualCtc must be greater than zero');

    const lines = await this.repo.findStructureLines(structureId);
    const monthlyCtc = round2(ctc / 12);
    const warnings: string[] = [];

    const resolved = new Map<number, number>();
    const earningLines = lines.filter((l) => l.componentType === 'EARNING');

    // 1. BASIC anchors everything that follows.
    const basicLine = earningLines.find((l) => l.category === 'BASIC');
    let basic = 0;
    if (basicLine) {
      if (basicLine.calculationType === 'PERCENT_OF' && basicLine.percentValue !== null) {
        basic = round2((monthlyCtc * basicLine.percentValue) / 100);
      } else if (basicLine.calculationType === 'FIXED' && basicLine.amount !== null) {
        basic = round2(basicLine.amount);
      } else {
        warnings.push(
          `${basicLine.componentCode} is ${basicLine.calculationType ?? 'unset'} and cannot be derived from CTC; treated as 0`,
        );
      }
      basic = this.clamp(basic, basicLine.minAmount, basicLine.maxAmount);
      resolved.set(basicLine.componentId, basic);
    } else {
      warnings.push('This structure has no BASIC component, so percent-of-basic values resolve to 0');
    }

    // 2. Percent-of components, 3. fixed amounts. A FORMULA line is deferred.
    const balancingLine =
      earningLines.find((l) => l.calculationType === 'FORMULA') ??
      earningLines.find((l) => l.componentCode === 'SPECIAL');

    for (const line of earningLines) {
      if (basicLine && line.componentId === basicLine.componentId) continue;
      if (balancingLine && line.componentId === balancingLine.componentId) continue;
      resolved.set(line.componentId, this.resolveLineAmount(line, basic, monthlyCtc, warnings));
    }

    let allocated = 0;
    for (const line of earningLines) {
      if (balancingLine && line.componentId === balancingLine.componentId) continue;
      allocated += resolved.get(line.componentId) ?? 0;
    }
    allocated = round2(allocated);

    if (balancingLine) {
      const residual = round2(monthlyCtc - allocated);
      if (residual < 0) {
        resolved.set(balancingLine.componentId, 0);
        warnings.push(
          `Fixed and percentage components total ${allocated}, which exceeds the monthly gross of ${monthlyCtc} by ${round2(-residual)}`,
        );
      } else {
        resolved.set(balancingLine.componentId, residual);
      }
    } else if (allocated !== monthlyCtc) {
      const gap = round2(monthlyCtc - allocated);
      warnings.push(
        gap > 0
          ? `Components total ${allocated}, leaving ${gap} of the monthly gross unallocated (no balancing component)`
          : `Components total ${allocated}, exceeding the monthly gross of ${monthlyCtc} by ${round2(-gap)}`,
      );
    }

    // Non-earning lines are informational: they never consume the gross.
    for (const line of lines) {
      if (line.componentType === 'EARNING') continue;
      resolved.set(line.componentId, this.resolveLineAmount(line, basic, monthlyCtc, warnings));
    }

    const toPreview = (lineList: typeof lines): StructurePreviewComponent[] =>
      lineList.map((l) => {
        const monthlyAmount = round2(resolved.get(l.componentId) ?? 0);
        return {
          componentId: l.componentId,
          code: l.componentCode,
          name: l.componentName,
          componentType: l.componentType,
          category: l.category,
          calculationType: l.calculationType,
          percentOf: l.percentOf,
          percentValue: l.percentValue,
          monthlyAmount,
          annualAmount: round2(monthlyAmount * 12),
          isBalancing: !!balancingLine && l.componentId === balancingLine.componentId,
        };
      });

    const earnings = toPreview(earningLines);
    const deductions = toPreview(lines.filter((l) => l.componentType === 'DEDUCTION'));
    const employerContributions = toPreview(
      lines.filter((l) => l.componentType === 'EMPLOYER_CONTRIBUTION'),
    );

    const monthlyGross = round2(earnings.reduce((sum, c) => sum + c.monthlyAmount, 0));
    const monthlyDeductions = round2(deductions.reduce((sum, c) => sum + c.monthlyAmount, 0));
    const monthlyEmployerCost = round2(
      employerContributions.reduce((sum, c) => sum + c.monthlyAmount, 0),
    );

    return {
      structureId: structure.id,
      structureCode: structure.code,
      structureName: structure.name,
      currency: structure.currency,
      annualCtc: round2(ctc),
      monthlyCtc,
      basicMonthly: round2(basic),
      earnings,
      deductions,
      employerContributions,
      monthlyGross,
      annualGross: round2(monthlyGross * 12),
      monthlyDeductions,
      monthlyEmployerCost,
      monthlyNet: round2(monthlyGross - monthlyDeductions),
      warnings,
    };
  }

  private resolveLineAmount(
    line: { componentCode: string; calculationType: string | null; percentOf: string | null; percentValue: number | null; amount: number | null; minAmount: number | null; maxAmount: number | null },
    basic: number,
    monthlyCtc: number,
    warnings: string[],
  ): number {
    let value = 0;
    switch (line.calculationType) {
      case 'PERCENT_OF': {
        if (line.percentValue === null) {
          warnings.push(`${line.componentCode} has no percentage configured; treated as 0`);
          break;
        }
        const base = line.percentOf === 'BASIC' ? basic : monthlyCtc;
        value = round2((base * line.percentValue) / 100);
        break;
      }
      case 'FIXED':
        value = round2(Number(line.amount ?? 0));
        break;
      default:
        // ATTENDANCE_BASED, PIECE_RATE, SLAB, MANUAL and FORMULA are resolved by
        // the payroll engine at run time, not from a static CTC.
        value = 0;
    }
    return this.clamp(value, line.minAmount, line.maxAmount);
  }

  private clamp(value: number, min: number | null, max: number | null): number {
    let out = value;
    if (min !== null && out < min) out = min;
    if (max !== null && out > max) out = max;
    return round2(out);
  }

  // =========================================================================
  // Employee compensation & revisions
  // =========================================================================
  async getCurrentSalary(employeeId: number): Promise<EmployeeSalaryResponse | null> {
    const current = await this.repo.findCurrentSalary(employeeId, todayString());
    if (!current) return null;
    current.components = await this.repo.findSalaryComponents(current.id);
    return current;
  }

  async getSalaryHistory(employeeId: number): Promise<EmployeeSalaryResponse[]> {
    return this.repo.findSalaryHistory(employeeId);
  }

  async getRevision(id: number): Promise<EmployeeSalaryResponse> {
    const revision = await this.repo.findSalaryById(id);
    if (!revision) throw new Error('Salary revision not found');
    revision.components = await this.repo.findSalaryComponents(id);
    return revision;
  }

  /**
   * Records a new compensation revision. In one transaction it closes the open
   * revision the day before the new one starts, computes the delta against the
   * previous CTC and writes the per-component amounts.
   */
  async createRevision(
    employeeId: number,
    data: CreateRevisionInput,
    userId: number,
  ): Promise<EmployeeSalaryResponse> {
    const employee = await this.repo.findEmployeeBrief(employeeId);
    if (!employee) throw new Error('Employee not found');

    const effectiveFrom = requireText(data.effectiveFrom, 'effectiveFrom is required');
    if (!isValidDateString(effectiveFrom)) {
      throw new Error('effectiveFrom must be a valid YYYY-MM-DD date');
    }

    const annualCtc = optionalNumber(data.annualCtc);
    if (annualCtc === null || annualCtc <= 0) throw new Error('annualCtc must be greater than zero');

    const revisionType = data.revisionType
      ? (requireEnum(data.revisionType, REVISION_TYPES, 'revisionType') as CreateRevisionInput['revisionType'])
      : 'INITIAL';

    let structureId: number | null = null;
    if (data.structureId !== null && data.structureId !== undefined) {
      structureId = Math.floor(Number(data.structureId));
      if (!Number.isFinite(structureId) || structureId <= 0) throw new Error('Invalid structureId');
      const structure = await this.repo.findStructureById(structureId);
      if (!structure) throw new Error('Salary structure not found');
    }

    // Components: use what the caller supplied, otherwise derive them from the
    // structure so the stored breakdown always matches the CTC.
    let components: EmployeeSalaryComponentInput[] = [];
    if (Array.isArray(data.components) && data.components.length > 0) {
      components = data.components.map((c) => {
        const componentId = Math.floor(Number(c.componentId));
        if (!Number.isFinite(componentId) || componentId <= 0) {
          throw new Error('Every component requires a valid componentId');
        }
        return {
          componentId,
          amount: optionalNumber(c.amount) === null ? null : round2(Number(c.amount)),
          percentValue: optionalNumber(c.percentValue),
          calculationType: c.calculationType ?? null,
          percentOf: c.percentOf ?? null,
        };
      });
    } else if (structureId) {
      const preview = await this.previewStructure(structureId, annualCtc);
      components = [...preview.earnings, ...preview.deductions, ...preview.employerContributions].map((c) => ({
        componentId: c.componentId,
        amount: c.monthlyAmount,
        percentValue: c.percentValue,
        calculationType: c.calculationType as EmployeeSalaryComponentInput['calculationType'],
        percentOf: c.percentOf as EmployeeSalaryComponentInput['percentOf'],
      }));
    }

    const monthlyGross = optionalNumber(data.monthlyGross) ?? round2(annualCtc / 12);

    const newId = await this.repo.withTransaction(async (conn) => {
      const latest = await this.repo.findLatestRevisionRow(employeeId, conn);

      if (latest) {
        const latestFrom = String(latest.effective_from ?? '').slice(0, 10);
        if (latestFrom && effectiveFrom < latestFrom) {
          throw new Error(`A later revision already exists from ${latestFrom}`);
        }
        const latestTo = latest.effective_to ? String(latest.effective_to).slice(0, 10) : null;
        if (latestTo === null || latestTo >= effectiveFrom) {
          await this.repo.closeRevision(Number(latest.id), addDays(effectiveFrom, -1), conn);
        }
      }

      const previousCtc = latest && latest.annual_ctc !== null ? Number(latest.annual_ctc) : null;
      const changePct =
        previousCtc !== null && previousCtc > 0
          ? round2(((annualCtc - previousCtc) / previousCtc) * 100)
          : null;

      const payload: CreateRevisionInput = {
        structureId,
        currency: data.currency ? String(data.currency).toUpperCase() : 'INR',
        annualCtc: round2(annualCtc),
        monthlyGross: round2(monthlyGross),
        effectiveFrom,
        revisionType,
        revisionReason: data.revisionReason ? String(data.revisionReason).trim() : null,
        status: data.status ?? 'ACTIVE',
        previousCtc,
        changePct,
      };

      const id = await this.repo.insertRevision(employeeId, payload, userId, conn);
      if (components.length > 0) {
        await this.repo.insertSalaryComponents(id, components, conn);
      }

      await this.activityRepo.log(
        {
          actorUserId: userId,
          employeeId,
          entityType: 'SALARY_REVISION',
          entityId: id,
          action: 'CREATE',
          summary: `Recorded ${revisionType} compensation revision for ${employee.fullName}: CTC ${round2(annualCtc)} from ${effectiveFrom}`,
          meta: { annualCtc: round2(annualCtc), previousCtc, changePct, effectiveFrom, structureId },
        },
        conn,
      );

      return id;
    });

    if ((data.status ?? 'ACTIVE') === 'PENDING_APPROVAL') {
      await this.notifications.notifyRoles(APPROVER_ROLES, {
        category: 'PAYROLL',
        priority: 'NORMAL',
        title: `Salary revision awaiting approval: ${employee.fullName}`,
        body: `${revisionType} revision to a CTC of ${round2(annualCtc)} effective ${effectiveFrom}.`,
        linkPage: 'payroll',
        linkRefId: newId,
        createdBy: userId,
      });
    }

    return this.getRevision(newId);
  }

  async approveRevision(id: number, userId: number, actorName?: string): Promise<EmployeeSalaryResponse> {
    const revision = await this.repo.findSalaryById(id);
    if (!revision) throw new Error('Salary revision not found');
    if (revision.status !== 'DRAFT' && revision.status !== 'PENDING_APPROVAL') {
      throw new Error('Only draft or pending revisions can be approved');
    }

    await this.repo.setRevisionStatus(id, 'APPROVED', userId, null);

    await this.notifications.notifyEmployee(revision.employeeId, {
      category: 'PAYROLL',
      priority: 'NORMAL',
      title: 'Your compensation revision was approved',
      body: `Effective ${revision.effectiveFrom}, your annual CTC is ${revision.annualCtc ?? 0}.`,
      linkPage: 'payroll',
      linkRefId: id,
      email: true,
      createdBy: userId,
    });

    await this.activityRepo.log({
      actorUserId: userId,
      actorName: actorName ?? null,
      employeeId: revision.employeeId,
      entityType: 'SALARY_REVISION',
      entityId: id,
      action: 'APPROVE',
      summary: `Approved compensation revision effective ${revision.effectiveFrom}`,
    });

    return this.getRevision(id);
  }

  async rejectRevision(
    id: number,
    userId: number,
    reason: string,
    actorName?: string,
  ): Promise<EmployeeSalaryResponse> {
    const note = requireText(reason, 'A rejection reason is required');

    const revision = await this.repo.findSalaryById(id);
    if (!revision) throw new Error('Salary revision not found');
    if (revision.status !== 'DRAFT' && revision.status !== 'PENDING_APPROVAL') {
      throw new Error('Only draft or pending revisions can be rejected');
    }

    await this.repo.setRevisionStatus(id, 'REJECTED', userId, `Rejected: ${note}`);

    await this.activityRepo.log({
      actorUserId: userId,
      actorName: actorName ?? null,
      employeeId: revision.employeeId,
      entityType: 'SALARY_REVISION',
      entityId: id,
      action: 'REJECT',
      summary: `Rejected compensation revision effective ${revision.effectiveFrom}`,
      meta: { reason: note },
    });

    return this.getRevision(id);
  }

  // =========================================================================
  // Pay cycles
  // =========================================================================
  async listCycles(isActive?: boolean): Promise<PayCycleResponse[]> {
    return this.repo.findCycles(isActive);
  }

  async getCycle(id: number): Promise<PayCycleResponse> {
    const cycle = await this.repo.findCycleById(id);
    if (!cycle) throw new Error('Pay cycle not found');
    return cycle;
  }

  async createCycle(data: PayCycleInput, userId: number): Promise<PayCycleResponse> {
    const payload = this.validateCycle(data, true);

    const clash = await this.repo.findCycleByCode(payload.code as string);
    if (clash) throw new Error(`Pay cycle ${payload.code} already exists`);

    const id = await this.repo.createCycle(payload, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'PAY_CYCLE',
      entityId: id,
      action: 'CREATE',
      summary: `Created pay cycle ${payload.code} (${payload.name})`,
    });
    return this.getCycle(id);
  }

  async updateCycle(id: number, data: PayCycleInput, userId: number): Promise<PayCycleResponse> {
    const existing = await this.repo.findCycleById(id);
    if (!existing) throw new Error('Pay cycle not found');

    const payload = this.validateCycle(data, false);

    const lopBasis = payload.lopBasis ?? existing.lopBasis;
    const fixedDays =
      payload.fixedDaysPerMonth !== undefined ? payload.fixedDaysPerMonth : existing.fixedDaysPerMonth;
    if (lopBasis === 'FIXED_DAYS' && (fixedDays === null || fixedDays < 1 || fixedDays > 31)) {
      throw new Error('A FIXED_DAYS cycle requires fixedDaysPerMonth between 1 and 31');
    }

    if (payload.code !== undefined && payload.code !== existing.code) {
      const clash = await this.repo.findCycleByCode(payload.code);
      if (clash && Number(clash.id) !== id) throw new Error(`Pay cycle ${payload.code} already exists`);
    }

    await this.repo.updateCycle(id, payload, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'PAY_CYCLE',
      entityId: id,
      action: 'UPDATE',
      summary: `Updated pay cycle ${existing.code}`,
    });
    return this.getCycle(id);
  }

  async deleteCycle(id: number, userId: number): Promise<void> {
    const existing = await this.repo.findCycleById(id);
    if (!existing) throw new Error('Pay cycle not found');
    if (existing.isDefault) throw new Error('The default pay cycle cannot be removed');

    const periods = await this.repo.countPeriodsForCycle(id);
    if (periods > 0) {
      throw new Error(`${existing.code} is used by ${periods} salary period(s) and cannot be removed`);
    }

    await this.repo.softDeleteCycle(id, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'PAY_CYCLE',
      entityId: id,
      action: 'DELETE',
      summary: `Removed pay cycle ${existing.code}`,
    });
  }

  async setDefaultCycle(id: number, userId: number): Promise<PayCycleResponse> {
    const existing = await this.repo.findCycleById(id);
    if (!existing) throw new Error('Pay cycle not found');
    if (!existing.isActive) throw new Error('An inactive pay cycle cannot be made the default');

    await this.repo.setDefaultCycle(id, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'PAY_CYCLE',
      entityId: id,
      action: 'SET_DEFAULT',
      summary: `Made ${existing.code} the default pay cycle`,
    });
    return this.getCycle(id);
  }

  private validateCycle(data: PayCycleInput, isCreate: boolean): PayCycleInput {
    const out: PayCycleInput = {};

    if (data.code !== undefined || isCreate) {
      out.code = requireText(data.code, 'A pay cycle code is required').toUpperCase();
    }
    if (data.name !== undefined || isCreate) {
      out.name = requireText(data.name, 'A pay cycle name is required');
    }
    if (data.frequency !== undefined || isCreate) {
      out.frequency = requireEnum(
        data.frequency ?? 'MONTHLY',
        FREQUENCIES,
        'frequency',
      ) as PayCycleInput['frequency'];
    }
    if (data.roundingMode !== undefined) {
      out.roundingMode = requireEnum(
        data.roundingMode,
        ROUNDING_MODES,
        'roundingMode',
      ) as PayCycleInput['roundingMode'];
    }
    if (data.lopBasis !== undefined) {
      out.lopBasis = requireEnum(data.lopBasis, LOP_BASES, 'lopBasis') as PayCycleInput['lopBasis'];
    }
    if (data.roundingPrecision !== undefined) {
      const precision = Number(data.roundingPrecision);
      if (!Number.isFinite(precision) || precision < 0 || precision > 2) {
        throw new Error('roundingPrecision must be between 0 and 2');
      }
      out.roundingPrecision = Math.floor(precision);
    }
    if (data.cycleStartDay !== undefined) {
      const day = Number(data.cycleStartDay);
      if (!Number.isFinite(day) || day < 0 || day > 31) {
        throw new Error('cycleStartDay must be between 0 and 31');
      }
      out.cycleStartDay = Math.floor(day);
    }
    for (const key of ['cutoffDay', 'payDay'] as const) {
      if (data[key] === undefined) continue;
      const value = optionalNumber(data[key]);
      if (value !== null && (value < 1 || value > 31)) {
        throw new Error(`${key} must be between 1 and 31`);
      }
      out[key] = value;
    }
    if (data.fixedDaysPerMonth !== undefined) {
      const value = optionalNumber(data.fixedDaysPerMonth);
      if (value !== null && (value < 1 || value > 31)) {
        throw new Error('fixedDaysPerMonth must be between 1 and 31');
      }
      out.fixedDaysPerMonth = value === null ? null : Math.floor(value);
    }
    if (data.currency !== undefined) out.currency = String(data.currency).trim().toUpperCase();
    if (data.country !== undefined) out.country = String(data.country).trim().toUpperCase();
    if (data.company !== undefined) out.company = data.company ? String(data.company).trim() : null;
    if (data.branch !== undefined) out.branch = data.branch ? String(data.branch).trim() : null;
    if (data.isActive !== undefined) out.isActive = !!data.isActive;

    if (isCreate) {
      const lopBasis = out.lopBasis ?? 'CALENDAR_DAYS';
      out.lopBasis = lopBasis;
      const fixedDays = out.fixedDaysPerMonth ?? null;
      if (lopBasis === 'FIXED_DAYS' && (fixedDays === null || fixedDays < 1 || fixedDays > 31)) {
        throw new Error('A FIXED_DAYS cycle requires fixedDaysPerMonth between 1 and 31');
      }
    }

    return out;
  }

  // =========================================================================
  // Overtime rules
  // =========================================================================
  async listOvertimeRules(isActive?: boolean): Promise<OvertimeRuleResponse[]> {
    return this.awardRepo.findOvertimeRules(isActive);
  }

  async getOvertimeRule(id: number): Promise<OvertimeRuleResponse> {
    const rule = await this.awardRepo.findOvertimeRuleById(id);
    if (!rule) throw new Error('Overtime rule not found');
    return rule;
  }

  async createOvertimeRule(data: OvertimeRuleInput, userId: number): Promise<OvertimeRuleResponse> {
    const payload = this.validateOvertimeRule(data, null);

    const clash = await this.awardRepo.findOvertimeRuleByCode(payload.code as string);
    if (clash) throw new Error(`Overtime rule ${payload.code} already exists`);

    const id = await this.awardRepo.createOvertimeRule(payload, userId);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'OVERTIME_RULE',
      entityId: id,
      action: 'CREATE',
      summary: `Created overtime rule ${payload.code}`,
    });
    return this.getOvertimeRule(id);
  }

  async updateOvertimeRule(
    id: number,
    data: OvertimeRuleInput,
    userId: number,
  ): Promise<OvertimeRuleResponse> {
    const existing = await this.awardRepo.findOvertimeRuleById(id);
    if (!existing) throw new Error('Overtime rule not found');

    const payload = this.validateOvertimeRule(data, existing);

    if (payload.code !== undefined && payload.code !== existing.code) {
      const clash = await this.awardRepo.findOvertimeRuleByCode(payload.code);
      if (clash && Number(clash.id) !== id) throw new Error(`Overtime rule ${payload.code} already exists`);
    }

    await this.awardRepo.updateOvertimeRule(id, payload);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'OVERTIME_RULE',
      entityId: id,
      action: 'UPDATE',
      summary: `Updated overtime rule ${existing.code}`,
    });
    return this.getOvertimeRule(id);
  }

  async deleteOvertimeRule(id: number, userId: number): Promise<void> {
    const existing = await this.awardRepo.findOvertimeRuleById(id);
    if (!existing) throw new Error('Overtime rule not found');

    await this.awardRepo.softDeleteOvertimeRule(id);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'OVERTIME_RULE',
      entityId: id,
      action: 'DELETE',
      summary: `Removed overtime rule ${existing.code}`,
    });
  }

  private validateOvertimeRule(
    data: OvertimeRuleInput,
    existing: OvertimeRuleResponse | null,
  ): OvertimeRuleInput {
    const out: OvertimeRuleInput = {};

    if (data.code !== undefined || !existing) {
      out.code = requireText(data.code, 'An overtime rule code is required').toUpperCase();
    }
    if (data.name !== undefined || !existing) {
      out.name = requireText(data.name, 'An overtime rule name is required');
    }
    if (data.otKind !== undefined || !existing) {
      out.otKind = requireEnum(data.otKind ?? 'REGULAR', OT_KINDS, 'otKind') as OvertimeRuleInput['otKind'];
    }
    if (data.rateType !== undefined || !existing) {
      out.rateType = requireEnum(
        data.rateType ?? 'FLAT_HOURLY',
        OT_RATE_TYPES,
        'rateType',
      ) as OvertimeRuleInput['rateType'];
    }
    if (data.flatRate !== undefined) out.flatRate = optionalNumber(data.flatRate);
    if (data.multiplier !== undefined) out.multiplier = optionalNumber(data.multiplier);
    if (data.minMinutes !== undefined) {
      const minutes = Number(data.minMinutes);
      if (!Number.isFinite(minutes) || minutes < 0) throw new Error('minMinutes must be zero or more');
      out.minMinutes = Math.floor(minutes);
    }
    for (const key of ['maxHoursPerDay', 'maxHoursPerMonth'] as const) {
      if (data[key] === undefined) continue;
      const value = optionalNumber(data[key]);
      if (value !== null && value <= 0) throw new Error(`${key} must be greater than zero`);
      out[key] = value;
    }
    if (data.requiresApproval !== undefined) out.requiresApproval = !!data.requiresApproval;
    if (data.isActive !== undefined) out.isActive = !!data.isActive;
    if (data.grade !== undefined) out.grade = data.grade ? String(data.grade).trim() : null;
    if (data.branch !== undefined) out.branch = data.branch ? String(data.branch).trim() : null;

    const rateType = out.rateType ?? existing?.rateType ?? 'FLAT_HOURLY';
    const flatRate = out.flatRate !== undefined ? out.flatRate : existing?.flatRate ?? null;
    const multiplier = out.multiplier !== undefined ? out.multiplier : existing?.multiplier ?? null;

    if (rateType === 'FLAT_HOURLY' && (flatRate === null || flatRate <= 0)) {
      throw new Error('A FLAT_HOURLY overtime rule requires a flatRate greater than zero');
    }
    if (rateType === 'MULTIPLIER' && (multiplier === null || multiplier <= 0)) {
      throw new Error('A MULTIPLIER overtime rule requires a multiplier greater than zero');
    }

    return out;
  }
}
