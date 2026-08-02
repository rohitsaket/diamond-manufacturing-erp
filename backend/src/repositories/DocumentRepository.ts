import { BaseRepository } from './BaseRepository';
import { toDateString } from '../utils/dateUtils';
import { countryIso2SqlExpr, normalizeCountry, safeInt } from '../utils/documentUtils';

/**
 * Every read and write for the document management module.
 *
 * Backward compatibility rule: `employee_documents` is shared with the legacy
 * `EmployeeDocumentService`. Every column this repository writes is either one
 * the legacy code already wrote (`doc_type`, `category`, `verified`, ...) or one
 * added by migration 043 with a default, so a row written here is a perfectly
 * valid row for `/api/employees/:id/documents` and vice versa.
 *
 * Performance rule: this table is expected to reach millions of rows. Every
 * filter in `search()` lands on an indexed column
 * (`idx_docs_current`, `idx_docs_status`, `idx_docs_type_id`, `idx_docs_hash`,
 * `idx_docs_expiry`, `idx_docs_root`, `idx_documents_employee`), and LIMIT /
 * OFFSET are inlined as sanitised integers because they cannot be bound.
 */

// ---------------------------------------------------------------------------
// Enumerations (mirrors of the DB enums; the DB is the authority)
// ---------------------------------------------------------------------------
export type DocumentStatus =
  | 'DRAFT'
  | 'UPLOADED'
  | 'PENDING_REVIEW'
  | 'PENDING_VERIFICATION'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'RENEWED'
  | 'ARCHIVED'
  | 'DELETED';

export const DOCUMENT_STATUSES: DocumentStatus[] = [
  'DRAFT',
  'UPLOADED',
  'PENDING_REVIEW',
  'PENDING_VERIFICATION',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'RENEWED',
  'ARCHIVED',
  'DELETED',
];

export type DocumentTypeCategory =
  | 'GOVERNMENT_ID'
  | 'PERSONAL'
  | 'EDUCATION'
  | 'CERTIFICATION'
  | 'EMPLOYMENT'
  | 'EXPERIENCE'
  | 'PAYROLL_FINANCE'
  | 'MEDICAL'
  | 'IMMIGRATION'
  | 'COMPLIANCE'
  | 'SIGNATURE'
  | 'HR_FORM'
  | 'ASSET'
  | 'LEGAL'
  | 'EMPLOYEE_GENERATED'
  | 'OTHER';

export const DOCUMENT_TYPE_CATEGORIES: DocumentTypeCategory[] = [
  'GOVERNMENT_ID',
  'PERSONAL',
  'EDUCATION',
  'CERTIFICATION',
  'EMPLOYMENT',
  'EXPERIENCE',
  'PAYROLL_FINANCE',
  'MEDICAL',
  'IMMIGRATION',
  'COMPLIANCE',
  'SIGNATURE',
  'HR_FORM',
  'ASSET',
  'LEGAL',
  'EMPLOYEE_GENERATED',
  'OTHER',
];

/** The frozen legacy enum on `employee_documents.doc_type`. */
export type LegacyDocType =
  | 'AADHAAR'
  | 'PAN'
  | 'BANK_PASSBOOK'
  | 'PHOTO'
  | 'AGREEMENT'
  | 'CERTIFICATE'
  | 'OTHER'
  | 'PASSPORT'
  | 'VISA'
  | 'DRIVING_LICENSE'
  | 'VOTER_ID'
  | 'ADDRESS_PROOF'
  | 'EDUCATION'
  | 'EXPERIENCE'
  | 'MEDICAL'
  | 'EMPLOYMENT'
  | 'FAMILY';

export const LEGACY_DOC_TYPES: LegacyDocType[] = [
  'AADHAAR',
  'PAN',
  'BANK_PASSBOOK',
  'PHOTO',
  'AGREEMENT',
  'CERTIFICATE',
  'OTHER',
  'PASSPORT',
  'VISA',
  'DRIVING_LICENSE',
  'VOTER_ID',
  'ADDRESS_PROOF',
  'EDUCATION',
  'EXPERIENCE',
  'MEDICAL',
  'EMPLOYMENT',
  'FAMILY',
];

/** The frozen legacy enum on `employee_documents.category`. */
export type LegacyCategory =
  | 'IDENTITY'
  | 'ADDRESS'
  | 'EDUCATION'
  | 'EXPERIENCE'
  | 'BANK'
  | 'MEDICAL'
  | 'EMPLOYMENT'
  | 'FAMILY'
  | 'OTHER';

export const LEGACY_CATEGORIES: LegacyCategory[] = [
  'IDENTITY',
  'ADDRESS',
  'EDUCATION',
  'EXPERIENCE',
  'BANK',
  'MEDICAL',
  'EMPLOYMENT',
  'FAMILY',
  'OTHER',
];

export type DocumentAuditAction =
  | 'UPLOAD'
  | 'REPLACE'
  | 'VIEW'
  | 'DOWNLOAD'
  | 'PRINT'
  | 'EDIT'
  | 'DELETE'
  | 'RESTORE'
  | 'SHARE'
  | 'SHARE_ACCESS'
  | 'VERIFY'
  | 'UNVERIFY'
  | 'REVIEW'
  | 'APPROVE'
  | 'REJECT'
  | 'ARCHIVE'
  | 'LOCK'
  | 'UNLOCK'
  | 'SIGN'
  | 'VERSION_RESTORE'
  | 'OCR'
  | 'SCAN'
  | 'EXPIRE';

