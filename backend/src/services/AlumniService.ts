import { AlumniRepository } from '../repositories/AlumniRepository';
import { AlumniResponse } from '../types/offboarding';
import { PerfActionContext } from '../types/performance';
import { toDateString } from '../utils/dateUtils';
import { ExitAuditService } from './ExitAuditService';
import { NotificationService } from './NotificationService';

/**
 * Alumni registry, rehire decisioning and boomerang tracking.
 *
 * Honest scope: there is no external alumni portal; the directory is internal
 * and any actual communication with alumni happens outside the system. The
 * stats payload says so explicitly.
 */

const ALUMNI_NOTE =
  'There is no external alumni portal; the directory is internal and communications happen outside the system.';

const REHIRE_DECISIONS = ['ELIGIBLE', 'RESTRICTED', 'BLOCKED'];

export class AlumniService {
  private repo = new AlumniRepository();
  private audit = new ExitAuditService();
  private notifications = new NotificationService();

  async list(filters: { rehireEligible?: boolean; search?: string; limit?: number }): Promise<AlumniResponse[]> {
    const rows = await this.repo.findMany(filters);
    return rows.map((r) => this.toResponse(r));
  }

  async get(id: number): Promise<AlumniResponse & {
    previousEmployment: { timeline: any[]; separations: any[] };
    reviews: any[];
  }> {
    const row = await this.requireRow(id);
    const latest = await this.repo.findLatestReview(id);
    const reviews = await this.repo.findReviews(id);
    const timeline = await this.repo.findTimelineEvents(Number(row.employee_id));
    const separations = await this.repo.findSeparationHistory(Number(row.employee_id));
    return {
      ...this.toResponse(row, latest),
      previousEmployment: {
        timeline: timeline.map((t) => ({
          id: Number(t.id),
          eventType: String(t.event_type),
          eventDate: toDateString(t.event_date),
          title: String(t.title),
          details: t.details ?? null,
          fromValue: t.from_value ?? null,
          toValue: t.to_value ?? null,
        })),
        separations: separations.map((s) => ({
          id: Number(s.id),
          sepCode: String(s.sep_code),
          separationType: String(s.separation_type),
          status: String(s.status),
          resignationDate: s.resignation_date ? toDateString(s.resignation_date) : null,
          lastWorkingDay: s.last_working_day ? toDateString(s.last_working_day) : null,
          reason: s.reason ?? null,
        })),
      },
      reviews: reviews.map((r) => ({
        id: Number(r.id),
        decision: String(r.decision),
        reason: r.reason ?? null,
        decidedBy: r.decided_by === null || r.decided_by === undefined ? null : Number(r.decided_by),
        decidedByName: r.decided_by_name ?? null,
        decidedAt: r.decided_at instanceof Date ? r.decided_at.toISOString() : String(r.decided_at ?? ''),
      })),
    };
  }

  async update(
    id: number,
    input: { contactEmail?: string | null; contactPhone?: string | null; inAlumniNetwork?: boolean; notes?: string | null },
    ctx: PerfActionContext,
  ): Promise<AlumniResponse> {
    const before = await this.requireRow(id);
    await this.repo.updateContact(id, {
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      inAlumniNetwork: input.inAlumniNetwork === undefined ? undefined : !!input.inAlumniNetwork,
      notes: input.notes,
    });
    await this.audit.record('ALUMNI', id, 'UPDATE', ctx,
      { contactEmail: before.contact_email, contactPhone: before.contact_phone, inAlumniNetwork: !!before.in_alumni_network },
      input);
    const row = await this.requireRow(id);
    const latest = await this.repo.findLatestReview(id);
    return this.toResponse(row, latest);
  }

