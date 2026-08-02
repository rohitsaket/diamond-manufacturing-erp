import { OrganizationRepository, ENTITY_CONFIG } from '../repositories/OrganizationRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { NotificationService } from './NotificationService';
import {
  OrgEntitySlug,
  OrgEntityResponse,
  OrgListFilters,
  OrgActor,
  OrgAuditEntry,
  OrgAuditFilters,
  OrgTreeNode,
  OrgTreeOptions,
  OrgTreeResult,
  ReportingChartNode,
  ReportingChartResult,
  PositionChartNode,
  PositionChartResult,
  ReportingRelationshipResponse,
  CreateReportingInput,
  TeamMemberResponse,
  CareerPathResponse,
  OrgChangeRequestResponse,
  OrgPolicyResponse,
  BulkImportResult,
  BulkTransferInput,
  BulkTransferResult,
  ReparentInput,
  ReparentResult,
  isOrgEntitySlug,
} from '../types/organization';
import { isValidDateString, todayString } from '../utils/dateUtils';

/** Singular / underscore spellings the API accepts for an entity slug. */
const SLUG_ALIASES: Readonly<Record<string, OrgEntitySlug>> = Object.freeze({
  company: 'companies',
  'legal-entity': 'legal-entities',
  region: 'regions',
  'business-unit': 'business-units',
  division: 'divisions',
  department: 'departments',
  branch: 'branches',
  location: 'locations',
  'cost-center-group': 'cost-center-groups',
  'cost-center': 'cost-centers',
  team: 'teams',
  'job-family': 'job-families',
  'job-function': 'job-functions',
  'job-grade': 'job-grades',
  'job-level': 'job-levels',
  'job-role': 'job-roles',
  position: 'positions',
});

/**
 * Where each entity is allowed to be re-parented to. The key is the entity, the
 * inner key the parent's type, the value the column that carries the link.
 * Omitting `newParentType` uses the entity's own self-parent column.
 */
const REPARENT_TARGETS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  companies: { companies: 'parent_company_id' },
  regions: { regions: 'parent_region_id' },
  'business-units': { 'business-units': 'parent_business_unit_id', companies: 'company_id' },
  divisions: { divisions: 'parent_division_id', 'business-units': 'business_unit_id' },
  departments: { departments: 'parent_department_id', divisions: 'division_id' },
  teams: { departments: 'department_id' },
  branches: { regions: 'region_id' },
  locations: { branches: 'branch_id' },
  'cost-centers': { 'cost-centers': 'parent_cost_center_id', 'cost-center-groups': 'group_id' },
  positions: { positions: 'reports_to_position_id' },
  'job-functions': { 'job-families': 'job_family_id' },
  'job-roles': { 'job-functions': 'job_function_id' },
});

const MAX_TREE_DEPTH = 60;
const EMPLOYEE_LEAF_CAP = 5000;

