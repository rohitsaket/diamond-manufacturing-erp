import { Request, Response } from 'express';
import { OrganizationService, resolveSlug } from '../services/OrganizationService';
import { OrgAnalyticsService } from '../services/OrgAnalyticsService';
import { OrgActor, OrgListFilters, OrgEntitySlug } from '../types/organization';
import { detectDeviceAndBrowser, clientIp } from '../utils/documentUtils';

/** Query keys the generic list engine understands, all of them optional ints. */
const NUMERIC_FILTERS = [
  'companyId',
  'parentId',
  'legalEntityId',
  'businessUnitId',
  'divisionId',
  'departmentId',
  'branchId',
  'regionId',
  'groupId',
  'costCenterId',
  'jobFamilyId',
  'jobFunctionId',
  'jobRoleId',
  'jobGradeId',
  'jobLevelId',
  'teamId',
  'limit',
] as const;

export class OrganizationController {
  private service = new OrganizationService();
  private analytics = new OrgAnalyticsService();

  // -------------------------------------------------------------------------
  // Request helpers
  // -------------------------------------------------------------------------

  /** Who did it and from where — reused for every audit row this module writes. */
  private actorOf(req: Request): OrgActor {
    const { device, browser } = detectDeviceAndBrowser(req.headers['user-agent']);
    return {
      userId: req.user!.userId,
      name: req.user!.name,
      role: req.user!.role,
      ip: clientIp(req),
      device,
      browser,
    };
  }

  private intOf(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : undefined;
  }

  private filtersOf(req: Request): OrgListFilters {
    const query = req.query as Record<string, string>;
    const filters: OrgListFilters = {};
    if (query.q) filters.q = query.q;
    if (query.status) filters.status = query.status;
    for (const key of NUMERIC_FILTERS) {
      const parsed = this.intOf(query[key]);
      if (parsed !== undefined) (filters as Record<string, any>)[key] = parsed;
    }
    return filters;
  }

  /** Resolves `:slug`, replying 404 and returning null when it is unknown. */
  private slugOf(req: Request, res: Response): OrgEntitySlug | null {
    const raw = String(req.params.slug ?? '');
    const slug = resolveSlug(raw);
    if (!slug) {
      res.status(404).json({ error: `Unknown organization entity "${raw}"` });
      return null;
    }
    return slug;
  }

  private idOf(req: Request, res: Response, param = 'id', label = 'id'): number | null {
    const value = Number(req.params[param]);
    if (!Number.isFinite(value)) {
      res.status(400).json({ error: `A valid ${label} is required` });
      return null;
    }
    return Math.floor(value);
  }

  // =========================================================================
  // Analytics and views
  // =========================================================================

