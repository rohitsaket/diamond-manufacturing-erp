import { SchedulingRepository } from '../repositories/SchedulingRepository';
import { AttendanceAuditRepository } from '../repositories/AttendanceAuditRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { HolidayRepository } from '../repositories/HolidayRepository';
import { LeaveRepository } from '../repositories/LeaveRepository';
import {
  AuditContext, Roster, RosterEntry, RotationPattern, ShiftAssignment, ShiftDetail,
} from '../types/attendance';
import { addDays, eachDate, isValidDateString } from '../utils/dateUtils';
import { hhmmToMinutes, parseWeekOffDays, shiftWindow } from '../utils/attendanceTime';

export interface RosterGenerateInput {
  code?: string;
  name: string;
  fromDate: string;
  toDate: string;
  branchId?: number | null;
  departmentId?: number | null;
  employeeIds?: number[];
  /** Default shift when an employee has no assignment or rotation. */
  defaultShiftId?: number | null;
  rotationPatternId?: number | null;
  respectHolidays?: boolean;
  respectLeave?: boolean;
  notes?: string | null;
}

/** How wide a roster one call may build, so a typo cannot generate millions of rows. */
const MAX_ROSTER_DAYS = 92;
const MAX_ROSTER_CELLS = 40000;

export class SchedulingService {
  private repo = new SchedulingRepository();
  private employeeRepo = new EmployeeRepository();
  private holidayRepo = new HolidayRepository();
  private leaveRepo = new LeaveRepository();
  private auditRepo = new AttendanceAuditRepository();

  // =========================================================================
  // Shifts
  // =========================================================================
  async listShifts(includeInactive = false): Promise<ShiftDetail[]> {
    return this.repo.listShifts(includeInactive);
  }

  async getShift(id: number): Promise<ShiftDetail> {
    const shift = await this.repo.findShiftById(id);
    if (!shift) throw new Error('Shift not found');
    return shift;
  }

  /**
   * Create a shift including the enterprise kinds the original service could
   * not express: cross-midnight nights, split shifts and flexible windows.
   * The classic three-field shift form still goes through AttendanceService,
   * which is untouched.
   */
  async createShift(data: Partial<ShiftDetail>, userId: number, ctx: AuditContext = {}): Promise<ShiftDetail> {
    const clean = this.validateShift(data, null);
    if (clean.code) {
      const clash = await this.repo.findShiftByCode(clean.code);
      if (clash) throw new Error(`Shift code "${clean.code}" is already in use`);
    }
    const id = await this.repo.createShift(clean, userId);
    await this.auditRepo.log({
      entityType: 'SHIFT', entityId: id, action: 'CREATE',
      summary: `Created ${clean.shiftType?.toLowerCase()} shift ${clean.name} (${clean.startTime}-${clean.endTime})`,
      newValue: clean as any, context: { ...ctx, userId },
    });
    return this.getShift(id);
  }

  async updateShift(id: number, data: Partial<ShiftDetail>, userId: number, ctx: AuditContext = {}): Promise<ShiftDetail> {
    const current = await this.repo.findShiftById(id);
    if (!current) throw new Error('Shift not found');
    const clean = this.validateShift(data, current);
    if (clean.code && clean.code !== current.code) {
      const clash = await this.repo.findShiftByCode(clean.code);
      if (clash && clash.id !== id) throw new Error(`Shift code "${clean.code}" is already in use`);
    }
    await this.repo.updateShiftExtras(id, clean, current, userId);
    await this.auditRepo.log({
      entityType: 'SHIFT', entityId: id, action: 'UPDATE',
      summary: `Updated shift ${current.name}`,
      previousValue: current as any, newValue: clean as any, context: { ...ctx, userId },
    });
    return this.getShift(id);
  }

