import { ReviewRepository } from '../repositories/ReviewRepository';
import { PerfAuditService } from './PerfAuditService';
import { NotificationService } from './NotificationService';
import {
  PerfActionContext,
  ReviewResponse,
  ReviewResponseItem,
  ReviewTemplateResponse,
  ReviewType,
  TemplateSection,
} from '../types/performance';
import { NotificationCategory } from '../types/hrms';
import { toDateString, todayString } from '../utils/dateUtils';

const REVIEW_TYPES: ReviewType[] = ['SELF', 'MANAGER', 'PEER', 'SUBORDINATE', 'CUSTOMER', 'EXTERNAL'];
const TEMPLATE_APPLIES = [...REVIEW_TYPES, 'ALL'];
const QUESTION_KINDS = ['TEXT', 'RATING', 'COMPETENCY'];

/** Roles that may see through review anonymity. */
const ANONYMITY_EXEMPT_ROLES = new Set(['admin', 'hr']);

export interface ReviewCaller {
  userId: number;
  role: string;
  employeeId: number | null;
}

const PERFORMANCE_CATEGORY = 'PERFORMANCE' as NotificationCategory;

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
 * Review templates plus the review/360 machinery.
 *
 * Anonymity has exactly one choke point: {@link ReviewService.toResponse}.
 * Every payload that leaves this service -- lists, single reads, the 360
 * summary, ESS history -- passes through it with the caller's role, so an
 * anonymous peer review can never leak its reviewer to anyone below HR/admin.
 */
export class ReviewService {
  private repo = new ReviewRepository();
  private audit = new PerfAuditService();
  private notifications = new NotificationService();

  // ==========================================================================
  // Templates
  // ==========================================================================

  async listTemplates(): Promise<ReviewTemplateResponse[]> {
    const rows = await this.repo.findTemplates();
    return rows.map((r) => this.toTemplateResponse(r));
  }

  async createTemplate(body: any, ctx: PerfActionContext): Promise<ReviewTemplateResponse> {
    if (!body?.code || !body?.name) throw new Error('code and name are required');
    const appliesTo = body.appliesTo ?? 'ALL';
    if (!TEMPLATE_APPLIES.includes(appliesTo)) throw new Error(`appliesTo must be one of ${TEMPLATE_APPLIES.join(', ')}`);
    const ratingScale = Math.trunc(Number(body.ratingScale ?? 5));
    if (!Number.isFinite(ratingScale) || ratingScale < 2 || ratingScale > 10) {
      throw new Error('ratingScale must be between 2 and 10');
    }
    const sections = await this.validateSections(body.sections);

    const existing = await this.repo.findTemplateByCode(String(body.code));
    if (existing) throw new Error(`A review template with code ${body.code} already exists`);

    const id = await this.repo.insertTemplate({
      code: String(body.code),
      name: String(body.name),
      appliesTo,
      ratingScale,
      sectionsJson: sections ? JSON.stringify(sections) : null,
      isActive: body.isActive === undefined ? true : !!body.isActive,
      createdBy: ctx.userId,
    });
    await this.audit.record('REVIEW_TEMPLATE', id, 'CREATE', ctx, null, body);
    return this.toTemplateResponse(await this.repo.findTemplateById(id));
  }

  async updateTemplate(id: number, body: any, ctx: PerfActionContext): Promise<ReviewTemplateResponse> {
    const before = await this.repo.findTemplateById(id);
    if (!before) throw new Error('Review template not found');

    const sets: string[] = [];
    const params: any[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); params.push(String(body.name)); }
    if (body.appliesTo !== undefined) {
      if (!TEMPLATE_APPLIES.includes(body.appliesTo)) throw new Error(`appliesTo must be one of ${TEMPLATE_APPLIES.join(', ')}`);
      sets.push('applies_to = ?'); params.push(body.appliesTo);
    }
    if (body.ratingScale !== undefined) {
      const scale = Math.trunc(Number(body.ratingScale));
      if (!Number.isFinite(scale) || scale < 2 || scale > 10) throw new Error('ratingScale must be between 2 and 10');
      sets.push('rating_scale = ?'); params.push(scale);
    }
    if (body.sections !== undefined) {
      const sections = await this.validateSections(body.sections);
      sets.push('sections_json = ?'); params.push(sections ? JSON.stringify(sections) : null);
    }
    if (body.isActive !== undefined) { sets.push('is_active = ?'); params.push(!!body.isActive); }
    if (sets.length === 0) throw new Error('Nothing to update');

