import { OrganizationRepository, ENTITY_CONFIG } from '../repositories/OrganizationRepository';
import {
  OrgDashboard,
  OrgTotals,
  OrgHealthScore,
  HealthFactor,
  OrgSearchFilters,
  OrgSearchResult,
  WorkforceGroupBy,
  WorkforceResult,
  OrgEntitySlug,
  OrgListFilters,
  isOrgEntitySlug,
} from '../types/organization';
import { generateCsv } from '../utils/csv';
import { round2 } from '../utils/dateUtils';

const WORKFORCE_GROUPS: readonly WorkforceGroupBy[] = [
  'department',
  'branch',
  'region',
  'company',
  'division',
  'business_unit',
  'grade',
  'employment_type',
  'position',
];

/** Healthy span of control. Below 3 is over-layered, above 10 is unmanageable. */
const SPAN_MIN = 3;
const SPAN_MAX = 10;

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

/**
 * Read-only analytics over the organization. Every figure here comes from a
 * single set-based query — nothing loops over employees — so the numbers still
 * come back at six figures of headcount.
 */
export class OrgAnalyticsService {
  private repo = new OrganizationRepository();

  // =========================================================================
  // Dashboard
  // =========================================================================

  async getDashboard(): Promise<OrgDashboard> {
    const [counts, byCompany, byDepartment, byBranch, byRegion, growth, budget, span, health] =
      await Promise.all([
        this.repo.countAllEntities(),
        this.repo.getHeadcountBy('company'),
        this.repo.getHeadcountBy('department'),
        this.repo.getHeadcountBy('branch'),
        this.repo.getHeadcountBy('region'),
        this.repo.getWorkforceGrowth(12),
        this.repo.getBudgetUtilisation(),
        this.repo.getSpanOfControl(10),
        this.getHealthScore(),
      ]);

    const totals: OrgTotals = {
      companies: counts['companies'] ?? 0,
      legalEntities: counts['legal-entities'] ?? 0,
      regions: counts['regions'] ?? 0,
      businessUnits: counts['business-units'] ?? 0,
      divisions: counts['divisions'] ?? 0,
      departments: counts['departments'] ?? 0,
      branches: counts['branches'] ?? 0,
      locations: counts['locations'] ?? 0,
      costCenterGroups: counts['cost-center-groups'] ?? 0,
      costCenters: counts['cost-centers'] ?? 0,
      teams: counts['teams'] ?? 0,
      jobFamilies: counts['job-families'] ?? 0,
      jobFunctions: counts['job-functions'] ?? 0,
      jobGrades: counts['job-grades'] ?? 0,
      jobLevels: counts['job-levels'] ?? 0,
      jobRoles: counts['job-roles'] ?? 0,
      positions: counts['positions'] ?? 0,
      employees: counts['employees'] ?? 0,
      vacantSeats: counts['vacantSeats'] ?? 0,
    };

    return {
      generatedAt: new Date().toISOString(),
      totals,
      headcountByCompany: byCompany,
      headcountByDepartment: byDepartment,
      headcountByBranch: byBranch,
      headcountByRegion: byRegion,
      workforceGrowth: growth,
      budgetUtilisation: {
        basis: 'SUM(employees.monthly_salary) x 12 against departments.annual_budget',
        note:
          'Committed cost is an ESTIMATE derived from fixed monthly salary only. ' +
          'Piece-rate and dhar workers carry no fixed monthly salary, so their real cost ' +
          'is not represented here — check headcountWithoutFixedSalary per row before ' +
          'reading utilisation as a true burn rate.',
        rows: budget,
      },
      spanOfControl: span,
      healthScore: health,
    };
  }

  // =========================================================================
  // Health score
  // =========================================================================

  /**
   * Five explainable factors, each returned with its own value, weight and a
   * plain-language detail string. Nothing here is a magic constant pulled out
   * of the air — every number traces back to a row count the caller can verify.
   */
  async getHealthScore(): Promise<OrgHealthScore> {
    const raw = await this.repo.getHealthFactorInputs();

    const departments = raw['departments'] ?? 0;
    const departmentsWithHead = raw['departmentsWithHead'] ?? 0;
    const employees = raw['employees'] ?? 0;
    const employeesWithDepartment = raw['employeesWithDepartment'] ?? 0;
    const employeesWithPosition = raw['employeesWithPosition'] ?? 0;
    const managers = raw['managers'] ?? 0;
    const managersInBand = raw['managersInBand'] ?? 0;
    const budgetedSeats = raw['budgetedSeats'] ?? 0;
    const vacantSeats = raw['vacantSeats'] ?? 0;

    const vacancyRate = pct(vacantSeats, budgetedSeats);

    const factors: HealthFactor[] = [
      {
        key: 'departmentsWithHead',
        label: 'Departments with a head assigned',
        value: departments === 0 ? 0 : pct(departmentsWithHead, departments),
        weight: 0.2,
        detail: `${departmentsWithHead} of ${departments} active departments have a head_employee_id.`,
      },
      {
        key: 'employeesWithDepartment',
        label: 'Employees placed in a department',
        value: pct(employeesWithDepartment, employees),
        weight: 0.25,
        detail: `${employeesWithDepartment} of ${employees} working employees have a department_id.`,
      },
      {
        key: 'employeesWithPosition',
        label: 'Employees mapped to a position',
        value: pct(employeesWithPosition, employees),
        weight: 0.2,
        detail: `${employeesWithPosition} of ${employees} working employees occupy a budgeted position.`,
      },
      {
        key: 'spanOfControl',
        label: `Managers with ${SPAN_MIN}-${SPAN_MAX} direct reports`,
        value: managers === 0 ? 0 : pct(managersInBand, managers),
        weight: 0.2,
        detail:
          managers === 0
            ? 'No reporting lines are recorded yet, so span of control cannot be assessed.'
            : `${managersInBand} of ${managers} managers sit inside the healthy ${SPAN_MIN}-${SPAN_MAX} band.`,
      },
      {
        key: 'seatFillRate',
        label: 'Budgeted seats filled',
        value: budgetedSeats === 0 ? 0 : 100 - vacancyRate,
        weight: 0.15,
        detail:
          budgetedSeats === 0
            ? 'No open positions carry a budgeted headcount, so vacancy rate is not measurable.'
            : `${vacantSeats} of ${budgetedSeats} budgeted seats are vacant (${vacancyRate}% vacancy rate).`,
      },
    ];

    const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
    const score = Math.round(factors.reduce((sum, f) => sum + f.value * f.weight, 0) / totalWeight);

    return { score, grade: gradeFor(score), factors };
  }

