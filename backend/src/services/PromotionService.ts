import { TalentRepository } from '../repositories/TalentRepository';
import { PerfAuditService } from './PerfAuditService';
import { NotificationService } from './NotificationService';
import { PerfActionContext, PromotionResponse } from '../types/performance';
import { NotificationCategory } from '../types/hrms';
import { toDateString, todayString } from '../utils/dateUtils';

const PERFORMANCE_CATEGORY = 'PERFORMANCE' as NotificationCategory;

/**
 * Promotion cases from draft to the grade actually changing on the employee
 * record. Effecting is one transaction: employees.grade, the career timeline
 * event and the case status move together or not at all.
 */
export class PromotionService {
  private repo = new TalentRepository();
  private audit = new PerfAuditService();
  private notifications = new NotificationService();

  async list(filters: { status?: string; employeeId?: number }): Promise<PromotionResponse[]> {
    const rows = await this.repo.findPromotions(filters);
    return rows.map((r) => this.toResponse(r));
  }

  async get(id: number): Promise<PromotionResponse> {
    const row = await this.repo.findPromotionById(id);
    if (!row) throw new Error('Promotion not found');
    return this.toResponse(row);
  }

  async create(body: any, ctx: PerfActionContext): Promise<PromotionResponse> {
    const employeeId = Math.trunc(Number(body?.employeeId));
    const toGrade = String(body?.toGrade ?? '').trim();
    if (!employeeId || !toGrade) throw new Error('employeeId and toGrade are required');

    const employee = await this.repo.findEmployeeById(employeeId);
    if (!employee) throw new Error('Employee not found');
    const fromGrade = employee.grade ? String(employee.grade) : null;
    if (fromGrade !== null && fromGrade === toGrade) {
      throw new Error(`toGrade must differ from the employee's current grade (${fromGrade})`);
    }

    let appraisalId: number | null = null;
    if (body.appraisalId) {
      appraisalId = Math.trunc(Number(body.appraisalId));
      const appraisal = await this.repo.findAppraisalById(appraisalId);
      if (!appraisal) throw new Error('Linked appraisal not found');
      if (Number(appraisal.employee_id) !== employeeId) {
        throw new Error('The linked appraisal belongs to a different employee');
      }
    }

    const id = await this.repo.insertPromotion({
      employeeId,
      appraisalId,
      fromGrade,
      toGrade,
      fromRoleId: body.fromRoleId ? Math.trunc(Number(body.fromRoleId)) : null,
      toRoleId: body.toRoleId ? Math.trunc(Number(body.toRoleId)) : null,
      fromPositionId: body.fromPositionId ? Math.trunc(Number(body.fromPositionId)) : null,
      toPositionId: body.toPositionId ? Math.trunc(Number(body.toPositionId)) : null,
      salaryImpactPct: body.salaryImpactPct !== undefined && body.salaryImpactPct !== null ? Number(body.salaryImpactPct) : null,
      salaryImpactAmount: body.salaryImpactAmount !== undefined && body.salaryImpactAmount !== null ? Number(body.salaryImpactAmount) : null,
      effectiveDate: body.effectiveDate ?? null,
      justification: body.justification ?? null,
      requestedBy: ctx.userId,
    });
    await this.audit.record('PROMOTION', id, 'CREATE', ctx, null, { employeeId, fromGrade, toGrade });
    return this.get(id);
  }

  async update(id: number, body: any, ctx: PerfActionContext): Promise<PromotionResponse> {
    const before = await this.repo.findPromotionById(id);
    if (!before) throw new Error('Promotion not found');
    if (before.status !== 'DRAFT') throw new Error('Only DRAFT promotions can be edited');

    const sets: string[] = [];
    const params: any[] = [];
    if (body.toGrade !== undefined) {
      const toGrade = String(body.toGrade).trim();
      if (!toGrade) throw new Error('toGrade cannot be empty');
      if (before.from_grade !== null && String(before.from_grade) === toGrade) {
        throw new Error(`toGrade must differ from the current grade (${before.from_grade})`);
      }
      sets.push('to_grade = ?'); params.push(toGrade);
    }
    if (body.toRoleId !== undefined) { sets.push('to_role_id = ?'); params.push(body.toRoleId ? Math.trunc(Number(body.toRoleId)) : null); }
    if (body.toPositionId !== undefined) { sets.push('to_position_id = ?'); params.push(body.toPositionId ? Math.trunc(Number(body.toPositionId)) : null); }
    if (body.salaryImpactPct !== undefined) { sets.push('salary_impact_pct = ?'); params.push(body.salaryImpactPct === null ? null : Number(body.salaryImpactPct)); }
    if (body.salaryImpactAmount !== undefined) { sets.push('salary_impact_amount = ?'); params.push(body.salaryImpactAmount === null ? null : Number(body.salaryImpactAmount)); }
    if (body.effectiveDate !== undefined) { sets.push('effective_date = ?'); params.push(body.effectiveDate ?? null); }
    if (body.justification !== undefined) { sets.push('justification = ?'); params.push(body.justification ?? null); }
    if (sets.length === 0) throw new Error('Nothing to update');

    await this.repo.updatePromotion(id, sets, params);
    await this.audit.record('PROMOTION', id, 'UPDATE', ctx, this.toResponse(before), body);
    return this.get(id);
  }