    await this.repo.updateTemplate(id, sets, params);
    await this.audit.record('REVIEW_TEMPLATE', id, 'UPDATE', ctx, this.toTemplateResponse(before), body);
    return this.toTemplateResponse(await this.repo.findTemplateById(id));
  }

  /**
   * sections must be an array of {section, questions:[{kind, question, competencyId?}]}.
   * COMPETENCY questions must point at a real competency so submissions can be
   * mirrored into competency_ratings without dangling references.
   */
  private async validateSections(sections: unknown): Promise<TemplateSection[] | null> {
    if (sections === undefined || sections === null) return null;
    if (!Array.isArray(sections)) throw new Error('sections must be an array of {section, questions}');
    const competencies = await this.repo.findCompetencies();
    const competencyIds = new Set(competencies.map((c) => Number(c.id)));

    const clean: TemplateSection[] = [];
    for (const section of sections) {
      if (!section || typeof section.section !== 'string' || !section.section.trim()) {
        throw new Error('Every section needs a non-empty "section" name');
      }
      if (!Array.isArray(section.questions) || section.questions.length === 0) {
        throw new Error(`Section "${section.section}" needs at least one question`);
      }
      const questions: TemplateSection['questions'] = [];
      for (const q of section.questions) {
        if (!q || !QUESTION_KINDS.includes(q.kind)) {
          throw new Error(`Question kind must be one of ${QUESTION_KINDS.join(', ')}`);
        }
        if (typeof q.question !== 'string' || !q.question.trim()) {
          throw new Error(`Section "${section.section}" has a question without text`);
        }
        const entry: TemplateSection['questions'][number] = { kind: q.kind, question: q.question.trim() };
        if (q.kind === 'COMPETENCY') {
          const compId = Math.trunc(Number(q.competencyId));
          if (!competencyIds.has(compId)) {
            throw new Error(`COMPETENCY question "${q.question}" needs a valid competencyId`);
          }
          entry.competencyId = compId;
        }
        questions.push(entry);
      }
      clean.push({ section: section.section.trim(), questions });
    }
    return clean;
  }

  // ==========================================================================
  // Reviews
  // ==========================================================================

  async listReviews(
    filters: { cycleId?: number; employeeId?: number; reviewType?: string; status?: string; reviewerEmployeeId?: number },
    callerRole: string,
  ): Promise<ReviewResponse[]> {
    const rows = await this.repo.findReviews(filters);
    return rows.map((r) => this.toResponse(r, callerRole));
  }

  async createReview(body: any, ctx: PerfActionContext): Promise<{ review: ReviewResponse; note?: string }> {
    const cycleId = Math.trunc(Number(body?.cycleId));
    const employeeId = Math.trunc(Number(body?.employeeId));
    const reviewType = String(body?.reviewType ?? '');
    if (!cycleId || !employeeId) throw new Error('cycleId and employeeId are required');
    if (!REVIEW_TYPES.includes(reviewType as ReviewType)) {
      throw new Error(`reviewType must be one of ${REVIEW_TYPES.join(', ')}`);
    }

    const cycle = await this.repo.findCycleById(cycleId);
    if (!cycle) throw new Error('Performance cycle not found');
    const employee = await this.repo.findEmployeeById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const isExternal = reviewType === 'CUSTOMER' || reviewType === 'EXTERNAL';
    let reviewerEmployeeId: number | null = null;
    let externalReviewerName: string | null = null;

    if (isExternal) {
      externalReviewerName = String(body.externalReviewerName ?? '').trim();
      if (!externalReviewerName) {
        throw new Error(`${reviewType} reviews require externalReviewerName -- HR records the stakeholder's feedback on their behalf`);
      }
    } else if (reviewType === 'SELF') {
      reviewerEmployeeId = employeeId;
    } else {
      reviewerEmployeeId = Math.trunc(Number(body.reviewerEmployeeId));
      if (!reviewerEmployeeId) throw new Error(`${reviewType} reviews require reviewerEmployeeId`);
      const reviewer = await this.repo.findEmployeeById(reviewerEmployeeId);
      if (!reviewer) throw new Error('Reviewer employee not found');
    }

    if (body.templateId) {
      const template = await this.repo.findTemplateById(Math.trunc(Number(body.templateId)));
      if (!template) throw new Error('Review template not found');
    }

    const exists = await this.repo.reviewExists(cycleId, employeeId, reviewType, reviewerEmployeeId);
    if (exists) throw new Error('An identical review request already exists for this cycle, subject and reviewer');

    const reviewerUserId = reviewerEmployeeId ? await this.repo.findUserIdForEmployee(reviewerEmployeeId) : null;
    const id = await this.repo.insertReview({
      cycleId,
      employeeId,
      reviewType,
      reviewerEmployeeId,
      reviewerUserId,
      externalReviewerName,
      templateId: body.templateId ? Math.trunc(Number(body.templateId)) : null,
      isAnonymous: !!body.isAnonymous,
      dueDate: body.dueDate ?? null,
      requestedBy: ctx.userId,
    });
    await this.audit.record('REVIEW', id, 'CREATE', ctx, null, { cycleId, employeeId, reviewType, reviewerEmployeeId, externalReviewerName });
    await this.notifyReviewRequested(id, reviewerUserId, employee.full_name, reviewType, ctx.userId);

    const review = this.toResponse(await this.repo.findReviewById(id), ctx.userRole);
    if (isExternal) {
      return {
        review,
        note: 'CUSTOMER/EXTERNAL reviews are recorded by HR on the stakeholder\'s behalf -- no external reviewer portal exists.',
      };
    }
    return { review };
  }

  /**
   * Bulk launch: one SELF review (reviewer = subject) and one MANAGER review
   * per WORKING employee. Employees without a primary manager mapping get the
   * SELF review only and are reported in `skipped` -- silently inventing a
   * manager would corrupt the 360. Idempotent: existing pairs are counted, not
   * duplicated.
   */
  async launch(cycleId: number, ctx: PerfActionContext): Promise<{
    cycleId: number;
    created: number;
    alreadyExisted: number;
    skipped: { employeeId: number; reason: string }[];
  }> {
    const cycle = await this.repo.findCycleById(cycleId);
    if (!cycle) throw new Error('Performance cycle not found');
    if (cycle.status === 'CLOSED') throw new Error('Reviews cannot be launched for a closed cycle');

    const template = await this.repo.findDefaultTemplate();
    const employees = await this.repo.findWorkingEmployees();
    const today = todayString();

    let created = 0;
    let alreadyExisted = 0;
    const skipped: { employeeId: number; reason: string }[] = [];

    for (const emp of employees) {
      const empId = Number(emp.id);

      // SELF review
      if (await this.repo.reviewExists(cycleId, empId, 'SELF', empId)) {
        alreadyExisted++;
      } else {
        const selfUserId = await this.repo.findUserIdForEmployee(empId);
        const id = await this.repo.insertReview({
          cycleId,
          employeeId: empId,
          reviewType: 'SELF',
          reviewerEmployeeId: empId,
          reviewerUserId: selfUserId,
          externalReviewerName: null,
          templateId: template ? Number(template.id) : null,
          isAnonymous: false,
          dueDate: cycle.self_review_end ? toDateString(cycle.self_review_end) : null,
          requestedBy: ctx.userId,
        });
        created++;
        await this.notifyReviewRequested(id, selfUserId, emp.full_name, 'SELF', ctx.userId);
      }

      // MANAGER review
      const managerId = await this.repo.findPrimaryManager(empId, today);
      if (!managerId) {
        skipped.push({ employeeId: empId, reason: 'no primary manager mapped in reporting relationships' });
        continue;
      }
      if (await this.repo.reviewExists(cycleId, empId, 'MANAGER', managerId)) {
        alreadyExisted++;
        continue;
      }
      const managerUserId = await this.repo.findUserIdForEmployee(managerId);
      const id = await this.repo.insertReview({
        cycleId,
        employeeId: empId,
        reviewType: 'MANAGER',
        reviewerEmployeeId: managerId,
        reviewerUserId: managerUserId,
        externalReviewerName: null,
        templateId: template ? Number(template.id) : null,
        isAnonymous: false,
        dueDate: cycle.manager_review_end ? toDateString(cycle.manager_review_end) : null,
        requestedBy: ctx.userId,
      });
      created++;
      await this.notifyReviewRequested(id, managerUserId, emp.full_name, 'MANAGER', ctx.userId);
    }

    await this.audit.record('REVIEW', cycleId, 'LAUNCH', ctx, null, { cycleId, created, alreadyExisted, skippedCount: skipped.length });
    return { cycleId, created, alreadyExisted, skipped };
  }

  /** Peer nominations for an existing review's subject and cycle. */
  async requestPeers(
    reviewId: number,
    reviewerEmployeeIds: number[],
    isAnonymous: boolean,
    ctx: PerfActionContext,
  ): Promise<{ created: number; skipped: { employeeId: number; reason: string }[] }> {
    const base = await this.repo.findReviewById(reviewId);
    if (!base) throw new Error('Review not found');
    if (!Array.isArray(reviewerEmployeeIds) || reviewerEmployeeIds.length === 0) {
      throw new Error('reviewerEmployeeIds must be a non-empty array');
    }

    const peerTemplate =
      (await this.repo.findTemplateByCode('TPL-PEER')) ?? (await this.repo.findDefaultTemplate());

    let created = 0;
    const skipped: { employeeId: number; reason: string }[] = [];
    for (const raw of reviewerEmployeeIds) {
      const peerId = Math.trunc(Number(raw));
      if (!peerId) { skipped.push({ employeeId: Number(raw), reason: 'invalid employee id' }); continue; }
      if (peerId === Number(base.employee_id)) {
        skipped.push({ employeeId: peerId, reason: 'self-nomination is not allowed for peer reviews' });
        continue;
      }
      const peer = await this.repo.findEmployeeById(peerId);
      if (!peer) { skipped.push({ employeeId: peerId, reason: 'employee not found' }); continue; }
      if (await this.repo.reviewExists(Number(base.cycle_id), Number(base.employee_id), 'PEER', peerId)) {
        skipped.push({ employeeId: peerId, reason: 'peer review already requested' });
        continue;
      }
      const peerUserId = await this.repo.findUserIdForEmployee(peerId);
      const id = await this.repo.insertReview({
        cycleId: Number(base.cycle_id),
        employeeId: Number(base.employee_id),
        reviewType: 'PEER',
        reviewerEmployeeId: peerId,
        reviewerUserId: peerUserId,
        externalReviewerName: null,
        templateId: peerTemplate ? Number(peerTemplate.id) : null,
        isAnonymous: !!isAnonymous,
        dueDate: base.due_date ? toDateString(base.due_date) : null,
        requestedBy: ctx.userId,
      });
      created++;
      await this.audit.record('REVIEW', id, 'CREATE', ctx, null, { reviewType: 'PEER', employeeId: base.employee_id, reviewerEmployeeId: peerId, isAnonymous: !!isAnonymous });
      await this.notifyReviewRequested(id, peerUserId, base.employee_name, 'PEER', ctx.userId);
    }
    return { created, skipped };
  }

  async getReview(id: number, caller: ReviewCaller): Promise<ReviewResponse> {
    const row = await this.repo.findReviewById(id);
    if (!row) throw new Error('Review not found');
    this.assertCanSee(row, caller);
    const responses = await this.repo.findResponses(id);
    const review = this.toResponse(row, caller.role);
    review.responses = responses.map((r) => this.toResponseItem(r));
    return review;
  }

  /**
   * Replace-all answer write. Allowed for the reviewer (matched on their
   * employee record) or staff (who record customer/external feedback).
   */
  async respond(id: number, body: any, caller: ReviewCaller, ctx: PerfActionContext): Promise<ReviewResponse> {
    const row = await this.repo.findReviewById(id);
    if (!row) throw new Error('Review not found');
    this.assertCanWrite(row, caller);
    if (['SUBMITTED', 'ACKNOWLEDGED', 'DECLINED'].includes(row.status)) {
      throw new Error(`Review cannot be edited once ${row.status}`);
    }

    const items = Array.isArray(body?.responses) ? body.responses : [];
    const clean = items.map((item: any, index: number) => {
      if (!item || typeof item.question !== 'string' || !item.question.trim()) {
        throw new Error(`Response ${index + 1} is missing its question text`);
      }
      const rating = item.rating === null || item.rating === undefined ? null : Number(item.rating);
      if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 10)) {
        throw new Error(`Response "${item.question}" has an invalid rating`);
      }
      return {
        section: item.section ? String(item.section) : null,
        question: item.question.trim(),
        responseText: item.responseText ? String(item.responseText) : null,
        rating,
        competencyId: item.competencyId ? Math.trunc(Number(item.competencyId)) : null,
        sortOrder: Number.isFinite(Number(item.sortOrder)) ? Math.trunc(Number(item.sortOrder)) : index,
      };
    });

    await this.repo.replaceResponses(
      id,
      {
        overallRating: body.overallRating === undefined ? undefined : (body.overallRating === null ? null : Number(body.overallRating)),
        achievements: body.achievements === undefined ? undefined : (body.achievements ?? null),
        challenges: body.challenges === undefined ? undefined : (body.challenges ?? null),
        learnings: body.learnings === undefined ? undefined : (body.learnings ?? null),
        developmentNotes: body.developmentNotes === undefined ? undefined : (body.developmentNotes ?? null),
        markInProgress: row.status === 'REQUESTED',
      },
      clean,
    );
    await this.audit.record('REVIEW', id, 'RESPOND', ctx, { status: row.status }, { responseCount: clean.length });
    return this.getReview(id, caller);
  }

  /**
   * Submission validates that every RATING question on the template received a
   * rating, then mirrors COMPETENCY answers into competency_ratings with a
   * rater type derived from the review type.
   */
  async submit(id: number, caller: ReviewCaller, ctx: PerfActionContext): Promise<ReviewResponse> {
    const row = await this.repo.findReviewById(id);
    if (!row) throw new Error('Review not found');
    this.assertCanWrite(row, caller);
    if (!['REQUESTED', 'IN_PROGRESS'].includes(row.status)) {
      throw new Error(`Review cannot be submitted from status ${row.status}`);
    }

    const responses = await this.repo.findResponses(id);

    if (row.template_id) {
      const template = await this.repo.findTemplateById(Number(row.template_id));
      const sections: TemplateSection[] = parseJson(template?.sections_json) ?? [];
      for (const section of sections) {
        for (const q of section.questions ?? []) {
          if (q.kind !== 'RATING') continue;
          const answered = responses.find((r) => String(r.question) === q.question && r.rating !== null);
          if (!answered) {
            throw new Error(`Rating question "${q.question}" must be answered before submitting`);
          }
        }
      }
    }

    const ratedByType = row.review_type === 'SELF' ? 'SELF'
      : row.review_type === 'MANAGER' ? 'MANAGER'
        : row.review_type === 'PEER' ? 'PEER' : 'OTHER';

    const competencyRows = responses
      .filter((r) => r.competency_id !== null && r.rating !== null)
      .map((r) => ({
        employeeId: Number(row.employee_id),
        competencyId: Number(r.competency_id),
        cycleId: Number(row.cycle_id),
        rating: Number(r.rating),
        ratedByType,
        ratedBy: ctx.userId,
      }));

    await this.repo.submitReview(id, competencyRows);
    await this.audit.record('REVIEW', id, 'SUBMIT', ctx, { status: row.status }, { status: 'SUBMITTED', competencyRatings: competencyRows.length });

    // Notify the subject that a review about them landed. The reviewer's name
    // is deliberately absent: the notification must respect anonymity too.
    try {
      await this.notifications.notifyEmployee(Number(row.employee_id), {
        category: PERFORMANCE_CATEGORY,
        title: `A ${String(row.review_type).toLowerCase()} review about you was submitted`,
        body: `Cycle: ${row.cycle_name}`,
        linkPage: 'performance',
        linkRefId: id,
        createdBy: ctx.userId,
      });
    } catch (err) {
      console.error('review-submitted notification failed:', err);
    }

    return this.getReview(id, caller);
  }

  async acknowledge(id: number, caller: ReviewCaller, ctx: PerfActionContext): Promise<ReviewResponse> {
    const row = await this.repo.findReviewById(id);
    if (!row) throw new Error('Review not found');
    const isSubject = caller.employeeId !== null && Number(row.employee_id) === caller.employeeId;
    if (!isSubject && !this.isStaff(caller.role)) {
      throw new Error('Only the review subject or staff can acknowledge a review');
    }
    if (row.status !== 'SUBMITTED') throw new Error(`Review cannot be acknowledged from status ${row.status}`);
    await this.repo.updateReview(id, ["status = 'ACKNOWLEDGED'", 'acknowledged_at = NOW()'], []);
    await this.audit.record('REVIEW', id, 'ACKNOWLEDGE', ctx, { status: row.status }, { status: 'ACKNOWLEDGED' });
    return this.toResponse(await this.repo.findReviewById(id), caller.role);
  }

  async decline(id: number, reason: string, caller: ReviewCaller, ctx: PerfActionContext): Promise<ReviewResponse> {
    const row = await this.repo.findReviewById(id);
    if (!row) throw new Error('Review not found');
    this.assertCanWrite(row, caller);
    if (!reason || !String(reason).trim()) throw new Error('A reason is required to decline a review');
    if (!['REQUESTED', 'IN_PROGRESS'].includes(row.status)) {
      throw new Error(`Review cannot be declined from status ${row.status}`);
    }
    await this.repo.updateReview(id, ["status = 'DECLINED'"], []);
    await this.audit.record('REVIEW', id, 'DECLINE', ctx, { status: row.status }, { status: 'DECLINED', reason: String(reason).trim() });
    return this.toResponse(await this.repo.findReviewById(id), caller.role);
  }

  // ==========================================================================
  // 360 summary
  // ==========================================================================

  async get360(employeeId: number, cycleId: number, callerRole: string): Promise<{
    employeeId: number;
    cycleId: number;
    byType: { reviewType: string; count: number; submitted: number; avgRating: number | null }[];
    competencyAverages: { competencyId: number; name: string; category: string; avgRating: number; raters: number }[];
    reviews: ReviewResponse[];
  }> {
    if (!cycleId) throw new Error('cycleId is required');
    const employee = await this.repo.findEmployeeById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const [byType, competencyAverages, reviews] = await Promise.all([
      this.repo.aggregate360ByType(employeeId, cycleId),
      this.repo.competencyAverages360(employeeId, cycleId),
      this.repo.findReviews({ employeeId, cycleId }),
    ]);

    return {
      employeeId,
      cycleId,
      byType: byType.map((r) => ({
        reviewType: String(r.review_type),
        count: Number(r.count),
        submitted: Number(r.submitted ?? 0),
        avgRating: r.avg_rating === null ? null : Math.round(Number(r.avg_rating) * 100) / 100,
      })),
      competencyAverages: competencyAverages.map((r) => ({
        competencyId: Number(r.competency_id),
        name: String(r.name),
        category: String(r.category),
        avgRating: Math.round(Number(r.avg_rating) * 100) / 100,
        raters: Number(r.raters),
      })),
      reviews: reviews.map((r) => this.toResponse(r, callerRole)),
    };
  }

  // ==========================================================================
  // Attachments
  // ==========================================================================

  async addAttachment(
    reviewId: number,
    file: { originalname: string; filename: string; mimetype: string; size: number },
    subdir: string,
    caller: ReviewCaller,
    ctx: PerfActionContext,
  ): Promise<any> {
    const row = await this.repo.findReviewById(reviewId);
    if (!row) throw new Error('Review not found');
    const isParticipant =
      caller.employeeId !== null
      && (Number(row.employee_id) === caller.employeeId || Number(row.reviewer_employee_id) === caller.employeeId);
    if (!isParticipant && !this.isStaff(caller.role)) {
      throw new Error('Only the review participants or staff can attach files to a review');
    }
    const id = await this.repo.insertAttachment({
      reviewId,
      fileName: file.originalname,
      filePath: `${subdir}/${file.filename}`,
      mimeType: file.mimetype ?? null,
      fileSize: file.size ?? null,
      uploadedBy: ctx.userId,
    });
    await this.audit.record('REVIEW', reviewId, 'ATTACH', ctx, null, { attachmentId: id, fileName: file.originalname });
    return this.toAttachmentResponse(await this.repo.findAttachmentById(id));
  }

  async listAttachments(reviewId: number, caller: ReviewCaller): Promise<any[]> {
    const row = await this.repo.findReviewById(reviewId);
    if (!row) throw new Error('Review not found');
    this.assertCanSee(row, caller);
    const rows = await this.repo.findAttachments(reviewId);
    return rows.map((r) => this.toAttachmentResponse(r));
  }

  /** Returns the stored relative path; the controller resolves and streams it. */
  async getAttachmentForDownload(attachmentId: number, caller: ReviewCaller): Promise<{ fileName: string; filePath: string; mimeType: string | null }> {
    const attachment = await this.repo.findAttachmentById(attachmentId);
    if (!attachment) throw new Error('Attachment not found');
    const row = await this.repo.findReviewById(Number(attachment.review_id));
    if (!row) throw new Error('Review not found');
    this.assertCanSee(row, caller);
    return {
      fileName: String(attachment.file_name),
      filePath: String(attachment.file_path),
      mimeType: attachment.mime_type ?? null,
    };
  }

  // ==========================================================================
  // ESS
  // ==========================================================================

  async myReviews(caller: ReviewCaller): Promise<ReviewResponse[]> {
    if (!caller.employeeId) throw new Error('This account is not linked to an employee record');
    const rows = await this.repo.findReviewsForReviewer(caller.employeeId);
    return rows.map((r) => this.toResponse(r, caller.role));
  }

  async myReviewHistory(caller: ReviewCaller): Promise<ReviewResponse[]> {
    if (!caller.employeeId) throw new Error('This account is not linked to an employee record');
    const rows = await this.repo.findReviewHistoryForEmployee(caller.employeeId);
    return rows.map((r) => this.toResponse(r, caller.role));
  }

  // ==========================================================================
  // Reports
  // ==========================================================================

  async reviewStatusReport(cycleId?: number): Promise<{ columns: { key: string; label: string }[]; rows: any[] }> {
    const rows = await this.repo.findReviews(cycleId ? { cycleId } : {});
    return {
      columns: [
        { key: 'cycleName', label: 'Cycle' },
        { key: 'employeeName', label: 'Employee' },
        { key: 'reviewType', label: 'Type' },
        { key: 'reviewerName', label: 'Reviewer' },
        { key: 'status', label: 'Status' },
        { key: 'dueDate', label: 'Due' },
        { key: 'submittedAt', label: 'Submitted' },
        { key: 'overallRating', label: 'Overall Rating' },
      ],
      rows: rows.map((raw) => {
        // Report rows go to staff; anonymity still holds for non-HR staff, so
        // the masked mapper is reused with a generic staff role.
        const r = this.toResponse(raw, 'manager');
        return {
          cycleName: r.cycleName,
          employeeName: r.employeeName,
          reviewType: r.reviewType,
          reviewerName: r.isAnonymous ? 'Anonymous' : (r.reviewerName ?? r.externalReviewerName ?? ''),
          status: r.status,
          dueDate: r.dueDate ?? '',
          submittedAt: r.submittedAt ?? '',
          overallRating: r.overallRating ?? '',
        };
      }),
    };
  }

  async feedback360Report(cycleId?: number): Promise<{ columns: { key: string; label: string }[]; rows: any[] }> {
    const rows = await this.repo.findReviews(cycleId ? { cycleId } : {});
    const byEmployee = new Map<number, any>();
    for (const r of rows) {
      const key = Number(r.employee_id);
      const entry = byEmployee.get(key) ?? {
        employeeName: r.employee_name, cycleName: r.cycle_name,
        total: 0, submitted: 0, self: 0, manager: 0, peer: 0, other: 0, ratings: [] as number[],
      };
      entry.total++;
      if (['SUBMITTED', 'ACKNOWLEDGED'].includes(r.status)) {
        entry.submitted++;
        if (r.overall_rating !== null) entry.ratings.push(Number(r.overall_rating));
      }
      if (r.review_type === 'SELF') entry.self++;
      else if (r.review_type === 'MANAGER') entry.manager++;
      else if (r.review_type === 'PEER') entry.peer++;
      else entry.other++;
      byEmployee.set(key, entry);
    }
    return {
      columns: [
        { key: 'employeeName', label: 'Employee' },
        { key: 'cycleName', label: 'Cycle' },
        { key: 'total', label: 'Reviews' },
        { key: 'submitted', label: 'Submitted' },
        { key: 'self', label: 'Self' },
        { key: 'manager', label: 'Manager' },
        { key: 'peer', label: 'Peer' },
        { key: 'other', label: 'Other' },
        { key: 'avgRating', label: 'Avg Rating' },
      ],
      rows: [...byEmployee.values()].map((e) => ({
        employeeName: e.employeeName,
        cycleName: e.cycleName,
        total: e.total,
        submitted: e.submitted,
        self: e.self,
        manager: e.manager,
        peer: e.peer,
        other: e.other,
        avgRating: e.ratings.length
          ? Math.round((e.ratings.reduce((a: number, b: number) => a + b, 0) / e.ratings.length) * 100) / 100
          : '',
      })),
    };
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private isStaff(role: string): boolean {
    return ['admin', 'manager', 'operator', 'accountant', 'hr'].includes(role);
  }

  /** Non-staff callers can read a review only as its subject or its reviewer. */
  private assertCanSee(row: any, caller: ReviewCaller): void {
    if (this.isStaff(caller.role)) return;
    const isParticipant =
      caller.employeeId !== null
      && (Number(row.employee_id) === caller.employeeId || Number(row.reviewer_employee_id) === caller.employeeId);
    if (!isParticipant) throw new Error('You can only access reviews you are part of');
  }

  private assertCanWrite(row: any, caller: ReviewCaller): void {
    const isReviewer = caller.employeeId !== null && Number(row.reviewer_employee_id) === caller.employeeId;
    if (!isReviewer && !this.isStaff(caller.role)) {
      throw new Error('Only the assigned reviewer or staff can act on this review');
    }
  }

  /**
   * THE anonymity choke point. Every review row leaving the service passes
   * through here; anonymous reviews lose reviewer identity unless the caller
   * is admin or hr.
   */
  private toResponse(r: any, callerRole: string): ReviewResponse {
    const hideReviewer = !!r.is_anonymous && !ANONYMITY_EXEMPT_ROLES.has(callerRole);
    return {
      id: Number(r.id),
      cycleId: Number(r.cycle_id),
      cycleName: r.cycle_name ?? null,
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      reviewType: r.review_type,
      reviewerEmployeeId: hideReviewer ? null : (r.reviewer_employee_id === null ? null : Number(r.reviewer_employee_id)),
      reviewerName: hideReviewer ? null : (r.reviewer_name ?? null),
      reviewerUserId: hideReviewer ? null : (r.reviewer_user_id === null ? null : Number(r.reviewer_user_id)),
      externalReviewerName: hideReviewer ? null : (r.external_reviewer_name ?? null),
      templateId: r.template_id === null ? null : Number(r.template_id),
      status: r.status,
      isAnonymous: !!r.is_anonymous,
      overallRating: r.overall_rating === null ? null : Number(r.overall_rating),
      achievements: r.achievements ?? null,
      challenges: r.challenges ?? null,
      learnings: r.learnings ?? null,
      developmentNotes: r.development_notes ?? null,
      dueDate: r.due_date ? toDateString(r.due_date) : null,
      submittedAt: r.submitted_at ? new Date(r.submitted_at).toISOString() : null,
      acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    };
  }

  private toResponseItem(r: any): ReviewResponseItem {
    return {
      id: Number(r.id),
      reviewId: Number(r.review_id),
      section: r.section ?? null,
      question: String(r.question),
      responseText: r.response_text ?? null,
      rating: r.rating === null ? null : Number(r.rating),
      competencyId: r.competency_id === null ? null : Number(r.competency_id),
      sortOrder: Number(r.sort_order ?? 0),
    };
  }

  private toTemplateResponse(r: any): ReviewTemplateResponse {
    return {
      id: Number(r.id),
      code: String(r.code),
      name: String(r.name),
      appliesTo: r.applies_to,
      ratingScale: Number(r.rating_scale),
      sections: parseJson(r.sections_json) ?? [],
      isActive: !!r.is_active,
    };
  }

  private toAttachmentResponse(r: any): any {
    return {
      id: Number(r.id),
      reviewId: Number(r.review_id),
      fileName: String(r.file_name),
      mimeType: r.mime_type ?? null,
      fileSize: r.file_size === null ? null : Number(r.file_size),
      uploadedBy: r.uploaded_by === null ? null : Number(r.uploaded_by),
      uploadedByName: r.uploaded_by_name ?? null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    };
  }

  private async notifyReviewRequested(
    reviewId: number,
    reviewerUserId: number | null,
    subjectName: string,
    reviewType: string,
    createdBy: number,
  ): Promise<void> {
    if (!reviewerUserId) return;
    try {
      await this.notifications.notify({
        userId: reviewerUserId,
        category: PERFORMANCE_CATEGORY,
        title: `Review requested: ${reviewType} review for ${subjectName}`,
        body: 'Open the performance workspace to complete the review.',
        linkPage: 'performance',
        linkRefId: reviewId,
        createdBy,
      });
    } catch (err) {
      console.error('review-requested notification failed:', err);
    }
  }
}
