import { ExitProcessRepository } from '../repositories/ExitProcessRepository';
import { SeparationRepository } from '../repositories/SeparationRepository';
import { ExitInterviewResponse, SurveyQuestionResponse } from '../types/offboarding';
import { PerfActionContext } from '../types/performance';
import { round2, toDateString } from '../utils/dateUtils';
import { ExitAuditService } from './ExitAuditService';
import { OffboardingActor, SURVEY_SUBMITTED_EVENT } from './SeparationService';

const QUESTION_KINDS = new Set(['TEXT', 'RATING', 'CHOICE']);

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseChoices(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

/** Tenure band from the joining date; the only person-shaped analytics kept for anonymous answers. */
export function tenureBandFor(joinedAt: unknown): string | null {
  if (!joinedAt) return null;
  const joined = joinedAt instanceof Date ? joinedAt : new Date(`${toDateString(joinedAt)}T00:00:00Z`);
  if (Number.isNaN(joined.getTime())) return null;
  const years = (Date.now() - joined.getTime()) / (365.25 * 86400000);
  if (years < 1) return '<1y';
  if (years < 3) return '1-3y';
  if (years < 5) return '3-5y';
  if (years < 10) return '5-10y';
  return '10y+';
}

export function toInterviewResponse(row: any): ExitInterviewResponse {
  return {
    id: row.id,
    separationId: row.separation_id,
    employeeName: row.employee_name ?? null,
    interviewType: row.interview_type,
    scheduledAt: isoOrNull(row.scheduled_at),
    interviewerUserId: row.interviewer_user_id ?? null,
    interviewerName: row.interviewer_name ?? null,
    status: row.status,
    summary: row.summary ?? null,
    keyReasons: row.key_reasons ?? null,
    wouldRecommendCompany:
      row.would_recommend_company === null || row.would_recommend_company === undefined
        ? null
        : !!row.would_recommend_company,
    completedAt: isoOrNull(row.completed_at),
  };
}

export function toSurveyQuestionResponse(row: any): SurveyQuestionResponse {
  return {
    id: row.id,
    question: row.question,
    kind: row.kind,
    choices: parseChoices(row.choices_json),
    sortOrder: Number(row.sort_order),
    isActive: !!row.is_active,
  };
}

/**
 * Exit interviews (HR + manager rounds) and the exit survey. The survey's
 * anonymity contract is enforced here: an anonymous submission stores NO
 * separation link - only the department and a tenure band - and the
 * double-submit block rides on a SURVEY_SUBMITTED case event instead of the
 * responses themselves.
 */
export class ExitInterviewService {
  private repo = new ExitProcessRepository();
  private separations = new SeparationRepository();
  private audit = new ExitAuditService();

  // ==========================================================================
  // Interviews
  // ==========================================================================

  async listInterviews(filters: { separationId?: number; status?: string; limit?: number }): Promise<ExitInterviewResponse[]> {
    const rows = await this.repo.findInterviews(filters);
    return rows.map(toInterviewResponse);
  }

  async schedule(
    id: number,
    input: { scheduledAt?: string; interviewerUserId?: number },
    ctx: PerfActionContext,
  ): Promise<ExitInterviewResponse> {
    const before = await this.mustFindInterview(id);
    if (before.status === 'COMPLETED' || before.status === 'CANCELLED') {
      throw new Error(`A ${before.status} interview cannot be scheduled`);
    }
    if (!input?.scheduledAt) throw new Error('scheduledAt is required');
    const when = new Date(String(input.scheduledAt));
    if (Number.isNaN(when.getTime())) throw new Error('scheduledAt must be a valid date/time');

    await this.repo.updateInterview(id, {
      status: 'SCHEDULED',
      scheduled_at: when,
      interviewer_user_id: input.interviewerUserId ?? before.interviewer_user_id ?? null,
    });
    await this.separations.insertEvent(
      before.separation_id,
      'INTERVIEW_SCHEDULED',
      `${before.interview_type} exit interview scheduled for ${when.toISOString()}.`,
      ctx.userId,
    );
    await this.audit.record('EXIT_INTERVIEW', id, 'SCHEDULE', ctx,
      { status: before.status, scheduledAt: isoOrNull(before.scheduled_at) },
      { status: 'SCHEDULED', scheduledAt: when.toISOString(), interviewerUserId: input.interviewerUserId ?? null });
    return toInterviewResponse(await this.mustFindInterview(id));
  }

  async complete(
    id: number,
    input: { summary?: string; keyReasons?: string; wouldRecommendCompany?: boolean },
    ctx: PerfActionContext,
  ): Promise<ExitInterviewResponse> {
    const before = await this.mustFindInterview(id);
    if (before.status === 'COMPLETED') throw new Error('This interview is already COMPLETED');
    if (before.status === 'CANCELLED') throw new Error('A CANCELLED interview cannot be completed');
    if (!input?.summary || !String(input.summary).trim()) throw new Error('A summary is required to complete an interview');

    await this.repo.updateInterview(id, {
      status: 'COMPLETED',
      summary: String(input.summary).trim(),
      key_reasons: input.keyReasons ? String(input.keyReasons).trim() : null,
      would_recommend_company:
        input.wouldRecommendCompany === undefined || input.wouldRecommendCompany === null
          ? null
          : input.wouldRecommendCompany ? 1 : 0,
      completed_at: new Date(),
      interviewer_user_id: before.interviewer_user_id ?? ctx.userId,
    });
    await this.separations.insertEvent(
      before.separation_id,
      'INTERVIEW_COMPLETED',
      `${before.interview_type} exit interview completed.`,
      ctx.userId,
    );
    await this.audit.record('EXIT_INTERVIEW', id, 'COMPLETE', ctx,
      { status: before.status },
      { status: 'COMPLETED', keyReasons: input.keyReasons ?? null, wouldRecommendCompany: input.wouldRecommendCompany ?? null });
    return toInterviewResponse(await this.mustFindInterview(id));
  }

  async cancelInterview(id: number, ctx: PerfActionContext): Promise<ExitInterviewResponse> {
    const before = await this.mustFindInterview(id);
    if (before.status === 'COMPLETED') throw new Error('A COMPLETED interview cannot be cancelled');
    if (before.status === 'CANCELLED') throw new Error('This interview is already CANCELLED');
    await this.repo.updateInterview(id, { status: 'CANCELLED' });
    await this.separations.insertEvent(
      before.separation_id, 'INTERVIEW_CANCELLED',
      `${before.interview_type} exit interview cancelled.`, ctx.userId,
    );
    await this.audit.record('EXIT_INTERVIEW', id, 'CANCEL', ctx, { status: before.status }, { status: 'CANCELLED' });
    return toInterviewResponse(await this.mustFindInterview(id));
  }

  // ==========================================================================
  // Survey questions
  // ==========================================================================

  async listQuestions(activeOnly: boolean): Promise<SurveyQuestionResponse[]> {
    const rows = await this.repo.findSurveyQuestions(activeOnly);
    return rows.map(toSurveyQuestionResponse);
  }

  async createQuestion(input: any, ctx: PerfActionContext): Promise<SurveyQuestionResponse> {
    if (!input?.question || !String(input.question).trim()) throw new Error('A question text is required');
    const kind = input.kind ? String(input.kind).toUpperCase() : 'RATING';
    if (!QUESTION_KINDS.has(kind)) throw new Error(`Invalid question kind "${input.kind}"`);
    let choicesJson: string | null = null;
    if (kind === 'CHOICE') {
      if (!Array.isArray(input.choices) || input.choices.length < 2) {
        throw new Error('A CHOICE question requires a choices array with at least two options');
      }
      choicesJson = JSON.stringify(input.choices.map(String));
    }
    const id = await this.repo.insertSurveyQuestion({
      question: String(input.question).trim(),
      kind,
      choices_json: choicesJson,
      sort_order: input.sortOrder === undefined ? 0 : Math.trunc(Number(input.sortOrder)),
      is_active: input.isActive === undefined ? 1 : input.isActive ? 1 : 0,
    });
    await this.audit.record('SURVEY_QUESTION', id, 'CREATE', ctx, null, input);
    return toSurveyQuestionResponse(await this.repo.findSurveyQuestionById(id));
  }

  async updateQuestion(id: number, input: any, ctx: PerfActionContext): Promise<SurveyQuestionResponse> {
    const before = await this.repo.findSurveyQuestionById(id);
    if (!before) throw new Error(`Survey question ${id} was not found`);

    const fields: Record<string, any> = {};
    if (input.question !== undefined) fields.question = String(input.question).trim();
    if (input.kind !== undefined) {
      const kind = String(input.kind).toUpperCase();
      if (!QUESTION_KINDS.has(kind)) throw new Error(`Invalid question kind "${input.kind}"`);
      fields.kind = kind;
    }
    if (input.choices !== undefined) {
      fields.choices_json = input.choices === null ? null : JSON.stringify((input.choices as any[]).map(String));
    }
    if (input.sortOrder !== undefined) fields.sort_order = Math.trunc(Number(input.sortOrder));
    if (input.isActive !== undefined) fields.is_active = input.isActive ? 1 : 0;
    if (Object.keys(fields).length === 0) throw new Error('No updatable fields were provided');

    await this.repo.updateSurveyQuestion(id, fields);
    await this.audit.record('SURVEY_QUESTION', id, 'UPDATE', ctx, toSurveyQuestionResponse(before), input);
    return toSurveyQuestionResponse(await this.repo.findSurveyQuestionById(id));
  }

  // ==========================================================================
  // Survey submission (ESS)
  // ==========================================================================

  /**
   * One submission per case. Anonymous answers are stored with NO separation
   * link - department and tenure band only - and the double-submit guard is a
   * SURVEY_SUBMITTED event on the case, so anonymity genuinely holds.
   */
  async submitMySurvey(
    actor: OffboardingActor,
    input: { anonymous?: boolean; answers?: { questionId?: number; responseText?: string; rating?: number; choice?: string }[] },
  ): Promise<{ submitted: number; anonymous: boolean; note: string }> {
    if (!actor.employeeId) throw new Error('This account is not linked to an employee record');
    const separation = await this.separations.findActiveByEmployee(actor.employeeId);
    if (!separation) throw new Error('No active separation case was found for this employee, so the exit survey is not open');
    if (!Array.isArray(input?.answers) || input.answers.length === 0) {
      throw new Error('A non-empty answers array is required');
    }

    // One submission per case, for both modes. Anonymous submissions are
    // tracked via the case event alone - never via the responses.
    if (await this.separations.hasEvent(separation.id, SURVEY_SUBMITTED_EVENT)) {
      throw new Error('The exit survey has already been submitted for this separation case');
    }

    const anonymous = input.anonymous === true;
    const employee = await this.separations.findEmployee(actor.employeeId);
    if (!employee) throw new Error(`Employee ${actor.employeeId} was not found`);
    const departmentId = employee.department_id ?? null;
    const tenureBand = tenureBandFor(employee.joined_at);

    const questions = await this.repo.findSurveyQuestions(true);
    const byId = new Map<number, any>(questions.map((q) => [Number(q.id), q]));

    const rows: any[] = [];
    for (const answer of input.answers) {
      const questionId = Number(answer?.questionId);
      const question = byId.get(questionId);
      if (!question) throw new Error(`Question ${answer?.questionId} was not found among the active survey questions`);

      let responseText: string | null = null;
      let rating: number | null = null;
      let choice: string | null = null;
      if (question.kind === 'RATING') {
        rating = Number(answer.rating);
        if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
          throw new Error(`Question ${questionId} expects a rating between 0 and 10`);
        }
      } else if (question.kind === 'CHOICE') {
        const choices = parseChoices(question.choices_json) ?? [];
        choice = String(answer.choice ?? '');
        if (!choices.includes(choice)) {
          throw new Error(`Question ${questionId} expects one of: ${choices.join(', ')}`);
        }
      } else {
        responseText = answer.responseText === undefined || answer.responseText === null
          ? null
          : String(answer.responseText).trim();
        if (!responseText) throw new Error(`Question ${questionId} expects a text response`);
      }

      rows.push({
        separationId: anonymous ? null : separation.id,
        departmentId,
        tenureBand,
        questionId,
        responseText,
        rating,
        choice,
      });
    }

    await this.repo.insertSurveyResponses(rows);
    await this.separations.insertEvent(
      separation.id,
      SURVEY_SUBMITTED_EVENT,
      anonymous ? 'Exit survey submitted (anonymous mode).' : 'Exit survey submitted.',
      actor.userId,
    );
    // The audit row records THAT a survey was submitted, never the answers.
    await this.audit.record('EXIT_SURVEY', separation.id, 'SUBMIT', actor, null, {
      anonymous, answerCount: rows.length,
    });

    return {
      submitted: rows.length,
      anonymous,
      note: anonymous
        ? `Your responses were stored anonymously: no link to you or your case was saved - only your department and tenure band (${tenureBand ?? 'unknown'}) were retained for aggregate analytics.`
        : 'Your responses were stored against your separation case.',
    };
  }

  // ==========================================================================
  // Survey results (staff)
  // ==========================================================================

  async surveyResults(questionId?: number): Promise<any[]> {
    const questions = questionId
      ? [await this.repo.findSurveyQuestionById(questionId)].filter(Boolean)
      : await this.repo.findSurveyQuestions(false);
    if (questionId && questions.length === 0) throw new Error(`Survey question ${questionId} was not found`);

    const responses = await this.repo.findSurveyResponses(questionId);
    const byQuestion = new Map<number, any[]>();
    for (const r of responses) {
      const list = byQuestion.get(Number(r.question_id)) ?? [];
      list.push(r);
      byQuestion.set(Number(r.question_id), list);
    }

    return questions.map((q: any) => {
      const answers = byQuestion.get(Number(q.id)) ?? [];
      const base = {
        question: toSurveyQuestionResponse(q),
        responseCount: answers.length,
        anonymousCount: answers.filter((a) => a.separation_id === null).length,
      };
      if (q.kind === 'RATING') {
        const rated = answers.filter((a) => a.rating !== null);
        const avg = rated.length ? round2(rated.reduce((s, a) => s + Number(a.rating), 0) / rated.length) : null;
        return { ...base, averageRating: avg, ratingCount: rated.length };
      }
      if (q.kind === 'CHOICE') {
        const distribution: Record<string, number> = {};
        for (const a of answers) {
          if (a.choice === null) continue;
          distribution[a.choice] = (distribution[a.choice] ?? 0) + 1;
        }
        return { ...base, distribution };
      }
      // TEXT: anonymous entries expose department + tenure band only.
      return {
        ...base,
        entries: answers
          .filter((a) => a.response_text !== null)
          .map((a) => ({
            text: a.response_text,
            anonymous: a.separation_id === null,
            separationId: a.separation_id ?? null,
            department: a.department_name ?? null,
            tenureBand: a.tenure_band ?? null,
            submittedAt: isoOrNull(a.submitted_at),
          })),
      };
    });
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private async mustFindInterview(id: number): Promise<any> {
    const row = await this.repo.findInterviewById(id);
    if (!row) throw new Error(`Exit interview ${id} was not found`);
    return row;
  }
}
