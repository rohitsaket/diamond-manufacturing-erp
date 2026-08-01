import { EmployeeDocumentRepository } from '../repositories/EmployeeDocumentRepository';
import { EmployeeRepository } from '../repositories/EmployeeRepository';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { resolveStoredFile } from '../middleware/upload';
import { DocumentType, EmployeeDocumentResponse } from '../types/hrms';

const DOC_TYPES: DocumentType[] = [
  'AADHAAR',
  'PAN',
  'BANK_PASSBOOK',
  'PHOTO',
  'AGREEMENT',
  'CERTIFICATE',
  'OTHER',
];

export interface DocumentDownload {
  absolutePath: string;
  fileName: string;
  mimeType: string;
}

export class EmployeeDocumentService {
  private repo = new EmployeeDocumentRepository();
  private employeeRepo = new EmployeeRepository();
  private activityRepo = new ActivityRepository();

  async list(employeeId: number): Promise<EmployeeDocumentResponse[]> {
    return this.repo.findByEmployee(employeeId);
  }

  /**
   * Records an already-uploaded multer file against an employee. The file is
   * stored on disk by the upload middleware; only its metadata lives in MySQL.
   */
  async add(
    employeeId: number,
    file: Express.Multer.File,
    docType: string,
    title: string | undefined,
    userId: number,
  ): Promise<EmployeeDocumentResponse> {
    if (!file) throw new Error('A file is required');

    const employee = await this.employeeRepo.findRowById(employeeId);
    if (!employee) throw new Error('Employee not found');

    const type = String(docType ?? '').trim().toUpperCase() as DocumentType;
    if (!DOC_TYPES.includes(type)) {
      throw new Error(`Document type must be one of: ${DOC_TYPES.join(', ')}`);
    }

    const finalTitle = (title ?? '').trim() || file.originalname;

    const id = await this.repo.create(
      {
        employeeId,
        docType: type,
        title: finalTitle.slice(0, 255),
        fileName: file.originalname,
        filePath: file.filename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
      userId,
    );

    await this.activityRepo.log({
      actorUserId: userId,
      employeeId,
      entityType: 'employee_document',
      entityId: id,
      action: 'UPLOAD',
      summary: `Uploaded ${type} document "${finalTitle}" for ${employee.full_name}`,
    });

    const created = await this.repo.findById(id);
    if (!created) throw new Error('Document could not be saved');
    return created;
  }

  async verify(id: number, userId: number): Promise<EmployeeDocumentResponse> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error('Document not found');

    await this.repo.verify(id, userId);

    await this.activityRepo.log({
      actorUserId: userId,
      employeeId: existing.employeeId,
      entityType: 'employee_document',
      entityId: id,
      action: 'VERIFY',
      summary: `Verified document "${existing.title}"`,
    });

    const updated = await this.repo.findById(id);
    if (!updated) throw new Error('Document not found');
    return updated;
  }

  async remove(id: number): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error('Document not found');
    await this.repo.softDelete(id);
  }

  /** Resolves an on-disk path for streaming, guarded against traversal. */
  async getDownload(id: number): Promise<DocumentDownload> {
    const row = await this.repo.findFileById(id);
    if (!row) throw new Error('Document not found');

    const absolutePath = resolveStoredFile(row.file_path);
    if (!absolutePath) throw new Error('File is missing from storage');

    return {
      absolutePath,
      fileName: row.file_name,
      mimeType: row.mime_type,
    };
  }

  /** Pending-verification counter for the HR dashboard. */
  async countUnverified(): Promise<number> {
    return this.repo.countUnverified();
  }
}