export type OcrStatus = 'NOT_RUN' | 'PENDING' | 'DONE' | 'FAILED' | 'UNSUPPORTED';
export type VirusScanStatus = 'NOT_RUN' | 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED';

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------
export interface DocumentTypeResponse {
  id: number;
  code: string;
  name: string;
  category: DocumentTypeCategory;
  description: string | null;
  country: string | null;
  legacyDocType: LegacyDocType | null;
  isMandatory: boolean;
  requiresExpiry: boolean;
  requiresVerification: boolean;
  requiresApproval: boolean;
  allowsMultiple: boolean;
  retentionMonths: number | null;
  renewalReminderDays: number;
  maxFileMb: number;
  isConfidential: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface DocumentRequirementResponse {
  id: number;
  documentTypeId: number;
  typeCode: string | null;
  typeName: string | null;
  category: DocumentTypeCategory | null;
  country: string | null;
  employmentType: string | null;
  workerType: string | null;
  grade: string | null;
  department: string | null;
  isMandatory: boolean;
  dueDaysAfterJoining: number | null;
  notes: string | null;
}

export interface DocumentResponse {
  id: number;
  employeeId: number;
  employeeName: string | null;
  empCode: string | null;
  department: string | null;
  branch: string | null;
  documentTypeId: number | null;
  typeCode: string | null;
  typeName: string | null;
  category: DocumentTypeCategory | null;
  legacyDocType: LegacyDocType;
  legacyCategory: LegacyCategory;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  version: number;
  isCurrentVersion: boolean;
  rootDocumentId: number | null;
  replacedById: number | null;
  fileHash: string | null;
  integrityCheckedAt: string | null;
  integrityOk: boolean | null;
  storageDriver: string;
  storageKey: string | null;
  isEncrypted: boolean;
  ocrStatus: OcrStatus;
  hasOcrText: boolean;
  virusScanStatus: VirusScanStatus;
  virusScanDetail: string | null;
  thumbnailKey: string | null;
  docNumber: string | null;
  issuingAuthority: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  daysToExpiry: number | null;
  isExpired: boolean;
  tags: string[];
  notes: string | null;
  isConfidential: boolean;
  verified: boolean;
  verifiedBy: number | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  isLocked: boolean;
  lockedByName: string | null;
  lockedAt: string | null;
  archivedAt: string | null;
  retentionUntil: string | null;
  uploadedBy: number | null;
  uploadedByName: string | null;
  uploadIp: string | null;
  uploadedAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DocumentAuditResponse {
  id: number;
  documentId: number | null;
  employeeId: number | null;
  documentTitle: string | null;
  actorUserId: number | null;
  actorName: string | null;
  actorRole: string | null;
  action: DocumentAuditAction;
  detail: string | null;
  previousValue: string | null;
  newValue: string | null;
  ipAddress: string | null;
  device: string | null;
  browser: string | null;
  createdAt: string;
}

export interface DocumentShareResponse {
  id: number;
  documentId: number;
  createdBy: number | null;
  createdByName: string | null;
  recipientNote: string | null;
  expiresAt: string;
  maxDownloads: number | null;
  downloadCount: number;
  allowDownload: boolean;
  watermark: boolean;
  allowedIp: string | null;
  revokedAt: string | null;
  lastAccessedAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface DocumentCommentResponse {
  id: number;
  documentId: number;
  userId: number | null;
  authorName: string | null;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------
export interface DocumentTypeInput {
  code?: string;
  name?: string;
  category?: DocumentTypeCategory;
  description?: string | null;
  country?: string | null;
  legacyDocType?: LegacyDocType | null;
  isMandatory?: boolean;
  requiresExpiry?: boolean;
  requiresVerification?: boolean;
  requiresApproval?: boolean;
  allowsMultiple?: boolean;
  retentionMonths?: number | null;
  renewalReminderDays?: number;
  maxFileMb?: number;
  isConfidential?: boolean;
  sortOrder?: number;
  isActive?: boolean;
}

export interface RequirementInput {
  documentTypeId: number;
  country?: string | null;
  employmentType?: string | null;
  workerType?: string | null;
  grade?: string | null;
  department?: string | null;
  isMandatory?: boolean;
  dueDaysAfterJoining?: number | null;
  notes?: string | null;
}

export interface RequirementFilters {
  documentTypeId?: number;
  country?: string;
  employmentType?: string;
  workerType?: string;
  grade?: string;
  department?: string;
  mandatoryOnly?: boolean;
}

/** The employee attributes that decide which documents are required. */
export interface EmployeeScope {
  id: number;
  country?: string | null;
  employment_type?: string | null;
  worker_type?: string | null;
  grade?: string | null;
  department?: string | null;
  joined_at?: unknown;
  full_name?: string | null;
  emp_code?: string | null;
  branch?: string | null;
}

export interface DocumentInsert {
  employeeId: number;
  docType: LegacyDocType;
  category: LegacyCategory;
  title: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  documentTypeId?: number | null;
  status?: DocumentStatus;
  version?: number;
  isCurrentVersion?: boolean;
  rootDocumentId?: number | null;
  fileHash?: string | null;
  storageDriver?: string;
  storageKey?: string | null;
  docNumber?: string | null;
  issuingAuthority?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  tags?: string | null;
  notes?: string | null;
  retentionUntil?: string | null;
  uploadedBy?: number | null;
  uploadIp?: string | null;
  verified?: boolean;
  verifiedBy?: number | null;
  verifiedAt?: Date | null;
  approvedBy?: number | null;
  approvedAt?: Date | null;
}

export interface DocumentPatch {
  documentTypeId?: number | null;
  docType?: LegacyDocType;
  category?: LegacyCategory;
  title?: string;
  fileName?: string;
  filePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  status?: DocumentStatus;
  version?: number;
  isCurrentVersion?: boolean;
  rootDocumentId?: number | null;
  replacedById?: number | null;
  fileHash?: string | null;
  integrityCheckedAt?: Date | null;
  integrityOk?: boolean | null;
  storageDriver?: string;
  storageKey?: string | null;
  isEncrypted?: boolean;
  ocrStatus?: OcrStatus;
  ocrText?: string | null;
  virusScanStatus?: VirusScanStatus;
  virusScanDetail?: string | null;
  thumbnailKey?: string | null;
  docNumber?: string | null;
  issuingAuthority?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  tags?: string | null;
  notes?: string | null;
  verified?: boolean;
  verifiedBy?: number | null;
  verifiedAt?: Date | null;
  reviewedBy?: number | null;
  reviewedAt?: Date | null;
  approvedBy?: number | null;
  approvedAt?: Date | null;
  rejectedReason?: string | null;
  isLocked?: boolean;
  lockedBy?: number | null;
  lockedAt?: Date | null;
  archivedAt?: Date | null;
  retentionUntil?: string | null;
  deletedAt?: Date | null;
  deletedBy?: number | null;
}

export interface DocumentSearchParams {
  employeeId?: number;
  employeeName?: string;
  department?: string;
  branch?: string;
  documentTypeId?: number;
  category?: string;
  status?: string[];
  tags?: string;
  fileName?: string;
  docNumber?: string;
  uploadedBy?: number;
  verifiedBy?: number;
  uploadedFrom?: string;
  uploadedTo?: string;
  expiresFrom?: string;
  expiresTo?: string;
  expiringInDays?: number;
  ocrText?: string;
  includeArchived?: boolean;
  includeDeleted?: boolean;
  currentVersionsOnly?: boolean;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

export interface AuditFilters {
  documentId?: number;
  employeeId?: number;
  action?: string;
  actorUserId?: number;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ShareInput {
  documentId: number;
  tokenHash: string;
  createdBy: number | null;
  recipientNote?: string | null;
  expiresAt: Date;
  maxDownloads?: number | null;
  allowDownload?: boolean;
  watermark?: boolean;
  allowedIp?: string | null;
}

export interface AuditEntry {
  documentId?: number | null;
  employeeId?: number | null;
  actorUserId?: number | null;
  actorName?: string | null;
  actorRole?: string | null;
  action: DocumentAuditAction;
  detail?: string | null;
  previousValue?: string | null;
  newValue?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  device?: string | null;
  browser?: string | null;
}

// ---------------------------------------------------------------------------
// Column maps for dynamic SQL
// ---------------------------------------------------------------------------
const TYPE_COLUMNS: Record<keyof DocumentTypeInput, string> = {
  code: 'code',
  name: 'name',
  category: 'category',
  description: 'description',
  country: 'country',
  legacyDocType: 'legacy_doc_type',
  isMandatory: 'is_mandatory',
  requiresExpiry: 'requires_expiry',
  requiresVerification: 'requires_verification',
  requiresApproval: 'requires_approval',
  allowsMultiple: 'allows_multiple',
  retentionMonths: 'retention_months',
  renewalReminderDays: 'renewal_reminder_days',
  maxFileMb: 'max_file_mb',
  isConfidential: 'is_confidential',
  sortOrder: 'sort_order',
  isActive: 'is_active',
};

const DOCUMENT_COLUMNS: Record<string, string> = {
  employeeId: 'employee_id',
  documentTypeId: 'document_type_id',
  docType: 'doc_type',
  category: 'category',
  title: 'title',
  fileName: 'file_name',
  filePath: 'file_path',
  mimeType: 'mime_type',
  sizeBytes: 'size_bytes',
  status: 'status',
  version: 'version',
  isCurrentVersion: 'is_current_version',
  rootDocumentId: 'root_document_id',
  replacedById: 'replaced_by_id',
  fileHash: 'file_hash',
  integrityCheckedAt: 'integrity_checked_at',
  integrityOk: 'integrity_ok',
  storageDriver: 'storage_driver',
  storageKey: 'storage_key',
  isEncrypted: 'is_encrypted',
  ocrStatus: 'ocr_status',
  ocrText: 'ocr_text',
  virusScanStatus: 'virus_scan_status',
  virusScanDetail: 'virus_scan_detail',
  thumbnailKey: 'thumbnail_key',
  docNumber: 'doc_number',
  issuingAuthority: 'issuing_authority',
  issuedOn: 'issued_on',
  expiresOn: 'expires_on',
  tags: 'tags',
  notes: 'notes',
  verified: 'verified',
  verifiedBy: 'verified_by',
  verifiedAt: 'verified_at',
  reviewedBy: 'reviewed_by',
  reviewedAt: 'reviewed_at',
  approvedBy: 'approved_by',
  approvedAt: 'approved_at',
  rejectedReason: 'rejected_reason',
  isLocked: 'is_locked',
  lockedBy: 'locked_by',
  lockedAt: 'locked_at',
  archivedAt: 'archived_at',
  retentionUntil: 'retention_until',
  deletedAt: 'deleted_at',
  deletedBy: 'deleted_by',
  uploadedBy: 'uploaded_by',
  uploadIp: 'upload_ip',
};

/** Sort keys a caller may ask for, mapped to their (indexed where possible) column. */
const SORT_COLUMNS: Record<string, string> = {
  createdAt: 'd.created_at',
  updatedAt: 'd.updated_at',
  uploadedAt: 'd.created_at',
  expiresOn: 'd.expires_on',
  title: 'd.title',
  status: 'd.status',
  version: 'd.version',
  sizeBytes: 'd.size_bytes',
  employeeName: 'e.full_name',
  empCode: 'e.emp_code',
  department: 'e.department',
  category: 'dt.category',
  typeName: 'dt.name',
};

/** Statuses that count as "the employee has produced this document". */
export const LIVE_STATUSES: DocumentStatus[] = ['UPLOADED', 'PENDING_REVIEW', 'PENDING_VERIFICATION', 'APPROVED'];

const DOCUMENT_SELECT = `
  d.*,
  e.full_name  AS employee_name,
  e.emp_code   AS emp_code,
  e.department AS employee_department,
  e.branch     AS employee_branch,
  dt.code      AS type_code,
  dt.name      AS type_name,
  dt.category  AS type_category,
  dt.is_confidential AS type_confidential,
  uu.name      AS uploaded_by_name,
  vu.name      AS verified_by_name,
  ru.name      AS reviewed_by_name,
  au.name      AS approved_by_name,
  lu.name      AS locked_by_name
`;

const DOCUMENT_JOINS = `
  FROM employee_documents d
  JOIN employees e        ON e.id  = d.employee_id
  LEFT JOIN document_types dt ON dt.id = d.document_type_id
  LEFT JOIN users uu      ON uu.id = d.uploaded_by
  LEFT JOIN users vu      ON vu.id = d.verified_by
  LEFT JOIN users ru      ON ru.id = d.reviewed_by
  LEFT JOIN users au      ON au.id = d.approved_by
  LEFT JOIN users lu      ON lu.id = d.locked_by
`;

export class DocumentRepository extends BaseRepository {
  /** Escape hatch so services can wrap multi-row writes in one transaction. */
  async withTransaction<T>(fn: (connection: any) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  private async run<T = any>(sql: string, params: any[], conn?: any): Promise<T> {
    if (conn) {
      const [rows] = await conn.query(sql, params);
      return rows as T;
    }
    return this.query<T>(sql, params);
  }

  // =========================================================================
  // Document types
  // =========================================================================
  async listTypes(
    filters: { category?: string; country?: string; activeOnly?: boolean; search?: string } = {},
  ): Promise<DocumentTypeResponse[]> {
    let sql = 'SELECT * FROM document_types WHERE deleted_at IS NULL';
    const params: any[] = [];

    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters.country) {
      // A type with no country is global, so it always applies.
      sql += ' AND (country IS NULL OR country = ?)';
      params.push(normalizeCountry(filters.country) ?? filters.country);
    }
    if (filters.activeOnly) sql += ' AND is_active = 1';
    if (filters.search) {
      sql += ' AND (code LIKE ? OR name LIKE ?)';
      const like = `%${filters.search}%`;
      params.push(like, like);
    }
    sql += ' ORDER BY category ASC, sort_order ASC, name ASC';

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toType(r));
  }

  async findTypeRowById(id: number, conn?: any): Promise<any | null> {
    const rows = await this.run<any[]>(
      'SELECT * FROM document_types WHERE id = ? AND deleted_at IS NULL',
      [id],
      conn,
    );
    return rows[0] || null;
  }

  async findTypeById(id: number): Promise<DocumentTypeResponse | null> {
    const row = await this.findTypeRowById(id);
    return row ? this.toType(row) : null;
  }

  async findTypeRowByCode(code: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM document_types WHERE code = ? AND deleted_at IS NULL',
      [String(code).trim().toUpperCase()],
    );
    return rows[0] || null;
  }

  async findTypeByCode(code: string): Promise<DocumentTypeResponse | null> {
    const row = await this.findTypeRowByCode(code);
    return row ? this.toType(row) : null;
  }

  async createType(data: DocumentTypeInput, userId: number): Promise<number> {
    const columns: string[] = [];
    const placeholders: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(TYPE_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      columns.push(column);
      placeholders.push('?');
      params.push(value);
    }
    columns.push('created_by', 'updated_by');
    placeholders.push('?', '?');
    params.push(userId, userId);

    const result = await this.query<any>(
      `INSERT INTO document_types (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
      params,
    );
    return result.insertId;
  }

  async updateType(id: number, data: DocumentTypeInput, userId: number): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(TYPE_COLUMNS)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;

    sets.push('updated_by = ?');
    params.push(userId, id);
    await this.query(
      `UPDATE document_types SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
  }

  /** Soft delete. The service refuses when live documents still reference it. */
  async deactivateType(id: number, userId: number): Promise<void> {
    await this.query(
      'UPDATE document_types SET is_active = 0, deleted_at = NOW(), updated_by = ? WHERE id = ? AND deleted_at IS NULL',
      [userId, id],
    );
  }

  async countDocumentsForType(typeId: number): Promise<number> {
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM employee_documents
       WHERE document_type_id = ? AND deleted_at IS NULL AND status <> 'ARCHIVED'`,
      [typeId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  // =========================================================================
  // Requirements
  // =========================================================================
  async listRequirements(filters: RequirementFilters = {}): Promise<DocumentRequirementResponse[]> {
    let sql = `
      SELECT r.*, dt.code AS type_code, dt.name AS type_name, dt.category AS type_category
      FROM document_requirements r
      JOIN document_types dt ON dt.id = r.document_type_id
      WHERE r.deleted_at IS NULL AND dt.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (filters.documentTypeId) {
      sql += ' AND r.document_type_id = ?';
      params.push(filters.documentTypeId);
    }
    if (filters.country) {
      sql += ' AND r.country = ?';
      params.push(normalizeCountry(filters.country) ?? filters.country);
    }
    if (filters.employmentType) {
      sql += ' AND r.employment_type = ?';
      params.push(filters.employmentType);
    }
    if (filters.workerType) {
      sql += ' AND r.worker_type = ?';
      params.push(filters.workerType);
    }
    if (filters.grade) {
      sql += ' AND r.grade = ?';
      params.push(filters.grade);
    }
    if (filters.department) {
      sql += ' AND r.department = ?';
      params.push(filters.department);
    }
    if (filters.mandatoryOnly) sql += ' AND r.is_mandatory = 1';

    sql += ' ORDER BY dt.category ASC, dt.sort_order ASC, dt.name ASC';

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => this.toRequirement(r));
  }

  async findRequirementById(id: number): Promise<DocumentRequirementResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT r.*, dt.code AS type_code, dt.name AS type_name, dt.category AS type_category
       FROM document_requirements r
       JOIN document_types dt ON dt.id = r.document_type_id
       WHERE r.id = ? AND r.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? this.toRequirement(rows[0]) : null;
  }

  async createRequirement(data: RequirementInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO document_requirements
         (document_type_id, country, employment_type, worker_type, grade, department,
          is_mandatory, due_days_after_joining, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.documentTypeId,
        data.country ?? null,
        data.employmentType ?? null,
        data.workerType ?? null,
        data.grade ?? null,
        data.department ?? null,
        data.isMandatory === undefined ? true : data.isMandatory,
        data.dueDaysAfterJoining ?? null,
        data.notes ?? null,
        userId,
      ],
    );
    return result.insertId;
  }

