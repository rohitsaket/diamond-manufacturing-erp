import {
  ApprovalRepository,
  ApprovalRequestResponse,
  ApprovalStepResponse,
} from '../repositories/ApprovalRepository';
import { NotificationService } from './NotificationService';

export interface SubmitApprovalInput {
  title: string;
  amount?: number | null;
  currency?: string;
  requestedBy: number;
  /** Deep link the notification should open, e.g. `payroll-runs`. */
  linkPage?: string;
}

export interface ApprovalDecision {
  action: 'APPROVE' | 'REJECT';
  comments?: string | null;
}

/**
 * Multi-level approval engine shared by every payroll entity.
 *
 * Two guarantees the payroll team relies on:
 *  - the acting user's application role must appear on the CURRENT step, so a
 *    later approver cannot skip ahead of an earlier one;
 *  - the same person cannot approve two consecutive steps (except 'admin', who
 *    is the deliberate break-glass), because two signatures from one pair of
 *    hands is not a control.
 */
export class PayrollApprovalService {
  private repo = new ApprovalRepository();
  private notifications = new NotificationService();

  /**
   * Raises an approval request for an entity and parks it on step 1.
   *
   * Returns the request with its full step ladder so the caller can show the
   * approver chain immediately.
   */
  async submit(
    entityType: string,
    entityId: number,
    input: SubmitApprovalInput,
  ): Promise<ApprovalRequestResponse> {
    if (!input.title) throw new Error('An approval title is required');

    const amount = input.amount === undefined || input.amount === null ? null : Number(input.amount);

    const existing = await this.repo.findByEntity(entityType, entityId);
    if (existing.some((r) => r.status === 'PENDING')) {
      throw new Error('An approval request for this record is already pending');
    }

    const workflow = await this.repo.findWorkflowFor(entityType, amount);
    if (!workflow) throw new Error(`No active approval workflow is configured for ${entityType}`);

    const steps = await this.repo.listSteps(workflow.id);
    if (steps.length === 0) throw new Error(`Workflow ${workflow.code} has no approval steps configured`);

    const firstStep = this.nextApplicableStep(steps, 0, amount);
    if (!firstStep) throw new Error(`Workflow ${workflow.code} has no step that applies to this amount`);

    const requestId = await this.repo.createRequest({
      workflowId: workflow.id,
      entityType,
      entityId,
      title: input.title,
      amount,
      currency: input.currency ?? 'INR',
      requestedBy: input.requestedBy,
    });

    if (firstStep.stepOrder !== 1) {
      await this.repo.setCurrentStep(requestId, firstStep.stepOrder);
    }

    await this.notifyStep(firstStep, input.title, requestId, input.linkPage);

    return this.hydrate(requestId, steps);
  }

  /**
   * Records an approve/reject decision on the request's current step.
   *
   * APPROVE walks forward to the next applicable step, or completes the request
   * when the ladder is exhausted. REJECT ends the request immediately: there is
   * no partial rejection in payroll -- the run either goes out or it does not.
   */
  async act(
    requestId: number,
    action: 'APPROVE' | 'REJECT',
    userId: number,
    userRole: string,
    comments?: string | null,
  ): Promise<ApprovalRequestResponse> {
    if (action !== 'APPROVE' && action !== 'REJECT') {
      throw new Error("Action must be either 'APPROVE' or 'REJECT'");
    }

    const request = await this.repo.findRequestById(requestId);
    if (!request) throw new Error('Approval request not found');
    if (request.status !== 'PENDING') {
      throw new Error(`This request is already ${request.status.toLowerCase()}`);
    }
    if (!request.workflowId) throw new Error('This request is not attached to a workflow');

    const steps = await this.repo.listSteps(request.workflowId);
    const step = steps.find((s) => s.stepOrder === request.currentStep);
    if (!step) throw new Error('The current approval step no longer exists on this workflow');

    const role = String(userRole || '').toLowerCase();
    if (!step.allowedUserRoles.includes(role)) {
      throw new Error('Your role cannot approve this step');
    }

    if (action === 'APPROVE' && role !== 'admin') {
      const last = await this.repo.findLastApproval(requestId);
      if (last && last.actedBy === userId) {
        throw new Error('The same user cannot approve consecutive steps');
      }
    }

    await this.repo.addAction({
      requestId,
      stepOrder: step.stepOrder,
      approverRole: step.approverRole,
      action: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      actedBy: userId,
      comments: comments ?? null,
    });

    if (action === 'REJECT') {
      await this.repo.completeRequest(requestId, 'REJECTED');
      await this.notifyRequester(request, `Rejected: ${request.title}`, comments ?? null);
      return this.hydrate(requestId, steps);
    }

    const index = steps.findIndex((s) => s.stepOrder === step.stepOrder);
    const next = this.nextApplicableStep(steps, index + 1, request.amount);

    if (next) {
      await this.repo.setCurrentStep(requestId, next.stepOrder);
      await this.notifyStep(next, request.title, requestId);
    } else {
      await this.repo.completeRequest(requestId, 'APPROVED');
      await this.notifyRequester(request, `Approved: ${request.title}`, comments ?? null);
    }

    return this.hydrate(requestId, steps);
  }

