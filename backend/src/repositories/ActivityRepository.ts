import { BaseRepository } from './BaseRepository';
import { ActivityResponse } from '../types/hrms';

export interface ActivityInput {
  actorUserId?: number | null;
  actorName?: string | null;
  employeeId?: number | null;
  entityType: string;
  entityId?: number | null;
  action: string;
  summary: string;
  meta?: Record<string, unknown> | null;
}

export class ActivityRepository extends BaseRepository {
  async log(input: ActivityInput, conn?: any): Promise<void> {
    const sql = `INSERT INTO activity_logs
        (actor_user_id, actor_name, employee_id, entity_type, entity_id, action, summary, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      input.actorUserId ?? null,
      input.actorName ?? null,
      input.employeeId ?? null,
      input.entityType,
      input.entityId ?? null,
      input.action,
      input.summary.slice(0, 500),
      input.meta ? JSON.stringify(input.meta) : null,
    ];
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  async findRecent(filters: { employeeId?: number; entityType?: string; limit?: number } = {}): Promise<ActivityResponse[]> {
    let sql = 'SELECT * FROM activity_logs WHERE 1 = 1';
    const params: any[] = [];

    if (filters.employeeId) {
      sql += ' AND employee_id = ?';
      params.push(filters.employeeId);
    }
    if (filters.entityType) {
      sql += ' AND entity_type = ?';
      params.push(filters.entityType);
    }

    const limit = Math.min(200, Math.max(1, filters.limit ?? 30));
    sql += ` ORDER BY created_at DESC LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      actorName: r.actor_name,
      employeeId: r.employee_id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      summary: r.summary,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }
}
