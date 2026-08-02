import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  BadgeCheck,
  Ban,
  Copy,
  Download,
  FileQuestion,
  Fingerprint,
  Loader2,
  Lock,
  Printer,
  RotateCcw,
  Send,
  Share2,
  ThumbsUp,
  Trash2,
  Unlock,
  Upload,
  XCircle,
} from 'lucide-react';
import { ModalShell } from '../../components/common/ModalShell';
import { TabBar, type TabItem } from '../../components/common/TabBar';
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
} from '../../components/common/HrmsUI';
import { documentApi } from '../../api/documents';
import { DOCUMENT_CATEGORY_LABELS } from '../../types/documents';
import type {
  DocumentAuditEntry,
  DocumentCategoryCode,
  DocumentComment,
  DocumentRecord,
  DocumentShare,
} from '../../types/documents';
import { useAuth, isStaffRole } from '../../contexts/AuthContext';
import {
  CategoryIcon,
  ExpiryChip,
  StatusChip,
  TagPills,
  downloadViaBlob,
  errMsg,
  fetchBlobUrl,
  formatBytes,
  formatDate,
  formatDateTime,
  previewKind,
  timeAgo,
} from './documentUi';

type DetailTab = 'preview' | 'details' | 'versions' | 'audit' | 'comments' | 'sharing';

const TABS: TabItem[] = [
  { id: 'preview', label: 'Preview' },
  { id: 'details', label: 'Details' },
  { id: 'versions', label: 'Versions' },
  { id: 'audit', label: 'Audit' },
  { id: 'comments', label: 'Comments' },
  { id: 'sharing', label: 'Sharing' },
];

const OCR_TONE: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  NOT_RUN: 'default',
  PENDING: 'warning',
  DONE: 'success',
  FAILED: 'danger',
  UNSUPPORTED: 'default',
  CLEAN: 'success',
  INFECTED: 'danger',
};