  /**
   * Record an explicit rehire decision and sync the registry flags:
   * rehire_eligible mirrors decision === 'ELIGIBLE', and the restriction note
   * carries the reason for anything that is not a clean ELIGIBLE.
   */
  async rehireReview(id: number, decision: string, reason: string | null, ctx: PerfActionContext): Promise<AlumniResponse> {
    const verdict = String(decision ?? '').toUpperCase();
    if (!REHIRE_DECISIONS.includes(verdict)) {
      throw new Error(`decision must be one of ${REHIRE_DECISIONS.join(', ')}`);
    }
    const before = await this.requireRow(id);
    const reviewId = await this.repo.insertReview(id, verdict, reason ?? null, ctx.userId);
    const eligible = verdict === 'ELIGIBLE';
    await this.repo.syncRehireDecision(id, eligible, eligible ? null : (reason ?? `Marked ${verdict} on review`));
    await this.audit.record('ALUMNI', id, 'REHIRE_REVIEW', ctx,
      { rehireEligible: before.rehire_eligible === null ? null : !!before.rehire_eligible },
      { reviewId, decision: verdict, reason });

    // Rehire-decision notification to the alumnus's account, if it still exists
    // and is active; most exited employees have deactivated logins.
    try {
      const employee = await this.repo.findEmployee(Number(before.employee_id));
      if (employee) {
        // Notification goes to HR-visible channels via the employee's user when active.
        await this.notifications.notifyEmployee(Number(before.employee_id), {
          category: 'OFFBOARDING',
          title: 'Rehire review recorded',
          body: `A rehire decision of ${verdict} was recorded on your alumni profile.`,
        });
      }
    } catch (err) {
      console.error('rehire review notification failed:', err);
    }

    const row = await this.requireRow(id);
    const latest = await this.repo.findLatestReview(id);
    return this.toResponse(row, latest);
  }

  /** Link the alumnus to the new employee row created for their rehire. */
  async markBoomerang(id: number, rehiredEmployeeId: number, rehiredAt: string, ctx: PerfActionContext): Promise<AlumniResponse> {
    const alumni = await this.requireRow(id);
    if (!rehiredEmployeeId || !Number.isFinite(Number(rehiredEmployeeId))) {
      throw new Error('A numeric rehiredEmployeeId is required');
    }
    if (Number(rehiredEmployeeId) === Number(alumni.employee_id)) {
      throw new Error('rehiredEmployeeId must be a different employee record from the original one; a rehire creates a new employee row');
    }
    const employee = await this.repo.findEmployee(Number(rehiredEmployeeId));
    if (!employee) throw new Error(`Employee ${rehiredEmployeeId} was not found`);
    const when = rehiredAt ? toDateString(rehiredAt) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(when)) throw new Error('rehiredAt must be a YYYY-MM-DD date');

    await this.repo.markBoomerang(id, Number(rehiredEmployeeId), when);
    await this.audit.record('ALUMNI', id, 'MARK_BOOMERANG', ctx,
      { isBoomerang: !!alumni.is_boomerang },
      { rehiredEmployeeId: Number(rehiredEmployeeId), rehiredAt: when });
    const row = await this.requireRow(id);
    const latest = await this.repo.findLatestReview(id);
    return this.toResponse(row, latest);
  }

  async stats(): Promise<{ total: number; rehireEligible: number; boomerangs: number; inNetwork: number; note: string }> {
    const stats = await this.repo.stats();
    return { ...stats, note: ALUMNI_NOTE };
  }

  // ---------------------------------------------------------------------------

  private async requireRow(id: number): Promise<any> {
    const row = await this.repo.findById(id);
    if (!row) throw new Error(`Alumni record ${id} was not found`);
    return row;
  }

  private toResponse(row: any, latestReview?: any | null): AlumniResponse {
    return {
      id: Number(row.id),
      employeeId: Number(row.employee_id),
      employeeName: row.full_name ?? null,
      empCode: row.emp_code ?? null,
      separationId: row.separation_id === null || row.separation_id === undefined ? null : Number(row.separation_id),
      exitDate: row.exit_date ? toDateString(row.exit_date) : null,
      lastGrade: row.last_grade ?? row.employee_grade ?? null,
      lastDepartment: row.last_department ?? null,
      contactEmail: row.contact_email ?? null,
      contactPhone: row.contact_phone ?? null,
      rehireEligible: row.rehire_eligible === null || row.rehire_eligible === undefined ? null : !!row.rehire_eligible,
      rehireRestrictionNote: row.rehire_restriction_note ?? null,
      isBoomerang: !!row.is_boomerang,
      rehiredEmployeeId: row.rehired_employee_id === null || row.rehired_employee_id === undefined ? null : Number(row.rehired_employee_id),
      rehiredAt: row.rehired_at ? toDateString(row.rehired_at) : null,
      inAlumniNetwork: !!row.in_alumni_network,
      notes: row.notes ?? null,
      latestDecision: latestReview
        ? {
          decision: String(latestReview.decision) as 'ELIGIBLE' | 'RESTRICTED' | 'BLOCKED',
          reason: latestReview.reason ?? null,
          decidedAt: latestReview.decided_at instanceof Date ? latestReview.decided_at.toISOString() : String(latestReview.decided_at ?? ''),
        }
        : (latestReview === null ? null : undefined),
    };
  }
}
