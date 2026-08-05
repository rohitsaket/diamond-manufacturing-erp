import { BaseRepository } from './BaseRepository';
import { CaptureMethod, FaceEnrollment, Geofence, IpRule, NfcCard } from '../types/attendance';
import { parseCsvList } from '../utils/attendanceTime';
import { toDateString } from '../utils/dateUtils';

function iso(value: any): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function parsePolygon(value: any): [number, number][] | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((p: any) => Array.isArray(p) && p.length >= 2).map((p: any) => [Number(p[0]), Number(p[1])]);
  } catch {
    return null;
  }
}

/** Geofences, QR tokens, NFC cards, face enrolments and IP rules. */
export class AttendanceCredentialRepository extends BaseRepository {
  // -------------------------------------------------------------------------
  // Geofences
  // -------------------------------------------------------------------------
  async listGeofences(includeInactive = false): Promise<Geofence[]> {
    const rows = await this.query<any[]>(
      `SELECT g.*, b.name AS branch_name,
              (SELECT COUNT(*) FROM employee_geofences eg WHERE eg.geofence_id = g.id AND eg.deleted_at IS NULL) AS employee_count
       FROM geofences g
       LEFT JOIN branches b ON b.id = g.branch_id
       WHERE g.deleted_at IS NULL ${includeInactive ? '' : "AND g.status = 'ACTIVE'"}
       ORDER BY g.name ASC`,
    );
    return rows.map((r) => this.toGeofence(r));
  }

  async findGeofenceById(id: number): Promise<Geofence | null> {
    const rows = await this.query<any[]>(
      `SELECT g.*, b.name AS branch_name FROM geofences g
       LEFT JOIN branches b ON b.id = g.branch_id
       WHERE g.id = ? AND g.deleted_at IS NULL LIMIT 1`,
      [id],
    );
    return rows[0] ? this.toGeofence(rows[0]) : null;
  }

  /**
   * Fences an employee may punch inside. Explicit employee assignments win when
   * present -- with none, every active fence for the employee's branch applies,
   * plus branch-less fences which are treated as organisation-wide.
   */
  async findGeofencesForEmployee(employeeId: number): Promise<Geofence[]> {
    const assigned = await this.query<any[]>(
      `SELECT g.*, b.name AS branch_name
       FROM employee_geofences eg
       JOIN geofences g ON g.id = eg.geofence_id AND g.deleted_at IS NULL AND g.status = 'ACTIVE'
       LEFT JOIN branches b ON b.id = g.branch_id
       WHERE eg.employee_id = ? AND eg.deleted_at IS NULL
         AND (eg.effective_from IS NULL OR eg.effective_from <= CURDATE())
         AND (eg.effective_to IS NULL OR eg.effective_to >= CURDATE())`,
      [employeeId],
    );
    if (assigned.length) return assigned.map((r) => this.toGeofence(r));

    const rows = await this.query<any[]>(
      `SELECT g.*, b.name AS branch_name
       FROM geofences g
       LEFT JOIN branches b ON b.id = g.branch_id
       JOIN employees e ON e.id = ?
       WHERE g.deleted_at IS NULL AND g.status = 'ACTIVE'
         AND (g.branch_id IS NULL OR g.branch_id = e.branch_id)`,
      [employeeId],
    );
    return rows.map((r) => this.toGeofence(r));
  }

