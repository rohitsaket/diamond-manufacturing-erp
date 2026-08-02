import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';
import {
  DocumentRepository,
  DocumentResponse,
  DocumentStatus,
  DocumentTypeCategory,
  DocumentAuditAction,
  DocumentAuditResponse,
  DocumentCommentResponse,
  DocumentShareResponse,
  LegacyCategory,
  LegacyDocType,
  AuditFilters,
  DocumentPatch,
  DocumentSearchParams,
} from '../repositories/DocumentRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { NotificationService } from './NotificationService';
import { getStorageDriver, StorageDriver } from './storage/StorageDriver';
import {
  addMonths,
  buildStorageKey,
  clientIp,
  detectDeviceAndBrowser,
  formatTags,
  isAllowedMime,
  parseTags,
  RequestLike,
  sanitizeFileName,
  sha256OfBuffer,
  sha256OfFile,
  sha256OfString,
  userAgentOf,
} from '../utils/documentUtils';
import { isValidDateString, todayString, toDateString } from '../utils/dateUtils';

/**
 * Document lifecycle: upload, versioning, workflow, sharing, integrity, expiry.
 *
 * What this service deliberately does NOT do is pretend. OCR, virus scanning,
 * thumbnailing and e-signature all have columns and hooks in the schema, but no
 * engine is installed in this deployment, so those methods record an honest
 * status and throw instead of inventing a result. See the bottom section.
 */

export interface DocumentActor {
  userId: number;
  name: string;
  role: string;
  employeeId?: number | null;
}

export interface UploadMeta {
  documentTypeId?: number;
  documentTypeCode?: string;
  title?: string;
  docNumber?: string | null;
  issuingAuthority?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  tags?: string | null;
  notes?: string | null;
  storageDriver?: string;
}

export interface MetadataPatch {
  title?: string;
  documentTypeId?: number;
  docNumber?: string | null;
  issuingAuthority?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  tags?: string | null;
  notes?: string | null;
}

export interface DocumentDownload {
  stream: NodeJS.ReadableStream;
  fileName: string;
  mimeType: string;
  size: number;
  documentId: number;
  watermark?: boolean;
}

export interface IntegrityResult {
  documentId: number;
  ok: boolean;
  expectedHash: string | null;
  actualHash: string;
  checkedAt: string;
  message: string;
}

export interface ShareOptions {
  expiresInHours?: number;
  maxDownloads?: number | null;
  allowDownload?: boolean;
  watermark?: boolean;
  allowedIp?: string | null;
  note?: string | null;
}

export interface CreatedShare {
  id: number;
  documentId: number;
  /** The plaintext token. Returned exactly once — only its sha256 is stored. */
  token: string;
  url: string;
  expiresAt: string;
  maxDownloads: number | null;
  allowDownload: boolean;
  watermark: boolean;
  allowedIp: string | null;
}

