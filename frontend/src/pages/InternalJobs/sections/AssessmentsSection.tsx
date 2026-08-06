import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ClipboardList, Info, Plus, RefreshCw } from 'lucide-react';
import { internalHiringApi, internalJobsApi } from '../../../api/internalJobs';
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
import { TabBar } from '../../../components/common/TabBar';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const ASSESSMENT_TYPES = ['TECHNICAL', 'APTITUDE', 'CODING', 'BEHAVIORAL', 'LEADERSHIP', 'SKILL'] as const;
/** Application statuses from which an assessment may be assigned (backend rule). */
const ASSIGNABLE = new Set(['UNDER_REVIEW', 'SHORTLISTED', 'ASSESSMENT']);

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

function resultTone(result: unknown): Tone {
  switch (String(result ?? '').toUpperCase()) {
    case 'PASS':
      return 'success';
    case 'FAIL':
      return 'danger';
    default:
      return 'default';
  }
}

function typeTone(type: unknown): Tone {
  switch (String(type ?? '').toUpperCase()) {
    case 'TECHNICAL':
    case 'CODING':
      return 'primary';
    case 'APTITUDE':
      return 'info';
    case 'BEHAVIORAL':
    case 'LEADERSHIP':
      return 'warning';
    default:
      return 'default';
  }
}

const EMPTY_ASM_FORM = {
  code: '',
  name: '',
  assessmentType: 'SKILL',
  description: '',
  maxScore: '100',
  passScore: '',
  durationMinutes: '',
};

// ---------------------------------------------------------------------------

