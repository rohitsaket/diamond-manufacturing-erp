import { PerformanceCycleRepository } from '../repositories/PerformanceCycleRepository';
import { CycleResponse, CycleStatus, PerfActionContext } from '../types/performance';
import { isValidDateString, toDateString, todayString } from '../utils/dateUtils';
import { PerfAuditService } from './PerfAuditService';

/** Stage order for the cycle status machine. Forward moves only. */
const STATUS_ORDER: CycleStatus[] = [
  'DRAFT',
  'GOAL_SETTING',
  'ACTIVE',
  'SELF_REVIEW',
  'MANAGER_REVIEW',
  'CALIBRATION',
  'CLOSED',
];

const CYCLE_TYPES = new Set(['ANNUAL', 'HALF_YEARLY', 'QUARTERLY', 'MONTHLY', 'PROBATION', 'PROJECT', 'CUSTOM']);

export interface CycleCalendarEntry {
  stage: string;
  start: string | null;
  end: string | null;
  status: 'UPCOMING' | 'OPEN' | 'CLOSED';
}

export interface CycleInput {
  code?: string;
  name?: string;
  cycleType?: string;
  financialYear?: string | null;
  startDate?: string;
  endDate?: string;
  goalSettingStart?: string | null;
  goalSettingEnd?: string | null;
  selfReviewStart?: string | null;
  selfReviewEnd?: string | null;
  managerReviewStart?: string | null;
  managerReviewEnd?: string | null;
  calibrationStart?: string | null;
  calibrationEnd?: string | null;
  description?: string | null;
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function dateOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return toDateString(value);
}

export function toCycleResponse(row: any): CycleResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    cycleType: row.cycle_type,
    financialYear: row.financial_year ?? null,
    startDate: toDateString(row.start_date),
    endDate: toDateString(row.end_date),
    goalSettingStart: dateOrNull(row.goal_setting_start),
    goalSettingEnd: dateOrNull(row.goal_setting_end),
    selfReviewStart: dateOrNull(row.self_review_start),
    selfReviewEnd: dateOrNull(row.self_review_end),
    managerReviewStart: dateOrNull(row.manager_review_start),
    managerReviewEnd: dateOrNull(row.manager_review_end),
    calibrationStart: dateOrNull(row.calibration_start),
    calibrationEnd: dateOrNull(row.calibration_end),
    status: row.status,
    description: row.description ?? null,
    createdAt: isoOrNull(row.created_at) ?? '',
  };
}

/**
 * Performance cycles: the time containers everything else hangs off.
 *
 * The status machine only ever moves forward (skipping stages is allowed);
 * a CLOSED cycle can never re-open, because appraisal letters may already
 * have been issued out of it.
 */
export class PerformanceCycleService {
  private repo = new PerformanceCycleRepository();
  private audit = new PerfAuditService();

  async list(status?: string): Promise<CycleResponse[]> {
    if (status && !STATUS_ORDER.includes(status as CycleStatus)) {
      throw new Error(`Invalid cycle status filter "${status}"`);
    }
    const rows = await this.repo.findAll(status);
    return rows.map(toCycleResponse);
  }

