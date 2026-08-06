import { OfferRepository } from '../repositories/OfferRepository';
import { RecruitmentAuditService } from './RecruitmentAuditService';
import { NotificationService } from './NotificationService';
import { FeedbackRecognitionService } from './FeedbackRecognitionService';
import { PerfActionContext } from '../types/performance';
import { OfferResponse } from '../types/internalRecruitment';

const OFFER_TYPES = ['INTERNAL_TRANSFER', 'PROMOTION', 'SALARY_REVISION', 'GIG_ASSIGNMENT'];
/** Application statuses from which an offer may be created. */
const OFFERABLE = ['INTERVIEW', 'SELECTED'];
const DEFAULT_REFERRAL_REWARD_POINTS = 500;

const ACCEPTANCE_NOTE =
  'Acceptance is recorded with the authenticated user, timestamp and IP address - '
  + 'an audit-backed acknowledgement, not a cryptographic digital signature.';
const SALARY_NOTE =
  'Salary revision figures are recorded as a recommendation; the actual revision is applied in Payroll -> Compensation.';

export function toOfferResponse(row: any): OfferResponse {
  return {
    id: row.id,
    offerCode: row.offer_code,
    applicationId: row.application_id,
    jobTitle: row.job_title ?? null,
    employeeId: row.employee_id,
    employeeName: row.employee_name ?? null,
    offerType: row.offer_type,
    title: row.title,
    toDepartmentId: row.to_department_id,
    toDepartmentName: row.to_department_name ?? null,
    toTeamId: row.to_team_id,
    toRoleId: row.to_role_id,
    toRoleName: row.to_role_name ?? null,
    toPositionId: row.to_position_id,
    toGrade: row.to_grade,
    salaryRevisionPct: row.salary_revision_pct === null ? null : Number(row.salary_revision_pct),
    salaryRevisionAmount: row.salary_revision_amount === null ? null : Number(row.salary_revision_amount),
    effectiveDate: row.effective_date,
    validUntil: row.valid_until,
    terms: row.terms,
    letterNumber: row.letter_number,
    letterGeneratedAt: row.letter_generated_at,
    status: row.status,
    releasedAt: row.released_at,
    respondedAt: row.responded_at,
    responseNote: row.response_note,
    effectedAt: row.effected_at,
    createdAt: row.created_at,
  };
}

export class OfferService {
  private repo = new OfferRepository();
  private audit = new RecruitmentAuditService();
  private notifications = new NotificationService();

  async create(body: any, ctx: PerfActionContext): Promise<OfferResponse> {
    const applicationId = Math.trunc(Number(body?.applicationId));
    if (!applicationId || !body?.title) throw new Error('applicationId and title are required');
    const offerType = body.offerType ?? 'INTERNAL_TRANSFER';
    if (!OFFER_TYPES.includes(offerType)) throw new Error(`offerType must be one of ${OFFER_TYPES.join(', ')}`);
    const application = await this.repo.findApplication(applicationId);
    if (!application) throw new Error('Application not found');
    if (!OFFERABLE.includes(application.status)) {
      throw new Error(`Offers can be created only for applications in ${OFFERABLE.join('/')} (current: ${application.status})`);
    }
    if (offerType === 'INTERNAL_TRANSFER' && !body.toDepartmentId) {
      throw new Error('An internal transfer offer needs toDepartmentId');
    }
    if (offerType === 'PROMOTION') {
      if (!body.toGrade) throw new Error('A promotion offer needs toGrade');
      if (String(body.toGrade) === String(application.employee_grade)) {
        throw new Error(`The employee is already grade ${application.employee_grade}`);
      }
    }
    const year = new Date().getFullYear();
    const seq = await this.repo.nextSequence(year);
    const offerCode = `OFR-${year}-${String(seq).padStart(3, '0')}`;
    const id = await this.repo.insert({ ...body, applicationId, offerType }, offerCode, ctx.userId);
    await this.audit.record('OFFER', id, 'CREATED', ctx, null, { offerCode, applicationId, offerType });
    return this.getById(id);
  }

  async list(filters: { status?: string; applicationId?: number }): Promise<OfferResponse[]> {
    const rows = await this.repo.findMany(filters);
    const resolved = await Promise.all(rows.map((r) => this.resolveExpiry(r)));
    return resolved.map(toOfferResponse);
  }

  async getById(id: number): Promise<OfferResponse> {
    let row = await this.repo.findById(id);
    if (!row) throw new Error('Offer not found');
    row = await this.resolveExpiry(row);
    return toOfferResponse(row);
  }

