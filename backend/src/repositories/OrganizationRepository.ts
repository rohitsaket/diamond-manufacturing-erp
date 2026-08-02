import { BaseRepository } from './BaseRepository';
import {
  OrgEntitySlug,
  OrgEntityRow,
  OrgEntityResponse,
  OrgListFilters,
  OrgAuditInput,
  OrgAuditEntry,
  OrgAuditFilters,
  ReportingRelationshipResponse,
  CreateReportingInput,
  TeamMemberResponse,
  CareerPathResponse,
  OrgChangeRequestResponse,
  OrgPolicyResponse,
  OrgCountBucket,
  WorkforceGrowthPoint,
  BudgetUtilisationRow,
  SpanOfControlRow,
  WorkforceGroupBy,
  WorkforceGroupRow,
  OrgSearchResult,
  OrgSearchFilters,
} from '../types/organization';
import { toDateString, round2 } from '../utils/dateUtils';

// ---------------------------------------------------------------------------
// Entity configuration — one engine, seventeen entities
// ---------------------------------------------------------------------------

export interface OrgDependent {
  table: string;
  column: string;
  label: string;
}

export interface OrgEntityConfig {
  slug: OrgEntitySlug;
  table: string;
  /** Human singular used in error messages: `Department code "X" is …`. */
  label: string;
  /** `title` for positions, `name` everywhere else. */
  nameColumn: string;
  /** Self-parenting column, or null when the entity has no parent of its own type. */
  parentColumn: string | null;
  /** Owning company column, or null for company-agnostic masters. */
  companyColumn: string | null;
  /** The `employees` column that points at this entity (drives headcount). */
  employeeColumn: string | null;
  /** Overrides the default employees-based headcount join. */
  headcountJoin: string | null;
  hasStatus: boolean;
  hasCreatedBy: boolean;
  hasUpdatedBy: boolean;
  /** Writable camelCase -> snake_case column map. Anything absent is ignored. */
  columns: Record<string, string>;
  /** JOIN clauses that resolve display names. Main table is always aliased `t`. */
  joins: string[];
  /** Extra SELECT expressions that accompany `joins`. */
  extraSelects: string[];
  /** Query-filter key -> qualified column. */
  filters: Record<string, string>;
  /** Rows in other tables that block a delete. */
  dependents: OrgDependent[];
  /** SQL expression (over alias `t`) used as the search subtitle. */
  searchSubtitle: string;
  orderBy: string;
}

const AUDIT_COLUMNS = { hasCreatedBy: true, hasUpdatedBy: true };
const NO_AUDIT_COLUMNS = { hasCreatedBy: false, hasUpdatedBy: false };

const COMPANY_JOIN = 'LEFT JOIN companies jc ON jc.id = t.company_id';

