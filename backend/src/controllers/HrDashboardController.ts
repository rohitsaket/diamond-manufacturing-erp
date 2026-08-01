import { Request, Response } from 'express';
import { DashboardAggregateService } from '../services/DashboardAggregateService';
import { SearchService } from '../services/SearchService';
import { CalendarService } from '../services/CalendarService';
import { DashboardLayoutRepository } from '../repositories/DashboardLayoutRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { STAFF_ROLES } from '../middleware/auth';
import { DashboardKey, WidgetLayoutItem } from '../types/hrms';

const DASHBOARD_KEYS: DashboardKey[] = ['employee', 'manager', 'hr', 'executive'];

/**
 * Role-based HR dashboards plus the cross-cutting omnibox, calendar and
 * activity feed. Intentionally separate from the manufacturing
 * `/api/dashboard` controller, which is left untouched.
 */
export class HrDashboardController {
  private dashboards = new DashboardAggregateService();
  private search = new SearchService();
  private calendar = new CalendarService();
  private layouts = new DashboardLayoutRepository();
  private activity = new ActivityRepository();

  // -------------------------------------------------------------------------
  // Dashboards
  // -------------------------------------------------------------------------
  employeeDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
      const raw = req.query.employeeId;
      let employeeId = req.user?.employeeId ?? 0;

      if (raw !== undefined && raw !== '') {
        if (!isStaff(req)) {
          res.status(403).json({ error: 'You can only view your own dashboard' });
          return;
        }
        const parsed = parseId(raw);
        if (!parsed) {
          res.status(400).json({ error: 'employeeId must be a positive integer' });
          return;
        }
        employeeId = parsed;
      }

      if (!employeeId) {
        res.status(400).json({ error: 'This account is not linked to an employee record' });
        return;
      }

