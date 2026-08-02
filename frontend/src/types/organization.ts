// Organization management types. Mirrors the backend organization schema.

export type EntityStatus = 'ACTIVE' | 'INACTIVE';
export type CompanyType = 'HOLDING' | 'SUBSIDIARY' | 'BRANCH_OFFICE' | 'FRANCHISE' | 'JOINT_VENTURE' | 'STANDALONE';
export type RegionType = 'GLOBAL' | 'COUNTRY' | 'STATE' | 'ZONE' | 'TERRITORY' | 'SALES' | 'OPERATIONAL';
export type BranchType = 'HEAD_OFFICE' | 'CORPORATE' | 'FACTORY' | 'SALES' | 'WAREHOUSE' | 'SERVICE' | 'REMOTE';
export type LocationType = 'OFFICE' | 'WORK_SITE' | 'PLANT' | 'WAREHOUSE' | 'MANUFACTURING_UNIT' | 'REMOTE' | 'CLIENT_SITE';
export type DivisionType = 'FUNCTIONAL' | 'OPERATIONAL' | 'SUPPORT' | 'SHARED_SERVICE';
export type TeamType = 'FUNCTIONAL' | 'CROSS_FUNCTIONAL' | 'PROJECT' | 'SHIFT' | 'OTHER';
export type CostCenterType = 'COST' | 'PROFIT' | 'EXPENSE' | 'INVESTMENT';
export type PositionStatus = 'OPEN' | 'FILLED' | 'ON_HOLD' | 'CLOSED';
export type ReportingType =
  | 'DIRECT' | 'MATRIX' | 'FUNCTIONAL' | 'ADMINISTRATIVE' | 'DOTTED_LINE' | 'ESCALATION' | 'DELEGATION';
export type OrgChangeStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'CANCELLED';
export type OrgAuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE' | 'ACTIVATE' | 'DEACTIVATE'
  | 'REPARENT' | 'TRANSFER' | 'ASSIGN' | 'UNASSIGN' | 'IMPORT' | 'APPROVE' | 'REJECT';

/** Every org entity shares this shape in lists and trees. */
export interface OrgEntityBase {
  id: number;
  code: string;
  name: string;
  status: string;
  headcount?: number;
  headEmployeeId?: number | null;
  headEmployeeName?: string | null;
}

export interface Company extends OrgEntityBase {
  shortName: string | null;
  parentCompanyId: number | null;
  companyType: CompanyType;
  industryType: string | null;
  registrationNo: string | null;
  cin: string | null;
  gstin: string | null;
  vatNumber: string | null;
  pan: string | null;
  tan: string | null;
  incorporatedOn: string | null;
  fiscalYearStartMonth: number;
  baseCurrency: string;
  defaultLanguage: string;
  defaultTimezone: string;
  country: string;
  corporateAddress: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  isPayrollCompany: boolean;
}

export interface LegalEntity extends OrgEntityBase {
  companyId: number;
  entityType: string;
  registrationNo: string | null;
  taxId: string | null;
  gstin: string | null;
  country: string;
  state: string | null;
  registeredAddress: string | null;
  currency: string;
  isPayrollEntity: boolean;
}

export interface Region extends OrgEntityBase {
  regionType: RegionType;
  parentRegionId: number | null;
  country: string | null;
}

export interface BusinessUnit extends OrgEntityBase {
  companyId: number;
  parentBusinessUnitId: number | null;
  description: string | null;
  annualBudget: number | null;
  budgetCurrency: string;
}

export interface Division extends OrgEntityBase {
  companyId: number;
  businessUnitId: number | null;
  parentDivisionId: number | null;
  divisionType: DivisionType;
  description: string | null;
}

export interface Department extends OrgEntityBase {
  companyId: number;
  divisionId: number | null;
  parentDepartmentId: number | null;
  costCenterId: number | null;
  description: string | null;
  objectives: string | null;
  annualBudget: number | null;
  plannedHeadcount: number | null;
  vacancies?: number;
}

export interface Branch extends OrgEntityBase {
  companyId: number;
  regionId: number | null;
  branchType: BranchType;
  managerEmployeeId: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  currency: string;
  language: string;
  contactEmail: string | null;
  contactPhone: string | null;
  openedOn: string | null;
}

export interface OrgLocation extends OrgEntityBase {
  companyId: number;
  branchId: number | null;
  locationType: LocationType;
  address: string | null;
  city: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  capacity: number | null;
}

export interface CostCenterGroup extends OrgEntityBase {
  companyId: number;
  description: string | null;
}

export interface CostCenter extends OrgEntityBase {
  companyId: number;
  groupId: number | null;
  groupName?: string | null;
  centerType: CostCenterType;
  parentCostCenterId: number | null;
  ownerEmployeeId: number | null;
  departmentId: number | null;
  branchId: number | null;
  glAccount: string | null;
  annualBudget: number | null;
  budgetCurrency: string;
  fiscalYear: string | null;
}

export interface Team extends OrgEntityBase {
  companyId: number;
  departmentId: number | null;
  departmentName?: string | null;
  teamType: TeamType;
  leadEmployeeId: number | null;
  leadEmployeeName?: string | null;
  capacity: number | null;
  objectives: string | null;
  startDate: string | null;
  endDate: string | null;
  memberCount?: number;
}

