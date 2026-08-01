import { AttendanceRepository } from '../repositories/AttendanceRepository';
import { ShiftRepository, ShiftInput } from '../repositories/ShiftRepository';
import { HolidayRepository, HolidayInput } from '../repositories/HolidayRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { SettingRepository } from '../repositories/SettingRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import {
  AttendanceResponse,
  AttendanceStatus,
  AttendanceUpsertEntry,
  HolidayResponse,
  PunchImportResult,
  RegisterDayCell,
  RegisterRowResponse,
  ShiftResponse,
  StatutoryConfig,
} from '../types/hrms';
import {
  dayOfWeek,
  eachDate,
  isValidDateString,
  monthBounds,
  round2,
  timeToMinutes,
  toDateString,
  todayString,
} from '../utils/dateUtils';
import { parsePunchCsv } from '../utils/punchCsv';
import { parseStatutoryConfig } from '../utils/statutoryCalculator';

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'HOLIDAY', 'WEEK_OFF',
];

export interface BulkMarkEntry {
  employeeId: number;
  status: AttendanceStatus;
  otHours?: number;
  remarks?: string | null;
  leaveTypeId?: number | null;
}

export interface BulkMarkResult {
  date: string;
  marked: number;
}

export type PunchKind = 'IN' | 'OUT';

export interface SelfTodayResponse {
  date: string;
  canPunchIn: boolean;
  canPunchOut: boolean;
  record: AttendanceResponse | null;
}