  async submit(id: number, ctx: PerfActionContext): Promise<PromotionResponse> {
    const before = await this.repo.findPromotionById(id);
    if (!before) throw new Error('Promotion not found');
    if (before.status !== 'DRAFT') throw new Error(`Promotion cannot be submitted from status ${before.status}`);
    await this.repo.updatePromotion(id, ["status = 'PENDING_APPROVAL'"], []);
    await this.audit.record('PROMOTION', id, 'SUBMIT', ctx, { status: before.status }, { status: 'PENDING_APPROVAL' });
    return this.get(id);
  }

  async approve(id: number, ctx: PerfActionContext): Promise<PromotionResponse> {
    const before = await this.repo.findPromotionById(id);
    if (!before) throw new Error('Promotion not found');
    if (before.status !== 'PENDING_APPROVAL') throw new Error(`Promotion cannot be approved from status ${before.status}`);
    await this.repo.updatePromotion(id, ["status = 'APPROVED'", 'approved_by = ?', 'approved_at = NOW()'], [ctx.userId]);
    await this.audit.record('PROMOTION', id, 'APPROVE', ctx, { status: before.status }, { status: 'APPROVED' });
    try {
      await this.notifications.notifyEmployee(Number(before.employee_id), {
        category: PERFORMANCE_CATEGORY,
        title: `Your promotion to grade ${before.to_grade} has been approved`,
        body: 'It will reflect on your profile once HR effects the change.',
        linkPage: 'performance',
        linkRefId: id,
        createdBy: ctx.userId,
      });
    } catch (err) {
      console.error('promotion-approved notification failed:', err);
    }
    return this.get(id);
  }

  async reject(id: number, reason: string, ctx: PerfActionContext): Promise<PromotionResponse> {
    const before = await this.repo.findPromotionById(id);
    if (!before) throw new Error('Promotion not found');
    if (before.status !== 'PENDING_APPROVAL') throw new Error(`Promotion cannot be rejected from status ${before.status}`);
    if (!reason || !String(reason).trim()) throw new Error('A reason is required to reject a promotion');
    // The schema has no rejection column; the reason is kept on the case
    // justification (marked) and in the audit trail.
    const marked = `${before.justification ? `${before.justification}\n` : ''}[REJECTED] ${String(reason).trim()}`;
    await this.repo.updatePromotion(id, ["status = 'REJECTED'", 'justification = ?', 'approved_by = ?', 'approved_at = NOW()'], [marked, ctx.userId]);
    await this.audit.record('PROMOTION', id, 'REJECT', ctx, { status: before.status }, { status: 'REJECTED', reason: String(reason).trim() });
    return this.get(id);
  }

  async effect(id: number, ctx: PerfActionContext): Promise<PromotionResponse> {
    const before = await this.repo.findPromotionById(id);
    if (!before) throw new Error('Promotion not found');
    if (before.status !== 'APPROVED') throw new Error(`Promotion cannot be effected from status ${before.status}`);
    if (!before.to_grade) throw new Error('Promotion has no target grade to apply');

    const eventDate = before.effective_date ? toDateString(before.effective_date) : todayString();
    await this.repo.effectPromotion(
      id,
      Number(before.employee_id),
      String(before.to_grade),
      {
        eventDate,
        title: `Promoted to grade ${before.to_grade}`,
        details: before.justification ?? null,
        fromValue: before.from_grade ?? null,
        toValue: String(before.to_grade),
      },
      ctx.userId,
    );
    await this.audit.record('PROMOTION', id, 'EFFECT', ctx, { status: before.status, grade: before.from_grade }, { status: 'EFFECTED', grade: before.to_grade });
    try {
      await this.notifications.notifyEmployee(Number(before.employee_id), {
        category: PERFORMANCE_CATEGORY,
        title: `Your promotion to grade ${before.to_grade} is now effective`,
        body: `Effective date: ${eventDate}`,
        linkPage: 'performance',
        linkRefId: id,
        createdBy: ctx.userId,
      });
    } catch (err) {
      console.error('promotion-effected notification failed:', err);
    }
    return this.get(id);
  }

