import { InterviewRepository } from '../repositories/InterviewRepository';
import { RecruitmentAuditService } from './RecruitmentAuditService';
import { NotificationService } from './NotificationService';
import { PerfActionContext } from '../types/performance';
import { InterviewFeedbackResponse, InterviewRoundResponse } from '../types/internalRecruitment';

const ROUND_TYPES = ['HR_SCREENING', 'TECHNICAL', 'MANAGER', 'PANEL', 'FINAL'];
const MODES = ['IN_PERSON', 'PHONE', 'VIDEO'];
const OUTCOMES = ['PASS', 'FAIL', 'ON_HOLD'];
const RECOMMENDATIONS = ['STRONG_YES', 'YES', 'NEUTRAL', 'NO', 'STRONG_NO'];
/** Application statuses from which an interview may be scheduled. */
const SCHEDULABLE = ['SHORTLISTED', 'ASSESSMENT', 'INTERVIEW'];

const NO_INTEGRATION_NOTE =
  'meeting_link is a manually pasted URL - no video-conference or calendar integration exists in this deployment. '
  + 'An importable .ics file is available per interview.';

function parseJson(value: unknown): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function toRoundResponse(row: any, feedback?: InterviewFeedbackResponse[]): InterviewRoundResponse {
  return {
    id: row.id,
    applicationId: row.application_id,
    jobTitle: row.job_title ?? null,
    applicantName: row.applicant_name ?? null,
    roundNo: row.round_no,
    roundType: row.round_type,
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
    mode: row.mode,
    location: row.location,
    meetingLink: row.meeting_link,
    panel: parseJson(row.panel_json),
    status: row.status,
    rescheduleReason: row.reschedule_reason,
    outcome: row.outcome,
    feedback,
    createdAt: row.created_at,
  };
}

function toFeedbackResponse(row: any): InterviewFeedbackResponse {
  return {
    id: row.id,
    roundId: row.round_id,
    interviewerEmployeeId: row.interviewer_employee_id,
    interviewerName: row.interviewer_name ?? null,
    scorecard: parseJson(row.scorecard_json),
    overallScore: row.overall_score === null ? null : Number(row.overall_score),
    recommendation: row.recommendation,
    comments: row.comments,
    submittedAt: row.submitted_at,
  };
}