  async createGeofence(data: Partial<Geofence>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO geofences
         (code, name, company_id, branch_id, location_id, fence_type, center_lat, center_lng,
          radius_m, polygon, address, allow_methods, enforce_on_in, enforce_on_out,
          max_accuracy_m, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code, data.name, data.companyId ?? null, data.branchId ?? null, data.locationId ?? null,
        data.fenceType ?? 'CIRCLE', data.centerLat ?? null, data.centerLng ?? null, data.radiusM ?? 200,
        data.polygon ? JSON.stringify(data.polygon) : null, data.address ?? null,
        (data.allowMethods ?? ['WEB', 'MOBILE', 'KIOSK', 'QR', 'NFC']).join(','),
        data.enforceOnIn === false ? 0 : 1, data.enforceOnOut ? 1 : 0,
        data.maxAccuracyM ?? 100, data.status ?? 'ACTIVE', userId, userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateGeofence(id: number, data: Partial<Geofence>, current: Geofence, userId: number): Promise<void> {
    await this.query(
      `UPDATE geofences SET name = ?, branch_id = ?, location_id = ?, fence_type = ?,
         center_lat = ?, center_lng = ?, radius_m = ?, polygon = ?, address = ?,
         allow_methods = ?, enforce_on_in = ?, enforce_on_out = ?, max_accuracy_m = ?,
         status = ?, updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        data.name ?? current.name,
        data.branchId === undefined ? current.branchId : data.branchId,
        data.locationId === undefined ? current.locationId : data.locationId,
        data.fenceType ?? current.fenceType,
        data.centerLat === undefined ? current.centerLat : data.centerLat,
        data.centerLng === undefined ? current.centerLng : data.centerLng,
        data.radiusM ?? current.radiusM,
        data.polygon === undefined
          ? (current.polygon ? JSON.stringify(current.polygon) : null)
          : (data.polygon ? JSON.stringify(data.polygon) : null),
        data.address === undefined ? current.address : data.address,
        (data.allowMethods ?? current.allowMethods).join(','),
        (data.enforceOnIn ?? current.enforceOnIn) ? 1 : 0,
        (data.enforceOnOut ?? current.enforceOnOut) ? 1 : 0,
        data.maxAccuracyM ?? current.maxAccuracyM,
        data.status ?? current.status,
        userId, id,
      ],
    );
  }

  async deleteGeofence(id: number, userId: number): Promise<void> {
    await this.query('UPDATE geofences SET deleted_at = NOW(), updated_by = ? WHERE id = ?', [userId, id]);
  }

  async assignGeofence(employeeId: number, geofenceId: number, userId: number): Promise<void> {
    await this.query(
      `INSERT INTO employee_geofences (employee_id, geofence_id, created_by)
       VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE deleted_at = NULL`,
      [employeeId, geofenceId, userId],
    );
  }

  async unassignGeofence(employeeId: number, geofenceId: number): Promise<void> {
    await this.query(
      'UPDATE employee_geofences SET deleted_at = NOW() WHERE employee_id = ? AND geofence_id = ?',
      [employeeId, geofenceId],
    );
  }

  // -------------------------------------------------------------------------
  // QR tokens
  // -------------------------------------------------------------------------
  async createQrToken(data: {
    token: string;
    deviceId: number | null;
    geofenceId: number | null;
    branchId: number | null;
    isStatic: boolean;
    rotationSeconds: number;
    expiresAt: Date | null;
    maxUses: number | null;
    userId: number;
  }): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO qr_tokens (token, device_id, geofence_id, branch_id, is_static, rotation_seconds,
                              expires_at, max_uses, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.token, data.deviceId, data.geofenceId, data.branchId, data.isStatic ? 1 : 0,
        data.rotationSeconds, data.expiresAt, data.maxUses, data.userId,
      ],
    );
    return Number(result.insertId);
  }

  async findQrToken(token: string): Promise<{
    id: number; deviceId: number | null; geofenceId: number | null; branchId: number | null;
    isStatic: boolean; rotationSeconds: number; expiresAt: Date | null;
    maxUses: number | null; usedCount: number; status: string;
  } | null> {
    const rows = await this.query<any[]>('SELECT * FROM qr_tokens WHERE token = ? LIMIT 1', [token]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      deviceId: r.device_id === null ? null : Number(r.device_id),
      geofenceId: r.geofence_id === null ? null : Number(r.geofence_id),
      branchId: r.branch_id === null ? null : Number(r.branch_id),
      isStatic: !!r.is_static,
      rotationSeconds: Number(r.rotation_seconds ?? 60),
      expiresAt: r.expires_at ? new Date(r.expires_at) : null,
      maxUses: r.max_uses === null ? null : Number(r.max_uses),
      usedCount: Number(r.used_count ?? 0),
      status: r.status,
    };
  }

  async consumeQrToken(id: number): Promise<void> {
    await this.query('UPDATE qr_tokens SET used_count = used_count + 1, last_used_at = NOW() WHERE id = ?', [id]);
  }

  async revokeQrToken(id: number): Promise<void> {
    await this.query("UPDATE qr_tokens SET status = 'REVOKED' WHERE id = ?", [id]);
  }

  /** Housekeeping so the token table does not grow without bound. */
  async expireOldQrTokens(): Promise<number> {
    const result = await this.query<any>(
      "UPDATE qr_tokens SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at < NOW()",
    );
    return Number(result?.affectedRows ?? 0);
  }

  // -------------------------------------------------------------------------
  // NFC cards
  // -------------------------------------------------------------------------
  async listCards(filters: { employeeId?: number; status?: string; search?: string } = {}): Promise<NfcCard[]> {
    const where: string[] = ['c.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.employeeId) { where.push('c.employee_id = ?'); params.push(filters.employeeId); }
    if (filters.status) { where.push('c.status = ?'); params.push(filters.status); }
    if (filters.search) {
      where.push('(c.card_uid LIKE ? OR c.card_number LIKE ? OR e.full_name LIKE ? OR e.emp_code LIKE ?)');
      const like = `%${filters.search}%`;
      params.push(like, like, like, like);
    }
    const rows = await this.query<any[]>(
      `SELECT c.*, e.full_name, e.emp_code
       FROM nfc_cards c LEFT JOIN employees e ON e.id = c.employee_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.status ASC, e.full_name ASC`,
      params,
    );
    return rows.map((r) => this.toCard(r));
  }

  async findCardByUid(uid: string): Promise<NfcCard | null> {
    const rows = await this.query<any[]>(
      `SELECT c.*, e.full_name, e.emp_code
       FROM nfc_cards c LEFT JOIN employees e ON e.id = c.employee_id
       WHERE c.card_uid = ? AND c.deleted_at IS NULL LIMIT 1`,
      [uid],
    );
    return rows[0] ? this.toCard(rows[0]) : null;
  }

  async createCard(data: Partial<NfcCard>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO nfc_cards (card_uid, card_type, employee_id, card_number, issued_on, expires_on, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.cardUid, data.cardType ?? 'NFC', data.employeeId ?? null, data.cardNumber ?? null,
        data.issuedOn ?? null, data.expiresOn ?? null, data.status ?? 'ACTIVE', data.notes ?? null, userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateCardStatus(id: number, status: string, notes: string | null): Promise<void> {
    await this.query(
      `UPDATE nfc_cards SET status = ?, notes = COALESCE(?, notes),
         reported_lost_at = IF(? = 'LOST', NOW(), reported_lost_at)
       WHERE id = ?`,
      [status, notes, status, id],
    );
  }

  async recordCardUse(id: number): Promise<void> {
    await this.query('UPDATE nfc_cards SET use_count = use_count + 1, last_used_at = NOW() WHERE id = ?', [id]);
  }

  async deleteCard(id: number): Promise<void> {
    await this.query('UPDATE nfc_cards SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  // -------------------------------------------------------------------------
  // Face enrolments
  // -------------------------------------------------------------------------
  async listFaceEnrollments(employeeId?: number): Promise<FaceEnrollment[]> {
    const params: any[] = [];
    let clause = 'f.deleted_at IS NULL';
    if (employeeId) { clause += ' AND f.employee_id = ?'; params.push(employeeId); }
    const rows = await this.query<any[]>(
      `SELECT f.*, e.full_name, e.emp_code
       FROM face_enrollments f JOIN employees e ON e.id = f.employee_id
       WHERE ${clause} ORDER BY e.full_name ASC`,
      params,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.full_name,
      empCode: r.emp_code,
      provider: r.provider,
      externalRef: r.external_ref ?? null,
      imagesCount: Number(r.images_count ?? 0),
      qualityScore: r.quality_score === null ? null : Number(r.quality_score),
      enrolledAt: iso(r.enrolled_at),
      lastVerifiedAt: iso(r.last_verified_at),
      verificationCount: Number(r.verification_count ?? 0),
      status: r.status,
      statusNote: r.status_note ?? null,
    }));
  }

  async upsertFaceEnrollment(
    employeeId: number,
    provider: string,
    externalRef: string | null,
    status: FaceEnrollment['status'],
    note: string | null,
    userId: number,
  ): Promise<void> {
    await this.query(
      `INSERT INTO face_enrollments (employee_id, provider, external_ref, status, status_note, enrolled_at, created_by)
       VALUES (?, ?, ?, ?, ?, IF(? = 'ACTIVE', NOW(), NULL), ?)
       ON DUPLICATE KEY UPDATE
         provider = VALUES(provider), external_ref = VALUES(external_ref),
         status = VALUES(status), status_note = VALUES(status_note),
         enrolled_at = COALESCE(VALUES(enrolled_at), enrolled_at), deleted_at = NULL`,
      [employeeId, provider, externalRef, status, note, status, userId],
    );
  }

  // -------------------------------------------------------------------------
  // IP rules
  // -------------------------------------------------------------------------
  async listIpRules(includeInactive = false): Promise<IpRule[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM attendance_ip_rules
       WHERE deleted_at IS NULL ${includeInactive ? '' : "AND status = 'ACTIVE'"}
       ORDER BY rule_type DESC, code ASC`,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      code: r.code,
      name: r.name,
      ruleType: r.rule_type,
      cidr: r.cidr ?? null,
      ipFrom: r.ip_from ?? null,
      ipTo: r.ip_to ?? null,
      companyId: r.company_id === null ? null : Number(r.company_id),
      branchId: r.branch_id === null ? null : Number(r.branch_id),
      status: r.status,
    }));
  }

