import { Request, Response } from 'express';
import { DocumentService, DocumentActor, DocumentDownload } from '../services/DocumentService';
import { DocumentAdminService } from '../services/DocumentAdminService';
import { listStorageDrivers } from '../services/storage/StorageDriver';
import { DocumentSearchParams, DOCUMENT_STATUSES, DocumentStatus } from '../repositories/DocumentRepository';
import { STAFF_ROLES } from '../middleware/auth';
import { safeInt } from '../utils/documentUtils';

/**
 * HTTP surface for the document module.
 *
 * Convention (matching the rest of the codebase): arrow-function class
 * properties, try/catch to a 500 with the service's message, raw JSON payloads,
 * 201 on create. Bad input is a 400 before the service is ever called; the
 * "not configured" capabilities answer 501.
 */
export class DocumentController {
  private service = new DocumentService();
  private admin = new DocumentAdminService();

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  private actorOf(req: Request): DocumentActor {
    const user = req.user!;
    return {
      userId: user.userId,
      name: user.name,
      role: user.role,
      employeeId: user.employeeId ?? null,
    };
  }

  private isStaff(req: Request): boolean {
    return STAFF_ROLES.includes(req.user?.role as (typeof STAFF_ROLES)[number]);
  }

  /** Parse a positive integer route param, or null when it is not one. */
  private idParam(req: Request, name: string): number | null {
    const value = Number(req.params[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }

  /**
   * `/:id` reads are open to any authenticated user, which for a self-service
   * login must still mean "your own documents only" — an employee must never be
   * able to page through document ids and read a colleague's payslip.
   * Returns true when the request was already answered with a 403.
   */
  private async blockedByOwnership(req: Request, res: Response, id: number): Promise<boolean> {
    if (this.isStaff(req)) return false;
    const doc = await this.service.getById(id, true);
    if (req.user?.employeeId && doc.employeeId === req.user.employeeId) return false;
    res.status(403).json({ error: 'You can only access your own documents' });
    return true;
  }

  private sendStream(res: Response, download: DocumentDownload, disposition: 'attachment' | 'inline'): void {
    const safeName = download.fileName.replace(/["\r\n]/g, '_');
    res.setHeader('Content-Type', download.mimeType);
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(download.fileName)}`,
    );
    if (download.size > 0) res.setHeader('Content-Length', String(download.size));
    if (download.watermark !== undefined) res.setHeader('X-Document-Watermark', download.watermark ? '1' : '0');

    download.stream.on('error', (err: any) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.end();
    });
    download.stream.pipe(res);
  }

  // =========================================================================
  // Document types
  // =========================================================================
  listTypes = async (req: Request, res: Response): Promise<void> => {
    try {
      const { category, country, activeOnly, search } = req.query as Record<string, string>;
      const types = await this.admin.listTypes({
        category,
        country,
        activeOnly: activeOnly === undefined ? true : activeOnly !== 'false',
        search,
      });
      res.json(types);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createType = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!body.code || !String(body.code).trim()) {
        res.status(400).json({ error: 'A document type code is required' });
        return;
      }
      if (!body.name || !String(body.name).trim()) {
        res.status(400).json({ error: 'A document type name is required' });
        return;
      }
      const type = await this.admin.createType(body, req.user!.userId);
      res.status(201).json(type);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateType = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'typeId');
      if (id === null) {
        res.status(400).json({ error: 'A valid document type id is required' });
        return;
      }
      const type = await this.admin.updateType(id, req.body ?? {}, req.user!.userId);
      res.json(type);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteType = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'typeId');
      if (id === null) {
        res.status(400).json({ error: 'A valid document type id is required' });
        return;
      }
      res.json(await this.admin.deactivateType(id, req.user!.userId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Requirements
  // =========================================================================
  listRequirements = async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query as Record<string, string>;
      const rows = await this.admin.listRequirements({
        documentTypeId: q.documentTypeId ? Number(q.documentTypeId) : undefined,
        country: q.country,
        employmentType: q.employmentType,
        workerType: q.workerType,
        grade: q.grade,
        department: q.department,
        mandatoryOnly: q.mandatoryOnly === 'true',
      });
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createRequirement = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (!body.documentTypeId) {
        res.status(400).json({ error: 'documentTypeId is required' });
        return;
      }
      const created = await this.admin.createRequirement(body, req.user!.userId);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteRequirement = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'reqId');
      if (id === null) {
        res.status(400).json({ error: 'A valid requirement id is required' });
        return;
      }
      res.json(await this.admin.deleteRequirement(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Search / dashboard / drivers
  // =========================================================================
  search = async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query as Record<string, string>;

      let statuses: string[] | undefined;
      if (q.status) {
        statuses = q.status
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        const bad = statuses.find((s) => !DOCUMENT_STATUSES.includes(s as DocumentStatus));
        if (bad) {
          res.status(400).json({ error: `Unknown status "${bad}". Valid: ${DOCUMENT_STATUSES.join(', ')}` });
          return;
        }
      }

      const page = safeInt(q.page, 1, 1, 100000);
      const limit = safeInt(q.limit, 50, 1, 2000);

      const params: DocumentSearchParams = {
        employeeId: q.employeeId ? Number(q.employeeId) : undefined,
        employeeName: q.employeeName,
        department: q.department,
        branch: q.branch,
        documentTypeId: q.documentTypeId ? Number(q.documentTypeId) : undefined,
        category: q.category,
        status: statuses,
        tags: q.tags,
        fileName: q.fileName,
        docNumber: q.docNumber,
        uploadedBy: q.uploadedBy ? Number(q.uploadedBy) : undefined,
        verifiedBy: q.verifiedBy ? Number(q.verifiedBy) : undefined,
        uploadedFrom: q.uploadedFrom,
        uploadedTo: q.uploadedTo,
        expiresFrom: q.expiresFrom,
        expiresTo: q.expiresTo,
        expiringInDays: q.expiringInDays ? Number(q.expiringInDays) : undefined,
        ocrText: q.ocrText,
        includeArchived: q.includeArchived === 'true',
        includeDeleted: q.includeDeleted === 'true',
        currentVersionsOnly: q.currentVersionsOnly !== 'false',
        sort: q.sort,
        order: q.order,
        limit,
        offset: (page - 1) * limit,
      };

      const result = await this.service.search(params);
      res.json({
        rows: result.rows,
        total: result.total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(result.total / limit)),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  dashboard = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.admin.getDashboard());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  storageDrivers = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(listStorageDrivers());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Reports
  // =========================================================================
  report = async (req: Request, res: Response): Promise<void> => {
    try {
      const name = String(req.params.report ?? '');
      const result = await this.admin.runReport(name, req.query as Record<string, string | undefined>);

      if (String(req.query.format ?? '').toLowerCase() === 'csv') {
        const csv = this.admin.toCsv(result.rows, result.headers);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
        );
        res.send(csv);
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Compliance
  // =========================================================================
  compliance = async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query as Record<string, string>;
      const limit = safeInt(q.limit, 50, 1, 500);
      const page = safeInt(q.page, 1, 1, 100000);
      const result = await this.admin.getComplianceReport({
        department: q.department,
        branch: q.branch,
        limit,
        offset: q.offset ? Number(q.offset) : (page - 1) * limit,
      });
      res.json({ ...result, page, limit });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  complianceForEmployee = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.idParam(req, 'employeeId');
      if (employeeId === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.admin.getComplianceScore(employeeId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  missingForEmployee = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.idParam(req, 'employeeId');
      if (employeeId === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.admin.getMissingDocuments(employeeId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Bulk
  // =========================================================================
  bulk = async (req: Request, res: Response): Promise<void> => {
    try {
      const action = String(req.params.action ?? '').toLowerCase();
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'ids must be a non-empty array of document ids' });
        return;
      }
      const result = await this.admin.runBulk(action, ids, this.actorOf(req), req);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Maintenance jobs (expiry sweep + reminders)
  // =========================================================================
  runExpirySweep = async (_req: Request, res: Response): Promise<void> => {
    try {
      const expired = await this.service.markExpiredDocuments();
      res.json({ expired });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  runExpiryReminders = async (_req: Request, res: Response): Promise<void> => {
    try {
      const reminded = await this.service.sendExpiryReminders();
      res.json({ reminded });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Employee-scoped
  // =========================================================================
  upload = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.idParam(req, 'employeeId');
      if (employeeId === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'A file is required' });
        return;
      }
      const body = req.body ?? {};
      if (!body.documentTypeId && !body.documentTypeCode) {
        res.status(400).json({ error: 'A documentTypeId or documentTypeCode is required' });
        return;
      }

      const doc = await this.service.upload(
        employeeId,
        req.file,
        {
          documentTypeId: body.documentTypeId ? Number(body.documentTypeId) : undefined,
          documentTypeCode: body.documentTypeCode,
          title: body.title,
          docNumber: body.docNumber,
          issuingAuthority: body.issuingAuthority,
          issuedOn: body.issuedOn,
          expiresOn: body.expiresOn,
          tags: body.tags,
          notes: body.notes,
          storageDriver: body.storageDriver,
        },
        this.actorOf(req),
        req,
      );
      res.status(201).json(doc);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  listForEmployee = async (req: Request, res: Response): Promise<void> => {
    try {
      const employeeId = this.idParam(req, 'employeeId');
      if (employeeId === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      const q = req.query as Record<string, string>;
      const docs = await this.service.listForEmployee(employeeId, {
        includeArchived: q.includeArchived === 'true',
        currentVersionsOnly: q.currentVersionsOnly !== 'false',
      });
      res.json(docs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Single document
  // =========================================================================
  getOne = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'id');
      if (id === null) {
        res.status(400).json({ error: 'A valid document id is required' });
        return;
      }
      if (await this.blockedByOwnership(req, res, id)) return;
      res.json(await this.service.getById(id, req.query.includeDeleted === 'true'));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  versions = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'id');
      if (id === null) {
        res.status(400).json({ error: 'A valid document id is required' });
        return;
      }
      if (await this.blockedByOwnership(req, res, id)) return;
      res.json(await this.service.listVersions(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  audit = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'id');
      if (id === null) {
        res.status(400).json({ error: 'A valid document id is required' });
        return;
      }
      const q = req.query as Record<string, string>;
      const result = await this.service.listAudit({
        documentId: id,
        action: q.action,
        from: q.from,
        to: q.to,
        limit: q.limit ? Number(q.limit) : 100,
        offset: q.offset ? Number(q.offset) : 0,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  replace = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'id');
      if (id === null) {
        res.status(400).json({ error: 'A valid document id is required' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'A file is required' });
        return;
      }
      const body = req.body ?? {};
      const doc = await this.service.replace(
        id,
        req.file,
        {
          title: body.title,
          docNumber: body.docNumber,
          issuingAuthority: body.issuingAuthority,
          issuedOn: body.issuedOn,
          expiresOn: body.expiresOn,
          tags: body.tags,
          notes: body.notes,
        },
        this.actorOf(req),
        req,
      );
      res.status(201).json(doc);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateMetadata = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'id');
      if (id === null) {
        res.status(400).json({ error: 'A valid document id is required' });
        return;
      }
      const body = req.body ?? {};
      const doc = await this.service.updateMetadata(
        id,
        {
          title: body.title,
          documentTypeId: body.documentTypeId !== undefined ? Number(body.documentTypeId) : undefined,
          docNumber: body.docNumber,
          issuingAuthority: body.issuingAuthority,
          issuedOn: body.issuedOn,
          expiresOn: body.expiresOn,
          tags: body.tags,
          notes: body.notes,
        },
        this.actorOf(req),
        req,
      );
      res.json(doc);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // -------------------------------------------------------------------------
  // Workflow
  // -------------------------------------------------------------------------
  private workflow(
    run: (id: number, req: Request) => Promise<unknown>,
  ): (req: Request, res: Response) => Promise<void> {
    return async (req: Request, res: Response): Promise<void> => {
      try {
        const id = this.idParam(req, 'id');
        if (id === null) {
          res.status(400).json({ error: 'A valid document id is required' });
          return;
        }
        res.json(await run(id, req));
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    };
  }

  submit = this.workflow((id, req) => this.service.submitForReview(id, this.actorOf(req), req));
  review = this.workflow((id, req) => this.service.review(id, this.actorOf(req), req));
  verify = this.workflow((id, req) => this.service.verify(id, this.actorOf(req), req));
  approve = this.workflow((id, req) => this.service.approve(id, this.actorOf(req), req));
  archive = this.workflow((id, req) => this.service.archive(id, this.actorOf(req), req));
  lock = this.workflow((id, req) => this.service.lock(id, this.actorOf(req), req));
  unlock = this.workflow((id, req) => this.service.unlock(id, this.actorOf(req), req));
  restore = this.workflow((id, req) => this.service.restore(id, this.actorOf(req), req));
  restoreVersion = this.workflow((id, req) => this.service.restoreVersion(id, this.actorOf(req), req));
  integrity = this.workflow((id) => this.service.verifyIntegrity(id));

  reject = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'id');
      if (id === null) {
        res.status(400).json({ error: 'A valid document id is required' });
        return;
      }
      const reason = String(req.body?.reason ?? req.body?.rejectedReason ?? '').trim();
      if (!reason) {
        res.status(400).json({ error: 'A rejection reason is required' });
        return;
      }
      res.json(await this.service.reject(id, reason, this.actorOf(req), req));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'id');
      if (id === null) {
        res.status(400).json({ error: 'A valid document id is required' });
        return;
      }
      await this.service.remove(id, this.actorOf(req), req);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // -------------------------------------------------------------------------
  // Download / print
  // -------------------------------------------------------------------------
  download = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'id');
      if (id === null) {
        res.status(400).json({ error: 'A valid document id is required' });
        return;
      }
      if (await this.blockedByOwnership(req, res, id)) return;
      const file = await this.service.getDownload(id, this.actorOf(req), req);
      this.sendStream(res, file, 'attachment');
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  print = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'id');
      if (id === null) {
        res.status(400).json({ error: 'A valid document id is required' });
        return;
      }
      if (await this.blockedByOwnership(req, res, id)) return;
      const file = await this.service.getDownload(id, this.actorOf(req), req, { asPrint: true });
      this.sendStream(res, file, 'inline');
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // -------------------------------------------------------------------------
  // Comments
  // -------------------------------------------------------------------------
  listComments = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'id');
      if (id === null) {
        res.status(400).json({ error: 'A valid document id is required' });
        return;
      }
      if (await this.blockedByOwnership(req, res, id)) return;
      res.json(await this.service.listComments(id, this.isStaff(req)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  addComment = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'id');
      if (id === null) {
        res.status(400).json({ error: 'A valid document id is required' });
        return;
      }
      const body = String(req.body?.body ?? '').trim();
      if (!body) {
        res.status(400).json({ error: 'A comment body is required' });
        return;
      }
      if (await this.blockedByOwnership(req, res, id)) return;
      const created = await this.service.addComment(
        id,
        body,
        !!req.body?.isInternal,
        this.actorOf(req),
        this.isStaff(req),
      );
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // -------------------------------------------------------------------------
  // Shares
  // -------------------------------------------------------------------------
  createShare = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'id');
      if (id === null) {
        res.status(400).json({ error: 'A valid document id is required' });
        return;
      }
      const body = req.body ?? {};
      const share = await this.service.createShare(
        id,
        {
          expiresInHours: body.expiresInHours !== undefined ? Number(body.expiresInHours) : undefined,
          maxDownloads: body.maxDownloads === undefined ? null : body.maxDownloads,
          allowDownload: body.allowDownload,
          watermark: body.watermark,
          allowedIp: body.allowedIp,
          note: body.note,
        },
        this.actorOf(req),
        req,
      );
      res.status(201).json(share);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  listShares = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'id');
      if (id === null) {
        res.status(400).json({ error: 'A valid document id is required' });
        return;
      }
      res.json(await this.service.listShares(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  revokeShare = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.idParam(req, 'shareId');
      if (id === null) {
        res.status(400).json({ error: 'A valid share id is required' });
        return;
      }
      await this.service.revokeShare(id, this.actorOf(req), req);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  /** Public: no authentication, that is the entire point of a share link. */
  sharedDownload = async (req: Request, res: Response): Promise<void> => {
    try {
      const token = String(req.params.token ?? '');
      if (!/^[a-f0-9]{64}$/i.test(token)) {
        res.status(400).json({ error: 'This link is not valid' });
        return;
      }
      const file = await this.service.resolveShare(token, req);
      this.sendStream(res, file, 'inline');
    } catch (err: any) {
      res.status(403).json({ error: err.message });
    }
  };

  // -------------------------------------------------------------------------
  // Capabilities this deployment does not have — 501, never a fake result
  // -------------------------------------------------------------------------
  ocr = async (req: Request, res: Response): Promise<void> => {
    const id = this.idParam(req, 'id');
    if (id === null) {
      res.status(400).json({ error: 'A valid document id is required' });
      return;
    }
    try {
      await this.service.runOcr(id, this.actorOf(req), req);
      res.status(501).json({ error: 'OCR is not configured' });
    } catch (err: any) {
      res.status(501).json({ error: err.message, ocrStatus: 'UNSUPPORTED' });
    }
  };

  scan = async (req: Request, res: Response): Promise<void> => {
    const id = this.idParam(req, 'id');
    if (id === null) {
      res.status(400).json({ error: 'A valid document id is required' });
      return;
    }
    try {
      await this.service.runVirusScan(id, this.actorOf(req), req);
      res.status(501).json({ error: 'Virus scanning is not configured' });
    } catch (err: any) {
      res.status(501).json({ error: err.message, virusScanStatus: 'NOT_RUN' });
    }
  };
}
