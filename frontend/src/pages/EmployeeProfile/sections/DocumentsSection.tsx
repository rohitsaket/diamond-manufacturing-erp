import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Upload, ExternalLink, Trash2, Check, Loader2 } from 'lucide-react';
import { profileCoreApi } from '../../../api/profile';
import type { EmployeeDocument } from '../../../types/hrms';
import { ModalShell } from '../../../components/common/ModalShell';
import {
  TableShell,
  Chip,
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  BTN_PRIMARY,
  BTN_SECONDARY,
} from '../../../components/common/HrmsUI';
import { formatDate, errorMessage } from '../ProfileField';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001/api';

/** Document types offered on upload, grouped under the category they belong to. */
const DOC_TYPES: { value: string; label: string; category: string }[] = [
  { value: 'AADHAAR', label: 'Aadhaar', category: 'IDENTITY' },
  { value: 'PAN', label: 'PAN card', category: 'IDENTITY' },
  { value: 'PASSPORT', label: 'Passport', category: 'IDENTITY' },
  { value: 'VISA', label: 'Visa', category: 'IDENTITY' },
  { value: 'DRIVING_LICENSE', label: 'Driving licence', category: 'IDENTITY' },
  { value: 'VOTER_ID', label: 'Voter ID', category: 'IDENTITY' },
  { value: 'PHOTO', label: 'Photograph', category: 'IDENTITY' },
  { value: 'ADDRESS_PROOF', label: 'Address proof', category: 'ADDRESS' },
  { value: 'EDUCATION', label: 'Education certificate', category: 'EDUCATION' },
  { value: 'EXPERIENCE', label: 'Experience letter', category: 'EXPERIENCE' },
  { value: 'BANK_PASSBOOK', label: 'Bank passbook', category: 'BANK' },
  { value: 'MEDICAL', label: 'Medical record', category: 'MEDICAL' },
  { value: 'AGREEMENT', label: 'Employment agreement', category: 'EMPLOYMENT' },
  { value: 'EMPLOYMENT', label: 'Employment document', category: 'EMPLOYMENT' },
  { value: 'CERTIFICATE', label: 'Certificate', category: 'EDUCATION' },
  { value: 'FAMILY', label: 'Family document', category: 'FAMILY' },
  { value: 'OTHER', label: 'Other', category: 'OTHER' },
];

const CATEGORY_LABELS: Record<string, string> = {
  IDENTITY: 'Identity documents',
  ADDRESS: 'Address proof',
  EDUCATION: 'Education documents',
  EXPERIENCE: 'Experience documents',
  BANK: 'Bank documents',
  MEDICAL: 'Medical documents',
  EMPLOYMENT: 'Employment documents',
  FAMILY: 'Family documents',
  OTHER: 'Other attachments',
};

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

function formatSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The server derives the category, but older rows may not carry one. */
function categoryOf(doc: EmployeeDocument): string {
  const explicit = (doc as EmployeeDocument & { category?: string }).category;
  if (explicit && CATEGORY_LABELS[explicit]) return explicit;
  return DOC_TYPES.find((t) => t.value === doc.docType)?.category ?? 'OTHER';
}

