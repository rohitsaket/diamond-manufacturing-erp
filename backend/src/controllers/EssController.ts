import { Request, Response } from 'express';
import { EssAccountService } from '../services/EssAccountService';

/** Employee self-service: own profile/preferences, plus HR-side login provisioning. */
export class EssController {
  private service = new EssAccountService();

  me = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.getMyProfile(req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  changePassword = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = (req.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
      if (typeof body.currentPassword !== 'string' || body.currentPassword === '') {
        res.status(400).json({ error: 'currentPassword is required' });
        return;
      }
      if (typeof body.newPassword !== 'string' || body.newPassword === '') {
        res.status(400).json({ error: 'newPassword is required' });
        return;
      }

      await this.service.changePassword(req.user!.userId, body.currentPassword, body.newPassword);
      res.json({ changed: true });
    } catch (err: any) {
      const status = /incorrect|at least|required|not found/i.test(err.message ?? '') ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  };

  setTheme = async (req: Request, res: Response): Promise<void> => {
    try {
      const theme = (req.body ?? {}).theme;
      if (typeof theme !== 'string' || theme === '') {
        res.status(400).json({ error: 'theme is required' });
        return;
      }
      res.json(await this.service.setTheme(req.user!.userId, theme));
    } catch (err: any) {
      const status = /Theme must be/i.test(err.message ?? '') ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  };

  provisionLogin = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = parseId(req.params.id);
      if (!employeeId) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }

      const body = (req.body ?? {}) as { email?: unknown; password?: unknown };
      if (body.email !== undefined && typeof body.email !== 'string') {
        res.status(400).json({ error: 'email must be a string' });
        return;
      }
      if (body.password !== undefined && typeof body.password !== 'string') {
        res.status(400).json({ error: 'password must be a string' });
        return;
      }

      const result = await this.service.provisionLogin(
        employeeId,
        { email: body.email as string | undefined, password: body.password as string | undefined },
        req.user!.userId,
      );
      res.json(result);
    } catch (err: any) {
      const status = /already has a login|already in use|not found|not valid|Only working|at least|required/i.test(
        err.message ?? '',
      )
        ? 400
        : 500;
      res.status(status).json({ error: err.message });
    }
  };

  bulkProvision = async (req: Request, res: Response): Promise<void> => {
    try {
      const ids = (req.body ?? {}).employeeIds;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'employeeIds must be a non-empty array of employee ids' });
        return;
      }
      if (ids.length > 500) {
        res.status(400).json({ error: 'employeeIds is limited to 500 ids per request' });
        return;
      }

      res.json(await this.service.bulkProvision(ids.map(Number), req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  revokeLogin = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = parseId(req.params.id);
      if (!employeeId) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.service.revokeLogin(employeeId, req.user!.userId));
    } catch (err: any) {
      const status = /does not have a login|required/i.test(err.message ?? '') ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  };
}

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
