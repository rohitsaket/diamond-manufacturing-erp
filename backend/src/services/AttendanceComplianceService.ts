import { AttendanceComplianceRepository, Observation } from '../repositories/AttendanceComplianceRepository';
import { AttendanceAuditRepository } from '../repositories/AttendanceAuditRepository';
import {
  AuditContext, ComplianceRule, ComplianceScanResult, ComplianceViolation,
  Paged, Severity, ViolationStatus,
} from '../types/attendance';
import { daysBetween, isValidDateString } from '../utils/dateUtils';

/** Scanning a very wide window is a mistake, not a request. */
const MAX_SCAN_DAYS = 400;

export class AttendanceComplianceService {
  private repo = new AttendanceComplianceRepository();
  private auditRepo = new AttendanceAuditRepository();

  // =========================================================================
  // Rules
  // =========================================================================
  async listRules(includeInactive = false): Promise<ComplianceRule[]> {
    return this.repo.listRules(includeInactive);
  }

  async createRule(data: Partial<ComplianceRule>, userId: number, ctx: AuditContext = {}): Promise<ComplianceRule[]> {
    if (!data.code || !data.name) throw new Error('A rule needs a code and a name');
    if (!data.ruleType) throw new Error('A rule type is required');
    const threshold = Number(data.thresholdValue);
    if (!Number.isFinite(threshold)) throw new Error('A numeric threshold is required');

    await this.repo.createRule(data, userId);
    await this.auditRepo.log({
      entityType: 'COMPLIANCE', action: 'CREATE',
      summary: `Created compliance rule ${data.code}: ${data.name}`,
      newValue: data as any, context: { ...ctx, userId },
    });
    return this.repo.listRules(true);
  }

  async updateRule(id: number, data: Partial<ComplianceRule>, userId: number, ctx: AuditContext = {}): Promise<ComplianceRule[]> {
    const current = await this.repo.findRuleById(id);
    if (!current) throw new Error('Compliance rule not found');
    await this.repo.updateRule(id, data, current);
    await this.auditRepo.log({
      entityType: 'COMPLIANCE', entityId: id, action: 'UPDATE',
      summary: `Updated compliance rule ${current.code}`,
      previousValue: current as any, newValue: data as any, context: { ...ctx, userId },
    });
    return this.repo.listRules(true);
  }

  async deleteRule(id: number): Promise<{ success: true }> {
    const rule = await this.repo.findRuleById(id);
    if (!rule) throw new Error('Compliance rule not found');
    await this.repo.deleteRule(id);
    return { success: true };
  }

