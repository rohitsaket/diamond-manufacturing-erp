import crypto from 'crypto';
import { AttendanceDeviceRepository, DeviceFilters } from '../repositories/AttendanceDeviceRepository';
import { AttendanceCredentialRepository } from '../repositories/AttendanceCredentialRepository';
import { AttendanceAuditRepository } from '../repositories/AttendanceAuditRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { PunchEngineService } from './PunchEngineService';
import { QrTokenService } from './QrTokenService';
import { faceProvider } from './FaceRecognitionProvider';
import {
  AttendanceDevice, AuditContext, CaptureMethod, DeviceEnrollment, DeviceSyncLog,
  FaceEnrollment, Geofence, IpRule, NfcCard, PunchType, QrTokenResponse,
} from '../types/attendance';

/** One row of a device sync payload. */
export interface DevicePunchPayload {
  /** Either our employee id, the device's own enrolment id, or a card UID. */
  employeeId?: number;
  deviceUserId?: string;
  cardUid?: string;
  /** ISO instant, or `YYYY-MM-DD HH:MM:SS` in the device's timezone. */
  timestamp: string;
  punchType?: PunchType | 'AUTO';
  /** Device-side unique id for the record, used to make replays a no-op. */
  ref?: string;
  latitude?: number;
  longitude?: number;
  verifyMode?: string;
}

export interface DeviceSyncResult {
  deviceId: number;
  deviceName: string;
  syncLogId: number;
  received: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  errors: { index: number; reason: string }[];
  daysRecomputed: number;
}

const DEVICE_TYPE_METHOD: Record<string, CaptureMethod> = {
  BIOMETRIC: 'BIOMETRIC', FACE: 'FACE', QR_KIOSK: 'QR', NFC_READER: 'NFC',
  RFID_READER: 'RFID', WEB_KIOSK: 'KIOSK', MOBILE: 'MOBILE', TURNSTILE: 'BIOMETRIC',
  PALM: 'PALM', IRIS: 'IRIS',
};

export class AttendanceDeviceService {
  private repo = new AttendanceDeviceRepository();
  private credRepo = new AttendanceCredentialRepository();
  private employeeRepo = new EmployeeRepository();
  private auditRepo = new AttendanceAuditRepository();
  private engine = new PunchEngineService();
  private qrService = new QrTokenService();

  // =========================================================================
  // Registry
  // =========================================================================
  async list(filters: DeviceFilters = {}): Promise<AttendanceDevice[]> {
    // Refresh health on read so an offline terminal is not reported as online
    // just because nothing has polled it.
    await this.repo.refreshHealth();
    return this.repo.findAll(filters);
  }

  async get(id: number): Promise<AttendanceDevice> {
    const device = await this.repo.findById(id);
    if (!device) throw new Error('Device not found');
    return device;
  }

  async create(data: Partial<AttendanceDevice>, userId: number, ctx: AuditContext = {}): Promise<{ device: AttendanceDevice; apiKey: string }> {
    if (!data.code || !data.name) throw new Error('A device needs a code and a name');
    const clash = await this.repo.findByCode(data.code);
    if (clash) throw new Error(`Device code "${data.code}" is already registered`);

    const id = await this.repo.create(data, userId);
    const apiKey = await this.rotateApiKey(id, userId, ctx);

    await this.auditRepo.log({
      entityType: 'DEVICE', entityId: id, action: 'CREATE',
      summary: `Registered device ${data.name} (${data.code})`,
      newValue: { code: data.code, type: data.deviceType }, context: { ...ctx, userId },
    });

    return { device: await this.get(id), apiKey };
  }

  async update(id: number, data: Partial<AttendanceDevice>, userId: number, ctx: AuditContext = {}): Promise<AttendanceDevice> {
    const current = await this.get(id);
    await this.repo.update(id, data, current, userId);
    await this.auditRepo.log({
      entityType: 'DEVICE', entityId: id, action: 'UPDATE',
      summary: `Updated device ${current.name}`,
      previousValue: current as any, newValue: data as any, context: { ...ctx, userId },
    });
    return this.get(id);
  }

