import { Request, Response } from 'express';
import { AppraisalService } from '../services/AppraisalService';
import { PromotionService } from '../services/PromotionService';
import { TalentService } from '../services/TalentService';
import { ReviewService } from '../services/ReviewService';
import { PipService } from '../services/PipService';
import { PerfLetterService } from '../services/PerfLetterService';
import { PerfActionContext } from '../types/performance';

/** Errors that are the caller's fault rather than the server's. */
function statusFor(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/already exists|already a (member|candidate)|already (been|completed|removed)|already [A-Z_]+|cannot be|can only|no longer|only (DRAFT|APPROVED|the)|is not allowed/i.test(message)) return 409;
  if (/required|must |invalid|needs |nothing to update|not linked|no rating available|pass \?/i.test(message)) return 400;
  return 500;
}

const REPORT_TYPES = [
  'review-status', 'feedback-360', 'appraisal', 'promotion',
  'talent-review', 'succession', 'calibration', 'pip',
] as const;

function toCsv(columns: { key: string; label: string }[], rows: any[]): string {
  const escape = (value: any): string => {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => escape(c.label)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c.key])).join(','));
  }
  return lines.join('\r\n');
}

/**
 * Appraisals (with letters), promotions, the 9-box, talent pools, succession,
 * calibration, and the performance report pack.
 */
export class TalentController {
  private appraisals = new AppraisalService();
  private promotions = new PromotionService();
  private talent = new TalentService();
  private reviews = new ReviewService();
  private pips = new PipService();
  private letters = new PerfLetterService();

  private ctx(req: Request): PerfActionContext {
    return {
      userId: req.user!.userId,
      userRole: req.user!.role,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };
  }

  private fail(res: Response, err: any): void {
    res.status(statusFor(err.message ?? '')).json({ error: err.message });
  }

  // =========================================================================
  // Appraisals
  // =========================================================================