interface DerivedPunch {
  workedHours: number;
  status: AttendanceStatus;
  otHours: number;
  isLate: boolean;
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export class AttendanceService {
  private repo = new AttendanceRepository();
  private shiftRepo = new ShiftRepository();
  private holidayRepo = new HolidayRepository();
  private employeeRepo = new EmployeeRepository();
  private settingRepo = new SettingRepository();
  private activityRepo = new ActivityRepository();

  // -------------------------------------------------------------------------
  // Daily sheet
  // -------------------------------------------------------------------------
  async getDaily(date: string): Promise<AttendanceResponse[]> {
    if (!date || !isValidDateString(date)) throw new Error('Invalid date');
    return this.repo.findByDate(date);
  }

  async getForEmployee(employeeId: number, from: string, to: string): Promise<AttendanceResponse[]> {
    if (!Number.isFinite(employeeId) || employeeId <= 0) throw new Error('Invalid employee id');
    if (!isValidDateString(from) || !isValidDateString(to)) throw new Error('Invalid date range');
    if (to < from) throw new Error('Invalid date range: to must not be before from');
    return this.repo.findForEmployee(employeeId, from, to);
  }

  // -------------------------------------------------------------------------
  // Monthly register
  // -------------------------------------------------------------------------
  async getRegister(month: string, employeeId?: number): Promise<RegisterRowResponse[]> {
    if (!month || !MONTH_PATTERN.test(month)) throw new Error('Invalid month: expected YYYY-MM');

    const { from, to } = monthBounds(month);
    const [allEmployees, rows, holidays, shifts] = await Promise.all([
      this.employeeRepo.findWorkingEmployees(),
      this.repo.findRegisterRows(from, to, employeeId),
      this.holidayRepo.findDateSet(from, to),
      this.shiftRepo.findAll(),
    ]);

    const employees = employeeId ? allEmployees.filter((e) => e.id === employeeId) : allEmployees;
    const shiftMap = new Map<number, ShiftResponse>(shifts.map((s) => [s.id, s]));
    const defaultShift = shifts.find((s) => s.isDefault) ?? null;

    const marked = new Map<number, Map<string, RegisterDayCell>>();
    for (const row of rows) {
      const empId = Number(row.employee_id);
      let byDate = marked.get(empId);
      if (!byDate) {
        byDate = new Map<string, RegisterDayCell>();
        marked.set(empId, byDate);
      }
      byDate.set(toDateString(row.att_date), { status: row.status, otHours: Number(row.ot_hours ?? 0) });
    }

    const dates = eachDate(from, to);
    const today = todayString();

    return employees.map((emp) => {
      const shift = (emp.shift_id ? shiftMap.get(emp.shift_id) : undefined) ?? defaultShift;
      const weekOffDay = shift?.weekOffDay ?? 0;
      const existing = marked.get(emp.id) ?? new Map<string, RegisterDayCell>();

      const days: Record<string, RegisterDayCell> = {};
      for (const date of dates) {
        const cell = existing.get(date);
        if (cell) {
          days[date] = cell;
          continue;
        }
        if (holidays.has(date)) {
          days[date] = { status: 'HOLIDAY', otHours: 0 };
          continue;
        }
        if (dayOfWeek(date) === weekOffDay) {
          days[date] = { status: 'WEEK_OFF', otHours: 0 };
          continue;
        }
        // Future days and unmarked past days stay empty.
        if (date > today) continue;
      }

      const totals = {
        present: 0, absent: 0, halfDay: 0, leave: 0, holiday: 0, weekOff: 0,
        otHours: 0, paidDays: 0, attendancePct: 0,
      };
      for (const cell of Object.values(days)) {
        switch (cell.status) {
          case 'PRESENT': totals.present += 1; break;
          case 'ABSENT': totals.absent += 1; break;
          case 'HALF_DAY': totals.halfDay += 1; break;
          case 'LEAVE': totals.leave += 1; break;
          case 'HOLIDAY': totals.holiday += 1; break;
          case 'WEEK_OFF': totals.weekOff += 1; break;
        }
        totals.otHours += Number(cell.otHours ?? 0);
      }

      totals.otHours = round2(totals.otHours);
      totals.paidDays = round2(
        totals.present + totals.halfDay * 0.5 + totals.leave + totals.holiday + totals.weekOff,
      );

      // Attendance % measures days actually worked against days the employee was
      // expected to work. Holidays and week-offs are excluded from both sides;
      // approved leave counts as an expected day that was not worked.
      const expectedDays = totals.present + totals.halfDay + totals.absent + totals.leave;
      const workedDays = totals.present + totals.halfDay * 0.5;
      totals.attendancePct = expectedDays <= 0
        ? 0
        : Math.min(100, Math.max(0, round1((workedDays / expectedDays) * 100)));

      return {
        employeeId: emp.id,
        employeeName: emp.full_name,
        empCode: emp.emp_code,
        workerType: emp.worker_type,
        days,
        totals,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Manual marking
  // -------------------------------------------------------------------------
  async bulkMark(date: string, entries: BulkMarkEntry[], userId: number): Promise<BulkMarkResult> {
    if (!date || !isValidDateString(date)) throw new Error('Invalid date');
    if (date > todayString()) throw new Error('Cannot mark attendance for a future date');
    if (!Array.isArray(entries) || entries.length === 0) throw new Error('At least one attendance entry is required');

    const upserts: AttendanceUpsertEntry[] = entries.map((entry) => {
      const employeeId = Number(entry.employeeId);
      if (!Number.isFinite(employeeId) || employeeId <= 0) throw new Error('Invalid employee id in attendance entry');
      if (!ATTENDANCE_STATUSES.includes(entry.status)) {
        throw new Error(`Invalid status "${entry.status}". Allowed: ${ATTENDANCE_STATUSES.join(', ')}`);
      }
      const otHours = entry.otHours === undefined || entry.otHours === null ? 0 : Number(entry.otHours);
      if (!Number.isFinite(otHours) || otHours < 0 || otHours > 24) {
        throw new Error('Overtime hours must be between 0 and 24');
      }
      return {
        employeeId,
        attDate: date,
        status: entry.status,
        leaveTypeId: entry.status === 'LEAVE' ? (entry.leaveTypeId ?? null) : null,
        otHours: round2(otHours),
        remarks: entry.remarks ?? null,
        source: 'MANUAL',
      };
    });

    await this.repo.bulkUpsert(upserts, userId);

    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'ATTENDANCE',
      action: 'BULK_MARK',
      summary: `Marked attendance for ${upserts.length} employee(s) on ${date}`,
      meta: { date, count: upserts.length },
    });

    return { date, marked: upserts.length };
  }

  // -------------------------------------------------------------------------
  // Biometric punch import
  // -------------------------------------------------------------------------
  async importPunchCsv(csvText: string, userId: number): Promise<PunchImportResult> {
    if (!csvText || !csvText.trim()) throw new Error('CSV content is required');

    const parsed = parsePunchCsv(csvText);
    const errors: { line: number; reason: string }[] = [...parsed.errors];

    const [empCodeMap, config, shifts] = await Promise.all([
      this.employeeRepo.getEmpCodeMap(),
      this.loadConfig(),
      this.shiftRepo.findAll(),
    ]);
    const shiftMap = new Map<number, ShiftResponse>(shifts.map((s) => [s.id, s]));
    const defaultShift = shifts.find((s) => s.isDefault) ?? null;

    const upserts: AttendanceUpsertEntry[] = [];

    for (const row of parsed.rows) {
      const employee = empCodeMap.get(row.empCode.trim().toUpperCase());
      if (!employee) {
        errors.push({ line: row.line, reason: `Unknown employee code "${row.empCode}"` });
        continue;
      }

      const shift = (employee.shiftId ? shiftMap.get(employee.shiftId) : undefined) ?? defaultShift;

      let derived: DerivedPunch;
      try {
        derived = this.derivePunch(row.inTime, row.outTime, shift, config);
      } catch (err: any) {
        errors.push({ line: row.line, reason: err?.message ?? 'Could not compute worked hours' });
        continue;
      }

      upserts.push({
        employeeId: employee.id,
        attDate: row.date,
        status: derived.status,
        shiftId: shift?.id ?? null,
        leaveTypeId: null,
        inTime: row.inTime,
        outTime: row.outTime,
        workedHours: derived.workedHours,
        otHours: derived.otHours,
        isLate: derived.isLate,
        source: 'IMPORT',
        remarks: null,
      });
    }

    if (upserts.length > 0) await this.repo.bulkUpsert(upserts, userId);

    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'ATTENDANCE',
      action: 'IMPORT_PUNCHES',
      summary: `Imported ${upserts.length} punch row(s), ${errors.length} skipped`,
      meta: { imported: upserts.length, skipped: errors.length },
    });

    return { imported: upserts.length, skipped: errors.length, errors };
  }

  // -------------------------------------------------------------------------
  // Self service
  // -------------------------------------------------------------------------
  async getSelfToday(employeeId: number): Promise<SelfTodayResponse> {
    if (!Number.isFinite(employeeId) || employeeId <= 0) throw new Error('Invalid employee id');
    const date = todayString();
    const record = await this.repo.findOne(employeeId, date);
    return {
      date,
      canPunchIn: !record?.inTime,
      canPunchOut: !!record?.inTime && !record?.outTime,
      record,
    };
  }

  async punch(employeeId: number, kind: PunchKind, userId: number): Promise<AttendanceResponse> {
    if (!Number.isFinite(employeeId) || employeeId <= 0) throw new Error('Invalid employee id');
    if (kind !== 'IN' && kind !== 'OUT') throw new Error('Punch kind must be IN or OUT');

    const employee = await this.employeeRepo.findRowById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const date = todayString();
    const now = this.currentTime();
    const existing = await this.repo.findOne(employeeId, date);
    const shift = await this.resolveShift(employee.shift_id);

    let entry: AttendanceUpsertEntry;

    if (kind === 'IN') {
      if (existing?.inTime) throw new Error('You have already punched in today');
      const startMinutes = shift ? timeToMinutes(shift.startTime) : null;
      const nowMinutes = timeToMinutes(now) ?? 0;
      entry = {
        employeeId,
        attDate: date,
        // The day is still in progress; punching out recomputes the real status.
        status: 'PRESENT',
        shiftId: shift?.id ?? null,
        leaveTypeId: null,
        inTime: now,
        outTime: null,
        workedHours: null,
        otHours: 0,
        isLate: startMinutes !== null && nowMinutes > startMinutes + (shift?.graceMinutes ?? 0),
        source: 'SELF_PUNCH',
        remarks: existing?.remarks ?? null,
      };
    } else {
      if (!existing?.inTime) throw new Error('Punch in first');
      const config = await this.loadConfig();
      const derived = this.derivePunch(existing.inTime, now, shift, config);
      entry = {
        employeeId,
        attDate: date,
        status: derived.status,
        shiftId: shift?.id ?? existing.shiftId ?? null,
        leaveTypeId: null,
        inTime: existing.inTime,
        outTime: now,
        workedHours: derived.workedHours,
        otHours: derived.otHours,
        isLate: derived.isLate,
        source: 'SELF_PUNCH',
        remarks: existing.remarks ?? null,
      };
    }

    await this.repo.bulkUpsert([entry], userId);

    await this.activityRepo.log({
      actorUserId: userId,
      employeeId,
      entityType: 'ATTENDANCE',
      action: kind === 'IN' ? 'PUNCH_IN' : 'PUNCH_OUT',
      summary: `${employee.full_name} punched ${kind === 'IN' ? 'in' : 'out'} at ${now} on ${date}`,
      meta: { date, time: now, kind },
    });

    const saved = await this.repo.findOne(employeeId, date);
    if (!saved) throw new Error('Attendance record not found after punch');
    return saved;
  }

  // -------------------------------------------------------------------------
  // Shifts
  // -------------------------------------------------------------------------
  async getShifts(): Promise<ShiftResponse[]> {
    return this.shiftRepo.findAll();
  }

  async createShift(data: ShiftInput, userId: number): Promise<ShiftResponse> {
    const clean = this.validateShift(data);
    const existing = await this.shiftRepo.findByName(clean.name);
    if (existing) throw new Error(`Shift "${clean.name}" already exists`);

    const id = await this.shiftRepo.create(clean, userId);
    const created = await this.shiftRepo.findById(id);
    if (!created) throw new Error('Shift not found after creation');

    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'SHIFT',
      entityId: id,
      action: 'CREATE',
      summary: `Created shift ${clean.name} (${clean.startTime}-${clean.endTime})`,
    });
    return created;
  }

  async updateShift(id: number, data: Partial<ShiftInput>, userId: number): Promise<ShiftResponse> {
    if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid shift id');
    const current = await this.shiftRepo.findById(id);
    if (!current) throw new Error('Shift not found');

    const merged = this.validateShift({
      name: data.name ?? current.name,
      startTime: data.startTime ?? current.startTime,
      endTime: data.endTime ?? current.endTime,
      breakMinutes: data.breakMinutes ?? current.breakMinutes,
      graceMinutes: data.graceMinutes ?? current.graceMinutes,
      weekOffDay: data.weekOffDay ?? current.weekOffDay,
      isDefault: data.isDefault ?? current.isDefault,
    });

    if (merged.name !== current.name) {
      const clash = await this.shiftRepo.findByName(merged.name);
      if (clash && clash.id !== id) throw new Error(`Shift "${merged.name}" already exists`);
    }

    await this.shiftRepo.update(id, merged, userId);
    const updated = await this.shiftRepo.findById(id);
    if (!updated) throw new Error('Shift not found');

    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'SHIFT',
      entityId: id,
      action: 'UPDATE',
      summary: `Updated shift ${updated.name}`,
    });
    return updated;
  }

  async deleteShift(id: number, userId: number): Promise<{ success: true }> {
    if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid shift id');
    const shift = await this.shiftRepo.findById(id);
    if (!shift) throw new Error('Shift not found');
    if (shift.isDefault) throw new Error('Cannot delete the default shift; make another shift the default first');

    await this.shiftRepo.softDelete(id);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'SHIFT',
      entityId: id,
      action: 'DELETE',
      summary: `Deleted shift ${shift.name}`,
    });
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Holidays
  // -------------------------------------------------------------------------
  async getHolidays(year?: number): Promise<HolidayResponse[]> {
    const resolved = year ?? new Date().getUTCFullYear();
    if (!Number.isFinite(resolved) || resolved < 1970 || resolved > 9999) throw new Error('Invalid year');
    return this.holidayRepo.findByYear(resolved);
  }

  async createHoliday(data: HolidayInput, userId: number): Promise<HolidayResponse> {
    const date = String(data.date ?? '').trim();
    const name = String(data.name ?? '').trim();
    if (!date) throw new Error('Holiday date is required');
    if (!isValidDateString(date)) throw new Error('Invalid date');
    if (!name) throw new Error('Holiday name is required');

    const id = await this.holidayRepo.create({ date, name, isOptional: !!data.isOptional }, userId);
    const created = (await this.holidayRepo.findById(id)) ?? (await this.holidayRepo.findByDate(date));
    if (!created) throw new Error('Holiday not found after creation');

    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'HOLIDAY',
      entityId: created.id,
      action: 'CREATE',
      summary: `Added holiday ${name} on ${date}`,
    });
    return created;
  }

  async deleteHoliday(id: number, userId: number): Promise<{ success: true }> {
    if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid holiday id');
    const holiday = await this.holidayRepo.findById(id);
    if (!holiday) throw new Error('Holiday not found');

    await this.holidayRepo.softDelete(id);
    await this.activityRepo.log({
      actorUserId: userId,
      entityType: 'HOLIDAY',
      entityId: id,
      action: 'DELETE',
      summary: `Removed holiday ${holiday.name} on ${holiday.date}`,
    });
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  private async loadConfig(): Promise<StatutoryConfig> {
    const settings = await this.settingRepo.getAll();
    return parseStatutoryConfig(settings);
  }

  private async resolveShift(shiftId: number | null): Promise<ShiftResponse | null> {
    if (shiftId) {
      const shift = await this.shiftRepo.findById(shiftId);
      if (shift) return shift;
    }
    return this.shiftRepo.findDefault();
  }

  /**
   * Worked hours, status, lateness and OT from a pair of punches.
   * Shared by the CSV importer and self-service punch-out so both agree.
   */
  private derivePunch(
    inTime: string | null,
    outTime: string | null,
    shift: ShiftResponse | null,
    config: StatutoryConfig,
  ): DerivedPunch {
    const inMinutes = inTime ? timeToMinutes(inTime) : null;
    const outMinutes = outTime ? timeToMinutes(outTime) : null;

    if (inMinutes !== null && outMinutes !== null && outMinutes <= inMinutes) {
      throw new Error('Out time must be after in time (overnight shifts are not supported)');
    }

    const breakMinutes = shift?.breakMinutes ?? 0;
    let workedHours = 0;
    if (inMinutes !== null && outMinutes !== null) {
      workedHours = round2(Math.max(0, (outMinutes - inMinutes - breakMinutes) / 60));
    }

    let status: AttendanceStatus = 'ABSENT';
    if (workedHours >= config.fullDayHours) status = 'PRESENT';
    else if (workedHours >= config.halfDayHours) status = 'HALF_DAY';

    let isLate = false;
    if (shift && inMinutes !== null) {
      const startMinutes = timeToMinutes(shift.startTime);
      if (startMinutes !== null) isLate = inMinutes > startMinutes + shift.graceMinutes;
    }

    let otHours = 0;
    if (shift && outMinutes !== null) {
      const endMinutes = timeToMinutes(shift.endTime);
      if (endMinutes !== null && outMinutes > endMinutes) {
        const extra = outMinutes - endMinutes;
        // Only credit OT past the configured threshold, in quarter-hour blocks.
        if (extra >= config.otMinMinutes) otHours = Math.floor((extra / 60) * 4) / 4;
      }
    }

    return { workedHours, status, otHours, isLate };
  }

  private validateShift(data: ShiftInput): ShiftInput {
    const name = String(data.name ?? '').trim();
    if (!name) throw new Error('Shift name is required');

    const startTime = String(data.startTime ?? '').trim();
    const endTime = String(data.endTime ?? '').trim();
    if (!startTime || !endTime) throw new Error('Shift start time and end time are required');

    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    if (startMinutes === null) throw new Error('Invalid shift start time: expected HH:MM');
    if (endMinutes === null) throw new Error('Invalid shift end time: expected HH:MM');
    if (endMinutes <= startMinutes) {
      throw new Error('Shift end time must be after start time (overnight shifts are not supported)');
    }

    const breakMinutes = Number(data.breakMinutes ?? 60);
    if (!Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes >= endMinutes - startMinutes) {
      throw new Error('Break minutes must be between 0 and the shift length');
    }

    const graceMinutes = Number(data.graceMinutes ?? 15);
    if (!Number.isFinite(graceMinutes) || graceMinutes < 0 || graceMinutes > 240) {
      throw new Error('Grace minutes must be between 0 and 240');
    }

    const weekOffDay = Number(data.weekOffDay ?? 0);
    if (!Number.isInteger(weekOffDay) || weekOffDay < 0 || weekOffDay > 6) {
      throw new Error('Week off day must be between 0 (Sunday) and 6 (Saturday)');
    }

    return {
      name,
      startTime: this.padTime(startTime),
      endTime: this.padTime(endTime),
      breakMinutes,
      graceMinutes,
      weekOffDay,
      isDefault: !!data.isDefault,
    };
  }

  private padTime(time: string): string {
    const minutes = timeToMinutes(time);
    if (minutes === null) return time;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  /** Server-local `HH:MM` for self-service punches. */
  private currentTime(): string {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
}
