import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Bell, Download, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { internalHiringApi, internalJobsApi } from '../../../api/internalJobs';
import { openAuthenticatedFile } from '../../../api/payroll';
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
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const ROUND_TYPES = ['HR_SCREENING', 'TECHNICAL', 'MANAGER', 'PANEL', 'FINAL'] as const;
const MODES = ['IN_PERSON', 'PHONE', 'VIDEO'] as const;
const STATUSES = ['SCHEDULED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
const OUTCOMES = ['PASS', 'FAIL', 'ON_HOLD'] as const;
const RECOMMENDATIONS = ['STRONG_YES', 'YES', 'NEUTRAL', 'NO', 'STRONG_NO'] as const;
/** Application statuses from which an interview may be scheduled. */
const SCHEDULABLE = new Set(['SHORTLISTED', 'ASSESSMENT', 'INTERVIEW']);

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
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

function statusTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'COMPLETED':
      return 'success';
    case 'SCHEDULED':
      return 'info';
    case 'RESCHEDULED':
      return 'warning';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'danger';
    default:
      return 'default';
  }
}

function outcomeTone(outcome: unknown): Tone {
  switch (String(outcome ?? '').toUpperCase()) {
    case 'PASS':
      return 'success';
    case 'FAIL':
      return 'danger';
    case 'ON_HOLD':
      return 'warning';
    default:
      return 'default';
  }
}

function recommendationTone(rec: unknown): Tone {
  switch (String(rec ?? '').toUpperCase()) {
    case 'STRONG_YES':
    case 'YES':
      return 'success';
    case 'NEUTRAL':
      return 'warning';
    case 'NO':
    case 'STRONG_NO':
      return 'danger';
    default:
      return 'default';
  }
}

interface PanelRow {
  employeeId: string;
  role: string;
}

interface ScoreRow {
  criterion: string;
  score: string;
  comment: string;
}

// ---------------------------------------------------------------------------