  private validateShift(data: Partial<ShiftDetail>, current: ShiftDetail | null): Partial<ShiftDetail> {
    const name = String(data.name ?? current?.name ?? '').trim();
    if (!name) throw new Error('Shift name is required');

    const startTime = String(data.startTime ?? current?.startTime ?? '').trim();
    const endTime = String(data.endTime ?? current?.endTime ?? '').trim();
    if (!startTime || !endTime) throw new Error('Shift start and end times are required');

    const start = hhmmToMinutes(startTime);
    const end = hhmmToMinutes(endTime);
    if (start === null) throw new Error('Invalid shift start time: expected HH:MM');
    if (end === null) throw new Error('Invalid shift end time: expected HH:MM');

    const shiftType = data.shiftType ?? current?.shiftType ?? 'FIXED';
    // Only a NIGHT shift may wrap past midnight without being told to. For any
    // other type an end before the start is a typo, and inferring the wrap
    // would quietly create a fifteen-hour shift nobody asked for.
    const crossesMidnight = data.crossesMidnight
      ?? current?.crossesMidnight
      ?? (shiftType === 'NIGHT' && end <= start);
    if (end <= start && !crossesMidnight) {
      throw new Error(
        `Shift end time must be after start time. Set crossesMidnight if this ${shiftType.toLowerCase()} shift really runs past midnight.`,
      );
    }
    if (end <= start && crossesMidnight && !['NIGHT', 'ROTATIONAL', 'OPEN'].includes(shiftType)) {
      throw new Error(`A ${shiftType.toLowerCase()} shift cannot cross midnight. Use the NIGHT shift type for that.`);
    }

    const window = shiftWindow(startTime, endTime, crossesMidnight);
    const breakMinutes = Number(data.breakMinutes ?? current?.breakMinutes ?? 60);
    if (!Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes >= window.lengthMinutes) {
      throw new Error('Break minutes must be between 0 and the shift length');
    }

    const graceMinutes = Number(data.graceMinutes ?? current?.graceMinutes ?? 15);
    if (!Number.isFinite(graceMinutes) || graceMinutes < 0 || graceMinutes > 240) {
      throw new Error('Grace minutes must be between 0 and 240');
    }

    if (shiftType === 'SPLIT') {
      const s2 = data.secondStartTime ?? current?.secondStartTime;
      const e2 = data.secondEndTime ?? current?.secondEndTime;
      if (!s2 || !e2) throw new Error('A split shift needs a second start and end time');
      const s2m = hhmmToMinutes(s2);
      const e2m = hhmmToMinutes(e2);
      if (s2m === null || e2m === null) throw new Error('Invalid second segment time: expected HH:MM');
      if (e2m <= s2m) throw new Error('The second segment must end after it starts');
      if (s2m < end) throw new Error('The second segment must start after the first one ends');
    }

    if (shiftType === 'FLEXIBLE') {
      const cs = data.flexibleCoreStart ?? current?.flexibleCoreStart;
      const ce = data.flexibleCoreEnd ?? current?.flexibleCoreEnd;
      if (cs && ce) {
        const csm = hhmmToMinutes(cs);
        const cem = hhmmToMinutes(ce);
        if (csm === null || cem === null) throw new Error('Invalid core hours: expected HH:MM');
        if (cem <= csm) throw new Error('Core hours must end after they start');
        if (csm < start || cem > (crossesMidnight ? end + 1440 : end)) {
          throw new Error('Core hours must sit inside the flexible window');
        }
      }
    }

    const weekOffDays = data.weekOffDays ?? current?.weekOffDays ?? [0];
    for (const d of weekOffDays) {
      if (!Number.isInteger(d) || d < 0 || d > 6) throw new Error('Week off days must be 0 (Sunday) to 6 (Saturday)');
    }

    return {
      ...data,
      name, startTime, endTime, shiftType, crossesMidnight,
      isNightShift: data.isNightShift ?? current?.isNightShift ?? (shiftType === 'NIGHT' || crossesMidnight),
      breakMinutes, graceMinutes, weekOffDays,
      code: (data.code ?? current?.code ?? null)?.toUpperCase().trim() || null,
    };
  }

  // =========================================================================
  // Rotation patterns
  // =========================================================================
  async listRotations(): Promise<RotationPattern[]> {
    return this.repo.listRotations();
  }

