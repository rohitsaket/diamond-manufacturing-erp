import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Plus, RefreshCw, Users } from 'lucide-react';
import { performanceApi } from '../../../api/performance';
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
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';
import { TabBar } from '../../../components/common/TabBar';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const KRA_STATUSES = ['ALL', 'ASSIGNED', 'SELF_SCORED', 'REVIEWED', 'FINALIZED'] as const;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? '—' : s;
}

function score(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : n.toFixed(1);
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

function statusTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'FINALIZED':
      return 'success';
    case 'REVIEWED':
      return 'info';
    case 'SELF_SCORED':
      return 'warning';
    case 'ASSIGNED':
    default:
      return 'default';
  }
}

// ---------------------------------------------------------------------------

export function KrasSection() {
  const { employees } = useApp();

  const [tab, setTab] = useState('employee');

  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [status, setStatus] = useState('ALL');

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kras, setKras] = useState<any[]>([]);
  const [krasLoading, setKrasLoading] = useState(false);
  const [krasError, setKrasError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<any[]>([]);

  // Score modal.
  const [scoring, setScoring] = useState<any>(null);
  const [scoreMode, setScoreMode] = useState<'self' | 'manager' | 'finalize'>('self');
  const [scoreValue, setScoreValue] = useState('');
  const [scoreRemarks, setScoreRemarks] = useState('');
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [scoreSaving, setScoreSaving] = useState(false);

  // Bulk assign modal.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkEmployeeIds, setBulkEmployeeIds] = useState<number[]>([]);
  const [bulkKraIds, setBulkKraIds] = useState<number[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResult, setBulkResult] = useState<any>(null);

  // Library modal.
  const [libModalOpen, setLibModalOpen] = useState(false);
  const [libEditing, setLibEditing] = useState<any>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [libSaving, setLibSaving] = useState(false);
  const [libForm, setLibForm] = useState({
    code: '',
    name: '',
    description: '',
    departmentId: '',
    defaultWeightagePct: '',
    isActive: true,
  });

  useEffect(() => {
    performanceApi
      .cycles()
      .then((list) => {
        const cyclesList = Array.isArray(list) ? list : [];
        setCycles(cyclesList);
        const active = cyclesList.find((c) => String(c?.status) === 'ACTIVE') ?? cyclesList[0];
        setCycleId(active ? Number(active.id) : null);
        if (!active) {
          setLoading(false);
          setFirstLoad(false);
        }
      })
      .catch((err) => {
        setError(reason(err));
        setLoading(false);
        setFirstLoad(false);
      });
    orgApi.departments.list().then((d) => setDepartments(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (cycleId === null) return;
    setLoading(true);
    setError(null);
    performanceApi
      .employeeKras({ cycleId, status: status === 'ALL' ? undefined : status })
      .then((res) => setRows(Array.isArray(res) ? res : []))
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [cycleId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const loadKras = useCallback(() => {
    setKrasLoading(true);
    setKrasError(null);
    performanceApi
      .kras()
      .then((res) => setKras(Array.isArray(res) ? res : []))
      .catch((err) => setKrasError(reason(err)))
      .finally(() => setKrasLoading(false));
  }, []);

  useEffect(() => {
    // The bulk-assign modal needs the library either way.
    loadKras();
  }, [loadKras]);

  // Group employee KRAs by employee for the section layout.
  const grouped = useMemo(() => {
    const map = new Map<number, { name: string; rows: any[] }>();
    for (const r of rows) {
      const id = Number(r?.employeeId ?? 0);
      if (!map.has(id)) map.set(id, { name: String(r?.employeeName ?? `Employee ${id}`), rows: [] });
      map.get(id)!.rows.push(r);
    }
    return [...map.entries()].map(([id, g]) => ({ employeeId: id, ...g }));
  }, [rows]);

  const openScore = (row: any, mode: 'self' | 'manager' | 'finalize') => {
    setScoring(row);
    setScoreMode(mode);
    setScoreValue('');
    setScoreRemarks('');
    setScoreError(null);
  };

  const submitScore = () => {
    if (!scoring) return;
    setScoreSaving(true);
    setScoreError(null);
    const id = Number(scoring.id);
    const call =
      scoreMode === 'self'
        ? performanceApi.selfScoreKra(id, { score: Number(scoreValue), remarks: scoreRemarks.trim() || undefined })
        : scoreMode === 'manager'
          ? performanceApi.managerScoreKra(id, {
              score: Number(scoreValue),
              remarks: scoreRemarks.trim() || undefined,
            })
          : performanceApi.finalizeKra(id, scoreValue === '' ? {} : { finalScore: Number(scoreValue) });
    call
      .then(() => {
        setScoring(null);
        load();
      })
      .catch((err) => setScoreError(reason(err)))
      .finally(() => setScoreSaving(false));
  };

  const runBulk = () => {
    if (cycleId === null) return;
    setBulkSaving(true);
    setBulkError(null);
    setBulkResult(null);
    performanceApi
      .bulkAssignKras({ cycleId, employeeIds: bulkEmployeeIds, kraIds: bulkKraIds })
      .then((res) => {
        setBulkResult(res ?? null);
        load();
      })
      .catch((err) => setBulkError(reason(err)))
      .finally(() => setBulkSaving(false));
  };

  const openLibModal = (kra: any | null) => {
    setLibEditing(kra);
    setLibError(null);
    setLibForm({
      code: String(kra?.code ?? ''),
      name: String(kra?.name ?? ''),
      description: String(kra?.description ?? ''),
      departmentId: kra?.departmentId === null || kra?.departmentId === undefined ? '' : String(kra.departmentId),
      defaultWeightagePct:
        kra?.defaultWeightagePct === null || kra?.defaultWeightagePct === undefined
          ? ''
          : String(kra.defaultWeightagePct),
      isActive: kra ? Boolean(kra.isActive) : true,
    });
    setLibModalOpen(true);
  };

  const saveLib = () => {
    setLibSaving(true);
    setLibError(null);
    const body: Record<string, unknown> = {
      code: libForm.code.trim(),
      name: libForm.name.trim(),
      description: libForm.description.trim() || null,
      departmentId: libForm.departmentId === '' ? null : Number(libForm.departmentId),
      defaultWeightagePct: libForm.defaultWeightagePct === '' ? undefined : Number(libForm.defaultWeightagePct),
      isActive: libForm.isActive,
    };
    const call = libEditing
      ? performanceApi.updateKra(Number(libEditing.id), body)
      : performanceApi.createKra(body);
    call
      .then(() => {
        setLibModalOpen(false);
        loadKras();
      })
      .catch((err) => setLibError(reason(err)))
      .finally(() => setLibSaving(false));
  };

  if (firstLoad && loading) return <LoadingBlock label="Loading KRAs…" />;

  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { id: 'employee', label: 'Employee KRAs', count: rows.length || null },
          { id: 'library', label: 'KRA Library', count: kras.length || null },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* --- Employee KRAs tab ------------------------------------------------ */}
      {tab === 'employee' && (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="w-64">
                <label className={LABEL_CLS} htmlFor="kra-cycle">
                  Cycle
                </label>
                <select
                  id="kra-cycle"
                  className={INPUT_CLS}
                  value={cycleId ?? ''}
                  onChange={(e) => setCycleId(e.target.value === '' ? null : Number(e.target.value))}
                >
                  {cycles.length === 0 && <option value="">No cycles</option>}
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} ({c.status})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="kra-status">
                  Status
                </label>
                <select
                  id="kra-status"
                  className={`${INPUT_CLS} w-44`}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {KRA_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s === 'ALL' ? 'All statuses' : s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={load} disabled={loading}>
                <span className="inline-flex items-center gap-2">
                  <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
                  Refresh
                </span>
              </button>
              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={() => {
                  setBulkEmployeeIds([]);
                  setBulkKraIds([]);
                  setBulkError(null);
                  setBulkResult(null);
                  setBulkOpen(true);
                }}
                disabled={cycleId === null}
              >
                <span className="inline-flex items-center gap-2">
                  <Users size={14} />
                  Bulk assign
                </span>
              </button>
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

          {grouped.length === 0 && !error ? (
            <EmptyBlock
              message="No KRAs assigned in this cycle"
              hint="Use Bulk assign to give employees their key result areas."
            />
          ) : (
            <div className="space-y-4">
              {grouped.map((g) => (
                <div key={g.employeeId} className="bg-bg-card border border-border-default rounded-md">
                  <div className="px-4 py-2.5 border-b border-border-default flex items-center justify-between gap-3">
                    <p className="text-text-primary text-sm font-semibold">{g.name}</p>
                    <span className="text-text-muted text-xs">
                      {g.rows.length} KRA(s) · total weight{' '}
                      {g.rows.reduce((s, r) => s + (num(r?.weightagePct) ?? 0), 0)}%
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-bg-secondary">
                        <tr>
                          {['KRA', 'Weight', 'Self', 'Manager', 'Final', 'Status', 'Actions'].map((h) => (
                            <th
                              key={h}
                              className="px-3 py-2 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-light">
                        {g.rows.map((r) => {
                          const st = String(r?.status ?? '');
                          return (
                            <tr key={r?.id} className="hover:bg-bg-hover transition-colors">
                              <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                                {text(r?.kraName)}
                                <p className="text-text-muted text-[11px] font-mono">{text(r?.kraCode)}</p>
                              </td>
                              <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                                {num(r?.weightagePct) ?? 0}%
                              </td>
                              <td className="px-3 py-2 text-xs text-text-primary font-mono text-right whitespace-nowrap">
                                {score(r?.selfScore)}
                              </td>
                              <td className="px-3 py-2 text-xs text-text-primary font-mono text-right whitespace-nowrap">
                                {score(r?.managerScore)}
                              </td>
                              <td className="px-3 py-2 text-xs text-text-primary font-mono font-semibold text-right whitespace-nowrap">
                                {score(r?.finalScore)}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                <Chip label={text(r?.status).replace(/_/g, ' ')} tone={statusTone(r?.status)} dot />
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  {st !== 'FINALIZED' && (
                                    <>
                                      <button
                                        type="button"
                                        className="text-primary text-xs font-medium hover:underline"
                                        onClick={() => openScore(r, 'self')}
                                      >
                                        Self-score
                                      </button>
                                      <button
                                        type="button"
                                        className="text-primary text-xs font-medium hover:underline"
                                        onClick={() => openScore(r, 'manager')}
                                      >
                                        Manager
                                      </button>
                                      <button
                                        type="button"
                                        className="text-success text-xs font-medium hover:underline"
                                        onClick={() => openScore(r, 'finalize')}
                                      >
                                        Finalize
                                      </button>
                                    </>
                                  )}
                                  {st === 'FINALIZED' && r?.remarks && (
                                    <span className="text-text-muted text-[11px] italic truncate max-w-[160px]">
                                      {String(r.remarks)}
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* --- Library tab ------------------------------------------------------- */}
      {tab === 'library' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-text-muted text-xs">
              KRAs can be tied to a department; the default weightage pre-fills bulk assignments.
            </p>
            <button type="button" className={BTN_PRIMARY} onClick={() => openLibModal(null)}>
              <span className="inline-flex items-center gap-2">
                <Plus size={14} />
                New KRA
              </span>
            </button>
          </div>
          {krasLoading && <LoadingBlock label="Loading the KRA library…" />}
          {krasError && <ErrorBlock message={krasError} />}
          {!krasLoading && !krasError && kras.length === 0 && <EmptyBlock message="No KRAs defined yet" />}
          {!krasLoading && !krasError && kras.length > 0 && (
            <TableShell headers={['Code', 'Name', 'Department', 'Default weight', 'Active', '']}>
              {kras.map((k) => (
                <tr key={k?.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs text-text-muted font-mono whitespace-nowrap">{text(k?.code)}</td>
                  <td className="px-3 py-2 text-xs text-text-primary">
                    {text(k?.name)}
                    {k?.description && <p className="text-text-muted text-[11px]">{String(k.description)}</p>}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                    {text(k?.departmentName)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                    {num(k?.defaultWeightagePct) === null ? '—' : `${k.defaultWeightagePct}%`}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Chip label={k?.isActive ? 'Active' : 'Inactive'} tone={k?.isActive ? 'success' : 'default'} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      className="text-primary text-xs font-medium hover:underline"
                      onClick={() => openLibModal(k)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}

      {/* --- Score modal --------------------------------------------------------- */}
      <AnimatePresence>
        {scoring && (
          <ModalShell
            title={
              scoreMode === 'self'
                ? 'Self score'
                : scoreMode === 'manager'
                  ? 'Manager score'
                  : 'Finalize KRA'
            }
            subtitle={`${text(scoring.employeeName)} · ${text(scoring.kraName)}`}
            onClose={() => setScoring(null)}
            maxWidth="max-w-md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setScoring(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={submitScore}
                  disabled={scoreSaving || (scoreMode !== 'finalize' && scoreValue === '')}
                >
                  {scoreSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {scoreError && <ErrorBlock message={scoreError} />}
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span>Self {score(scoring.selfScore)}</span>
                <span>Manager {score(scoring.managerScore)}</span>
                <span>Final {score(scoring.finalScore)}</span>
              </div>
              <div>
                <label className={LABEL_CLS}>
                  {scoreMode === 'finalize' ? 'Final score (blank = use manager, then self score)' : 'Score'}
                </label>
                <input
                  type="number"
                  step="0.1"
                  className={INPUT_CLS}
                  value={scoreValue}
                  onChange={(e) => setScoreValue(e.target.value)}
                />
              </div>
              {scoreMode !== 'finalize' && (
                <div>
                  <label className={LABEL_CLS}>Remarks</label>
                  <textarea
                    className={`${INPUT_CLS} min-h-[60px]`}
                    value={scoreRemarks}
                    onChange={(e) => setScoreRemarks(e.target.value)}
                  />
                </div>
              )}
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* --- Bulk assign modal ----------------------------------------------------- */}
      <AnimatePresence>
        {bulkOpen && (
          <ModalShell
            title="Bulk assign KRAs"
            subtitle={`Cycle: ${cycles.find((c) => Number(c.id) === cycleId)?.code ?? '—'} — every selected employee gets every selected KRA`}
            onClose={() => setBulkOpen(false)}
            maxWidth="max-w-2xl"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setBulkOpen(false)}>
                  Close
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={runBulk}
                  disabled={bulkSaving || bulkEmployeeIds.length === 0 || bulkKraIds.length === 0}
                >
                  {bulkSaving ? 'Assigning…' : `Assign (${bulkEmployeeIds.length} × ${bulkKraIds.length})`}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {bulkError && <ErrorBlock message={bulkError} />}

              {bulkResult && (
                <div className="rounded-md bg-bg-secondary border border-border-light p-3 space-y-2">
                  <p className="text-text-primary text-xs font-medium">
                    {num(bulkResult.created) ?? 0} assignment(s) created ·{' '}
                    {Array.isArray(bulkResult.skipped) ? bulkResult.skipped.length : 0} skipped
                  </p>
                  {Array.isArray(bulkResult.skipped) && bulkResult.skipped.length > 0 && (
                    <ul className="space-y-1 list-disc list-inside max-h-40 overflow-y-auto scrollbar-thin">
                      {bulkResult.skipped.map((s: any, index: number) => {
                        const emp = employees.find((e) => e.id === Number(s?.employeeId));
                        const kra = kras.find((k) => Number(k.id) === Number(s?.kraId));
                        return (
                          <li key={index} className="text-text-secondary text-xs">
                            {emp ? emp.fullName : `Employee ${s?.employeeId}`} ×{' '}
                            {kra ? kra.name : `KRA ${s?.kraId}`} — {text(s?.reason)}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLS}>Employees ({bulkEmployeeIds.length})</label>
                  <div className="max-h-64 overflow-y-auto scrollbar-thin rounded-md border border-border-default divide-y divide-border-light">
                    {employees.map((e) => (
                      <label
                        key={e.id}
                        className="flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-hover cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={bulkEmployeeIds.includes(e.id)}
                          onChange={() =>
                            setBulkEmployeeIds((prev) =>
                              prev.includes(e.id) ? prev.filter((x) => x !== e.id) : [...prev, e.id],
                            )
                          }
                        />
                        {e.fullName}
                        <span className="text-text-muted font-mono ml-auto">{e.empCode}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={LABEL_CLS}>KRAs ({bulkKraIds.length})</label>
                  <div className="max-h-64 overflow-y-auto scrollbar-thin rounded-md border border-border-default divide-y divide-border-light">
                    {kras
                      .filter((k) => k?.isActive)
                      .map((k) => (
                        <label
                          key={k.id}
                          className="flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-hover cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={bulkKraIds.includes(Number(k.id))}
                            onChange={() =>
                              setBulkKraIds((prev) =>
                                prev.includes(Number(k.id))
                                  ? prev.filter((x) => x !== Number(k.id))
                                  : [...prev, Number(k.id)],
                              )
                            }
                          />
                          {k.name}
                          <span className="text-text-muted ml-auto">{num(k.defaultWeightagePct) ?? 0}%</span>
                        </label>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* --- Library create/edit modal ---------------------------------------------- */}
      <AnimatePresence>
        {libModalOpen && (
          <ModalShell
            title={libEditing ? `Edit KRA ${libEditing.code}` : 'New KRA'}
            onClose={() => setLibModalOpen(false)}
            maxWidth="max-w-md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setLibModalOpen(false)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={saveLib} disabled={libSaving}>
                  {libSaving ? 'Saving…' : libEditing ? 'Save changes' : 'Create KRA'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {libError && <ErrorBlock message={libError} />}
              <div>
                <label className={LABEL_CLS}>Code</label>
                <input
                  className={INPUT_CLS}
                  value={libForm.code}
                  onChange={(e) => setLibForm((f) => ({ ...f, code: e.target.value }))}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Name</label>
                <input
                  className={INPUT_CLS}
                  value={libForm.name}
                  onChange={(e) => setLibForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Description</label>
                <textarea
                  className={`${INPUT_CLS} min-h-[60px]`}
                  value={libForm.description}
                  onChange={(e) => setLibForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Department (optional)</label>
                  <select
                    className={INPUT_CLS}
                    value={libForm.departmentId}
                    onChange={(e) => setLibForm((f) => ({ ...f, departmentId: e.target.value }))}
                  >
                    <option value="">Any department</option>
                    {departments.map((d: any) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Default weightage %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={INPUT_CLS}
                    value={libForm.defaultWeightagePct}
                    onChange={(e) => setLibForm((f) => ({ ...f, defaultWeightagePct: e.target.value }))}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-text-primary">
                <input
                  type="checkbox"
                  checked={libForm.isActive}
                  onChange={(e) => setLibForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                Active
              </label>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
