import { BaseRepository } from './BaseRepository';
import { AttendancePolicy, BreakType, CaptureMethod, PolicyAssignment } from '../types/attendance';
import { parseCsvList, parseWeekOffDays } from '../utils/attendanceTime';
import { toDateString, toTimeString } from '../utils/dateUtils';

/** Columns written by create/update, in placeholder order. */
const POLICY_COLUMNS = [
  'code', 'name', 'description', 'company_id', 'is_default', 'priority',
  'working_hours_per_day', 'full_day_hours', 'half_day_hours', 'min_hours_for_present',
  'max_hours_per_day', 'max_hours_per_week',
  'grace_minutes', 'late_after_minutes', 'late_penalty_type', 'late_penalty_after_count',
  'max_late_per_month', 'early_exit_grace_minutes', 'early_exit_penalty_type',
  'half_day_enabled', 'week_off_days', 'alternate_week_off', 'week_off_paid', 'holiday_paid',
  'sandwich_leave_rule',
  'ot_enabled', 'ot_requires_approval', 'ot_min_minutes', 'ot_rounding_minutes',
  'ot_max_hours_per_day', 'ot_max_hours_per_month',
  'ot_multiplier_weekday', 'ot_multiplier_weekoff', 'ot_multiplier_holiday', 'ot_multiplier_night',
  'auto_absent_if_no_punch', 'auto_punch_out_enabled', 'auto_punch_out_after_hours',
  'auto_mark_week_off', 'auto_mark_holiday',
  'allowed_capture_methods', 'require_geofence', 'require_photo', 'require_face_match',
  'allow_remote_punch', 'allow_offline_punch', 'offline_max_age_hours', 'restrict_ip',
  'max_punches_per_day', 'min_minutes_between_punches',
  'min_rest_hours_between_shifts', 'max_consecutive_work_days', 'mandatory_break_after_hours',
  'regularization_enabled', 'regularization_window_days', 'max_regularizations_per_month',
  'effective_from', 'effective_to', 'status',
] as const;

export type PolicyInput = Partial<AttendancePolicy>;

export class AttendancePolicyRepository extends BaseRepository {
  // -------------------------------------------------------------------------
  // Policies
  // -------------------------------------------------------------------------
  async findAll(includeInactive = false): Promise<AttendancePolicy[]> {
    const rows = await this.query<any[]>(
      `SELECT p.*, (
         SELECT COUNT(*) FROM attendance_policy_assignments a
         WHERE a.policy_id = p.id AND a.deleted_at IS NULL
       ) AS assignment_count
       FROM attendance_policies p
       WHERE p.deleted_at IS NULL ${includeInactive ? '' : "AND p.status <> 'INACTIVE'"}
       ORDER BY p.is_default DESC, p.priority ASC, p.name ASC`,
    );
    return rows.map((r) => this.toPolicy(r));
  }

