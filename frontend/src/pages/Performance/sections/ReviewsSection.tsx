import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { AlertTriangle, Plus, Rocket, Star, Trash2, Users } from 'lucide-react';
import { performanceApi, talentApi } from '../../../api/performance';
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
import { TabBar } from '../../../components/common/TabBar';
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------
// Local helpers (date-fns is not installed)
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const REVIEW_TYPES = ['SELF', 'MANAGER', 'PEER', 'SUBORDINATE', 'CUSTOMER', 'EXTERNAL'] as const;
const REVIEW_STATUSES = ['REQUESTED', 'IN_PROGRESS', 'SUBMITTED', 'ACKNOWLEDGED', 'DECLINED'] as const;

const TYPE_TONE: Record<string, Tone> = {
  SELF: 'info',
  MANAGER: 'primary',
  PEER: 'default',
  SUBORDINATE: 'default',
  CUSTOMER: 'warning',
  EXTERNAL: 'warning',
};

const STATUS_TONE: Record<string, Tone> = {
  REQUESTED: 'default',
  IN_PROGRESS: 'info',
  SUBMITTED: 'primary',
  ACKNOWLEDGED: 'success',
  DECLINED: 'danger',
};

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? '—' : s;
}

function fmtDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

/**
 * The backend nulls reviewerName for anonymous reviews shown to non-HR
 * callers; either way an anonymous review must read as such.
 */
function reviewerLabel(r: any): string {
  if (r?.isAnonymous && !r?.reviewerName) return 'Anonymous';
  return r?.reviewerName ?? r?.externalReviewerName ?? '—';
}

/** Whole ratings up to 5 render as stars; anything else as the number. */
function RatingCells({ rating, scale = 5 }: { rating: number | null | undefined; scale?: number }) {
  if (rating === null || rating === undefined) return <span className="text-text-muted">—</span>;
  const n = Number(rating);
  if (Number.isInteger(n) && n >= 0 && n <= scale && scale <= 5) {
    return (
      <span className="inline-flex items-center gap-0.5" title={`${n} / ${scale}`}>
        {Array.from({ length: scale }, (_, i) => (
          <Star key={i} size={12} className={i < n ? 'text-warning fill-warning' : 'text-border-default'} />
        ))}
      </span>
    );
  }
  return <span className="font-mono tabular-nums text-text-primary">{n}</span>;
}

interface TemplateQuestion {
  kind: string;
  question: string;
  competencyId?: number | null;
}
interface TemplateSection {
  section: string;
  questions: TemplateQuestion[];
}

// ---------------------------------------------------------------------------

