import { ExitProcessRepository } from '../repositories/ExitProcessRepository';
import { SeparationRepository } from '../repositories/SeparationRepository';
import { AccessRevocationResponse, AssetReturnResponse, KtItemResponse, KtPlanResponse } from '../types/offboarding';
import { PerfActionContext } from '../types/performance';
import { isValidDateString, toDateString, todayString } from '../utils/dateUtils';
import { ExitAuditService } from './ExitAuditService';
import { NotificationService } from './NotificationService';

const RETURN_CONDITIONS = new Set(['GOOD', 'DAMAGED', 'LOST']);
const KT_PLAN_STATUSES = new Set(['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'APPROVED']);
const KT_ITEM_TYPES = new Set(['SESSION', 'DOCUMENT', 'PROJECT_HANDOVER', 'CLIENT_HANDOVER', 'TEAM_HANDOVER', 'RESPONSIBILITY']);
const KT_ITEM_STATUSES = new Set(['PENDING', 'IN_PROGRESS', 'DONE']);
const ACCESS_STATUSES = new Set(['PENDING', 'REVOKED', 'NA']);

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function dateOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return toDateString(value);
}

export function toAssetReturnResponse(row: any): AssetReturnResponse {
  return {
    id: row.id,
    separationId: row.separation_id,
    assetAssignmentId: row.asset_assignment_id,
    assetName: row.asset_name ?? null,
    assetTag: row.asset_tag ?? null,
    assetCategory: row.asset_category ?? null,
    assignedOn: dateOrNull(row.assigned_on),
    returnCondition: row.return_condition,
    damageNote: row.damage_note ?? null,
    damageCharge: row.damage_charge === null || row.damage_charge === undefined ? null : Number(row.damage_charge),
    returnedAt: isoOrNull(row.returned_at),
    verifiedBy: row.verified_by ?? null,
  };
}

export function toKtPlanResponse(row: any): KtPlanResponse {
  return {
    id: row.id,
    separationId: row.separation_id,
    employeeName: row.employee_name ?? null,
    successorEmployeeId: row.successor_employee_id ?? null,
    successorName: row.successor_name ?? null,
    status: row.status,
    note: row.note ?? null,
    approvedBy: row.approved_by ?? null,
    approvedAt: isoOrNull(row.approved_at),
  };
}

export function toKtItemResponse(row: any): KtItemResponse {
  return {
    id: row.id,
    planId: row.plan_id,
    itemType: row.item_type,
    title: row.title,
    description: row.description ?? null,
    dueDate: dateOrNull(row.due_date),
    status: row.status,
    completedAt: isoOrNull(row.completed_at),
    sortOrder: Number(row.sort_order),
  };
}

export function toAccessRevocationResponse(row: any): AccessRevocationResponse {
  return {
    id: row.id,
    separationId: row.separation_id,
    systemName: row.system_name,
    isInternal: !!row.is_internal,
    status: row.status,
    note: row.note ?? null,
    revokedBy: row.revoked_by ?? null,
    revokedAt: isoOrNull(row.revoked_at),
  };
}

/**
 * The physical/technical legs of an exit: asset returns wired into the real
 * asset register, the knowledge-transfer plan, and the access-revocation
 * checklist (where the HRMS Login row genuinely deactivates the account).
 */
export class ExitProcessService {
  private repo = new ExitProcessRepository();
  private separations = new SeparationRepository();
  private audit = new ExitAuditService();
  private notifications = new NotificationService();

  // ==========================================================================
  // Asset returns
  // ==========================================================================

  async listAssetReturns(filters: { separationId?: number; limit?: number }): Promise<AssetReturnResponse[]> {
    const rows = await this.repo.findAssetReturns(filters);
    return rows.map(toAssetReturnResponse);
  }

  /**
   * Verifying a return closes the loop with the asset module in one
   * transaction: the return row, the open assignment (returned_on +
   * condition_note) and the asset's own status all move together.
   */
  async verifyAssetReturn(
    id: number,
    input: { returnCondition?: string; damageNote?: string; damageCharge?: number },
    ctx: PerfActionContext,
  ): Promise<AssetReturnResponse> {
    const before = await this.repo.findAssetReturnById(id);
    if (!before) throw new Error(`Asset return ${id} was not found`);
    const condition = String(input?.returnCondition ?? '').toUpperCase();
    if (!RETURN_CONDITIONS.has(condition)) {
      throw new Error('returnCondition must be GOOD, DAMAGED or LOST');
    }
    if ((condition === 'DAMAGED' || condition === 'LOST') && (!input.damageNote || !String(input.damageNote).trim())) {
      throw new Error(`A damageNote is required when the asset is ${condition}`);
    }
    let damageCharge: number | null = null;
    if (input.damageCharge !== undefined && input.damageCharge !== null) {
      damageCharge = Number(input.damageCharge);
      if (!Number.isFinite(damageCharge) || damageCharge < 0) throw new Error('damageCharge must be zero or a positive number');
    }

    await this.repo.verifyAssetReturn({
      returnId: id,
      assetAssignmentId: before.asset_assignment_id,
      assetId: before.asset_id,
      returnCondition: condition,
      damageNote: input.damageNote ? String(input.damageNote).trim() : null,
      damageCharge,
      verifiedBy: ctx.userId,
      returnedOn: todayString(),
    });
    await this.separations.insertEvent(
      before.separation_id, 'ASSET_RETURNED',
      `${before.asset_name} (${before.asset_tag}) returned ${condition}${damageCharge ? `; damage charge ${damageCharge}` : ''}.`,
      ctx.userId,
    );
    await this.audit.record('ASSET_RETURN', id, 'VERIFY', ctx,
      { returnCondition: before.return_condition },
      { returnCondition: condition, damageNote: input.damageNote ?? null, damageCharge });
    return toAssetReturnResponse(await this.repo.findAssetReturnById(id));
  }

  // ==========================================================================
  // Knowledge transfer
  // ==========================================================================

  async getKtPlan(separationId: number): Promise<KtPlanResponse> {
    const plan = await this.repo.findKtPlanBySeparation(separationId);
    if (!plan) throw new Error(`No KT plan was found for separation ${separationId}; it is generated when the case is approved`);
    const items = await this.repo.findKtItems(plan.id);
    return { ...toKtPlanResponse(plan), items: items.map(toKtItemResponse) };
  }

  async updateKtPlan(
    planId: number,
    input: { successorEmployeeId?: number | null; note?: string | null; status?: string },
    ctx: PerfActionContext,
  ): Promise<KtPlanResponse> {
    const before = await this.mustFindPlan(planId);
    const fields: Record<string, any> = {};
    if (input.successorEmployeeId !== undefined) {
      if (input.successorEmployeeId === null) {
        fields.successor_employee_id = null;
      } else {
        const successor = await this.separations.findEmployee(Number(input.successorEmployeeId));
        if (!successor) throw new Error(`Successor employee ${input.successorEmployeeId} was not found`);
        fields.successor_employee_id = Number(input.successorEmployeeId);
      }
    }
    if (input.note !== undefined) fields.note = input.note === null ? null : String(input.note).trim();
    if (input.status !== undefined) {
      const status = String(input.status).toUpperCase();
      if (!KT_PLAN_STATUSES.has(status)) throw new Error(`Invalid KT plan status "${input.status}"`);
      if (status === 'APPROVED') throw new Error('Use the approve endpoint to approve a KT plan');
      fields.status = status;
    }
    if (Object.keys(fields).length === 0) throw new Error('No updatable fields were provided');

    await this.repo.updateKtPlan(planId, fields);
    await this.audit.record('KT_PLAN', planId, 'UPDATE', ctx,
      toKtPlanResponse(before), input);
    const after = await this.mustFindPlan(planId);
    const items = await this.repo.findKtItems(planId);
    return { ...toKtPlanResponse(after), items: items.map(toKtItemResponse) };
  }

  async addKtItem(planId: number, input: any, ctx: PerfActionContext): Promise<KtItemResponse> {
    const plan = await this.mustFindPlan(planId);
    if (plan.status === 'APPROVED') throw new Error('Items cannot be added to an APPROVED KT plan');
    if (!input?.title || !String(input.title).trim()) throw new Error('A KT item title is required');
    const itemType = input.itemType ? String(input.itemType).toUpperCase() : 'SESSION';
    if (!KT_ITEM_TYPES.has(itemType)) throw new Error(`Invalid KT item type "${input.itemType}"`);
    if (input.dueDate && !isValidDateString(String(input.dueDate))) {
      throw new Error('dueDate must be a valid YYYY-MM-DD date');
    }
    const existing = await this.repo.findKtItems(planId);
    const id = await this.repo.insertKtItem({
      plan_id: planId,
      item_type: itemType,
      title: String(input.title).trim(),
      description: input.description ?? null,
      due_date: input.dueDate ?? null,
      status: 'PENDING',
      sort_order: input.sortOrder === undefined ? existing.length : Math.trunc(Number(input.sortOrder)),
    });
    // A plan with work on it is underway.
    if (plan.status === 'DRAFT') await this.repo.updateKtPlan(planId, { status: 'IN_PROGRESS' });
    await this.audit.record('KT_ITEM', id, 'CREATE', ctx, null, { planId, title: input.title, itemType });
    return toKtItemResponse(await this.repo.findKtItemById(id));
  }

  async updateKtItem(id: number, input: { status?: string }, ctx: PerfActionContext): Promise<KtItemResponse> {
    const before = await this.repo.findKtItemById(id);
    if (!before) throw new Error(`KT item ${id} was not found`);
    const status = String(input?.status ?? '').toUpperCase();
    if (!KT_ITEM_STATUSES.has(status)) throw new Error('status must be PENDING, IN_PROGRESS or DONE');

    await this.repo.updateKtItem(id, {
      status,
      completed_at: status === 'DONE' ? new Date() : null,
    });

    // All items DONE promotes the plan to COMPLETED; reopening an item
    // demotes a COMPLETED (but not APPROVED) plan back to IN_PROGRESS.
    const plan = await this.mustFindPlan(before.plan_id);
    const pending = await this.repo.countPendingKtItems(before.plan_id);
    if (pending === 0 && plan.status !== 'APPROVED' && plan.status !== 'COMPLETED') {
      await this.repo.updateKtPlan(before.plan_id, { status: 'COMPLETED' });
      await this.separations.insertEvent(plan.separation_id, 'KT_COMPLETED', 'All knowledge-transfer items are done.', ctx.userId);
    } else if (pending > 0 && plan.status === 'COMPLETED') {
      await this.repo.updateKtPlan(before.plan_id, { status: 'IN_PROGRESS' });
    }

    await this.audit.record('KT_ITEM', id, 'UPDATE', ctx, { status: before.status }, { status });
    return toKtItemResponse(await this.repo.findKtItemById(id));
  }

  async deleteKtItem(id: number, ctx: PerfActionContext): Promise<void> {
    const before = await this.repo.findKtItemById(id);
    if (!before) throw new Error(`KT item ${id} was not found`);
    const plan = await this.mustFindPlan(before.plan_id);
    if (plan.status === 'APPROVED') throw new Error('Items cannot be removed from an APPROVED KT plan');
    await this.repo.deleteKtItem(id);
    await this.audit.record('KT_ITEM', id, 'DELETE', ctx, toKtItemResponse(before), null);
  }

  async approveKtPlan(planId: number, ctx: PerfActionContext): Promise<KtPlanResponse> {
    const plan = await this.mustFindPlan(planId);
    if (plan.status === 'APPROVED') throw new Error('This KT plan is already APPROVED');
    if (plan.status !== 'COMPLETED') {
      const pending = await this.repo.countPendingKtItems(planId);
      throw new Error(
        `Only a COMPLETED KT plan can be approved (this one is ${plan.status}${pending > 0 ? ` with ${pending} item(s) not DONE` : ''})`,
      );
    }
    await this.repo.updateKtPlan(planId, { status: 'APPROVED', approved_by: ctx.userId, approved_at: new Date() });
    await this.separations.insertEvent(plan.separation_id, 'KT_APPROVED', 'Knowledge-transfer plan approved.', ctx.userId);
    await this.audit.record('KT_PLAN', planId, 'APPROVE', ctx, { status: plan.status }, { status: 'APPROVED' });
    const after = await this.mustFindPlan(planId);
    const items = await this.repo.findKtItems(planId);
    return { ...toKtPlanResponse(after), items: items.map(toKtItemResponse) };
  }

  // ==========================================================================
  // Access revocations
  // ==========================================================================

  async listAccessRevocations(filters: { separationId?: number; limit?: number }): Promise<AccessRevocationResponse[]> {
    const rows = await this.repo.findAccessRevocations(filters);
    return rows.map(toAccessRevocationResponse);
  }

  /**
   * Internal rows are real: revoking "HRMS Login" deactivates the linked user
   * account in the same transaction. External rows are recorded manual steps
   * (no directory or SaaS integration exists), and the response says so.
   */
  async updateAccessRevocation(
    id: number,
    input: { status?: string; note?: string | null },
    ctx: PerfActionContext,
  ): Promise<AccessRevocationResponse & { manualStepNote?: string }> {
    const before = await this.repo.findAccessRevocationById(id);
    if (!before) throw new Error(`Access revocation ${id} was not found`);
    const status = String(input?.status ?? '').toUpperCase();
    if (!ACCESS_STATUSES.has(status)) throw new Error('status must be PENDING, REVOKED or NA');
    const note = input.note === undefined ? before.note : input.note === null ? null : String(input.note).trim();

    // A completed case has already deactivated the login; walking an internal
    // revocation back would silently contradict reality.
    if (before.case_status === 'COMPLETED' && before.is_internal && before.status === 'REVOKED' && status !== 'REVOKED') {
      throw new Error('An internal revocation cannot be reopened on a COMPLETED case; the account is already deactivated');
    }

    if (status === 'REVOKED' && before.is_internal && before.system_name === 'HRMS Login') {
      await this.repo.revokeHrmsLogin({
        revocationId: id,
        employeeId: before.employee_id,
        note,
        revokedBy: ctx.userId,
      });
    } else {
      await this.repo.updateAccessRevocation(id, {
        status,
        note,
        revoked_by: status === 'REVOKED' ? ctx.userId : null,
        revoked_at: status === 'REVOKED' ? new Date() : null,
      });
    }

    await this.separations.insertEvent(
      before.separation_id, 'ACCESS_UPDATED',
      `${before.system_name} marked ${status}.`, ctx.userId,
    );
    await this.audit.record('ACCESS_REVOCATION', id, 'UPDATE', ctx,
      { status: before.status }, { status, note });

    const after = toAccessRevocationResponse(await this.repo.findAccessRevocationById(id));
    if (status === 'REVOKED' && !before.is_internal) {
      return {
        ...after,
        manualStepNote:
          `${before.system_name} is an external system with no integration; this entry records that the revocation was performed manually outside the HRMS.`,
      };
    }
    if (status === 'REVOKED' && before.is_internal && before.system_name === 'HRMS Login') {
      return { ...after, manualStepNote: 'The linked HRMS user account has been deactivated.' };
    }
    return after;
  }

  // ==========================================================================
  // Reminders
  // ==========================================================================

  /**
   * Nudge admin/hr about every live case that still has pending clearances,
   * asset returns or interviews. Cases with nothing pending are skipped with
   * a reason rather than silently dropped.
   */
  async sendReminders(ctx: PerfActionContext): Promise<{ notified: number; skipped: { sepCode: string; reason: string }[] }> {
    const cases = await this.repo.findCasesNeedingReminders();
    let notified = 0;
    const skipped: { sepCode: string; reason: string }[] = [];

    for (const c of cases) {
      const parts: string[] = [];
      if (Number(c.pending_clearances) > 0) parts.push(`${c.pending_clearances} clearance(s)`);
      if (Number(c.pending_assets) > 0) parts.push(`${c.pending_assets} asset return(s)`);
      if (Number(c.pending_interviews) > 0) parts.push(`${c.pending_interviews} exit interview(s)`);
      if (parts.length === 0) {
        skipped.push({ sepCode: c.sep_code, reason: 'nothing pending' });
        continue;
      }
      try {
        await this.notifications.notifyRoles(['admin', 'hr'], {
          category: 'OFFBOARDING',
          title: `Offboarding pending: ${c.employee_name} (${c.sep_code})`,
          body: `${parts.join(', ')} still open; last working day ${c.last_working_day ? toDateString(c.last_working_day) : 'not set'}.`,
          linkPage: 'offboarding',
          linkRefId: c.id,
        });
        notified++;
      } catch (err: any) {
        skipped.push({ sepCode: c.sep_code, reason: `notification failed: ${err.message}` });
      }
    }

    await this.audit.record('SEPARATION', 0, 'REMINDERS', ctx, null, { notified, skipped: skipped.length });
    return { notified, skipped };
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private async mustFindPlan(planId: number): Promise<any> {
    const plan = await this.repo.findKtPlanById(planId);
    if (!plan) throw new Error(`KT plan ${planId} was not found`);
    return plan;
  }
}