const PIPELINE_NOTE = 'This pipeline is not configured in this deployment, so the status stays as-is.';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={LABEL_CLS}>{label}</p>
      <div className="text-sm text-text-primary break-words">{children ?? '—'}</div>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  busy,
  tone = 'secondary',
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  tone?: 'secondary' | 'danger' | 'primary';
  disabled?: boolean;
}) {
  const cls =
    tone === 'primary'
      ? 'border-primary/30 bg-primary-light text-primary'
      : tone === 'danger'
        ? 'border-danger/30 text-danger hover:bg-danger-light'
        : 'border-border-default text-text-secondary hover:bg-bg-hover';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${cls}`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

export function DocumentDetailModal({
  documentId,
  onClose,
  onChanged,
}: {
  documentId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const role = user?.role;
  const staff = isStaffRole(role);
  const canVerify = role === 'admin' || role === 'hr' || role === 'manager';
  const canApprove = role === 'admin' || role === 'hr';
  const canDestroy = role === 'admin' || role === 'hr';

  const [tab, setTab] = useState<DetailTab>('preview');
  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [versions, setVersions] = useState<DocumentRecord[]>([]);
  const [audit, setAudit] = useState<DocumentAuditEntry[]>([]);
  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [shares, setShares] = useState<DocumentShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const replaceRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [record, vers, entries, notes, links] = await Promise.all([
      documentApi.get(documentId).catch((err: unknown) => {
        setError(errMsg(err, 'Could not load this document.'));
        return null;
      }),
      documentApi.versions(documentId).catch(() => [] as DocumentRecord[]),
      documentApi.audit(documentId).catch(() => [] as DocumentAuditEntry[]),
      documentApi.comments(documentId).catch(() => [] as DocumentComment[]),
      documentApi.shares(documentId).catch(() => [] as DocumentShare[]),
    ]);
    setDoc(record);
    setVersions(vers);
    setAudit(entries);
    setComments(notes);
    setShares(links);
    setLoading(false);
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---------------------------------------------------------------------------
  // Preview — authenticated blob, revoked whenever the tab or document changes.
  // ---------------------------------------------------------------------------
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const kind = previewKind(doc?.mimeType);
  const docKey = doc ? `${doc.id}:${doc.version}` : null;

  useEffect(() => {
    if (tab !== 'preview' || !docKey || kind === 'other') return;
    const id = Number(docKey.split(':')[0]);
    let cancelled = false;
    let created: string | null = null;
    setPreviewLoading(true);
    setPreviewError(null);
    fetchBlobUrl(documentApi.downloadUrl(id))
      .then((url) => {
        created = url;
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setPreviewUrl(url);
      })
      .catch((err: unknown) => {
        if (!cancelled) setPreviewError(errMsg(err, 'Could not load the preview.'));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
      setPreviewUrl(null);
      if (created) URL.revokeObjectURL(created);
    };
  }, [tab, docKey, kind]);

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const run = async (key: string, what: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      onChanged();
      await load();
    } catch (err) {
      window.alert(errMsg(err, `Could not ${what}.`));
    } finally {
      setBusy(null);
    }
  };

  const doReject = async () => {
    if (rejectReason.trim() === '') {
      window.alert('A rejection reason is required — the employee sees it.');
      return;
    }
    await run('reject', 'reject this document', () => documentApi.reject(documentId, rejectReason.trim()));
    setRejecting(false);
    setRejectReason('');
  };

  const doDownload = async () => {
    if (!doc) return;
    setBusy('download');
    try {
      await downloadViaBlob(documentApi.downloadUrl(doc.id), doc.fileName);
    } catch (err) {
      window.alert(errMsg(err, 'Could not download this document.'));
    } finally {
      setBusy(null);
    }
  };

  const doPrint = async () => {
    if (!doc) return;
    setBusy('print');
    let url: string | null = null;
    try {
      url = await fetchBlobUrl(documentApi.printUrl(doc.id));
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      window.alert(errMsg(err, 'Could not open the print view.'));
    } finally {
      // The new tab has already loaded the blob by the time this fires.
      if (url) window.setTimeout((u: string) => URL.revokeObjectURL(u), 30_000, url);
      setBusy(null);
    }
  };

  const onReplaceFile = async (file: File | null) => {
    if (!file || !doc) return;
    await run('replace', 'replace the file', () => documentApi.replace(doc.id, file, {}));
    if (replaceRef.current) replaceRef.current.value = '';
  };

  // ---------------------------------------------------------------------------
  // Integrity
  // ---------------------------------------------------------------------------
  const [integrity, setIntegrity] = useState<{ ok: boolean; checkedAt: string } | null>(null);

  const checkIntegrity = async () => {
    setBusy('integrity');
    try {
      const res = await documentApi.checkIntegrity(documentId);
      setIntegrity({ ok: res.ok, checkedAt: res.checkedAt });
      await load();
    } catch (err) {
      window.alert(errMsg(err, 'The integrity check could not be run.'));
    } finally {
      setBusy(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------
  const [commentBody, setCommentBody] = useState('');
  const [commentInternal, setCommentInternal] = useState(false);

  const addComment = async () => {
    if (commentBody.trim() === '') return;
    setBusy('comment');
    try {
      await documentApi.addComment(documentId, commentBody.trim(), commentInternal);
      setCommentBody('');
      setCommentInternal(false);
      setComments(await documentApi.comments(documentId).catch(() => comments));
    } catch (err) {
      window.alert(errMsg(err, 'Could not post the comment.'));
    } finally {
      setBusy(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Sharing
  // ---------------------------------------------------------------------------
  const [shareHours, setShareHours] = useState(24);
  const [shareMax, setShareMax] = useState<string>('');
  const [shareAllowDownload, setShareAllowDownload] = useState(true);
  const [shareWatermark, setShareWatermark] = useState(false);
  const [shareIp, setShareIp] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [newShareUrl, setNewShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createShare = async () => {
    setBusy('share');
    try {
      const created = await documentApi.createShare(documentId, {
        expiresInHours: shareHours,
        maxDownloads: shareMax.trim() === '' ? null : Number(shareMax),
        allowDownload: shareAllowDownload,
        watermark: shareWatermark,
        allowedIp: shareIp.trim() === '' ? null : shareIp.trim(),
        note: shareNote.trim() || undefined,
      });
      const url = created.url ?? (created.token ? documentApi.sharedUrl(created.token) : null);
      setNewShareUrl(url);
      if (!url) window.alert('The link was created but the server did not return a URL for it.');
      setShareNote('');
      setShareIp('');
      setShareMax('');
      setShares(await documentApi.shares(documentId).catch(() => shares));
    } catch (err) {
      window.alert(errMsg(err, 'Could not create the share link.'));
    } finally {
      setBusy(null);
    }
  };

  const copyShare = async () => {
    if (!newShareUrl) return;
    try {
      await navigator.clipboard.writeText(newShareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert('Copy failed — select the text and copy it manually.');
    }
  };

  const revokeShare = async (shareId: number) => {
    setBusy(`revoke-${shareId}`);
    try {
      await documentApi.revokeShare(shareId);
      setShares(await documentApi.shares(documentId).catch(() => shares));
    } catch (err) {
      window.alert(errMsg(err, 'Could not revoke the link.'));
    } finally {
      setBusy(null);
    }
  };

  // ---------------------------------------------------------------------------

  const sortedAudit = useMemo(
    () => audit.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id)),
    [audit],
  );

  const sortedVersions = useMemo(() => versions.slice().sort((a, b) => b.version - a.version), [versions]);

  const live = !!doc && doc.status !== 'DELETED' && doc.status !== 'ARCHIVED';
  const categoryLabel = doc ? (DOCUMENT_CATEGORY_LABELS[doc.category as DocumentCategoryCode] ?? doc.category) : '';

  const footer = doc ? (
    <div className="space-y-2">
      {rejecting && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className={LABEL_CLS}>Rejection reason (required)</label>
            <input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="What is wrong with this document?"
              className={INPUT_CLS}
              autoFocus
            />
          </div>
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={() => void doReject()}
            disabled={busy === 'reject' || rejectReason.trim() === ''}
          >
            Confirm
          </button>
          <button type="button" className={BTN_SECONDARY} onClick={() => setRejecting(false)}>
            Cancel
          </button>
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <ActionButton label="Download" icon={<Download size={13} />} onClick={() => void doDownload()} busy={busy === 'download'} />
        <ActionButton label="Print" icon={<Printer size={13} />} onClick={() => void doPrint()} busy={busy === 'print'} />

        {live && (doc.status === 'DRAFT' || doc.status === 'UPLOADED') && (
          <ActionButton
            label="Submit for review"
            icon={<Send size={13} />}
            tone="primary"
            onClick={() => void run('review', 'submit this document for review', () => documentApi.review(doc.id))}
            busy={busy === 'review'}
          />
        )}
        {live && staff && doc.status === 'PENDING_REVIEW' && (
          <ActionButton
            label="Mark reviewed"
            icon={<Send size={13} />}
            onClick={() => void run('review', 'mark this document reviewed', () => documentApi.review(doc.id))}
            busy={busy === 'review'}
          />
        )}
        {live && canVerify && !doc.verified && (
          <ActionButton
            label="Verify"
            icon={<BadgeCheck size={13} />}
            onClick={() => void run('verify', 'verify this document', () => documentApi.verify(doc.id))}
            busy={busy === 'verify'}
          />
        )}
        {live && canApprove && doc.status !== 'APPROVED' && (
          <ActionButton
            label="Approve"
            icon={<ThumbsUp size={13} />}
            onClick={() => void run('approve', 'approve this document', () => documentApi.approve(doc.id))}
            busy={busy === 'approve'}
          />
        )}
        {live && canApprove && doc.status !== 'REJECTED' && (
          <ActionButton label="Reject" icon={<XCircle size={13} />} tone="danger" onClick={() => setRejecting(true)} />
        )}
        {staff && doc.status !== 'ARCHIVED' && doc.status !== 'DELETED' && (
          <ActionButton
            label="Archive"
            icon={<Archive size={13} />}
            onClick={() => void run('archive', 'archive this document', () => documentApi.archive(doc.id))}
            busy={busy === 'archive'}
          />
        )}
        {staff &&
          (doc.isLocked ? (
            <ActionButton
              label="Unlock"
              icon={<Unlock size={13} />}
              onClick={() => void run('unlock', 'unlock this document', () => documentApi.unlock(doc.id))}
              busy={busy === 'unlock'}
            />
          ) : (
            <ActionButton
              label="Lock"
              icon={<Lock size={13} />}
              onClick={() => void run('lock', 'lock this document', () => documentApi.lock(doc.id))}
              busy={busy === 'lock'}
            />
          ))}
        {canDestroy && doc.status !== 'DELETED' && (
          <ActionButton
            label="Delete"
            icon={<Trash2 size={13} />}
            tone="danger"
            onClick={() => {
              if (!window.confirm(`Delete "${doc.title}"?`)) return;
              void run('delete', 'delete this document', () => documentApi.remove(doc.id));
            }}
            busy={busy === 'delete'}
          />
        )}
        {canDestroy && doc.status === 'DELETED' && (
          <ActionButton
            label="Restore"
            icon={<RotateCcw size={13} />}
            onClick={() => void run('restore', 'restore this document', () => documentApi.restore(doc.id))}
            busy={busy === 'restore'}
          />
        )}
      </div>
    </div>
  ) : null;

  return (
    <ModalShell
      title={doc?.title ?? 'Document'}
      subtitle={doc ? `${doc.employeeName ?? `Employee #${doc.employeeId}`} · ${doc.fileName}` : null}
      onClose={onClose}
      maxWidth="max-w-4xl"
      footer={footer}
    >
      {loading ? (
        <LoadingBlock label="Loading document…" />
      ) : error || !doc ? (
        <ErrorBlock message={error ?? 'This document could not be loaded.'} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <CategoryIcon category={doc.category} size={18} className="text-text-secondary" />
            <StatusChip status={doc.status} />
            <span className="text-sm text-text-secondary">{doc.typeName ?? doc.docType}</span>
            <Chip label={`v${doc.version}`} tone={doc.isCurrentVersion ? 'info' : 'default'} />
            {doc.isLocked ? (
              <Chip label="Locked" tone="warning" dot />
            ) : (
              <Chip label="Unlocked" tone="default" />
            )}
            {doc.isEncrypted && <Chip label="Encrypted" tone="primary" />}
            <ExpiryChip expiresOn={doc.expiresOn} />
          </div>

          <TabBar tabs={TABS} active={tab} onChange={(id) => setTab(id as DetailTab)} />

          {/* ---------------------------------------------------------------- */}
          {tab === 'preview' && (
            <div>
              {kind === 'other' ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 border border-border-default rounded-md bg-bg-secondary">
                  <FileQuestion size={28} className="text-text-muted" />
                  <div className="text-center">
                    <p className="text-sm text-text-secondary">
                      {doc.mimeType || 'This file type'} cannot be previewed in the browser.
                    </p>
                    <p className="text-text-muted text-xs mt-0.5">
                      {doc.fileName} · {formatBytes(doc.sizeBytes)}
                    </p>
                  </div>
                  <button type="button" className={BTN_PRIMARY} onClick={() => void doDownload()} disabled={busy === 'download'}>
                    <span className="flex items-center gap-1.5">
                      <Download size={14} /> Download
                    </span>
                  </button>
                </div>
              ) : previewLoading ? (
                <LoadingBlock label="Fetching the file…" />
              ) : previewError ? (
                <ErrorBlock message={previewError} />
              ) : previewUrl && kind === 'image' ? (
                <div className="flex justify-center bg-bg-secondary border border-border-default rounded-md p-3">
                  <img src={previewUrl} alt={doc.title} className="max-h-[60vh] max-w-full object-contain rounded" />
                </div>
              ) : previewUrl ? (
                <iframe title={doc.title} src={previewUrl} className="w-full h-[60vh] rounded-md border border-border-default" />
              ) : (
                <EmptyBlock message="Nothing to preview" />
              )}
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {tab === 'details' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="Document type">{doc.typeName ?? doc.docType}</Field>
                <Field label="Category">{categoryLabel}</Field>
                <Field label="Document number">{doc.docNumber || '—'}</Field>
                <Field label="Issuing authority">{doc.issuingAuthority || '—'}</Field>
                <Field label="Issued on">{formatDate(doc.issuedOn)}</Field>
                <Field label="Expires on">{doc.expiresOn ? formatDate(doc.expiresOn) : '—'}</Field>
                <Field label="Size">{formatBytes(doc.sizeBytes)}</Field>
                <Field label="MIME type">
                  <span className="font-mono text-xs">{doc.mimeType || '—'}</span>
                </Field>
                <Field label="Uploaded by">{doc.uploadedByName || '—'}</Field>
                <Field label="Uploaded at">
                  {formatDateTime(doc.uploadedAt)}
                  <span className="text-text-muted text-xs"> · {timeAgo(doc.uploadedAt)}</span>
                </Field>
                <Field label="Storage driver">
                  <span className="font-mono text-xs">{doc.storageDriver}</span>
                </Field>
                <Field label="Retention until">{doc.retentionUntil ? formatDate(doc.retentionUntil) : '—'}</Field>
                <Field label="Verified">
                  {doc.verified ? `Yes · ${formatDateTime(doc.verifiedAt)}` : 'No'}
                </Field>
                <Field label="Approved">{doc.approvedAt ? formatDateTime(doc.approvedAt) : '—'}</Field>
                <Field label="Archived">{doc.archivedAt ? formatDateTime(doc.archivedAt) : '—'}</Field>
              </div>

              <div>
                <p className={LABEL_CLS}>Tags</p>
                {doc.tags && doc.tags.length > 0 ? (
                  <TagPills tags={doc.tags} max={20} />
                ) : (
                  <p className="text-sm text-text-muted">—</p>
                )}
              </div>

              <div>
                <p className={LABEL_CLS}>Notes</p>
                <p className="text-sm text-text-primary whitespace-pre-wrap">{doc.notes || '—'}</p>
              </div>

              {doc.rejectedReason && (
                <div className="px-3 py-2 rounded-md bg-danger-light border border-danger/30">
                  <p className={LABEL_CLS}>Rejection reason</p>
                  <p className="text-sm text-danger">{doc.rejectedReason}</p>
                </div>
              )}

              <div className="rounded-md border border-border-default p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Fingerprint size={16} className="text-text-muted" />
                  <span className="text-sm font-medium text-text-primary">Integrity</span>
                  <span className="font-mono text-[11px] text-text-muted break-all">
                    {doc.fileHash ? `sha256:${doc.fileHash.slice(0, 16)}…` : 'no hash recorded'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void checkIntegrity()}
                    disabled={busy === 'integrity' || !doc.fileHash}
                    className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border-default text-text-secondary text-xs font-medium hover:bg-bg-hover transition-colors disabled:opacity-50"
                  >
                    {busy === 'integrity' && <Loader2 size={13} className="animate-spin" />}
                    Check integrity
                  </button>
                </div>
                {(() => {
                  const ok = integrity?.ok ?? doc.integrityOk;
                  const at = integrity?.checkedAt ?? doc.integrityCheckedAt;
                  if (ok === null || ok === undefined) {
                    return <p className="text-xs text-text-muted">Not checked yet.</p>;
                  }
                  return (
                    <p className={`text-xs ${ok ? 'text-success' : 'text-danger'}`}>
                      {ok
                        ? `Passed — the stored file still matches its recorded hash. Checked ${formatDateTime(at)}.`
                        : `FAILED — the stored file no longer matches its recorded hash. Checked ${formatDateTime(at)}.`}
                    </p>
                  );
                })()}
              </div>

              <div className="rounded-md border border-border-default p-3 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-text-muted uppercase tracking-wider">OCR</span>
                  <Chip label={doc.ocrStatus.replace('_', ' ')} tone={OCR_TONE[doc.ocrStatus] ?? 'default'} />
                  <span className="text-xs text-text-muted uppercase tracking-wider ml-3">Virus scan</span>
                  <Chip
                    label={doc.virusScanStatus.replace('_', ' ')}
                    tone={OCR_TONE[doc.virusScanStatus] ?? 'default'}
                  />
                </div>
                {(doc.ocrStatus === 'NOT_RUN' ||
                  doc.ocrStatus === 'UNSUPPORTED' ||
                  doc.virusScanStatus === 'NOT_RUN') && (
                  <p className="text-[11px] text-text-muted">{PIPELINE_NOTE}</p>
                )}
              </div>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {tab === 'versions' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-text-secondary">
                  {sortedVersions.length} version{sortedVersions.length === 1 ? '' : 's'}
                </p>
                <div>
                  <input
                    ref={replaceRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => void onReplaceFile(e.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    onClick={() => replaceRef.current?.click()}
                    disabled={busy === 'replace' || doc.isLocked}
                    title={doc.isLocked ? 'Unlock the document before replacing it' : undefined}
                  >
                    <span className="flex items-center gap-1.5">
                      {busy === 'replace' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      Replace with a new version
                    </span>
                  </button>
                </div>
              </div>

              {sortedVersions.length === 0 ? (
                <EmptyBlock message="No version history recorded" />
              ) : (
                <TableShell headers={['Version', 'Status', 'Size', 'Uploaded', 'Uploaded by', '']}>
                  {sortedVersions.map((v) => (
                    <tr key={v.id} className={v.isCurrentVersion ? 'bg-bg-selected' : ''}>
                      <td className="px-3 py-2 text-sm text-text-primary whitespace-nowrap">
                        v{v.version}
                        {v.isCurrentVersion && <span className="ml-1.5 text-primary text-[10px] font-medium">CURRENT</span>}
                      </td>
                      <td className="px-3 py-2">
                        <StatusChip status={v.status} />
                      </td>
                      <td className="px-3 py-2 text-xs text-text-secondary tabular-nums">{formatBytes(v.sizeBytes)}</td>
                      <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                        {formatDateTime(v.uploadedAt)}
                      </td>
                      <td className="px-3 py-2 text-xs text-text-secondary">{v.uploadedByName || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        {!v.isCurrentVersion && staff && (
                          <button
                            type="button"
                            onClick={() =>
                              void run('restore-version', 'make this version current', () =>
                                documentApi.restoreVersion(v.id),
                              )
                            }
                            disabled={busy === 'restore-version'}
                            className="text-xs text-primary font-medium hover:underline disabled:opacity-50"
                          >
                            Make current
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </TableShell>
              )}
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {tab === 'audit' &&
            (sortedAudit.length === 0 ? (
              <EmptyBlock message="No audit entries yet" />
            ) : (
              <TableShell headers={['Action', 'Actor', 'Detail', 'IP', 'Device', 'When']}>
                {sortedAudit.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-3 py-2 align-top">
                      <Chip label={entry.action.replace(/_/g, ' ')} tone="default" />
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      <p className="text-xs text-text-primary">{entry.actorName || 'System'}</p>
                      <p className="text-[10px] text-text-muted">{entry.actorRole || '—'}</p>
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-text-secondary max-w-[260px] break-words">
                      {entry.detail || '—'}
                    </td>
                    <td className="px-3 py-2 align-top text-[10px] font-mono text-text-muted whitespace-nowrap">
                      {entry.ipAddress || '—'}
                    </td>
                    <td className="px-3 py-2 align-top text-[11px] text-text-muted max-w-[160px] truncate">
                      {[entry.device, entry.browser].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      <p className="text-xs text-text-secondary">{formatDateTime(entry.createdAt)}</p>
                      <p className="text-[10px] text-text-muted">{timeAgo(entry.createdAt)}</p>
                    </td>
                  </tr>
                ))}
              </TableShell>
            ))}

          {/* ---------------------------------------------------------------- */}
          {tab === 'comments' && (
            <div className="space-y-3">
              {comments.length === 0 ? (
                <EmptyBlock message="No comments yet" />
              ) : (
                <ul className="space-y-2">
                  {comments.map((c) => (
                    <li
                      key={c.id}
                      className={`rounded-md border p-3 ${
                        c.isInternal ? 'border-warning/30 bg-warning-light' : 'border-border-default bg-bg-secondary'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-text-primary">{c.authorName || 'Unknown'}</span>
                        {c.isInternal && <Chip label="Internal" tone="warning" />}
                        <span className="text-[10px] text-text-muted ml-auto">{formatDateTime(c.createdAt)}</span>
                      </div>
                      <p className="text-sm text-text-secondary whitespace-pre-wrap">{c.body}</p>
                    </li>
                  ))}
                </ul>
              )}

              <div className="space-y-2">
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  rows={3}
                  placeholder="Add a comment…"
                  className={`${INPUT_CLS} resize-y`}
                />
                <div className="flex items-center gap-3">
                  {staff && (
                    <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={commentInternal}
                        onChange={(e) => setCommentInternal(e.target.checked)}
                        className="w-3.5 h-3.5 accent-primary cursor-pointer"
                      />
                      Internal note (hidden from the employee)
                    </label>
                  )}
                  <button
                    type="button"
                    className={`${BTN_PRIMARY} ml-auto`}
                    onClick={() => void addComment()}
                    disabled={busy === 'comment' || commentBody.trim() === ''}
                  >
                    {busy === 'comment' ? 'Posting…' : 'Post comment'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {tab === 'sharing' && (
            <div className="space-y-4">
              <div className="rounded-md border border-border-default p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Share2 size={16} className="text-text-muted" />
                  <span className="text-sm font-medium text-text-primary">Create a share link</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={LABEL_CLS}>Expires in (hours)</label>
                    <input
                      type="number"
                      min={1}
                      value={shareHours}
                      onChange={(e) => setShareHours(Math.max(1, Number(e.target.value) || 1))}
                      className={INPUT_CLS}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Max downloads</label>
                    <input
                      type="number"
                      min={1}
                      value={shareMax}
                      onChange={(e) => setShareMax(e.target.value)}
                      placeholder="Unlimited"
                      className={INPUT_CLS}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Restrict to IP</label>
                    <input
                      value={shareIp}
                      onChange={(e) => setShareIp(e.target.value)}
                      placeholder="Any IP"
                      className={INPUT_CLS}
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <label className={LABEL_CLS}>Note</label>
                    <input
                      value={shareNote}
                      onChange={(e) => setShareNote(e.target.value)}
                      placeholder="Who is this for?"
                      className={INPUT_CLS}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={shareAllowDownload}
                      onChange={(e) => setShareAllowDownload(e.target.checked)}
                      className="w-3.5 h-3.5 accent-primary cursor-pointer"
                    />
                    Allow download
                  </label>
                  <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={shareWatermark}
                      onChange={(e) => setShareWatermark(e.target.checked)}
                      className="w-3.5 h-3.5 accent-primary cursor-pointer"
                    />
                    Watermark
                  </label>
                  <button
                    type="button"
                    className={`${BTN_PRIMARY} ml-auto`}
                    onClick={() => void createShare()}
                    disabled={busy === 'share'}
                  >
                    {busy === 'share' ? 'Creating…' : 'Create link'}
                  </button>
                </div>

                {newShareUrl && (
                  <div className="rounded-md border border-warning/30 bg-warning-light p-3 space-y-2">
                    <p className="text-xs text-warning font-medium">
                      Copy this link now — it is shown once and cannot be retrieved again.
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={newShareUrl}
                        onFocus={(e) => e.currentTarget.select()}
                        className={`${INPUT_CLS} font-mono text-xs`}
                      />
                      <button
                        type="button"
                        onClick={() => void copyShare()}
                        className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md border border-border-default text-text-secondary text-xs font-medium hover:bg-bg-hover transition-colors whitespace-nowrap"
                      >
                        <Copy size={13} /> {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {shares.length === 0 ? (
                <EmptyBlock message="No share links have been created" />
              ) : (
                <TableShell headers={['Created', 'Expires', 'Downloads', 'Last accessed', 'Flags', 'State', '']}>
                  {shares.map((s) => {
                    const revoked = !!s.revokedAt;
                    const expired = new Date(s.expiresAt).getTime() < Date.now();
                    return (
                      <tr key={s.id}>
                        <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                          {formatDateTime(s.createdAt)}
                          {s.recipientNote && <p className="text-[10px] text-text-muted">{s.recipientNote}</p>}
                        </td>
                        <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                          {formatDateTime(s.expiresAt)}
                        </td>
                        <td className="px-3 py-2 text-xs text-text-secondary tabular-nums whitespace-nowrap">
                          {s.downloadCount}
                          {s.maxDownloads !== null ? ` / ${s.maxDownloads}` : ' / ∞'}
                        </td>
                        <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                          {s.lastAccessedAt ? formatDateTime(s.lastAccessedAt) : 'Never'}
                        </td>
                        <td className="px-3 py-2 text-[10px] text-text-muted whitespace-nowrap">
                          {[
                            s.allowDownload ? 'download' : 'view only',
                            s.watermark ? 'watermark' : null,
                            s.allowedIp ? `ip ${s.allowedIp}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </td>
                        <td className="px-3 py-2">
                          {revoked ? (
                            <Chip label="Revoked" tone="danger" />
                          ) : expired ? (
                            <Chip label="Expired" tone="default" />
                          ) : (
                            <Chip label="Active" tone="success" dot />
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {!revoked && (
                            <button
                              type="button"
                              onClick={() => void revokeShare(s.id)}
                              disabled={busy === `revoke-${s.id}`}
                              className="inline-flex items-center gap-1 text-xs text-danger font-medium hover:underline disabled:opacity-50"
                            >
                              <Ban size={12} /> Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </TableShell>
              )}
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}
