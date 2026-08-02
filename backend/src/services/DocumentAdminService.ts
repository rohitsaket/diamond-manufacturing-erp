import {
  DocumentRepository,
  DocumentTypeInput,
  DocumentTypeResponse,
  DocumentTypeCategory,
  DOCUMENT_TYPE_CATEGORIES,
  DocumentRequirementResponse,
  RequirementInput,
  RequirementFilters,
  LegacyDocType,
  LEGACY_DOC_TYPES,
  AuditFilters,
} from '../repositories/DocumentRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { DocumentActor, DocumentService } from './DocumentService';
import { generateCsv } from '../utils/csv';
import { normalizeCountry, formatBytes, RequestLike, safeInt } from '../utils/documentUtils';
import { addDays, todayString, toDateString } from '../utils/dateUtils';

/**
 * Administration side of the document module: the type/requirement master
 * data, compliance maths, reports and bulk actions.
 *
 * Everything workforce-wide in here is set-based SQL. `getComplianceReport`
 * over 100k employees is one grouped query, not 100k queries.
 */

export interface MissingDocument {
  documentTypeId: number;
  typeCode: string;
  typeName: string;
  category: DocumentTypeCategory | null;
  dueDate: string | null;
  overdue: boolean;
  notes: string | null;
}

export interface ComplianceScore {
  employeeId: number;
  required: number;
  present: number;
  missing: number;
  expired: number;
  pct: number;
}

export interface ComplianceRow {
  employeeId: number;
  empCode: string | null;
  employeeName: string;
  department: string | null;
  branch: string | null;
  required: number;
  present: number;
  missing: number;
  expired: number;
  pct: number;
}

export interface BulkResult {
  succeeded: number[];
  failed: Array<{ id: number; reason: string }>;
}

export interface ReportResult {
  report: string;
  generatedAt: string;
  headers: string[];
  rows: Record<string, unknown>[];
  total: number;
}

export const REPORT_NAMES = [
  'missing-documents',
  'expiring',
  'verification-status',
  'upload-history',
  'download-history',
  'audit-history',
  'storage-usage',
  'completeness',
] as const;

export type ReportName = (typeof REPORT_NAMES)[number];

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]{1,59}$/;

export class DocumentAdminService {
  private repo = new DocumentRepository();
  private employeeRepo = new EmployeeRepository();
  private documents = new DocumentService();

  // =========================================================================
  // Document types
  // =========================================================================
  async listTypes(filters: {
    category?: string;
    country?: string;
    activeOnly?: boolean;
    search?: string;
  }): Promise<DocumentTypeResponse[]> {
    if (filters.category && !DOCUMENT_TYPE_CATEGORIES.includes(filters.category as DocumentTypeCategory)) {
      throw new Error(`category must be one of: ${DOCUMENT_TYPE_CATEGORIES.join(', ')}`);
    }
    return this.repo.listTypes(filters);
  }

  async getType(id: number): Promise<DocumentTypeResponse> {
    const type = await this.repo.findTypeById(id);
    if (!type) throw new Error('Document type not found');
    return type;
  }

  async createType(input: DocumentTypeInput, userId: number): Promise<DocumentTypeResponse> {
    const data = this.validateType(input, true);

    const existing = await this.repo.findTypeRowByCode(data.code as string);
    if (existing) throw new Error(`A document type with the code ${data.code} already exists`);

    const id = await this.repo.createType(data, userId);
    return this.getType(id);
  }

  async updateType(id: number, input: DocumentTypeInput, userId: number): Promise<DocumentTypeResponse> {
    const existing = await this.repo.findTypeRowById(id);
    if (!existing) throw new Error('Document type not found');

    const data = this.validateType(input, false);
    if (data.code && data.code !== existing.code) {
      const clash = await this.repo.findTypeRowByCode(data.code);
      if (clash && Number(clash.id) !== id) {
        throw new Error(`A document type with the code ${data.code} already exists`);
      }
    }

    await this.repo.updateType(id, data, userId);
    return this.getType(id);
  }

  async deactivateType(id: number, userId: number): Promise<{ success: true }> {
    const existing = await this.repo.findTypeRowById(id);
    if (!existing) throw new Error('Document type not found');

    const inUse = await this.repo.countDocumentsForType(id);
    if (inUse > 0) throw new Error(`${inUse} documents still use this type`);

    await this.repo.deactivateType(id, userId);
    return { success: true };
  }

