import { Request, Response } from 'express';
import { EmployeeService } from '../services/EmployeeService';

export class EmployeeController {
  private service = new EmployeeService();

  findAll = async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, workStatus } = req.query as Record<string, string>;
      const employees = await this.service.findAll(
        search,
        workStatus,
      );
      res.json(employees);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  findById = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const employee = await this.service.findById(id);
      if (!employee) {
        res.status(404).json({ error: 'Employee not found' });
        return;
      }
      res.json(employee);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getLots = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const lots = await this.service.getEmployeeLots(id);
      res.json(lots);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
