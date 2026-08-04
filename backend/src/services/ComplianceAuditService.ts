import {
  ActionResponse,
  AuditResponse,
  ComplianceRepository,
  FindingResponse,
} from '../repositories/ComplianceRepository';
import { NotificationService } from './NotificationService';
import { todayString } from '../utils/dateUtils';

export interface FindingsSummary {
  bySeverity: { severity: string; count: number }[];
  byStatus: { status: string; count: number }[];
  byCategory: { category: string; count: number }[];
  total: number;
  open: number;
  overdueActions: number;
}

/**
 * Compliance audits, the findings they raise and the corrective actions that
 * close them.
 *
 * The two refusals below are the point of the module. A finding cannot be
 * closed while somebody is still working on it, and an audit cannot be closed
 * while any finding is unresolved -- otherwise "closed" stops meaning anything
 * and the audit trail becomes decoration.
 */
export class ComplianceAuditService {
  private repo = new ComplianceRepository();
  private notifications = new NotificationService();

  // -------------------------------------------------------------------------
  // Audits
  // -------------------------------------------------------------------------

  async listAudits(filters: { status?: string; auditType?: string; financialYear?: string; limit?: number } = {}): Promise<AuditResponse[]> {
    return this.repo.listAudits(filters);
  }

  async getAudit(id: number): Promise<AuditResponse & { findings: FindingResponse[] }> {
    const audit = await this.repo.findAuditById(id);
    if (!audit) throw new Error('Audit not found');
    const findings = await this.repo.listFindings({ auditId: id, limit: 500 });
    return { ...audit, findings };
  }

  async createAudit(data: Record<string, any>, userId: number): Promise<AuditResponse> {
    if (!data.title || !String(data.title).trim()) throw new Error('An audit needs a title');
    const id = await this.repo.createAudit(data, userId);
    await this.repo.logAudit({
      entityType: 'compliance_audits',
      entityId: id,
      action: 'CREATE',
      summary: `Audit "${String(data.title).slice(0, 120)}" created`,
      actorUserId: userId,
    });
    const audit = await this.repo.findAuditById(id);
    if (!audit) throw new Error('Audit could not be created');
    return audit;
  }

  async updateAudit(id: number, data: Record<string, any>, userId: number): Promise<AuditResponse> {
    const existing = await this.repo.findAuditById(id);
    if (!existing) throw new Error('Audit not found');
    if (existing.status === 'CLOSED' && data.status === undefined) {
      throw new Error('A closed audit cannot be edited; reopen it first by setting its status');
    }
    await this.repo.updateAudit(id, data, userId);
    const audit = await this.repo.findAuditById(id);
    if (!audit) throw new Error('Audit not found');
    return audit;
  }

  async deleteAudit(id: number, userId: number): Promise<{ deleted: boolean }> {
    const existing = await this.repo.findAuditById(id);
    if (!existing) throw new Error('Audit not found');
    await this.repo.softDeleteAudit(id);
    await this.repo.logAudit({
      entityType: 'compliance_audits',
      entityId: id,
      action: 'DELETE',
      summary: `Audit "${existing.title}" deleted`,
      actorUserId: userId,
    });
    return { deleted: true };
  }

  /** Refuses while anything raised by the audit is still unresolved. */
  async closeAudit(id: number, userId: number, summary?: string): Promise<AuditResponse> {
    const existing = await this.repo.findAuditById(id);
    if (!existing) throw new Error('Audit not found');
    if (existing.status === 'CLOSED') throw new Error('This audit is already closed');

    const open = await this.repo.countOpenFindings(id);
    if (open > 0) throw new Error(`${open} findings are still open`);

    await this.repo.updateAudit(
      id,
      {
        status: 'CLOSED',
        completedOn: existing.completedOn ?? todayString(),
        summary: summary ?? existing.summary,
      },
      userId,
    );
    await this.repo.logAudit({
      entityType: 'compliance_audits',
      entityId: id,
      action: 'CLOSE',
      summary: `Audit "${existing.title}" closed`,
      fieldName: 'status',
      previousValue: existing.status,
      newValue: 'CLOSED',
      actorUserId: userId,
    });
    const audit = await this.repo.findAuditById(id);
    if (!audit) throw new Error('Audit not found');
    return audit;
  }

  // -------------------------------------------------------------------------
  // Findings
  // -------------------------------------------------------------------------

