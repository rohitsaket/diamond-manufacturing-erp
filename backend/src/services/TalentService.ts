import { TalentRepository } from '../repositories/TalentRepository';
import { PerfAuditService } from './PerfAuditService';
import {
  CalibrationSessionResponse,
  PerfActionContext,
  SuccessionPlanResponse,
  TalentAssessmentResponse,
  TalentPoolResponse,
} from '../types/performance';
import { toDateString } from '../utils/dateUtils';

const POOL_TYPES = ['HIPO', 'LEADERSHIP', 'CRITICAL_SKILL', 'SUCCESSOR', 'CUSTOM'];
const CRITICALITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const RISK = ['LOW', 'MEDIUM', 'HIGH'];
const READINESS = ['READY_NOW', 'READY_1_YEAR', 'READY_2_YEARS', 'DEVELOPMENT_NEEDED'];
const ATTRITION = ['LOW', 'MEDIUM', 'HIGH'];

/** Standard 9-box names, row-major: 1 = low perf / low potential, 9 = high/high. */
export const NINE_BOX_LABELS: Record<number, string> = {
  1: 'Underperformer',
  2: 'Effective Performer',
  3: 'Trusted Professional',
  4: 'Inconsistent Player',
  5: 'Core Player',
  6: 'High Performer',
  7: 'Rough Diamond',
  8: 'Future Star',
  9: 'Star',
};

/** Thirds on the 0-5 scale: <=2.33 low, <=3.67 mid, else high. */
function third(score: number): 1 | 2 | 3 {
  if (score <= 2.33) return 1;
  if (score <= 3.67) return 2;
  return 3;
}

function parseJson(value: unknown): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

/**
 * Talent management: the 9-box matrix, talent pools, succession planning and
 * calibration sessions.
 */
export class TalentService {
  private repo = new TalentRepository();
  private audit = new PerfAuditService();

  // ==========================================================================
  // 9-box matrix
  // ==========================================================================

  async matrix(cycleId: number): Promise<{
    cycleId: number;
    boxes: { position: number; label: string; employees: TalentAssessmentResponse[] }[];
    unassessed: { employeeId: number; empCode: string; employeeName: string; grade: string | null }[];
  }> {
    const cycle = await this.repo.findCycleById(cycleId);
    if (!cycle) throw new Error('Performance cycle not found');

    const [assessments, unassessed] = await Promise.all([
      this.repo.findAssessments(cycleId),
      this.repo.findUnassessedEmployees(cycleId),
    ]);

    const boxes = Array.from({ length: 9 }, (_, i) => ({
      position: i + 1,
      label: NINE_BOX_LABELS[i + 1] as string,
      employees: [] as TalentAssessmentResponse[],
    }));
    for (const row of assessments) {
      const pos = Number(row.box_position);
      const box = boxes[pos - 1];
      if (box) box.employees.push(this.toAssessmentResponse(row));
    }

    return {
      cycleId,
      boxes,
      unassessed: unassessed.map((r) => ({
        employeeId: Number(r.employee_id),
        empCode: String(r.emp_code),
        employeeName: String(r.full_name),
        grade: r.grade ?? null,
      })),
    };
  }