  private validateType(input: DocumentTypeInput, isCreate: boolean): DocumentTypeInput {
    const out: DocumentTypeInput = {};

    if (input.code !== undefined || isCreate) {
      const code = String(input.code ?? '').trim().toUpperCase();
      if (!code) throw new Error('A document type code is required');
      if (!CODE_PATTERN.test(code)) {
        throw new Error('A code must be 2-60 characters of A-Z, 0-9 and underscore');
      }
      out.code = code;
    }

    if (input.name !== undefined || isCreate) {
      const name = String(input.name ?? '').trim();
      if (!name) throw new Error('A document type name is required');
      out.name = name.slice(0, 160);
    }

    if (input.category !== undefined || isCreate) {
      const category = String(input.category ?? 'OTHER').trim().toUpperCase() as DocumentTypeCategory;
      if (!DOCUMENT_TYPE_CATEGORIES.includes(category)) {
        throw new Error(`category must be one of: ${DOCUMENT_TYPE_CATEGORIES.join(', ')}`);
      }
      out.category = category;
    }

    if (input.description !== undefined) {
      out.description = input.description ? String(input.description).slice(0, 500) : null;
    }
    if (input.country !== undefined) {
      out.country = input.country ? normalizeCountry(input.country) : null;
      if (input.country && !out.country) {
        throw new Error('country must be an ISO-2 code such as IN, US or AE');
      }
    }
    if (input.legacyDocType !== undefined) {
      if (input.legacyDocType === null) {
        out.legacyDocType = null;
      } else {
        const legacy = String(input.legacyDocType).trim().toUpperCase() as LegacyDocType;
        if (!LEGACY_DOC_TYPES.includes(legacy)) {
          throw new Error(`legacyDocType must be one of: ${LEGACY_DOC_TYPES.join(', ')}`);
        }
        out.legacyDocType = legacy;
      }
    }

    for (const flag of [
      'isMandatory',
      'requiresExpiry',
      'requiresVerification',
      'requiresApproval',
      'allowsMultiple',
      'isConfidential',
      'isActive',
    ] as const) {
      if (input[flag] !== undefined) out[flag] = !!input[flag];
    }

    if (input.maxFileMb !== undefined) {
      const mb = Number(input.maxFileMb);
      if (!Number.isFinite(mb) || mb < 1 || mb > 50) throw new Error('maxFileMb must be between 1 and 50');
      out.maxFileMb = Math.floor(mb);
    }
    if (input.renewalReminderDays !== undefined) {
      const days = Number(input.renewalReminderDays);
      if (!Number.isFinite(days) || days < 0 || days > 365) {
        throw new Error('renewalReminderDays must be between 0 and 365');
      }
      out.renewalReminderDays = Math.floor(days);
    }
    if (input.retentionMonths !== undefined) {
      if (input.retentionMonths === null) {
        out.retentionMonths = null;
      } else {
        const months = Number(input.retentionMonths);
        if (!Number.isFinite(months) || months < 1 || months > 1200) {
          throw new Error('retentionMonths must be between 1 and 1200');
        }
        out.retentionMonths = Math.floor(months);
      }
    }
    if (input.sortOrder !== undefined) {
      out.sortOrder = safeInt(input.sortOrder, 100, 0, 9999);
    }

    return out;
  }

  // =========================================================================
  // Requirements
  // =========================================================================
  async listRequirements(filters: RequirementFilters): Promise<DocumentRequirementResponse[]> {
    return this.repo.listRequirements(filters);
  }

