import { TalentRepository } from '../repositories/TalentRepository';
import { PerfAuditService } from './PerfAuditService';
import { AppraisalResponse, PerfActionContext } from '../types/performance';

const SALARY_NOTE =
  'salaryIncreasePct is a recommendation only -- the payroll revision itself happens in the payroll module, nothing is auto-applied.';

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Rating band labels applied at finalization when no explicit label is given. */
export function ratingLabelFor(rating: number): string {
  if (rating >= 4.5) return 'Outstanding';
  if (rating >= 3.5) return 'Exceeds Expectations';
  if (rating >= 2.5) return 'Meets Expectations';
  if (rating >= 1.5) return 'Needs Improvement';
  return 'Unsatisfactory';
}

/**
 * Appraisals: generation from live goal/KRA/KPI/competency data, the review
 * workflow to a final rating, and the letter lifecycle.
 *
 * Generation never fabricates: a component with no underlying data stays NULL
 * and the summary reports exactly which components fed each employee's total.
 */
export class AppraisalService {
  private repo = new TalentRepository();
  private audit = new PerfAuditService();

  /**
   * One appraisal per WORKING employee for the cycle (unique on
   * cycle+employee; existing rows are skipped and counted).
   *
   * Score model, all on a 0-5 scale:
   * - goalScore: weightage-weighted avg progressPct of the employee's
   *   ACTIVE/COMPLETED individual goals, divided by 20.
   * - kraScore: weightage-weighted avg of final (fallback manager, then self) scores.
   * - kpiScore: weightage-weighted avg of (score / weightage) * 5, clamped 0-5.
   * - competencyScore: plain avg of the cycle's competency ratings.
   * totalScore = mean of the non-null components x 20 (0-100).
   */
  async generate(cycleId: number, ctx: PerfActionContext): Promise<{
    cycleId: number;
    created: number;
    skippedExisting: number;
    employees: { employeeId: number; empCode: string; componentsUsed: string[]; totalScore: number | null }[];
  }> {
    const cycle = await this.repo.findCycleById(cycleId);
    if (!cycle) throw new Error('Performance cycle not found');

    const [employees, existingIds, goalMap, kraMap, kpiRows, compMap, ratingMap] = await Promise.all([
      this.repo.findWorkingEmployees(),
      this.repo.findAppraisalEmployeeIds(cycleId),
      this.repo.goalProgressByEmployee(cycleId),
      this.repo.kraScoreByEmployee(cycleId),
      this.repo.scoredKpiAssignments(cycleId),
      this.repo.competencyAvgByEmployee(cycleId),
      this.repo.reviewRatingsByEmployee(cycleId),
    ]);

    // KPI: weighted average of the per-assignment achievement ratio on a 0-5 scale.
    const kpiMap = new Map<number, number>();
    const kpiAcc = new Map<number, { weighted: number; weight: number }>();
    for (const row of kpiRows) {
      const empId = Number(row.employee_id);
      const weight = Number(row.weightage_pct);
      const ratio = Number(row.score) / weight; // score is weightage-scaled points
      const scaled = Math.min(Math.max(ratio * 5, 0), 5);
      const acc = kpiAcc.get(empId) ?? { weighted: 0, weight: 0 };
      acc.weighted += scaled * weight;
      acc.weight += weight;
      kpiAcc.set(empId, acc);
    }
    for (const [empId, acc] of kpiAcc) {
      if (acc.weight > 0) kpiMap.set(empId, acc.weighted / acc.weight);
    }

    let created = 0;
    let skippedExisting = 0;
    const summary: { employeeId: number; empCode: string; componentsUsed: string[]; totalScore: number | null }[] = [];

    for (const emp of employees) {
      const empId = Number(emp.id);
      if (existingIds.has(empId)) {
        skippedExisting++;
        continue;
      }

      const goalProgress = goalMap.get(empId);
      const goalScore = goalProgress === undefined ? null : round2(goalProgress / 20);
      const kraScore = kraMap.has(empId) ? round2(kraMap.get(empId) as number) : null;
      const kpiScore = kpiMap.has(empId) ? round2(kpiMap.get(empId) as number) : null;
      const competencyScore = compMap.has(empId) ? round2(compMap.get(empId) as number) : null;

      const components: { name: string; value: number | null }[] = [
        { name: 'goals', value: goalScore },
        { name: 'kra', value: kraScore },
        { name: 'kpi', value: kpiScore },
        { name: 'competency', value: competencyScore },
      ];
      const used = components.filter((c) => c.value !== null);
      const totalScore = used.length > 0
        ? round2((used.reduce((sum, c) => sum + (c.value as number), 0) / used.length) * 20)
        : null;

      const ratings = ratingMap.get(empId) ?? { self: null, manager: null };
      await this.repo.insertAppraisal({
        cycleId,
        employeeId: empId,
        goalScore,
        kraScore,
        kpiScore,
        competencyScore,
        totalScore,
        selfRating: ratings.self,
        managerRating: ratings.manager,
      });
      created++;
      summary.push({
        employeeId: empId,
        empCode: String(emp.emp_code),
        componentsUsed: used.map((c) => c.name),
        totalScore,
      });
    }

    await this.audit.record('APPRAISAL', cycleId, 'GENERATE', ctx, null, { cycleId, created, skippedExisting });
    return { cycleId, created, skippedExisting, employees: summary };
  }

