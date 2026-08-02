/**
 * Organization management types.
 *
 * The module is driven by one generic entity engine rather than 17 hand-written
 * repositories, so most row shapes are intentionally open (`OrgEntityRow`) and
 * the response shape is the camelCased projection of whatever the entity's
 * config selected. The named interfaces below cover everything that is *not*
 * generic: trees, charts, audit, analytics and the relationship tables.
 */

// ---------------------------------------------------------------------------
// Entity slugs
// ---------------------------------------------------------------------------

/** Every slug the generic CRUD engine understands. Order drives search order. */
export const ORG_ENTITY_SLUGS = [
  'companies',
  'legal-entities',
  'regions',
  'business-units',
  'divisions',
  'departments',
  'branches',
  'locations',
  'cost-center-groups',
  'cost-centers',
  'teams',
  'job-families',
  'job-functions',
  'job-grades',
  'job-levels',
  'job-roles',
  'positions',
] as const;

export type OrgEntitySlug = (typeof ORG_ENTITY_SLUGS)[number];

export function isOrgEntitySlug(value: string): value is OrgEntitySlug {
  return (ORG_ENTITY_SLUGS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Generic rows and responses
// ---------------------------------------------------------------------------

/** A raw row straight out of mysql2 — snake_case keys, driver-typed values. */
export interface OrgEntityRow {
  [column: string]: any;
}

/** The camelCased projection handed back to the API. */
export interface OrgEntityResponse {
  id: number;
  code: string | null;
  name: string;
  status?: string | null;
  headcount?: number;
  [key: string]: any;
}

export interface OrgListFilters {
  q?: string;
  status?: string;
  companyId?: number;
  parentId?: number;
  legalEntityId?: number;
  businessUnitId?: number;
  divisionId?: number;
  departmentId?: number;
  branchId?: number;
  regionId?: number;
  groupId?: number;
  costCenterId?: number;
  jobFamilyId?: number;
  jobFunctionId?: number;
  jobRoleId?: number;
  jobGradeId?: number;
  jobLevelId?: number;
  teamId?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Actor / audit
// ---------------------------------------------------------------------------

/** Who performed a mutation, and from where. Built by the controller. */
export interface OrgActor {
  userId: number;
  name: string;
  role: string;
  ip?: string | null;
  device?: string | null;
  browser?: string | null;
}

export type OrgAuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'RESTORE'
  | 'ACTIVATE'
  | 'DEACTIVATE'
  | 'REPARENT'
  | 'TRANSFER'
  | 'ASSIGN'
  | 'UNASSIGN'
  | 'IMPORT'
  | 'APPROVE'
  | 'REJECT';

export interface OrgAuditInput {
  entityType: string;
  entityId?: number | null;
  entityName?: string | null;
  action: OrgAuditAction;
  actor: OrgActor;
  summary: string;
  previousValue?: unknown;
  newValue?: unknown;
}

export interface OrgAuditEntry {
  id: number;
  entityType: string;
  entityId: number | null;
  entityName: string | null;
  action: OrgAuditAction;
  actorUserId: number | null;
  actorName: string | null;
  actorRole: string | null;
  summary: string | null;
  previousValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  device: string | null;
  browser: string | null;
  createdAt: string;
}

export interface OrgAuditFilters {
  entityType?: string;
  entityId?: number;
  action?: string;
  actorUserId?: number;
  from?: string;
  to?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Structural tree
// ---------------------------------------------------------------------------

export type OrgTreeNodeType =
  | 'company'
  | 'business_unit'
  | 'division'
  | 'department'
  | 'team'
  | 'employee';

export interface OrgTreeNode {
  type: OrgTreeNodeType;
  id: number;
  code: string | null;
  name: string;
  status: string | null;
  headEmployeeId: number | null;
  headName: string | null;
  /** Employees whose deepest org assignment is exactly this node. */
  directHeadcount: number;
  /** directHeadcount rolled up over the whole subtree. */
  headcount: number;
  /** Departments only; null when nobody planned a headcount. */
  plannedHeadcount: number | null;
  /** Departments only; `planned - headcount` floored at 0, null when unplanned. */
  vacancies: number | null;
  children: OrgTreeNode[];
}

export interface OrgTreeOptions {
  rootType?: string;
  rootId?: number;
  includeTeams?: boolean;
  includeEmployees?: boolean;
}

export interface OrgTreeResult {
  generatedAt: string;
  rootType: string | null;
  rootId: number | null;
  includeTeams: boolean;
  includeEmployees: boolean;
  /** True when the employee leaf list hit its safety cap. */
  truncatedEmployees: boolean;
  totals: { nodes: number; headcount: number };
  nodes: OrgTreeNode[];
}

// ---------------------------------------------------------------------------
// Reporting chart
// ---------------------------------------------------------------------------

export interface ReportingChartNode {
  id: number;
  empCode: string;
  name: string;
  designation: string | null;
  positionTitle: string | null;
  departmentId: number | null;
  departmentName: string | null;
  branchName: string | null;
  gradeCode: string | null;
  photoUrl: string | null;
  managerId: number | null;
  level: number;
  directReports: number;
  /** Size of the subtree below this node. */
  totalReports: number;
  children: ReportingChartNode[];
}

export interface ReportingChartResult {
  generatedAt: string;
  rootEmployeeId: number | null;
  depth: number | null;
  totalEmployees: number;
  /** Employees dropped because their manager link formed a cycle. */
  cyclesBroken: number;
  nodes: ReportingChartNode[];
}

export interface PositionChartNode {
  id: number;
  code: string;
  title: string;
  status: string;
  departmentId: number | null;
  departmentName: string | null;
  reportsToPositionId: number | null;
  headcountBudgeted: number;
  occupancy: number;
  vacancies: number;
  children: PositionChartNode[];
}

export interface PositionChartResult {
  generatedAt: string;
  totalPositions: number;
  totalBudgetedSeats: number;
  totalOccupied: number;
  totalVacant: number;
  nodes: PositionChartNode[];
}

// ---------------------------------------------------------------------------
// Relationship tables
// ---------------------------------------------------------------------------

export type ReportingRelationshipType =
  | 'DIRECT'
  | 'MATRIX'
  | 'FUNCTIONAL'
  | 'ADMINISTRATIVE'
  | 'DOTTED_LINE'
  | 'ESCALATION'
  | 'DELEGATION';

export interface ReportingRelationshipResponse {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  managerEmployeeId: number;
  managerName: string;
  managerCode: string;
  relationshipType: ReportingRelationshipType;
  context: string | null;
  allocationPct: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string;
}

export interface CreateReportingInput {
  employeeId: number;
  managerEmployeeId: number;
  relationshipType?: ReportingRelationshipType;
  context?: string | null;
  allocationPct?: number | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  isPrimary?: boolean;
  notes?: string | null;
}

export interface TeamMemberResponse {
  id: number;
  teamId: number;
  teamName: string;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  designation: string | null;
  roleInTeam: string | null;
  allocationPct: number;
  joinedOn: string | null;
  leftOn: string | null;
}

export interface CareerPathResponse {
  id: number;
  fromRoleId: number;
  fromRoleName: string;
  fromRoleCode: string;
  toRoleId: number;
  toRoleName: string;
  toRoleCode: string;
  typicalYears: number | null;
  notes: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Change requests and policies
// ---------------------------------------------------------------------------

export type OrgChangeRequestStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'APPLIED'
  | 'CANCELLED';

export interface OrgChangeRequestResponse {
  id: number;
  requestType: string;
  entityType: string | null;
  entityId: number | null;
  employeeId: number | null;
  employeeName: string | null;
  title: string;
  justification: string | null;
  proposed: unknown;
  current: unknown;
  effectiveDate: string | null;
  status: OrgChangeRequestStatus;
  requestedBy: number | null;
  requestedByName: string | null;
  decidedBy: number | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  appliedAt: string | null;
  createdAt: string;
}

export interface OrgPolicyResponse {
  id: number;
  companyId: number | null;
  companyName: string | null;
  branchId: number | null;
  branchName: string | null;
  policyType: string;
  code: string;
  name: string;
  body: string | null;
  config: unknown;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  documentId: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface OrgCountBucket {
  id: number | null;
  label: string;
  headcount: number;
}

export interface WorkforceGrowthPoint {
  month: string;
  joined: number;
  resigned: number;
  net: number;
}

export interface BudgetUtilisationRow {
  departmentId: number;
  departmentName: string;
  annualBudget: number | null;
  /** SUM(monthly_salary) * 12 over the department's working employees. */
  committedEstimate: number;
  utilisationPct: number | null;
  headcount: number;
  /** Workers with no fixed monthly salary (piece-rate) — excluded from the estimate. */
  headcountWithoutFixedSalary: number;
}

export interface SpanOfControlRow {
  managerId: number;
  managerName: string;
  designation: string | null;
  departmentName: string | null;
  directReports: number;
}

export interface HealthFactor {
  key: string;
  label: string;
  /** 0-100. */
  value: number;
  weight: number;
  detail: string;
}

export interface OrgHealthScore {
  score: number;
  grade: string;
  factors: HealthFactor[];
}

export interface OrgTotals {
  companies: number;
  legalEntities: number;
  regions: number;
  businessUnits: number;
  divisions: number;
  departments: number;
  branches: number;
  locations: number;
  costCenterGroups: number;
  costCenters: number;
  teams: number;
  jobFamilies: number;
  jobFunctions: number;
  jobGrades: number;
  jobLevels: number;
  jobRoles: number;
  positions: number;
  employees: number;
  vacantSeats: number;
}

export interface OrgDashboard {
  generatedAt: string;
  totals: OrgTotals;
  headcountByCompany: OrgCountBucket[];
  headcountByDepartment: OrgCountBucket[];
  headcountByBranch: OrgCountBucket[];
  headcountByRegion: OrgCountBucket[];
  workforceGrowth: WorkforceGrowthPoint[];
  budgetUtilisation: {
    basis: string;
    note: string;
    rows: BudgetUtilisationRow[];
  };
  spanOfControl: SpanOfControlRow[];
  healthScore: OrgHealthScore;
}

export interface OrgSearchResult {
  entityType: OrgEntitySlug;
  id: number;
  code: string | null;
  name: string;
  subtitle: string | null;
  headcount: number | null;
}

export interface OrgSearchFilters {
  q: string;
  entityType?: string;
  status?: string;
  limit?: number;
}

export type WorkforceGroupBy =
  | 'department'
  | 'branch'
  | 'region'
  | 'company'
  | 'division'
  | 'business_unit'
  | 'grade'
  | 'employment_type'
  | 'position';

export interface WorkforceGroupRow {
  id: number | null;
  label: string;
  headcount: number;
  workingCount: number;
  resignedCount: number;
  avgTenureYears: number | null;
}

export interface WorkforceResult {
  groupBy: WorkforceGroupBy;
  totalHeadcount: number;
  rows: WorkforceGroupRow[];
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

export interface BulkImportResult {
  slug: OrgEntitySlug;
  created: number;
  updated: number;
  failed: Array<{ row: number; code?: string; reason: string }>;
}

export interface BulkTransferInput {
  employeeIds: number[];
  departmentId?: number | null;
  branchId?: number | null;
  costCenterId?: number | null;
  effectiveDate?: string | null;
}

export interface BulkTransferResult {
  succeeded: Array<{ employeeId: number; employeeName: string }>;
  failed: Array<{ employeeId: number; reason: string }>;
  /** The module has no effective-dated org assignment table; see note. */
  effectiveDate: string | null;
  note: string;
}

export interface ReparentInput {
  entityType: string;
  id: number;
  newParentId: number | null;
  newParentType?: string;
}

export interface ReparentResult {
  entityType: string;
  id: number;
  name: string;
  previousParentId: number | null;
  newParentId: number | null;
  parentType: string;
  message: string;
}
