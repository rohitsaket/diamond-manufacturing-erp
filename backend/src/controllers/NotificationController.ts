import { Request, Response } from 'express';
import { NotificationService } from '../services/NotificationService';

const CATEGORIES = [
  'LEAVE', 'ATTENDANCE', 'PAYROLL', 'TRAINING', 'POLICY', 'SECURITY',
  'SYSTEM', 'RECRUITMENT', 'EXPENSE', 'TASK', 'HELPDESK', 'ASSET',
];

/** Notification centre. Every action is scoped to the authenticated user. */
export class NotificationController {
  private service = new NotificationService();

  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const category = typeof req.query.category === 'string' && req.query.category !== ''
        ? req.query.category.toUpperCase()
        : undefined;
      if (category && !CATEGORIES.includes(category)) {
        res.status(400).json({ error: `category must be one of ${CATEGORIES.join(', ')}` });
        return;
      }

      let limit: number | undefined;
      if (req.query.limit !== undefined && req.query.limit !== '') {
        const parsed = Number(req.query.limit);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
          res.status(400).json({ error: 'limit must be an integer between 1 and 200' });
          return;
        }
        limit = parsed;
      }

      const search = typeof req.query.search === 'string' && req.query.search.trim() !== ''
        ? req.query.search.trim()
        : undefined;

      res.json(
        await this.service.list(req.user!.userId, {
          unreadOnly: isTrue(req.query.unreadOnly),
          archived: isTrue(req.query.archived),
          category,
          search,
          limit,
        }),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  unreadCount = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({ count: await this.service.unreadCount(req.user!.userId) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  markRead = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'A valid notification id is required' });
        return;
      }
      await this.service.markRead(id, req.user!.userId);
      res.json({ id, isRead: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  markAllRead = async (req: Request, res: Response): Promise<void> => {
    try {
      const updated = await this.service.markAllRead(req.user!.userId);
      res.json({ updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  archive = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'A valid notification id is required' });
        return;
      }
      await this.service.archive(id, req.user!.userId);
      res.json({ id, isArchived: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  snooze = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        res.status(400).json({ error: 'A valid notification id is required' });
        return;
      }
      const until = (req.body ?? {}).until;
      if (typeof until !== 'string' || until.trim() === '') {
        res.status(400).json({ error: 'A snooze time (until) is required' });
        return;
      }
      if (Number.isNaN(Date.parse(until))) {
        res.status(400).json({ error: 'until must be a valid date-time' });
        return;
      }

      await this.service.snooze(id, req.user!.userId, until);
      res.json({ id, snoozedUntil: until });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}

function isTrue(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
