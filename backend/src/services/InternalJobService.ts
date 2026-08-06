import { InternalJobRepository, JobFilters, PortalJobFilters } from '../repositories/InternalJobRepository';
import { EligibilityService } from './EligibilityService';
import { RecruitmentAuditService } from './RecruitmentAuditService';
import { PerfActionContext } from '../types/performance';
import {
  EligibilityCheck,
  EligibilityRules,
  InternalEmploymentType,
  InternalJobResponse,
  InternalJobStatus,
  WorkMode,
} from '../types/internalRecruitment';

const WORK_MODES: WorkMode[] = ['ONSITE', 'REMOTE', 'HYBRID'];
const EMPLOYMENT_TYPES: InternalEmploymentType[] = ['FULL_TIME', 'PART_TIME', 'GIG', 'SHORT_TERM'];
const TERMINAL_STATUSES: InternalJobStatus[] = ['FILLED', 'ARCHIVED', 'CANCELLED'];
const VISIBILITIES = ['ALL', 'DEPARTMENT'];

/** Weights for the rule-based recommendation score (sums to 100). */
const MATCH_WEIGHTS = {
  requiredSkills: 30, // proportional overlap of the job's requiredSkills with the employee's recorded skills
  allowedGrades: 20, // employee grade appears in the job's allowedGrades
  preferredDepartments: 15, // job's department name in career_interests.preferredDepartments
  preferredRoles: 15, // job's role name (or title) matches career_interests.preferredRoles
  workMode: 10, // job work mode equals the stated preference (ANY matches everything)
  gig: 10, // GIG posting and the employee is open to gigs
} as const;

const RULE_BASED_NOTE =
  'Matches are rule-based on skills, grade, and stated career interests - no AI model is involved.';

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** mysql2 usually parses JSON columns; be defensive either way. */
function parseJsonColumn(value: unknown): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

/** Accepts 'YYYY-MM-DD HH:MM:SS', 'YYYY-MM-DD' or ISO; returns a UTC Date. */
function toUtcDate(value: unknown, field: string): Date {
  const s = String(value).trim();
  let candidate = s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) candidate = `${s}T00:00:00Z`;
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) candidate = `${s.replace(' ', 'T')}Z`;
  const d = new Date(candidate);
  if (Number.isNaN(d.getTime())) throw new Error(`${field} must be a valid date/time (got "${s}")`);
  return d;
}

export function toJobResponse(r: any): InternalJobResponse {
  return {
    id: Number(r.id),
    jobCode: String(r.job_code),
    requisitionId: r.requisition_id === null ? null : Number(r.requisition_id),
    openingId: r.opening_id === null ? null : Number(r.opening_id),
    title: String(r.title),
    description: r.description ?? null,
    category: r.category ?? null,
    departmentId: r.department_id === null ? null : Number(r.department_id),
    departmentName: r.department_name ?? null,
    teamId: r.team_id === null ? null : Number(r.team_id),
    jobRoleId: r.job_role_id === null ? null : Number(r.job_role_id),
    jobRoleName: r.job_role_name ?? null,
    grade: r.grade ?? null,
    location: r.location ?? null,
    workMode: r.work_mode,
    employmentType: r.employment_type,
    openings: Number(r.openings ?? 1),
    salaryRangeMin: r.salary_range_min === null || r.salary_range_min === undefined ? null : Number(r.salary_range_min),
    salaryRangeMax: r.salary_range_max === null || r.salary_range_max === undefined ? null : Number(r.salary_range_max),
    eligibilityRules: parseJsonColumn(r.eligibility_rules),
    isFeatured: !!r.is_featured,
    isConfidential: !!r.is_confidential,
    visibility: r.visibility,
    visibilityDepartmentId: r.visibility_department_id === null ? null : Number(r.visibility_department_id),
    status: r.status,
    publishAt: isoOrNull(r.publish_at),
    expiresAt: isoOrNull(r.expires_at),
    publishedAt: isoOrNull(r.published_at),
    filledAt: isoOrNull(r.filled_at),
    hiringManagerEmployeeId: r.hiring_manager_employee_id === null ? null : Number(r.hiring_manager_employee_id),
    hiringManagerName: r.hiring_manager_name ?? null,
    createdAt: isoOrNull(r.created_at) ?? '',
  };
}

export interface JobCaller {
  userId: number;
  role: string;
  employeeId: number | null;
}