  // =========================================================================
  // Scan
  // =========================================================================
  /**
   * Evaluate every active rule over a window and record what breaches.
   *
   * Rules the engine has no observation query for are reported in `skipped`
   * with the reason, rather than quietly counting as passed -- a compliance
   * report that silently omits a rule is worse than one that says it could not
   * check it.
   */
  async scan(from: string, to: string, userId: number, ctx: AuditContext = {}): Promise<ComplianceScanResult> {
    if (!isValidDateString(from) || !isValidDateString(to)) throw new Error('Invalid date range');
    if (to < from) throw new Error('Invalid date range: to must not be before from');
    const span = daysBetween(from, to);
    if (span > MAX_SCAN_DAYS) throw new Error(`A scan can cover at most ${MAX_SCAN_DAYS} days. This one covers ${span}.`);

    const rules = await this.repo.listRules(false);
    const skipped: { code: string; reason: string }[] = [];
    const bySeverity: Record<Severity, number> = { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    const employees = new Set<number>();
    let violationsFound = 0;
    let violationsNew = 0;

    // Each observation set is fetched once and reused by every rule of that
    // type, so ten daily-hours rules cost one query rather than ten.
    const cache = new Map<string, Observation[]>();
    const observationsFor = async (rule: ComplianceRule): Promise<Observation[] | null> => {
      const key = `${rule.ruleType}:${rule.thresholdValue}`;
      if (cache.has(key)) return cache.get(key)!;

      let rows: Observation[] | null;
      switch (rule.ruleType) {
        case 'MAX_DAILY_HOURS':
        case 'MIN_DAILY_HOURS':
          rows = await this.repo.dailyHours(from, to); break;
        case 'MAX_WEEKLY_HOURS':
          rows = await this.repo.weeklyHours(from, to); break;
        case 'MIN_REST_HOURS':
          rows = await this.repo.restGaps(from, to); break;
        case 'MAX_OT_MONTHLY':
        case 'MAX_OT_WEEKLY':
          rows = await this.repo.monthlyOvertime(from, to); break;
        case 'MANDATORY_WEEKLY_OFF':
          rows = await this.repo.weeklyOffCount(from, to); break;
        case 'MAX_CONSECUTIVE_DAYS':
          rows = await this.repo.consecutiveWorkDays(from, to); break;
        case 'MANDATORY_BREAK':
          rows = await this.repo.missingBreaks(from, to, rule.thresholdValue); break;
        default:
          rows = null;
      }
      if (rows) cache.set(key, rows);
      return rows;
    };

    for (const rule of rules) {
      if (rule.ruleType === 'NIGHT_SHIFT_LIMIT') {
        skipped.push({
          code: rule.code,
          reason: 'Night shift limits need per-shift night-hour accounting, which this engine does not compute yet.',
        });
        continue;
      }
      if (rule.ruleType === 'MAX_OT_WEEKLY') {
        skipped.push({
          code: rule.code,
          reason: 'Weekly overtime is evaluated against monthly totals only. Add a weekly overtime aggregate before relying on this rule.',
        });
        continue;
      }

      const observations = await observationsFor(rule);
      if (!observations) {
        skipped.push({ code: rule.code, reason: `No observation query exists for rule type ${rule.ruleType}` });
        continue;
      }

      const breaches = observations.filter((o) => this.breaches(o.value, rule));
      if (!breaches.length) continue;

      const existing = await this.repo.countExisting(
        rule.id,
        breaches.map((b) => ({ employeeId: b.employeeId, periodStart: b.periodStart })),
      );

      await this.repo.recordViolations(
        rule.id,
        rule.severity,
        breaches.map((b) => ({ ...b, thresholdValue: rule.thresholdValue })),
      );

      violationsFound += breaches.length;
      violationsNew += Math.max(0, breaches.length - existing);
      bySeverity[rule.severity] += breaches.length;
      for (const b of breaches) employees.add(b.employeeId);
    }

    await this.auditRepo.log({
      entityType: 'COMPLIANCE', action: 'SCAN',
      summary: `Compliance scan of ${from} to ${to}: ${violationsFound} breach(es) across ${rules.length - skipped.length} rule(s)`,
      newValue: { from, to, violationsFound, violationsNew, skipped: skipped.length },
      context: { ...ctx, userId },
    });

    return {
      scannedFrom: from,
      scannedTo: to,
      rulesEvaluated: rules.length - skipped.length,
      employeesScanned: employees.size,
      violationsFound,
      violationsNew,
      bySeverity,
      skipped,
    };
  }

  private breaches(value: number, rule: ComplianceRule): boolean {
    switch (rule.comparison) {
      case 'GT': return value > rule.thresholdValue;
      case 'GTE': return value >= rule.thresholdValue;
      case 'LT': return value < rule.thresholdValue;
      case 'LTE': return value <= rule.thresholdValue;
      default: return false;
    }
  }

  // =========================================================================
  // Violations
  // =========================================================================
  async listViolations(filters: {
    status?: ViolationStatus; severity?: Severity; ruleId?: number; employeeId?: number;
    from?: string; to?: string; page?: number; pageSize?: number;
  }): Promise<Paged<ComplianceViolation>> {
    return this.repo.listViolations(filters);
  }

  async resolveViolation(
    id: number,
    status: ViolationStatus,
    note: string | null,
    userId: number,
    ctx: AuditContext = {},
  ): Promise<{ success: true }> {
    const allowed: ViolationStatus[] = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'WAIVED'];
    if (!allowed.includes(status)) throw new Error(`Invalid status. Allowed: ${allowed.join(', ')}`);
    if (status === 'WAIVED' && !note) throw new Error('Waiving a violation requires a reason');

    await this.repo.resolveViolation(id, status, note, userId);
    await this.auditRepo.log({
      entityType: 'COMPLIANCE', entityId: id, action: status,
      summary: `Violation ${id} marked ${status.toLowerCase()}`,
      newValue: { status, note }, context: { ...ctx, userId },
    });
    return { success: true };
  }

  async summary(): Promise<{
    bySeverity: Record<string, number>;
    byStatus: Record<string, number>;
    total: number;
    rules: { total: number; active: number };
  }> {
    const [counts, rules] = await Promise.all([this.repo.summary(), this.repo.listRules(true)]);
    return {
      ...counts,
      rules: { total: rules.length, active: rules.filter((r) => r.status === 'ACTIVE').length },
    };
  }
}