  async listFindings(filters: {
    auditId?: number;
    status?: string;
    severity?: string;
    category?: string;
    ruleCode?: string;
    isAutomated?: boolean;
    ownerUserId?: number;
    limit?: number;
  } = {}): Promise<FindingResponse[]> {
    return this.repo.listFindings(filters);
  }

  async getFinding(id: number): Promise<FindingResponse & { actions: ActionResponse[] }> {
    const finding = await this.repo.findFindingById(id);
    if (!finding) throw new Error('Finding not found');
    const actions = await this.repo.listActions(id);
    return { ...finding, actions };
  }

  async createFinding(data: Record<string, any>, userId: number): Promise<FindingResponse> {
    if (!data.title || !String(data.title).trim()) throw new Error('A finding needs a title');
    if (!data.category) throw new Error('A finding needs a category');
    if (data.auditId) {
      const audit = await this.repo.findAuditById(Number(data.auditId));
      if (!audit) throw new Error('Audit not found');
    }
    const id = await this.repo.createFinding({ ...data, identifiedOn: data.identifiedOn ?? todayString() }, userId);
    await this.repo.logAudit({
      entityType: 'compliance_findings',
      entityId: id,
      action: 'CREATE',
      summary: `Finding "${String(data.title).slice(0, 120)}" raised`,
      actorUserId: userId,
    });
    if (data.ownerUserId) await this.notifyOwnerAssigned(id, Number(data.ownerUserId), userId);
    const finding = await this.repo.findFindingById(id);
    if (!finding) throw new Error('Finding could not be created');
    return finding;
  }

  async updateFinding(id: number, data: Record<string, any>, userId: number): Promise<FindingResponse> {
    const existing = await this.repo.findFindingById(id);
    if (!existing) throw new Error('Finding not found');
    if (existing.status === 'CLOSED' && data.status === undefined) {
      throw new Error('A closed finding cannot be edited; reopen it first by setting its status');
    }
    await this.repo.updateFinding(id, data);

    const newOwner = data.ownerUserId === undefined ? null : Number(data.ownerUserId);
    if (newOwner && newOwner !== existing.ownerUserId) {
      await this.notifyOwnerAssigned(id, newOwner, userId);
    }
    await this.repo.logAudit({
      entityType: 'compliance_findings',
      entityId: id,
      action: 'UPDATE',
      summary: `Finding "${existing.title}" updated`,
      actorUserId: userId,
    });
    const finding = await this.repo.findFindingById(id);
    if (!finding) throw new Error('Finding not found');
    return finding;
  }

  /** Refuses while a corrective action is still outstanding. */
  async closeFinding(id: number, userId: number, note?: string): Promise<FindingResponse> {
    const existing = await this.repo.findFindingById(id);
    if (!existing) throw new Error('Finding not found');
    if (existing.status === 'CLOSED') throw new Error('This finding is already closed');

    const openActions = await this.repo.countOpenActions(id);
    if (openActions > 0) throw new Error('Close the open corrective actions first');

    const description = note && note.trim()
      ? `${existing.description ? `${existing.description}\n` : ''}Closed: ${note.trim()}`
      : existing.description;
    await this.repo.updateFinding(id, { status: 'CLOSED', description });
    await this.repo.logAudit({
      entityType: 'compliance_findings',
      entityId: id,
      action: 'CLOSE',
      summary: `Finding "${existing.title}" closed${note ? `: ${note.trim().slice(0, 200)}` : ''}`,
      fieldName: 'status',
      previousValue: existing.status,
      newValue: 'CLOSED',
      actorUserId: userId,
    });
    const finding = await this.repo.findFindingById(id);
    if (!finding) throw new Error('Finding not found');
    return finding;
  }

  async getFindingsSummary(): Promise<FindingsSummary> {
    const summary = await this.repo.getFindingsSummary();
    return {
      bySeverity: summary.bySeverity.map((r) => ({ severity: r.severity, count: r.count })),
      byStatus: summary.byStatus.map((r) => ({ status: r.status, count: r.count })),
      byCategory: summary.byCategory.map((r) => ({ category: r.category, count: r.count })),
      total: summary.total,
      open: summary.open,
      overdueActions: summary.overdueActions,
    };
  }

  // -------------------------------------------------------------------------
  // Corrective actions
  // -------------------------------------------------------------------------