export const ENTITY_CONFIG: Record<OrgEntitySlug, OrgEntityConfig> = {
  companies: {
    slug: 'companies',
    table: 'companies',
    label: 'Company',
    nameColumn: 'name',
    parentColumn: 'parent_company_id',
    companyColumn: null,
    employeeColumn: 'company_id',
    headcountJoin: null,
    hasStatus: true,
    ...AUDIT_COLUMNS,
    columns: {
      code: 'code',
      name: 'name',
      shortName: 'short_name',
      parentCompanyId: 'parent_company_id',
      companyType: 'company_type',
      industryType: 'industry_type',
      registrationNo: 'registration_no',
      cin: 'cin',
      gstin: 'gstin',
      vatNumber: 'vat_number',
      pan: 'pan',
      tan: 'tan',
      incorporatedOn: 'incorporated_on',
      fiscalYearStartMonth: 'fiscal_year_start_month',
      baseCurrency: 'base_currency',
      defaultLanguage: 'default_language',
      defaultTimezone: 'default_timezone',
      country: 'country',
      corporateAddress: 'corporate_address',
      contactEmail: 'contact_email',
      contactPhone: 'contact_phone',
      website: 'website',
      logoUrl: 'logo_url',
      brandColor: 'brand_color',
      isPayrollCompany: 'is_payroll_company',
      status: 'status',
      notes: 'notes',
    },
    joins: ['LEFT JOIN companies jp ON jp.id = t.parent_company_id AND jp.deleted_at IS NULL'],
    extraSelects: ['jp.name AS parent_name'],
    filters: { parentId: 't.parent_company_id' },
    dependents: [
      { table: 'legal_entities', column: 'company_id', label: 'legal entities' },
      { table: 'business_units', column: 'company_id', label: 'business units' },
      { table: 'divisions', column: 'company_id', label: 'divisions' },
      { table: 'departments', column: 'company_id', label: 'departments' },
      { table: 'branches', column: 'company_id', label: 'branches' },
      { table: 'locations', column: 'company_id', label: 'locations' },
      { table: 'cost_centers', column: 'company_id', label: 'cost centres' },
      { table: 'teams', column: 'company_id', label: 'teams' },
      { table: 'positions', column: 'company_id', label: 'positions' },
    ],
    searchSubtitle: 't.company_type',
    orderBy: 't.name ASC',
  },

  'legal-entities': {
    slug: 'legal-entities',
    table: 'legal_entities',
    label: 'Legal entity',
    nameColumn: 'name',
    parentColumn: null,
    companyColumn: 'company_id',
    employeeColumn: 'legal_entity_id',
    headcountJoin: null,
    hasStatus: true,
    ...AUDIT_COLUMNS,
    columns: {
      companyId: 'company_id',
      code: 'code',
      name: 'name',
      entityType: 'entity_type',
      registrationNo: 'registration_no',
      taxId: 'tax_id',
      gstin: 'gstin',
      country: 'country',
      state: 'state',
      registeredAddress: 'registered_address',
      currency: 'currency',
      isPayrollEntity: 'is_payroll_entity',
      status: 'status',
    },
    joins: [COMPANY_JOIN],
    extraSelects: ['jc.name AS company_name'],
    filters: { companyId: 't.company_id' },
    dependents: [],
    searchSubtitle: 't.entity_type',
    orderBy: 't.name ASC',
  },

  regions: {
    slug: 'regions',
    table: 'regions',
    label: 'Region',
    nameColumn: 'name',
    parentColumn: 'parent_region_id',
    companyColumn: null,
    employeeColumn: 'region_id',
    headcountJoin: null,
    hasStatus: true,
    ...AUDIT_COLUMNS,
    columns: {
      code: 'code',
      name: 'name',
      regionType: 'region_type',
      parentRegionId: 'parent_region_id',
      country: 'country',
      headEmployeeId: 'head_employee_id',
      status: 'status',
    },
    joins: [
      'LEFT JOIN regions jp ON jp.id = t.parent_region_id AND jp.deleted_at IS NULL',
      'LEFT JOIN employees jh ON jh.id = t.head_employee_id AND jh.deleted_at IS NULL',
    ],
    extraSelects: ['jp.name AS parent_name', 'jh.full_name AS head_name'],
    filters: { parentId: 't.parent_region_id' },
    dependents: [{ table: 'branches', column: 'region_id', label: 'branches' }],
    searchSubtitle: 't.region_type',
    orderBy: 't.name ASC',
  },

  'business-units': {
    slug: 'business-units',
    table: 'business_units',
    label: 'Business unit',
    nameColumn: 'name',
    parentColumn: 'parent_business_unit_id',
    companyColumn: 'company_id',
    employeeColumn: 'business_unit_id',
    headcountJoin: null,
    hasStatus: true,
    ...AUDIT_COLUMNS,
    columns: {
      companyId: 'company_id',
      code: 'code',
      name: 'name',
      parentBusinessUnitId: 'parent_business_unit_id',
      headEmployeeId: 'head_employee_id',
      description: 'description',
      annualBudget: 'annual_budget',
      budgetCurrency: 'budget_currency',
      status: 'status',
    },
    joins: [
      COMPANY_JOIN,
      'LEFT JOIN business_units jp ON jp.id = t.parent_business_unit_id AND jp.deleted_at IS NULL',
      'LEFT JOIN employees jh ON jh.id = t.head_employee_id AND jh.deleted_at IS NULL',
    ],
    extraSelects: ['jc.name AS company_name', 'jp.name AS parent_name', 'jh.full_name AS head_name'],
    filters: { companyId: 't.company_id', parentId: 't.parent_business_unit_id' },
    dependents: [{ table: 'divisions', column: 'business_unit_id', label: 'divisions' }],
    searchSubtitle: "COALESCE(t.description, 'Business unit')",
    orderBy: 't.name ASC',
  },

  divisions: {
    slug: 'divisions',
    table: 'divisions',
    label: 'Division',
    nameColumn: 'name',
    parentColumn: 'parent_division_id',
    companyColumn: 'company_id',
    employeeColumn: 'division_id',
    headcountJoin: null,
    hasStatus: true,
    ...AUDIT_COLUMNS,
    columns: {
      companyId: 'company_id',
      businessUnitId: 'business_unit_id',
      code: 'code',
      name: 'name',
      parentDivisionId: 'parent_division_id',
      divisionType: 'division_type',
      headEmployeeId: 'head_employee_id',
      description: 'description',
      status: 'status',
    },
    joins: [
      COMPANY_JOIN,
      'LEFT JOIN business_units jb ON jb.id = t.business_unit_id AND jb.deleted_at IS NULL',
      'LEFT JOIN divisions jp ON jp.id = t.parent_division_id AND jp.deleted_at IS NULL',
      'LEFT JOIN employees jh ON jh.id = t.head_employee_id AND jh.deleted_at IS NULL',
    ],
    extraSelects: [
      'jc.name AS company_name',
      'jb.name AS business_unit_name',
      'jp.name AS parent_name',
      'jh.full_name AS head_name',
    ],
    filters: {
      companyId: 't.company_id',
      businessUnitId: 't.business_unit_id',
      parentId: 't.parent_division_id',
    },
    dependents: [{ table: 'departments', column: 'division_id', label: 'departments' }],
    searchSubtitle: 't.division_type',
    orderBy: 't.name ASC',
  },

  departments: {
    slug: 'departments',
    table: 'departments',
    label: 'Department',
    nameColumn: 'name',
    parentColumn: 'parent_department_id',
    companyColumn: 'company_id',
    employeeColumn: 'department_id',
    headcountJoin: null,
    hasStatus: true,
    ...AUDIT_COLUMNS,
    columns: {
      companyId: 'company_id',
      divisionId: 'division_id',
      code: 'code',
      name: 'name',
      parentDepartmentId: 'parent_department_id',
      headEmployeeId: 'head_employee_id',
      costCenterId: 'cost_center_id',
      description: 'description',
      objectives: 'objectives',
      annualBudget: 'annual_budget',
      plannedHeadcount: 'planned_headcount',
      status: 'status',
    },
    joins: [
      COMPANY_JOIN,
      'LEFT JOIN divisions jd ON jd.id = t.division_id AND jd.deleted_at IS NULL',
      'LEFT JOIN departments jp ON jp.id = t.parent_department_id AND jp.deleted_at IS NULL',
      'LEFT JOIN employees jh ON jh.id = t.head_employee_id AND jh.deleted_at IS NULL',
      'LEFT JOIN cost_centers jcc ON jcc.id = t.cost_center_id AND jcc.deleted_at IS NULL',
    ],
    extraSelects: [
      'jc.name AS company_name',
      'jd.name AS division_name',
      'jp.name AS parent_name',
      'jh.full_name AS head_name',
      'jcc.name AS cost_center_name',
    ],
    filters: {
      companyId: 't.company_id',
      divisionId: 't.division_id',
      parentId: 't.parent_department_id',
      costCenterId: 't.cost_center_id',
    },
    dependents: [
      { table: 'teams', column: 'department_id', label: 'teams' },
      { table: 'positions', column: 'department_id', label: 'positions' },
      { table: 'cost_centers', column: 'department_id', label: 'cost centres' },
    ],
    searchSubtitle: "COALESCE(t.description, 'Department')",
    orderBy: 't.name ASC',
  },

  branches: {
    slug: 'branches',
    table: 'branches',
    label: 'Branch',
    nameColumn: 'name',
    parentColumn: null,
    companyColumn: 'company_id',
    employeeColumn: 'branch_id',
    headcountJoin: null,
    hasStatus: true,
    ...AUDIT_COLUMNS,
    columns: {
      companyId: 'company_id',
      regionId: 'region_id',
      code: 'code',
      name: 'name',
      branchType: 'branch_type',
      managerEmployeeId: 'manager_employee_id',
      address: 'address',
      city: 'city',
      state: 'state',
      country: 'country',
      postalCode: 'postal_code',
      latitude: 'latitude',
      longitude: 'longitude',
      timezone: 'timezone',
      currency: 'currency',
      language: 'language',
      contactEmail: 'contact_email',
      contactPhone: 'contact_phone',
      openedOn: 'opened_on',
      status: 'status',
    },
    joins: [
      COMPANY_JOIN,
      'LEFT JOIN regions jr ON jr.id = t.region_id AND jr.deleted_at IS NULL',
      'LEFT JOIN employees jm ON jm.id = t.manager_employee_id AND jm.deleted_at IS NULL',
    ],
    extraSelects: ['jc.name AS company_name', 'jr.name AS region_name', 'jm.full_name AS manager_name'],
    filters: { companyId: 't.company_id', regionId: 't.region_id' },
    dependents: [
      { table: 'locations', column: 'branch_id', label: 'locations' },
      { table: 'positions', column: 'branch_id', label: 'positions' },
    ],
    searchSubtitle: "CONCAT_WS(', ', t.city, t.state)",
    orderBy: 't.name ASC',
  },

  locations: {
    slug: 'locations',
    table: 'locations',
    label: 'Location',
    nameColumn: 'name',
    parentColumn: null,
    companyColumn: 'company_id',
    employeeColumn: 'location_id',
    headcountJoin: null,
    hasStatus: true,
    ...AUDIT_COLUMNS,
    columns: {
      companyId: 'company_id',
      branchId: 'branch_id',
      code: 'code',
      name: 'name',
      locationType: 'location_type',
      address: 'address',
      city: 'city',
      country: 'country',
      latitude: 'latitude',
      longitude: 'longitude',
      timezone: 'timezone',
      capacity: 'capacity',
      status: 'status',
    },
    joins: [COMPANY_JOIN, 'LEFT JOIN branches jb ON jb.id = t.branch_id AND jb.deleted_at IS NULL'],
    extraSelects: ['jc.name AS company_name', 'jb.name AS branch_name'],
    filters: { companyId: 't.company_id', branchId: 't.branch_id' },
    dependents: [],
    searchSubtitle: 't.location_type',
    orderBy: 't.name ASC',
  },

  'cost-center-groups': {
    slug: 'cost-center-groups',
    table: 'cost_center_groups',
    label: 'Cost centre group',
    nameColumn: 'name',
    parentColumn: null,
    companyColumn: 'company_id',
    employeeColumn: null,
    // Headcount rolls up through the group's cost centres.
    headcountJoin:
      'LEFT JOIN (SELECT cc.group_id AS ref, COUNT(*) AS cnt FROM employees e' +
      ' JOIN cost_centers cc ON cc.id = e.cost_center_id' +
      " WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING' AND cc.group_id IS NOT NULL" +
      ' GROUP BY cc.group_id) hc ON hc.ref = t.id',
    hasStatus: true,
    hasCreatedBy: true,
    hasUpdatedBy: false,
    columns: {
      companyId: 'company_id',
      code: 'code',
      name: 'name',
      description: 'description',
      status: 'status',
    },
    joins: [COMPANY_JOIN],
    extraSelects: ['jc.name AS company_name'],
    filters: { companyId: 't.company_id' },
    dependents: [{ table: 'cost_centers', column: 'group_id', label: 'cost centres' }],
    searchSubtitle: "COALESCE(t.description, 'Cost centre group')",
    orderBy: 't.name ASC',
  },

  'cost-centers': {
    slug: 'cost-centers',
    table: 'cost_centers',
    label: 'Cost centre',
    nameColumn: 'name',
    parentColumn: 'parent_cost_center_id',
    companyColumn: 'company_id',
    employeeColumn: 'cost_center_id',
    headcountJoin: null,
    hasStatus: true,
    ...AUDIT_COLUMNS,
    columns: {
      companyId: 'company_id',
      groupId: 'group_id',
      code: 'code',
      name: 'name',
      centerType: 'center_type',
      parentCostCenterId: 'parent_cost_center_id',
      ownerEmployeeId: 'owner_employee_id',
      departmentId: 'department_id',
      branchId: 'branch_id',
      glAccount: 'gl_account',
      annualBudget: 'annual_budget',
      budgetCurrency: 'budget_currency',
      fiscalYear: 'fiscal_year',
      status: 'status',
    },
    joins: [
      COMPANY_JOIN,
      'LEFT JOIN cost_center_groups jg ON jg.id = t.group_id AND jg.deleted_at IS NULL',
      'LEFT JOIN cost_centers jp ON jp.id = t.parent_cost_center_id AND jp.deleted_at IS NULL',
      'LEFT JOIN employees jo ON jo.id = t.owner_employee_id AND jo.deleted_at IS NULL',
      'LEFT JOIN departments jd ON jd.id = t.department_id AND jd.deleted_at IS NULL',
      'LEFT JOIN branches jb ON jb.id = t.branch_id AND jb.deleted_at IS NULL',
    ],
    extraSelects: [
      'jc.name AS company_name',
      'jg.name AS group_name',
      'jp.name AS parent_name',
      'jo.full_name AS owner_name',
      'jd.name AS department_name',
      'jb.name AS branch_name',
    ],
    filters: {
      companyId: 't.company_id',
      groupId: 't.group_id',
      parentId: 't.parent_cost_center_id',
      departmentId: 't.department_id',
      branchId: 't.branch_id',
    },
    dependents: [
      { table: 'departments', column: 'cost_center_id', label: 'departments' },
      { table: 'positions', column: 'cost_center_id', label: 'positions' },
    ],
    searchSubtitle: 't.center_type',
    orderBy: 't.code ASC',
  },

  teams: {
    slug: 'teams',
    table: 'teams',
    label: 'Team',
    nameColumn: 'name',
    parentColumn: null,
    companyColumn: 'company_id',
    employeeColumn: null,
    headcountJoin:
      'LEFT JOIN (SELECT team_id AS ref, COUNT(*) AS cnt FROM team_members WHERE left_on IS NULL GROUP BY team_id) hc ON hc.ref = t.id',
    hasStatus: true,
    ...AUDIT_COLUMNS,
    columns: {
      companyId: 'company_id',
      departmentId: 'department_id',
      code: 'code',
      name: 'name',
      teamType: 'team_type',
      leadEmployeeId: 'lead_employee_id',
      capacity: 'capacity',
      objectives: 'objectives',
      startDate: 'start_date',
      endDate: 'end_date',
      status: 'status',
    },
    joins: [
      COMPANY_JOIN,
      'LEFT JOIN departments jd ON jd.id = t.department_id AND jd.deleted_at IS NULL',
      'LEFT JOIN employees jl ON jl.id = t.lead_employee_id AND jl.deleted_at IS NULL',
    ],
    extraSelects: ['jc.name AS company_name', 'jd.name AS department_name', 'jl.full_name AS lead_name'],
    filters: { companyId: 't.company_id', departmentId: 't.department_id' },
    dependents: [],
    searchSubtitle: 't.team_type',
    orderBy: 't.name ASC',
  },

  'job-families': {
    slug: 'job-families',
    table: 'job_families',
    label: 'Job family',
    nameColumn: 'name',
    parentColumn: null,
    companyColumn: null,
    employeeColumn: null,
    headcountJoin:
      'LEFT JOIN (SELECT jf.job_family_id AS ref, COUNT(*) AS cnt FROM employees e' +
      ' JOIN job_roles jr ON jr.id = e.job_role_id' +
      ' JOIN job_functions jf ON jf.id = jr.job_function_id' +
      " WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING'" +
      ' GROUP BY jf.job_family_id) hc ON hc.ref = t.id',
    hasStatus: true,
    ...NO_AUDIT_COLUMNS,
    columns: { code: 'code', name: 'name', description: 'description', status: 'status' },
    joins: [],
    extraSelects: [],
    filters: {},
    dependents: [{ table: 'job_functions', column: 'job_family_id', label: 'job functions' }],
    searchSubtitle: "COALESCE(t.description, 'Job family')",
    orderBy: 't.name ASC',
  },

  'job-functions': {
    slug: 'job-functions',
    table: 'job_functions',
    label: 'Job function',
    nameColumn: 'name',
    parentColumn: null,
    companyColumn: null,
    employeeColumn: null,
    headcountJoin:
      'LEFT JOIN (SELECT jr.job_function_id AS ref, COUNT(*) AS cnt FROM employees e' +
      ' JOIN job_roles jr ON jr.id = e.job_role_id' +
      " WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING' AND jr.job_function_id IS NOT NULL" +
      ' GROUP BY jr.job_function_id) hc ON hc.ref = t.id',
    hasStatus: true,
    ...NO_AUDIT_COLUMNS,
    columns: {
      jobFamilyId: 'job_family_id',
      code: 'code',
      name: 'name',
      description: 'description',
      status: 'status',
    },
    joins: ['LEFT JOIN job_families jf ON jf.id = t.job_family_id AND jf.deleted_at IS NULL'],
    extraSelects: ['jf.name AS job_family_name'],
    filters: { jobFamilyId: 't.job_family_id' },
    dependents: [{ table: 'job_roles', column: 'job_function_id', label: 'job roles' }],
    searchSubtitle: "COALESCE(t.description, 'Job function')",
    orderBy: 't.name ASC',
  },

  'job-grades': {
    slug: 'job-grades',
    table: 'job_grades',
    label: 'Job grade',
    nameColumn: 'name',
    parentColumn: null,
    companyColumn: null,
    employeeColumn: 'job_grade_id',
    headcountJoin: null,
    hasStatus: true,
    ...NO_AUDIT_COLUMNS,
    columns: {
      code: 'code',
      name: 'name',
      rankOrder: 'rank_order',
      minSalary: 'min_salary',
      maxSalary: 'max_salary',
      currency: 'currency',
      description: 'description',
      status: 'status',
    },
    joins: [],
    extraSelects: [],
    filters: {},
    dependents: [
      { table: 'job_roles', column: 'job_grade_id', label: 'job roles' },
      { table: 'positions', column: 'job_grade_id', label: 'positions' },
    ],
    searchSubtitle: "CONCAT('Rank ', t.rank_order)",
    orderBy: 't.rank_order ASC',
  },

  'job-levels': {
    slug: 'job-levels',
    table: 'job_levels',
    label: 'Job level',
    nameColumn: 'name',
    parentColumn: null,
    companyColumn: null,
    employeeColumn: 'job_level_id',
    headcountJoin: null,
    hasStatus: true,
    ...NO_AUDIT_COLUMNS,
    columns: {
      code: 'code',
      name: 'name',
      rankOrder: 'rank_order',
      careerStage: 'career_stage',
      description: 'description',
      status: 'status',
    },
    joins: [],
    extraSelects: [],
    filters: {},
    dependents: [
      { table: 'job_roles', column: 'job_level_id', label: 'job roles' },
      { table: 'positions', column: 'job_level_id', label: 'positions' },
    ],
    searchSubtitle: 't.career_stage',
    orderBy: 't.rank_order ASC',
  },

  'job-roles': {
    slug: 'job-roles',
    table: 'job_roles',
    label: 'Job role',
    nameColumn: 'name',
    parentColumn: null,
    companyColumn: null,
    employeeColumn: 'job_role_id',
    headcountJoin: null,
    hasStatus: true,
    ...NO_AUDIT_COLUMNS,
    columns: {
      jobFunctionId: 'job_function_id',
      code: 'code',
      name: 'name',
      jobGradeId: 'job_grade_id',
      jobLevelId: 'job_level_id',
      description: 'description',
      responsibilities: 'responsibilities',
      status: 'status',
    },
    joins: [
      'LEFT JOIN job_functions jf ON jf.id = t.job_function_id AND jf.deleted_at IS NULL',
      'LEFT JOIN job_grades jg ON jg.id = t.job_grade_id AND jg.deleted_at IS NULL',
      'LEFT JOIN job_levels jl ON jl.id = t.job_level_id AND jl.deleted_at IS NULL',
    ],
    extraSelects: ['jf.name AS job_function_name', 'jg.name AS job_grade_name', 'jl.name AS job_level_name'],
    filters: { jobFunctionId: 't.job_function_id', jobGradeId: 't.job_grade_id', jobLevelId: 't.job_level_id' },
    dependents: [{ table: 'positions', column: 'job_role_id', label: 'positions' }],
    searchSubtitle: "'Job role'",
    orderBy: 't.name ASC',
  },

  positions: {
    slug: 'positions',
    table: 'positions',
    label: 'Position',
    nameColumn: 'title',
    parentColumn: 'reports_to_position_id',
    companyColumn: 'company_id',
    employeeColumn: 'position_id',
    headcountJoin: null,
    hasStatus: true,
    ...AUDIT_COLUMNS,
    columns: {
      companyId: 'company_id',
      code: 'code',
      title: 'title',
      name: 'title',
      jobRoleId: 'job_role_id',
      departmentId: 'department_id',
      branchId: 'branch_id',
      costCenterId: 'cost_center_id',
      reportsToPositionId: 'reports_to_position_id',
      jobGradeId: 'job_grade_id',
      jobLevelId: 'job_level_id',
      headcountBudgeted: 'headcount_budgeted',
      budgetAmount: 'budget_amount',
      employmentType: 'employment_type',
      status: 'status',
      effectiveFrom: 'effective_from',
      effectiveTo: 'effective_to',
    },
    joins: [
      COMPANY_JOIN,
      'LEFT JOIN job_roles jr ON jr.id = t.job_role_id AND jr.deleted_at IS NULL',
      'LEFT JOIN departments jd ON jd.id = t.department_id AND jd.deleted_at IS NULL',
      'LEFT JOIN branches jb ON jb.id = t.branch_id AND jb.deleted_at IS NULL',
      'LEFT JOIN cost_centers jcc ON jcc.id = t.cost_center_id AND jcc.deleted_at IS NULL',
      'LEFT JOIN positions jp ON jp.id = t.reports_to_position_id AND jp.deleted_at IS NULL',
      'LEFT JOIN job_grades jg ON jg.id = t.job_grade_id AND jg.deleted_at IS NULL',
      'LEFT JOIN job_levels jl ON jl.id = t.job_level_id AND jl.deleted_at IS NULL',
    ],
    extraSelects: [
      'jc.name AS company_name',
      'jr.name AS job_role_name',
      'jd.name AS department_name',
      'jb.name AS branch_name',
      'jcc.name AS cost_center_name',
      'jp.title AS parent_name',
      'jg.name AS job_grade_name',
      'jl.name AS job_level_name',
    ],
    filters: {
      companyId: 't.company_id',
      departmentId: 't.department_id',
      branchId: 't.branch_id',
      costCenterId: 't.cost_center_id',
      jobRoleId: 't.job_role_id',
      jobGradeId: 't.job_grade_id',
      parentId: 't.reports_to_position_id',
    },
    dependents: [],
    searchSubtitle: 't.status',
    orderBy: 't.title ASC',
  },
};

