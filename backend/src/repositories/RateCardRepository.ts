import { BaseRepository } from './BaseRepository';
import { RateCardRow, RateCardResponse, RateCardAuditLogRow, AuditEntryResponse } from '../types';

export class RateCardRepository extends BaseRepository {
  async findAll(shapeCategory?: string): Promise<RateCardResponse[]> {
    let sql = 'SELECT * FROM rate_card_rows WHERE deleted_at IS NULL AND is_active = true';
    const params: any[] = [];
    if (shapeCategory) {
      sql += ' AND shape_category = ?';
      params.push(shapeCategory);
    }
    sql += ' ORDER BY shape_category, lab, cts_min';
    const rows = await this.query<RateCardRow[]>(sql, params);
    return rows.map(this.toResponse);
  }

  async findById(id: number): Promise<RateCardResponse | null> {
    const rows = await this.query<RateCardRow[]>(
      'SELECT * FROM rate_card_rows WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toResponse(rows[0]) : null;
  }

  async updateRate(id: number, newRate: number, updatedBy: number): Promise<RateCardResponse> {
    await this.query(
      'UPDATE rate_card_rows SET rate_per_ct = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL',
      [newRate, updatedBy, id],
    );
    return this.findById(id) as Promise<RateCardResponse>;
  }

  async cloneVersion(effectiveFrom: string, createdBy: number): Promise<void> {
    await this.transaction(async (conn) => {
      const [rows] = await conn.query(
        'SELECT * FROM rate_card_rows WHERE is_active = true AND deleted_at IS NULL',
      );
      const oldRows = rows as RateCardRow[];

      // Deactivate old rows
      await conn.query('UPDATE rate_card_rows SET is_active = false WHERE is_active = true');

      // Insert new version
      for (const row of oldRows) {
        await conn.query(
          `INSERT INTO rate_card_rows (shape_category, lab, cts_min, cts_max, rate_per_ct, effective_from, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [row.shape_category, row.lab, row.cts_min, row.cts_max, row.rate_per_ct, effectiveFrom, createdBy],
        );
      }
    });
  }

  async getLatestEffectiveDate(): Promise<string | null> {
    const rows = await this.query<any[]>(
      'SELECT MAX(effective_from) as max_date FROM rate_card_rows WHERE deleted_at IS NULL',
    );
    return rows[0]?.max_date ?? null;
  }

  async getAuditLogs(): Promise<AuditEntryResponse[]> {
    const rows = await this.query<RateCardAuditLogRow[]>(
      'SELECT * FROM rate_card_audit_logs ORDER BY created_at DESC',
    );
    return rows.map((r) => ({
      date: r.created_at
        ? ((r as any).created_at instanceof Date
          ? (r as any).created_at.toISOString().split('T')[0]
          : String(r.created_at).split(' ')[0])
        : '',
      actor: r.actor,
      change: r.change_description,
      type: r.change_type,
    }));
  }

  async addAuditLog(data: {
    rateCardRowId: number | null;
    actor: string;
    changeDescription: string;
    changeType: 'increase' | 'decrease' | 'bulk';
    oldRate: number | null;
    newRate: number | null;
  }): Promise<void> {
    await this.query(
      `INSERT INTO rate_card_audit_logs (rate_card_row_id, actor, change_description, change_type, old_rate, new_rate) VALUES (?, ?, ?, ?, ?, ?)`,
      [data.rateCardRowId, data.actor, data.changeDescription, data.changeType, data.oldRate, data.newRate],
    );
  }

  async computeImpact(changedId: number, newRate: number): Promise<number> {
    const row = await this.query<RateCardRow[]>(
      'SELECT * FROM rate_card_rows WHERE id = ?',
      [changedId],
    );
    if (!row[0]) return 0;

    const r = row[0];
    const oldRate = r.rate_per_ct;
    const diff = newRate - oldRate;

    const lots = await this.query<any[]>(
      `SELECT polished_wt FROM lots 
       WHERE shape_category = ? AND status IN ('VERIFIED', 'RECEIVED') 
       AND polished_wt IS NOT NULL AND deleted_at IS NULL`,
      [r.shape_category],
    );

    let totalImpact = 0;
    for (const lot of lots) {
      const wt = parseFloat(lot.polished_wt);
      totalImpact += wt * diff;
    }

    return Math.round(totalImpact);
  }

  private toResponse(row: RateCardRow): RateCardResponse {
    return {
      id: row.id,
      shapeCategory: row.shape_category,
      lab: row.lab,
      ctsMin: parseFloat(row.cts_min.toString()),
      ctsMax: parseFloat(row.cts_max.toString()),
      ratePerCt: parseFloat(row.rate_per_ct.toString()),
      effectiveFrom: (row as any).effective_from instanceof Date ? (row as any).effective_from.toISOString().split('T')[0] : String(row.effective_from),
    };
  }
}
