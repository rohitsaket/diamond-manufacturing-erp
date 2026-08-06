import { ReferralRepository } from '../repositories/ReferralRepository';
import { FeedbackRecognitionService } from './FeedbackRecognitionService';
import { RecruitmentAuditService } from './RecruitmentAuditService';
import { NotificationService } from './NotificationService';
import { PerfActionContext } from '../types/performance';
import { ReferralResponse } from '../types/internalRecruitment';

/** Default reward for a referral that ends in a hire, in reward points. */
export const DEFAULT_REFERRAL_REWARD_POINTS = 500;

const ACCEPT_NOTE =
  'The referred employee has been notified and invited to apply. No application was created on their behalf - applying is their choice.';

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function toReferralResponse(r: any): ReferralResponse {
  return {
    id: Number(r.id),
    jobId: r.job_id === null ? null : Number(r.job_id),
    jobTitle: r.job_title ?? null,
    referrerEmployeeId: Number(r.referrer_employee_id),
    referrerName: r.referrer_name ?? null,
    referredEmployeeId: r.referred_employee_id === null ? null : Number(r.referred_employee_id),
    referredName: r.referred_name ?? null,
    externalName: r.external_name ?? null,
    externalPhone: r.external_phone ?? null,
    externalEmail: r.external_email ?? null,
    note: r.note ?? null,
    status: r.status,
    applicationId: r.application_id === null ? null : Number(r.application_id),
    candidateId: r.candidate_id === null ? null : Number(r.candidate_id),
    rewardPoints: Number(r.reward_points ?? 0),
    rewardRecognitionId: r.reward_recognition_id === null ? null : Number(r.reward_recognition_id),
    approvedBy: r.approved_by === null ? null : Number(r.approved_by),
    approvedAt: isoOrNull(r.approved_at),
    createdAt: isoOrNull(r.created_at) ?? '',
  };
}

export interface ReferralCaller {
  userId: number;
  role: string;
  employeeId: number | null;
}

/**
 * Referrals: internal (a colleague) or external (a name + phone). Accepted
 * internal referrals invite the colleague to apply - never apply for them.
 * Accepted external referrals become rows in the existing candidates
 * pipeline. A hire pays the referrer reward points through the performance
 * module's recognition path, so the reward_ledger EARNED entry rides the
 * proven transaction.
 */
export class ReferralService {
  private repo = new ReferralRepository();
  private recognition = new FeedbackRecognitionService();
  private audit = new RecruitmentAuditService();
  private notifications = new NotificationService();

  async create(body: any, caller: ReferralCaller, ctx: PerfActionContext): Promise<ReferralResponse> {
    if (!caller.employeeId) {
      throw new Error('This account is not linked to an employee record, so it cannot make referrals');
    }
    const referrerEmployeeId = caller.employeeId;

    const hasInternal = !!body?.referredEmployeeId;
    const hasExternal = !!(body?.externalName || body?.externalPhone || body?.externalEmail);
    if (hasInternal === hasExternal) {
      throw new Error('Provide exactly one of: referredEmployeeId (internal) OR externalName + externalPhone (external)');
    }

    let jobId: number | null = null;
    if (body?.jobId) {
      jobId = Math.trunc(Number(body.jobId));
      const job = await this.repo.findJobById(jobId);
      if (!job) throw new Error('Job not found');
    }

    const fields: Record<string, any> = {
      job_id: jobId,
      referrer_employee_id: referrerEmployeeId,
      note: body?.note ? String(body.note).slice(0, 1000) : null,
      status: 'SUBMITTED',
    };

    if (hasInternal) {
      const referredEmployeeId = Math.trunc(Number(body.referredEmployeeId));
      if (referredEmployeeId === referrerEmployeeId) {
        throw new Error('You cannot refer yourself');
      }
      const referred = await this.repo.findEmployeeById(referredEmployeeId);
      if (!referred) throw new Error('Referred employee not found');
      // No usable unique key exists (nullable columns), so check-then-insert.
      if (await this.repo.duplicateInternalExists(jobId, referredEmployeeId)) {
        throw new Error('An active referral for this employee and job already exists');
      }
      fields.referred_employee_id = referredEmployeeId;
    } else {
      const name = String(body.externalName ?? '').trim();
      const phone = String(body.externalPhone ?? '').trim();
      if (!name || !phone) throw new Error('externalName and externalPhone are required for an external referral');
      fields.external_name = name.slice(0, 160);
      fields.external_phone = phone.slice(0, 20);
      fields.external_email = body.externalEmail ? String(body.externalEmail).trim().slice(0, 255) : null;
    }

    const id = await this.repo.insert(fields);
    await this.audit.record('REFERRAL', id, 'CREATE', ctx, null, {
      jobId,
      referredEmployeeId: fields.referred_employee_id ?? null,
      externalName: fields.external_name ?? null,
    });
    return toReferralResponse(await this.repo.findById(id));
  }

