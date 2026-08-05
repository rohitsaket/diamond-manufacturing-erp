import { ReviewRepository } from '../repositories/ReviewRepository';
import { PerfAuditService } from './PerfAuditService';
import { CompetencyRatingResponse, CompetencyResponse, PerfActionContext } from '../types/performance';

const CATEGORIES = ['TECHNICAL', 'FUNCTIONAL', 'LEADERSHIP', 'BEHAVIORAL'];
const RATED_BY_TYPES = ['SELF', 'MANAGER', 'PEER', 'OTHER'];

function parseJson(value: unknown): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

/**
 * Competency framework: master data, standalone assessments and the skill
 * matrix that blends competency ratings with the existing employee_skills
 * catalogue.
 */
export class CompetencyService {
  private repo = new ReviewRepository();
  private audit = new PerfAuditService();

  async list(): Promise<CompetencyResponse[]> {
    const rows = await this.repo.findCompetencies();
    return rows.map((r) => this.toResponse(r));
  }

  async create(body: any, ctx: PerfActionContext): Promise<CompetencyResponse> {
    if (!body?.code || !body?.name) throw new Error('code and name are required');
    const category = body.category ?? 'TECHNICAL';
    if (!CATEGORIES.includes(category)) throw new Error(`category must be one of ${CATEGORIES.join(', ')}`);

    const existing = await this.repo.findCompetencyByCode(String(body.code));
    if (existing) throw new Error(`A competency with code ${body.code} already exists`);

    const id = await this.repo.insertCompetency({
      code: String(body.code),
      name: String(body.name),
      category,
      description: body.description ?? null,
      levelsJson: body.levels ? JSON.stringify(body.levels) : null,
      isActive: body.isActive === undefined ? true : !!body.isActive,
      createdBy: ctx.userId,
    });
    await this.audit.record('COMPETENCY', id, 'CREATE', ctx, null, body);
    return this.toResponse(await this.repo.findCompetencyById(id));
  }

  async update(id: number, body: any, ctx: PerfActionContext): Promise<CompetencyResponse> {
    const before = await this.repo.findCompetencyById(id);
    if (!before) throw new Error('Competency not found');

    const sets: string[] = [];
    const params: any[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); params.push(String(body.name)); }
    if (body.category !== undefined) {
      if (!CATEGORIES.includes(body.category)) throw new Error(`category must be one of ${CATEGORIES.join(', ')}`);
      sets.push('category = ?'); params.push(body.category);
    }
    if (body.description !== undefined) { sets.push('description = ?'); params.push(body.description ?? null); }
    if (body.levels !== undefined) { sets.push('levels_json = ?'); params.push(body.levels ? JSON.stringify(body.levels) : null); }
    if (body.isActive !== undefined) { sets.push('is_active = ?'); params.push(!!body.isActive); }
    if (sets.length === 0) throw new Error('Nothing to update');

    await this.repo.updateCompetency(id, sets, params);
    await this.audit.record('COMPETENCY', id, 'UPDATE', ctx, this.toResponse(before), body);
    return this.toResponse(await this.repo.findCompetencyById(id));
  }

  async listRatings(filters: { employeeId?: number; cycleId?: number }): Promise<CompetencyRatingResponse[]> {
    const rows = await this.repo.findCompetencyRatings(filters);
    return rows.map((r) => this.toRatingResponse(r));
  }

  /** Standalone assessment outside any review form. */
  async createRating(body: any, ctx: PerfActionContext): Promise<CompetencyRatingResponse> {
    const employeeId = Math.trunc(Number(body?.employeeId));
    const competencyId = Math.trunc(Number(body?.competencyId));
    const rating = Number(body?.rating);
    if (!employeeId || !competencyId) throw new Error('employeeId and competencyId are required');
    if (!Number.isFinite(rating) || rating < 0 || rating > 10) throw new Error('rating must be a number between 0 and 10');

    const employee = await this.repo.findEmployeeById(employeeId);
    if (!employee) throw new Error('Employee not found');
    const competency = await this.repo.findCompetencyById(competencyId);
    if (!competency) throw new Error('Competency not found');

    const ratedByType = body.ratedByType ?? 'MANAGER';
    if (!RATED_BY_TYPES.includes(ratedByType)) throw new Error(`ratedByType must be one of ${RATED_BY_TYPES.join(', ')}`);

    let cycleId: number | null = null;
    if (body.cycleId) {
      cycleId = Math.trunc(Number(body.cycleId));
      const cycle = await this.repo.findCycleById(cycleId);
      if (!cycle) throw new Error('Performance cycle not found');
    }

    const id = await this.repo.insertCompetencyRating({
      employeeId,
      competencyId,
      cycleId,
      reviewId: null,
      rating,
      ratedByType,
      ratedBy: ctx.userId,
      note: body.note ?? null,
    });
    await this.audit.record('COMPETENCY_RATING', id, 'CREATE', ctx, null, { employeeId, competencyId, cycleId, rating, ratedByType });

    const rows = await this.repo.findCompetencyRatings({ employeeId });
    const created = rows.find((r) => Number(r.id) === id);
    return this.toRatingResponse(created);
  }

  /**
   * Skill matrix: one row per WORKING employee with average competency rating
   * per category plus the count of rated skills in employee_skills.
   */
  async skillMatrix(cycleId?: number): Promise<any[]> {
    const rows = await this.repo.skillMatrix(cycleId);
    const round = (v: any) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);
    return rows.map((r) => ({
      employeeId: Number(r.employee_id),
      empCode: String(r.emp_code),
      employeeName: String(r.full_name),
      grade: r.grade ?? null,
      avgTechnical: round(r.avg_technical),
      avgFunctional: round(r.avg_functional),
      avgLeadership: round(r.avg_leadership),
      avgBehavioral: round(r.avg_behavioral),
      skillCount: Number(r.skill_count ?? 0),
    }));
  }

  private toResponse(r: any): CompetencyResponse {
    return {
      id: Number(r.id),
      code: String(r.code),
      name: String(r.name),
      category: r.category,
      description: r.description ?? null,
      levels: parseJson(r.levels_json),
      isActive: !!r.is_active,
    };
  }

  private toRatingResponse(r: any): CompetencyRatingResponse {
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      competencyId: Number(r.competency_id),
      competencyCode: r.competency_code ?? undefined,
      competencyName: r.competency_name ?? undefined,
      category: r.category ?? undefined,
      cycleId: r.cycle_id === null ? null : Number(r.cycle_id),
      reviewId: r.review_id === null ? null : Number(r.review_id),
      rating: Number(r.rating),
      ratedByType: r.rated_by_type,
      note: r.note ?? null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    };
  }
}
