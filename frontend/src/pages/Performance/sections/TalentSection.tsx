import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Plus, Star, Trash2, Users } from 'lucide-react';
import { performanceApi, talentApi } from '../../../api/performance';
import { api } from '../../../api/client';
import { orgApi } from '../../../api/organization';
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
import { ModalShell } from '../../../components/common/ModalShell';
import { TabBar } from '../../../components/common/TabBar';
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------
// talentApi's pool-member removal points at /talent/talent/members/:id and the
// succession-candidate helpers at /talent/candidates/:id, but the backend
// serves /talent/talent/pools/members/:id and /talent/succession/candidates/:id
// (and the pool detail GET has no helper). These wrappers use verified routes.
// ---------------------------------------------------------------------------
const talentFix = {
  poolDetail: (id: number) => api.get<any>(`/talent/talent/pools/${id}`),
  removePoolMember: (memberId: number) => api.delete<any>(`/talent/talent/pools/members/${memberId}`),
  updateCandidate: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/talent/succession/candidates/${id}`, body),
  removeCandidate: (id: number) => api.delete<any>(`/talent/succession/candidates/${id}`),
};

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const POOL_TYPES = ['HIPO', 'LEADERSHIP', 'CRITICAL_SKILL', 'SUCCESSOR', 'CUSTOM'];
const CRITICALITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const RISK = ['LOW', 'MEDIUM', 'HIGH'];
const READINESS = ['READY_NOW', 'READY_1_YEAR', 'READY_2_YEARS', 'DEVELOPMENT_NEEDED'];

const READINESS_TONE: Record<string, Tone> = {
  READY_NOW: 'success',
  READY_1_YEAR: 'info',
  READY_2_YEARS: 'warning',
  DEVELOPMENT_NEEDED: 'default',
};

const LEVEL_TONE: Record<string, Tone> = {
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'danger',
  CRITICAL: 'danger',
};

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? '—' : s;
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

// ---------------------------------------------------------------------------

export function TalentSection() {
  const [tab, setTab] = useState('matrix');

  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { id: 'matrix', label: '9-Box Matrix' },
          { id: 'pools', label: 'Talent Pools' },
          { id: 'succession', label: 'Succession' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'matrix' && <MatrixTab />}
      {tab === 'pools' && <PoolsTab />}
      {tab === 'succession' && <SuccessionTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 9-Box matrix
// ---------------------------------------------------------------------------

/** Cell tints: greens for the top boxes, warm for the bottom-left, neutral mid. */
function cellClasses(position: number): string {
  if (position === 8 || position === 9) return 'bg-success-light border-success/30';
  if (position === 1 || position === 2) return 'bg-warning-light border-warning/30';
  if (position === 6) return 'bg-success-light/50 border-border-default';
  return 'bg-bg-secondary border-border-default';
}

function MatrixTab() {
  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assessing, setAssessing] = useState<any | null>(null);

  useEffect(() => {
    performanceApi
      .cycles()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setCycles(list);
        const annual = list.find((c) => c?.status === 'ACTIVE' && c?.cycleType === 'ANNUAL') ?? list[0];
        if (annual?.id) setCycleId(Number(annual.id));
      })
      .catch((err) => setError(reason(err)));
  }, []);

  const load = useCallback(() => {
    if (cycleId === null) return;
    setLoading(true);
    setError(null);
    talentApi
      .talentMatrix(cycleId)
      .then((res) => setData(res ?? null))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [cycleId]);

  useEffect(() => {
    load();
  }, [load]);

  const boxes: any[] = Array.isArray(data?.boxes) ? data.boxes : [];
  const unassessed: any[] = Array.isArray(data?.unassessed) ? data.unassessed : [];
  const boxAt = (position: number) => boxes.find((b) => Number(b.position) === position);

  // Grid rows: potential high → low (top row = positions 7,8,9),
  // columns: performance low → high.
  const gridRows = [
    [7, 8, 9],
    [4, 5, 6],
    [1, 2, 3],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="w-64">
          <label className={LABEL_CLS} htmlFor="mx-cycle">
            Performance cycle
          </label>
          <select
            id="mx-cycle"
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
        <p className="text-text-muted text-[11px]">
          Box position and the HiPo flag are derived server-side from the two scores — they are not set by hand.
        </p>
      </div>

      {loading && <LoadingBlock label="Loading the talent matrix…" />}
      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="flex gap-2">
            <div className="flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] uppercase tracking-wider text-text-muted [writing-mode:vertical-rl] rotate-180">
                Potential →
              </span>
            </div>
            <div className="flex-1 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                {gridRows.flat().map((position) => {
                  const box = boxAt(position);
                  const emps: any[] = Array.isArray(box?.employees) ? box.employees : [];
                  return (
                    <div key={position} className={`rounded-md border p-3 min-h-28 ${cellClasses(position)}`}>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-text-primary text-xs font-semibold">{text(box?.label)}</p>
                        <span className="text-text-muted text-[10px] font-mono">#{position}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {emps.length === 0 && <span className="text-text-muted text-[11px]">—</span>}
                        {emps.map((e) => (
                          <button
                            key={e.employeeId}
                            type="button"
                            title={`Perf ${e.performanceScore} · Pot ${e.potentialScore}${e.attritionRisk ? ` · attrition ${e.attritionRisk}` : ''}`}
                            onClick={() => setAssessing({ employeeId: e.employeeId, employeeName: e.employeeName, existing: e })}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-card border border-border-default text-[11px] text-text-primary hover:border-primary/40 transition-colors"
                          >
                            {e.isHipo && <Star size={11} className="text-warning fill-warning" />}
                            {text(e.employeeName)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-center text-[10px] uppercase tracking-wider text-text-muted">Performance →</p>
            </div>
          </div>

          <div className="rounded-md border border-border-default bg-bg-card p-4 space-y-2">
            <p className="text-text-primary text-sm font-semibold">
              Unassessed employees ({unassessed.length})
            </p>
            {unassessed.length === 0 ? (
              <p className="text-text-muted text-xs">Every working employee has an assessment in this cycle.</p>
            ) : (
              <div className="space-y-1.5">
                {unassessed.map((e) => (
                  <div key={e.employeeId} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-text-secondary">
                      {text(e.employeeName)} <span className="text-text-muted font-mono">({text(e.empCode)})</span>
                      {e.grade && <span className="text-text-muted ml-2">grade {e.grade}</span>}
                    </span>
                    <button
                      type="button"
                      className="text-primary text-xs font-medium hover:underline"
                      onClick={() => setAssessing({ employeeId: e.employeeId, employeeName: e.employeeName, existing: null })}
                    >
                      Assess
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <AnimatePresence>
        {assessing && cycleId !== null && (
          <AssessModal
            cycleId={cycleId}
            employeeId={Number(assessing.employeeId)}
            employeeName={String(assessing.employeeName ?? '')}
            existing={assessing.existing}
            onClose={() => setAssessing(null)}
            onSaved={() => {
              setAssessing(null);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function AssessModal({
  cycleId,
  employeeId,
  employeeName,
  existing,
  onClose,
  onSaved,
}: {
  cycleId: number;
  employeeId: number;
  employeeName: string;
  existing: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [performanceScore, setPerformanceScore] = useState(
    existing?.performanceScore !== undefined && existing?.performanceScore !== null ? String(existing.performanceScore) : '',
  );
  const [potentialScore, setPotentialScore] = useState(
    existing?.potentialScore !== undefined && existing?.potentialScore !== null ? String(existing.potentialScore) : '',
  );
  const [attritionRisk, setAttritionRisk] = useState<string>(existing?.attritionRisk ?? '');
  const [note, setNote] = useState<string>(existing?.assessmentNote ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setBusy(true);
    setError(null);
    talentApi
      .assessTalent({
        cycleId,
        employeeId,
        performanceScore: Number(performanceScore),
        potentialScore: Number(potentialScore),
        attritionRisk: attritionRisk || null,
        note: note.trim() || null,
      })
      .then(() => onSaved())
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title={`Assess — ${employeeName}`}
      subtitle="The box and HiPo flag are computed server-side from these two scores (upsert)."
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy || performanceScore === '' || potentialScore === ''}
            onClick={save}
          >
            {busy ? 'Saving…' : 'Save assessment'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBlock message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Performance score (0–5)</label>
            <input
              type="number"
              min={0}
              max={5}
              step={0.5}
              className={INPUT_CLS}
              value={performanceScore}
              onChange={(e) => setPerformanceScore(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Potential score (0–5)</label>
            <input
              type="number"
              min={0}
              max={5}
              step={0.5}
              className={INPUT_CLS}
              value={potentialScore}
              onChange={(e) => setPotentialScore(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Attrition risk</label>
            <select className={INPUT_CLS} value={attritionRisk} onChange={(e) => setAttritionRisk(e.target.value)}>
              <option value="">Not set</option>
              {RISK.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={LABEL_CLS}>Note</label>
          <textarea className={INPUT_CLS} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Talent pools
// ---------------------------------------------------------------------------

function PoolsTab() {
  const [pools, setPools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null | 'new'>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    talentApi
      .talentPools()
      .then((rows) => setPools(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingBlock label="Loading talent pools…" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className={BTN_PRIMARY} onClick={() => setEditing('new')}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} /> New pool
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

      {!error && pools.length === 0 && <EmptyBlock message="No talent pools yet" />}

      {pools.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {pools.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setDetailId(Number(p.id))}
              className="text-left bg-bg-card border border-border-default rounded-md p-4 hover:border-primary/40 transition-colors space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-text-primary text-sm font-semibold flex items-center gap-1.5">
                  <Users size={15} className="text-primary" /> {text(p.name)}
                </p>
                <Chip label={text(p.poolType).replace(/_/g, ' ')} tone={p.poolType === 'HIPO' ? 'success' : 'info'} />
              </div>
              {p.description && <p className="text-text-muted text-xs">{p.description}</p>}
              <div className="flex items-center gap-2 text-[11px] text-text-muted">
                <span className="font-mono">{text(p.code)}</span>
                <span>· {Number(p.memberCount ?? 0)} member(s)</span>
                {!p.isActive && <Chip label="Inactive" tone="default" />}
              </div>
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>
        {editing !== null && (
          <PoolEditorModal
            pool={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        )}
        {detailId !== null && (
          <PoolDetailModal
            poolId={detailId}
            onClose={() => setDetailId(null)}
            onChanged={load}
            onEdit={(pool) => {
              setDetailId(null);
              setEditing(pool);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function PoolEditorModal({ pool, onClose, onSaved }: { pool: any | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState<string>(pool?.code ?? '');
  const [name, setName] = useState<string>(pool?.name ?? '');
  const [poolType, setPoolType] = useState<string>(pool?.poolType ?? 'CUSTOM');
  const [description, setDescription] = useState<string>(pool?.description ?? '');
  const [isActive, setIsActive] = useState<boolean>(pool ? !!pool.isActive : true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setBusy(true);
    setError(null);
    const body = { code: code.trim(), name: name.trim(), poolType, description: description.trim() || null, isActive };
    const call = pool ? talentApi.updateTalentPool(Number(pool.id), body) : talentApi.createTalentPool(body);
    call
      .then(() => onSaved())
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title={pool ? `Edit pool — ${pool.name}` : 'New talent pool'}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !code.trim() || !name.trim()} onClick={save}>
            {busy ? 'Saving…' : 'Save pool'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBlock message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Code</label>
            <input className={INPUT_CLS} value={code} onChange={(e) => setCode(e.target.value)} disabled={!!pool} />
          </div>
          <div>
            <label className={LABEL_CLS}>Name</label>
            <input className={INPUT_CLS} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Type</label>
            <select className={INPUT_CLS} value={poolType} onChange={(e) => setPoolType(e.target.value)}>
              {POOL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active
            </label>
          </div>
        </div>
        <div>
          <label className={LABEL_CLS}>Description</label>
          <textarea className={INPUT_CLS} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
    </ModalShell>
  );
}

function PoolDetailModal({
  poolId,
  onClose,
  onChanged,
  onEdit,
}: {
  poolId: number;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (pool: any) => void;
}) {
  const { employees } = useApp();
  const [pool, setPool] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [memberNote, setMemberNote] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    talentFix
      .poolDetail(poolId)
      .then((p) => setPool(p ?? null))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [poolId]);

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
      })
      .catch((err) => setActionError(reason(err)))
      .finally(() => setBusy(false));
  };

  const members: any[] = Array.isArray(pool?.members) ? pool.members : [];

  return (
    <ModalShell
      title={pool ? `Pool — ${text(pool.name)}` : 'Talent pool'}
      subtitle={pool ? `${text(pool.code)} · ${text(pool.poolType)}` : null}
      onClose={onClose}
      maxWidth="max-w-xl"
      footer={
        pool ? (
          <div className="flex items-center justify-end">
            <button type="button" className={BTN_SECONDARY} onClick={() => onEdit(pool)}>
              Edit pool
            </button>
          </div>
        ) : null
      }
    >
      {loading ? (
        <LoadingBlock label="Loading the pool…" />
      ) : error ? (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      ) : pool ? (
        <div className="space-y-4">
          {actionError && <ErrorBlock message={actionError} />}
          {pool.description && <p className="text-text-secondary text-xs">{pool.description}</p>}

          <div className="space-y-2">
            <p className="text-text-primary text-sm font-semibold">Members ({members.length})</p>
            {members.length === 0 && <EmptyBlock message="No members in this pool" />}
            {members.map((m) => (
              <div
                key={m.id}
                className="rounded-md border border-border-light bg-bg-secondary p-3 flex items-start justify-between gap-3"
              >
                <div>
                  <p className="text-text-primary text-xs font-medium">{text(m.employeeName)}</p>
                  {m.note && <p className="text-text-muted text-[11px] mt-0.5">{m.note}</p>}
                </div>
                <button
                  type="button"
                  aria-label="Remove member"
                  className="text-text-muted hover:text-danger transition-colors flex-shrink-0"
                  disabled={busy}
                  onClick={() => {
                    const ok = window.confirm(
                      'Remove this member? The membership row is kept with a removed_at timestamp — history is preserved, not deleted.',
                    );
                    if (ok) run(() => talentFix.removePoolMember(Number(m.id)));
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-border-default p-3 space-y-3">
            <p className="text-text-primary text-sm font-semibold">Add member</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Employee</label>
                <select className={INPUT_CLS} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                  <option value="">Select…</option>
                  {(employees ?? []).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.empCode} · {emp.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Note (optional)</label>
                <input className={INPUT_CLS} value={memberNote} onChange={(e) => setMemberNote(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={busy || !memberId}
                onClick={() =>
                  run(() =>
                    talentApi.addPoolMember(poolId, {
                      employeeId: Number(memberId),
                      note: memberNote.trim() || undefined,
                    }),
                  )
                }
              >
                {busy ? 'Saving…' : 'Add member'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Succession
// ---------------------------------------------------------------------------

function SuccessionTab() {
  const [plans, setPlans] = useState<any[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([talentApi.successionPlans(), talentApi.successionDashboard().catch(() => null)])
      .then(([rows, dash]) => {
        const list = Array.isArray(rows) ? rows : [];
        setPlans(list);
        setDashboard(dash ?? null);
        // Keep an open detail modal in sync after mutations.
        setDetail((prev: any) => (prev ? list.find((p) => Number(p.id) === Number(prev.id)) ?? null : prev));
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && plans.length === 0) return <LoadingBlock label="Loading succession plans…" />;

  const positionLabel = (p: any) => p?.positionName ?? p?.roleName ?? (p?.incumbentName ? `${p.incumbentName}'s seat` : '—');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Plans" value={Number(dashboard?.plans ?? 0)} />
        <StatCard
          label="Coverage (ready now)"
          value={Number(dashboard?.coverage ?? 0)}
          intent={Number(dashboard?.coverage ?? 0) > 0 ? 'success' : 'warning'}
          hint="Plans with at least one READY_NOW candidate"
        />
        <StatCard
          label="Gaps"
          value={Number(dashboard?.gaps ?? 0)}
          intent={Number(dashboard?.gaps ?? 0) > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="High risk"
          value={Number(dashboard?.highRisk ?? 0)}
          intent={Number(dashboard?.highRisk ?? 0) > 0 ? 'danger' : 'success'}
        />
      </div>

      <div className="flex justify-end">
        <button type="button" className={BTN_PRIMARY} onClick={() => setCreateOpen(true)}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} /> New plan
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

      {!error && plans.length === 0 && <EmptyBlock message="No succession plans yet" />}

      {plans.length > 0 && (
        <TableShell headers={['Position / role', 'Incumbent', 'Criticality', 'Risk of loss', 'Candidates', 'Status']}>
          {plans.map((p) => (
            <tr key={p.id} className="hover:bg-bg-hover transition-colors cursor-pointer" onClick={() => setDetail(p)}>
              <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{positionLabel(p)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(p.incumbentName)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip label={text(p.criticality)} tone={LEVEL_TONE[p.criticality] ?? 'default'} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip label={text(p.riskOfLoss)} tone={LEVEL_TONE[p.riskOfLoss] ?? 'default'} />
              </td>
              <td className="px-3 py-2 text-xs font-mono text-text-secondary">
                {(Array.isArray(p.candidates) ? p.candidates : []).length}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip label={text(p.status)} tone={p.status === 'ACTIVE' ? 'info' : 'default'} dot />
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {createOpen && (
          <SuccessionPlanModal
            onClose={() => setCreateOpen(false)}
            onSaved={() => {
              setCreateOpen(false);
              load();
            }}
          />
        )}
        {detail && <SuccessionDetailModal plan={detail} onClose={() => setDetail(null)} onChanged={load} />}
      </AnimatePresence>
    </div>
  );
}

function SuccessionPlanModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { employees } = useApp();
  const [roles, setRoles] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);

  const [positionId, setPositionId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [incumbentId, setIncumbentId] = useState('');
  const [criticality, setCriticality] = useState('MEDIUM');
  const [riskOfLoss, setRiskOfLoss] = useState('LOW');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orgApi.jobRoles
      .list()
      .then((rows: any) => setRoles(Array.isArray(rows) ? rows : []))
      .catch(() => setRoles([]));
    orgApi.positions
      .list()
      .then((rows: any) => setPositions(Array.isArray(rows) ? rows : []))
      .catch(() => setPositions([]));
  }, []);

  const save = () => {
    setBusy(true);
    setError(null);
    talentApi
      .createSuccessionPlan({
        positionId: positionId ? Number(positionId) : undefined,
        roleId: roleId ? Number(roleId) : undefined,
        incumbentEmployeeId: incumbentId ? Number(incumbentId) : undefined,
        criticality,
        riskOfLoss,
        notes: notes.trim() || undefined,
      })
      .then(() => onSaved())
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title="New succession plan"
      subtitle="At least one of position, role or incumbent is required."
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy || (!positionId && !roleId && !incumbentId)}
            onClick={save}
          >
            {busy ? 'Creating…' : 'Create plan'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBlock message={error} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Position</label>
            <select className={INPUT_CLS} value={positionId} onChange={(e) => setPositionId(e.target.value)}>
              <option value="">None</option>
              {positions.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.title ?? p.code ?? `Position #${p.id}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Role</label>
            <select className={INPUT_CLS} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">None</option>
              {roles.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name ?? r.code ?? `Role #${r.id}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Incumbent</label>
            <select className={INPUT_CLS} value={incumbentId} onChange={(e) => setIncumbentId(e.target.value)}>
              <option value="">None</option>
              {(employees ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.empCode} · {emp.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Criticality</label>
            <select className={INPUT_CLS} value={criticality} onChange={(e) => setCriticality(e.target.value)}>
              {CRITICALITY.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Risk of loss</label>
            <select className={INPUT_CLS} value={riskOfLoss} onChange={(e) => setRiskOfLoss(e.target.value)}>
              {RISK.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={LABEL_CLS}>Notes</label>
          <textarea className={INPUT_CLS} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </ModalShell>
  );
}

function SuccessionDetailModal({
  plan,
  onClose,
  onChanged,
}: {
  plan: any;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { employees } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [candidateId, setCandidateId] = useState('');
  const [readiness, setReadiness] = useState('DEVELOPMENT_NEEDED');
  const [ranking, setRanking] = useState('');
  const [developmentNote, setDevelopmentNote] = useState('');

  const run = (fn: () => Promise<any>) => {
    setBusy(true);
    setError(null);
    fn()
      .then(() => onChanged())
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  const candidates: any[] = [...(Array.isArray(plan.candidates) ? plan.candidates : [])].sort(
    (a, b) => Number(a?.ranking ?? 999) - Number(b?.ranking ?? 999),
  );

  return (
    <ModalShell
      title={`Succession — ${text(plan.positionName ?? plan.roleName ?? plan.incumbentName)}`}
      subtitle={`Incumbent ${text(plan.incumbentName)} · ${text(plan.criticality)} criticality · ${text(plan.riskOfLoss)} risk of loss`}
      onClose={onClose}
      maxWidth="max-w-xl"
    >
      <div className="space-y-4">
        {error && <ErrorBlock message={error} />}
        {plan.notes && <p className="text-text-secondary text-xs">{plan.notes}</p>}

        <div className="space-y-2">
          <p className="text-text-primary text-sm font-semibold">Candidates (ranked)</p>
          {candidates.length === 0 && <EmptyBlock message="No candidates yet — this plan is a coverage gap" />}
          {candidates.map((c) => (
            <div
              key={c.id}
              className="rounded-md border border-border-light bg-bg-secondary p-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-text-muted font-mono text-[11px]">#{c.ranking ?? '—'}</span>
                  <p className="text-text-primary text-xs font-medium">{text(c.employeeName)}</p>
                  <Chip label={text(c.readiness).replace(/_/g, ' ')} tone={READINESS_TONE[c.readiness] ?? 'default'} />
                </div>
                {c.developmentNote && <p className="text-text-muted text-[11px] mt-1">{c.developmentNote}</p>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <select
                  className={`${INPUT_CLS} py-1 w-44`}
                  value={c.readiness}
                  disabled={busy}
                  aria-label="Candidate readiness"
                  onChange={(e) => run(() => talentFix.updateCandidate(Number(c.id), { readiness: e.target.value }))}
                >
                  {READINESS.map((r) => (
                    <option key={r} value={r}>
                      {r.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="Remove candidate"
                  className="text-text-muted hover:text-danger transition-colors"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Remove this candidate from the plan?'))
                      run(() => talentFix.removeCandidate(Number(c.id)));
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-md border border-border-default p-3 space-y-3">
          <p className="text-text-primary text-sm font-semibold">Add candidate</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Employee</label>
              <select className={INPUT_CLS} value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
                <option value="">Select…</option>
                {(employees ?? []).map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.empCode} · {emp.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Readiness</label>
              <select className={INPUT_CLS} value={readiness} onChange={(e) => setReadiness(e.target.value)}>
                {READINESS.map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Ranking (optional)</label>
              <input type="number" min={1} className={INPUT_CLS} value={ranking} onChange={(e) => setRanking(e.target.value)} />
            </div>
            <div>
              <label className={LABEL_CLS}>Development note (optional)</label>
              <input className={INPUT_CLS} value={developmentNote} onChange={(e) => setDevelopmentNote(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={busy || !candidateId}
              onClick={() =>
                run(() =>
                  talentApi.addSuccessionCandidate(Number(plan.id), {
                    employeeId: Number(candidateId),
                    readiness,
                    ranking: ranking === '' ? undefined : Number(ranking),
                    developmentNote: developmentNote.trim() || undefined,
                  }),
                )
              }
            >
              {busy ? 'Saving…' : 'Add candidate'}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