      res.json(await this.dashboards.getEmployeeDashboard(employeeId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  managerDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
      const raw = req.query.employeeId;
      let managerEmployeeId = req.user?.employeeId ?? undefined;

      if (raw !== undefined && raw !== '') {
        const parsed = parseId(raw);
        if (!parsed) {
          res.status(400).json({ error: 'employeeId must be a positive integer' });
          return;
        }
        managerEmployeeId = parsed;
      }

      res.json(await this.dashboards.getManagerDashboard(managerEmployeeId ?? undefined));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  hrDashboard = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.dashboards.getHrDashboard());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  executiveDashboard = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.dashboards.getExecutiveDashboard());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // -------------------------------------------------------------------------
  // Global search
  // -------------------------------------------------------------------------
  globalSearch = async (req: Request, res: Response): Promise<void> => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      if (q.trim().length < 2) {
        res.status(400).json({ error: 'Enter at least 2 characters' });
        return;
      }
      const user = req.user!;
      res.json(
        await this.search.search(q, {
          userId: user.userId,
          role: user.role,
          employeeId: user.employeeId ?? null,
        }),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // -------------------------------------------------------------------------
  // Calendar
  // -------------------------------------------------------------------------
  getCalendar = async (req: Request, res: Response): Promise<void> => {
    try {
      const from = typeof req.query.from === 'string' ? req.query.from : '';
      const to = typeof req.query.to === 'string' ? req.query.to : '';
      if (!from || !to) {
        res.status(400).json({ error: 'Both from and to query parameters are required' });
        return;
      }

      let employeeId: number | undefined;
      if (isStaff(req)) {
        const raw = req.query.employeeId;
        if (raw !== undefined && raw !== '') {
          const parsed = parseId(raw);
          if (!parsed) {
            res.status(400).json({ error: 'employeeId must be a positive integer' });
            return;
          }
          employeeId = parsed;
        }
      } else {
        // Self-service callers only ever see their own leave.
        employeeId = req.user?.employeeId ?? undefined;
        if (!employeeId) {
          res.status(403).json({ error: 'This account is not linked to an employee record' });
          return;
        }
      }

      res.json(await this.calendar.getEvents(from, to, { employeeId }));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  };

  // -------------------------------------------------------------------------
  // Activity feed
  // -------------------------------------------------------------------------
  getActivity = async (req: Request, res: Response): Promise<void> => {
    try {
      let employeeId: number | undefined;
      if (isStaff(req)) {
        const raw = req.query.employeeId;
        if (raw !== undefined && raw !== '') {
          const parsed = parseId(raw);
          if (!parsed) {
            res.status(400).json({ error: 'employeeId must be a positive integer' });
            return;
          }
          employeeId = parsed;
        }
      } else {
        employeeId = req.user?.employeeId ?? undefined;
        if (!employeeId) {
          res.status(403).json({ error: 'This account is not linked to an employee record' });
          return;
        }
      }

      const entityTypeRaw = req.query.entityType;
      const entityType = typeof entityTypeRaw === 'string' && entityTypeRaw !== '' ? entityTypeRaw : undefined;

      let limit: number | undefined;
      if (req.query.limit !== undefined && req.query.limit !== '') {
        const parsed = Number(req.query.limit);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
          res.status(400).json({ error: 'limit must be an integer between 1 and 200' });
          return;
        }
        limit = parsed;
      }

      res.json(await this.activity.findRecent({ employeeId, entityType, limit }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // -------------------------------------------------------------------------
  // Dashboard layouts (per user)
  // -------------------------------------------------------------------------
  getLayouts = async (req: Request, res: Response): Promise<void> => {
    try {
      const key = parseDashboardKey(req.params.dashboardKey);
      if (!key) {
        res.status(400).json({ error: 'dashboardKey must be one of employee, manager, hr, executive' });
        return;
      }
      res.json(await this.layouts.getLayouts(req.user!.userId, key));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  saveLayout = async (req: Request, res: Response): Promise<void> => {
    try {
      const key = parseDashboardKey(req.params.dashboardKey);
      if (!key) {
        res.status(400).json({ error: 'dashboardKey must be one of employee, manager, hr, executive' });
        return;
      }

      const body = (req.body ?? {}) as {
        layoutName?: unknown;
        layout?: unknown;
        isActive?: unknown;
      };
      const layoutName = typeof body.layoutName === 'string' ? body.layoutName.trim() : 'Default';
      if (!layoutName || layoutName.length > 100) {
        res.status(400).json({ error: 'layoutName must be 1-100 characters' });
        return;
      }
      if (!Array.isArray(body.layout)) {
        res.status(400).json({ error: 'layout must be an array of widget items' });
        return;
      }

      const layout = normaliseLayout(body.layout);
      if (layout === null) {
        res.status(400).json({ error: 'Every layout item needs a string widgetKey' });
        return;
      }

      const isActive = body.isActive === undefined ? true : !!body.isActive;
      await this.layouts.saveLayout(req.user!.userId, key, layoutName, layout, isActive);
      res.json({ dashboardKey: key, layoutName, isActive, layout });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteLayout = async (req: Request, res: Response): Promise<void> => {
    try {
      const key = parseDashboardKey(req.params.dashboardKey);
      if (!key) {
        res.status(400).json({ error: 'dashboardKey must be one of employee, manager, hr, executive' });
        return;
      }
      const layoutName = String(req.params.layoutName ?? '').trim();
      if (!layoutName) {
        res.status(400).json({ error: 'A layout name is required' });
        return;
      }

      const removed = await this.layouts.deleteLayout(req.user!.userId, key, layoutName);
      if (removed === 0) {
        res.status(404).json({ error: 'That layout does not exist' });
        return;
      }
      res.json({ deleted: removed });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  resetLayouts = async (req: Request, res: Response): Promise<void> => {
    try {
      const key = parseDashboardKey(req.params.dashboardKey);
      if (!key) {
        res.status(400).json({ error: 'dashboardKey must be one of employee, manager, hr, executive' });
        return;
      }
      const removed = await this.layouts.resetLayouts(req.user!.userId, key);
      res.json({ dashboardKey: key, deleted: removed });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isStaff(req: Request): boolean {
  const role = req.user?.role ?? '';
  return (STAFF_ROLES as readonly string[]).includes(role);
}

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseDashboardKey(raw: unknown): DashboardKey | null {
  const value = String(raw ?? '');
  return (DASHBOARD_KEYS as string[]).includes(value) ? (value as DashboardKey) : null;
}

/** Returns null when any item is unusable so the caller can answer 400. */
function normaliseLayout(items: unknown[]): WidgetLayoutItem[] | null {
  const out: WidgetLayoutItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') return null;
    const rec = item as Record<string, unknown>;
    if (typeof rec.widgetKey !== 'string' || rec.widgetKey.trim() === '') return null;
    out.push({
      widgetKey: rec.widgetKey.trim(),
      order: Number.isFinite(Number(rec.order)) ? Number(rec.order) : i,
      colSpan: Number.isFinite(Number(rec.colSpan)) ? Number(rec.colSpan) : 1,
      hidden: !!rec.hidden,
      collapsed: !!rec.collapsed,
      pinned: !!rec.pinned,
    });
  }
  return out;
}
