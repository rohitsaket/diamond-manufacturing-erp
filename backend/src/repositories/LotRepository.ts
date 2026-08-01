import { BaseRepository } from './BaseRepository';
import { LotRow, LotResponse, LotFilterParams, ExceptionItem } from '../types';
import { computeLabourAmount } from '../utils/labourCalculator';
import { RateCardRepository } from './RateCardRepository';

export class LotRepository extends BaseRepository {
  private rateCardRepo = new RateCardRepository();

  async findAll(params: LotFilterParams): Promise<{ rows: LotResponse[]; total: number }> {
    let sql = 'SELECT l.*, e.full_name as employee_name, lh.name as labour_head_name FROM lots l JOIN employees e ON l.employee_id = e.id JOIN labour_heads lh ON l.labour_head_id = lh.id WHERE l.deleted_at IS NULL';
    // JOIN employees so a search filter on e.full_name resolves in the count query too.
    const countSql = 'SELECT COUNT(*) as total FROM lots l JOIN employees e ON l.employee_id = e.id WHERE l.deleted_at IS NULL';
    const conditions: string[] = [];
    const queryParams: any[] = [];

    if (params.search) {
      conditions.push('(l.lot_name LIKE ? OR l.lot_id LIKE ? OR e.full_name LIKE ? OR l.shape LIKE ?)');
      queryParams.push(`%${params.search}%`, `%${params.search}%`, `%${params.search}%`, `%${params.search}%`);
    }
    if (params.status) {
      conditions.push('l.status = ?');
      queryParams.push(params.status);
    }
    if (params.lab) {
      conditions.push('l.lab = ?');
      queryParams.push(params.lab);
    }
    if (params.employeeId) {
      conditions.push('l.employee_id = ?');
      queryParams.push(params.employeeId);
    }

    if (conditions.length > 0) {
      const whereClause = ' AND ' + conditions.join(' AND ');
      sql += whereClause;
    }

    // Count
    const countResult = await this.query<any[]>(countSql + (conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : ''), queryParams);
    const total = countResult[0]?.total ?? 0;

    // Sort
    const sortMap: Record<string, string> = {
      issueDate: 'l.issue_date',
      lotName: 'l.lot_name',
      status: 'l.status',
      daysConsumed: 'l.days_consumed',
      labourAmount: 'l.labour_amount',
    };
    const sortCol = sortMap[params.sort || ''] || 'l.issue_date';
    const sortDir = params.order === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortCol} ${sortDir}`;

    // Pagination — LIMIT/OFFSET cannot be bound as prepared-statement params
    // in mysql2 (mysqld_stmt_execute rejects them), so inline the sanitized ints.
    const page = Math.max(1, Math.floor(Number(params.page) || 1));
    const limit = Math.min(1000, Math.max(1, Math.floor(Number(params.limit) || 100)));
    const offset = (page - 1) * limit;
    sql += ` LIMIT ${limit} OFFSET ${offset}`;

    const rows = await this.query<any[]>(sql, queryParams);
    const lots = await Promise.all(rows.map((r) => this.toResponse(r)));
    return { rows: lots, total };
  }

  async findById(id: number): Promise<LotResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT l.*, e.full_name as employee_name, lh.name as labour_head_name FROM lots l JOIN employees e ON l.employee_id = e.id JOIN labour_heads lh ON l.labour_head_id = lh.id WHERE l.id = ? AND l.deleted_at IS NULL',
      [id],
    );
    if (!rows[0]) return null;
    return this.toResponse(rows[0]);
  }

  async create(data: {
    lotId: string;
    lotName: string;
    employeeId: number;
    shape: string;
    shapeCategory: 'ROUND' | 'FANCY' | 'BLOCKING';
    qty: number;
    issueWeight: number;
    estimateWt: number;
    issueDate?: string;
    labourHeadId: number;
    lab?: string;
    createdBy: number;
  }): Promise<LotResponse> {
    const sql = `INSERT INTO lots (lot_id, lot_name, employee_id, shape, shape_category, qty, issue_weight, estimate_wt, issue_date, labour_head_id, lab, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURDATE()), ?, ?, 'ISSUED', ?)`;
    const result = await this.query<any>(sql, [
      data.lotId, data.lotName, data.employeeId, data.shape, data.shapeCategory,
      data.qty, data.issueWeight, data.estimateWt, data.issueDate || null, data.labourHeadId,
      data.lab || null, data.createdBy,
    ]);
    return this.findById(result.insertId) as Promise<LotResponse>;
  }

  async receive(id: number, data: {
    polishedWt: number;
    color?: string;
    clarity?: string;
    cut?: string;
    grader?: string;
    receivedDate: string;
    updatedBy: number;
  }): Promise<LotResponse> {
    const lot = await this.query<LotRow[]>('SELECT * FROM lots WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!lot[0]) throw new Error('Lot not found');

    const issueDate = new Date(lot[0].issue_date);
    const recvDate = new Date(data.receivedDate);
    const daysConsumed = Math.floor((recvDate.getTime() - issueDate.getTime()) / (1000 * 60 * 60 * 24));
    const weightDiff = parseFloat(lot[0].issue_weight.toString()) - data.polishedWt;

    // Compute labour amount
    const rates = await this.rateCardRepo.findAll();
    const labourAmount = computeLabourAmount(
      data.polishedWt,
      lot[0].qty,
      lot[0].shape_category,
      lot[0].lab,
      rates.map((r) => ({
        id: r.id,
        shape_category: r.shapeCategory,
        lab: r.lab,
        cts_min: r.ctsMin,
        cts_max: r.ctsMax,
        rate_per_ct: r.ratePerCt,
        effective_from: r.effectiveFrom,
        is_active: true,
        created_by: null,
        updated_by: null,
        created_at: '',
        updated_at: '',
        deleted_at: null,
      })),
    );

    await this.query(
      `UPDATE lots SET status = 'RECEIVED', received_date = ?, polished_wt = ?, color = ?, clarity = ?, cut = ?, grader = ?, days_consumed = ?, weight_diff = ?, labour_amount = ?, updated_by = ? WHERE id = ?`,
      [
        data.receivedDate, data.polishedWt, data.color || null, data.clarity || null,
        data.cut || null, data.grader || null, daysConsumed, weightDiff, labourAmount,
        data.updatedBy, id,
      ],
    );
    return this.findById(id) as Promise<LotResponse>;
  }

  async verify(id: number, updatedBy: number): Promise<LotResponse> {
    await this.query(
      "UPDATE lots SET status = 'VERIFIED', updated_by = ? WHERE id = ? AND deleted_at IS NULL",
      [updatedBy, id],
    );
    return this.findById(id) as Promise<LotResponse>;
  }

  async getMaxLotId(): Promise<number> {
    const rows = await this.query<any[]>('SELECT MAX(CAST(lot_id AS UNSIGNED)) as max_id FROM lots');
    return rows[0]?.max_id ?? 92124000;
  }

  async getExceptions(): Promise<ExceptionItem[]> {
    const exceptions: ExceptionItem[] = [];

    // Leakage exceptions
    const leakageRows = await this.query<any[]>(
      `SELECT l.*, e.full_name FROM lots l 
       JOIN employees e ON l.employee_id = e.id 
       WHERE l.status IN ('VERIFIED', 'RECEIVED') AND l.deleted_at IS NULL
       AND l.weight_diff IS NOT NULL AND l.issue_weight > 0
       AND (l.weight_diff / l.issue_weight) * 100 > 5.0
       LIMIT 5`,
    );
    for (const row of leakageRows) {
      const pct = ((row.weight_diff / row.issue_weight) * 100).toFixed(1);
      exceptions.push({
        type: 'leakage',
        title: `Leakage Flag — ${pct}%`,
        detail: `${row.lot_name} — ${row.full_name.split(' ')[0]}`,
      });
    }

    // Overdue exceptions
    const overdueRows = await this.query<any[]>(
      `SELECT l.*, e.full_name, DATEDIFF(CURDATE(), l.issue_date) as days_since
       FROM lots l JOIN employees e ON l.employee_id = e.id
       WHERE l.status IN ('ISSUED', 'IN_PROGRESS') AND l.deleted_at IS NULL
       AND DATEDIFF(CURDATE(), l.issue_date) > 18
       LIMIT 5`,
    );
    for (const row of overdueRows) {
      exceptions.push({
        type: 'overdue',
        title: `Overdue ${row.days_since}d`,
        detail: `${row.lot_name} — ${row.full_name.split(' ')[0]}`,
      });
    }

    // Rework exceptions
    const reworkRows = await this.query<any[]>(
      `SELECT l.*, e.full_name FROM lots l
       JOIN employees e ON l.employee_id = e.id
       WHERE l.status = 'REWORK' AND l.deleted_at IS NULL
       LIMIT 5`,
    );
    for (const row of reworkRows) {
      exceptions.push({
        type: 'rework',
        title: 'Rework Pending',
        detail: `${row.lot_name} — ${row.full_name.split(' ')[0]}`,
      });
    }

    return exceptions.slice(0, 5);
  }

  async getKpiData(): Promise<{
    yieldPct: number;
    wipCarats: number;
    wipValue: number;
    avgDaysConsumed: number;
    labourPerCt: number;
    onTimePct: number;
    reworkPct: number;
    totalLots: number;
    activeLots: number;
    leakageExceptions: number;
  }> {
    // Yield
    const yieldRow = await this.query<any[]>(
      `SELECT 
        COALESCE(SUM(issue_weight), 0) as total_issue,
        COALESCE(SUM(polished_wt), 0) as total_polished
      FROM lots WHERE status IN ('VERIFIED', 'RECEIVED') AND deleted_at IS NULL`,
    );
    const yieldPct = yieldRow[0]?.total_issue > 0
      ? Math.round((yieldRow[0].total_polished / yieldRow[0].total_issue) * 1000) / 10
      : 0;

    // WIP carats
    const wipRow = await this.query<any[]>(
      "SELECT COALESCE(SUM(issue_weight), 0) as wip FROM lots WHERE status IN ('ISSUED', 'IN_PROGRESS') AND deleted_at IS NULL",
    );
    const wipCarats = wipRow[0]?.wip ?? 0;

    // Avg days
    const daysRow = await this.query<any[]>(
      `SELECT COALESCE(AVG(days_consumed), 0) as avg_days FROM lots WHERE status IN ('VERIFIED', 'RECEIVED') AND days_consumed IS NOT NULL AND deleted_at IS NULL`,
    );
    const avgDaysConsumed = Math.round((daysRow[0]?.avg_days ?? 0) * 10) / 10;

    // On-time %
    const onTimeRow = await this.query<any[]>(
      `SELECT 
        COUNT(*) as total_received,
        SUM(CASE WHEN days_consumed <= 18 THEN 1 ELSE 0 END) as on_time
      FROM lots WHERE status IN ('VERIFIED', 'RECEIVED') AND deleted_at IS NULL`,
    );
    const onTimePct = onTimeRow[0]?.total_received > 0
      ? Math.round((onTimeRow[0].on_time / onTimeRow[0].total_received) * 1000) / 10
      : 0;

    // Rework %
    const reworkRow = await this.query<any[]>(
      `SELECT 
        COUNT(*) as total_rework
      FROM lots WHERE status = 'REWORK' AND deleted_at IS NULL`,
    );
    const receivedCount = onTimeRow[0]?.total_received ?? 0;
    const reworkCount = reworkRow[0]?.total_rework ?? 0;
    const reworkPct = (receivedCount + reworkCount) > 0
      ? Math.round((reworkCount / (receivedCount + reworkCount)) * 1000) / 10
      : 0;

    // Total and active lots
    const totalRow = await this.query<any[]>('SELECT COUNT(*) as cnt FROM lots WHERE deleted_at IS NULL');
    const activeRow = await this.query<any[]>(
      "SELECT COUNT(*) as cnt FROM lots WHERE status IN ('ISSUED', 'IN_PROGRESS') AND deleted_at IS NULL",
    );
    const totalLots = totalRow[0]?.cnt ?? 0;
    const activeLots = activeRow[0]?.cnt ?? 0;

    // Leakage exceptions
    const leakRow = await this.query<any[]>(
      `SELECT COUNT(*) as cnt FROM lots 
       WHERE status IN ('VERIFIED', 'RECEIVED') AND deleted_at IS NULL
       AND weight_diff IS NOT NULL AND issue_weight > 0
       AND (weight_diff / issue_weight) * 100 > 5.0`,
    );
    const leakageExceptions = leakRow[0]?.cnt ?? 0;

    // Labour per ct (from salary_lines)
    const labourRow = await this.query<any[]>(
      `SELECT COALESCE(SUM(total_cts), 0) as total_cts, COALESCE(SUM(total_amount), 0) as total_amount
       FROM salary_lines WHERE period_id = (SELECT id FROM salary_periods WHERE status = 'OPEN' LIMIT 1)`,
    );
    const labourPerCt = labourRow[0]?.total_cts > 0
      ? Math.round(labourRow[0].total_amount / labourRow[0].total_cts)
      : 0;

    return {
      yieldPct,
      wipCarats,
      wipValue: Math.round(wipCarats * 150000),
      avgDaysConsumed,
      labourPerCt,
      onTimePct,
      reworkPct,
      totalLots,
      activeLots,
      leakageExceptions,
    };
  }

  async getStatusDistribution(): Promise<{ name: string; value: number; color: string }[]> {
    const rows = await this.query<any[]>(
      `SELECT status, COUNT(*) as cnt FROM lots WHERE deleted_at IS NULL GROUP BY status`,
    );
    const colorMap: Record<string, string> = {
      ISSUED: '#9CA3AF',
      IN_PROGRESS: '#CA8A04',
      RECEIVED: '#2563EB',
      VERIFIED: '#16A34A',
      REWORK: '#EA580C',
      LOST: '#DC2626',
    };
    const labelMap: Record<string, string> = {
      ISSUED: 'Issued',
      IN_PROGRESS: 'In Progress',
      RECEIVED: 'Received',
      VERIFIED: 'Verified',
      REWORK: 'Rework',
      LOST: 'Lost',
    };
    const statusOrder = ['ISSUED', 'IN_PROGRESS', 'RECEIVED', 'VERIFIED', 'REWORK', 'LOST'];
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = r.cnt;
    return statusOrder.map((s) => ({
      name: labelMap[s],
      value: counts[s] ?? 0,
      color: colorMap[s],
    }));
  }

  /**
   * Piece-rate earnings per employee for a payroll window.
   *
   * A lot contributes to payroll once it has been received (RECEIVED/VERIFIED)
   * and the received date falls inside the window — that is the date the work
   * is considered delivered, regardless of when it was issued.
   */
  async getLabourByEmployeeForWindow(
    from: string,
    to: string,
    conn?: any,
  ): Promise<{ employee_id: number; total_amount: number; total_cts: number; lots_count: number }[]> {
    const sql = `SELECT employee_id,
                        COALESCE(SUM(labour_amount), 0) AS total_amount,
                        COALESCE(SUM(issue_weight), 0) AS total_cts,
                        COUNT(*) AS lots_count
                 FROM lots
                 WHERE status IN ('RECEIVED', 'VERIFIED')
                   AND received_date BETWEEN ? AND ?
                   AND deleted_at IS NULL
                 GROUP BY employee_id`;
    if (conn) {
      const [rows] = await conn.query(sql, [from, to]);
      return rows as { employee_id: number; total_amount: number; total_cts: number; lots_count: number }[];
    }
    return this.query<{ employee_id: number; total_amount: number; total_cts: number; lots_count: number }[]>(
      sql,
      [from, to],
    );
  }

  /** Per-employee productivity over a window (lots, carats in/out, labour value). */
  async getProductivityByMonth(
    from: string,
    to: string,
  ): Promise<
    {
      employee_id: number;
      employee_name: string;
      emp_code: string;
      lots_count: number;
      total_cts: number;
      total_polished: number;
      labour_amount: number;
    }[]
  > {
    return this.query<any[]>(
      `SELECT l.employee_id,
              e.full_name AS employee_name,
              e.emp_code,
              COUNT(*) AS lots_count,
              COALESCE(SUM(l.issue_weight), 0) AS total_cts,
              COALESCE(SUM(l.polished_wt), 0) AS total_polished,
              COALESCE(SUM(l.labour_amount), 0) AS labour_amount
       FROM lots l
       JOIN employees e ON l.employee_id = e.id
       WHERE l.status IN ('RECEIVED', 'VERIFIED')
         AND l.received_date BETWEEN ? AND ?
         AND l.deleted_at IS NULL
       GROUP BY l.employee_id, e.full_name, e.emp_code
       ORDER BY labour_amount DESC`,
      [from, to],
    );
  }

  private async toResponse(row: any): Promise<LotResponse> {
    const fmtDate = (d: any): string => d instanceof Date ? d.toISOString().split('T')[0] : String(d);
    return {
      id: row.id,
      lotId: row.lot_id,
      lotName: row.lot_name,
      employeeId: row.employee_id,
      employeeName: row.employee_name || '',
      qty: row.qty,
      shape: row.shape,
      shapeCategory: row.shape_category,
      issueWeight: parseFloat(row.issue_weight),
      estimateWt: parseFloat(row.estimate_wt),
      issueDate: fmtDate(row.issue_date),
      receivedDate: row.received_date ? fmtDate(row.received_date) : null,
      polishedWt: row.polished_wt ? parseFloat(row.polished_wt) : null,
      color: row.color,
      clarity: row.clarity,
      cut: row.cut,
      grader: row.grader,
      lab: row.lab,
      labourHead: row.labour_head_name || '',
      remarks: row.remarks,
      status: row.status,
      daysConsumed: row.days_consumed,
      weightDiff: row.weight_diff ? parseFloat(row.weight_diff) : null,
      labourAmount: row.labour_amount ? parseFloat(row.labour_amount) : null,
    };
  }
}