/**
 * Internal job postings for the talent marketplace.
 *
 * EFFECTIVE-STATUS MODEL (deliberate, documented design): this stack runs no
 * scheduler process, so scheduled publishes and expiries CANNOT flip rows in
 * the background. Instead every read path funnels through
 * applyEffectiveStatus(), which resolves the honest current status at read
 * time - APPROVED with publish_at in the past becomes PUBLISHED, PUBLISHED
 * with expires_at in the past becomes EXPIRED - and lazily persists the flip
 * when it is detected. Until something reads the job, the stored status is
 * stale; that is the accepted trade-off of the lazy model, not a bug.
 */
export class InternalJobService {
  private repo = new InternalJobRepository();
  private eligibility = new EligibilityService();
  private audit = new RecruitmentAuditService();

  // ==========================================================================
  // Effective-status resolver (core)
  // ==========================================================================

  /** Resolves + lazily persists effective statuses; mutates the given rows. */
  private async applyEffectiveStatus(rows: any[]): Promise<void> {
    const now = Date.now();
    for (const row of rows) {
      if (
        row.status === 'APPROVED' &&
        row.publish_at &&
        new Date(row.publish_at).getTime() <= now
      ) {
        const publishedAt = row.published_at ? new Date(row.published_at) : new Date(row.publish_at);
        await this.repo.persistStatusFlip(Number(row.id), 'APPROVED', 'PUBLISHED', publishedAt);
        row.status = 'PUBLISHED';
        row.published_at = row.published_at ?? row.publish_at;
      }
      // Not "else": a job whose publish AND expiry are both in the past flips twice.
      if (row.status === 'PUBLISHED' && row.expires_at && new Date(row.expires_at).getTime() < now) {
        await this.repo.persistStatusFlip(Number(row.id), 'PUBLISHED', 'EXPIRED', null);
        row.status = 'EXPIRED';
      }
    }
  }

  // ==========================================================================
  // Staff reads
  // ==========================================================================

  async list(filters: JobFilters): Promise<InternalJobResponse[]> {
    // Status is filtered AFTER resolution so e.g. ?status=EXPIRED also finds
    // rows still stored as PUBLISHED whose expiry has passed.
    const rows = await this.repo.findAll({ ...filters, status: undefined });
    await this.applyEffectiveStatus(rows);
    const filtered = filters.status ? rows.filter((r) => r.status === filters.status) : rows;
    return filtered.map((r) => toJobResponse(r));
  }

