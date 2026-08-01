import { BaseRepository } from '../repositories/BaseRepository';
import { SearchResultItem } from '../types/hrms';

/** The caller identity the search is scoped against. */
export interface SearchUser {
  userId: number;
  role: string;
  employeeId?: number | null;
}

class SearchQueryRepository extends BaseRepository {
  async run<T = any[]>(sql: string, params: any[] = []): Promise<T> {
    return this.query<T>(sql, params);
  }
}

const PER_SOURCE_LIMIT = 5;

/**
 * Global omnibox search.
 *
 * Every source is queried in parallel and capped, so a broad term stays cheap.
 * Self-service ('employee') callers only ever see their own rows; company-wide
 * sources (candidates, assets, salary periods) are skipped for them entirely.
 */
export class SearchService {
  private db = new SearchQueryRepository();

  async search(query: string, user: SearchUser): Promise<SearchResultItem[]> {
    const term = (query ?? '').trim();
    if (term.length < 2) throw new Error('Enter at least 2 characters');

    const like = `%${escapeLike(term)}%`;
    const selfOnly = user.role === 'employee';
    const selfId = user.employeeId ?? 0;

    // A self-service account with no linked employee record can see nothing.
    if (selfOnly && !selfId) return [];

    const employeeScope = selfOnly ? 'AND e.id = ?' : '';
    const employeeScopeParams: any[] = selfOnly ? [selfId] : [];

    const [
      employees,
      lots,
      leaves,
      advances,
      candidates,
      tickets,
      assets,
      documents,
      periods,
    ] = await Promise.all([
      this.db.run<any[]>(
        `SELECT e.id, e.full_name, e.emp_code, e.department, e.work_status
           FROM employees e
          WHERE e.deleted_at IS NULL AND (e.full_name LIKE ? OR e.emp_code LIKE ?) ${employeeScope}
          ORDER BY e.full_name ASC
          LIMIT ${PER_SOURCE_LIMIT}`,
        [like, like, ...employeeScopeParams],
      ),
      this.db.run<any[]>(
        `SELECT l.id, l.lot_id, l.lot_name, l.status, e.full_name AS employee_name
           FROM lots l
           JOIN employees e ON e.id = l.employee_id
          WHERE l.deleted_at IS NULL AND (l.lot_id LIKE ? OR l.lot_name LIKE ?)
            ${selfOnly ? 'AND l.employee_id = ?' : ''}
          ORDER BY l.issue_date DESC
          LIMIT ${PER_SOURCE_LIMIT}`,
        selfOnly ? [like, like, selfId] : [like, like],
      ),
      this.db.run<any[]>(
        `SELECT lr.id, lr.from_date, lr.to_date, lr.status, e.full_name AS employee_name,
                lt.name AS leave_type_name
           FROM leave_requests lr
           JOIN employees e ON e.id = lr.employee_id
           JOIN leave_types lt ON lt.id = lr.leave_type_id
          WHERE lr.deleted_at IS NULL AND e.full_name LIKE ?
            ${selfOnly ? 'AND lr.employee_id = ?' : ''}
          ORDER BY lr.from_date DESC
          LIMIT ${PER_SOURCE_LIMIT}`,
        selfOnly ? [like, selfId] : [like],
      ),
      this.db.run<any[]>(
        `SELECT a.id, a.amount, a.advance_type, a.status, a.advance_date, e.full_name AS employee_name
           FROM advances a
           JOIN employees e ON e.id = a.employee_id
          WHERE a.deleted_at IS NULL AND e.full_name LIKE ?
            ${selfOnly ? 'AND a.employee_id = ?' : ''}
          ORDER BY a.advance_date DESC
          LIMIT ${PER_SOURCE_LIMIT}`,
        selfOnly ? [like, selfId] : [like],
      ),
      selfOnly
        ? Promise.resolve([] as any[])
        : this.db.run<any[]>(
            `SELECT id, full_name, phone, status, position_grade
               FROM candidates
              WHERE deleted_at IS NULL AND (full_name LIKE ? OR phone LIKE ?)
              ORDER BY created_at DESC
              LIMIT ${PER_SOURCE_LIMIT}`,
            [like, like],
          ),
      this.db.run<any[]>(
        `SELECT t.id, t.ticket_no, t.subject, t.status, e.full_name AS employee_name
           FROM tickets t
           JOIN employees e ON e.id = t.employee_id
          WHERE t.deleted_at IS NULL AND (t.ticket_no LIKE ? OR t.subject LIKE ?)
            ${selfOnly ? 'AND t.employee_id = ?' : ''}
          ORDER BY t.created_at DESC
          LIMIT ${PER_SOURCE_LIMIT}`,
        selfOnly ? [like, like, selfId] : [like, like],
      ),
      selfOnly
        ? Promise.resolve([] as any[])
        : this.db.run<any[]>(
            `SELECT id, asset_code, name, category, status
               FROM assets
              WHERE deleted_at IS NULL AND (asset_code LIKE ? OR name LIKE ?)
              ORDER BY asset_code ASC
              LIMIT ${PER_SOURCE_LIMIT}`,
            [like, like],
          ),
      this.db.run<any[]>(
        `SELECT d.id, d.title, d.doc_type, d.verified, d.employee_id, e.full_name AS employee_name
           FROM employee_documents d
           JOIN employees e ON e.id = d.employee_id
          WHERE d.deleted_at IS NULL AND d.title LIKE ?
            ${selfOnly ? 'AND d.employee_id = ?' : ''}
          ORDER BY d.created_at DESC
          LIMIT ${PER_SOURCE_LIMIT}`,
        selfOnly ? [like, selfId] : [like],
      ),
      selfOnly
        ? Promise.resolve([] as any[])
        : this.db.run<any[]>(
            `SELECT id, label, status, from_date, to_date
               FROM salary_periods
              WHERE deleted_at IS NULL AND label LIKE ?
              ORDER BY to_date DESC
              LIMIT ${PER_SOURCE_LIMIT}`,
            [like],
          ),
    ]);

    const results: SearchResultItem[] = [];

    for (const r of employees) {
      results.push({
        type: 'employee',
        id: Number(r.id),
        title: `${r.full_name} (${r.emp_code})`,
        subtitle: [r.department, r.work_status].filter(Boolean).join(' · ') || null,
        page: 'employees',
      });
    }
    for (const r of lots) {
      results.push({
        type: 'lot',
        id: Number(r.id),
        title: `${r.lot_id} — ${r.lot_name}`,
        subtitle: `${r.employee_name} · ${r.status}`,
        page: 'ledger',
      });
    }
    for (const r of leaves) {
      results.push({
        type: 'leave',
        id: Number(r.id),
        title: `${r.employee_name} — ${r.leave_type_name}`,
        subtitle: `${dateOnly(r.from_date)} → ${dateOnly(r.to_date)} · ${r.status}`,
        page: 'hr',
      });
    }
    for (const r of advances) {
      results.push({
        type: 'advance',
        id: Number(r.id),
        title: `${r.employee_name} — ${r.advance_type}`,
        subtitle: `₹${Number(r.amount ?? 0)} · ${dateOnly(r.advance_date)} · ${r.status}`,
        page: 'hr',
      });
    }
    for (const r of candidates) {
      results.push({
        type: 'candidate',
        id: Number(r.id),
        title: r.full_name,
        subtitle: `${r.phone} · ${r.position_grade} · ${r.status}`,
        page: 'hr',
      });
    }
    for (const r of tickets) {
      results.push({
        type: 'ticket',
        id: Number(r.id),
        title: `${r.ticket_no} — ${r.subject}`,
        subtitle: `${r.employee_name} · ${r.status}`,
        page: 'hr',
      });
    }
    for (const r of assets) {
      results.push({
        type: 'asset',
        id: Number(r.id),
        title: `${r.asset_code} — ${r.name}`,
        subtitle: `${r.category} · ${r.status}`,
        page: 'hr',
      });
    }
    for (const r of documents) {
      results.push({
        type: 'document',
        id: Number(r.id),
        title: r.title,
        subtitle: `${r.employee_name} · ${r.doc_type} · ${r.verified ? 'verified' : 'unverified'}`,
        page: 'employees',
      });
    }
    for (const r of periods) {
      results.push({
        type: 'period',
        id: Number(r.id),
        title: `Payroll: ${r.label}`,
        subtitle: `${dateOnly(r.from_date)} → ${dateOnly(r.to_date)} · ${r.status}`,
        page: 'payroll',
      });
    }

    return results;
  }
}

/** Neutralises LIKE wildcards so a literal `%` or `_` does not match everything. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value ?? '');
  return s.length > 10 ? s.slice(0, 10) : s;
}