  async remove(id: number, userId: number, ctx: AuditContext = {}): Promise<{ success: true }> {
    const device = await this.get(id);
    if (device.totalPunches > 0) {
      // Punches reference the device. Decommissioning keeps that history
      // readable; a hard delete would orphan it.
      await this.repo.update(id, { status: 'DECOMMISSIONED' }, device, userId);
      await this.auditRepo.log({
        entityType: 'DEVICE', entityId: id, action: 'DEACTIVATE',
        summary: `Decommissioned device ${device.name}: it has ${device.totalPunches} punches, so its history is kept`,
        context: { ...ctx, userId },
      });
      return { success: true };
    }
    await this.repo.softDelete(id, userId);
    await this.auditRepo.log({
      entityType: 'DEVICE', entityId: id, action: 'DELETE',
      summary: `Deleted device ${device.name}`, context: { ...ctx, userId },
    });
    return { success: true };
  }

  /**
   * Mint a device key. Only the SHA-256 hash is stored, so the plaintext is
   * shown exactly once and cannot be recovered from the database later.
   */
  async rotateApiKey(id: number, userId: number, ctx: AuditContext = {}): Promise<string> {
    const device = await this.repo.findById(id);
    if (!device) throw new Error('Device not found');

    const apiKey = `dev_${crypto.randomBytes(24).toString('base64url')}`;
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    await this.repo.setApiKey(id, hash, apiKey.slice(-6));

    await this.auditRepo.log({
      entityType: 'DEVICE', entityId: id, action: 'ROTATE_KEY',
      summary: `Issued a new API key for ${device.name}`, context: { ...ctx, userId },
    });
    return apiKey;
  }