  async list(filters: { cycleId?: number; status?: string; employeeId?: number }): Promise<AppraisalResponse[]> {
    const rows = await this.repo.findAppraisals(filters);
    return rows.map((r) => this.toResponse(r));
  }

  async get(id: number): Promise<AppraisalResponse> {
    const row = await this.repo.findAppraisalById(id);
    if (!row) throw new Error('Appraisal not found');
    return this.toResponse(row);
  }

  async update(id: number, body: any, ctx: PerfActionContext): Promise<AppraisalResponse> {
    const before = await this.repo.findAppraisalById(id);
    if (!before) throw new Error('Appraisal not found');
    if (['FINALIZED', 'LETTER_ISSUED', 'ACKNOWLEDGED'].includes(before.status)) {
      throw new Error(`Appraisal cannot be edited once ${before.status}`);
    }

    const sets: string[] = [];
    const params: any[] = [];
    if (body.managerRating !== undefined) {
      const rating = body.managerRating === null ? null : Number(body.managerRating);
      if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 5)) {
        throw new Error('managerRating must be between 0 and 5');
      }
      sets.push('manager_rating = ?'); params.push(rating);
    }
    if (body.remarks !== undefined) { sets.push('remarks = ?'); params.push(body.remarks ?? null); }
    if (body.salaryIncreasePct !== undefined) {
      const pct = body.salaryIncreasePct === null ? null : Number(body.salaryIncreasePct);
      if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
        throw new Error('salaryIncreasePct must be between 0 and 100');
      }
      sets.push('salary_increase_pct = ?'); params.push(pct);
    }
    if (body.promotionRecommended !== undefined) {
      sets.push('promotion_recommended = ?'); params.push(!!body.promotionRecommended);
    }
    if (sets.length === 0) throw new Error('Nothing to update');
    if (before.status === 'PENDING') sets.push("status = 'IN_REVIEW'");

    await this.repo.updateAppraisal(id, sets, params);
    await this.audit.record('APPRAISAL', id, 'UPDATE', ctx, this.toResponse(before), body);
    return this.get(id);
  }

  async finalize(id: number, body: any, ctx: PerfActionContext): Promise<{ appraisal: AppraisalResponse; note: string }> {
    const before = await this.repo.findAppraisalById(id);
    if (!before) throw new Error('Appraisal not found');
    if (['FINALIZED', 'LETTER_ISSUED', 'ACKNOWLEDGED'].includes(before.status)) {
      throw new Error(`Appraisal is already ${before.status}`);
    }

    let finalRating: number | null = body?.finalRating !== undefined && body.finalRating !== null
      ? Number(body.finalRating)
      : null;
    if (finalRating === null) {
      finalRating = before.calibrated_rating !== null
        ? Number(before.calibrated_rating)
        : before.manager_rating !== null ? Number(before.manager_rating) : null;
    }
    if (finalRating === null) {
      throw new Error('No rating available to finalize: provide finalRating, or set a manager or calibrated rating first');
    }
    if (!Number.isFinite(finalRating) || finalRating < 0 || finalRating > 5) {
      throw new Error('finalRating must be between 0 and 5');
    }
    const label = body?.ratingLabel ? String(body.ratingLabel) : ratingLabelFor(finalRating);

    await this.repo.updateAppraisal(
      id,
      ['final_rating = ?', 'rating_label = ?', "status = 'FINALIZED'", 'finalized_by = ?', 'finalized_at = NOW()'],
      [finalRating, label, ctx.userId],
    );
    await this.audit.record('APPRAISAL', id, 'FINALIZE', ctx, this.toResponse(before), { finalRating, ratingLabel: label });
    return { appraisal: await this.get(id), note: SALARY_NOTE };
  }

  /** Stamps the letter number; the PDF itself is rendered on demand. */
  async markLetterIssued(id: number, ctx: PerfActionContext): Promise<AppraisalResponse> {
    const row = await this.repo.findAppraisalById(id);
    if (!row) throw new Error('Appraisal not found');
    if (!['FINALIZED', 'LETTER_ISSUED', 'ACKNOWLEDGED'].includes(row.status)) {
      throw new Error('An appraisal letter can only be issued after finalization');
    }
    if (row.letter_number) return this.toResponse(row); // idempotent

    const fy = row.financial_year ?? String(new Date().getFullYear());
    const letterNumber = `APL/${fy}/${String(row.id).padStart(5, '0')}`;
    await this.repo.updateAppraisal(
      id,
      ['letter_number = ?', 'letter_generated_at = NOW()', "status = 'LETTER_ISSUED'"],
      [letterNumber],
    );
    await this.audit.record('APPRAISAL', id, 'LETTER_ISSUED', ctx, { status: row.status }, { letterNumber });
    return this.get(id);
  }

  async acknowledge(id: number, caller: { role: string; employeeId: number | null }, ctx: PerfActionContext): Promise<AppraisalResponse> {
    const row = await this.repo.findAppraisalById(id);
    if (!row) throw new Error('Appraisal not found');
    const isSubject = caller.employeeId !== null && Number(row.employee_id) === caller.employeeId;
    const isStaff = ['admin', 'manager', 'operator', 'accountant', 'hr'].includes(caller.role);
    if (!isSubject && !isStaff) throw new Error('Only the appraised employee or staff can acknowledge an appraisal');
    if (!['FINALIZED', 'LETTER_ISSUED'].includes(row.status)) {
      throw new Error(`Appraisal cannot be acknowledged from status ${row.status}`);
    }
    await this.repo.updateAppraisal(id, ["status = 'ACKNOWLEDGED'"], []);
    await this.audit.record('APPRAISAL', id, 'ACKNOWLEDGE', ctx, { status: row.status }, { status: 'ACKNOWLEDGED' });
    return this.get(id);
  }

  /** ESS: only finalized-or-later appraisals are visible to the employee. */
  async myAppraisals(employeeId: number): Promise<(AppraisalResponse & { letterAvailable: boolean })[]> {
    const rows = await this.repo.findAppraisals({ employeeId });
    return rows
      .filter((r) => ['FINALIZED', 'LETTER_ISSUED', 'ACKNOWLEDGED'].includes(r.status))
      .map((r) => ({ ...this.toResponse(r), letterAvailable: ['LETTER_ISSUED', 'ACKNOWLEDGED'].includes(r.status) }));
  }

  /** Raw row (with joins) for the letter renderer. */
  async findRowForLetter(id: number): Promise<any> {
    const row = await this.repo.findAppraisalById(id);
    if (!row) throw new Error('Appraisal not found');
    if (!['LETTER_ISSUED', 'ACKNOWLEDGED'].includes(row.status)) {
      throw new Error('The letter has not been issued for this appraisal yet');
    }
    return row;
  }

  async report(cycleId?: number): Promise<{ columns: { key: string; label: string }[]; rows: any[] }> {
    const rows = await this.repo.findAppraisals(cycleId ? { cycleId } : {});
    return {
      columns: [
        { key: 'empCode', label: 'Emp Code' },
        { key: 'employeeName', label: 'Employee' },
        { key: 'cycleName', label: 'Cycle' },
        { key: 'goalScore', label: 'Goal Score' },
        { key: 'kraScore', label: 'KRA Score' },
        { key: 'kpiScore', label: 'KPI Score' },
        { key: 'competencyScore', label: 'Competency Score' },
        { key: 'totalScore', label: 'Total (0-100)' },
        { key: 'finalRating', label: 'Final Rating' },
        { key: 'ratingLabel', label: 'Band' },
        { key: 'salaryIncreasePct', label: 'Increase % (rec.)' },
        { key: 'status', label: 'Status' },
      ],
      rows: rows.map((raw) => {
        const r = this.toResponse(raw);
        return {
          empCode: r.empCode ?? '',
          employeeName: r.employeeName ?? '',
          cycleName: r.cycleName ?? '',
          goalScore: r.goalScore ?? '',
          kraScore: r.kraScore ?? '',
          kpiScore: r.kpiScore ?? '',
          competencyScore: r.competencyScore ?? '',
          totalScore: r.totalScore ?? '',
          finalRating: r.finalRating ?? '',
          ratingLabel: r.ratingLabel ?? '',
          salaryIncreasePct: r.salaryIncreasePct ?? '',
          status: r.status,
        };
      }),
    };
  }

  private toResponse(r: any): AppraisalResponse {
    const num = (v: any) => (v === null || v === undefined ? null : Number(v));
    return {
      id: Number(r.id),
      cycleId: Number(r.cycle_id),
      cycleName: r.cycle_name ?? null,
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      empCode: r.emp_code ?? null,
      goalScore: num(r.goal_score),
      kraScore: num(r.kra_score),
      kpiScore: num(r.kpi_score),
      competencyScore: num(r.competency_score),
      totalScore: num(r.total_score),
      selfRating: num(r.self_rating),
      managerRating: num(r.manager_rating),
      calibratedRating: num(r.calibrated_rating),
      finalRating: num(r.final_rating),
      ratingLabel: r.rating_label ?? null,
      salaryIncreasePct: num(r.salary_increase_pct),
      promotionRecommended: !!r.promotion_recommended,
      status: r.status,
      remarks: r.remarks ?? null,
      letterNumber: r.letter_number ?? null,
      letterGeneratedAt: r.letter_generated_at ? new Date(r.letter_generated_at).toISOString() : null,
      finalizedAt: r.finalized_at ? new Date(r.finalized_at).toISOString() : null,
    };
  }
}
