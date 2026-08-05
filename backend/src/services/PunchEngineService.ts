import { AttendanceCredentialRepository } from '../repositories/AttendanceCredentialRepository';
import { AttendanceDayRepository, ComputedDay } from '../repositories/AttendanceDayRepository';
import { AttendanceDeviceRepository } from '../repositories/AttendanceDeviceRepository';
import { AttendancePolicyRepository } from '../repositories/AttendancePolicyRepository';
import { AttendancePunchRepository, PunchInsert } from '../repositories/AttendancePunchRepository';
import { AttendanceAuditRepository } from '../repositories/AttendanceAuditRepository';
import { AttendanceRequestRepository } from '../repositories/AttendanceRequestRepository';
import { SchedulingRepository } from '../repositories/SchedulingRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { HolidayRepository } from '../repositories/HolidayRepository';
import {
  AttendancePolicy, AuditContext, BreakRecord, CaptureMethod, DailyAttendanceDetail,
  Geofence, PunchInput, PunchRecord, PunchResult, PunchType, ShiftDetail, WorkMode,
} from '../types/attendance';
import { AttendanceStatus } from '../types/hrms';
import {
  alignToShift, hhmmToMinutes, localDateTime, minutesToHhmm, parseWeekOffDays,
  round2, roundOvertimeMinutes, shiftWindow, toZoned, zonedNow,
} from '../utils/attendanceTime';
import { distanceToPolygon, evaluateIpRules, haversineMetres, parseUserAgent, pointInPolygon } from '../utils/attendanceGeo';
import { addDays, isValidDateString } from '../utils/dateUtils';
import { faceProvider } from './FaceRecognitionProvider';
import { QrTokenService } from './QrTokenService';

export interface PunchContext extends AuditContext {
  /**
   * Null for a device push: a terminal has no user session, and writing 0 into
   * created_by would break the foreign key to users.
   */
  userId: number | null;
  actorRole?: string | null;
}

interface GeoOutcome {
  status: 'NOT_REQUIRED' | 'INSIDE' | 'OUTSIDE' | 'NO_FIX' | 'LOW_ACCURACY';
  geofence: Geofence | null;
  distanceM: number | null;
  blocked: boolean;
  message: string | null;
}

export interface RecomputeResult {
  employeeId: number;
  date: string;
  status: AttendanceStatus;
  workedHours: number;
  otHours: number;
  skippedLocked: boolean;
}

/**
 * The punch engine.
 *
 * A punch is an immutable event. The day is a derived summary recomputed from
 * the whole event stream every time -- never patched incrementally -- so a late
 * arriving offline batch produces the same answer as if it had arrived on time.
 */
export class PunchEngineService {
  private punchRepo = new AttendancePunchRepository();
  private dayRepo = new AttendanceDayRepository();
  private policyRepo = new AttendancePolicyRepository();
  private deviceRepo = new AttendanceDeviceRepository();
  private credRepo = new AttendanceCredentialRepository();
  private schedRepo = new SchedulingRepository();
  private employeeRepo = new EmployeeRepository();
  private holidayRepo = new HolidayRepository();
  private requestRepo = new AttendanceRequestRepository();
  private auditRepo = new AttendanceAuditRepository();
  private qrService = new QrTokenService();

