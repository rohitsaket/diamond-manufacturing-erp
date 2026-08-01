import { BaseRepository } from './BaseRepository';
import { SalaryLineRow, SalaryLineResponse } from '../types';

export class SalaryLineRepository extends BaseRepository {
  async findByPeriod(periodId: number): Promise<SalaryLineResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT sl.*, e.full_name as employee_name, e.emp_code
       FROM salary_lines sl
       JOIN employees e ON sl.employee_id = e.id
       WHERE sl.period_id = ?
       ORDER BY e.full_name`,
      [periodId],
    );
    return rows.map((r) => ({
      id: r.id,
      periodId: r.period_id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      empCode: r.emp_code,
      totalCts: parseFloat(r.total_cts),
      totalAmount: parseFloat(r.total_amount),
      managerVerified: r.manager_verified === 1 || r.manager_verified === true,
      accountVerified: r.account_verified === 1 || r.account_verified === true,
      paidAt: r.paid_at ? (r.paid_at instanceof Date ? r.paid_at.toISOString().split('T')[0] : String(r.paid_at)) : null,
      lotsCount: r.lots_count,
    }));
  }

  async findById(id: number): Promise<SalaryLineRow | null> {
    const rows = await this.query<SalaryLineRow[]>(
      'SELECT * FROM salary_lines WHERE id = ?',
      [id],
    );
    return rows[0] || null;
  }

  async managerVerify(id: number, userId: number): Promise<void> {
    await this.query(
      'UPDATE salary_lines SET manager_verified = true, manager_verified_by = ?, manager_verified_at = NOW() WHERE id = ?',
      [userId, id],
    );
  }

  async managerUnverify(id: number): Promise<void> {
    await this.query(
      'UPDATE salary_lines SET manager_verified = false, manager_verified_by = NULL, manager_verified_at = NULL WHERE id = ?',
      [id],
    );
  }

  async accountVerify(id: number, userId: number): Promise<void> {
    await this.query(
      'UPDATE salary_lines SET account_verified = true, account_verified_by = ?, account_verified_at = NOW(), paid_at = CURDATE() WHERE id = ? AND manager_verified = true',
      [userId, id],
    );
  }

  async accountUnverify(id: number): Promise<void> {
    await this.query(
      'UPDATE salary_lines SET account_verified = false, account_verified_by = NULL, account_verified_at = NULL, paid_at = NULL WHERE id = ?',
      [id],
    );
  }
}
