import {
  AUTO_ADJUSTMENT_PREFIX,
  CalendarEntryResponse,
  CalendarFilters,
  CalendarUpsertInput,
  ComplianceRepository,
  ObligationResponse,
} from '../repositories/ComplianceRepository';
import { NotificationService } from './NotificationService';
import { dayOfWeek, daysInMonth, toDateString, todayString } from '../utils/dateUtils';

export interface GenerateCalendarResult {
  financialYear: string;
  obligationsProcessed: number;
  obligationsSkipped: { code: string; reason: string }[];
  created: number;
  updated: number;
  unchanged: number;
  weekendAdjusted: number;
  entries: CalendarEntryResponse[];
  /** Said plainly, because a calendar that silently claims more than it does is worse than none. */
  adjustmentNote: string;
}

export interface CompleteCalendarInput {
  completedOn?: string;
  filingId?: number | null;
  challanId?: number | null;
  remarks?: string | null;
}

const WEEKEND_NOTE =
  'Due dates falling on a Saturday or Sunday were moved to the following Monday. '
  + 'No government holiday list is available to this system, so public holidays and '
  + 'state-specific closures are NOT accounted for -- verify any date that falls near one.';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface GeneratedPeriod {
  label: string;
  monthKey: string | null;
  quarter: number | null;
  /** Last day of the period the obligation reports on. */
  periodEnd: string;
}