  async myReferrals(caller: ReferralCaller): Promise<ReferralResponse[]> {
    if (!caller.employeeId) {
      throw new Error('This account is not linked to an employee record, so it has no referrals');
    }
    const rows = await this.repo.findMine(caller.employeeId);
    return rows.map((r) => toReferralResponse(r));
  }

  async list(filters: { status?: string }): Promise<ReferralResponse[]> {
    const rows = await this.repo.findAll(filters);
    return rows.map((r) => toReferralResponse(r));
  }

  /**
   * admin/hr review. Accepting an internal referral notifies the referred
   * employee and stops there - applying stays their choice. Accepting an
   * external one creates the candidates-pipeline row. rewardPoints may
   * override the 500-point default paid if the referral later ends in a hire.
   */
  async review(
    id: number,
    body: any,
    ctx: PerfActionContext,
  ): Promise<{ referral: ReferralResponse; note?: string }> {
    const action = String(body?.action ?? '');
    if (!['accept', 'reject'].includes(action)) throw new Error("action must be 'accept' or 'reject'");
    const note = body?.note ? String(body.note).slice(0, 1000) : null;

    const row = await this.repo.findById(id);
    if (!row) throw new Error('Referral not found');
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(row.status)) {
      throw new Error(`Only SUBMITTED or UNDER_REVIEW referrals can be reviewed (current: ${row.status})`);
    }

    if (action === 'reject') {
      await this.repo.update(id, { status: 'REJECTED', approved_by: ctx.userId, approved_at: new Date() });
      await this.audit.record('REFERRAL', id, 'REJECT', ctx, { status: row.status }, { status: 'REJECTED', note });
      return { referral: toReferralResponse(await this.repo.findById(id)) };
    }

    let rewardPoints = DEFAULT_REFERRAL_REWARD_POINTS;
    if (body?.rewardPoints !== undefined && body.rewardPoints !== null) {
      rewardPoints = Math.trunc(Number(body.rewardPoints));
      if (!Number.isFinite(rewardPoints) || rewardPoints < 0) {
        throw new Error('rewardPoints must be zero or a positive integer');
      }
    }

    const fields: Record<string, any> = {
      status: 'ACCEPTED',
      approved_by: ctx.userId,
      approved_at: new Date(),
      reward_points: rewardPoints,
    };

    let responseNote: string | undefined;

    if (row.referred_employee_id) {
      // Internal: invite, never auto-apply.
      responseNote = ACCEPT_NOTE;
    } else {
      // External: create the candidates-pipeline row and link it.
      const job = row.job_id ? await this.repo.findJobById(Number(row.job_id)) : null;
      const candidateId = await this.repo.insertCandidate({
        full_name: row.external_name,
        phone: row.external_phone,
        email: row.external_email ?? null,
        opening_id: null,
        position_grade: job?.grade ?? 'TBD',
        source: `Internal referral: ${row.referrer_name ?? `employee #${row.referrer_employee_id}`}`,
        status: 'APPLIED',
        notes: row.note ?? null,
        created_by: ctx.userId,
      });
      fields.candidate_id = candidateId;
      responseNote = `External candidate added to the recruitment pipeline (candidate #${candidateId}).`;
    }

    await this.repo.update(id, fields);
    await this.audit.record('REFERRAL', id, 'ACCEPT', ctx, { status: row.status }, {
      status: 'ACCEPTED',
      rewardPoints,
      candidateId: fields.candidate_id ?? null,
      note,
    });

