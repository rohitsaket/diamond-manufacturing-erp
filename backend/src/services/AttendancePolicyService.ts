import { AttendancePolicyRepository } from '../repositories/AttendancePolicyRepository';
import { AttendanceAuditRepository } from '../repositories/AttendanceAuditRepository';
import { AttendancePolicy, AuditContext, BreakType, CaptureMethod, PolicyAssignment } from '../types/attendance';
import { hhmmToMinutes } from '../utils/attendanceTime';
import { isValidDateString } from '../utils/dateUtils';

const CAPTURE_METHODS: CaptureMethod[] = [
  'WEB', 'MOBILE', 'KIOSK', 'BIOMETRIC', 'FACE', 'QR', 'NFC', 'RFID',
  'PALM', 'IRIS', 'MANUAL', 'IMPORT', 'AUTO', 'API',
];

const SCOPE_TYPES: PolicyAssignment['scopeType'][] = [
  'GLOBAL', 'COMPANY', 'BRANCH', 'DEPARTMENT', 'DIVISION', 'TEAM', 'JOB_GRADE', 'EMPLOYEE', 'WORKER_TYPE',
];

export class AttendancePolicyService {
  private repo = new AttendancePolicyRepository();
  private auditRepo = new AttendanceAuditRepository();

  async list(includeInactive = false): Promise<AttendancePolicy[]> {
    return this.repo.findAll(includeInactive);
  }

  async get(id: number): Promise<AttendancePolicy & { assignments: PolicyAssignment[] }> {
    const policy = await this.repo.findById(id);
    if (!policy) throw new Error('Attendance policy not found');
    const assignments = await this.repo.listAssignments(id);
    return { ...policy, assignments };
  }

  async resolveForEmployee(employeeId: number, date: string): Promise<AttendancePolicy> {
    if (!isValidDateString(date)) throw new Error('Invalid date');
    const policy = await this.repo.resolveForEmployee(employeeId, date);
    if (!policy) {
      throw new Error('No attendance policy applies to this employee and no default policy is configured');
    }
    return policy;
  }

  async create(data: Partial<AttendancePolicy>, userId: number, ctx: AuditContext = {}): Promise<AttendancePolicy> {
    const clean = this.validate(data, null);
    const existing = await this.repo.findByCode(clean.code!);
    if (existing) throw new Error(`Policy code "${clean.code}" is already in use`);

    const id = await this.repo.create(clean, userId);
    await this.auditRepo.log({
      entityType: 'POLICY', entityId: id, action: 'CREATE',
      summary: `Created attendance policy ${clean.name} (${clean.code})`,
      newValue: clean as any, context: { ...ctx, userId },
    });
    return this.get(id);
  }

  async update(id: number, data: Partial<AttendancePolicy>, userId: number, ctx: AuditContext = {}): Promise<AttendancePolicy> {
    const current = await this.repo.findById(id);
    if (!current) throw new Error('Attendance policy not found');

    const clean = this.validate(data, current);
    if (clean.code && clean.code !== current.code) {
      const clash = await this.repo.findByCode(clean.code);
      if (clash && clash.id !== id) throw new Error(`Policy code "${clean.code}" is already in use`);
    }

    await this.repo.update(id, clean, current, userId);
    await this.auditRepo.log({
      entityType: 'POLICY', entityId: id, action: 'UPDATE',
      summary: `Updated attendance policy ${current.name}`,
      previousValue: current as any, newValue: clean as any, context: { ...ctx, userId },
    });
    return this.get(id);
  }