  async findById(id: number): Promise<AttendancePolicy | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM attendance_policies WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [id],
    );
    return rows[0] ? this.toPolicy(rows[0]) : null;
  }

  async findByCode(code: string): Promise<AttendancePolicy | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM attendance_policies WHERE code = ? AND deleted_at IS NULL LIMIT 1',
      [code],
    );
    return rows[0] ? this.toPolicy(rows[0]) : null;
  }

  async findDefault(): Promise<AttendancePolicy | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM attendance_policies
       WHERE deleted_at IS NULL AND status = 'ACTIVE'
       ORDER BY is_default DESC, priority ASC, id ASC LIMIT 1`,
    );
    return rows[0] ? this.toPolicy(rows[0]) : null;
  }

  /**
   * The policy that applies to an employee on a date.
   *
   * Specificity beats priority: an EMPLOYEE-scoped assignment wins over a
   * DEPARTMENT one, which wins over BRANCH, and so on. Within the same
   * specificity the lower `priority` number wins. Falls back to the default
   * policy so the engine always has a rule set to evaluate against.
   */
  async resolveForEmployee(employeeId: number, date: string): Promise<AttendancePolicy | null> {
    const rows = await this.query<any[]>(
      `SELECT p.*,
              CASE a.scope_type
                WHEN 'EMPLOYEE' THEN 1
                WHEN 'TEAM' THEN 2
                WHEN 'DEPARTMENT' THEN 3
                WHEN 'DIVISION' THEN 4
                WHEN 'JOB_GRADE' THEN 5
                WHEN 'BRANCH' THEN 6
                WHEN 'WORKER_TYPE' THEN 7
                WHEN 'COMPANY' THEN 8
                ELSE 9
              END AS specificity
       FROM attendance_policy_assignments a
       JOIN attendance_policies p ON p.id = a.policy_id AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
       JOIN employees e ON e.id = ?
       WHERE a.deleted_at IS NULL
         AND (a.effective_from IS NULL OR a.effective_from <= ?)
         AND (a.effective_to IS NULL OR a.effective_to >= ?)
         AND (p.effective_from IS NULL OR p.effective_from <= ?)
         AND (p.effective_to IS NULL OR p.effective_to >= ?)
         AND (
           a.scope_type = 'GLOBAL'
           OR (a.scope_type = 'EMPLOYEE' AND a.scope_id = e.id)
           OR (a.scope_type = 'DEPARTMENT' AND a.scope_id = e.department_id)
           OR (a.scope_type = 'DIVISION' AND a.scope_id = e.division_id)
           OR (a.scope_type = 'BRANCH' AND a.scope_id = e.branch_id)
           OR (a.scope_type = 'COMPANY' AND a.scope_id = e.company_id)
           OR (a.scope_type = 'JOB_GRADE' AND a.scope_id = e.job_grade_id)
           OR (a.scope_type = 'WORKER_TYPE' AND a.scope_value = e.worker_type)
           OR (a.scope_type = 'TEAM' AND a.scope_id IN (
                 SELECT tm.team_id FROM team_members tm
                 WHERE tm.employee_id = e.id AND tm.left_on IS NULL))
         )
       ORDER BY specificity ASC, p.priority ASC, p.id ASC
       LIMIT 1`,
      [employeeId, date, date, date, date],
    );
    if (rows[0]) return this.toPolicy(rows[0]);
    return this.findDefault();
  }

  /** Resolve for many employees at once so a day's recompute is one query. */
  async resolveForEmployees(employeeIds: number[], date: string): Promise<Map<number, AttendancePolicy>> {
    const out = new Map<number, AttendancePolicy>();
    if (!employeeIds.length) return out;

    const placeholders = employeeIds.map(() => '?').join(', ');
    const rows = await this.query<any[]>(
      `SELECT ranked.* FROM (
         SELECT p.*, e.id AS emp_id,
                ROW_NUMBER() OVER (
                  PARTITION BY e.id
                  ORDER BY CASE a.scope_type
                             WHEN 'EMPLOYEE' THEN 1 WHEN 'TEAM' THEN 2 WHEN 'DEPARTMENT' THEN 3
                             WHEN 'DIVISION' THEN 4 WHEN 'JOB_GRADE' THEN 5 WHEN 'BRANCH' THEN 6
                             WHEN 'WORKER_TYPE' THEN 7 WHEN 'COMPANY' THEN 8 ELSE 9 END ASC,
                           p.priority ASC, p.id ASC
                ) AS rn
         FROM employees e
         JOIN attendance_policy_assignments a ON a.deleted_at IS NULL
           AND (a.effective_from IS NULL OR a.effective_from <= ?)
           AND (a.effective_to IS NULL OR a.effective_to >= ?)
           AND (
             a.scope_type = 'GLOBAL'
             OR (a.scope_type = 'EMPLOYEE' AND a.scope_id = e.id)
             OR (a.scope_type = 'DEPARTMENT' AND a.scope_id = e.department_id)
             OR (a.scope_type = 'DIVISION' AND a.scope_id = e.division_id)
             OR (a.scope_type = 'BRANCH' AND a.scope_id = e.branch_id)
             OR (a.scope_type = 'COMPANY' AND a.scope_id = e.company_id)
             OR (a.scope_type = 'JOB_GRADE' AND a.scope_id = e.job_grade_id)
             OR (a.scope_type = 'WORKER_TYPE' AND a.scope_value = e.worker_type)
           )
         JOIN attendance_policies p ON p.id = a.policy_id
           AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
           AND (p.effective_from IS NULL OR p.effective_from <= ?)
           AND (p.effective_to IS NULL OR p.effective_to >= ?)
         WHERE e.id IN (${placeholders})
       ) ranked WHERE ranked.rn = 1`,
      [date, date, date, date, ...employeeIds],
    );

    for (const row of rows) out.set(Number(row.emp_id), this.toPolicy(row));

    if (out.size < employeeIds.length) {
      const fallback = await this.findDefault();
      if (fallback) {
        for (const id of employeeIds) if (!out.has(id)) out.set(id, fallback);
      }
    }
    return out;
  }

  async create(data: PolicyInput, userId: number): Promise<number> {
    const values = this.toColumnValues(data, null);
    const result = await this.query<any>(
      `INSERT INTO attendance_policies (${POLICY_COLUMNS.join(', ')}, created_by, updated_by)
       VALUES (${POLICY_COLUMNS.map(() => '?').join(', ')}, ?, ?)`,
      [...values, userId, userId],
    );
    const id = Number(result.insertId);
    if (data.isDefault) await this.clearOtherDefaults(id);
    return id;
  }

  async update(id: number, data: PolicyInput, current: AttendancePolicy, userId: number): Promise<void> {
    const values = this.toColumnValues(data, current);
    await this.query(
      `UPDATE attendance_policies
       SET ${POLICY_COLUMNS.map((c) => `${c} = ?`).join(', ')}, updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [...values, userId, id],
    );
    if (data.isDefault) await this.clearOtherDefaults(id);
  }

  async softDelete(id: number, userId: number): Promise<void> {
    await this.query(
      'UPDATE attendance_policies SET deleted_at = NOW(), updated_by = ? WHERE id = ?',
      [userId, id],
    );
  }

  async countAssignments(policyId: number): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT COUNT(*) AS n FROM attendance_policy_assignments WHERE policy_id = ? AND deleted_at IS NULL',
      [policyId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  private async clearOtherDefaults(keepId: number): Promise<void> {
    await this.query('UPDATE attendance_policies SET is_default = false WHERE id <> ? AND deleted_at IS NULL', [keepId]);
  }

  // -------------------------------------------------------------------------
  // Assignments
  // -------------------------------------------------------------------------
  async listAssignments(policyId?: number): Promise<PolicyAssignment[]> {
    const rows = await this.query<any[]>(
      `SELECT a.*, p.name AS policy_name,
              CASE a.scope_type
                WHEN 'EMPLOYEE' THEN (SELECT e.full_name FROM employees e WHERE e.id = a.scope_id)
                WHEN 'DEPARTMENT' THEN (SELECT d.name FROM departments d WHERE d.id = a.scope_id)
                WHEN 'DIVISION' THEN (SELECT dv.name FROM divisions dv WHERE dv.id = a.scope_id)
                WHEN 'BRANCH' THEN (SELECT b.name FROM branches b WHERE b.id = a.scope_id)
                WHEN 'COMPANY' THEN (SELECT c.name FROM companies c WHERE c.id = a.scope_id)
                WHEN 'TEAM' THEN (SELECT t.name FROM teams t WHERE t.id = a.scope_id)
                WHEN 'JOB_GRADE' THEN (SELECT g.name FROM job_grades g WHERE g.id = a.scope_id)
                WHEN 'WORKER_TYPE' THEN a.scope_value
                ELSE 'All employees'
              END AS scope_label
       FROM attendance_policy_assignments a
       JOIN attendance_policies p ON p.id = a.policy_id
       WHERE a.deleted_at IS NULL ${policyId ? 'AND a.policy_id = ?' : ''}
       ORDER BY a.policy_id, a.scope_type`,
      policyId ? [policyId] : [],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      policyId: Number(r.policy_id),
      policyName: r.policy_name,
      scopeType: r.scope_type,
      scopeId: r.scope_id === null ? null : Number(r.scope_id),
      scopeValue: r.scope_value ?? null,
      scopeLabel: r.scope_label ?? null,
      effectiveFrom: r.effective_from ? toDateString(r.effective_from) : null,
      effectiveTo: r.effective_to ? toDateString(r.effective_to) : null,
    }));
  }

  async createAssignment(data: Omit<PolicyAssignment, 'id'>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO attendance_policy_assignments
         (policy_id, scope_type, scope_id, scope_value, effective_from, effective_to, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.policyId, data.scopeType, data.scopeId ?? null, data.scopeValue ?? null,
        data.effectiveFrom ?? null, data.effectiveTo ?? null, userId,
      ],
    );
    return Number(result.insertId);
  }

  async deleteAssignment(id: number): Promise<void> {
    await this.query('UPDATE attendance_policy_assignments SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  // -------------------------------------------------------------------------
  // Break types
  // -------------------------------------------------------------------------
  async listBreakTypes(includeInactive = false): Promise<BreakType[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM break_types
       WHERE deleted_at IS NULL ${includeInactive ? '' : "AND status = 'ACTIVE'"}
       ORDER BY is_mandatory DESC, name ASC`,
    );
    return rows.map((r) => this.toBreakType(r));
  }

  async findBreakTypeByCode(code: string): Promise<BreakType | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM break_types WHERE code = ? AND deleted_at IS NULL LIMIT 1',
      [code],
    );
    return rows[0] ? this.toBreakType(rows[0]) : null;
  }

  async findBreakTypeById(id: number): Promise<BreakType | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM break_types WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [id],
    );
    return rows[0] ? this.toBreakType(rows[0]) : null;
  }

  async createBreakType(data: Partial<BreakType>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO break_types
         (code, name, company_id, is_paid, default_minutes, max_minutes, max_per_day,
          requires_approval, is_mandatory, earliest_start, latest_end, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code, data.name, data.companyId ?? null, data.isPaid ? 1 : 0,
        data.defaultMinutes ?? 30, data.maxMinutes ?? 60, data.maxPerDay ?? 1,
        data.requiresApproval ? 1 : 0, data.isMandatory ? 1 : 0,
        data.earliestStart ?? null, data.latestEnd ?? null, data.status ?? 'ACTIVE', userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateBreakType(id: number, data: Partial<BreakType>, current: BreakType): Promise<void> {
    await this.query(
      `UPDATE break_types SET name = ?, is_paid = ?, default_minutes = ?, max_minutes = ?,
         max_per_day = ?, requires_approval = ?, is_mandatory = ?, earliest_start = ?,
         latest_end = ?, status = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        data.name ?? current.name,
        (data.isPaid ?? current.isPaid) ? 1 : 0,
        data.defaultMinutes ?? current.defaultMinutes,
        data.maxMinutes ?? current.maxMinutes,
        data.maxPerDay ?? current.maxPerDay,
        (data.requiresApproval ?? current.requiresApproval) ? 1 : 0,
        (data.isMandatory ?? current.isMandatory) ? 1 : 0,
        data.earliestStart ?? current.earliestStart,
        data.latestEnd ?? current.latestEnd,
        data.status ?? current.status,
        id,
      ],
    );
  }

  async deleteBreakType(id: number): Promise<void> {
    await this.query('UPDATE break_types SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  // -------------------------------------------------------------------------
  // Mapping
  // -------------------------------------------------------------------------
  private toColumnValues(data: PolicyInput, current: AttendancePolicy | null): any[] {
    const pick = <K extends keyof AttendancePolicy>(key: K, fallback: AttendancePolicy[K]): AttendancePolicy[K] => {
      const value = data[key];
      if (value === undefined) return current ? current[key] : fallback;
      return value as AttendancePolicy[K];
    };
    const bool = (key: keyof AttendancePolicy, fallback: boolean): number =>
      (pick(key, fallback as any) ? 1 : 0);

    const weekOff = pick('weekOffDays', [0]);
    const methods = pick('allowedCaptureMethods', ['WEB', 'MOBILE', 'KIOSK', 'BIOMETRIC', 'QR', 'NFC', 'MANUAL', 'IMPORT'] as CaptureMethod[]);

    return [
      pick('code', ''),
      pick('name', ''),
      pick('description', null),
      pick('companyId', null),
      bool('isDefault', false),
      pick('priority', 100),
      pick('workingHoursPerDay', 8),
      pick('fullDayHours', 8),
      pick('halfDayHours', 4),
      pick('minHoursForPresent', 4),
      pick('maxHoursPerDay', 12),
      pick('maxHoursPerWeek', 48),
      pick('graceMinutes', 15),
      pick('lateAfterMinutes', 15),
      pick('latePenaltyType', 'WARN'),
      pick('latePenaltyAfterCount', 3),
      pick('maxLatePerMonth', 3),
      pick('earlyExitGraceMinutes', 15),
      pick('earlyExitPenaltyType', 'WARN'),
      bool('halfDayEnabled', true),
      (Array.isArray(weekOff) ? weekOff : [0]).join(','),
      pick('alternateWeekOff', null),
      bool('weekOffPaid', true),
      bool('holidayPaid', true),
      bool('sandwichLeaveRule', false),
      bool('otEnabled', true),
      bool('otRequiresApproval', true),
      pick('otMinMinutes', 30),
      pick('otRoundingMinutes', 15),
      pick('otMaxHoursPerDay', 4),
      pick('otMaxHoursPerMonth', 50),
      pick('otMultiplierWeekday', 1),
      pick('otMultiplierWeekoff', 2),
      pick('otMultiplierHoliday', 2),
      pick('otMultiplierNight', 1.5),
      bool('autoAbsentIfNoPunch', true),
      bool('autoPunchOutEnabled', false),
      pick('autoPunchOutAfterHours', null),
      bool('autoMarkWeekOff', true),
      bool('autoMarkHoliday', true),
      (Array.isArray(methods) ? methods : []).join(','),
      bool('requireGeofence', false),
      bool('requirePhoto', false),
      bool('requireFaceMatch', false),
      bool('allowRemotePunch', true),
      bool('allowOfflinePunch', true),
      pick('offlineMaxAgeHours', 72),
      bool('restrictIp', false),
      pick('maxPunchesPerDay', 20),
      pick('minMinutesBetweenPunches', 1),
      pick('minRestHoursBetweenShifts', 11),
      pick('maxConsecutiveWorkDays', 6),
      pick('mandatoryBreakAfterHours', null),
      bool('regularizationEnabled', true),
      pick('regularizationWindowDays', 7),
      pick('maxRegularizationsPerMonth', 3),
      pick('effectiveFrom', null),
      pick('effectiveTo', null),
      pick('status', 'ACTIVE'),
    ];
  }

  private toPolicy(r: any): AttendancePolicy {
    const num = (v: any, d = 0): number => (v === null || v === undefined ? d : Number(v));
    return {
      id: Number(r.id),
      code: r.code,
      name: r.name,
      description: r.description ?? null,
      companyId: r.company_id === null ? null : Number(r.company_id),
      isDefault: !!r.is_default,
      priority: num(r.priority, 100),

      workingHoursPerDay: num(r.working_hours_per_day, 8),
      fullDayHours: num(r.full_day_hours, 8),
      halfDayHours: num(r.half_day_hours, 4),
      minHoursForPresent: num(r.min_hours_for_present, 4),
      maxHoursPerDay: num(r.max_hours_per_day, 12),
      maxHoursPerWeek: num(r.max_hours_per_week, 48),

      graceMinutes: num(r.grace_minutes, 15),
      lateAfterMinutes: num(r.late_after_minutes, 15),
      latePenaltyType: r.late_penalty_type,
      latePenaltyAfterCount: num(r.late_penalty_after_count, 3),
      maxLatePerMonth: num(r.max_late_per_month, 3),
      earlyExitGraceMinutes: num(r.early_exit_grace_minutes, 15),
      earlyExitPenaltyType: r.early_exit_penalty_type,

      halfDayEnabled: !!r.half_day_enabled,
      weekOffDays: parseWeekOffDays(r.week_off_days, 0),
      alternateWeekOff: r.alternate_week_off ?? null,
      weekOffPaid: !!r.week_off_paid,
      holidayPaid: !!r.holiday_paid,
      sandwichLeaveRule: !!r.sandwich_leave_rule,

      otEnabled: !!r.ot_enabled,
      otRequiresApproval: !!r.ot_requires_approval,
      otMinMinutes: num(r.ot_min_minutes, 30),
      otRoundingMinutes: num(r.ot_rounding_minutes, 15),
      otMaxHoursPerDay: num(r.ot_max_hours_per_day, 4),
      otMaxHoursPerMonth: num(r.ot_max_hours_per_month, 50),
      otMultiplierWeekday: num(r.ot_multiplier_weekday, 1),
      otMultiplierWeekoff: num(r.ot_multiplier_weekoff, 2),
      otMultiplierHoliday: num(r.ot_multiplier_holiday, 2),
      otMultiplierNight: num(r.ot_multiplier_night, 1.5),

      autoAbsentIfNoPunch: !!r.auto_absent_if_no_punch,
      autoPunchOutEnabled: !!r.auto_punch_out_enabled,
      autoPunchOutAfterHours: r.auto_punch_out_after_hours === null ? null : Number(r.auto_punch_out_after_hours),
      autoMarkWeekOff: !!r.auto_mark_week_off,
      autoMarkHoliday: !!r.auto_mark_holiday,

      allowedCaptureMethods: parseCsvList(r.allowed_capture_methods) as CaptureMethod[],
      requireGeofence: !!r.require_geofence,
      requirePhoto: !!r.require_photo,
      requireFaceMatch: !!r.require_face_match,
      allowRemotePunch: !!r.allow_remote_punch,
      allowOfflinePunch: !!r.allow_offline_punch,
      offlineMaxAgeHours: num(r.offline_max_age_hours, 72),
      restrictIp: !!r.restrict_ip,
      maxPunchesPerDay: num(r.max_punches_per_day, 20),
      minMinutesBetweenPunches: num(r.min_minutes_between_punches, 1),

      minRestHoursBetweenShifts: num(r.min_rest_hours_between_shifts, 11),
      maxConsecutiveWorkDays: num(r.max_consecutive_work_days, 6),
      mandatoryBreakAfterHours: r.mandatory_break_after_hours === null ? null : Number(r.mandatory_break_after_hours),

      regularizationEnabled: !!r.regularization_enabled,
      regularizationWindowDays: num(r.regularization_window_days, 7),
      maxRegularizationsPerMonth: num(r.max_regularizations_per_month, 3),

      effectiveFrom: r.effective_from ? toDateString(r.effective_from) : null,
      effectiveTo: r.effective_to ? toDateString(r.effective_to) : null,
      status: r.status,
      assignmentCount: r.assignment_count === undefined ? undefined : Number(r.assignment_count),
    };
  }

  private toBreakType(r: any): BreakType {
    return {
      id: Number(r.id),
      code: r.code,
      name: r.name,
      companyId: r.company_id === null ? null : Number(r.company_id),
      isPaid: !!r.is_paid,
      defaultMinutes: Number(r.default_minutes ?? 30),
      maxMinutes: Number(r.max_minutes ?? 60),
      maxPerDay: Number(r.max_per_day ?? 1),
      requiresApproval: !!r.requires_approval,
      isMandatory: !!r.is_mandatory,
      earliestStart: toTimeString(r.earliest_start),
      latestEnd: toTimeString(r.latest_end),
      status: r.status,
    };
  }
}
