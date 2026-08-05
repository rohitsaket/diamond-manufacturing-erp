import { FeedbackRepository } from '../repositories/FeedbackRepository';
import { PerfAuditService } from './PerfAuditService';
import { NotificationService } from './NotificationService';
import {
  FeedbackResponse,
  PerfActionContext,
  RecognitionResponse,
  RewardLedgerEntryResponse,
  RewardRedemptionResponse,
} from '../types/performance';
import { NotificationCategory } from '../types/hrms';
import { toDateString, todayString } from '../utils/dateUtils';

const FEEDBACK_TYPES = ['FEEDBACK', 'APPRECIATION', 'COACHING', 'SUGGESTION', 'IMPROVEMENT'];
const VISIBILITIES = ['PRIVATE', 'MANAGER', 'PUBLIC'];
const AWARD_TYPES = ['SPOT', 'ACHIEVEMENT', 'MILESTONE', 'SERVICE', 'TEAM', 'CUSTOM'];
const STAFF_ROLES = ['admin', 'manager', 'operator', 'accountant', 'hr'];

/** Roles that may see through feedback anonymity (same contract as reviews). */
const ANONYMITY_EXEMPT_ROLES = new Set(['admin', 'hr']);

const PERFORMANCE_CATEGORY = 'PERFORMANCE' as NotificationCategory;

const MONETARY_NOTE =
  'monetary award recorded; add the payout in Payroll → Awards so it flows through a payroll run';

export interface FeedbackCaller {
  userId: number;
  role: string;
  employeeId: number | null;
}

/**
 * Continuous feedback, recognition awards and the reward-points economy.
 * Feedback anonymity funnels through one mapper, mirroring the review
 * contract; redemption approval re-checks the balance inside the transaction.
 */
export class FeedbackRecognitionService {
  private repo = new FeedbackRepository();
  private audit = new PerfAuditService();
  private notifications = new NotificationService();

  // ==========================================================================
  // Continuous feedback
  // ==========================================================================

  async listFeedback(
    filters: { employeeId?: number; feedbackType?: string },
    caller: FeedbackCaller,
  ): Promise<FeedbackResponse[]> {
    const isStaff = STAFF_ROLES.includes(caller.role);
    const rows = await this.repo.findFeedback({
      ...filters,
      restrictTo: isStaff ? undefined : { ownEmployeeId: caller.employeeId },
    });
    return rows.map((r) => this.toFeedbackResponse(r, caller.role));
  }

  async createFeedback(body: any, caller: FeedbackCaller, ctx: PerfActionContext): Promise<FeedbackResponse> {
    const toEmployeeId = Math.trunc(Number(body?.toEmployeeId));
    if (!toEmployeeId || !body?.message || !String(body.message).trim()) {
      throw new Error('toEmployeeId and message are required');
    }
    const target = await this.repo.findEmployeeById(toEmployeeId);
    if (!target) throw new Error('Employee not found');

    const feedbackType = body.feedbackType ?? 'FEEDBACK';
    if (!FEEDBACK_TYPES.includes(feedbackType)) throw new Error(`feedbackType must be one of ${FEEDBACK_TYPES.join(', ')}`);
    const visibility = body.visibility ?? 'MANAGER';
    if (!VISIBILITIES.includes(visibility)) throw new Error(`visibility must be one of ${VISIBILITIES.join(', ')}`);

    let relatedGoalId: number | null = null;
    if (body.relatedGoalId) {
      relatedGoalId = Math.trunc(Number(body.relatedGoalId));
      if (!(await this.repo.goalExists(relatedGoalId))) throw new Error('Related goal not found');
    }

    const id = await this.repo.insertFeedback({
      toEmployeeId,
      fromEmployeeId: caller.employeeId ?? null,
      fromUserId: caller.userId,
      feedbackType,
      message: String(body.message).trim(),
      visibility,
      isAnonymous: !!body.isAnonymous,
      relatedGoalId,
    });
    await this.audit.record('FEEDBACK', id, 'CREATE', ctx, null, { toEmployeeId, feedbackType, visibility, isAnonymous: !!body.isAnonymous });

    const row = await this.repo.findFeedbackById(id);
    return this.toFeedbackResponse(row, caller.role);
  }

  /** Soft delete by the author or admin/hr. */
  async deleteFeedback(id: number, caller: FeedbackCaller, ctx: PerfActionContext): Promise<{ deleted: true }> {
    const row = await this.repo.findFeedbackById(id);
    if (!row) throw new Error('Feedback not found');
    const isAuthor = Number(row.from_user_id) === caller.userId;
    const isPrivileged = ANONYMITY_EXEMPT_ROLES.has(caller.role);
    if (!isAuthor && !isPrivileged) throw new Error('Only the author or admin/hr can delete feedback');
    await this.repo.softDeleteFeedback(id);
    await this.audit.record('FEEDBACK', id, 'DELETE', ctx, { toEmployeeId: row.to_employee_id, feedbackType: row.feedback_type }, null);
    return { deleted: true };
  }

