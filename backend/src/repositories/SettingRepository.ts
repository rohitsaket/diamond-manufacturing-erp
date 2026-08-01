import { BaseRepository } from './BaseRepository';
import { SettingRow } from '../types';

export class SettingRepository extends BaseRepository {
  async getValue(key: string): Promise<string | null> {
    const rows = await this.query<SettingRow[]>(
      'SELECT `value` FROM settings WHERE `key` = ?',
      [key],
    );
    return rows[0]?.value ?? null;
  }

  async getAll(): Promise<Record<string, string>> {
    const rows = await this.query<SettingRow[]>('SELECT `key`, `value` FROM settings');
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  async set(key: string, value: string, updatedBy: number | null): Promise<void> {
    await this.query(
      'INSERT INTO settings (`key`, `value`, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `value` = ?, updated_by = ?',
      [key, value, updatedBy, value, updatedBy],
    );
  }
}
