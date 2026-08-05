import { BaseRepository } from './BaseRepository';

/**
 * Data access for performance cycles (`perf_cycles`).
 *
 * Every list read filters `deleted_at IS NULL`; the service layer owns all
 * validation and the DRAFT → … → CLOSED stage machine.
 */
export class PerformanceCycleRepository extends BaseRepository {
  async findAll(status?: string): Promise<any[]> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: any[] = [];
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    return this.query<any[]>(
      `SELECT * FROM perf_cycles WHERE ${where.join(' AND ')} ORDER BY start_date DESC, id DESC`,
      params,
    );
  }

  async findById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM perf_cycles WHERE id = ? AND deleted_at IS NULL', [id]);
    return rows[0] ?? null;
  }

  async findByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM perf_cycles WHERE code = ? AND deleted_at IS NULL', [code]);
    return rows[0] ?? null;
  }

  async create(fields: Record<string, any>): Promise<number> {
    const keys = Object.keys(fields);
    const result: any = await this.query(
      `INSERT INTO perf_cycles (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => fields[k]),
    );
    return result.insertId;
  }

  async update(id: number, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    await this.query(
      `UPDATE perf_cycles SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...keys.map((k) => fields[k]), id],
    );
  }
}
