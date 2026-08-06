import { BaseRepository } from '../repositories/BaseRepository';
import { PerfActionContext } from '../types/performance';

class ExitAuditRepository extends BaseRepository {
  async insert(
    entityType: string,
    entityId: number,
    action: string,
    ctx: PerfActionContext,
    previousValue: unknown,
    newValue: unknown,
  ): Promise<void> {
    await this.query(
      `INSERT INTO exit_audit_logs
         (entity_type, entity_id, action, user_id, user_role, previous_value, new_value, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entityType,
        entityId,
        action,
        ctx.userId ?? null,
        ctx.userRole ?? null,
        previousValue === undefined || previousValue === null ? null : JSON.stringify(previousValue),
        newValue === undefined || newValue === null ? null : JSON.stringify(newValue),
        ctx.ipAddress ?? null,
        ctx.userAgent ?? null,
      ],
    );
  }

  async list(filters: { entityType?: string; entityId?: number; limit?: number }): Promise<any[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.entityType) {
      where.push('l.entity_type = ?');
      params.push(filters.entityType);
    }
    if (filters.entityId) {
      where.push('l.entity_id = ?');
      params.push(filters.entityId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // LIMIT cannot be bound in this stack; inline the sanitized number.
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 200), 1), 1000);
    return this.query<any[]>(
      `SELECT l.*, u.name AS user_name
         FROM exit_audit_logs l
         LEFT JOIN users u ON u.id = l.user_id
         ${whereSql}
         ORDER BY l.id DESC
         LIMIT ${limit}`,
      params,
    );
  }
}

function parseJsonColumn(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return value;
  }
}

/**
 * Shared audit trail for every offboarding entity. Both offboarding work
 * streams import this; it owns the exit_audit_logs table alone.
 */
export class ExitAuditService {
  private repo = new ExitAuditRepository();

  /** Fire-and-forget: an audit failure must never fail the business write. */
  async record(
    entityType: string,
    entityId: number,
    action: string,
    ctx: PerfActionContext,
    previousValue?: unknown,
    newValue?: unknown,
  ): Promise<void> {
    try {
      await this.repo.insert(entityType, entityId, action, ctx, previousValue ?? null, newValue ?? null);
    } catch (err) {
      console.error(`exit audit write failed for ${entityType}#${entityId} ${action}:`, err);
    }
  }

  async list(filters: { entityType?: string; entityId?: number; limit?: number }): Promise<any[]> {
    const rows = await this.repo.list(filters);
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      userId: r.user_id,
      userName: r.user_name ?? null,
      userRole: r.user_role,
      previousValue: parseJsonColumn(r.previous_value),
      newValue: parseJsonColumn(r.new_value),
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      createdAt: r.created_at,
    }));
  }
}
