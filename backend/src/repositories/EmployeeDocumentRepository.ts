import { BaseRepository } from './BaseRepository';
import { DocumentType, EmployeeDocumentResponse } from '../types/hrms';

export interface CreateEmployeeDocumentInput {
  employeeId: number;
  docType: DocumentType;
  title: string;
  /** Original client file name, shown in the UI and used for downloads. */
  fileName: string;
  /** Name of the file as stored on disk inside the upload directory. */
  filePath: string;
  mimeType: string;
  sizeBytes: number;
}

/** Raw storage columns needed to stream a document back to the client. */
export interface EmployeeDocumentFileRow {
  id: number;
  employee_id: number;
  doc_type: DocumentType;
  title: string;
  file_name: string;
  file_path: string;
  mime_type: string;
  size_bytes: number;
}

export class EmployeeDocumentRepository extends BaseRepository {
  async findByEmployee(employeeId: number): Promise<EmployeeDocumentResponse[]> {
    const rows = await this.query<any[]>(
      `SELECT * FROM employee_documents
       WHERE employee_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [employeeId],
    );
    return rows.map((r) => this.toResponse(r));
  }

  async findById(id: number): Promise<EmployeeDocumentResponse | null> {
    const rows = await this.query<any[]>(
      'SELECT * FROM employee_documents WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] ? this.toResponse(rows[0]) : null;
  }

  /** Storage-level lookup used by the download endpoint. */
  async findFileById(id: number): Promise<EmployeeDocumentFileRow | null> {
    const rows = await this.query<EmployeeDocumentFileRow[]>(
      `SELECT id, employee_id, doc_type, title, file_name, file_path, mime_type, size_bytes
       FROM employee_documents
       WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] || null;
  }

  async create(data: CreateEmployeeDocumentInput, userId: number): Promise<number> {
    const result = await this.query<any>(
      `INSERT INTO employee_documents
         (employee_id, doc_type, title, file_name, file_path, mime_type, size_bytes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.employeeId,
        data.docType,
        data.title,
        data.fileName,
        data.filePath,
        data.mimeType,
        data.sizeBytes,
        userId,
      ],
    );
    return result.insertId;
  }

  async verify(id: number, userId: number): Promise<void> {
    await this.query(
      `UPDATE employee_documents
       SET verified = 1, verified_by = ?, verified_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [userId, id],
    );
  }

  async softDelete(id: number): Promise<void> {
    await this.query(
      'UPDATE employee_documents SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
  }

  /** Documents still awaiting HR verification (HR dashboard counter). */
  async countUnverified(): Promise<number> {
    const rows = await this.query<any[]>(
      'SELECT COUNT(*) AS cnt FROM employee_documents WHERE verified = 0 AND deleted_at IS NULL',
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  private toResponse(r: any): EmployeeDocumentResponse {
    return {
      id: r.id,
      employeeId: r.employee_id,
      docType: r.doc_type,
      title: r.title,
      fileName: r.file_name,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes ?? 0),
      verified: !!r.verified,
      verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null,
      uploadedAt: new Date(r.created_at).toISOString(),
    };
  }
}
