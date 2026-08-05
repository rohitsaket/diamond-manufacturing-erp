import { VisitorRepository } from '../repositories/VisitorRepository';
import { AttendanceAuditRepository } from '../repositories/AttendanceAuditRepository';
import { AuditContext, Paged, Visitor, VisitorVisit } from '../types/attendance';
import { isValidDateString, todayString } from '../utils/dateUtils';

export class VisitorService {
  private repo = new VisitorRepository();
  private auditRepo = new AttendanceAuditRepository();

  // =========================================================================
  // Registry
  // =========================================================================
  async listVisitors(filters: { visitorType?: string; search?: string; onSiteOnly?: boolean } = {}): Promise<Visitor[]> {
    return this.repo.listVisitors(filters);
  }

  async createVisitor(data: Partial<Visitor>, userId: number, ctx: AuditContext = {}): Promise<Visitor[]> {
    if (!data.fullName?.trim()) throw new Error('A visitor name is required');
    if (data.contractFrom && data.contractTo && data.contractTo < data.contractFrom) {
      throw new Error('The contract end date is before its start date');
    }

    const visitorCode = await this.repo.nextVisitorCode();
    const id = await this.repo.createVisitor({ ...data, visitorCode }, userId);
    await this.auditRepo.log({
      entityType: 'VISITOR', entityId: id, action: 'CREATE',
      summary: `Registered ${data.visitorType?.toLowerCase() ?? 'visitor'} ${data.fullName} (${visitorCode})`,
      context: { ...ctx, userId },
    });
    return this.repo.listVisitors({});
  }

  async updateVisitor(id: number, data: Partial<Visitor>, userId: number, ctx: AuditContext = {}): Promise<Visitor[]> {
    const current = await this.repo.findVisitorById(id);
    if (!current) throw new Error('Visitor not found');
    if (data.isBlacklisted && !data.blacklistReason && !current.blacklistReason) {
      throw new Error('Blacklisting a visitor requires a reason');
    }
    await this.repo.updateVisitor(id, data, current);
    await this.auditRepo.log({
      entityType: 'VISITOR', entityId: id, action: 'UPDATE',
      summary: `Updated visitor ${current.fullName}`,
      previousValue: current as any, newValue: data as any, context: { ...ctx, userId },
    });
    return this.repo.listVisitors({});
  }

  async deleteVisitor(id: number): Promise<{ success: true }> {
    const visitor = await this.repo.findVisitorById(id);
    if (!visitor) throw new Error('Visitor not found');
    if (visitor.onSite) throw new Error(`${visitor.fullName} is currently checked in and cannot be removed`);
    await this.repo.deleteVisitor(id);
    return { success: true };
  }

  // =========================================================================
  // Visits
  // =========================================================================
  async listVisits(filters: {
    from?: string; to?: string; visitorId?: number; status?: string;
    visitorType?: string; branchId?: number; page?: number; pageSize?: number;
  }): Promise<Paged<VisitorVisit>> {
    await this.repo.flagOverstays();
    return this.repo.listVisits(filters);
  }

  async scheduleVisit(data: Partial<VisitorVisit>, userId: number, ctx: AuditContext = {}): Promise<VisitorVisit> {
    if (!data.visitorId) throw new Error('A visitor is required');
    if (!data.visitDate || !isValidDateString(data.visitDate)) throw new Error('A valid visit date is required');

    const visitor = await this.repo.findVisitorById(data.visitorId);
    if (!visitor) throw new Error('Visitor not found');
    if (visitor.isBlacklisted) {
      throw new Error(`${visitor.fullName} is blacklisted${visitor.blacklistReason ? `: ${visitor.blacklistReason}` : ''}`);
    }
    if (visitor.contractTo && data.visitDate > visitor.contractTo) {
      throw new Error(`${visitor.fullName}'s contract ended on ${visitor.contractTo}`);
    }

    const id = await this.repo.createVisit(data, userId);
    await this.auditRepo.log({
      entityType: 'VISITOR', entityId: data.visitorId, action: 'SCHEDULE_VISIT',
      summary: `Visit scheduled for ${visitor.fullName} on ${data.visitDate}`,
      context: { ...ctx, userId },
    });
    return (await this.repo.findVisitById(id))!;
  }

