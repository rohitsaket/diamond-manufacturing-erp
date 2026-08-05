import { BaseRepository } from './BaseRepository';
import { Paged, Visitor, VisitorVisit } from '../types/attendance';
import { toDateString } from '../utils/dateUtils';

function iso(value: any): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export class VisitorRepository extends BaseRepository {
  async listVisitors(filters: { visitorType?: string; search?: string; onSiteOnly?: boolean } = {}): Promise<Visitor[]> {
    const where: string[] = ['v.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.visitorType) { where.push('v.visitor_type = ?'); params.push(filters.visitorType); }
    if (filters.search) {
      where.push('(v.full_name LIKE ? OR v.company_name LIKE ? OR v.visitor_code LIKE ? OR v.phone LIKE ?)');
      const like = `%${filters.search}%`;
      params.push(like, like, like, like);
    }
    if (filters.onSiteOnly) {
      where.push(`EXISTS (SELECT 1 FROM visitor_visits vv
        WHERE vv.visitor_id = v.id AND vv.deleted_at IS NULL AND vv.status = 'CHECKED_IN')`);
    }

    const rows = await this.query<any[]>(
      `SELECT v.*,
              (SELECT COUNT(*) FROM visitor_visits vv WHERE vv.visitor_id = v.id AND vv.deleted_at IS NULL) AS visit_count,
              (SELECT MAX(vv.visit_date) FROM visitor_visits vv WHERE vv.visitor_id = v.id AND vv.deleted_at IS NULL) AS last_visit_date,
              EXISTS (SELECT 1 FROM visitor_visits vv WHERE vv.visitor_id = v.id
                        AND vv.deleted_at IS NULL AND vv.status = 'CHECKED_IN') AS on_site
       FROM visitors v
       WHERE ${where.join(' AND ')}
       ORDER BY v.full_name ASC`,
      params,
    );
    return rows.map((r) => this.toVisitor(r));
  }

  async findVisitorById(id: number): Promise<Visitor | null> {
    const rows = await this.query<any[]>('SELECT * FROM visitors WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
    return rows[0] ? this.toVisitor(rows[0]) : null;
  }

  async nextVisitorCode(): Promise<string> {
    const rows = await this.query<any[]>(
      "SELECT visitor_code FROM visitors WHERE visitor_code LIKE 'VIS-%' ORDER BY id DESC LIMIT 1",
    );
    const last = rows[0]?.visitor_code as string | undefined;
    const seq = last ? Number(last.split('-')[1] ?? 0) + 1 : 1;
    return `VIS-${String(seq).padStart(4, '0')}`;
  }

  async createVisitor(data: Partial<Visitor> & { visitorCode: string }, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO visitors
         (visitor_code, visitor_type, full_name, company_name, phone, email, id_proof_type, id_proof_no,
          photo_path, nationality, contractor_agency, contract_from, contract_to, daily_rate,
          notes, company_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.visitorCode, data.visitorType ?? 'VISITOR', data.fullName, data.companyName ?? null,
        data.phone ?? null, data.email ?? null, data.idProofType ?? null, data.idProofNo ?? null,
        data.photoPath ?? null, data.nationality ?? null, data.contractorAgency ?? null,
        data.contractFrom ?? null, data.contractTo ?? null, data.dailyRate ?? null,
        data.notes ?? null, (data as any).companyId ?? null, userId,
      ],
    );
    return Number(result.insertId);
  }

  async updateVisitor(id: number, data: Partial<Visitor>, current: Visitor): Promise<void> {
    await this.query(
      `UPDATE visitors SET visitor_type = ?, full_name = ?, company_name = ?, phone = ?, email = ?,
         id_proof_type = ?, id_proof_no = ?, nationality = ?, contractor_agency = ?,
         contract_from = ?, contract_to = ?, daily_rate = ?, is_blacklisted = ?,
         blacklist_reason = ?, notes = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [
        data.visitorType ?? current.visitorType,
        data.fullName ?? current.fullName,
        data.companyName === undefined ? current.companyName : data.companyName,
        data.phone === undefined ? current.phone : data.phone,
        data.email === undefined ? current.email : data.email,
        data.idProofType === undefined ? current.idProofType : data.idProofType,
        data.idProofNo === undefined ? current.idProofNo : data.idProofNo,
        data.nationality === undefined ? current.nationality : data.nationality,
        data.contractorAgency === undefined ? current.contractorAgency : data.contractorAgency,
        data.contractFrom === undefined ? current.contractFrom : data.contractFrom,
        data.contractTo === undefined ? current.contractTo : data.contractTo,
        data.dailyRate === undefined ? current.dailyRate : data.dailyRate,
        (data.isBlacklisted ?? current.isBlacklisted) ? 1 : 0,
        data.blacklistReason === undefined ? current.blacklistReason : data.blacklistReason,
        data.notes === undefined ? current.notes : data.notes,
        id,
      ],
    );
  }

  async deleteVisitor(id: number): Promise<void> {
    await this.query('UPDATE visitors SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  // -------------------------------------------------------------------------
  // Visits
  // -------------------------------------------------------------------------
  async listVisits(filters: {
    from?: string; to?: string; visitorId?: number; status?: string; visitorType?: string;
    branchId?: number; page?: number; pageSize?: number;
  }): Promise<Paged<VisitorVisit>> {
    const where: string[] = ['vv.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.from) { where.push('vv.visit_date >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('vv.visit_date <= ?'); params.push(filters.to); }
    if (filters.visitorId) { where.push('vv.visitor_id = ?'); params.push(filters.visitorId); }
    if (filters.status) { where.push('vv.status = ?'); params.push(filters.status); }
    if (filters.visitorType) { where.push('v.visitor_type = ?'); params.push(filters.visitorType); }
    if (filters.branchId) { where.push('vv.branch_id = ?'); params.push(filters.branchId); }

    const clause = where.join(' AND ');
    const page = safeInt(filters.page, 1, 1, 100000);
    const pageSize = safeInt(filters.pageSize, 50, 1, 500);
    const offset = (page - 1) * pageSize;

    const [countRows, rows] = await Promise.all([
      this.query<any[]>(
        `SELECT COUNT(*) AS n FROM visitor_visits vv JOIN visitors v ON v.id = vv.visitor_id WHERE ${clause}`,
        params,
      ),
      this.query<any[]>(
        `SELECT vv.*, v.full_name AS visitor_name, v.visitor_code, v.visitor_type, v.company_name,
                e.full_name AS host_name, l.name AS location_name
         FROM visitor_visits vv
         JOIN visitors v ON v.id = vv.visitor_id
         LEFT JOIN employees e ON e.id = vv.host_employee_id
         LEFT JOIN locations l ON l.id = vv.location_id
         WHERE ${clause}
         ORDER BY vv.visit_date DESC, vv.checked_in_at DESC, vv.id DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      ),
    ]);

    return {
      rows: rows.map((r) => this.toVisit(r)),
      total: Number(countRows[0]?.n ?? 0),
      page,
      pageSize,
    };
  }

  async findVisitById(id: number): Promise<VisitorVisit | null> {
    const rows = await this.query<any[]>(
      `SELECT vv.*, v.full_name AS visitor_name, v.visitor_code, v.visitor_type, v.company_name,
              e.full_name AS host_name, l.name AS location_name
       FROM visitor_visits vv
       JOIN visitors v ON v.id = vv.visitor_id
       LEFT JOIN employees e ON e.id = vv.host_employee_id
       LEFT JOIN locations l ON l.id = vv.location_id
       WHERE vv.id = ? AND vv.deleted_at IS NULL LIMIT 1`,
      [id],
    );
    return rows[0] ? this.toVisit(rows[0]) : null;
  }

  async createVisit(data: Partial<VisitorVisit>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO visitor_visits
         (visitor_id, visit_date, host_employee_id, purpose, branch_id, location_id, badge_no,
          vehicle_no, expected_in, expected_out, accompanying_count, approval_status, status,
          safety_briefing_done, remarks, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.visitorId, data.visitDate, data.hostEmployeeId ?? null, data.purpose ?? null,
        data.branchId ?? null, data.locationId ?? null, data.badgeNo ?? null, data.vehicleNo ?? null,
        data.expectedIn ?? null, data.expectedOut ?? null, data.accompanyingCount ?? 0,
        data.approvalStatus ?? 'NOT_REQUIRED', data.status ?? 'EXPECTED',
        data.safetyBriefingDone ? 1 : 0, data.remarks ?? null, userId,
      ],
    );
    return Number(result.insertId);
  }

  async checkIn(id: number): Promise<void> {
    await this.query(
      "UPDATE visitor_visits SET checked_in_at = NOW(), status = 'CHECKED_IN' WHERE id = ? AND checked_in_at IS NULL",
      [id],
    );
  }

  /** Hours are computed from the two timestamps rather than trusted from input. */
  async checkOut(id: number): Promise<void> {
    await this.query(
      `UPDATE visitor_visits
       SET checked_out_at = NOW(), status = 'CHECKED_OUT',
           hours = ROUND(TIMESTAMPDIFF(MINUTE, checked_in_at, NOW()) / 60, 2)
       WHERE id = ? AND checked_in_at IS NOT NULL AND checked_out_at IS NULL`,
      [id],
    );
  }

  async setVisitStatus(id: number, status: string, remarks: string | null): Promise<void> {
    await this.query(
      'UPDATE visitor_visits SET status = ?, remarks = COALESCE(?, remarks) WHERE id = ?',
      [status, remarks, id],
    );
  }

  async deleteVisit(id: number): Promise<void> {
    await this.query('UPDATE visitor_visits SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  /** Visits still checked in past their expected exit, marked so the gate list is accurate. */
  async flagOverstays(): Promise<number> {
    const result = await this.query<any>(
      `UPDATE visitor_visits
       SET status = 'OVERSTAY'
       WHERE deleted_at IS NULL AND status = 'CHECKED_IN'
         AND expected_out IS NOT NULL AND expected_out < NOW()`,
    );
    return Number(result?.affectedRows ?? 0);
  }

  async summaryForDate(date: string): Promise<{
    expected: number; onSite: number; checkedOut: number; overstay: number; total: number;
    byType: { type: string; count: number }[];
  }> {
    const [totals, byType] = await Promise.all([
      this.query<any[]>(
        `SELECT
           COALESCE(SUM(status = 'EXPECTED'), 0) AS expected,
           COALESCE(SUM(status = 'CHECKED_IN'), 0) AS on_site,
           COALESCE(SUM(status = 'CHECKED_OUT'), 0) AS checked_out,
           COALESCE(SUM(status = 'OVERSTAY'), 0) AS overstay,
           COUNT(*) AS total
         FROM visitor_visits WHERE visit_date = ? AND deleted_at IS NULL`,
        [date],
      ),
      this.query<any[]>(
        `SELECT v.visitor_type, COUNT(*) AS n
         FROM visitor_visits vv JOIN visitors v ON v.id = vv.visitor_id
         WHERE vv.visit_date = ? AND vv.deleted_at IS NULL
         GROUP BY v.visitor_type`,
        [date],
      ),
    ]);
    const t = totals[0] ?? {};
    return {
      expected: Number(t.expected ?? 0),
      onSite: Number(t.on_site ?? 0),
      checkedOut: Number(t.checked_out ?? 0),
      overstay: Number(t.overstay ?? 0),
      total: Number(t.total ?? 0),
      byType: byType.map((r) => ({ type: r.visitor_type, count: Number(r.n) })),
    };
  }

  private toVisitor(r: any): Visitor {
    return {
      id: Number(r.id),
      visitorCode: r.visitor_code,
      visitorType: r.visitor_type,
      fullName: r.full_name,
      companyName: r.company_name ?? null,
      phone: r.phone ?? null,
      email: r.email ?? null,
      idProofType: r.id_proof_type ?? null,
      idProofNo: r.id_proof_no ?? null,
      photoPath: r.photo_path ?? null,
      nationality: r.nationality ?? null,
      contractorAgency: r.contractor_agency ?? null,
      contractFrom: r.contract_from ? toDateString(r.contract_from) : null,
      contractTo: r.contract_to ? toDateString(r.contract_to) : null,
      dailyRate: r.daily_rate === null ? null : Number(r.daily_rate),
      isBlacklisted: !!r.is_blacklisted,
      blacklistReason: r.blacklist_reason ?? null,
      notes: r.notes ?? null,
      visitCount: r.visit_count === undefined ? undefined : Number(r.visit_count),
      lastVisitDate: r.last_visit_date ? toDateString(r.last_visit_date) : null,
      onSite: r.on_site === undefined ? undefined : !!Number(r.on_site),
    };
  }

  private toVisit(r: any): VisitorVisit {
    return {
      id: Number(r.id),
      visitorId: Number(r.visitor_id),
      visitorName: r.visitor_name,
      visitorCode: r.visitor_code,
      visitorType: r.visitor_type,
      companyName: r.company_name ?? null,
      visitDate: toDateString(r.visit_date),
      hostEmployeeId: r.host_employee_id === null ? null : Number(r.host_employee_id),
      hostName: r.host_name ?? null,
      purpose: r.purpose ?? null,
      branchId: r.branch_id === null ? null : Number(r.branch_id),
      locationId: r.location_id === null ? null : Number(r.location_id),
      locationName: r.location_name ?? null,
      badgeNo: r.badge_no ?? null,
      vehicleNo: r.vehicle_no ?? null,
      expectedIn: iso(r.expected_in),
      expectedOut: iso(r.expected_out),
      checkedInAt: iso(r.checked_in_at),
      checkedOutAt: iso(r.checked_out_at),
      hours: r.hours === null ? null : Number(r.hours),
      accompanyingCount: Number(r.accompanying_count ?? 0),
      approvalStatus: r.approval_status,
      status: r.status,
      safetyBriefingDone: !!r.safety_briefing_done,
      remarks: r.remarks ?? null,
    };
  }
}