export interface TeamMember {
  id: number;
  teamId: number;
  employeeId: number;
  employeeName: string;
  empCode: string;
  roleInTeam: string | null;
  allocationPct: number;
  joinedOn: string | null;
  leftOn: string | null;
}

export interface JobFamily extends OrgEntityBase {
  description: string | null;
}
export interface JobFunction extends OrgEntityBase {
  jobFamilyId: number;
  jobFamilyName?: string | null;
  description: string | null;
}
export interface JobGrade extends OrgEntityBase {
  rankOrder: number;
  minSalary: number | null;
  maxSalary: number | null;
  currency: string;
  description: string | null;
}
export interface JobLevel extends OrgEntityBase {
  rankOrder: number;
  careerStage: string;
  description: string | null;
}
export interface JobRole extends OrgEntityBase {
  jobFunctionId: number | null;
  jobFunctionName?: string | null;
  jobGradeId: number | null;
  jobGradeCode?: string | null;
  jobLevelId: number | null;
  jobLevelCode?: string | null;
  description: string | null;
  responsibilities: string | null;
}

export interface CareerPath {
  id: number;
  fromRoleId: number;
  fromRoleName: string;
  toRoleId: number;
  toRoleName: string;
  typicalYears: number | null;
  notes: string | null;
}

export interface Position extends OrgEntityBase {
  companyId: number;
  title: string;
  jobRoleId: number | null;
  jobRoleName?: string | null;
  departmentId: number | null;
  departmentName?: string | null;
  branchId: number | null;
  branchName?: string | null;
  costCenterId: number | null;
  reportsToPositionId: number | null;
  reportsToTitle?: string | null;
  jobGradeId: number | null;
  jobLevelId: number | null;
  headcountBudgeted: number;
  budgetAmount: number | null;
  employmentType: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  occupiedBy?: { employeeId: number; employeeName: string; empCode: string }[];
  occupancy?: number;
  vacancies?: number;
}

export interface ReportingRelationship {
  id: number;
  employeeId: number;
  employeeName: string;
  empCode: string;
  managerEmployeeId: number;
  managerName: string;
  relationshipType: ReportingType;
  context: string | null;
  allocationPct: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isPrimary: boolean;
  notes: string | null;
}

export interface OrgChangeRequest {
  id: number;
  requestType: string;
  entityType: string | null;
  entityId: number | null;
  employeeId: number | null;
  employeeName?: string | null;
  title: string;
  justification: string | null;
  effectiveDate: string | null;
  status: OrgChangeStatus;
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface OrgAuditEntry {
  id: number;
  entityType: string;
  entityId: number | null;
  entityName: string | null;
  action: OrgAuditAction;
  actorName: string | null;
  actorRole: string | null;
  summary: string | null;
  previousValue: string | null;
  newValue: string | null;
  ipAddress: string | null;
  device: string | null;
  browser: string | null;
  createdAt: string;
}

export interface OrgPolicy {
  id: number;
  companyId: number | null;
  branchId: number | null;
  policyType: string;
  code: string;
  name: string;
  body: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: string;
}

/** A node in the structure tree or the reporting chart. */
export interface OrgTreeNode {
  key: string;
  entityType: 'company' | 'business_unit' | 'division' | 'department' | 'team' | 'branch' | 'location' | 'region' | 'cost_center' | 'position' | 'employee';
  id: number;
  code: string | null;
  name: string;
  subtitle?: string | null;
  headcount: number;
  vacancies?: number;
  status?: string;
  children: OrgTreeNode[];
}

export interface OrgChartNodeFull {
  employeeId: number;
  empCode: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  photoUrl: string | null;
  directReports: number;
  totalReports: number;
  reports: OrgChartNodeFull[];
}

export interface OrgDashboard {
  totals: {
    companies: number;
    legalEntities: number;
    businessUnits: number;
    divisions: number;
    departments: number;
    branches: number;
    locations: number;
    teams: number;
    costCenters: number;
    positions: number;
    employees: number;
    vacantSeats: number;
  };
  headcountByCompany: { name: string; headcount: number }[];
  headcountByDepartment: { name: string; headcount: number; planned: number | null; vacancies: number }[];
  headcountByBranch: { name: string; headcount: number }[];
  headcountByRegion: { name: string; headcount: number }[];
  workforceGrowth: { month: string; joined: number; resigned: number; net: number }[];
  budgetUtilisation: { name: string; budget: number; committed: number; pct: number }[];
  /** Why committed cost is an estimate — surfaced verbatim from the API. */
  budgetNote?: string | null;
  spanOfControl: { managerName: string; directReports: number }[];
  healthScore: { score: number; factors: { label: string; value: number; weight: number; detail: string }[] };
}

export const ORG_ENTITY_LABELS: Record<string, string> = {
  company: 'Company',
  legal_entity: 'Legal entity',
  business_unit: 'Business unit',
  division: 'Division',
  department: 'Department',
  branch: 'Branch',
  location: 'Location',
  region: 'Region',
  cost_center: 'Cost centre',
  team: 'Team',
  position: 'Position',
  employee: 'Employee',
};