  async getForEntity(entityType: string, entityId: number): Promise<ApprovalRequestResponse[]> {
    const requests = await this.repo.findByEntity(entityType, entityId);
    const out: ApprovalRequestResponse[] = [];
    for (const request of requests) {
      const steps = request.workflowId ? await this.repo.listSteps(request.workflowId) : [];
      out.push(await this.decorate(request, steps));
    }
    return out;
  }

  /** Requests waiting on a step that the given application role may act on. */
  async listPending(userRole: string, limit = 200): Promise<ApprovalRequestResponse[]> {
    if (!userRole) return [];
    return this.repo.listPendingForRole(String(userRole).toLowerCase(), limit);
  }

  async cancel(requestId: number, userId: number): Promise<ApprovalRequestResponse> {
    const request = await this.repo.findRequestById(requestId);
    if (!request) throw new Error('Approval request not found');
    if (request.status !== 'PENDING') {
      throw new Error(`This request is already ${request.status.toLowerCase()}`);
    }
    await this.repo.addAction({
      requestId,
      stepOrder: request.currentStep,
      approverRole: null,
      action: 'COMMENTED',
      actedBy: userId,
      comments: 'Request cancelled by the requester',
    });
    await this.repo.completeRequest(requestId, 'CANCELLED');
    const steps = request.workflowId ? await this.repo.listSteps(request.workflowId) : [];
    return this.hydrate(requestId, steps);
  }

  /** Latest request for an entity, or null. Used by run submit/approve flows. */
  async latestForEntity(entityType: string, entityId: number): Promise<ApprovalRequestResponse | null> {
    const rows = await this.repo.findByEntity(entityType, entityId);
    return rows[0] ?? null;
  }

  async countPending(entityType?: string): Promise<number> {
    return this.repo.countPending(entityType);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * First step at or after `fromIndex` that applies at this amount.
   *
   * `can_skip_if_below` is a value threshold: a step configured to skip below
   * 100000 is not required when the request is worth less than that.
   */
  private nextApplicableStep(
    steps: ApprovalStepResponse[],
    fromIndex: number,
    amount: number | null,
  ): ApprovalStepResponse | null {
    for (let i = fromIndex; i < steps.length; i++) {
      const step = steps[i] as ApprovalStepResponse;
      if (step.canSkipIfBelow !== null && (amount ?? 0) < step.canSkipIfBelow) continue;
      return step;
    }
    return null;
  }

  private async hydrate(
    requestId: number,
    steps: ApprovalStepResponse[],
  ): Promise<ApprovalRequestResponse> {
    const request = await this.repo.findRequestById(requestId);
    if (!request) throw new Error('Approval request not found');
    return this.decorate(request, steps);
  }

  private async decorate(
    request: ApprovalRequestResponse,
    steps: ApprovalStepResponse[],
  ): Promise<ApprovalRequestResponse> {
    const history = await this.repo.listActions(request.id);
    const current = steps.find((s) => s.stepOrder === request.currentStep) ?? null;
    return {
      ...request,
      steps,
      history,
      currentStepName: current ? current.name : null,
      currentStepRoles: current ? current.allowedUserRoles : [],
    };
  }

  /** Notification failures never block an approval; they are logged and dropped. */
  private async notifyStep(
    step: ApprovalStepResponse,
    title: string,
    requestId: number,
    linkPage = 'payroll',
  ): Promise<void> {
    if (step.allowedUserRoles.length === 0) return;
    try {
      await this.notifications.notifyRoles(step.allowedUserRoles, {
        category: 'PAYROLL',
        priority: 'HIGH',
        title: `Approval needed: ${title}`,
        body: `Awaiting "${step.name}" approval.`,
        linkPage,
        linkRefId: requestId,
      });
    } catch (err: any) {
      console.error('[approvals] notification failed:', err?.message ?? err);
    }
  }

  private async notifyRequester(
    request: ApprovalRequestResponse,
    title: string,
    comments: string | null,
  ): Promise<void> {
    if (!request.requestedBy) return;
    try {
      await this.notifications.notify({
        userId: request.requestedBy,
        category: 'PAYROLL',
        priority: 'NORMAL',
        title,
        body: comments,
        linkPage: 'payroll',
        linkRefId: request.id,
      });
    } catch (err: any) {
      console.error('[approvals] notification failed:', err?.message ?? err);
    }
  }
}
