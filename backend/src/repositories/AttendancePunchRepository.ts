import { BaseRepository } from './BaseRepository';
import {
  BreakRecord, CaptureMethod, DailyAttendanceDetail, GeoStatus, Paged,
  PunchRecord, PunchStatus, PunchType, WorkMode,
} from '../types/attendance';
import { toDateString, toTimeString } from '../utils/dateUtils';

export interface PunchInsert {
  employeeId: number;
  punchAt: string;
  punchDate: string;
  punchTime: string;
  timezone: string;
  utcOffsetMinutes: number;
  punchType: PunchType;
  captureMethod: CaptureMethod;
  workMode: WorkMode;
  deviceId?: number | null;
  devicePunchRef?: string | null;
  shiftId?: number | null;
  projectRef?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  geofenceId?: number | null;
  geoStatus?: GeoStatus;
  distanceM?: number | null;
  addressLabel?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  browser?: string | null;
  os?: string | null;
  nfcCardId?: number | null;
  qrTokenId?: number | null;
  photoPath?: string | null;
  faceVerified?: boolean;
  faceMatchScore?: number | null;
  livenessPassed?: boolean | null;
  faceProviderNote?: string | null;
  clientPunchId?: string | null;
  isOffline?: boolean;
  capturedAt?: string | null;
  syncLogId?: number | null;
  status?: PunchStatus;
  rejectReason?: string | null;
  isManualEntry?: boolean;
  remarks?: string | null;
  createdBy?: number | null;
}

export interface PunchFilters {
  employeeId?: number;
  from?: string;
  to?: string;
  deviceId?: number;
  punchType?: PunchType;
  captureMethod?: CaptureMethod;
  status?: PunchStatus;
  geoStatus?: GeoStatus;
  branchId?: number;
  departmentId?: number;
  search?: string;
  page?: number;
  pageSize?: number;
}

const PUNCH_COLUMNS = [
  'employee_id', 'punch_at', 'punch_date', 'punch_time', 'timezone', 'utc_offset_minutes',
  'punch_type', 'capture_method', 'work_mode', 'device_id', 'device_punch_ref', 'shift_id',
  'project_ref', 'latitude', 'longitude', 'accuracy_m', 'geofence_id', 'geo_status', 'distance_m',
  'address_label', 'ip_address', 'user_agent', 'browser', 'os', 'nfc_card_id', 'qr_token_id',
  'photo_path', 'face_verified', 'face_match_score', 'liveness_passed', 'face_provider_note',
  'client_punch_id', 'is_offline', 'captured_at', 'sync_log_id', 'status', 'reject_reason',
  'is_manual_entry', 'remarks', 'created_by',
];

/** Batch size for bulk punch inserts -- keeps the packet and placeholder count sane. */
const INSERT_CHUNK = 400;

