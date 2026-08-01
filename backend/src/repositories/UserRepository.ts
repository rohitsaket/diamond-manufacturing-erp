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
      `SELECT id, email, name, role, is_active, last_login_at, employee_id, phone, avatar_url, theme,
              must_change_password, created_at
       FROM users WHERE id = ? AND deleted_at IS NULL`,
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

  async findByRoles(roles: string[]): Promise<UserRow[]> {
    if (roles.length === 0) return [];
    const placeholders = roles.map(() => '?').join(', ');
    return this.query<UserRow[]>(
      `SELECT id, email, name, role, employee_id FROM users
       WHERE role IN (${placeholders}) AND is_active = true AND deleted_at IS NULL`,
      roles,
    );
  }

  async findByEmployeeId(employeeId: number): Promise<UserRow | null> {
    const rows = await this.query<UserRow[]>(
      `SELECT id, email, name, role, employee_id FROM users
       WHERE employee_id = ? AND is_active = true AND deleted_at IS NULL LIMIT 1`,
      [employeeId],
    );
    return rows[0] || null;
  }

  /** Creates a self-service login for an employee. */
  async createEmployeeLogin(data: {
    email: string;
    passwordHash: string;
    name: string;
    employeeId: number;
    phone?: string | null;
  }): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO users (email, password_hash, name, role, employee_id, phone, must_change_password)
       VALUES (?, ?, ?, 'employee', ?, ?, true)`,
      [data.email, data.passwordHash, data.name, data.employeeId, data.phone ?? null],
    );
    return result.insertId;
  }

  async updatePassword(id: number, passwordHash: string): Promise<void> {
    await this.query(
      'UPDATE users SET password_hash = ?, must_change_password = false WHERE id = ?',
      [passwordHash, id],
    );
  }

  async updateTheme(id: number, theme: 'light' | 'dark' | 'system'): Promise<void> {
    await this.query('UPDATE users SET theme = ? WHERE id = ?', [theme, id]);
  }

  async deactivateByEmployeeId(employeeId: number): Promise<void> {
    await this.query('UPDATE users SET is_active = false WHERE employee_id = ?', [employeeId]);
  }
}