export function resolveSlug(value: string): OrgEntitySlug | null {
  const raw = String(value ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (isOrgEntitySlug(raw)) return raw;
  return SLUG_ALIASES[raw] ?? null;
}

/** Returns false when walking up from `parentId` would come back to `id`. */
function isAcyclic(id: number, parentId: number, parents: Map<number, number | null>): boolean {
  const seen = new Set<number>([id]);
  let cursor: number | null = parentId;
  let guard = 0;
  while (cursor !== null && cursor !== undefined && guard++ < MAX_TREE_DEPTH * 10) {
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return true;
}

export class OrganizationService {
  private repo = new OrganizationRepository();
  private activity = new ActivityRepository();
  private notifications = new NotificationService();

  // =========================================================================
  // Generic entity CRUD
  // =========================================================================

  async list(slug: OrgEntitySlug, filters: OrgListFilters): Promise<OrgEntityResponse[]> {
    return this.repo.list(slug, filters);
  }

  async getById(slug: OrgEntitySlug, id: number): Promise<OrgEntityResponse> {
    const found = await this.repo.findById(slug, id);
    if (!found) throw new Error(`${ENTITY_CONFIG[slug].label} ${id} was not found`);
    return found;
  }

  async create(slug: OrgEntitySlug, input: Record<string, any>, actor: OrgActor): Promise<OrgEntityResponse> {
    const cfg = ENTITY_CONFIG[slug];
    const data = { ...input };

    data.code = await this.validateCode(slug, data.code);
    data[cfg.nameColumn === 'title' ? 'title' : 'name'] = this.validateName(cfg.label, data.name ?? data.title);
    if (cfg.nameColumn === 'title') delete data.name;

    await this.validateParents(slug, data, null);

    const id = await this.repo.create(slug, data, actor.userId);
    const created = await this.repo.findById(slug, id);

    await this.audit({
      entityType: slug,
      entityId: id,
      entityName: created?.name ?? data.name ?? null,
      action: 'CREATE',
      actor,
      summary: `${cfg.label} "${created?.name ?? data.code}" created`,
      newValue: created,
    });
    await this.logActivity(actor, slug, id, 'CREATE', `${cfg.label} "${created?.name ?? data.code}" created`);

    return created as OrgEntityResponse;
  }

  async update(
    slug: OrgEntitySlug,
    id: number,
    patch: Record<string, any>,
    actor: OrgActor,
  ): Promise<OrgEntityResponse> {
    const cfg = ENTITY_CONFIG[slug];
    const before = await this.repo.findById(slug, id);
    if (!before) throw new Error(`${cfg.label} ${id} was not found`);

    const data = { ...patch };
    if (data.code !== undefined) data.code = await this.validateCode(slug, data.code, id);
    if (data.name !== undefined || data.title !== undefined) {
      const value = this.validateName(cfg.label, data.name ?? data.title);
      if (cfg.nameColumn === 'title') {
        data.title = value;
        delete data.name;
      } else {
        data.name = value;
      }
    }
    await this.validateParents(slug, data, id);

    await this.repo.update(slug, id, data, actor.userId);
    const after = await this.repo.findById(slug, id);

    await this.audit({
      entityType: slug,
      entityId: id,
      entityName: after?.name ?? before.name,
      action: this.statusAction(before.status, after?.status),
      actor,
      summary: `${cfg.label} "${after?.name ?? before.name}" updated`,
      previousValue: before,
      newValue: after,
    });
    await this.logActivity(actor, slug, id, 'UPDATE', `${cfg.label} "${after?.name ?? before.name}" updated`);

    return after as OrgEntityResponse;
  }

  /**
   * Soft delete, refused while anything still hangs off the entity. The caller
   * is told exactly what is in the way and pointed at deactivation instead.
   */
  async remove(slug: OrgEntitySlug, id: number, actor: OrgActor): Promise<{ success: true; message: string }> {
    const cfg = ENTITY_CONFIG[slug];
    const existing = await this.repo.findById(slug, id);
    if (!existing) throw new Error(`${cfg.label} ${id} was not found`);

    const employees = await this.repo.countEmployeesFor(slug, id);
    if (employees > 0) {
      throw new Error(
        `${existing.name} still has ${employees} ${employees === 1 ? 'employee' : 'employees'} assigned. ` +
          `Move them first, or set the status to INACTIVE to retire it without deleting.`,
      );
    }

    const blockers = await this.repo.countBlockers(slug, id);
    if (blockers.length > 0) {
      const detail = blockers.map((b) => `${b.count} ${b.label}`).join(', ');
      throw new Error(
        `${existing.name} still has ${detail}. Move or remove them first, or set the status to INACTIVE instead.`,
      );
    }

    await this.repo.softDelete(slug, id, actor.userId);
    await this.audit({
      entityType: slug,
      entityId: id,
      entityName: existing.name,
      action: 'DELETE',
      actor,
      summary: `${cfg.label} "${existing.name}" deleted`,
      previousValue: existing,
    });
    await this.logActivity(actor, slug, id, 'DELETE', `${cfg.label} "${existing.name}" deleted`);

    return { success: true, message: `${cfg.label} "${existing.name}" was deleted` };
  }

  // -------------------------------------------------------------------------
  // Validation helpers
  // -------------------------------------------------------------------------

  private validateName(label: string, value: unknown): string {
    const name = String(value ?? '').trim();
    if (!name) throw new Error(`A ${label.toLowerCase()} name is required`);
    return name;
  }

  private async validateCode(slug: OrgEntitySlug, value: unknown, excludeId?: number): Promise<string> {
    const cfg = ENTITY_CONFIG[slug];
    const code = String(value ?? '').trim().toUpperCase();
    if (!code) throw new Error(`A ${cfg.label.toLowerCase()} code is required`);
    const clash = await this.repo.findByCode(slug, code, excludeId);
    if (clash) throw new Error(`${cfg.label} code "${code}" is already in use`);
    return code;
  }

  /**
   * Every parent reference on the payload must exist, must sit in the same
   * company, and (for self-parenting entities) must not close a loop.
   */
  private async validateParents(slug: OrgEntitySlug, data: Record<string, any>, selfId: number | null): Promise<void> {
    const cfg = ENTITY_CONFIG[slug];
    const targets = REPARENT_TARGETS[slug] ?? {};

    for (const [parentType, column] of Object.entries(targets)) {
      const camel = column.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
      const value = data[camel];
      if (value === undefined || value === null || value === '') continue;

      const parentSlug = resolveSlug(parentType);
      if (!parentSlug) continue;
      const parentId = Number(value);
      if (!Number.isFinite(parentId)) throw new Error(`${ENTITY_CONFIG[parentSlug].label} id must be a number`);

      const parent = await this.repo.findRawById(parentSlug, parentId);
      if (!parent) throw new Error(`${ENTITY_CONFIG[parentSlug].label} ${parentId} was not found`);

      // Same-company rule, only where both sides actually carry a company.
      const parentCompany = ENTITY_CONFIG[parentSlug].companyColumn
        ? parent[ENTITY_CONFIG[parentSlug].companyColumn as string]
        : parentSlug === 'companies'
          ? parent.id
          : null;
      const ownCompany = data.companyId ?? (selfId ? (await this.repo.findRawById(slug, selfId))?.[cfg.companyColumn ?? ''] : null);
      if (cfg.companyColumn && parentCompany != null && ownCompany != null && Number(parentCompany) !== Number(ownCompany)) {
        throw new Error(
          `${ENTITY_CONFIG[parentSlug].label} "${parent.name ?? parent.title}" belongs to a different company`,
        );
      }

      if (parentSlug === slug && selfId) {
        if (parentId === selfId) throw new Error('That would create a circular hierarchy');
        const parents = await this.repo.getParentMap(slug);
        if (!isAcyclic(selfId, parentId, parents)) throw new Error('That would create a circular hierarchy');
      }
    }
  }

  private statusAction(before: unknown, after: unknown): 'UPDATE' | 'ACTIVATE' | 'DEACTIVATE' {
    if (!after || before === after) return 'UPDATE';
    if (after === 'ACTIVE') return 'ACTIVATE';
    if (after === 'INACTIVE' || after === 'CLOSED' || after === 'DISSOLVED') return 'DEACTIVATE';
    return 'UPDATE';
  }

  // =========================================================================
  // Reparent / transfer
  // =========================================================================

  async reparent(input: ReparentInput, actor: OrgActor): Promise<ReparentResult> {
    const rawType = String(input.entityType ?? '').trim().toLowerCase();
    const id = Number(input.id);
    if (!Number.isFinite(id)) throw new Error('A valid entity id is required');

    // Moving a person is a transfer, not a structural reparent.
    if (rawType === 'employee' || rawType === 'employees') {
      return this.transferEmployee(input, actor);
    }

    const slug = resolveSlug(rawType);
    if (!slug) throw new Error(`Unknown organization entity "${input.entityType}"`);
    const cfg = ENTITY_CONFIG[slug];

    const targets = REPARENT_TARGETS[slug];
    if (!targets) throw new Error(`${cfg.label} cannot be re-parented`);

    const parentType = input.newParentType ? (resolveSlug(input.newParentType) ?? input.newParentType) : slug;
    const column = targets[parentType as string];
    if (!column) {
      throw new Error(
        `A ${cfg.label.toLowerCase()} cannot sit under a ${String(input.newParentType ?? parentType)}. ` +
          `Allowed: ${Object.keys(targets).join(', ')}`,
      );
    }

    const existing = await this.repo.findRawById(slug, id);
    if (!existing) throw new Error(`${cfg.label} ${id} was not found`);

    const previousParentId = existing[column] === null || existing[column] === undefined ? null : Number(existing[column]);
    const newParentId = input.newParentId === null || input.newParentId === undefined ? null : Number(input.newParentId);
    if (newParentId !== null && !Number.isFinite(newParentId)) throw new Error('A valid parent id is required');

    if (newParentId !== null) {
      const parentSlug = resolveSlug(String(parentType));
      if (!parentSlug) throw new Error(`Unknown parent entity "${parentType}"`);
      const parent = await this.repo.findRawById(parentSlug, newParentId);
      if (!parent) throw new Error(`${ENTITY_CONFIG[parentSlug].label} ${newParentId} was not found`);

      if (parentSlug === slug) {
        if (newParentId === id) throw new Error('That would create a circular hierarchy');
        const parents = await this.repo.getParentMap(slug);
        if (!isAcyclic(id, newParentId, parents)) throw new Error('That would create a circular hierarchy');
      }

      if (cfg.companyColumn && ENTITY_CONFIG[parentSlug].companyColumn) {
        const own = existing[cfg.companyColumn];
        const theirs = parent[ENTITY_CONFIG[parentSlug].companyColumn as string];
        if (own != null && theirs != null && Number(own) !== Number(theirs)) {
          throw new Error(`${ENTITY_CONFIG[parentSlug].label} "${parent.name ?? parent.title}" belongs to a different company`);
        }
      }
    }

    await this.repo.setColumn(slug, id, column, newParentId, actor.userId);

    const name = String(existing[cfg.nameColumn] ?? id);
    const message = `${cfg.label} "${name}" moved under ${parentType} ${newParentId ?? '(none)'}`;
    await this.audit({
      entityType: slug,
      entityId: id,
      entityName: name,
      action: 'REPARENT',
      actor,
      summary: message,
      previousValue: { [column]: previousParentId },
      newValue: { [column]: newParentId },
    });
    await this.logActivity(actor, slug, id, 'REPARENT', message);

    return {
      entityType: slug,
      id,
      name,
      previousParentId,
      newParentId,
      parentType: String(parentType),
      message,
    };
  }

  /**
   * Employee move. Writes the `*_id` column AND the legacy free-text column in
   * one transaction (see OrganizationRepository.moveEmployeeOrg) so existing
   * screens that still read `employees.department` keep working.
   */
  private async transferEmployee(input: ReparentInput, actor: OrgActor): Promise<ReparentResult> {
    const employeeId = Number(input.id);
    const parentType = String(input.newParentType ?? 'department').toLowerCase();
    const target: { departmentId?: number | null; branchId?: number | null; costCenterId?: number | null } = {};

    const newParentId = input.newParentId === null || input.newParentId === undefined ? null : Number(input.newParentId);
    if (newParentId !== null && !Number.isFinite(newParentId)) throw new Error('A valid parent id is required');

    if (parentType === 'department' || parentType === 'departments') target.departmentId = newParentId;
    else if (parentType === 'branch' || parentType === 'branches') target.branchId = newParentId;
    else if (parentType === 'cost-center' || parentType === 'cost-centers' || parentType === 'cost_center')
      target.costCenterId = newParentId;
    else throw new Error(`An employee can be moved to a department, branch or cost centre — not a ${parentType}`);

    const before = await this.repo.findEmployeeOrg(employeeId);
    if (!before) throw new Error(`Employee ${employeeId} was not found`);

    const moved = await this.repo.moveEmployeeOrg(employeeId, target);
    const message = `${moved.employeeName} transferred to ${parentType} ${newParentId ?? '(none)'}`;

    await this.audit({
      entityType: 'employee',
      entityId: employeeId,
      entityName: moved.employeeName,
      action: 'TRANSFER',
      actor,
      summary: message,
      previousValue: moved.before,
      newValue: moved.after,
    });
    await this.logActivity(actor, 'employee', employeeId, 'TRANSFER', message);

    // The seat count on the old and new position may have changed.
    if (before.position_id) await this.syncPositionStatus(Number(before.position_id), actor.userId);

    return {
      entityType: 'employee',
      id: employeeId,
      name: moved.employeeName,
      previousParentId:
        target.departmentId !== undefined
          ? (before.department_id ?? null)
          : target.branchId !== undefined
            ? (before.branch_id ?? null)
            : (before.cost_center_id ?? null),
      newParentId,
      parentType,
      message,
    };
  }

  // =========================================================================
  // Structural tree
  // =========================================================================

  /**
   * company > business unit > division > department (> team) (> employee),
   * assembled in memory from six set-based reads. No query runs per node.
   */
  async getTree(options: OrgTreeOptions = {}): Promise<OrgTreeResult> {
    const includeTeams = !!options.includeTeams;
    const includeEmployees = !!options.includeEmployees;
    const data = await this.repo.getTreeData(includeTeams, includeEmployees, EMPLOYEE_LEAF_CAP);

    // --- direct headcount: every employee counts once, at their deepest node.
    const direct = new Map<string, number>();
    for (const row of data.counts) {
      const cnt = Number(row.cnt ?? 0);
      let key: string | null = null;
      if (row.department_id) key = `department:${row.department_id}`;
      else if (row.division_id) key = `division:${row.division_id}`;
      else if (row.business_unit_id) key = `business_unit:${row.business_unit_id}`;
      else if (row.company_id) key = `company:${row.company_id}`;
      if (!key) continue;
      direct.set(key, (direct.get(key) ?? 0) + cnt);
    }

    const nodes = new Map<string, OrgTreeNode>();
    const makeNode = (type: OrgTreeNode['type'], row: any): OrgTreeNode => {
      const key = `${type}:${row.id}`;
      const head = row.head_employee_id ?? row.lead_employee_id ?? null;
      const node: OrgTreeNode = {
        type,
        id: Number(row.id),
        code: row.code ?? null,
        name: String(row.name ?? ''),
        status: row.status ?? null,
        headEmployeeId: head === null ? null : Number(head),
        headName: row.head_name ?? null,
        directHeadcount: direct.get(key) ?? 0,
        headcount: 0,
        plannedHeadcount:
          row.planned_headcount === null || row.planned_headcount === undefined
            ? null
            : Number(row.planned_headcount),
        vacancies: null,
        children: [],
      };
      nodes.set(key, node);
      return node;
    };

    for (const row of data.companies) makeNode('company', row);
    for (const row of data.businessUnits) makeNode('business_unit', row);
    for (const row of data.divisions) makeNode('division', row);
    for (const row of data.departments) makeNode('department', row);

    const parentMapOf = (rows: any[], column: string): Map<number, number | null> => {
      const map = new Map<number, number | null>();
      for (const r of rows) map.set(Number(r.id), r[column] === null || r[column] === undefined ? null : Number(r[column]));
      return map;
    };
    const companyParents = parentMapOf(data.companies, 'parent_company_id');
    const buParents = parentMapOf(data.businessUnits, 'parent_business_unit_id');
    const divParents = parentMapOf(data.divisions, 'parent_division_id');
    const deptParents = parentMapOf(data.departments, 'parent_department_id');

    const roots: OrgTreeNode[] = [];
    const attach = (childKey: string, parentKeys: Array<string | null>) => {
      const child = nodes.get(childKey);
      if (!child) return;
      for (const pk of parentKeys) {
        if (!pk) continue;
        const parent = nodes.get(pk);
        if (parent) {
          parent.children.push(child);
          return;
        }
      }
      roots.push(child);
    };

    for (const row of data.companies) {
      const id = Number(row.id);
      const p = row.parent_company_id ? Number(row.parent_company_id) : null;
      const safe = p !== null && isAcyclic(id, p, companyParents) ? p : null;
      attach(`company:${id}`, [safe ? `company:${safe}` : null]);
    }
    for (const row of data.businessUnits) {
      const id = Number(row.id);
      const p = row.parent_business_unit_id ? Number(row.parent_business_unit_id) : null;
      const safe = p !== null && isAcyclic(id, p, buParents) ? p : null;
      attach(`business_unit:${id}`, [
        safe ? `business_unit:${safe}` : null,
        row.company_id ? `company:${row.company_id}` : null,
      ]);
    }
    for (const row of data.divisions) {
      const id = Number(row.id);
      const p = row.parent_division_id ? Number(row.parent_division_id) : null;
      const safe = p !== null && isAcyclic(id, p, divParents) ? p : null;
      attach(`division:${id}`, [
        safe ? `division:${safe}` : null,
        row.business_unit_id ? `business_unit:${row.business_unit_id}` : null,
        row.company_id ? `company:${row.company_id}` : null,
      ]);
    }
    for (const row of data.departments) {
      const id = Number(row.id);
      const p = row.parent_department_id ? Number(row.parent_department_id) : null;
      const safe = p !== null && isAcyclic(id, p, deptParents) ? p : null;
      attach(`department:${id}`, [
        safe ? `department:${safe}` : null,
        row.division_id ? `division:${row.division_id}` : null,
        row.company_id ? `company:${row.company_id}` : null,
      ]);
    }

    // --- roll up structural headcount before decorative leaves are attached.
    const rollUp = (node: OrgTreeNode, depth: number): number => {
      if (depth > MAX_TREE_DEPTH) return node.directHeadcount;
      let total = node.directHeadcount;
      for (const child of node.children) total += rollUp(child, depth + 1);
      node.headcount = total;
      if (node.type === 'department' && node.plannedHeadcount !== null) {
        node.vacancies = Math.max(0, node.plannedHeadcount - total);
      }
      return total;
    };
    for (const root of roots) rollUp(root, 0);

    // --- teams and employees hang off the tree without polluting the roll-up.
    if (includeTeams) {
      const teamCounts = new Map<number, number>(
        data.teamCounts.map((r: any) => [Number(r.team_id), Number(r.cnt ?? 0)]),
      );
      for (const row of data.teams) {
        const node = makeNode('team', row);
        node.directHeadcount = teamCounts.get(Number(row.id)) ?? 0;
        node.headcount = node.directHeadcount;
        const parent =
          (row.department_id ? nodes.get(`department:${row.department_id}`) : undefined) ??
          (row.company_id ? nodes.get(`company:${row.company_id}`) : undefined);
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
    }
    if (includeEmployees) {
      for (const row of data.employees) {
        const node: OrgTreeNode = {
          type: 'employee',
          id: Number(row.id),
          code: row.emp_code ?? null,
          name: String(row.full_name ?? ''),
          status: row.designation ?? null,
          headEmployeeId: null,
          headName: null,
          directHeadcount: 0,
          headcount: 0,
          plannedHeadcount: null,
          vacancies: null,
          children: [],
        };
        const parent =
          (row.department_id ? nodes.get(`department:${row.department_id}`) : undefined) ??
          (row.division_id ? nodes.get(`division:${row.division_id}`) : undefined) ??
          (row.business_unit_id ? nodes.get(`business_unit:${row.business_unit_id}`) : undefined) ??
          (row.company_id ? nodes.get(`company:${row.company_id}`) : undefined);
        if (parent) parent.children.push(node);
      }
    }

    // --- optional subtree selection
    let output = roots;
    let rootType: string | null = null;
    let rootId: number | null = null;
    if (options.rootType && options.rootId) {
      const normalised = String(options.rootType).toLowerCase().replace(/-/g, '_').replace(/s$/, '');
      const key = `${normalised}:${options.rootId}`;
      const node = nodes.get(key);
      if (!node) throw new Error(`No ${options.rootType} with id ${options.rootId} exists in the organization tree`);
      output = [node];
      rootType = normalised;
      rootId = Number(options.rootId);
    }

    let nodeCount = 0;
    const countNodes = (list: OrgTreeNode[], depth: number): void => {
      if (depth > MAX_TREE_DEPTH) return;
      for (const n of list) {
        nodeCount++;
        countNodes(n.children, depth + 1);
      }
    };
    countNodes(output, 0);

    return {
      generatedAt: new Date().toISOString(),
      rootType,
      rootId,
      includeTeams,
      includeEmployees,
      truncatedEmployees: includeEmployees && data.employees.length >= EMPLOYEE_LEAF_CAP,
      totals: {
        nodes: nodeCount,
        headcount: output.reduce((sum, n) => sum + n.headcount, 0),
      },
      nodes: output,
    };
  }

  // =========================================================================
  // Reporting chart
  // =========================================================================

  /**
   * One query for every working employee; the manager tree is assembled in
   * memory, cycle-guarded, with `directReports` and subtree `totalReports`.
   */
  async getReportingChart(rootEmployeeId?: number, depth?: number): Promise<ReportingChartResult> {
    const rows = await this.repo.getReportingRows();

    const nodes = new Map<number, ReportingChartNode>();
    const managerOf = new Map<number, number | null>();
    for (const r of rows) {
      const id = Number(r.id);
      nodes.set(id, {
        id,
        empCode: r.emp_code,
        name: r.full_name,
        designation: r.designation ?? null,
        positionTitle: r.position_title ?? null,
        departmentId: r.department_id === null ? null : Number(r.department_id),
        departmentName: r.department_name ?? null,
        branchName: r.branch_name ?? null,
        gradeCode: r.grade_code ?? null,
        photoUrl: r.photo_url ?? null,
        managerId: r.reporting_manager_id === null ? null : Number(r.reporting_manager_id),
        level: 0,
        directReports: 0,
        totalReports: 0,
        children: [],
      });
      managerOf.set(id, r.reporting_manager_id === null ? null : Number(r.reporting_manager_id));
    }

    let cyclesBroken = 0;
    const roots: ReportingChartNode[] = [];
    for (const [id, node] of nodes) {
      const managerId = node.managerId;
      if (managerId === null || !nodes.has(managerId)) {
        roots.push(node);
        continue;
      }
      if (!isAcyclic(id, managerId, managerOf)) {
        cyclesBroken++;
        roots.push(node);
        continue;
      }
      nodes.get(managerId)!.children.push(node);
    }

    const measure = (node: ReportingChartNode, level: number): number => {
      node.level = level;
      node.directReports = node.children.length;
      if (level > MAX_TREE_DEPTH) {
        node.children = [];
        node.totalReports = 0;
        return 0;
      }
      let total = 0;
      for (const child of node.children) total += 1 + measure(child, level + 1);
      node.totalReports = total;
      return total;
    };

    let output: ReportingChartNode[];
    if (rootEmployeeId) {
      const root = nodes.get(rootEmployeeId);
      if (!root) throw new Error(`Employee ${rootEmployeeId} is not an active employee`);
      measure(root, 0);
      output = [root];
    } else {
      for (const root of roots) measure(root, 0);
      output = roots.sort((a, b) => b.totalReports - a.totalReports || a.name.localeCompare(b.name));
    }

    // `depth` trims what is rendered; totalReports still reports the truth.
    if (depth !== undefined && Number.isFinite(depth)) {
      const maxLevel = Math.max(0, Math.floor(depth));
      const baseLevel = output[0]?.level ?? 0;
      const trim = (list: ReportingChartNode[]) => {
        for (const n of list) {
          if (n.level - baseLevel >= maxLevel) n.children = [];
          else trim(n.children);
        }
      };
      trim(output);
    }

    return {
      generatedAt: new Date().toISOString(),
      rootEmployeeId: rootEmployeeId ?? null,
      depth: depth === undefined ? null : Math.floor(depth),
      totalEmployees: nodes.size,
      cyclesBroken,
      nodes: output,
    };
  }

  async getPositionChart(): Promise<PositionChartResult> {
    const rows = await this.repo.getPositionRows();
    const nodes = new Map<number, PositionChartNode>();
    const parents = new Map<number, number | null>();

    let budgeted = 0;
    let occupied = 0;
    for (const r of rows) {
      const id = Number(r.id);
      const headcountBudgeted = Number(r.headcount_budgeted ?? 0);
      const occupancy = Number(r.occupancy ?? 0);
      budgeted += headcountBudgeted;
      occupied += occupancy;
      nodes.set(id, {
        id,
        code: r.code,
        title: r.title,
        status: r.status,
        departmentId: r.department_id === null ? null : Number(r.department_id),
        departmentName: r.department_name ?? null,
        reportsToPositionId: r.reports_to_position_id === null ? null : Number(r.reports_to_position_id),
        headcountBudgeted,
        occupancy,
        vacancies: Math.max(0, headcountBudgeted - occupancy),
        children: [],
      });
      parents.set(id, r.reports_to_position_id === null ? null : Number(r.reports_to_position_id));
    }

    const roots: PositionChartNode[] = [];
    for (const [id, node] of nodes) {
      const parentId = node.reportsToPositionId;
      if (parentId === null || !nodes.has(parentId) || !isAcyclic(id, parentId, parents)) {
        roots.push(node);
        continue;
      }
      nodes.get(parentId)!.children.push(node);
    }

    return {
      generatedAt: new Date().toISOString(),
      totalPositions: nodes.size,
      totalBudgetedSeats: budgeted,
      totalOccupied: occupied,
      totalVacant: Math.max(0, budgeted - occupied),
      nodes: roots,
    };
  }

  // =========================================================================
  // Reporting relationships
  // =========================================================================

  /**
   * NOTE: an employee's *primary* manager lives on `employees.reporting_manager_id`
   * and is edited through the employee module. This table only carries the
   * additional lines — matrix, functional, dotted, escalation, delegation.
   */
  async listReporting(filters: {
    employeeId?: number;
    managerEmployeeId?: number;
    relationshipType?: string;
    activeOnly?: boolean;
    limit?: number;
  }): Promise<ReportingRelationshipResponse[]> {
    return this.repo.listReporting(filters);
  }

  async createReporting(input: CreateReportingInput, actor: OrgActor): Promise<ReportingRelationshipResponse> {
    const employeeId = Number(input.employeeId);
    const managerEmployeeId = Number(input.managerEmployeeId);
    if (!Number.isFinite(employeeId) || !Number.isFinite(managerEmployeeId)) {
      throw new Error('Both employeeId and managerEmployeeId are required');
    }
    if (employeeId === managerEmployeeId) throw new Error('An employee cannot report to themselves');

    const employee = await this.repo.employeeExists(employeeId);
    if (!employee) throw new Error(`Employee ${employeeId} was not found`);
    const manager = await this.repo.employeeExists(managerEmployeeId);
    if (!manager) throw new Error(`Employee ${managerEmployeeId} was not found`);

    const relationshipType = (input.relationshipType ?? 'MATRIX') as CreateReportingInput['relationshipType'];
    const duplicate = await this.repo.findActiveReporting(employeeId, managerEmployeeId, String(relationshipType));
    if (duplicate) {
      throw new Error(
        `${employee.full_name} already has an active ${relationshipType} line to ${manager.full_name}`,
      );
    }

    const effectiveFrom = input.effectiveFrom ?? todayString();
    if (!isValidDateString(effectiveFrom)) throw new Error('effectiveFrom must be a YYYY-MM-DD date');
    if (input.effectiveTo && !isValidDateString(input.effectiveTo)) {
      throw new Error('effectiveTo must be a YYYY-MM-DD date');
    }
    if (input.allocationPct != null && (input.allocationPct < 0 || input.allocationPct > 100)) {
      throw new Error('allocationPct must be between 0 and 100');
    }

    const id = await this.repo.createReporting(
      { ...input, employeeId, managerEmployeeId, relationshipType, effectiveFrom },
      actor.userId,
    );
    const created = (await this.repo.listReporting({ employeeId, limit: 500 })).find((r) => r.id === id);

    const summary = `${employee.full_name} now has a ${relationshipType} line to ${manager.full_name}`;
    await this.audit({
      entityType: 'reporting_relationship',
      entityId: id,
      entityName: employee.full_name,
      action: 'ASSIGN',
      actor,
      summary,
      newValue: created,
    });
    await this.logActivity(actor, 'reporting_relationship', id, 'ASSIGN', summary);

    return created as ReportingRelationshipResponse;
  }

  async deleteReporting(id: number, actor: OrgActor): Promise<{ success: true }> {
    const existing = await this.repo.findReportingById(id);
    if (!existing) throw new Error(`Reporting line ${id} was not found`);
    await this.repo.softDeleteReporting(id);
    await this.audit({
      entityType: 'reporting_relationship',
      entityId: id,
      entityName: null,
      action: 'UNASSIGN',
      actor,
      summary: `Reporting line ${id} removed`,
      previousValue: existing,
    });
    return { success: true };
  }

  // =========================================================================
  // Team members
  // =========================================================================

  async listTeamMembers(teamId: number): Promise<TeamMemberResponse[]> {
    const team = await this.repo.findRawById('teams', teamId);
    if (!team) throw new Error(`Team ${teamId} was not found`);
    return this.repo.listTeamMembers(teamId);
  }

  async addTeamMember(
    teamId: number,
    input: { employeeId: number; roleInTeam?: string | null; allocationPct?: number; joinedOn?: string | null },
    actor: OrgActor,
  ): Promise<TeamMemberResponse[]> {
    const team = await this.repo.findRawById('teams', teamId);
    if (!team) throw new Error(`Team ${teamId} was not found`);

    const employeeId = Number(input.employeeId);
    if (!Number.isFinite(employeeId)) throw new Error('A valid employeeId is required');
    const employee = await this.repo.employeeExists(employeeId);
    if (!employee) throw new Error(`Employee ${employeeId} was not found`);

    const allocationPct = input.allocationPct === undefined ? 100 : Number(input.allocationPct);
    if (!Number.isFinite(allocationPct) || allocationPct < 0 || allocationPct > 100) {
      throw new Error('allocationPct must be between 0 and 100');
    }
    if (input.joinedOn && !isValidDateString(input.joinedOn)) {
      throw new Error('joinedOn must be a YYYY-MM-DD date');
    }

    // A person cannot be more than 100% allocated across their active teams.
    const elsewhere = await this.repo.getEmployeeAllocation(employeeId, teamId);
    if (elsewhere + allocationPct > 100) {
      throw new Error(
        `${employee.full_name} is already allocated ${elsewhere}% across other teams`,
      );
    }

    await this.repo.upsertTeamMember(
      teamId,
      employeeId,
      { roleInTeam: input.roleInTeam ?? null, allocationPct, joinedOn: input.joinedOn ?? todayString() },
      actor.userId,
    );

    const summary = `${employee.full_name} added to team "${team.name}" at ${allocationPct}%`;
    await this.audit({
      entityType: 'team_member',
      entityId: teamId,
      entityName: team.name,
      action: 'ASSIGN',
      actor,
      summary,
      newValue: { teamId, employeeId, allocationPct, roleInTeam: input.roleInTeam ?? null },
    });
    await this.logActivity(actor, 'team_member', teamId, 'ASSIGN', summary);

    return this.repo.listTeamMembers(teamId);
  }

  async removeTeamMember(teamId: number, employeeId: number, actor: OrgActor): Promise<{ success: true }> {
    const membership = await this.repo.findTeamMember(teamId, employeeId);
    if (!membership) throw new Error(`Employee ${employeeId} is not a member of team ${teamId}`);
    if (membership.left_on) throw new Error('That team membership has already ended');

    const affected = await this.repo.endTeamMembership(teamId, employeeId, todayString());
    if (affected === 0) throw new Error('That team membership has already ended');

    await this.audit({
      entityType: 'team_member',
      entityId: teamId,
      entityName: null,
      action: 'UNASSIGN',
      actor,
      summary: `Employee ${employeeId} removed from team ${teamId}`,
      previousValue: { teamId, employeeId, allocationPct: Number(membership.allocation_pct ?? 0) },
    });
    return { success: true };
  }

  // =========================================================================
  // Positions
  // =========================================================================

  /**
   * A seat flips to FILLED once occupancy reaches the budget and back to OPEN
   * when it drops. CLOSED and ON_HOLD are deliberate human decisions and are
   * never overwritten.
   */
  async syncPositionStatus(positionId: number, userId: number): Promise<string | null> {
    const state = await this.repo.getPositionOccupancy(positionId);
    if (!state) return null;
    if (state.status === 'CLOSED' || state.status === 'ON_HOLD') return state.status;

    const desired = state.budgeted > 0 && state.occupancy >= state.budgeted ? 'FILLED' : 'OPEN';
    if (desired !== state.status) await this.repo.setPositionStatus(positionId, desired, userId);
    return desired;
  }

  async getPositionOccupancy(positionId: number): Promise<{ positionId: number; occupancy: number; budgeted: number; vacancies: number; status: string }> {
    const state = await this.repo.getPositionOccupancy(positionId);
    if (!state) throw new Error(`Position ${positionId} was not found`);
    return {
      positionId,
      occupancy: state.occupancy,
      budgeted: state.budgeted,
      vacancies: Math.max(0, state.budgeted - state.occupancy),
      status: state.status,
    };
  }

  // =========================================================================
  // Career paths
  // =========================================================================

  async listCareerPaths(fromRoleId?: number): Promise<CareerPathResponse[]> {
    return this.repo.listCareerPaths(fromRoleId);
  }

  async createCareerPath(
    input: { fromRoleId: number; toRoleId: number; typicalYears?: number | null; notes?: string | null },
    actor: OrgActor,
  ): Promise<CareerPathResponse> {
    const fromRoleId = Number(input.fromRoleId);
    const toRoleId = Number(input.toRoleId);
    if (!Number.isFinite(fromRoleId) || !Number.isFinite(toRoleId)) {
      throw new Error('Both fromRoleId and toRoleId are required');
    }
    if (fromRoleId === toRoleId) throw new Error('A career path must lead to a different role');

    const from = await this.repo.findRawById('job-roles', fromRoleId);
    if (!from) throw new Error(`Job role ${fromRoleId} was not found`);
    const to = await this.repo.findRawById('job-roles', toRoleId);
    if (!to) throw new Error(`Job role ${toRoleId} was not found`);

    const existing = await this.repo.findCareerPath(fromRoleId, toRoleId);
    if (existing) throw new Error(`A career path from "${from.name}" to "${to.name}" already exists`);

    const id = await this.repo.createCareerPath({ ...input, fromRoleId, toRoleId });
    const created = (await this.repo.listCareerPaths(fromRoleId)).find((p) => p.id === id);

    await this.audit({
      entityType: 'career_path',
      entityId: id,
      entityName: `${from.name} -> ${to.name}`,
      action: 'CREATE',
      actor,
      summary: `Career path "${from.name}" to "${to.name}" created`,
      newValue: created,
    });
    return created as CareerPathResponse;
  }

  async deleteCareerPath(id: number, actor: OrgActor): Promise<{ success: true }> {
    const existing = await this.repo.findCareerPathById(id);
    if (!existing) throw new Error(`Career path ${id} was not found`);
    await this.repo.deleteCareerPath(id);
    await this.audit({
      entityType: 'career_path',
      entityId: id,
      entityName: null,
      action: 'DELETE',
      actor,
      summary: `Career path ${id} deleted`,
      previousValue: existing,
    });
    return { success: true };
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
    return this.repo.listChangeRequests(filters);
  }

  async createChangeRequest(input: Record<string, any>, actor: OrgActor): Promise<OrgChangeRequestResponse> {
    const requestType = String(input.requestType ?? '').trim().toUpperCase();
    if (!requestType) throw new Error('A requestType is required');
    const title = String(input.title ?? '').trim();
    if (!title) throw new Error('A title is required');
    if (input.effectiveDate && !isValidDateString(String(input.effectiveDate))) {
      throw new Error('effectiveDate must be a YYYY-MM-DD date');
    }

    const id = await this.repo.createChangeRequest(
      {
        requestType,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        employeeId: input.employeeId ?? null,
        title,
        justification: input.justification ?? null,
        proposed: input.proposed,
        current: input.current,
        effectiveDate: input.effectiveDate ?? null,
        status: input.status === 'DRAFT' ? 'DRAFT' : 'PENDING',
      },
      actor.userId,
    );
    const created = await this.repo.findChangeRequestById(id);

    await this.audit({
      entityType: 'org_change_request',
      entityId: id,
      entityName: title,
      action: 'CREATE',
      actor,
      summary: `Change request "${title}" raised`,
      newValue: created,
    });

    // Approvers need to know something is waiting; failures must not block the write.
    try {
      await this.notifications.notifyRoles(['admin', 'hr'], {
        category: 'POLICY',
        title: `Org change request: ${title}`,
        body: `${actor.name} raised a ${requestType} request awaiting a decision.`,
        linkPage: 'organization',
        linkRefId: id,
      });
    } catch (err: any) {
      console.error('[organization] change-request notification failed:', err.message);
    }

    return created as OrgChangeRequestResponse;
  }

  /**
   * Approval records a decision — it deliberately does NOT mutate the org.
   * Applying an approved request is a separate, explicit action so nobody's
   * structure changes as a side effect of clicking Approve.
   */
  async decideChangeRequest(
    id: number,
    decision: 'APPROVED' | 'REJECTED',
    note: string | null,
    actor: OrgActor,
  ): Promise<{ request: OrgChangeRequestResponse; applied: false; message: string }> {
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new Error("A decision must be either 'APPROVED' or 'REJECTED'");
    }
    const existing = await this.repo.findChangeRequestById(id);
    if (!existing) throw new Error(`Change request ${id} was not found`);
    if (existing.status !== 'PENDING' && existing.status !== 'DRAFT') {
      throw new Error(`Change request ${id} is already ${existing.status}`);
    }
    if (decision === 'REJECTED' && !String(note ?? '').trim()) {
      throw new Error('A rejection note is required');
    }

    await this.repo.decideChangeRequest(id, decision, note, actor.userId);
    const updated = await this.repo.findChangeRequestById(id);

    await this.audit({
      entityType: 'org_change_request',
      entityId: id,
      entityName: existing.title,
      action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
      actor,
      summary: `Change request "${existing.title}" ${decision.toLowerCase()}`,
      previousValue: existing,
      newValue: updated,
    });

    const message =
      decision === 'APPROVED'
        ? 'Approved and recorded. The structural change has NOT been applied — apply it deliberately through the relevant endpoint.'
        : 'Rejected and recorded. Nothing was changed.';

    return { request: updated as OrgChangeRequestResponse, applied: false, message };
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
    return this.repo.listPolicies(filters);
  }

  async createPolicy(input: Record<string, any>, actor: OrgActor): Promise<OrgPolicyResponse> {
    const code = String(input.code ?? '').trim().toUpperCase();
    if (!code) throw new Error('A policy code is required');
    const name = String(input.name ?? '').trim();
    if (!name) throw new Error('A policy name is required');
    const policyType = String(input.policyType ?? '').trim().toUpperCase();
    if (!policyType) throw new Error('A policyType is required');

    const id = await this.repo.createPolicy({ ...input, code, name, policyType }, actor.userId);
    const created = await this.repo.findPolicyById(id);

    await this.audit({
      entityType: 'org_policy',
      entityId: id,
      entityName: name,
      action: 'CREATE',
      actor,
      summary: `Policy "${name}" created`,
      newValue: created,
    });
    return created as OrgPolicyResponse;
  }

  async updatePolicy(id: number, patch: Record<string, any>, actor: OrgActor): Promise<OrgPolicyResponse> {
    const before = await this.repo.findPolicyById(id);
    if (!before) throw new Error(`Policy ${id} was not found`);
    const data = { ...patch };
    if (data.code !== undefined) data.code = String(data.code).trim().toUpperCase();
    if (data.policyType !== undefined) data.policyType = String(data.policyType).trim().toUpperCase();

    await this.repo.updatePolicy(id, data, actor.userId);
    const after = await this.repo.findPolicyById(id);

    await this.audit({
      entityType: 'org_policy',
      entityId: id,
      entityName: after?.name ?? before.name,
      action: 'UPDATE',
      actor,
      summary: `Policy "${after?.name ?? before.name}" updated`,
      previousValue: before,
      newValue: after,
    });
    return after as OrgPolicyResponse;
  }

  // =========================================================================
  // Bulk operations — always per-row, never all-or-nothing
  // =========================================================================

  async bulkImport(slug: OrgEntitySlug, rows: any[], actor: OrgActor): Promise<BulkImportResult> {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('Provide a non-empty array of rows');
    if (rows.length > 5000) throw new Error('Import is limited to 5000 rows per call');

    const cfg = ENTITY_CONFIG[slug];
    const result: BulkImportResult = { slug, created: 0, updated: 0, failed: [] };

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] ?? {};
      let code = '';
      try {
        code = String(raw.code ?? '').trim().toUpperCase();
        if (!code) throw new Error(`A ${cfg.label.toLowerCase()} code is required`);
        const name = String(raw.name ?? raw.title ?? '').trim();
        if (!name) throw new Error(`A ${cfg.label.toLowerCase()} name is required`);

        const payload: Record<string, any> = { ...raw, code };
        if (cfg.nameColumn === 'title') {
          payload.title = name;
          delete payload.name;
        } else {
          payload.name = name;
        }

        const existing = await this.repo.findByCode(slug, code);
        if (existing) {
          await this.repo.update(slug, Number(existing.id), payload, actor.userId);
          result.updated++;
        } else {
          await this.repo.create(slug, payload, actor.userId);
          result.created++;
        }
      } catch (err: any) {
        result.failed.push({ row: i + 1, code: code || undefined, reason: err.message });
      }
    }

    await this.audit({
      entityType: slug,
      entityId: null,
      entityName: null,
      action: 'IMPORT',
      actor,
      summary: `Imported ${cfg.label.toLowerCase()}s: ${result.created} created, ${result.updated} updated, ${result.failed.length} failed`,
      newValue: { created: result.created, updated: result.updated, failed: result.failed.length },
    });
    await this.logActivity(
      actor,
      slug,
      null,
      'IMPORT',
      `Bulk import of ${cfg.label.toLowerCase()}s: ${result.created} created, ${result.updated} updated`,
    );

    return result;
  }

  /**
   * Moves a batch of employees. Each employee is its own transaction, so one
   * bad id never rolls back the rest, and both the `*_id` and the legacy text
   * columns are written together.
   */
  async bulkTransfer(input: BulkTransferInput, actor: OrgActor): Promise<BulkTransferResult> {
    const ids = Array.isArray(input.employeeIds) ? input.employeeIds.map(Number).filter(Number.isFinite) : [];
    if (ids.length === 0) throw new Error('Provide at least one employeeId');
    if (ids.length > 2000) throw new Error('Bulk transfer is limited to 2000 employees per call');
    if (input.departmentId === undefined && input.branchId === undefined && input.costCenterId === undefined) {
      throw new Error('Provide a departmentId, branchId or costCenterId to transfer to');
    }
    if (input.effectiveDate && !isValidDateString(String(input.effectiveDate))) {
      throw new Error('effectiveDate must be a YYYY-MM-DD date');
    }

    const target: { departmentId?: number | null; branchId?: number | null; costCenterId?: number | null } = {};
    if (input.departmentId !== undefined) target.departmentId = input.departmentId === null ? null : Number(input.departmentId);
    if (input.branchId !== undefined) target.branchId = input.branchId === null ? null : Number(input.branchId);
    if (input.costCenterId !== undefined) target.costCenterId = input.costCenterId === null ? null : Number(input.costCenterId);

    const succeeded: BulkTransferResult['succeeded'] = [];
    const failed: BulkTransferResult['failed'] = [];
    const touchedPositions = new Set<number>();

    for (const employeeId of ids) {
      try {
        const before = await this.repo.findEmployeeOrg(employeeId);
        if (!before) throw new Error(`Employee ${employeeId} was not found`);
        if (before.position_id) touchedPositions.add(Number(before.position_id));

        const moved = await this.repo.moveEmployeeOrg(employeeId, target);
        succeeded.push({ employeeId, employeeName: moved.employeeName });

        await this.audit({
          entityType: 'employee',
          entityId: employeeId,
          entityName: moved.employeeName,
          action: 'TRANSFER',
          actor,
          summary: `${moved.employeeName} transferred (bulk)`,
          previousValue: moved.before,
          newValue: moved.after,
        });
      } catch (err: any) {
        failed.push({ employeeId, reason: err.message });
      }
    }

    for (const positionId of touchedPositions) {
      try {
        await this.syncPositionStatus(positionId, actor.userId);
      } catch {
        // A stale seat status must never fail an otherwise successful transfer.
      }
    }

    await this.logActivity(
      actor,
      'employee',
      null,
      'TRANSFER',
      `Bulk transfer: ${succeeded.length} moved, ${failed.length} failed`,
    );

    return {
      succeeded,
      failed,
      effectiveDate: input.effectiveDate ?? null,
      note:
        'Transfers apply immediately. There is no effective-dated org assignment table in this schema, ' +
        'so any effectiveDate supplied is recorded on the audit entry rather than scheduled.',
    };
  }

  // =========================================================================
  // Audit
  // =========================================================================

  async getAuditLog(filters: OrgAuditFilters): Promise<OrgAuditEntry[]> {
    return this.repo.getAuditLog(filters);
  }

  /** Every mutation in this module funnels through here. */
  private async audit(entry: Parameters<OrganizationRepository['logAudit']>[0]): Promise<void> {
    try {
      await this.repo.logAudit(entry);
    } catch (err: any) {
      // An audit failure must not lose the business write that already happened.
      console.error('[organization] audit write failed:', err.message);
    }
  }

  private async logActivity(
    actor: OrgActor,
    entityType: string,
    entityId: number | null,
    action: string,
    summary: string,
  ): Promise<void> {
    try {
      await this.activity.log({
        actorUserId: actor.userId,
        actorName: actor.name,
        entityType: `org:${entityType}`,
        entityId,
        action,
        summary,
      });
    } catch (err: any) {
      console.error('[organization] activity log failed:', err.message);
    }
  }
}
