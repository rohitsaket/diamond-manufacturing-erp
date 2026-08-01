import { BaseRepository } from './BaseRepository';
import { WorkerType } from '../types';
import {
  CandidateResponse,
  CandidateStatus,
  JobOpeningResponse,
  JobOpeningStatus,
} from '../types/hrms';
import { toDateString } from '../utils/dateUtils';

// ---------------------------------------------------------------------------
// Row / input shapes
// ---------------------------------------------------------------------------
export interface CandidateRow {
  id: number;
  full_name: string;
  phone: string;
  email: string | null;
  opening_id: number | null;
  position_grade: string;
  worker_type: WorkerType;
  expected_salary: number | null;
  experience_years: number | null;
  source: string | null;
  status: CandidateStatus;
  interview_date: string | null;
  notes: string | null;
  converted_employee_id: number | null;
  created_at: string;
}

export interface CreateOpeningInput {
  title: string;
  department?: string | null;
  grade?: string | null;
  workerType?: WorkerType;
  openings?: number;
  openedAt: string;
  notes?: string | null;
}

export interface UpdateOpeningInput {
  title?: string;
  department?: string | null;
  grade?: string | null;
  workerType?: WorkerType;
  openings?: number;
  status?: JobOpeningStatus;
  notes?: string | null;
}

export interface CreateCandidateInput {
  fullName: string;
  phone: string;
  email?: string | null;
  openingId?: number | null;
  positionGrade: string;
  workerType?: WorkerType;
  expectedSalary?: number | null;
  experienceYears?: number | null;
  source?: string | null;
  interviewDate?: string | null;
  notes?: string | null;
}

export interface UpdateCandidateInput {
  fullName?: string;
  phone?: string;
  email?: string | null;
  openingId?: number | null;
  positionGrade?: string;
  workerType?: WorkerType;
  expectedSalary?: number | null;
  experienceYears?: number | null;
  source?: string | null;
  interviewDate?: string | null;
  notes?: string | null;
}

export interface CandidateFilters {
  status?: CandidateStatus;
  openingId?: number;
  search?: string;
  limit?: number;
}

/** Columns update() may write, mapped to their DB names. */
const CANDIDATE_COLUMNS: Record<keyof UpdateCandidateInput, string> = {
  fullName: 'full_name',
  phone: 'phone',
  email: 'email',
  openingId: 'opening_id',
  positionGrade: 'position_grade',
  workerType: 'worker_type',
  expectedSalary: 'expected_salary',
  experienceYears: 'experience_years',
  source: 'source',
  interviewDate: 'interview_date',
  notes: 'notes',
};

const OPENING_COLUMNS: Record<keyof UpdateOpeningInput, string> = {
  title: 'title',
  department: 'department',
  grade: 'grade',
  workerType: 'worker_type',
  openings: 'openings',
  status: 'status',
  notes: 'notes',
};

export class CandidateRepository extends BaseRepository {
  /** Exposes the pooled transaction helper to the service layer. */
  async withTransaction<T>(fn: (connection: any) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  // =========================================================================
  // Job openings
  // =========================================================================
  async findOpenings(status?: JobOpeningStatus): Promise<JobOpeningResponse[]> {
    let sql = `
      SELECT o.*,
             (SELECT COUNT(*) FROM candidates c
               WHERE c.opening_id = o.id AND c.deleted_at IS NULL) AS candidate_count
      FROM job_openings o
      WHERE o.deleted_at IS NULL`;
    const params: any[] = [];

    if (status) {
      sql += ' AND o.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY o.status = \'CLOSED\', o.opened_at DESC, o.id DESC';

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.openingToResponse(r));
  }

  async findOpeningById(id: number): Promise<JobOpeningResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT o.*,
              (SELECT COUNT(*) FROM candidates c
                WHERE c.opening_id = o.id AND c.deleted_at IS NULL) AS candidate_count
       FROM job_openings o
       WHERE o.id = ? AND o.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.openingToResponse(rows[0]) : null;
  }

