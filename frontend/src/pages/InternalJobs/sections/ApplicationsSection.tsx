import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  LayoutGrid,
  List,
  RefreshCw,
  Upload,
  XCircle,
} from 'lucide-react';
import { internalJobsApi } from '../../../api/internalJobs';
import { openAuthenticatedFile } from '../../../api/payroll';
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

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const ALL_STATUSES = [
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'ASSESSMENT', 'INTERVIEW',
  'SELECTED', 'OFFERED', 'HIRED', 'REJECTED', 'WITHDRAWN',
] as const;

/** Pipeline columns for the kanban view (terminal states excluded). */
const PIPELINE = [
  'SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'ASSESSMENT', 'INTERVIEW', 'SELECTED', 'OFFERED', 'HIRED',
] as const;

/**
 * Client-side mirror of the backend's forward transition map, intersected with
 * the staff-settable targets. Anything else 400s server-side and the message
 * is shown verbatim.
 */
const STAFF_TARGETS = new Set([
  'UNDER_REVIEW', 'SHORTLISTED', 'ASSESSMENT', 'INTERVIEW', 'SELECTED', 'OFFERED', 'HIRED', 'REJECTED',
]);
const FLOW: Record<string, string[]> = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['UNDER_REVIEW', 'REJECTED', 'WITHDRAWN'],
  UNDER_REVIEW: ['SHORTLISTED', 'REJECTED', 'WITHDRAWN'],
  SHORTLISTED: ['ASSESSMENT', 'INTERVIEW', 'REJECTED', 'WITHDRAWN'],
  ASSESSMENT: ['INTERVIEW', 'SELECTED', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW: ['SELECTED', 'REJECTED', 'WITHDRAWN'],
  SELECTED: ['OFFERED', 'REJECTED', 'WITHDRAWN'],
  OFFERED: ['HIRED', 'REJECTED', 'WITHDRAWN'],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? '—' : s;
}

function fmtDateTime(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

function statusTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'HIRED':
    case 'SELECTED':
      return 'success';
    case 'OFFERED':
    case 'SHORTLISTED':
      return 'primary';
    case 'UNDER_REVIEW':
      return 'warning';
    case 'ASSESSMENT':
    case 'INTERVIEW':
    case 'SUBMITTED':
      return 'info';
    case 'REJECTED':
      return 'danger';
    default:
      return 'default';
  }
}

/** Eligibility badge: pass, fail, override or not-yet-evaluated. */
function eligibility(app: any): { label: string; tone: Tone } {
  if (app?.eligibilityOverride) return { label: 'Override', tone: 'warning' };
  if (app?.eligibilityPassed === null || app?.eligibilityPassed === undefined)
    return { label: 'Not evaluated', tone: 'default' };
  return app.eligibilityPassed
    ? { label: 'Eligible', tone: 'success' }
    : { label: 'Not eligible', tone: 'danger' };
}

// ---------------------------------------------------------------------------