  async createRequirement(input: RequirementInput, userId: number): Promise<DocumentRequirementResponse> {
    const typeId = Number(input.documentTypeId);
    if (!Number.isFinite(typeId)) throw new Error('A valid documentTypeId is required');

    const type = await this.repo.findTypeRowById(typeId);
    if (!type) throw new Error('Document type not found');

    let dueDays: number | null = null;
    if (input.dueDaysAfterJoining !== undefined && input.dueDaysAfterJoining !== null) {
      const days = Number(input.dueDaysAfterJoining);
      if (!Number.isFinite(days) || days < 0 || days > 3650) {
        throw new Error('dueDaysAfterJoining must be between 0 and 3650');
      }
      dueDays = Math.floor(days);
    }

    const country = input.country ? normalizeCountry(input.country) : null;
    if (input.country && !country) throw new Error('country must be an ISO-2 code such as IN, US or AE');

    const id = await this.repo.createRequirement(
      {
        documentTypeId: typeId,
        country,
        employmentType: input.employmentType?.trim() || null,
        workerType: input.workerType?.trim() || null,
        grade: input.grade?.trim() || null,
        department: input.department?.trim() || null,
        isMandatory: input.isMandatory === undefined ? true : !!input.isMandatory,
        dueDaysAfterJoining: dueDays,
        notes: input.notes?.slice(0, 255) ?? null,
      },
      userId,
    );

    const created = await this.repo.findRequirementById(id);
    if (!created) throw new Error('The requirement could not be saved');
    return created;
  }

  async deleteRequirement(id: number): Promise<{ success: true }> {
    const existing = await this.repo.findRequirementById(id);
    if (!existing) throw new Error('Requirement not found');
    await this.repo.deleteRequirement(id);
    return { success: true };
  }

  // =========================================================================
  // Compliance
  // =========================================================================
  async getMissingDocuments(employeeId: number): Promise<MissingDocument[]> {
    const employee = await this.employeeRepo.findRowById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const requirements = await this.repo.findApplicableRequirements(employee as any);
    const held = await this.repo.findHeldTypeIds(employeeId);
    const joinedAt = employee.joined_at ? toDateString(employee.joined_at) : null;
    const today = todayString();

    const missing: MissingDocument[] = [];
    for (const req of requirements) {
      if (!req.isMandatory) continue;
      const existing = held.get(req.documentTypeId);
      // An expired document is a compliance gap, not a satisfied requirement.
      if (existing && existing.status !== 'EXPIRED') continue;

      const dueDate =
        joinedAt && req.dueDaysAfterJoining !== null ? addDays(joinedAt, req.dueDaysAfterJoining) : null;

      missing.push({
        documentTypeId: req.documentTypeId,
        typeCode: req.typeCode ?? '',
        typeName: req.typeName ?? '',
        category: req.category,
        dueDate,
        overdue: dueDate !== null && dueDate < today,
        notes: req.notes,
      });
    }
    return missing;
  }

  async getComplianceScore(employeeId: number): Promise<ComplianceScore> {
    const employee = await this.employeeRepo.findRowById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const requirements = (await this.repo.findApplicableRequirements(employee as any)).filter((r) => r.isMandatory);
    const held = await this.repo.findHeldTypeIds(employeeId);

    let present = 0;
    let expired = 0;
    for (const req of requirements) {
      const existing = held.get(req.documentTypeId);
      if (!existing) continue;
      if (existing.status === 'EXPIRED') expired++;
      else present++;
    }

    const required = requirements.length;
    return {
      employeeId,
      required,
      present,
      missing: Math.max(0, required - present),
      expired,
      pct: required > 0 ? Math.round((present / required) * 100) : 100,
    };
  }

