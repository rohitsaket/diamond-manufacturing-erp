import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Loader2, Archive } from 'lucide-react';
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
} from '../../components/common/HrmsUI';
import { recruitmentApi } from '../../api/hrms';
import type { JobOpening, JobOpeningStatus, WorkerType } from '../../types/hrms';

const STATUSES: JobOpeningStatus[] = ['OPEN', 'ON_HOLD', 'CLOSED'];

const STATUS_TONE: Record<JobOpeningStatus, 'success' | 'warning' | 'default'> = {
  OPEN: 'success',
  ON_HOLD: 'warning',
  CLOSED: 'default',
};

const WORKER_TYPES: WorkerType[] = ['PIECE_RATE', 'DHAR', 'MAXI'];
const TODAY = new Date().toISOString().slice(0, 10);

const errText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

const formatDate = (value: string | null): string => (value ? value.slice(0, 10) : '—');

interface OpeningForm {
  title: string;
  department: string;
  grade: string;
  workerType: WorkerType;
  openings: string;
  openedAt: string;
  notes: string;
}

const EMPTY_FORM: OpeningForm = {
  title: '',
  department: '',
  grade: '',
  workerType: 'PIECE_RATE',
  openings: '1',
  openedAt: TODAY,
  notes: '',
};

export function JobOpenings({ onDataChanged }: { onDataChanged?: () => void }) {
  const [rows, setRows] = useState<JobOpening[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<JobOpeningStatus | 'ALL'>('ALL');
  const [busyId, setBusyId] = useState<number | null>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState<OpeningForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    recruitmentApi
      .openings()
      .then(setRows)
      .catch((err: unknown) => {
        setRows([]);
        setError(errText(err, 'Could not load job openings.'));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const openPositions = rows
      .filter((r) => r.status === 'OPEN')
      .reduce((sum, r) => sum + Number(r.openings ?? 0), 0);
    const pipeline = rows.reduce((sum, r) => sum + Number(r.candidateCount ?? 0), 0);
    return { openPositions, total: rows.length, pipeline };
  }, [rows]);

  const counts = useMemo(() => {
    const base: Record<JobOpeningStatus, number> = { OPEN: 0, ON_HOLD: 0, CLOSED: 0 };
    for (const r of rows) base[r.status] += 1;
    return base;
  }, [rows]);

  const filtered = useMemo(
    () => (filter === 'ALL' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  const afterMutation = useCallback(() => {
    load();
    onDataChanged?.();
  }, [load, onDataChanged]);

  const handleClose = async (opening: JobOpening) => {
    if (!window.confirm(`Close "${opening.title}"? It will stop accepting new candidates.`)) return;
    setBusyId(opening.id);
    try {
      await recruitmentApi.closeOpening(opening.id);
      afterMutation();
    } catch (err) {
      window.alert(errText(err, 'Failed to close opening'));
    } finally {
      setBusyId(null);
    }
  };

  const openPanel = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    setPanelOpen(true);
  };

  const set = <K extends keyof OpeningForm>(key: K, value: OpeningForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = 'Required';
    const n = Number(form.openings);
    if (form.openings.trim() === '' || Number.isNaN(n) || n < 1) e.openings = 'Must be at least 1';
    if (!form.openedAt) e.openedAt = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await recruitmentApi.createOpening({
        title: form.title.trim(),
        department: form.department.trim() || null,
        grade: form.grade.trim() || null,
        workerType: form.workerType,
        openings: Number(form.openings),
        openedAt: form.openedAt,
        notes: form.notes.trim() || null,
      });
      setPanelOpen(false);
      afterMutation();
    } catch (err) {
      window.alert(errText(err, 'Failed to create opening'));
    } finally {
      setSaving(false);
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label="Open positions" value={stats.openPositions} intent="success" hint="Seats to fill on OPEN roles" />
        <StatCard label="Total openings" value={stats.total} />
        <StatCard label="Candidates in pipeline" value={stats.pipeline} intent="info" />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setFilter('ALL')} className={pillCls(filter === 'ALL')}>
            All <span className="ml-1 opacity-70">({rows.length})</span>
          </button>
          {STATUSES.map((s) => (
            <button key={s} type="button" onClick={() => setFilter(s)} className={pillCls(filter === s)}>
              {s.replace('_', ' ')} <span className="ml-1 opacity-70">({counts[s]})</span>
            </button>
          ))}
        </div>

        <button type="button" onClick={openPanel} className={`${BTN_PRIMARY} flex items-center gap-2 ml-auto`}>
          <Plus size={14} />
          New opening
        </button>
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading job openings…" />
      ) : filtered.length === 0 && !error ? (
        <EmptyBlock
          message={rows.length === 0 ? 'No job openings yet' : 'No openings match this filter'}
          hint={rows.length === 0 ? 'Create an opening so candidates can be linked to it.' : undefined}
        />
      ) : filtered.length === 0 ? null : (
        <TableShell
          headers={['Title', 'Department', 'Grade', 'Type', 'Positions', 'Candidates', 'Opened', 'Status', '']}
        >
          {filtered.map((o) => (
            <tr key={o.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-text-primary text-sm font-medium">{o.title}</td>
              <td className="px-3 py-2 text-text-secondary text-xs">{o.department ?? '—'}</td>
              <td className="px-3 py-2 text-text-secondary text-xs">{o.grade ?? '—'}</td>
              <td className="px-3 py-2 text-text-secondary text-xs">{o.workerType.replace('_', ' ')}</td>
              <td className="px-3 py-2 text-text-secondary text-xs font-mono">{o.openings}</td>
              <td className="px-3 py-2 text-text-secondary text-xs font-mono">{o.candidateCount}</td>
              <td className="px-3 py-2 text-text-secondary text-xs font-mono">{formatDate(o.openedAt)}</td>
              <td className="px-3 py-2">
                <Chip label={o.status.replace('_', ' ')} tone={STATUS_TONE[o.status]} />
              </td>
              <td className="px-3 py-2">
                {o.status !== 'CLOSED' && (
                  <button
                    type="button"
                    disabled={busyId === o.id}
                    onClick={() => {
                      void handleClose(o);
                    }}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border-default text-text-muted hover:border-danger/30 hover:text-danger transition-colors disabled:opacity-50"
                  >
                    <Archive size={10} />
                    Close
                  </button>
                )}
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {panelOpen && (
          <motion.div
            key="opening-panel"
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed right-0 top-0 h-full w-80 bg-bg-card border-l border-border-default z-40 p-5 overflow-y-auto scrollbar-thin shadow-modal"
          >
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h3 className="text-text-primary font-semibold text-base">New opening</h3>
                <p className="text-text-muted text-xs mt-0.5">Candidates can be linked to it right away</p>
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
                <label className={LABEL_CLS} htmlFor="open-title">
                  Title *
                </label>
                <input
                  id="open-title"
                  type="text"
                  value={form.title}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder="Polishing karigar"
                  className={fieldCls('title')}
                />
                {errors.title && <p className="text-danger text-[9px] mt-0.5">{errors.title}</p>}
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="open-dept">
                  Department
                </label>
                <input
                  id="open-dept"
                  type="text"
                  value={form.department}
                  onChange={(e) => set('department', e.target.value)}
                  placeholder="Polishing"
                  className={INPUT_CLS}
                />
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="open-grade">
                  Grade
                </label>
                <input
                  id="open-grade"
                  type="text"
                  value={form.grade}
                  onChange={(e) => set('grade', e.target.value)}
                  placeholder="A+"
                  className={INPUT_CLS}
                />
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="open-workertype">
                  Worker type
                </label>
                <select
                  id="open-workertype"
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
                  <label className={LABEL_CLS} htmlFor="open-count">
                    Positions *
                  </label>
                  <input
                    id="open-count"
                    type="number"
                    min={1}
                    value={form.openings}
                    onChange={(e) => set('openings', e.target.value)}
                    className={fieldCls('openings')}
                  />
                  {errors.openings && <p className="text-danger text-[9px] mt-0.5">{errors.openings}</p>}
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="open-date">
                    Opened on *
                  </label>
                  <input
                    id="open-date"
                    type="date"
                    value={form.openedAt}
                    onChange={(e) => set('openedAt', e.target.value)}
                    className={fieldCls('openedAt')}
                  />
                  {errors.openedAt && <p className="text-danger text-[9px] mt-0.5">{errors.openedAt}</p>}
                </div>
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="open-notes">
                  Notes
                </label>
                <textarea
                  id="open-notes"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="Skills, shift, anything relevant…"
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
                Create opening
              </button>
              <button type="button" onClick={() => setPanelOpen(false)} className={BTN_SECONDARY}>
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
