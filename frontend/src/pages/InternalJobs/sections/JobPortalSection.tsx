import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Bookmark,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  MapPin,
  Search,
  Sparkles,
  Star,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { internalJobsApi } from '../../../api/internalJobs';
import { ApiError } from '../../../api/client';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
  inr,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';
import { TabBar } from '../../../components/common/TabBar';
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const WORK_MODES = ['ONSITE', 'REMOTE', 'HYBRID'];
const EMPLOYMENT_TYPES: { id: string; label: string }[] = [
  { id: 'FULL_TIME', label: 'Full time' },
  { id: 'PART_TIME', label: 'Part time' },
  { id: 'GIG', label: 'Gigs' },
  { id: 'SHORT_TERM', label: 'Short term' },
];

const APPLICATION_TONE: Record<string, Tone> = {
  DRAFT: 'default',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  SHORTLISTED: 'primary',
  INTERVIEW: 'primary',
  SELECTED: 'success',
  OFFERED: 'info',
  HIRED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'default',
};

const REFERRAL_TONE: Record<string, Tone> = {
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  ACCEPTED: 'primary',
  HIRED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'default',
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

function fmtDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

/** True when the backend refused the portal because the login has no employee link. */
function isNoEmployeeLink(err: any): boolean {
  return err instanceof ApiError && err.status === 400;
}

function salaryRange(min: unknown, max: unknown): string | null {
  const lo = num(min);
  const hi = num(max);
  if (lo === null && hi === null) return null;
  if (lo !== null && hi !== null) return `${inr(lo)} – ${inr(hi)}`;
  return inr((lo ?? hi) as number);
}

/** Human rows out of the eligibilityRules JSON — only rules that are set. */
function ruleRows(rules: any): { label: string; value: string }[] {
  if (!rules || typeof rules !== 'object') return [];
  const rows: { label: string; value: string }[] = [];
  if (num(rules.minTenureMonths) !== null) rows.push({ label: 'Minimum tenure', value: `${rules.minTenureMonths} months` });
  if (Array.isArray(rules.allowedGrades) && rules.allowedGrades.length > 0)
    rows.push({ label: 'Allowed grades', value: rules.allowedGrades.join(', ') });
  if (num(rules.minPerformanceRating) !== null)
    rows.push({ label: 'Minimum performance rating', value: String(rules.minPerformanceRating) });
  if (Array.isArray(rules.requiredSkills) && rules.requiredSkills.length > 0)
    rows.push({ label: 'Required skills', value: rules.requiredSkills.join(', ') });
  if (Array.isArray(rules.requiredCertifications) && rules.requiredCertifications.length > 0)
    rows.push({ label: 'Required certifications', value: rules.requiredCertifications.join(', ') });
  if (num(rules.maxNoticeDays) !== null)
    rows.push({ label: 'Maximum notice period', value: `${rules.maxNoticeDays} days` });
  return rows;
}

/** One evaluated eligibility check, rendered verbatim. pass:null warns, never blocks. */
function EligibilityCheckRow({ check }: { check: any }) {
  const pass: boolean | null = check?.pass === true ? true : check?.pass === false ? false : null;
  const icon =
    pass === true ? (
      <CheckCircle2 size={14} className="text-success flex-shrink-0 mt-0.5" />
    ) : pass === false ? (
      <XCircle size={14} className="text-danger flex-shrink-0 mt-0.5" />
    ) : (
      <AlertTriangle size={14} className="text-warning flex-shrink-0 mt-0.5" />
    );
  return (
    <div className="flex items-start gap-2">
      {icon}
      <div className="min-w-0">
        <p className="text-text-primary text-xs">{text(check?.detail)}</p>
        <p className="text-text-muted text-[10px] font-mono">{text(check?.rule)}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job card (rails + grid)
// ---------------------------------------------------------------------------

function JobCard({
  job,
  onOpen,
  onToggleSave,
  saving,
  matchScore,
  matchReasons,
}: {
  job: any;
  onOpen: (id: number) => void;
  onToggleSave: (job: any) => void;
  saving: boolean;
  matchScore?: number;
  matchReasons?: string[];
}) {
  const salary = salaryRange(job?.salaryRangeMin, job?.salaryRangeMax);
  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4 hover:border-primary/40 transition-colors flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <button type="button" className="text-left min-w-0" onClick={() => onOpen(Number(job.id))}>
          <p className="text-text-primary text-sm font-semibold hover:text-primary transition-colors flex items-center gap-1.5">
            {job?.isFeatured && <Star size={13} className="text-warning fill-warning flex-shrink-0" />}
            {text(job?.title)}
          </p>
          <p className="text-text-muted text-[11px] font-mono mt-0.5">{text(job?.jobCode)}</p>
        </button>
        <button
          type="button"
          aria-label={job?.saved ? 'Remove from saved' : 'Save job'}
          disabled={saving}
          onClick={() => onToggleSave(job)}
          className={`flex-shrink-0 transition-colors ${
            job?.saved ? 'text-primary' : 'text-text-muted hover:text-primary'
          } disabled:opacity-50`}
        >
          <Bookmark size={16} className={job?.saved ? 'fill-current' : undefined} />
        </button>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-text-secondary flex-wrap">
        <span className="inline-flex items-center gap-1">
          <Briefcase size={12} className="text-text-muted" /> {text(job?.departmentName)}
        </span>
        <span className="inline-flex items-center gap-1">
          <MapPin size={12} className="text-text-muted" /> {text(job?.location)}
        </span>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <Chip label={text(job?.workMode)} tone="default" />
        <Chip
          label={String(job?.employmentType ?? '—').replace(/_/g, ' ')}
          tone={job?.employmentType === 'GIG' ? 'info' : 'default'}
        />
        {job?.category && <Chip label={String(job.category)} tone="default" />}
        {job?.applied && <Chip label="Applied" tone="success" dot />}
        {job?.saved && <Chip label="Saved" tone="primary" />}
        {typeof matchScore === 'number' && <Chip label={`Match ${matchScore}`} tone="primary" />}
      </div>

      {salary && <p className="text-text-primary text-xs font-mono">{salary} / month</p>}

      {Array.isArray(matchReasons) && matchReasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {matchReasons.map((r, i) => (
            <span
              key={i}
              className="px-2 py-0.5 rounded-full bg-bg-secondary border border-border-light text-[10px] text-text-secondary"
            >
              {r}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function JobPortalSection() {
  const [tab, setTab] = useState('all');

  // Portal availability: staff logins without an employee record get a 400
  // with a clear message — that message is the screen for them.
  const [portalBlocked, setPortalBlocked] = useState<string | null>(null);

  const [jobs, setJobs] = useState<any[]>([]);
  const [featured, setFeatured] = useState<any[]>([]);
  const [recommended, setRecommended] = useState<any>(null);
  const [saved, setSaved] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('');
  const [workMode, setWorkMode] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const categoriesSeen = useRef<Set<string>>(new Set());

  const [savingJobId, setSavingJobId] = useState<number | null>(null);
  const [detailJobId, setDetailJobId] = useState<number | null>(null);
  const [referOpen, setReferOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      internalJobsApi.portalJobs({
        search: debouncedSearch || undefined,
        category: category || undefined,
        workMode: workMode || undefined,
        employmentType: employmentType || undefined,
        featured: featuredOnly ? true : undefined,
      }),
      internalJobsApi.featuredJobs().catch(() => []),
      internalJobsApi.recommendedJobs().catch(() => null),
      internalJobsApi.savedJobs().catch(() => []),
    ])
      .then(([list, feat, rec, sav]) => {
        const rows = Array.isArray(list) ? list : [];
        setJobs(rows);
        setFeatured(Array.isArray(feat) ? feat : []);
        setRecommended(rec ?? null);
        setSaved(Array.isArray(sav) ? sav : []);
        for (const j of rows) if (j?.category) categoriesSeen.current.add(String(j.category));
        setPortalBlocked(null);
      })
      .catch((err) => {
        if (isNoEmployeeLink(err)) setPortalBlocked(reason(err));
        else setError(reason(err));
      })
      .finally(() => setLoading(false));
  }, [debouncedSearch, category, workMode, employmentType, featuredOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSave = (job: any) => {
    const id = Number(job?.id);
    if (!Number.isFinite(id)) return;
    setSavingJobId(id);
    const call = job?.saved ? internalJobsApi.unsaveJob(id) : internalJobsApi.saveJob(id);
    call
      .then(() => load())
      .catch((err) => window.alert(reason(err)))
      .finally(() => setSavingJobId(null));
  };

  const categories = useMemo(() => Array.from(categoriesSeen.current).sort(), [jobs]);

  // No-employee-link accounts see the server's own explanation, nothing else.
  if (portalBlocked) {
    return (
      <div className="rounded-md bg-info-light border border-info/30 px-4 py-3 flex items-start gap-2">
        <Info size={16} className="text-info flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-text-primary text-sm font-medium">{portalBlocked}</p>
          <p className="text-text-secondary text-xs mt-0.5">
            The portal shows openings for the signed-in employee. Sign in with a self-service account linked to an
            employee record to browse and apply.
          </p>
        </div>
      </div>
    );
  }

  const recommendedJobs: any[] = Array.isArray(recommended?.jobs) ? recommended.jobs : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <TabBar
          tabs={[
            { id: 'all', label: 'All' },
            { id: 'saved', label: 'Saved', count: saved.length },
            { id: 'applications', label: 'My Applications' },
            { id: 'referrals', label: 'My Referrals' },
          ]}
          active={tab}
          onChange={setTab}
        />
        <button type="button" className={BTN_SECONDARY} onClick={() => setReferOpen(true)}>
          <span className="inline-flex items-center gap-1.5">
            <UserPlus size={14} /> Refer someone
          </span>
        </button>
      </div>

      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {tab === 'all' && (
        <div className="space-y-5">
          {/* Search + filter row ------------------------------------------- */}
          <div className="bg-bg-card border border-border-default rounded-md p-3 space-y-3">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-56">
                <label className={LABEL_CLS} htmlFor="jp-search">
                  Search openings
                </label>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    id="jp-search"
                    className={`${INPUT_CLS} pl-8`}
                    placeholder="Title or description…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="jp-category">
                  Category
                </label>
                <select
                  id="jp-category"
                  className={`${INPUT_CLS} w-40`}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {WORK_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setWorkMode(workMode === m ? '' : m)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                    workMode === m
                      ? 'bg-primary-light border-primary/30 text-primary'
                      : 'border-border-default text-text-muted hover:border-text-muted'
                  }`}
                >
                  {m}
                </button>
              ))}
              <span className="w-px h-5 bg-border-default" />
              {EMPLOYMENT_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setEmploymentType(employmentType === t.id ? '' : t.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                    employmentType === t.id
                      ? 'bg-primary-light border-primary/30 text-primary'
                      : 'border-border-default text-text-muted hover:border-text-muted'
                  }`}
                >
                  {t.label}
                </button>
              ))}
              <span className="w-px h-5 bg-border-default" />
              <button
                type="button"
                onClick={() => setFeaturedOnly((v) => !v)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all inline-flex items-center gap-1.5 ${
                  featuredOnly
                    ? 'bg-warning-light border-warning/30 text-warning'
                    : 'border-border-default text-text-muted hover:border-text-muted'
                }`}
              >
                <Star size={12} className={featuredOnly ? 'fill-current' : undefined} /> Featured
              </button>
            </div>
          </div>

          {loading && <LoadingBlock label="Loading the job portal…" />}

          {!loading && (
            <>
              {/* Featured rail --------------------------------------------- */}
              {featured.length > 0 && (
                <div className="space-y-2">
                  <p className="text-text-primary text-sm font-semibold inline-flex items-center gap-1.5">
                    <Star size={14} className="text-warning fill-warning" /> Featured
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {featured.map((j) => (
                      <JobCard
                        key={`feat-${j.id}`}
                        job={j}
                        onOpen={setDetailJobId}
                        onToggleSave={toggleSave}
                        saving={savingJobId === Number(j.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Recommended rail ------------------------------------------ */}
              {recommendedJobs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-text-primary text-sm font-semibold inline-flex items-center gap-1.5">
                    <Sparkles size={14} className="text-primary" /> Recommended for you
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {recommendedJobs.map((j) => (
                      <JobCard
                        key={`rec-${j.id}`}
                        job={j}
                        onOpen={setDetailJobId}
                        onToggleSave={toggleSave}
                        saving={savingJobId === Number(j.id)}
                        matchScore={num(j?.matchScore) ?? undefined}
                        matchReasons={Array.isArray(j?.matchReasons) ? j.matchReasons : undefined}
                      />
                    ))}
                  </div>
                  {recommended?.note && <p className="text-text-muted text-[11px]">{String(recommended.note)}</p>}
                </div>
              )}

              {/* Main grid ------------------------------------------------- */}
              <div className="space-y-2">
                <p className="text-text-primary text-sm font-semibold">
                  All openings <span className="text-text-muted font-normal text-xs">({jobs.length})</span>
                </p>
                {jobs.length === 0 ? (
                  <EmptyBlock message="No openings match these filters" />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {jobs.map((j) => (
                      <JobCard
                        key={j.id}
                        job={j}
                        onOpen={setDetailJobId}
                        onToggleSave={toggleSave}
                        saving={savingJobId === Number(j.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'saved' &&
        (loading ? (
          <LoadingBlock label="Loading saved jobs…" />
        ) : saved.length === 0 ? (
          <EmptyBlock message="No saved jobs yet" hint="Use the bookmark on any opening to keep it here." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {saved.map((j) => (
              <JobCard
                key={j.id}
                job={{ ...j, saved: true }}
                onOpen={setDetailJobId}
                onToggleSave={toggleSave}
                saving={savingJobId === Number(j.id)}
              />
            ))}
          </div>
        ))}

      {tab === 'applications' && <MyApplicationsTab onOpenJob={setDetailJobId} />}
      {tab === 'referrals' && <MyReferralsTab onRefer={() => setReferOpen(true)} />}

      <AnimatePresence>
        {detailJobId !== null && (
          <JobDetailModal jobId={detailJobId} onClose={() => setDetailJobId(null)} onChanged={load} onSwitchJob={setDetailJobId} />
        )}
        {referOpen && <ReferModal jobs={jobs} onClose={() => setReferOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job detail modal with the honest eligibility rendering and the apply form
// ---------------------------------------------------------------------------

function JobDetailModal({
  jobId,
  onClose,
  onChanged,
  onSwitchJob,
}: {
  jobId: number;
  onClose: () => void;
  onChanged: () => void;
  onSwitchJob: (id: number) => void;
}) {
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Apply form
  const [coverLetter, setCoverLetter] = useState('');
  const [noticeDays, setNoticeDays] = useState('');
  const [asDraft, setAsDraft] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyDone, setApplyDone] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    internalJobsApi
      .portalJob(jobId)
      .then((j) => setJob(j ?? null))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [jobId]);

  useEffect(() => {
    setApplyError(null);
    setApplyDone(null);
    load();
  }, [load]);

  const apply = () => {
    setApplyBusy(true);
    setApplyError(null);
    internalJobsApi
      .apply(jobId, {
        coverLetter: coverLetter.trim() || undefined,
        expectedNoticeDays: noticeDays === '' ? undefined : Number(noticeDays),
        draft: asDraft,
      })
      .then(() => {
        setApplyDone(asDraft ? 'Draft saved — submit it from My Applications when ready.' : 'Application submitted.');
        load();
        onChanged();
      })
      // Eligibility blocks come back as a 400 whose message embeds each failing
      // rule and its detail — shown here in the modal, next to the same checks
      // already rendered above, never as a browser alert.
      .catch((err) => setApplyError(reason(err)))
      .finally(() => setApplyBusy(false));
  };

  const checks: any[] = Array.isArray(job?.myEligibility?.checks) ? job.myEligibility.checks : [];
  const similar: any[] = Array.isArray(job?.similarJobs) ? job.similarJobs : [];
  const rules = ruleRows(job?.eligibilityRules);
  const salary = salaryRange(job?.salaryRangeMin, job?.salaryRangeMax);

  return (
    <ModalShell
      title={job ? String(job.title ?? 'Opening') : 'Opening'}
      subtitle={job ? `${text(job.jobCode)} · ${text(job.departmentName)} · ${text(job.location)}` : null}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      {loading ? (
        <LoadingBlock label="Loading the opening…" />
      ) : error ? (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      ) : job ? (
        <div className="space-y-4">
          <div className="flex items-center gap-1.5 flex-wrap">
            {job.isFeatured && <Chip label="Featured" tone="warning" />}
            <Chip label={text(job.workMode)} tone="default" />
            <Chip label={String(job.employmentType ?? '—').replace(/_/g, ' ')} tone={job.employmentType === 'GIG' ? 'info' : 'default'} />
            {job.category && <Chip label={String(job.category)} tone="default" />}
            {job.applied && <Chip label="Applied" tone="success" dot />}
            {job.saved && <Chip label="Saved" tone="primary" />}
            <Chip label={`${num(job.openings) ?? '—'} opening(s)`} tone="default" />
          </div>

          <p className="text-text-secondary text-sm whitespace-pre-wrap">{text(job.description)}</p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
            <div>
              <p className={LABEL_CLS}>Salary range</p>
              <p className="text-text-primary font-mono">{salary ? `${salary} / month` : 'Not disclosed'}</p>
            </div>
            <div>
              <p className={LABEL_CLS}>Role</p>
              <p className="text-text-secondary">{text(job.jobRoleName)}</p>
            </div>
            <div>
              <p className={LABEL_CLS}>Hiring manager</p>
              <p className="text-text-secondary">{text(job.hiringManagerName)}</p>
            </div>
            <div>
              <p className={LABEL_CLS}>Expires</p>
              <p className="text-text-secondary">{fmtDate(job.expiresAt)}</p>
            </div>
          </div>

          {rules.length > 0 && (
            <div className="rounded-md border border-border-default bg-bg-secondary p-3 space-y-1.5">
              <p className={LABEL_CLS}>Requirements</p>
              {rules.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-4 text-xs">
                  <span className="text-text-muted">{r.label}</span>
                  <span className="text-text-primary text-right">{r.value}</span>
                </div>
              ))}
            </div>
          )}

          {checks.length > 0 && (
            <div className="rounded-md border border-border-default p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className={LABEL_CLS}>Your eligibility</p>
                <Chip
                  label={job.myEligibility?.eligibilityPassed ? 'Eligible' : 'Not eligible yet'}
                  tone={job.myEligibility?.eligibilityPassed ? 'success' : 'danger'}
                  dot
                />
              </div>
              <div className="space-y-2">
                {checks.map((c, i) => (
                  <EligibilityCheckRow key={i} check={c} />
                ))}
              </div>
              <p className="text-text-muted text-[10px]">
                Rules that could not be evaluated warn but do not block — the detail says why.
              </p>
            </div>
          )}

          {similar.length > 0 && (
            <div className="space-y-1.5">
              <p className={LABEL_CLS}>Similar openings</p>
              {similar.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSwitchJob(Number(s.id))}
                  className="w-full text-left rounded-md border border-border-light bg-bg-secondary px-3 py-2 hover:border-primary/40 transition-colors"
                >
                  <span className="text-text-primary text-xs font-medium">{text(s.title)}</span>
                  <span className="text-text-muted text-[11px] font-mono ml-2">{text(s.jobCode)}</span>
                </button>
              ))}
            </div>
          )}

          {/* Apply ---------------------------------------------------------- */}
          {job.applied ? (
            <div className="rounded-md bg-success-light border border-success/30 px-3 py-2">
              <p className="text-success text-xs font-medium">You have applied to this opening — track it under My Applications.</p>
            </div>
          ) : (
            <div className="rounded-md border border-border-default p-3 space-y-3">
              <p className="text-text-primary text-sm font-semibold">Apply</p>
              {applyError && <ErrorBlock message={applyError} />}
              {applyDone && (
                <div className="rounded-md bg-success-light border border-success/30 px-3 py-2">
                  <p className="text-success text-xs font-medium">{applyDone}</p>
                </div>
              )}
              <div>
                <label className={LABEL_CLS}>Cover letter</label>
                <textarea
                  className={INPUT_CLS}
                  rows={3}
                  value={coverLetter}
                  onChange={(e) => setCoverLetter(e.target.value)}
                  placeholder="Why this move makes sense…"
                />
              </div>
              <div className="flex items-end gap-4 flex-wrap">
                <div className="w-44">
                  <label className={LABEL_CLS}>Expected notice (days)</label>
                  <input
                    type="number"
                    min={0}
                    className={INPUT_CLS}
                    value={noticeDays}
                    onChange={(e) => setNoticeDays(e.target.value)}
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer pb-2">
                  <input type="checkbox" checked={asDraft} onChange={(e) => setAsDraft(e.target.checked)} />
                  Save as draft (stores the eligibility result without submitting)
                </label>
              </div>
              <div className="flex justify-end">
                <button type="button" className={BTN_PRIMARY} disabled={applyBusy || !!applyDone} onClick={apply}>
                  {applyBusy ? 'Sending…' : asDraft ? 'Save draft' : 'Submit application'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// My Applications tab
// ---------------------------------------------------------------------------

function MyApplicationsTab({ onOpenJob }: { onOpenJob: (jobId: number) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [withdrawing, setWithdrawing] = useState<number | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    internalJobsApi
      .myApplications()
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const withdraw = (id: number) => {
    setBusy(true);
    internalJobsApi
      .withdrawApplication(id, withdrawReason.trim() || undefined)
      .then(() => {
        setWithdrawing(null);
        setWithdrawReason('');
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const submitDraft = (id: number) => {
    setBusy(true);
    internalJobsApi
      .submitApplication(id)
      .then(() => load())
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  if (loading) return <LoadingBlock label="Loading your applications…" />;
  if (error)
    return (
      <div className="space-y-2">
        <ErrorBlock message={error} />
        <button type="button" className={BTN_SECONDARY} onClick={load}>
          Retry
        </button>
      </div>
    );
  if (rows.length === 0) return <EmptyBlock message="You have not applied to anything yet" />;

  return (
    <div className="space-y-3">
      {rows.map((a) => {
        const timeline: any[] = Array.isArray(a?.timeline) ? a.timeline : [];
        const status = String(a?.status ?? '');
        const open = expanded === Number(a.id);
        const canWithdraw = !['WITHDRAWN', 'REJECTED', 'HIRED'].includes(status);
        return (
          <div key={a.id} className="bg-bg-card border border-border-default rounded-md p-4 space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <button
                  type="button"
                  className="text-text-primary text-sm font-semibold hover:text-primary transition-colors text-left"
                  onClick={() => onOpenJob(Number(a.jobId))}
                >
                  {text(a.jobTitle)}
                </button>
                <p className="text-text-muted text-[11px] font-mono">{text(a.jobCode)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Chip label={status.replace(/_/g, ' ')} tone={APPLICATION_TONE[status] ?? 'default'} dot />
                {a.eligibilityPassed === false && <Chip label="Eligibility failed" tone="danger" />}
                {a.eligibilityOverride && <Chip label="Eligibility overridden" tone="warning" />}
              </div>
            </div>

            {a.coverLetter && <p className="text-text-secondary text-xs">{String(a.coverLetter)}</p>}
            <div className="flex items-center gap-4 text-[11px] text-text-muted flex-wrap">
              {a.submittedAt && <span>Submitted {fmtDate(a.submittedAt)}</span>}
              {num(a.expectedNoticeDays) !== null && <span>Notice: {a.expectedNoticeDays} days</span>}
              {a.withdrawnAt && <span>Withdrawn {fmtDate(a.withdrawnAt)}{a.withdrawReason ? ` — ${a.withdrawReason}` : ''}</span>}
              {a.decisionNote && <span>Decision: {String(a.decisionNote)}</span>}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                className="text-primary text-xs font-medium hover:underline inline-flex items-center gap-1"
                onClick={() => setExpanded(open ? null : Number(a.id))}
              >
                {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Timeline ({timeline.length})
              </button>
              {status === 'DRAFT' && (
                <button
                  type="button"
                  className="text-primary text-xs font-medium hover:underline"
                  disabled={busy}
                  onClick={() => submitDraft(Number(a.id))}
                >
                  Submit draft
                </button>
              )}
              {canWithdraw && (
                <button
                  type="button"
                  className="text-danger text-xs font-medium hover:underline"
                  disabled={busy}
                  onClick={() => {
                    setWithdrawReason('');
                    setWithdrawing(withdrawing === Number(a.id) ? null : Number(a.id));
                  }}
                >
                  Withdraw
                </button>
              )}
            </div>

            {withdrawing === Number(a.id) && (
              <div className="flex items-end gap-2 flex-wrap rounded-md border border-border-light bg-bg-secondary p-3">
                <div className="flex-1 min-w-48">
                  <label className={LABEL_CLS}>Withdrawal reason</label>
                  <input
                    className={INPUT_CLS}
                    value={withdrawReason}
                    onChange={(e) => setWithdrawReason(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <button type="button" className={BTN_SECONDARY} onClick={() => setWithdrawing(null)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => withdraw(Number(a.id))}>
                  {busy ? 'Withdrawing…' : 'Confirm withdraw'}
                </button>
              </div>
            )}

            {open && (
              <div className="rounded-md border border-border-light bg-bg-secondary p-3 space-y-2">
                {timeline.length === 0 && <p className="text-text-muted text-xs">No timeline entries.</p>}
                {timeline.map((t) => (
                  <div key={t.id} className="flex items-start gap-2 text-xs">
                    <span className="text-text-muted font-mono flex-shrink-0">{fmtDate(t.createdAt)}</span>
                    <div>
                      <p className="text-text-primary">
                        {t.fromStatus ? `${String(t.fromStatus).replace(/_/g, ' ')} → ` : ''}
                        {String(t.toStatus ?? '').replace(/_/g, ' ')}
                      </p>
                      {t.note && <p className="text-text-muted">{String(t.note)}</p>}
                      {t.actorName && <p className="text-text-muted text-[10px]">by {String(t.actorName)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Referrals tab + refer modal
// ---------------------------------------------------------------------------

function MyReferralsTab({ onRefer }: { onRefer: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    internalJobsApi
      .myReferrals()
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingBlock label="Loading your referrals…" />;
  if (error)
    return (
      <div className="space-y-2">
        <ErrorBlock message={error} />
        <button type="button" className={BTN_SECONDARY} onClick={load}>
          Retry
        </button>
      </div>
    );

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <EmptyBlock message="You have not referred anyone yet" hint="Referrals that lead to a hire earn reward points." />
      ) : (
        rows.map((r) => {
          const kind = r?.referredEmployeeId ? 'INTERNAL' : 'EXTERNAL';
          const who = r?.referredName ?? r?.externalName ?? '—';
          return (
            <div key={r.id} className="bg-bg-card border border-border-default rounded-md p-4 space-y-1.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <p className="text-text-primary text-sm font-semibold">{text(who)}</p>
                <div className="flex items-center gap-2">
                  <Chip label={kind} tone={kind === 'INTERNAL' ? 'info' : 'default'} />
                  <Chip label={String(r?.status ?? '—').replace(/_/g, ' ')} tone={REFERRAL_TONE[r?.status] ?? 'default'} dot />
                </div>
              </div>
              <p className="text-text-muted text-xs">
                {r?.jobTitle ? `For ${r.jobTitle}` : 'General referral (no specific job)'} · {fmtDate(r?.createdAt)}
              </p>
              {r?.note && <p className="text-text-secondary text-xs">{String(r.note)}</p>}
              {num(r?.rewardPoints) !== null && num(r?.rewardPoints)! > 0 && (
                <Chip label={`${r.rewardPoints} reward points`} tone="success" />
              )}
            </div>
          );
        })
      )}
      <div>
        <button type="button" className={BTN_PRIMARY} onClick={onRefer}>
          <span className="inline-flex items-center gap-1.5">
            <UserPlus size={14} /> Refer someone
          </span>
        </button>
      </div>
    </div>
  );
}

function ReferModal({ jobs, onClose }: { jobs: any[]; onClose: () => void }) {
  const { employees } = useApp();
  const [kind, setKind] = useState<'internal' | 'external'>('internal');
  const [jobId, setJobId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [externalName, setExternalName] = useState('');
  const [externalPhone, setExternalPhone] = useState('');
  const [externalEmail, setExternalEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = () => {
    setBusy(true);
    setError(null);
    internalJobsApi
      .createReferral({
        jobId: jobId ? Number(jobId) : undefined,
        ...(kind === 'internal'
          ? { referredEmployeeId: Number(employeeId) }
          : {
              externalName: externalName.trim(),
              externalPhone: externalPhone.trim() || undefined,
              externalEmail: externalEmail.trim() || undefined,
            }),
        note: note.trim() || undefined,
      })
      .then(() => setDone(true))
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  const valid = kind === 'internal' ? employeeId !== '' : externalName.trim() !== '';

  return (
    <ModalShell
      title="Refer someone"
      subtitle="One referral per person per job — HR reviews every submission."
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && (
            <button type="button" className={BTN_PRIMARY} disabled={busy || !valid} onClick={save}>
              {busy ? 'Sending…' : 'Send referral'}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBlock message={error} />}
        {done ? (
          <div className="rounded-md bg-success-light border border-success/30 px-3 py-2">
            <p className="text-success text-xs font-medium">Referral submitted — you can track it under My Referrals.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {(['internal', 'external'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                    kind === k
                      ? 'bg-primary-light border-primary/30 text-primary'
                      : 'border-border-default text-text-muted hover:border-text-muted'
                  }`}
                >
                  {k === 'internal' ? 'Colleague (internal)' : 'External candidate'}
                </button>
              ))}
            </div>

            <div>
              <label className={LABEL_CLS}>Job (optional)</label>
              <select className={INPUT_CLS} value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">General — no specific job</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.jobCode} · {j.title}
                  </option>
                ))}
              </select>
            </div>

            {kind === 'internal' ? (
              <div>
                <label className={LABEL_CLS}>Colleague</label>
                <select className={INPUT_CLS} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                  <option value="">Select…</option>
                  {(employees ?? []).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.empCode} · {emp.fullName}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className={LABEL_CLS}>Name</label>
                  <input className={INPUT_CLS} value={externalName} onChange={(e) => setExternalName(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLS}>Phone</label>
                    <input className={INPUT_CLS} value={externalPhone} onChange={(e) => setExternalPhone(e.target.value)} />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Email</label>
                    <input className={INPUT_CLS} value={externalEmail} onChange={(e) => setExternalEmail(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className={LABEL_CLS}>Why this person?</label>
              <textarea className={INPUT_CLS} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <p className="text-text-muted text-[11px]">
              An accepted internal referral invites your colleague to apply — it never creates an application on their
              behalf. Accepted external referrals join the recruitment candidate pipeline.
            </p>
          </>
        )}
      </div>
    </ModalShell>
  );
}
