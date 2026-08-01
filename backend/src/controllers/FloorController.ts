import { Request, Response } from 'express';
import { FloorService } from '../services/FloorService';

export class FloorController {
  private service = new FloorService();

  getLots = async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, status, lab, employeeId, page, limit, sort, order } = req.query as Record<string, string>;
      const result = await this.service.getLots({
        search,
        status: status as any,
        lab: lab as any,
        employeeId: employeeId ? parseInt(employeeId) : undefined,
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 100,
        sort: sort as string,
        order: order as 'asc' | 'desc',
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getExceptions = async (_req: Request, res: Response): Promise<void> => {
    try {
      const exceptions = await this.service.getExceptions();
      res.json(exceptions);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getWorkers = async (_req: Request, res: Response): Promise<void> => {
    try {
      const workers = await this.service.getWorkingEmployees();
      res.json(workers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getLabourHeads = async (_req: Request, res: Response): Promise<void> => {
    try {
      const heads = await this.service.getLabourHeads();
      res.json(heads);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getShapes = async (_req: Request, res: Response): Promise<void> => {
    try {
      const shapes = await this.service.getShapes();
      res.json(shapes);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getMaxLotId = async (_req: Request, res: Response): Promise<void> => {
    try {
      const maxId = await this.service.getMaxLotId();
      res.json({ maxLotId: maxId + 1 });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  issueLot = async (req: Request, res: Response): Promise<void> => {
    try {
      const { workerId, lotId, lotName, shape, shapeCategory, qty, issueWt, estimateWt, issueDate, lab, labourHeadId } = req.body;
      if (!workerId || !lotId || !lotName || !shape || !qty || !issueWt || !estimateWt || !labourHeadId) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }
      if (issueDate && !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
        res.status(400).json({ error: 'Issue date must be in YYYY-MM-DD format' });
        return;
      }
      const lot = await this.service.issueLot({
        workerId, lotId, lotName, shape, shapeCategory,
        qty: parseInt(qty), issueWt: parseFloat(issueWt),
        estimateWt: parseFloat(estimateWt), issueDate, lab, labourHeadId,
        createdBy: req.user!.userId,
      });
      res.status(201).json(lot);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  receiveLot = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const { polishedWt, color, clarity, cut, grader, receivedDate } = req.body;
      if (!polishedWt || !receivedDate) {
        res.status(400).json({ error: 'Polished weight and received date are required' });
        return;
      }
      const lot = await this.service.receiveLot(id, {
        polishedWt: parseFloat(polishedWt), color, clarity, cut, grader,
        receivedDate, updatedBy: req.user!.userId,
      });
      res.json(lot);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  verifyLot = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const lot = await this.service.verifyLot(id, req.user!.userId);
      res.json(lot);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