  /** Stamps the promotion letter number (PRM/<year>/<id>); PDF renders on demand. */
  async markLetterIssued(id: number, ctx: PerfActionContext): Promise<PromotionResponse> {
    const row = await this.repo.findPromotionById(id);
    if (!row) throw new Error('Promotion not found');
    if (!['APPROVED', 'EFFECTED'].includes(row.status)) {
      throw new Error('A promotion letter can only be issued once the promotion is approved');
    }
    if (row.letter_number) return this.toResponse(row); // idempotent

    const year = row.approved_at ? new Date(row.approved_at).getFullYear() : new Date().getFullYear();
    const letterNumber = `PRM/${year}/${String(row.id).padStart(5, '0')}`;
    await this.repo.updatePromotion(id, ['letter_number = ?', 'letter_generated_at = NOW()'], [letterNumber]);
    await this.audit.record('PROMOTION', id, 'LETTER_ISSUED', ctx, null, { letterNumber });
    return this.get(id);
  }

  async findRowForLetter(id: number): Promise<any> {
    const row = await this.repo.findPromotionById(id);
    if (!row) throw new Error('Promotion not found');
    if (!row.letter_number) throw new Error('The letter has not been issued for this promotion yet');
    return row;
  }

  /**
   * Promotion eligibility for a cycle: final rating >= 4 in the cycle's
   * appraisal OR an explicit promotion recommendation. The criteria travel in
   * the payload so HR can see the basis for every name on the list.
   */
  async eligibility(cycleId: number): Promise<{
    cycleId: number;
    criteria: string[];
    employees: any[];
  }> {
    const cycle = await this.repo.findCycleById(cycleId);
    if (!cycle) throw new Error('Performance cycle not found');
    const rows = await this.repo.promotionEligibility(cycleId);
    const today = todayString();
    return {
      cycleId,
      criteria: [
        'final appraisal rating >= 4.00 in this cycle',
        'OR promotion recommended on the appraisal',
        'tenure computed from employees.joined_at',
      ],
      employees: rows.map((r) => {
        const joined = r.joined_at ? toDateString(r.joined_at) : null;
        const tenureYears = joined
          ? Math.round(((Date.parse(today) - Date.parse(joined)) / (365.25 * 86400000)) * 10) / 10
          : null;
        return {
          employeeId: Number(r.employee_id),
          empCode: String(r.emp_code),
          employeeName: String(r.full_name),
          grade: r.grade ?? null,
          joinedAt: joined,
          tenureYears,
          appraisalId: Number(r.appraisal_id),
          finalRating: r.final_rating === null ? null : Number(r.final_rating),
          ratingLabel: r.rating_label ?? null,
          promotionRecommended: !!r.promotion_recommended,
        };
      }),
    };
  }

  async report(): Promise<{ columns: { key: string; label: string }[]; rows: any[] }> {
    const rows = await this.repo.findPromotions({});
    return {
      columns: [
        { key: 'empCode', label: 'Emp Code' },
        { key: 'employeeName', label: 'Employee' },
        { key: 'fromGrade', label: 'From Grade' },
        { key: 'toGrade', label: 'To Grade' },
        { key: 'effectiveDate', label: 'Effective' },
        { key: 'salaryImpactPct', label: 'Salary Impact %' },
        { key: 'status', label: 'Status' },
        { key: 'letterNumber', label: 'Letter No' },
      ],
      rows: rows.map((r) => ({
        empCode: r.emp_code ?? '',
        employeeName: r.employee_name ?? '',
        fromGrade: r.from_grade ?? '',
        toGrade: r.to_grade ?? '',
        effectiveDate: r.effective_date ? toDateString(r.effective_date) : '',
        salaryImpactPct: r.salary_impact_pct ?? '',
        status: r.status,
        letterNumber: r.letter_number ?? '',
      })),
    };
  }

  private toResponse(r: any): PromotionResponse {
    const num = (v: any) => (v === null || v === undefined ? null : Number(v));
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      appraisalId: num(r.appraisal_id),
      fromGrade: r.from_grade ?? null,
      toGrade: r.to_grade ?? null,
      fromRoleId: num(r.from_role_id),
      fromRoleName: r.from_role_name ?? null,
      toRoleId: num(r.to_role_id),
      toRoleName: r.to_role_name ?? null,
      fromPositionId: num(r.from_position_id),
      toPositionId: num(r.to_position_id),
      salaryImpactPct: num(r.salary_impact_pct),
      salaryImpactAmount: num(r.salary_impact_amount),
      effectiveDate: r.effective_date ? toDateString(r.effective_date) : null,
      justification: r.justification ?? null,
      status: r.status,
      letterNumber: r.letter_number ?? null,
      requestedBy: num(r.requested_by),
      approvedBy: num(r.approved_by),
      approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
      effectedAt: r.effected_at ? new Date(r.effected_at).toISOString() : null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    };
  }
}
