// Document management types. Mirrors the backend DMS schema.

export type DocumentCategoryCode =
  | 'GOVERNMENT_ID' | 'PERSONAL' | 'EDUCATION' | 'CERTIFICATION' | 'EMPLOYMENT'
  | 'EXPERIENCE' | 'PAYROLL_FINANCE' | 'MEDICAL' | 'IMMIGRATION' | 'COMPLIANCE'
  | 'SIGNATURE' | 'HR_FORM' | 'ASSET' | 'LEGAL' | 'EMPLOYEE_GENERATED' | 'OTHER';

export type DocumentStatus =
  | 'DRAFT' | 'UPLOADED' | 'PENDING_REVIEW' | 'PENDING_VERIFICATION' | 'APPROVED'
  | 'REJECTED' | 'EXPIRED' | 'RENEWED' | 'ARCHIVED' | 'DELETED';

export type OcrStatus = 'NOT_RUN' | 'PENDING' | 'DONE' | 'FAILED' | 'UNSUPPORTED';
export type VirusScanStatus = 'NOT_RUN' | 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED';

export type DocumentAuditAction =
  | 'UPLOAD' | 'REPLACE' | 'VIEW' | 'DOWNLOAD' | 'PRINT' | 'EDIT' | 'DELETE' | 'RESTORE'
  | 'SHARE' | 'SHARE_ACCESS' | 'VERIFY' | 'UNVERIFY' | 'REVIEW' | 'APPROVE' | 'REJECT'
  | 'ARCHIVE' | 'LOCK' | 'UNLOCK' | 'SIGN' | 'VERSION_RESTORE' | 'OCR' | 'SCAN' | 'EXPIRE';

export interface DocumentType {
  id: number;
  code: string;
  name: string;
  category: DocumentCategoryCode;
  description: string | null;
  country: string | null;
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

export interface DocumentRequirement {
  id: number;
  documentTypeId: number;
  typeCode?: string;
  typeName?: string;
  country: string | null;
  employmentType: string | null;
  workerType: string | null;
  grade: string | null;
  department: string | null;
  isMandatory: boolean;
  dueDaysAfterJoining: number | null;
  notes: string | null;
}

export interface DocumentRecord {
  id: number;
  employeeId: number;
  employeeName?: string;
  empCode?: string;
  documentTypeId: number | null;
  typeCode: string | null;
  typeName: string | null;
  docType: string;
  category: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  version: number;
  isCurrentVersion: boolean;
  rootDocumentId: number | null;
  fileHash: string | null;
  integrityCheckedAt: string | null;
  integrityOk: boolean | null;
  storageDriver: string;
  isEncrypted: boolean;
  ocrStatus: OcrStatus;
  virusScanStatus: VirusScanStatus;
  docNumber: string | null;
  issuingAuthority: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  tags: string[];
  notes: string | null;
  verified: boolean;
  verifiedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  isLocked: boolean;
  archivedAt: string | null;
  retentionUntil: string | null;
  uploadedAt: string;
  uploadedByName?: string | null;
}

export interface DocumentSearchResult {
  rows: DocumentRecord[];
  total: number;
}

export interface DocumentAuditEntry {
  id: number;
  documentId: number | null;
  employeeId: number | null;
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

export interface DocumentComment {
  id: number;
  documentId: number;
  authorName: string | null;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

export interface DocumentShare {
  id: number;
  documentId: number;
  recipientNote: string | null;
  expiresAt: string;
  maxDownloads: number | null;
  downloadCount: number;
  allowDownload: boolean;
  watermark: boolean;
  allowedIp: string | null;
  revokedAt: string | null;
  lastAccessedAt: string | null;
  createdAt: string;
  /** Returned only once, at creation. */
  token?: string;
  url?: string;
}

export interface MissingDocument {
  typeId: number;
  typeCode: string;
  typeName: string;
  category: DocumentCategoryCode;
  dueDate: string | null;
  overdue: boolean;
}

export interface ComplianceScore {
  employeeId: number;
  required: number;
  present: number;
  missing: number;
  expired: number;
  pct: number;
}

export interface DocumentDashboard {
  total: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  pendingVerification: number;
  pendingApproval: number;
  expiringSoon: number;
  expired: number;
  missingDocuments: number;
  recentUploads: DocumentRecord[];
  storage: { totalBytes: number; documentCount: number; byCategory: { category: string; bytes: number; count: number }[] };
  uploadTrend: { month: string; count: number }[];
  complianceScore: number;
}

export interface BulkResult {
  succeeded: number[];
  failed: { id: number; reason: string }[];
}

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategoryCode, string> = {
  GOVERNMENT_ID: 'Government identity',
  PERSONAL: 'Personal',
  EDUCATION: 'Education',
  CERTIFICATION: 'Certifications',
  EMPLOYMENT: 'Employment',
  EXPERIENCE: 'Experience',
  PAYROLL_FINANCE: 'Payroll & finance',
  MEDICAL: 'Medical',
  IMMIGRATION: 'Immigration',
  COMPLIANCE: 'Compliance',
  SIGNATURE: 'Signatures',
  HR_FORM: 'HR forms',
  ASSET: 'Asset',
  LEGAL: 'Legal',
  EMPLOYEE_GENERATED: 'Employee generated',
  OTHER: 'Other',
};

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

export const DOCUMENT_STATUS_META: Record<DocumentStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'default' },
  UPLOADED: { label: 'Uploaded', tone: 'info' },
  PENDING_REVIEW: { label: 'Pending review', tone: 'warning' },
  PENDING_VERIFICATION: { label: 'Pending verification', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'danger' },
  RENEWED: { label: 'Superseded', tone: 'default' },
  ARCHIVED: { label: 'Archived', tone: 'default' },
  DELETED: { label: 'Deleted', tone: 'danger' },
};
