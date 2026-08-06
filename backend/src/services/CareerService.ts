import { CareerRepository } from '../repositories/CareerRepository';
import { RecruitmentAuditService } from './RecruitmentAuditService';
import { PerfActionContext } from '../types/performance';
import { CareerInterestResponse } from '../types/internalRecruitment';

const WORK_MODES = ['ANY', 'ONSITE', 'REMOTE', 'HYBRID'];

function parseJson(value: unknown, fallback: any = []): any {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function toInterestResponse(row: any): CareerInterestResponse {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name ?? null,
    preferredRoles: parseJson(row.preferred_roles),
    preferredDepartments: parseJson(row.preferred_departments),
    workModePreference: row.work_mode_preference,
    willingToRelocate: !!row.willing_to_relocate,
    openToGigs: !!row.open_to_gigs,
    careerStatement: row.career_statement,
    updatedAt: row.updated_at,
  };
}

export class CareerService {
  private repo = new CareerRepository();
  private audit = new RecruitmentAuditService();

  async getInterests(employeeId: number): Promise<CareerInterestResponse | { employeeId: number; exists: false }> {
    const row = await this.repo.findInterests(employeeId);
    if (!row) return { employeeId, exists: false };
    return toInterestResponse(row);
  }

  async saveInterests(employeeId: number, body: any, ctx: PerfActionContext): Promise<CareerInterestResponse> {
    const employee = await this.repo.findEmployee(employeeId);
    if (!employee) throw new Error('Employee not found');
    if (body?.workModePreference && !WORK_MODES.includes(body.workModePreference)) {
      throw new Error(`workModePreference must be one of ${WORK_MODES.join(', ')}`);
    }
    if (body?.preferredRoles !== undefined && !Array.isArray(body.preferredRoles)) {
      throw new Error('preferredRoles must be an array of role names');
    }
    if (body?.preferredDepartments !== undefined && !Array.isArray(body.preferredDepartments)) {
      throw new Error('preferredDepartments must be an array of department names');
    }
    await this.repo.upsertInterests(employeeId, body ?? {}, ctx.userId);
    await this.audit.record('CAREER_INTEREST', employeeId, 'SAVED', ctx, null, body ?? {});
    const row = await this.repo.findInterests(employeeId);
    return toInterestResponse(row);
  }

  /**
   * The employee's career dashboard. Every block that depends on data that
   * may not exist reports {available:false, reason} instead of guessing.
   */
  async myDashboard(employeeId: number): Promise<any> {
    const employee = await this.repo.findEmployee(employeeId);
    if (!employee) throw new Error('Employee not found');

    const [interestsRow, appCounts, savedCount, openOffers, readiness, assessment] = await Promise.all([
      this.repo.findInterests(employeeId),
      this.repo.applicationCounts(employeeId),
      this.repo.savedJobCount(employeeId),
      this.repo.openOffers(employeeId),
      this.repo.successionReadiness(employeeId),
      this.repo.latestTalentAssessment(employeeId),
    ]);

    const applications: Record<string, number> = {};
    for (const row of appCounts) applications[row.status] = Number(row.n);

    const promotionReadiness = readiness.length || assessment
      ? {
          available: true,
          successionSlots: readiness.map((r) => ({
            position: r.position_title ?? r.role_name ?? '-',
            readiness: r.readiness,
            ranking: r.ranking,
            criticality: r.criticality,
          })),
          talentAssessment: assessment
            ? {
                cycle: assessment.cycle_name,
                boxPosition: assessment.box_position,
                isHipo: !!assessment.is_hipo,
                performanceScore: Number(assessment.performance_score),
                potentialScore: Number(assessment.potential_score),
              }
            : null,
        }
      : { available: false, reason: 'No talent assessment or succession slot is recorded for you yet.' };

    // Roadmap resolves via job_grades.code matching the employee grade string.
    // No match means the mapping honestly does not exist for this grade.
    const paths = await this.repo.roadmapForGrade(String(employee.grade));
    const roadmap = paths.length
      ? {
          available: true,
          basis: `career paths for roles at grade ${employee.grade}`,
          paths: paths.map((p) => ({
            fromRole: p.from_role,
            toRole: p.to_role,
            toGrade: p.to_grade_code ?? null,
            typicalYears: p.typical_years === null ? null : Number(p.typical_years),
            notes: p.notes,
          })),
        }
      : {
          available: false,
          reason: `No career path is mapped for roles at grade ${employee.grade} in the job architecture.`,
        };

    return {
      employee: { id: employee.id, name: employee.full_name, grade: employee.grade },
      interests: interestsRow ? toInterestResponse(interestsRow) : null,
      applications,
      savedJobs: savedCount,
      openOffers: openOffers.map((o) => ({
        id: o.id, offerCode: o.offer_code, title: o.title, offerType: o.offer_type, validUntil: o.valid_until,
      })),
      promotionReadiness,
      roadmap,
    };
  }

  async allRoadmaps(): Promise<any[]> {
    const rows = await this.repo.allRoadmaps();
    return rows.map((p) => ({
      id: p.id,
      fromRole: p.from_role,
      fromRoleCode: p.from_role_code,
      toRole: p.to_role,
      toRoleCode: p.to_role_code,
      typicalYears: p.typical_years === null ? null : Number(p.typical_years),
      notes: p.notes,
    }));
  }
}