  async myFeedback(caller: FeedbackCaller): Promise<FeedbackResponse[]> {
    if (!caller.employeeId) throw new Error('This account is not linked to an employee record');
    const rows = await this.repo.findFeedbackReceived(caller.employeeId);
    return rows.map((r) => this.toFeedbackResponse(r, caller.role));
  }

  // ==========================================================================
  // Recognitions
  // ==========================================================================

  async listRecognitions(filters: { employeeId?: number }): Promise<RecognitionResponse[]> {
    const rows = await this.repo.findRecognitions(filters);
    return rows.map((r) => this.toRecognitionResponse(r));
  }

  async createRecognition(body: any, ctx: PerfActionContext): Promise<{ recognition: RecognitionResponse; note?: string }> {
    const employeeId = Math.trunc(Number(body?.employeeId));
    if (!employeeId || !body?.title) throw new Error('employeeId and title are required');
    const employee = await this.repo.findEmployeeById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const awardType = body.awardType ?? 'SPOT';
    if (!AWARD_TYPES.includes(awardType)) throw new Error(`awardType must be one of ${AWARD_TYPES.join(', ')}`);
    const points = Math.trunc(Number(body.points ?? 0));
    if (!Number.isFinite(points) || points < 0) throw new Error('points must be zero or a positive integer');
    const monetaryAmount = body.monetaryAmount !== undefined && body.monetaryAmount !== null
      ? Number(body.monetaryAmount)
      : null;
    if (monetaryAmount !== null && (!Number.isFinite(monetaryAmount) || monetaryAmount <= 0)) {
      throw new Error('monetaryAmount must be a positive number when given');
    }

    const id = await this.repo.insertRecognitionWithPoints({
      employeeId,
      awardType,
      title: String(body.title),
      citation: body.citation ?? null,
      points,
      monetaryAmount,
      cycleId: body.cycleId ? Math.trunc(Number(body.cycleId)) : null,
      isPublic: body.isPublic === undefined ? true : !!body.isPublic,
      awardedBy: ctx.userId,
      awardedAt: body.awardedAt ?? todayString(),
    });
    await this.audit.record('RECOGNITION', id, 'CREATE', ctx, null, { employeeId, awardType, title: body.title, points, monetaryAmount });

    try {
      await this.notifications.notifyEmployee(employeeId, {
        category: PERFORMANCE_CATEGORY,
        title: `You received a recognition: ${body.title}`,
        body: points > 0 ? `${points} reward points have been credited to your balance.` : (body.citation ?? null),
        linkPage: 'performance',
        linkRefId: id,
        createdBy: ctx.userId,
      });
    } catch (err) {
      console.error('recognition notification failed:', err);
    }

    const recognition = this.toRecognitionResponse(await this.repo.findRecognitionById(id));
    // Monetary awards do NOT auto-create a payroll pay award -- that table
    // belongs to the payroll module and must go through a payroll run.
    return monetaryAmount !== null ? { recognition, note: MONETARY_NOTE } : { recognition };
  }

  async myRecognitions(caller: FeedbackCaller): Promise<RecognitionResponse[]> {
    if (!caller.employeeId) throw new Error('This account is not linked to an employee record');
    return this.listRecognitions({ employeeId: caller.employeeId });
  }

  // ==========================================================================
  // Reward ledger & redemptions
  // ==========================================================================

  async balance(employeeId: number): Promise<{ employeeId: number; balance: number; entries: RewardLedgerEntryResponse[] }> {
    const employee = await this.repo.findEmployeeById(employeeId);
    if (!employee) throw new Error('Employee not found');
    const [balance, entries] = await Promise.all([
      this.repo.ledgerBalance(employeeId),
      this.repo.ledgerEntries(employeeId, 50),
    ]);
    return { employeeId, balance, entries: entries.map((e) => this.toLedgerResponse(e)) };
  }

  /** An employee redeems their own points; staff accounts need an employee link too. */
  async requestRedemption(body: any, caller: FeedbackCaller, ctx: PerfActionContext): Promise<RewardRedemptionResponse> {
    if (!caller.employeeId) throw new Error('This account is not linked to an employee record, so it has no reward balance');
    const points = Math.trunc(Number(body?.points));
    const rewardItem = String(body?.rewardItem ?? '').trim();
    if (!Number.isFinite(points) || points <= 0) throw new Error('points must be a positive integer');
    if (!rewardItem) throw new Error('rewardItem is required');

    const balance = await this.repo.ledgerBalance(caller.employeeId);
    if (points > balance) {
      throw new Error(`Insufficient reward balance: you have ${balance} points, the redemption needs ${points}`);
    }

    const id = await this.repo.insertRedemption(caller.employeeId, points, rewardItem);
    await this.audit.record('REWARD_REDEMPTION', id, 'REQUEST', ctx, null, { employeeId: caller.employeeId, points, rewardItem });
    const row = await this.repo.findRedemptionById(id);
    return this.toRedemptionResponse(row);
  }