  async createRotation(data: Partial<RotationPattern>, userId: number, ctx: AuditContext = {}): Promise<RotationPattern[]> {
    const pattern = Array.isArray(data.pattern) ? data.pattern.map((p) => String(p).trim().toUpperCase()) : [];
    if (!data.code || !data.name) throw new Error('A rotation needs a code and a name');
    if (!pattern.length) throw new Error('A rotation needs at least one day in its pattern');

    const cycleDays = Number(data.cycleDays ?? pattern.length);
    if (cycleDays !== pattern.length) {
      throw new Error(`Cycle length is ${cycleDays} but the pattern has ${pattern.length} entries`);
    }

    // Every non-OFF entry must name a real shift, or the rotation silently
    // produces blank days once it is in use.
    for (const code of pattern) {
      if (code === 'OFF') continue;
      const shift = await this.repo.findShiftByCode(code);
      if (!shift) throw new Error(`Pattern references shift code "${code}", which does not exist`);
    }

    await this.repo.createRotation({ ...data, pattern, cycleDays }, userId);
    await this.auditRepo.log({
      entityType: 'SHIFT', action: 'CREATE',
      summary: `Created rotation pattern ${data.name} over ${cycleDays} days`,
      newValue: { code: data.code, pattern }, context: { ...ctx, userId },
    });
    return this.repo.listRotations();
  }

  async deleteRotation(id: number): Promise<{ success: true }> {
    await this.repo.deleteRotation(id);
    return { success: true };
  }

