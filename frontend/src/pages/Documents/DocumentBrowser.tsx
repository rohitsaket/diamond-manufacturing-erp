import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Archive,
  BadgeCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Download,
  Eye,
  Loader2,
  Lock,
  MoreVertical,
  Plus,
  RefreshCw,
  RotateCcw,
  ThumbsUp,
  Trash2,
  XCircle,
} from 'lucide-react';
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
import { ModalShell } from '../../components/common/ModalShell';
import { documentApi, type DocumentSearchParams } from '../../api/documents';
import type { BulkResult, DocumentRecord, DocumentSearchResult, DocumentType } from '../../types/documents';
import { useAuth, isStaffRole } from '../../contexts/AuthContext';
import { DocumentFilters } from './DocumentFilters';
import { DocumentUploadModal } from './DocumentUploadModal';
import { DocumentDetailModal } from './DocumentDetailModal';
import {
  CategoryIcon,
  ExpiryChip,
  StatusChip,
  TagPills,
  downloadViaBlob,
  errMsg,
  formatBytes,
  formatDate,
  timeAgo,
} from './documentUi';

type SortKey = 'uploadedAt' | 'title' | 'expiresOn' | 'status';
type BulkAction = 'verify' | 'approve' | 'archive' | 'delete' | 'restore';

const PAGE_SIZES = [25, 50, 100];

const DEFAULT_PARAMS: DocumentSearchParams = {
  page: 1,
  limit: 25,
  sort: 'uploadedAt',
  order: 'desc',
  currentVersionsOnly: true,
};

const TH_CLS =
  'px-3 py-2 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap';

/**
 * `TableShell` takes plain string headers, so the results grid — which needs a
 * select-all checkbox and clickable sort headers — mirrors its markup here
 * rather than modifying the shared component.
 */