  async createOpening(data: CreateOpeningInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO job_openings
         (title, department, grade, worker_type, openings, opened_at, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.title,
        data.department ?? null,
        data.grade ?? null,
        data.workerType ?? 'PIECE_RATE',
        data.openings ?? 1,
        data.openedAt,
        data.notes ?? null,
        userId,
        userId,
      ],
    );
    return result.insertId;
  }

  async updateOpening(id: number, data: UpdateOpeningInput, userId: number): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(OPENING_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value === '' ? null : value);
    }
    if (sets.length === 0) return;

    sets.push('updated_by = ?');
    params.push(userId, id);

    await this.query(
      `UPDATE job_openings SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async closeOpening(id: number, closedAt: string, userId: number): Promise<void> {
    await this.query(
      `UPDATE job_openings
       SET status = 'CLOSED', closed_at = ?, updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [closedAt, userId, id],
    );
  }

  async softDeleteOpening(id: number): Promise<void> {
    await this.query(
      'UPDATE job_openings SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
  }

  /** Open requisitions counter for the HR dashboard. */
  async countOpen(): Promise<number> {
    const rows = await this.query<any[]>(
      "SELECT COUNT(*) AS cnt FROM job_openings WHERE status = 'OPEN' AND deleted_at IS NULL",
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  // =========================================================================
  // Candidates
  // =========================================================================
  async findAll(filters: CandidateFilters = {}): Promise<CandidateResponse[]> {
    let sql = `
      SELECT c.*, o.title AS opening_title
      FROM candidates c
      LEFT JOIN job_openings o ON o.id = c.opening_id
      WHERE c.deleted_at IS NULL`;
    const params: any[] = [];

    if (filters.status) {
      sql += ' AND c.status = ?';
      params.push(filters.status);
    }
    if (filters.openingId) {
      sql += ' AND c.opening_id = ?';
      params.push(filters.openingId);
    }
    if (filters.search) {
      sql += ' AND (c.full_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)';
      const like = `%${filters.search}%`;
      params.push(like, like, like);
    }

    const limit = Math.min(500, Math.max(1, filters.limit || 200));
    sql += ` ORDER BY c.created_at DESC, c.id DESC LIMIT ${limit}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toResponse(r));
  }

  async findById(id: number): Promise<CandidateResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT c.*, o.title AS opening_title
       FROM candidates c
       LEFT JOIN job_openings o ON o.id = c.opening_id
       WHERE c.id = ? AND c.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.toResponse(rows[0]) : null;
  }

  /** Raw row lookup; accepts a connection so it can run inside a transaction. */
  async findRowById(id: number, conn?: any): Promise<CandidateRow | null> {
    const sql = 'SELECT * FROM candidates WHERE id = ? AND deleted_at IS NULL';
    if (conn) {
      const [rows] = await conn.query(sql, [id]);
      return (rows as CandidateRow[])[0] || null;
    }
    const rows = await this.query<CandidateRow[]>(sql, [id]);
    return rows[0] || null;
  }

  async create(data: CreateCandidateInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO candidates
         (full_name, phone, email, opening_id, position_grade, worker_type, expected_salary,
          experience_years, source, interview_date, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.fullName,
        data.phone,
        data.email ?? null,
        data.openingId ?? null,
        data.positionGrade,
        data.workerType ?? 'PIECE_RATE',
        data.expectedSalary ?? null,
        data.experienceYears ?? null,
        data.source ?? null,
        data.interviewDate ?? null,
        data.notes ?? null,
        userId,
        userId,
      ],
    );
    return result.insertId;
  }

  async update(id: number, data: UpdateCandidateInput, userId: number): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(CANDIDATE_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value === '' ? null : value);
    }
    if (sets.length === 0) return;

    sets.push('updated_by = ?');
    params.push(userId, id);

    await this.query(
      `UPDATE candidates SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  async updateStatus(id: number, status: CandidateStatus, userId: number): Promise<void> {
    await this.query(
      'UPDATE candidates SET status = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL',
      [status, userId, id],
    );
  }

  /** Links a candidate to the employee record created from it. */
  async markJoined(id: number, employeeId: number, conn?: any): Promise<void> {
    const sql = `UPDATE candidates
                 SET status = 'JOINED', converted_employee_id = ?
                 WHERE id = ? AND deleted_at IS NULL`;
    const params = [employeeId, id];
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  async softDelete(id: number): Promise<void> {
    await this.query(
      'UPDATE candidates SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
  }

  /** Pipeline funnel counts for dashboards; every status is always present. */
  async countByStatus(): Promise<Record<CandidateStatus, number>> {
    const rows = await this.query<any[]>(
      'SELECT status, COUNT(*) AS cnt FROM candidates WHERE deleted_at IS NULL GROUP BY status',
    );
    const out: Record<CandidateStatus, number> = {
      APPLIED: 0,
      INTERVIEW: 0,
      SELECTED: 0,
      JOINED: 0,
      REJECTED: 0,
    };
    for (const r of rows) {
      const key = r.status as CandidateStatus;
      if (key in out) out[key] = Number(r.cnt ?? 0);
    }
    return out;
  }

  // =========================================================================
  // Mappers
  // =========================================================================
  private openingToResponse(r: any): JobOpeningResponse {
    return {
      id: r.id,
      title: r.title,
      department: r.department,
      grade: r.grade,
      workerType: r.worker_type,
      openings: Number(r.openings ?? 0),
      status: r.status,
      openedAt: toDateString(r.opened_at),
      closedAt: r.closed_at ? toDateString(r.closed_at) : null,
      notes: r.notes,
      candidateCount: Number(r.candidate_count ?? 0),
    };
  }

  private toResponse(r: any): CandidateResponse {
    return {
      id: r.id,
      fullName: r.full_name,
      phone: r.phone,
      email: r.email,
      openingId: r.opening_id,
      openingTitle: r.opening_title ?? null,
      positionGrade: r.position_grade,
      workerType: r.worker_type,
      expectedSalary: r.expected_salary === null ? null : Number(r.expected_salary),
      experienceYears: r.experience_years === null ? null : Number(r.experience_years),
      source: r.source,
      status: r.status,
      interviewDate: r.interview_date ? new Date(r.interview_date).toISOString() : null,
      notes: r.notes,
      convertedEmployeeId: r.converted_employee_id,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }
}