export function DocumentsSection({
  employeeId,
  onNavigate,
}: {
  employeeId: number;
  onNavigate?: (page: string) => void;
}) {
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    profileCoreApi
      .documents(employeeId)
      .then((rows) => {
        setDocs(rows ?? []);
        setError(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [employeeId]);

  useEffect(load, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, EmployeeDocument[]>();
    for (const doc of docs) {
      const key = categoryOf(doc);
      const list = map.get(key) ?? [];
      list.push(doc);
      map.set(key, list);
    }
    return map;
  }, [docs]);

  const verify = (docId: number) => {
    profileCoreApi
      .verifyDocument(docId)
      .then(load)
      .catch((err: unknown) => window.alert(errorMessage(err)));
  };

  const remove = (doc: EmployeeDocument) => {
    if (!window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    profileCoreApi
      .deleteDocument(doc.id)
      .then(load)
      .catch((err: unknown) => window.alert(errorMessage(err)));
  };

  if (loading && docs.length === 0) return <LoadingBlock label="Loading documents…" />;

  const unverified = docs.filter((d) => !d.verified).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Chip label={`${docs.length} document${docs.length === 1 ? '' : 's'}`} tone="default" />
          {unverified > 0 && <Chip label={`${unverified} awaiting verification`} tone="warning" dot />}
        </div>
        <button onClick={() => setShowUpload(true)} className={`${BTN_PRIMARY} inline-flex items-center gap-1.5`}>
          <Upload size={14} /> Upload document
        </button>
      </div>

      {error && <ErrorBlock message={error} />}

      {docs.length === 0 ? (
        <EmptyBlock message="No documents uploaded yet" hint="Upload identity, address, education and bank documents here." />
      ) : (
        CATEGORY_ORDER.filter((c) => grouped.has(c)).map((category) => {
          const rows = grouped.get(category)!;
          return (
            <div key={category} className="space-y-2">
              <div className="flex items-center gap-2">
                <h4 className="text-text-primary text-sm font-semibold">{CATEGORY_LABELS[category]}</h4>
                <span className="text-text-muted text-xs">({rows.length})</span>
              </div>
              <TableShell headers={['Title', 'Type', 'Size', 'Uploaded', 'Verified', '']}>
                {rows.map((doc) => (
                  <tr key={doc.id} className="hover:bg-bg-hover transition-colors">
                    <td className="px-3 py-2 text-text-primary text-xs font-medium">{doc.title}</td>
                    <td className="px-3 py-2 text-text-secondary text-xs">
                      {DOC_TYPES.find((t) => t.value === doc.docType)?.label ?? doc.docType}
                    </td>
                    <td className="px-3 py-2 text-text-secondary text-xs font-mono">{formatSize(doc.sizeBytes)}</td>
                    <td className="px-3 py-2 text-text-secondary text-xs">{formatDate(doc.uploadedAt) || '—'}</td>
                    <td className="px-3 py-2">
                      {doc.verified ? (
                        <Chip label="Verified" tone="success" />
                      ) : (
                        <button
                          onClick={() => verify(doc.id)}
                          className="px-2 py-1 rounded text-xs border border-success/30 text-success hover:bg-success-light transition-colors inline-flex items-center gap-1"
                        >
                          <Check size={12} /> Verify
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={`${API_BASE}${profileCoreApi.documentUrl(doc.id)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1 text-xs"
                        >
                          <ExternalLink size={12} /> View
                        </a>
                        <button
                          onClick={() => remove(doc)}
                          className="text-text-muted hover:text-danger transition-colors"
                          title="Delete document"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </TableShell>
            </div>
          );
        })
      )}

      <p className="text-text-muted text-[11px]">
        Documents open through an authenticated endpoint, so links only work while you are signed in.
        {onNavigate && (
          <>
            {' '}
            Certificates added from the{' '}
            <button onClick={() => onNavigate('hrprofile')} className="text-primary hover:underline">
              Certifications
            </button>{' '}
            section also appear here.
          </>
        )}
      </p>

      <AnimatePresence>
        {showUpload && (
          <UploadModal
            employeeId={employeeId}
            onClose={() => setShowUpload(false)}
            onUploaded={() => {
              setShowUpload(false);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function UploadModal({
  employeeId,
  onClose,
  onUploaded,
}: {
  employeeId: number;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState('AADHAAR');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!file) {
      setError('Choose a file to upload');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('The file must be 5 MB or smaller');
      return;
    }
    setSaving(true);
    setError(null);
    profileCoreApi
      .uploadDocument(employeeId, file, docType, title.trim() || undefined)
      .then(onUploaded)
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setSaving(false));
  };

  return (
    <ModalShell
      title="Upload document"
      subtitle="JPG, PNG, WebP or PDF up to 5 MB"
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={BTN_SECONDARY} disabled={saving}>
            Cancel
          </button>
          <button onClick={submit} className={`${BTN_PRIMARY} inline-flex items-center gap-1.5`} disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />} Upload
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={LABEL_CLS}>File</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Document type</label>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={INPUT_CLS}>
            {DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="text-text-muted text-[9px] mt-0.5">
            Filed under {CATEGORY_LABELS[DOC_TYPES.find((t) => t.value === docType)?.category ?? 'OTHER']}
          </p>
        </div>
        <div>
          <label className={LABEL_CLS}>Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={file?.name ?? 'Defaults to the file name'}
            className={INPUT_CLS}
          />
        </div>
        {error && <p className="text-danger text-xs">{error}</p>}
      </div>
    </ModalShell>
  );
}
