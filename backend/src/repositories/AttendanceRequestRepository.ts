import { BaseRepository } from './BaseRepository';
import {
  ApprovalDecision, ApprovalWorkflowStep, AttendanceRequest, AttendanceRequestStatus,
  AttendanceRequestType, Delegation, OvertimeRecord, Paged, RequestApproval,
} from '../types/attendance';
import { toDateString } from '../utils/dateUtils';

export interface RequestFilters {
  status?: AttendanceRequestStatus;
  requestType?: AttendanceRequestType;
  employeeId?: number;
  approverEmployeeId?: number;
  from?: string;
  to?: string;
  overdueOnly?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

function iso(value: any): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function fromJson(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  try { return JSON.parse(String(value)); } catch { return null; }
}

function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

const SELECT_REQUEST = `
  SELECT r.*, e.full_name, e.emp_code, d.name AS department_name,
         cp.full_name AS counterparty_name
  FROM attendance_requests r
  JOIN employees e ON e.id = r.employee_id
  LEFT JOIN departments d ON d.id = COALESCE(r.department_id, e.department_id)
  LEFT JOIN employees cp ON cp.id = r.counterparty_employee_id
`;

export class AttendanceRequestRepository extends BaseRepository {
  // -------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------
  async list(filters: RequestFilters): Promise<Paged<AttendanceRequest>> {
    const where: string[] = ['r.deleted_at IS NULL'];
    const params: any[] = [];

    if (filters.status) { where.push('r.status = ?'); params.push(filters.status); }
    if (filters.requestType) { where.push('r.request_type = ?'); params.push(filters.requestType); }
    if (filters.employeeId) { where.push('r.employee_id = ?'); params.push(filters.employeeId); }
    if (filters.from) { where.push('r.att_date >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('r.att_date <= ?'); params.push(filters.to); }
    if (filters.overdueOnly) { where.push("r.status = 'PENDING' AND r.due_at IS NOT NULL AND r.due_at < NOW()"); }
    if (filters.search) {
      where.push('(e.full_name LIKE ? OR e.emp_code LIKE ? OR r.request_no LIKE ?)');
      const like = `%${filters.search}%`;
      params.push(like, like, like);
    }
    if (filters.approverEmployeeId) {
      // The pending level for this approver, whether assigned directly or by delegation.
      where.push(`EXISTS (
        SELECT 1 FROM attendance_request_approvals ra
        WHERE ra.request_id = r.id AND ra.level = r.current_level AND ra.decision = 'PENDING'
          AND (ra.approver_employee_id = ? OR ra.delegated_from_employee_id = ?)
      )`);
      params.push(filters.approverEmployeeId, filters.approverEmployeeId);
    }

    const clause = where.join(' AND ');
    const page = safeInt(filters.page, 1, 1, 100000);
    const pageSize = safeInt(filters.pageSize, 50, 1, 500);
    const offset = (page - 1) * pageSize;

    const [countRows, rows] = await Promise.all([
      this.query<any[]>(
        `SELECT COUNT(*) AS n FROM attendance_requests r JOIN employees e ON e.id = r.employee_id WHERE ${clause}`,
        params,
      ),
      this.query<any[]>(
        `${SELECT_REQUEST} WHERE ${clause}
         ORDER BY FIELD(r.status, 'PENDING', 'ESCALATED', 'DRAFT', 'APPROVED', 'APPLIED', 'REJECTED', 'CANCELLED', 'EXPIRED'),
                  r.due_at ASC, r.id DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      ),
    ]);

    return {
      rows: rows.map((r) => this.toRequest(r)),
      total: Number(countRows[0]?.n ?? 0),
      page,
      pageSize,
    };
  }

  async findById(id: number): Promise<AttendanceRequest | null> {
    const rows = await this.query<any[]>(`${SELECT_REQUEST} WHERE r.id = ? AND r.deleted_at IS NULL LIMIT 1`, [id]);
    if (!rows[0]) return null;
    const request = this.toRequest(rows[0]);
    request.approvals = await this.listApprovals(id);
    return request;
  }

  /** Sequential request numbers per year, allocated under the row lock of the insert. */
  async nextRequestNo(year: number): Promise<string> {
    const rows = await this.query<any[]>(
      `SELECT request_no FROM attendance_requests
       WHERE request_no LIKE ? ORDER BY id DESC LIMIT 1`,
      [`AR-${year}-%`],
    );
    const last = rows[0]?.request_no as string | undefined;
    const seq = last ? Number(last.split('-')[2] ?? 0) + 1 : 1;
    return `AR-${year}-${String(seq).padStart(4, '0')}`;
  }

  async create(data: Partial<AttendanceRequest> & { requestNo: string; raisedBy: number }, conn?: any): Promise<number> {
    const sql = `INSERT INTO attendance_requests
        (request_no, request_type, employee_id, att_date, to_date, attendance_id,
         current_value, requested_value, requested_hours, reason, attachment_path,
         counterparty_employee_id, counterparty_response, status, current_level, total_levels,
         submitted_at, due_at, company_id, branch_id, department_id, raised_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)`;
    const params = [
      data.requestNo, data.requestType, data.employeeId, data.attDate, data.toDate ?? null,
      data.attendanceId ?? null,
      data.currentValue ? JSON.stringify(data.currentValue) : null,
      data.requestedValue ? JSON.stringify(data.requestedValue) : null,
      data.requestedHours ?? null, data.reason ?? null, data.attachmentPath ?? null,
      data.counterpartyEmployeeId ?? null, data.counterpartyResponse ?? 'NOT_REQUIRED',
      data.status ?? 'PENDING', data.currentLevel ?? 1, data.totalLevels ?? 1,
      data.dueAt ?? null, (data as any).companyId ?? null, (data as any).branchId ?? null,
      (data as any).departmentId ?? null, data.raisedBy,
    ];
    if (conn) { const [r] = await conn.query(sql, params); return Number((r as any).insertId); }
    const result = await this.query<any>(sql, params);
    return Number(result.insertId);
  }

  async updateStatus(
    id: number,
    status: AttendanceRequestStatus,
    currentLevel: number,
    note: string | null,
    conn?: any,
  ): Promise<void> {
    const sql = `UPDATE attendance_requests
                 SET status = ?, current_level = ?, decision_note = COALESCE(?, decision_note),
                     decided_at = IF(? IN ('APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'), NOW(), decided_at)
                 WHERE id = ?`;
    const params = [status, currentLevel, note, status, id];
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  async markApplied(id: number, conn?: any): Promise<void> {
    const sql = "UPDATE attendance_requests SET status = 'APPLIED', applied_at = NOW() WHERE id = ?";
    if (conn) await conn.query(sql, [id]);
    else await this.query(sql, [id]);
  }

  async setCounterpartyResponse(id: number, response: 'ACCEPTED' | 'DECLINED'): Promise<void> {
    await this.query(
      'UPDATE attendance_requests SET counterparty_response = ?, counterparty_responded_at = NOW() WHERE id = ?',
      [response, id],
    );
  }

  async softDelete(id: number): Promise<void> {
    await this.query('UPDATE attendance_requests SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  async countByStatus(from?: string, to?: string): Promise<Record<string, number>> {
    const params: any[] = [];
    let clause = 'deleted_at IS NULL';
    if (from) { clause += ' AND att_date >= ?'; params.push(from); }
    if (to) { clause += ' AND att_date <= ?'; params.push(to); }
    const rows = await this.query<any[]>(
      `SELECT status, COUNT(*) AS n FROM attendance_requests WHERE ${clause} GROUP BY status`,
      params,
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }

  /** How many regularizations an employee already used in a month. */
  async countRegularizationsInMonth(employeeId: number, month: string): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS n FROM attendance_requests
       WHERE employee_id = ? AND deleted_at IS NULL
         AND request_type IN ('REGULARIZATION', 'MISSED_PUNCH', 'CORRECTION')
         AND status IN ('PENDING', 'APPROVED', 'APPLIED')
         AND DATE_FORMAT(att_date, '%Y-%m') = ?`,
      [employeeId, month],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async findDuplicate(employeeId: number, requestType: AttendanceRequestType, attDate: string): Promise<number | null> {
    const rows = await this.query<any[]>(
      `SELECT id FROM attendance_requests
       WHERE employee_id = ? AND request_type = ? AND att_date = ?
         AND status IN ('DRAFT', 'PENDING', 'ESCALATED') AND deleted_at IS NULL LIMIT 1`,
      [employeeId, requestType, attDate],
    );
    return rows[0] ? Number(rows[0].id) : null;
  }

  // -------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------
  async createApprovals(
    requestId: number,
    steps: { level: number; approverType: string; approverEmployeeId: number | null; approverRole: string | null; dueAt: Date | null; delegatedFrom: number | null }[],
    conn?: any,
  ): Promise<void> {
    if (!steps.length) return;
    const cols = ['request_id', 'level', 'approver_type', 'approver_employee_id', 'approver_role', 'due_at', 'delegated_from_employee_id'];
    const params: any[] = [];
    for (const s of steps) {
      params.push(requestId, s.level, s.approverType, s.approverEmployeeId, s.approverRole, s.dueAt, s.delegatedFrom);
    }
    const sql = `INSERT INTO attendance_request_approvals (${cols.join(', ')})
                 VALUES ${steps.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ')}
                 ON DUPLICATE KEY UPDATE approver_type = VALUES(approver_type),
                   approver_employee_id = VALUES(approver_employee_id), due_at = VALUES(due_at)`;
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  async listApprovals(requestId: number): Promise<RequestApproval[]> {
    const rows = await this.query<any[]>(
      `SELECT ra.*, ae.full_name AS approver_name, u.name AS decided_by_name,
              de.full_name AS delegated_from_name
       FROM attendance_request_approvals ra
       LEFT JOIN employees ae ON ae.id = ra.approver_employee_id
       LEFT JOIN employees de ON de.id = ra.delegated_from_employee_id
       LEFT JOIN users u ON u.id = ra.decided_by
       WHERE ra.request_id = ? ORDER BY ra.level ASC`,
      [requestId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      requestId: Number(r.request_id),
      level: Number(r.level),
      approverType: r.approver_type,
      approverEmployeeId: r.approver_employee_id === null ? null : Number(r.approver_employee_id),
      approverName: r.approver_name ?? null,
      approverRole: r.approver_role ?? null,
      decision: r.decision,
      decidedByName: r.decided_by_name ?? null,
      decidedAt: iso(r.decided_at),
      comments: r.comments ?? null,
      delegatedFromName: r.delegated_from_name ?? null,
      dueAt: iso(r.due_at),
      escalatedAt: iso(r.escalated_at),
    }));
  }

  async recordDecision(
    requestId: number,
    level: number,
    decision: ApprovalDecision,
    userId: number,
    comments: string | null,
    conn?: any,
  ): Promise<void> {
    const sql = `UPDATE attendance_request_approvals
                 SET decision = ?, decided_by = ?, decided_at = NOW(), comments = ?
                 WHERE request_id = ? AND level = ?`;
    const params = [decision, userId, comments, requestId, level];
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  async findPendingStep(requestId: number, level: number): Promise<RequestApproval | null> {
    const rows = await this.query<any[]>(
      `SELECT ra.*, ae.full_name AS approver_name
       FROM attendance_request_approvals ra
       LEFT JOIN employees ae ON ae.id = ra.approver_employee_id
       WHERE ra.request_id = ? AND ra.level = ? LIMIT 1`,
      [requestId, level],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id), requestId: Number(r.request_id), level: Number(r.level),
      approverType: r.approver_type,
      approverEmployeeId: r.approver_employee_id === null ? null : Number(r.approver_employee_id),
      approverName: r.approver_name ?? null, approverRole: r.approver_role ?? null,
      decision: r.decision, decidedByName: null, decidedAt: iso(r.decided_at),
      comments: r.comments ?? null, delegatedFromName: null,
      dueAt: iso(r.due_at), escalatedAt: iso(r.escalated_at),
    };
  }

  /** Requests whose current level is past its SLA and not yet escalated. */
  async findOverdueForEscalation(): Promise<{ requestId: number; level: number; approvalId: number }[]> {
    const rows = await this.query<any[]>(
      `SELECT ra.id AS approval_id, ra.request_id, ra.level
       FROM attendance_request_approvals ra
       JOIN attendance_requests r ON r.id = ra.request_id AND r.deleted_at IS NULL
       WHERE ra.decision = 'PENDING' AND r.status = 'PENDING'
         AND ra.level = r.current_level
         AND ra.due_at IS NOT NULL AND ra.due_at < NOW()
         AND ra.escalated_at IS NULL`,
    );
    return rows.map((r) => ({
      requestId: Number(r.request_id), level: Number(r.level), approvalId: Number(r.approval_id),
    }));
  }

  async markEscalated(approvalId: number, escalateToEmployeeId: number | null): Promise<void> {
    await this.query(
      'UPDATE attendance_request_approvals SET escalated_at = NOW(), escalated_to_employee_id = ? WHERE id = ?',
      [escalateToEmployeeId, approvalId],
    );
  }

  // -------------------------------------------------------------------------
  // Workflow definitions
  // -------------------------------------------------------------------------
  async findWorkflow(
    requestType: AttendanceRequestType,
    companyId: number | null,
    branchId: number | null,
    departmentId: number | null,
  ): Promise<ApprovalWorkflowStep[]> {
    // Most specific scope that has any steps wins, so a department override
    // replaces the company chain rather than stacking on top of it.
    const scopes: [string, any[]][] = [
      ['w.department_id = ?', [departmentId]],
      ['w.branch_id = ? AND w.department_id IS NULL', [branchId]],
      ['w.company_id = ? AND w.branch_id IS NULL AND w.department_id IS NULL', [companyId]],
      ['w.company_id IS NULL AND w.branch_id IS NULL AND w.department_id IS NULL', []],
    ];

    for (const [clause, params] of scopes) {
      if (params.some((p) => p === null || p === undefined)) continue;
      const rows = await this.query<any[]>(
        `SELECT w.*, e.full_name AS approver_name
         FROM attendance_approval_workflows w
         LEFT JOIN employees e ON e.id = w.approver_employee_id
         WHERE w.request_type = ? AND w.status = 'ACTIVE' AND w.deleted_at IS NULL AND ${clause}
         ORDER BY w.level ASC`,
        [requestType, ...params],
      );
      if (rows.length) return rows.map((r) => this.toWorkflowStep(r));
    }
    return [];
  }

  async listWorkflows(requestType?: AttendanceRequestType): Promise<ApprovalWorkflowStep[]> {
    const params: any[] = [];
    let clause = 'w.deleted_at IS NULL';
    if (requestType) { clause += ' AND w.request_type = ?'; params.push(requestType); }
    const rows = await this.query<any[]>(
      `SELECT w.*, e.full_name AS approver_name
       FROM attendance_approval_workflows w
       LEFT JOIN employees e ON e.id = w.approver_employee_id
       WHERE ${clause} ORDER BY w.request_type ASC, w.level ASC`,
      params,
    );
    return rows.map((r) => this.toWorkflowStep(r));
  }

  async createWorkflowStep(data: Partial<ApprovalWorkflowStep>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO attendance_approval_workflows
         (request_type, company_id, branch_id, department_id, level, approver_type,
          approver_employee_id, approver_role, is_mandatory, sla_hours, auto_escalate,
          escalate_to_type, escalate_to_employee_id, auto_approve_after_hours, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.requestType, data.companyId ?? null, data.branchId ?? null, data.departmentId ?? null,
        data.level ?? 1, data.approverType, data.approverEmployeeId ?? null, data.approverRole ?? null,
        data.isMandatory === false ? 0 : 1, data.slaHours ?? 48, data.autoEscalate ? 1 : 0,
        data.escalateToType ?? null, data.escalateToEmployeeId ?? null,
        data.autoApproveAfterHours ?? null, data.status ?? 'ACTIVE', userId,
      ],
    );
    return Number(result.insertId);
  }

  async deleteWorkflowStep(id: number): Promise<void> {
    await this.query('UPDATE attendance_approval_workflows SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  // -------------------------------------------------------------------------
  // Delegations
  // -------------------------------------------------------------------------
  async listDelegations(employeeId?: number): Promise<Delegation[]> {
    const params: any[] = [];
    let clause = 'd.deleted_at IS NULL';
    if (employeeId) { clause += ' AND (d.from_employee_id = ? OR d.to_employee_id = ?)'; params.push(employeeId, employeeId); }
    const rows = await this.query<any[]>(
      `SELECT d.*, fe.full_name AS from_name, te.full_name AS to_name
       FROM approval_delegations d
       JOIN employees fe ON fe.id = d.from_employee_id
       JOIN employees te ON te.id = d.to_employee_id
       WHERE ${clause} ORDER BY d.from_date DESC`,
      params,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      fromEmployeeId: Number(r.from_employee_id),
      fromEmployeeName: r.from_name,
      toEmployeeId: Number(r.to_employee_id),
      toEmployeeName: r.to_name,
      fromDate: toDateString(r.from_date),
      toDate: toDateString(r.to_date),
      requestTypes: r.request_types ? String(r.request_types).split(',').filter(Boolean) as AttendanceRequestType[] : [],
      reason: r.reason ?? null,
      status: r.status,
    }));
  }

  /** The stand-in for an approver on a date, if one is in force. */
  async findActiveDelegate(fromEmployeeId: number, requestType: AttendanceRequestType, onDate: string): Promise<number | null> {
    const rows = await this.query<any[]>(
      `SELECT to_employee_id, request_types FROM approval_delegations
       WHERE from_employee_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL
         AND from_date <= ? AND to_date >= ?
       ORDER BY id DESC LIMIT 1`,
      [fromEmployeeId, onDate, onDate],
    );
    const r = rows[0];
    if (!r) return null;
    const types = r.request_types ? String(r.request_types).split(',').filter(Boolean) : [];
    if (types.length && !types.includes(requestType)) return null;
    return Number(r.to_employee_id);
  }

  async createDelegation(data: Partial<Delegation>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO approval_delegations (from_employee_id, to_employee_id, from_date, to_date, request_types, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.fromEmployeeId, data.toEmployeeId, data.fromDate, data.toDate,
        (data.requestTypes ?? []).join(','), data.reason ?? null, userId,
      ],
    );
    return Number(result.insertId);
  }

  async cancelDelegation(id: number): Promise<void> {
    await this.query("UPDATE approval_delegations SET status = 'CANCELLED' WHERE id = ?", [id]);
  }

  // -------------------------------------------------------------------------
  // Overtime ledger
  // -------------------------------------------------------------------------
  async upsertOvertime(data: {
    employeeId: number; attDate: string; attendanceId: number | null; requestId?: number | null;
    otType: string; derivedHours: number; requestedHours: number; approvedHours: number;
    multiplier: number; status: string; reason?: string | null; approvedBy?: number | null;
    companyId?: number | null; branchId?: number | null; departmentId?: number | null; userId: number | null;
  }, conn?: any): Promise<void> {
    const payable = Math.round(data.approvedHours * data.multiplier * 100) / 100;
    const sql = `INSERT INTO overtime_records
        (employee_id, att_date, attendance_id, request_id, ot_type, derived_hours, requested_hours,
         approved_hours, multiplier, payable_hours, status, reason, approved_by,
         approved_at, company_id, branch_id, department_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? IS NULL, NULL, NOW()), ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        attendance_id = VALUES(attendance_id),
        request_id = COALESCE(VALUES(request_id), request_id),
        ot_type = VALUES(ot_type), derived_hours = VALUES(derived_hours),
        requested_hours = VALUES(requested_hours), approved_hours = VALUES(approved_hours),
        multiplier = VALUES(multiplier), payable_hours = VALUES(payable_hours),
        status = VALUES(status), reason = COALESCE(VALUES(reason), reason),
        approved_by = COALESCE(VALUES(approved_by), approved_by),
        approved_at = COALESCE(VALUES(approved_at), approved_at), deleted_at = NULL`;
    const params = [
      data.employeeId, data.attDate, data.attendanceId, data.requestId ?? null, data.otType,
      data.derivedHours, data.requestedHours, data.approvedHours, data.multiplier, payable,
      data.status, data.reason ?? null, data.approvedBy ?? null, data.approvedBy ?? null,
      data.companyId ?? null, data.branchId ?? null, data.departmentId ?? null, data.userId || null,
    ];
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  async listOvertime(filters: {
    from?: string; to?: string; employeeId?: number; status?: string; page?: number; pageSize?: number;
  }): Promise<Paged<OvertimeRecord>> {
    const where: string[] = ['o.deleted_at IS NULL'];
    const params: any[] = [];
    if (filters.from) { where.push('o.att_date >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('o.att_date <= ?'); params.push(filters.to); }
    if (filters.employeeId) { where.push('o.employee_id = ?'); params.push(filters.employeeId); }
    if (filters.status) { where.push('o.status = ?'); params.push(filters.status); }

    const clause = where.join(' AND ');
    const page = safeInt(filters.page, 1, 1, 100000);
    const pageSize = safeInt(filters.pageSize, 50, 1, 500);
    const offset = (page - 1) * pageSize;

    const [countRows, rows] = await Promise.all([
      this.query<any[]>(`SELECT COUNT(*) AS n FROM overtime_records o WHERE ${clause}`, params),
      this.query<any[]>(
        `SELECT o.*, e.full_name, e.emp_code, u.name AS approved_by_name
         FROM overtime_records o
         JOIN employees e ON e.id = o.employee_id
         LEFT JOIN users u ON u.id = o.approved_by
         WHERE ${clause} ORDER BY o.att_date DESC, e.full_name ASC
         LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      ),
    ]);

    return {
      rows: rows.map((r) => ({
        id: Number(r.id),
        employeeId: Number(r.employee_id),
        employeeName: r.full_name,
        empCode: r.emp_code,
        attDate: toDateString(r.att_date),
        attendanceId: r.attendance_id === null ? null : Number(r.attendance_id),
        requestId: r.request_id === null ? null : Number(r.request_id),
        otType: r.ot_type,
        derivedHours: Number(r.derived_hours ?? 0),
        requestedHours: Number(r.requested_hours ?? 0),
        approvedHours: Number(r.approved_hours ?? 0),
        multiplier: Number(r.multiplier ?? 1),
        payableHours: Number(r.payable_hours ?? 0),
        hourlyRate: r.hourly_rate === null ? null : Number(r.hourly_rate),
        amount: r.amount === null ? null : Number(r.amount),
        status: r.status,
        reason: r.reason ?? null,
        approvedByName: r.approved_by_name ?? null,
        approvedAt: iso(r.approved_at),
      })),
      total: Number(countRows[0]?.n ?? 0),
      page,
      pageSize,
    };
  }

  async monthlyOvertimeHours(employeeId: number, month: string): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COALESCE(SUM(approved_hours), 0) AS n FROM overtime_records
       WHERE employee_id = ? AND deleted_at IS NULL AND status IN ('APPROVED', 'PAID')
         AND DATE_FORMAT(att_date, '%Y-%m') = ?`,
      [employeeId, month],
    );
    return Number(rows[0]?.n ?? 0);
  }

  // -------------------------------------------------------------------------
  // Mapping
  // -------------------------------------------------------------------------
  private toRequest(r: any): AttendanceRequest {
    const dueAt = r.due_at ? new Date(r.due_at) : null;
    return {
      id: Number(r.id),
      requestNo: r.request_no,
      requestType: r.request_type,
      employeeId: Number(r.employee_id),
      employeeName: r.full_name,
      empCode: r.emp_code,
      departmentName: r.department_name ?? null,
      attDate: toDateString(r.att_date),
      toDate: r.to_date ? toDateString(r.to_date) : null,
      attendanceId: r.attendance_id === null ? null : Number(r.attendance_id),
      currentValue: fromJson(r.current_value),
      requestedValue: fromJson(r.requested_value),
      requestedHours: r.requested_hours === null ? null : Number(r.requested_hours),
      reason: r.reason ?? null,
      attachmentPath: r.attachment_path ?? null,
      counterpartyEmployeeId: r.counterparty_employee_id === null ? null : Number(r.counterparty_employee_id),
      counterpartyName: r.counterparty_name ?? null,
      counterpartyResponse: r.counterparty_response,
      status: r.status,
      currentLevel: Number(r.current_level ?? 1),
      totalLevels: Number(r.total_levels ?? 1),
      submittedAt: iso(r.submitted_at),
      decidedAt: iso(r.decided_at),
      appliedAt: iso(r.applied_at),
      dueAt: iso(r.due_at),
      isOverdue: r.status === 'PENDING' && !!dueAt && dueAt.getTime() < Date.now(),
      decisionNote: r.decision_note ?? null,
      createdAt: iso(r.created_at)!,
    };
  }

  private toWorkflowStep(r: any): ApprovalWorkflowStep {
    return {
      id: Number(r.id),
      requestType: r.request_type,
      companyId: r.company_id === null ? null : Number(r.company_id),
      branchId: r.branch_id === null ? null : Number(r.branch_id),
      departmentId: r.department_id === null ? null : Number(r.department_id),
      level: Number(r.level),
      approverType: r.approver_type,
      approverEmployeeId: r.approver_employee_id === null ? null : Number(r.approver_employee_id),
      approverName: r.approver_name ?? null,
      approverRole: r.approver_role ?? null,
      isMandatory: !!r.is_mandatory,
      slaHours: Number(r.sla_hours ?? 48),
      autoEscalate: !!r.auto_escalate,
      escalateToType: r.escalate_to_type ?? null,
      escalateToEmployeeId: r.escalate_to_employee_id === null ? null : Number(r.escalate_to_employee_id),
      autoApproveAfterHours: r.auto_approve_after_hours === null ? null : Number(r.auto_approve_after_hours),
      status: r.status,
    };
  }
}