  async deleteRequirement(id: number): Promise<void> {
    await this.query(
      'UPDATE document_requirements SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
  }

  /**
   * Requirements that apply to one employee. A NULL scope column is a wildcard,
   * so a requirement matches when each of its scope columns is either NULL or
   * equal to the employee's value.
   */
  async findApplicableRequirements(employee: EmployeeScope): Promise<DocumentRequirementResponse[]> {
    const country = normalizeCountry(employee.country ?? null);
    const rows = await this.query<any[]>(
      `SELECT r.*, dt.code AS type_code, dt.name AS type_name, dt.category AS type_category
       FROM document_requirements r
       JOIN document_types dt ON dt.id = r.document_type_id
       WHERE r.deleted_at IS NULL
         AND dt.deleted_at IS NULL
         AND dt.is_active = 1
         AND (r.country         IS NULL OR r.country         = ?)
         AND (r.employment_type IS NULL OR r.employment_type = ?)
         AND (r.worker_type     IS NULL OR r.worker_type     = ?)
         AND (r.grade           IS NULL OR r.grade           = ?)
         AND (r.department      IS NULL OR r.department      = ?)
       ORDER BY dt.category ASC, dt.sort_order ASC, dt.name ASC`,
      [
        country,
        employee.employment_type ?? null,
        employee.worker_type ?? null,
        employee.grade ?? null,
        employee.department ?? null,
      ],
    );
    return rows.map((r) => this.toRequirement(r));
  }

  // =========================================================================
  // Documents — search and reads
  // =========================================================================
  /**
   * Builds the shared WHERE clause for `search` and its COUNT twin so the two
   * can never drift apart.
   */
  private buildSearchWhere(params: DocumentSearchParams): { sql: string; values: any[] } {
    let sql = ' WHERE 1 = 1';
    const values: any[] = [];

    if (!params.includeDeleted) sql += ' AND d.deleted_at IS NULL';
    if (params.currentVersionsOnly !== false) sql += ' AND d.is_current_version = 1';
    if (!params.includeArchived) sql += " AND d.status <> 'ARCHIVED'";

    if (params.employeeId) {
      sql += ' AND d.employee_id = ?';
      values.push(params.employeeId);
    }
    if (params.employeeName) {
      sql += ' AND (e.full_name LIKE ? OR e.emp_code LIKE ?)';
      const like = `%${params.employeeName}%`;
      values.push(like, like);
    }
    if (params.department) {
      sql += ' AND e.department = ?';
      values.push(params.department);
    }
    if (params.branch) {
      sql += ' AND e.branch = ?';
      values.push(params.branch);
    }
    if (params.documentTypeId) {
      sql += ' AND d.document_type_id = ?';
      values.push(params.documentTypeId);
    }
    if (params.category) {
      // `category` means the document-type category. Untyped legacy rows are
      // treated as OTHER so they remain reachable.
      if (params.category === 'OTHER') {
        sql += " AND (dt.category = 'OTHER' OR d.document_type_id IS NULL)";
      } else {
        sql += ' AND dt.category = ?';
        values.push(params.category);
      }
    }
    if (params.status && params.status.length > 0) {
      sql += ` AND d.status IN (${params.status.map(() => '?').join(', ')})`;
      values.push(...params.status);
    }
    if (params.tags) {
      sql += ' AND d.tags LIKE ?';
      values.push(`%${params.tags}%`);
    }
    if (params.fileName) {
      sql += ' AND (d.file_name LIKE ? OR d.title LIKE ?)';
      const like = `%${params.fileName}%`;
      values.push(like, like);
    }
    if (params.docNumber) {
      // Prefix match keeps the lookup index-friendly.
      sql += ' AND d.doc_number LIKE ?';
      values.push(`${params.docNumber}%`);
    }
    if (params.uploadedBy) {
      sql += ' AND d.uploaded_by = ?';
      values.push(params.uploadedBy);
    }
    if (params.verifiedBy) {
      sql += ' AND d.verified_by = ?';
      values.push(params.verifiedBy);
    }
    if (params.uploadedFrom) {
      sql += ' AND d.created_at >= ?';
      values.push(`${params.uploadedFrom} 00:00:00`);
    }
    if (params.uploadedTo) {
      sql += ' AND d.created_at <= ?';
      values.push(`${params.uploadedTo} 23:59:59`);
    }
    if (params.expiresFrom) {
      sql += ' AND d.expires_on >= ?';
      values.push(params.expiresFrom);
    }
    if (params.expiresTo) {
      sql += ' AND d.expires_on <= ?';
      values.push(params.expiresTo);
    }
    if (params.expiringInDays !== undefined) {
      const days = safeInt(params.expiringInDays, 30, 0, 3650);
      sql += ` AND d.expires_on IS NOT NULL AND d.expires_on BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ${days} DAY)`;
    }
    if (params.ocrText) {
      sql += ' AND d.ocr_text LIKE ?';
      values.push(`%${params.ocrText}%`);
    }

    return { sql, values };
  }

  async search(params: DocumentSearchParams = {}): Promise<{ rows: DocumentResponse[]; total: number }> {
    const { sql: where, values } = this.buildSearchWhere(params);

    const sortColumn = SORT_COLUMNS[params.sort ?? 'createdAt'] ?? SORT_COLUMNS.createdAt;
    const order = String(params.order ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const limit = safeInt(params.limit, 50, 1, 2000);
    const offset = safeInt(params.offset, 0, 0, 1_000_000);

    const rows = await this.query<any[]>(
      `SELECT ${DOCUMENT_SELECT} ${DOCUMENT_JOINS} ${where}
       ORDER BY ${sortColumn} ${order}, d.id ${order}
       LIMIT ${limit} OFFSET ${offset}`,
      values,
    );

    const countRows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt
       FROM employee_documents d
       JOIN employees e ON e.id = d.employee_id
       LEFT JOIN document_types dt ON dt.id = d.document_type_id
       ${where}`,
      values,
    );

    return { rows: rows.map((r) => this.toDocument(r)), total: Number(countRows[0]?.cnt ?? 0) };
  }

  async findRowById(id: number, options: { includeDeleted?: boolean } = {}, conn?: any): Promise<any | null> {
    const sql = `SELECT d.*, dt.code AS type_code, dt.name AS type_name, dt.category AS type_category,
                        dt.requires_expiry, dt.requires_verification, dt.requires_approval,
                        dt.allows_multiple, dt.retention_months, dt.renewal_reminder_days,
                        dt.max_file_mb, dt.is_confidential AS type_confidential
                 FROM employee_documents d
                 LEFT JOIN document_types dt ON dt.id = d.document_type_id
                 WHERE d.id = ?${options.includeDeleted ? '' : ' AND d.deleted_at IS NULL'}`;
    const rows = await this.run<any[]>(sql, [id], conn);
    return rows[0] || null;
  }

  async findById(id: number, options: { includeDeleted?: boolean } = {}): Promise<DocumentResponse | null> {
    const rows = await this.query<any[]>(
      `SELECT ${DOCUMENT_SELECT} ${DOCUMENT_JOINS}
       WHERE d.id = ?${options.includeDeleted ? '' : ' AND d.deleted_at IS NULL'}`,
      [id],
    );
    return rows[0] ? this.toDocument(rows[0]) : null;
  }

  /** Duplicate detection: same employee, same bytes, still live. */
  async findByHash(employeeId: number, hash: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT id, title, version, status FROM employee_documents
       WHERE employee_id = ? AND file_hash = ? AND deleted_at IS NULL AND status <> 'ARCHIVED'
       ORDER BY id DESC LIMIT 1`,
      [employeeId, hash],
    );
    return rows[0] || null;
  }

  /** The live current version of a type for an employee (for allows_multiple). */
  async findCurrentForType(employeeId: number, documentTypeId: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      `SELECT id, title, version, status FROM employee_documents
       WHERE employee_id = ? AND document_type_id = ? AND is_current_version = 1
         AND deleted_at IS NULL AND status NOT IN ('ARCHIVED', 'REJECTED', 'DELETED')
       ORDER BY id DESC LIMIT 1`,
      [employeeId, documentTypeId],
    );
    return rows[0] || null;
  }

