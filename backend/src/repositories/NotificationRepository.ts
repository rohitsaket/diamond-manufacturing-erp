import { BaseRepository } from './BaseRepository';
import { NotificationResponse, CreateNotificationInput } from '../types/hrms';

export class NotificationRepository extends BaseRepository {
  async create(input: CreateNotificationInput, emailStatus: 'NONE' | 'PENDING'): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO notifications
        (user_id, category, priority, title, body, link_page, link_ref_id, email_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.userId,
        input.category,
        input.priority ?? 'NORMAL',
        input.title,
        input.body ?? null,
        input.linkPage ?? null,
        input.linkRefId ?? null,
        emailStatus,
        input.createdBy ?? null,
      ],
    );
    return result.insertId;
  }

  async markEmailStatus(id: number, status: 'SENT' | 'FAILED', error?: string): Promise<void> {
    await this.query('UPDATE notifications SET email_status = ?, email_error = ? WHERE id = ?', [
      status,
      error ? error.slice(0, 500) : null,
      id,
    ]);
  }

  async findForUser(
    userId: number,
    filters: { unreadOnly?: boolean; archived?: boolean; category?: string; search?: string; limit?: number } = {},
  ): Promise<NotificationResponse[]> {
    let sql = `SELECT * FROM notifications
               WHERE user_id = ?
                 AND is_archived = ?
                 AND (snoozed_until IS NULL OR snoozed_until <= NOW())`;
    const params: any[] = [userId, filters.archived ? 1 : 0];

    if (filters.unreadOnly) sql += ' AND is_read = false';
    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters.search) {
      sql += ' AND (title LIKE ? OR body LIKE ?)';
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    sql += ` ORDER BY created_at DESC LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toResponse(r));
  }

  async countUnread(userId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM notifications
       WHERE user_id = ? AND is_read = false AND is_archived = false
         AND (snoozed_until IS NULL OR snoozed_until <= NOW())`,
      [userId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  async markRead(id: number, userId: number): Promise<void> {
    await this.query('UPDATE notifications SET is_read = true, read_at = NOW() WHERE id = ? AND user_id = ?', [id, userId]);
  }

  async markAllRead(userId: number): Promise<number> {
    const result = await this.query<any>(
      'UPDATE notifications SET is_read = true, read_at = NOW() WHERE user_id = ? AND is_read = false',
      [userId],
    );
    return result.affectedRows ?? 0;
  }

  async archive(id: number, userId: number): Promise<void> {
    await this.query('UPDATE notifications SET is_archived = true WHERE id = ? AND user_id = ?', [id, userId]);
  }

  async snooze(id: number, userId: number, until: string): Promise<void> {
    await this.query('UPDATE notifications SET snoozed_until = ? WHERE id = ? AND user_id = ?', [until, id, userId]);
  }

  private toResponse(r: any): NotificationResponse {
    return {
      id: r.id,
      category: r.category,
      priority: r.priority,
      title: r.title,
      body: r.body,
      linkPage: r.link_page,
      linkRefId: r.link_ref_id,
      isRead: !!r.is_read,
      isArchived: !!r.is_archived,
      snoozedUntil: r.snoozed_until ? new Date(r.snoozed_until).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }
}