  async get(id: number): Promise<CycleResponse> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error(`Performance cycle ${id} was not found`);
    return toCycleResponse(row);
  }

  async create(input: CycleInput, ctx: PerfActionContext): Promise<CycleResponse> {
    if (!input.code || !input.name || !input.startDate || !input.endDate) {
      throw new Error('code, name, startDate and endDate are required');
    }
    this.validateDates(input);
    const cycleType = input.cycleType ?? 'ANNUAL';
    if (!CYCLE_TYPES.has(cycleType)) throw new Error(`Invalid cycleType "${cycleType}"`);

    // Check-then-insert: the unique key would also catch this, but a readable
    // message beats ER_DUP_ENTRY.
    const existing = await this.repo.findByCode(String(input.code).trim());
    if (existing) throw new Error(`A cycle with code "${input.code}" already exists`);

    const id = await this.repo.create({
      code: String(input.code).trim(),
      name: String(input.name).trim(),
      cycle_type: cycleType,
      financial_year: input.financialYear ?? null,
      start_date: input.startDate,
      end_date: input.endDate,
      goal_setting_start: input.goalSettingStart ?? null,
      goal_setting_end: input.goalSettingEnd ?? null,
      self_review_start: input.selfReviewStart ?? null,
      self_review_end: input.selfReviewEnd ?? null,
      manager_review_start: input.managerReviewStart ?? null,
      manager_review_end: input.managerReviewEnd ?? null,
      calibration_start: input.calibrationStart ?? null,
      calibration_end: input.calibrationEnd ?? null,
      description: input.description ?? null,
      created_by: ctx.userId,
    });
    const created = await this.get(id);
    await this.audit.record('PERF_CYCLE', id, 'CREATE', ctx, null, created);
    return created;
  }

  async update(id: number, input: CycleInput, ctx: PerfActionContext): Promise<CycleResponse> {
    const before = await this.repo.findById(id);
    if (!before) throw new Error(`Performance cycle ${id} was not found`);
    if (before.status === 'CLOSED') throw new Error('A CLOSED cycle cannot be edited');
    this.validateDates(input);

    const fields: Record<string, any> = {};
    if (input.name !== undefined) fields.name = String(input.name).trim();
    if (input.cycleType !== undefined) {
      if (!CYCLE_TYPES.has(input.cycleType)) throw new Error(`Invalid cycleType "${input.cycleType}"`);
      fields.cycle_type = input.cycleType;
    }
    if (input.financialYear !== undefined) fields.financial_year = input.financialYear;
    if (input.startDate !== undefined) fields.start_date = input.startDate;
    if (input.endDate !== undefined) fields.end_date = input.endDate;
    if (input.goalSettingStart !== undefined) fields.goal_setting_start = input.goalSettingStart;
    if (input.goalSettingEnd !== undefined) fields.goal_setting_end = input.goalSettingEnd;
    if (input.selfReviewStart !== undefined) fields.self_review_start = input.selfReviewStart;
    if (input.selfReviewEnd !== undefined) fields.self_review_end = input.selfReviewEnd;
    if (input.managerReviewStart !== undefined) fields.manager_review_start = input.managerReviewStart;
    if (input.managerReviewEnd !== undefined) fields.manager_review_end = input.managerReviewEnd;
    if (input.calibrationStart !== undefined) fields.calibration_start = input.calibrationStart;
    if (input.calibrationEnd !== undefined) fields.calibration_end = input.calibrationEnd;
    if (input.description !== undefined) fields.description = input.description;
    if (Object.keys(fields).length === 0) throw new Error('No updatable fields were provided');

    await this.repo.update(id, fields);
    const after = await this.get(id);
    await this.audit.record('PERF_CYCLE', id, 'UPDATE', ctx, toCycleResponse(before), after);
    return after;
  }

  /**
   * DRAFT → GOAL_SETTING → ACTIVE → SELF_REVIEW → MANAGER_REVIEW →
   * CALIBRATION → CLOSED. Skipping forward is legal; going backwards is not,
   * and CLOSED is terminal.
   */
  async changeStatus(id: number, status: string, ctx: PerfActionContext): Promise<CycleResponse> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error(`Performance cycle ${id} was not found`);

    const target = String(status ?? '').toUpperCase() as CycleStatus;
    if (!STATUS_ORDER.includes(target)) {
      throw new Error(`Invalid cycle status "${status}"; expected one of ${STATUS_ORDER.join(', ')}`);
    }
    const currentIdx = STATUS_ORDER.indexOf(row.status as CycleStatus);
    const targetIdx = STATUS_ORDER.indexOf(target);
    if (row.status === 'CLOSED') {
      throw new Error('This cycle is CLOSED and cannot be re-opened');
    }
    if (targetIdx <= currentIdx) {
      throw new Error(`Cannot move cycle status backwards from ${row.status} to ${target}`);
    }

    await this.repo.update(id, { status: target });
    const after = await this.get(id);
    await this.audit.record('PERF_CYCLE', id, 'STATUS_CHANGE', ctx, { status: row.status }, { status: target });
    return after;
  }

  /** The cycle's stage windows measured against today. */
  async calendar(id: number): Promise<{ cycleId: number; today: string; stages: CycleCalendarEntry[] }> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error(`Performance cycle ${id} was not found`);
    const today = todayString();

    const entry = (stage: string, start: unknown, end: unknown): CycleCalendarEntry | null => {
      const s = dateOrNull(start);
      const e = dateOrNull(end);
      if (!s || !e) return null;
      const status: CycleCalendarEntry['status'] = today < s ? 'UPCOMING' : today > e ? 'CLOSED' : 'OPEN';
      return { stage, start: s, end: e, status };
    };

    const stages = [
      entry('CYCLE', row.start_date, row.end_date),
      entry('GOAL_SETTING', row.goal_setting_start, row.goal_setting_end),
      entry('SELF_REVIEW', row.self_review_start, row.self_review_end),
      entry('MANAGER_REVIEW', row.manager_review_start, row.manager_review_end),
      entry('CALIBRATION', row.calibration_start, row.calibration_end),
    ].filter((s): s is CycleCalendarEntry => s !== null);

    return { cycleId: id, today, stages };
  }

  private validateDates(input: CycleInput): void {
    const dateFields: [string, string | null | undefined][] = [
      ['startDate', input.startDate],
      ['endDate', input.endDate],
      ['goalSettingStart', input.goalSettingStart],
      ['goalSettingEnd', input.goalSettingEnd],
      ['selfReviewStart', input.selfReviewStart],
      ['selfReviewEnd', input.selfReviewEnd],
      ['managerReviewStart', input.managerReviewStart],
      ['managerReviewEnd', input.managerReviewEnd],
      ['calibrationStart', input.calibrationStart],
      ['calibrationEnd', input.calibrationEnd],
    ];
    for (const [name, value] of dateFields) {
      if (value !== undefined && value !== null && !isValidDateString(String(value))) {
        throw new Error(`${name} must be a valid YYYY-MM-DD date`);
      }
    }
    if (input.startDate && input.endDate && input.endDate < input.startDate) {
      throw new Error('endDate must be on or after startDate');
    }
  }
}
