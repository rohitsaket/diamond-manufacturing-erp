// Typed helpers for the organization management endpoints.
import { api, BASE_URL } from './client';
import type {
  Company, LegalEntity, Region, BusinessUnit, Division, Department, Branch, OrgLocation,
  CostCenter, CostCenterGroup, Team, TeamMember, JobFamily, JobFunction, JobGrade, JobLevel,
  JobRole, CareerPath, Position, ReportingRelationship, OrgChangeRequest, OrgAuditEntry,
  OrgPolicy, OrgTreeNode, OrgChartNodeFull, OrgDashboard,
} from '../types/organization';

const qs = (params: Record<string, unknown> = {}): string => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    search.append(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

// ---------------------------------------------------------------------------
// Response adapters. The API returns enveloped payloads with its own field
// names; everything below normalises them onto the shared types so no view has
// to know the difference.
// ---------------------------------------------------------------------------
interface TreeEnvelope {
  nodes?: RawTreeNode[];
  totals?: { nodes: number; headcount: number };
  truncatedEmployees?: boolean;
}
interface RawTreeNode {
  type: string;
  id: number;
  code: string | null;
  name: string;
  status?: string;
  headName?: string | null;
  headEmployeeId?: number | null;
  directHeadcount?: number;
  headcount?: number;
  plannedHeadcount?: number | null;
  vacancies?: number | null;
  children?: RawTreeNode[];
}

function toTreeNode(raw: RawTreeNode): OrgTreeNode {
  return {
    key: `${raw.type}-${raw.id}`,
    entityType: raw.type as OrgTreeNode['entityType'],
    id: raw.id,
    code: raw.code ?? null,
    name: raw.name,
    subtitle: raw.headName ?? null,
    headcount: Number(raw.headcount ?? 0),
    vacancies: raw.vacancies ?? undefined,
    status: raw.status,
    children: (raw.children ?? []).map(toTreeNode),
  };
}

interface ChartEnvelope {
  nodes?: RawChartNode[];
  totalEmployees?: number;
  cyclesBroken?: number;
}
interface RawChartNode {
  id: number;
  empCode: string;
  name: string;
  designation: string | null;
  departmentName: string | null;
  photoUrl: string | null;
  directReports?: number;
  totalReports?: number;
  children?: RawChartNode[];
}

function toChartNode(raw: RawChartNode): OrgChartNodeFull {
  return {
    employeeId: raw.id,
    empCode: raw.empCode,
    fullName: raw.name,
    designation: raw.designation ?? null,
    department: raw.departmentName ?? null,
    photoUrl: raw.photoUrl ?? null,
    directReports: Number(raw.directReports ?? 0),
    totalReports: Number(raw.totalReports ?? 0),
    reports: (raw.children ?? []).map(toChartNode),
  };
}

interface RawLabelled { id?: number; label?: string; headcount?: number }
interface RawWorkforceRow extends RawLabelled { planned?: number | null; vacancies?: number }
interface RawDashboard {
  totals?: Record<string, number>;
  headcountByCompany?: RawLabelled[];
  headcountByDepartment?: RawLabelled[];
  headcountByBranch?: RawLabelled[];
  headcountByRegion?: RawLabelled[];
  workforceGrowth?: { month: string; joined: number; resigned: number; net: number }[];
  budgetUtilisation?: {
    basis?: string;
    note?: string;
    rows?: { departmentName?: string; annualBudget?: number; committedEstimate?: number; utilisationPct?: number }[];
  };
  spanOfControl?: { managerName?: string; directReports?: number }[];
  healthScore?: OrgDashboard['healthScore'];
}

/** Entity slugs the generic CRUD routes accept. */
export const ORG_ENTITIES = [
  'companies', 'legal-entities', 'regions', 'business-units', 'divisions',
  'departments', 'branches', 'locations', 'cost-center-groups', 'cost-centers',
  'teams', 'job-families', 'job-functions', 'job-grades', 'job-levels', 'job-roles', 'positions',
] as const;

export type OrgEntitySlug = (typeof ORG_ENTITIES)[number];

/** Generic CRUD, one shape for every entity. */
function crud<T>(slug: OrgEntitySlug) {
  return {
    list: (params: Record<string, unknown> = {}) => api.get<T[]>(`/organization/${slug}${qs(params)}`),
    get: (id: number) => api.get<T>(`/organization/${slug}/${id}`),
    create: (body: Partial<T>) => api.post<T>(`/organization/${slug}`, body),
    update: (id: number, body: Partial<T>) => api.put<T>(`/organization/${slug}/${id}`, body),
    remove: (id: number) => api.delete<{ success: boolean }>(`/organization/${slug}/${id}`),
  };
}

export const orgApi = {
  companies: crud<Company>('companies'),
  legalEntities: crud<LegalEntity>('legal-entities'),
  regions: crud<Region>('regions'),
  businessUnits: crud<BusinessUnit>('business-units'),
  divisions: crud<Division>('divisions'),
  departments: crud<Department>('departments'),
  branches: crud<Branch>('branches'),
  locations: crud<OrgLocation>('locations'),
  costCenterGroups: crud<CostCenterGroup>('cost-center-groups'),
  costCenters: crud<CostCenter>('cost-centers'),
  teams: crud<Team>('teams'),
  jobFamilies: crud<JobFamily>('job-families'),
  jobFunctions: crud<JobFunction>('job-functions'),
  jobGrades: crud<JobGrade>('job-grades'),
  jobLevels: crud<JobLevel>('job-levels'),
  jobRoles: crud<JobRole>('job-roles'),
  positions: crud<Position>('positions'),

  // Team membership -----------------------------------------------------------
  teamMembers: (teamId: number) => api.get<TeamMember[]>(`/organization/teams/${teamId}/members`),
  addTeamMember: (teamId: number, body: { employeeId: number; roleInTeam?: string; allocationPct?: number }) =>
    api.post<TeamMember>(`/organization/teams/${teamId}/members`, body),
  removeTeamMember: (teamId: number, employeeId: number) =>
    api.delete<{ success: boolean }>(`/organization/teams/${teamId}/members/${employeeId}`),

  // Career paths --------------------------------------------------------------
  careerPaths: () => api.get<CareerPath[]>('/organization/career-paths'),
  createCareerPath: (body: { fromRoleId: number; toRoleId: number; typicalYears?: number; notes?: string }) =>
    api.post<CareerPath>('/organization/career-paths', body),
  deleteCareerPath: (id: number) => api.delete<{ success: boolean }>(`/organization/career-paths/${id}`),

  // Structure and charts ------------------------------------------------------
  // The endpoints wrap their nodes in an envelope and use slightly different
  // field names; these adapters keep the translation in one place so the views
  // can stay on the shared types.
  tree: async (params: { rootType?: string; rootId?: number; includeTeams?: boolean; includeEmployees?: boolean } = {}) => {
    const res = await api.get<TreeEnvelope>(`/organization/tree${qs(params)}`);
    return (res?.nodes ?? []).map(toTreeNode);
  },
  treeEnvelope: (params: Record<string, unknown> = {}) =>
    api.get<TreeEnvelope>(`/organization/tree${qs(params)}`),
  chart: async (params: { rootEmployeeId?: number; depth?: number } = {}) => {
    const res = await api.get<ChartEnvelope>(`/organization/chart${qs(params)}`);
    return (res?.nodes ?? []).map(toChartNode);
  },
  positionChart: async () => {
    const res = await api.get<TreeEnvelope>('/organization/position-chart');
    return (res?.nodes ?? []).map(toTreeNode);
  },
  /** Moves an entity (or an employee) under a new parent. */
  reparent: (body: { entityType: string; id: number; newParentType?: string; newParentId: number | null }) =>
    api.put<{ success: boolean }>('/organization/reparent', body),

  // Reporting relationships ---------------------------------------------------
  reporting: (params: { employeeId?: number; managerId?: number; type?: string } = {}) =>
    api.get<ReportingRelationship[]>(`/organization/reporting${qs(params)}`),
  createReporting: (body: Partial<ReportingRelationship>) =>
    api.post<ReportingRelationship>('/organization/reporting', body),
  deleteReporting: (id: number) => api.delete<{ success: boolean }>(`/organization/reporting/${id}`),

  // Analytics, search, workflow, audit ----------------------------------------
  /**
   * The dashboard reports headcount by department without the planned figure,
   * so it is enriched from the department list — that is what makes the
   * headcount-versus-planned comparison meaningful.
   */
  dashboard: async (): Promise<OrgDashboard> => {
    const [raw, departments] = await Promise.all([
      api.get<RawDashboard>('/organization/dashboard'),
      api.get<Department[]>('/organization/departments').catch(() => [] as Department[]),
    ]);
    const plannedByName = new Map<string, { planned: number | null; vacancies: number }>();
    for (const d of departments ?? []) {
      plannedByName.set(d.name, {
        planned: d.plannedHeadcount ?? null,
        vacancies: Number(d.vacancies ?? 0),
      });
    }
    const label = (rows?: RawLabelled[]) =>
      (rows ?? []).map((r) => ({ name: r.label ?? '—', headcount: Number(r.headcount ?? 0) }));

    return {
      totals: (raw?.totals ?? {}) as OrgDashboard['totals'],
      headcountByCompany: label(raw?.headcountByCompany),
      headcountByDepartment: (raw?.headcountByDepartment ?? []).map((r) => {
        const extra = plannedByName.get(r.label ?? '');
        return {
          name: r.label ?? '—',
          headcount: Number(r.headcount ?? 0),
          planned: extra?.planned ?? null,
          vacancies: extra?.vacancies ?? 0,
        };
      }),
      headcountByBranch: label(raw?.headcountByBranch),
      headcountByRegion: label(raw?.headcountByRegion),
      workforceGrowth: raw?.workforceGrowth ?? [],
      // Served as {basis, note, rows} — the note explains that committed cost is
      // estimated from fixed monthly salary only.
      budgetUtilisation: (raw?.budgetUtilisation?.rows ?? []).map((r) => ({
        name: r.departmentName ?? '—',
        budget: Number(r.annualBudget ?? 0),
        committed: Number(r.committedEstimate ?? 0),
        pct: Number(r.utilisationPct ?? 0),
      })),
      budgetNote: raw?.budgetUtilisation?.note ?? null,
      spanOfControl: (raw?.spanOfControl ?? []).map((r) => ({
        managerName: r.managerName ?? '—',
        directReports: Number(r.directReports ?? 0),
      })),
      healthScore: raw?.healthScore ?? { score: 0, factors: [] },
    };
  },
  search: async (params: { q?: string; entityType?: string; status?: string; limit?: number } = {}) => {
    const rows = await api.get<
      { entityType: string; id: number; code: string | null; name: string; subtitle: string | null; headcount: number }[]
    >(`/organization/search${qs(params)}`);
    const list = rows ?? [];
    return { rows: list, total: list.length };
  },
  workforce: async (params: { groupBy?: string } = {}) => {
    const res = await api.get<{ rows?: RawWorkforceRow[] }>(`/organization/workforce${qs(params)}`);
    return {
      rows: (res?.rows ?? []).map((r) => ({
        key: String(r.id ?? r.label ?? ''),
        label: r.label ?? '—',
        headcount: Number(r.headcount ?? 0),
        planned: r.planned ?? null,
        vacancies: Number(r.vacancies ?? 0),
      })),
    };
  },

  changeRequests: (params: { status?: string; type?: string } = {}) =>
    api.get<OrgChangeRequest[]>(`/organization/change-requests${qs(params)}`),
  createChangeRequest: (body: Partial<OrgChangeRequest>) =>
    api.post<OrgChangeRequest>('/organization/change-requests', body),
  decideChangeRequest: (id: number, decision: 'APPROVED' | 'REJECTED', note?: string) =>
    api.put<OrgChangeRequest>(`/organization/change-requests/${id}/decide`, { decision, note }),

  /** Served as a bare array; normalised to the paginated shape the views use. */
  audit: async (params: { entityType?: string; entityId?: number; limit?: number; offset?: number } = {}) => {
    const res = await api.get<OrgAuditEntry[] | { rows: OrgAuditEntry[]; total: number }>(
      `/organization/audit${qs(params)}`,
    );
    if (Array.isArray(res)) return { rows: res, total: res.length };
    return { rows: res?.rows ?? [], total: Number(res?.total ?? 0) };
  },

  policies: (params: { companyId?: number; policyType?: string } = {}) =>
    api.get<OrgPolicy[]>(`/organization/policies${qs(params)}`),
  createPolicy: (body: Partial<OrgPolicy>) => api.post<OrgPolicy>('/organization/policies', body),
  updatePolicy: (id: number, body: Partial<OrgPolicy>) => api.put<OrgPolicy>(`/organization/policies/${id}`, body),

  // Bulk -----------------------------------------------------------------------
  bulkImport: (entity: OrgEntitySlug, rows: Record<string, unknown>[]) =>
    api.post<{ created: number; updated: number; failed: { row: number; reason: string }[] }>(
      `/organization/bulk/${entity}/import`,
      { rows },
    ),
  bulkTransfer: (body: { employeeIds: number[]; departmentId?: number; branchId?: number; costCenterId?: number; effectiveDate?: string }) =>
    api.post<{ succeeded: number[]; failed: { id: number; reason: string }[] }>('/organization/bulk/transfer', body),
  exportUrl: (entity: string, params: Record<string, unknown> = {}) =>
    `${BASE_URL}/organization/export/${entity}${qs({ ...params, format: 'csv' })}`,
};
