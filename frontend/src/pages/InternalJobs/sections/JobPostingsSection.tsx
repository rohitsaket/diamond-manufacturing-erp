import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Lock, Plus, RefreshCw, Star, X } from 'lucide-react';
import { internalJobsApi } from '../../../api/internalJobs';
import { orgApi } from '../../../api/organization';
import { useApp } from '../../../contexts/AppContext';
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
  inr,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';
import { TabBar } from '../../../components/common/TabBar';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const JOB_STATUSES = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'PAUSED', 'EXPIRED', 'ARCHIVED', 'FILLED', 'CANCELLED',
] as const;
const WORK_MODES = ['ONSITE', 'REMOTE', 'HYBRID'] as const;
const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'GIG', 'SHORT_TERM'] as const;

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

function statusTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'PUBLISHED':
      return 'success';
    case 'APPROVED':
      return 'info';
    case 'PENDING_APPROVAL':
    case 'PAUSED':
      return 'warning';
    case 'EXPIRED':
    case 'CANCELLED':
      return 'danger';
    case 'FILLED':
      return 'primary';
    default:
      return 'default';
  }
}

function employmentTone(type: unknown): Tone {
  switch (String(type ?? '').toUpperCase()) {
    case 'GIG':
      return 'warning';
    case 'SHORT_TERM':
      return 'info';
    default:
      return 'default';
  }
}

function salaryRange(min: unknown, max: unknown): string {
  const lo = num(min);
  const hi = num(max);
  if (lo === null && hi === null) return '—';
  if (lo !== null && hi !== null) return `${inr(lo)} – ${inr(hi)}`;
  return inr(lo ?? hi ?? 0);
}

// ---------------------------------------------------------------------------
// Tag input (free-entry chips) used by the eligibility rules editor.
// ---------------------------------------------------------------------------

function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          className={INPUT_CLS}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className={BTN_SECONDARY} onClick={add} disabled={draft.trim() === ''}>
          Add
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-bg-hover text-text-secondary border border-border-default"
            >
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                className="text-text-muted hover:text-danger"
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Eligibility rules editor (shared by job + template forms).
// ---------------------------------------------------------------------------

interface RulesForm {
  minTenureMonths: string;
  allowedGrades: string[];
  minPerformanceRating: string;
  requiredSkills: string[];
  requiredCertifications: string[];
  maxNoticeDays: string;
}

const EMPTY_RULES: RulesForm = {
  minTenureMonths: '',
  allowedGrades: [],
  minPerformanceRating: '',
  requiredSkills: [],
  requiredCertifications: [],
  maxNoticeDays: '',
};

function rulesFromJob(rules: any): RulesForm {
  if (!rules || typeof rules !== 'object') return { ...EMPTY_RULES };
  return {
    minTenureMonths: rules.minTenureMonths === null || rules.minTenureMonths === undefined ? '' : String(rules.minTenureMonths),
    allowedGrades: Array.isArray(rules.allowedGrades) ? rules.allowedGrades.map(String) : [],
    minPerformanceRating:
      rules.minPerformanceRating === null || rules.minPerformanceRating === undefined
        ? ''
        : String(rules.minPerformanceRating),
    requiredSkills: Array.isArray(rules.requiredSkills) ? rules.requiredSkills.map(String) : [],
    requiredCertifications: Array.isArray(rules.requiredCertifications)
      ? rules.requiredCertifications.map(String)
      : [],
    maxNoticeDays: rules.maxNoticeDays === null || rules.maxNoticeDays === undefined ? '' : String(rules.maxNoticeDays),
  };
}

function rulesToBody(r: RulesForm): Record<string, unknown> | null {
  const empty =
    r.minTenureMonths === '' &&
    r.allowedGrades.length === 0 &&
    r.minPerformanceRating === '' &&
    r.requiredSkills.length === 0 &&
    r.requiredCertifications.length === 0 &&
    r.maxNoticeDays === '';
  if (empty) return null;
  return {
    minTenureMonths: r.minTenureMonths === '' ? null : Number(r.minTenureMonths),
    allowedGrades: r.allowedGrades,
    minPerformanceRating: r.minPerformanceRating === '' ? null : Number(r.minPerformanceRating),
    requiredSkills: r.requiredSkills,
    requiredCertifications: r.requiredCertifications,
    maxNoticeDays: r.maxNoticeDays === '' ? null : Number(r.maxNoticeDays),
  };
}

