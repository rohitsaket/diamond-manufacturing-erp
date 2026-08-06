import { Request, Response } from 'express';
import { OfferService } from '../services/OfferService';
import { OfferLetterService } from '../services/OfferLetterService';
import { PerfActionContext } from '../types/performance';

function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/only the employee/i.test(message)) return 403;
  if (/only|cannot|must be|required|needs|invalid|already/i.test(message)) return 400;
  return 500;
}

export class OfferController {
  private offers = new OfferService();
  private letters = new OfferLetterService();

  private ctx(req: Request): PerfActionContext {
    return {
      userId: req.user!.userId,
      userRole: req.user!.role,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    };
  }

  private fail(res: Response, err: any): void {
    res.status(statusFor(err.message ?? '')).json({ error: err.message });
  }

  create = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.offers.create(req.body ?? {}, this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query as Record<string, string>;
      res.json(await this.offers.list({
        status: q.status || undefined,
        applicationId: q.applicationId ? parseInt(q.applicationId) : undefined,
      }));
    } catch (err: any) { this.fail(res, err); }
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.offers.getById(parseInt(req.params.id as string)));
    } catch (err: any) { this.fail(res, err); }
  };

  submit = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.offers.submit(parseInt(req.params.id as string), this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  approve = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.offers.approve(parseInt(req.params.id as string), this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  rejectApproval = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.offers.rejectApproval(parseInt(req.params.id as string), req.body?.reason, this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  release = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.offers.release(parseInt(req.params.id as string), this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  withdraw = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.offers.withdraw(parseInt(req.params.id as string), this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  myOffers = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(400).json({ error: 'This account is not linked to an employee record' });
        return;
      }
      res.json(await this.offers.myOffers(employeeId));
    } catch (err: any) { this.fail(res, err); }
  };

  accept = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.offers.accept(
        parseInt(req.params.id as string),
        {
          userId: req.user!.userId,
          employeeId: req.user!.employeeId ?? undefined,
          role: req.user!.role,
          ip: req.ip ?? null,
        },
        this.ctx(req),
      ));
    } catch (err: any) { this.fail(res, err); }
  };

  decline = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.offers.decline(
        parseInt(req.params.id as string),
        req.body?.note,
        { userId: req.user!.userId, employeeId: req.user!.employeeId ?? undefined },
        this.ctx(req),
      ));
    } catch (err: any) { this.fail(res, err); }
  };

  issueLetter = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.offers.setLetter(parseInt(req.params.id as string), this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };

  /** Streams the letter PDF. Staff always; the offer's employee once RELEASED+. */
  downloadLetter = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      // Ensure the letter number exists before rendering.
      await this.offers.setLetter(id, this.ctx(req));
      const row = await this.offers.getRow(id);
      const role = req.user!.role;
      const isStaff = ['admin', 'manager', 'operator', 'accountant', 'hr'].includes(role);
      if (!isStaff) {
        const own = row.employee_id === req.user!.employeeId;
        const visible = ['RELEASED', 'ACCEPTED', 'DECLINED', 'EFFECTED'].includes(row.status);
        if (!own || !visible) {
          res.status(403).json({ error: 'This letter is not available for your account' });
          return;
        }
      }
      const pdf = await this.letters.offerLetter(row);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="offer-${row.offer_code}.pdf"`);
      res.send(pdf);
    } catch (err: any) { this.fail(res, err); }
  };

  effect = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.offers.effect(parseInt(req.params.id as string), this.ctx(req)));
    } catch (err: any) { this.fail(res, err); }
  };
}
