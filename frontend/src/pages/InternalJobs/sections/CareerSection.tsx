import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Info, Plus, Star, X } from 'lucide-react';
import { internalHiringApi } from '../../../api/internalJobs';
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
  StatCard,
  TableShell,
} from '../../../components/common/HrmsUI';
import { TabBar } from '../../../components/common/TabBar';
import { useApp } from '../../../contexts/AppContext';
import { useAuth, isStaffRole } from '../../../contexts/AuthContext';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const WORK_MODE_PREFS = ['ANY', 'ONSITE', 'REMOTE', 'HYBRID'];

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

const READINESS_TONE: Record<string, Tone> = {
  READY_NOW: 'success',
  READY_1_YEAR: 'info',
  READY_2_YEARS: 'warning',
  DEVELOPMENT_NEEDED: 'default',
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

function InfoCard({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="rounded-md bg-info-light border border-info/30 px-4 py-3 flex items-start gap-2">
      <Info size={16} className="text-info flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-text-primary text-sm">{message}</p>
        {hint && <p className="text-text-secondary text-xs mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

/** Chip list with an inline add box — used for preferred roles/departments. */
function TagInput({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft('');
  };

  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
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
        <button type="button" className={BTN_SECONDARY} onClick={add} aria-label={`Add ${label}`}>
          <Plus size={14} />
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-light border border-primary/30 text-primary text-xs"
            >
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                className="hover:text-danger transition-colors"
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <X size={11} />
              </button>
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

export function CareerSection() {
  const [tab, setTab] = useState('me');

  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { id: 'me', label: 'My Career' },
          { id: 'interests', label: 'Career Interests' },
          { id: 'roadmaps', label: 'Roadmaps (staff)' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'me' && <MyCareerTab />}
      {tab === 'interests' && <InterestsTab />}
      {tab === 'roadmaps' && <RoadmapsTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Career dashboard
// ---------------------------------------------------------------------------

function MyCareerTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    internalHiringApi
      .myCareerDashboard()
      .then((res) => {
        setData(res ?? null);
        setBlocked(null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 400) setBlocked(reason(err));
        else setError(reason(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingBlock label="Loading your career dashboard…" />;
  if (blocked)
    return (
      <InfoCard
        message={blocked}
        hint="The career dashboard belongs to the signed-in employee — staff accounts without an employee link have no dashboard to show."
      />
    );
  if (error)
    return (
      <div className="space-y-2">
        <ErrorBlock message={error} />
        <button type="button" className={BTN_SECONDARY} onClick={load}>
          Retry
        </button>
      </div>
    );
  if (!data) return <EmptyBlock message="No career data" />;

  const applications: Record<string, number> =
    data.applications && typeof data.applications === 'object' ? data.applications : {};
  const appEntries = Object.entries(applications);
  const openOffers: any[] = Array.isArray(data.openOffers) ? data.openOffers : [];
  const readiness = data.promotionReadiness ?? null;
  const roadmap = data.roadmap ?? null;
  const slots: any[] = Array.isArray(readiness?.successionSlots) ? readiness.successionSlots : [];
  const talent = readiness?.talentAssessment ?? null;
  const paths: any[] = Array.isArray(roadmap?.paths) ? roadmap.paths : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-text-primary text-base font-semibold">{text(data.employee?.name)}</p>
        {data.employee?.grade && <Chip label={`Grade ${data.employee.grade}`} tone="default" />}
      </div>

      {/* Applications + saved -------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <p className="text-text-muted text-xs uppercase tracking-wider mb-2">My applications</p>
          {appEntries.length === 0 ? (
            <p className="text-text-muted text-xs">None yet</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {appEntries.map(([status, count]) => (
                <Chip
                  key={status}
                  label={`${status.replace(/_/g, ' ')}: ${count}`}
                  tone={APPLICATION_TONE[status] ?? 'default'}
                />
              ))}
            </div>
          )}
        </div>
        <StatCard label="Saved jobs" value={Number(data.savedJobs ?? 0)} hint="Bookmarked on the portal" />
        <StatCard
          label="Open offers"
          value={openOffers.length}
          intent={openOffers.length > 0 ? 'info' : 'default'}
          hint="Awaiting your response"
        />
      </div>

      {/* Open offers ------------------------------------------------------ */}
      {openOffers.length > 0 && (
        <div className="space-y-2">
          <p className="text-text-primary text-sm font-semibold">Open offers</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {openOffers.map((o) => (
              <div key={o.id} className="bg-bg-card border border-border-default rounded-md p-3 space-y-1">
                <p className="text-text-primary text-sm font-medium">{text(o.title)}</p>
                <p className="text-text-muted text-[11px] font-mono">{text(o.offerCode)}</p>
                <div className="flex items-center gap-2 text-[11px] text-text-muted">
                  <Chip label={String(o.offerType ?? '—').replace(/_/g, ' ')} tone="primary" />
                  <span>Respond by {fmtDate(o.validUntil)}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-text-muted text-[11px]">Respond to offers from Internal Jobs → Offers → My Offers.</p>
        </div>
      )}

      {/* Promotion readiness ---------------------------------------------- */}
      <div className="bg-bg-card border border-border-default rounded-md p-4 space-y-3">
        <p className="text-text-primary text-sm font-semibold">Promotion readiness</p>
        {!readiness || readiness.available === false ? (
          <InfoCard message={String(readiness?.reason ?? 'No readiness data is available for you yet.')} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className={LABEL_CLS}>Succession slots you are named in</p>
              {slots.length === 0 ? (
                <p className="text-text-muted text-xs">You are not currently named in any succession plan.</p>
              ) : (
                slots.map((s, i) => (
                  <div key={i} className="rounded-md border border-border-light bg-bg-secondary px-3 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-text-primary text-xs font-medium truncate">{text(s.position)}</p>
                      <p className="text-text-muted text-[10px]">
                        Rank #{text(s.ranking)} · {text(s.criticality)} criticality
                      </p>
                    </div>
                    <Chip label={text(s.readiness).replace(/_/g, ' ')} tone={READINESS_TONE[s.readiness] ?? 'default'} />
                  </div>
                ))
              )}
            </div>
            <div className="space-y-2">
              <p className={LABEL_CLS}>Talent assessment</p>
              {!talent ? (
                <p className="text-text-muted text-xs">No talent assessment in the current cycle.</p>
              ) : (
                <div className="rounded-md border border-border-light bg-bg-secondary px-3 py-2 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Chip label={`Box ${text(talent.boxPosition)}`} tone="primary" />
                    {talent.isHipo && (
                      <span className="inline-flex items-center gap-1 text-warning text-xs font-medium">
                        <Star size={12} className="fill-warning" /> High potential
                      </span>
                    )}
                  </div>
                  <p className="text-text-secondary text-xs">
                    Performance {text(talent.performanceScore)} · Potential {text(talent.potentialScore)}
                  </p>
                  <p className="text-text-muted text-[10px]">{text(talent.cycle)}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Roadmap ----------------------------------------------------------- */}
      <div className="bg-bg-card border border-border-default rounded-md p-4 space-y-3">
        <p className="text-text-primary text-sm font-semibold">Career roadmap</p>
        {!roadmap || roadmap.available === false ? (
          <InfoCard message={String(roadmap?.reason ?? 'No roadmap is available.')} />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {paths.map((p, i) => (
                <div key={i} className="rounded-md border border-border-light bg-bg-secondary p-3 space-y-1">
                  <p className="text-text-primary text-sm font-medium inline-flex items-center gap-2">
                    {text(p.fromRole)} <ArrowRight size={13} className="text-text-muted" /> {text(p.toRole)}
                  </p>
                  <p className="text-text-muted text-xs">
                    {p.typicalYears !== null && p.typicalYears !== undefined
                      ? `Typically ${p.typicalYears} year(s)`
                      : 'No typical duration recorded'}
                    {p.toGrade ? ` · to grade ${p.toGrade}` : ''}
                  </p>
                  {p.notes && <p className="text-text-secondary text-xs">{String(p.notes)}</p>}
                </div>
              ))}
            </div>
            {roadmap.basis && <p className="text-text-muted text-[11px]">Basis: {String(roadmap.basis)}</p>}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Career interests form
// ---------------------------------------------------------------------------

function InterestsTab() {
  const { user } = useAuth();
  const { employees } = useApp();
  const staff = isStaffRole(user?.role);
  const ownEmployeeId = user?.employeeId ?? null;

  const [employeeId, setEmployeeId] = useState<number | null>(ownEmployeeId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preferredRoles, setPreferredRoles] = useState<string[]>([]);
  const [preferredDepartments, setPreferredDepartments] = useState<string[]>([]);
  const [workModePreference, setWorkModePreference] = useState('ANY');
  const [willingToRelocate, setWillingToRelocate] = useState(false);
  const [openToGigs, setOpenToGigs] = useState(false);
  const [careerStatement, setCareerStatement] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback((empId: number) => {
    setLoading(true);
    setError(null);
    setSaved(false);
    internalHiringApi
      .careerInterests(empId)
      .then((res) => {
        setPreferredRoles(Array.isArray(res?.preferredRoles) ? res.preferredRoles.map(String) : []);
        setPreferredDepartments(Array.isArray(res?.preferredDepartments) ? res.preferredDepartments.map(String) : []);
        setWorkModePreference(String(res?.workModePreference ?? 'ANY'));
        setWillingToRelocate(!!res?.willingToRelocate);
        setOpenToGigs(!!res?.openToGigs);
        setCareerStatement(String(res?.careerStatement ?? ''));
        setUpdatedAt(res?.updatedAt ? String(res.updatedAt) : null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (employeeId !== null) load(employeeId);
  }, [employeeId, load]);

  const save = () => {
    if (employeeId === null) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    internalHiringApi
      .saveCareerInterests(employeeId, {
        preferredRoles,
        preferredDepartments,
        workModePreference,
        willingToRelocate,
        openToGigs,
        careerStatement: careerStatement.trim() || null,
      })
      .then(() => {
        setSaved(true);
        load(employeeId);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  if (!staff && ownEmployeeId === null) {
    return (
      <InfoCard
        message="This account is not linked to an employee record, so it has no career interests to edit."
        hint="Sign in with a self-service account to state your preferences — they feed the portal's rule-based recommendations."
      />
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {staff && (
        <div className="w-72">
          <label className={LABEL_CLS} htmlFor="ci-employee">
            Employee
          </label>
          <select
            id="ci-employee"
            className={INPUT_CLS}
            value={employeeId ?? ''}
            onChange={(e) => setEmployeeId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Select an employee…</option>
            {(employees ?? []).map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.empCode} · {emp.fullName}
              </option>
            ))}
          </select>
        </div>
      )}

      {employeeId === null ? (
        staff ? <EmptyBlock message="Pick an employee to view or edit their career interests" /> : null
      ) : loading ? (
        <LoadingBlock label="Loading career interests…" />
      ) : (
        <div className="space-y-4">
          {error && <ErrorBlock message={error} />}
          {saved && (
            <div className="rounded-md bg-success-light border border-success/30 px-3 py-2">
              <p className="text-success text-xs font-medium">
                Interests saved — the portal's recommendations use them immediately.
              </p>
            </div>
          )}

          <TagInput label="Preferred roles" values={preferredRoles} onChange={setPreferredRoles} placeholder="e.g. Senior Karigar" />
          <TagInput
            label="Preferred departments"
            values={preferredDepartments}
            onChange={setPreferredDepartments}
            placeholder="e.g. Polishing"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLS} htmlFor="ci-workmode">
                Work mode preference
              </label>
              <select
                id="ci-workmode"
                className={INPUT_CLS}
                value={workModePreference}
                onChange={(e) => setWorkModePreference(e.target.value)}
              >
                {WORK_MODE_PREFS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-5 pb-2">
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={willingToRelocate}
                  onChange={(e) => setWillingToRelocate(e.target.checked)}
                />
                Willing to relocate
              </label>
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                <input type="checkbox" checked={openToGigs} onChange={(e) => setOpenToGigs(e.target.checked)} />
                Open to gigs
              </label>
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Career statement</label>
            <textarea
              className={INPUT_CLS}
              rows={3}
              value={careerStatement}
              onChange={(e) => setCareerStatement(e.target.value)}
              placeholder="Where do you want this career to go?"
            />
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-text-muted text-[11px]">
              {updatedAt ? `Last updated ${fmtDate(updatedAt)}. ` : ''}
              These preferences drive the rule-based job recommendations on the portal.
            </p>
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save interests'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roadmaps (staff-only endpoint; a 403 renders in place)
// ---------------------------------------------------------------------------

function RoadmapsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    internalHiringApi
      .careerRoadmaps()
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingBlock label="Loading career roadmaps…" />;
  if (error) return <ErrorBlock message={error} />;
  if (rows.length === 0)
    return <EmptyBlock message="No career paths mapped yet" hint="Roadmaps come from the job architecture's career paths." />;

  return (
    <div className="space-y-2">
      <TableShell headers={['From role', 'To role', 'Typical years', 'Notes']}>
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-bg-hover transition-colors">
            <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
              {text(r.fromRole)} <span className="text-text-muted font-mono text-[10px]">({text(r.fromRoleCode)})</span>
            </td>
            <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
              {text(r.toRole)} <span className="text-text-muted font-mono text-[10px]">({text(r.toRoleCode)})</span>
            </td>
            <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
              {text(r.typicalYears)}
            </td>
            <td className="px-3 py-2 text-xs text-text-secondary">{text(r.notes)}</td>
          </tr>
        ))}
      </TableShell>
      <p className="text-text-muted text-[11px]">
        Employees see only the paths mapped for their own grade on their career dashboard.
      </p>
    </div>
  );
}