  // =========================================================================
  // Recording a punch
  // =========================================================================
  async punch(input: PunchInput, ctx: PunchContext): Promise<PunchResult> {
    const employeeId = await this.resolveEmployee(input);
    const employee = await this.employeeRepo.findRowById(employeeId);
    if (!employee) throw new Error('Employee not found');
    if (employee.work_status !== 'WORKING') {
      throw new Error(`Cannot record a punch for ${employee.full_name}: the employee is marked ${employee.work_status}`);
    }

    const device = await this.resolveDevice(input);
    const timezone = input.timezone || device?.timezone || (await this.employeeTimezone(employeeId));

    // Offline punches carry their own capture instant; live ones use now.
    const instant = input.capturedAt ? new Date(input.capturedAt) : new Date();
    if (Number.isNaN(instant.getTime())) throw new Error('Invalid capturedAt timestamp');
    const zoned = toZoned(instant, timezone);

    const policy = await this.policyRepo.resolveForEmployee(employeeId, zoned.date);
    if (!policy) throw new Error('No attendance policy applies to this employee. Configure a default policy first.');

    const warnings: string[] = [];
    const method: CaptureMethod = (input.captureMethod ?? 'WEB') as CaptureMethod;

    // --- Policy gates -----------------------------------------------------
    if (policy.allowedCaptureMethods.length && !policy.allowedCaptureMethods.includes(method)) {
      throw new Error(`Policy "${policy.name}" does not allow punching by ${method}. Allowed: ${policy.allowedCaptureMethods.join(', ')}`);
    }

    const workMode: WorkMode = (input.workMode ?? 'OFFICE') as WorkMode;
    if (workMode === 'REMOTE' && !policy.allowRemotePunch) {
      throw new Error(`Policy "${policy.name}" does not allow remote punching`);
    }

    if (input.isOffline) {
      if (!policy.allowOfflinePunch) throw new Error(`Policy "${policy.name}" does not allow offline punches`);
      const ageHours = (Date.now() - instant.getTime()) / 3600000;
      if (ageHours > policy.offlineMaxAgeHours) {
        throw new Error(`This offline punch is ${Math.round(ageHours)} hours old, beyond the ${policy.offlineMaxAgeHours} hour limit`);
      }
    }

    // --- Idempotency ------------------------------------------------------
    // Two independent replay keys: one the client mints for offline capture,
    // one the terminal supplies for its own log. Either one matching means the
    // event is already recorded, so the original is returned untouched rather
    // than a second row being written or a unique-key error surfacing.
    const replayOf = input.clientPunchId
      ? await this.punchRepo.findByClientPunchId(employeeId, input.clientPunchId)
      : device && input.devicePunchRef
        ? await this.punchRepo.findByDeviceRef(device.id, input.devicePunchRef)
        : null;

    if (replayOf) {
      const attendance = await this.dayRepo.findDetail(employeeId, replayOf.punchDate);
      return {
        punch: replayOf,
        attendance: attendance ?? (await this.emptyDetail(employeeId, replayOf.punchDate)),
        warnings: ['This punch was already recorded, returning the original'],
        nextExpectedPunch: await this.nextExpected(employeeId, replayOf.punchDate),
      };
    }

    // --- IP restriction ---------------------------------------------------
    if (policy.restrictIp) {
      const rules = await this.credRepo.listIpRules();
      const decision = evaluateIpRules(ctx.ipAddress ?? null, rules);
      if (!decision.allowed) throw new Error(`Punch refused: ${decision.reason}`);
      if (decision.reason.includes('not IPv4')) warnings.push(decision.reason);
    }

    // --- Credentials ------------------------------------------------------
    let qrTokenId: number | null = null;
    let geofenceFromCredential: number | null = null;
    if (method === 'QR') {
      if (!input.qrToken) throw new Error('A QR token is required for a QR punch');
      const result = await this.qrService.validate(input.qrToken);
      if (!result.valid) throw new Error(`Punch refused: ${result.reason}`);
      qrTokenId = result.tokenId;
      geofenceFromCredential = result.geofenceId;
    }

    let nfcCardId: number | null = null;
    if (method === 'NFC' || method === 'RFID') {
      if (!input.cardUid) throw new Error('A card UID is required for a card punch');
      const card = await this.credRepo.findCardByUid(input.cardUid);
      if (!card) throw new Error(`Card ${input.cardUid} is not registered`);
      if (card.status !== 'ACTIVE') throw new Error(`Card ${input.cardUid} is marked ${card.status.toLowerCase()}`);
      if (card.employeeId && card.employeeId !== employeeId) {
        throw new Error('This card belongs to a different employee');
      }
      nfcCardId = card.id;
      await this.credRepo.recordCardUse(card.id);
    }

    // --- Face verification ------------------------------------------------
    let faceVerified = false;
    let faceMatchScore: number | null = null;
    let livenessPassed: boolean | null = null;
    let faceNote: string | null = null;

    if (method === 'FACE' || policy.requireFaceMatch) {
      const result = await faceProvider.verify(employeeId, input.faceImageRef ?? null);
      faceNote = result.note;
      faceVerified = result.verified;
      faceMatchScore = result.matchScore;
      livenessPassed = result.livenessPassed;

      if (!result.available && policy.requireFaceMatch) {
        throw new Error(`Punch refused: policy "${policy.name}" requires face verification but ${result.note}`);
      }
      if (!result.available) warnings.push(result.note);
      else if (!result.verified && policy.requireFaceMatch) {
        throw new Error(`Punch refused: face verification failed. ${result.note}`);
      }
    }

    if (policy.requirePhoto && !input.photoPath) {
      throw new Error(`Policy "${policy.name}" requires a photo with every punch`);
    }

    // --- Geofence ---------------------------------------------------------
    const punchType = await this.resolvePunchType(employeeId, zoned.date, input, device?.defaultPunchType ?? 'AUTO');
    const geo = await this.evaluateGeofence(employeeId, policy, input, punchType, geofenceFromCredential);
    if (geo.blocked) throw new Error(`Punch refused: ${geo.message}`);
    if (geo.message && geo.status !== 'INSIDE') warnings.push(geo.message);

    // --- Rate limiting ----------------------------------------------------
    const dayPunches = await this.punchRepo.findForDay(employeeId, zoned.date);
    if (dayPunches.length >= policy.maxPunchesPerDay) {
      throw new Error(`Policy "${policy.name}" allows at most ${policy.maxPunchesPerDay} punches a day and ${dayPunches.length} are already recorded`);
    }
    // The rule exists to stop a reader being double-tapped, so it measures the
    // gap to the *nearest* punch in either direction rather than to the latest
    // one. Comparing against the latest would falsely reject a backdated device
    // batch arriving out of order -- an 09:02 entry landing after an 18:40 exit
    // is nine hours away from it, not zero.
    //
    // Both sides are local wall-clock. Measuring the new instant against the
    // stored punch_at would be wrong: punch_at holds the time in the employee's
    // own zone, so on an IST server the difference came out negative and the
    // limit silently never fired at all.
    const newMinutes = hhmmToMinutes(zoned.timeSeconds);
    if (policy.minMinutesBetweenPunches > 0 && newMinutes !== null) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const p of dayPunches) {
        if (p.punchDate !== zoned.date) continue;
        const minutes = hhmmToMinutes(p.punchTime);
        if (minutes === null) continue;
        nearest = Math.min(nearest, Math.abs(newMinutes - minutes));
      }
      if (nearest < policy.minMinutesBetweenPunches) {
        throw new Error(
          `Wait ${policy.minMinutesBetweenPunches} minute(s) between punches. Another punch is already recorded ${nearest} minute(s) from this one.`,
        );
      }
    }

    const last = dayPunches[dayPunches.length - 1];
    if (last && last.punchType === punchType && punchType !== 'IN') {
      warnings.push(`Two ${punchType} punches in a row; the day will be computed from the pairs that do match up`);
    }

    // --- Persist ----------------------------------------------------------
    const shift = await this.resolveShift(employeeId, zoned.date);
    const agent = parseUserAgent(ctx.userAgent);

    const insert: PunchInsert = {
      employeeId,
      punchAt: zoned.dateTime,
      punchDate: zoned.date,
      punchTime: zoned.timeSeconds,
      timezone: zoned.timezone,
      utcOffsetMinutes: zoned.offsetMinutes,
      punchType,
      captureMethod: method,
      workMode,
      deviceId: device?.id ?? null,
      devicePunchRef: input.devicePunchRef ?? null,
      shiftId: shift?.id ?? null,
      projectRef: input.projectRef ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      accuracyM: input.accuracyM ?? null,
      geofenceId: geo.geofence?.id ?? null,
      geoStatus: geo.status,
      distanceM: geo.distanceM,
      addressLabel: geo.geofence?.address ?? null,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      browser: agent.browser,
      os: agent.os,
      nfcCardId,
      qrTokenId,
      photoPath: input.photoPath ?? null,
      faceVerified,
      faceMatchScore,
      livenessPassed,
      faceProviderNote: faceNote,
      clientPunchId: input.clientPunchId ?? null,
      isOffline: !!input.isOffline,
      capturedAt: input.capturedAt ? zoned.dateTime : null,
      status: 'ACCEPTED',
      isManualEntry: method === 'MANUAL',
      remarks: input.remarks ?? null,
      createdBy: ctx.userId || null,
    };

    const punchId = await this.punchRepo.insert(insert);
    if (qrTokenId) await this.qrService.consume(qrTokenId);
    if (device) await this.deviceRepo.recordSyncOutcome(device.id, 1);

    // --- Recompute --------------------------------------------------------
    await this.recomputeDay(employeeId, zoned.date, ctx.userId);
    // A cross-day shift's exit lands on the next calendar date, so that day is
    // recomputed too rather than left showing an orphan OUT punch.
    if (shift?.crossesMidnight) {
      await this.recomputeDay(employeeId, addDays(zoned.date, -1), ctx.userId);
    }

    const saved = await this.punchRepo.findById(punchId);
    const attendance = await this.dayRepo.findDetail(employeeId, zoned.date);

    await this.auditRepo.log({
      entityType: 'PUNCH',
      entityId: punchId,
      employeeId,
      attDate: zoned.date,
      action: `PUNCH_${punchType}`,
      summary: `${employee.full_name} recorded ${punchType} at ${zoned.time} by ${method}`,
      newValue: { punchType, method, workMode, geoStatus: geo.status, deviceId: device?.id ?? null },
      context: { ...ctx, latitude: input.latitude ?? null, longitude: input.longitude ?? null },
    });

    return {
      punch: saved!,
      attendance: attendance ?? (await this.emptyDetail(employeeId, zoned.date)),
      warnings,
      nextExpectedPunch: await this.nextExpected(employeeId, zoned.date),
    };
  }

  // =========================================================================
  // Recompute a day from its punches
  // =========================================================================
  /**
   * Rebuilds one employee-day. The result is a pure function of the punches,
   * the shift, the policy and the calendar, so running it twice changes
   * nothing and running it late gives the same answer as running it on time.
   */
  async recomputeDay(employeeId: number, date: string, userId: number | null): Promise<RecomputeResult> {
    if (!isValidDateString(date)) throw new Error('Invalid date');

    const [punches, employeeRow, policy, shift, holidays, existing] = await Promise.all([
      this.punchRepo.findForDay(employeeId, date),
      this.employeeRepo.findRowById(employeeId),
      this.policyRepo.resolveForEmployee(employeeId, date),
      this.resolveShift(employeeId, date),
      this.holidayRepo.findDateSet(date, date),
      this.dayRepo.findDetail(employeeId, date),
    ]);

    if (!employeeRow) throw new Error('Employee not found');
    if (!policy) throw new Error('No attendance policy applies to this employee');

    // Cross-day shifts: an exit after midnight belongs to the previous day's
    // shift, so pull the early punches from the following date in as well.
    let effectivePunches = punches;
    if (shift?.crossesMidnight) {
      const nextDay = await this.punchRepo.findForDay(employeeId, addDays(date, 1));
      const window = shiftWindow(shift.startTime, shift.endTime, true);
      const carryover = nextDay.filter((p) => {
        const minutes = hhmmToMinutes(p.punchTime) ?? 0;
        return minutes + 1440 <= window.endMinutes + 240;
      });
      effectivePunches = [...punches, ...carryover];
    }

    const computed = this.computeDay({
      employeeId,
      date,
      punches: effectivePunches,
      policy,
      shift,
      isHoliday: holidays.has(date),
      employee: employeeRow,
      previousStatus: existing?.status as AttendanceStatus | undefined,
      previousLeaveTypeId: existing?.id ? await this.leaveTypeFor(employeeId, date) : null,
    });

    const { id, skippedLocked } = await this.dayRepo.upsertComputed(computed.day, userId);

    if (!skippedLocked) {
      await this.punchRepo.replaceBreaksForDay(employeeId, date, id, computed.breaks, userId);

      if (computed.day.otHours > 0 && policy.otEnabled) {
        const multiplier = this.otMultiplier(computed.day.otType, policy);
        await this.requestRepo.upsertOvertime({
          employeeId,
          attDate: date,
          attendanceId: id,
          otType: computed.day.otType === 'NONE' ? 'WEEKDAY' : computed.day.otType,
          derivedHours: computed.day.otHours,
          requestedHours: computed.day.otHours,
          // Derived overtime is not payable until someone approves it, unless
          // the policy says approval is not needed.
          approvedHours: policy.otRequiresApproval ? 0 : computed.day.otHours,
          multiplier,
          status: policy.otRequiresApproval ? 'PENDING' : 'APPROVED',
          companyId: employeeRow.company_id ?? null,
          branchId: employeeRow.branch_id ?? null,
          departmentId: employeeRow.department_id ?? null,
          userId,
        });
      }
    }

    return {
      employeeId,
      date,
      status: computed.day.status,
      workedHours: computed.day.workedHours ?? 0,
      otHours: computed.day.otHours,
      skippedLocked,
    };
  }

  /** Recompute a whole range for one or all employees. */
  async recomputeRange(
    from: string,
    to: string,
    userId: number | null,
    employeeId?: number,
  ): Promise<{ days: number; skippedLocked: number; employees: number }> {
    if (!isValidDateString(from) || !isValidDateString(to)) throw new Error('Invalid date range');
    if (to < from) throw new Error('Invalid date range: to must not be before from');

    const employees = employeeId
      ? [{ id: employeeId }]
      : await this.employeeRepo.findWorkingEmployees();

    let days = 0;
    let skipped = 0;
    for (const emp of employees) {
      for (let date = from; date <= to; date = addDays(date, 1)) {
        const result = await this.recomputeDay(emp.id, date, userId);
        days += 1;
        if (result.skippedLocked) skipped += 1;
      }
    }
    return { days, skippedLocked: skipped, employees: employees.length };
  }

  // =========================================================================
  // Offline batch sync
  // =========================================================================
  /**
   * Replay a batch captured while the client was offline.
   *
   * Each entry carries a client-generated id, so re-sending the same batch is
   * a no-op rather than a duplicate. Entries are validated individually: one
   * bad row does not sink the batch, and the caller is told exactly which rows
   * were rejected and why.
   */
  async syncOfflineBatch(
    entries: PunchInput[],
    ctx: PunchContext,
  ): Promise<{ accepted: number; duplicates: number; rejected: { index: number; reason: string }[]; recomputed: number }> {
    const rejected: { index: number; reason: string }[] = [];
    let accepted = 0;
    let duplicates = 0;
    const touched = new Set<string>();

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!;
      try {
        if (!entry.clientPunchId) throw new Error('clientPunchId is required for an offline punch');
        const result = await this.punch({ ...entry, isOffline: true }, ctx);
        if (result.warnings.some((w) => w.startsWith('This punch was already recorded'))) duplicates += 1;
        else accepted += 1;
        touched.add(`${result.punch.employeeId}|${result.punch.punchDate}`);
      } catch (err: any) {
        rejected.push({ index: i, reason: err?.message ?? 'Unknown error' });
      }
    }

    return { accepted, duplicates, rejected, recomputed: touched.size };
  }

  // =========================================================================
  // Automation
  // =========================================================================
  /**
   * Close out days where someone punched in and never out.
   *
   * The punch is written as an AUTO capture and clearly marked, so the day is
   * never left permanently open but nobody is credited with hours they cannot
   * be shown to have worked -- the auto-out is placed at the shift end, not at
   * the moment the job happens to run.
   */
  async autoPunchOut(date: string, userId: number | null): Promise<{ closed: number; skipped: number; details: string[] }> {
    const board = await this.dayRepo.findDayBoard(date);
    const details: string[] = [];
    let closed = 0;
    let skipped = 0;

    const presence = await this.punchRepo.getPresenceState(date);

    for (const row of board) {
      const state = presence.get(row.employeeId);
      if (!state || (state.lastType !== 'IN' && state.lastType !== 'BREAK_IN')) continue;

      const policy = await this.policyRepo.resolveForEmployee(row.employeeId, date);
      if (!policy?.autoPunchOutEnabled) { skipped += 1; continue; }

      const shift = await this.resolveShift(row.employeeId, date);
      const cutoffMinutes = shift
        ? shiftWindow(shift.startTime, shift.endTime, shift.crossesMidnight).endMinutes
        : (hhmmToMinutes('18:00') ?? 1080);

      const outTime = minutesToHhmm(cutoffMinutes);
      await this.punchRepo.insert({
        employeeId: row.employeeId,
        punchAt: localDateTime(date, outTime),
        punchDate: date,
        punchTime: `${outTime}:00`,
        timezone: row.timezone ?? 'Asia/Kolkata',
        utcOffsetMinutes: 330,
        punchType: 'OUT',
        captureMethod: 'AUTO',
        workMode: row.workMode,
        shiftId: shift?.id ?? null,
        status: 'ACCEPTED',
        remarks: 'Auto punch-out: no exit punch was recorded. Placed at shift end, not at the time this ran.',
        createdBy: userId,
      });

      await this.recomputeDay(row.employeeId, date, userId);
      closed += 1;
      details.push(`${row.employeeName} closed at ${outTime}`);
    }

    return { closed, skipped, details };
  }

  /**
   * Mark unpunched working days absent.
   *
   * Only runs for dates already past, and never overwrites an existing record:
   * a holiday, week-off or approved leave already on the day wins.
   */
  async autoMarkAbsent(date: string, userId: number | null): Promise<{ marked: number; skipped: number }> {
    if (date >= zonedNow().date) throw new Error('Cannot auto-mark absence for today or a future date');

    const board = await this.dayRepo.findDayBoard(date);
    let marked = 0;
    let skipped = 0;

    for (const row of board) {
      if (row.status) { skipped += 1; continue; }
      const policy = await this.policyRepo.resolveForEmployee(row.employeeId, date);
      if (!policy?.autoAbsentIfNoPunch) { skipped += 1; continue; }
      await this.recomputeDay(row.employeeId, date, userId);
      marked += 1;
    }

    await this.auditRepo.log({
      entityType: 'ATTENDANCE',
      attDate: date,
      action: 'AUTO_ABSENT',
      summary: `Auto-marked ${marked} unpunched employee(s) absent on ${date}`,
      context: { userId },
    });

    return { marked, skipped };
  }

  // =========================================================================
  // Reads
  // =========================================================================
  async getDayDetail(employeeId: number, date: string): Promise<DailyAttendanceDetail> {
    const detail = await this.dayRepo.findDetail(employeeId, date);
    const [punches, breaks] = await Promise.all([
      this.punchRepo.findForDay(employeeId, date),
      this.punchRepo.findBreaksForDay(employeeId, date),
    ]);
    const base = detail ?? (await this.emptyDetail(employeeId, date));
    return { ...base, punches, breaks };
  }

  async getSelfStatus(employeeId: number): Promise<{
    date: string;
    timezone: string;
    state: 'NOT_STARTED' | 'IN' | 'ON_BREAK' | 'OUT';
    nextExpectedPunch: PunchType | null;
    canPunchIn: boolean;
    canPunchOut: boolean;
    canStartBreak: boolean;
    canEndBreak: boolean;
    workedMinutesSoFar: number;
    shift: { id: number; name: string; startTime: string; endTime: string; crossesMidnight: boolean } | null;
    attendance: DailyAttendanceDetail | null;
    punches: PunchRecord[];
  }> {
    const timezone = await this.employeeTimezone(employeeId);
    const now = zonedNow(timezone);
    const [punches, attendance, shift] = await Promise.all([
      this.punchRepo.findForDay(employeeId, now.date),
      this.dayRepo.findDetail(employeeId, now.date),
      this.resolveShift(employeeId, now.date),
    ]);

    const lastType = punches.length ? punches[punches.length - 1]!.punchType : null;
    const state = lastType === null ? 'NOT_STARTED'
      : lastType === 'IN' || lastType === 'BREAK_IN' ? 'IN'
        : lastType === 'BREAK_OUT' ? 'ON_BREAK'
          : 'OUT';

    // Minutes accumulated across every closed IN/OUT pair, plus the open one.
    let workedMinutes = 0;
    let openStart: number | null = null;
    for (const p of punches) {
      const minutes = hhmmToMinutes(p.punchTime) ?? 0;
      if (p.punchType === 'IN' || p.punchType === 'BREAK_IN') {
        if (openStart === null) openStart = minutes;
      } else if (openStart !== null) {
        workedMinutes += Math.max(0, minutes - openStart);
        openStart = null;
      }
    }
    if (openStart !== null) {
      const nowMinutes = hhmmToMinutes(now.time) ?? 0;
      workedMinutes += Math.max(0, nowMinutes - openStart);
    }

    return {
      date: now.date,
      timezone,
      state,
      nextExpectedPunch: state === 'NOT_STARTED' ? 'IN' : state === 'IN' ? 'OUT' : state === 'ON_BREAK' ? 'BREAK_IN' : null,
      canPunchIn: state === 'NOT_STARTED' || state === 'OUT',
      canPunchOut: state === 'IN',
      canStartBreak: state === 'IN',
      canEndBreak: state === 'ON_BREAK',
      workedMinutesSoFar: workedMinutes,
      shift: shift ? {
        id: shift.id, name: shift.name, startTime: shift.startTime,
        endTime: shift.endTime, crossesMidnight: shift.crossesMidnight,
      } : null,
      attendance,
      punches,
    };
  }

  // =========================================================================
  // Internals
  // =========================================================================
  /**
   * The whole day derivation, kept pure so it can be reasoned about and reused
   * by the recompute path, the importer and the roster projection alike.
   */
  private computeDay(args: {
    employeeId: number;
    date: string;
    punches: PunchRecord[];
    policy: AttendancePolicy;
    shift: ShiftDetail | null;
    isHoliday: boolean;
    employee: any;
    previousStatus?: AttendanceStatus;
    previousLeaveTypeId: number | null;
  }): { day: ComputedDay; breaks: Omit<BreakRecord, 'id' | 'breakTypeName'>[] } {
    const { date, punches, policy, shift, isHoliday, employee } = args;

    const weekOffDays = shift?.weekOffDays?.length ? shift.weekOffDays : policy.weekOffDays;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const isWeekOff = parseWeekOffDays(weekOffDays.join(','), 0).includes(dow);

    const window = shift
      ? shiftWindow(shift.startTime, shift.endTime, shift.crossesMidnight)
      : shiftWindow('09:00', '18:00', false);

    // --- Pair the punches -------------------------------------------------
    const sorted = [...punches].sort((a, b) => (a.punchAt < b.punchAt ? -1 : 1));
    const timeline = sorted.map((p) => ({
      punch: p,
      minutes: alignToShift(hhmmToMinutes(p.punchTime) ?? 0, window),
    }));

    let workMinutes = 0;
    let breakMinutesTotal = 0;
    let paidBreakMinutes = 0;
    let unpaidBreakMinutes = 0;
    const breaks: Omit<BreakRecord, 'id' | 'breakTypeName'>[] = [];

    let openWork: number | null = null;
    let openBreak: number | null = null;
    let firstIn: number | null = null;
    let lastOut: number | null = null;

    for (const item of timeline) {
      const { punch, minutes } = item;
      switch (punch.punchType) {
        case 'IN':
        case 'BREAK_IN':
          if (openBreak !== null) {
            const length = Math.max(0, minutes - openBreak);
            breakMinutesTotal += length;
            unpaidBreakMinutes += length;
            breaks.push({
              attendanceId: null, employeeId: args.employeeId, attDate: date, breakTypeId: null,
              startTime: minutesToHhmm(openBreak), endTime: minutesToHhmm(minutes),
              minutes: length, isPaid: false, isOpen: false, exceededByMinutes: 0,
              approvalStatus: 'NOT_REQUIRED', source: 'PUNCH', remarks: null,
            });
            openBreak = null;
          }
          if (openWork === null) openWork = minutes;
          if (firstIn === null) firstIn = minutes;
          break;

        case 'BREAK_OUT':
          if (openWork !== null) { workMinutes += Math.max(0, minutes - openWork); openWork = null; }
          if (openBreak === null) openBreak = minutes;
          break;

        case 'OUT':
          if (openWork !== null) { workMinutes += Math.max(0, minutes - openWork); openWork = null; }
          if (openBreak !== null) {
            const length = Math.max(0, minutes - openBreak);
            breakMinutesTotal += length;
            unpaidBreakMinutes += length;
            openBreak = null;
          }
          lastOut = minutes;
          break;
      }
    }

    // An unclosed IN means a missing punch, not free hours -- nothing is
    // credited past the last real event.
    const hasOpenPair = openWork !== null || openBreak !== null;

    // With no break punches at all, fall back to the shift's nominal break so
    // a floor that does not punch its lunch is not paid for it.
    if (!breaks.length && workMinutes > 0 && (shift?.breakMinutes ?? 0) > 0) {
      const nominal = shift!.breakMinutes;
      workMinutes = Math.max(0, workMinutes - nominal);
      breakMinutesTotal = nominal;
      unpaidBreakMinutes = nominal;
    }

    const grossMinutes = firstIn !== null && lastOut !== null ? Math.max(0, lastOut - firstIn) : 0;
    const workedHours = round2(workMinutes / 60);
    const grossHours = round2(grossMinutes / 60);

    // --- Status -----------------------------------------------------------
    const fullDay = shift?.fullDayHours ?? policy.fullDayHours;
    const halfDay = shift?.halfDayHours ?? policy.halfDayHours;

    let status: AttendanceStatus;
    if (punches.length === 0) {
      if (isHoliday && policy.autoMarkHoliday) status = 'HOLIDAY';
      else if (isWeekOff && policy.autoMarkWeekOff) status = 'WEEK_OFF';
      else if (args.previousStatus === 'LEAVE') status = 'LEAVE';
      else status = 'ABSENT';
    } else if (workedHours >= fullDay) {
      status = 'PRESENT';
    } else if (policy.halfDayEnabled && workedHours >= halfDay) {
      status = 'HALF_DAY';
    } else if (workedHours > 0) {
      status = policy.halfDayEnabled ? 'HALF_DAY' : 'ABSENT';
    } else {
      status = 'ABSENT';
    }

    // --- Lateness and early exit ------------------------------------------
    let lateMinutes = 0;
    let earlyExitMinutes = 0;
    const grace = shift?.graceMinutes ?? policy.graceMinutes;

    if (firstIn !== null && (status === 'PRESENT' || status === 'HALF_DAY')) {
      const over = firstIn - window.startMinutes - Math.max(grace, policy.lateAfterMinutes);
      if (over > 0) lateMinutes = over;
    }
    if (lastOut !== null && (status === 'PRESENT' || status === 'HALF_DAY')) {
      const short = window.endMinutes - lastOut - policy.earlyExitGraceMinutes;
      if (short > 0) earlyExitMinutes = short;
    }

    // The late penalty is applied here rather than left as a note, because a
    // policy that says HALF_DAY and then pays a full day is not a policy.
    if (lateMinutes > 0 && status === 'PRESENT') {
      if (policy.latePenaltyType === 'HALF_DAY') status = 'HALF_DAY';
      else if (policy.latePenaltyType === 'ABSENT') status = 'ABSENT';
    }

    // --- Overtime ---------------------------------------------------------
    let otHours = 0;
    let otType: ComputedDay['otType'] = 'NONE';

    if (policy.otEnabled && (shift?.otEligible ?? true) && workMinutes > 0) {
      const expectedMinutes = Math.round((shift?.fullDayHours ?? policy.workingHoursPerDay) * 60);
      const extra = workMinutes - expectedMinutes;
      if (extra >= policy.otMinMinutes) {
        const rounded = roundOvertimeMinutes(extra, policy.otRoundingMinutes);
        otHours = Math.min(round2(rounded / 60), policy.otMaxHoursPerDay);
        otType = isHoliday ? 'HOLIDAY' : isWeekOff ? 'WEEK_OFF' : shift?.isNightShift ? 'NIGHT' : 'WEEKDAY';
      }
    }
    // Work on a rest day is overtime from the first minute, not only past a
    // full shift's worth.
    if (policy.otEnabled && otHours === 0 && workMinutes >= policy.otMinMinutes && (isHoliday || isWeekOff)) {
      otHours = Math.min(round2(roundOvertimeMinutes(workMinutes, policy.otRoundingMinutes) / 60), policy.otMaxHoursPerDay);
      otType = isHoliday ? 'HOLIDAY' : 'WEEK_OFF';
    }

    // --- Flags ------------------------------------------------------------
    const expectedHours = status === 'HOLIDAY' || status === 'WEEK_OFF' || status === 'LEAVE'
      ? 0
      : (shift?.fullDayHours ?? policy.workingHoursPerDay);
    const deficitHours = Math.max(0, round2(expectedHours - workedHours));

    const flags: string[] = [];
    if (lateMinutes > 0) flags.push('LATE');
    if (earlyExitMinutes > 0) flags.push('EARLY_EXIT');
    if (otHours > 0) flags.push('OVERTIME');
    if (status === 'ABSENT') flags.push('ABSENT');
    if (hasOpenPair) flags.push('MISSING_PUNCH');
    if (punches.some((p) => p.geoStatus === 'OUTSIDE')) flags.push('OUTSIDE_FENCE');
    if (grossMinutes > policy.maxHoursPerDay * 60) flags.push('OVER_MAX_HOURS');

    const workMode = punches.length ? punches[punches.length - 1]!.workMode : 'OFFICE';
    const lastDevice = [...punches].reverse().find((p) => p.deviceId)?.deviceId ?? null;
    const source = punches.length ? this.sourceFromMethod(punches[punches.length - 1]!.captureMethod) : 'SYSTEM';

    return {
      day: {
        employeeId: args.employeeId,
        attDate: date,
        status,
        shiftId: shift?.id ?? null,
        workMode,
        leaveTypeId: status === 'LEAVE' ? args.previousLeaveTypeId : null,
        inTime: firstIn === null ? null : minutesToHhmm(firstIn),
        outTime: lastOut === null ? null : minutesToHhmm(lastOut),
        firstInTime: firstIn === null ? null : minutesToHhmm(firstIn),
        lastOutTime: lastOut === null ? null : minutesToHhmm(lastOut),
        punchCount: punches.length,
        breakMinutes: breakMinutesTotal,
        paidBreakMinutes,
        unpaidBreakMinutes,
        grossHours: punches.length ? grossHours : null,
        workedHours: punches.length ? workedHours : null,
        expectedHours,
        deficitHours: punches.length ? deficitHours : null,
        otHours,
        otType,
        isLate: lateMinutes > 0,
        lateMinutes,
        isEarlyExit: earlyExitMinutes > 0,
        earlyExitMinutes,
        isMissingPunch: hasOpenPair,
        exceptionFlags: flags,
        isCrossDay: !!shift?.crossesMidnight && lastOut !== null && lastOut > 1440,
        shiftEndDate: shift?.crossesMidnight && lastOut !== null && lastOut > 1440 ? addDays(date, 1) : null,
        timezone: punches[0]?.timezone ?? 'Asia/Kolkata',
        policyId: policy.id,
        deviceId: lastDevice,
        companyId: employee.company_id ?? null,
        branchId: employee.branch_id ?? null,
        departmentId: employee.department_id ?? null,
        source,
        remarks: null,
      },
      breaks,
    };
  }

  private sourceFromMethod(method: CaptureMethod): string {
    const map: Record<string, string> = {
      WEB: 'WEB', MOBILE: 'MOBILE', KIOSK: 'KIOSK', BIOMETRIC: 'BIOMETRIC', FACE: 'FACE',
      QR: 'QR', NFC: 'NFC', RFID: 'RFID', MANUAL: 'MANUAL', IMPORT: 'IMPORT', AUTO: 'AUTO',
      API: 'SYSTEM', PALM: 'BIOMETRIC', IRIS: 'BIOMETRIC',
    };
    return map[method] ?? 'SYSTEM';
  }

  private otMultiplier(otType: ComputedDay['otType'], policy: AttendancePolicy): number {
    switch (otType) {
      case 'HOLIDAY': return policy.otMultiplierHoliday;
      case 'WEEK_OFF': return policy.otMultiplierWeekoff;
      case 'NIGHT': return policy.otMultiplierNight;
      default: return policy.otMultiplierWeekday;
    }
  }

  private async resolveEmployee(input: PunchInput): Promise<number> {
    if (input.employeeId) return Number(input.employeeId);
    if (input.cardUid) {
      const card = await this.credRepo.findCardByUid(input.cardUid);
      if (card?.employeeId) return card.employeeId;
      throw new Error(`Card ${input.cardUid} is not linked to an employee`);
    }
    throw new Error('An employee id or a registered card is required to record a punch');
  }

  private async resolveDevice(input: PunchInput) {
    if (input.deviceId) return this.deviceRepo.findById(Number(input.deviceId));
    if (input.deviceCode) {
      const device = await this.deviceRepo.findByCode(input.deviceCode);
      if (!device) throw new Error(`Device "${input.deviceCode}" is not registered`);
      if (device.status === 'DECOMMISSIONED' || device.status === 'INACTIVE') {
        throw new Error(`Device "${device.name}" is ${device.status.toLowerCase()} and cannot accept punches`);
      }
      return device;
    }
    return null;
  }

  /** Employee zone comes from their branch, falling back to the configured default. */
  private async employeeTimezone(employeeId: number): Promise<string> {
    const rows = await (this.employeeRepo as any).query(
      `SELECT COALESCE(b.timezone, s.timezone) AS tz
       FROM employees e
       LEFT JOIN branches b ON b.id = e.branch_id
       LEFT JOIN shifts s ON s.id = e.shift_id
       WHERE e.id = ? LIMIT 1`,
      [employeeId],
    );
    return rows?.[0]?.tz || 'Asia/Kolkata';
  }

  /**
   * The shift for a date: the published roster first, then the effective-dated
   * assignment, then the standing employees.shift_id. The last of these is what
   * the original module used, so behaviour is unchanged where nothing new is
   * configured.
   */
  private async resolveShift(employeeId: number, date: string): Promise<ShiftDetail | null> {
    const rosterEntries = await this.schedRepo.findPublishedEntriesForDate(date);
    const rosterEntry = rosterEntries.get(employeeId);
    if (rosterEntry?.shiftId) {
      const shift = await this.schedRepo.findShiftById(rosterEntry.shiftId);
      if (shift) return shift;
    }

    const assignments = await this.schedRepo.resolveAssignments([employeeId], date);
    const assignment = assignments.get(employeeId);
    if (assignment?.shiftId) {
      const shift = await this.schedRepo.findShiftById(assignment.shiftId);
      if (shift) return shift;
    }
    if (assignment?.rotationPatternId) {
      const shift = await this.resolveRotationShift(assignment, date);
      if (shift) return shift;
    }

    const employee = await this.employeeRepo.findRowById(employeeId);
    if (employee?.shift_id) return this.schedRepo.findShiftById(employee.shift_id);
    return null;
  }

  /** Which slot of a rotation cycle a date falls on. */
  private async resolveRotationShift(
    assignment: { rotationPatternId: number | null; rotationAnchorDate: string | null; rotationOffset: number; effectiveFrom: string },
    date: string,
  ): Promise<ShiftDetail | null> {
    if (!assignment.rotationPatternId) return null;
    const pattern = await this.schedRepo.findRotationById(assignment.rotationPatternId);
    if (!pattern || !pattern.pattern.length) return null;

    const anchor = assignment.rotationAnchorDate ?? assignment.effectiveFrom;
    const dayOffset = Math.floor(
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86400000,
    );
    if (!Number.isFinite(dayOffset)) return null;

    const cycle = pattern.pattern.length;
    const index = (((dayOffset + assignment.rotationOffset) % cycle) + cycle) % cycle;
    const code = pattern.pattern[index];
    if (!code || code.toUpperCase() === 'OFF') return null;
    return this.schedRepo.findShiftByCode(code);
  }

  private async resolvePunchType(
    employeeId: number,
    date: string,
    input: PunchInput,
    deviceDefault: 'AUTO' | 'IN' | 'OUT',
  ): Promise<PunchType> {
    const requested = input.punchType;
    if (requested && requested !== 'AUTO') return requested as PunchType;
    if (deviceDefault === 'IN' || deviceDefault === 'OUT') return deviceDefault;

    // AUTO: alternate from the last punch of the day.
    const last = await this.punchRepo.findLastPunch(employeeId, date);
    if (!last) return 'IN';
    switch (last.punchType) {
      case 'IN': return 'OUT';
      case 'OUT': return 'IN';
      case 'BREAK_OUT': return 'BREAK_IN';
      case 'BREAK_IN': return 'OUT';
      default: return 'IN';
    }
  }

  private async nextExpected(employeeId: number, date: string): Promise<PunchType | null> {
    const last = await this.punchRepo.findLastPunch(employeeId, date);
    if (!last) return 'IN';
    return last.punchType === 'IN' || last.punchType === 'BREAK_IN' ? 'OUT'
      : last.punchType === 'BREAK_OUT' ? 'BREAK_IN'
        : 'IN';
  }

  private async evaluateGeofence(
    employeeId: number,
    policy: AttendancePolicy,
    input: PunchInput,
    punchType: PunchType,
    preferredFenceId: number | null,
  ): Promise<GeoOutcome> {
    if (!policy.requireGeofence && input.latitude === undefined && input.longitude === undefined) {
      return { status: 'NOT_REQUIRED', geofence: null, distanceM: null, blocked: false, message: null };
    }

    const fences = await this.credRepo.findGeofencesForEmployee(employeeId);
    const candidates = preferredFenceId
      ? fences.filter((f) => f.id === preferredFenceId).concat(fences.filter((f) => f.id !== preferredFenceId))
      : fences;

    if (!candidates.length) {
      const message = 'No geofence is configured for this employee, so location was recorded but not checked';
      return {
        status: 'NOT_REQUIRED', geofence: null, distanceM: null,
        blocked: policy.requireGeofence, message: policy.requireGeofence
          ? 'the policy requires a geofence but none is configured for this employee'
          : message,
      };
    }

    const lat = input.latitude;
    const lng = input.longitude;
    if (lat === undefined || lat === null || lng === undefined || lng === null) {
      return {
        status: 'NO_FIX', geofence: null, distanceM: null,
        blocked: policy.requireGeofence,
        message: policy.requireGeofence
          ? 'the policy requires a location fix and none was supplied'
          : 'No location was supplied with this punch',
      };
    }

    let best: { fence: Geofence; distance: number; inside: boolean } | null = null;
    for (const fence of candidates) {
      const enforced = punchType === 'IN' || punchType === 'BREAK_IN' ? fence.enforceOnIn : fence.enforceOnOut;
      if (!enforced && !policy.requireGeofence) continue;

      let inside = false;
      let distance = Number.POSITIVE_INFINITY;

      if (fence.fenceType === 'POLYGON' && fence.polygon?.length) {
        inside = pointInPolygon(lat, lng, fence.polygon);
        distance = inside ? 0 : distanceToPolygon(lat, lng, fence.polygon);
      } else if (fence.centerLat !== null && fence.centerLng !== null) {
        distance = haversineMetres(lat, lng, fence.centerLat, fence.centerLng);
        inside = distance <= fence.radiusM;
      }

      if (!best || distance < best.distance) best = { fence, distance, inside };
      if (inside) break;
    }

    if (!best) return { status: 'NOT_REQUIRED', geofence: null, distanceM: null, blocked: false, message: null };

    // A wildly imprecise fix inside a small fence is not evidence of presence.
    const accuracy = input.accuracyM ?? null;
    if (best.inside && accuracy !== null && accuracy > best.fence.maxAccuracyM) {
      return {
        status: 'LOW_ACCURACY', geofence: best.fence, distanceM: best.distance,
        blocked: policy.requireGeofence,
        message: `location accuracy of ${accuracy} m is wider than the ${best.fence.maxAccuracyM} m this fence accepts`,
      };
    }

    if (best.inside) {
      return {
        status: 'INSIDE', geofence: best.fence, distanceM: best.distance,
        blocked: false, message: null,
      };
    }

    return {
      status: 'OUTSIDE', geofence: best.fence, distanceM: best.distance,
      blocked: policy.requireGeofence,
      message: `you are ${best.distance} m from ${best.fence.name}, which allows ${best.fence.radiusM} m`,
    };
  }

  private async leaveTypeFor(employeeId: number, date: string): Promise<number | null> {
    const rows = await (this.employeeRepo as any).query(
      'SELECT leave_type_id FROM attendance_records WHERE employee_id = ? AND att_date = ? LIMIT 1',
      [employeeId, date],
    );
    return rows?.[0]?.leave_type_id ?? null;
  }

  private async emptyDetail(employeeId: number, date: string): Promise<DailyAttendanceDetail> {
    const employee = await this.employeeRepo.findRowById(employeeId);
    return {
      id: null, employeeId, employeeName: employee?.full_name ?? '', empCode: employee?.emp_code ?? '',
      date, status: null, workMode: 'OFFICE', shiftId: employee?.shift_id ?? null,
      shiftName: null, shiftCode: null, inTime: null, outTime: null, firstInTime: null,
      lastOutTime: null, punchCount: 0, breakMinutes: 0, paidBreakMinutes: 0, unpaidBreakMinutes: 0,
      grossHours: null, workedHours: null, expectedHours: null, deficitHours: null,
      otHours: 0, otApprovedHours: 0, otStatus: 'NONE', otType: 'NONE',
      isLate: false, lateMinutes: 0, isEarlyExit: false, earlyExitMinutes: 0,
      isMissingPunch: false, exceptionFlags: [], isCrossDay: false, shiftEndDate: null,
      timezone: null, policyId: null, deviceId: null, branchId: employee?.branch_id ?? null,
      departmentId: employee?.department_id ?? null, approvalStatus: 'NOT_REQUIRED',
      isRegularized: false, isLocked: false, lockedReason: null, source: null, remarks: null,
    };
  }
}