/** Legal status transitions. Anything absent here is refused. */
const TRANSITIONS: Record<DocumentStatus, DocumentStatus[]> = {
  DRAFT: ['UPLOADED', 'PENDING_REVIEW', 'PENDING_VERIFICATION', 'ARCHIVED', 'DELETED'],
  UPLOADED: ['PENDING_REVIEW', 'PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'EXPIRED', 'RENEWED', 'ARCHIVED', 'DELETED'],
  PENDING_REVIEW: ['PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'EXPIRED', 'RENEWED', 'ARCHIVED', 'DELETED'],
  PENDING_VERIFICATION: ['APPROVED', 'REJECTED', 'EXPIRED', 'RENEWED', 'ARCHIVED', 'DELETED'],
  APPROVED: ['PENDING_REVIEW', 'PENDING_VERIFICATION', 'EXPIRED', 'RENEWED', 'ARCHIVED', 'DELETED'],
  REJECTED: ['PENDING_REVIEW', 'PENDING_VERIFICATION', 'ARCHIVED', 'DELETED'],
  EXPIRED: ['PENDING_REVIEW', 'PENDING_VERIFICATION', 'RENEWED', 'ARCHIVED', 'DELETED'],
  RENEWED: ['ARCHIVED', 'DELETED'],
  ARCHIVED: ['UPLOADED', 'APPROVED', 'DELETED'],
  DELETED: ['UPLOADED', 'APPROVED'],
};

/**
 * Legacy fan-out. `doc_type` and `category` are the columns the pre-DMS
 * endpoints read, so every new row must carry sensible values for them.
 */
const LEGACY_CATEGORY_BY_DOC_TYPE: Partial<Record<LegacyDocType, LegacyCategory>> = {
  AADHAAR: 'IDENTITY',
  PAN: 'IDENTITY',
  PASSPORT: 'IDENTITY',
  VISA: 'IDENTITY',
  VOTER_ID: 'IDENTITY',
  DRIVING_LICENSE: 'IDENTITY',
  PHOTO: 'IDENTITY',
  ADDRESS_PROOF: 'ADDRESS',
  BANK_PASSBOOK: 'BANK',
  EDUCATION: 'EDUCATION',
  EXPERIENCE: 'EXPERIENCE',
  MEDICAL: 'MEDICAL',
  EMPLOYMENT: 'EMPLOYMENT',
  AGREEMENT: 'EMPLOYMENT',
  FAMILY: 'FAMILY',
};

const LEGACY_CATEGORY_BY_CATEGORY: Record<DocumentTypeCategory, LegacyCategory> = {
  GOVERNMENT_ID: 'IDENTITY',
  PERSONAL: 'OTHER',
  EDUCATION: 'EDUCATION',
  CERTIFICATION: 'EDUCATION',
  EMPLOYMENT: 'EMPLOYMENT',
  EXPERIENCE: 'EXPERIENCE',
  PAYROLL_FINANCE: 'BANK',
  MEDICAL: 'MEDICAL',
  IMMIGRATION: 'IDENTITY',
  COMPLIANCE: 'EMPLOYMENT',
  SIGNATURE: 'OTHER',
  HR_FORM: 'EMPLOYMENT',
  ASSET: 'OTHER',
  LEGAL: 'OTHER',
  EMPLOYEE_GENERATED: 'OTHER',
  OTHER: 'OTHER',
};

const NOT_FOUND = 'Document not found';

interface AuditContext {
  ipAddress: string | null;
  userAgent: string | null;
  device: string;
  browser: string;
}

export class DocumentService {
  protected repo = new DocumentRepository();
  private employeeRepo = new EmployeeRepository();
  private activityRepo = new ActivityRepository();
  private notifications = new NotificationService();

  // =========================================================================
  // Upload
  // =========================================================================
  async upload(
    employeeId: number,
    file: Express.Multer.File | undefined,
    meta: UploadMeta,
    actor: DocumentActor,
    req?: RequestLike,
  ): Promise<DocumentResponse> {
    if (!file) throw new Error('A file is required');
    let copiedKey: string | null = null;
    let driverName = 'local';

    try {
      const employee = await this.employeeRepo.findRowById(employeeId);
      if (!employee) throw new Error('Employee not found');

      const type = await this.resolveType(meta);

      if (!type.is_active) throw new Error(`Document type "${type.name}" is no longer active`);
      if (!isAllowedMime(file.mimetype)) {
        throw new Error(`${file.mimetype} files are not accepted for document uploads`);
      }

      const maxMb = Number(type.max_file_mb ?? env.maxUploadMb);
      if (file.size > maxMb * 1024 * 1024) {
        throw new Error(`${type.name} files must be ${maxMb} MB or smaller`);
      }

      if (type.requires_expiry && !meta.expiresOn) {
        throw new Error(`An expiry date is required for ${type.name}`);
      }
      const expiresOn = this.optionalDate(meta.expiresOn, 'expiresOn');
      const issuedOn = this.optionalDate(meta.issuedOn, 'issuedOn');

      // Duplicate detection: the same bytes for the same employee is a mistake,
      // not a second document.
      const hash = await sha256OfFile(file.path);
      const duplicate = await this.repo.findByHash(employeeId, hash);
      if (duplicate) {
        throw new Error(
          `This exact file is already uploaded as "${duplicate.title}" (version ${Number(duplicate.version ?? 1)})`,
        );
      }

      if (!type.allows_multiple) {
        const existing = await this.repo.findCurrentForType(employeeId, Number(type.id));
        if (existing) {
          throw new Error(`${type.name} already exists — use replace to upload a new version`);
        }
      }

      // multer has already written the bytes into env.uploadDir, which is the
      // local driver's root. Hand them to the driver under a key that carries
      // random entropy, so two uploads of the same filename in the same
      // millisecond cannot land on each other.
      const driver = getStorageDriver(meta.storageDriver ?? 'local');
      driverName = driver.name;
      const storageKey = buildStorageKey(employeeId, file.originalname);
      await driver.putFromPath(storageKey, file.path);
      copiedKey = storageKey;

      const status = this.initialStatus(type);
      const legacyDocType = this.legacyDocTypeFor(type);
      const context = this.context(req);
      const now = new Date();

      const id = await this.repo.insert({
        employeeId,
        documentTypeId: Number(type.id),
        docType: legacyDocType,
        category: this.legacyCategoryFor(type, legacyDocType),
        title: (meta.title?.trim() || file.originalname).slice(0, 255),
        fileName: sanitizeFileName(file.originalname).slice(0, 255),
        filePath: storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        status,
        version: 1,
        isCurrentVersion: true,
        fileHash: hash,
        storageDriver: driver.name,
        storageKey,
        docNumber: meta.docNumber?.trim() || null,
        issuingAuthority: meta.issuingAuthority?.trim() || null,
        issuedOn,
        expiresOn,
        tags: formatTags(parseTags(meta.tags)),
        notes: meta.notes?.trim() || null,
        retentionUntil: this.retentionUntil(type),
        uploadedBy: actor.userId,
        uploadIp: context.ipAddress,
        verified: status === 'APPROVED',
        verifiedBy: status === 'APPROVED' ? actor.userId : null,
        verifiedAt: status === 'APPROVED' ? now : null,
        approvedBy: status === 'APPROVED' ? actor.userId : null,
        approvedAt: status === 'APPROVED' ? now : null,
      });

      // A first version is the root of its own lineage.
      await this.repo.update(id, { rootDocumentId: id });

      await this.audit(context, {
        documentId: id,
        employeeId,
        action: 'UPLOAD',
        actor,
        detail: `Uploaded ${type.name} "${meta.title?.trim() || file.originalname}"`,
        newValue: status,
      });

      await this.activityRepo.log({
        actorUserId: actor.userId,
        actorName: actor.name,
        employeeId,
        entityType: 'employee_document',
        entityId: id,
        action: 'UPLOAD',
        summary: `Uploaded ${type.name} for ${employee.full_name}`,
      });

      if (status === 'PENDING_REVIEW' || status === 'PENDING_VERIFICATION') {
        await this.notifyStaffOfReview(id, employee.full_name, type.name, status);
      }

      const created = await this.repo.findById(id);
      if (!created) throw new Error('The document could not be saved');
      return created;
    } catch (err) {
      // Nothing was recorded, so the orphaned bytes must not linger on disk.
      await this.discardStored(driverName, copiedKey);
      throw err;
    } finally {
      // The multer temp copy is redundant once the driver holds the bytes.
      this.discardFile(file);
    }
  }

  // =========================================================================
  // Replace (new version)
  // =========================================================================
  async replace(
    documentId: number,
    file: Express.Multer.File | undefined,
    meta: UploadMeta,
    actor: DocumentActor,
    req?: RequestLike,
  ): Promise<DocumentResponse> {
    if (!file) throw new Error('A file is required');
    let copiedKey: string | null = null;
    let driverName = 'local';

    try {
      const previous = await this.repo.findRowById(documentId);
      if (!previous) throw new Error(NOT_FOUND);
      if (previous.is_locked) throw new Error('This document is locked and cannot be replaced');
      if (!previous.is_current_version) {
        throw new Error('Only the current version of a document can be replaced');
      }

      const type = previous.document_type_id
        ? await this.repo.findTypeRowById(Number(previous.document_type_id))
        : null;

      if (!isAllowedMime(file.mimetype)) {
        throw new Error(`${file.mimetype} files are not accepted for document uploads`);
      }
      const maxMb = Number(type?.max_file_mb ?? env.maxUploadMb);
      if (file.size > maxMb * 1024 * 1024) {
        throw new Error(`${type?.name ?? 'Document'} files must be ${maxMb} MB or smaller`);
      }

      const hash = await sha256OfFile(file.path);
      if (hash === previous.file_hash) {
        throw new Error('The uploaded file is identical to the current version');
      }

      if (type?.requires_expiry && !meta.expiresOn && !previous.expires_on) {
        throw new Error(`An expiry date is required for ${type.name}`);
      }
      const expiresOn = meta.expiresOn
        ? this.optionalDate(meta.expiresOn, 'expiresOn')
        : previous.expires_on
          ? toDateString(previous.expires_on)
          : null;
      const issuedOn = meta.issuedOn
        ? this.optionalDate(meta.issuedOn, 'issuedOn')
        : previous.issued_on
          ? toDateString(previous.issued_on)
          : null;

      const driver = getStorageDriver(previous.storage_driver ?? 'local');
      driverName = driver.name;
      const storageKey = buildStorageKey(Number(previous.employee_id), file.originalname);
      await driver.putFromPath(storageKey, file.path);
      copiedKey = storageKey;

      const context = this.context(req);
      const rootId = Number(previous.root_document_id ?? previous.id);
      const nextVersion = Number(previous.version ?? 1) + 1;
      const status = type ? this.initialStatus(type) : 'PENDING_VERIFICATION';
      const now = new Date();

      const newId = await this.repo.withTransaction(async (conn) => {
        const insertedId = await this.repo.insert(
          {
            employeeId: Number(previous.employee_id),
            documentTypeId: previous.document_type_id ? Number(previous.document_type_id) : null,
            docType: previous.doc_type as LegacyDocType,
            category: previous.category as LegacyCategory,
            title: (meta.title?.trim() || previous.title).slice(0, 255),
            fileName: sanitizeFileName(file.originalname).slice(0, 255),
            filePath: storageKey,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            status,
            version: nextVersion,
            isCurrentVersion: true,
            rootDocumentId: rootId,
            fileHash: hash,
            storageDriver: driver.name,
            storageKey,
            docNumber: meta.docNumber?.trim() || previous.doc_number || null,
            issuingAuthority: meta.issuingAuthority?.trim() || previous.issuing_authority || null,
            issuedOn,
            expiresOn,
            tags: meta.tags !== undefined ? formatTags(parseTags(meta.tags)) : previous.tags,
            notes: meta.notes?.trim() || previous.notes || null,
            retentionUntil: type ? this.retentionUntil(type) : null,
            uploadedBy: actor.userId,
            uploadIp: context.ipAddress,
            verified: status === 'APPROVED',
            verifiedBy: status === 'APPROVED' ? actor.userId : null,
            verifiedAt: status === 'APPROVED' ? now : null,
            approvedBy: status === 'APPROVED' ? actor.userId : null,
            approvedAt: status === 'APPROVED' ? now : null,
          },
          conn,
        );

        await this.repo.update(
          Number(previous.id),
          { isCurrentVersion: false, status: 'RENEWED', replacedById: insertedId },
          conn,
        );
        await this.repo.markCurrentVersion(rootId, insertedId, conn);
        return insertedId;
      });

      await this.audit(context, {
        documentId: newId,
        employeeId: Number(previous.employee_id),
        action: 'REPLACE',
        actor,
        detail: `Replaced "${previous.title}" with version ${nextVersion}`,
        previousValue: `v${previous.version} (${previous.status})`,
        newValue: `v${nextVersion} (${status})`,
      });

      if (status === 'PENDING_REVIEW' || status === 'PENDING_VERIFICATION') {
        const employee = await this.employeeRepo.findRowById(Number(previous.employee_id));
        await this.notifyStaffOfReview(newId, employee?.full_name ?? 'an employee', type?.name ?? previous.title, status);
      }

      const created = await this.repo.findById(newId);
      if (!created) throw new Error('The new version could not be saved');
      return created;
    } catch (err) {
      await this.discardStored(driverName, copiedKey);
      throw err;
    } finally {
      this.discardFile(file);
    }
  }

  /** Make an older version current again. No new row is created; flags flip. */
  async restoreVersion(documentId: number, actor: DocumentActor, req?: RequestLike): Promise<DocumentResponse> {
    const target = await this.repo.findRowById(documentId);
    if (!target) throw new Error(NOT_FOUND);
    if (target.is_current_version) throw new Error('That version is already the current one');
    if (target.is_locked) throw new Error('This document is locked and cannot be changed');

    const rootId = Number(target.root_document_id ?? target.id);
    const restoredStatus: DocumentStatus = target.verified ? 'APPROVED' : 'UPLOADED';

    await this.repo.withTransaction(async (conn) => {
      await this.repo.markCurrentVersion(rootId, Number(target.id), conn);
      await this.repo.update(
        Number(target.id),
        { status: restoredStatus, replacedById: null, isCurrentVersion: true },
        conn,
      );
    });

    await this.audit(this.context(req), {
      documentId: Number(target.id),
      employeeId: Number(target.employee_id),
      action: 'VERSION_RESTORE',
      actor,
      detail: `Restored version ${target.version} of "${target.title}"`,
      previousValue: String(target.status),
      newValue: restoredStatus,
    });

    const restored = await this.repo.findById(documentId);
    if (!restored) throw new Error(NOT_FOUND);
    return restored;
  }

  // =========================================================================
  // Reads
  // =========================================================================
  /** The workhorse search, straight through to the repository. */
  async search(params: DocumentSearchParams): Promise<{ rows: DocumentResponse[]; total: number }> {
    return this.repo.search(params);
  }

  async getById(id: number, includeDeleted = false): Promise<DocumentResponse> {
    const doc = await this.repo.findById(id, { includeDeleted });
    if (!doc) throw new Error(NOT_FOUND);
    return doc;
  }

  async listForEmployee(
    employeeId: number,
    options: { includeArchived?: boolean; currentVersionsOnly?: boolean } = {},
  ): Promise<DocumentResponse[]> {
    return this.repo.findByEmployee(employeeId, options);
  }

  async listVersions(id: number): Promise<DocumentResponse[]> {
    const doc = await this.repo.findRowById(id, { includeDeleted: true });
    if (!doc) throw new Error(NOT_FOUND);
    return this.repo.findVersions(Number(doc.root_document_id ?? doc.id));
  }

  async listAudit(filters: AuditFilters): Promise<{ rows: DocumentAuditResponse[]; total: number }> {
    return this.repo.listAudit(filters);
  }

  // =========================================================================
  // Metadata edit
  // =========================================================================
  async updateMetadata(
    id: number,
    patch: MetadataPatch,
    actor: DocumentActor,
    req?: RequestLike,
  ): Promise<DocumentResponse> {
    const existing = await this.repo.findRowById(id);
    if (!existing) throw new Error(NOT_FOUND);
    if (existing.is_locked) throw new Error('This document is locked and cannot be edited');

    const update: DocumentPatch = {};
    if (patch.title !== undefined) {
      const title = String(patch.title).trim();
      if (!title) throw new Error('A document title is required');
      update.title = title.slice(0, 255);
    }
    if (patch.docNumber !== undefined) update.docNumber = patch.docNumber ? String(patch.docNumber).trim() : null;
    if (patch.issuingAuthority !== undefined) {
      update.issuingAuthority = patch.issuingAuthority ? String(patch.issuingAuthority).trim() : null;
    }
    if (patch.issuedOn !== undefined) update.issuedOn = this.optionalDate(patch.issuedOn, 'issuedOn');
    if (patch.expiresOn !== undefined) update.expiresOn = this.optionalDate(patch.expiresOn, 'expiresOn');
    if (patch.tags !== undefined) update.tags = formatTags(parseTags(patch.tags));
    if (patch.notes !== undefined) update.notes = patch.notes ? String(patch.notes) : null;

    if (patch.documentTypeId !== undefined) {
      const type = await this.repo.findTypeRowById(Number(patch.documentTypeId));
      if (!type) throw new Error('Document type not found');
      const legacyDocType = this.legacyDocTypeFor(type);
      update.documentTypeId = Number(type.id);
      update.docType = legacyDocType;
      update.category = this.legacyCategoryFor(type, legacyDocType);
      update.retentionUntil = this.retentionUntil(type);
    }

    if (Object.keys(update).length === 0) {
      return this.getById(id);
    }

    await this.repo.update(id, update);
    await this.audit(this.context(req), {
      documentId: id,
      employeeId: Number(existing.employee_id),
      action: 'EDIT',
      actor,
      detail: `Edited metadata on "${existing.title}"`,
      previousValue: JSON.stringify({
        title: existing.title,
        docNumber: existing.doc_number,
        expiresOn: existing.expires_on ? toDateString(existing.expires_on) : null,
        tags: existing.tags,
      }).slice(0, 2000),
      newValue: JSON.stringify(update).slice(0, 2000),
    });

    return this.getById(id);
  }

  // =========================================================================
  // Workflow
  // =========================================================================
  async submitForReview(id: number, actor: DocumentActor, req?: RequestLike): Promise<DocumentResponse> {
    return this.transition(id, 'PENDING_REVIEW', 'REVIEW', actor, req, {
      detail: 'Submitted for review',
      notifyStaff: true,
    });
  }

  async review(id: number, actor: DocumentActor, req?: RequestLike): Promise<DocumentResponse> {
    return this.transition(id, 'PENDING_VERIFICATION', 'REVIEW', actor, req, {
      detail: 'Reviewed; awaiting verification',
      patch: { reviewedBy: actor.userId, reviewedAt: new Date() },
      notifyStaff: true,
    });
  }

  async verify(id: number, actor: DocumentActor, req?: RequestLike): Promise<DocumentResponse> {
    return this.transition(id, 'APPROVED', 'VERIFY', actor, req, {
      detail: 'Verified',
      // `verified` is the legacy flag the pre-DMS endpoints read; keep it in sync.
      patch: {
        verified: true,
        verifiedBy: actor.userId,
        verifiedAt: new Date(),
        approvedBy: actor.userId,
        approvedAt: new Date(),
        rejectedReason: null,
      },
      notifyEmployee: { title: 'Document verified', body: 'Your document has been verified.' },
    });
  }

  async approve(id: number, actor: DocumentActor, req?: RequestLike): Promise<DocumentResponse> {
    return this.transition(id, 'APPROVED', 'APPROVE', actor, req, {
      detail: 'Approved',
      patch: {
        verified: true,
        verifiedBy: actor.userId,
        verifiedAt: new Date(),
        approvedBy: actor.userId,
        approvedAt: new Date(),
        rejectedReason: null,
      },
      notifyEmployee: { title: 'Document approved', body: 'Your document has been approved.' },
    });
  }

  async reject(id: number, reason: string, actor: DocumentActor, req?: RequestLike): Promise<DocumentResponse> {
    const trimmed = String(reason ?? '').trim();
    if (!trimmed) throw new Error('A rejection reason is required');

    return this.transition(id, 'REJECTED', 'REJECT', actor, req, {
      detail: `Rejected: ${trimmed}`,
      patch: {
        rejectedReason: trimmed.slice(0, 500),
        verified: false,
        verifiedBy: null,
        verifiedAt: null,
        approvedBy: null,
        approvedAt: null,
      },
      notifyEmployee: { title: 'Document rejected', body: `Your document was rejected: ${trimmed}` },
    });
  }

  async archive(id: number, actor: DocumentActor, req?: RequestLike): Promise<DocumentResponse> {
    return this.transition(id, 'ARCHIVED', 'ARCHIVE', actor, req, {
      detail: 'Archived',
      patch: { archivedAt: new Date() },
    });
  }

  /** Undo a soft delete or an archive, returning the document to active use. */
  async restore(id: number, actor: DocumentActor, req?: RequestLike): Promise<DocumentResponse> {
    const existing = await this.repo.findRowById(id, { includeDeleted: true });
    if (!existing) throw new Error(NOT_FOUND);
    if (!existing.deleted_at && existing.status !== 'ARCHIVED') {
      throw new Error('This document is already active');
    }

    const restoredStatus: DocumentStatus = existing.verified ? 'APPROVED' : 'UPLOADED';
    await this.repo.restore(id, restoredStatus);

    await this.audit(this.context(req), {
      documentId: id,
      employeeId: Number(existing.employee_id),
      action: 'RESTORE',
      actor,
      detail: `Restored "${existing.title}"`,
      previousValue: String(existing.status),
      newValue: restoredStatus,
    });

    return this.getById(id);
  }

  async remove(id: number, actor: DocumentActor, req?: RequestLike): Promise<void> {
    const existing = await this.repo.findRowById(id);
    if (!existing) throw new Error(NOT_FOUND);
    if (existing.is_locked) throw new Error('This document is locked and cannot be deleted');

    await this.repo.softDelete(id, actor.userId);
    await this.audit(this.context(req), {
      documentId: id,
      employeeId: Number(existing.employee_id),
      action: 'DELETE',
      actor,
      detail: `Deleted "${existing.title}"`,
      previousValue: String(existing.status),
      newValue: 'DELETED',
    });
  }

  async lock(id: number, actor: DocumentActor, req?: RequestLike): Promise<DocumentResponse> {
    const existing = await this.repo.findRowById(id);
    if (!existing) throw new Error(NOT_FOUND);
    if (existing.is_locked) throw new Error('This document is already locked');

    await this.repo.update(id, { isLocked: true, lockedBy: actor.userId, lockedAt: new Date() });
    await this.audit(this.context(req), {
      documentId: id,
      employeeId: Number(existing.employee_id),
      action: 'LOCK',
      actor,
      detail: `Locked "${existing.title}"`,
    });
    return this.getById(id);
  }

  async unlock(id: number, actor: DocumentActor, req?: RequestLike): Promise<DocumentResponse> {
    const existing = await this.repo.findRowById(id);
    if (!existing) throw new Error(NOT_FOUND);
    if (!existing.is_locked) throw new Error('This document is not locked');

    await this.repo.update(id, { isLocked: false, lockedBy: null, lockedAt: null });
    await this.audit(this.context(req), {
      documentId: id,
      employeeId: Number(existing.employee_id),
      action: 'UNLOCK',
      actor,
      detail: `Unlocked "${existing.title}"`,
    });
    return this.getById(id);
  }

  /** Shared body of every workflow move: validate, patch, audit, notify. */
  private async transition(
    id: number,
    target: DocumentStatus,
    action: DocumentAuditAction,
    actor: DocumentActor,
    req: RequestLike | undefined,
    options: {
      detail: string;
      patch?: DocumentPatch;
      notifyEmployee?: { title: string; body: string };
      notifyStaff?: boolean;
    },
  ): Promise<DocumentResponse> {
    const existing = await this.repo.findRowById(id);
    if (!existing) throw new Error(NOT_FOUND);
    if (existing.is_locked && target !== 'ARCHIVED') {
      throw new Error('This document is locked and cannot be changed');
    }

    const current = existing.status as DocumentStatus;
    if (current === target) {
      throw new Error(`This document is already ${target.toLowerCase().replace(/_/g, ' ')}`);
    }
    if (!(TRANSITIONS[current] ?? []).includes(target)) {
      throw new Error(`Cannot move a document from ${current} to ${target}`);
    }

    await this.repo.update(id, { status: target, ...(options.patch ?? {}) });

    await this.audit(this.context(req), {
      documentId: id,
      employeeId: Number(existing.employee_id),
      action,
      actor,
      detail: options.detail,
      previousValue: current,
      newValue: target,
    });

    if (options.notifyEmployee) {
      await this.notifications
        .notifyEmployee(Number(existing.employee_id), {
          category: 'POLICY',
          priority: target === 'REJECTED' ? 'HIGH' : 'NORMAL',
          title: options.notifyEmployee.title,
          body: `${options.notifyEmployee.body} (${existing.title})`,
          linkPage: 'documents',
          linkRefId: id,
          email: true,
        })
        .catch(() => undefined);
    }
    if (options.notifyStaff) {
      const employee = await this.employeeRepo.findRowById(Number(existing.employee_id));
      await this.notifyStaffOfReview(id, employee?.full_name ?? 'an employee', existing.title, target);
    }

    return this.getById(id);
  }

  // =========================================================================
  // Download / print
  // =========================================================================
  async getDownload(
    id: number,
    actor: DocumentActor,
    req?: RequestLike,
    options: { asPrint?: boolean } = {},
  ): Promise<DocumentDownload> {
    const row = await this.repo.findRowById(id);
    if (!row) throw new Error(NOT_FOUND);

    const download = await this.openStream(row);
    await this.audit(this.context(req), {
      documentId: id,
      employeeId: Number(row.employee_id),
      action: options.asPrint ? 'PRINT' : 'DOWNLOAD',
      actor,
      detail: `${options.asPrint ? 'Printed' : 'Downloaded'} "${row.title}"`,
    });
    return download;
  }

  private async openStream(row: any): Promise<DocumentDownload> {
    const driver = getStorageDriver(row.storage_driver ?? 'local');
    const key = row.storage_key || row.file_path;
    if (!key) throw new Error('File is missing from storage');
    if (!(await driver.exists(key))) throw new Error('File is missing from storage');

    return {
      stream: driver.stream(key),
      fileName: row.file_name || `document-${row.id}`,
      mimeType: row.mime_type || 'application/octet-stream',
      size: Number(row.size_bytes ?? 0),
      documentId: Number(row.id),
    };
  }

  // =========================================================================
  // Integrity — this one is real
  // =========================================================================
  /**
   * Re-hash the bytes currently in storage and compare them to the hash taken
   * at upload. This is a genuine tamper/corruption check, not a stub.
   */
  async verifyIntegrity(id: number): Promise<IntegrityResult> {
    const row = await this.repo.findRowById(id, { includeDeleted: true });
    if (!row) throw new Error(NOT_FOUND);

    const driver: StorageDriver = getStorageDriver(row.storage_driver ?? 'local');
    const key = row.storage_key || row.file_path;
    if (!key || !(await driver.exists(key))) {
      await this.repo.update(id, { integrityCheckedAt: new Date(), integrityOk: false });
      throw new Error('File is missing from storage');
    }

    const localPath = driver.absolutePathIfLocal(key);
    const actualHash = localPath ? await sha256OfFile(localPath) : sha256OfBuffer(await driver.get(key));

    const expectedHash: string | null = row.file_hash ?? null;
    const checkedAt = new Date();

    if (!expectedHash) {
      // No baseline existed (a legacy row). Record one rather than guessing.
      await this.repo.update(id, { fileHash: actualHash, integrityCheckedAt: checkedAt, integrityOk: true });
      return {
        documentId: id,
        ok: true,
        expectedHash: null,
        actualHash,
        checkedAt: checkedAt.toISOString(),
        message: 'No baseline hash existed for this document; the current file hash has been recorded as the baseline',
      };
    }

    const ok = expectedHash === actualHash;
    await this.repo.update(id, { integrityCheckedAt: checkedAt, integrityOk: ok });

    return {
      documentId: id,
      ok,
      expectedHash,
      actualHash,
      checkedAt: checkedAt.toISOString(),
      message: ok
        ? 'The stored file matches the hash recorded at upload'
        : 'The stored file does NOT match the hash recorded at upload — it has been modified or corrupted',
    };
  }

  // =========================================================================
  // Share links
  // =========================================================================
  async createShare(
    documentId: number,
    options: ShareOptions,
    actor: DocumentActor,
    req?: RequestLike,
  ): Promise<CreatedShare> {
    const row = await this.repo.findRowById(documentId);
    if (!row) throw new Error(NOT_FOUND);

    const hours = Number(options.expiresInHours ?? 72);
    if (!Number.isFinite(hours) || hours <= 0) throw new Error('expiresInHours must be a positive number');
    if (hours > 24 * 90) throw new Error('A share link cannot be valid for more than 90 days');

    const maxDownloads =
      options.maxDownloads === undefined || options.maxDownloads === null ? null : Number(options.maxDownloads);
    if (maxDownloads !== null && (!Number.isFinite(maxDownloads) || maxDownloads < 1)) {
      throw new Error('maxDownloads must be at least 1');
    }

    // 32 random bytes; only the sha256 is persisted, so a database dump cannot
    // be replayed as a working link.
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + hours * 3600 * 1000);

    const id = await this.repo.createShare({
      documentId,
      tokenHash: sha256OfString(token),
      createdBy: actor.userId,
      recipientNote: options.note ? String(options.note).slice(0, 200) : null,
      expiresAt,
      maxDownloads,
      allowDownload: options.allowDownload === undefined ? true : !!options.allowDownload,
      watermark: options.watermark === undefined ? true : !!options.watermark,
      allowedIp: options.allowedIp ? String(options.allowedIp).slice(0, 45) : null,
    });

    await this.audit(this.context(req), {
      documentId,
      employeeId: Number(row.employee_id),
      action: 'SHARE',
      actor,
      detail: `Created a share link valid until ${expiresAt.toISOString()}`,
      newValue: `share:${id}`,
    });

    return {
      id,
      documentId,
      token,
      url: `${env.company.appUrl.replace(/\/+$/, '')}/documents/shared/${token}`,
      expiresAt: expiresAt.toISOString(),
      maxDownloads,
      allowDownload: options.allowDownload === undefined ? true : !!options.allowDownload,
      watermark: options.watermark === undefined ? true : !!options.watermark,
      allowedIp: options.allowedIp ?? null,
    };
  }

  async listShares(documentId: number): Promise<DocumentShareResponse[]> {
    const row = await this.repo.findRowById(documentId);
    if (!row) throw new Error(NOT_FOUND);
    return this.repo.listShares(documentId);
  }

  async revokeShare(shareId: number, actor: DocumentActor, req?: RequestLike): Promise<void> {
    const share = await this.repo.findShareById(shareId);
    if (!share) throw new Error('Share link not found');
    if (share.revoked_at) throw new Error('This link has already been revoked');

    await this.repo.revokeShare(shareId);
    await this.audit(this.context(req), {
      documentId: Number(share.document_id),
      action: 'SHARE',
      actor,
      detail: `Revoked share link ${shareId}`,
    });
  }

  /** Validate a public share token and open the file it points at. */
  async resolveShare(token: string, req?: RequestLike): Promise<DocumentDownload> {
    const clean = String(token ?? '').trim();
    if (!clean) throw new Error('This link is not valid');

    const share = await this.repo.findShareByTokenHash(sha256OfString(clean));
    if (!share) throw new Error('This link is not valid');
    if (share.revoked_at) throw new Error('This link has been revoked');
    if (new Date(share.expires_at).getTime() <= Date.now()) throw new Error('This link has expired');
    if (share.max_downloads !== null && Number(share.download_count ?? 0) >= Number(share.max_downloads)) {
      throw new Error('This link has reached its download limit');
    }

    const ip = clientIp(req);
    if (share.allowed_ip && share.allowed_ip !== ip) {
      throw new Error('This link is not permitted from your network');
    }

    const row = await this.repo.findRowById(Number(share.document_id));
    if (!row) throw new Error('The shared document is no longer available');

    const download = await this.openStream(row);
    await this.repo.incrementShareDownload(Number(share.id));

    const context = this.context(req);
    await this.repo.logAudit({
      documentId: Number(row.id),
      employeeId: Number(row.employee_id),
      actorUserId: share.created_by ?? null,
      actorName: 'Share link recipient',
      actorRole: 'share',
      action: 'SHARE_ACCESS',
      detail: `Share link ${share.id} accessed (download ${Number(share.download_count ?? 0) + 1})`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      device: context.device,
      browser: context.browser,
    });

    return { ...download, watermark: !!share.watermark };
  }

  // =========================================================================
  // Comments
  // =========================================================================
  async listComments(documentId: number, staffView: boolean): Promise<DocumentCommentResponse[]> {
    const row = await this.repo.findRowById(documentId);
    if (!row) throw new Error(NOT_FOUND);
    return this.repo.listComments(documentId, staffView);
  }

  async addComment(
    documentId: number,
    body: string,
    isInternal: boolean,
    actor: DocumentActor,
    staffView: boolean,
  ): Promise<DocumentCommentResponse> {
    const row = await this.repo.findRowById(documentId);
    if (!row) throw new Error(NOT_FOUND);

    const text = String(body ?? '').trim();
    if (!text) throw new Error('A comment cannot be empty');

    // Only staff can leave a note the employee never sees.
    const internal = staffView ? !!isInternal : false;
    const id = await this.repo.addComment({
      documentId,
      userId: actor.userId,
      authorName: actor.name,
      body: text,
      isInternal: internal,
    });

    const comments = await this.repo.listComments(documentId, true);
    const created = comments.find((c) => c.id === id);
    if (!created) throw new Error('The comment could not be saved');
    return created;
  }

  async deleteComment(commentId: number, actor: DocumentActor): Promise<void> {
    const comment = await this.repo.findCommentById(commentId);
    if (!comment) throw new Error('Comment not found');
    if (Number(comment.user_id) !== actor.userId && !['admin', 'hr'].includes(actor.role)) {
      throw new Error('You can only delete your own comments');
    }
    await this.repo.softDeleteComment(commentId);
  }

  // =========================================================================
  // Expiry
  // =========================================================================
  /** Flip live documents whose expiry has passed to EXPIRED. Returns the count. */
  async markExpiredDocuments(): Promise<number> {
    const candidates = await this.repo.findExpirable(1000);
    if (candidates.length === 0) return 0;

    const updated = await this.repo.markExpired(candidates.map((c) => Number(c.id)));
    for (const doc of candidates) {
      await this.repo.logAudit({
        documentId: Number(doc.id),
        employeeId: Number(doc.employee_id),
        actorName: 'System',
        actorRole: 'system',
        action: 'EXPIRE',
        detail: `Expired automatically (was ${doc.status})`,
        previousValue: String(doc.status),
        newValue: 'EXPIRED',
      });
    }
    return updated;
  }

  /**
   * Notify the employee and HR about documents inside their renewal window.
   * The audit log doubles as the idempotency key: a `reminder:<date>` detail is
   * written per document per day and re-running the job the same day is a no-op.
   */
  async sendExpiryReminders(): Promise<number> {
    const today = todayString();
    const due = await this.repo.findDueForReminder(today, 500);
    let sent = 0;

    for (const doc of due) {
      const expiresOn = toDateString(doc.expires_on);
      const body = `${doc.type_name} "${doc.title}" for ${doc.employee_name} expires on ${expiresOn}.`;

      await this.notifications
        .notifyEmployee(Number(doc.employee_id), {
          category: 'POLICY',
          priority: 'HIGH',
          title: `Document expiring: ${doc.type_name}`,
          body,
          linkPage: 'documents',
          linkRefId: Number(doc.id),
          email: true,
        })
        .catch(() => undefined);

      await this.notifications
        .notifyRoles(['admin', 'hr'], {
          category: 'POLICY',
          priority: 'NORMAL',
          title: `Document expiring: ${doc.employee_name}`,
          body,
          linkPage: 'documents',
          linkRefId: Number(doc.id),
          email: true,
        })
        .catch(() => undefined);

      await this.repo.logAudit({
        documentId: Number(doc.id),
        employeeId: Number(doc.employee_id),
        actorName: 'System',
        actorRole: 'system',
        action: 'EXPIRE',
        detail: `reminder:${today} sent for expiry ${expiresOn}`,
      });
      sent++;
    }
    return sent;
  }

  // =========================================================================
  // Capabilities this deployment does NOT have
  //
  // Each of these has a real column and a real hook. None of them fabricates a
  // result: a fake "CLEAN" virus scan or an empty OCR pass would be actively
  // dangerous, so they record an honest status and refuse.
  // =========================================================================
  async runOcr(id: number, actor: DocumentActor, req?: RequestLike): Promise<never> {
    const row = await this.repo.findRowById(id);
    if (!row) throw new Error(NOT_FOUND);

    await this.repo.update(id, { ocrStatus: 'UNSUPPORTED' });
    await this.audit(this.context(req), {
      documentId: id,
      employeeId: Number(row.employee_id),
      action: 'OCR',
      actor,
      detail: 'OCR requested but no engine is configured',
      newValue: 'UNSUPPORTED',
    });
    throw new Error('OCR is not configured — no OCR engine is available in this deployment');
  }

  async runVirusScan(id: number, actor: DocumentActor, req?: RequestLike): Promise<never> {
    const row = await this.repo.findRowById(id);
    if (!row) throw new Error(NOT_FOUND);

    await this.repo.update(id, {
      virusScanStatus: 'NOT_RUN',
      virusScanDetail: 'No virus scanner is configured in this deployment',
    });
    await this.audit(this.context(req), {
      documentId: id,
      employeeId: Number(row.employee_id),
      action: 'SCAN',
      actor,
      detail: 'Virus scan requested but no scanner is configured',
      newValue: 'NOT_RUN',
    });
    throw new Error('Virus scanning is not configured — no scanner is available in this deployment');
  }

  async generateThumbnail(id: number): Promise<never> {
    if (!(await this.repo.findRowById(id))) throw new Error(NOT_FOUND);
    throw new Error(
      'Thumbnail generation is not configured — no image processing library is available in this deployment',
    );
  }

  async requestSignature(id: number): Promise<never> {
    if (!(await this.repo.findRowById(id))) throw new Error(NOT_FOUND);
    throw new Error(
      'Digital signing is not configured — no e-signature provider is available in this deployment',
    );
  }

  // =========================================================================
  // Internals
  // =========================================================================
  private async resolveType(meta: UploadMeta): Promise<any> {
    let type: any = null;
    if (meta.documentTypeId !== undefined && meta.documentTypeId !== null) {
      const id = Number(meta.documentTypeId);
      if (!Number.isFinite(id)) throw new Error('documentTypeId must be a number');
      type = await this.repo.findTypeRowById(id);
    } else if (meta.documentTypeCode) {
      type = await this.repo.findTypeRowByCode(meta.documentTypeCode);
    } else {
      throw new Error('A documentTypeId or documentTypeCode is required');
    }
    if (!type) throw new Error('Document type not found');
    return type;
  }

  private initialStatus(type: any): DocumentStatus {
    if (type.requires_approval) return 'PENDING_REVIEW';
    if (type.requires_verification) return 'PENDING_VERIFICATION';
    return 'APPROVED';
  }

  private legacyDocTypeFor(type: any): LegacyDocType {
    return (type.legacy_doc_type as LegacyDocType) || 'OTHER';
  }

  private legacyCategoryFor(type: any, legacyDocType: LegacyDocType): LegacyCategory {
    return (
      LEGACY_CATEGORY_BY_DOC_TYPE[legacyDocType] ??
      LEGACY_CATEGORY_BY_CATEGORY[type.category as DocumentTypeCategory] ??
      'OTHER'
    );
  }

  private retentionUntil(type: any): string | null {
    const months = Number(type.retention_months ?? 0);
    if (!months || !Number.isFinite(months)) return null;
    return addMonths(todayString(), months);
  }

  private optionalDate(value: string | null | undefined, field: string): string | null {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const date = String(value).trim().slice(0, 10);
    if (!isValidDateString(date)) throw new Error(`${field} must be a YYYY-MM-DD date`);
    return date;
  }

  private context(req?: RequestLike | null): AuditContext {
    const userAgent = userAgentOf(req);
    const { device, browser } = detectDeviceAndBrowser(userAgent);
    return { ipAddress: clientIp(req), userAgent, device, browser };
  }

  private async audit(
    context: AuditContext,
    entry: {
      documentId?: number | null;
      employeeId?: number | null;
      action: DocumentAuditAction;
      actor: DocumentActor;
      detail?: string;
      previousValue?: string | null;
      newValue?: string | null;
    },
  ): Promise<void> {
    await this.repo.logAudit({
      documentId: entry.documentId ?? null,
      employeeId: entry.employeeId ?? null,
      actorUserId: entry.actor.userId,
      actorName: entry.actor.name,
      actorRole: entry.actor.role,
      action: entry.action,
      detail: entry.detail ?? null,
      previousValue: entry.previousValue ?? null,
      newValue: entry.newValue ?? null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      device: context.device,
      browser: context.browser,
    });
  }

  private async notifyStaffOfReview(
    documentId: number,
    employeeName: string,
    typeName: string,
    status: DocumentStatus,
  ): Promise<void> {
    await this.notifications
      .notifyRoles(['admin', 'hr'], {
        category: 'SYSTEM',
        priority: 'NORMAL',
        title: `Document awaiting ${status === 'PENDING_REVIEW' ? 'review' : 'verification'}`,
        body: `${typeName} for ${employeeName} is waiting for HR.`,
        linkPage: 'documents',
        linkRefId: documentId,
        email: true,
      })
      .catch(() => undefined);
  }

  /** Remove bytes handed to a driver for a document row that was never written. */
  private async discardStored(driverName: string, key: string | null): Promise<void> {
    if (!key) return;
    try {
      await getStorageDriver(driverName).remove(key);
    } catch {
      // Best effort only; a stray object must never mask the real error.
    }
  }

  /** Remove a multer temp file once the driver holds its own copy. */
  private discardFile(file?: Express.Multer.File): void {
    if (!file?.path) return;
    try {
      const base = path.resolve(env.uploadDir);
      const full = path.resolve(file.path);
      if (full.startsWith(base) && fs.existsSync(full)) fs.unlinkSync(full);
    } catch {
      // Best effort only; a stray temp file must never mask the real error.
    }
  }
}