  /** Constant-time key check for the unauthenticated device sync endpoint. */
  async authenticateDevice(code: string, apiKey: string): Promise<AttendanceDevice> {
    const device = await this.repo.findByCode(code);
    if (!device) throw new Error('Device authentication failed');
    if (device.status === 'DECOMMISSIONED' || device.status === 'INACTIVE') {
      throw new Error(`Device "${device.name}" is ${device.status.toLowerCase()}`);
    }

    const stored = await this.repo.findApiKeyHash(device.id);
    if (!stored) throw new Error('Device authentication failed: no API key is set for this device');

    const provided = crypto.createHash('sha256').update(String(apiKey ?? '')).digest('hex');
    const a = Buffer.from(provided);
    const b = Buffer.from(stored);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error('Device authentication failed');
    }
    return device;
  }

  // =========================================================================
  // Sync
  // =========================================================================
  /**
   * Ingest a batch of raw device records.
   *
   * The device speaks in its own enrolment ids and timestamps. Resolution to an
   * employee happens here, then each row goes through the same punch engine a
   * web punch does, so policy, geofencing and the day recompute apply
   * identically no matter where the punch came from.
   */
  async ingest(
    device: AttendanceDevice,
    payload: DevicePunchPayload[],
    userId: number | null,
    ctx: AuditContext = {},
  ): Promise<DeviceSyncResult> {
    if (!Array.isArray(payload)) throw new Error('The sync payload must be an array of punch records');
    if (payload.length > 5000) throw new Error('A sync batch is limited to 5000 records. Split the batch.');

    const syncLogId = await this.repo.startSyncLog(device.id, 'PUSH', userId || null);
    const errors: { index: number; reason: string }[] = [];
    const touched = new Set<string>();
    let accepted = 0;
    let duplicates = 0;

    const method = DEVICE_TYPE_METHOD[device.deviceType] ?? 'API';

    for (let i = 0; i < payload.length; i += 1) {
      const row = payload[i]!;
      try {
        const employeeId = await this.resolveEmployee(device.id, row);
        const capturedAt = this.parseTimestamp(row.timestamp);

        const result = await this.engine.punch({
          employeeId,
          punchType: row.punchType ?? 'AUTO',
          captureMethod: method,
          deviceId: device.id,
          devicePunchRef: row.ref ?? `${device.code}:${employeeId}:${capturedAt}`,
          latitude: row.latitude,
          longitude: row.longitude,
          capturedAt,
          timezone: device.timezone,
          remarks: row.verifyMode ? `Device verify mode: ${row.verifyMode}` : undefined,
        }, { ...ctx, userId });

        if (result.warnings.some((w) => w.startsWith('This punch was already recorded'))) duplicates += 1;
        else accepted += 1;
        touched.add(`${result.punch.employeeId}|${result.punch.punchDate}`);
      } catch (err: any) {
        errors.push({ index: i, reason: err?.message ?? 'Unknown error' });
      }
    }

    const status = errors.length === 0 ? 'SUCCESS' : accepted > 0 ? 'PARTIAL' : 'FAILED';
    await this.repo.finishSyncLog(
      syncLogId,
      status,
      { received: payload.length, accepted, duplicate: duplicates, rejected: errors.length },
      errors.length ? errors.slice(0, 20).map((e) => `row ${e.index}: ${e.reason}`).join(' | ') : null,
    );
    await this.repo.recordHeartbeat(device.id, 'ONLINE', null);

    await this.auditRepo.log({
      entityType: 'DEVICE', entityId: device.id, action: 'SYNC',
      summary: `${device.name} synced ${payload.length} record(s): ${accepted} accepted, ${duplicates} duplicate, ${errors.length} rejected`,
      newValue: { accepted, duplicates, rejected: errors.length }, context: { ...ctx, userId },
    });

    return {
      deviceId: device.id,
      deviceName: device.name,
      syncLogId,
      received: payload.length,
      accepted,
      duplicates,
      rejected: errors.length,
      errors,
      daysRecomputed: touched.size,
    };
  }

  async heartbeat(device: AttendanceDevice, note?: string | null): Promise<{ acknowledged: true; nextSyncInMinutes: number }> {
    await this.repo.recordHeartbeat(device.id, 'ONLINE', note ?? null);
    return { acknowledged: true, nextSyncInMinutes: device.syncIntervalMinutes };
  }

  async listSyncLogs(deviceId?: number, limit = 50): Promise<DeviceSyncLog[]> {
    return this.repo.listSyncLogs(deviceId, limit);
  }

  async healthSummary(): Promise<{ online: number; offline: number; degraded: number; unknown: number; total: number }> {
    await this.repo.refreshHealth();
    return this.repo.healthSummary();
  }

  /**
   * A pull sync would open a connection to the terminal and read its log.
   * No vendor driver ships here, so this reports what is missing rather than
   * pretending a pull happened.
   */
  async pull(deviceId: number, userId: number): Promise<never> {
    const device = await this.get(deviceId);
    const logId = await this.repo.startSyncLog(deviceId, 'PULL', userId);
    const reason = `Pull sync needs a vendor driver for ${device.vendor ?? 'this device'} ${device.model ?? ''}`.trim()
      + '. None is bundled. Configure the device to push to POST /api/attendance/devices/sync instead, or add a driver for it.';
    await this.repo.finishSyncLog(logId, 'FAILED', { received: 0, accepted: 0, duplicate: 0, rejected: 0 }, reason);
    throw new Error(reason);
  }

  // =========================================================================
  // Enrollments
  // =========================================================================
  async listEnrollments(deviceId?: number, employeeId?: number): Promise<DeviceEnrollment[]> {
    return this.repo.listEnrollments(deviceId, employeeId);
  }

  async enroll(data: Partial<DeviceEnrollment>, userId: number, ctx: AuditContext = {}): Promise<DeviceEnrollment[]> {
    if (!data.deviceId || !data.employeeId || !data.deviceUserId) {
      throw new Error('An enrolment needs a device, an employee and the id the device knows them by');
    }
    const [device, employee] = await Promise.all([
      this.repo.findById(data.deviceId),
      this.employeeRepo.findRowById(data.employeeId),
    ]);
    if (!device) throw new Error('Device not found');
    if (!employee) throw new Error('Employee not found');

    await this.repo.upsertEnrollment(data, userId);
    await this.repo.refreshEnrolledCounts();
    await this.auditRepo.log({
      entityType: 'DEVICE', entityId: data.deviceId, employeeId: data.employeeId, action: 'ENROLL',
      summary: `${employee.full_name} enrolled on ${device.name} as ${data.deviceUserId}`,
      context: { ...ctx, userId },
    });
    return this.repo.listEnrollments(data.deviceId);
  }

  async removeEnrollment(id: number): Promise<{ success: true }> {
    await this.repo.deleteEnrollment(id);
    await this.repo.refreshEnrolledCounts();
    return { success: true };
  }

  // =========================================================================
  // Geofences, cards, QR, face, IP
  // =========================================================================
  async listGeofences(includeInactive = false): Promise<Geofence[]> {
    return this.credRepo.listGeofences(includeInactive);
  }

  async createGeofence(data: Partial<Geofence>, userId: number, ctx: AuditContext = {}): Promise<Geofence[]> {
    this.validateGeofence(data);
    await this.credRepo.createGeofence(data, userId);
    await this.auditRepo.log({
      entityType: 'GEOFENCE', action: 'CREATE',
      summary: `Created geofence ${data.name}`, newValue: data as any, context: { ...ctx, userId },
    });
    return this.credRepo.listGeofences(true);
  }

  async updateGeofence(id: number, data: Partial<Geofence>, userId: number, ctx: AuditContext = {}): Promise<Geofence[]> {
    const current = await this.credRepo.findGeofenceById(id);
    if (!current) throw new Error('Geofence not found');
    this.validateGeofence({ ...current, ...data });
    await this.credRepo.updateGeofence(id, data, current, userId);
    await this.auditRepo.log({
      entityType: 'GEOFENCE', entityId: id, action: 'UPDATE',
      summary: `Updated geofence ${current.name}`,
      previousValue: current as any, newValue: data as any, context: { ...ctx, userId },
    });
    return this.credRepo.listGeofences(true);
  }

  async deleteGeofence(id: number, userId: number): Promise<{ success: true }> {
    const fence = await this.credRepo.findGeofenceById(id);
    if (!fence) throw new Error('Geofence not found');
    await this.credRepo.deleteGeofence(id, userId);
    return { success: true };
  }

  private validateGeofence(data: Partial<Geofence>): void {
    if (!data.code || !data.name) throw new Error('A geofence needs a code and a name');
    if (data.fenceType === 'POLYGON') {
      if (!Array.isArray(data.polygon) || data.polygon.length < 3) {
        throw new Error('A polygon fence needs at least three points');
      }
      for (const point of data.polygon) {
        if (!Array.isArray(point) || point.length < 2) throw new Error('Each polygon point must be a [longitude, latitude] pair');
        const [lng, lat] = point;
        if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error(`Longitude ${lng} is out of range`);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error(`Latitude ${lat} is out of range`);
      }
      return;
    }
    const lat = Number(data.centerLat);
    const lng = Number(data.centerLng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('A circular fence needs a latitude between -90 and 90');
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error('A circular fence needs a longitude between -180 and 180');
    const radius = Number(data.radiusM ?? 200);
    if (!Number.isFinite(radius) || radius < 10 || radius > 50000) {
      throw new Error('Fence radius must be between 10 and 50000 metres');
    }
  }

  async assignGeofence(employeeId: number, geofenceId: number, userId: number): Promise<{ success: true }> {
    await this.credRepo.assignGeofence(employeeId, geofenceId, userId);
    return { success: true };
  }

  async unassignGeofence(employeeId: number, geofenceId: number): Promise<{ success: true }> {
    await this.credRepo.unassignGeofence(employeeId, geofenceId);
    return { success: true };
  }

  async issueQr(deviceId: number, userId: number): Promise<QrTokenResponse> {
    const device = await this.get(deviceId);
    if (device.status !== 'ACTIVE') throw new Error(`Device "${device.name}" is ${device.status.toLowerCase()} and cannot issue QR codes`);
    return this.qrService.issue(deviceId, {
      geofenceId: device.geofenceId,
      branchId: device.branchId,
      userId,
    });
  }

  async listCards(filters: { employeeId?: number; status?: string; search?: string } = {}): Promise<NfcCard[]> {
    return this.credRepo.listCards(filters);
  }

  async createCard(data: Partial<NfcCard>, userId: number, ctx: AuditContext = {}): Promise<NfcCard[]> {
    if (!data.cardUid) throw new Error('A card UID is required');
    const existing = await this.credRepo.findCardByUid(data.cardUid);
    if (existing) throw new Error(`Card ${data.cardUid} is already registered`);
    await this.credRepo.createCard(data, userId);
    await this.auditRepo.log({
      entityType: 'NFC_CARD', employeeId: data.employeeId ?? null, action: 'CREATE',
      summary: `Issued card ${data.cardUid}`, context: { ...ctx, userId },
    });
    return this.credRepo.listCards({});
  }

  async setCardStatus(id: number, status: string, notes: string | null, userId: number, ctx: AuditContext = {}): Promise<NfcCard[]> {
    const allowed = ['ACTIVE', 'INACTIVE', 'LOST', 'DAMAGED', 'EXPIRED', 'RETURNED'];
    if (!allowed.includes(status)) throw new Error(`Invalid card status. Allowed: ${allowed.join(', ')}`);
    await this.credRepo.updateCardStatus(id, status, notes);
    await this.auditRepo.log({
      entityType: 'NFC_CARD', entityId: id, action: 'UPDATE',
      summary: `Card ${id} marked ${status.toLowerCase()}`, context: { ...ctx, userId },
    });
    return this.credRepo.listCards({});
  }

  async deleteCard(id: number): Promise<{ success: true }> {
    await this.credRepo.deleteCard(id);
    return { success: true };
  }

  async listFaceEnrollments(employeeId?: number): Promise<{ status: ReturnType<typeof faceProvider.status>; rows: FaceEnrollment[] }> {
    return { status: faceProvider.status(), rows: await this.credRepo.listFaceEnrollments(employeeId) };
  }

  async enrollFace(employeeId: number, imageRefs: string[], userId: number): Promise<FaceEnrollment[]> {
    const employee = await this.employeeRepo.findRowById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const result = await faceProvider.enroll(employeeId, imageRefs);
    await this.credRepo.upsertFaceEnrollment(
      employeeId,
      faceProvider.providerName,
      result.externalRef,
      result.available ? (result.enrolled ? 'ACTIVE' : 'FAILED') : 'NOT_CONFIGURED',
      result.note,
      userId,
    );
    if (!result.available) throw new Error(result.note);
    return this.credRepo.listFaceEnrollments(employeeId);
  }

  async listIpRules(includeInactive = false): Promise<IpRule[]> {
    return this.credRepo.listIpRules(includeInactive);
  }

  async createIpRule(data: Partial<IpRule>, userId: number): Promise<IpRule[]> {
    if (!data.code || !data.name) throw new Error('An IP rule needs a code and a name');
    if (!data.cidr && !(data.ipFrom && data.ipTo)) {
      throw new Error('An IP rule needs either a CIDR block or a from/to address pair');
    }
    await this.credRepo.createIpRule(data, userId);
    return this.credRepo.listIpRules(true);
  }

  async deleteIpRule(id: number): Promise<{ success: true }> {
    await this.credRepo.deleteIpRule(id);
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  private async resolveEmployee(deviceId: number, row: DevicePunchPayload): Promise<number> {
    if (row.employeeId) return Number(row.employeeId);
    if (row.deviceUserId) {
      const id = await this.repo.findEmployeeByDeviceUserId(deviceId, row.deviceUserId);
      if (id) return id;
      throw new Error(`Device user id "${row.deviceUserId}" is not enrolled against any employee on this device`);
    }
    if (row.cardUid) {
      const card = await this.credRepo.findCardByUid(row.cardUid);
      if (card?.employeeId) return card.employeeId;
      throw new Error(`Card ${row.cardUid} is not linked to an employee`);
    }
    throw new Error('Each record needs an employeeId, deviceUserId or cardUid');
  }

  /** Accepts ISO or `YYYY-MM-DD HH:MM:SS`, both of which terminals emit. */
  private parseTimestamp(value: string): string {
    const raw = String(value ?? '').trim();
    if (!raw) throw new Error('A timestamp is required');
    const normalised = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)
      ? raw.replace(' ', 'T')
      : raw;
    const parsed = new Date(normalised);
    if (Number.isNaN(parsed.getTime())) throw new Error(`Could not read timestamp "${value}"`);
    return parsed.toISOString();
  }
}