  /** Upsert one employee's assessment; box and HiPo flag are derived, not supplied. */
  async assess(body: any, ctx: PerfActionContext): Promise<TalentAssessmentResponse> {
    const cycleId = Math.trunc(Number(body?.cycleId));
    const employeeId = Math.trunc(Number(body?.employeeId));
    const performanceScore = Number(body?.performanceScore);
    const potentialScore = Number(body?.potentialScore);
    if (!cycleId || !employeeId) throw new Error('cycleId and employeeId are required');
    for (const [name, score] of [['performanceScore', performanceScore], ['potentialScore', potentialScore]] as const) {
      if (!Number.isFinite(score) || score < 0 || score > 5) throw new Error(`${name} must be between 0 and 5`);
    }
    if (body.attritionRisk !== undefined && body.attritionRisk !== null && !ATTRITION.includes(body.attritionRisk)) {
      throw new Error(`attritionRisk must be one of ${ATTRITION.join(', ')}`);
    }

    const cycle = await this.repo.findCycleById(cycleId);
    if (!cycle) throw new Error('Performance cycle not found');
    const employee = await this.repo.findEmployeeById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const perfLevel = third(performanceScore);
    const potLevel = third(potentialScore);
    const boxPosition = (potLevel - 1) * 3 + perfLevel;
    const isHipo = potLevel === 3 && perfLevel >= 2;

    const before = await this.repo.findAssessment(cycleId, employeeId);
    await this.repo.upsertAssessment({
      cycleId,
      employeeId,
      performanceScore,
      potentialScore,
      boxPosition,
      isHipo,
      attritionRisk: body.attritionRisk ?? null,
      assessmentNote: body.note ?? null,
      assessedBy: ctx.userId,
    });

    const after = await this.repo.findAssessment(cycleId, employeeId);
    await this.audit.record(
      'TALENT_ASSESSMENT',
      Number(after.id),
      before ? 'UPDATE' : 'CREATE',
      ctx,
      before ? this.toAssessmentResponse(before) : null,
      this.toAssessmentResponse(after),
    );
    return this.toAssessmentResponse(after);
  }

  // ==========================================================================
  // Talent pools
  // ==========================================================================

  async listPools(): Promise<TalentPoolResponse[]> {
    const rows = await this.repo.findPools();
    return rows.map((r) => this.toPoolResponse(r));
  }

  async getPool(id: number): Promise<TalentPoolResponse> {
    const row = await this.repo.findPoolById(id);
    if (!row) throw new Error('Talent pool not found');
    const members = await this.repo.findPoolMembers(id);
    const pool = this.toPoolResponse(row);
    pool.memberCount = members.length;
    pool.members = members.map((m) => ({
      id: Number(m.id),
      employeeId: Number(m.employee_id),
      employeeName: String(m.employee_name),
      note: m.note ?? null,
      addedAt: m.added_at ? new Date(m.added_at).toISOString() : '',
    }));
    return pool;
  }

  async createPool(body: any, ctx: PerfActionContext): Promise<TalentPoolResponse> {
    if (!body?.code || !body?.name) throw new Error('code and name are required');
    const poolType = body.poolType ?? 'CUSTOM';
    if (!POOL_TYPES.includes(poolType)) throw new Error(`poolType must be one of ${POOL_TYPES.join(', ')}`);
    const existing = await this.repo.findPoolByCode(String(body.code));
    if (existing) throw new Error(`A talent pool with code ${body.code} already exists`);

    const id = await this.repo.insertPool({
      code: String(body.code),
      name: String(body.name),
      poolType,
      description: body.description ?? null,
      isActive: body.isActive === undefined ? true : !!body.isActive,
      createdBy: ctx.userId,
    });
    await this.audit.record('TALENT_POOL', id, 'CREATE', ctx, null, body);
    return this.getPool(id);
  }

  async updatePool(id: number, body: any, ctx: PerfActionContext): Promise<TalentPoolResponse> {
    const before = await this.repo.findPoolById(id);
    if (!before) throw new Error('Talent pool not found');

    const sets: string[] = [];
    const params: any[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); params.push(String(body.name)); }
    if (body.poolType !== undefined) {
      if (!POOL_TYPES.includes(body.poolType)) throw new Error(`poolType must be one of ${POOL_TYPES.join(', ')}`);
      sets.push('pool_type = ?'); params.push(body.poolType);
    }
    if (body.description !== undefined) { sets.push('description = ?'); params.push(body.description ?? null); }
    if (body.isActive !== undefined) { sets.push('is_active = ?'); params.push(!!body.isActive); }
    if (sets.length === 0) throw new Error('Nothing to update');

