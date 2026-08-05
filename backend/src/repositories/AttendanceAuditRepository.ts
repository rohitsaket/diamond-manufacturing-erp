import { BaseRepository } from './BaseRepository';
import { AttendanceAuditEntry, AuditContext, AuditEntityType, Paged } from '../types/attendance';
import { toDateString } from '../utils/dateUtils';

export interface AuditWriteInput {
  entityType: AuditEntityType;
  entityId?: number | null;
  employeeId?: number | null;
  attDate?: string | null;
  action: string;
  summary?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  context?: AuditContext;
}

export interface AuditFilters {
  entityType?: AuditEntityType;
  entityId?: number;
  employeeId?: number;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** mysql2 cannot bind LIMIT/OFFSET, so they are sanitised and inlined. */
function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function toJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function fromJson(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

export class AttendanceAuditRepository extends BaseRepository {
  /**
   * Append-only. Never throws: an audit write failing must not roll back the
   * business action that produced it, but it is logged so the gap is visible.
   */
  async log(input: AuditWriteInput): Promise<void> {
    const ctx = input.context ?? {};
    try {
      await this.query(
        `INSERT INTO attendance_audit_logs
           (entity_type, entity_id, employee_id, att_date, action, summary,
            previous_value, new_value, actor_user_id, actor_role, actor_name,
            ip_address, device, browser, user_agent, latitude, longitude)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.entityType,
          input.entityId ?? null,
          input.employeeId ?? null,
          input.attDate ?? null,
          input.action,
          input.summary ?? null,
          toJson(input.previousValue),
          toJson(input.newValue),
          ctx.userId ?? null,
          ctx.actorRole ?? null,
          ctx.actorName ?? null,
          ctx.ipAddress ?? null,
          ctx.device ?? null,
          ctx.browser ?? null,
          ctx.userAgent ? String(ctx.userAgent).slice(0, 500) : null,
          ctx.latitude ?? null,
          ctx.longitude ?? null,
        ],
      );
    } catch (err: any) {
      console.error('[attendance-audit] failed to write audit row:', err?.message ?? err);
    }
  }

  async list(filters: AuditFilters): Promise<Paged<AttendanceAuditEntry>> {
    const where: string[] = ['1 = 1'];
    const params: any[] = [];

    if (filters.entityType) { where.push('l.entity_type = ?'); params.push(filters.entityType); }
    if (filters.entityId) { where.push('l.entity_id = ?'); params.push(filters.entityId); }
    if (filters.employeeId) { where.push('l.employee_id = ?'); params.push(filters.employeeId); }
    if (filters.action) { where.push('l.action = ?'); params.push(filters.action); }
    if (filters.from) { where.push('DATE(l.created_at) >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('DATE(l.created_at) <= ?'); params.push(filters.to); }

    const clause = where.join(' AND ');
    const page = safeInt(filters.page, 1, 1, 100000);
    const pageSize = safeInt(filters.pageSize, 50, 1, 500);
    const offset = (page - 1) * pageSize;

    const [countRows, rows] = await Promise.all([
      this.query<any[]>(`SELECT COUNT(*) AS n FROM attendance_audit_logs l WHERE ${clause}`, params),
      this.query<any[]>(
        `SELECT l.*, e.full_name AS employee_name
         FROM attendance_audit_logs l
         LEFT JOIN employees e ON e.id = l.employee_id
         WHERE ${clause}
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      ),
    ]);

    return {
      rows: rows.map((r) => this.toEntry(r)),
      total: Number(countRows[0]?.n ?? 0),
      page,
      pageSize,
    };
  }

  private toEntry(r: any): AttendanceAuditEntry {
    return {
      id: Number(r.id),
      entityType: r.entity_type,
      entityId: r.entity_id === null ? null : Number(r.entity_id),
      employeeId: r.employee_id === null ? null : Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      attDate: r.att_date ? toDateString(r.att_date) : null,
      action: r.action,
      summary: r.summary ?? null,
      previousValue: fromJson(r.previous_value),
      newValue: fromJson(r.new_value),
      actorUserId: r.actor_user_id === null ? null : Number(r.actor_user_id),
      actorRole: r.actor_role ?? null,
      actorName: r.actor_name ?? null,
      ipAddress: r.ip_address ?? null,
      device: r.device ?? null,
      browser: r.browser ?? null,
      latitude: r.latitude === null ? null : Number(r.latitude),
      longitude: r.longitude === null ? null : Number(r.longitude),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    };
  }
}
