import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Plus, X, Loader2, ChevronRight, UserPlus, Ban } from 'lucide-react';
import {
  StatCard,
  Chip,
  TableShell,
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  BTN_PRIMARY,
  BTN_SECONDARY,
  inr,
} from '../../components/common/HrmsUI';
import { ModalShell } from '../../components/common/ModalShell';
import { recruitmentApi } from '../../api/hrms';
import { useApp } from '../../contexts/AppContext';
import type { Candidate, CandidateStatus, JobOpening, WorkerType } from '../../types/hrms';
import { ConvertCandidateModal } from './ConvertCandidateModal';

const STAGES: CandidateStatus[] = ['APPLIED', 'INTERVIEW', 'SELECTED', 'JOINED', 'REJECTED'];

const STAGE_TONE: Record<CandidateStatus, 'default' | 'info' | 'warning' | 'success' | 'danger'> = {
  APPLIED: 'default',
  INTERVIEW: 'info',
  SELECTED: 'warning',
  JOINED: 'success',
  REJECTED: 'danger',
};

/** Pipeline is forward-only on the server, so only these hops are offered. */
const NEXT_STAGE: Partial<Record<CandidateStatus, { status: CandidateStatus; label: string }>> = {
  APPLIED: { status: 'INTERVIEW', label: 'Interview' },
  INTERVIEW: { status: 'SELECTED', label: 'Select' },
};

const WORKER_TYPES: WorkerType[] = ['PIECE_RATE', 'DHAR', 'MAXI'];

const errText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

/** Backend may send ISO or `YYYY-MM-DD HH:MM:SS`; the input wants 16 chars. */
const toDateTimeLocal = (value: string | null): string =>
  value ? value.replace(' ', 'T').slice(0, 16) : '';