function SortHeader({
  label,
  sortKey,
  active,
  order,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: string | undefined;
  order: 'asc' | 'desc' | undefined;
  onSort: (key: SortKey) => void;
}) {
  const isActive = active === sortKey;
  return (
    <th className={TH_CLS}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors ${
          isActive ? 'text-primary' : 'hover:text-text-secondary'
        }`}
      >
        {label}
        {isActive ? (
          order === 'asc' ? (
            <ChevronUp size={12} />
          ) : (
            <ChevronDown size={12} />
          )
        ) : (
          <ChevronsUpDown size={12} className="opacity-50" />
        )}
      </button>
    </th>
  );
}

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  tone?: 'danger';
  run: () => void | Promise<void>;
}

export function DocumentBrowser() {
  const { user } = useAuth();
  const role = user?.role;
  const staff = isStaffRole(role);
  const canVerify = role === 'admin' || role === 'hr' || role === 'manager';
  const canApprove = role === 'admin' || role === 'hr';
  const canDestroy = role === 'admin' || role === 'hr';

  const [params, setParams] = useState<DocumentSearchParams>(DEFAULT_PARAMS);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [result, setResult] = useState<DocumentSearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<number[]>([]);
  const [bulkBusy, setBulkBusy] = useState<BulkAction | null>(null);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);
  const [bulkFailures, setBulkFailures] = useState<{ id: number; reason: string }[] | null>(null);

  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ id: number; items: MenuItem[]; x: number; y: number } | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [rejectFor, setRejectFor] = useState<DocumentRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);

  // Guards against a slow earlier request overwriting a newer result.
  const requestSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    documentApi
      .types({ activeOnly: true })
      .then((rows) => {
        if (alive) setTypes(rows);
      })
      .catch(() => {
        // Non-fatal: filters and upload just lose their type list.
        if (alive) setTypes([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async () => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setLoading(true);
    setError(null);
    try {
      const res = await documentApi.search(params);
      if (requestSeq.current === seq) setResult(res);
    } catch (err) {
      if (requestSeq.current === seq) {
        setError(errMsg(err, 'Could not load documents.'));
        setResult(null);
      }
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any change of filters, sort or page invalidates the current selection.
  useEffect(() => {
    setSelected([]);
    setBulkSummary(null);
    setMenu(null);
  }, [params]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const page = params.page ?? 1;
  const limit = params.limit ?? 25;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggleRow = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleAll = () => setSelected(allOnPageSelected ? [] : rows.map((r) => r.id));

  const onSort = (key: SortKey) => {
    setParams((prev) => ({
      ...prev,
      sort: key,
      order: prev.sort === key && prev.order === 'asc' ? 'desc' : prev.sort === key ? 'asc' : 'desc',
      page: 1,
    }));
  };

  const goPage = (next: number) =>
    setParams((prev) => ({ ...prev, page: Math.min(Math.max(1, next), pageCount) }));

  // -------------------------------------------------------------------------
  // Single-row actions
  // -------------------------------------------------------------------------

  const runRowAction = async (doc: DocumentRecord, what: string, fn: () => Promise<unknown>) => {
    setMenu(null);
    setRowBusy(doc.id);
    try {
      await fn();
      await load();
    } catch (err) {
      window.alert(errMsg(err, `Could not ${what} this document.`));
    } finally {
      setRowBusy(null);
    }
  };

  const download = async (doc: DocumentRecord) => {
    setMenu(null);
    setRowBusy(doc.id);
    try {
      await downloadViaBlob(documentApi.downloadUrl(doc.id), doc.fileName);
    } catch (err) {
      window.alert(errMsg(err, 'Could not download this document.'));
    } finally {
      setRowBusy(null);
    }
  };

  const menuItemsFor = (doc: DocumentRecord): MenuItem[] => {
    const items: MenuItem[] = [];
    const live = doc.status !== 'DELETED' && doc.status !== 'ARCHIVED';

    if (canVerify && live && !doc.verified) {
      items.push({
        label: 'Verify',
        icon: <BadgeCheck size={14} />,
        run: () => runRowAction(doc, 'verify', () => documentApi.verify(doc.id)),
      });
    }
    if (canApprove && live && doc.status !== 'APPROVED') {
      items.push({
        label: 'Approve',
        icon: <ThumbsUp size={14} />,
        run: () => runRowAction(doc, 'approve', () => documentApi.approve(doc.id)),
      });
    }
    if (canApprove && live && doc.status !== 'REJECTED') {
      items.push({
        label: 'Reject…',
        icon: <XCircle size={14} />,
        run: () => {
          setMenu(null);
          setRejectReason('');
          setRejectFor(doc);
        },
      });
    }
    if (staff && doc.status !== 'ARCHIVED' && doc.status !== 'DELETED') {
      items.push({
        label: 'Archive',
        icon: <Archive size={14} />,
        run: () => runRowAction(doc, 'archive', () => documentApi.archive(doc.id)),
      });
    }
    if (canDestroy && doc.status !== 'DELETED') {
      items.push({
        label: 'Delete',
        icon: <Trash2 size={14} />,
        tone: 'danger',
        run: () => {
          if (!window.confirm(`Delete "${doc.title}"? It can be restored from the deleted filter.`)) return;
          void runRowAction(doc, 'delete', () => documentApi.remove(doc.id));
        },
      });
    }
    if (canDestroy && doc.status === 'DELETED') {
      items.push({
        label: 'Restore',
        icon: <RotateCcw size={14} />,
        run: () => runRowAction(doc, 'restore', () => documentApi.restore(doc.id)),
      });
    }
    return items;
  };

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>, doc: DocumentRecord) => {
    const items = menuItemsFor(doc);
    if (items.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu((prev) =>
      prev?.id === doc.id
        ? null
        : { id: doc.id, items, x: Math.max(8, rect.right - 176), y: rect.bottom + 4 },
    );
  };

  const confirmReject = async () => {
    if (!rejectFor) return;
    if (rejectReason.trim() === '') {
      window.alert('A rejection reason is required — the employee sees it.');
      return;
    }
    setRejectBusy(true);
    try {
      await documentApi.reject(rejectFor.id, rejectReason.trim());
      setRejectFor(null);
      setRejectReason('');
      await load();
    } catch (err) {
      window.alert(errMsg(err, 'Could not reject this document.'));
    } finally {
      setRejectBusy(false);
    }
  };

  // -------------------------------------------------------------------------
  // Bulk actions
  // -------------------------------------------------------------------------

  const runBulk = async (action: BulkAction) => {
    if (selected.length === 0) return;
    if (action === 'delete' && !window.confirm(`Delete ${selected.length} document(s)?`)) return;
    setBulkBusy(action);
    setBulkSummary(null);
    setBulkFailures(null);
    try {
      const res: BulkResult = await documentApi.bulk(action, selected);
      const ok = res.succeeded?.length ?? 0;
      const failed = res.failed?.length ?? 0;
      // Never report a blanket success — partial failures are the normal case.
      setBulkSummary(`${ok} succeeded, ${failed} failed.`);
      if (failed > 0) setBulkFailures(res.failed);
      setSelected(failed > 0 ? res.failed.map((f) => f.id) : []);
      await load();
    } catch (err) {
      window.alert(errMsg(err, `The bulk ${action} failed.`));
    } finally {
      setBulkBusy(null);
    }
  };

  const bulkButton = (action: BulkAction, label: string, icon: React.ReactNode, allowed: boolean) =>
    allowed ? (
      <button
        key={action}
        type="button"
        onClick={() => void runBulk(action)}
        disabled={bulkBusy !== null}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border-default bg-bg-card text-text-secondary text-xs font-medium hover:bg-bg-hover transition-colors disabled:opacity-50"
      >
        {bulkBusy === action ? <Loader2 size={13} className="animate-spin" /> : icon}
        {label}
      </button>
    ) : null;

  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      <DocumentFilters value={params} onChange={setParams} types={types} />

      <div className="flex-1 min-w-0 w-full space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-text-secondary">
            {loading ? 'Searching…' : `${total.toLocaleString('en-IN')} document${total === 1 ? '' : 's'}`}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className={BTN_SECONDARY}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={() => setUploadOpen(true)}>
              <span className="flex items-center gap-1.5">
                <Plus size={14} /> Upload document
              </span>
            </button>
          </div>
        </div>

        {bulkSummary && (
          <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-bg-secondary border border-border-default text-sm text-text-secondary">
            <span>{bulkSummary}</span>
            {bulkFailures && bulkFailures.length > 0 && (
              <button
                type="button"
                onClick={() => setBulkFailures(bulkFailures)}
                className="text-danger text-xs font-medium hover:underline"
              >
                View {bulkFailures.length} failure{bulkFailures.length === 1 ? '' : 's'}
              </button>
            )}
          </div>
        )}

        {selected.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-md bg-bg-selected border border-primary/30">
            <span className="text-sm text-text-primary font-medium">{selected.length} selected</span>
            <span className="w-px h-4 bg-border-default" />
            {bulkButton('verify', 'Verify', <BadgeCheck size={13} />, canVerify)}
            {bulkButton('approve', 'Approve', <ThumbsUp size={13} />, canApprove)}
            {bulkButton('archive', 'Archive', <Archive size={13} />, staff)}
            {bulkButton('delete', 'Delete', <Trash2 size={13} />, canDestroy)}
            {bulkButton('restore', 'Restore', <RotateCcw size={13} />, canDestroy)}
            <button
              type="button"
              onClick={() => setSelected([])}
              className="ml-auto text-xs text-text-muted hover:text-text-primary"
            >
              Clear selection
            </button>
          </div>
        )}

        {error && <ErrorBlock message={error} />}

        {loading && !result ? (
          <LoadingBlock label="Loading documents…" />
        ) : rows.length === 0 && !error ? (
          <EmptyBlock message="No documents match these filters" />
        ) : (
          <div className="rounded-md border border-border-default overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-bg-secondary">
                  <tr>
                    <th className={`${TH_CLS} w-8`}>
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={allOnPageSelected}
                        onChange={toggleAll}
                        className="w-3.5 h-3.5 accent-primary cursor-pointer"
                      />
                    </th>
                    <SortHeader
                      label="Document"
                      sortKey="title"
                      active={params.sort}
                      order={params.order}
                      onSort={onSort}
                    />
                    <th className={TH_CLS}>Employee</th>
                    <th className={TH_CLS}>Type</th>
                    <SortHeader
                      label="Status"
                      sortKey="status"
                      active={params.sort}
                      order={params.order}
                      onSort={onSort}
                    />
                    <th className={TH_CLS}>Version</th>
                    <th className={TH_CLS}>Size</th>
                    <SortHeader
                      label="Uploaded"
                      sortKey="uploadedAt"
                      active={params.sort}
                      order={params.order}
                      onSort={onSort}
                    />
                    <SortHeader
                      label="Expires"
                      sortKey="expiresOn"
                      active={params.sort}
                      order={params.order}
                      onSort={onSort}
                    />
                    <th className={`${TH_CLS} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {rows.map((doc) => {
                    const busy = rowBusy === doc.id;
                    return (
                      <tr
                        key={doc.id}
                        className={`transition-colors ${
                          selectedSet.has(doc.id) ? 'bg-bg-selected' : 'hover:bg-bg-hover'
                        }`}
                      >
                        <td className="px-3 py-2 align-top">
                          <input
                            type="checkbox"
                            aria-label={`Select ${doc.title}`}
                            checked={selectedSet.has(doc.id)}
                            onChange={() => toggleRow(doc.id)}
                            className="w-3.5 h-3.5 accent-primary cursor-pointer mt-1"
                          />
                        </td>

                        <td className="px-3 py-2 align-top max-w-[280px]">
                          <div className="flex items-start gap-2">
                            <CategoryIcon category={doc.category} size={16} className="text-text-muted mt-0.5" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => setDetailId(doc.id)}
                                  className="text-sm font-semibold text-text-primary hover:text-primary transition-colors text-left truncate"
                                >
                                  {doc.title}
                                </button>
                                {doc.isLocked && <Lock size={12} className="text-warning flex-shrink-0" />}
                                {doc.version > 1 && <Chip label={`v${doc.version}`} tone="info" />}
                              </div>
                              <p className="text-text-muted text-[10px] font-mono truncate">{doc.fileName}</p>
                              <TagPills tags={doc.tags} />
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          <p className="text-sm text-text-primary">{doc.employeeName ?? '—'}</p>
                          <p className="text-text-muted text-[10px] font-mono">{doc.empCode ?? `#${doc.employeeId}`}</p>
                        </td>

                        <td className="px-3 py-2 align-top">
                          <p className="text-xs text-text-secondary whitespace-nowrap">
                            {doc.typeName ?? doc.docType ?? '—'}
                          </p>
                          {doc.typeCode && <p className="text-text-muted text-[10px] font-mono">{doc.typeCode}</p>}
                        </td>

                        <td className="px-3 py-2 align-top">
                          <StatusChip status={doc.status} />
                        </td>

                        <td className="px-3 py-2 align-top text-xs text-text-secondary tabular-nums whitespace-nowrap">
                          v{doc.version}
                          {!doc.isCurrentVersion && <span className="text-text-muted"> (old)</span>}
                        </td>

                        <td className="px-3 py-2 align-top text-xs text-text-secondary tabular-nums whitespace-nowrap">
                          {formatBytes(doc.sizeBytes)}
                        </td>

                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          <p className="text-xs text-text-secondary">{formatDate(doc.uploadedAt)}</p>
                          <p className="text-text-muted text-[10px]">{timeAgo(doc.uploadedAt)}</p>
                        </td>

                        <td className="px-3 py-2 align-top">
                          {doc.expiresOn ? (
                            <ExpiryChip expiresOn={doc.expiresOn} />
                          ) : (
                            <span className="text-text-muted text-xs">—</span>
                          )}
                        </td>

                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              title="Preview"
                              onClick={() => setDetailId(doc.id)}
                              className="p-1.5 rounded-md text-text-muted hover:text-primary hover:bg-bg-hover transition-colors"
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              type="button"
                              title="Download"
                              onClick={() => void download(doc)}
                              disabled={busy}
                              className="p-1.5 rounded-md text-text-muted hover:text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
                            >
                              {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                            </button>
                            <button
                              type="button"
                              title="More actions"
                              onClick={(e) => openMenu(e, doc)}
                              className="p-1.5 rounded-md text-text-muted hover:text-primary hover:bg-bg-hover transition-colors"
                            >
                              <MoreVertical size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 bg-bg-secondary border-t border-border-default">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span>
                  Showing {from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')} of{' '}
                  {total.toLocaleString('en-IN')}
                </span>
                <select
                  value={limit}
                  onChange={(e) => setParams((prev) => ({ ...prev, limit: Number(e.target.value), page: 1 }))}
                  className="bg-bg-card border border-border-default rounded px-1.5 py-0.5 text-xs text-text-secondary"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n} / page
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => goPage(page - 1)}
                  disabled={page <= 1 || loading}
                  className="p-1 rounded-md border border-border-default text-text-secondary disabled:opacity-40 hover:bg-bg-hover transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-text-secondary px-2 tabular-nums">
                  Page {page} of {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => goPage(page + 1)}
                  disabled={page >= pageCount || loading}
                  className="p-1 rounded-md border border-border-default text-text-secondary disabled:opacity-40 hover:bg-bg-hover transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Row kebab: fixed-position so the table's horizontal scroll can't clip it. */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            className="fixed z-50 w-44 py-1 rounded-md border border-border-default bg-bg-card shadow-modal"
            style={{ left: menu.x, top: menu.y }}
          >
            {menu.items.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => void item.run()}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-bg-hover transition-colors ${
                  item.tone === 'danger' ? 'text-danger' : 'text-text-secondary'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}

      <AnimatePresence>
        {uploadOpen && (
          <DocumentUploadModal
            types={types}
            onClose={() => setUploadOpen(false)}
            onUploaded={() => void load()}
          />
        )}

        {detailId !== null && (
          <DocumentDetailModal
            documentId={detailId}
            onClose={() => setDetailId(null)}
            onChanged={() => void load()}
          />
        )}

        {rejectFor && (
          <ModalShell
            title="Reject document"
            subtitle={rejectFor.title}
            onClose={() => setRejectFor(null)}
            maxWidth="max-w-md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setRejectFor(null)} disabled={rejectBusy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={() => void confirmReject()}
                  disabled={rejectBusy || rejectReason.trim() === ''}
                >
                  {rejectBusy ? 'Rejecting…' : 'Reject'}
                </button>
              </div>
            }
          >
            <label className={LABEL_CLS}>Reason (required)</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Tell the employee what is wrong so they can re-upload correctly."
              className={`${INPUT_CLS} resize-y`}
            />
          </ModalShell>
        )}

        {bulkFailures && bulkFailures.length > 0 && (
          <ModalShell
            title="Some documents could not be processed"
            subtitle={`${bulkFailures.length} failure${bulkFailures.length === 1 ? '' : 's'}`}
            onClose={() => setBulkFailures(null)}
            maxWidth="max-w-lg"
          >
            <TableShell headers={['Document ID', 'Reason']}>
              {bulkFailures.map((f) => (
                <tr key={f.id}>
                  <td className="px-3 py-2 text-xs font-mono text-text-secondary align-top">{f.id}</td>
                  <td className="px-3 py-2 text-xs text-text-primary">{f.reason}</td>
                </tr>
              ))}
            </TableShell>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
