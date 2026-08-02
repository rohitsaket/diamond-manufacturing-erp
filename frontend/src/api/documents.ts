// Typed helpers for the document management endpoints.
import { api, BASE_URL } from './client';
import type {
  DocumentType,
  DocumentRequirement,
  DocumentRecord,
  DocumentSearchResult,
  DocumentAuditEntry,
  DocumentComment,
  DocumentShare,
  MissingDocument,
  ComplianceScore,
  DocumentDashboard,
  BulkResult,
} from '../types/documents';

const qs = (params: Record<string, unknown>): string => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length > 0) search.append(k, v.join(','));
    } else {
      search.append(k, String(v));
    }
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

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
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface UploadMeta {
  documentTypeId?: number;
  typeCode?: string;
  title?: string;
  docNumber?: string;
  issuingAuthority?: string;
  issuedOn?: string;
  expiresOn?: string;
  tags?: string;
  notes?: string;
}

const metaFields = (meta: UploadMeta): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  }
  return out;
};

export const documentApi = {
  // Taxonomy -----------------------------------------------------------------
  types: (filters: { category?: string; country?: string; activeOnly?: boolean } = {}) =>
    api.get<DocumentType[]>(`/documents/types${qs(filters)}`),
  createType: (body: Partial<DocumentType>) => api.post<DocumentType>('/documents/types', body),
  updateType: (typeId: number, body: Partial<DocumentType>) =>
    api.put<DocumentType>(`/documents/types/${typeId}`, body),
  deleteType: (typeId: number) => api.delete<{ success: boolean }>(`/documents/types/${typeId}`),

  requirements: (filters: Record<string, unknown> = {}) =>
    api.get<DocumentRequirement[]>(`/documents/requirements${qs(filters)}`),
  createRequirement: (body: Partial<DocumentRequirement>) =>
    api.post<DocumentRequirement>('/documents/requirements', body),
  deleteRequirement: (reqId: number) => api.delete<{ success: boolean }>(`/documents/requirements/${reqId}`),

  // Search and read ----------------------------------------------------------
  search: (params: DocumentSearchParams = {}) =>
    api.get<DocumentSearchResult>(`/documents/search${qs(params as Record<string, unknown>)}`),
  forEmployee: (employeeId: number, params: Record<string, unknown> = {}) =>
    api.get<DocumentRecord[]>(`/documents/employee/${employeeId}${qs(params)}`),
  get: (id: number) => api.get<DocumentRecord>(`/documents/${id}`),
  versions: (id: number) => api.get<DocumentRecord[]>(`/documents/${id}/versions`),
  /** Paginated: the endpoint returns `{rows, total}`, not a bare array. */
  audit: (id: number, params: { limit?: number; offset?: number } = {}) =>
    api.get<{ rows: DocumentAuditEntry[]; total: number }>(`/documents/${id}/audit${qs(params)}`),
  comments: (id: number) => api.get<DocumentComment[]>(`/documents/${id}/comments`),
  addComment: (id: number, body: string, isInternal = false) =>
    api.post<DocumentComment>(`/documents/${id}/comments`, { body, isInternal }),

  // Upload / replace ---------------------------------------------------------
  upload: (employeeId: number, file: File, meta: UploadMeta) =>
    api.upload<DocumentRecord>(`/documents/employee/${employeeId}`, file, metaFields(meta)),
  replace: (id: number, file: File, meta: UploadMeta = {}) =>
    api.upload<DocumentRecord>(`/documents/${id}/replace`, file, metaFields(meta)),
  updateMeta: (id: number, body: Record<string, unknown>) => api.put<DocumentRecord>(`/documents/${id}`, body),

  // Workflow -----------------------------------------------------------------
  review: (id: number) => api.put<DocumentRecord>(`/documents/${id}/review`, {}),
  verify: (id: number) => api.put<DocumentRecord>(`/documents/${id}/verify`, {}),
  approve: (id: number) => api.put<DocumentRecord>(`/documents/${id}/approve`, {}),
  reject: (id: number, reason: string) => api.put<DocumentRecord>(`/documents/${id}/reject`, { reason }),
  archive: (id: number) => api.put<DocumentRecord>(`/documents/${id}/archive`, {}),
  lock: (id: number) => api.put<DocumentRecord>(`/documents/${id}/lock`, {}),
  unlock: (id: number) => api.put<DocumentRecord>(`/documents/${id}/unlock`, {}),
  restoreVersion: (id: number) => api.put<DocumentRecord>(`/documents/${id}/restore-version`, {}),
  remove: (id: number) => api.delete<{ success: boolean }>(`/documents/${id}`),
  restore: (id: number) => api.put<DocumentRecord>(`/documents/${id}/restore`, {}),
  checkIntegrity: (id: number) =>
    api.post<{ ok: boolean; expected: string; actual: string; checkedAt: string }>(`/documents/${id}/integrity`),

  // Sharing ------------------------------------------------------------------
  createShare: (
    id: number,
    body: {
      expiresInHours: number;
      maxDownloads?: number | null;
      allowDownload?: boolean;
      watermark?: boolean;
      allowedIp?: string | null;
      note?: string;
    },
  ) => api.post<DocumentShare>(`/documents/${id}/share`, body),
  shares: (id: number) => api.get<DocumentShare[]>(`/documents/${id}/shares`),
  revokeShare: (shareId: number) => api.delete<{ success: boolean }>(`/documents/shares/${shareId}`),

  // Compliance and reporting -------------------------------------------------
  dashboard: () => api.get<DocumentDashboard>('/documents/dashboard'),
  compliance: (filters: { department?: string; branch?: string; page?: number; limit?: number } = {}) =>
    api.get<{ rows: (ComplianceScore & { employeeName: string; empCode: string })[]; total: number }>(
      `/documents/compliance${qs(filters)}`,
    ),
  complianceFor: (employeeId: number) => api.get<ComplianceScore>(`/documents/compliance/${employeeId}`),
  missingFor: (employeeId: number) => api.get<MissingDocument[]>(`/documents/missing/${employeeId}`),
  storageDrivers: () => api.get<{ name: string; available: boolean; reason?: string }[]>('/documents/storage-drivers'),

  bulk: (action: 'verify' | 'approve' | 'archive' | 'delete' | 'restore', ids: number[]) =>
    api.post<BulkResult>(`/documents/bulk/${action}`, { ids }),

  // Direct URLs (opened in a new tab, so they carry the session cookie-less
  // bearer only when fetched — use downloadUrl for links the user clicks).
  downloadUrl: (id: number) => `${BASE_URL}/documents/${id}/download`,
  printUrl: (id: number) => `${BASE_URL}/documents/${id}/print`,
  reportUrl: (report: string, params: Record<string, unknown> = {}) =>
    `${BASE_URL}/documents/reports/${report}${qs({ ...params, format: 'csv' })}`,
  sharedUrl: (token: string) => `${BASE_URL}/documents/shared/${token}`,

  report: (report: string, params: Record<string, unknown> = {}) =>
    api.get<ReportResponse>(`/documents/reports/${report}${qs(params)}`),
};

/** Report slugs the backend serves. Keep in step with DocumentAdminService. */
export const REPORT_SLUGS = {
  missingDocuments: 'missing-documents',
  expiring: 'expiring',
  verificationStatus: 'verification-status',
  uploadHistory: 'upload-history',
  downloadHistory: 'download-history',
  auditHistory: 'audit-history',
  storageUsage: 'storage-usage',
  completeness: 'completeness',
} as const;

export interface ReportResponse {
  report: string;
  generatedAt: string;
  headers: string[];
  rows: Record<string, unknown>[];
  total: number;
}