  async listRedemptions(filters: { status?: string; employeeId?: number }): Promise<RewardRedemptionResponse[]> {
    const rows = await this.repo.findRedemptions(filters);
    return rows.map((r) => this.toRedemptionResponse(r));
  }

  /** Approve (writes the negative ledger row, balance re-checked in-transaction) or reject. */
  async decideRedemption(id: number, approve: boolean, note: string | null, ctx: PerfActionContext): Promise<RewardRedemptionResponse & { balanceAfter?: number | null }> {
    const before = await this.repo.findRedemptionById(id);
    if (!before) throw new Error('Redemption not found');

    const result = await this.repo.decideRedemption(id, approve, note, ctx.userId);
    await this.audit.record('REWARD_REDEMPTION', id, approve ? 'APPROVE' : 'REJECT', ctx, { status: before.status }, { status: result.status, note });

    const row = await this.repo.findRedemptionById(id);
    return { ...this.toRedemptionResponse(row), balanceAfter: result.balanceAfter };
  }

  async fulfillRedemption(id: number, ctx: PerfActionContext): Promise<RewardRedemptionResponse> {
    const before = await this.repo.findRedemptionById(id);
    if (!before) throw new Error('Redemption not found');
    if (before.status !== 'APPROVED') throw new Error(`Only APPROVED redemptions can be fulfilled (current: ${before.status})`);
    await this.repo.fulfillRedemption(id);
    await this.audit.record('REWARD_REDEMPTION', id, 'FULFILL', ctx, { status: before.status }, { status: 'FULFILLED' });
    return this.toRedemptionResponse(await this.repo.findRedemptionById(id));
  }

  async myRewards(caller: FeedbackCaller): Promise<{
    employeeId: number;
    balance: number;
    entries: RewardLedgerEntryResponse[];
    redemptions: RewardRedemptionResponse[];
  }> {
    if (!caller.employeeId) throw new Error('This account is not linked to an employee record');
    const [summary, redemptions] = await Promise.all([
      this.balance(caller.employeeId),
      this.listRedemptions({ employeeId: caller.employeeId }),
    ]);
    return { ...summary, redemptions };
  }

  // ==========================================================================
  // Mappers
  // ==========================================================================

  /** Anonymity choke point for feedback -- mirrors the review contract. */
  private toFeedbackResponse(r: any, callerRole: string): FeedbackResponse {
    const hideAuthor = !!r.is_anonymous && !ANONYMITY_EXEMPT_ROLES.has(callerRole);
    return {
      id: Number(r.id),
      toEmployeeId: Number(r.to_employee_id),
      toEmployeeName: r.to_employee_name ?? null,
      fromEmployeeId: hideAuthor ? null : (r.from_employee_id === null ? null : Number(r.from_employee_id)),
      fromUserId: hideAuthor ? null : (r.from_user_id === null ? null : Number(r.from_user_id)),
      fromName: hideAuthor ? null : (r.from_name ?? null),
      feedbackType: r.feedback_type,
      message: String(r.message),
      visibility: r.visibility,
      isAnonymous: !!r.is_anonymous,
      relatedGoalId: r.related_goal_id === null ? null : Number(r.related_goal_id),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    };
  }

  private toRecognitionResponse(r: any): RecognitionResponse {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      awardType: r.award_type,
      title: String(r.title),
      citation: r.citation ?? null,
      points: Number(r.points ?? 0),
      monetaryAmount: r.monetary_amount === null ? null : Number(r.monetary_amount),
      payAwardId: r.pay_award_id === null ? null : Number(r.pay_award_id),
      cycleId: r.cycle_id === null ? null : Number(r.cycle_id),
      isPublic: !!r.is_public,
      awardedBy: r.awarded_by === null ? null : Number(r.awarded_by),
      awardedByName: r.awarded_by_name ?? null,
      awardedAt: r.awarded_at ? toDateString(r.awarded_at) : null,
    };
  }

  private toLedgerResponse(r: any): RewardLedgerEntryResponse {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      entryType: r.entry_type,
      points: Number(r.points),
      recognitionId: r.recognition_id === null ? null : Number(r.recognition_id),
      redemptionId: r.redemption_id === null ? null : Number(r.redemption_id),
      reference: r.reference ?? null,
      note: r.note ?? null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    };
  }

  private toRedemptionResponse(r: any): RewardRedemptionResponse {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      points: Number(r.points),
      rewardItem: String(r.reward_item),
      status: r.status,
      note: r.note ?? null,
      requestedAt: r.requested_at ? new Date(r.requested_at).toISOString() : '',
      decidedBy: r.decided_by === null ? null : Number(r.decided_by),
      decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
    };
  }
}
