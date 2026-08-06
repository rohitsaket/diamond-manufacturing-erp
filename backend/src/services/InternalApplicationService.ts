import { ApplicationFilters, InternalApplicationRepository } from '../repositories/InternalApplicationRepository';
import { EligibilityService } from './EligibilityService';
import { InternalJobService, JobCaller } from './InternalJobService';
import { ReferralService } from './ReferralService';
import { RecruitmentAuditService } from './RecruitmentAuditService';
import { NotificationService } from './NotificationService';
import { PerfActionContext } from '../types/performance';
import {
  ApplicationResponse,
  ApplicationStatus,
  EligibilityCheck,
  EligibilityRules,
  StageEventResponse,
} from '../types/internalRecruitment';

/**
 * Legal forward map for application statuses. Exported so the hiring-flow
 * work stream can copy/import the exact same rules when it moves applications
 * into ASSESSMENT/INTERVIEW/OFFERED/HIRED (it writes application_stage_events
 * rows for those moves too).
 */
export const APPLICATION_STATUS_FLOW: Record<ApplicationStatus, ApplicationStatus[]> = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['UNDER_REVIEW', 'REJECTED', 'WITHDRAWN'],
  UNDER_REVIEW: ['SHORTLISTED', 'REJECTED', 'WITHDRAWN'],
  SHORTLISTED: ['ASSESSMENT', 'INTERVIEW', 'REJECTED', 'WITHDRAWN'],
  ASSESSMENT: ['INTERVIEW', 'SELECTED', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW: ['SELECTED', 'REJECTED', 'WITHDRAWN'],
  SELECTED: ['OFFERED', 'REJECTED', 'WITHDRAWN'],
  OFFERED: ['HIRED', 'REJECTED', 'WITHDRAWN'],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

/** Throws with a clear message when from->to is not a legal move. */
export function assertApplicationTransition(from: string, to: string): void {
  const allowed = APPLICATION_STATUS_FLOW[from as ApplicationStatus];
  if (!allowed) throw new Error(`Unknown application status "${from}"`);
  if (!allowed.includes(to as ApplicationStatus)) {
    throw new Error(
      `Cannot move an application from ${from} to ${to}. Allowed next statuses: ${allowed.length ? allowed.join(', ') : 'none (terminal state)'}`,
    );
  }
}

const STAFF_STATUS_TARGETS: ApplicationStatus[] = [
  'UNDER_REVIEW', 'SHORTLISTED', 'ASSESSMENT', 'INTERVIEW', 'SELECTED', 'OFFERED', 'HIRED', 'REJECTED',
];
const CONFIDENTIAL_ROLES = new Set(['admin', 'hr']);

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseJsonColumn(value: unknown): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

export function toApplicationResponse(r: any): ApplicationResponse {
  return {
    id: Number(r.id),
    jobId: Number(r.job_id),
    jobCode: r.job_code ?? undefined,
    jobTitle: r.job_title ?? undefined,
    employeeId: Number(r.employee_id),
    employeeName: r.employee_name ?? null,
    empCode: r.emp_code ?? null,
    grade: r.employee_grade ?? null,
    status: r.status,
    coverLetter: r.cover_letter ?? null,
    resumeDocumentId: r.resume_document_id === null ? null : Number(r.resume_document_id),
    expectedNoticeDays: r.expected_notice_days === null || r.expected_notice_days === undefined ? null : Number(r.expected_notice_days),
    eligibilityResult: parseJsonColumn(r.eligibility_result),
    eligibilityPassed: r.eligibility_passed === null || r.eligibility_passed === undefined ? null : !!r.eligibility_passed,
    eligibilityOverride: !!r.eligibility_override,
    overrideReason: r.override_reason ?? null,
    submittedAt: isoOrNull(r.submitted_at),
    withdrawnAt: isoOrNull(r.withdrawn_at),
    withdrawReason: r.withdraw_reason ?? null,
    decidedAt: isoOrNull(r.decided_at),
    decisionNote: r.decision_note ?? null,
    createdAt: isoOrNull(r.created_at) ?? '',
  };
}

function toStageEventResponse(r: any): StageEventResponse {
  return {
    id: Number(r.id),
    applicationId: Number(r.application_id),
    fromStatus: r.from_status ?? null,
    toStatus: String(r.to_status),
    note: r.note ?? null,
    createdBy: r.created_by === null ? null : Number(r.created_by),
    actorName: r.actor_name ?? null,
    createdAt: isoOrNull(r.created_at) ?? '',
  };
}

/**
 * The application pipeline: ESS apply/submit/withdraw plus the staff status
 * walk. Every status change writes an append-only stage event, an audit row
 * and (for staff moves) an in-app notification to the applicant.
 */
export class InternalApplicationService {
  private repo = new InternalApplicationRepository();
  private eligibility = new EligibilityService();
  private jobs = new InternalJobService();
  private referrals = new ReferralService();
  private audit = new RecruitmentAuditService();
  private notifications = new NotificationService();

  // ==========================================================================
  // ESS: apply / submit / withdraw / my applications
  // ==========================================================================

  async apply(
    jobId: number,
    body: any,
    caller: JobCaller,
    ctx: PerfActionContext,
  ): Promise<{ application: ApplicationResponse; warnings: EligibilityCheck[] }> {
    if (!caller.employeeId) {
      throw new Error('This account is not linked to an employee record, so it cannot apply to internal jobs');
    }
    const employeeId = caller.employeeId;

    // The job must be portal-visible AND effective-PUBLISHED for the caller;
    // portalJobDetail applies the resolver, confidentiality and department
    // visibility in one place.
    const job = await this.jobs.portalJobDetail(jobId, caller);

    const existing = await this.repo.findByJobAndEmployee(jobId, employeeId);
    if (existing) {
      throw new Error(
        existing.status === 'DRAFT'
          ? `You already have a DRAFT application for this job (id ${existing.id}) - submit or withdraw it instead of applying again`
          : `You have already applied to this job (current status: ${existing.status})`,
      );
    }

    let resumeDocumentId: number | null = null;
    if (body?.resumeDocumentId) {
      resumeDocumentId = Math.trunc(Number(body.resumeDocumentId));
      const owned = await this.repo.employeeDocumentBelongsTo(resumeDocumentId, employeeId);
      if (!owned) throw new Error('resumeDocumentId must reference one of your own employee documents');
    }

    let expectedNoticeDays: number | null = null;
    if (body?.expectedNoticeDays !== undefined && body.expectedNoticeDays !== null) {
      expectedNoticeDays = Math.trunc(Number(body.expectedNoticeDays));
      if (!Number.isFinite(expectedNoticeDays) || expectedNoticeDays < 0) {
        throw new Error('expectedNoticeDays must be a non-negative integer');
      }
    }

    const isDraft = !!body?.draft;
    const rules: EligibilityRules | null = job.eligibilityRules;
    const outcome = await this.eligibility.evaluateForEmployee(rules, employeeId, expectedNoticeDays);

    // Hard-fail rules block a real submission; drafts store the result so the
    // employee can see exactly what blocks them. pass:null rules only warn.
    if (!isDraft && !outcome.passed) {
      const failing = outcome.checks.filter((c) => c.pass === false);
      const err: any = new Error(
        `You do not meet the eligibility rules for this job: ${failing.map((c) => `${c.rule} (${c.detail})`).join('; ')}`,
      );
      err.eligibility = outcome.checks;
      throw err;
    }

    // Snapshot of the honest profile data the evaluation ran against.
    const snapshot = {
      grade: outcome.profile.grade,
      tenureMonths: outcome.profile.tenureMonths,
      skills: outcome.profile.skills,
      certifications: outcome.profile.certifications,
      latestRating: outcome.profile.latestRating,
    };

    const now = new Date();
    const id = await this.repo.insert({
      job_id: jobId,
      employee_id: employeeId,
      status: isDraft ? 'DRAFT' : 'SUBMITTED',
      cover_letter: body?.coverLetter ?? null,
      resume_document_id: resumeDocumentId,
      profile_snapshot: JSON.stringify(snapshot),
      expected_notice_days: expectedNoticeDays,
      eligibility_result: JSON.stringify(outcome.checks),
      eligibility_passed: outcome.passed ? 1 : 0,
      submitted_at: isDraft ? null : now,
    });

    await this.repo.insertStageEvent(
      id,
      null,
      isDraft ? 'DRAFT' : 'SUBMITTED',
      isDraft ? 'Draft saved through the internal portal' : 'Application submitted through the internal portal',
      ctx.userId,
    );
    await this.audit.record('APPLICATION', id, isDraft ? 'CREATE_DRAFT' : 'SUBMIT', ctx, null, {
      jobId,
      jobCode: job.jobCode,
      employeeId,
      eligibilityPassed: outcome.passed,
    });

    // A matching referral (someone referred this employee to this job) gets
    // linked so the referrer's pipeline reflects the real application.
    try {
      await this.referrals.linkApplication(jobId, employeeId, id);
    } catch (err) {
      console.error('referral auto-link failed:', err);
    }

    const row = await this.repo.findById(id);
    return {
      application: toApplicationResponse(row),
      warnings: outcome.checks.filter((c) => c.pass === null),
    };
  }

  /** Own DRAFT -> SUBMITTED; eligibility re-runs against current data. */
  async submitDraft(id: number, caller: JobCaller, ctx: PerfActionContext): Promise<{ application: ApplicationResponse; warnings: EligibilityCheck[] }> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error('Application not found');
    if (!caller.employeeId || Number(row.employee_id) !== caller.employeeId) {
      throw new Error('You can only submit your own application');
    }
    if (row.status !== 'DRAFT') throw new Error(`Only DRAFT applications can be submitted (current: ${row.status})`);

    const job = await this.repo.findJobById(Number(row.job_id));
    if (!job) throw new Error('Job not found');
    const rules: EligibilityRules | null = parseJsonColumn(job.eligibility_rules);
    const expectedNoticeDays = row.expected_notice_days === null ? null : Number(row.expected_notice_days);
    const outcome = await this.eligibility.evaluateForEmployee(rules, caller.employeeId, expectedNoticeDays);

    // An admin/hr eligibility override recorded on the row lets a blocked
    // draft through; the stored result still shows the honest failure.
    if (!outcome.passed && !row.eligibility_override) {
      await this.repo.update(id, {
        eligibility_result: JSON.stringify(outcome.checks),
        eligibility_passed: 0,
      });
      const failing = outcome.checks.filter((c) => c.pass === false);
      const err: any = new Error(
        `You do not meet the eligibility rules for this job: ${failing.map((c) => `${c.rule} (${c.detail})`).join('; ')}`,
      );
      err.eligibility = outcome.checks;
      throw err;
    }

    assertApplicationTransition(row.status, 'SUBMITTED');
    await this.repo.update(id, {
      status: 'SUBMITTED',
      submitted_at: new Date(),
      eligibility_result: JSON.stringify(outcome.checks),
      eligibility_passed: outcome.passed ? 1 : 0,
    });
    await this.repo.insertStageEvent(
      id,
      'DRAFT',
      'SUBMITTED',
      row.eligibility_override && !outcome.passed
        ? 'Submitted under an HR eligibility override'
        : 'Application submitted through the internal portal',
      ctx.userId,
    );
    await this.audit.record('APPLICATION', id, 'SUBMIT', ctx, { status: 'DRAFT' }, { status: 'SUBMITTED', eligibilityPassed: outcome.passed, override: !!row.eligibility_override });

    try {
      await this.referrals.linkApplication(Number(row.job_id), caller.employeeId, id);
    } catch (err) {
      console.error('referral auto-link failed:', err);
    }

    const after = await this.repo.findById(id);
    return { application: toApplicationResponse(after), warnings: outcome.checks.filter((c) => c.pass === null) };
  }

  async withdraw(id: number, reason: string | null, caller: JobCaller, ctx: PerfActionContext): Promise<ApplicationResponse> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error('Application not found');
    if (!caller.employeeId || Number(row.employee_id) !== caller.employeeId) {
      throw new Error('You can only withdraw your own application');
    }
    if (['HIRED', 'REJECTED', 'WITHDRAWN'].includes(row.status)) {
      throw new Error(`A ${row.status} application cannot be withdrawn`);
    }
    assertApplicationTransition(row.status, 'WITHDRAWN');
    await this.repo.update(id, {
      status: 'WITHDRAWN',
      withdrawn_at: new Date(),
      withdraw_reason: reason ? String(reason).slice(0, 500) : null,
    });
    await this.repo.insertStageEvent(id, row.status, 'WITHDRAWN', reason ?? null, ctx.userId);
    await this.audit.record('APPLICATION', id, 'WITHDRAW', ctx, { status: row.status }, { status: 'WITHDRAWN', reason });
    return toApplicationResponse(await this.repo.findById(id));
  }

  async myApplications(caller: JobCaller): Promise<ApplicationResponse[]> {
    if (!caller.employeeId) {
      throw new Error('This account is not linked to an employee record, so it has no internal applications');
    }
    const rows = await this.repo.findMine(caller.employeeId);
    const responses: ApplicationResponse[] = [];
    for (const row of rows) {
      const response = toApplicationResponse(row);
      response.timeline = (await this.repo.findStageEvents(Number(row.id))).map(toStageEventResponse);
      responses.push(response);
    }
    return responses;
  }

  // ==========================================================================
  // Staff pipeline
  // ==========================================================================

  async staffList(filters: Omit<ApplicationFilters, 'includeConfidential'>, callerRole: string): Promise<ApplicationResponse[]> {
    const rows = await this.repo.findAll({
      ...filters,
      // Applications on confidential jobs are visible to admin/hr only.
      includeConfidential: CONFIDENTIAL_ROLES.has(callerRole),
    });
    return rows.map((r) => toApplicationResponse(r));
  }

  async staffGet(id: number, callerRole: string): Promise<ApplicationResponse & { documents: any[] }> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error('Application not found');
    if (row.is_confidential && !CONFIDENTIAL_ROLES.has(callerRole)) {
      // Indistinguishable from missing - no existence leak on confidential jobs.
      throw new Error('Application not found');
    }
    const response = toApplicationResponse(row) as ApplicationResponse & { documents: any[] };
    response.timeline = (await this.repo.findStageEvents(id)).map(toStageEventResponse);
    response.documents = (await this.repo.findDocuments(id)).map((d) => this.toDocumentResponse(d));
    return response;
  }

  /**
   * Staff status walk. Validates the transition against the shared forward
   * map, writes the stage event + audit row, notifies the applicant, and on
   * HIRED settles any linked referral reward.
   */
  async updateStatus(
    id: number,
    body: any,
    callerRole: string,
    ctx: PerfActionContext,
  ): Promise<ApplicationResponse> {
    const status = String(body?.status ?? '');
    if (!STAFF_STATUS_TARGETS.includes(status as ApplicationStatus)) {
      throw new Error(`status must be one of ${STAFF_STATUS_TARGETS.join(', ')}`);
    }
    const note = body?.note ? String(body.note).slice(0, 1000) : null;

    const row = await this.repo.findById(id);
    if (!row) throw new Error('Application not found');
    if (row.is_confidential && !CONFIDENTIAL_ROLES.has(callerRole)) {
      throw new Error('Application not found');
    }
    assertApplicationTransition(row.status, status);

    const fields: Record<string, any> = { status };
    if (status === 'REJECTED' || status === 'HIRED') {
      fields.decided_at = new Date();
      fields.decision_note = note;
    }
    await this.repo.update(id, fields);
    await this.repo.insertStageEvent(id, row.status, status, note, ctx.userId);
    await this.audit.record('APPLICATION', id, `STATUS_${status}`, ctx, { status: row.status }, { status, note });

    // Notify the applicant's user account; never fail the business write.
    try {
      await this.notifications.notifyEmployee(Number(row.employee_id), {
        category: 'RECRUITMENT',
        title: `Your application for ${row.job_title} is now ${status.replace(/_/g, ' ').toLowerCase()}`,
        body: note ?? `Application ${row.job_code ?? ''} moved from ${row.status} to ${status}.`,
        linkPage: 'internal-jobs',
        linkRefId: id,
        createdBy: ctx.userId,
      });
    } catch (err) {
      console.error('application status notification failed:', err);
    }

    // A hire settles the referral reward through the recognition path.
    if (status === 'HIRED') {
      try {
        await this.referrals.onApplicationHired(id, ctx);
      } catch (err) {
        console.error('referral hire settlement failed (application status change stands):', err);
      }
    }

    return toApplicationResponse(await this.repo.findById(id));
  }

  /** admin/hr: records an eligibility override so a blocked DRAFT can submit. */
  async override(id: number, reason: string | null, ctx: PerfActionContext): Promise<ApplicationResponse> {
    if (!reason || !String(reason).trim()) throw new Error('An override reason is required');
    const row = await this.repo.findById(id);
    if (!row) throw new Error('Application not found');
    if (['HIRED', 'REJECTED', 'WITHDRAWN'].includes(row.status)) {
      throw new Error(`A ${row.status} application cannot be overridden`);
    }
    await this.repo.update(id, {
      eligibility_override: 1,
      override_reason: String(reason).trim().slice(0, 500),
      override_by: ctx.userId,
    });
    await this.audit.record('APPLICATION', id, 'ELIGIBILITY_OVERRIDE', ctx, { override: !!row.eligibility_override }, { override: true, reason });
    return toApplicationResponse(await this.repo.findById(id));
  }

  // ==========================================================================
  // Documents
  // ==========================================================================

  /** Upload allowed for the applicant or staff (confidential-guarded). */
  async addDocument(
    applicationId: number,
    file: { originalname: string; filename: string; mimetype: string; size: number },
    subdir: string,
    caller: JobCaller,
    ctx: PerfActionContext,
  ): Promise<any> {
    const row = await this.requireDocumentAccess(applicationId, caller);
    const id = await this.repo.insertDocument({
      application_id: Number(row.id),
      file_name: file.originalname,
      file_path: `${subdir}/${file.filename}`,
      mime_type: file.mimetype,
      file_size: file.size,
      uploaded_by: ctx.userId,
    });
    await this.audit.record('APPLICATION', applicationId, 'DOCUMENT_UPLOAD', ctx, null, { documentId: id, fileName: file.originalname });
    return this.toDocumentResponse(await this.repo.findDocumentById(id));
  }

  async listDocuments(applicationId: number, caller: JobCaller): Promise<any[]> {
    await this.requireDocumentAccess(applicationId, caller);
    return (await this.repo.findDocuments(applicationId)).map((d) => this.toDocumentResponse(d));
  }

  /** Returns the stored (relative) path; the controller applies the traversal guard. */
  async getDocumentForDownload(documentId: number, caller: JobCaller): Promise<{ fileName: string; filePath: string; mimeType: string | null }> {
    const doc = await this.repo.findDocumentById(documentId);
    if (!doc) throw new Error('Document not found');
    await this.requireDocumentAccess(Number(doc.application_id), caller);
    return { fileName: String(doc.file_name), filePath: String(doc.file_path), mimeType: doc.mime_type ?? null };
  }

  /** Owner-or-staff, with the admin/hr-only rule on confidential jobs. */
  private async requireDocumentAccess(applicationId: number, caller: JobCaller): Promise<any> {
    const row = await this.repo.findById(applicationId);
    if (!row) throw new Error('Application not found');
    const isOwner = !!caller.employeeId && Number(row.employee_id) === caller.employeeId;
    const isStaff = ['admin', 'manager', 'operator', 'accountant', 'hr'].includes(caller.role);
    const confidentialOk = !row.is_confidential || CONFIDENTIAL_ROLES.has(caller.role) || isOwner;
    if ((!isOwner && !isStaff) || !confidentialOk) throw new Error('Application not found');
    return row;
  }

  private toDocumentResponse(d: any): any {
    return {
      id: Number(d.id),
      applicationId: Number(d.application_id),
      fileName: String(d.file_name),
      mimeType: d.mime_type ?? null,
      fileSize: d.file_size === null || d.file_size === undefined ? null : Number(d.file_size),
      uploadedBy: d.uploaded_by === null ? null : Number(d.uploaded_by),
      createdAt: isoOrNull(d.created_at) ?? '',
    };
  }
}