    if (row.referred_employee_id) {
      try {
        await this.notifications.notifyEmployee(Number(row.referred_employee_id), {
          category: 'RECRUITMENT',
          title: row.job_title
            ? `You have been referred for: ${row.job_title}`
            : 'A colleague has referred you for an internal opportunity',
          body: 'A colleague vouched for you. If the role interests you, apply through the internal job portal - the choice is entirely yours.',
          linkPage: 'internal-jobs',
          linkRefId: row.job_id ? Number(row.job_id) : null,
          createdBy: ctx.userId,
        });
      } catch (err) {
        console.error('referral invite notification failed:', err);
      }
    }

    return { referral: toReferralResponse(await this.repo.findById(id)), note: responseNote };
  }

  /**
   * Links a fresh application to the matching referral (job + referred
   * employee, active status). Called from the apply/submit flow.
   */
  async linkApplication(jobId: number, employeeId: number, applicationId: number): Promise<boolean> {
    const referral = await this.repo.findLinkable(jobId, employeeId);
    if (!referral) return false;
    await this.repo.update(Number(referral.id), { application_id: applicationId });
    return true;
  }

  /** Settles the referral for a hired application, if one is linked. */
  async onApplicationHired(applicationId: number, ctx: PerfActionContext): Promise<ReferralResponse | null> {
    const referral = await this.repo.findByApplicationId(applicationId);
    if (!referral) return null;
    return this.markHired(Number(referral.id), ctx);
  }

  /**
   * Marks the referral HIRED and pays the reward through
   * FeedbackRecognitionService.createRecognition, so the reward_ledger EARNED
   * row is written by the proven recognition transaction. Idempotent: a
   * referral already HIRED or already holding a recognition is not paid twice.
   */
  async markHired(referralId: number, ctx: PerfActionContext, overridePoints?: number): Promise<ReferralResponse> {
    const row = await this.repo.findById(referralId);
    if (!row) throw new Error('Referral not found');
    if (row.status === 'HIRED' || row.reward_recognition_id) {
      return toReferralResponse(row); // already settled - never double-award
    }
    if (['REJECTED', 'WITHDRAWN'].includes(row.status)) {
      throw new Error(`A ${row.status} referral cannot be marked hired`);
    }

    const points =
      overridePoints !== undefined && overridePoints !== null
        ? Math.max(0, Math.trunc(Number(overridePoints)))
        : Number(row.reward_points) > 0
          ? Number(row.reward_points)
          : DEFAULT_REFERRAL_REWARD_POINTS;

    let recognitionId: number | null = null;
    if (points > 0) {
      const who = row.referred_name ?? row.external_name ?? 'a candidate';
      const { recognition } = await this.recognition.createRecognition(
        {
          employeeId: Number(row.referrer_employee_id),
          awardType: 'CUSTOM',
          title: 'Referral hire reward',
          citation: `Referral of ${who}${row.job_title ? ` for ${row.job_title}` : ''} ended in a hire.`,
          points,
          isPublic: true,
        },
        ctx,
      );
      recognitionId = recognition.id;
    }

    await this.repo.update(referralId, {
      status: 'HIRED',
      reward_points: points,
      reward_recognition_id: recognitionId,
    });
    await this.audit.record('REFERRAL', referralId, 'HIRED', ctx, { status: row.status }, {
      status: 'HIRED',
      rewardPoints: points,
      rewardRecognitionId: recognitionId,
    });

    return toReferralResponse(await this.repo.findById(referralId));
  }

  /** Ranked per-referrer totals for the leaderboard. */
  async leaderboard(): Promise<any[]> {
    const rows = await this.repo.leaderboard();
    return rows.map((r, i) => ({
      rank: i + 1,
      referrerEmployeeId: Number(r.referrer_employee_id),
      referrerName: r.referrer_name ?? null,
      empCode: r.emp_code ?? null,
      total: Number(r.total ?? 0),
      hired: Number(r.hired ?? 0),
      totalPoints: Number(r.total_points ?? 0),
    }));
  }
}