  async getComplianceReport(filters: {
    department?: string;
    branch?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ rows: ComplianceRow[]; total: number }> {
    const result = await this.repo.complianceRows(filters);
    return { rows: result.rows.map((r) => this.toComplianceRow(r)), total: result.total };
  }

  private toComplianceRow(r: any): ComplianceRow {
    const required = Number(r.required ?? 0);
    const present = Number(r.present ?? 0);
    return {
      employeeId: Number(r.employee_id),
      empCode: r.emp_code ?? null,
      employeeName: r.full_name,
      department: r.department ?? null,
      branch: r.branch ?? null,
      required,
      present,
      missing: Math.max(0, required - present),
      expired: Number(r.expired ?? 0),
      pct: required > 0 ? Math.round((present / required) * 100) : 100,
    };
  }

  // =========================================================================
  // Dashboard
  // =========================================================================
  async getDashboard(): Promise<Record<string, unknown>> {
    const [byStatus, storage, trend, totals, expiring30, recent, expiringList] = await Promise.all([
      this.repo.countsByStatus(),
      this.repo.storageUsage(),
      this.repo.uploadTrend(12),
      this.repo.complianceTotals(),
      this.repo.countExpiringWithin(30),
      this.repo.recentUploads(10),
      this.repo.expiringSoon(30, 20),
    ]);

    const statusMap: Record<string, number> = {};
    let totalDocuments = 0;
    for (const row of byStatus) {
      statusMap[row.status] = row.count;
      totalDocuments += row.count;
    }

    return {
      totalDocuments,
      byStatus: statusMap,
      pendingReview: statusMap.PENDING_REVIEW ?? 0,
      pendingVerification: statusMap.PENDING_VERIFICATION ?? 0,
      pendingApproval: (statusMap.PENDING_REVIEW ?? 0) + (statusMap.PENDING_VERIFICATION ?? 0),
      approved: statusMap.APPROVED ?? 0,
      rejected: statusMap.REJECTED ?? 0,
      archived: statusMap.ARCHIVED ?? 0,
      expiringIn30Days: expiring30,
      expired: statusMap.EXPIRED ?? 0,
      missingDocuments: Math.max(0, totals.required - totals.present),
      compliance: {
        employees: totals.employees,
        required: totals.required,
        present: totals.present,
        missing: Math.max(0, totals.required - totals.present),
        expired: totals.expired,
        pct: totals.required > 0 ? Math.round((totals.present / totals.required) * 100) : 100,
      },
      storage: {
        ...storage,
        totalReadable: formatBytes(storage.totalBytes),
      },
      byCategory: storage.byCategory,
      uploadTrend: trend,
      recentUploads: recent,
      expiringSoon: expiringList,
    };
  }

  // =========================================================================
  // Reports
  // =========================================================================
  async runReport(
    name: string,
    query: Record<string, string | undefined>,
  ): Promise<ReportResult> {
    switch (name) {
      case 'missing-documents':
        return this.missingDocumentsReport({
          department: query.department,
          branch: query.branch,
          limit: query.limit ? Number(query.limit) : undefined,
          offset: query.offset ? Number(query.offset) : undefined,
        });
      case 'expiring':
        return this.expiringReport(query.days ? Number(query.days) : 30);
      case 'verification-status':
        return this.verificationStatusReport();
      case 'upload-history':
        return this.uploadHistoryReport(query.from, query.to);
      case 'download-history':
        return this.downloadHistoryReport(query.from, query.to);
      case 'audit-history':
        return this.auditHistoryReport({
          documentId: query.documentId ? Number(query.documentId) : undefined,
          employeeId: query.employeeId ? Number(query.employeeId) : undefined,
          action: query.action,
          from: query.from,
          to: query.to,
          limit: query.limit ? Number(query.limit) : 1000,
          offset: query.offset ? Number(query.offset) : 0,
        });
      case 'storage-usage':
        return this.storageUsageReport();
      case 'completeness':
        return this.completenessReport();
      default:
        throw new Error(`Unknown report "${name}". Available reports: ${REPORT_NAMES.join(', ')}`);
    }
  }

  async missingDocumentsReport(filters: {
    department?: string;
    branch?: string;
    limit?: number;
    offset?: number;
  }): Promise<ReportResult> {
    const rows = await this.repo.missingDocumentRows(filters);
    const today = todayString();

    const mapped = rows.map((r) => {
      const joinedAt = r.joined_at ? toDateString(r.joined_at) : null;
      const dueDate =
        joinedAt && r.due_days_after_joining !== null && r.due_days_after_joining !== undefined
          ? addDays(joinedAt, Number(r.due_days_after_joining))
          : null;
      return {
        empCode: r.emp_code,
        employeeName: r.full_name,
        department: r.department,
        branch: r.branch,
        typeCode: r.type_code,
        typeName: r.type_name,
        category: r.category,
        joinedAt,
        dueDate,
        overdue: dueDate !== null && dueDate < today ? 'YES' : 'NO',
      };
    });

    return this.result('missing-documents', mapped, [
      'empCode',
      'employeeName',
      'department',
      'branch',
      'typeCode',
      'typeName',
      'category',
      'joinedAt',
      'dueDate',
      'overdue',
    ]);
  }

  async expiringReport(days: number): Promise<ReportResult> {
    const window = safeInt(days, 30, 0, 3650);
    const docs = await this.repo.expiringSoon(window, 500);
    const mapped = docs.map((d) => ({
      documentId: d.id,
      empCode: d.empCode,
      employeeName: d.employeeName,
      department: d.department,
      typeName: d.typeName ?? d.legacyDocType,
      category: d.category,
      title: d.title,
      status: d.status,
      expiresOn: d.expiresOn,
      daysToExpiry: d.daysToExpiry,
    }));

    return this.result('expiring', mapped, [
      'documentId',
      'empCode',
      'employeeName',
      'department',
      'typeName',
      'category',
      'title',
      'status',
      'expiresOn',
      'daysToExpiry',
    ]);
  }

  async verificationStatusReport(): Promise<ReportResult> {
    const rows = await this.repo.verificationBreakdown();
    const mapped = rows.map((r) => ({
      category: r.category,
      typeName: r.type_name,
      status: r.status,
      count: Number(r.cnt ?? 0),
    }));
    return this.result('verification-status', mapped, ['category', 'typeName', 'status', 'count']);
  }

  async uploadHistoryReport(from?: string, to?: string): Promise<ReportResult> {
    const result = await this.repo.search({
      uploadedFrom: from,
      uploadedTo: to,
      includeArchived: true,
      currentVersionsOnly: false,
      limit: 2000,
      sort: 'createdAt',
      order: 'desc',
    });

    const mapped = result.rows.map((d) => ({
      documentId: d.id,
      uploadedAt: d.uploadedAt,
      empCode: d.empCode,
      employeeName: d.employeeName,
      department: d.department,
      typeName: d.typeName ?? d.legacyDocType,
      title: d.title,
      version: d.version,
      status: d.status,
      sizeBytes: d.sizeBytes,
      uploadedBy: d.uploadedByName,
      uploadIp: d.uploadIp,
    }));

    return this.result('upload-history', mapped, [
      'documentId',
      'uploadedAt',
      'empCode',
      'employeeName',
      'department',
      'typeName',
      'title',
      'version',
      'status',
      'sizeBytes',
      'uploadedBy',
      'uploadIp',
    ], result.total);
  }

  async downloadHistoryReport(from?: string, to?: string): Promise<ReportResult> {
    const result = await this.repo.listAudit({ from, to, limit: 1000 });
    const mapped = result.rows
      .filter((r) => r.action === 'DOWNLOAD' || r.action === 'PRINT' || r.action === 'SHARE_ACCESS')
      .map((r) => ({
        auditId: r.id,
        at: r.createdAt,
        documentId: r.documentId,
        documentTitle: r.documentTitle,
        employeeId: r.employeeId,
        action: r.action,
        actor: r.actorName,
        role: r.actorRole,
        ip: r.ipAddress,
        device: r.device,
        browser: r.browser,
      }));

    return this.result('download-history', mapped, [
      'auditId',
      'at',
      'documentId',
      'documentTitle',
      'employeeId',
      'action',
      'actor',
      'role',
      'ip',
      'device',
      'browser',
    ]);
  }

  async auditHistoryReport(filters: AuditFilters): Promise<ReportResult> {
    const result = await this.repo.listAudit(filters);
    const mapped = result.rows.map((r) => ({
      auditId: r.id,
      at: r.createdAt,
      documentId: r.documentId,
      documentTitle: r.documentTitle,
      employeeId: r.employeeId,
      action: r.action,
      detail: r.detail,
      previousValue: r.previousValue,
      newValue: r.newValue,
      actor: r.actorName,
      role: r.actorRole,
      ip: r.ipAddress,
      device: r.device,
      browser: r.browser,
    }));

    return this.result(
      'audit-history',
      mapped,
      [
        'auditId',
        'at',
        'documentId',
        'documentTitle',
        'employeeId',
        'action',
        'detail',
        'previousValue',
        'newValue',
        'actor',
        'role',
        'ip',
        'device',
        'browser',
      ],
      result.total,
    );
  }

  async storageUsageReport(): Promise<ReportResult> {
    const usage = await this.repo.storageUsage();
    const mapped = usage.byCategory.map((c) => ({
      category: c.category,
      documents: c.count,
      bytes: c.bytes,
      readable: formatBytes(c.bytes),
      pctOfTotal: usage.totalBytes > 0 ? Math.round((c.bytes / usage.totalBytes) * 100) : 0,
    }));
    mapped.push({
      category: 'TOTAL',
      documents: usage.totalDocuments,
      bytes: usage.totalBytes,
      readable: formatBytes(usage.totalBytes),
      pctOfTotal: 100,
    });

    return this.result('storage-usage', mapped, ['category', 'documents', 'bytes', 'readable', 'pctOfTotal']);
  }

  async completenessReport(): Promise<ReportResult> {
    const rows = await this.repo.departmentCompleteness();
    const mapped = rows.map((r) => {
      const required = Number(r.required ?? 0);
      const present = Number(r.present ?? 0);
      return {
        department: r.department,
        employees: Number(r.employees ?? 0),
        required,
        present,
        missing: Math.max(0, required - present),
        pct: required > 0 ? Math.round((present / required) * 100) : 100,
      };
    });
    return this.result('completeness', mapped, [
      'department',
      'employees',
      'required',
      'present',
      'missing',
      'pct',
    ]);
  }

  private result(
    report: string,
    rows: Record<string, unknown>[],
    headers: string[],
    total?: number,
  ): ReportResult {
    return {
      report,
      generatedAt: new Date().toISOString(),
      headers,
      rows,
      total: total ?? rows.length,
    };
  }

  /** Render a report as CSV using the shared csv helper. */
  toCsv(rows: Record<string, unknown>[], headers: string[]): string {
    return generateCsv(
      headers,
      rows.map((row) => headers.map((h) => row[h] ?? '')),
    );
  }

  // =========================================================================
  // Bulk actions
  //
  // Every one of these is per-id with its own try/catch. A bulk verify of 500
  // documents where one is locked must verify the other 499, not roll back.
  // =========================================================================
  async bulkVerify(ids: number[], actor: DocumentActor, req?: RequestLike): Promise<BulkResult> {
    return this.bulk(ids, (id) => this.documents.verify(id, actor, req));
  }

  async bulkApprove(ids: number[], actor: DocumentActor, req?: RequestLike): Promise<BulkResult> {
    return this.bulk(ids, (id) => this.documents.approve(id, actor, req));
  }

  async bulkArchive(ids: number[], actor: DocumentActor, req?: RequestLike): Promise<BulkResult> {
    return this.bulk(ids, (id) => this.documents.archive(id, actor, req));
  }

  async bulkDelete(ids: number[], actor: DocumentActor, req?: RequestLike): Promise<BulkResult> {
    return this.bulk(ids, (id) => this.documents.remove(id, actor, req));
  }

  async bulkRestore(ids: number[], actor: DocumentActor, req?: RequestLike): Promise<BulkResult> {
    return this.bulk(ids, (id) => this.documents.restore(id, actor, req));
  }

  async runBulk(
    action: string,
    ids: number[],
    actor: DocumentActor,
    req?: RequestLike,
  ): Promise<BulkResult> {
    switch (action) {
      case 'verify':
        return this.bulkVerify(ids, actor, req);
      case 'approve':
        return this.bulkApprove(ids, actor, req);
      case 'archive':
        return this.bulkArchive(ids, actor, req);
      case 'delete':
        return this.bulkDelete(ids, actor, req);
      case 'restore':
        return this.bulkRestore(ids, actor, req);
      default:
        throw new Error(`Unknown bulk action "${action}". Use verify, approve, archive, delete or restore`);
    }
  }

  private async bulk(ids: number[], run: (id: number) => Promise<unknown>): Promise<BulkResult> {
    if (!Array.isArray(ids) || ids.length === 0) throw new Error('At least one document id is required');
    if (ids.length > 500) throw new Error('A bulk action can cover at most 500 documents at a time');

    const result: BulkResult = { succeeded: [], failed: [] };
    for (const raw of ids) {
      const id = Number(raw);
      if (!Number.isFinite(id) || id <= 0) {
        result.failed.push({ id: Number.isFinite(id) ? id : 0, reason: 'Not a valid document id' });
        continue;
      }
      try {
        await run(id);
        result.succeeded.push(id);
      } catch (err: any) {
        result.failed.push({ id, reason: err?.message ?? 'Unknown error' });
      }
    }
    return result;
  }
}
