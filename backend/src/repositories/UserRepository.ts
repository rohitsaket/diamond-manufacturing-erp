import { BaseRepository } from './BaseRepository';
import { UserRow } from '../types';

export class UserRepository extends BaseRepository {
  async findByEmail(email: string): Promise<UserRow | null> {
    const rows = await this.query<UserRow[]>(
      'SELECT * FROM users WHERE email = ? AND deleted_at IS NULL',
      [email],
    );
    return rows[0] || null;
  }

  async findById(id: number): Promise<UserRow | null> {
    const rows = await this.query<UserRow[]>(
      'SELECT id, email, name, role, is_active, last_login_at, created_at FROM users WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] || null;
  }

  async updateLastLogin(id: number): Promise<void> {
    await this.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = ?',
      [id],
    );
  }
}