  async findVersions(rootId: number): Promise<DocumentResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT ${DOCUMENT_SELECT} ${DOCUMENT_JOINS}
       WHERE (d.root_document_id = ? OR d.id = ?)
       ORDER BY d.version ASC, d.id ASC`,
      [rootId, rootId],
    );
    return rows.map((r) => this.toDocument(r));
  }

  async findByEmployee(
    employeeId: number,
    options: { includeArchived?: boolean; currentVersionsOnly?: boolean } = {},
  ): Promise<DocumentResponse[]> {
    const result = await this.search({
      employeeId,
      includeArchived: options.includeArchived ?? false,
      currentVersionsOnly: options.currentVersionsOnly ?? true,
      limit: 500,
      sort: 'createdAt',
      order: 'desc',
    });
    return result.rows;
  }

  // =========================================================================
  // Documents — writes
  // =========================================================================
  async insert(doc: DocumentInsert, conn?: any): Promise<number> {
    const columns: string[] = [];
    const placeholders: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(doc)) {
      const column = DOCUMENT_COLUMNS[key];
      if (!column || value === undefined) continue;
      columns.push(column);
      placeholders.push('?');
      params.push(value);
    }

    const sql = `INSERT INTO employee_documents (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
    if (conn) {
      const [result] = await conn.query(sql, params);
      return (result as any).insertId;
    }
    const result = await this.query<any>(sql, params);
    return result.insertId;
  }

