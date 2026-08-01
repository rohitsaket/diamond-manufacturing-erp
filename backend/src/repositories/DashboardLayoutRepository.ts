import { BaseRepository } from './BaseRepository';
import { DashboardKey, DashboardLayoutResponse, WidgetLayoutItem } from '../types/hrms';

/**
 * Per-user dashboard widget layouts (drag / resize / hide / pin).
 *
 * `layout_json` is user-authored JSON, so every read parses defensively:
 * a corrupt or hand-edited blob degrades to an empty layout instead of
 * breaking the whole dashboard request.
 */
export class DashboardLayoutRepository extends BaseRepository {
  async getLayouts(userId: number, dashboardKey: DashboardKey): Promise<DashboardLayoutResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT dashboard_key, layout_name, is_active, layout_json
         FROM dashboard_layouts
        WHERE user_id = ? AND dashboard_key = ?
        ORDER BY is_active DESC, layout_name ASC`,
      [userId, dashboardKey],
    );

    return rows.map((r) => ({
      dashboardKey: r.dashboard_key as DashboardKey,
      layoutName: r.layout_name,
      isActive: !!r.is_active,
      layout: parseLayout(r.layout_json),
    }));
  }

  async saveLayout(
    userId: number,
    dashboardKey: DashboardKey,
    layoutName: string,
    layout: WidgetLayoutItem[],
    isActive: boolean,
  ): Promise<void> {
    const json = JSON.stringify(layout ?? []);
    await this.transaction(async (conn) => {
      if (isActive) {
        await conn.query(
          'UPDATE dashboard_layouts SET is_active = false WHERE user_id = ? AND dashboard_key = ?',
          [userId, dashboardKey],
        );
      }
      await conn.query(
        `INSERT INTO dashboard_layouts (user_id, dashboard_key, layout_name, is_active, layout_json)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE layout_json = VALUES(layout_json), is_active = VALUES(is_active)`,
        [userId, dashboardKey, layoutName, isActive, json],
      );
    });
  }

  async setActive(userId: number, dashboardKey: DashboardKey, layoutName: string): Promise<void> {
    const existing = await this.query<any[]>(
      'SELECT id FROM dashboard_layouts WHERE user_id = ? AND dashboard_key = ? AND layout_name = ? LIMIT 1',
      [userId, dashboardKey, layoutName],
    );
    if (existing.length === 0) throw new Error('That layout does not exist');

    await this.transaction(async (conn) => {
      await conn.query(
        'UPDATE dashboard_layouts SET is_active = false WHERE user_id = ? AND dashboard_key = ?',
        [userId, dashboardKey],
      );
      await conn.query(
        'UPDATE dashboard_layouts SET is_active = true WHERE user_id = ? AND dashboard_key = ? AND layout_name = ?',
        [userId, dashboardKey, layoutName],
      );
    });
  }

  async deleteLayout(userId: number, dashboardKey: DashboardKey, layoutName: string): Promise<number> {
    const result = await this.query<any>(
      'DELETE FROM dashboard_layouts WHERE user_id = ? AND dashboard_key = ? AND layout_name = ?',
      [userId, dashboardKey, layoutName],
    );
    return Number(result?.affectedRows ?? 0);
  }

  /** Drops every stored layout for the dashboard so the UI falls back to its defaults. */
  async resetLayouts(userId: number, dashboardKey: DashboardKey): Promise<number> {
    const result = await this.query<any>(
      'DELETE FROM dashboard_layouts WHERE user_id = ? AND dashboard_key = ?',
      [userId, dashboardKey],
    );
    return Number(result?.affectedRows ?? 0);
  }
}

function parseLayout(raw: unknown): WidgetLayoutItem[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: WidgetLayoutItem[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const widgetKey = typeof rec.widgetKey === 'string' ? rec.widgetKey : null;
    if (!widgetKey) continue;
    out.push({
      widgetKey,
      order: Number.isFinite(Number(rec.order)) ? Number(rec.order) : out.length,
      colSpan: Number.isFinite(Number(rec.colSpan)) ? Number(rec.colSpan) : 1,
      hidden: !!rec.hidden,
      collapsed: !!rec.collapsed,
      pinned: !!rec.pinned,
    });
  }
  return out;
}