  async listActions(findingId: number, filters: { status?: string; limit?: number } = {}): Promise<ActionResponse[]> {
    const finding = await this.repo.findFindingById(findingId);
    if (!finding) throw new Error('Finding not found');
    return this.repo.listActions(findingId, filters);
  }

  async createAction(findingId: number, data: Record<string, any>, userId: number): Promise<ActionResponse> {
    const finding = await this.repo.findFindingById(findingId);
    if (!finding) throw new Error('Finding not found');
    if (!data.actionText || !String(data.actionText).trim()) throw new Error('A corrective action needs a description');

    const id = await this.repo.createAction({ ...data, findingId }, userId);
    await this.repo.logAudit({
      entityType: 'compliance_actions',
      entityId: id,
      action: 'CREATE',
      summary: `Corrective action added to finding "${finding.title}"`,
      actorUserId: userId,
    });

    if (data.ownerUserId) {
      await this.notifications.notify({
        userId: Number(data.ownerUserId),
        category: 'POLICY',
        priority: finding.severity === 'CRITICAL' || finding.severity === 'HIGH' ? 'HIGH' : 'NORMAL',
        title: `Corrective action assigned: ${finding.title}`,
        body: `${String(data.actionText).slice(0, 300)}${data.dueDate ? ` Due ${data.dueDate}.` : ''}`,
        linkPage: 'compliance',
        linkRefId: findingId,
        createdBy: userId,
      });
    }

    const action = await this.repo.findActionById(id);
    if (!action) throw new Error('Corrective action could not be created');
    return action;
  }

  async updateAction(id: number, data: Record<string, any>, userId: number): Promise<ActionResponse> {
    const existing = await this.repo.findActionById(id);
    if (!existing) throw new Error('Corrective action not found');

    const patch = { ...data };
    if (patch.status === 'COMPLETED' && !patch.completedOn && !existing.completedOn) {
      patch.completedOn = todayString();
    }
    await this.repo.updateAction(id, patch);
    await this.repo.logAudit({
      entityType: 'compliance_actions',
      entityId: id,
      action: 'UPDATE',
      summary: `Corrective action ${id} updated${patch.status ? ` to ${patch.status}` : ''}`,
      fieldName: patch.status ? 'status' : null,
      previousValue: patch.status ? existing.status : null,
      newValue: patch.status ? String(patch.status) : null,
      actorUserId: userId,
    });
    const action = await this.repo.findActionById(id);
    if (!action) throw new Error('Corrective action not found');
    return action;
  }

  /**
   * Nudges owners whose corrective actions are close to, or past, their due
   * date. Notification only -- nothing is auto-escalated, because an action
   * being late is a conversation, not a state change.
   */
  async sendActionReminders(days = 7): Promise<{ candidates: number; notified: number }> {
    const actions = await this.repo.findActionsDueWithin(days);
    let notified = 0;
    for (const action of actions) {
      if (!action.ownerUserId) continue;
      const overdue = !!action.dueDate && action.dueDate < todayString();
      await this.notifications.notify({
        userId: action.ownerUserId,
        category: 'POLICY',
        priority: overdue || action.findingSeverity === 'CRITICAL' ? 'HIGH' : 'NORMAL',
        title: `${overdue ? 'Overdue' : 'Due soon'}: corrective action for "${action.findingTitle}"`,
        body: `${action.actionText.slice(0, 300)} Due ${action.dueDate ?? 'unspecified'}.`,
        linkPage: 'compliance',
        linkRefId: action.findingId,
      });
      notified++;
    }
    return { candidates: actions.length, notified };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async notifyOwnerAssigned(findingId: number, ownerUserId: number, actorUserId: number): Promise<void> {
    const finding = await this.repo.findFindingById(findingId);
    if (!finding) return;
    await this.notifications.notify({
      userId: ownerUserId,
      category: 'POLICY',
      priority: finding.severity === 'CRITICAL' || finding.severity === 'HIGH' ? 'HIGH' : 'NORMAL',
      title: `Compliance finding assigned: ${finding.title}`,
      body: `${finding.severity} ${finding.category} finding affecting ${finding.affectedCount} record(s).`
        + `${finding.dueDate ? ` Due ${finding.dueDate}.` : ''}`,
      linkPage: 'compliance',
      linkRefId: findingId,
      createdBy: actorUserId,
    });
  }
}