  getDashboard = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.analytics.getDashboard());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  search = async (req: Request, res: Response): Promise<void> => {
    try {
      const { q, entityType, status, limit } = req.query as Record<string, string>;
      if (!q || !q.trim()) {
        res.status(400).json({ error: 'A search term (q) is required' });
        return;
      }
      const filters: { q: string; entityType?: string; status?: string; limit?: number } = { q };
      if (entityType) {
        const slug = resolveSlug(entityType);
        if (!slug) {
          res.status(400).json({ error: `Unknown organization entity "${entityType}"` });
          return;
        }
        filters.entityType = slug;
      }
      if (status) filters.status = status;
      const parsedLimit = this.intOf(limit);
      if (parsedLimit !== undefined) filters.limit = parsedLimit;

      res.json(await this.analytics.search(filters));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getWorkforce = async (req: Request, res: Response): Promise<void> => {
    try {
      const { groupBy } = req.query as Record<string, string>;
      res.json(await this.analytics.getWorkforce(groupBy ?? 'department'));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getTree = async (req: Request, res: Response): Promise<void> => {
    try {
      const { rootType, rootId, includeTeams, includeEmployees } = req.query as Record<string, string>;
      const options: {
        rootType?: string;
        rootId?: number;
        includeTeams?: boolean;
        includeEmployees?: boolean;
      } = {
        includeTeams: includeTeams === 'true' || includeTeams === '1',
        includeEmployees: includeEmployees === 'true' || includeEmployees === '1',
      };
      if (rootType) options.rootType = rootType;
      const parsedRoot = this.intOf(rootId);
      if (parsedRoot !== undefined) options.rootId = parsedRoot;
      if (options.rootType && options.rootId === undefined) {
        res.status(400).json({ error: 'rootId is required when rootType is supplied' });
        return;
      }

      res.json(await this.service.getTree(options));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getChart = async (req: Request, res: Response): Promise<void> => {
    try {
      const { rootEmployeeId, depth } = req.query as Record<string, string>;
      const root = this.intOf(rootEmployeeId);
      const levels = this.intOf(depth);
      res.json(await this.service.getReportingChart(root, levels));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getPositionChart = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.getPositionChart());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getAudit = async (req: Request, res: Response): Promise<void> => {
    try {
      const { entityType, entityId, action, actorUserId, from, to, limit } = req.query as Record<string, string>;
      res.json(
        await this.service.getAuditLog({
          entityType: entityType || undefined,
          entityId: this.intOf(entityId),
          action: action || undefined,
          actorUserId: this.intOf(actorUserId),
          from: from || undefined,
          to: to || undefined,
          limit: this.intOf(limit),
        }),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  exportCsv = async (req: Request, res: Response): Promise<void> => {
    try {
      const entity = String(req.params.entity ?? '');
      const { filename, csv } = await this.analytics.exportCsv(entity, this.filtersOf(req));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Reparent
  // =========================================================================

  reparent = async (req: Request, res: Response): Promise<void> => {
    try {
      const { entityType, id, newParentId, newParentType } = req.body ?? {};
      if (!entityType) {
        res.status(400).json({ error: 'entityType is required' });
        return;
      }
      if (!Number.isFinite(Number(id))) {
        res.status(400).json({ error: 'A valid id is required' });
        return;
      }
      res.json(
        await this.service.reparent(
          {
            entityType: String(entityType),
            id: Math.floor(Number(id)),
            newParentId: newParentId === null || newParentId === undefined ? null : Math.floor(Number(newParentId)),
            newParentType: newParentType ? String(newParentType) : undefined,
          },
          this.actorOf(req),
        ),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Reporting relationships
  // =========================================================================

  listReporting = async (req: Request, res: Response): Promise<void> => {
    try {
      const { employeeId, managerEmployeeId, relationshipType, activeOnly, limit } = req.query as Record<string, string>;
      res.json(
        await this.service.listReporting({
          employeeId: this.intOf(employeeId),
          managerEmployeeId: this.intOf(managerEmployeeId),
          relationshipType: relationshipType || undefined,
          activeOnly: activeOnly === 'true' || activeOnly === '1',
          limit: this.intOf(limit),
        }),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createReporting = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!Number.isFinite(Number(body.employeeId)) || !Number.isFinite(Number(body.managerEmployeeId))) {
        res.status(400).json({ error: 'employeeId and managerEmployeeId are required' });
        return;
      }
      res.status(201).json(await this.service.createReporting(body, this.actorOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteReporting = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOf(req, res, 'id', 'reporting line id');
      if (id === null) return;
      res.json(await this.service.deleteReporting(id, this.actorOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Change requests
  // =========================================================================

  listChangeRequests = async (req: Request, res: Response): Promise<void> => {
    try {
      const { status, requestType, entityType, limit } = req.query as Record<string, string>;
      res.json(
        await this.service.listChangeRequests({
          status: status || undefined,
          requestType: requestType || undefined,
          entityType: entityType || undefined,
          limit: this.intOf(limit),
        }),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createChangeRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.service.createChangeRequest(req.body ?? {}, this.actorOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  decideChangeRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOf(req, res, 'id', 'change request id');
      if (id === null) return;
      const decision = String(req.body?.decision ?? '').toUpperCase();
      if (decision !== 'APPROVED' && decision !== 'REJECTED') {
        res.status(400).json({ error: "decision must be either 'APPROVED' or 'REJECTED'" });
        return;
      }
      res.json(
        await this.service.decideChangeRequest(
          id,
          decision as 'APPROVED' | 'REJECTED',
          req.body?.note ?? null,
          this.actorOf(req),
        ),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Policies
  // =========================================================================

  listPolicies = async (req: Request, res: Response): Promise<void> => {
    try {
      const { companyId, branchId, policyType, status } = req.query as Record<string, string>;
      res.json(
        await this.service.listPolicies({
          companyId: this.intOf(companyId),
          branchId: this.intOf(branchId),
          policyType: policyType || undefined,
          status: status || undefined,
        }),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createPolicy = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(201).json(await this.service.createPolicy(req.body ?? {}, this.actorOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updatePolicy = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOf(req, res, 'id', 'policy id');
      if (id === null) return;
      res.json(await this.service.updatePolicy(id, req.body ?? {}, this.actorOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Career paths
  // =========================================================================

  listCareerPaths = async (req: Request, res: Response): Promise<void> => {
    try {
      const { fromRoleId } = req.query as Record<string, string>;
      res.json(await this.service.listCareerPaths(this.intOf(fromRoleId)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createCareerPath = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!Number.isFinite(Number(body.fromRoleId)) || !Number.isFinite(Number(body.toRoleId))) {
        res.status(400).json({ error: 'fromRoleId and toRoleId are required' });
        return;
      }
      res.status(201).json(await this.service.createCareerPath(body, this.actorOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteCareerPath = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idOf(req, res, 'id', 'career path id');
      if (id === null) return;
      res.json(await this.service.deleteCareerPath(id, this.actorOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Team members
  // =========================================================================

  listTeamMembers = async (req: Request, res: Response): Promise<void> => {
    try {
      const teamId = this.idOf(req, res, 'teamId', 'team id');
      if (teamId === null) return;
      res.json(await this.service.listTeamMembers(teamId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  addTeamMember = async (req: Request, res: Response): Promise<void> => {
    try {
      const teamId = this.idOf(req, res, 'teamId', 'team id');
      if (teamId === null) return;
      const body = req.body ?? {};
      if (!Number.isFinite(Number(body.employeeId))) {
        res.status(400).json({ error: 'A valid employeeId is required' });
        return;
      }
      res.status(201).json(await this.service.addTeamMember(teamId, body, this.actorOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  removeTeamMember = async (req: Request, res: Response): Promise<void> => {
    try {
      const teamId = this.idOf(req, res, 'teamId', 'team id');
      if (teamId === null) return;
      const employeeId = this.idOf(req, res, 'employeeId', 'employee id');
      if (employeeId === null) return;
      res.json(await this.service.removeTeamMember(teamId, employeeId, this.actorOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Bulk
  // =========================================================================

  bulkImport = async (req: Request, res: Response): Promise<void> => {
    try {
      const slug = this.slugOf(req, res);
      if (!slug) return;
      const rows = Array.isArray(req.body) ? req.body : req.body?.rows;
      if (!Array.isArray(rows)) {
        res.status(400).json({ error: 'Provide an array of rows, either as the body or as { rows: [...] }' });
        return;
      }
      res.json(await this.service.bulkImport(slug, rows, this.actorOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  bulkTransfer = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!Array.isArray(body.employeeIds) || body.employeeIds.length === 0) {
        res.status(400).json({ error: 'employeeIds must be a non-empty array' });
        return;
      }
      res.json(await this.service.bulkTransfer(body, this.actorOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Generic entity CRUD (registered last so literal paths win)
  // =========================================================================

  listEntities = async (req: Request, res: Response): Promise<void> => {
    try {
      const slug = this.slugOf(req, res);
      if (!slug) return;
      res.json(await this.service.list(slug, this.filtersOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getEntity = async (req: Request, res: Response): Promise<void> => {
    try {
      const slug = this.slugOf(req, res);
      if (!slug) return;
      const id = this.idOf(req, res);
      if (id === null) return;
      res.json(await this.service.getById(slug, id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createEntity = async (req: Request, res: Response): Promise<void> => {
    try {
      const slug = this.slugOf(req, res);
      if (!slug) return;
      res.status(201).json(await this.service.create(slug, req.body ?? {}, this.actorOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateEntity = async (req: Request, res: Response): Promise<void> => {
    try {
      const slug = this.slugOf(req, res);
      if (!slug) return;
      const id = this.idOf(req, res);
      if (id === null) return;
      res.json(await this.service.update(slug, id, req.body ?? {}, this.actorOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteEntity = async (req: Request, res: Response): Promise<void> => {
    try {
      const slug = this.slugOf(req, res);
      if (!slug) return;
      const id = this.idOf(req, res);
      if (id === null) return;
      res.json(await this.service.remove(slug, id, this.actorOf(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