const formatDateTime = (value: string | null): string => {
  if (!value) return '—';
  const d = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

const formatDate = (value: string | null): string => (value ? value.slice(0, 10) : '—');

interface CandidateForm {
  fullName: string;
  phone: string;
  email: string;
  openingId: string;
  positionGrade: string;
  workerType: WorkerType;
  expectedSalary: string;
  experienceYears: string;
  source: string;
  notes: string;
}

const EMPTY_FORM: CandidateForm = {
  fullName: '',
  phone: '',
  email: '',
  openingId: '',
  positionGrade: '',
  workerType: 'PIECE_RATE',
  expectedSalary: '',
  experienceYears: '',
  source: '',
  notes: '',
};

export function CandidatePipeline({ onDataChanged }: { onDataChanged?: () => void }) {
  const { refresh } = useApp();

  const [rows, setRows] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<CandidateStatus | 'ALL'>('ALL');

  const [detail, setDetail] = useState<Candidate | null>(null);
  const [converting, setConverting] = useState<Candidate | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // New candidate panel
  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState<CandidateForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [openings, setOpenings] = useState<JobOpening[]>([]);

  // Detail edit form
  const [editNotes, setEditNotes] = useState('');
  const [editInterview, setEditInterview] = useState('');
  const [savingDetail, setSavingDetail] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    recruitmentApi
      .candidates()
      .then(setRows)
      .catch((err: unknown) => {
        setRows([]);
        setError(errText(err, 'Could not load candidates.'));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const base: Record<CandidateStatus, number> = {
      APPLIED: 0,
      INTERVIEW: 0,
      SELECTED: 0,
      JOINED: 0,
      REJECTED: 0,
    };
    for (const r of rows) base[r.status] += 1;
    return base;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchStage = stage === 'ALL' || r.status === stage;
      const matchSearch =
        q === '' || r.fullName.toLowerCase().includes(q) || (r.phone ?? '').toLowerCase().includes(q);
      return matchStage && matchSearch;
    });
  }, [rows, search, stage]);

  // --- Mutations ------------------------------------------------------------
  const afterMutation = useCallback(() => {
    load();
    onDataChanged?.();
  }, [load, onDataChanged]);

  const handleAdvance = async (candidate: Candidate, next: CandidateStatus) => {
    setBusyId(candidate.id);
    try {
      await recruitmentApi.setStatus(candidate.id, next);
      afterMutation();
    } catch (err) {
      window.alert(errText(err, 'Failed to update stage'));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (candidate: Candidate) => {
    if (!window.confirm(`Reject ${candidate.fullName}? This closes their application.`)) return;
    setBusyId(candidate.id);
    try {
      await recruitmentApi.setStatus(candidate.id, 'REJECTED');
      setDetail(null);
      afterMutation();
    } catch (err) {
      window.alert(errText(err, 'Failed to reject candidate'));
    } finally {
      setBusyId(null);
    }
  };

  const handleConverted = () => {
    afterMutation();
    setDetail(null);
    void refresh();
  };

  // --- New candidate panel --------------------------------------------------
  const openPanel = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    setPanelOpen(true);
    recruitmentApi
      .openings('OPEN')
      .then(setOpenings)
      .catch(() => setOpenings([]));
  };

  const set = <K extends keyof CandidateForm>(key: K, value: CandidateForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.fullName.trim()) e.fullName = 'Required';
    if (!form.phone.trim()) e.phone = 'Required';
    if (!form.positionGrade.trim()) e.positionGrade = 'Required';
    if (form.expectedSalary.trim() !== '') {
      const n = Number(form.expectedSalary);
      if (Number.isNaN(n) || n < 0) e.expectedSalary = 'Must be a number ≥ 0';
    }
    if (form.experienceYears.trim() !== '') {
      const n = Number(form.experienceYears);
      if (Number.isNaN(n) || n < 0) e.experienceYears = 'Must be a number ≥ 0';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await recruitmentApi.create({
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        openingId: form.openingId ? Number(form.openingId) : null,
        positionGrade: form.positionGrade.trim(),
        workerType: form.workerType,
        expectedSalary: form.expectedSalary.trim() === '' ? null : Number(form.expectedSalary),
        experienceYears: form.experienceYears.trim() === '' ? null : Number(form.experienceYears),
        source: form.source.trim() || null,
        notes: form.notes.trim() || null,
      });
      setPanelOpen(false);
      afterMutation();
    } catch (err) {
      window.alert(errText(err, 'Failed to create candidate'));
    } finally {
      setSaving(false);
    }
  };

  // --- Detail modal ---------------------------------------------------------
  const openDetail = (candidate: Candidate) => {
    setDetail(candidate);
    setEditNotes(candidate.notes ?? '');
    setEditInterview(toDateTimeLocal(candidate.interviewDate));
  };

  const handleSaveDetail = async () => {
    if (!detail) return;
    setSavingDetail(true);
    try {
      const updated = await recruitmentApi.update(detail.id, {
        notes: editNotes.trim() || null,
        interviewDate: editInterview ? editInterview : null,
      });
      setDetail(updated);
      setEditNotes(updated.notes ?? '');
      setEditInterview(toDateTimeLocal(updated.interviewDate));
      afterMutation();
    } catch (err) {
      window.alert(errText(err, 'Failed to save candidate'));
    } finally {
      setSavingDetail(false);
    }
  };

  const fieldCls = (key: string) => `${INPUT_CLS}${errors[key] ? ' border-danger' : ''}`;

  const pillCls = (active: boolean) =>
    `px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
      active
        ? 'bg-primary-light border-primary/30 text-primary'
        : 'border-border-default text-text-muted hover:border-text-muted'
    }`;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {STAGES.map((s) => (
          <StatCard
            key={s}
            label={s === 'JOINED' ? 'Joined' : s.charAt(0) + s.slice(1).toLowerCase()}
            value={counts[s]}
            intent={STAGE_TONE[s]}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone…"
            className={`${INPUT_CLS} pl-9 w-56`}
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setStage('ALL')} className={pillCls(stage === 'ALL')}>
            All <span className="ml-1 opacity-70">({rows.length})</span>
          </button>
          {STAGES.map((s) => (
            <button key={s} type="button" onClick={() => setStage(s)} className={pillCls(stage === s)}>
              {s.charAt(0) + s.slice(1).toLowerCase()} <span className="ml-1 opacity-70">({counts[s]})</span>
            </button>
          ))}
        </div>

        <button type="button" onClick={openPanel} className={`${BTN_PRIMARY} flex items-center gap-2 ml-auto`}>
          <Plus size={14} />
          New candidate
        </button>
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading candidates…" />
      ) : filtered.length === 0 && !error ? (
        <EmptyBlock
          message={rows.length === 0 ? 'No candidates yet' : 'No candidates match this filter'}
          hint={rows.length === 0 ? 'Add a candidate to start tracking the pipeline.' : undefined}
        />
      ) : filtered.length === 0 ? null : (
        <TableShell
          headers={[
            'Candidate',
            'Phone',
            'Applied for',
            'Grade',
            'Expected',
            'Experience',
            'Source',
            'Stage',
            'Actions',
          ]}
        >
          {filtered.map((c) => {
            const next = NEXT_STAGE[c.status];
            const busy = busyId === c.id;
            return (
              <tr
                key={c.id}
                onClick={() => openDetail(c)}
                className="hover:bg-bg-hover transition-colors cursor-pointer"
              >
                <td className="px-3 py-2">
                  <p className="text-text-primary text-sm font-semibold">{c.fullName}</p>
                  {c.email && <p className="text-text-muted text-[10px]">{c.email}</p>}
                </td>
                <td className="px-3 py-2 text-text-secondary text-xs font-mono">{c.phone}</td>
                <td className="px-3 py-2 text-text-secondary text-xs">{c.openingTitle ?? '—'}</td>
                <td className="px-3 py-2 text-text-secondary text-xs">{c.positionGrade}</td>
                <td className="px-3 py-2 text-text-secondary text-xs font-mono">
                  {c.expectedSalary != null ? inr(c.expectedSalary) : '—'}
                </td>
                <td className="px-3 py-2 text-text-secondary text-xs">
                  {c.experienceYears != null ? `${c.experienceYears} yrs` : '—'}
                </td>
                <td className="px-3 py-2 text-text-secondary text-xs">{c.source ?? '—'}</td>
                <td className="px-3 py-2">
                  <Chip label={c.status} tone={STAGE_TONE[c.status]} />
                </td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  {c.status === 'JOINED' ? (
                    <Chip tone="success" label="Employee created" />
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {next && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void handleAdvance(c, next.status);
                          }}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border-default text-text-muted hover:border-primary/30 hover:text-primary transition-colors disabled:opacity-50"
                        >
                          <ChevronRight size={10} />
                          {next.label}
                        </button>
                      )}
                      {c.status === 'SELECTED' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConverting(c)}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-primary text-white font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
                        >
                          <UserPlus size={10} />
                          Convert
                        </button>
                      )}
                      {c.status !== 'REJECTED' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void handleReject(c);
                          }}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border-default text-text-muted hover:border-danger/30 hover:text-danger transition-colors disabled:opacity-50"
                        >
                          <Ban size={10} />
                          Reject
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </TableShell>
      )}

      {/* New candidate slide-in */}
      <AnimatePresence>
        {panelOpen && (
          <motion.div
            key="candidate-panel"
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed right-0 top-0 h-full w-80 bg-bg-card border-l border-border-default z-40 p-5 overflow-y-auto scrollbar-thin shadow-modal"
          >
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h3 className="text-text-primary font-semibold text-base">New candidate</h3>
                <p className="text-text-muted text-xs mt-0.5">Enters the pipeline as APPLIED</p>
              </div>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                aria-label="Close"
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className={LABEL_CLS} htmlFor="cand-name">
                  Full name *
                </label>
                <input
                  id="cand-name"
                  type="text"
                  value={form.fullName}
                  onChange={(e) => set('fullName', e.target.value)}
                  placeholder="Ramesh Patel"
                  className={fieldCls('fullName')}
                />
                {errors.fullName && <p className="text-danger text-[9px] mt-0.5">{errors.fullName}</p>}
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="cand-phone">
                  Phone *
                </label>
                <input
                  id="cand-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  placeholder="9876543210"
                  className={fieldCls('phone')}
                />
                {errors.phone && <p className="text-danger text-[9px] mt-0.5">{errors.phone}</p>}
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="cand-email">
                  Email
                </label>
                <input
                  id="cand-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  placeholder="name@example.com"
                  className={INPUT_CLS}
                />
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="cand-opening">
                  Applying for
                </label>
                <select
                  id="cand-opening"
                  value={form.openingId}
                  onChange={(e) => set('openingId', e.target.value)}
                  className={INPUT_CLS}
                >
                  <option value="">No specific opening</option>
                  {openings.map((o) => (
                    <option key={o.id} value={String(o.id)}>
                      {o.title}
                      {o.department ? ` · ${o.department}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="cand-grade">
                  Position grade *
                </label>
                <input
                  id="cand-grade"
                  type="text"
                  value={form.positionGrade}
                  onChange={(e) => set('positionGrade', e.target.value)}
                  placeholder="A+"
                  className={fieldCls('positionGrade')}
                />
                {errors.positionGrade && (
                  <p className="text-danger text-[9px] mt-0.5">{errors.positionGrade}</p>
                )}
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="cand-workertype">
                  Worker type
                </label>
                <select
                  id="cand-workertype"
                  value={form.workerType}
                  onChange={(e) => set('workerType', e.target.value as WorkerType)}
                  className={INPUT_CLS}
                >
                  {WORKER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS} htmlFor="cand-salary">
                    Expected salary
                  </label>
                  <input
                    id="cand-salary"
                    type="number"
                    min={0}
                    value={form.expectedSalary}
                    onChange={(e) => set('expectedSalary', e.target.value)}
                    placeholder="18000"
                    className={fieldCls('expectedSalary')}
                  />
                  {errors.expectedSalary && (
                    <p className="text-danger text-[9px] mt-0.5">{errors.expectedSalary}</p>
                  )}
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="cand-exp">
                    Experience (yrs)
                  </label>
                  <input
                    id="cand-exp"
                    type="number"
                    min={0}
                    value={form.experienceYears}
                    onChange={(e) => set('experienceYears', e.target.value)}
                    placeholder="3"
                    className={fieldCls('experienceYears')}
                  />
                  {errors.experienceYears && (
                    <p className="text-danger text-[9px] mt-0.5">{errors.experienceYears}</p>
                  )}
                </div>
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="cand-source">
                  Source
                </label>
                <input
                  id="cand-source"
                  type="text"
                  value={form.source}
                  onChange={(e) => set('source', e.target.value)}
                  placeholder="Referral"
                  className={INPUT_CLS}
                />
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="cand-notes">
                  Notes
                </label>
                <textarea
                  id="cand-notes"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="Anything worth remembering…"
                  className={INPUT_CLS}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  void handleCreate();
                }}
                disabled={saving}
                className={`${BTN_PRIMARY} flex items-center gap-2`}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Add candidate
              </button>
              <button type="button" onClick={() => setPanelOpen(false)} className={BTN_SECONDARY}>
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Detail modal */}
      <AnimatePresence>
        {detail && !converting && (
          <ModalShell
            key="candidate-detail"
            title={detail.fullName}
            subtitle={detail.openingTitle ? `Applied for ${detail.openingTitle}` : 'No linked opening'}
            onClose={() => setDetail(null)}
          >
            <div className="space-y-5">
              <div className="flex items-center gap-2 flex-wrap">
                <Chip label={detail.status} tone={STAGE_TONE[detail.status]} />
                <span className="text-text-muted text-xs">Added {formatDate(detail.createdAt)}</span>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {(
                  [
                    ['Phone', detail.phone],
                    ['Email', detail.email ?? '—'],
                    ['Position grade', detail.positionGrade],
                    ['Worker type', detail.workerType.replace('_', ' ')],
                    ['Expected salary', detail.expectedSalary != null ? inr(detail.expectedSalary) : '—'],
                    [
                      'Experience',
                      detail.experienceYears != null ? `${detail.experienceYears} yrs` : '—',
                    ],
                    ['Source', detail.source ?? '—'],
                    ['Interview', formatDateTime(detail.interviewDate)],
                    [
                      'Employee record',
                      detail.convertedEmployeeId != null ? `#${detail.convertedEmployeeId}` : '—',
                    ],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 border-b border-border-light py-1.5">
                    <span className="text-text-muted text-xs">{k}</span>
                    <span className="text-text-primary text-xs font-medium text-right">{v}</span>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-text-muted text-[10px] uppercase tracking-wider font-medium mb-1">Notes</p>
                <p className="text-text-secondary text-sm whitespace-pre-wrap">
                  {detail.notes && detail.notes.trim() !== '' ? detail.notes : '—'}
                </p>
              </div>

              <div className="rounded-md border border-border-default bg-bg-secondary p-4 space-y-3">
                <p className="text-text-primary text-sm font-medium">Edit notes / set interview date</p>
                <div>
                  <label className={LABEL_CLS} htmlFor="detail-interview">
                    Interview date &amp; time
                  </label>
                  <input
                    id="detail-interview"
                    type="datetime-local"
                    value={editInterview}
                    onChange={(e) => setEditInterview(e.target.value)}
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="detail-notes">
                    Notes
                  </label>
                  <textarea
                    id="detail-notes"
                    rows={3}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className={INPUT_CLS}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void handleSaveDetail();
                    }}
                    disabled={savingDetail}
                    className={`${BTN_PRIMARY} flex items-center gap-2`}
                  >
                    {savingDetail && <Loader2 size={14} className="animate-spin" />}
                    Save
                  </button>
                  {detail.status === 'SELECTED' && (
                    <button
                      type="button"
                      onClick={() => setConverting(detail)}
                      className={`${BTN_SECONDARY} flex items-center gap-2`}
                    >
                      <UserPlus size={14} />
                      Convert to employee
                    </button>
                  )}
                </div>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Convert modal */}
      <AnimatePresence>
        {converting && (
          <ConvertCandidateModal
            key="convert-modal"
            candidate={converting}
            onClose={() => setConverting(null)}
            onConverted={handleConverted}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