function RulesEditor({ value, onChange }: { value: RulesForm; onChange: (next: RulesForm) => void }) {
  return (
    <div className="rounded-md border border-border-default p-3 space-y-3">
      <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">Eligibility rules</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={LABEL_CLS}>Min tenure (months)</label>
          <input
            type="number"
            min={0}
            className={INPUT_CLS}
            value={value.minTenureMonths}
            onChange={(e) => onChange({ ...value, minTenureMonths: e.target.value })}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Min performance rating</label>
          <input
            type="number"
            min={0}
            max={5}
            step={0.1}
            className={INPUT_CLS}
            value={value.minPerformanceRating}
            onChange={(e) => onChange({ ...value, minPerformanceRating: e.target.value })}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Max notice (days)</label>
          <input
            type="number"
            min={0}
            className={INPUT_CLS}
            value={value.maxNoticeDays}
            onChange={(e) => onChange({ ...value, maxNoticeDays: e.target.value })}
          />
        </div>
      </div>
      <div>
        <label className={LABEL_CLS}>Allowed grades</label>
        <TagInput
          values={value.allowedGrades}
          onChange={(allowedGrades) => onChange({ ...value, allowedGrades })}
          placeholder="e.g. A++ then Enter"
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Required skills</label>
        <TagInput
          values={value.requiredSkills}
          onChange={(requiredSkills) => onChange({ ...value, requiredSkills })}
          placeholder="e.g. Fancy shape polishing"
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Required certifications</label>
        <TagInput
          values={value.requiredCertifications}
          onChange={(requiredCertifications) => onChange({ ...value, requiredCertifications })}
          placeholder="e.g. GIA graduate"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const EMPTY_JOB_FORM = {
  title: '',
  description: '',
  category: '',
  requisitionId: '',
  departmentId: '',
  jobRoleId: '',
  grade: '',
  location: '',
  workMode: 'ONSITE',
  employmentType: 'FULL_TIME',
  openings: '1',
  salaryRangeMin: '',
  salaryRangeMax: '',
  visibility: 'ALL',
  visibilityDepartmentId: '',
  hiringManagerEmployeeId: '',
  isFeatured: false,
  isConfidential: false,
};

const EMPTY_TPL_FORM = {
  code: '',
  name: '',
  titleTemplate: '',
  descriptionTemplate: '',
  category: '',
  workMode: 'ONSITE',
  employmentType: 'FULL_TIME',
};

export function JobPostingsSection() {
  const { employees } = useApp();
  const [tab, setTab] = useState('postings');

  const [status, setStatus] = useState('ALL');
  const [jobs, setJobs] = useState<any[]>([]);
  const [appCounts, setAppCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [departments, setDepartments] = useState<any[]>([]);
  const [jobRoles, setJobRoles] = useState<any[]>([]);
  const [requisitions, setRequisitions] = useState<any[]>([]);

  // Detail modal.
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  // Publish modal.
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishAt, setPublishAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  // Create / edit modal.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_JOB_FORM });
  const [rules, setRules] = useState<RulesForm>({ ...EMPTY_RULES });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Templates tab.
  const [templates, setTemplates] = useState<any[]>([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [tplEditing, setTplEditing] = useState<any>(null);
  const [tplForm, setTplForm] = useState({ ...EMPTY_TPL_FORM });
  const [tplRules, setTplRules] = useState<RulesForm>({ ...EMPTY_RULES });
  const [tplSaving, setTplSaving] = useState(false);
  const [tplFormError, setTplFormError] = useState<string | null>(null);

  // Create-job-from-template modal.
  const [useTpl, setUseTpl] = useState<any>(null);
  const [useForm, setUseForm] = useState({ title: '', departmentId: '', jobRoleId: '', location: '', grade: '', openings: '1' });
  const [useError, setUseError] = useState<string | null>(null);
  const [using, setUsing] = useState(false);

  useEffect(() => {
    orgApi.departments.list().then((d: any) => setDepartments(Array.isArray(d) ? d : [])).catch(() => {});
    orgApi.jobRoles.list().then((r: any) => setJobRoles(Array.isArray(r) ? r : [])).catch(() => {});
    internalJobsApi
      .requisitions({ status: 'APPROVED' })
      .then((r) => setRequisitions(Array.isArray(r) ? r : []))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      internalJobsApi.jobs(status === 'ALL' ? {} : { status }),
      // The list rows do not carry applicationCount (only the detail does), so
      // the count per job is derived from the staff applications list.
      internalJobsApi.applications().catch(() => [] as any[]),
    ])
      .then(([list, apps]) => {
        setJobs(Array.isArray(list) ? list : []);
        const counts: Record<number, number> = {};
        for (const a of Array.isArray(apps) ? apps : []) {
          const jid = num(a?.jobId);
          if (jid !== null) counts[jid] = (counts[jid] ?? 0) + 1;
        }
        setAppCounts(counts);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const loadTemplates = useCallback(() => {
    setTplLoading(true);
    setTplError(null);
    internalJobsApi
      .jobTemplates()
      .then((rows) => setTemplates(Array.isArray(rows) ? rows : []))
      .catch((err) => setTplError(reason(err)))
      .finally(() => setTplLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'templates') loadTemplates();
  }, [tab, loadTemplates]);

  const loadDetail = useCallback((id: number) => {
    setDetailLoading(true);
    setDetailError(null);
    internalJobsApi
      .job(id)
      .then((d) => setDetail(d ?? null))
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

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_JOB_FORM });
    setRules({ ...EMPTY_RULES });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (j: any) => {
    setEditing(j);
    setForm({
      title: String(j?.title ?? ''),
      description: String(j?.description ?? ''),
      category: String(j?.category ?? ''),
      requisitionId: j?.requisitionId === null || j?.requisitionId === undefined ? '' : String(j.requisitionId),
      departmentId: j?.departmentId === null || j?.departmentId === undefined ? '' : String(j.departmentId),
      jobRoleId: j?.jobRoleId === null || j?.jobRoleId === undefined ? '' : String(j.jobRoleId),
      grade: String(j?.grade ?? ''),
      location: String(j?.location ?? ''),
      workMode: String(j?.workMode ?? 'ONSITE'),
      employmentType: String(j?.employmentType ?? 'FULL_TIME'),
      openings: String(j?.openings ?? 1),
      salaryRangeMin: j?.salaryRangeMin === null || j?.salaryRangeMin === undefined ? '' : String(j.salaryRangeMin),
      salaryRangeMax: j?.salaryRangeMax === null || j?.salaryRangeMax === undefined ? '' : String(j.salaryRangeMax),
      visibility: String(j?.visibility ?? 'ALL'),
      visibilityDepartmentId:
        j?.visibilityDepartmentId === null || j?.visibilityDepartmentId === undefined
          ? ''
          : String(j.visibilityDepartmentId),
      hiringManagerEmployeeId:
        j?.hiringManagerEmployeeId === null || j?.hiringManagerEmployeeId === undefined
          ? ''
          : String(j.hiringManagerEmployeeId),
      isFeatured: !!j?.isFeatured,
      isConfidential: !!j?.isConfidential,
    });
    setRules(rulesFromJob(j?.eligibilityRules));
    setFormError(null);
    setFormOpen(true);
  };

  const save = () => {
    setSaving(true);
    setFormError(null);
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      category: form.category.trim() || null,
      requisitionId: form.requisitionId === '' ? null : Number(form.requisitionId),
      departmentId: form.departmentId === '' ? null : Number(form.departmentId),
      jobRoleId: form.jobRoleId === '' ? null : Number(form.jobRoleId),
      grade: form.grade.trim() || null,
      location: form.location.trim() || null,
      workMode: form.workMode,
      employmentType: form.employmentType,
      openings: form.openings === '' ? 1 : Number(form.openings),
      salaryRangeMin: form.salaryRangeMin === '' ? null : Number(form.salaryRangeMin),
      salaryRangeMax: form.salaryRangeMax === '' ? null : Number(form.salaryRangeMax),
      visibility: form.visibility,
      visibilityDepartmentId: form.visibilityDepartmentId === '' ? null : Number(form.visibilityDepartmentId),
      hiringManagerEmployeeId: form.hiringManagerEmployeeId === '' ? null : Number(form.hiringManagerEmployeeId),
      isFeatured: form.isFeatured,
      isConfidential: form.isConfidential,
      eligibilityRules: rulesToBody(rules),
    };
    const call = editing
      ? internalJobsApi.updateJob(Number(editing.id), body)
      : internalJobsApi.createJob(body);
    call
      .then(() => {
        setFormOpen(false);
        load();
        if (editing && detailId !== null) loadDetail(detailId);
      })
      .catch((err) => setFormError(reason(err)))
      .finally(() => setSaving(false));
  };

  const runPublish = () => {
    if (detailId === null) return;
    setPublishing(true);
    setPublishError(null);
    const body: { publishAt?: string; expiresAt?: string } = {};
    if (publishAt) body.publishAt = publishAt;
    if (expiresAt) body.expiresAt = expiresAt;
    internalJobsApi
      .publishJob(detailId, body)
      .then(() => {
        setPublishOpen(false);
        loadDetail(detailId);
        load();
      })
      .catch((err) => setPublishError(reason(err)))
      .finally(() => setPublishing(false));
  };

  const openTplModal = (tpl: any | null) => {
    setTplEditing(tpl);
    setTplForm({
      code: String(tpl?.code ?? ''),
      name: String(tpl?.name ?? ''),
      titleTemplate: String(tpl?.titleTemplate ?? ''),
      descriptionTemplate: String(tpl?.descriptionTemplate ?? ''),
      category: String(tpl?.category ?? ''),
      workMode: String(tpl?.workMode ?? 'ONSITE'),
      employmentType: String(tpl?.employmentType ?? 'FULL_TIME'),
    });
    setTplRules(rulesFromJob(tpl?.eligibilityRules));
    setTplFormError(null);
    setTplModalOpen(true);
  };

  const saveTemplate = () => {
    setTplSaving(true);
    setTplFormError(null);
    const body: Record<string, unknown> = {
      code: tplForm.code.trim(),
      name: tplForm.name.trim(),
      titleTemplate: tplForm.titleTemplate.trim(),
      descriptionTemplate: tplForm.descriptionTemplate.trim() || null,
      category: tplForm.category.trim() || null,
      workMode: tplForm.workMode,
      employmentType: tplForm.employmentType,
      eligibilityRules: rulesToBody(tplRules),
    };
    const call = tplEditing
      ? internalJobsApi.updateJobTemplate(Number(tplEditing.id), body)
      : internalJobsApi.createJobTemplate(body);
    call
      .then(() => {
        setTplModalOpen(false);
        loadTemplates();
      })
      .catch((err) => setTplFormError(reason(err)))
      .finally(() => setTplSaving(false));
  };

  const runUseTemplate = () => {
    if (!useTpl) return;
    setUsing(true);
    setUseError(null);
    const overrides: Record<string, unknown> = {};
    if (useForm.title.trim()) overrides.title = useForm.title.trim();
    if (useForm.departmentId !== '') overrides.departmentId = Number(useForm.departmentId);
    if (useForm.jobRoleId !== '') overrides.jobRoleId = Number(useForm.jobRoleId);
    if (useForm.location.trim()) overrides.location = useForm.location.trim();
    if (useForm.grade.trim()) overrides.grade = useForm.grade.trim();
    if (useForm.openings !== '') overrides.openings = Number(useForm.openings);
    internalJobsApi
      .jobFromTemplate({ templateId: Number(useTpl.id), overrides })
      .then((created) => {
        setUseTpl(null);
        setTab('postings');
        load();
        if (num(created?.id) !== null) setDetailId(Number(created.id));
      })
      .catch((err) => setUseError(reason(err)))
      .finally(() => setUsing(false));
  };

  const detailStatus = String(detail?.status ?? '');
  const detailRules = detail?.eligibilityRules ?? null;
  const ruleEntries = useMemo(() => {
    if (!detailRules || typeof detailRules !== 'object') return [] as [string, unknown][];
    return Object.entries(detailRules as Record<string, unknown>).filter(
      ([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0),
    );
  }, [detailRules]);

  if (firstLoad && loading) return <LoadingBlock label="Loading job postings…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <TabBar
          tabs={[
            { id: 'postings', label: 'Postings' },
            { id: 'templates', label: 'Templates' },
          ]}
          active={tab}
          onChange={setTab}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={tab === 'templates' ? loadTemplates : load}
            disabled={loading || tplLoading}
          >
            <span className="inline-flex items-center gap-2">
              <RefreshCw size={14} className={loading || tplLoading ? 'animate-spin' : undefined} />
              Refresh
            </span>
          </button>
          {tab === 'postings' ? (
            <button type="button" className={BTN_PRIMARY} onClick={openCreate}>
              <span className="inline-flex items-center gap-2">
                <Plus size={14} />
                New posting
              </span>
            </button>
          ) : (
            <button type="button" className={BTN_PRIMARY} onClick={() => openTplModal(null)}>
              <span className="inline-flex items-center gap-2">
                <Plus size={14} />
                New template
              </span>
            </button>
          )}
        </div>
      </div>

      {/* --- Postings tab ----------------------------------------------------- */}
      {tab === 'postings' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {(['ALL', ...JOB_STATUSES] as string[]).map((s) => (
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

          {jobs.length === 0 && !error ? (
            <EmptyBlock message="No postings match this filter" />
          ) : (
            <TableShell
              headers={[
                'Job code', 'Title', 'Department', 'Mode', 'Type', 'Openings', 'Status', 'Published', 'Expires', 'Apps',
              ]}
            >
              {jobs.map((j, index) => (
                <tr
                  key={j?.id ?? index}
                  className="hover:bg-bg-hover transition-colors cursor-pointer"
                  onClick={() => (num(j?.id) === null ? undefined : setDetailId(Number(j.id)))}
                >
                  <td className="px-3 py-2 text-xs text-text-primary font-mono whitespace-nowrap">
                    {text(j?.jobCode)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-primary max-w-[260px]">
                    <span className="inline-flex items-center gap-1.5">
                      {!!j?.isFeatured && <Star size={13} className="text-warning flex-shrink-0" fill="currentColor" />}
                      {!!j?.isConfidential && <Lock size={13} className="text-text-muted flex-shrink-0" />}
                      <span className="line-clamp-2">{text(j?.title)}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                    {text(j?.departmentName)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(j?.workMode)} tone="default" />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip
                      label={text(j?.employmentType).replace(/_/g, ' ')}
                      tone={employmentTone(j?.employmentType)}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {text(j?.openings)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(j?.status).replace(/_/g, ' ')} tone={statusTone(j?.status)} dot />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDate(j?.publishedAt)}</td>
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDate(j?.expiresAt)}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {appCounts[Number(j?.id)] ?? num(j?.applicationCount) ?? 0}
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}

      {/* --- Templates tab ------------------------------------------------------ */}
      {tab === 'templates' && (
        <div className="space-y-3">
          {tplLoading && <LoadingBlock label="Loading templates…" />}
          {tplError && <ErrorBlock message={tplError} />}
          {!tplLoading && !tplError && templates.length === 0 && <EmptyBlock message="No job templates yet" />}
          {!tplLoading && !tplError && templates.length > 0 && (
            <TableShell headers={['Code', 'Name', 'Title template', 'Category', 'Mode', 'Type', 'Active', 'Actions']}>
              {templates.map((t, index) => (
                <tr key={t?.id ?? index} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs text-text-muted font-mono whitespace-nowrap">{text(t?.code)}</td>
                  <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{text(t?.name)}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary max-w-[240px]">
                    <span className="line-clamp-2">{text(t?.titleTemplate)}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(t?.category)}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(t?.workMode)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip
                      label={text(t?.employmentType).replace(/_/g, ' ')}
                      tone={employmentTone(t?.employmentType)}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={t?.isActive ? 'Active' : 'Inactive'} tone={t?.isActive ? 'success' : 'default'} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline"
                        onClick={() => openTplModal(t)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline"
                        onClick={() => {
                          setUseTpl(t);
                          setUseForm({ title: '', departmentId: '', jobRoleId: '', location: '', grade: '', openings: '1' });
                          setUseError(null);
                        }}
                      >
                        Create job
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}

      {/* --- Detail modal ------------------------------------------------------- */}
      <AnimatePresence>
        {detailId !== null && (
          <ModalShell
            title={detail ? `${text(detail.jobCode)} · ${text(detail.title)}` : 'Job posting'}
            subtitle={detail ? `${text(detail.departmentName)} · ${text(detail.location)}` : null}
            onClose={() => setDetailId(null)}
            maxWidth="max-w-3xl"
          >
            {detailLoading && <LoadingBlock label="Loading the posting…" />}
            {detailError && <ErrorBlock message={detailError} />}
            {!detailLoading && detail && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Chip label={text(detail.status).replace(/_/g, ' ')} tone={statusTone(detail.status)} dot />
                  <Chip label={text(detail.workMode)} tone="default" />
                  <Chip
                    label={text(detail.employmentType).replace(/_/g, ' ')}
                    tone={employmentTone(detail.employmentType)}
                  />
                  {!!detail.isFeatured && <Chip label="Featured" tone="warning" />}
                  {!!detail.isConfidential && <Chip label="Confidential" tone="danger" />}
                  <Chip
                    label={
                      detail.visibility === 'DEPARTMENT'
                        ? `Visible to department #${text(detail.visibilityDepartmentId)}`
                        : 'Visible to all'
                    }
                    tone="default"
                  />
                </div>

                {detail.description && <p className="text-text-secondary text-sm">{String(detail.description)}</p>}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                  <div>
                    <p className={LABEL_CLS}>Openings</p>
                    <p className="text-text-secondary font-mono">{text(detail.openings)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Salary range</p>
                    <p className="text-text-secondary font-mono">
                      {salaryRange(detail.salaryRangeMin, detail.salaryRangeMax)}
                    </p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Published</p>
                    <p className="text-text-secondary">{fmtDate(detail.publishedAt)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Expires</p>
                    <p className="text-text-secondary">{fmtDate(detail.expiresAt)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Hiring manager</p>
                    <p className="text-text-secondary">{text(detail.hiringManagerName)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Grade</p>
                    <p className="text-text-secondary">{text(detail.grade)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Role</p>
                    <p className="text-text-secondary">{text(detail.jobRoleName)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Applications</p>
                    <p className="text-text-secondary font-mono">{text(detail.applicationCount)}</p>
                  </div>
                </div>

                <div>
                  <p className={LABEL_CLS}>Eligibility rules</p>
                  {ruleEntries.length === 0 ? (
                    <p className="text-text-muted text-xs italic">No eligibility rules — every employee may apply.</p>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      {ruleEntries.map(([k, v]) => (
                        <Chip key={k} label={`${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`} tone="default" />
                      ))}
                    </div>
                  )}
                </div>

                {/* Lifecycle actions by status ------------------------------- */}
                <div className="flex items-center gap-2 flex-wrap">
                  {detailStatus === 'DRAFT' && (
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      disabled={acting}
                      onClick={() => act(() => internalJobsApi.submitJob(Number(detail.id)))}
                    >
                      Submit for approval
                    </button>
                  )}
                  {detailStatus === 'PENDING_APPROVAL' && (
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      disabled={acting}
                      onClick={() => act(() => internalJobsApi.approveJob(Number(detail.id)))}
                    >
                      Approve
                    </button>
                  )}
                  {detailStatus === 'APPROVED' && (
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      disabled={acting}
                      onClick={() => {
                        setPublishAt('');
                        setExpiresAt('');
                        setPublishError(null);
                        setPublishOpen(true);
                      }}
                    >
                      Publish…
                    </button>
                  )}
                  {detailStatus === 'PUBLISHED' && (
                    <>
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        disabled={acting}
                        onClick={() => act(() => internalJobsApi.pauseJob(Number(detail.id)))}
                      >
                        Pause
                      </button>
                      <button
                        type="button"
                        className={BTN_PRIMARY}
                        disabled={acting}
                        onClick={() => {
                          if (window.confirm('Mark this posting as filled?'))
                            act(() => internalJobsApi.fillJob(Number(detail.id)));
                        }}
                      >
                        Mark filled
                      </button>
                    </>
                  )}
                  {detailStatus === 'PAUSED' && (
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      disabled={acting}
                      onClick={() => act(() => internalJobsApi.resumeJob(Number(detail.id)))}
                    >
                      Resume
                    </button>
                  )}
                  {(detailStatus === 'EXPIRED' || detailStatus === 'FILLED') && (
                    <button
                      type="button"
                      className={BTN_SECONDARY}
                      disabled={acting}
                      onClick={() => act(() => internalJobsApi.archiveJob(Number(detail.id)))}
                    >
                      Archive
                    </button>
                  )}
                  {(detailStatus === 'DRAFT' || detailStatus === 'PENDING_APPROVAL') && (
                    <button type="button" className={BTN_SECONDARY} onClick={() => openEdit(detail)}>
                      Edit
                    </button>
                  )}
                  {detailStatus !== 'ARCHIVED' &&
                    detailStatus !== 'CANCELLED' &&
                    detailStatus !== 'FILLED' &&
                    detailStatus !== 'EXPIRED' && (
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        disabled={acting}
                        onClick={() => {
                          if (window.confirm('Cancel this posting?'))
                            act(() => internalJobsApi.cancelJob(Number(detail.id)));
                        }}
                      >
                        Cancel posting
                      </button>
                    )}
                </div>
              </div>
            )}
          </ModalShell>
        )}
      </AnimatePresence>

      {/* --- Publish modal ------------------------------------------------------ */}
      <AnimatePresence>
        {publishOpen && (
          <ModalShell
            title="Publish this posting"
            onClose={() => setPublishOpen(false)}
            maxWidth="max-w-md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setPublishOpen(false)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={runPublish} disabled={publishing}>
                  {publishing ? 'Publishing…' : publishAt ? 'Schedule publish' : 'Publish now'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {publishError && <ErrorBlock message={publishError} />}
              <div>
                <label className={LABEL_CLS}>Publish at (optional)</label>
                <input
                  type="datetime-local"
                  className={INPUT_CLS}
                  value={publishAt}
                  onChange={(e) => setPublishAt(e.target.value)}
                />
                <p className="text-text-muted text-[11px] mt-1">
                  Leave empty to publish immediately. A future time schedules the publish — there is no background
                  scheduler process, so the posting flips to PUBLISHED lazily on the first read after that moment.
                </p>
              </div>
              <div>
                <label className={LABEL_CLS}>Expires at (optional)</label>
                <input
                  type="datetime-local"
                  className={INPUT_CLS}
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
                <p className="text-text-muted text-[11px] mt-1">
                  Expiry is also resolved lazily at read time; it must fall after the publish time.
                </p>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* --- Create / edit posting modal ---------------------------------------- */}
      <AnimatePresence>
        {formOpen && (
          <ModalShell
            title={editing ? `Edit ${text(editing.jobCode)}` : 'New job posting'}
            onClose={() => setFormOpen(false)}
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setFormOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={save}
                  disabled={saving || form.title.trim() === ''}
                >
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create posting'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {formError && <ErrorBlock message={formError} />}
              <div>
                <label className={LABEL_CLS}>Title</label>
                <input
                  className={INPUT_CLS}
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Description</label>
                <textarea
                  className={`${INPUT_CLS} min-h-[70px]`}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={LABEL_CLS}>Requisition</label>
                  <select
                    className={INPUT_CLS}
                    value={form.requisitionId}
                    onChange={(e) => setForm((f) => ({ ...f, requisitionId: e.target.value }))}
                  >
                    <option value="">None</option>
                    {requisitions.map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.reqCode} · {r.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Department</label>
                  <select
                    className={INPUT_CLS}
                    value={form.departmentId}
                    onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
                  >
                    <option value="">Select…</option>
                    {departments.map((d: any) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Job role</label>
                  <select
                    className={INPUT_CLS}
                    value={form.jobRoleId}
                    onChange={(e) => setForm((f) => ({ ...f, jobRoleId: e.target.value }))}
                  >
                    <option value="">Select…</option>
                    {jobRoles.map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className={LABEL_CLS}>Category</label>
                  <input
                    className={INPUT_CLS}
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Grade</label>
                  <input
                    className={INPUT_CLS}
                    value={form.grade}
                    onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Location</label>
                  <input
                    className={INPUT_CLS}
                    value={form.location}
                    onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Openings</label>
                  <input
                    type="number"
                    min={1}
                    className={INPUT_CLS}
                    value={form.openings}
                    onChange={(e) => setForm((f) => ({ ...f, openings: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className={LABEL_CLS}>Work mode</label>
                  <select
                    className={INPUT_CLS}
                    value={form.workMode}
                    onChange={(e) => setForm((f) => ({ ...f, workMode: e.target.value }))}
                  >
                    {WORK_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Employment type</label>
                  <select
                    className={INPUT_CLS}
                    value={form.employmentType}
                    onChange={(e) => setForm((f) => ({ ...f, employmentType: e.target.value }))}
                  >
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Salary min (monthly)</label>
                  <input
                    type="number"
                    min={0}
                    className={INPUT_CLS}
                    value={form.salaryRangeMin}
                    onChange={(e) => setForm((f) => ({ ...f, salaryRangeMin: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Salary max (monthly)</label>
                  <input
                    type="number"
                    min={0}
                    className={INPUT_CLS}
                    value={form.salaryRangeMax}
                    onChange={(e) => setForm((f) => ({ ...f, salaryRangeMax: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={LABEL_CLS}>Visibility</label>
                  <select
                    className={INPUT_CLS}
                    value={form.visibility}
                    onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value }))}
                  >
                    <option value="ALL">ALL — every employee</option>
                    <option value="DEPARTMENT">DEPARTMENT — one department only</option>
                  </select>
                </div>
                {form.visibility === 'DEPARTMENT' && (
                  <div>
                    <label className={LABEL_CLS}>Visible to department</label>
                    <select
                      className={INPUT_CLS}
                      value={form.visibilityDepartmentId}
                      onChange={(e) => setForm((f) => ({ ...f, visibilityDepartmentId: e.target.value }))}
                    >
                      <option value="">Select department…</option>
                      {departments.map((d: any) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className={LABEL_CLS}>Hiring manager</label>
                  <select
                    className={INPUT_CLS}
                    value={form.hiringManagerEmployeeId}
                    onChange={(e) => setForm((f) => ({ ...f, hiringManagerEmployeeId: e.target.value }))}
                  >
                    <option value="">None</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName} ({e.empCode})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-5">
                <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isFeatured}
                    onChange={(e) => setForm((f) => ({ ...f, isFeatured: e.target.checked }))}
                  />
                  Featured on the portal
                </label>
                <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isConfidential}
                    onChange={(e) => setForm((f) => ({ ...f, isConfidential: e.target.checked }))}
                  />
                  Confidential (admin/hr only)
                </label>
              </div>
              <RulesEditor value={rules} onChange={setRules} />
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* --- Template create/edit modal ------------------------------------------ */}
      <AnimatePresence>
        {tplModalOpen && (
          <ModalShell
            title={tplEditing ? `Edit template ${text(tplEditing.code)}` : 'New job template'}
            onClose={() => setTplModalOpen(false)}
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setTplModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={saveTemplate}
                  disabled={tplSaving || tplForm.code.trim() === '' || tplForm.name.trim() === ''}
                >
                  {tplSaving ? 'Saving…' : tplEditing ? 'Save changes' : 'Create template'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {tplFormError && <ErrorBlock message={tplFormError} />}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Code</label>
                  <input
                    className={INPUT_CLS}
                    value={tplForm.code}
                    onChange={(e) => setTplForm((f) => ({ ...f, code: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Name</label>
                  <input
                    className={INPUT_CLS}
                    value={tplForm.name}
                    onChange={(e) => setTplForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Title template</label>
                <input
                  className={INPUT_CLS}
                  value={tplForm.titleTemplate}
                  onChange={(e) => setTplForm((f) => ({ ...f, titleTemplate: e.target.value }))}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Description template</label>
                <textarea
                  className={`${INPUT_CLS} min-h-[60px]`}
                  value={tplForm.descriptionTemplate}
                  onChange={(e) => setTplForm((f) => ({ ...f, descriptionTemplate: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={LABEL_CLS}>Category</label>
                  <input
                    className={INPUT_CLS}
                    value={tplForm.category}
                    onChange={(e) => setTplForm((f) => ({ ...f, category: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Work mode</label>
                  <select
                    className={INPUT_CLS}
                    value={tplForm.workMode}
                    onChange={(e) => setTplForm((f) => ({ ...f, workMode: e.target.value }))}
                  >
                    {WORK_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Employment type</label>
                  <select
                    className={INPUT_CLS}
                    value={tplForm.employmentType}
                    onChange={(e) => setTplForm((f) => ({ ...f, employmentType: e.target.value }))}
                  >
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <RulesEditor value={tplRules} onChange={setTplRules} />
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* --- Create job from template modal --------------------------------------- */}
      <AnimatePresence>
        {useTpl && (
          <ModalShell
            title={`Create a job from "${text(useTpl.name)}"`}
            subtitle="Overrides are optional — the template supplies the rest. The job is created as a DRAFT."
            onClose={() => setUseTpl(null)}
            maxWidth="max-w-lg"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setUseTpl(null)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={runUseTemplate} disabled={using}>
                  {using ? 'Creating…' : 'Create job'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {useError && <ErrorBlock message={useError} />}
              <div>
                <label className={LABEL_CLS}>Title override</label>
                <input
                  className={INPUT_CLS}
                  value={useForm.title}
                  placeholder={String(useTpl.titleTemplate ?? '')}
                  onChange={(e) => setUseForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Department</label>
                  <select
                    className={INPUT_CLS}
                    value={useForm.departmentId}
                    onChange={(e) => setUseForm((f) => ({ ...f, departmentId: e.target.value }))}
                  >
                    <option value="">From template / none</option>
                    {departments.map((d: any) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Job role</label>
                  <select
                    className={INPUT_CLS}
                    value={useForm.jobRoleId}
                    onChange={(e) => setUseForm((f) => ({ ...f, jobRoleId: e.target.value }))}
                  >
                    <option value="">From template / none</option>
                    {jobRoles.map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Location</label>
                  <input
                    className={INPUT_CLS}
                    value={useForm.location}
                    onChange={(e) => setUseForm((f) => ({ ...f, location: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Grade</label>
                  <input
                    className={INPUT_CLS}
                    value={useForm.grade}
                    onChange={(e) => setUseForm((f) => ({ ...f, grade: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Openings</label>
                  <input
                    type="number"
                    min={1}
                    className={INPUT_CLS}
                    value={useForm.openings}
                    onChange={(e) => setUseForm((f) => ({ ...f, openings: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
