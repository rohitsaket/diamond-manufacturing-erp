import { useCallback, useEffect, useRef, useState } from 'react';
import { Award, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { profileApi, profileCoreApi } from '../../../api/profile';
import type { Certification, CertificationType } from '../../../types/profile';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
  TableShell,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';

const TYPES: CertificationType[] = ['PROFESSIONAL', 'TECHNICAL', 'LICENSE', 'OTHER'];
const TYPE_LABEL: Record<CertificationType, string> = {
  PROFESSIONAL: 'Professional',
  TECHNICAL: 'Technical',
  LICENSE: 'Licence',
  OTHER: 'Other',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function toInputDate(v: string | null | undefined): string {
  return v ? String(v).slice(0, 10) : '';
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}

interface CertDraft {
  name: string;
  certType: CertificationType;
  issuingAuthority: string;
  credentialId: string;
  issuedOn: string;
  validUntil: string;
  renewalDate: string;
  notes: string;
}

const EMPTY_DRAFT: CertDraft = {
  name: '',
  certType: 'PROFESSIONAL',
  issuingAuthority: '',
  credentialId: '',
  issuedOn: '',
  validUntil: '',
  renewalDate: '',
  notes: '',
};

function toDraft(row: Certification): CertDraft {
  return {
    name: row.name,
    certType: row.certType,
    issuingAuthority: row.issuingAuthority ?? '',
    credentialId: row.credentialId ?? '',
    issuedOn: toInputDate(row.issuedOn),
    validUntil: toInputDate(row.validUntil),
    renewalDate: toInputDate(row.renewalDate),
    notes: row.notes ?? '',
  };
}

export function CertificationsSection({ employeeId }: { employeeId: number }) {
  const [rows, setRows] = useState<Certification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<CertDraft>(EMPTY_DRAFT);
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    profileApi
      .certifications(employeeId)
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch((e: unknown) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setFile(null);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (row: Certification) => {
    setEditingId(row.id);
    setDraft(toDraft(row));
    setFile(null);
    setFormError(null);
    setModalOpen(true);
  };

  const handleDelete = (row: Certification) => {
    if (!window.confirm(`Delete the certification "${row.name}"?`)) return;
    profileApi
      .deleteCertification(row.id)
      .then(() => load())
      .catch((e: unknown) => window.alert(errMsg(e)));
  };

  const handleSave = () => {
    if (draft.name.trim() === '') {
      setFormError('Certification name is required.');
      return;
    }
    if (draft.issuedOn && draft.validUntil && draft.validUntil <= draft.issuedOn) {
      setFormError('"Valid until" must be after the issue date.');
      return;
    }

    const body: Partial<Certification> = {
      name: draft.name.trim(),
      certType: draft.certType,
      issuingAuthority: draft.issuingAuthority.trim() || null,
      credentialId: draft.credentialId.trim() || null,
      issuedOn: draft.issuedOn || null,
      validUntil: draft.validUntil || null,
      renewalDate: draft.renewalDate || null,
      notes: draft.notes.trim() || null,
    };

    setSaving(true);
    const req = editingId === null
      ? profileApi.addCertification(employeeId, body)
      : profileApi.updateCertification(editingId, body);

    req
      .then(() => {
        if (!file) return null;
        return profileCoreApi.uploadDocument(employeeId, file, 'CERTIFICATE', draft.name.trim());
      })
      .then(() => {
        setModalOpen(false);
        setFile(null);
        load();
      })
      .catch((e: unknown) => window.alert(errMsg(e)))
      .finally(() => setSaving(false));
  };

  const statusChip = (row: Certification) => {
    if (row.isExpired) return <Chip tone="danger" label="Expired" />;
    if (row.expiringSoon) return <Chip tone="warning" label="Expiring soon" />;
    return <Chip tone="success" label="Valid" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-text-primary font-semibold text-sm">Certifications</h3>
          <p className="text-text-muted text-xs mt-0.5">Professional credentials, licences and renewals</p>
        </div>
        <button onClick={openAdd} className={BTN_PRIMARY}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} /> Add certification
          </span>
        </button>
      </div>

      {error && <ErrorBlock message={error} />}
      {loading && <LoadingBlock />}

      {!loading && !error && rows.length === 0 && (
        <EmptyBlock message="No certifications recorded" hint="Add a credential to track its validity and renewal." />
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((row) => (
              <div key={row.id} className="bg-bg-card border border-border-default rounded-md p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="w-8 h-8 rounded-md bg-info-light text-info flex items-center justify-center flex-shrink-0">
                      <Award size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-text-primary text-sm font-medium truncate">{row.name}</p>
                      <p className="text-text-secondary text-xs mt-0.5 truncate">{row.issuingAuthority || '—'}</p>
                      {row.credentialId && (
                        <p className="text-text-muted text-xs mt-1 font-mono truncate">{row.credentialId}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEdit(row)}
                      aria-label="Edit"
                      className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(row)}
                      aria-label="Delete"
                      className="p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-danger-light transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-3">
                  <Chip label={TYPE_LABEL[row.certType]} tone="primary" />
                  {statusChip(row)}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                  <div>
                    <p className="text-text-muted text-[10px] uppercase tracking-wider">Issued</p>
                    <p className="text-text-secondary mt-0.5">{fmtDate(row.issuedOn)}</p>
                  </div>
                  <div>
                    <p className="text-text-muted text-[10px] uppercase tracking-wider">Valid until</p>
                    <p className="text-text-secondary mt-0.5">{fmtDate(row.validUntil)}</p>
                  </div>
                  <div>
                    <p className="text-text-muted text-[10px] uppercase tracking-wider">Renewal</p>
                    <p className="text-text-secondary mt-0.5">{fmtDate(row.renewalDate)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <TableShell
            headers={['Name', 'Type', 'Authority', 'Credential ID', 'Issued', 'Valid until', 'Renewal', 'Status']}
          >
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-bg-hover transition-colors">
                <td className="px-3 py-2 text-xs text-text-primary">{row.name}</td>
                <td className="px-3 py-2 text-xs text-text-secondary">{TYPE_LABEL[row.certType]}</td>
                <td className="px-3 py-2 text-xs text-text-secondary">{row.issuingAuthority || '—'}</td>
                <td className="px-3 py-2 text-xs text-text-secondary font-mono">{row.credentialId || '—'}</td>
                <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{fmtDate(row.issuedOn)}</td>
                <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{fmtDate(row.validUntil)}</td>
                <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{fmtDate(row.renewalDate)}</td>
                <td className="px-3 py-2">{statusChip(row)}</td>
              </tr>
            ))}
          </TableShell>
        </>
      )}

      {modalOpen && (
        <ModalShell
          title={editingId === null ? 'Add certification' : 'Edit certification'}
          subtitle="Credential details"
          onClose={() => setModalOpen(false)}
          maxWidth="max-w-2xl"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button className={BTN_SECONDARY} onClick={() => setModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className={BTN_PRIMARY} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            {formError && <ErrorBlock message={formError} />}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL_CLS}>Name</label>
                <input
                  className={INPUT_CLS}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Type</label>
                <select
                  className={INPUT_CLS}
                  value={draft.certType}
                  onChange={(e) => setDraft({ ...draft, certType: e.target.value as CertificationType })}
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Issuing authority</label>
                <input
                  className={INPUT_CLS}
                  value={draft.issuingAuthority}
                  onChange={(e) => setDraft({ ...draft, issuingAuthority: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Credential ID</label>
                <input
                  className={INPUT_CLS}
                  value={draft.credentialId}
                  onChange={(e) => setDraft({ ...draft, credentialId: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Issued on</label>
                <input
                  type="date"
                  className={INPUT_CLS}
                  value={draft.issuedOn}
                  onChange={(e) => setDraft({ ...draft, issuedOn: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Valid until</label>
                <input
                  type="date"
                  className={INPUT_CLS}
                  value={draft.validUntil}
                  onChange={(e) => setDraft({ ...draft, validUntil: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Renewal date</label>
                <input
                  type="date"
                  className={INPUT_CLS}
                  value={draft.renewalDate}
                  onChange={(e) => setDraft({ ...draft, renewalDate: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>Notes</label>
              <textarea
                className={`${INPUT_CLS} min-h-20`}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>

            <div className="rounded-md border border-border-light bg-bg-secondary p-3">
              <p className={LABEL_CLS}>Certificate file (optional)</p>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <button type="button" className={BTN_SECONDARY} onClick={() => fileRef.current?.click()}>
                  <span className="inline-flex items-center gap-1.5">
                    <Upload size={14} /> Choose file
                  </span>
                </button>
                <span className="text-text-secondary text-xs truncate">{file ? file.name : 'No file selected'}</span>
              </div>
              <p className="text-text-muted text-[11px] mt-2">
                Uploaded certificates appear under the Documents section of this profile.
              </p>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