export function AssessmentsSection() {
  const { employees } = useApp();
  const [tab, setTab] = useState('results');

  const [assessments, setAssessments] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [applicationFilter, setApplicationFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Record-score modal.
  const [scoreTarget, setScoreTarget] = useState<any>(null);
  const [scoreValue, setScoreValue] = useState('');
  const [scoreResult, setScoreResult] = useState('PASS');
  const [scoreNotes, setScoreNotes] = useState('');
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [scoring, setScoring] = useState(false);

  // Assign modal.
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignAssessmentId, setAssignAssessmentId] = useState('');
  const [assignApplicationId, setAssignApplicationId] = useState('');
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  // Catalogue create/edit modal.
  const [asmModalOpen, setAsmModalOpen] = useState(false);
  const [asmEditing, setAsmEditing] = useState<any>(null);
  const [asmForm, setAsmForm] = useState({ ...EMPTY_ASM_FORM });
  const [asmError, setAsmError] = useState<string | null>(null);
  const [asmSaving, setAsmSaving] = useState(false);
  const [toggleBusyId, setToggleBusyId] = useState<number | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);

  // The create response carries an honest delivery note — shown as a banner.
  const [deliveryNote, setDeliveryNote] = useState<string | null>(null);

  useEffect(() => {
    internalJobsApi.applications().then((a) => setApplications(Array.isArray(a) ? a : [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      internalHiringApi.assessments(),
      internalHiringApi.assessmentResults({
        applicationId: applicationFilter === '' ? undefined : Number(applicationFilter),
        employeeId: employeeFilter === '' ? undefined : Number(employeeFilter),
      }),
    ])
      .then(([asm, res]) => {
        setAssessments(Array.isArray(asm) ? asm : []);
        setResults(Array.isArray(res) ? res : []);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [applicationFilter, employeeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  /** Catalogue metadata by id — result rows do not carry max/pass score. */
  const assessmentById = useMemo(() => {
    const map: Record<number, any> = {};
    for (const a of assessments) {
      const id = num(a?.id);
      if (id !== null) map[id] = a;
    }
    return map;
  }, [assessments]);

  const applicationById = useMemo(() => {
    const map: Record<number, any> = {};
    for (const a of applications) {
      const id = num(a?.id);
      if (id !== null) map[id] = a;
    }
    return map;
  }, [applications]);

  const openScoreModal = (row: any) => {
    setScoreTarget(row);
    setScoreValue(row?.score === null || row?.score === undefined ? '' : String(row.score));
    setScoreResult('PASS');
    setScoreNotes(String(row?.notes ?? ''));
    setScoreError(null);
  };

  const submitScore = () => {
    if (!scoreTarget) return;
    const meta = assessmentById[Number(scoreTarget.assessmentId)];
    const hasPassScore = meta ? num(meta.passScore) !== null : false;
    setScoring(true);
    setScoreError(null);
    const body: Record<string, unknown> = {
      score: scoreValue === '' ? null : Number(scoreValue),
      notes: scoreNotes.trim() || null,
    };
    // Without a pass score the verdict must be stated explicitly.
    if (!hasPassScore) body.result = scoreResult;
    internalHiringApi
      .recordAssessmentResult(Number(scoreTarget.id), body)
      .then(() => {
        setScoreTarget(null);
        load();
      })
      .catch((err) => setScoreError(reason(err)))
      .finally(() => setScoring(false));
  };

  const submitAssign = () => {
    setAssigning(true);
    setAssignError(null);
    internalHiringApi
      .assignAssessment(Number(assignAssessmentId), Number(assignApplicationId))
      .then(() => {
        setAssignOpen(false);
        load();
      })
      .catch((err) => setAssignError(reason(err)))
      .finally(() => setAssigning(false));
  };

  const openAsmModal = (a: any | null) => {
    setAsmEditing(a);
    setAsmForm({
      code: String(a?.code ?? ''),
      name: String(a?.name ?? ''),
      assessmentType: String(a?.assessmentType ?? 'SKILL'),
      description: String(a?.description ?? ''),
      maxScore: a?.maxScore === null || a?.maxScore === undefined ? '100' : String(a.maxScore),
      passScore: a?.passScore === null || a?.passScore === undefined ? '' : String(a.passScore),
      durationMinutes: a?.durationMinutes === null || a?.durationMinutes === undefined ? '' : String(a.durationMinutes),
    });
    setAsmError(null);
    setAsmModalOpen(true);
  };

  const saveAssessment = () => {
    setAsmSaving(true);
    setAsmError(null);
    const body: Record<string, unknown> = {
      code: asmForm.code.trim(),
      name: asmForm.name.trim(),
      assessmentType: asmForm.assessmentType,
      description: asmForm.description.trim() || null,
      maxScore: asmForm.maxScore === '' ? 100 : Number(asmForm.maxScore),
      passScore: asmForm.passScore === '' ? null : Number(asmForm.passScore),
      durationMinutes: asmForm.durationMinutes === '' ? null : Number(asmForm.durationMinutes),
    };
    const call = asmEditing
      ? internalHiringApi.updateAssessment(Number(asmEditing.id), body)
      : internalHiringApi.createAssessment(body);
    call
      .then((res: any) => {
        // Creation returns { assessment, note } — the note says results are
        // recorded by assessors, not delivered online. Render it honestly.
        if (!asmEditing && typeof res?.note === 'string') setDeliveryNote(res.note);
        setAsmModalOpen(false);
        load();
      })
      .catch((err) => setAsmError(reason(err)))
      .finally(() => setAsmSaving(false));
  };

  const toggleActive = (a: any) => {
    setToggleBusyId(Number(a.id));
    setCatalogueError(null);
    internalHiringApi
      .updateAssessment(Number(a.id), { isActive: !a.isActive })
      .then(() => load())
      .catch((err) => setCatalogueError(reason(err)))
      .finally(() => setToggleBusyId(null));
  };

  if (firstLoad && loading) return <LoadingBlock label="Loading assessments…" />;

  const scoreMeta = scoreTarget ? assessmentById[Number(scoreTarget.assessmentId)] : null;
  const scoreMax = scoreMeta ? num(scoreMeta.maxScore) : null;
  const scoreHasPass = scoreMeta ? num(scoreMeta.passScore) !== null : false;
  const assignableApplications = applications.filter((a) => ASSIGNABLE.has(String(a?.status ?? '')));
  const activeAssessments = assessments.filter((a) => !!a?.isActive);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <TabBar
          tabs={[
            { id: 'results', label: 'Results', count: results.length },
            { id: 'catalogue', label: 'Catalogue', count: assessments.length },
          ]}
          active={tab}
          onChange={setTab}
        />
        <div className="flex items-center gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
            <span className="inline-flex items-center gap-2">
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
              Refresh
            </span>
          </button>
          {tab === 'results' ? (
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={() => {
                setAssignAssessmentId('');
                setAssignApplicationId('');
                setAssignError(null);
                setAssignOpen(true);
              }}
            >
              <span className="inline-flex items-center gap-2">
                <ClipboardList size={14} />
                Assign assessment
              </span>
            </button>
          ) : (
            <button type="button" className={BTN_PRIMARY} onClick={() => openAsmModal(null)}>
              <span className="inline-flex items-center gap-2">
                <Plus size={14} />
                New assessment
              </span>
            </button>
          )}
        </div>
      </div>

      {deliveryNote && (
        <div className="rounded-md bg-info-light border border-info/30 px-4 py-3 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Info size={14} className="text-info flex-shrink-0 mt-0.5" />
            <p className="text-text-secondary text-xs">{deliveryNote}</p>
          </div>
          <button
            type="button"
            className="text-text-muted text-xs hover:text-text-primary flex-shrink-0"
            onClick={() => setDeliveryNote(null)}
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

      {/* --- Results tab --------------------------------------------------------- */}
      {tab === 'results' && (
        <div className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="w-64">
              <label className={LABEL_CLS} htmlFor="asr-app">
                Application
              </label>
              <select
                id="asr-app"
                className={INPUT_CLS}
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
            <div className="w-64">
              <label className={LABEL_CLS} htmlFor="asr-emp">
                Employee
              </label>
              <select
                id="asr-emp"
                className={INPUT_CLS}
                value={employeeFilter}
                onChange={(e) => setEmployeeFilter(e.target.value)}
              >
                <option value="">All employees</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName} ({e.empCode})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {results.length === 0 && !error ? (
            <EmptyBlock
              message="No assessment results yet"
              hint="Assign an assessment to an UNDER_REVIEW, SHORTLISTED or ASSESSMENT application."
            />
          ) : (
            <TableShell
              headers={['Assessment', 'Employee', 'Application', 'Score', 'Result', 'Notes', 'Assessed', 'Actions']}
            >
              {results.map((r, index) => {
                const meta = assessmentById[Number(r?.assessmentId)];
                const maxScore = meta ? num(meta.maxScore) : null;
                const app = applicationById[Number(r?.applicationId)];
                return (
                  <tr key={r?.id ?? index} className="hover:bg-bg-hover transition-colors">
                    <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                      {text(r?.assessmentName)}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                      {text(r?.employeeName)}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                      #{text(r?.applicationId)}
                      {app && <span className="text-text-muted"> · {text(app.jobCode)}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-primary font-mono text-right whitespace-nowrap">
                      {num(r?.score) === null ? '—' : r.score}
                      {maxScore !== null && <span className="text-text-muted"> / {maxScore}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Chip label={text(r?.result)} tone={resultTone(r?.result)} />
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary max-w-[200px]">
                      <span className="line-clamp-2">{text(r?.notes)}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">
                      {r?.assessedBy ? `user #${r.assessedBy} · ` : ''}
                      {fmtDateTime(r?.assessedAt)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline"
                        onClick={() => openScoreModal(r)}
                      >
                        {String(r?.result) === 'PENDING' ? 'Record score' : 'Re-record'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </TableShell>
          )}
        </div>
      )}

      {/* --- Catalogue tab --------------------------------------------------------- */}
      {tab === 'catalogue' && (
        <div className="space-y-3">
          {catalogueError && <ErrorBlock message={catalogueError} />}
          {assessments.length === 0 && !error ? (
            <EmptyBlock message="No assessments in the catalogue yet" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {assessments.map((a, index) => (
                <div key={a?.id ?? index} className="bg-bg-card border border-border-default rounded-md p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-text-primary text-sm font-semibold truncate">{text(a?.name)}</p>
                      <p className="text-text-muted text-[11px] font-mono">{text(a?.code)}</p>
                    </div>
                    <Chip label={text(a?.assessmentType)} tone={typeTone(a?.assessmentType)} />
                  </div>
                  {a?.description && (
                    <p className="text-text-secondary text-xs line-clamp-3">{String(a.description)}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-text-secondary font-mono">
                      Max {text(a?.maxScore)}
                      {num(a?.passScore) !== null ? ` · pass ≥ ${a.passScore}` : ' · no pass score'}
                    </span>
                    <span className="text-text-muted">
                      {num(a?.durationMinutes) === null ? 'No duration' : `${a.durationMinutes} min`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-border-light">
                    <Chip label={a?.isActive ? 'Active' : 'Inactive'} tone={a?.isActive ? 'success' : 'default'} />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline"
                        disabled={toggleBusyId === Number(a?.id)}
                        onClick={() => toggleActive(a)}
                      >
                        {toggleBusyId === Number(a?.id) ? 'Saving…' : a?.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline"
                        onClick={() => openAsmModal(a)}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* --- Record score modal ------------------------------------------------------ */}
      <AnimatePresence>
        {scoreTarget && (
          <ModalShell
            title={`Record result · ${text(scoreTarget.assessmentName)}`}
            subtitle={`${text(scoreTarget.employeeName)} · application #${text(scoreTarget.applicationId)}`}
            onClose={() => setScoreTarget(null)}
            maxWidth="max-w-md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setScoreTarget(null)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={submitScore} disabled={scoring}>
                  {scoring ? 'Saving…' : 'Save result'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {scoreError && <ErrorBlock message={scoreError} />}
              <div>
                <label className={LABEL_CLS}>
                  Score{scoreMax !== null ? ` (0 – ${scoreMax})` : ''}
                </label>
                <input
                  type="number"
                  min={0}
                  max={scoreMax ?? undefined}
                  className={INPUT_CLS}
                  value={scoreValue}
                  onChange={(e) => setScoreValue(e.target.value)}
                />
                {scoreHasPass && scoreMeta && (
                  <p className="text-text-muted text-[11px] mt-1">
                    PASS/FAIL is derived automatically: scores of {scoreMeta.passScore} or more pass.
                  </p>
                )}
              </div>
              {!scoreHasPass && (
                <div>
                  <label className={LABEL_CLS}>Result</label>
                  <select
                    className={INPUT_CLS}
                    value={scoreResult}
                    onChange={(e) => setScoreResult(e.target.value)}
                  >
                    <option value="PASS">PASS</option>
                    <option value="FAIL">FAIL</option>
                  </select>
                  <p className="text-text-muted text-[11px] mt-1">
                    This assessment has no pass score, so the verdict must be stated explicitly — the system never
                    guesses.
                  </p>
                </div>
              )}
              <div>
                <label className={LABEL_CLS}>Notes</label>
                <textarea
                  className={`${INPUT_CLS} min-h-[60px]`}
                  value={scoreNotes}
                  onChange={(e) => setScoreNotes(e.target.value)}
                />
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* --- Assign modal ------------------------------------------------------------- */}
      <AnimatePresence>
        {assignOpen && (
          <ModalShell
            title="Assign an assessment"
            subtitle="Assigning moves the application to ASSESSMENT and notifies the applicant"
            onClose={() => setAssignOpen(false)}
            maxWidth="max-w-md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setAssignOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={submitAssign}
                  disabled={assigning || assignAssessmentId === '' || assignApplicationId === ''}
                >
                  {assigning ? 'Assigning…' : 'Assign'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {assignError && <ErrorBlock message={assignError} />}
              <div>
                <label className={LABEL_CLS}>Assessment</label>
                <select
                  className={INPUT_CLS}
                  value={assignAssessmentId}
                  onChange={(e) => setAssignAssessmentId(e.target.value)}
                >
                  <option value="">Select assessment…</option>
                  {activeAssessments.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Application</label>
                <select
                  className={INPUT_CLS}
                  value={assignApplicationId}
                  onChange={(e) => setAssignApplicationId(e.target.value)}
                >
                  <option value="">Select application…</option>
                  {assignableApplications.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      #{a.id} {a.employeeName} → {a.jobCode} ({String(a.status).replace(/_/g, ' ')})
                    </option>
                  ))}
                </select>
                {assignableApplications.length === 0 && (
                  <p className="text-text-muted text-[11px] mt-1">
                    No applications are currently in UNDER_REVIEW, SHORTLISTED or ASSESSMENT.
                  </p>
                )}
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* --- Catalogue create/edit modal ------------------------------------------------ */}
      <AnimatePresence>
        {asmModalOpen && (
          <ModalShell
            title={asmEditing ? `Edit ${text(asmEditing.code)}` : 'New assessment'}
            subtitle="Assessments are recorded and scored by assessors — there is no online test delivery."
            onClose={() => setAsmModalOpen(false)}
            maxWidth="max-w-lg"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setAsmModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={saveAssessment}
                  disabled={asmSaving || asmForm.code.trim() === '' || asmForm.name.trim() === ''}
                >
                  {asmSaving ? 'Saving…' : asmEditing ? 'Save changes' : 'Create assessment'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {asmError && <ErrorBlock message={asmError} />}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Code</label>
                  <input
                    className={INPUT_CLS}
                    value={asmForm.code}
                    disabled={!!asmEditing}
                    onChange={(e) => setAsmForm((f) => ({ ...f, code: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Name</label>
                  <input
                    className={INPUT_CLS}
                    value={asmForm.name}
                    onChange={(e) => setAsmForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Type</label>
                <select
                  className={INPUT_CLS}
                  value={asmForm.assessmentType}
                  onChange={(e) => setAsmForm((f) => ({ ...f, assessmentType: e.target.value }))}
                >
                  {ASSESSMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Description</label>
                <textarea
                  className={`${INPUT_CLS} min-h-[60px]`}
                  value={asmForm.description}
                  onChange={(e) => setAsmForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={LABEL_CLS}>Max score</label>
                  <input
                    type="number"
                    min={1}
                    className={INPUT_CLS}
                    value={asmForm.maxScore}
                    onChange={(e) => setAsmForm((f) => ({ ...f, maxScore: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Pass score</label>
                  <input
                    type="number"
                    min={0}
                    className={INPUT_CLS}
                    value={asmForm.passScore}
                    onChange={(e) => setAsmForm((f) => ({ ...f, passScore: e.target.value }))}
                  />
                  <p className="text-text-muted text-[11px] mt-1">
                    Leave empty for no pass score — the assessor will then state PASS/FAIL explicitly.
                  </p>
                </div>
                <div>
                  <label className={LABEL_CLS}>Duration (min)</label>
                  <input
                    type="number"
                    min={0}
                    className={INPUT_CLS}
                    value={asmForm.durationMinutes}
                    onChange={(e) => setAsmForm((f) => ({ ...f, durationMinutes: e.target.value }))}
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