  /** Raw row for internal use (letters, ownership checks). */
  async getRow(id: number): Promise<any> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error('Offer not found');
    return this.resolveExpiry(row);
  }

  async submit(id: number, ctx: PerfActionContext): Promise<OfferResponse> {
    await this.transition(id, ['DRAFT'], 'PENDING_APPROVAL', ctx, 'SUBMITTED');
    return this.getById(id);
  }

  async approve(id: number, ctx: PerfActionContext): Promise<OfferResponse> {
    const row = await this.getRow(id);
    if (row.status !== 'PENDING_APPROVAL') throw new Error(`Only pending offers can be approved (current: ${row.status})`);
    await this.repo.update(id, ["status = 'APPROVED'", 'approved_by = ?', 'approved_at = NOW()'], [ctx.userId]);
    await this.audit.record('OFFER', id, 'APPROVED', ctx, { status: row.status }, { status: 'APPROVED' });
    return this.getById(id);
  }

  async rejectApproval(id: number, reason: string, ctx: PerfActionContext): Promise<OfferResponse> {
    if (!reason) throw new Error('A rejection reason is required');
    await this.transition(id, ['PENDING_APPROVAL'], 'DRAFT', ctx, 'APPROVAL_REJECTED', { reason });
    return this.getById(id);
  }

  async release(id: number, ctx: PerfActionContext): Promise<{ offer: OfferResponse; note: string }> {
    const row = await this.getRow(id);
    if (row.status !== 'APPROVED') throw new Error(`Only approved offers can be released (current: ${row.status})`);
    await this.repo.release(id, row.application_id, row.application_status, ctx.userId);
    await this.audit.record('OFFER', id, 'RELEASED', ctx, null, { applicationId: row.application_id });
    try {
      await this.notifications.notifyEmployee(row.employee_id, {
        category: 'RECRUITMENT',
        priority: 'URGENT',
        title: `Offer released: ${row.title}`,
        body: `Offer ${row.offer_code} for ${row.job_title}. Review and respond from the internal jobs portal.`,
        linkPage: 'internaljobs',
        linkRefId: id,
        email: true,
      });
    } catch (err) {
      console.error('offer notification failed:', err);
    }
    return { offer: await this.getById(id), note: ACCEPTANCE_NOTE };
  }

  async withdraw(id: number, ctx: PerfActionContext): Promise<OfferResponse> {
    await this.transition(id, ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RELEASED'], 'WITHDRAWN', ctx, 'WITHDRAWN');
    return this.getById(id);
  }

  async myOffers(employeeId: number): Promise<OfferResponse[]> {
    const rows = await this.repo.findMany({ employeeId });
    const resolved = await Promise.all(rows.map((r) => this.resolveExpiry(r)));
    // ESS sees offers only once released.
    return resolved
      .filter((r) => ['RELEASED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'EFFECTED'].includes(r.status))
      .map(toOfferResponse);
  }

  async accept(id: number, caller: { userId: number; employeeId?: number; role: string; ip?: string | null }, ctx: PerfActionContext): Promise<{ offer: OfferResponse; note: string }> {
    const row = await this.getRow(id);
    if (row.employee_id !== caller.employeeId) throw new Error('Only the employee this offer belongs to can accept it');
    if (row.status !== 'RELEASED') throw new Error(`Only released offers can be accepted (current: ${row.status})`);
    await this.repo.update(
      id,
      ["status = 'ACCEPTED'", 'responded_at = NOW()', 'accepted_by_user_id = ?', 'acceptance_ip = ?'],
      [caller.userId, caller.ip ?? null],
    );
    await this.audit.record('OFFER', id, 'ACCEPTED', ctx, null, { acceptanceIp: caller.ip ?? null });
    return { offer: await this.getById(id), note: ACCEPTANCE_NOTE };
  }

  async decline(id: number, note: string | undefined, caller: { userId: number; employeeId?: number }, ctx: PerfActionContext): Promise<OfferResponse> {
    const row = await this.getRow(id);
    if (row.employee_id !== caller.employeeId) throw new Error('Only the employee this offer belongs to can decline it');
    if (row.status !== 'RELEASED') throw new Error(`Only released offers can be declined (current: ${row.status})`);
    await this.repo.update(id, ["status = 'DECLINED'", 'responded_at = NOW()', 'response_note = ?'], [note ?? null]);
    await this.audit.record('OFFER', id, 'DECLINED', ctx, null, { note: note ?? null });
    return this.getById(id);
  }

  /**
   * Effects an accepted offer: employee change + timeline + statuses + job
   * fill check in one transaction, then the referral reward outside it.
   */
  async effect(id: number, ctx: PerfActionContext): Promise<{
    offer: OfferResponse;
    jobFilled: boolean;
    referralRewarded: boolean;
    note?: string;
  }> {
    const row = await this.getRow(id);
    if (row.status !== 'ACCEPTED') throw new Error(`Only accepted offers can be effected (current: ${row.status})`);

    const { jobFilled } = await this.repo.effect(row, ctx.userId);
    await this.audit.record('OFFER', id, 'EFFECTED', ctx,
      { grade: row.employee_grade, departmentId: row.employee_department_id },
      { offerType: row.offer_type, toGrade: row.to_grade, toDepartmentId: row.to_department_id, jobFilled });

    // Referral reward: linked referral goes to HIRED with points through the
    // performance module's proven recognition + ledger path.
    let referralRewarded = false;
    try {
      const referral = await this.repo.findReferralByApplication(row.application_id);
      if (referral && referral.status !== 'HIRED' && referral.referrer_employee_id) {
        const points = Number(referral.reward_points) > 0 ? Number(referral.reward_points) : DEFAULT_REFERRAL_REWARD_POINTS;
        const recognitionService = new FeedbackRecognitionService();
        const { recognition } = await recognitionService.createRecognition(
          {
            employeeId: referral.referrer_employee_id,
            awardType: 'ACHIEVEMENT',
            title: `Referral reward - ${row.job_title}`,
            citation: `Referral hired through offer ${row.offer_code}.`,
            points,
            isPublic: true,
          },
          ctx,
        );
        await this.repo.markReferralHired(referral.id, points, recognition.id);
        referralRewarded = true;
        await this.notifications.notifyEmployee(referral.referrer_employee_id, {
          category: 'RECRUITMENT',
          priority: 'NORMAL',
          title: `Referral reward: ${points} points`,
          body: `Your referral for ${row.job_title} was hired.`,
          linkPage: 'internaljobs',
          email: true,
        }).catch(() => undefined);
      }
    } catch (err) {
      console.error('referral reward failed (offer still effected):', err);
    }

    try {
      await this.notifications.notifyEmployee(row.employee_id, {
        category: 'RECRUITMENT',
        priority: 'HIGH',
        title: `Position confirmed: ${row.title}`,
        body: `Offer ${row.offer_code} is now effective.`,
        linkPage: 'internaljobs',
        linkRefId: id,
        email: true,
      });
    } catch (err) {
      console.error('offer effect notification failed:', err);
    }

    return {
      offer: await this.getById(id),
      jobFilled,
      referralRewarded,
      note: row.offer_type === 'SALARY_REVISION' ? SALARY_NOTE : undefined,
    };
  }

  async setLetter(id: number, ctx: PerfActionContext): Promise<OfferResponse> {
    const row = await this.getRow(id);
    if (!['APPROVED', 'RELEASED', 'ACCEPTED', 'EFFECTED'].includes(row.status)) {
      throw new Error(`Letters are issued for approved offers onwards (current: ${row.status})`);
    }
    if (!row.letter_number) {
      const letterNumber = `OFR/${new Date().getFullYear()}/${String(id).padStart(5, '0')}`;
      await this.repo.update(id, ['letter_number = ?', 'letter_generated_at = NOW()'], [letterNumber]);
      await this.audit.record('OFFER', id, 'LETTER_ISSUED', ctx, null, { letterNumber });
    }
    return this.getById(id);
  }

  /** RELEASED offers past their valid_until date resolve to EXPIRED lazily. */
  private async resolveExpiry(row: any): Promise<any> {
    if (row.status === 'RELEASED' && row.valid_until) {
      const validUntil = new Date(row.valid_until);
      const endOfDay = new Date(validUntil.getFullYear(), validUntil.getMonth(), validUntil.getDate(), 23, 59, 59);
      if (endOfDay.getTime() < Date.now()) {
        await this.repo.update(row.id, ["status = 'EXPIRED'"], []);
        return { ...row, status: 'EXPIRED' };
      }
    }
    return row;
  }

  private async transition(
    id: number,
    fromStatuses: string[],
    to: string,
    ctx: PerfActionContext,
    action: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const row = await this.getRow(id);
    if (!fromStatuses.includes(row.status)) {
      throw new Error(`Cannot move offer from ${row.status} to ${to}`);
    }
    await this.repo.update(id, ['status = ?'], [to]);
    await this.audit.record('OFFER', id, action, ctx, { status: row.status }, { status: to, ...extra });
  }
}