  async remove(id: number, userId: number, ctx: AuditContext = {}): Promise<{ success: true }> {
    const policy = await this.repo.findById(id);
    if (!policy) throw new Error('Attendance policy not found');
    if (policy.isDefault) {
      throw new Error('Cannot delete the default policy. Make another policy the default first.');
    }

    // Deleting a policy that employees are still scoped to would silently move
    // them onto the default rule set, which is not the same thing as deleting
    // a rule they never used.
    const assignments = await this.repo.countAssignments(id);
    if (assignments > 0) {
      throw new Error(
        `Policy "${policy.name}" has ${assignments} assignment(s). Remove them first, or set the policy to INACTIVE to stop it applying.`,
      );
    }

    await this.repo.softDelete(id, userId);
    await this.auditRepo.log({
      entityType: 'POLICY', entityId: id, action: 'DELETE',
      summary: `Deleted attendance policy ${policy.name}`, context: { ...ctx, userId },
    });
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Assignments
  // -------------------------------------------------------------------------
  async listAssignments(policyId?: number): Promise<PolicyAssignment[]> {
    return this.repo.listAssignments(policyId);
  }

  async assign(data: Partial<PolicyAssignment>, userId: number, ctx: AuditContext = {}): Promise<PolicyAssignment[]> {
    if (!data.policyId) throw new Error('A policy is required');
    if (!data.scopeType || !SCOPE_TYPES.includes(data.scopeType)) {
      throw new Error(`Invalid scope type. Allowed: ${SCOPE_TYPES.join(', ')}`);
    }
    const policy = await this.repo.findById(data.policyId);
    if (!policy) throw new Error('Attendance policy not found');

    if (data.scopeType === 'WORKER_TYPE' && !data.scopeValue) {
      throw new Error('A worker-type scope needs a worker type value');
    }
    if (data.scopeType !== 'GLOBAL' && data.scopeType !== 'WORKER_TYPE' && !data.scopeId) {
      throw new Error(`A ${data.scopeType.toLowerCase().replace('_', ' ')} scope needs an id`);
    }

    await this.repo.createAssignment(data as Omit<PolicyAssignment, 'id'>, userId);
    await this.auditRepo.log({
      entityType: 'POLICY', entityId: data.policyId, action: 'ASSIGN',
      summary: `Applied policy ${policy.name} to ${data.scopeType.toLowerCase()} ${data.scopeValue ?? data.scopeId ?? 'all'}`,
      newValue: data as any, context: { ...ctx, userId },
    });
    return this.repo.listAssignments(data.policyId);
  }

  async unassign(id: number): Promise<{ success: true }> {
    await this.repo.deleteAssignment(id);
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Break types
  // -------------------------------------------------------------------------
  async listBreakTypes(includeInactive = false): Promise<BreakType[]> {
    return this.repo.listBreakTypes(includeInactive);
  }

  async createBreakType(data: Partial<BreakType>, userId: number): Promise<BreakType[]> {
    if (!data.code || !data.name) throw new Error('A break type needs a code and a name');
    const existing = await this.repo.findBreakTypeByCode(data.code);
    if (existing) throw new Error(`Break type code "${data.code}" is already in use`);
    this.validateBreakType(data);

    await this.repo.createBreakType(data, userId);
    return this.repo.listBreakTypes(true);
  }

  async updateBreakType(id: number, data: Partial<BreakType>): Promise<BreakType[]> {
    const current = await this.repo.findBreakTypeById(id);
    if (!current) throw new Error('Break type not found');
    this.validateBreakType({ ...current, ...data });
    await this.repo.updateBreakType(id, data, current);
    return this.repo.listBreakTypes(true);
  }

  async deleteBreakType(id: number): Promise<{ success: true }> {
    const current = await this.repo.findBreakTypeById(id);
    if (!current) throw new Error('Break type not found');
    await this.repo.deleteBreakType(id);
    return { success: true };
  }

  private validateBreakType(data: Partial<BreakType>): void {
    const def = Number(data.defaultMinutes ?? 30);
    const max = Number(data.maxMinutes ?? 60);
    if (!Number.isFinite(def) || def < 0 || def > 480) throw new Error('Default break minutes must be between 0 and 480');
    if (!Number.isFinite(max) || max < def) throw new Error('Maximum break minutes cannot be below the default');
    const perDay = Number(data.maxPerDay ?? 1);
    if (!Number.isInteger(perDay) || perDay < 1 || perDay > 10) throw new Error('Breaks per day must be between 1 and 10');

    if (data.earliestStart && data.latestEnd) {
      const s = hhmmToMinutes(data.earliestStart);
      const e = hhmmToMinutes(data.latestEnd);
      if (s === null || e === null) throw new Error('Invalid break window: expected HH:MM');
      if (e <= s) throw new Error('The break window must end after it starts');
    }
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------
  /**
   * Rejects rule sets that cannot hold together -- a half day above a full day,
   * a grace window longer than the shift, an overtime cap of zero with overtime
   * switched on. A policy that contradicts itself produces attendance nobody
   * can explain, so it is refused at the door rather than at compute time.
   */
  private validate(data: Partial<AttendancePolicy>, current: AttendancePolicy | null): Partial<AttendancePolicy> {
    const merged = { ...(current ?? {}), ...data } as Partial<AttendancePolicy>;

    const code = String(merged.code ?? '').trim().toUpperCase();
    if (!code) throw new Error('A policy code is required');
    if (!/^[A-Z0-9_-]{2,50}$/.test(code)) {
      throw new Error('A policy code may only contain letters, numbers, hyphens and underscores');
    }
    const name = String(merged.name ?? '').trim();
    if (!name) throw new Error('A policy name is required');

    const num = (key: keyof AttendancePolicy, label: string, min: number, max: number, fallback: number): number => {
      const raw = merged[key];
      const value = raw === undefined || raw === null ? fallback : Number(raw);
      if (!Number.isFinite(value) || value < min || value > max) {
        throw new Error(`${label} must be between ${min} and ${max}`);
      }
      return value;
    };

    const workingHours = num('workingHoursPerDay', 'Working hours per day', 1, 24, 8);
    const fullDay = num('fullDayHours', 'Full day hours', 1, 24, 8);
    const halfDay = num('halfDayHours', 'Half day hours', 0.5, 24, 4);
    const minPresent = num('minHoursForPresent', 'Minimum hours for present', 0.5, 24, 4);
    const maxDaily = num('maxHoursPerDay', 'Maximum hours per day', 1, 24, 12);
    const maxWeekly = num('maxHoursPerWeek', 'Maximum hours per week', 1, 168, 48);

    if (halfDay >= fullDay) throw new Error('Half day hours must be below full day hours');
    if (minPresent > fullDay) throw new Error('Minimum hours for present cannot exceed full day hours');
    if (maxDaily < fullDay) throw new Error('Maximum hours per day cannot be below full day hours');
    if (maxWeekly < maxDaily) throw new Error('Maximum hours per week cannot be below maximum hours per day');
    if (workingHours > maxDaily) throw new Error('Working hours per day cannot exceed the daily maximum');

    num('graceMinutes', 'Grace minutes', 0, 240, 15);
    num('lateAfterMinutes', 'Late-after minutes', 0, 240, 15);
    num('earlyExitGraceMinutes', 'Early exit grace minutes', 0, 240, 15);
    num('maxLatePerMonth', 'Maximum late arrivals per month', 0, 31, 3);
    num('latePenaltyAfterCount', 'Late penalty threshold', 0, 31, 3);

    const otEnabled = merged.otEnabled !== false;
    if (otEnabled) {
      const otMax = num('otMaxHoursPerDay', 'Maximum overtime per day', 0, 16, 4);
      const otMonthly = num('otMaxHoursPerMonth', 'Maximum overtime per month', 0, 400, 50);
      if (otMax === 0) throw new Error('Overtime is enabled but the daily cap is zero. Disable overtime or raise the cap.');
      if (otMonthly < otMax) throw new Error('The monthly overtime cap cannot be below the daily cap');
      num('otMinMinutes', 'Minimum overtime minutes', 0, 240, 30);
      num('otRoundingMinutes', 'Overtime rounding minutes', 0, 60, 15);
      num('otMultiplierWeekday', 'Weekday overtime multiplier', 0, 10, 1);
      num('otMultiplierWeekoff', 'Week-off overtime multiplier', 0, 10, 2);
      num('otMultiplierHoliday', 'Holiday overtime multiplier', 0, 10, 2);
      num('otMultiplierNight', 'Night overtime multiplier', 0, 10, 1.5);
    }

    num('maxPunchesPerDay', 'Maximum punches per day', 2, 100, 20);
    num('minMinutesBetweenPunches', 'Minimum minutes between punches', 0, 240, 1);
    num('minRestHoursBetweenShifts', 'Minimum rest hours between shifts', 0, 24, 11);
    num('maxConsecutiveWorkDays', 'Maximum consecutive work days', 1, 31, 6);
    num('offlineMaxAgeHours', 'Offline punch maximum age', 1, 720, 72);
    num('regularizationWindowDays', 'Regularization window', 0, 90, 7);
    num('maxRegularizationsPerMonth', 'Regularizations per month', 0, 31, 3);
    num('priority', 'Priority', 1, 1000, 100);

    const weekOffDays = merged.weekOffDays ?? [0];
    if (!Array.isArray(weekOffDays)) throw new Error('Week off days must be a list of weekday numbers');
    for (const d of weekOffDays) {
      if (!Number.isInteger(d) || d < 0 || d > 6) throw new Error('Week off days must be 0 (Sunday) to 6 (Saturday)');
    }
    if (weekOffDays.length >= 7) throw new Error('At least one day of the week must be a working day');

    const methods = merged.allowedCaptureMethods ?? CAPTURE_METHODS;
    if (!Array.isArray(methods) || !methods.length) {
      throw new Error('At least one capture method must be allowed, or nobody can punch');
    }
    for (const m of methods) {
      if (!CAPTURE_METHODS.includes(m)) throw new Error(`Unknown capture method "${m}"`);
    }
    if (merged.requireFaceMatch && !methods.includes('FACE')) {
      throw new Error('Face verification is required but FACE is not an allowed capture method');
    }

    if (merged.autoPunchOutEnabled) {
      const after = Number(merged.autoPunchOutAfterHours ?? 0);
      if (!Number.isFinite(after) || after <= fullDay || after > 24) {
        throw new Error(`Auto punch-out must happen after the full day (${fullDay} h) and within 24 hours`);
      }
    }

    if (merged.effectiveFrom && !isValidDateString(merged.effectiveFrom)) throw new Error('Invalid effective-from date');
    if (merged.effectiveTo && !isValidDateString(merged.effectiveTo)) throw new Error('Invalid effective-to date');
    if (merged.effectiveFrom && merged.effectiveTo && merged.effectiveTo < merged.effectiveFrom) {
      throw new Error('The policy end date is before its start date');
    }

    return { ...merged, code, name, weekOffDays, allowedCaptureMethods: methods };
  }
}