  async update(id: number, patch: DocumentPatch, conn?: any): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(patch)) {
      const column = DOCUMENT_COLUMNS[key];
      if (!column || value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;
    params.push(id);

    const sql = `UPDATE employee_documents SET ${sets.join(', ')} WHERE id = ?`;
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  async softDelete(id: number, userId: number, conn?: any): Promise<void> {
    const sql = `UPDATE employee_documents
                 SET deleted_at = NOW(), deleted_by = ?, status = 'DELETED', is_current_version = 0
                 WHERE id = ? AND deleted_at IS NULL`;
    if (conn) await conn.query(sql, [userId, id]);
    else await this.query(sql, [userId, id]);
  }

  async restore(id: number, status: DocumentStatus, conn?: any): Promise<void> {
    const sql = `UPDATE employee_documents
                 SET deleted_at = NULL, deleted_by = NULL, archived_at = NULL,
                     status = ?, is_current_version = 1
                 WHERE id = ?`;
    if (conn) await conn.query(sql, [status, id]);
    else await this.query(sql, [status, id]);
  }

  /** Exactly one row in a lineage carries `is_current_version = 1`. */
  async markCurrentVersion(rootId: number, currentId: number, conn?: any): Promise<void> {
    const sql = `UPDATE employee_documents
                 SET is_current_version = (id = ?)
                 WHERE (root_document_id = ? OR id = ?) AND deleted_at IS NULL`;
    if (conn) await conn.query(sql, [currentId, rootId, rootId]);
    else await this.query(sql, [currentId, rootId, rootId]);
  }

  /** Live documents whose expiry has passed — the input to `markExpiredDocuments`. */
  async findExpirable(limit = 1000): Promise<Array<{ id: number; employee_id: number; title: string; status: DocumentStatus }>> {
    const capped = safeInt(limit, 1000, 1, 10000);
    return this.query<any[]>(
      `SELECT id, employee_id, title, status FROM employee_documents
       WHERE deleted_at IS NULL AND is_current_version = 1
         AND expires_on IS NOT NULL AND expires_on < CURDATE()
         AND status IN ('UPLOADED', 'PENDING_REVIEW', 'PENDING_VERIFICATION', 'APPROVED')
       ORDER BY expires_on ASC
       LIMIT ${capped}`,
    );
  }

  async markExpired(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.query<any>(
      `UPDATE employee_documents SET status = 'EXPIRED'
       WHERE id IN (${ids.map(() => '?').join(', ')}) AND deleted_at IS NULL`,
      ids,
    );
    return Number(result?.affectedRows ?? 0);
  }

  /**
   * Documents inside their type's renewal reminder window that have not already
   * been reminded about today. The NOT EXISTS guard against the audit log is
   * what stops a second run on the same day from spamming everyone.
   */
  async findDueForReminder(today: string, limit = 500): Promise<any[]> {
    const capped = safeInt(limit, 500, 1, 5000);
    return this.query<any[]>(
      `SELECT d.id, d.employee_id, d.title, d.expires_on,
              dt.name AS type_name, dt.renewal_reminder_days,
              e.full_name AS employee_name, e.emp_code
       FROM employee_documents d
       JOIN document_types dt ON dt.id = d.document_type_id
       JOIN employees e ON e.id = d.employee_id
       WHERE d.deleted_at IS NULL AND d.is_current_version = 1
         AND d.status IN ('UPLOADED', 'PENDING_REVIEW', 'PENDING_VERIFICATION', 'APPROVED')
         AND d.expires_on IS NOT NULL
         AND d.expires_on >= CURDATE()
         AND d.expires_on <= DATE_ADD(CURDATE(), INTERVAL dt.renewal_reminder_days DAY)
         AND e.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM document_audit_logs al
           WHERE al.document_id = d.id AND al.action = 'EXPIRE' AND al.detail LIKE ?
         )
       ORDER BY d.expires_on ASC
       LIMIT ${capped}`,
      [`reminder:${today}%`],
    );
  }

  // =========================================================================
  // Audit trail
  // =========================================================================
  async logAudit(entry: AuditEntry, conn?: any): Promise<void> {
    const sql = `INSERT INTO document_audit_logs
        (document_id, employee_id, actor_user_id, actor_name, actor_role, action,
         detail, previous_value, new_value, ip_address, user_agent, device, browser)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      entry.documentId ?? null,
      entry.employeeId ?? null,
      entry.actorUserId ?? null,
      entry.actorName ? String(entry.actorName).slice(0, 160) : null,
      entry.actorRole ? String(entry.actorRole).slice(0, 40) : null,
      entry.action,
      entry.detail ? String(entry.detail).slice(0, 500) : null,
      entry.previousValue ?? null,
      entry.newValue ?? null,
      entry.ipAddress ? String(entry.ipAddress).slice(0, 45) : null,
      entry.userAgent ? String(entry.userAgent).slice(0, 400) : null,
      entry.device ? String(entry.device).slice(0, 80) : null,
      entry.browser ? String(entry.browser).slice(0, 80) : null,
    ];
    if (conn) await conn.query(sql, params);
    else await this.query(sql, params);
  }

  async listAudit(filters: AuditFilters = {}): Promise<{ rows: DocumentAuditResponse[]; total: number }> {
    let where = ' WHERE 1 = 1';
    const values: any[] = [];

    if (filters.documentId) {
      where += ' AND al.document_id = ?';
      values.push(filters.documentId);
    }
    if (filters.employeeId) {
      where += ' AND al.employee_id = ?';
      values.push(filters.employeeId);
    }
    if (filters.action) {
      where += ' AND al.action = ?';
      values.push(filters.action);
    }
    if (filters.actorUserId) {
      where += ' AND al.actor_user_id = ?';
      values.push(filters.actorUserId);
    }
    if (filters.from) {
      where += ' AND al.created_at >= ?';
      values.push(`${filters.from} 00:00:00`);
    }
    if (filters.to) {
      where += ' AND al.created_at <= ?';
      values.push(`${filters.to} 23:59:59`);
    }

    const limit = safeInt(filters.limit, 100, 1, 1000);
    const offset = safeInt(filters.offset, 0, 0, 1_000_000);

    const rows = await this.query<any[]>(
      `SELECT al.*, d.title AS document_title
       FROM document_audit_logs al
       LEFT JOIN employee_documents d ON d.id = al.document_id
       ${where}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    const countRows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM document_audit_logs al ${where}`,
      values,
    );

    return { rows: rows.map((r) => this.toAudit(r)), total: Number(countRows[0]?.cnt ?? 0) };
  }

  // =========================================================================
  // Shares
  // =========================================================================
  async createShare(data: ShareInput): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO document_shares
         (document_id, token_hash, created_by, recipient_note, expires_at,
          max_downloads, allow_download, watermark, allowed_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.documentId,
        data.tokenHash,
        data.createdBy ?? null,
        data.recipientNote ?? null,
        data.expiresAt,
        data.maxDownloads ?? null,
        data.allowDownload === undefined ? true : data.allowDownload,
        data.watermark === undefined ? true : data.watermark,
        data.allowedIp ?? null,
      ],
    );
    return result.insertId;
  }

  async findShareByTokenHash(tokenHash: string): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM document_shares WHERE token_hash = ?',
      [tokenHash],
    );
    return rows[0] || null;
  }

  async findShareById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>('SELECT * FROM document_shares WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async incrementShareDownload(id: number): Promise<void> {
    await this.query(
      'UPDATE document_shares SET download_count = download_count + 1, last_accessed_at = NOW() WHERE id = ?',
      [id],
    );
  }

  async revokeShare(id: number): Promise<void> {
    await this.query(
      'UPDATE document_shares SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL',
      [id],
    );
  }

  async listShares(documentId: number): Promise<DocumentShareResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT s.*, u.name AS created_by_name
       FROM document_shares s
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.document_id = ?
       ORDER BY s.created_at DESC`,
      [documentId],
    );
    return rows.map((r) => this.toShare(r));
  }

  // =========================================================================
  // Comments
  // =========================================================================
  async listComments(documentId: number, includeInternal: boolean): Promise<DocumentCommentResponse[]> {
    let sql = 'SELECT * FROM document_comments WHERE document_id = ? AND deleted_at IS NULL';
    if (!includeInternal) sql += ' AND is_internal = 0';
    sql += ' ORDER BY created_at ASC, id ASC';

    const rows = await this.query<any[]>(sql, [documentId]);
    return rows.map((r) => this.toComment(r));
  }

  async findCommentById(id: number): Promise<any | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM document_comments WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] || null;
  }

