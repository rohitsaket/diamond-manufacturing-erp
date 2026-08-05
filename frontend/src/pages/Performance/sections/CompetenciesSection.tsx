import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Plus, RefreshCw, Star } from 'lucide-react';
import { performanceApi, talentApi } from '../../../api/performance';
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

const CATEGORIES = ['TECHNICAL', 'FUNCTIONAL', 'LEADERSHIP', 'BEHAVIORAL'] as const;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? '—' : s;
}

function rating(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : n.toFixed(1);
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

// ---------------------------------------------------------------------------

export function CompetenciesSection() {
  const { employees } = useApp();

  const [tab, setTab] = useState('framework');

  const [competencies, setCompetencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [matrix, setMatrix] = useState<any[]>([]);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);

  const [cycles, setCycles] = useState<any[]>([]);
  const [ratings, setRatings] = useState<any[]>([]);
  const [ratingsLoading, setRatingsLoading] = useState(false);
  const [ratingsError, setRatingsError] = useState<string | null>(null);
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterCycle, setFilterCycle] = useState('');

  // Framework create/edit modal.
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name: '',
    category: 'TECHNICAL',
    description: '',
    isActive: true,
  });

  // Rate modal.
  const [rateOpen, setRateOpen] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateSaving, setRateSaving] = useState(false);
  const [rForm, setRForm] = useState({
    employeeId: '',
    competencyId: '',
    rating: '3',
    cycleId: '',
    note: '',
  });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    talentApi
      .competencies()
      .then((rows) => setCompetencies(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, []);

  useEffect(() => {
    load();
    performanceApi
      .cycles()
      .then((rows) => setCycles(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, [load]);

  const loadMatrix = useCallback(() => {
    setMatrixLoading(true);
    setMatrixError(null);
    talentApi
      .skillMatrix()
      .then((res) => setMatrix(Array.isArray(res) ? res : (res?.rows ?? [])))
      .catch((err) => setMatrixError(reason(err)))
      .finally(() => setMatrixLoading(false));
  }, []);

  const loadRatings = useCallback(() => {
    setRatingsLoading(true);
    setRatingsError(null);
    talentApi
      .competencyRatings({
        employeeId: filterEmployee === '' ? undefined : Number(filterEmployee),
        cycleId: filterCycle === '' ? undefined : Number(filterCycle),
      })
      .then((rows) => setRatings(Array.isArray(rows) ? rows : []))
      .catch((err) => setRatingsError(reason(err)))
      .finally(() => setRatingsLoading(false));
  }, [filterEmployee, filterCycle]);

  useEffect(() => {
    if (tab === 'matrix') loadMatrix();
    if (tab === 'assessments') loadRatings();
  }, [tab, loadMatrix, loadRatings]);

  const byCategory = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const c of competencies) {
      const cat = String(c?.category ?? 'TECHNICAL');
      (groups[cat] = groups[cat] ?? []).push(c);
    }
    return groups;
  }, [competencies]);

  const openModal = (comp: any | null) => {
    setEditing(comp);
    setModalError(null);
    setForm({
      code: String(comp?.code ?? ''),
      name: String(comp?.name ?? ''),
      category: String(comp?.category ?? 'TECHNICAL'),
      description: String(comp?.description ?? ''),
      isActive: comp ? Boolean(comp.isActive) : true,
    });
    setModalOpen(true);
  };

  const save = () => {
    setSaving(true);
    setModalError(null);
    const body: Record<string, unknown> = {
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category,
      description: form.description.trim() || null,
      isActive: form.isActive,
    };
    const call = editing
      ? talentApi.updateCompetency(Number(editing.id), body)
      : talentApi.createCompetency(body);
    call
      .then(() => {
        setModalOpen(false);
        load();
      })
      .catch((err) => setModalError(reason(err)))
      .finally(() => setSaving(false));
  };

  const submitRating = () => {
    setRateSaving(true);
    setRateError(null);
    talentApi
      .rateCompetency({
        employeeId: Number(rForm.employeeId),
        competencyId: Number(rForm.competencyId),
        rating: Number(rForm.rating),
        cycleId: rForm.cycleId === '' ? undefined : Number(rForm.cycleId),
        note: rForm.note.trim() || undefined,
      })
      .then(() => {
        setRateOpen(false);
        if (tab === 'assessments') loadRatings();
        if (tab === 'matrix') loadMatrix();
      })
      .catch((err) => setRateError(reason(err)))
      .finally(() => setRateSaving(false));
  };

  if (firstLoad && loading) return <LoadingBlock label="Loading competencies…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <TabBar
          tabs={[
            { id: 'framework', label: 'Framework', count: competencies.length || null },
            { id: 'matrix', label: 'Skill Matrix' },
            { id: 'assessments', label: 'Assessments' },
          ]}
          active={tab}
          onChange={setTab}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={() => {
              setRForm({ employeeId: '', competencyId: '', rating: '3', cycleId: '', note: '' });
              setRateError(null);
              setRateOpen(true);
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Star size={14} />
              Rate competency
            </span>
          </button>
          {tab === 'framework' && (
            <button type="button" className={BTN_PRIMARY} onClick={() => openModal(null)}>
              <span className="inline-flex items-center gap-2">
                <Plus size={14} />
                New competency
              </span>
            </button>
          )}
        </div>
      </div>

      {/* --- Framework tab ----------------------------------------------------- */}
      {tab === 'framework' && (
        <div className="space-y-4">
          {error && (
            <div className="space-y-2">
              <ErrorBlock message={error} />
              <button type="button" className={BTN_SECONDARY} onClick={load}>
                Retry
              </button>
            </div>
          )}
          {competencies.length === 0 && !error && <EmptyBlock message="No competencies defined yet" />}
          {CATEGORIES.filter((cat) => (byCategory[cat] ?? []).length > 0).map((cat) => (
            <div key={cat} className="bg-bg-card border border-border-default rounded-md">
              <div className="px-4 py-2.5 border-b border-border-default flex items-center gap-2">
                <p className="text-text-primary text-sm font-semibold">{cat}</p>
                <span className="text-text-muted text-xs">{(byCategory[cat] ?? []).length} competencies</span>
              </div>
              <div className="divide-y divide-border-light">
                {(byCategory[cat] ?? []).map((c) => (
                  <div key={c?.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-text-primary text-xs font-medium">
                        {text(c?.name)}{' '}
                        <span className="text-text-muted font-mono font-normal">{text(c?.code)}</span>
                      </p>
                      {c?.description && (
                        <p className="text-text-muted text-[11px] mt-0.5">{String(c.description)}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Chip label={c?.isActive ? 'Active' : 'Inactive'} tone={c?.isActive ? 'success' : 'default'} />
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline"
                        onClick={() => openModal(c)}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {/* Categories outside the standard four, if the API ever returns them. */}
          {Object.keys(byCategory)
            .filter((cat) => !CATEGORIES.includes(cat as any))
            .map((cat) => (
              <div key={cat} className="bg-bg-card border border-border-default rounded-md">
                <div className="px-4 py-2.5 border-b border-border-default">
                  <p className="text-text-primary text-sm font-semibold">{cat}</p>
                </div>
                <div className="divide-y divide-border-light">
                  {byCategory[cat].map((c) => (
                    <div key={c?.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <p className="text-text-primary text-xs font-medium">{text(c?.name)}</p>
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline"
                        onClick={() => openModal(c)}
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* --- Skill matrix tab ---------------------------------------------------- */}
      {tab === 'matrix' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-text-muted text-xs">
              Average competency rating per category; a dash means the employee has no ratings in that category yet.
            </p>
            <button type="button" className={BTN_SECONDARY} onClick={loadMatrix} disabled={matrixLoading}>
              <span className="inline-flex items-center gap-2">
                <RefreshCw size={14} className={matrixLoading ? 'animate-spin' : undefined} />
                Refresh
              </span>
            </button>
          </div>
          {matrixLoading && <LoadingBlock label="Loading the skill matrix…" />}
          {matrixError && <ErrorBlock message={matrixError} />}
          {!matrixLoading && !matrixError && matrix.length === 0 && (
            <EmptyBlock message="No employees in the skill matrix" />
          )}
          {!matrixLoading && !matrixError && matrix.length > 0 && (
            <TableShell
              headers={['Employee', 'Grade', 'Technical', 'Functional', 'Leadership', 'Behavioral', 'Skills']}
            >
              {matrix.map((row, index) => (
                <tr key={row?.employeeId ?? index} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                    {text(row?.employeeName)}
                    <span className="text-text-muted font-mono ml-2">{text(row?.empCode)}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(row?.grade)} tone="default" />
                  </td>
                  {(['avgTechnical', 'avgFunctional', 'avgLeadership', 'avgBehavioral'] as const).map((key) => (
                    <td key={key} className="px-3 py-2 whitespace-nowrap">
                      {num(row?.[key]) === null ? (
                        <span className="text-text-muted text-xs">—</span>
                      ) : (
                        <Chip label={rating(row[key])} tone="default" />
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {num(row?.skillCount) ?? 0}
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}

      {/* --- Assessments tab ------------------------------------------------------- */}
      {tab === 'assessments' && (
        <div className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="w-56">
              <label className={LABEL_CLS} htmlFor="cr-emp">
                Employee
              </label>
              <select
                id="cr-emp"
                className={INPUT_CLS}
                value={filterEmployee}
                onChange={(e) => setFilterEmployee(e.target.value)}
              >
                <option value="">All employees</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName} ({e.empCode})
                  </option>
                ))}
              </select>
            </div>
            <div className="w-52">
              <label className={LABEL_CLS} htmlFor="cr-cycle">
                Cycle
              </label>
              <select
                id="cr-cycle"
                className={INPUT_CLS}
                value={filterCycle}
                onChange={(e) => setFilterCycle(e.target.value)}
              >
                <option value="">All cycles</option>
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className={BTN_SECONDARY} onClick={loadRatings} disabled={ratingsLoading}>
              <span className="inline-flex items-center gap-2">
                <RefreshCw size={14} className={ratingsLoading ? 'animate-spin' : undefined} />
                Refresh
              </span>
            </button>
          </div>
          {ratingsLoading && <LoadingBlock label="Loading assessments…" />}
          {ratingsError && <ErrorBlock message={ratingsError} />}
          {!ratingsLoading && !ratingsError && ratings.length === 0 && (
            <EmptyBlock message="No competency ratings match these filters" />
          )}
          {!ratingsLoading && !ratingsError && ratings.length > 0 && (
            <TableShell headers={['Employee', 'Competency', 'Category', 'Rating', 'Rated by', 'Note', 'When']}>
              {ratings.map((r, index) => (
                <tr key={r?.id ?? index} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{text(r?.employeeName)}</td>
                  <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                    {text(r?.competencyName)}
                    <p className="text-text-muted text-[11px] font-mono">{text(r?.competencyCode)}</p>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={text(r?.category)} tone="default" />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-primary font-mono font-semibold text-right whitespace-nowrap">
                    {rating(r?.rating)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(r?.ratedByType)}</td>
                  <td className="px-3 py-2 text-xs text-text-muted max-w-[220px] truncate">{text(r?.note)}</td>
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDateTime(r?.createdAt)}</td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}

      {/* --- Competency create/edit modal -------------------------------------------- */}
      <AnimatePresence>
        {modalOpen && (
          <ModalShell
            title={editing ? `Edit competency ${editing.code}` : 'New competency'}
            onClose={() => setModalOpen(false)}
            maxWidth="max-w-md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create competency'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {modalError && <ErrorBlock message={modalError} />}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Code</label>
                  <input
                    className={INPUT_CLS}
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Category</label>
                  <select
                    className={INPUT_CLS}
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Name</label>
                <input
                  className={INPUT_CLS}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Description</label>
                <textarea
                  className={`${INPUT_CLS} min-h-[60px]`}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-text-primary">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                Active
              </label>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* --- Rate competency modal ------------------------------------------------------ */}
      <AnimatePresence>
        {rateOpen && (
          <ModalShell
            title="Rate a competency"
            subtitle="0 to 5 in half-point steps"
            onClose={() => setRateOpen(false)}
            maxWidth="max-w-md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setRateOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={submitRating}
                  disabled={rateSaving || rForm.employeeId === '' || rForm.competencyId === ''}
                >
                  {rateSaving ? 'Saving…' : 'Save rating'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {rateError && <ErrorBlock message={rateError} />}
              <div>
                <label className={LABEL_CLS}>Employee</label>
                <select
                  className={INPUT_CLS}
                  value={rForm.employeeId}
                  onChange={(e) => setRForm((f) => ({ ...f, employeeId: e.target.value }))}
                >
                  <option value="">Select employee…</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.fullName} ({e.empCode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Competency</label>
                <select
                  className={INPUT_CLS}
                  value={rForm.competencyId}
                  onChange={(e) => setRForm((f) => ({ ...f, competencyId: e.target.value }))}
                >
                  <option value="">Select competency…</option>
                  {competencies
                    .filter((c) => c?.isActive)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        [{c.category}] {c.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Rating (0–5)</label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.5}
                    className={INPUT_CLS}
                    value={rForm.rating}
                    onChange={(e) => setRForm((f) => ({ ...f, rating: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Cycle (optional)</label>
                  <select
                    className={INPUT_CLS}
                    value={rForm.cycleId}
                    onChange={(e) => setRForm((f) => ({ ...f, cycleId: e.target.value }))}
                  >
                    <option value="">No cycle</option>
                    {cycles.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Note</label>
                <textarea
                  className={`${INPUT_CLS} min-h-[60px]`}
                  value={rForm.note}
                  onChange={(e) => setRForm((f) => ({ ...f, note: e.target.value }))}
                />
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