  /** Project a rotation onto real dates so a planner can see it before applying. */
  async previewRotation(patternId: number, from: string, days: number, anchorDate?: string): Promise<{
    pattern: RotationPattern;
    days: { date: string; shiftCode: string; shiftName: string | null; isOff: boolean }[];
  }> {
    const pattern = await this.repo.findRotationById(patternId);
    if (!pattern) throw new Error('Rotation pattern not found');
    if (!isValidDateString(from)) throw new Error('Invalid date');

    const count = Math.min(120, Math.max(1, Math.trunc(Number(days) || pattern.cycleDays)));
    const anchor = anchorDate && isValidDateString(anchorDate) ? anchorDate : from;
    const shifts = await this.repo.listShifts(true);
    const byCode = new Map(shifts.filter((s) => s.code).map((s) => [s.code as string, s]));

    const out: { date: string; shiftCode: string; shiftName: string | null; isOff: boolean }[] = [];
    for (let i = 0; i < count; i += 1) {
      const date = addDays(from, i);
      const offset = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86400000);
      const index = ((offset % pattern.cycleDays) + pattern.cycleDays) % pattern.cycleDays;
      const code = pattern.pattern[index] ?? 'OFF';
      out.push({
        date,
        shiftCode: code,
        shiftName: code === 'OFF' ? null : byCode.get(code)?.name ?? null,
        isOff: code === 'OFF',
      });
    }
    return { pattern, days: out };
  }

  // =========================================================================
  // Effective-dated assignments
  // =========================================================================
  async listAssignments(employeeId?: number, activeOn?: string): Promise<ShiftAssignment[]> {
    return this.repo.listAssignments(employeeId, activeOn);
  }

  async assignShift(data: Partial<ShiftAssignment>, userId: number, ctx: AuditContext = {}): Promise<ShiftAssignment[]> {
    if (!data.employeeId) throw new Error('An employee is required');
    if (!data.effectiveFrom || !isValidDateString(data.effectiveFrom)) throw new Error('A valid effective-from date is required');
    if (data.effectiveTo && !isValidDateString(data.effectiveTo)) throw new Error('Invalid effective-to date');
    if (data.effectiveTo && data.effectiveTo < data.effectiveFrom) {
      throw new Error('The assignment end date is before its start date');
    }
    if (!data.shiftId && !data.rotationPatternId) {
      throw new Error('Either a shift or a rotation pattern is required');
    }

    const employee = await this.employeeRepo.findRowById(data.employeeId);
    if (!employee) throw new Error('Employee not found');

    if (data.shiftId) {
      const shift = await this.repo.findShiftById(data.shiftId);
      if (!shift) throw new Error('Shift not found');
      if (shift.maxEmployees) {
        const onShift = (await this.repo.listAssignments(undefined, data.effectiveFrom))
          .filter((a) => a.shiftId === data.shiftId && a.employeeId !== data.employeeId).length;
        if (onShift >= shift.maxEmployees) {
          throw new Error(`Shift "${shift.name}" is capped at ${shift.maxEmployees} employees and already has ${onShift} on ${data.effectiveFrom}`);
        }
      }
    }

    if (data.isPrimary !== false) await this.repo.closeOpenAssignments(data.employeeId, data.effectiveFrom);
    await this.repo.createAssignment(data, userId);

    await this.auditRepo.log({
      entityType: 'ASSIGNMENT', employeeId: data.employeeId, action: 'ASSIGN',
      summary: `${employee.full_name} assigned to ${data.shiftId ? `shift ${data.shiftId}` : `rotation ${data.rotationPatternId}`} from ${data.effectiveFrom}`,
      newValue: data as any, context: { ...ctx, userId },
    });

    return this.repo.listAssignments(data.employeeId);
  }

  async deleteAssignment(id: number): Promise<{ success: true }> {
    await this.repo.deleteAssignment(id);
    return { success: true };
  }

  /** Which shift applies to each employee on a date, resolved the same way the punch engine does. */
  async resolveForDate(date: string, employeeIds?: number[]): Promise<ShiftAssignment[]> {
    if (!isValidDateString(date)) throw new Error('Invalid date');
    const ids = employeeIds?.length
      ? employeeIds
      : (await this.employeeRepo.findWorkingEmployees()).map((e) => e.id);
    const map = await this.repo.resolveAssignments(ids, date);
    return Array.from(map.values());
  }

  // =========================================================================
  // Rosters
  // =========================================================================
  async listRosters(filters: { branchId?: number; departmentId?: number; status?: string; from?: string; to?: string } = {}): Promise<Roster[]> {
    return this.repo.listRosters(filters);
  }

  async getRoster(id: number): Promise<{ roster: Roster; entries: RosterEntry[] }> {
    const roster = await this.repo.findRosterById(id);
    if (!roster) throw new Error('Roster not found');
    const entries = await this.repo.listRosterEntries(id);
    return { roster, entries };
  }

  /**
   * Build a roster from the standing assignments, rotations, holiday calendar
   * and approved leave.
   *
   * Generation is a projection of what is already configured -- it invents no
   * coverage of its own. Days it cannot fill are left blank rather than being
   * padded with a default shift nobody chose.
   */
  async generateRoster(input: RosterGenerateInput, userId: number, ctx: AuditContext = {}): Promise<{
    roster: Roster;
    entries: number;
    warnings: string[];
  }> {
    if (!isValidDateString(input.fromDate) || !isValidDateString(input.toDate)) throw new Error('Invalid date range');
    if (input.toDate < input.fromDate) throw new Error('Invalid date range: end date is before the start date');

    const dates = eachDate(input.fromDate, input.toDate);
    if (dates.length > MAX_ROSTER_DAYS) {
      throw new Error(`A roster can span at most ${MAX_ROSTER_DAYS} days. This one covers ${dates.length}.`);
    }

    const warnings: string[] = [];
    const allEmployees = await this.employeeRepo.findWorkingEmployees();
    let employees = allEmployees;
    if (input.employeeIds?.length) {
      const wanted = new Set(input.employeeIds);
      employees = allEmployees.filter((e) => wanted.has(e.id));
    } else if (input.departmentId) {
      employees = allEmployees.filter((e) => e.department_id === input.departmentId);
    } else if (input.branchId) {
      employees = allEmployees.filter((e) => e.branch_id === input.branchId);
    }

    if (!employees.length) throw new Error('No working employees match that scope');
    if (employees.length * dates.length > MAX_ROSTER_CELLS) {
      throw new Error(
        `That scope produces ${employees.length * dates.length} roster cells, above the ${MAX_ROSTER_CELLS} limit. Narrow the date range or the employee set.`,
      );
    }

    const employeeIds = employees.map((e) => e.id);
    const [holidays, shifts] = await Promise.all([
      this.holidayRepo.findDateSet(input.fromDate, input.toDate),
      this.repo.listShifts(true),
    ]);
    const shiftById = new Map(shifts.map((s) => [s.id, s]));
    const shiftByCode = new Map(shifts.filter((s) => s.code).map((s) => [s.code as string, s]));

    // Approved leave, so a rostered day is not planned over an agreed absence.
    const leaveDays = new Set<string>();
    if (input.respectLeave !== false) {
      try {
        const requests = await this.leaveRepo.findRequests({
          status: 'APPROVED', from: input.fromDate, to: input.toDate,
        });
        for (const req of requests) {
          for (const date of eachDate(req.fromDate, req.toDate)) {
            leaveDays.add(`${req.employeeId}|${date}`);
          }
        }
      } catch {
        warnings.push('Approved leave could not be read, so the roster does not account for it');
      }
    }

    const code = input.code?.trim() || `ROS-${input.fromDate.replace(/-/g, '')}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const rosterId = await this.repo.createRoster({
      code, name: input.name, branchId: input.branchId ?? null,
      departmentId: input.departmentId ?? null, fromDate: input.fromDate, toDate: input.toDate,
      status: 'DRAFT', notes: input.notes ?? null,
    }, userId);

    const entries: Partial<RosterEntry>[] = [];
    let unresolved = 0;

    for (const date of dates) {
      const assignments = await this.repo.resolveAssignments(employeeIds, date);
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();

      for (const employee of employees) {
        const assignment = assignments.get(employee.id);
        let shift: ShiftDetail | null = null;

        if (assignment?.shiftId) {
          shift = shiftById.get(assignment.shiftId) ?? null;
        } else if (assignment?.rotationPatternId ?? input.rotationPatternId) {
          const patternId = assignment?.rotationPatternId ?? input.rotationPatternId!;
          const pattern = await this.repo.findRotationById(patternId);
          if (pattern?.pattern.length) {
            const anchor = assignment?.rotationAnchorDate ?? assignment?.effectiveFrom ?? input.fromDate;
            const offset = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86400000);
            const index = ((offset + (assignment?.rotationOffset ?? 0)) % pattern.cycleDays + pattern.cycleDays) % pattern.cycleDays;
            const patternCode = pattern.pattern[index];
            shift = patternCode && patternCode !== 'OFF' ? shiftByCode.get(patternCode) ?? null : null;
          }
        }

        if (!shift && input.defaultShiftId) shift = shiftById.get(input.defaultShiftId) ?? null;
        if (!shift && employee.shift_id) shift = shiftById.get(employee.shift_id) ?? null;

        const weekOff = parseWeekOffDays((shift?.weekOffDays ?? [0]).join(','), 0).includes(dow);
        const isHoliday = (input.respectHolidays !== false) && holidays.has(date);
        const isLeave = leaveDays.has(`${employee.id}|${date}`);

        if (!shift && !weekOff && !isHoliday && !isLeave) unresolved += 1;

        entries.push({
          employeeId: employee.id,
          workDate: date,
          shiftId: weekOff || isHoliday || isLeave ? null : shift?.id ?? null,
          isWeekOff: weekOff,
          isHoliday,
          isLeave,
          plannedHours: weekOff || isHoliday || isLeave ? 0 : shift?.fullDayHours ?? null,
        });
      }
    }

    const written = await this.repo.replaceRosterEntries(rosterId, entries);
    if (unresolved > 0) {
      warnings.push(`${unresolved} cell(s) have no shift: those employees have no assignment, rotation or standing shift for that day. They are left blank rather than filled with a guess.`);
    }

    await this.auditRepo.log({
      entityType: 'ROSTER', entityId: rosterId, action: 'CREATE',
      summary: `Generated roster ${code} covering ${employees.length} employees over ${dates.length} days`,
      newValue: { code, employees: employees.length, days: dates.length, unresolved },
      context: { ...ctx, userId },
    });

    const roster = await this.repo.findRosterById(rosterId);
    return { roster: roster!, entries: written, warnings };
  }

  async updateRosterEntries(rosterId: number, entries: Partial<RosterEntry>[], userId: number): Promise<{ written: number }> {
    const roster = await this.repo.findRosterById(rosterId);
    if (!roster) throw new Error('Roster not found');
    if (roster.status === 'LOCKED') throw new Error('This roster is locked and cannot be edited');

    const existing = await this.repo.listRosterEntries(rosterId);
    const byKey = new Map(existing.map((e) => [`${e.employeeId}|${e.workDate}`, e]));
    for (const patch of entries) {
      const key = `${patch.employeeId}|${patch.workDate}`;
      byKey.set(key, { ...(byKey.get(key) ?? {} as RosterEntry), ...patch } as RosterEntry);
    }

    const written = await this.repo.replaceRosterEntries(rosterId, Array.from(byKey.values()));
    await this.auditRepo.log({
      entityType: 'ROSTER', entityId: rosterId, action: 'UPDATE',
      summary: `Updated ${entries.length} cell(s) on roster ${roster.code}`,
      context: { userId },
    });
    return { written };
  }

  async setRosterStatus(id: number, status: 'DRAFT' | 'PUBLISHED' | 'LOCKED' | 'ARCHIVED', userId: number, ctx: AuditContext = {}): Promise<Roster> {
    const roster = await this.repo.findRosterById(id);
    if (!roster) throw new Error('Roster not found');
    if (roster.status === 'LOCKED' && status !== 'ARCHIVED') {
      throw new Error('A locked roster can only be archived');
    }
    if (status === 'PUBLISHED' && (roster.entryCount ?? 0) === 0) {
      throw new Error('Cannot publish an empty roster');
    }

    await this.repo.updateRosterStatus(id, status, userId);
    await this.auditRepo.log({
      entityType: 'ROSTER', entityId: id, action: status === 'PUBLISHED' ? 'APPROVE' : 'UPDATE',
      summary: `Roster ${roster.code} moved from ${roster.status} to ${status}`,
      previousValue: { status: roster.status }, newValue: { status },
      context: { ...ctx, userId },
    });
    return (await this.repo.findRosterById(id))!;
  }

  async deleteRoster(id: number): Promise<{ success: true }> {
    const roster = await this.repo.findRosterById(id);
    if (!roster) throw new Error('Roster not found');
    if (roster.status === 'PUBLISHED' || roster.status === 'LOCKED') {
      throw new Error('A published or locked roster cannot be deleted. Archive it instead.');
    }
    await this.repo.deleteRoster(id);
    return { success: true };
  }

  async swapEntries(entryIdA: number, entryIdB: number, userId: number, ctx: AuditContext = {}): Promise<{ success: true }> {
    await this.repo.swapRosterEntries(entryIdA, entryIdB);
    await this.auditRepo.log({
      entityType: 'ROSTER', action: 'UPDATE',
      summary: `Swapped roster entries ${entryIdA} and ${entryIdB}`,
      context: { ...ctx, userId },
    });
    return { success: true };
  }

  /**
   * Planned headcount by shift per day, plus the gap against each shift's cap.
   * This is the capacity view a planner needs before publishing.
   */
  async capacity(rosterId: number): Promise<{
    roster: Roster;
    days: { date: string; shifts: { shiftId: number | null; shiftName: string; planned: number; capacity: number | null; gap: number | null }[]; off: number }[];
  }> {
    const { roster, entries } = await this.getRoster(rosterId);
    const shifts = await this.repo.listShifts(true);
    const shiftById = new Map(shifts.map((s) => [s.id, s]));

    const byDate = new Map<string, Map<number | null, number>>();
    const offByDate = new Map<string, number>();

    for (const entry of entries) {
      if (entry.isWeekOff || entry.isHoliday || entry.isLeave) {
        offByDate.set(entry.workDate, (offByDate.get(entry.workDate) ?? 0) + 1);
        continue;
      }
      let bucket = byDate.get(entry.workDate);
      if (!bucket) { bucket = new Map(); byDate.set(entry.workDate, bucket); }
      bucket.set(entry.shiftId, (bucket.get(entry.shiftId) ?? 0) + 1);
    }

    const days = eachDate(roster.fromDate, roster.toDate).map((date) => {
      const bucket = byDate.get(date) ?? new Map<number | null, number>();
      return {
        date,
        off: offByDate.get(date) ?? 0,
        shifts: Array.from(bucket.entries()).map(([shiftId, planned]) => {
          const shift = shiftId === null ? null : shiftById.get(shiftId);
          const capacity = shift?.maxEmployees ?? null;
          return {
            shiftId,
            shiftName: shift?.name ?? 'Unassigned',
            planned,
            capacity,
            gap: capacity === null ? null : capacity - planned,
          };
        }).sort((a, b) => b.planned - a.planned),
      };
    });

    return { roster, days };
  }
}
