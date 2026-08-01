import { BaseRepository } from './BaseRepository';
import { SalaryPeriodRow, SalaryPeriodResponse } from '../types';

export class SalaryPeriodRepository extends BaseRepository {
  async findAll(): Promise<SalaryPeriodResponse[]> {
    const rows = await this.query<SalaryPeriodRow[]>(
      'SELECT * FROM salary_periods WHERE deleted_at IS NULL ORDER BY from_date DESC',
    );
    return rows.map(this.toResponse);
  }

  async findById(id: number): Promise<SalaryPeriodResponse | null> {
    const rows = await this.query<SalaryPeriodRow[]>(
      'SELECT * FROM salary_periods WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toResponse(rows[0]) : null;
  }

  async findOpenPeriod(): Promise<SalaryPeriodResponse | null> {
    const rows = await this.query<SalaryPeriodRow[]>(
      "SELECT * FROM salary_periods WHERE status = 'OPEN' AND deleted_at IS NULL LIMIT 1",
    );
    return rows[0] ? this.toResponse(rows[0]) : null;
  }

  async lock(id: number, updatedBy: number): Promise<void> {
    await this.query(
      "UPDATE salary_periods SET status = 'LOCKED', locked_at = NOW(), updated_by = ? WHERE id = ? AND status = 'OPEN'",
      [updatedBy, id],
    );
  }

  async markPaid(id: number, updatedBy: number): Promise<void> {
    await this.query(
      "UPDATE salary_periods SET status = 'PAID', paid_at = NOW(), updated_by = ? WHERE id = ? AND status = 'LOCKED'",
      [updatedBy, id],
    );
  }

  async create(data: { label: string; fromDate: string; toDate: string; createdBy: number }): Promise<SalaryPeriodResponse> {
    const result = await this.query<any>(
      'INSERT INTO salary_periods (label, from_date, to_date, created_by) VALUES (?, ?, ?, ?)',
      [data.label, data.fromDate, data.toDate, data.createdBy],
    );
    return this.findById(result.insertId) as Promise<SalaryPeriodResponse>;
  }

  private toResponse(row: SalaryPeriodRow): SalaryPeriodResponse {
    return {
      id: row.id,
      label: row.label,
      fromDate: (row as any).from_date instanceof Date ? (row as any).from_date.toISOString().split('T')[0] : String(row.from_date),
      toDate: (row as any).to_date instanceof Date ? (row as any).to_date.toISOString().split('T')[0] : String(row.to_date),
      status: row.status,
    };
  }
}