export function ApplicationsSection() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [jobId, setJobId] = useState<string>('');
  const [status, setStatus] = useState<string>('ALL');
  const [view, setView] = useState<'kanban' | 'list'>('kanban');

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detail modal.
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [nextStatus, setNextStatus] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    internalJobsApi.jobs().then((j) => setJobs(Array.isArray(j) ? j : [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    internalJobsApi
      .applications({
        jobId: jobId === '' ? undefined : Number(jobId),
        status: status === 'ALL' ? undefined : status,
      })
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [jobId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const loadDetail = useCallback((id: number) => {
    setDetailLoading(true);
    setDetailError(null);
    internalJobsApi
      .application(id)
      .then((d) => {
        setDetail(d ?? null);
        setNextStatus('');
        setStatusNote('');
      })
      .catch((err) => setDetailError(reason(err)))
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    if (detailId === null) {
      setDetail(null);
      return;
    }
    loadDetail(detailId);
  }, [detailId, loadDetail]);

  // Any 400 (illegal transition) or 403 surfaces verbatim in the modal.
  const act = (fn: () => Promise<any>) => {
    setActing(true);
    setDetailError(null);
    fn()
      .then(() => {
        if (detailId !== null) loadDetail(detailId);
        load();
      })
      .catch((err) => setDetailError(reason(err)))
      .finally(() => setActing(false));
  };

  const uploadDocument = (file: File) => {
    if (detailId === null) return;
    setUploading(true);
    setDetailError(null);
    internalJobsApi
      .uploadApplicationDocument(detailId, file)
      .then(() => loadDetail(detailId))
      .catch((err) => setDetailError(reason(err)))
      .finally(() => setUploading(false));
  };

  const byColumn = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const col of PIPELINE) map[col] = [];
    for (const r of rows) {
      const s = String(r?.status ?? '');
      if (map[s]) map[s].push(r);
    }
    return map;
  }, [rows]);

  const offPipeline = useMemo(
    () => rows.filter((r) => !PIPELINE.includes(String(r?.status ?? '') as any)),
    [rows],
  );

  if (firstLoad && loading) return <LoadingBlock label="Loading applications…" />;

  const detailChecks: any[] = Array.isArray(detail?.eligibilityResult) ? detail.eligibilityResult : [];
  const detailTimeline: any[] = Array.isArray(detail?.timeline) ? detail.timeline : [];
  const detailDocs: any[] = Array.isArray(detail?.documents) ? detail.documents : [];
  const detailStatus = String(detail?.status ?? '');
  const legalTargets = (FLOW[detailStatus] ?? []).filter((s) => STAFF_TARGETS.has(s));
  const elig = detail ? eligibility(detail) : null;

  return (
    <div className="space-y-4">
      {/* Controls -------------------------------------------------------------- */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="w-72">
            <label className={LABEL_CLS} htmlFor="apps-job">
              Job
            </label>
            <select
              id="apps-job"
              className={INPUT_CLS}
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
            >
              <option value="">All jobs</option>
              {jobs.map((j: any) => (
                <option key={j.id} value={j.id}>
                  {j.jobCode} · {j.title}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
            <span className="inline-flex items-center gap-2">
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
              Refresh
            </span>
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border-default p-0.5">
          <button
            type="button"
            aria-label="Pipeline view"
            className={`px-2.5 py-1.5 rounded ${view === 'kanban' ? 'bg-bg-selected text-primary' : 'text-text-muted hover:text-text-primary'}`}
            onClick={() => setView('kanban')}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            type="button"
            aria-label="List view"
            className={`px-2.5 py-1.5 rounded ${view === 'list' ? 'bg-bg-selected text-primary' : 'text-text-muted hover:text-text-primary'}`}
            onClick={() => setView('list')}
          >
            <List size={14} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(['ALL', ...ALL_STATUSES] as string[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
              s === status
                ? 'bg-primary-light border-primary/30 text-primary'
                : 'border-border-default text-text-muted hover:border-text-muted'
            }`}
          >
            {s === 'ALL' ? 'All statuses' : s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {/* Kanban ---------------------------------------------------------------- */}
      {view === 'kanban' && !error && (
        <div className="space-y-3">
          <div className="overflow-x-auto scrollbar-thin pb-2">
            <div className="flex gap-3 min-w-max">
              {PIPELINE.map((col) => {
                const cards = byColumn[col] ?? [];
                return (
                  <div key={col} className="w-56 flex-shrink-0 bg-bg-secondary border border-border-light rounded-md">
                    <div className="px-3 py-2 border-b border-border-light flex items-center justify-between gap-2">
                      <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">
                        {col.replace(/_/g, ' ')}
                      </p>
                      <span className="text-text-secondary text-[11px] font-mono">{cards.length}</span>
                    </div>
                    <div className="p-2 space-y-2 min-h-[60px]">
                      {cards.map((a) => {
                        const badge = eligibility(a);
                        return (
                          <button
                            key={a?.id}
                            type="button"
                            className="w-full text-left bg-bg-card border border-border-default rounded-md p-2.5 hover:border-primary/30 transition-colors"
                            onClick={() => setDetailId(Number(a.id))}
                          >
                            <p className="text-text-primary text-xs font-medium truncate">
                              {text(a?.employeeName)}
                              <span className="text-text-muted font-mono ml-1">{text(a?.empCode)}</span>
                            </p>
                            <p className="text-text-muted text-[11px] truncate mt-0.5">
                              {text(a?.jobCode)} · {text(a?.jobTitle)}
                            </p>
                            <div className="mt-1.5">
                              <Chip label={badge.label} tone={badge.tone} />
                            </div>
                          </button>
                        );
                      })}
                      {cards.length === 0 && <p className="text-text-muted text-[11px] italic px-1 py-2">Empty</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {offPipeline.length > 0 && (
            <p className="text-text-muted text-[11px]">
              {offPipeline.length} application(s) outside the pipeline (draft, rejected or withdrawn) — switch to the
              list view to see them.
            </p>
          )}
        </div>
      )}

      {/* List ------------------------------------------------------------------ */}
      {view === 'list' && !error && (
        rows.length === 0 ? (
          <EmptyBlock message="No applications match these filters" />
        ) : (
          <TableShell headers={['Applicant', 'Code', 'Job', 'Eligibility', 'Status', 'Submitted', 'Decided']}>
            {rows.map((a, index) => {
              const badge = eligibility(a);
              return (
                <tr
                  key={a?.id ?? index}
                  className="hover:bg-bg-hover transition-colors cursor-pointer"
                  onClick={() => (num(a?.id) === null ? undefined : setDetailId(Number(a.id)))}
                >
                  <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{text(a?.employeeName)}</td>
                  <td className="px-3 py-2 text-xs text-text-muted font-mono whitespace-nowrap">{text(a?.empCode)}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary max-w-[260px]">
                    <span className="line-clamp-2">
                      {text(a?.jobCode)} · {text(a?.jobTitle)}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={badge.label} tone={badge.tone} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(a?.status).replace(/_/g, ' ')} tone={statusTone(a?.status)} dot />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDateTime(a?.submittedAt)}</td>
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDateTime(a?.decidedAt)}</td>
                </tr>
              );
            })}
          </TableShell>
        )
      )}

      {/* Detail modal ------------------------------------------------------------ */}
      <AnimatePresence>
        {detailId !== null && (
          <ModalShell
            title={detail ? `${text(detail.employeeName)} → ${text(detail.jobTitle)}` : 'Application'}
            subtitle={detail ? `${text(detail.jobCode)} · application #${text(detail.id)}` : null}
            onClose={() => setDetailId(null)}
            maxWidth="max-w-3xl"
          >
            {detailLoading && <LoadingBlock label="Loading the application…" />}
            {detailError && <ErrorBlock message={detailError} />}
            {!detailLoading && detail && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Chip label={detailStatus.replace(/_/g, ' ')} tone={statusTone(detailStatus)} dot />
                  {elig && <Chip label={elig.label} tone={elig.tone} />}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                  <div>
                    <p className={LABEL_CLS}>Applicant</p>
                    <p className="text-text-secondary">
                      {text(detail.employeeName)} <span className="font-mono">({text(detail.empCode)})</span>
                    </p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Grade</p>
                    <p className="text-text-secondary">{text(detail.grade)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Expected notice</p>
                    <p className="text-text-secondary font-mono">
                      {num(detail.expectedNoticeDays) === null ? '—' : `${detail.expectedNoticeDays} days`}
                    </p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Submitted</p>
                    <p className="text-text-secondary">{fmtDateTime(detail.submittedAt)}</p>
                  </div>
                  {detail.decidedAt && (
                    <div>
                      <p className={LABEL_CLS}>Decided</p>
                      <p className="text-text-secondary">{fmtDateTime(detail.decidedAt)}</p>
                    </div>
                  )}
                  {detail.decisionNote && (
                    <div className="col-span-2">
                      <p className={LABEL_CLS}>Decision note</p>
                      <p className="text-text-secondary">{String(detail.decisionNote)}</p>
                    </div>
                  )}
                  {detail.withdrawReason && (
                    <div className="col-span-2">
                      <p className={LABEL_CLS}>Withdraw reason</p>
                      <p className="text-text-secondary">{String(detail.withdrawReason)}</p>
                    </div>
                  )}
                </div>

                {detail.coverLetter && (
                  <div className="rounded-md border border-border-light bg-bg-secondary p-3">
                    <p className={LABEL_CLS}>Cover letter</p>
                    <p className="text-text-secondary text-xs whitespace-pre-wrap">{String(detail.coverLetter)}</p>
                  </div>
                )}

                {/* Eligibility panel — every rule check rendered verbatim. -------- */}
                <div className="space-y-2">
                  <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">
                    Eligibility checks
                  </p>
                  {detailChecks.length === 0 && (
                    <p className="text-text-muted text-xs italic">
                      No eligibility evaluation is recorded on this application.
                    </p>
                  )}
                  {detailChecks.map((c, index) => {
                    const pass = c?.pass;
                    const tone =
                      pass === true ? 'text-success' : pass === false ? 'text-danger' : 'text-warning';
                    const box =
                      pass === true
                        ? 'bg-success-light border-success/30'
                        : pass === false
                          ? 'bg-danger-light border-danger/30'
                          : 'bg-warning-light border-warning/30';
                    return (
                      <div
                        key={c?.rule ?? index}
                        className={`flex items-start gap-2 px-3 py-2 rounded-md border ${box}`}
                      >
                        {pass === true ? (
                          <CheckCircle2 size={14} className={`${tone} flex-shrink-0 mt-0.5`} />
                        ) : pass === false ? (
                          <XCircle size={14} className={`${tone} flex-shrink-0 mt-0.5`} />
                        ) : (
                          <AlertTriangle size={14} className={`${tone} flex-shrink-0 mt-0.5`} />
                        )}
                        <div className="min-w-0">
                          <p className={`text-xs font-medium ${tone}`}>
                            {text(c?.rule)}
                            {pass === null && ' · could not be verified'}
                          </p>
                          <p className="text-text-secondary text-[11px]">{text(c?.detail)}</p>
                        </div>
                      </div>
                    );
                  })}
                  {detail.eligibilityOverride && (
                    <p className="text-warning text-[11px]">
                      Eligibility was overridden{detail.overrideReason ? `: ${detail.overrideReason}` : '.'}
                    </p>
                  )}
                  {detail.eligibilityPassed === false && !detail.eligibilityOverride && (
                    <button
                      type="button"
                      className={BTN_SECONDARY}
                      disabled={acting}
                      onClick={() => {
                        // Admin/hr only — a 403 from the API is shown verbatim.
                        const r = window.prompt('Reason for overriding the failed eligibility checks (required):');
                        if (r && r.trim())
                          act(() => internalJobsApi.overrideEligibility(Number(detail.id), r.trim()));
                      }}
                    >
                      Override eligibility…
                    </button>
                  )}
                </div>

                {/* Status change --------------------------------------------------- */}
                {legalTargets.length > 0 ? (
                  <div className="rounded-md border border-border-default p-3 space-y-2">
                    <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">
                      Move application
                    </p>
                    <div className="flex items-end gap-2 flex-wrap">
                      <div>
                        <label className={LABEL_CLS}>Next status</label>
                        <select
                          className={`${INPUT_CLS} w-44`}
                          value={nextStatus}
                          onChange={(e) => setNextStatus(e.target.value)}
                        >
                          <option value="">Select…</option>
                          {legalTargets.map((s) => (
                            <option key={s} value={s}>
                              {s.replace(/_/g, ' ')}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-1 min-w-[160px]">
                        <label className={LABEL_CLS}>Note</label>
                        <input
                          className={INPUT_CLS}
                          value={statusNote}
                          onChange={(e) => setStatusNote(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className={BTN_PRIMARY}
                        disabled={acting || nextStatus === ''}
                        onClick={() =>
                          act(() =>
                            internalJobsApi.setApplicationStatus(Number(detail.id), {
                              status: nextStatus,
                              note: statusNote.trim() || undefined,
                            }),
                          )
                        }
                      >
                        Apply
                      </button>
                    </div>
                    <p className="text-text-muted text-[11px]">
                      Only legal forward transitions are offered; the server re-validates and rejects anything else.
                    </p>
                  </div>
                ) : (
                  <p className="text-text-muted text-xs italic">
                    {detailStatus.replace(/_/g, ' ')} is a terminal state — no further transitions.
                  </p>
                )}

                {/* Timeline --------------------------------------------------------- */}
                <div className="space-y-2">
                  <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">Timeline</p>
                  {detailTimeline.length === 0 && (
                    <p className="text-text-muted text-xs italic">No stage events recorded.</p>
                  )}
                  <ul className="space-y-1.5 max-h-56 overflow-y-auto scrollbar-thin">
                    {detailTimeline.map((ev, index) => (
                      <li
                        key={ev?.id ?? index}
                        className="px-3 py-2 rounded-md bg-bg-secondary border border-border-light"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-2">
                            {ev?.fromStatus && (
                              <span className="text-text-muted text-[11px]">
                                {String(ev.fromStatus).replace(/_/g, ' ')} →
                              </span>
                            )}
                            <Chip
                              label={text(ev?.toStatus).replace(/_/g, ' ')}
                              tone={statusTone(ev?.toStatus)}
                            />
                          </span>
                          <span className="text-text-muted text-[11px]">
                            {text(ev?.actorName)} · {fmtDateTime(ev?.createdAt)}
                          </span>
                        </div>
                        {ev?.note && <p className="text-text-secondary text-[11px] mt-1">{String(ev.note)}</p>}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Documents --------------------------------------------------------- */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">Documents</p>
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadDocument(f);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      className={BTN_SECONDARY}
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Upload size={13} />
                        {uploading ? 'Uploading…' : 'Upload'}
                      </span>
                    </button>
                  </div>
                  {detailDocs.length === 0 && (
                    <p className="text-text-muted text-xs italic">No documents attached.</p>
                  )}
                  {detailDocs.map((d, index) => (
                    <div
                      key={d?.id ?? index}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border-light"
                    >
                      <div className="min-w-0">
                        <p className="text-text-primary text-xs truncate">{text(d?.fileName ?? d?.title)}</p>
                        <p className="text-text-muted text-[11px]">
                          {text(d?.docType)} · {fmtDateTime(d?.uploadedAt ?? d?.createdAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline inline-flex items-center gap-1 flex-shrink-0"
                        onClick={() =>
                          openAuthenticatedFile(
                            internalJobsApi.applicationDocumentUrl(Number(d.id)),
                            String(d?.fileName ?? 'document'),
                          ).catch((err) => setDetailError(reason(err)))
                        }
                      >
                        <Download size={12} /> Download
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
