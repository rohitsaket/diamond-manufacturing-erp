import { Request, Response } from 'express';
import { CandidateService } from '../services/CandidateService';
import { CandidateStatus } from '../types/hrms';

export class CandidateController {
  private service = new CandidateService();

  // =========================================================================
  // Job openings
  // =========================================================================
  listOpenings = async (req: Request, res: Response): Promise<void> => {
    try {
      const { status } = req.query as Record<string, string>;
      const openings = await this.service.listOpenings(status);
      res.json(openings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createOpening = async (req: Request, res: Response): Promise<void> => {
    try {
      const { title, department, grade, workerType, openings, openedAt, notes } = req.body ?? {};
      if (!title) {
        res.status(400).json({ error: 'A job title is required' });
        return;
      }
      const created = await this.service.createOpening(
        { title, department, grade, workerType, openings, openedAt, notes },
        req.user!.userId,
      );
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateOpening = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const { title, department, grade, workerType, openings, status, notes } = req.body ?? {};
      const updated = await this.service.updateOpening(
        id,
        { title, department, grade, workerType, openings, status, notes },
        req.user!.userId,
      );
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  closeOpening = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const { closedAt } = req.body ?? {};
      const updated = await this.service.closeOpening(id, req.user!.userId, closedAt);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Candidates
  // =========================================================================
  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const { status, openingId, search, limit } = req.query as Record<string, string>;
      const candidates = await this.service.list({
        status: status ? (status as CandidateStatus) : undefined,
        openingId: openingId ? parseInt(openingId) : undefined,
        search: search || undefined,
        limit: limit ? parseInt(limit) : undefined,
      });
      res.json(candidates);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const candidate = await this.service.getById(id);
      res.json(candidate);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!body.fullName) {
        res.status(400).json({ error: 'Candidate name is required' });
        return;
      }
      if (!body.phone) {
        res.status(400).json({ error: 'A contact phone number is required' });
        return;
      }
      if (!body.positionGrade) {
        res.status(400).json({ error: 'A position grade is required' });
        return;
      }

      const created = await this.service.create(
        {
          fullName: body.fullName,
          phone: body.phone,
          email: body.email,
          openingId: body.openingId ? Number(body.openingId) : null,
          positionGrade: body.positionGrade,
          workerType: body.workerType,
          expectedSalary: body.expectedSalary ?? null,
          experienceYears: body.experienceYears ?? null,
          source: body.source ?? null,
          interviewDate: body.interviewDate ?? null,
          notes: body.notes ?? null,
        },
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const body = req.body ?? {};
      const updated = await this.service.update(
        id,
        {
          fullName: body.fullName,
          phone: body.phone,
          email: body.email,
          openingId: body.openingId === undefined ? undefined : body.openingId === null ? null : Number(body.openingId),
          positionGrade: body.positionGrade,
          workerType: body.workerType,
          expectedSalary: body.expectedSalary,
          experienceYears: body.experienceYears,
          source: body.source,
          interviewDate: body.interviewDate,
          notes: body.notes,
        },
        req.user!.userId,
      );
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const { status } = req.body ?? {};
      if (!status) {
        res.status(400).json({ error: 'A status is required' });
        return;
      }
      const updated = await this.service.updateStatus(
        id,
        String(status).toUpperCase() as CandidateStatus,
        req.user!.userId,
        req.user!.name,
      );
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  convert = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const { empCode, grade, workerType, joinedAt, monthlySalary, department, designation, shiftId } =
        req.body ?? {};

      if (!empCode) {
        res.status(400).json({ error: 'An employee code is required' });
        return;
      }
      if (!joinedAt) {
        res.status(400).json({ error: 'A joining date is required' });
        return;
      }

      const result = await this.service.convertToEmployee(
        id,
        {
          empCode,
          grade,
          workerType,
          joinedAt,
          monthlySalary: monthlySalary === undefined || monthlySalary === null ? null : Number(monthlySalary),
          department: department ?? null,
          designation: designation ?? null,
          shiftId: shiftId === undefined || shiftId === null || shiftId === '' ? null : Number(shiftId),
        },
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      await this.service.remove(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