export function InterviewsSection() {
  const { employees } = useApp();

  const [upcomingOnly, setUpcomingOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [applicationFilter, setApplicationFilter] = useState('');

  const [rows, setRows] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reminders result banner.
  const [reminderResult, setReminderResult] = useState<any>(null);
  const [remindersBusy, setRemindersBusy] = useState(false);

  // Schedule modal.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [sForm, setSForm] = useState({
    applicationId: '',
    roundType: 'HR_SCREENING',
    scheduledAt: '',
    durationMinutes: '30',
    mode: 'IN_PERSON',
    location: '',
    meetingLink: '',
  });
  const [panel, setPanel] = useState<PanelRow[]>([{ employeeId: '', role: '' }]);

  // Detail modal.
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [reschedAt, setReschedAt] = useState('');
  const [reschedReason, setReschedReason] = useState('');
  const [outcome, setOutcome] = useState('PASS');

  // Feedback form.
  const [scorecard, setScorecard] = useState<ScoreRow[]>([{ criterion: '', score: '', comment: '' }]);
  const [recommendation, setRecommendation] = useState('');
  const [fbComments, setFbComments] = useState('');
  const [fbSubmitting, setFbSubmitting] = useState(false);

  useEffect(() => {
    internalJobsApi.applications().then((a) => setApplications(Array.isArray(a) ? a : [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    internalHiringApi
      .interviews({
        upcoming: upcomingOnly ? true : undefined,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        applicationId: applicationFilter === '' ? undefined : Number(applicationFilter),
      })
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [upcomingOnly, statusFilter, applicationFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const loadDetail = useCallback((id: number) => {
    setDetailLoading(true);
    setDetailError(null);
    internalHiringApi
      .interview(id)
      .then((d) => setDetail(d ?? null))
      .catch((err) => setDetailError(reason(err)))
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    if (detailId === null) {
      setDetail(null);
      return;
    }
    setReschedAt('');
    setReschedReason('');
    setOutcome('PASS');
    setScorecard([{ criterion: '', score: '', comment: '' }]);
    setRecommendation('');
    setFbComments('');
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

  const schedulableApplications = useMemo(
    () => applications.filter((a) => SCHEDULABLE.has(String(a?.status ?? ''))),
    [applications],
  );

  const runSchedule = () => {
    setScheduling(true);
    setScheduleError(null);
    const panelBody = panel
      .filter((p) => p.employeeId !== '')
      .map((p) => {
        const emp = employees.find((e) => e.id === Number(p.employeeId));
        return {
          employeeId: Number(p.employeeId),
          name: emp ? emp.fullName : `Employee #${p.employeeId}`,
          role: p.role.trim() || undefined,
        };
      });
    internalHiringApi
      .scheduleInterview({
        applicationId: Number(sForm.applicationId),
        roundType: sForm.roundType,
        scheduledAt: sForm.scheduledAt,
        durationMinutes: sForm.durationMinutes === '' ? undefined : Number(sForm.durationMinutes),
        mode: sForm.mode,
        location: sForm.location.trim() || undefined,
        meetingLink: sForm.meetingLink.trim() || undefined,
        panel: panelBody.length > 0 ? panelBody : undefined,
      })
      .then(() => {
        setScheduleOpen(false);
        load();
      })
      .catch((err) => setScheduleError(reason(err)))
      .finally(() => setScheduling(false));
  };

  const sendReminders = () => {
    setRemindersBusy(true);
    setReminderResult(null);
    internalHiringApi
      .sendInterviewReminders()
      .then((res) => setReminderResult(res ?? null))
      .catch((err) => setReminderResult({ error: reason(err) }))
      .finally(() => setRemindersBusy(false));
  };

  const submitFeedback = () => {
    if (detailId === null) return;
    setFbSubmitting(true);
    setDetailError(null);
    const rowsBody = scorecard
      .filter((r) => r.criterion.trim() !== '' && r.score !== '')
      .map((r) => ({
        criterion: r.criterion.trim(),
        score: Number(r.score),
        comment: r.comment.trim() || undefined,
      }));
    internalHiringApi
      .submitInterviewFeedback(detailId, {
        scorecard: rowsBody.length > 0 ? rowsBody : undefined,
        recommendation: recommendation || undefined,
        comments: fbComments.trim() || undefined,
      })
      .then(() => {
        setScorecard([{ criterion: '', score: '', comment: '' }]);
        setRecommendation('');
        setFbComments('');
        loadDetail(detailId);
      })
      .catch((err) => setDetailError(reason(err)))
      .finally(() => setFbSubmitting(false));
  };

  if (firstLoad && loading) return <LoadingBlock label="Loading interviews…" />;

  const detailStatus = String(detail?.status ?? '');
  const detailFeedback: any[] = Array.isArray(detail?.feedback) ? detail.feedback : [];
  const canAct = detailStatus === 'SCHEDULED' || detailStatus === 'RESCHEDULED';
  const skipped: any[] = Array.isArray(reminderResult?.skipped) ? reminderResult.skipped : [];

  return (
    <div className="space-y-4">
      {/* Controls -------------------------------------------------------------- */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className={LABEL_CLS} htmlFor="iv-status">
              Status
            </label>
            <select
              id="iv-status"
              className={`${INPUT_CLS} w-44`}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="iv-app">
              Application
            </label>
            <select
              id="iv-app"
              className={`${INPUT_CLS} w-64`}
              value={applicationFilter}
              onChange={(e) => setApplicationFilter(e.target.value)}
            >
              <option value="">All applications</option>
              {applications.map((a: any) => (
                <option key={a.id} value={a.id}>
                  #{a.id} {a.employeeName} → {a.jobCode}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setUpcomingOnly((u) => !u)}
            className={`px-3 py-2 rounded-md text-xs font-medium border transition-all ${
              upcomingOnly
                ? 'bg-primary-light border-primary/30 text-primary'
                : 'border-border-default text-text-muted hover:border-text-muted'
            }`}
          >
            Upcoming only
          </button>
          <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
            <span className="inline-flex items-center gap-2">
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
              Refresh
            </span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={sendReminders} disabled={remindersBusy}>
            <span className="inline-flex items-center gap-2">
              <Bell size={14} />
              {remindersBusy ? 'Sending…' : 'Send reminders'}
            </span>
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={() => {
              setScheduleError(null);
              setSForm({
                applicationId: '',
                roundType: 'HR_SCREENING',
                scheduledAt: '',
                durationMinutes: '30',
                mode: 'IN_PERSON',
                location: '',
                meetingLink: '',
              });
              setPanel([{ employeeId: '', role: '' }]);
              setScheduleOpen(true);
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Plus size={14} />
              Schedule interview
            </span>
          </button>
        </div>
      </div>

      {/* Reminders result -------------------------------------------------------- */}
      {reminderResult && (
        <div className="rounded-md bg-bg-secondary border border-border-light px-4 py-3 flex items-start justify-between gap-3">
          <div className="space-y-1">
            {reminderResult.error ? (
              <p className="text-danger text-xs">{String(reminderResult.error)}</p>
            ) : (
              <>
                <p className="text-text-primary text-xs font-medium">
                  {num(reminderResult.notified) ?? 0} interview(s) notified · {skipped.length} skipped
                </p>
                {skipped.length > 0 && (
                  <ul className="space-y-0.5 list-disc list-inside">
                    {skipped.map((s: any, index: number) => (
                      <li key={index} className="text-text-secondary text-[11px]">
                        Round #{text(s?.roundId)} — {text(s?.reason)}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <button
            type="button"
            className="text-text-muted text-xs hover:text-text-primary flex-shrink-0"
            onClick={() => setReminderResult(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {/* Table ----------------------------------------------------------------- */}
      {rows.length === 0 && !error ? (
        <EmptyBlock
          message="No interviews match these filters"
          hint="Interviews can be scheduled for SHORTLISTED, ASSESSMENT or INTERVIEW applications."
        />
      ) : (
        <TableShell headers={['Applicant', 'Job', 'Round', 'Scheduled', 'Mode', 'Panel', 'Status', 'Outcome']}>
          {rows.map((r, index) => {
            const panelNames = Array.isArray(r?.panel) ? r.panel.map((p: any) => p?.name).filter(Boolean) : [];
            return (
              <tr
                key={r?.id ?? index}
                className="hover:bg-bg-hover transition-colors cursor-pointer"
                onClick={() => (num(r?.id) === null ? undefined : setDetailId(Number(r.id)))}
              >
                <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{text(r?.applicantName)}</td>
                <td className="px-3 py-2 text-xs text-text-secondary max-w-[220px]">
                  <span className="line-clamp-2">{text(r?.jobTitle)}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-text-muted text-[11px] font-mono">R{text(r?.roundNo)}</span>
                    <Chip label={text(r?.roundType).replace(/_/g, ' ')} tone="primary" />
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                  {fmtDateTime(r?.scheduledAt)}
                  {num(r?.durationMinutes) !== null && (
                    <span className="text-text-muted"> · {r.durationMinutes}m</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Chip label={text(r?.mode).replace(/_/g, ' ')} tone="default" />
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary max-w-[180px]">
                  <span className="line-clamp-2">{panelNames.length > 0 ? panelNames.join(', ') : '—'}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Chip label={text(r?.status).replace(/_/g, ' ')} tone={statusTone(r?.status)} dot />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r?.outcome ? <Chip label={text(r.outcome).replace(/_/g, ' ')} tone={outcomeTone(r.outcome)} /> : '—'}
                </td>
              </tr>
            );
          })}
        </TableShell>
      )}

      {/* Schedule modal ----------------------------------------------------------- */}
      <AnimatePresence>
        {scheduleOpen && (
          <ModalShell
            title="Schedule an interview round"
            subtitle="Scheduling moves the application to INTERVIEW"
            onClose={() => setScheduleOpen(false)}
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setScheduleOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={runSchedule}
                  disabled={scheduling || sForm.applicationId === '' || sForm.scheduledAt === ''}
                >
                  {scheduling ? 'Scheduling…' : 'Schedule'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {scheduleError && <ErrorBlock message={scheduleError} />}
              <div>
                <label className={LABEL_CLS}>Application</label>
                <select
                  className={INPUT_CLS}
                  value={sForm.applicationId}
                  onChange={(e) => setSForm((f) => ({ ...f, applicationId: e.target.value }))}
                >
                  <option value="">Select application…</option>
                  {schedulableApplications.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      #{a.id} {a.employeeName} → {a.jobCode} ({String(a.status).replace(/_/g, ' ')})
                    </option>
                  ))}
                </select>
                {schedulableApplications.length === 0 && (
                  <p className="text-text-muted text-[11px] mt-1">
                    No applications are currently in SHORTLISTED, ASSESSMENT or INTERVIEW.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className={LABEL_CLS}>Round type</label>
                  <select
                    className={INPUT_CLS}
                    value={sForm.roundType}
                    onChange={(e) => setSForm((f) => ({ ...f, roundType: e.target.value }))}
                  >
                    {ROUND_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Date &amp; time</label>
                  <input
                    type="datetime-local"
                    className={INPUT_CLS}
                    value={sForm.scheduledAt}
                    onChange={(e) => setSForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Duration (min)</label>
                  <input
                    type="number"
                    min={5}
                    max={480}
                    className={INPUT_CLS}
                    value={sForm.durationMinutes}
                    onChange={(e) => setSForm((f) => ({ ...f, durationMinutes: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Mode</label>
                  <select
                    className={INPUT_CLS}
                    value={sForm.mode}
                    onChange={(e) => setSForm((f) => ({ ...f, mode: e.target.value }))}
                  >
                    {MODES.map((m) => (
                      <option key={m} value={m}>
                        {m.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Location</label>
                  <input
                    className={INPUT_CLS}
                    value={sForm.location}
                    onChange={(e) => setSForm((f) => ({ ...f, location: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Meeting link</label>
                  <input
                    className={INPUT_CLS}
                    value={sForm.meetingLink}
                    placeholder="https://…"
                    onChange={(e) => setSForm((f) => ({ ...f, meetingLink: e.target.value }))}
                  />
                  <p className="text-text-muted text-[11px] mt-1">
                    There is no video-conferencing integration — paste a link created outside this system.
                  </p>
                </div>
              </div>

              {/* Panel repeater ------------------------------------------------ */}
              <div className="space-y-2">
                <p className={LABEL_CLS}>Panel</p>
                {panel.map((p, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <select
                      className={INPUT_CLS}
                      value={p.employeeId}
                      onChange={(e) =>
                        setPanel((rows_) => rows_.map((r, i) => (i === index ? { ...r, employeeId: e.target.value } : r)))
                      }
                    >
                      <option value="">Select employee…</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.fullName} ({e.empCode})
                        </option>
                      ))}
                    </select>
                    <input
                      className={`${INPUT_CLS} w-44`}
                      value={p.role}
                      placeholder="Role on panel"
                      onChange={(e) =>
                        setPanel((rows_) => rows_.map((r, i) => (i === index ? { ...r, role: e.target.value } : r)))
                      }
                    />
                    <button
                      type="button"
                      aria-label="Remove panel member"
                      className="text-text-muted hover:text-danger flex-shrink-0"
                      onClick={() => setPanel((rows_) => rows_.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={BTN_SECONDARY}
                  onClick={() => setPanel((rows_) => [...rows_, { employeeId: '', role: '' }])}
                >
                  <span className="inline-flex items-center gap-2">
                    <Plus size={13} /> Add panel member
                  </span>
                </button>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Detail modal --------------------------------------------------------------- */}
      <AnimatePresence>
        {detailId !== null && (
          <ModalShell
            title={detail ? `Round ${text(detail.roundNo)} · ${text(detail.roundType).replace(/_/g, ' ')}` : 'Interview'}
            subtitle={detail ? `${text(detail.applicantName)} → ${text(detail.jobTitle)}` : null}
            onClose={() => setDetailId(null)}
            maxWidth="max-w-3xl"
            footer={
              detail ? (
                <div className="flex items-center justify-end gap-2 flex-wrap">
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    onClick={() =>
                      openAuthenticatedFile(
                        internalHiringApi.interviewIcsUrl(Number(detail.id)),
                        'interview.ics',
                      ).catch((err) => setDetailError(reason(err)))
                    }
                  >
                    <span className="inline-flex items-center gap-2">
                      <Download size={14} />
                      Download .ics
                    </span>
                  </button>
                </div>
              ) : null
            }
          >
            {detailLoading && <LoadingBlock label="Loading the interview…" />}
            {detailError && <ErrorBlock message={detailError} />}
            {!detailLoading && detail && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Chip label={detailStatus.replace(/_/g, ' ')} tone={statusTone(detailStatus)} dot />
                  {detail.outcome && (
                    <Chip label={text(detail.outcome).replace(/_/g, ' ')} tone={outcomeTone(detail.outcome)} />
                  )}
                  <Chip label={text(detail.mode).replace(/_/g, ' ')} tone="default" />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                  <div>
                    <p className={LABEL_CLS}>Scheduled</p>
                    <p className="text-text-secondary">{fmtDateTime(detail.scheduledAt)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Duration</p>
                    <p className="text-text-secondary font-mono">
                      {num(detail.durationMinutes) === null ? '—' : `${detail.durationMinutes} min`}
                    </p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Location</p>
                    <p className="text-text-secondary">{text(detail.location)}</p>
                  </div>
                  <div>
                    <p className={LABEL_CLS}>Meeting link</p>
                    <p className="text-text-secondary truncate">{text(detail.meetingLink)}</p>
                  </div>
                  {detail.rescheduleReason && (
                    <div className="col-span-2">
                      <p className={LABEL_CLS}>Reschedule reason</p>
                      <p className="text-text-secondary">{String(detail.rescheduleReason)}</p>
                    </div>
                  )}
                </div>

                <div>
                  <p className={LABEL_CLS}>Panel</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(Array.isArray(detail.panel) ? detail.panel : []).map((p: any, index: number) => (
                      <Chip key={index} label={`${text(p?.name)}${p?.role ? ` · ${p.role}` : ''}`} tone="default" />
                    ))}
                    {(!Array.isArray(detail.panel) || detail.panel.length === 0) && (
                      <span className="text-text-muted text-xs italic">No panel recorded.</span>
                    )}
                  </div>
                </div>

                {/* Actions ------------------------------------------------------ */}
                {canAct && (
                  <div className="rounded-md border border-border-default p-3 space-y-3">
                    <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">Actions</p>
                    <div className="flex items-end gap-2 flex-wrap">
                      <div>
                        <label className={LABEL_CLS}>New date &amp; time</label>
                        <input
                          type="datetime-local"
                          className={INPUT_CLS}
                          value={reschedAt}
                          onChange={(e) => setReschedAt(e.target.value)}
                        />
                      </div>
                      <div className="flex-1 min-w-[160px]">
                        <label className={LABEL_CLS}>Reason</label>
                        <input
                          className={INPUT_CLS}
                          value={reschedReason}
                          onChange={(e) => setReschedReason(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        disabled={acting || reschedAt === '' || reschedReason.trim() === ''}
                        onClick={() =>
                          act(() =>
                            internalHiringApi.rescheduleInterview(Number(detail.id), {
                              scheduledAt: reschedAt,
                              reason: reschedReason.trim(),
                            }),
                          )
                        }
                      >
                        Reschedule
                      </button>
                    </div>
                    <div className="flex items-end gap-2 flex-wrap">
                      <div>
                        <label className={LABEL_CLS}>Outcome</label>
                        <select
                          className={`${INPUT_CLS} w-36`}
                          value={outcome}
                          onChange={(e) => setOutcome(e.target.value)}
                        >
                          {OUTCOMES.map((o) => (
                            <option key={o} value={o}>
                              {o.replace(/_/g, ' ')}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        className={BTN_PRIMARY}
                        disabled={acting}
                        onClick={() => act(() => internalHiringApi.completeInterview(Number(detail.id), outcome))}
                      >
                        Complete
                      </button>
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        disabled={acting}
                        onClick={() => {
                          if (window.confirm('Mark this interview as a no-show?'))
                            act(() => internalHiringApi.noShowInterview(Number(detail.id)));
                        }}
                      >
                        No-show
                      </button>
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        disabled={acting}
                        onClick={() => {
                          if (window.confirm('Cancel this interview?'))
                            act(() => internalHiringApi.cancelInterview(Number(detail.id)));
                        }}
                      >
                        Cancel interview
                      </button>
                    </div>
                  </div>
                )}

                {/* Feedback list ------------------------------------------------- */}
                <div className="space-y-2">
                  <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">Feedback</p>
                  {detailFeedback.length === 0 && (
                    <p className="text-text-muted text-xs italic">No feedback submitted yet.</p>
                  )}
                  {detailFeedback.map((fb, index) => {
                    const card: any[] = Array.isArray(fb?.scorecard) ? fb.scorecard : [];
                    return (
                      <div key={fb?.id ?? index} className="rounded-md border border-border-light p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="text-text-primary text-xs font-medium">{text(fb?.interviewerName)}</p>
                          <div className="flex items-center gap-2">
                            {num(fb?.overallScore) !== null && (
                              <span className="text-text-secondary text-xs font-mono">
                                Overall {Number(fb.overallScore).toFixed(2)}
                              </span>
                            )}
                            {fb?.recommendation && (
                              <Chip
                                label={text(fb.recommendation).replace(/_/g, ' ')}
                                tone={recommendationTone(fb.recommendation)}
                              />
                            )}
                          </div>
                        </div>
                        {card.length > 0 && (
                          <TableShell headers={['Criterion', 'Score', 'Comment']}>
                            {card.map((c, i) => (
                              <tr key={i}>
                                <td className="px-3 py-1.5 text-xs text-text-primary whitespace-nowrap">
                                  {text(c?.criterion)}
                                </td>
                                <td className="px-3 py-1.5 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                                  {text(c?.score)}
                                </td>
                                <td className="px-3 py-1.5 text-xs text-text-secondary">{text(c?.comment)}</td>
                              </tr>
                            ))}
                          </TableShell>
                        )}
                        {fb?.comments && <p className="text-text-secondary text-[11px]">{String(fb.comments)}</p>}
                        <p className="text-text-muted text-[11px]">{fmtDateTime(fb?.submittedAt)}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Feedback form ------------------------------------------------- */}
                <div className="rounded-md border border-border-default p-3 space-y-2">
                  <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">
                    Submit feedback
                  </p>
                  {scorecard.map((r, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        className={INPUT_CLS}
                        value={r.criterion}
                        placeholder="Criterion"
                        onChange={(e) =>
                          setScorecard((rows_) =>
                            rows_.map((x, i) => (i === index ? { ...x, criterion: e.target.value } : x)),
                          )
                        }
                      />
                      <input
                        type="number"
                        step={0.5}
                        className={`${INPUT_CLS} w-24`}
                        value={r.score}
                        placeholder="Score"
                        onChange={(e) =>
                          setScorecard((rows_) =>
                            rows_.map((x, i) => (i === index ? { ...x, score: e.target.value } : x)),
                          )
                        }
                      />
                      <input
                        className={INPUT_CLS}
                        value={r.comment}
                        placeholder="Comment (optional)"
                        onChange={(e) =>
                          setScorecard((rows_) =>
                            rows_.map((x, i) => (i === index ? { ...x, comment: e.target.value } : x)),
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label="Remove row"
                        className="text-text-muted hover:text-danger flex-shrink-0"
                        onClick={() => setScorecard((rows_) => rows_.filter((_, i) => i !== index))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    onClick={() => setScorecard((rows_) => [...rows_, { criterion: '', score: '', comment: '' }])}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Plus size={13} /> Add criterion
                    </span>
                  </button>
                  <div className="flex items-end gap-2 flex-wrap">
                    <div>
                      <label className={LABEL_CLS}>Recommendation</label>
                      <select
                        className={`${INPUT_CLS} w-40`}
                        value={recommendation}
                        onChange={(e) => setRecommendation(e.target.value)}
                      >
                        <option value="">None</option>
                        {RECOMMENDATIONS.map((r) => (
                          <option key={r} value={r}>
                            {r.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[180px]">
                      <label className={LABEL_CLS}>Comments</label>
                      <input
                        className={INPUT_CLS}
                        value={fbComments}
                        onChange={(e) => setFbComments(e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      disabled={fbSubmitting}
                      onClick={submitFeedback}
                    >
                      {fbSubmitting ? 'Submitting…' : 'Submit feedback'}
                    </button>
                  </div>
                  <p className="text-text-muted text-[11px]">
                    The overall score is derived as the average of the scorecard rows. Submitting again replaces
                    your earlier feedback for this round.
                  </p>
                </div>
              </div>
            )}
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