  async addComment(data: {
    documentId: number;
    userId: number | null;
    authorName: string | null;
    body: string;
    isInternal: boolean;
  }): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO document_comments (document_id, user_id, author_name, body, is_internal)
       VALUES (?, ?, ?, ?, ?)`,
      [data.documentId, data.userId, data.authorName, data.body.slice(0, 1000), data.isInternal],
    );
    return result.insertId;
  }

  async softDeleteComment(id: number): Promise<void> {
    await this.query(
      'UPDATE document_comments SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
  }

  // =========================================================================
  // Aggregates (dashboard and reports)
  // =========================================================================
  async countsByStatus(filters: { employeeId?: number; department?: string; branch?: string } = {}): Promise<
    Array<{ status: DocumentStatus; count: number }>
  > {
    let sql = `SELECT d.status, COUNT(*) AS cnt
               FROM employee_documents d
               JOIN employees e ON e.id = d.employee_id
               WHERE d.deleted_at IS NULL AND d.is_current_version = 1`;
    const params: any[] = [];

    if (filters.employeeId) {
      sql += ' AND d.employee_id = ?';
      params.push(filters.employeeId);
    }
    if (filters.department) {
      sql += ' AND e.department = ?';
      params.push(filters.department);
    }
    if (filters.branch) {
      sql += ' AND e.branch = ?';
      params.push(filters.branch);
    }
    sql += ' GROUP BY d.status';

    const rows = await this.query<any[]>(sql, params);
    return rows.map((r) => ({ status: r.status as DocumentStatus, count: Number(r.cnt ?? 0) }));
  }

  async countsByCategory(): Promise<Array<{ category: string; count: number; bytes: number }>> {
    const rows = await this.query<any[]>(
      `SELECT COALESCE(dt.category, 'OTHER') AS category,
              COUNT(*) AS cnt, COALESCE(SUM(d.size_bytes), 0) AS bytes
       FROM employee_documents d
       LEFT JOIN document_types dt ON dt.id = d.document_type_id
       WHERE d.deleted_at IS NULL AND d.is_current_version = 1
       GROUP BY COALESCE(dt.category, 'OTHER')
       ORDER BY cnt DESC`,
    );
    return rows.map((r) => ({ category: r.category, count: Number(r.cnt ?? 0), bytes: Number(r.bytes ?? 0) }));
  }

  async expiringSoon(days: number, limit: number): Promise<DocumentResponse[]> {
    const window = safeInt(days, 30, 0, 3650);
    const capped = safeInt(limit, 20, 1, 500);
    const rows = await this.query<any[]>(
      `SELECT ${DOCUMENT_SELECT} ${DOCUMENT_JOINS}
       WHERE d.deleted_at IS NULL AND d.is_current_version = 1
         AND d.status NOT IN ('ARCHIVED', 'REJECTED', 'DELETED')
         AND d.expires_on IS NOT NULL
         AND d.expires_on BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ${window} DAY)
       ORDER BY d.expires_on ASC
       LIMIT ${capped}`,
    );
    return rows.map((r) => this.toDocument(r));
  }

  async countExpiringWithin(days: number): Promise<number> {
    const window = safeInt(days, 30, 0, 3650);
    const rows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM employee_documents d
       WHERE d.deleted_at IS NULL AND d.is_current_version = 1
         AND d.status NOT IN ('ARCHIVED', 'REJECTED', 'DELETED', 'EXPIRED')
         AND d.expires_on IS NOT NULL
         AND d.expires_on BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ${window} DAY)`,
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  async recentUploads(limit: number): Promise<DocumentResponse[]> {
    const capped = safeInt(limit, 10, 1, 100);
    const rows = await this.query<any[]>(
      `SELECT ${DOCUMENT_SELECT} ${DOCUMENT_JOINS}
       WHERE d.deleted_at IS NULL
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT ${capped}`,
    );
    return rows.map((r) => this.toDocument(r));
  }

  async storageUsage(): Promise<{
    totalDocuments: number;
    totalBytes: number;
    averageBytes: number;
    byCategory: Array<{ category: string; count: number; bytes: number }>;
    byDriver: Array<{ driver: string; count: number; bytes: number }>;
  }> {
    const totals = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(size_bytes), 0) AS bytes
       FROM employee_documents WHERE deleted_at IS NULL`,
    );
    const byCategory = await this.countsByCategory();
    const byDriverRows = await this.query<any[]>(
      `SELECT storage_driver AS driver, COUNT(*) AS cnt, COALESCE(SUM(size_bytes), 0) AS bytes
       FROM employee_documents WHERE deleted_at IS NULL
       GROUP BY storage_driver`,
    );

    const totalDocuments = Number(totals[0]?.cnt ?? 0);
    const totalBytes = Number(totals[0]?.bytes ?? 0);
    return {
      totalDocuments,
      totalBytes,
      averageBytes: totalDocuments > 0 ? Math.round(totalBytes / totalDocuments) : 0,
      byCategory,
      byDriver: byDriverRows.map((r) => ({
        driver: r.driver,
        count: Number(r.cnt ?? 0),
        bytes: Number(r.bytes ?? 0),
      })),
    };
  }

  async uploadTrend(months: number): Promise<Array<{ month: string; count: number; bytes: number }>> {
    const window = safeInt(months, 12, 1, 60);
    const rows = await this.query<any[]>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
              COUNT(*) AS cnt, COALESCE(SUM(size_bytes), 0) AS bytes
       FROM employee_documents
       WHERE deleted_at IS NULL
         AND created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL ${window - 1} MONTH)
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY month ASC`,
    );
    return rows.map((r) => ({ month: r.month, count: Number(r.cnt ?? 0), bytes: Number(r.bytes ?? 0) }));
  }

  /**
   * Per-employee compliance in one grouped query. Deliberately set-based: a
   * per-employee loop would issue 100k round trips on a large workforce.
   */
  async complianceRows(filters: {
    department?: string;
    branch?: string;
    employeeId?: number;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ rows: any[]; total: number }> {
    const iso2 = countryIso2SqlExpr('e.country');
    let where = " WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING'";
    const values: any[] = [];

    if (filters.employeeId) {
      where += ' AND e.id = ?';
      values.push(filters.employeeId);
    }
    if (filters.department) {
      where += ' AND e.department = ?';
      values.push(filters.department);
    }
    if (filters.branch) {
      where += ' AND e.branch = ?';
      values.push(filters.branch);
    }

    const joins = `
      FROM employees e
      LEFT JOIN document_requirements r
        ON r.deleted_at IS NULL AND r.is_mandatory = 1
       AND (r.country         IS NULL OR r.country         = ${iso2})
       AND (r.employment_type IS NULL OR r.employment_type = e.employment_type)
       AND (r.worker_type     IS NULL OR r.worker_type     = e.worker_type)
       AND (r.grade           IS NULL OR r.grade           = e.grade)
       AND (r.department      IS NULL OR r.department      = e.department)
      LEFT JOIN document_types dt
        ON dt.id = r.document_type_id AND dt.deleted_at IS NULL AND dt.is_active = 1
      LEFT JOIN employee_documents d
        ON d.employee_id = e.id AND d.document_type_id = r.document_type_id
       AND d.deleted_at IS NULL AND d.is_current_version = 1
       AND d.status IN ('UPLOADED', 'PENDING_REVIEW', 'PENDING_VERIFICATION', 'APPROVED')
      LEFT JOIN employee_documents x
        ON x.employee_id = e.id AND x.document_type_id = r.document_type_id
       AND x.deleted_at IS NULL AND x.is_current_version = 1 AND x.status = 'EXPIRED'
    `;

    const limit = safeInt(filters.limit, 50, 1, 500);
    const offset = safeInt(filters.offset, 0, 0, 1_000_000);

    const rows = await this.query<any[]>(
      `SELECT e.id AS employee_id, e.emp_code, e.full_name, e.department, e.branch, e.joined_at,
              COUNT(DISTINCT CASE WHEN dt.id IS NOT NULL THEN r.document_type_id END) AS required,
              COUNT(DISTINCT CASE WHEN d.id IS NOT NULL THEN r.document_type_id END) AS present,
              COUNT(DISTINCT CASE WHEN x.id IS NOT NULL THEN r.document_type_id END) AS expired
       ${joins}
       ${where}
       GROUP BY e.id, e.emp_code, e.full_name, e.department, e.branch, e.joined_at
       ORDER BY e.full_name ASC
       LIMIT ${limit} OFFSET ${offset}`,
      values,
    );

    const countRows = await this.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM employees e ${where}`,
      values,
    );

    return { rows, total: Number(countRows[0]?.cnt ?? 0) };
  }

  /** Company-wide required/present totals, for the dashboard compliance score. */
  async complianceTotals(): Promise<{ required: number; present: number; expired: number; employees: number }> {
    const iso2 = countryIso2SqlExpr('e.country');
    const rows = await this.query<any[]>(
      `SELECT COALESCE(SUM(t.required), 0) AS required,
              COALESCE(SUM(t.present), 0)  AS present,
              COALESCE(SUM(t.expired), 0)  AS expired,
              COUNT(*) AS employees
       FROM (
         SELECT e.id,
                COUNT(DISTINCT CASE WHEN dt.id IS NOT NULL THEN r.document_type_id END) AS required,
                COUNT(DISTINCT CASE WHEN d.id  IS NOT NULL THEN r.document_type_id END) AS present,
                COUNT(DISTINCT CASE WHEN x.id  IS NOT NULL THEN r.document_type_id END) AS expired
         FROM employees e
         LEFT JOIN document_requirements r
           ON r.deleted_at IS NULL AND r.is_mandatory = 1
          AND (r.country         IS NULL OR r.country         = ${iso2})
          AND (r.employment_type IS NULL OR r.employment_type = e.employment_type)
          AND (r.worker_type     IS NULL OR r.worker_type     = e.worker_type)
          AND (r.grade           IS NULL OR r.grade           = e.grade)
          AND (r.department      IS NULL OR r.department      = e.department)
         LEFT JOIN document_types dt
           ON dt.id = r.document_type_id AND dt.deleted_at IS NULL AND dt.is_active = 1
         LEFT JOIN employee_documents d
           ON d.employee_id = e.id AND d.document_type_id = r.document_type_id
          AND d.deleted_at IS NULL AND d.is_current_version = 1
          AND d.status IN ('UPLOADED', 'PENDING_REVIEW', 'PENDING_VERIFICATION', 'APPROVED')
         LEFT JOIN employee_documents x
           ON x.employee_id = e.id AND x.document_type_id = r.document_type_id
          AND x.deleted_at IS NULL AND x.is_current_version = 1 AND x.status = 'EXPIRED'
         WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING'
         GROUP BY e.id
       ) t`,
    );
    return {
      required: Number(rows[0]?.required ?? 0),
      present: Number(rows[0]?.present ?? 0),
      expired: Number(rows[0]?.expired ?? 0),
      employees: Number(rows[0]?.employees ?? 0),
    };
  }

  /** One row per missing mandatory document, across the workforce. */
  async missingDocumentRows(filters: {
    department?: string;
    branch?: string;
    employeeId?: number;
    limit?: number;
    offset?: number;
  } = {}): Promise<any[]> {
    const iso2 = countryIso2SqlExpr('e.country');
    let where = " WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING' AND d.id IS NULL";
    const values: any[] = [];

    if (filters.employeeId) {
      where += ' AND e.id = ?';
      values.push(filters.employeeId);
    }
    if (filters.department) {
      where += ' AND e.department = ?';
      values.push(filters.department);
    }
    if (filters.branch) {
      where += ' AND e.branch = ?';
      values.push(filters.branch);
    }

    const limit = safeInt(filters.limit, 500, 1, 5000);
    const offset = safeInt(filters.offset, 0, 0, 1_000_000);

    return this.query<any[]>(
      `SELECT e.id AS employee_id, e.emp_code, e.full_name, e.department, e.branch, e.joined_at,
              dt.code AS type_code, dt.name AS type_name, dt.category,
              r.due_days_after_joining
       FROM employees e
       JOIN document_requirements r
         ON r.deleted_at IS NULL AND r.is_mandatory = 1
        AND (r.country         IS NULL OR r.country         = ${iso2})
        AND (r.employment_type IS NULL OR r.employment_type = e.employment_type)
        AND (r.worker_type     IS NULL OR r.worker_type     = e.worker_type)
        AND (r.grade           IS NULL OR r.grade           = e.grade)
        AND (r.department      IS NULL OR r.department      = e.department)
       JOIN document_types dt
         ON dt.id = r.document_type_id AND dt.deleted_at IS NULL AND dt.is_active = 1
       LEFT JOIN employee_documents d
         ON d.employee_id = e.id AND d.document_type_id = r.document_type_id
        AND d.deleted_at IS NULL AND d.is_current_version = 1
        AND d.status IN ('UPLOADED', 'PENDING_REVIEW', 'PENDING_VERIFICATION', 'APPROVED')
       ${where}
       ORDER BY e.full_name ASC, dt.category ASC, dt.name ASC
       LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
  }

  /** Document type ids an employee already holds in a live state. */
  async findHeldTypeIds(employeeId: number): Promise<Map<number, { status: DocumentStatus; expiresOn: string | null }>> {
    const rows = await this.query<any[]>(
      `SELECT document_type_id, status, expires_on FROM employee_documents
       WHERE employee_id = ? AND deleted_at IS NULL AND is_current_version = 1
         AND document_type_id IS NOT NULL
         AND status NOT IN ('ARCHIVED', 'DELETED', 'REJECTED')`,
      [employeeId],
    );
    const map = new Map<number, { status: DocumentStatus; expiresOn: string | null }>();
    for (const r of rows) {
      map.set(Number(r.document_type_id), {
        status: r.status as DocumentStatus,
        expiresOn: r.expires_on ? toDateString(r.expires_on) : null,
      });
    }
    return map;
  }

  async verificationBreakdown(): Promise<any[]> {
    return this.query<any[]>(
      `SELECT COALESCE(dt.name, d.doc_type) AS type_name,
              COALESCE(dt.category, 'OTHER') AS category,
              d.status,
              COUNT(*) AS cnt
       FROM employee_documents d
       LEFT JOIN document_types dt ON dt.id = d.document_type_id
       WHERE d.deleted_at IS NULL AND d.is_current_version = 1
       GROUP BY COALESCE(dt.name, d.doc_type), COALESCE(dt.category, 'OTHER'), d.status
       ORDER BY category ASC, type_name ASC, d.status ASC`,
    );
  }

  async departmentCompleteness(): Promise<any[]> {
    const iso2 = countryIso2SqlExpr('e.country');
    return this.query<any[]>(
      `SELECT t.department,
              COUNT(*) AS employees,
              COALESCE(SUM(t.required), 0) AS required,
              COALESCE(SUM(t.present), 0)  AS present
       FROM (
         SELECT e.id, COALESCE(e.department, 'Unassigned') AS department,
                COUNT(DISTINCT CASE WHEN dt.id IS NOT NULL THEN r.document_type_id END) AS required,
                COUNT(DISTINCT CASE WHEN d.id  IS NOT NULL THEN r.document_type_id END) AS present
         FROM employees e
         LEFT JOIN document_requirements r
           ON r.deleted_at IS NULL AND r.is_mandatory = 1
          AND (r.country         IS NULL OR r.country         = ${iso2})
          AND (r.employment_type IS NULL OR r.employment_type = e.employment_type)
          AND (r.worker_type     IS NULL OR r.worker_type     = e.worker_type)
          AND (r.grade           IS NULL OR r.grade           = e.grade)
          AND (r.department      IS NULL OR r.department      = e.department)
         LEFT JOIN document_types dt
           ON dt.id = r.document_type_id AND dt.deleted_at IS NULL AND dt.is_active = 1
         LEFT JOIN employee_documents d
           ON d.employee_id = e.id AND d.document_type_id = r.document_type_id
          AND d.deleted_at IS NULL AND d.is_current_version = 1
          AND d.status IN ('UPLOADED', 'PENDING_REVIEW', 'PENDING_VERIFICATION', 'APPROVED')
         WHERE e.deleted_at IS NULL AND e.work_status = 'WORKING'
         GROUP BY e.id, COALESCE(e.department, 'Unassigned')
       ) t
       GROUP BY t.department
       ORDER BY t.department ASC`,
    );
  }

  // =========================================================================
  // Mappers
  // =========================================================================
  private toType(r: any): DocumentTypeResponse {
    return {
      id: Number(r.id),
      code: r.code,
      name: r.name,
      category: r.category,
      description: r.description ?? null,
      country: r.country ?? null,
      legacyDocType: (r.legacy_doc_type ?? null) as LegacyDocType | null,
      isMandatory: !!r.is_mandatory,
      requiresExpiry: !!r.requires_expiry,
      requiresVerification: !!r.requires_verification,
      requiresApproval: !!r.requires_approval,
      allowsMultiple: !!r.allows_multiple,
      retentionMonths: r.retention_months === null || r.retention_months === undefined ? null : Number(r.retention_months),
      renewalReminderDays: Number(r.renewal_reminder_days ?? 30),
      maxFileMb: Number(r.max_file_mb ?? 5),
      isConfidential: !!r.is_confidential,
      sortOrder: Number(r.sort_order ?? 100),
      isActive: !!r.is_active,
    };
  }

  private toRequirement(r: any): DocumentRequirementResponse {
    return {
      id: Number(r.id),
      documentTypeId: Number(r.document_type_id),
      typeCode: r.type_code ?? null,
      typeName: r.type_name ?? null,
      category: (r.type_category ?? null) as DocumentTypeCategory | null,
      country: r.country ?? null,
      employmentType: r.employment_type ?? null,
      workerType: r.worker_type ?? null,
      grade: r.grade ?? null,
      department: r.department ?? null,
      isMandatory: !!r.is_mandatory,
      dueDaysAfterJoining:
        r.due_days_after_joining === null || r.due_days_after_joining === undefined
          ? null
          : Number(r.due_days_after_joining),
      notes: r.notes ?? null,
    };
  }

  private toDocument(r: any): DocumentResponse {
    const expiresOn = r.expires_on ? toDateString(r.expires_on) : null;
    let daysToExpiry: number | null = null;
    if (expiresOn) {
      const diff = Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${toDateString(new Date())}T00:00:00Z`);
      daysToExpiry = Math.round(diff / 86400000);
    }

    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      employeeName: r.employee_name ?? null,
      empCode: r.emp_code ?? null,
      department: r.employee_department ?? null,
      branch: r.employee_branch ?? null,
      documentTypeId: r.document_type_id === null || r.document_type_id === undefined ? null : Number(r.document_type_id),
      typeCode: r.type_code ?? null,
      typeName: r.type_name ?? null,
      category: (r.type_category ?? null) as DocumentTypeCategory | null,
      legacyDocType: r.doc_type as LegacyDocType,
      legacyCategory: r.category as LegacyCategory,
      title: r.title,
      fileName: r.file_name,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes ?? 0),
      status: r.status as DocumentStatus,
      version: Number(r.version ?? 1),
      isCurrentVersion: !!r.is_current_version,
      rootDocumentId: r.root_document_id === null || r.root_document_id === undefined ? null : Number(r.root_document_id),
      replacedById: r.replaced_by_id === null || r.replaced_by_id === undefined ? null : Number(r.replaced_by_id),
      fileHash: r.file_hash ?? null,
      integrityCheckedAt: r.integrity_checked_at ? new Date(r.integrity_checked_at).toISOString() : null,
      integrityOk: r.integrity_ok === null || r.integrity_ok === undefined ? null : !!r.integrity_ok,
      storageDriver: r.storage_driver ?? 'local',
      storageKey: r.storage_key ?? null,
      isEncrypted: !!r.is_encrypted,
      ocrStatus: (r.ocr_status ?? 'NOT_RUN') as OcrStatus,
      hasOcrText: !!r.ocr_text,
      virusScanStatus: (r.virus_scan_status ?? 'NOT_RUN') as VirusScanStatus,
      virusScanDetail: r.virus_scan_detail ?? null,
      thumbnailKey: r.thumbnail_key ?? null,
      docNumber: r.doc_number ?? null,
      issuingAuthority: r.issuing_authority ?? null,
      issuedOn: r.issued_on ? toDateString(r.issued_on) : null,
      expiresOn,
      daysToExpiry,
      isExpired: daysToExpiry !== null && daysToExpiry < 0,
      tags: r.tags ? String(r.tags).split(',').filter(Boolean) : [],
      notes: r.notes ?? null,
      isConfidential: !!r.type_confidential,
      verified: !!r.verified,
      verifiedBy: r.verified_by === null || r.verified_by === undefined ? null : Number(r.verified_by),
      verifiedByName: r.verified_by_name ?? null,
      verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null,
      reviewedByName: r.reviewed_by_name ?? null,
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
      approvedByName: r.approved_by_name ?? null,
      approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
      rejectedReason: r.rejected_reason ?? null,
      isLocked: !!r.is_locked,
      lockedByName: r.locked_by_name ?? null,
      lockedAt: r.locked_at ? new Date(r.locked_at).toISOString() : null,
      archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
      retentionUntil: r.retention_until ? toDateString(r.retention_until) : null,
      uploadedBy: r.uploaded_by === null || r.uploaded_by === undefined ? null : Number(r.uploaded_by),
      uploadedByName: r.uploaded_by_name ?? null,
      uploadIp: r.upload_ip ?? null,
      uploadedAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at ?? r.created_at).toISOString(),
      deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
    };
  }

  private toAudit(r: any): DocumentAuditResponse {
    return {
      id: Number(r.id),
      documentId: r.document_id === null || r.document_id === undefined ? null : Number(r.document_id),
      employeeId: r.employee_id === null || r.employee_id === undefined ? null : Number(r.employee_id),
      documentTitle: r.document_title ?? null,
      actorUserId: r.actor_user_id === null || r.actor_user_id === undefined ? null : Number(r.actor_user_id),
      actorName: r.actor_name ?? null,
      actorRole: r.actor_role ?? null,
      action: r.action as DocumentAuditAction,
      detail: r.detail ?? null,
      previousValue: r.previous_value ?? null,
      newValue: r.new_value ?? null,
      ipAddress: r.ip_address ?? null,
      device: r.device ?? null,
      browser: r.browser ?? null,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  private toShare(r: any): DocumentShareResponse {
    const expiresAt = new Date(r.expires_at);
    const revoked = !!r.revoked_at;
    const exhausted = r.max_downloads !== null && Number(r.download_count ?? 0) >= Number(r.max_downloads);
    return {
      id: Number(r.id),
      documentId: Number(r.document_id),
      createdBy: r.created_by === null || r.created_by === undefined ? null : Number(r.created_by),
      createdByName: r.created_by_name ?? null,
      recipientNote: r.recipient_note ?? null,
      expiresAt: expiresAt.toISOString(),
      maxDownloads: r.max_downloads === null || r.max_downloads === undefined ? null : Number(r.max_downloads),
      downloadCount: Number(r.download_count ?? 0),
      allowDownload: !!r.allow_download,
      watermark: !!r.watermark,
      allowedIp: r.allowed_ip ?? null,
      revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
      lastAccessedAt: r.last_accessed_at ? new Date(r.last_accessed_at).toISOString() : null,
      isActive: !revoked && !exhausted && expiresAt.getTime() > Date.now(),
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  private toComment(r: any): DocumentCommentResponse {
    return {
      id: Number(r.id),
      documentId: Number(r.document_id),
      userId: r.user_id === null || r.user_id === undefined ? null : Number(r.user_id),
      authorName: r.author_name ?? null,
      body: r.body,
      isInternal: !!r.is_internal,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }
}