  async createIpRule(data: Partial<IpRule>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO attendance_ip_rules (code, name, rule_type, cidr, ip_from, ip_to, company_id, branch_id, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.code, data.name, data.ruleType ?? 'ALLOW', data.cidr ?? null, data.ipFrom ?? null,
        data.ipTo ?? null, data.companyId ?? null, data.branchId ?? null, data.status ?? 'ACTIVE', userId,
      ],
    );
    return Number(result.insertId);
  }

  async deleteIpRule(id: number): Promise<void> {
    await this.query('UPDATE attendance_ip_rules SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  // -------------------------------------------------------------------------
  // Mapping
  // -------------------------------------------------------------------------
  private toGeofence(r: any): Geofence {
    return {
      id: Number(r.id),
      code: r.code,
      name: r.name,
      companyId: r.company_id === null ? null : Number(r.company_id),
      branchId: r.branch_id === null ? null : Number(r.branch_id),
      branchName: r.branch_name ?? null,
      locationId: r.location_id === null ? null : Number(r.location_id),
      fenceType: r.fence_type,
      centerLat: r.center_lat === null ? null : Number(r.center_lat),
      centerLng: r.center_lng === null ? null : Number(r.center_lng),
      radiusM: Number(r.radius_m ?? 200),
      polygon: parsePolygon(r.polygon),
      address: r.address ?? null,
      allowMethods: parseCsvList(r.allow_methods) as CaptureMethod[],
      enforceOnIn: !!r.enforce_on_in,
      enforceOnOut: !!r.enforce_on_out,
      maxAccuracyM: Number(r.max_accuracy_m ?? 100),
      status: r.status,
      employeeCount: r.employee_count === undefined ? undefined : Number(r.employee_count),
    };
  }

  private toCard(r: any): NfcCard {
    return {
      id: Number(r.id),
      cardUid: r.card_uid,
      cardType: r.card_type,
      employeeId: r.employee_id === null ? null : Number(r.employee_id),
      employeeName: r.full_name ?? null,
      empCode: r.emp_code ?? null,
      cardNumber: r.card_number ?? null,
      issuedOn: r.issued_on ? toDateString(r.issued_on) : null,
      expiresOn: r.expires_on ? toDateString(r.expires_on) : null,
      status: r.status,
      reportedLostAt: iso(r.reported_lost_at),
      lastUsedAt: iso(r.last_used_at),
      useCount: Number(r.use_count ?? 0),
      notes: r.notes ?? null,
    };
  }
}