  // =========================================================================
  // Search
  // =========================================================================

  async search(filters: OrgSearchFilters): Promise<OrgSearchResult[]> {
    const q = String(filters.q ?? '').trim();
    if (q.length < 1) throw new Error('A search term is required');
    return this.repo.searchEntities({ ...filters, q });
  }

  // =========================================================================
  // Workforce distribution
  // =========================================================================

  async getWorkforce(groupBy: string): Promise<WorkforceResult> {
    const key = String(groupBy ?? 'department').trim().toLowerCase().replace(/-/g, '_') as WorkforceGroupBy;
    if (!WORKFORCE_GROUPS.includes(key)) {
      throw new Error(`groupBy must be one of: ${WORKFORCE_GROUPS.join(', ')}`);
    }
    const rows = await this.repo.getWorkforceGroup(key);
    return {
      groupBy: key,
      totalHeadcount: rows.reduce((sum, r) => sum + r.workingCount, 0),
      rows,
    };
  }

  // =========================================================================
  // CSV export
  // =========================================================================

  /**
   * CSV for any org entity, plus the flattened `employees` placement sheet.
   * Headers come from the entity's own column map, so an export never silently
   * drops a field that was added to the schema.
   */
  async exportCsv(entity: string, filters: OrgListFilters & { format?: string }): Promise<{ filename: string; csv: string }> {
    const raw = String(entity ?? '').trim().toLowerCase();

    if (raw === 'employees' || raw === 'employee') {
      const rows = await this.repo.listEmployeeOrgRows({
        companyId: filters.companyId,
        departmentId: filters.departmentId,
        branchId: filters.branchId,
        limit: filters.limit,
      });
      const headers = [
        'Employee Code',
        'Name',
        'Work Status',
        'Designation',
        'Position',
        'Grade',
        'Company',
        'Business Unit',
        'Division',
        'Department',
        'Branch',
        'Region',
        'Cost Centre',
      ];
      const data = rows.map((r) => [
        r.emp_code,
        r.full_name,
        r.work_status,
        r.designation ?? '',
        r.position_title ?? '',
        r.grade_code ?? '',
        r.company_name ?? '',
        r.business_unit_name ?? '',
        r.division_name ?? '',
        r.department_name ?? '',
        r.branch_name ?? '',
        r.region_name ?? '',
        r.cost_center_name ?? '',
      ]);
      return { filename: 'organization-employees.csv', csv: generateCsv(headers, data) };
    }

    if (raw === 'audit' || raw === 'audit-log') {
      const entries = await this.repo.getAuditLog({ limit: filters.limit ?? 1000 });
      const headers = ['When', 'Entity Type', 'Entity', 'Action', 'Actor', 'Role', 'Summary', 'IP'];
      const data = entries.map((e) => [
        e.createdAt,
        e.entityType,
        e.entityName ?? e.entityId ?? '',
        e.action,
        e.actorName ?? '',
        e.actorRole ?? '',
        e.summary ?? '',
        e.ipAddress ?? '',
      ]);
      return { filename: 'organization-audit.csv', csv: generateCsv(headers, data) };
    }

    if (!isOrgEntitySlug(raw)) throw new Error(`Unknown organization entity "${entity}"`);
    const slug: OrgEntitySlug = raw;
    const cfg = ENTITY_CONFIG[slug];

    const rows = await this.repo.list(slug, filters);
    const fields = ['id', ...Object.keys(cfg.columns).filter((k) => k !== 'name' || cfg.nameColumn === 'name'), 'headcount'];
    const unique = Array.from(new Set(fields));
    const headers = unique.map(titleise);
    const data = rows.map((row) => unique.map((f) => flatten(row[f])));

    return { filename: `organization-${slug}.csv`, csv: generateCsv(headers, data) };
  }
}

// ---------------------------------------------------------------------------

function gradeFor(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Fair';
  if (score >= 40) return 'Needs attention';
  return 'Critical';
}

function titleise(field: string): string {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function flatten(value: unknown): string | number {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return round2(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