/** Indian financial year window: 1 April to 31 March. */
function fyBounds(financialYear: string): { from: string; to: string; startYear: number } {
  const startYear = Number(String(financialYear).slice(0, 4));
  if (!Number.isFinite(startYear)) throw new Error("Financial year must look like '2026-2027'");
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31`, startYear };
}

function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function lastDayOf(year: number, month: number): string {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return `${key}-${String(daysInMonth(key)).padStart(2, '0')}`;
}

/** Add whole months to a `YYYY-MM-DD`, landing on `day` clamped to the month length. */
function dueDateFrom(periodEnd: string, offsetMonths: number, dueDay: number | null): string {
  const year = Number(periodEnd.slice(0, 4));
  const month = Number(periodEnd.slice(5, 7));
  const zero = (year * 12 + (month - 1)) + Math.max(0, Math.floor(offsetMonths));
  const targetYear = Math.floor(zero / 12);
  const targetMonth = (zero % 12) + 1;
  const length = daysInMonth(`${targetYear}-${String(targetMonth).padStart(2, '0')}`);
  const day = dueDay === null || dueDay <= 0 ? length : Math.min(dueDay, length);
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Saturday and Sunday roll forward to Monday. */
function nextWorkingDay(date: string): string {
  const dow = dayOfWeek(date);
  if (dow !== 0 && dow !== 6) return date;
  const shift = dow === 6 ? 2 : 1;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + shift);
  return toDateString(d);
}

/**
 * The statutory calendar: turning recurring obligations into dated entries,
 * keeping their status honest, and reminding the people who have to act.
 *
 * Generation is idempotent by construction. The table's unique key includes a
 * nullable `state_code`, and MySQL does not treat two NULLs as equal, so an
 * upsert would quietly duplicate every central obligation on the second run.
 * The existing entries for the year are therefore read once and matched in
 * memory before anything is written.
 */
export class ComplianceCalendarService {
  private repo = new ComplianceRepository();
  private notifications = new NotificationService();

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------

  async generateCalendar(financialYear: string, userId: number): Promise<GenerateCalendarResult> {
    const fy = this.normaliseFy(financialYear);
    const { startYear } = fyBounds(fy);
    const obligations = await this.repo.listObligations({ isActive: true, limit: 500 });
    const existing = await this.repo.findCalendarEntriesForYear(fy);

    const key = (obligationId: number, label: string, stateCode: string | null): string =>
      `${obligationId}|${label}|${stateCode ?? ''}`;
    const existingByKey = new Map<string, { id: number }>();
    for (const row of existing) existingByKey.set(key(row.obligationId, row.periodLabel, row.stateCode), { id: row.id });

    const skipped: { code: string; reason: string }[] = [];
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let weekendAdjusted = 0;
    let processed = 0;

    for (const obligation of obligations) {
      const periods = this.periodsFor(obligation.frequency, startYear);
      if (periods.length === 0) {
        skipped.push({
          code: obligation.code,
          reason: `Frequency ${obligation.frequency} does not repeat inside a financial year; schedule it manually.`,
        });
        continue;
      }
      processed++;

      for (const period of periods) {
        const raw = dueDateFrom(period.periodEnd, obligation.dueMonthOffset, obligation.dueDay);
        const adjusted = nextWorkingDay(raw);
        const movedForWeekend = adjusted !== raw;
        if (movedForWeekend) weekendAdjusted++;

        const entry: CalendarUpsertInput = {
          obligationId: obligation.id,
          financialYear: fy,
          periodLabel: period.label,
          monthKey: period.monthKey,
          quarter: period.quarter,
          stateCode: obligation.stateCode,
          dueDate: adjusted,
          originalDueDate: movedForWeekend ? raw : null,
          extensionReason: movedForWeekend
            ? `${AUTO_ADJUSTMENT_PREFIX}statutory due date ${raw} fell on a weekend; moved to the next working day.`
            : null,
        };

        const match = existingByKey.get(key(obligation.id, period.label, obligation.stateCode));
        if (match) {
          const changed = await this.repo.refreshCalendarDates(match.id, entry);
          if (changed > 0) updated++;
          else unchanged++;
        } else {
          await this.repo.insertCalendarEntry(entry);
          created++;
        }
      }
    }

    await this.repo.logAudit({
      entityType: 'compliance_calendar',
      action: 'GENERATE',
      summary: `Generated the compliance calendar for ${fy}: ${created} new, ${updated} refreshed`,
      actorUserId: userId,
    });

    const entries = await this.repo.listCalendar({ financialYear: fy, limit: 1000 });
    return {
      financialYear: fy,
      obligationsProcessed: processed,
      obligationsSkipped: skipped,
      created,
      updated,
      unchanged,
      weekendAdjusted,
      entries,
      adjustmentNote: WEEKEND_NOTE,
    };
  }

  /**
   * The reporting periods an obligation produces inside one financial year.
   * Quarters follow the Indian convention: Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar.
   */
  private periodsFor(frequency: ObligationResponse['frequency'], startYear: number): GeneratedPeriod[] {
    const fyLabel = `${startYear}-${startYear + 1}`;
    switch (frequency) {
      case 'MONTHLY':
        return Array.from({ length: 12 }, (_, index) => {
          const monthNumber = ((3 + index) % 12) + 1; // April = 4 ... March = 3
          const year = index < 9 ? startYear : startYear + 1;
          return {
            label: monthLabel(year, monthNumber),
            monthKey: `${year}-${String(monthNumber).padStart(2, '0')}`,
            quarter: Math.floor(index / 3) + 1,
            periodEnd: lastDayOf(year, monthNumber),
          };
        });
      case 'QUARTERLY':
        return [
          { label: `Q1 ${fyLabel}`, monthKey: `${startYear}-06`, quarter: 1, periodEnd: lastDayOf(startYear, 6) },
          { label: `Q2 ${fyLabel}`, monthKey: `${startYear}-09`, quarter: 2, periodEnd: lastDayOf(startYear, 9) },
          { label: `Q3 ${fyLabel}`, monthKey: `${startYear}-12`, quarter: 3, periodEnd: lastDayOf(startYear, 12) },
          { label: `Q4 ${fyLabel}`, monthKey: `${startYear + 1}-03`, quarter: 4, periodEnd: lastDayOf(startYear + 1, 3) },
        ];
      case 'HALF_YEARLY':
        return [
          { label: `H1 ${fyLabel}`, monthKey: `${startYear}-09`, quarter: 2, periodEnd: lastDayOf(startYear, 9) },
          { label: `H2 ${fyLabel}`, monthKey: `${startYear + 1}-03`, quarter: 4, periodEnd: lastDayOf(startYear + 1, 3) },
        ];
      case 'ANNUAL':
        return [
          { label: `FY ${fyLabel}`, monthKey: `${startYear + 1}-03`, quarter: 4, periodEnd: lastDayOf(startYear + 1, 3) },
        ];
      default:
        return [];
    }
  }

  // -------------------------------------------------------------------------
  // Status maintenance
  // -------------------------------------------------------------------------

  /**
   * Ages the calendar. COMPLETED, WAIVED and NOT_APPLICABLE are never touched:
   * an obligation that has been dealt with does not become overdue later.
   */
  async refreshStatuses(): Promise<{ markedOverdue: number; markedDueSoon: number; asOf: string }> {
    const result = await this.repo.refreshCalendarStatuses();
    return { ...result, asOf: todayString() };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getCalendar(filters: CalendarFilters = {}): Promise<CalendarEntryResponse[]> {
    if (filters.financialYear) filters.financialYear = this.normaliseFy(filters.financialYear);
    if (filters.month && !/^\d{4}-\d{2}$/.test(filters.month)) {
      throw new Error("Month must look like '2026-07'");
    }
    return this.repo.listCalendar(filters);
  }

  async getUpcoming(days = 30): Promise<CalendarEntryResponse[]> {
    return this.repo.getUpcoming(days);
  }

  async getOverdue(): Promise<CalendarEntryResponse[]> {
    return this.repo.getOverdue();
  }

  async getEntry(id: number): Promise<CalendarEntryResponse> {
    const entry = await this.repo.findCalendarById(id);
    if (!entry) throw new Error('Calendar entry not found');
    return entry;
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async markCompleted(id: number, input: CompleteCalendarInput, userId: number): Promise<CalendarEntryResponse> {
    const entry = await this.getEntry(id);
    if (entry.status === 'COMPLETED') throw new Error('This obligation is already marked completed');
    const completedOn = input.completedOn ?? todayString();

    await this.repo.updateCalendarEntry(id, {
      status: 'COMPLETED',
      completedOn,
      completedBy: userId,
      filingId: input.filingId ?? null,
      challanId: input.challanId ?? null,
      remarks: input.remarks ?? entry.remarks,
    });
    await this.repo.logAudit({
      entityType: 'compliance_calendar',
      entityId: id,
      action: 'COMPLETE',
      summary: `${entry.obligationCode} ${entry.periodLabel} marked completed on ${completedOn}`,
      fieldName: 'status',
      previousValue: entry.status,
      newValue: 'COMPLETED',
      actorUserId: userId,
    });
    return this.getEntry(id);
  }

  async markNotApplicable(id: number, reason: string, userId: number): Promise<CalendarEntryResponse> {
    if (!reason || !reason.trim()) throw new Error('A reason is required to mark an obligation not applicable');
    const entry = await this.getEntry(id);
    await this.repo.updateCalendarEntry(id, { status: 'NOT_APPLICABLE', remarks: reason.trim().slice(0, 500) });
    await this.repo.logAudit({
      entityType: 'compliance_calendar',
      entityId: id,
      action: 'NOT_APPLICABLE',
      summary: `${entry.obligationCode} ${entry.periodLabel} marked not applicable: ${reason.trim()}`,
      fieldName: 'status',
      previousValue: entry.status,
      newValue: 'NOT_APPLICABLE',
      actorUserId: userId,
    });
    return this.getEntry(id);
  }

  async waive(id: number, reason: string, userId: number): Promise<CalendarEntryResponse> {
    if (!reason || !reason.trim()) throw new Error('A reason is required to waive an obligation');
    const entry = await this.getEntry(id);
    await this.repo.updateCalendarEntry(id, { status: 'WAIVED', remarks: reason.trim().slice(0, 500) });
    await this.repo.logAudit({
      entityType: 'compliance_calendar',
      entityId: id,
      action: 'WAIVE',
      summary: `${entry.obligationCode} ${entry.periodLabel} waived: ${reason.trim()}`,
      fieldName: 'status',
      previousValue: entry.status,
      newValue: 'WAIVED',
      actorUserId: userId,
    });
    return this.getEntry(id);
  }

  /**
   * Government extensions move the deadline. The date first computed is kept in
   * `original_due_date` so the record still shows what the law asked for.
   */
  async extend(id: number, newDueDate: string, reason: string, userId: number): Promise<CalendarEntryResponse> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(newDueDate ?? ''))) {
      throw new Error("A new due date is required, formatted '2026-07-15'");
    }
    if (!reason || !reason.trim()) throw new Error('A reason is required to extend a due date');
    const entry = await this.getEntry(id);
    if (entry.status === 'COMPLETED') throw new Error('A completed obligation cannot be extended');

    await this.repo.updateCalendarEntry(id, {
      dueDate: newDueDate,
      originalDueDate: entry.originalDueDate ?? entry.dueDate,
      extensionReason: reason.trim().slice(0, 255),
      status: entry.status === 'OVERDUE' ? 'UPCOMING' : entry.status,
      // A new deadline deserves a fresh reminder.
      reminderSentAt: null,
    });
    await this.repo.logAudit({
      entityType: 'compliance_calendar',
      entityId: id,
      action: 'EXTEND',
      summary: `${entry.obligationCode} ${entry.periodLabel} extended to ${newDueDate}: ${reason.trim()}`,
      fieldName: 'due_date',
      previousValue: entry.dueDate,
      newValue: newDueDate,
      actorUserId: userId,
    });
    return this.getEntry(id);
  }

  async assignOwner(id: number, ownerUserId: number, actorUserId: number): Promise<CalendarEntryResponse> {
    if (!Number.isFinite(ownerUserId) || ownerUserId <= 0) throw new Error('A valid owner user id is required');
    const entry = await this.getEntry(id);
    await this.repo.updateCalendarEntry(id, { ownerUserId });
    await this.repo.logAudit({
      entityType: 'compliance_calendar',
      entityId: id,
      action: 'ASSIGN',
      summary: `${entry.obligationCode} ${entry.periodLabel} assigned to user ${ownerUserId}`,
      fieldName: 'owner_user_id',
      previousValue: entry.ownerUserId === null ? null : String(entry.ownerUserId),
      newValue: String(ownerUserId),
      actorUserId,
    });

    await this.notifications.notify({
      userId: ownerUserId,
      category: 'POLICY',
      priority: 'NORMAL',
      title: `You own ${entry.obligationName} (${entry.periodLabel})`,
      body: `Due ${entry.dueDate}. Authority: ${entry.authority ?? 'not recorded'}.`,
      linkPage: 'compliance',
      linkRefId: id,
      createdBy: actorUserId,
    });
    return this.getEntry(id);
  }

  // -------------------------------------------------------------------------
  // Reminders
  // -------------------------------------------------------------------------

  /**
   * One reminder per calendar entry, ever. `reminder_sent_at` is stamped after
   * the notifications go out, so a scheduler that runs this hourly does not
   * turn a due date into a daily broadcast.
   */
  async sendReminders(): Promise<{
    candidates: number;
    notified: number;
    recipients: number;
    entries: { id: number; obligation: string; periodLabel: string; dueDate: string; status: string }[];
  }> {
    const candidates = await this.repo.findReminderCandidates();
    const sentIds: number[] = [];
    let recipients = 0;

    for (const entry of candidates) {
      const overdue = entry.status === 'OVERDUE' || entry.daysToDue < 0;
      const title = overdue
        ? `Overdue: ${entry.obligationName} (${entry.periodLabel})`
        : `Due ${entry.dueDate}: ${entry.obligationName} (${entry.periodLabel})`;
      const body = [
        `Obligation ${entry.obligationCode} for ${entry.periodLabel} is due on ${entry.dueDate}.`,
        entry.authority ? `Authority: ${entry.authority}.` : null,
        overdue ? 'This deadline has already passed.' : `${entry.daysToDue} day(s) remaining.`,
      ].filter(Boolean).join(' ');

      const count = await this.notifications.notifyRoles(['admin', 'accountant', 'hr'], {
        category: 'POLICY',
        priority: overdue ? 'HIGH' : 'NORMAL',
        title,
        body,
        linkPage: 'compliance',
        linkRefId: entry.id,
      });
      recipients += count;
      sentIds.push(entry.id);
    }

    const notified = await this.repo.markRemindersSent(sentIds);
    return {
      candidates: candidates.length,
      notified,
      recipients,
      entries: candidates.map((e) => ({
        id: e.id,
        obligation: e.obligationCode,
        periodLabel: e.periodLabel,
        dueDate: e.dueDate,
        status: e.status,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Obligations CRUD
  // -------------------------------------------------------------------------

  async listObligations(filters: { category?: string; frequency?: string; isActive?: boolean } = {}): Promise<ObligationResponse[]> {
    return this.repo.listObligations(filters);
  }

  async createObligation(data: Record<string, any>, userId: number): Promise<ObligationResponse> {
    if (!data.code || !data.name || !data.category) {
      throw new Error('An obligation needs a code, a name and a category');
    }
    const duplicate = await this.repo.findObligationByCode(String(data.code));
    if (duplicate) throw new Error(`An obligation with code ${data.code} already exists`);
    const id = await this.repo.createObligation(data, userId);
    const created = await this.repo.findObligationById(id);
    if (!created) throw new Error('Obligation could not be created');
    return created;
  }

  async updateObligation(id: number, data: Record<string, any>): Promise<ObligationResponse> {
    const existing = await this.repo.findObligationById(id);
    if (!existing) throw new Error('Obligation not found');
    await this.repo.updateObligation(id, data);
    const updated = await this.repo.findObligationById(id);
    if (!updated) throw new Error('Obligation not found');
    return updated;
  }

  /**
   * An obligation with calendar history is deactivated, not deleted: removing
   * it would cascade away the record of every filing made against it.
   */
  async deleteObligation(id: number): Promise<{ deleted: boolean; deactivated: boolean }> {
    const existing = await this.repo.findObligationById(id);
    if (!existing) throw new Error('Obligation not found');
    const used = await this.repo.countCalendarEntriesForObligation(id);
    if (used > 0) {
      await this.repo.updateObligation(id, { isActive: false });
      return { deleted: false, deactivated: true };
    }
    await this.repo.softDeleteObligation(id);
    return { deleted: true, deactivated: false };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private normaliseFy(financialYear: string): string {
    const fy = String(financialYear ?? '').trim();
    if (!/^\d{4}-\d{4}$/.test(fy)) throw new Error("Financial year must look like '2026-2027'");
    return fy;
  }
}
