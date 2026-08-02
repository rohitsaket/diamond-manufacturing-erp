import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldAlert, Upload } from 'lucide-react';
import { ModalShell } from '../../components/common/ModalShell';
import {
  Chip,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  BTN_PRIMARY,
  BTN_SECONDARY,
} from '../../components/common/HrmsUI';
import { useApp } from '../../contexts/AppContext';
import { documentApi } from '../../api/documents';
import { DOCUMENT_CATEGORY_LABELS } from '../../types/documents';
import type { DocumentCategoryCode, DocumentType } from '../../types/documents';
import { errMsg, formatBytes } from './documentUi';

const ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,.tiff,.heic,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.zip';

/**
 * The server's multer filter is narrower than the accept list above. Saying so
 * up front beats letting the user hit an opaque rejection after a long upload.
 */
const SERVER_FORMAT_NOTE =
  'The server currently accepts PDF, JPG, PNG and WebP. Other formats are listed here but will be rejected until the upload filter is widened.';

const CATEGORY_ORDER = Object.keys(DOCUMENT_CATEGORY_LABELS) as DocumentCategoryCode[];

interface DocumentUploadModalProps {
  employeeId?: number;
  types: DocumentType[];
  onClose: () => void;
  onUploaded: () => void;
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function Rule({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs text-text-secondary">
      {ok ? (
        <CheckCircle2 size={14} className="text-success flex-shrink-0 mt-0.5" />
      ) : (
        <Info size={14} className="text-text-muted flex-shrink-0 mt-0.5" />
      )}
      <span>{children}</span>
    </li>
  );
}

export function DocumentUploadModal({ employeeId, types, onClose, onUploaded }: DocumentUploadModalProps) {
  const { employees } = useApp();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [selectedEmployee, setSelectedEmployee] = useState<number | ''>(employeeId ?? '');
  const [typeId, setTypeId] = useState<number | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [issuingAuthority, setIssuingAuthority] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedType = useMemo(
    () => (typeId === '' ? null : (types.find((t) => t.id === typeId) ?? null)),
    [typeId, types],
  );

  /** Type picker is grouped by category so a 100-type list stays navigable. */
  const grouped = useMemo(() => {
    const byCategory = new Map<DocumentCategoryCode, DocumentType[]>();
    for (const t of types) {
      if (!t.isActive) continue;
      const key = t.category;
      const list = byCategory.get(key);
      if (list) list.push(t);
      else byCategory.set(key, [t]);
    }
    return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({
      category: c,
      label: DOCUMENT_CATEGORY_LABELS[c],
      items: (byCategory.get(c) ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    }));
  }, [types]);

  const maxBytes = selectedType ? selectedType.maxFileMb * 1024 * 1024 : null;
  const tooBig = !!(file && maxBytes && file.size > maxBytes);

  const workflowNote = (() => {
    if (!selectedType) return null;
    if (selectedType.requiresVerification && selectedType.requiresApproval)
      return 'After upload it enters verification, then approval before it counts as compliant.';
    if (selectedType.requiresVerification) return 'After upload it enters the verification queue.';
    if (selectedType.requiresApproval) return 'After upload it enters the approval queue.';
    return 'No verification or approval step — it is usable as soon as it is uploaded.';
  })();

  const onPickFile = (next: File | null) => {
    setFile(next);
    setError(null);
    if (next && title.trim() === '') setTitle(stripExtension(next.name));
  };

  const submit = async () => {
    setError(null);
    if (selectedEmployee === '') {
      setError('Choose the employee this document belongs to.');
      return;
    }
    if (typeId === '') {
      setError('Choose a document type — its rules decide the workflow and retention.');
      return;
    }
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    if (maxBytes && file.size > maxBytes) {
      setError(
        `${file.name} is ${formatBytes(file.size)} — larger than the ${selectedType?.maxFileMb} MB limit for ${
          selectedType?.name
        }. Compress it or pick a smaller file.`,
      );
      return;
    }
    if (selectedType?.requiresExpiry && expiresOn.trim() === '') {
      setError(`${selectedType.name} requires an expiry date.`);
      return;
    }
    if (issuedOn && expiresOn && expiresOn < issuedOn) {
      setError('The expiry date cannot be before the issue date.');
      return;
    }

    setSaving(true);
    try {
      await documentApi.upload(Number(selectedEmployee), file, {
        documentTypeId: typeId,
        title: title.trim() || file.name,
        docNumber: docNumber.trim() || undefined,
        issuingAuthority: issuingAuthority.trim() || undefined,
        issuedOn: issuedOn || undefined,
        expiresOn: expiresOn || undefined,
        tags: tags.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onUploaded();
      onClose();
    } catch (err) {
      // Duplicate-hash and mime rejections come back with a useful server
      // message — show it verbatim rather than a generic failure.
      setError(errMsg(err, 'The upload failed.'));
    } finally {
      setSaving(false);
    }
  };

  const employeeLabel = employees.find((e) => e.id === Number(selectedEmployee));

  return (
    <ModalShell
      title="Upload document"
      subtitle="Attach a file to an employee record and start its workflow"
      onClose={saving ? () => undefined : onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={BTN_PRIMARY} onClick={submit} disabled={saving || tooBig}>
            {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Uploading…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Upload size={14} /> Upload
              </span>
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBlock message={error} />}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLS}>Employee</label>
            {employeeId !== undefined ? (
              <div className="px-3 py-2 rounded-md bg-bg-secondary border border-border-default text-sm text-text-primary">
                {employeeLabel ? `${employeeLabel.fullName} · ${employeeLabel.empCode}` : `Employee #${employeeId}`}
              </div>
            ) : (
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value === '' ? '' : Number(e.target.value))}
                className={INPUT_CLS}
              >
                <option value="">Select an employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.fullName} · {emp.empCode}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className={LABEL_CLS}>Document type</label>
            <select
              value={typeId}
              onChange={(e) => setTypeId(e.target.value === '' ? '' : Number(e.target.value))}
              className={INPUT_CLS}
            >
              <option value="">Select a type…</option>
              {grouped.map((group) => (
                <optgroup key={group.category} label={group.label}>
                  {group.items.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        {selectedType && (
          <div className="rounded-md border border-border-default bg-bg-secondary p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-text-primary">{selectedType.name}</span>
              <span className="text-[10px] font-mono text-text-muted">{selectedType.code}</span>
              {selectedType.isConfidential && <Chip label="Confidential" tone="danger" dot />}
              {selectedType.isMandatory && <Chip label="Mandatory" tone="primary" />}
            </div>
            {selectedType.description && (
              <p className="text-xs text-text-secondary">{selectedType.description}</p>
            )}
            <ul className="space-y-1">
              <Rule ok={false}>Maximum file size {selectedType.maxFileMb} MB.</Rule>
              <Rule ok={!selectedType.requiresExpiry}>
                {selectedType.requiresExpiry
                  ? 'An expiry date is required for this type.'
                  : 'No expiry date needed (you can still set one).'}
              </Rule>
              <Rule ok={!selectedType.requiresVerification && !selectedType.requiresApproval}>{workflowNote}</Rule>
              <Rule ok={selectedType.allowsMultiple}>
                {selectedType.allowsMultiple
                  ? 'Multiple documents of this type are allowed.'
                  : 'Only one current document of this type is allowed — uploading again replaces it.'}
              </Rule>
              {selectedType.retentionMonths !== null && (
                <Rule ok={false}>Retained for {selectedType.retentionMonths} months after upload.</Rule>
              )}
              {selectedType.renewalReminderDays > 0 && selectedType.requiresExpiry && (
                <Rule ok={false}>Renewal reminders start {selectedType.renewalReminderDays} days before expiry.</Rule>
              )}
            </ul>
            {selectedType.isConfidential && (
              <p className="flex items-start gap-2 text-xs text-danger">
                <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
                Confidential — visible only to the employee and authorised HR staff.
              </p>
            )}
          </div>
        )}

        <div>
          <label className={LABEL_CLS}>File</label>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm text-text-secondary file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border file:border-border-default file:bg-bg-secondary file:text-text-secondary file:text-sm file:cursor-pointer hover:file:bg-bg-hover"
          />
          {file && (
            <p className={`text-xs mt-1.5 ${tooBig ? 'text-danger' : 'text-text-secondary'}`}>
              {file.name} · {formatBytes(file.size)}
              {tooBig && selectedType && ` — over the ${selectedType.maxFileMb} MB limit for ${selectedType.name}`}
            </p>
          )}
          <p className="flex items-start gap-1.5 text-[11px] text-text-muted mt-1.5">
            <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
            {SERVER_FORMAT_NOTE}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={LABEL_CLS}>Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Defaults to the file name"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Document number</label>
            <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Issuing authority</label>
            <input
              value={issuingAuthority}
              onChange={(e) => setIssuingAuthority(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Issued on</label>
            <input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>
              Expires on{selectedType?.requiresExpiry ? <span className="text-danger"> *</span> : null}
            </label>
            <input
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
              className={INPUT_CLS}
              required={selectedType?.requiresExpiry}
            />
            {selectedType?.requiresExpiry && expiresOn === '' && (
              <p className="text-[11px] text-warning mt-1">Required for {selectedType.name}.</p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL_CLS}>Tags (comma separated)</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="onboarding, verified-copy"
              className={INPUT_CLS}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL_CLS}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={`${INPUT_CLS} resize-y`}
            />
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
