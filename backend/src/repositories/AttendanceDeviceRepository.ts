import { BaseRepository } from './BaseRepository';
import { AttendanceDevice, DeviceEnrollment, DeviceHealth, DeviceSyncLog, SyncStatus } from '../types/attendance';
import { toDateString } from '../utils/dateUtils';

export interface DeviceFilters {
  deviceType?: string;
  branchId?: number;
  status?: string;
  healthStatus?: DeviceHealth;
  search?: string;
}

function iso(value: any): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export class AttendanceDeviceRepository extends BaseRepository {
  async findAll(filters: DeviceFilters = {}): Promise<AttendanceDevice[]> {
    const where: string[] = ['d.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.deviceType) { where.push('d.device_type = ?'); params.push(filters.deviceType); }
    if (filters.branchId) { where.push('d.branch_id = ?'); params.push(filters.branchId); }
    if (filters.status) { where.push('d.status = ?'); params.push(filters.status); }
    if (filters.healthStatus) { where.push('d.health_status = ?'); params.push(filters.healthStatus); }
    if (filters.search) {
      where.push('(d.name LIKE ? OR d.code LIKE ? OR d.serial_no LIKE ?)');
      params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }

    const rows = await this.query<any[]>(
      `SELECT d.*, b.name AS branch_name, l.name AS location_name, g.name AS geofence_name
       FROM attendance_devices d
       LEFT JOIN branches b ON b.id = d.branch_id
       LEFT JOIN locations l ON l.id = d.location_id
       LEFT JOIN geofences g ON g.id = d.geofence_id
       WHERE ${where.join(' AND ')}
       ORDER BY d.status ASC, d.name ASC`,
      params,
    );
    return rows.map((r) => this.toDevice(r));
  }

  async findById(id: number): Promise<AttendanceDevice | null> {
    const rows = await this.query<any[]>(
      `SELECT d.*, b.name AS branch_name, l.name AS location_name, g.name AS geofence_name
       FROM attendance_devices d
       LEFT JOIN branches b ON b.id = d.branch_id
       LEFT JOIN locations l ON l.id = d.location_id
       LEFT JOIN geofences g ON g.id = d.geofence_id
       WHERE d.id = ? AND d.deleted_at IS NULL LIMIT 1`,
      [id],
    );
    return rows[0] ? this.toDevice(rows[0]) : null;
  }

  async findByCode(code: string): Promise<AttendanceDevice | null> {
    const rows = await this.query<any[]>(
      `SELECT d.*, b.name AS branch_name, l.name AS location_name, g.name AS geofence_name
       FROM attendance_devices d
       LEFT JOIN branches b ON b.id = d.branch_id
       LEFT JOIN locations l ON l.id = d.location_id
       LEFT JOIN geofences g ON g.id = d.geofence_id
       WHERE d.code = ? AND d.deleted_at IS NULL LIMIT 1`,
      [code],
    );
    return rows[0] ? this.toDevice(rows[0]) : null;
  }

  /** Returns the stored key hash, which never leaves the service layer. */
  async findApiKeyHash(deviceId: number): Promise<string | null> {
    const rows = await this.query<any[]>(
      "SELECT api_key_hash FROM attendance_devices WHERE id = ? AND deleted_at IS NULL AND status IN ('ACTIVE', 'MAINTENANCE') LIMIT 1",
      [deviceId],
    );
    return rows[0]?.api_key_hash ?? null;
  }

  async create(data: Partial<AttendanceDevice>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO attendance_devices
         (code, name, device_type, vendor, model, serial_no, firmware_version, ip_address, mac_address,
          company_id, branch_id, location_id, geofence_id, timezone, supports_in_out, default_punch_type,
          sync_mode, sync_interval_minutes, heartbeat_interval_minutes, status, installed_on,
          warranty_expires_on, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code, data.name, data.deviceType ?? 'BIOMETRIC', data.vendor ?? null, data.model ?? null,
        data.serialNo ?? null, data.firmwareVersion ?? null, data.ipAddress ?? null, data.macAddress ?? null,
        data.companyId ?? null, data.branchId ?? null, data.locationId ?? null, data.geofenceId ?? null,
        data.timezone ?? 'Asia/Kolkata', data.supportsInOut === false ? 0 : 1, data.defaultPunchType ?? 'AUTO',
        data.syncMode ?? 'PUSH', data.syncIntervalMinutes ?? 15, data.heartbeatIntervalMinutes ?? 5,
        data.status ?? 'ACTIVE', data.installedOn ?? null, data.warrantyExpiresOn ?? null,
        data.notes ?? null, userId, userId,
      ],
    );
    return Number(result.insertId);
  }

  async update(id: number, data: Partial<AttendanceDevice>, current: AttendanceDevice, userId: number): Promise<void> {
    await this.query(
      `UPDATE attendance_devices SET
         name = ?, device_type = ?, vendor = ?, model = ?, serial_no = ?, firmware_version = ?,
         ip_address = ?, mac_address = ?, company_id = ?, branch_id = ?, location_id = ?, geofence_id = ?,
         timezone = ?, supports_in_out = ?, default_punch_type = ?, sync_mode = ?,
         sync_interval_minutes = ?, heartbeat_interval_minutes = ?, status = ?,
         installed_on = ?, warranty_expires_on = ?, notes = ?, updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        data.name ?? current.name,
        data.deviceType ?? current.deviceType,
        data.vendor === undefined ? current.vendor : data.vendor,
        data.model === undefined ? current.model : data.model,
        data.serialNo === undefined ? current.serialNo : data.serialNo,
        data.firmwareVersion === undefined ? current.firmwareVersion : data.firmwareVersion,
        data.ipAddress === undefined ? current.ipAddress : data.ipAddress,
        data.macAddress === undefined ? current.macAddress : data.macAddress,
        data.companyId === undefined ? current.companyId : data.companyId,
        data.branchId === undefined ? current.branchId : data.branchId,
        data.locationId === undefined ? current.locationId : data.locationId,
        data.geofenceId === undefined ? current.geofenceId : data.geofenceId,
        data.timezone ?? current.timezone,
        (data.supportsInOut ?? current.supportsInOut) ? 1 : 0,
        data.defaultPunchType ?? current.defaultPunchType,
        data.syncMode ?? current.syncMode,
        data.syncIntervalMinutes ?? current.syncIntervalMinutes,
        data.heartbeatIntervalMinutes ?? current.heartbeatIntervalMinutes,
        data.status ?? current.status,
        data.installedOn === undefined ? current.installedOn : data.installedOn,
        data.warrantyExpiresOn === undefined ? current.warrantyExpiresOn : data.warrantyExpiresOn,
        data.notes === undefined ? current.notes : data.notes,
        userId, id,
      ],
    );
  }

  async setApiKey(id: number, hash: string, hint: string): Promise<void> {
    await this.query('UPDATE attendance_devices SET api_key_hash = ?, api_key_hint = ? WHERE id = ?', [hash, hint, id]);
  }

  async softDelete(id: number, userId: number): Promise<void> {
    await this.query('UPDATE attendance_devices SET deleted_at = NOW(), updated_by = ? WHERE id = ?', [userId, id]);
  }

  async recordHeartbeat(id: number, health: DeviceHealth, note: string | null): Promise<void> {
    await this.query(
      'UPDATE attendance_devices SET last_heartbeat_at = NOW(), health_status = ?, health_note = ? WHERE id = ?',
      [health, note, id],
    );
  }

  async recordSyncOutcome(id: number, accepted: number): Promise<void> {
    await this.query(
      `UPDATE attendance_devices
       SET last_sync_at = NOW(), last_heartbeat_at = NOW(), health_status = 'ONLINE',
           total_punches = total_punches + ?, last_punch_at = NOW()
       WHERE id = ?`,
      [accepted, id],
    );
  }

  /**
   * Marks devices silent for more than three heartbeat intervals as OFFLINE.
   * Three rather than one so a single missed beat on a busy network does not
   * raise an alert.
   */
  async refreshHealth(): Promise<{ offline: number }> {
    const result = await this.query<any>(
      `UPDATE attendance_devices
       SET health_status = 'OFFLINE',
           health_note = CONCAT('No heartbeat since ', COALESCE(DATE_FORMAT(last_heartbeat_at, '%Y-%m-%d %H:%i'), 'registration'))
       WHERE deleted_at IS NULL
         AND status = 'ACTIVE'
         AND health_status <> 'OFFLINE'
         AND (last_heartbeat_at IS NULL OR last_heartbeat_at < DATE_SUB(NOW(), INTERVAL (heartbeat_interval_minutes * 3) MINUTE))`,
    );
    return { offline: Number(result?.affectedRows ?? 0) };
  }

  async healthSummary(): Promise<{ online: number; offline: number; degraded: number; unknown: number; total: number }> {
    const rows = await this.query<any[]>(
      `SELECT
         COALESCE(SUM(health_status = 'ONLINE'), 0) AS online,
         COALESCE(SUM(health_status = 'OFFLINE'), 0) AS offline,
         COALESCE(SUM(health_status = 'DEGRADED'), 0) AS degraded,
         COALESCE(SUM(health_status = 'UNKNOWN'), 0) AS unknown,
         COUNT(*) AS total
       FROM attendance_devices WHERE deleted_at IS NULL AND status <> 'DECOMMISSIONED'`,
    );
    const r = rows[0] ?? {};
    return {
      online: Number(r.online ?? 0), offline: Number(r.offline ?? 0),
      degraded: Number(r.degraded ?? 0), unknown: Number(r.unknown ?? 0),
      total: Number(r.total ?? 0),
    };
  }

  // -------------------------------------------------------------------------
  // Sync logs
  // -------------------------------------------------------------------------
  async startSyncLog(deviceId: number, syncType: string, userId: number | null): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO device_sync_logs (device_id, sync_type, started_at, status, triggered_by)
       VALUES (?, ?, NOW(), 'RUNNING', ?)`,
      [deviceId, syncType, userId],
    );
    return Number(result.insertId);
  }

  async finishSyncLog(
    id: number,
    status: SyncStatus,
    counts: { received: number; accepted: number; duplicate: number; rejected: number },
    errorMessage: string | null,
  ): Promise<void> {
    await this.query(
      `UPDATE device_sync_logs
       SET finished_at = NOW(),
           duration_ms = TIMESTAMPDIFF(MICROSECOND, started_at, NOW()) DIV 1000,
           status = ?, records_received = ?, records_accepted = ?,
           records_duplicate = ?, records_rejected = ?, error_message = ?
       WHERE id = ?`,
      [status, counts.received, counts.accepted, counts.duplicate, counts.rejected, errorMessage, id],
    );
  }

  async listSyncLogs(deviceId?: number, limit = 50): Promise<DeviceSyncLog[]> {
    const capped = Math.min(500, Math.max(1, Math.trunc(Number(limit) || 50)));
    const params: any[] = [];
    let clause = '1 = 1';
    if (deviceId) { clause = 'l.device_id = ?'; params.push(deviceId); }
    const rows = await this.query<any[]>(
      `SELECT l.*, d.name AS device_name
       FROM device_sync_logs l JOIN attendance_devices d ON d.id = l.device_id
       WHERE ${clause}
       ORDER BY l.started_at DESC, l.id DESC LIMIT ${capped}`,
      params,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      deviceId: Number(r.device_id),
      deviceName: r.device_name,
      syncType: r.sync_type,
      startedAt: iso(r.started_at)!,
      finishedAt: iso(r.finished_at),
      durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
      status: r.status,
      recordsReceived: Number(r.records_received ?? 0),
      recordsAccepted: Number(r.records_accepted ?? 0),
      recordsDuplicate: Number(r.records_duplicate ?? 0),
      recordsRejected: Number(r.records_rejected ?? 0),
      errorMessage: r.error_message ?? null,
    }));
  }

  // -------------------------------------------------------------------------
  // Enrollments
  // -------------------------------------------------------------------------
  async listEnrollments(deviceId?: number, employeeId?: number): Promise<DeviceEnrollment[]> {
    const where: string[] = ['en.deleted_at IS NULL'];
    const params: any[] = [];
    if (deviceId) { where.push('en.device_id = ?'); params.push(deviceId); }
    if (employeeId) { where.push('en.employee_id = ?'); params.push(employeeId); }

    const rows = await this.query<any[]>(
      `SELECT en.*, d.name AS device_name, e.full_name, e.emp_code
       FROM device_enrollments en
       JOIN attendance_devices d ON d.id = en.device_id
       JOIN employees e ON e.id = en.employee_id
       WHERE ${where.join(' AND ')}
       ORDER BY d.name ASC, e.full_name ASC`,
      params,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      deviceId: Number(r.device_id),
      deviceName: r.device_name,
      employeeId: Number(r.employee_id),
      employeeName: r.full_name,
      empCode: r.emp_code,
      deviceUserId: r.device_user_id,
      enrollmentType: r.enrollment_type,
      templatesCount: Number(r.templates_count ?? 0),
      qualityScore: r.quality_score === null ? null : Number(r.quality_score),
      enrolledAt: iso(r.enrolled_at),
      lastVerifiedAt: iso(r.last_verified_at),
      status: r.status,
      notes: r.notes ?? null,
    }));
  }

  async findEmployeeByDeviceUserId(deviceId: number, deviceUserId: string): Promise<number | null> {
    const rows = await this.query<any[]>(
      `SELECT employee_id FROM device_enrollments
       WHERE device_id = ? AND device_user_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' LIMIT 1`,
      [deviceId, deviceUserId],
    );
    return rows[0] ? Number(rows[0].employee_id) : null;
  }

  async upsertEnrollment(data: Partial<DeviceEnrollment>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO device_enrollments
         (device_id, employee_id, device_user_id, enrollment_type, templates_count, quality_score,
          enrolled_at, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         employee_id = VALUES(employee_id), enrollment_type = VALUES(enrollment_type),
         templates_count = VALUES(templates_count), quality_score = VALUES(quality_score),
         status = VALUES(status), notes = VALUES(notes), deleted_at = NULL`,
      [
        data.deviceId, data.employeeId, data.deviceUserId, data.enrollmentType ?? 'FINGERPRINT',
        data.templatesCount ?? 0, data.qualityScore ?? null, data.status ?? 'ACTIVE',
        data.notes ?? null, userId,
      ],
    );
    return Number(result.insertId);
  }

  async deleteEnrollment(id: number): Promise<void> {
    await this.query('UPDATE device_enrollments SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  async refreshEnrolledCounts(): Promise<void> {
    await this.query(
      `UPDATE attendance_devices d
       SET d.enrolled_count = (
         SELECT COUNT(*) FROM device_enrollments en
         WHERE en.device_id = d.id AND en.deleted_at IS NULL AND en.status = 'ACTIVE')`,
    );
  }

  private toDevice(r: any): AttendanceDevice {
    const lastBeat = r.last_heartbeat_at ? new Date(r.last_heartbeat_at) : null;
    return {
      id: Number(r.id),
      code: r.code,
      name: r.name,
      deviceType: r.device_type,
      vendor: r.vendor ?? null,
      model: r.model ?? null,
      serialNo: r.serial_no ?? null,
      firmwareVersion: r.firmware_version ?? null,
      ipAddress: r.ip_address ?? null,
      macAddress: r.mac_address ?? null,
      companyId: r.company_id === null ? null : Number(r.company_id),
      branchId: r.branch_id === null ? null : Number(r.branch_id),
      branchName: r.branch_name ?? null,
      locationId: r.location_id === null ? null : Number(r.location_id),
      locationName: r.location_name ?? null,
      geofenceId: r.geofence_id === null ? null : Number(r.geofence_id),
      geofenceName: r.geofence_name ?? null,
      timezone: r.timezone,
      hasApiKey: !!r.api_key_hash,
      apiKeyHint: r.api_key_hint ?? null,
      supportsInOut: !!r.supports_in_out,
      defaultPunchType: r.default_punch_type,
      syncMode: r.sync_mode,
      syncIntervalMinutes: Number(r.sync_interval_minutes ?? 15),
      heartbeatIntervalMinutes: Number(r.heartbeat_interval_minutes ?? 5),
      lastHeartbeatAt: iso(r.last_heartbeat_at),
      lastSyncAt: iso(r.last_sync_at),
      lastPunchAt: iso(r.last_punch_at),
      totalPunches: Number(r.total_punches ?? 0),
      enrolledCount: Number(r.enrolled_count ?? 0),
      healthStatus: r.health_status,
      healthNote: r.health_note ?? null,
      status: r.status,
      installedOn: r.installed_on ? toDateString(r.installed_on) : null,
      warrantyExpiresOn: r.warranty_expires_on ? toDateString(r.warranty_expires_on) : null,
      notes: r.notes ?? null,
      minutesSinceHeartbeat: lastBeat ? Math.floor((Date.now() - lastBeat.getTime()) / 60000) : null,
    };
  }
}