  async checkIn(id: number, userId: number, ctx: AuditContext = {}): Promise<VisitorVisit> {
    const visit = await this.repo.findVisitById(id);
    if (!visit) throw new Error('Visit not found');
    if (visit.checkedInAt) throw new Error(`${visit.visitorName} is already checked in`);
    if (visit.status === 'CANCELLED') throw new Error('This visit was cancelled');

    const visitor = await this.repo.findVisitorById(visit.visitorId);
    if (visitor?.isBlacklisted) throw new Error(`${visitor.fullName} is blacklisted and cannot be admitted`);

    await this.repo.checkIn(id);
    await this.auditRepo.log({
      entityType: 'VISITOR', entityId: visit.visitorId, action: 'CHECK_IN',
      summary: `${visit.visitorName} checked in`, context: { ...ctx, userId },
    });
    return (await this.repo.findVisitById(id))!;
  }

  async checkOut(id: number, userId: number, ctx: AuditContext = {}): Promise<VisitorVisit> {
    const visit = await this.repo.findVisitById(id);
    if (!visit) throw new Error('Visit not found');
    if (!visit.checkedInAt) throw new Error(`${visit.visitorName} has not checked in`);
    if (visit.checkedOutAt) throw new Error(`${visit.visitorName} already checked out`);

    await this.repo.checkOut(id);
    const updated = await this.repo.findVisitById(id);
    await this.auditRepo.log({
      entityType: 'VISITOR', entityId: visit.visitorId, action: 'CHECK_OUT',
      summary: `${visit.visitorName} checked out after ${updated?.hours ?? 0} hours`,
      context: { ...ctx, userId },
    });
    return updated!;
  }

  async setStatus(id: number, status: string, remarks: string | null, userId: number): Promise<VisitorVisit> {
    const allowed = ['EXPECTED', 'CHECKED_IN', 'CHECKED_OUT', 'NO_SHOW', 'CANCELLED', 'OVERSTAY'];
    if (!allowed.includes(status)) throw new Error(`Invalid visit status. Allowed: ${allowed.join(', ')}`);
    const visit = await this.repo.findVisitById(id);
    if (!visit) throw new Error('Visit not found');
    await this.repo.setVisitStatus(id, status, remarks);
    await this.auditRepo.log({
      entityType: 'VISITOR', entityId: visit.visitorId, action: 'UPDATE',
      summary: `Visit for ${visit.visitorName} marked ${status.toLowerCase()}`,
      context: { userId },
    });
    return (await this.repo.findVisitById(id))!;
  }

  async deleteVisit(id: number): Promise<{ success: true }> {
    const visit = await this.repo.findVisitById(id);
    if (!visit) throw new Error('Visit not found');
    if (visit.status === 'CHECKED_IN') throw new Error('Check the visitor out before removing the visit');
    await this.repo.deleteVisit(id);
    return { success: true };
  }

  /** Who is on site right now, plus the day's totals -- the gate desk view. */
  async board(date?: string): Promise<{
    date: string;
    summary: Awaited<ReturnType<VisitorRepository['summaryForDate']>>;
    onSite: VisitorVisit[];
    expected: VisitorVisit[];
  }> {
    const day = date && isValidDateString(date) ? date : todayString();
    await this.repo.flagOverstays();

    const [summary, onSite, expected] = await Promise.all([
      this.repo.summaryForDate(day),
      this.repo.listVisits({ from: day, to: day, status: 'CHECKED_IN', pageSize: 200 }),
      this.repo.listVisits({ from: day, to: day, status: 'EXPECTED', pageSize: 200 }),
    ]);

    return { date: day, summary, onSite: onSite.rows, expected: expected.rows };
  }
}
