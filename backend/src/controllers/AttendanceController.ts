import { Request, Response } from 'express';
import { AttendanceService, BulkMarkEntry, PunchKind } from '../services/AttendanceService';

/** Rule violations raised by the service; everything else is a 500. */
const CLIENT_ERROR = /^(Invalid|Cannot|Missing|Unknown|At least one|Overtime|Break|Grace|Week off|Shift |Holiday |Punch |Out time|You have already|CSV )/;

export class AttendanceController {
  private service = new AttendanceService();

  // ---------------------------------------------------------------------
  // Shifts
  // ---------------------------------------------------------------------
  getShifts = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.getShifts());
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createShift = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, startTime, endTime, breakMinutes, graceMinutes, weekOffDay, isDefault } = req.body ?? {};
      if (!name || !startTime || !endTime) {
        res.status(400).json({ error: 'name, startTime and endTime are required' });
        return;
      }
      const shift = await this.service.createShift(
        { name, startTime, endTime, breakMinutes, graceMinutes, weekOffDay, isDefault },
        req.user!.userId,
      );
      res.status(201).json(shift);
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateShift = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'A numeric shift id is required' });
        return;
      }
      const { name, startTime, endTime, breakMinutes, graceMinutes, weekOffDay, isDefault } = req.body ?? {};
      const shift = await this.service.updateShift(
        id,
        { name, startTime, endTime, breakMinutes, graceMinutes, weekOffDay, isDefault },
        req.user!.userId,
      );
      res.json(shift);
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  deleteShift = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'A numeric shift id is required' });
        return;
      }
      res.json(await this.service.deleteShift(id, req.user!.userId));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // ---------------------------------------------------------------------
  // Holidays
  // ---------------------------------------------------------------------
  getHolidays = async (req: Request, res: Response): Promise<void> => {
    try {
      const raw = req.query.year as string | undefined;
      let year: number | undefined;
      if (raw !== undefined && raw !== '') {
        year = parseInt(raw, 10);
        if (!Number.isFinite(year)) {
          res.status(400).json({ error: 'year must be a 4-digit number' });
          return;
        }
      }
      res.json(await this.service.getHolidays(year));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createHoliday = async (req: Request, res: Response): Promise<void> => {
    try {
      const { date, name, isOptional } = req.body ?? {};
      if (!date || !name) {
        res.status(400).json({ error: 'date and name are required' });
        return;
      }
      const holiday = await this.service.createHoliday({ date, name, isOptional }, req.user!.userId);
      res.status(201).json(holiday);
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  deleteHoliday = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'A numeric holiday id is required' });
        return;
      }
      res.json(await this.service.deleteHoliday(id, req.user!.userId));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // ---------------------------------------------------------------------
  // Attendance
  // ---------------------------------------------------------------------
  getDaily = async (req: Request, res: Response): Promise<void> => {
    try {
      const date = req.query.date as string;
      if (!date) {
        res.status(400).json({ error: 'date query parameter is required (YYYY-MM-DD)' });
        return;
      }
      res.json(await this.service.getDaily(date));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  bulkMark = async (req: Request, res: Response): Promise<void> => {
    try {
      const { date, entries } = req.body ?? {};
      if (!date) {
        res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
        return;
      }
      if (!Array.isArray(entries) || entries.length === 0) {
        res.status(400).json({ error: 'entries must be a non-empty array' });
        return;
      }
      const result = await this.service.bulkMark(date, entries as BulkMarkEntry[], req.user!.userId);
      res.json(result);
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  getRegister = async (req: Request, res: Response): Promise<void> => {
    try {
      const month = req.query.month as string;
      if (!month) {
        res.status(400).json({ error: 'month query parameter is required (YYYY-MM)' });
        return;
      }
      const rawEmployee = req.query.employeeId as string | undefined;
      let employeeId: number | undefined;
      if (rawEmployee !== undefined && rawEmployee !== '') {
        employeeId = parseInt(rawEmployee, 10);
        if (!Number.isFinite(employeeId)) {
          res.status(400).json({ error: 'employeeId must be a number' });
          return;
        }
      }
      res.json(await this.service.getRegister(month, employeeId));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  importPunches = async (req: Request, res: Response): Promise<void> => {
    try {
      const { csvText } = req.body ?? {};
      if (!csvText || typeof csvText !== 'string' || !csvText.trim()) {
        res.status(400).json({ error: 'csvText is required' });
        return;
      }
      res.json(await this.service.importPunchCsv(csvText, req.user!.userId));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  getEmployeeAttendance = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'A numeric employee id is required' });
        return;
      }
      const from = req.query.from as string;
      const to = req.query.to as string;
      if (!from || !to) {
        res.status(400).json({ error: 'from and to query parameters are required (YYYY-MM-DD)' });
        return;
      }
      res.json(await this.service.getForEmployee(id, from, to));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // ---------------------------------------------------------------------
  // Self service
  // ---------------------------------------------------------------------
  getMyToday = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: 'This account is not linked to an employee record' });
        return;
      }
      res.json(await this.service.getSelfToday(employeeId));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  punch = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: 'This account is not linked to an employee record' });
        return;
      }
      const kind = (req.body ?? {}).kind as PunchKind;
      if (kind !== 'IN' && kind !== 'OUT') {
        res.status(400).json({ error: "kind is required and must be 'IN' or 'OUT'" });
        return;
      }
      res.json(await this.service.punch(employeeId, kind, req.user!.userId));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  /** Maps service rule violations to 4xx and leaves genuine faults as 500. */
  private fail(res: Response, err: any): void {
    const message = err?.message ?? 'Unexpected error';
    if (/not found$/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    if (CLIENT_ERROR.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(500).json({ error: message });
  }
}