  async getById(id: number): Promise<InternalJobResponse> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error('Job not found');
    await this.applyEffectiveStatus([row]);
    const response = toJobResponse(row);
    response.applicationCount = await this.repo.applicationCount(id);
    return response;
  }

  // ==========================================================================
  // Staff writes
  // ==========================================================================

  async create(body: any, ctx: PerfActionContext): Promise<InternalJobResponse> {
    let base: Record<string, any> = {};
    if (body?.templateId) {
      const template = await this.repo.findTemplateById(Math.trunc(Number(body.templateId)));
      if (!template) throw new Error('Job template not found');
      base = {
        title: template.title_template,
        description: template.description_template,
        category: template.category,
        workMode: template.work_mode,
        employmentType: template.employment_type,
        eligibilityRules: parseJsonColumn(template.eligibility_rules),
      };
    }
    const input = { ...base, ...body };

    if (!input.title || !String(input.title).trim()) throw new Error('title is required');
    const workMode = input.workMode ?? 'ONSITE';
    if (!WORK_MODES.includes(workMode)) throw new Error(`workMode must be one of ${WORK_MODES.join(', ')}`);
    const employmentType = input.employmentType ?? 'FULL_TIME';
    if (!EMPLOYMENT_TYPES.includes(employmentType)) {
      throw new Error(`employmentType must be one of ${EMPLOYMENT_TYPES.join(', ')}`);
    }
    const visibility = input.visibility ?? 'ALL';
    if (!VISIBILITIES.includes(visibility)) throw new Error(`visibility must be one of ${VISIBILITIES.join(', ')}`);
    if (visibility === 'DEPARTMENT' && !input.visibilityDepartmentId) {
      throw new Error('visibilityDepartmentId is required when visibility is DEPARTMENT');
    }
    const openings = Math.trunc(Number(input.openings ?? 1));
    if (!Number.isFinite(openings) || openings < 1) throw new Error('openings must be a positive integer');

    let requisitionId: number | null = null;
    if (input.requisitionId) {
      requisitionId = Math.trunc(Number(input.requisitionId));
      const requisition = await this.repo.findRequisitionById(requisitionId);
      if (!requisition) throw new Error('Requisition not found');
      if (requisition.status !== 'APPROVED') {
        throw new Error(`Jobs can only be attached to an APPROVED requisition (current: ${requisition.status})`);
      }
    }

    const rules = this.eligibility.validateRules(input.eligibilityRules ?? null);

    const year = new Date().getUTCFullYear();
    const seq = await this.repo.nextSequence(year);
    const jobCode = `IJ-${year}-${String(seq).padStart(3, '0')}`;

    const id = await this.repo.insert({
      job_code: jobCode,
      requisition_id: requisitionId,
      opening_id: input.openingId ? Math.trunc(Number(input.openingId)) : null,
      template_id: input.templateId ? Math.trunc(Number(input.templateId)) : null,
      title: String(input.title).trim(),
      description: input.description ?? null,
      category: input.category ?? null,
      department_id: input.departmentId ? Math.trunc(Number(input.departmentId)) : null,
      team_id: input.teamId ? Math.trunc(Number(input.teamId)) : null,
      job_role_id: input.jobRoleId ? Math.trunc(Number(input.jobRoleId)) : null,
      grade: input.grade ?? null,
      location: input.location ?? null,
      work_mode: workMode,
      employment_type: employmentType,
      openings,
      salary_range_min: input.salaryRangeMin === undefined || input.salaryRangeMin === null ? null : Number(input.salaryRangeMin),
      salary_range_max: input.salaryRangeMax === undefined || input.salaryRangeMax === null ? null : Number(input.salaryRangeMax),
      eligibility_rules: rules === null ? null : JSON.stringify(rules),
      is_featured: input.isFeatured ? 1 : 0,
      is_confidential: input.isConfidential ? 1 : 0,
      visibility,
      visibility_department_id: input.visibilityDepartmentId ? Math.trunc(Number(input.visibilityDepartmentId)) : null,
      status: 'DRAFT',
      hiring_manager_employee_id: input.hiringManagerEmployeeId ? Math.trunc(Number(input.hiringManagerEmployeeId)) : null,
      created_by: ctx.userId,
    });
    await this.audit.record('INTERNAL_JOB', id, 'CREATE', ctx, null, { jobCode, title: input.title, requisitionId, templateId: input.templateId ?? null });
    return this.getById(id);
  }

  async update(id: number, body: any, ctx: PerfActionContext): Promise<InternalJobResponse> {
    const before = await this.repo.findById(id);
    if (!before) throw new Error('Job not found');
    await this.applyEffectiveStatus([before]);
    if (TERMINAL_STATUSES.includes(before.status)) {
      throw new Error(`A ${before.status} job cannot be edited`);
    }

    const fields: Record<string, any> = {};
    if (body.title !== undefined) {
      if (!String(body.title).trim()) throw new Error('title cannot be empty');
      fields.title = String(body.title).trim();
    }
    if (body.description !== undefined) fields.description = body.description ?? null;
    if (body.category !== undefined) fields.category = body.category ?? null;
    if (body.departmentId !== undefined) fields.department_id = body.departmentId ? Math.trunc(Number(body.departmentId)) : null;
    if (body.teamId !== undefined) fields.team_id = body.teamId ? Math.trunc(Number(body.teamId)) : null;
    if (body.jobRoleId !== undefined) fields.job_role_id = body.jobRoleId ? Math.trunc(Number(body.jobRoleId)) : null;
    if (body.grade !== undefined) fields.grade = body.grade ?? null;
    if (body.location !== undefined) fields.location = body.location ?? null;
    if (body.workMode !== undefined) {
      if (!WORK_MODES.includes(body.workMode)) throw new Error(`workMode must be one of ${WORK_MODES.join(', ')}`);
      fields.work_mode = body.workMode;
    }
    if (body.employmentType !== undefined) {
      if (!EMPLOYMENT_TYPES.includes(body.employmentType)) {
        throw new Error(`employmentType must be one of ${EMPLOYMENT_TYPES.join(', ')}`);
      }
      fields.employment_type = body.employmentType;
    }
    if (body.openings !== undefined) {
      const openings = Math.trunc(Number(body.openings));
      if (!Number.isFinite(openings) || openings < 1) throw new Error('openings must be a positive integer');
      fields.openings = openings;
    }
    if (body.salaryRangeMin !== undefined) fields.salary_range_min = body.salaryRangeMin === null ? null : Number(body.salaryRangeMin);
    if (body.salaryRangeMax !== undefined) fields.salary_range_max = body.salaryRangeMax === null ? null : Number(body.salaryRangeMax);
    if (body.eligibilityRules !== undefined) {
      const rules = this.eligibility.validateRules(body.eligibilityRules);
      fields.eligibility_rules = rules === null ? null : JSON.stringify(rules);
    }
    if (body.isFeatured !== undefined) fields.is_featured = body.isFeatured ? 1 : 0;
    if (body.isConfidential !== undefined) fields.is_confidential = body.isConfidential ? 1 : 0;
    if (body.visibility !== undefined) {
      if (!VISIBILITIES.includes(body.visibility)) throw new Error(`visibility must be one of ${VISIBILITIES.join(', ')}`);
      fields.visibility = body.visibility;
    }
    if (body.visibilityDepartmentId !== undefined) {
      fields.visibility_department_id = body.visibilityDepartmentId ? Math.trunc(Number(body.visibilityDepartmentId)) : null;
    }
    if (body.hiringManagerEmployeeId !== undefined) {
      fields.hiring_manager_employee_id = body.hiringManagerEmployeeId ? Math.trunc(Number(body.hiringManagerEmployeeId)) : null;
    }
    if (body.expiresAt !== undefined) {
      fields.expires_at = body.expiresAt === null ? null : toUtcDate(body.expiresAt, 'expiresAt');
    }
    if ((fields.visibility ?? before.visibility) === 'DEPARTMENT' && !(fields.visibility_department_id ?? before.visibility_department_id)) {
      throw new Error('visibilityDepartmentId is required when visibility is DEPARTMENT');
    }

    await this.repo.update(id, fields);
    await this.audit.record('INTERNAL_JOB', id, 'UPDATE', ctx, { title: before.title, status: before.status }, body);
    return this.getById(id);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  private async transition(
    id: number,
    fromStatuses: InternalJobStatus[],
    toStatus: InternalJobStatus,
    extraFields: Record<string, any>,
    action: string,
    ctx: PerfActionContext,
  ): Promise<InternalJobResponse> {
    const before = await this.repo.findById(id);
    if (!before) throw new Error('Job not found');
    await this.applyEffectiveStatus([before]);
    if (!fromStatuses.includes(before.status)) {
      throw new Error(`A ${before.status} job cannot be ${action.toLowerCase()}d (expected: ${fromStatuses.join(' or ')})`);
    }
    await this.repo.update(id, { status: toStatus, ...extraFields });
    await this.audit.record('INTERNAL_JOB', id, action, ctx, { status: before.status }, { status: toStatus, ...extraFields });
    return this.getById(id);
  }

  async submit(id: number, ctx: PerfActionContext): Promise<InternalJobResponse> {
    return this.transition(id, ['DRAFT'], 'PENDING_APPROVAL', {}, 'SUBMIT', ctx);
  }

  async approve(id: number, ctx: PerfActionContext): Promise<InternalJobResponse> {
    return this.transition(id, ['PENDING_APPROVAL'], 'APPROVED', { approved_by: ctx.userId, approved_at: new Date() }, 'APPROVE', ctx);
  }

  /**
   * Immediate publish sets PUBLISHED + published_at now. A FUTURE publishAt
   * keeps the row APPROVED with publish_at stored - the effective-status
   * resolver flips it to PUBLISHED on the first read after that moment.
   */
  async publish(id: number, body: any, ctx: PerfActionContext): Promise<InternalJobResponse> {
    const before = await this.repo.findById(id);
    if (!before) throw new Error('Job not found');
    await this.applyEffectiveStatus([before]);
    if (before.status !== 'APPROVED') {
      throw new Error(`Only APPROVED jobs can be published (current: ${before.status})`);
    }

    const now = new Date();
    const publishAt = body?.publishAt ? toUtcDate(body.publishAt, 'publishAt') : null;
    const expiresAt = body?.expiresAt ? toUtcDate(body.expiresAt, 'expiresAt') : (before.expires_at ? new Date(before.expires_at) : null);
    if (expiresAt && expiresAt.getTime() <= (publishAt ?? now).getTime()) {
      throw new Error('expiresAt must be after the publish time');
    }

    if (publishAt && publishAt.getTime() > now.getTime()) {
      await this.repo.update(id, { publish_at: publishAt, expires_at: expiresAt });
      await this.audit.record('INTERNAL_JOB', id, 'SCHEDULE_PUBLISH', ctx, { status: before.status }, { publishAt: publishAt.toISOString(), expiresAt: expiresAt?.toISOString() ?? null });
      const response = await this.getById(id);
      return response;
    }

    await this.repo.update(id, {
      status: 'PUBLISHED',
      publish_at: publishAt ?? now,
      published_at: now,
      expires_at: expiresAt,
    });
    await this.audit.record('INTERNAL_JOB', id, 'PUBLISH', ctx, { status: before.status }, { status: 'PUBLISHED', expiresAt: expiresAt?.toISOString() ?? null });
    return this.getById(id);
  }

  async pause(id: number, ctx: PerfActionContext): Promise<InternalJobResponse> {
    return this.transition(id, ['PUBLISHED'], 'PAUSED', {}, 'PAUSE', ctx);
  }

  async resume(id: number, ctx: PerfActionContext): Promise<InternalJobResponse> {
    const before = await this.repo.findById(id);
    if (!before) throw new Error('Job not found');
    if (before.status !== 'PAUSED') throw new Error(`Only PAUSED jobs can be resumed (current: ${before.status})`);
    if (before.expires_at && new Date(before.expires_at).getTime() < Date.now()) {
      // Honest outcome: resuming a job past its expiry lands it in EXPIRED.
      await this.repo.update(id, { status: 'EXPIRED' });
      await this.audit.record('INTERNAL_JOB', id, 'RESUME_EXPIRED', ctx, { status: 'PAUSED' }, { status: 'EXPIRED' });
      throw new Error('Job cannot be resumed: its expiry date has already passed, so it is now EXPIRED');
    }
    await this.repo.update(id, { status: 'PUBLISHED' });
    await this.audit.record('INTERNAL_JOB', id, 'RESUME', ctx, { status: 'PAUSED' }, { status: 'PUBLISHED' });
    return this.getById(id);
  }

  async archive(id: number, ctx: PerfActionContext): Promise<InternalJobResponse> {
    return this.transition(id, ['PUBLISHED', 'PAUSED', 'EXPIRED', 'FILLED', 'CANCELLED'], 'ARCHIVED', {}, 'ARCHIVE', ctx);
  }

  async cancel(id: number, ctx: PerfActionContext): Promise<InternalJobResponse> {
    return this.transition(
      id,
      ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'PAUSED', 'EXPIRED'],
      'CANCELLED',
      {},
      'CANCEL',
      ctx,
    );
  }

  /**
   * Marks the job FILLED. "All openings filled" is judged at the requisition
   * level as: every job linked to the requisition is FILLED (or cancelled /
   * archived) - there is no per-opening hire counter in this schema, so the
   * job-level FILLED flag is the unit of truth.
   */
  async fill(
    id: number,
    ctx: PerfActionContext,
    requisitionService: { markFulfilledIfComplete(reqId: number, ctx: PerfActionContext): Promise<boolean> },
  ): Promise<InternalJobResponse & { requisitionFulfilled?: boolean }> {
    const response = await this.transition(
      id,
      ['PUBLISHED', 'PAUSED', 'EXPIRED', 'APPROVED'],
      'FILLED',
      { filled_at: new Date() },
      'FILL',
      ctx,
    );
    if (response.requisitionId) {
      const fulfilled = await requisitionService.markFulfilledIfComplete(response.requisitionId, ctx);
      return { ...response, requisitionFulfilled: fulfilled };
    }
    return response;
  }

  // ==========================================================================
  // Templates
  // ==========================================================================

  async listTemplates(): Promise<any[]> {
    const rows = await this.repo.findTemplates();
    return rows.map((t) => this.toTemplateResponse(t));
  }

  async createTemplate(body: any, ctx: PerfActionContext): Promise<any> {
    if (!body?.code || !body?.name || !body?.titleTemplate) {
      throw new Error('code, name and titleTemplate are required');
    }
    // MySQL treats the UNIQUE code as case-insensitive; check-then-insert
    // keeps the error friendly.
    const existing = await this.repo.findTemplateByCode(String(body.code).trim());
    if (existing) throw new Error(`A template with code ${body.code} already exists`);
    const workMode = body.workMode ?? 'ONSITE';
    if (!WORK_MODES.includes(workMode)) throw new Error(`workMode must be one of ${WORK_MODES.join(', ')}`);
    const employmentType = body.employmentType ?? 'FULL_TIME';
    if (!EMPLOYMENT_TYPES.includes(employmentType)) {
      throw new Error(`employmentType must be one of ${EMPLOYMENT_TYPES.join(', ')}`);
    }
    const rules = this.eligibility.validateRules(body.eligibilityRules ?? null);
    const id = await this.repo.insertTemplate({
      code: String(body.code).trim(),
      name: String(body.name).trim(),
      title_template: String(body.titleTemplate),
      description_template: body.descriptionTemplate ?? null,
      category: body.category ?? null,
      work_mode: workMode,
      employment_type: employmentType,
      eligibility_rules: rules === null ? null : JSON.stringify(rules),
      is_active: body.isActive === undefined ? 1 : body.isActive ? 1 : 0,
      created_by: ctx.userId,
    });
    await this.audit.record('JOB_TEMPLATE', id, 'CREATE', ctx, null, { code: body.code, name: body.name });
    return this.toTemplateResponse(await this.repo.findTemplateById(id));
  }

  async updateTemplate(id: number, body: any, ctx: PerfActionContext): Promise<any> {
    const before = await this.repo.findTemplateById(id);
    if (!before) throw new Error('Job template not found');
    const fields: Record<string, any> = {};
    if (body.name !== undefined) fields.name = String(body.name).trim();
    if (body.titleTemplate !== undefined) fields.title_template = String(body.titleTemplate);
    if (body.descriptionTemplate !== undefined) fields.description_template = body.descriptionTemplate ?? null;
    if (body.category !== undefined) fields.category = body.category ?? null;
    if (body.workMode !== undefined) {
      if (!WORK_MODES.includes(body.workMode)) throw new Error(`workMode must be one of ${WORK_MODES.join(', ')}`);
      fields.work_mode = body.workMode;
    }
    if (body.employmentType !== undefined) {
      if (!EMPLOYMENT_TYPES.includes(body.employmentType)) {
        throw new Error(`employmentType must be one of ${EMPLOYMENT_TYPES.join(', ')}`);
      }
      fields.employment_type = body.employmentType;
    }
    if (body.eligibilityRules !== undefined) {
      const rules = this.eligibility.validateRules(body.eligibilityRules);
      fields.eligibility_rules = rules === null ? null : JSON.stringify(rules);
    }
    if (body.isActive !== undefined) fields.is_active = body.isActive ? 1 : 0;
    await this.repo.updateTemplate(id, fields);
    await this.audit.record('JOB_TEMPLATE', id, 'UPDATE', ctx, { name: before.name }, body);
    return this.toTemplateResponse(await this.repo.findTemplateById(id));
  }

  async createFromTemplate(body: any, ctx: PerfActionContext): Promise<InternalJobResponse> {
    if (!body?.templateId) throw new Error('templateId is required');
    return this.create({ ...(body.overrides ?? {}), templateId: body.templateId }, ctx);
  }

  private toTemplateResponse(t: any): any {
    return {
      id: Number(t.id),
      code: String(t.code),
      name: String(t.name),
      titleTemplate: String(t.title_template),
      descriptionTemplate: t.description_template ?? null,
      category: t.category ?? null,
      workMode: t.work_mode,
      employmentType: t.employment_type,
      eligibilityRules: parseJsonColumn(t.eligibility_rules),
      isActive: !!t.is_active,
      createdAt: isoOrNull(t.created_at) ?? '',
    };
  }

  // ==========================================================================
  // Portal
  // ==========================================================================

  /** 400-with-clear-message contract for accounts without an employee link. */
  private requireEmployee(caller: JobCaller): number {
    if (!caller.employeeId) {
      throw new Error('This account is not linked to an employee record, so the internal job portal is unavailable for it');
    }
    return caller.employeeId;
  }

  private async callerDepartmentId(employeeId: number): Promise<number | null> {
    const employee = await this.repo.findEmployeeById(employeeId);
    return employee?.department_id ? Number(employee.department_id) : null;
  }

  private async annotate(rows: any[], employeeId: number): Promise<InternalJobResponse[]> {
    const [saved, appliedIds] = await Promise.all([
      this.repo.savedRows(employeeId),
      this.repo.appliedJobIds(employeeId),
    ]);
    const savedMap = new Map(saved.map((s) => [Number(s.job_id), !!s.is_favorite]));
    const applied = new Set(appliedIds);
    return rows.map((r) => {
      const response = toJobResponse(r);
      response.saved = savedMap.has(response.id);
      response.favorite = savedMap.get(response.id) ?? false;
      response.applied = applied.has(response.id);
      return response;
    });
  }

  async portalJobs(caller: JobCaller, filters: PortalJobFilters): Promise<InternalJobResponse[]> {
    const employeeId = this.requireEmployee(caller);
    const departmentId = await this.callerDepartmentId(employeeId);
    const rows = await this.repo.findPortalVisible(departmentId, filters);
    await this.applyEffectiveStatus(rows);
    return this.annotate(rows.filter((r) => r.status === 'PUBLISHED'), employeeId);
  }

  async portalFeatured(caller: JobCaller): Promise<InternalJobResponse[]> {
    return this.portalJobs(caller, { featured: true });
  }

  async portalRecent(caller: JobCaller): Promise<InternalJobResponse[]> {
    const employeeId = this.requireEmployee(caller);
    const departmentId = await this.callerDepartmentId(employeeId);
    const rows = await this.repo.findRecentPublished(departmentId, 10);
    await this.applyEffectiveStatus(rows);
    return this.annotate(rows.filter((r) => r.status === 'PUBLISHED'), employeeId);
  }

  async portalJobDetail(
    id: number,
    caller: JobCaller,
  ): Promise<InternalJobResponse & { similarJobs: InternalJobResponse[]; myEligibility: { checks: EligibilityCheck[]; eligibilityPassed: boolean } }> {
    const employeeId = this.requireEmployee(caller);
    const departmentId = await this.callerDepartmentId(employeeId);

    const row = await this.repo.findById(id);
    if (!row) throw new Error('Job not found');
    await this.applyEffectiveStatus([row]);
    // Confidential and out-of-visibility jobs are indistinguishable from
    // missing ones on the portal - no existence leak.
    const visible =
      !row.is_confidential &&
      row.status === 'PUBLISHED' &&
      (row.visibility === 'ALL' || (row.visibility === 'DEPARTMENT' && Number(row.visibility_department_id) === departmentId));
    if (!visible) throw new Error('Job not found');

    const [annotated] = await this.annotate([row], employeeId);

    const similarRows = await this.repo.findSimilar(row, departmentId);
    await this.applyEffectiveStatus(similarRows);
    const similarJobs = await this.annotate(similarRows.filter((r) => r.status === 'PUBLISHED'), employeeId);

    const rules: EligibilityRules | null = parseJsonColumn(row.eligibility_rules);
    const hasRules = rules && Object.keys(rules).length > 0;
    const outcome = hasRules
      ? await this.eligibility.evaluateForEmployee(rules, employeeId, null)
      : { checks: [] as EligibilityCheck[], passed: true };

    return {
      ...(annotated as InternalJobResponse),
      similarJobs,
      myEligibility: { checks: outcome.checks, eligibilityPassed: outcome.passed },
    };
  }

  /**
   * RULE-BASED job recommendations - explicitly NOT AI. The score is a fixed
   * weighted sum (see MATCH_WEIGHTS) over recorded skills, the employee's
   * grade, and their own stated career interests. Every response says so.
   */
  async portalRecommended(caller: JobCaller): Promise<{ matchBasis: 'rule_based'; note: string; jobs: InternalJobResponse[] }> {
    const employeeId = this.requireEmployee(caller);
    const [employee, interests, skills] = await Promise.all([
      this.repo.findEmployeeById(employeeId),
      this.repo.findCareerInterests(employeeId),
      this.repo.employeeSkillNames(employeeId),
    ]);
    if (!employee) throw new Error('Employee not found');
    const departmentId = employee.department_id ? Number(employee.department_id) : null;

    const rows = await this.repo.findPortalVisible(departmentId, { limit: 500 });
    await this.applyEffectiveStatus(rows);
    const published = rows.filter((r) => r.status === 'PUBLISHED');

    const appliedIds = new Set(await this.repo.appliedJobIds(employeeId));
    const openToGigs = interests ? !!interests.open_to_gigs : false;
    const workModePref: string = interests?.work_mode_preference ?? 'ANY';
    const preferredRoles: string[] = (parseJsonColumn(interests?.preferred_roles) ?? []).map((s: string) => s.toLowerCase());
    const preferredDepartments: string[] = (parseJsonColumn(interests?.preferred_departments) ?? []).map((s: string) => s.toLowerCase());
    const mySkills = new Set(skills.map((s) => s.toLowerCase()));
    const myGrade = employee.grade ? String(employee.grade).toLowerCase() : null;

    const scored: { row: any; score: number; reasons: string[] }[] = [];
    for (const row of published) {
      if (appliedIds.has(Number(row.id))) continue; // already applied
      if (row.employment_type === 'GIG' && !openToGigs) continue; // gigs only for the willing

      let score = 0;
      const reasons: string[] = [];
      const rules: EligibilityRules | null = parseJsonColumn(row.eligibility_rules);

      const requiredSkills = rules?.requiredSkills ?? [];
      if (requiredSkills.length > 0) {
        const matched = requiredSkills.filter((s) => mySkills.has(s.toLowerCase()));
        if (matched.length > 0) {
          score += Math.round(MATCH_WEIGHTS.requiredSkills * (matched.length / requiredSkills.length));
          reasons.push(`Skills match: ${matched.join(', ')}`);
        }
      }

      const allowedGrades = rules?.allowedGrades ?? [];
      if (myGrade && allowedGrades.length > 0 && allowedGrades.some((g) => g.toLowerCase() === myGrade)) {
        score += MATCH_WEIGHTS.allowedGrades;
        reasons.push(`Your grade ${employee.grade} is in the job's allowed grades`);
      }

      if (row.department_name && preferredDepartments.includes(String(row.department_name).toLowerCase())) {
        score += MATCH_WEIGHTS.preferredDepartments;
        reasons.push(`Department ${row.department_name} is in your preferred departments`);
      }

      const roleName = row.job_role_name ? String(row.job_role_name).toLowerCase() : null;
      const title = String(row.title).toLowerCase();
      const roleHit = preferredRoles.find((p) => (roleName && roleName === p) || title.includes(p));
      if (roleHit) {
        score += MATCH_WEIGHTS.preferredRoles;
        reasons.push(`Matches your preferred role "${roleHit}"`);
      }

      if (workModePref !== 'ANY' && row.work_mode === workModePref) {
        score += MATCH_WEIGHTS.workMode;
        reasons.push(`Work mode ${row.work_mode} matches your preference`);
      }

      if (row.employment_type === 'GIG' && openToGigs) {
        score += MATCH_WEIGHTS.gig;
        reasons.push('Gig posting and you are open to gigs');
      }

      if (score > 0) scored.push({ row, score: Math.min(100, score), reasons });
    }

    scored.sort((a, b) => b.score - a.score || Number(b.row.id) - Number(a.row.id));
    const annotated = await this.annotate(scored.map((s) => s.row), employeeId);
    annotated.forEach((job, i) => {
      job.matchScore = scored[i]!.score;
      job.matchReasons = scored[i]!.reasons;
    });

    return { matchBasis: 'rule_based', note: RULE_BASED_NOTE, jobs: annotated };
  }

  // ==========================================================================
  // Saved jobs
  // ==========================================================================

  async saveJob(jobId: number, caller: JobCaller, favorite: boolean): Promise<{ saved: true; favorite: boolean }> {
    const employeeId = this.requireEmployee(caller);
    const row = await this.repo.findById(jobId);
    if (!row || row.is_confidential) throw new Error('Job not found');
    await this.repo.saveJob(employeeId, jobId, favorite);
    return { saved: true, favorite };
  }

  async unsaveJob(jobId: number, caller: JobCaller): Promise<{ removed: boolean }> {
    const employeeId = this.requireEmployee(caller);
    const removed = await this.repo.unsaveJob(employeeId, jobId);
    if (!removed) throw new Error('Saved job not found');
    return { removed: true };
  }

  async listSaved(caller: JobCaller): Promise<InternalJobResponse[]> {
    const employeeId = this.requireEmployee(caller);
    const rows = await this.repo.findSavedJobs(employeeId);
    // Effective status still resolves so an expired saved job shows EXPIRED
    // rather than pretending to be open.
    await this.applyEffectiveStatus(rows);
    const appliedIds = new Set(await this.repo.appliedJobIds(employeeId));
    return rows.map((r) => {
      const response = toJobResponse(r);
      response.saved = true;
      response.favorite = !!r.is_favorite;
      response.applied = appliedIds.has(response.id);
      return response;
    });
  }
}