  generateAppraisals = async (req: Request, res: Response): Promise<void> => {
    try {
      const cycleId = Number(req.body?.cycleId);
      if (!cycleId) {
        res.status(400).json({ error: 'cycleId is required' });
        return;
      }
      res.json(await this.appraisals.generate(cycleId, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  listAppraisals = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.appraisals.list({
        cycleId: req.query.cycleId ? Number(req.query.cycleId) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
      }));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  getAppraisal = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.appraisals.get(Number(req.params.id)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateAppraisal = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.appraisals.update(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  finalizeAppraisal = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.appraisals.finalize(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  issueAppraisalLetter = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.appraisals.markLetterIssued(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  downloadAppraisalLetter = async (req: Request, res: Response): Promise<void> => {
    try {
      const row = await this.appraisals.findRowForLetter(Number(req.params.id));
      const pdf = await this.letters.appraisalLetter(row);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="appraisal-letter-${row.emp_code}.pdf"`);
      res.send(pdf);
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  acknowledgeAppraisal = async (req: Request, res: Response): Promise<void> => {
    try {
      const caller = { role: req.user!.role, employeeId: req.user!.employeeId ?? null };
      res.json(await this.appraisals.acknowledge(Number(req.params.id), caller, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  myAppraisals = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: 'This account is not linked to an employee record' });
        return;
      }
      res.json(await this.appraisals.myAppraisals(employeeId));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  myAppraisalLetter = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(403).json({ error: 'This account is not linked to an employee record' });
        return;
      }
      const row = await this.appraisals.findRowForLetter(Number(req.params.id));
      if (Number(row.employee_id) !== employeeId) {
        res.status(403).json({ error: 'You can only download your own appraisal letter' });
        return;
      }
      const pdf = await this.letters.appraisalLetter(row);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="appraisal-letter-${row.emp_code}.pdf"`);
      res.send(pdf);
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // Promotions
  // =========================================================================

  listPromotions = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.promotions.list({
        status: req.query.status ? String(req.query.status) : undefined,
        employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
      }));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  promotionEligibility = async (req: Request, res: Response): Promise<void> => {
    try {
      const cycleId = Number(req.query.cycleId);
      if (!cycleId) {
        res.status(400).json({ error: 'cycleId is required' });
        return;
      }
      res.json(await this.promotions.eligibility(cycleId));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createPromotion = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.promotions.create(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updatePromotion = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.promotions.update(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  submitPromotion = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.promotions.submit(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  approvePromotion = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.promotions.approve(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  rejectPromotion = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.promotions.reject(Number(req.params.id), req.body?.reason ?? '', this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  effectPromotion = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.promotions.effect(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  issuePromotionLetter = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.promotions.markLetterIssued(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  downloadPromotionLetter = async (req: Request, res: Response): Promise<void> => {
    try {
      const row = await this.promotions.findRowForLetter(Number(req.params.id));
      const pdf = await this.letters.promotionLetter(row);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="promotion-letter-${row.emp_code}.pdf"`);
      res.send(pdf);
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // 9-box, pools, succession, calibration
  // =========================================================================

  talentMatrix = async (req: Request, res: Response): Promise<void> => {
    try {
      const cycleId = Number(req.query.cycleId);
      if (!cycleId) {
        res.status(400).json({ error: 'cycleId is required' });
        return;
      }
      res.json(await this.talent.matrix(cycleId));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  upsertAssessment = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.talent.assess(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  listPools = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.talent.listPools());
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  getPool = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.talent.getPool(Number(req.params.id)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createPool = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.talent.createPool(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updatePool = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.talent.updatePool(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  addPoolMember = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.talent.addPoolMember(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  removePoolMember = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.talent.removePoolMember(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  successionDashboard = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.talent.successionDashboard());
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  listSuccession = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.talent.listSuccessionPlans(req.query.status ? String(req.query.status) : undefined));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createSuccession = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.talent.createSuccessionPlan(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateSuccession = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.talent.updateSuccessionPlan(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  addSuccessionCandidate = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.talent.addSuccessionCandidate(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateSuccessionCandidate = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.talent.updateSuccessionCandidate(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  removeSuccessionCandidate = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.talent.removeSuccessionCandidate(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  listCalibrationSessions = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.talent.listCalibrationSessions(req.query.cycleId ? Number(req.query.cycleId) : undefined));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  createCalibrationSession = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.talent.createCalibrationSession(req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  updateCalibrationSession = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.talent.updateCalibrationSession(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  adjustCalibration = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.talent.adjust(Number(req.params.id), req.body ?? {}, this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  completeCalibrationSession = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.talent.completeCalibrationSession(Number(req.params.id), this.ctx(req)));
    } catch (err: any) {
      this.fail(res, err);
    }
  };

  // =========================================================================
  // Reports
  // =========================================================================

  report = async (req: Request, res: Response): Promise<void> => {
    await this.runReport(req, res, false);
  };

  reportExport = async (req: Request, res: Response): Promise<void> => {
    await this.runReport(req, res, true);
  };

  private runReport = async (req: Request, res: Response, asCsv: boolean): Promise<void> => {
    try {
      const type = String(req.params.type ?? '');
      if (!REPORT_TYPES.includes(type as any)) {
        res.status(400).json({ error: `Unknown report type; expected one of ${REPORT_TYPES.join(', ')}` });
        return;
      }
      // PIPs are confidential; the report inherits the module's role gate.
      if (type === 'pip' && !['admin', 'hr', 'manager'].includes(req.user!.role)) {
        res.status(403).json({ error: 'The PIP report is restricted to admin, hr and manager roles' });
        return;
      }

      const cycleId = req.query.cycleId ? Number(req.query.cycleId) : undefined;
      let result: { columns: { key: string; label: string }[]; rows: any[] };
      switch (type) {
        case 'review-status': result = await this.reviews.reviewStatusReport(cycleId); break;
        case 'feedback-360': result = await this.reviews.feedback360Report(cycleId); break;
        case 'appraisal': result = await this.appraisals.report(cycleId); break;
        case 'promotion': result = await this.promotions.report(); break;
        case 'talent-review': result = await this.talent.talentReviewReport(cycleId); break;
        case 'succession': result = await this.talent.successionReport(); break;
        case 'calibration': result = await this.talent.calibrationReport(cycleId); break;
        default: result = await this.pips.report(); break;
      }

      if (asCsv) {
        const date = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${type}-report-${date}.csv"`);
        res.send(toCsv(result.columns, result.rows));
        return;
      }
      res.json({ reportType: type, ...result });
    } catch (err: any) {
      this.fail(res, err);
    }
  };
}
