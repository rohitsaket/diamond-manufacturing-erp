import { AssessmentRepository } from '../repositories/AssessmentRepository';
import { RecruitmentAuditService } from './RecruitmentAuditService';
import { NotificationService } from './NotificationService';
import { PerfActionContext } from '../types/performance';
import { AssessmentResponse, AssessmentResultResponse } from '../types/internalRecruitment';

const TYPES = ['TECHNICAL', 'APTITUDE', 'CODING', 'BEHAVIORAL', 'LEADERSHIP', 'SKILL'];
/** Application statuses from which an assessment may be assigned. */
const ASSIGNABLE = ['UNDER_REVIEW', 'SHORTLISTED', 'ASSESSMENT'];

const DELIVERY_NOTE =
  'Assessments are recorded and scored by assessors in this system - online test delivery does not exist in this deployment.';

function toResponse(row: any): AssessmentResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    assessmentType: row.assessment_type,
    description: row.description,
    maxScore: Number(row.max_score),
    passScore: row.pass_score === null ? null : Number(row.pass_score),
    durationMinutes: row.duration_minutes,
    isActive: !!row.is_active,
  };
}

function toResultResponse(row: any): AssessmentResultResponse {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    assessmentName: row.assessment_name,
    applicationId: row.application_id,
    employeeId: row.employee_id,
    employeeName: row.employee_name ?? null,
    score: row.score === null ? null : Number(row.score),
    result: row.result,
    notes: row.notes,
    assessedBy: row.assessed_by,
    assessedAt: row.assessed_at,
  };
}

export class AssessmentService {
  private repo = new AssessmentRepository();
  private audit = new RecruitmentAuditService();
  private notifications = new NotificationService();

  async list(): Promise<AssessmentResponse[]> {
    const rows = await this.repo.findAll();
    return rows.map(toResponse);
  }

  async create(body: any, ctx: PerfActionContext): Promise<{ assessment: AssessmentResponse; note: string }> {
    if (!body?.code || !body?.name) throw new Error('code and name are required');
    if (body.assessmentType && !TYPES.includes(body.assessmentType)) {
      throw new Error(`assessmentType must be one of ${TYPES.join(', ')}`);
    }
    const existing = await this.repo.findByCode(String(body.code));
    if (existing) throw new Error(`An assessment with code ${body.code} already exists`);
    const id = await this.repo.insert(
      { ...body, assessmentType: body.assessmentType ?? 'SKILL' },
      ctx.userId,
    );
    await this.audit.record('ASSESSMENT', id, 'CREATED', ctx, null, { code: body.code, name: body.name });
    const row = await this.repo.findById(id);
    return { assessment: toResponse(row), note: DELIVERY_NOTE };
  }

  async update(id: number, body: any, ctx: PerfActionContext): Promise<AssessmentResponse> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error('Assessment not found');
    const sets: string[] = [];
    const params: any[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); params.push(body.name); }
    if (body.description !== undefined) { sets.push('description = ?'); params.push(body.description); }
    if (body.assessmentType !== undefined) {
      if (!TYPES.includes(body.assessmentType)) throw new Error(`assessmentType must be one of ${TYPES.join(', ')}`);
      sets.push('assessment_type = ?'); params.push(body.assessmentType);
    }
    if (body.maxScore !== undefined) { sets.push('max_score = ?'); params.push(Number(body.maxScore)); }
    if (body.passScore !== undefined) { sets.push('pass_score = ?'); params.push(body.passScore === null ? null : Number(body.passScore)); }
    if (body.durationMinutes !== undefined) { sets.push('duration_minutes = ?'); params.push(body.durationMinutes === null ? null : Math.trunc(Number(body.durationMinutes))); }
    if (body.isActive !== undefined) { sets.push('is_active = ?'); params.push(!!body.isActive); }
    await this.repo.update(id, sets, params);
    await this.audit.record('ASSESSMENT', id, 'UPDATED', ctx, null, body);
    const updated = await this.repo.findById(id);
    return toResponse(updated);
  }

  async assign(assessmentId: number, applicationId: number, ctx: PerfActionContext): Promise<AssessmentResultResponse> {
    const assessment = await this.repo.findById(assessmentId);
    if (!assessment) throw new Error('Assessment not found');
    if (!assessment.is_active) throw new Error('This assessment is inactive');
    const application = await this.repo.findApplication(applicationId);
    if (!application) throw new Error('Application not found');
    if (!ASSIGNABLE.includes(application.status)) {
      throw new Error(`Assessments can be assigned only in ${ASSIGNABLE.join('/')} (current: ${application.status})`);
    }
    const existing = await this.repo.findPendingResult(assessmentId, applicationId);
    if (existing) throw new Error('This assessment is already assigned to the application');

    const transitionFrom = application.status !== 'ASSESSMENT' ? application.status : null;
    const id = await this.repo.assign(
      { assessmentId, applicationId, employeeId: application.employee_id },
      transitionFrom,
      ctx.userId,
    );
    await this.audit.record('ASSESSMENT_RESULT', id, 'ASSIGNED', ctx, null, { assessmentId, applicationId });
    try {
      await this.notifications.notifyEmployee(application.employee_id, {
        category: 'RECRUITMENT',
        priority: 'NORMAL',
        title: `Assessment assigned: ${assessment.name}`,
        body: 'Your assessor will schedule the assessment with you.',
        linkPage: 'internaljobs',
        email: true,
      });
    } catch (err) {
      console.error('assessment notification failed:', err);
    }
    const row = await this.repo.findResultById(id);
    return toResultResponse(row);
  }

  async recordResult(resultId: number, body: any, ctx: PerfActionContext): Promise<AssessmentResultResponse> {
    const row = await this.repo.findResultById(resultId);
    if (!row) throw new Error('Assessment result not found');
    const score = body?.score === undefined || body.score === null ? null : Number(body.score);
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > Number(row.max_score))) {
      throw new Error(`score must be between 0 and ${row.max_score}`);
    }
    // With a pass_score the verdict is derived; without one the assessor must
    // state PASS/FAIL explicitly - the system never guesses.
    let verdict: string;
    if (row.pass_score !== null && score !== null) {
      verdict = score >= Number(row.pass_score) ? 'PASS' : 'FAIL';
    } else if (body?.result === 'PASS' || body?.result === 'FAIL') {
      verdict = body.result;
    } else {
      throw new Error('This assessment has no pass score; provide result PASS or FAIL explicitly');
    }
    await this.repo.updateResult(resultId, score, verdict, body?.notes ?? null, ctx.userId);
    await this.audit.record('ASSESSMENT_RESULT', resultId, 'SCORED', ctx,
      { result: row.result, score: row.score }, { result: verdict, score });
    const updated = await this.repo.findResultById(resultId);
    return toResultResponse(updated);
  }

  async listResults(filters: { applicationId?: number; employeeId?: number }): Promise<AssessmentResultResponse[]> {
    const rows = await this.repo.findResults(filters);
    return rows.map(toResultResponse);
  }
}