export function ReviewsSection() {
  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [cyclesError, setCyclesError] = useState<string | null>(null);
  const [tab, setTab] = useState('all');

  useEffect(() => {
    performanceApi
      .cycles()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setCycles(list);
        const active = list.find((c) => c?.status === 'ACTIVE') ?? list[0];
        if (active?.id) setCycleId(Number(active.id));
      })
      .catch((err) => setCyclesError(reason(err)));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <TabBar
          tabs={[
            { id: 'all', label: 'All Reviews' },
            { id: 'launch', label: 'Launch & Requests' },
            { id: '360', label: '360° View' },
            { id: 'templates', label: 'Templates' },
          ]}
          active={tab}
          onChange={setTab}
        />
        {tab !== 'templates' && (
          <div className="w-64">
            <label className={LABEL_CLS} htmlFor="rv-cycle">
              Performance cycle
            </label>
            <select
              id="rv-cycle"
              className={INPUT_CLS}
              value={cycleId ?? ''}
              onChange={(e) => setCycleId(e.target.value ? Number(e.target.value) : null)}
            >
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {cyclesError && <ErrorBlock message={cyclesError} />}

      {tab === 'all' && cycleId !== null && <AllReviewsTab cycleId={cycleId} />}
      {tab === 'launch' && cycleId !== null && <LaunchTab cycleId={cycleId} />}
      {tab === '360' && cycleId !== null && <ThreeSixtyTab cycleId={cycleId} />}
      {tab === 'templates' && <TemplatesTab />}
      {cycleId === null && !cyclesError && tab !== 'templates' && <LoadingBlock label="Loading cycles…" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// All Reviews
// ---------------------------------------------------------------------------

function AllReviewsTab({ cycleId }: { cycleId: number }) {
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [rows, setRows] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([talentApi.reviews({ cycleId }), talentApi.reviewTemplates().catch(() => [])])
      .then(([list, tpls]) => {
        setRows(Array.isArray(list) ? list : []);
        setTemplates(Array.isArray(tpls) ? tpls : []);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [cycleId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = rows.filter(
    (r) =>
      (typeFilter === 'ALL' || r?.reviewType === typeFilter) &&
      (statusFilter === 'ALL' || r?.status === statusFilter),
  );

  if (loading) return <LoadingBlock label="Loading reviews…" />;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {['ALL', ...REVIEW_TYPES].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                typeFilter === t
                  ? 'bg-primary-light border-primary/30 text-primary'
                  : 'border-border-default text-text-muted hover:border-text-muted'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {['ALL', ...REVIEW_STATUSES].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                statusFilter === s
                  ? 'bg-primary-light border-primary/30 text-primary'
                  : 'border-border-default text-text-muted hover:border-text-muted'
              }`}
            >
              {s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!error && filtered.length === 0 && (
        <EmptyBlock
          message="No reviews match these filters"
          hint="Launch cycle reviews or request one from the Launch & Requests tab."
        />
      )}

      {!error && filtered.length > 0 && (
        <TableShell headers={['Subject', 'Type', 'Reviewer', 'Status', 'Rating', 'Due', 'Submitted']}>
          {filtered.map((r) => (
            <tr
              key={r.id}
              className="hover:bg-bg-hover transition-colors cursor-pointer"
              onClick={() => setDetailId(Number(r.id))}
            >
              <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{text(r.employeeName)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip label={text(r.reviewType)} tone={TYPE_TONE[r.reviewType] ?? 'default'} />
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                {reviewerLabel(r)}
                {r.isAnonymous && <Chip label="anon" tone="default" />}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip label={text(r.status).replace(/_/g, ' ')} tone={STATUS_TONE[r.status] ?? 'default'} dot />
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-xs">
                <RatingCells rating={r.overallRating} />
              </td>
              <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDate(r.dueDate)}</td>
              <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDate(r.submittedAt)}</td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {detailId !== null && (
          <ReviewDetailModal
            reviewId={detailId}
            templates={templates}
            onClose={() => setDetailId(null)}
            onChanged={load}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review detail
// ---------------------------------------------------------------------------

function ReviewDetailModal({
  reviewId,
  templates,
  onClose,
  onChanged,
}: {
  reviewId: number;
  templates: any[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [review, setReview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'view' | 'respond' | 'decline' | 'peers'>('view');
  const [declineReason, setDeclineReason] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    talentApi
      .review(reviewId)
      .then((r) => setReview(r ?? null))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [reviewId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = (fn: () => Promise<any>) => {
    setBusy(true);
    setActionError(null);
    fn()
      .then(() => {
        load();
        onChanged();
        setMode('view');
      })
      // 400 validation messages (e.g. unanswered rating questions on submit)
      // must be shown verbatim, not paraphrased.
      .catch((err) => setActionError(reason(err)))
      .finally(() => setBusy(false));
  };

  const responses: any[] = Array.isArray(review?.responses) ? review.responses : [];
  const sections = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const r of responses) {
      const key = r?.section ?? 'General';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()];
  }, [responses]);

  const editable = review && ['REQUESTED', 'IN_PROGRESS'].includes(review.status);
  const template = review?.templateId ? templates.find((t) => Number(t.id) === Number(review.templateId)) : null;

  return (
    <ModalShell
      title={review ? `${review.reviewType} review — ${text(review.employeeName)}` : 'Review'}
      subtitle={review ? `${text(review.cycleName)} · reviewer ${reviewerLabel(review)}` : null}
      onClose={onClose}
      maxWidth="max-w-3xl"
      footer={
        review && mode === 'view' ? (
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <button type="button" className={BTN_SECONDARY} onClick={() => setMode('peers')}>
              <span className="inline-flex items-center gap-1.5">
                <Users size={14} /> Nominate peers
              </span>
            </button>
            {editable && (
              <>
                <button type="button" className={BTN_SECONDARY} onClick={() => setMode('decline')}>
                  Decline
                </button>
                <button type="button" className={BTN_SECONDARY} onClick={() => setMode('respond')}>
                  {responses.length > 0 ? 'Edit responses' : 'Respond'}
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={busy}
                  onClick={() => run(() => talentApi.submitReview(reviewId))}
                >
                  Submit
                </button>
              </>
            )}
            {review.status === 'SUBMITTED' && (
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={busy}
                onClick={() => run(() => talentApi.acknowledgeReview(reviewId))}
              >
                Acknowledge
              </button>
            )}
          </div>
        ) : null
      }
    >
      {loading ? (
        <LoadingBlock label="Loading the review…" />
      ) : error ? (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      ) : review ? (
        <div className="space-y-4">
          {actionError && <ErrorBlock message={actionError} />}

          <div className="flex items-center gap-2 flex-wrap">
            <Chip label={text(review.status).replace(/_/g, ' ')} tone={STATUS_TONE[review.status] ?? 'default'} dot />
            <Chip label={text(review.reviewType)} tone={TYPE_TONE[review.reviewType] ?? 'default'} />
            {review.isAnonymous && <Chip label="Anonymous" tone="default" />}
            <span className="text-text-muted text-xs">
              due {fmtDate(review.dueDate)} · submitted {fmtDate(review.submittedAt)}
            </span>
            {review.overallRating !== null && (
              <span className="text-xs text-text-secondary inline-flex items-center gap-1.5">
                overall <RatingCells rating={review.overallRating} />
              </span>
            )}
          </div>

          {mode === 'decline' && (
            <div className="rounded-md border border-border-default bg-bg-secondary p-3 space-y-2">
              <label className={LABEL_CLS} htmlFor="rv-decline">
                Reason for declining
              </label>
              <textarea
                id="rv-decline"
                className={INPUT_CLS}
                rows={2}
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
              />
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setMode('view')}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={busy || !declineReason.trim()}
                  onClick={() => run(() => talentApi.declineReview(reviewId, declineReason.trim()))}
                >
                  Decline review
                </button>
              </div>
            </div>
          )}

          {mode === 'peers' && (
            <PeerNominationForm
              busy={busy}
              onCancel={() => setMode('view')}
              onSubmit={(ids, anon) => run(() => talentApi.requestPeers(reviewId, { reviewerEmployeeIds: ids, isAnonymous: anon }))}
            />
          )}

          {mode === 'respond' ? (
            <RespondForm
              review={review}
              template={template}
              busy={busy}
              onCancel={() => setMode('view')}
              onSave={(body) => run(() => talentApi.respondReview(reviewId, body))}
            />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(
                  [
                    ['Achievements', review.achievements],
                    ['Challenges', review.challenges],
                    ['Learnings', review.learnings],
                    ['Development notes', review.developmentNotes],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-md border border-border-light bg-bg-secondary p-3">
                    <p className={LABEL_CLS}>{label}</p>
                    <p className="text-text-secondary text-xs whitespace-pre-wrap">{text(value)}</p>
                  </div>
                ))}
              </div>

              {sections.length === 0 ? (
                <EmptyBlock message="No responses recorded yet" hint="Use Respond to fill the review form." />
              ) : (
                <div className="space-y-3">
                  {sections.map(([section, items]) => (
                    <div key={section} className="rounded-md border border-border-default p-3">
                      <p className="text-text-primary text-sm font-semibold mb-2">{section}</p>
                      <div className="space-y-2">
                        {items.map((r: any) => (
                          <div key={r.id} className="flex items-start justify-between gap-4">
                            <p className="text-text-secondary text-xs">{text(r.question)}</p>
                            {r.rating !== null ? (
                              <span className="flex-shrink-0 text-xs">
                                <RatingCells rating={r.rating} />
                              </span>
                            ) : (
                              <p className="text-text-primary text-xs max-w-[50%] text-right whitespace-pre-wrap">
                                {text(r.responseText)}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </ModalShell>
  );
}

function PeerNominationForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (ids: number[], anonymous: boolean) => void;
}) {
  const { employees } = useApp();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anonymous, setAnonymous] = useState(false);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="rounded-md border border-border-default bg-bg-secondary p-3 space-y-3">
      <p className="text-text-primary text-sm font-semibold">Nominate peer reviewers</p>
      <div className="max-h-48 overflow-y-auto scrollbar-thin space-y-1 border border-border-light rounded-md p-2 bg-bg-card">
        {(employees ?? []).map((emp) => (
          <label key={emp.id} className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input type="checkbox" checked={selected.has(emp.id)} onChange={() => toggle(emp.id)} />
            {emp.fullName} <span className="text-text-muted font-mono">({emp.empCode})</span>
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
        <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
        Keep the peer reviews anonymous
      </label>
      <div className="flex items-center justify-end gap-2">
        <button type="button" className={BTN_SECONDARY} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={busy || selected.size === 0}
          onClick={() => onSubmit([...selected], anonymous)}
        >
          Request {selected.size > 0 ? `${selected.size} peer review(s)` : 'peer reviews'}
        </button>
      </div>
    </div>
  );
}

/**
 * Dynamic answer form built from the review's template (matched on
 * templateId). Falls back to the already-recorded responses when the template
 * is missing, so an ad-hoc review is still editable.
 */
function RespondForm({
  review,
  template,
  busy,
  onCancel,
  onSave,
}: {
  review: any;
  template: any | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const templateSections: TemplateSection[] = Array.isArray(template?.sections) ? template.sections : [];
  const existing: any[] = Array.isArray(review?.responses) ? review.responses : [];

  const initialItems = useMemo(() => {
    if (templateSections.length > 0) {
      const flat: { section: string; question: string; kind: string; competencyId: number | null }[] = [];
      for (const s of templateSections) {
        for (const q of s.questions ?? []) {
          flat.push({
            section: s.section,
            question: q.question,
            kind: q.kind ?? 'TEXT',
            competencyId: q.competencyId ?? null,
          });
        }
      }
      return flat.map((q, index) => {
        const prev = existing.find((r) => String(r.question) === q.question);
        return {
          ...q,
          sortOrder: index,
          responseText: prev?.responseText ?? '',
          rating: prev?.rating ?? null,
        };
      });
    }
    return existing.map((r, index) => ({
      section: r.section ?? 'General',
      question: String(r.question ?? ''),
      kind: r.rating !== null ? 'RATING' : 'TEXT',
      competencyId: r.competencyId ?? null,
      sortOrder: index,
      responseText: r.responseText ?? '',
      rating: r.rating ?? null,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review?.id, template?.id]);

  const [items, setItems] = useState(initialItems);
  const [overallRating, setOverallRating] = useState<string>(review?.overallRating !== null ? String(review.overallRating) : '');
  const [achievements, setAchievements] = useState<string>(review?.achievements ?? '');
  const [challenges, setChallenges] = useState<string>(review?.challenges ?? '');
  const [learnings, setLearnings] = useState<string>(review?.learnings ?? '');
  const [developmentNotes, setDevelopmentNotes] = useState<string>(review?.developmentNotes ?? '');

  useEffect(() => setItems(initialItems), [initialItems]);

  const patch = (index: number, changes: Record<string, unknown>) =>
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...changes } : it)));

  const save = () => {
    onSave({
      overallRating: overallRating === '' ? null : Number(overallRating),
      achievements: achievements.trim() || null,
      challenges: challenges.trim() || null,
      learnings: learnings.trim() || null,
      developmentNotes: developmentNotes.trim() || null,
      responses: items.map((it) => ({
        section: it.section,
        question: it.question,
        responseText: it.kind === 'TEXT' ? it.responseText || null : null,
        rating: it.kind === 'TEXT' ? null : it.rating === null || it.rating === '' ? null : Number(it.rating),
        competencyId: it.competencyId,
        sortOrder: it.sortOrder,
      })),
    });
  };

  const grouped = useMemo(() => {
    const map = new Map<string, typeof items>();
    items.forEach((it) => {
      if (!map.has(it.section)) map.set(it.section, []);
      map.get(it.section)!.push(it);
    });
    return [...map.entries()];
  }, [items]);

  return (
    <div className="space-y-3">
      {!template && templateSections.length === 0 && existing.length === 0 && (
        <ErrorBlock message="This review has no template and no recorded responses — there is no form to build. Fill the narrative fields below and save." />
      )}
      {grouped.map(([section, sectionItems]) => (
        <div key={section} className="rounded-md border border-border-default p-3 space-y-3">
          <p className="text-text-primary text-sm font-semibold">{section}</p>
          {sectionItems.map((it) => {
            const index = items.indexOf(it);
            return (
              <div key={`${it.question}-${index}`}>
                <label className={LABEL_CLS}>{it.question}</label>
                {it.kind === 'TEXT' ? (
                  <textarea
                    className={INPUT_CLS}
                    rows={2}
                    value={it.responseText}
                    onChange={(e) => patch(index, { responseText: e.target.value })}
                  />
                ) : (
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.5}
                    className={`${INPUT_CLS} w-28`}
                    value={it.rating ?? ''}
                    onChange={(e) => patch(index, { rating: e.target.value === '' ? null : e.target.value })}
                    placeholder="0–5"
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}

      <div className="rounded-md border border-border-default p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLS}>Overall rating (0–5)</label>
          <input
            type="number"
            min={0}
            max={5}
            step={0.5}
            className={`${INPUT_CLS} w-28`}
            value={overallRating}
            onChange={(e) => setOverallRating(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Achievements</label>
          <textarea className={INPUT_CLS} rows={2} value={achievements} onChange={(e) => setAchievements(e.target.value)} />
        </div>
        <div>
          <label className={LABEL_CLS}>Challenges</label>
          <textarea className={INPUT_CLS} rows={2} value={challenges} onChange={(e) => setChallenges(e.target.value)} />
        </div>
        <div>
          <label className={LABEL_CLS}>Learnings</label>
          <textarea className={INPUT_CLS} rows={2} value={learnings} onChange={(e) => setLearnings(e.target.value)} />
        </div>
        <div>
          <label className={LABEL_CLS}>Development notes</label>
          <textarea
            className={INPUT_CLS}
            rows={2}
            value={developmentNotes}
            onChange={(e) => setDevelopmentNotes(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button type="button" className={BTN_SECONDARY} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save responses'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Launch & Requests
// ---------------------------------------------------------------------------

function LaunchTab({ cycleId }: { cycleId: number }) {
  const { employees } = useApp();
  const empName = (id: unknown) => {
    const emp = (employees ?? []).find((e) => Number(e.id) === Number(id));
    return emp ? `${emp.fullName} (${emp.empCode})` : `Employee #${id}`;
  };

  const [launchBusy, setLaunchBusy] = useState(false);
  const [launchResult, setLaunchResult] = useState<any>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // Single request form
  const [employeeId, setEmployeeId] = useState('');
  const [reviewType, setReviewType] = useState('MANAGER');
  const [reviewerId, setReviewerId] = useState('');
  const [externalName, setExternalName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [reqBusy, setReqBusy] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);
  const [reqNote, setReqNote] = useState<string | null>(null);

  const isExternal = reviewType === 'CUSTOMER' || reviewType === 'EXTERNAL';
  const needsReviewer = ['MANAGER', 'PEER', 'SUBORDINATE'].includes(reviewType);

  const launch = () => {
    setLaunchBusy(true);
    setLaunchError(null);
    talentApi
      .launchReviews(cycleId)
      .then((res) => setLaunchResult(res ?? null))
      .catch((err) => setLaunchError(reason(err)))
      .finally(() => setLaunchBusy(false));
  };

  const request = () => {
    setReqBusy(true);
    setReqError(null);
    setReqNote(null);
    talentApi
      .createReview({
        cycleId,
        employeeId: Number(employeeId),
        reviewType,
        reviewerEmployeeId: needsReviewer ? Number(reviewerId) || undefined : undefined,
        externalReviewerName: isExternal ? externalName.trim() : undefined,
        dueDate: dueDate || undefined,
      })
      .then((res) => {
        setReqNote(res?.note ? String(res.note) : 'Review requested.');
        setEmployeeId('');
        setReviewerId('');
        setExternalName('');
      })
      .catch((err) => setReqError(reason(err)))
      .finally(() => setReqBusy(false));
  };

  const skipped: any[] = Array.isArray(launchResult?.skipped) ? launchResult.skipped : [];

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border-default bg-bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-text-primary text-sm font-semibold">Launch cycle reviews</p>
            <p className="text-text-muted text-xs mt-0.5">
              Creates one SELF review and one MANAGER review per working employee for this cycle. Employees without a
              primary manager mapping are reported back, not silently skipped.
            </p>
          </div>
          <button type="button" className={BTN_PRIMARY} onClick={launch} disabled={launchBusy}>
            <span className="inline-flex items-center gap-2">
              <Rocket size={14} />
              {launchBusy ? 'Launching…' : 'Launch cycle reviews'}
            </span>
          </button>
        </div>

        {launchError && <ErrorBlock message={launchError} />}

        {launchResult && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Chip label={`${Number(launchResult.created ?? 0)} created`} tone="success" />
              <Chip label={`${Number(launchResult.alreadyExisted ?? 0)} already existed`} tone="default" />
              <Chip label={`${skipped.length} skipped`} tone={skipped.length > 0 ? 'warning' : 'default'} />
            </div>
            {skipped.length > 0 && (
              <div className="rounded-md bg-warning-light border border-warning/30 p-3">
                <p className="text-warning text-xs font-semibold mb-1 flex items-center gap-1.5">
                  <AlertTriangle size={13} /> {skipped.length} employee(s) skipped — a MANAGER review could not be created
                </p>
                <ul className="space-y-0.5">
                  {skipped.map((s: any, i: number) => (
                    <li key={s?.employeeId ?? i} className="text-text-secondary text-xs">
                      {empName(s?.employeeId)} — {text(s?.reason)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-md border border-border-default bg-bg-card p-4 space-y-3">
        <p className="text-text-primary text-sm font-semibold">Request a single review</p>
        {reqError && <ErrorBlock message={reqError} />}
        {reqNote && (
          <div className="rounded-md bg-success-light border border-success/30 px-3 py-2 text-success text-xs">{reqNote}</div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className={LABEL_CLS} htmlFor="rq-emp">
              Employee (subject)
            </label>
            <select id="rq-emp" className={INPUT_CLS} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select…</option>
              {(employees ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.empCode} · {emp.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="rq-type">
              Review type
            </label>
            <select id="rq-type" className={INPUT_CLS} value={reviewType} onChange={(e) => setReviewType(e.target.value)}>
              {REVIEW_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {needsReviewer && (
            <div>
              <label className={LABEL_CLS} htmlFor="rq-reviewer">
                Reviewer
              </label>
              <select
                id="rq-reviewer"
                className={INPUT_CLS}
                value={reviewerId}
                onChange={(e) => setReviewerId(e.target.value)}
              >
                <option value="">Select…</option>
                {(employees ?? []).map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.empCode} · {emp.fullName}
                  </option>
                ))}
              </select>
            </div>
          )}
          {isExternal && (
            <div>
              <label className={LABEL_CLS} htmlFor="rq-ext">
                External reviewer name
              </label>
              <input id="rq-ext" className={INPUT_CLS} value={externalName} onChange={(e) => setExternalName(e.target.value)} />
            </div>
          )}
          <div>
            <label className={LABEL_CLS} htmlFor="rq-due">
              Due date (optional)
            </label>
            <input id="rq-due" type="date" className={INPUT_CLS} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        {isExternal && (
          <div className="rounded-md bg-info-light border border-info/30 px-3 py-2 text-info text-[11px]">
            CUSTOMER and EXTERNAL reviews are recorded by HR on the stakeholder&rsquo;s behalf — there is no external
            reviewer portal.
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={reqBusy || !employeeId || (needsReviewer && !reviewerId) || (isExternal && !externalName.trim())}
            onClick={request}
          >
            {reqBusy ? 'Requesting…' : 'Request review'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 360° View
// ---------------------------------------------------------------------------

function ThreeSixtyTab({ cycleId }: { cycleId: number }) {
  const { employees } = useApp();
  const [employeeId, setEmployeeId] = useState<string>('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    talentApi
      .feedback360(Number(employeeId), cycleId)
      .then((res) => setData(res ?? null))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [employeeId, cycleId]);

  const byType: any[] = Array.isArray(data?.byType) ? data.byType : [];
  const competencyAverages: any[] = Array.isArray(data?.competencyAverages) ? data.competencyAverages : [];
  const reviews: any[] = Array.isArray(data?.reviews) ? data.reviews : [];

  return (
    <div className="space-y-4">
      <div className="w-72">
        <label className={LABEL_CLS} htmlFor="ts-emp">
          Employee
        </label>
        <select id="ts-emp" className={INPUT_CLS} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Select an employee</option>
          {(employees ?? []).map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.empCode} · {emp.fullName}
            </option>
          ))}
        </select>
      </div>

      {loading && <LoadingBlock label="Loading the 360° view…" />}
      {error && <ErrorBlock message={error} />}
      {!employeeId && !loading && <EmptyBlock message="Pick an employee to see their 360° feedback" />}

      {data && !loading && (
        <>
          {byType.length === 0 ? (
            <EmptyBlock message="No reviews exist for this employee in this cycle" />
          ) : (
            <TableShell headers={['Review type', 'Requested', 'Submitted', 'Avg rating']}>
              {byType.map((row) => (
                <tr key={row.reviewType} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(row.reviewType)} tone={TYPE_TONE[row.reviewType] ?? 'default'} />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono">{Number(row.count ?? 0)}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono">{Number(row.submitted ?? 0)}</td>
                  <td className="px-3 py-2 text-xs">
                    <RatingCells rating={row.avgRating} />
                  </td>
                </tr>
              ))}
            </TableShell>
          )}

          <div className="rounded-md border border-border-default bg-bg-card p-4">
            <p className="text-text-primary text-sm font-semibold mb-2">Competency averages</p>
            {competencyAverages.length === 0 ? (
              <p className="text-text-muted text-xs">
                No competency ratings recorded in this cycle — competency answers appear here after reviews with
                COMPETENCY questions are submitted.
              </p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={competencyAverages.map((c) => ({ name: c.name, avg: Number(c.avgRating ?? 0) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 5]} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="avg" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {reviews.length > 0 && (
            <TableShell headers={['Type', 'Reviewer', 'Status', 'Rating', 'Submitted']}>
              {reviews.map((r) => (
                <tr key={r.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(r.reviewType)} tone={TYPE_TONE[r.reviewType] ?? 'default'} />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                    {r.isAnonymous ? 'Anonymous' : reviewerLabel(r)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(r.status).replace(/_/g, ' ')} tone={STATUS_TONE[r.status] ?? 'default'} dot />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <RatingCells rating={r.overallRating} />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDate(r.submittedAt)}</td>
                </tr>
              ))}
            </TableShell>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function TemplatesTab() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null | 'new'>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    talentApi
      .reviewTemplates()
      .then((rows) => setTemplates(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingBlock label="Loading templates…" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className={BTN_PRIMARY} onClick={() => setEditing('new')}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} /> New template
          </span>
        </button>
      </div>

      {error && <ErrorBlock message={error} />}
      {!error && templates.length === 0 && <EmptyBlock message="No review templates yet" />}

      {templates.length > 0 && (
        <TableShell headers={['Code', 'Name', 'Applies to', 'Scale', 'Sections', 'Questions', 'Active', '']}>
          {templates.map((t) => {
            const sections: TemplateSection[] = Array.isArray(t.sections) ? t.sections : [];
            const questionCount = sections.reduce((sum, s) => sum + (s.questions?.length ?? 0), 0);
            return (
              <tr key={t.id} className="hover:bg-bg-hover transition-colors">
                <td className="px-3 py-2 text-xs font-mono text-text-secondary whitespace-nowrap">{text(t.code)}</td>
                <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{text(t.name)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Chip label={text(t.appliesTo)} tone={t.appliesTo === 'ALL' ? 'default' : 'info'} />
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary font-mono">0–{Number(t.ratingScale ?? 5)}</td>
                <td className="px-3 py-2 text-xs text-text-secondary font-mono">{sections.length}</td>
                <td className="px-3 py-2 text-xs text-text-secondary font-mono">{questionCount}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Chip label={t.isActive ? 'Active' : 'Inactive'} tone={t.isActive ? 'success' : 'default'} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <button
                    type="button"
                    className="text-primary text-xs font-medium hover:underline"
                    onClick={() => setEditing(t)}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            );
          })}
        </TableShell>
      )}

      <AnimatePresence>
        {editing !== null && (
          <TemplateEditorModal
            template={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function TemplateEditorModal({
  template,
  onClose,
  onSaved,
}: {
  template: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState<string>(template?.code ?? '');
  const [name, setName] = useState<string>(template?.name ?? '');
  const [appliesTo, setAppliesTo] = useState<string>(template?.appliesTo ?? 'ALL');
  const [ratingScale, setRatingScale] = useState<string>(String(template?.ratingScale ?? 5));
  const [sections, setSections] = useState<TemplateSection[]>(
    Array.isArray(template?.sections) && template.sections.length > 0
      ? template.sections.map((s: any) => ({
          section: String(s.section ?? ''),
          questions: (s.questions ?? []).map((q: any) => ({
            kind: q.kind ?? 'TEXT',
            question: String(q.question ?? ''),
            competencyId: q.competencyId ?? null,
          })),
        }))
      : [{ section: 'General', questions: [{ kind: 'TEXT', question: '' }] }],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchSection = (i: number, changes: Partial<TemplateSection>) =>
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...changes } : s)));

  const patchQuestion = (si: number, qi: number, changes: Partial<TemplateQuestion>) =>
    setSections((prev) =>
      prev.map((s, idx) =>
        idx === si ? { ...s, questions: s.questions.map((q, j) => (j === qi ? { ...q, ...changes } : q)) } : s,
      ),
    );

  const save = () => {
    setBusy(true);
    setError(null);
    const body = {
      code: code.trim(),
      name: name.trim(),
      appliesTo,
      ratingScale: Number(ratingScale),
      sections: sections
        .filter((s) => s.section.trim() !== '')
        .map((s) => ({
          section: s.section.trim(),
          questions: s.questions.filter((q) => q.question.trim() !== ''),
        })),
    };
    const call = template
      ? talentApi.updateReviewTemplate(Number(template.id), body)
      : talentApi.createReviewTemplate(body);
    call
      .then(() => onSaved())
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title={template ? `Edit template — ${template.name}` : 'New review template'}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !code.trim() || !name.trim()} onClick={save}>
            {busy ? 'Saving…' : 'Save template'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBlock message={error} />}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className={LABEL_CLS}>Code</label>
            <input className={INPUT_CLS} value={code} onChange={(e) => setCode(e.target.value)} disabled={!!template} />
          </div>
          <div>
            <label className={LABEL_CLS}>Name</label>
            <input className={INPUT_CLS} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Applies to</label>
            <select className={INPUT_CLS} value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)}>
              {['ALL', ...REVIEW_TYPES].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Rating scale (2–10)</label>
            <input
              type="number"
              min={2}
              max={10}
              className={INPUT_CLS}
              value={ratingScale}
              onChange={(e) => setRatingScale(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-3">
          {sections.map((s, si) => (
            <div key={si} className="rounded-md border border-border-default p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  className={INPUT_CLS}
                  value={s.section}
                  placeholder="Section name"
                  onChange={(e) => patchSection(si, { section: e.target.value })}
                />
                <button
                  type="button"
                  aria-label="Remove section"
                  className="text-text-muted hover:text-danger transition-colors flex-shrink-0"
                  onClick={() => setSections((prev) => prev.filter((_, i) => i !== si))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {s.questions.map((q, qi) => (
                <div key={qi} className="flex items-center gap-2">
                  <select
                    className={`${INPUT_CLS} w-36 flex-shrink-0`}
                    value={q.kind}
                    onChange={(e) => patchQuestion(si, qi, { kind: e.target.value })}
                    aria-label="Question kind"
                  >
                    {['TEXT', 'RATING', 'COMPETENCY'].map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <input
                    className={INPUT_CLS}
                    value={q.question}
                    placeholder="Question text"
                    onChange={(e) => patchQuestion(si, qi, { question: e.target.value })}
                  />
                  <button
                    type="button"
                    aria-label="Remove question"
                    className="text-text-muted hover:text-danger transition-colors flex-shrink-0"
                    onClick={() =>
                      patchSection(si, { questions: s.questions.filter((_, j) => j !== qi) })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-primary text-xs font-medium hover:underline"
                onClick={() => patchSection(si, { questions: [...s.questions, { kind: 'TEXT', question: '' }] })}
              >
                + Add question
              </button>
            </div>
          ))}
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={() => setSections((prev) => [...prev, { section: '', questions: [{ kind: 'TEXT', question: '' }] }])}
          >
            <span className="inline-flex items-center gap-1.5">
              <Plus size={14} /> Add section
            </span>
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