/**
 * Employee id column -> the legacy free-text column that mirrors it.
 *
 * BACKWARD COMPATIBILITY: existing screens and reports still read the text
 * columns, so every org move writes both sides. Never update one alone.
 */
export const EMPLOYEE_TEXT_MIRROR: Readonly<Record<string, string>> = Object.freeze({
  company_id: 'company',
  legal_entity_id: 'legal_entity',
  business_unit_id: 'business_unit',
  division_id: 'division',
  department_id: 'department',
  branch_id: 'branch',
  region_id: 'region',
  cost_center_id: 'cost_center',
});

const WORKING = "e.deleted_at IS NULL AND e.work_status = 'WORKING'";

/** LIKE wildcards are escaped with `!` so a user typing `%` searches for `%`. */
function likeTerm(raw: string): string {
  return `%${String(raw).replace(/[!%_]/g, '!$&')}%`;
}

function sanitizeLimit(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

// ---------------------------------------------------------------------------

/**
 * All organization SQL lives here: the generic entity engine, the set-based
 * hierarchy/aggregate reads, the relationship tables and the audit trail.
 * Services never touch the database directly.
 */
export class OrganizationRepository extends BaseRepository {
  // =========================================================================
  // Generic entity CRUD
  // =========================================================================

  config(slug: OrgEntitySlug): OrgEntityConfig {
    return ENTITY_CONFIG[slug];
  }

  async list(slug: OrgEntitySlug, filters: OrgListFilters = {}): Promise<OrgEntityResponse[]> {
    const cfg = ENTITY_CONFIG[slug];
    const params: any[] = [];

    const selects = ['t.*', ...cfg.extraSelects, 'COALESCE(hc.cnt, 0) AS headcount'];
    const joins = [...cfg.joins, this.headcountJoinFor(cfg)];

    let sql = `SELECT ${selects.join(', ')} FROM ${cfg.table} t ${joins.join(' ')} WHERE t.deleted_at IS NULL`;

    if (filters.q) {
      sql += ` AND (t.code LIKE ? ESCAPE '!' OR t.${cfg.nameColumn} LIKE ? ESCAPE '!')`;
      const term = likeTerm(filters.q);
      params.push(term, term);
    }
    if (cfg.hasStatus && filters.status && filters.status !== 'ALL') {
      sql += ' AND t.status = ?';
      params.push(filters.status);
    }
    for (const [key, column] of Object.entries(cfg.filters)) {
      const value = (filters as Record<string, any>)[key];
      if (value === undefined || value === null || value === '') continue;
      sql += ` AND ${column} = ?`;
      params.push(value);
    }

    // LIMIT cannot be bound in a prepared statement; inline a sanitised int.
    const limit = sanitizeLimit(filters.limit, 500, 5000);
    sql += ` ORDER BY ${cfg.orderBy} LIMIT ${limit}`;

    const rows = await this.query<OrgEntityRow[]>(sql, params);
    return rows.map((r) => this.toResponse(cfg, r));
  }

  async findById(slug: OrgEntitySlug, id: number): Promise<OrgEntityResponse | null> {
    const cfg = ENTITY_CONFIG[slug];
    const selects = ['t.*', ...cfg.extraSelects, 'COALESCE(hc.cnt, 0) AS headcount'];
    const joins = [...cfg.joins, this.headcountJoinFor(cfg)];
    const rows = await this.query<OrgEntityRow[]>(
      `SELECT ${selects.join(', ')} FROM ${cfg.table} t ${joins.join(' ')}
       WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.toResponse(cfg, rows[0]) : null;
  }

  /** Unjoined row, used for audit snapshots and validation. */
  async findRawById(slug: OrgEntitySlug, id: number): Promise<OrgEntityRow | null> {
    const cfg = ENTITY_CONFIG[slug];
    const rows = await this.query<OrgEntityRow[]>(
      `SELECT * FROM ${cfg.table} WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findByCode(slug: OrgEntitySlug, code: string, excludeId?: number): Promise<OrgEntityRow | null> {
    const cfg = ENTITY_CONFIG[slug];
    let sql = `SELECT * FROM ${cfg.table} WHERE code = ? AND deleted_at IS NULL`;
    const params: any[] = [code];
    if (excludeId) {
      sql += ' AND id <> ?';
      params.push(excludeId);
    }
    const rows = await this.query<OrgEntityRow[]>(sql, params);
    return rows[0] ?? null;
  }

  async create(slug: OrgEntitySlug, data: Record<string, any>, userId: number): Promise<number> {
    const cfg = ENTITY_CONFIG[slug];
    const columns: string[] = [];
    const placeholders: string[] = [];
    const params: any[] = [];
    const seen = new Set<string>();

    for (const [key, column] of Object.entries(cfg.columns)) {
      if (data[key] === undefined || seen.has(column)) continue;
      seen.add(column);
      columns.push(column);
      placeholders.push('?');
      params.push(data[key] === '' ? null : data[key]);
    }
    if (columns.length === 0) throw new Error('Nothing to create: no recognised fields were supplied');

    if (cfg.hasCreatedBy) {
      columns.push('created_by');
      placeholders.push('?');
      params.push(userId);
    }
    if (cfg.hasUpdatedBy) {
      columns.push('updated_by');
      placeholders.push('?');
      params.push(userId);
    }

    const result = await this.query<any>(
      `INSERT INTO ${cfg.table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
      params,
    );
    return Number(result.insertId);
  }

  async update(slug: OrgEntitySlug, id: number, patch: Record<string, any>, userId: number): Promise<void> {
    const cfg = ENTITY_CONFIG[slug];
    const sets: string[] = [];
    const params: any[] = [];
    const seen = new Set<string>();

    for (const [key, column] of Object.entries(cfg.columns)) {
      if (patch[key] === undefined || seen.has(column)) continue;
      seen.add(column);
      sets.push(`${column} = ?`);
      params.push(patch[key] === '' ? null : patch[key]);
    }
    if (sets.length === 0) return;

    if (cfg.hasUpdatedBy) {
      sets.push('updated_by = ?');
      params.push(userId);
    }
    params.push(id);
    await this.query(
      `UPDATE ${cfg.table} SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  /** Writes a single raw column. Used by reparent, which owns its own validation. */
  async setColumn(slug: OrgEntitySlug, id: number, column: string, value: any, userId: number): Promise<void> {
    const cfg = ENTITY_CONFIG[slug];
    const allowed = new Set(Object.values(cfg.columns));
    if (!allowed.has(column)) throw new Error(`${cfg.label} has no writable column "${column}"`);
    const sets = [`${column} = ?`];
    const params: any[] = [value];
    if (cfg.hasUpdatedBy) {
      sets.push('updated_by = ?');
      params.push(userId);
    }
    params.push(id);
    await this.query(`UPDATE ${cfg.table} SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params);
  }

  async softDelete(slug: OrgEntitySlug, id: number, userId: number): Promise<void> {
    const cfg = ENTITY_CONFIG[slug];
    const sets = ['deleted_at = NOW()'];
    const params: any[] = [];
    if (cfg.hasUpdatedBy) {
      sets.push('updated_by = ?');
      params.push(userId);
    }
    params.push(id);
    await this.query(`UPDATE ${cfg.table} SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params);
  }

  /** Working employees currently attached to this entity. */
  async countEmployeesFor(slug: OrgEntitySlug, id: number): Promise<number> {
    const cfg = ENTITY_CONFIG[slug];
    if (cfg.slug === 'teams') {
      const rows = await this.query<any[]>(
        'SELECT COUNT(*) AS cnt FROM team_members WHERE team_id = ? AND left_on IS NULL',
        [id],
      );
      return Number(rows[0]?.cnt ?? 0);
    }
    if (!cfg.employeeColumn) return 0;
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM employees e WHERE ${WORKING} AND e.${cfg.employeeColumn} = ?`,
      [id],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /** Self-parented children plus every dependent row that blocks a delete. */
  async countBlockers(slug: OrgEntitySlug, id: number): Promise<Array<{ label: string; count: number }>> {
    const cfg = ENTITY_CONFIG[slug];
    const checks: OrgDependent[] = [...cfg.dependents];
    if (cfg.parentColumn) {
      checks.unshift({ table: cfg.table, column: cfg.parentColumn, label: 'child records' });
    }
    if (checks.length === 0) return [];

    const unions = checks.map(
      (c) => `SELECT '${c.label}' AS label, COUNT(*) AS cnt FROM ${c.table} WHERE ${c.column} = ? AND deleted_at IS NULL`,
    );
    const rows = await this.query<any[]>(unions.join(' UNION ALL '), checks.map(() => id));
    return rows
      .map((r) => ({ label: String(r.label), count: Number(r.cnt ?? 0) }))
      .filter((r) => r.count > 0);
  }

  /** id -> parentId for a whole self-parenting table, for in-memory cycle checks. */
  async getParentMap(slug: OrgEntitySlug): Promise<Map<number, number | null>> {
    const cfg = ENTITY_CONFIG[slug];
    if (!cfg.parentColumn) return new Map();
    const rows = await this.query<any[]>(
      `SELECT id, ${cfg.parentColumn} AS parent_id FROM ${cfg.table} WHERE deleted_at IS NULL`,
    );
    const map = new Map<number, number | null>();
    for (const r of rows) map.set(Number(r.id), r.parent_id === null ? null : Number(r.parent_id));
    return map;
  }

  // =========================================================================
  // Hierarchy reads (set-based; the tree is assembled in the service)
  // =========================================================================

  async getTreeData(
    includeTeams: boolean,
    includeEmployees: boolean,
    employeeCap: number,
  ): Promise<{
    companies: any[];
    businessUnits: any[];
    divisions: any[];
    departments: any[];
    teams: any[];
    employees: any[];
    counts: any[];
    teamCounts: any[];
  }> {
    const [companies, businessUnits, divisions, departments, counts] = await Promise.all([
      this.query<any[]>(
        `SELECT id, code, name, parent_company_id, status FROM companies WHERE deleted_at IS NULL ORDER BY name`,
      ),
      this.query<any[]>(
        `SELECT b.id, b.code, b.name, b.company_id, b.parent_business_unit_id, b.status,
                b.head_employee_id, h.full_name AS head_name
         FROM business_units b
         LEFT JOIN employees h ON h.id = b.head_employee_id AND h.deleted_at IS NULL
         WHERE b.deleted_at IS NULL ORDER BY b.name`,
      ),
      this.query<any[]>(
        `SELECT d.id, d.code, d.name, d.company_id, d.business_unit_id, d.parent_division_id, d.status,
                d.head_employee_id, h.full_name AS head_name
         FROM divisions d
         LEFT JOIN employees h ON h.id = d.head_employee_id AND h.deleted_at IS NULL
         WHERE d.deleted_at IS NULL ORDER BY d.name`,
      ),
      this.query<any[]>(
        `SELECT dp.id, dp.code, dp.name, dp.company_id, dp.division_id, dp.parent_department_id, dp.status,
                dp.planned_headcount, dp.head_employee_id, h.full_name AS head_name
         FROM departments dp
         LEFT JOIN employees h ON h.id = dp.head_employee_id AND h.deleted_at IS NULL
         WHERE dp.deleted_at IS NULL ORDER BY dp.name`,
      ),
      // One grouped scan supplies the headcount for every level of the tree.
      this.query<any[]>(
        `SELECT e.company_id, e.business_unit_id, e.division_id, e.department_id, COUNT(*) AS cnt
         FROM employees e WHERE ${WORKING}
         GROUP BY e.company_id, e.business_unit_id, e.division_id, e.department_id`,
      ),
    ]);

    const teams = includeTeams
      ? await this.query<any[]>(
          `SELECT t.id, t.code, t.name, t.company_id, t.department_id, t.status,
                  t.lead_employee_id, l.full_name AS head_name
           FROM teams t
           LEFT JOIN employees l ON l.id = t.lead_employee_id AND l.deleted_at IS NULL
           WHERE t.deleted_at IS NULL ORDER BY t.name`,
        )
      : [];

    const teamCounts = includeTeams
      ? await this.query<any[]>(
          'SELECT team_id, COUNT(*) AS cnt FROM team_members WHERE left_on IS NULL GROUP BY team_id',
        )
      : [];

    const employees = includeEmployees
      ? await this.query<any[]>(
          `SELECT e.id, e.emp_code, e.full_name, e.designation, e.company_id, e.business_unit_id,
                  e.division_id, e.department_id
           FROM employees e WHERE ${WORKING}
           ORDER BY e.full_name LIMIT ${sanitizeLimit(employeeCap, 5000, 50000)}`,
        )
      : [];

    return { companies, businessUnits, divisions, departments, teams, employees, counts, teamCounts };
  }

  /** Every working employee, flat. The reporting tree is built in memory. */
  async getReportingRows(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT e.id, e.emp_code, e.full_name, e.designation, e.photo_url, e.reporting_manager_id,
              e.department_id, d.name AS department_name,
              e.position_id, p.title AS position_title,
              e.job_grade_id, g.code AS grade_code,
              e.branch_id, b.name AS branch_name
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id AND d.deleted_at IS NULL
       LEFT JOIN positions p   ON p.id = e.position_id AND p.deleted_at IS NULL
       LEFT JOIN job_grades g  ON g.id = e.job_grade_id AND g.deleted_at IS NULL
       LEFT JOIN branches b    ON b.id = e.branch_id AND b.deleted_at IS NULL
       WHERE ${WORKING}
       ORDER BY e.full_name`,
    );
  }

  async getPositionRows(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT p.id, p.code, p.title, p.status, p.reports_to_position_id, p.headcount_budgeted,
              p.department_id, d.name AS department_name, COALESCE(o.cnt, 0) AS occupancy
       FROM positions p
       LEFT JOIN departments d ON d.id = p.department_id AND d.deleted_at IS NULL
       LEFT JOIN (SELECT e.position_id AS ref, COUNT(*) AS cnt FROM employees e
                  WHERE ${WORKING} AND e.position_id IS NOT NULL GROUP BY e.position_id) o ON o.ref = p.id
       WHERE p.deleted_at IS NULL
       ORDER BY p.title`,
    );
  }

  async getPositionOccupancy(positionId: number): Promise<{ occupancy: number; budgeted: number; status: string } | null> {
    const rows = await this.query<any[]>(
      `SELECT p.headcount_budgeted, p.status,
              (SELECT COUNT(*) FROM employees e WHERE ${WORKING} AND e.position_id = p.id) AS occupancy
       FROM positions p WHERE p.id = ? AND p.deleted_at IS NULL`,
      [positionId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      occupancy: Number(row.occupancy ?? 0),
      budgeted: Number(row.headcount_budgeted ?? 0),
      status: String(row.status),
    };
  }

  async setPositionStatus(positionId: number, status: string, userId: number): Promise<void> {
    await this.query('UPDATE positions SET status = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL', [
      status,
      userId,
      positionId,
    ]);
  }

  // =========================================================================
  // Employee org placement (id column + legacy text column, always together)
  // =========================================================================

  async findEmployeeOrg(employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT id, emp_code, full_name, company_id, company, business_unit_id, business_unit,
              division_id, division, department_id, department, branch_id, branch,
              region_id, region, cost_center_id, cost_center, position_id, designation
       FROM employees WHERE id = ? AND deleted_at IS NULL`,
      [employeeId],
    );
    return rows[0] ?? null;
  }

  /**
   * Moves an employee's org assignment, writing BOTH the `*_id` column and the
   * legacy free-text column in one transaction. A department move also pulls
   * down the department's division, business unit, company and cost centre so
   * the employee never ends up half-placed.
   */
  async moveEmployeeOrg(
    employeeId: number,
    target: { departmentId?: number | null; branchId?: number | null; costCenterId?: number | null },
  ): Promise<{ employeeId: number; employeeName: string; before: Record<string, any>; after: Record<string, any> }> {
    return this.transaction(async (conn) => {
      const [empRows] = await conn.query(
        `SELECT id, emp_code, full_name, company_id, company, business_unit_id, business_unit,
                division_id, division, department_id, department, branch_id, branch,
                region_id, region, cost_center_id, cost_center
         FROM employees WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
        [employeeId],
      );
      const before = (empRows as any[])[0];
      if (!before) throw new Error(`Employee ${employeeId} was not found`);

      const sets: string[] = [];
      const params: any[] = [];
      const after: Record<string, any> = {};

      const assign = (column: string, value: any) => {
        sets.push(`${column} = ?`);
        params.push(value);
        after[column] = value;
      };

      if (target.departmentId !== undefined) {
        if (target.departmentId === null) {
          assign('department_id', null);
          assign('department', null);
        } else {
          const [deptRows] = await conn.query(
            `SELECT d.id, d.name, d.company_id, d.division_id, d.cost_center_id,
                    c.name AS company_name, dv.name AS division_name,
                    dv.business_unit_id, bu.name AS business_unit_name, cc.name AS cost_center_name
             FROM departments d
             LEFT JOIN companies c       ON c.id = d.company_id
             LEFT JOIN divisions dv      ON dv.id = d.division_id AND dv.deleted_at IS NULL
             LEFT JOIN business_units bu ON bu.id = dv.business_unit_id AND bu.deleted_at IS NULL
             LEFT JOIN cost_centers cc   ON cc.id = d.cost_center_id AND cc.deleted_at IS NULL
             WHERE d.id = ? AND d.deleted_at IS NULL`,
            [target.departmentId],
          );
          const dept = (deptRows as any[])[0];
          if (!dept) throw new Error(`Department ${target.departmentId} was not found`);

          assign('department_id', dept.id);
          assign('department', dept.name);
          assign('company_id', dept.company_id ?? null);
          assign('company', dept.company_name ?? null);
          if (dept.division_id) {
            assign('division_id', dept.division_id);
            assign('division', dept.division_name ?? null);
          }
          if (dept.business_unit_id) {
            assign('business_unit_id', dept.business_unit_id);
            assign('business_unit', dept.business_unit_name ?? null);
          }
          // An explicit cost centre in the same call wins over the inherited one.
          if (target.costCenterId === undefined && dept.cost_center_id) {
            assign('cost_center_id', dept.cost_center_id);
            assign('cost_center', dept.cost_center_name ?? null);
          }
        }
      }

      if (target.branchId !== undefined) {
        if (target.branchId === null) {
          assign('branch_id', null);
          assign('branch', null);
        } else {
          const [branchRows] = await conn.query(
            `SELECT b.id, b.name, b.region_id, r.name AS region_name
             FROM branches b
             LEFT JOIN regions r ON r.id = b.region_id AND r.deleted_at IS NULL
             WHERE b.id = ? AND b.deleted_at IS NULL`,
            [target.branchId],
          );
          const branch = (branchRows as any[])[0];
          if (!branch) throw new Error(`Branch ${target.branchId} was not found`);
          assign('branch_id', branch.id);
          assign('branch', branch.name);
          if (branch.region_id) {
            assign('region_id', branch.region_id);
            assign('region', branch.region_name ?? null);
          }
        }
      }

      if (target.costCenterId !== undefined) {
        if (target.costCenterId === null) {
          assign('cost_center_id', null);
          assign('cost_center', null);
        } else {
          const [ccRows] = await conn.query(
            'SELECT id, name FROM cost_centers WHERE id = ? AND deleted_at IS NULL',
            [target.costCenterId],
          );
          const cc = (ccRows as any[])[0];
          if (!cc) throw new Error(`Cost centre ${target.costCenterId} was not found`);
          assign('cost_center_id', cc.id);
          assign('cost_center', cc.name);
        }
      }

      if (sets.length === 0) throw new Error('Nothing to move: supply a department, branch or cost centre');

      params.push(employeeId);
      await conn.query(`UPDATE employees SET ${sets.join(', ')} WHERE id = ?`, params);

      const beforeSnapshot: Record<string, any> = {};
      for (const key of Object.keys(after)) beforeSnapshot[key] = before[key] ?? null;

      return { employeeId, employeeName: String(before.full_name), before: beforeSnapshot, after };
    });
  }

  // =========================================================================
  // Audit trail
  // =========================================================================

  async logAudit(entry: OrgAuditInput): Promise<void> {
    await this.query(
      `INSERT INTO org_audit_logs
        (entity_type, entity_id, entity_name, action, actor_user_id, actor_name, actor_role,
         summary, previous_value, new_value, ip_address, device, browser)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.entityType.slice(0, 40),
        entry.entityId ?? null,
        entry.entityName ? String(entry.entityName).slice(0, 200) : null,
        entry.action,
        entry.actor.userId ?? null,
        entry.actor.name ? String(entry.actor.name).slice(0, 160) : null,
        entry.actor.role ? String(entry.actor.role).slice(0, 40) : null,
        entry.summary.slice(0, 500),
        entry.previousValue === undefined ? null : JSON.stringify(entry.previousValue),
        entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
        entry.actor.ip ?? null,
        entry.actor.device ?? null,
        entry.actor.browser ?? null,
      ],
    );
  }

  async getAuditLog(filters: OrgAuditFilters = {}): Promise<OrgAuditEntry[]> {
    let sql = 'SELECT * FROM org_audit_logs WHERE 1 = 1';
    const params: any[] = [];

    if (filters.entityType) {
      sql += ' AND entity_type = ?';
      params.push(filters.entityType);
    }
    if (filters.entityId) {
      sql += ' AND entity_id = ?';
      params.push(filters.entityId);
    }
    if (filters.action) {
      sql += ' AND action = ?';
      params.push(filters.action);
    }
    if (filters.actorUserId) {
      sql += ' AND actor_user_id = ?';
      params.push(filters.actorUserId);
    }
    if (filters.from) {
      sql += ' AND created_at >= ?';
      params.push(`${filters.from} 00:00:00`);
    }
    if (filters.to) {
      sql += ' AND created_at <= ?';
      params.push(`${filters.to} 23:59:59`);
    }

    sql += ` ORDER BY id DESC LIMIT ${sanitizeLimit(filters.limit, 100, 1000)}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({
      id: Number(r.id),
      entityType: r.entity_type,
      entityId: r.entity_id === null ? null : Number(r.entity_id),
      entityName: r.entity_name,
      action: r.action,
      actorUserId: r.actor_user_id === null ? null : Number(r.actor_user_id),
      actorName: r.actor_name,
      actorRole: r.actor_role,
      summary: r.summary,
      previousValue: safeParse(r.previous_value),
      newValue: safeParse(r.new_value),
      ipAddress: r.ip_address,
      device: r.device,
      browser: r.browser,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  // =========================================================================
  // Team members
  // =========================================================================

  async listTeamMembers(teamId?: number, employeeId?: number, activeOnly = true): Promise<TeamMemberResponse[]> {
    let sql = `SELECT tm.*, t.name AS team_name, e.full_name AS employee_name, e.emp_code, e.designation
               FROM team_members tm
               JOIN teams t ON t.id = tm.team_id
               JOIN employees e ON e.id = tm.employee_id
               WHERE e.deleted_at IS NULL`;
    const params: any[] = [];
    if (teamId) {
      sql += ' AND tm.team_id = ?';
      params.push(teamId);
    }
    if (employeeId) {
      sql += ' AND tm.employee_id = ?';
      params.push(employeeId);
    }
    if (activeOnly) sql += ' AND tm.left_on IS NULL';
    sql += ' ORDER BY t.name, e.full_name';

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({
      id: Number(r.id),
      teamId: Number(r.team_id),
      teamName: r.team_name,
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name,
      employeeCode: r.emp_code,
      designation: r.designation ?? null,
      roleInTeam: r.role_in_team ?? null,
      allocationPct: Number(r.allocation_pct ?? 0),
      joinedOn: r.joined_on ? toDateString(r.joined_on) : null,
      leftOn: r.left_on ? toDateString(r.left_on) : null,
    }));
  }

  async findTeamMember(teamId: number, employeeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM team_members WHERE team_id = ? AND employee_id = ?',
      [teamId, employeeId],
    );
    return rows[0] ?? null;
  }

  /** Total active allocation for an employee, optionally ignoring one team. */
  async getEmployeeAllocation(employeeId: number, excludeTeamId?: number): Promise<number> {
    let sql =
      'SELECT COALESCE(SUM(allocation_pct), 0) AS total FROM team_members WHERE employee_id = ? AND left_on IS NULL';
    const params: any[] = [employeeId];
    if (excludeTeamId) {
      sql += ' AND team_id <> ?';
      params.push(excludeTeamId);
    }
    const rows = await this.query<any[]>(sql, params);
    return Number(rows[0]?.total ?? 0);
  }

  async upsertTeamMember(
    teamId: number,
    employeeId: number,
    data: { roleInTeam?: string | null; allocationPct: number; joinedOn?: string | null },
    userId: number,
  ): Promise<void> {
    await this.query(
      `INSERT INTO team_members (team_id, employee_id, role_in_team, allocation_pct, joined_on, created_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE role_in_team = VALUES(role_in_team),
                               allocation_pct = VALUES(allocation_pct),
                               joined_on = VALUES(joined_on),
                               left_on = NULL`,
      [teamId, employeeId, data.roleInTeam ?? null, data.allocationPct, data.joinedOn ?? null, userId],
    );
  }

  /** Members leave rather than vanish, so team history survives. */
  async endTeamMembership(teamId: number, employeeId: number, leftOn: string): Promise<number> {
    const result = await this.query<any>(
      'UPDATE team_members SET left_on = ? WHERE team_id = ? AND employee_id = ? AND left_on IS NULL',
      [leftOn, teamId, employeeId],
    );
    return Number(result?.affectedRows ?? 0);
  }

  // =========================================================================
  // Reporting relationships (matrix / dotted lines only)
  // =========================================================================

  async listReporting(filters: {
    employeeId?: number;
    managerEmployeeId?: number;
    relationshipType?: string;
    activeOnly?: boolean;
    limit?: number;
  }): Promise<ReportingRelationshipResponse[]> {
    let sql = `SELECT rr.*, e.full_name AS employee_name, e.emp_code AS employee_code,
                      m.full_name AS manager_name, m.emp_code AS manager_code
               FROM reporting_relationships rr
               JOIN employees e ON e.id = rr.employee_id
               JOIN employees m ON m.id = rr.manager_employee_id
               WHERE rr.deleted_at IS NULL`;
    const params: any[] = [];
    if (filters.employeeId) {
      sql += ' AND rr.employee_id = ?';
      params.push(filters.employeeId);
    }
    if (filters.managerEmployeeId) {
      sql += ' AND rr.manager_employee_id = ?';
      params.push(filters.managerEmployeeId);
    }
    if (filters.relationshipType) {
      sql += ' AND rr.relationship_type = ?';
      params.push(filters.relationshipType);
    }
    if (filters.activeOnly) sql += ' AND (rr.effective_to IS NULL OR rr.effective_to >= CURDATE())';
    sql += ` ORDER BY e.full_name, rr.relationship_type LIMIT ${sanitizeLimit(filters.limit, 500, 5000)}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name,
      employeeCode: r.employee_code,
      managerEmployeeId: Number(r.manager_employee_id),
      managerName: r.manager_name,
      managerCode: r.manager_code,
      relationshipType: r.relationship_type,
      context: r.context ?? null,
      allocationPct: r.allocation_pct === null ? null : Number(r.allocation_pct),
      effectiveFrom: toDateString(r.effective_from),
      effectiveTo: r.effective_to ? toDateString(r.effective_to) : null,
      isPrimary: !!r.is_primary,
      notes: r.notes ?? null,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  async findActiveReporting(
    employeeId: number,
    managerEmployeeId: number,
    relationshipType: string,
  ): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT * FROM reporting_relationships
       WHERE employee_id = ? AND manager_employee_id = ? AND relationship_type = ?
         AND deleted_at IS NULL AND (effective_to IS NULL OR effective_to >= CURDATE())`,
      [employeeId, managerEmployeeId, relationshipType],
    );
    return rows[0] ?? null;
  }

  async createReporting(data: Required<Pick<CreateReportingInput, 'employeeId' | 'managerEmployeeId'>> & CreateReportingInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO reporting_relationships
        (employee_id, manager_employee_id, relationship_type, context, allocation_pct,
         effective_from, effective_to, is_primary, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.employeeId,
        data.managerEmployeeId,
        data.relationshipType ?? 'MATRIX',
        data.context ?? null,
        data.allocationPct ?? null,
        data.effectiveFrom ?? toDateString(new Date()),
        data.effectiveTo ?? null,
        data.isPrimary ? 1 : 0,
        data.notes ?? null,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async findReportingById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM reporting_relationships WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ?? null;
  }

  async softDeleteReporting(id: number): Promise<void> {
    await this.query('UPDATE reporting_relationships SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL', [id]);
  }

  // =========================================================================
  // Career paths
  // =========================================================================

  async listCareerPaths(fromRoleId?: number): Promise<CareerPathResponse[]> {
    let sql = `SELECT cp.*, fr.name AS from_name, fr.code AS from_code, tr.name AS to_name, tr.code AS to_code
               FROM career_paths cp
               JOIN job_roles fr ON fr.id = cp.from_role_id
               JOIN job_roles tr ON tr.id = cp.to_role_id
               WHERE 1 = 1`;
    const params: any[] = [];
    if (fromRoleId) {
      sql += ' AND cp.from_role_id = ?';
      params.push(fromRoleId);
    }
    sql += ' ORDER BY fr.name, tr.name LIMIT 1000';

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({
      id: Number(r.id),
      fromRoleId: Number(r.from_role_id),
      fromRoleName: r.from_name,
      fromRoleCode: r.from_code,
      toRoleId: Number(r.to_role_id),
      toRoleName: r.to_name,
      toRoleCode: r.to_code,
      typicalYears: r.typical_years === null ? null : Number(r.typical_years),
      notes: r.notes ?? null,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  async findCareerPath(fromRoleId: number, toRoleId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM career_paths WHERE from_role_id = ? AND to_role_id = ?',
      [fromRoleId, toRoleId],
    );
    return rows[0] ?? null;
  }

  async createCareerPath(data: {
    fromRoleId: number;
    toRoleId: number;
    typicalYears?: number | null;
    notes?: string | null;
  }): Promise<number> {
    const result = await this.query<any>(
      'INSERT INTO career_paths (from_role_id, to_role_id, typical_years, notes) VALUES (?, ?, ?, ?)',
      [data.fromRoleId, data.toRoleId, data.typicalYears ?? null, data.notes ?? null],
    );
    return Number(result.insertId);
  }

  async findCareerPathById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM career_paths WHERE id = ?', [id]);
    return rows[0] ?? null;
  }

  async deleteCareerPath(id: number): Promise<void> {
    // career_paths carries no deleted_at; it is pure reference data.
    await this.query('DELETE FROM career_paths WHERE id = ?', [id]);
  }

  // =========================================================================
  // Change requests
  // =========================================================================

  async listChangeRequests(filters: {
    status?: string;
    requestType?: string;
    entityType?: string;
    limit?: number;
  }): Promise<OrgChangeRequestResponse[]> {
    let sql = `SELECT cr.*, e.full_name AS employee_name, ru.name AS requested_by_name, du.name AS decided_by_name
               FROM org_change_requests cr
               LEFT JOIN employees e ON e.id = cr.employee_id
               LEFT JOIN users ru ON ru.id = cr.requested_by
               LEFT JOIN users du ON du.id = cr.decided_by
               WHERE cr.deleted_at IS NULL`;
    const params: any[] = [];
    if (filters.status && filters.status !== 'ALL') {
      sql += ' AND cr.status = ?';
      params.push(filters.status);
    }
    if (filters.requestType) {
      sql += ' AND cr.request_type = ?';
      params.push(filters.requestType);
    }
    if (filters.entityType) {
      sql += ' AND cr.entity_type = ?';
      params.push(filters.entityType);
    }
    sql += ` ORDER BY cr.id DESC LIMIT ${sanitizeLimit(filters.limit, 200, 2000)}`;

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.changeRequestToResponse(r));
  }

  async findChangeRequestById(id: number): Promise<OrgChangeRequestResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT cr.*, e.full_name AS employee_name, ru.name AS requested_by_name, du.name AS decided_by_name
       FROM org_change_requests cr
       LEFT JOIN employees e ON e.id = cr.employee_id
       LEFT JOIN users ru ON ru.id = cr.requested_by
       LEFT JOIN users du ON du.id = cr.decided_by
       WHERE cr.id = ? AND cr.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.changeRequestToResponse(rows[0]) : null;
  }

  async createChangeRequest(
    data: {
      requestType: string;
      entityType?: string | null;
      entityId?: number | null;
      employeeId?: number | null;
      title: string;
      justification?: string | null;
      proposed?: unknown;
      current?: unknown;
      effectiveDate?: string | null;
      status?: string;
    },
    userId: number,
  ): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO org_change_requests
        (request_type, entity_type, entity_id, employee_id, title, justification,
         proposed_json, current_json, effective_date, status, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.requestType,
        data.entityType ?? null,
        data.entityId ?? null,
        data.employeeId ?? null,
        data.title.slice(0, 200),
        data.justification ?? null,
        data.proposed === undefined ? null : JSON.stringify(data.proposed),
        data.current === undefined ? null : JSON.stringify(data.current),
        data.effectiveDate ?? null,
        data.status ?? 'PENDING',
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async decideChangeRequest(id: number, status: string, note: string | null, userId: number): Promise<void> {
    await this.query(
      `UPDATE org_change_requests
       SET status = ?, decided_by = ?, decided_at = NOW(), decision_note = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [status, userId, note, id],
    );
  }

  private changeRequestToResponse(r: any): OrgChangeRequestResponse {
    return {
      id: Number(r.id),
      requestType: r.request_type,
      entityType: r.entity_type ?? null,
      entityId: r.entity_id === null ? null : Number(r.entity_id),
      employeeId: r.employee_id === null ? null : Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      title: r.title,
      justification: r.justification ?? null,
      proposed: safeParse(r.proposed_json),
      current: safeParse(r.current_json),
      effectiveDate: r.effective_date ? toDateString(r.effective_date) : null,
      status: r.status,
      requestedBy: r.requested_by === null ? null : Number(r.requested_by),
      requestedByName: r.requested_by_name ?? null,
      decidedBy: r.decided_by === null ? null : Number(r.decided_by),
      decidedByName: r.decided_by_name ?? null,
      decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
      decisionNote: r.decision_note ?? null,
      appliedAt: r.applied_at ? new Date(r.applied_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  // =========================================================================
  // Policies
  // =========================================================================

  async listPolicies(filters: {
    companyId?: number;
    branchId?: number;
    policyType?: string;
    status?: string;
  }): Promise<OrgPolicyResponse[]> {
    let sql = `SELECT p.*, c.name AS company_name, b.name AS branch_name
               FROM org_policies p
               LEFT JOIN companies c ON c.id = p.company_id AND c.deleted_at IS NULL
               LEFT JOIN branches b ON b.id = p.branch_id AND b.deleted_at IS NULL
               WHERE p.deleted_at IS NULL`;
    const params: any[] = [];
    if (filters.companyId) {
      sql += ' AND p.company_id = ?';
      params.push(filters.companyId);
    }
    if (filters.branchId) {
      sql += ' AND p.branch_id = ?';
      params.push(filters.branchId);
    }
    if (filters.policyType) {
      sql += ' AND p.policy_type = ?';
      params.push(filters.policyType);
    }
    if (filters.status && filters.status !== 'ALL') {
      sql += ' AND p.status = ?';
      params.push(filters.status);
    }
    sql += ' ORDER BY p.policy_type, p.name LIMIT 1000';

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.policyToResponse(r));
  }

  async findPolicyById(id: number): Promise<OrgPolicyResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT p.*, c.name AS company_name, b.name AS branch_name
       FROM org_policies p
       LEFT JOIN companies c ON c.id = p.company_id
       LEFT JOIN branches b ON b.id = p.branch_id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.policyToResponse(rows[0]) : null;
  }

  async createPolicy(data: Record<string, any>, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO org_policies
        (company_id, branch_id, policy_type, code, name, body, config_json,
         effective_from, effective_to, document_id, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.companyId ?? null,
        data.branchId ?? null,
        data.policyType,
        data.code,
        data.name,
        data.body ?? null,
        data.config === undefined ? null : JSON.stringify(data.config),
        data.effectiveFrom ?? null,
        data.effectiveTo ?? null,
        data.documentId ?? null,
        data.status ?? 'ACTIVE',
        userId,
        userId,
      ],
    );
    return Number(result.insertId);
  }

  async updatePolicy(id: number, patch: Record<string, any>, userId: number): Promise<void> {
    const map: Record<string, string> = {
      companyId: 'company_id',
      branchId: 'branch_id',
      policyType: 'policy_type',
      code: 'code',
      name: 'name',
      body: 'body',
      effectiveFrom: 'effective_from',
      effectiveTo: 'effective_to',
      documentId: 'document_id',
      status: 'status',
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [key, column] of Object.entries(map)) {
      if (patch[key] === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(patch[key] === '' ? null : patch[key]);
    }
    if (patch.config !== undefined) {
      sets.push('config_json = ?');
      params.push(patch.config === null ? null : JSON.stringify(patch.config));
    }
    if (sets.length === 0) return;
    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(`UPDATE org_policies SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params);
  }

  private policyToResponse(r: any): OrgPolicyResponse {
    return {
      id: Number(r.id),
      companyId: r.company_id === null ? null : Number(r.company_id),
      companyName: r.company_name ?? null,
      branchId: r.branch_id === null ? null : Number(r.branch_id),
      branchName: r.branch_name ?? null,
      policyType: r.policy_type,
      code: r.code,
      name: r.name,
      body: r.body ?? null,
      config: safeParse(r.config_json),
      effectiveFrom: r.effective_from ? toDateString(r.effective_from) : null,
      effectiveTo: r.effective_to ? toDateString(r.effective_to) : null,
      documentId: r.document_id === null ? null : Number(r.document_id),
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  // =========================================================================
  // Aggregates for OrgAnalyticsService — every one a single set-based query
  // =========================================================================

  async countAllEntities(): Promise<Record<string, number>> {
    const branches = Object.values(ENTITY_CONFIG).map(
      (cfg) => `SELECT '${cfg.slug}' AS k, COUNT(*) AS c FROM ${cfg.table} WHERE deleted_at IS NULL`,
    );
    branches.push("SELECT 'employees' AS k, COUNT(*) AS c FROM employees WHERE deleted_at IS NULL AND work_status = 'WORKING'");
    branches.push(
      `SELECT 'vacantSeats' AS k,
              COALESCE(SUM(GREATEST(p.headcount_budgeted - COALESCE(o.cnt, 0), 0)), 0) AS c
       FROM positions p
       LEFT JOIN (SELECT e.position_id AS ref, COUNT(*) AS cnt FROM employees e
                  WHERE ${WORKING} AND e.position_id IS NOT NULL GROUP BY e.position_id) o ON o.ref = p.id
       WHERE p.deleted_at IS NULL AND p.status <> 'CLOSED'`,
    );

    const rows = await this.query<any[]>(branches.join(' UNION ALL '));
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.k)] = Number(r.c ?? 0);
    return out;
  }

  /** Headcount grouped by one org dimension, unassigned employees included. */
  async getHeadcountBy(dimension: 'company' | 'department' | 'branch' | 'region'): Promise<OrgCountBucket[]> {
    const spec: Record<string, { idCol: string; table: string; textCol: string }> = {
      company: { idCol: 'company_id', table: 'companies', textCol: 'company' },
      department: { idCol: 'department_id', table: 'departments', textCol: 'department' },
      branch: { idCol: 'branch_id', table: 'branches', textCol: 'branch' },
      region: { idCol: 'region_id', table: 'regions', textCol: 'region' },
    };
    const s = spec[dimension]!;
    const rows = await this.query<any[]>(
      `SELECT e.${s.idCol} AS id,
              COALESCE(x.name, NULLIF(e.${s.textCol}, ''), 'Unassigned') AS label,
              COUNT(*) AS headcount
       FROM employees e
       LEFT JOIN ${s.table} x ON x.id = e.${s.idCol} AND x.deleted_at IS NULL
       WHERE ${WORKING}
       GROUP BY e.${s.idCol}, label
       ORDER BY headcount DESC, label ASC`,
    );
    return rows.map((r) => ({
      id: r.id === null ? null : Number(r.id),
      label: String(r.label),
      headcount: Number(r.headcount ?? 0),
    }));
  }

  async getWorkforceGrowth(months: number): Promise<WorkforceGrowthPoint[]> {
    const span = Math.min(60, Math.max(1, Math.floor(months)));
    const [joined, resigned] = await Promise.all([
      this.query<any[]>(
        `SELECT DATE_FORMAT(joined_at, '%Y-%m') AS m, COUNT(*) AS c
         FROM employees
         WHERE deleted_at IS NULL AND joined_at IS NOT NULL
           AND joined_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL ${span - 1} MONTH)
         GROUP BY m`,
      ),
      this.query<any[]>(
        `SELECT DATE_FORMAT(resigned_at, '%Y-%m') AS m, COUNT(*) AS c
         FROM employees
         WHERE deleted_at IS NULL AND resigned_at IS NOT NULL
           AND resigned_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL ${span - 1} MONTH)
         GROUP BY m`,
      ),
    ]);

    const joinedMap = new Map(joined.map((r) => [String(r.m), Number(r.c ?? 0)]));
    const resignedMap = new Map(resigned.map((r) => [String(r.m), Number(r.c ?? 0)]));

    const out: WorkforceGrowthPoint[] = [];
    const now = new Date();
    for (let i = span - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const j = joinedMap.get(key) ?? 0;
      const r = resignedMap.get(key) ?? 0;
      out.push({ month: key, joined: j, resigned: r, net: j - r });
    }
    return out;
  }

  async getBudgetUtilisation(): Promise<BudgetUtilisationRow[]> {
    const rows = await this.query<any[]>(
      `SELECT d.id, d.name, d.annual_budget,
              COALESCE(SUM(e.monthly_salary), 0) * 12 AS committed,
              COUNT(e.id) AS headcount,
              SUM(CASE WHEN e.id IS NOT NULL AND (e.monthly_salary IS NULL OR e.monthly_salary = 0) THEN 1 ELSE 0 END) AS no_fixed
       FROM departments d
       LEFT JOIN employees e ON e.department_id = d.id AND ${WORKING}
       WHERE d.deleted_at IS NULL
       GROUP BY d.id, d.name, d.annual_budget
       ORDER BY d.name`,
    );
    return rows.map((r) => {
      const budget = r.annual_budget === null ? null : Number(r.annual_budget);
      const committed = round2(Number(r.committed ?? 0));
      return {
        departmentId: Number(r.id),
        departmentName: r.name,
        annualBudget: budget,
        committedEstimate: committed,
        utilisationPct: budget && budget > 0 ? round2((committed / budget) * 100) : null,
        headcount: Number(r.headcount ?? 0),
        headcountWithoutFixedSalary: Number(r.no_fixed ?? 0),
      };
    });
  }

  async getSpanOfControl(limit: number): Promise<SpanOfControlRow[]> {
    const rows = await this.query<any[]>(
      `SELECT m.id, m.full_name, m.designation, d.name AS department_name, COUNT(e.id) AS direct_reports
       FROM employees m
       JOIN employees e ON e.reporting_manager_id = m.id AND ${WORKING}
       LEFT JOIN departments d ON d.id = m.department_id AND d.deleted_at IS NULL
       WHERE m.deleted_at IS NULL
       GROUP BY m.id, m.full_name, m.designation, d.name
       ORDER BY direct_reports DESC, m.full_name ASC
       LIMIT ${sanitizeLimit(limit, 10, 200)}`,
    );
    return rows.map((r) => ({
      managerId: Number(r.id),
      managerName: r.full_name,
      designation: r.designation ?? null,
      departmentName: r.department_name ?? null,
      directReports: Number(r.direct_reports ?? 0),
    }));
  }

  /** Raw numerators/denominators behind the health score. One round trip. */
  async getHealthFactorInputs(): Promise<Record<string, number>> {
    const parts = [
      "SELECT 'departments' AS k, COUNT(*) AS c FROM departments WHERE deleted_at IS NULL AND status = 'ACTIVE'",
      "SELECT 'departmentsWithHead', COUNT(*) FROM departments WHERE deleted_at IS NULL AND status = 'ACTIVE' AND head_employee_id IS NOT NULL",
      `SELECT 'employees', COUNT(*) FROM employees e WHERE ${WORKING}`,
      `SELECT 'employeesWithDepartment', COUNT(*) FROM employees e WHERE ${WORKING} AND e.department_id IS NOT NULL`,
      `SELECT 'employeesWithPosition', COUNT(*) FROM employees e WHERE ${WORKING} AND e.position_id IS NOT NULL`,
      `SELECT 'managers', COUNT(*) FROM (SELECT e.reporting_manager_id AS m, COUNT(*) AS c FROM employees e
        WHERE ${WORKING} AND e.reporting_manager_id IS NOT NULL GROUP BY e.reporting_manager_id) x`,
      `SELECT 'managersInBand', COUNT(*) FROM (SELECT e.reporting_manager_id AS m, COUNT(*) AS c FROM employees e
        WHERE ${WORKING} AND e.reporting_manager_id IS NOT NULL GROUP BY e.reporting_manager_id) x WHERE x.c BETWEEN 3 AND 10`,
      `SELECT 'budgetedSeats', COALESCE(SUM(p.headcount_budgeted), 0) FROM positions p
        WHERE p.deleted_at IS NULL AND p.status <> 'CLOSED'`,
      `SELECT 'vacantSeats', COALESCE(SUM(GREATEST(p.headcount_budgeted - COALESCE(o.cnt, 0), 0)), 0)
        FROM positions p
        LEFT JOIN (SELECT e.position_id AS ref, COUNT(*) AS cnt FROM employees e
                   WHERE ${WORKING} AND e.position_id IS NOT NULL GROUP BY e.position_id) o ON o.ref = p.id
        WHERE p.deleted_at IS NULL AND p.status <> 'CLOSED'`,
    ];
    const rows = await this.query<any[]>(parts.join(' UNION ALL '));
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.k)] = Number(r.c ?? 0);
    return out;
  }

  async getWorkforceGroup(groupBy: WorkforceGroupBy): Promise<WorkforceGroupRow[]> {
    const specs: Record<WorkforceGroupBy, { join: string; idExpr: string; labelExpr: string }> = {
      department: {
        join: 'LEFT JOIN departments x ON x.id = e.department_id AND x.deleted_at IS NULL',
        idExpr: 'e.department_id',
        labelExpr: "COALESCE(x.name, NULLIF(e.department, ''), 'Unassigned')",
      },
      branch: {
        join: 'LEFT JOIN branches x ON x.id = e.branch_id AND x.deleted_at IS NULL',
        idExpr: 'e.branch_id',
        labelExpr: "COALESCE(x.name, NULLIF(e.branch, ''), 'Unassigned')",
      },
      region: {
        join: 'LEFT JOIN regions x ON x.id = e.region_id AND x.deleted_at IS NULL',
        idExpr: 'e.region_id',
        labelExpr: "COALESCE(x.name, NULLIF(e.region, ''), 'Unassigned')",
      },
      company: {
        join: 'LEFT JOIN companies x ON x.id = e.company_id AND x.deleted_at IS NULL',
        idExpr: 'e.company_id',
        labelExpr: "COALESCE(x.name, NULLIF(e.company, ''), 'Unassigned')",
      },
      division: {
        join: 'LEFT JOIN divisions x ON x.id = e.division_id AND x.deleted_at IS NULL',
        idExpr: 'e.division_id',
        labelExpr: "COALESCE(x.name, NULLIF(e.division, ''), 'Unassigned')",
      },
      business_unit: {
        join: 'LEFT JOIN business_units x ON x.id = e.business_unit_id AND x.deleted_at IS NULL',
        idExpr: 'e.business_unit_id',
        labelExpr: "COALESCE(x.name, NULLIF(e.business_unit, ''), 'Unassigned')",
      },
      grade: {
        join: 'LEFT JOIN job_grades x ON x.id = e.job_grade_id AND x.deleted_at IS NULL',
        idExpr: 'e.job_grade_id',
        labelExpr: "COALESCE(x.name, NULLIF(e.grade, ''), 'Unassigned')",
      },
      employment_type: {
        join: '',
        idExpr: 'NULL',
        labelExpr: "COALESCE(e.employment_type, 'Unspecified')",
      },
      position: {
        join: 'LEFT JOIN positions x ON x.id = e.position_id AND x.deleted_at IS NULL',
        idExpr: 'e.position_id',
        labelExpr: "COALESCE(x.title, NULLIF(e.designation, ''), 'Unassigned')",
      },
    };
    const s = specs[groupBy];

    const rows = await this.query<any[]>(
      `SELECT ${s.idExpr} AS id, ${s.labelExpr} AS label,
              COUNT(*) AS headcount,
              SUM(CASE WHEN e.work_status = 'WORKING' THEN 1 ELSE 0 END) AS working_count,
              SUM(CASE WHEN e.work_status = 'RESIGN' THEN 1 ELSE 0 END) AS resigned_count,
              AVG(DATEDIFF(COALESCE(e.resigned_at, CURDATE()), e.joined_at)) / 365.25 AS avg_tenure
       FROM employees e
       ${s.join}
       WHERE e.deleted_at IS NULL
       GROUP BY ${s.idExpr}, label
       ORDER BY headcount DESC, label ASC`,
    );

    return rows.map((r) => ({
      id: r.id === null ? null : Number(r.id),
      label: String(r.label),
      headcount: Number(r.headcount ?? 0),
      workingCount: Number(r.working_count ?? 0),
      resignedCount: Number(r.resigned_count ?? 0),
      avgTenureYears: r.avg_tenure === null ? null : round2(Number(r.avg_tenure)),
    }));
  }

  /**
   * Cross-entity search in one UNION, then one grouped headcount query per
   * matched entity type — never a lookup per row.
   */
  async searchEntities(filters: OrgSearchFilters): Promise<OrgSearchResult[]> {
    const term = likeTerm(filters.q);
    const slugs = filters.entityType
      ? Object.values(ENTITY_CONFIG).filter((c) => c.slug === filters.entityType)
      : Object.values(ENTITY_CONFIG);
    if (slugs.length === 0) return [];

    const params: any[] = [];
    const branches = slugs.map((cfg) => {
      let where = `t.deleted_at IS NULL AND (t.code LIKE ? ESCAPE '!' OR t.${cfg.nameColumn} LIKE ? ESCAPE '!')`;
      params.push(term, term);
      if (cfg.hasStatus && filters.status && filters.status !== 'ALL') {
        where += ' AND t.status = ?';
        params.push(filters.status);
      }
      return `SELECT '${cfg.slug}' AS entity_type, t.id AS id, t.code AS code,
                     t.${cfg.nameColumn} AS name, CAST(${cfg.searchSubtitle} AS CHAR) AS subtitle
              FROM ${cfg.table} t WHERE ${where}`;
    });

    const limit = sanitizeLimit(filters.limit, 40, 500);
    const rows = await this.query<any[]>(
      `SELECT * FROM (${branches.join(' UNION ALL ')}) s ORDER BY s.name ASC LIMIT ${limit}`,
      params,
    );

    const results: OrgSearchResult[] = rows.map((r) => ({
      entityType: r.entity_type as OrgEntitySlug,
      id: Number(r.id),
      code: r.code ?? null,
      name: String(r.name),
      subtitle: r.subtitle ?? null,
      headcount: null,
    }));

    // One grouped headcount query per distinct entity type present in the page.
    const byType = new Map<OrgEntitySlug, OrgSearchResult[]>();
    for (const row of results) {
      const list = byType.get(row.entityType);
      if (list) list.push(row);
      else byType.set(row.entityType, [row]);
    }
    for (const [slug, list] of byType) {
      const counts = await this.getHeadcountForIds(slug, list.map((r) => r.id));
      if (!counts) continue;
      for (const row of list) row.headcount = counts.get(row.id) ?? 0;
    }
    return results;
  }

  /** Grouped headcount for a bounded id set, or null when the entity has none. */
  async getHeadcountForIds(slug: OrgEntitySlug, ids: number[]): Promise<Map<number, number> | null> {
    const cfg = ENTITY_CONFIG[slug];
    const clean = ids.filter((n) => Number.isFinite(n)).map((n) => Math.floor(n));
    if (clean.length === 0) return null;
    const placeholders = clean.map(() => '?').join(', ');

    if (slug === 'teams') {
      const rows = await this.query<any[]>(
        `SELECT team_id AS ref, COUNT(*) AS cnt FROM team_members
         WHERE left_on IS NULL AND team_id IN (${placeholders}) GROUP BY team_id`,
        clean,
      );
      return new Map(rows.map((r) => [Number(r.ref), Number(r.cnt ?? 0)]));
    }
    // Entities that reach employees through a join rather than a direct column.
    const INDIRECT: Partial<Record<OrgEntitySlug, string>> = {
      'cost-center-groups':
        'SELECT cc.group_id AS ref, COUNT(*) AS cnt FROM employees e JOIN cost_centers cc ON cc.id = e.cost_center_id' +
        ` WHERE ${WORKING} AND cc.group_id IN (%IDS%) GROUP BY cc.group_id`,
      'job-functions':
        'SELECT jr.job_function_id AS ref, COUNT(*) AS cnt FROM employees e JOIN job_roles jr ON jr.id = e.job_role_id' +
        ` WHERE ${WORKING} AND jr.job_function_id IN (%IDS%) GROUP BY jr.job_function_id`,
      'job-families':
        'SELECT jf.job_family_id AS ref, COUNT(*) AS cnt FROM employees e JOIN job_roles jr ON jr.id = e.job_role_id' +
        ' JOIN job_functions jf ON jf.id = jr.job_function_id' +
        ` WHERE ${WORKING} AND jf.job_family_id IN (%IDS%) GROUP BY jf.job_family_id`,
    };
    const indirect = INDIRECT[slug];
    if (indirect) {
      const rows = await this.query<any[]>(indirect.replace('%IDS%', placeholders), clean);
      return new Map(rows.map((r) => [Number(r.ref), Number(r.cnt ?? 0)]));
    }
    if (!cfg.employeeColumn) return null;

    const rows = await this.query<any[]>(
      `SELECT e.${cfg.employeeColumn} AS ref, COUNT(*) AS cnt FROM employees e
       WHERE ${WORKING} AND e.${cfg.employeeColumn} IN (${placeholders})
       GROUP BY e.${cfg.employeeColumn}`,
      clean,
    );
    return new Map(rows.map((r) => [Number(r.ref), Number(r.cnt ?? 0)]));
  }

  /** Flat employee export rows for `/organization/export/employees`. */
  async listEmployeeOrgRows(filters: { companyId?: number; departmentId?: number; branchId?: number; limit?: number }): Promise<any[]> {
    let sql = `SELECT e.id, e.emp_code, e.full_name, e.work_status, e.designation,
                      COALESCE(c.name, e.company) AS company_name,
                      COALESCE(bu.name, e.business_unit) AS business_unit_name,
                      COALESCE(dv.name, e.division) AS division_name,
                      COALESCE(d.name, e.department) AS department_name,
                      COALESCE(b.name, e.branch) AS branch_name,
                      COALESCE(r.name, e.region) AS region_name,
                      COALESCE(cc.name, e.cost_center) AS cost_center_name,
                      p.title AS position_title, g.code AS grade_code
               FROM employees e
               LEFT JOIN companies c       ON c.id = e.company_id
               LEFT JOIN business_units bu ON bu.id = e.business_unit_id
               LEFT JOIN divisions dv      ON dv.id = e.division_id
               LEFT JOIN departments d     ON d.id = e.department_id
               LEFT JOIN branches b        ON b.id = e.branch_id
               LEFT JOIN regions r         ON r.id = e.region_id
               LEFT JOIN cost_centers cc   ON cc.id = e.cost_center_id
               LEFT JOIN positions p       ON p.id = e.position_id
               LEFT JOIN job_grades g      ON g.id = e.job_grade_id
               WHERE e.deleted_at IS NULL`;
    const params: any[] = [];
    if (filters.companyId) {
      sql += ' AND e.company_id = ?';
      params.push(filters.companyId);
    }
    if (filters.departmentId) {
      sql += ' AND e.department_id = ?';
      params.push(filters.departmentId);
    }
    if (filters.branchId) {
      sql += ' AND e.branch_id = ?';
      params.push(filters.branchId);
    }
    sql += ` ORDER BY e.full_name LIMIT ${sanitizeLimit(filters.limit, 10000, 100000)}`;
    return this.query<any[]>(sql, params);
  }

  async employeeExists(employeeId: number): Promise<{ id: number; full_name: string } | null> {
    const rows = await this.query<any[]>(
      'SELECT id, full_name FROM employees WHERE id = ? AND deleted_at IS NULL',
      [employeeId],
    );
    return rows[0] ?? null;
  }

  // =========================================================================
  // Mapping
  // =========================================================================

  private headcountJoinFor(cfg: OrgEntityConfig): string {
    if (cfg.headcountJoin) return cfg.headcountJoin;
    if (!cfg.employeeColumn) return 'LEFT JOIN (SELECT NULL AS ref, 0 AS cnt) hc ON hc.ref = t.id';
    return (
      `LEFT JOIN (SELECT e.${cfg.employeeColumn} AS ref, COUNT(*) AS cnt FROM employees e` +
      ` WHERE ${WORKING} AND e.${cfg.employeeColumn} IS NOT NULL` +
      ` GROUP BY e.${cfg.employeeColumn}) hc ON hc.ref = t.id`
    );
  }

  /** snake_case row -> camelCase response, with driver-typed values normalised. */
  private toResponse(cfg: OrgEntityConfig, row: OrgEntityRow): OrgEntityResponse {
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
      out[toCamel(key)] = normaliseValue(key, value);
    }
    // `positions` names its label column `title`; expose `name` too so generic
    // UI (search results, pickers, CSV) can rely on one field everywhere.
    if (cfg.nameColumn !== 'name') out.name = row[cfg.nameColumn] ?? null;
    out.entityType = cfg.slug;

    if (cfg.slug === 'positions') {
      const budgeted = Number(row.headcount_budgeted ?? 0);
      const occupancy = Number(row.headcount ?? 0);
      out.occupancy = occupancy;
      out.vacancies = Math.max(0, budgeted - occupancy);
    }
    if (cfg.slug === 'departments') {
      const planned = row.planned_headcount === null || row.planned_headcount === undefined
        ? null
        : Number(row.planned_headcount);
      out.vacancies = planned === null ? null : Math.max(0, planned - Number(row.headcount ?? 0));
    }
    return out as OrgEntityResponse;
  }
}

// ---------------------------------------------------------------------------
// Module-local helpers
// ---------------------------------------------------------------------------

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

function normaliseValue(key: string, value: unknown): unknown {
  if (value instanceof Date) {
    // `*_at` columns are timestamps; everything else dated is a plain date.
    return key.endsWith('_at') ? value.toISOString() : toDateString(value);
  }
  if (key.startsWith('is_') || key.startsWith('has_')) return !!value;
  return value;
}

function safeParse(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return String(value);
  }
}