/** Formats a Date as an iCalendar UTC timestamp (YYYYMMDDTHHMMSSZ). */
function icsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export class InterviewService {
  private repo = new InterviewRepository();
  private audit = new RecruitmentAuditService();
  private notifications = new NotificationService();

  async schedule(body: any, ctx: PerfActionContext): Promise<{ round: InterviewRoundResponse; note: string }> {
    const applicationId = Math.trunc(Number(body?.applicationId));
    if (!applicationId) throw new Error('applicationId is required');
    const application = await this.repo.findApplicationById(applicationId);
    if (!application) throw new Error('Application not found');
    if (!SCHEDULABLE.includes(application.status)) {
      throw new Error(
        `Interviews can be scheduled only for applications in ${SCHEDULABLE.join('/')} (current: ${application.status})`,
      );
    }
    const roundType = body.roundType ?? 'HR_SCREENING';
    if (!ROUND_TYPES.includes(roundType)) throw new Error(`roundType must be one of ${ROUND_TYPES.join(', ')}`);
    const mode = body.mode ?? 'IN_PERSON';
    if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(', ')}`);
    const scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) throw new Error('A valid scheduledAt datetime is required');
    const durationMinutes = Math.min(Math.max(Math.trunc(Number(body.durationMinutes ?? 30)), 5), 480);

    let panelJson: string | null = null;
    if (body.panel !== undefined && body.panel !== null) {
      if (!Array.isArray(body.panel)) throw new Error('panel must be an array of {employeeId?, name, role?}');
      for (const member of body.panel) {
        if (!member?.name) throw new Error('Every panel member needs a name');
      }
      panelJson = JSON.stringify(body.panel);
    }

    const roundNo = await this.repo.nextRoundNo(applicationId);
    // The first round (or any round while not yet in INTERVIEW) moves the
    // application to INTERVIEW inside the same transaction.
    const transitionFrom = application.status !== 'INTERVIEW' ? application.status : null;
    const id = await this.repo.insertRound(
      {
        applicationId,
        roundNo,
        roundType,
        scheduledAt,
        durationMinutes,
        mode,
        location: body.location ?? null,
        meetingLink: body.meetingLink ?? null,
        panelJson,
        createdBy: ctx.userId,
      },
      transitionFrom,
    );

    await this.audit.record('INTERVIEW_ROUND', id, 'SCHEDULED', ctx, null, {
      applicationId, roundNo, roundType, scheduledAt: body.scheduledAt, mode,
    });
    await this.notifyRound(id, 'Interview scheduled');

    const round = await this.getById(id);
    return { round, note: NO_INTEGRATION_NOTE };
  }

  async list(filters: {
    applicationId?: number;
    status?: string;
    from?: string;
    to?: string;
    upcoming?: boolean;
  }): Promise<InterviewRoundResponse[]> {
    const rows = await this.repo.findRounds(filters);
    return rows.map((r) => toRoundResponse(r));
  }

  async getById(id: number): Promise<InterviewRoundResponse> {
    const row = await this.repo.findRoundById(id);
    if (!row) throw new Error('Interview round not found');
    const feedback = await this.repo.findFeedbackByRound(id);
    return toRoundResponse(row, feedback.map(toFeedbackResponse));
  }

  async reschedule(id: number, body: { scheduledAt: string; reason: string }, ctx: PerfActionContext): Promise<InterviewRoundResponse> {
    const row = await this.repo.findRoundById(id);
    if (!row) throw new Error('Interview round not found');
    if (!['SCHEDULED', 'RESCHEDULED'].includes(row.status)) {
      throw new Error(`Only scheduled rounds can be rescheduled (current: ${row.status})`);
    }
    const scheduledAt = new Date(body?.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) throw new Error('A valid scheduledAt datetime is required');
    if (!body?.reason) throw new Error('A reschedule reason is required');
    await this.repo.updateRound(id, ["status = 'RESCHEDULED'", 'scheduled_at = ?', 'reschedule_reason = ?'], [scheduledAt, body.reason]);
    await this.audit.record('INTERVIEW_ROUND', id, 'RESCHEDULED', ctx,
      { scheduledAt: row.scheduled_at }, { scheduledAt: body.scheduledAt, reason: body.reason });
    await this.notifyRound(id, 'Interview rescheduled');
    return this.getById(id);
  }

  async cancel(id: number, ctx: PerfActionContext): Promise<InterviewRoundResponse> {
    const row = await this.repo.findRoundById(id);
    if (!row) throw new Error('Interview round not found');
    if (['COMPLETED', 'CANCELLED'].includes(row.status)) {
      throw new Error(`Round is already ${row.status}`);
    }
    await this.repo.updateRound(id, ["status = 'CANCELLED'"], []);
    await this.audit.record('INTERVIEW_ROUND', id, 'CANCELLED', ctx, { status: row.status }, null);
    return this.getById(id);
  }

  async complete(id: number, outcome: string, ctx: PerfActionContext): Promise<InterviewRoundResponse> {
    const row = await this.repo.findRoundById(id);
    if (!row) throw new Error('Interview round not found');
    if (!['SCHEDULED', 'RESCHEDULED'].includes(row.status)) {
      throw new Error(`Only scheduled rounds can be completed (current: ${row.status})`);
    }
    if (!OUTCOMES.includes(outcome)) throw new Error(`outcome must be one of ${OUTCOMES.join(', ')}`);
    await this.repo.updateRound(id, ["status = 'COMPLETED'", 'outcome = ?'], [outcome]);
    await this.audit.record('INTERVIEW_ROUND', id, 'COMPLETED', ctx, null, { outcome });
    return this.getById(id);
  }

  async noShow(id: number, ctx: PerfActionContext): Promise<InterviewRoundResponse> {
    const row = await this.repo.findRoundById(id);
    if (!row) throw new Error('Interview round not found');
    if (!['SCHEDULED', 'RESCHEDULED'].includes(row.status)) {
      throw new Error(`Only scheduled rounds can be marked no-show (current: ${row.status})`);
    }
    await this.repo.updateRound(id, ["status = 'NO_SHOW'"], []);
    await this.audit.record('INTERVIEW_ROUND', id, 'NO_SHOW', ctx, null, null);
    return this.getById(id);
  }

  /**
   * A standards-compliant iCalendar file for one round - the honest calendar
   * story for this deployment: importable everywhere, no external API.
   */
  async icsFile(id: number): Promise<{ fileName: string; content: string }> {
    const row = await this.repo.findRoundById(id);
    if (!row) throw new Error('Interview round not found');
    const start = new Date(row.scheduled_at);
    const end = new Date(start.getTime() + row.duration_minutes * 60000);
    const panel = parseJson(row.panel_json) as { name: string }[] | null;
    const summary = `${String(row.round_type).replace(/_/g, ' ')} interview - ${row.applicant_name}`;
    const descriptionParts = [
      `Application: ${row.job_title}`,
      panel?.length ? `Panel: ${panel.map((p) => p.name).join(', ')}` : null,
    ].filter(Boolean) as string[];

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Harene Diamond ERP//Internal Hiring//EN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:interview-${row.id}@harene-erp`,
      `DTSTAMP:${icsUtc(new Date())}`,
      `DTSTART:${icsUtc(start)}`,
      `DTEND:${icsUtc(end)}`,
      `SUMMARY:${escapeIcs(summary)}`,
      row.location ? `LOCATION:${escapeIcs(row.location)}` : null,
      row.meeting_link ? `URL:${escapeIcs(row.meeting_link)}` : null,
      `DESCRIPTION:${escapeIcs(descriptionParts.join('\n'))}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].filter(Boolean) as string[];

    return { fileName: `interview-${row.id}.ics`, content: lines.join('\r\n') + '\r\n' };
  }

  async submitFeedback(roundId: number, body: any, ctx: PerfActionContext & { employeeId?: number; isStaff: boolean }): Promise<InterviewFeedbackResponse[]> {
    const row = await this.repo.findRoundById(roundId);
    if (!row) throw new Error('Interview round not found');

    // Staff may always submit; otherwise the caller must be on the panel.
    if (!ctx.isStaff) {
      const panel = (parseJson(row.panel_json) as { employeeId?: number }[] | null) ?? [];
      const onPanel = ctx.employeeId && panel.some((p) => p.employeeId === ctx.employeeId);
      if (!onPanel) throw new Error('Only panel members or staff can submit feedback for this round');
    }

    let scorecardJson: string | null = null;
    let derivedOverall: number | null = null;
    if (body?.scorecard !== undefined && body.scorecard !== null) {
      if (!Array.isArray(body.scorecard) || body.scorecard.length === 0) {
        throw new Error('scorecard must be a non-empty array of {criterion, score, comment?}');
      }
      for (const item of body.scorecard) {
        if (!item?.criterion || !Number.isFinite(Number(item.score))) {
          throw new Error('Every scorecard row needs a criterion and a numeric score');
        }
      }
      scorecardJson = JSON.stringify(body.scorecard);
      const sum = body.scorecard.reduce((acc: number, i: any) => acc + Number(i.score), 0);
      derivedOverall = Math.round((sum / body.scorecard.length) * 100) / 100;
    }
    const overallScore = body?.overallScore !== undefined && body.overallScore !== null
      ? Number(body.overallScore)
      : derivedOverall;
    const recommendation = body?.recommendation ?? null;
    if (recommendation !== null && !RECOMMENDATIONS.includes(recommendation)) {
      throw new Error(`recommendation must be one of ${RECOMMENDATIONS.join(', ')}`);
    }

    // One row per interviewer: check-then-insert (interviewer_user_id can be
    // null in the schema, so no unique key protects this).
    const existing = await this.repo.findFeedbackByRoundAndUser(roundId, ctx.userId);
    if (existing) {
      await this.repo.updateFeedback(existing.id, {
        scorecardJson, overallScore, recommendation, comments: body?.comments ?? null,
      });
      await this.audit.record('INTERVIEW_FEEDBACK', existing.id, 'UPDATED', ctx, null, { roundId, overallScore, recommendation });
    } else {
      const id = await this.repo.insertFeedback({
        roundId,
        interviewerEmployeeId: ctx.employeeId ?? null,
        interviewerUserId: ctx.userId,
        scorecardJson,
        overallScore,
        recommendation,
        comments: body?.comments ?? null,
      });
      await this.audit.record('INTERVIEW_FEEDBACK', id, 'SUBMITTED', ctx, null, { roundId, overallScore, recommendation });
    }
    const rows = await this.repo.findFeedbackByRound(roundId);
    return rows.map(toFeedbackResponse);
  }

  async listFeedback(roundId: number): Promise<InterviewFeedbackResponse[]> {
    const rows = await this.repo.findFeedbackByRound(roundId);
    return rows.map(toFeedbackResponse);
  }

  /** Reminders for rounds starting inside the next 48 hours. */
  async sendReminders(): Promise<{ notified: number; skipped: { roundId: number; reason: string }[] }> {
    const rounds = await this.repo.findRoundsForReminders(48);
    let notified = 0;
    const skipped: { roundId: number; reason: string }[] = [];
    for (const round of rounds) {
      const when = new Date(round.scheduled_at).toLocaleString('en-IN');
      const title = `Interview reminder: ${String(round.round_type).replace(/_/g, ' ')} on ${when}`;
      try {
        const applicantNotified = await this.notifications.notifyEmployee(round.applicant_employee_id, {
          category: 'RECRUITMENT', priority: 'HIGH', title,
          body: `${round.job_title} - round ${round.round_no}`,
          linkPage: 'internaljobs', linkRefId: round.id, email: true,
        });
        let panelNotified = 0;
        const panel = (parseJson(round.panel_json) as { employeeId?: number }[] | null) ?? [];
        for (const member of panel) {
          if (member.employeeId) {
            const ok = await this.notifications.notifyEmployee(member.employeeId, {
              category: 'RECRUITMENT', priority: 'HIGH', title,
              body: `Panel duty: ${round.applicant_name} for ${round.job_title}`,
              linkPage: 'internaljobs', linkRefId: round.id, email: true,
            });
            if (ok) panelNotified++;
          }
        }
        if (!applicantNotified && panelNotified === 0) {
          skipped.push({ roundId: round.id, reason: 'no linked user accounts to notify' });
        } else {
          notified++;
        }
      } catch (err: any) {
        skipped.push({ roundId: round.id, reason: err.message });
      }
    }
    return { notified, skipped };
  }

  private async notifyRound(roundId: number, title: string): Promise<void> {
    try {
      const round = await this.repo.findRoundById(roundId);
      if (!round) return;
      await this.notifications.notifyEmployee(round.applicant_employee_id, {
        category: 'RECRUITMENT',
        priority: 'HIGH',
        title: `${title}: ${String(round.round_type).replace(/_/g, ' ')}`,
        body: `${round.job_title} - ${new Date(round.scheduled_at).toLocaleString('en-IN')}`,
        linkPage: 'internaljobs',
        linkRefId: roundId,
        email: true,
      });
    } catch (err) {
      console.error('interview notification failed:', err);
    }
  }
}