    await this.repo.updatePool(id, sets, params);
    await this.audit.record('TALENT_POOL', id, 'UPDATE', ctx, this.toPoolResponse(before), body);
    return this.getPool(id);
  }

  async addPoolMember(poolId: number, body: any, ctx: PerfActionContext): Promise<TalentPoolResponse> {
    const pool = await this.repo.findPoolById(poolId);
    if (!pool) throw new Error('Talent pool not found');
    const employeeId = Math.trunc(Number(body?.employeeId));
    if (!employeeId) throw new Error('employeeId is required');
    const employee = await this.repo.findEmployeeById(employeeId);
    if (!employee) throw new Error('Employee not found');

    // The (pool, employee) pair is unique and removal keeps the row, so a
    // re-add reactivates the existing membership instead of inserting.
    const existing = await this.repo.findMembership(poolId, employeeId);
    if (existing && existing.removed_at === null) throw new Error('Employee is already a member of this pool');
    if (existing) {
      await this.repo.reactivateMember(Number(existing.id), body.note ?? null, ctx.userId);
      await this.audit.record('TALENT_POOL_MEMBER', Number(existing.id), 'READD', ctx, null, { poolId, employeeId });
    } else {
      const memberId = await this.repo.insertMember(poolId, employeeId, body.note ?? null, ctx.userId);
      await this.audit.record('TALENT_POOL_MEMBER', memberId, 'ADD', ctx, null, { poolId, employeeId });
    }
    return this.getPool(poolId);
  }

  async removePoolMember(memberId: number, ctx: PerfActionContext): Promise<{ removed: true }> {
    const member = await this.repo.findMembershipById(memberId);
    if (!member) throw new Error('Pool membership not found');
    if (member.removed_at !== null) throw new Error('This membership has already been removed');
    await this.repo.removeMember(memberId);
    await this.audit.record('TALENT_POOL_MEMBER', memberId, 'REMOVE', ctx, { poolId: member.pool_id, employeeId: member.employee_id }, null);
    return { removed: true };
  }

  // ==========================================================================
  // Succession planning
  // ==========================================================================

  async listSuccessionPlans(status?: string): Promise<SuccessionPlanResponse[]> {
    const plans = await this.repo.findSuccessionPlans(status);
    const candidates = await this.repo.findSuccessionCandidates(plans.map((p) => Number(p.id)));
    const byPlan = new Map<number, any[]>();
    for (const c of candidates) {
      const list = byPlan.get(Number(c.plan_id)) ?? [];
      list.push(c);
      byPlan.set(Number(c.plan_id), list);
    }
    return plans.map((p) => this.toSuccessionResponse(p, byPlan.get(Number(p.id)) ?? []));
  }

  async getSuccessionPlan(id: number): Promise<SuccessionPlanResponse> {
    const plan = await this.repo.findSuccessionPlanById(id);
    if (!plan) throw new Error('Succession plan not found');
    const candidates = await this.repo.findSuccessionCandidates([id]);
    return this.toSuccessionResponse(plan, candidates);
  }

  async createSuccessionPlan(body: any, ctx: PerfActionContext): Promise<SuccessionPlanResponse> {
    if (!body?.positionId && !body?.roleId && !body?.incumbentEmployeeId) {
      throw new Error('A succession plan needs at least a positionId, roleId or incumbentEmployeeId');
    }
    if (body.criticality !== undefined && !CRITICALITY.includes(body.criticality)) {
      throw new Error(`criticality must be one of ${CRITICALITY.join(', ')}`);
    }
    if (body.riskOfLoss !== undefined && !RISK.includes(body.riskOfLoss)) {
      throw new Error(`riskOfLoss must be one of ${RISK.join(', ')}`);
    }
    if (body.incumbentEmployeeId) {
      const employee = await this.repo.findEmployeeById(Math.trunc(Number(body.incumbentEmployeeId)));
      if (!employee) throw new Error('Incumbent employee not found');
    }
    const id = await this.repo.insertSuccessionPlan({
      positionId: body.positionId ? Math.trunc(Number(body.positionId)) : null,
      roleId: body.roleId ? Math.trunc(Number(body.roleId)) : null,
      incumbentEmployeeId: body.incumbentEmployeeId ? Math.trunc(Number(body.incumbentEmployeeId)) : null,
      criticality: body.criticality ?? 'MEDIUM',
      riskOfLoss: body.riskOfLoss ?? 'LOW',
      notes: body.notes ?? null,
      createdBy: ctx.userId,
    });
    await this.audit.record('SUCCESSION_PLAN', id, 'CREATE', ctx, null, body);
    return this.getSuccessionPlan(id);
  }

  async updateSuccessionPlan(id: number, body: any, ctx: PerfActionContext): Promise<SuccessionPlanResponse> {
    const before = await this.repo.findSuccessionPlanById(id);
    if (!before) throw new Error('Succession plan not found');

    const sets: string[] = [];
    const params: any[] = [];
    if (body.positionId !== undefined) { sets.push('position_id = ?'); params.push(body.positionId ? Math.trunc(Number(body.positionId)) : null); }
    if (body.roleId !== undefined) { sets.push('role_id = ?'); params.push(body.roleId ? Math.trunc(Number(body.roleId)) : null); }
    if (body.incumbentEmployeeId !== undefined) { sets.push('incumbent_employee_id = ?'); params.push(body.incumbentEmployeeId ? Math.trunc(Number(body.incumbentEmployeeId)) : null); }
    if (body.criticality !== undefined) {
      if (!CRITICALITY.includes(body.criticality)) throw new Error(`criticality must be one of ${CRITICALITY.join(', ')}`);
      sets.push('criticality = ?'); params.push(body.criticality);
    }
    if (body.riskOfLoss !== undefined) {
      if (!RISK.includes(body.riskOfLoss)) throw new Error(`riskOfLoss must be one of ${RISK.join(', ')}`);
      sets.push('risk_of_loss = ?'); params.push(body.riskOfLoss);
    }
    if (body.status !== undefined) {
      if (!['ACTIVE', 'CLOSED'].includes(body.status)) throw new Error('status must be ACTIVE or CLOSED');
      sets.push('status = ?'); params.push(body.status);
    }
    if (body.notes !== undefined) { sets.push('notes = ?'); params.push(body.notes ?? null); }
    if (sets.length === 0) throw new Error('Nothing to update');

    await this.repo.updateSuccessionPlan(id, sets, params);
    await this.audit.record('SUCCESSION_PLAN', id, 'UPDATE', ctx, null, body);
    return this.getSuccessionPlan(id);
  }

  async addSuccessionCandidate(planId: number, body: any, ctx: PerfActionContext): Promise<SuccessionPlanResponse> {
    const plan = await this.repo.findSuccessionPlanById(planId);
    if (!plan) throw new Error('Succession plan not found');
    const employeeId = Math.trunc(Number(body?.employeeId));
    if (!employeeId) throw new Error('employeeId is required');
    const employee = await this.repo.findEmployeeById(employeeId);
    if (!employee) throw new Error('Employee not found');
    const readiness = body.readiness ?? 'DEVELOPMENT_NEEDED';
    if (!READINESS.includes(readiness)) throw new Error(`readiness must be one of ${READINESS.join(', ')}`);
    const existing = await this.repo.findCandidatePair(planId, employeeId);
    if (existing) throw new Error('Employee is already a candidate on this plan');

    const id = await this.repo.insertSuccessionCandidate({
      planId,
      employeeId,
      readiness,
      ranking: body.ranking !== undefined && body.ranking !== null ? Math.trunc(Number(body.ranking)) : null,
      developmentNote: body.developmentNote ?? null,
    });
    await this.audit.record('SUCCESSION_CANDIDATE', id, 'CREATE', ctx, null, { planId, employeeId, readiness });
    return this.getSuccessionPlan(planId);
  }

  async updateSuccessionCandidate(id: number, body: any, ctx: PerfActionContext): Promise<SuccessionPlanResponse> {
    const before = await this.repo.findSuccessionCandidateById(id);
    if (!before) throw new Error('Succession candidate not found');

    const sets: string[] = [];
    const params: any[] = [];
    if (body.readiness !== undefined) {
      if (!READINESS.includes(body.readiness)) throw new Error(`readiness must be one of ${READINESS.join(', ')}`);
      sets.push('readiness = ?'); params.push(body.readiness);
    }
    if (body.ranking !== undefined) { sets.push('ranking = ?'); params.push(body.ranking === null ? null : Math.trunc(Number(body.ranking))); }
    if (body.developmentNote !== undefined) { sets.push('development_note = ?'); params.push(body.developmentNote ?? null); }
    if (sets.length === 0) throw new Error('Nothing to update');

    await this.repo.updateSuccessionCandidate(id, sets, params);
    await this.audit.record('SUCCESSION_CANDIDATE', id, 'UPDATE', ctx, null, body);
    return this.getSuccessionPlan(Number(before.plan_id));
  }

  async removeSuccessionCandidate(id: number, ctx: PerfActionContext): Promise<{ removed: true }> {
    const before = await this.repo.findSuccessionCandidateById(id);
    if (!before) throw new Error('Succession candidate not found');
    await this.repo.deleteSuccessionCandidate(id);
    await this.audit.record('SUCCESSION_CANDIDATE', id, 'DELETE', ctx, { planId: before.plan_id, employeeId: before.employee_id }, null);
    return { removed: true };
  }

  async successionDashboard(): Promise<{
    plans: number;
    coverage: number;
    gaps: number;
    highRisk: number;
    detail: { planId: number; positionName: string | null; roleName: string | null; incumbentName: string | null; criticality: string; riskOfLoss: string; readyNow: number; candidates: number }[];
  }> {
    const plans = await this.repo.findSuccessionPlans('ACTIVE');
    const candidates = await this.repo.findSuccessionCandidates(plans.map((p) => Number(p.id)));
    const byPlan = new Map<number, any[]>();
    for (const c of candidates) {
      const list = byPlan.get(Number(c.plan_id)) ?? [];
      list.push(c);
      byPlan.set(Number(c.plan_id), list);
    }

    let coverage = 0;
    let gaps = 0;
    let highRisk = 0;
    const detail = plans.map((p) => {
      const planCandidates = byPlan.get(Number(p.id)) ?? [];
      const readyNow = planCandidates.filter((c) => c.readiness === 'READY_NOW').length;
      if (readyNow > 0) coverage++; else gaps++;
      if (p.risk_of_loss === 'HIGH' && readyNow === 0) highRisk++;
      return {
        planId: Number(p.id),
        positionName: p.position_name ?? null,
        roleName: p.role_name ?? null,
        incumbentName: p.incumbent_name ?? null,
        criticality: String(p.criticality),
        riskOfLoss: String(p.risk_of_loss),
        readyNow,
        candidates: planCandidates.length,
      };
    });

    return { plans: plans.length, coverage, gaps, highRisk, detail };
  }

  // ==========================================================================
  // Calibration
  // ==========================================================================

  async listCalibrationSessions(cycleId?: number): Promise<CalibrationSessionResponse[]> {
    const rows = await this.repo.findCalibrationSessions(cycleId);
    return rows.map((r) => this.toSessionResponse(r));
  }

  async getCalibrationSession(id: number): Promise<CalibrationSessionResponse> {
    const row = await this.repo.findCalibrationSessionById(id);
    if (!row) throw new Error('Calibration session not found');
    const adjustments = await this.repo.findAdjustmentsForSession(id);
    const session = this.toSessionResponse(row);
    session.adjustments = adjustments.map((a) => ({
      id: Number(a.id),
      sessionId: Number(a.session_id),
      appraisalId: Number(a.appraisal_id),
      employeeName: a.employee_name ?? null,
      previousRating: a.previous_rating === null ? null : Number(a.previous_rating),
      adjustedRating: Number(a.adjusted_rating),
      reason: a.reason ?? null,
      createdAt: a.created_at ? new Date(a.created_at).toISOString() : '',
    }));
    return session;
  }

  async createCalibrationSession(body: any, ctx: PerfActionContext): Promise<CalibrationSessionResponse> {
    const cycleId = Math.trunc(Number(body?.cycleId));
    if (!cycleId || !body?.name) throw new Error('cycleId and name are required');
    const cycle = await this.repo.findCycleById(cycleId);
    if (!cycle) throw new Error('Performance cycle not found');
    if (body.committee !== undefined && body.committee !== null && !Array.isArray(body.committee)) {
      throw new Error('committee must be an array of {name, role?}');
    }
    const id = await this.repo.insertCalibrationSession({
      cycleId,
      name: String(body.name),
      sessionDate: body.sessionDate ?? null,
      departmentId: body.departmentId ? Math.trunc(Number(body.departmentId)) : null,
      committeeJson: body.committee ? JSON.stringify(body.committee) : null,
      notes: body.notes ?? null,
      createdBy: ctx.userId,
    });
    await this.audit.record('CALIBRATION_SESSION', id, 'CREATE', ctx, null, body);
    return this.getCalibrationSession(id);
  }

  async updateCalibrationSession(id: number, body: any, ctx: PerfActionContext): Promise<CalibrationSessionResponse> {
    const before = await this.repo.findCalibrationSessionById(id);
    if (!before) throw new Error('Calibration session not found');

    const sets: string[] = [];
    const params: any[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); params.push(String(body.name)); }
    if (body.sessionDate !== undefined) { sets.push('session_date = ?'); params.push(body.sessionDate ?? null); }
    if (body.departmentId !== undefined) { sets.push('department_id = ?'); params.push(body.departmentId ? Math.trunc(Number(body.departmentId)) : null); }
    if (body.committee !== undefined) {
      if (body.committee !== null && !Array.isArray(body.committee)) throw new Error('committee must be an array of {name, role?}');
      sets.push('committee_json = ?'); params.push(body.committee ? JSON.stringify(body.committee) : null);
    }
    if (body.notes !== undefined) { sets.push('notes = ?'); params.push(body.notes ?? null); }
    if (body.status !== undefined) {
      if (!['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'].includes(body.status)) {
        throw new Error('status must be SCHEDULED, IN_PROGRESS or COMPLETED');
      }
      sets.push('status = ?'); params.push(body.status);
    }
    if (sets.length === 0) throw new Error('Nothing to update');

    await this.repo.updateCalibrationSession(id, sets, params);
    await this.audit.record('CALIBRATION_SESSION', id, 'UPDATE', ctx, null, body);
    return this.getCalibrationSession(id);
  }

  /**
   * Committee adjustment: records the appraisal's rating as it stood
   * (calibrated, falling back to manager) and applies the new calibrated
   * rating in the same transaction.
   */
  async adjust(sessionId: number, body: any, ctx: PerfActionContext): Promise<CalibrationSessionResponse> {
    const session = await this.repo.findCalibrationSessionById(sessionId);
    if (!session) throw new Error('Calibration session not found');
    if (session.status === 'COMPLETED') throw new Error('This calibration session is already completed');

    const appraisalId = Math.trunc(Number(body?.appraisalId));
    const adjustedRating = Number(body?.adjustedRating);
    if (!appraisalId) throw new Error('appraisalId is required');
    if (!Number.isFinite(adjustedRating) || adjustedRating < 0 || adjustedRating > 5) {
      throw new Error('adjustedRating must be between 0 and 5');
    }

    const appraisal = await this.repo.findAppraisalById(appraisalId);
    if (!appraisal) throw new Error('Appraisal not found');
    if (Number(appraisal.cycle_id) !== Number(session.cycle_id)) {
      throw new Error('The appraisal belongs to a different cycle than this session');
    }
    if (['FINALIZED', 'LETTER_ISSUED', 'ACKNOWLEDGED'].includes(appraisal.status)) {
      throw new Error(`Appraisal can no longer be calibrated once ${appraisal.status}`);
    }

    const previousRating = appraisal.calibrated_rating !== null
      ? Number(appraisal.calibrated_rating)
      : appraisal.manager_rating !== null ? Number(appraisal.manager_rating) : null;

    const adjustmentId = await this.repo.applyAdjustment(
      sessionId, appraisalId, previousRating, adjustedRating, body.reason ?? null, ctx.userId,
    );
    await this.audit.record('CALIBRATION_ADJUSTMENT', adjustmentId, 'CREATE', ctx, { previousRating }, { adjustedRating, reason: body.reason ?? null });
    await this.audit.record('APPRAISAL', appraisalId, 'CALIBRATE', ctx, { calibratedRating: appraisal.calibrated_rating, status: appraisal.status }, { calibratedRating: adjustedRating, status: 'CALIBRATED' });

    // Move a freshly-used session into IN_PROGRESS so the dashboard reflects reality.
    if (session.status === 'SCHEDULED') {
      await this.repo.updateCalibrationSession(sessionId, ["status = 'IN_PROGRESS'"], []);
    }
    return this.getCalibrationSession(sessionId);
  }

  async completeCalibrationSession(id: number, ctx: PerfActionContext): Promise<CalibrationSessionResponse> {
    const before = await this.repo.findCalibrationSessionById(id);
    if (!before) throw new Error('Calibration session not found');
    if (before.status === 'COMPLETED') throw new Error('Session is already completed');
    await this.repo.updateCalibrationSession(id, ["status = 'COMPLETED'"], []);
    await this.audit.record('CALIBRATION_SESSION', id, 'COMPLETE', ctx, { status: before.status }, { status: 'COMPLETED' });
    return this.getCalibrationSession(id);
  }

  // ==========================================================================
  // Reports
  // ==========================================================================

  async talentReviewReport(cycleId?: number): Promise<{ columns: { key: string; label: string }[]; rows: any[] }> {
    if (!cycleId) {
      return {
        columns: [{ key: 'note', label: 'Note' }],
        rows: [{ note: 'Pass ?cycleId= to run the talent review report for a cycle' }],
      };
    }
    const rows = await this.repo.findAssessments(cycleId);
    return {
      columns: [
        { key: 'empCode', label: 'Emp Code' },
        { key: 'employeeName', label: 'Employee' },
        { key: 'grade', label: 'Grade' },
        { key: 'performanceScore', label: 'Performance' },
        { key: 'potentialScore', label: 'Potential' },
        { key: 'boxPosition', label: 'Box' },
        { key: 'boxLabel', label: 'Box Label' },
        { key: 'isHipo', label: 'HiPo' },
        { key: 'attritionRisk', label: 'Attrition Risk' },
      ],
      rows: rows.map((r) => ({
        empCode: r.emp_code ?? '',
        employeeName: r.employee_name ?? '',
        grade: r.grade ?? '',
        performanceScore: Number(r.performance_score),
        potentialScore: Number(r.potential_score),
        boxPosition: Number(r.box_position),
        boxLabel: NINE_BOX_LABELS[Number(r.box_position)] ?? '',
        isHipo: r.is_hipo ? 'Yes' : 'No',
        attritionRisk: r.attrition_risk ?? '',
      })),
    };
  }

  async successionReport(): Promise<{ columns: { key: string; label: string }[]; rows: any[] }> {
    const plans = await this.listSuccessionPlans();
    return {
      columns: [
        { key: 'position', label: 'Position / Role' },
        { key: 'incumbent', label: 'Incumbent' },
        { key: 'criticality', label: 'Criticality' },
        { key: 'riskOfLoss', label: 'Risk of Loss' },
        { key: 'status', label: 'Status' },
        { key: 'candidates', label: 'Candidates' },
        { key: 'readyNow', label: 'Ready Now' },
      ],
      rows: plans.map((p) => ({
        position: p.positionName ?? p.roleName ?? '',
        incumbent: p.incumbentName ?? '',
        criticality: p.criticality,
        riskOfLoss: p.riskOfLoss,
        status: p.status,
        candidates: p.candidates?.length ?? 0,
        readyNow: p.candidates?.filter((c) => c.readiness === 'READY_NOW').length ?? 0,
      })),
    };
  }

  async calibrationReport(cycleId?: number): Promise<{ columns: { key: string; label: string }[]; rows: any[] }> {
    const sessions = await this.repo.findCalibrationSessions(cycleId);
    const rows: any[] = [];
    for (const s of sessions) {
      const adjustments = await this.repo.findAdjustmentsForSession(Number(s.id));
      for (const a of adjustments) {
        rows.push({
          session: s.name,
          cycle: s.cycle_name,
          employeeName: a.employee_name ?? '',
          previousRating: a.previous_rating ?? '',
          adjustedRating: Number(a.adjusted_rating),
          reason: a.reason ?? '',
          date: a.created_at ? new Date(a.created_at).toISOString().slice(0, 10) : '',
        });
      }
    }
    return {
      columns: [
        { key: 'session', label: 'Session' },
        { key: 'cycle', label: 'Cycle' },
        { key: 'employeeName', label: 'Employee' },
        { key: 'previousRating', label: 'Previous' },
        { key: 'adjustedRating', label: 'Adjusted' },
        { key: 'reason', label: 'Reason' },
        { key: 'date', label: 'Date' },
      ],
      rows,
    };
  }

  // ==========================================================================
  // Mappers
  // ==========================================================================

  private toAssessmentResponse(r: any): TalentAssessmentResponse {
    return {
      id: Number(r.id),
      cycleId: Number(r.cycle_id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      empCode: r.emp_code ?? null,
      grade: r.grade ?? null,
      performanceScore: Number(r.performance_score),
      potentialScore: Number(r.potential_score),
      boxPosition: Number(r.box_position),
      isHipo: !!r.is_hipo,
      attritionRisk: r.attrition_risk ?? null,
      assessmentNote: r.assessment_note ?? null,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : '',
    };
  }

  private toPoolResponse(r: any): TalentPoolResponse {
    return {
      id: Number(r.id),
      code: String(r.code),
      name: String(r.name),
      poolType: r.pool_type,
      description: r.description ?? null,
      isActive: !!r.is_active,
      memberCount: r.member_count !== undefined ? Number(r.member_count) : undefined,
    };
  }

  private toSuccessionResponse(p: any, candidates: any[]): SuccessionPlanResponse {
    return {
      id: Number(p.id),
      positionId: p.position_id === null ? null : Number(p.position_id),
      positionName: p.position_name ?? null,
      roleId: p.role_id === null ? null : Number(p.role_id),
      roleName: p.role_name ?? null,
      incumbentEmployeeId: p.incumbent_employee_id === null ? null : Number(p.incumbent_employee_id),
      incumbentName: p.incumbent_name ?? null,
      criticality: p.criticality,
      riskOfLoss: p.risk_of_loss,
      status: p.status,
      notes: p.notes ?? null,
      candidates: candidates.map((c) => ({
        id: Number(c.id),
        planId: Number(c.plan_id),
        employeeId: Number(c.employee_id),
        employeeName: c.employee_name ?? null,
        readiness: c.readiness,
        ranking: c.ranking === null ? null : Number(c.ranking),
        developmentNote: c.development_note ?? null,
      })),
    };
  }

  private toSessionResponse(r: any): CalibrationSessionResponse {
    return {
      id: Number(r.id),
      cycleId: Number(r.cycle_id),
      cycleName: r.cycle_name ?? null,
      name: String(r.name),
      sessionDate: r.session_date ? toDateString(r.session_date) : null,
      departmentId: r.department_id === null ? null : Number(r.department_id),
      departmentName: r.department_name ?? null,
      status: r.status,
      committee: parseJson(r.committee_json),
      notes: r.notes ?? null,
    };
  }
}