function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export class AttendancePunchRepository extends BaseRepository {
  private toParams(p: PunchInsert): any[] {
    return [
      p.employeeId, p.punchAt, p.punchDate, p.punchTime, p.timezone, p.utcOffsetMinutes,
      p.punchType, p.captureMethod, p.workMode, p.deviceId ?? null, p.devicePunchRef ?? null,
      p.shiftId ?? null, p.projectRef ?? null, p.latitude ?? null, p.longitude ?? null,
      p.accuracyM ?? null, p.geofenceId ?? null, p.geoStatus ?? 'NOT_REQUIRED', p.distanceM ?? null,
      p.addressLabel ?? null, p.ipAddress ?? null,
      p.userAgent ? String(p.userAgent).slice(0, 500) : null,
      p.browser ?? null, p.os ?? null, p.nfcCardId ?? null, p.qrTokenId ?? null,
      p.photoPath ?? null, p.faceVerified ? 1 : 0, p.faceMatchScore ?? null,
      p.livenessPassed === undefined || p.livenessPassed === null ? null : (p.livenessPassed ? 1 : 0),
      p.faceProviderNote ?? null, p.clientPunchId ?? null, p.isOffline ? 1 : 0,
      p.capturedAt ?? null, p.syncLogId ?? null, p.status ?? 'ACCEPTED', p.rejectReason ?? null,
      p.isManualEntry ? 1 : 0, p.remarks ?? null, p.createdBy ?? null,
    ];
  }

  async insert(punch: PunchInsert, conn?: any): Promise<number> {
    const sql = `INSERT INTO attendance_punches (${PUNCH_COLUMNS.join(', ')})
                 VALUES (${PUNCH_COLUMNS.map(() => '?').join(', ')})`;
    const params = this.toParams(punch);
    if (conn) {
      const [result] = await conn.query(sql, params);
      return Number((result as any).insertId);
    }
    const result = await this.query<any>(sql, params);
    return Number(result.insertId);
  }

  /**
   * Bulk insert for device sync and offline replay.
   *
   * IGNORE rather than ON DUPLICATE KEY UPDATE: a replayed punch must not
   * overwrite the accepted original, because the original is what the day was
   * computed from. The unique keys on (employee_id, client_punch_id) and
   * (device_id, device_punch_ref) make the replay a no-op instead.
   */
  async bulkInsertIgnore(punches: PunchInsert[]): Promise<{ inserted: number; duplicates: number }> {
    if (!punches.length) return { inserted: 0, duplicates: 0 };
    const rowPlaceholder = `(${PUNCH_COLUMNS.map(() => '?').join(', ')})`;
    let inserted = 0;

    for (let i = 0; i < punches.length; i += INSERT_CHUNK) {
      const chunk = punches.slice(i, i + INSERT_CHUNK);
      const params: any[] = [];
      for (const p of chunk) params.push(...this.toParams(p));
      const result = await this.query<any>(
        `INSERT IGNORE INTO attendance_punches (${PUNCH_COLUMNS.join(', ')})
         VALUES ${chunk.map(() => rowPlaceholder).join(', ')}`,
        params,
      );
      inserted += Number(result?.affectedRows ?? 0);
    }
    return { inserted, duplicates: punches.length - inserted };
  }

  /** Punches for one employee on one local date, chronological. */
  async findForDay(employeeId: number, date: string, conn?: any): Promise<PunchRecord[]> {
    const sql = `SELECT p.*, e.full_name, e.emp_code, d.name AS device_name, g.name AS geofence_name
                 FROM attendance_punches p
                 JOIN employees e ON e.id = p.employee_id
                 LEFT JOIN attendance_devices d ON d.id = p.device_id
                 LEFT JOIN geofences g ON g.id = p.geofence_id
                 WHERE p.employee_id = ? AND p.punch_date = ?
                   AND p.deleted_at IS NULL AND p.status = 'ACCEPTED'
                 ORDER BY p.punch_at ASC, p.id ASC`;
    const rows = conn
      ? ((await conn.query(sql, [employeeId, date]))[0] as any[])
      : await this.query<any[]>(sql, [employeeId, date]);
    return rows.map((r) => this.toPunch(r));
  }

  /** Punches for a set of employee-days, used by the recompute-many path. */
  async findForDateRange(from: string, to: string, employeeIds?: number[]): Promise<PunchRecord[]> {
    const params: any[] = [from, to];
    let clause = '';
    if (employeeIds?.length) {
      clause = ` AND p.employee_id IN (${employeeIds.map(() => '?').join(', ')})`;
      params.push(...employeeIds);
    }
    const rows = await this.query<any[]>(
      `SELECT p.*, e.full_name, e.emp_code
       FROM attendance_punches p
       JOIN employees e ON e.id = p.employee_id
       WHERE p.punch_date BETWEEN ? AND ? AND p.deleted_at IS NULL AND p.status = 'ACCEPTED'${clause}
       ORDER BY p.employee_id, p.punch_at ASC, p.id ASC`,
      params,
    );
    return rows.map((r) => this.toPunch(r));
  }

  async list(filters: PunchFilters): Promise<Paged<PunchRecord>> {
    const where: string[] = ['p.deleted_at IS NULL'];
    const params: any[] = [];

    if (filters.employeeId) { where.push('p.employee_id = ?'); params.push(filters.employeeId); }
    if (filters.from) { where.push('p.punch_date >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('p.punch_date <= ?'); params.push(filters.to); }
    if (filters.deviceId) { where.push('p.device_id = ?'); params.push(filters.deviceId); }
    if (filters.punchType) { where.push('p.punch_type = ?'); params.push(filters.punchType); }
    if (filters.captureMethod) { where.push('p.capture_method = ?'); params.push(filters.captureMethod); }
    if (filters.status) { where.push('p.status = ?'); params.push(filters.status); }
    if (filters.geoStatus) { where.push('p.geo_status = ?'); params.push(filters.geoStatus); }
    if (filters.branchId) { where.push('e.branch_id = ?'); params.push(filters.branchId); }
    if (filters.departmentId) { where.push('e.department_id = ?'); params.push(filters.departmentId); }
    if (filters.search) {
      where.push('(e.full_name LIKE ? OR e.emp_code LIKE ?)');
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    const clause = where.join(' AND ');
    const page = safeInt(filters.page, 1, 1, 100000);
    const pageSize = safeInt(filters.pageSize, 50, 1, 500);
    const offset = (page - 1) * pageSize;

    const [countRows, rows] = await Promise.all([
      this.query<any[]>(
        `SELECT COUNT(*) AS n FROM attendance_punches p JOIN employees e ON e.id = p.employee_id WHERE ${clause}`,
        params,
      ),
      this.query<any[]>(
        `SELECT p.*, e.full_name, e.emp_code, d.name AS device_name, g.name AS geofence_name
         FROM attendance_punches p
         JOIN employees e ON e.id = p.employee_id
         LEFT JOIN attendance_devices d ON d.id = p.device_id
         LEFT JOIN geofences g ON g.id = p.geofence_id
         WHERE ${clause}
         ORDER BY p.punch_at DESC, p.id DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      ),
    ]);

    return {
      rows: rows.map((r) => this.toPunch(r)),
      total: Number(countRows[0]?.n ?? 0),
      page,
      pageSize,
    };
  }

  /** Most recent accepted punches across everyone -- the live board feed. */
  async findRecent(limit = 25, sinceId?: number): Promise<PunchRecord[]> {
    const capped = safeInt(limit, 25, 1, 200);
    const params: any[] = [];
    let clause = "p.deleted_at IS NULL AND p.status = 'ACCEPTED'";
    if (sinceId) { clause += ' AND p.id > ?'; params.push(sinceId); }

    const rows = await this.query<any[]>(
      `SELECT p.*, e.full_name, e.emp_code, d.name AS device_name, g.name AS geofence_name
       FROM attendance_punches p
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN attendance_devices d ON d.id = p.device_id
       LEFT JOIN geofences g ON g.id = p.geofence_id
       WHERE ${clause}
       ORDER BY p.id DESC
       LIMIT ${capped}`,
      params,
    );
    return rows.map((r) => this.toPunch(r));
  }

  async findLastPunch(employeeId: number, date: string): Promise<PunchRecord | null> {
    const rows = await this.query<any[]>(
      `SELECT p.*, e.full_name, e.emp_code
       FROM attendance_punches p JOIN employees e ON e.id = p.employee_id
       WHERE p.employee_id = ? AND p.punch_date = ? AND p.deleted_at IS NULL AND p.status = 'ACCEPTED'
       ORDER BY p.punch_at DESC, p.id DESC LIMIT 1`,
      [employeeId, date],
    );
    return rows[0] ? this.toPunch(rows[0]) : null;
  }

  /** Device-side replay lookup, the same idempotency contract as clientPunchId. */
  async findByDeviceRef(deviceId: number, devicePunchRef: string): Promise<PunchRecord | null> {
    const rows = await this.query<any[]>(
      `SELECT p.*, e.full_name, e.emp_code
       FROM attendance_punches p JOIN employees e ON e.id = p.employee_id
       WHERE p.device_id = ? AND p.device_punch_ref = ? LIMIT 1`,
      [deviceId, devicePunchRef],
    );
    return rows[0] ? this.toPunch(rows[0]) : null;
  }

  async findByClientPunchId(employeeId: number, clientPunchId: string): Promise<PunchRecord | null> {
    const rows = await this.query<any[]>(
      `SELECT p.*, e.full_name, e.emp_code
       FROM attendance_punches p JOIN employees e ON e.id = p.employee_id
       WHERE p.employee_id = ? AND p.client_punch_id = ? LIMIT 1`,
      [employeeId, clientPunchId],
    );
    return rows[0] ? this.toPunch(rows[0]) : null;
  }

  async findById(id: number): Promise<PunchRecord | null> {
    const rows = await this.query<any[]>(
      `SELECT p.*, e.full_name, e.emp_code, d.name AS device_name, g.name AS geofence_name
       FROM attendance_punches p
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN attendance_devices d ON d.id = p.device_id
       LEFT JOIN geofences g ON g.id = p.geofence_id
       WHERE p.id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ? this.toPunch(rows[0]) : null;
  }

  async softDelete(id: number, reason: string): Promise<void> {
    await this.query(
      'UPDATE attendance_punches SET deleted_at = NOW(), remarks = CONCAT(COALESCE(remarks, ""), ?) WHERE id = ?',
      [` [deleted: ${reason}]`, id],
    );
  }

  /**
   * Employees currently inside: their latest punch of the day is IN or BREAK_IN.
   * One pass over the day's punches rather than a query per employee.
   */
  async getPresenceState(date: string): Promise<Map<number, { lastType: PunchType; lastAt: string }>> {
    const rows = await this.query<any[]>(
      `SELECT p.employee_id, p.punch_type, p.punch_at
       FROM attendance_punches p
       JOIN (
         SELECT employee_id, MAX(punch_at) AS max_at
         FROM attendance_punches
         WHERE punch_date = ? AND deleted_at IS NULL AND status = 'ACCEPTED'
         GROUP BY employee_id
       ) last ON last.employee_id = p.employee_id AND last.max_at = p.punch_at
       WHERE p.punch_date = ? AND p.deleted_at IS NULL AND p.status = 'ACCEPTED'`,
      [date, date],
    );
    const out = new Map<number, { lastType: PunchType; lastAt: string }>();
    for (const r of rows) {
      out.set(Number(r.employee_id), {
        lastType: r.punch_type,
        lastAt: r.punch_at instanceof Date ? r.punch_at.toISOString() : String(r.punch_at),
      });
    }
    return out;
  }

  async countByMethod(from: string, to: string): Promise<{ method: CaptureMethod; count: number }[]> {
    const rows = await this.query<any[]>(
      `SELECT capture_method, COUNT(*) AS n
       FROM attendance_punches
       WHERE punch_date BETWEEN ? AND ? AND deleted_at IS NULL AND status = 'ACCEPTED'
       GROUP BY capture_method ORDER BY n DESC`,
      [from, to],
    );
    return rows.map((r) => ({ method: r.capture_method as CaptureMethod, count: Number(r.n) }));
  }

  // -------------------------------------------------------------------------
  // Breaks
  // -------------------------------------------------------------------------
  async replaceBreaksForDay(
    employeeId: number,
    date: string,
    attendanceId: number | null,
    breaks: Omit<BreakRecord, 'id' | 'breakTypeName'>[],
    userId: number | null,
    conn?: any,
  ): Promise<void> {
    const run = async (sql: string, params: any[]) => {
      if (conn) await conn.query(sql, params);
      else await this.query(sql, params);
    };

    // Derived breaks are rebuilt from punches on every recompute. Manually
    // entered ones are left alone -- they were not derived, so re-deriving must
    // not silently discard them.
    await run(
      `DELETE FROM attendance_breaks WHERE employee_id = ? AND att_date = ? AND source = 'PUNCH'`,
      [employeeId, date],
    );
    if (!breaks.length) return;

    const cols = ['attendance_id', 'employee_id', 'att_date', 'break_type_id', 'start_time', 'end_time',
      'minutes', 'is_paid', 'is_open', 'exceeded_by_minutes', 'approval_status', 'source', 'remarks', 'created_by'];
    const params: any[] = [];
    for (const b of breaks) {
      params.push(
        attendanceId, employeeId, date, b.breakTypeId ?? null, b.startTime ?? null, b.endTime ?? null,
        b.minutes, b.isPaid ? 1 : 0, b.isOpen ? 1 : 0, b.exceededByMinutes,
        b.approvalStatus, b.source, b.remarks ?? null, userId || null,
      );
    }
    await run(
      `INSERT INTO attendance_breaks (${cols.join(', ')})
       VALUES ${breaks.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ')}`,
      params,
    );
  }

  async findBreaksForDay(employeeId: number, date: string): Promise<BreakRecord[]> {
    const rows = await this.query<any[]>(
      `SELECT b.*, bt.name AS break_type_name
       FROM attendance_breaks b
       LEFT JOIN break_types bt ON bt.id = b.break_type_id
       WHERE b.employee_id = ? AND b.att_date = ? AND b.deleted_at IS NULL
       ORDER BY b.start_time ASC`,
      [employeeId, date],
    );
    return rows.map((r) => this.toBreak(r));
  }

  async findBreaksForRange(from: string, to: string, employeeId?: number): Promise<BreakRecord[]> {
    const params: any[] = [from, to];
    let clause = '';
    if (employeeId) { clause = ' AND b.employee_id = ?'; params.push(employeeId); }
    const rows = await this.query<any[]>(
      `SELECT b.*, bt.name AS break_type_name
       FROM attendance_breaks b
       LEFT JOIN break_types bt ON bt.id = b.break_type_id
       WHERE b.att_date BETWEEN ? AND ? AND b.deleted_at IS NULL${clause}
       ORDER BY b.att_date ASC, b.start_time ASC`,
      params,
    );
    return rows.map((r) => this.toBreak(r));
  }

  // -------------------------------------------------------------------------
  // Mapping
  // -------------------------------------------------------------------------
  private toPunch(r: any): PunchRecord {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.full_name,
      empCode: r.emp_code,
      punchAt: r.punch_at instanceof Date ? r.punch_at.toISOString() : String(r.punch_at),
      punchDate: toDateString(r.punch_date),
      punchTime: toTimeString(r.punch_time) ?? '00:00',
      timezone: r.timezone,
      punchType: r.punch_type,
      captureMethod: r.capture_method,
      workMode: r.work_mode,
      deviceId: r.device_id === null ? null : Number(r.device_id),
      deviceName: r.device_name ?? null,
      shiftId: r.shift_id === null ? null : Number(r.shift_id),
      projectRef: r.project_ref ?? null,
      latitude: r.latitude === null ? null : Number(r.latitude),
      longitude: r.longitude === null ? null : Number(r.longitude),
      accuracyM: r.accuracy_m === null ? null : Number(r.accuracy_m),
      geofenceId: r.geofence_id === null ? null : Number(r.geofence_id),
      geofenceName: r.geofence_name ?? null,
      geoStatus: r.geo_status,
      distanceM: r.distance_m === null ? null : Number(r.distance_m),
      addressLabel: r.address_label ?? null,
      ipAddress: r.ip_address ?? null,
      browser: r.browser ?? null,
      os: r.os ?? null,
      photoPath: r.photo_path ?? null,
      faceVerified: !!r.face_verified,
      faceMatchScore: r.face_match_score === null ? null : Number(r.face_match_score),
      livenessPassed: r.liveness_passed === null ? null : !!r.liveness_passed,
      faceProviderNote: r.face_provider_note ?? null,
      clientPunchId: r.client_punch_id ?? null,
      isOffline: !!r.is_offline,
      capturedAt: r.captured_at ? (r.captured_at instanceof Date ? r.captured_at.toISOString() : String(r.captured_at)) : null,
      syncedAt: r.synced_at ? (r.synced_at instanceof Date ? r.synced_at.toISOString() : String(r.synced_at)) : null,
      status: r.status,
      rejectReason: r.reject_reason ?? null,
      isManualEntry: !!r.is_manual_entry,
      remarks: r.remarks ?? null,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    };
  }

  private toBreak(r: any): BreakRecord {
    return {
      id: Number(r.id),
      attendanceId: r.attendance_id === null ? null : Number(r.attendance_id),
      employeeId: Number(r.employee_id),
      attDate: toDateString(r.att_date),
      breakTypeId: r.break_type_id === null ? null : Number(r.break_type_id),
      breakTypeName: r.break_type_name ?? null,
      startTime: toTimeString(r.start_time),
      endTime: toTimeString(r.end_time),
      minutes: Number(r.minutes ?? 0),
      isPaid: !!r.is_paid,
      isOpen: !!r.is_open,
      exceededByMinutes: Number(r.exceeded_by_minutes ?? 0),
      approvalStatus: r.approval_status,
      source: r.source,
      remarks: r.remarks ?? null,
    };
  }
}

/** Shared row-to-detail mapper, used by both the day repository and reports. */
export function mapDailyDetail(r: any): DailyAttendanceDetail {
  const num = (v: any): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    id: r.att_id === null || r.att_id === undefined ? null : Number(r.att_id),
    employeeId: Number(r.employee_id),
    employeeName: r.full_name,
    empCode: r.emp_code,
    date: toDateString(r.att_date ?? r.date),
    status: r.status ?? null,
    workMode: r.work_mode ?? 'OFFICE',
    shiftId: r.shift_id === null || r.shift_id === undefined ? null : Number(r.shift_id),
    shiftName: r.shift_name ?? null,
    shiftCode: r.shift_code ?? null,
    inTime: toTimeString(r.in_time),
    outTime: toTimeString(r.out_time),
    firstInTime: toTimeString(r.first_in_time),
    lastOutTime: toTimeString(r.last_out_time),
    punchCount: Number(r.punch_count ?? 0),
    breakMinutes: Number(r.break_minutes ?? 0),
    paidBreakMinutes: Number(r.paid_break_minutes ?? 0),
    unpaidBreakMinutes: Number(r.unpaid_break_minutes ?? 0),
    grossHours: num(r.gross_hours),
    workedHours: num(r.worked_hours),
    expectedHours: num(r.expected_hours),
    deficitHours: num(r.deficit_hours),
    otHours: Number(r.ot_hours ?? 0),
    otApprovedHours: Number(r.ot_approved_hours ?? 0),
    otStatus: r.ot_status ?? 'NONE',
    otType: r.ot_type ?? 'NONE',
    isLate: !!r.is_late,
    lateMinutes: Number(r.late_minutes ?? 0),
    isEarlyExit: !!r.is_early_exit,
    earlyExitMinutes: Number(r.early_exit_minutes ?? 0),
    isMissingPunch: !!r.is_missing_punch,
    exceptionFlags: r.exception_flags ? String(r.exception_flags).split(',').filter(Boolean) : [],
    isCrossDay: !!r.is_cross_day,
    shiftEndDate: r.shift_end_date ? toDateString(r.shift_end_date) : null,
    timezone: r.timezone ?? null,
    policyId: r.policy_id === null || r.policy_id === undefined ? null : Number(r.policy_id),
    policyName: r.policy_name ?? null,
    deviceId: r.device_id === null || r.device_id === undefined ? null : Number(r.device_id),
    branchId: r.branch_id === null || r.branch_id === undefined ? null : Number(r.branch_id),
    departmentId: r.department_id === null || r.department_id === undefined ? null : Number(r.department_id),
    approvalStatus: r.approval_status ?? 'NOT_REQUIRED',
    isRegularized: !!r.is_regularized,
    isLocked: !!r.is_locked,
    lockedReason: r.locked_reason ?? null,
    source: r.source ?? null,
    remarks: r.remarks ?? null,
  };
}
