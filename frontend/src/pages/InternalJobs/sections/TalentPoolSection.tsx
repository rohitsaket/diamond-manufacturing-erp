import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Search, Star, Trash2, Users } from 'lucide-react';
import { performanceApi, talentApi } from '../../../api/performance';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  LoadingBlock,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

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

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

function rating(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : n.toFixed(1);
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

/**
 * Read-through of the Performance module's talent data for hiring decisions:
 * pools with membership editing, the HiPo/ready-now shortlist, and a search
 * over the skill matrix. Assessments themselves live in Performance.
 */
export function TalentPoolSection() {
  return (
    <div className="space-y-4">
      <PoolsPanel />
      <HipoReadyPanel />
      <TalentSearchPanel />
      <p className="text-text-muted text-[11px]">
        Talent assessments are managed in Performance → Talent &amp; Succession. This screen reuses that data for
        hiring — box positions, HiPo flags and readiness are never edited here.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

function PoolsPanel() {
  const [pools, setPools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <div className="space-y-2">
      <p className="text-text-primary text-sm font-semibold">Talent pools</p>
      {loading && <LoadingBlock label="Loading talent pools…" />}
      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}
      {!loading && !error && pools.length === 0 && (
        <EmptyBlock message="No talent pools yet" hint="Create pools in Performance → Talent & Succession." />
      )}
      {!loading && pools.length > 0 && (
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
        {detailId !== null && <PoolDetailModal poolId={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
      </AnimatePresence>
    </div>
  );
}

function PoolDetailModal({
  poolId,
  onClose,
  onChanged,
}: {
  poolId: number;
  onClose: () => void;
  onChanged: () => void;
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
    talentApi
      .talentPool(poolId)
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
                      'Remove this member? The membership row keeps a removed_at timestamp — history is preserved, not deleted.',
                    );
                    if (ok) run(() => talentApi.removePoolMember(Number(m.id)));
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
// HiPo & ready-now
// ---------------------------------------------------------------------------

function HipoReadyPanel() {
  const [hipos, setHipos] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [cycleName, setCycleName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    // The 9-box matrix needs a cycle — resolve the active annual one first,
    // exactly like the Performance module does.
    performanceApi
      .cycles()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        const annual = list.find((c) => c?.status === 'ACTIVE' && c?.cycleType === 'ANNUAL') ?? list[0];
        if (!annual?.id) throw new Error('No performance cycle exists, so the 9-box matrix has no data');
        setCycleName(String(annual.name ?? ''));
        return Promise.all([talentApi.talentMatrix(Number(annual.id)), talentApi.successionPlans().catch(() => [])]);
      })
      .then(([matrix, planRows]) => {
        const boxes: any[] = Array.isArray(matrix?.boxes) ? matrix.boxes : [];
        const flagged = boxes.flatMap((b) => (Array.isArray(b?.employees) ? b.employees : [])).filter((e) => e?.isHipo);
        setHipos(flagged);
        setPlans(Array.isArray(planRows) ? planRows : []);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const candidates = useMemo(
    () =>
      plans.flatMap((p) =>
        (Array.isArray(p?.candidates) ? p.candidates : []).map((c: any) => ({
          ...c,
          planLabel: p?.positionName ?? p?.roleName ?? (p?.incumbentName ? `${p.incumbentName}'s seat` : `Plan #${p?.id}`),
        })),
      ),
    [plans],
  );

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-text-primary text-sm font-semibold inline-flex items-center gap-1.5">
          <Star size={14} className="text-warning fill-warning" /> HiPo &amp; ready now
        </p>
        {cycleName && <span className="text-text-muted text-[11px]">Cycle: {cycleName}</span>}
      </div>

      {loading && <LoadingBlock label="Loading the talent shortlist…" />}
      {error && <ErrorBlock message={error} />}

      {!loading && !error && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className={LABEL_CLS}>High-potential (from the 9-box matrix)</p>
            {hipos.length === 0 ? (
              <p className="text-text-muted text-xs">No employee carries the HiPo flag in this cycle.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {hipos.map((e) => (
                  <span
                    key={e.employeeId}
                    title={`Perf ${rating(e.performanceScore)} · Pot ${rating(e.potentialScore)} · box ${e.boxPosition}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-secondary border border-border-default text-[11px] text-text-primary"
                  >
                    <Star size={11} className="text-warning fill-warning" />
                    {text(e.employeeName)}
                    <span className="text-text-muted font-mono">box {e.boxPosition}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className={LABEL_CLS}>Succession readiness</p>
            {candidates.length === 0 ? (
              <p className="text-text-muted text-xs">No succession candidates recorded.</p>
            ) : (
              <div className="space-y-1.5">
                {candidates.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 ${
                      c.readiness === 'READY_NOW'
                        ? 'bg-success-light border-success/30'
                        : 'bg-bg-secondary border-border-light'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-text-primary text-xs font-medium truncate">{text(c.employeeName)}</p>
                      <p className="text-text-muted text-[10px] truncate">for {text(c.planLabel)}</p>
                    </div>
                    <Chip
                      label={text(c.readiness).replace(/_/g, ' ')}
                      tone={READINESS_TONE[c.readiness] ?? 'default'}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Talent search over the skill matrix
// ---------------------------------------------------------------------------

function TalentSearchPanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    talentApi
      .skillMatrix()
      .then((res) => setRows(Array.isArray(res) ? res : []))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r?.employeeName, r?.empCode, r?.grade].some((v) => String(v ?? '').toLowerCase().includes(q)),
    );
  }, [rows, query]);

  return (
    <div className="bg-bg-card border border-border-default rounded-md p-4 space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <p className="text-text-primary text-sm font-semibold">Talent search</p>
        <div className="relative w-64">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className={`${INPUT_CLS} pl-8`}
            placeholder="Name, code or grade…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the skill matrix"
          />
        </div>
      </div>
      <p className="text-text-muted text-[11px]">
        The skill matrix returns per-category averages, not individual skill names — so the search matches name, code
        and grade. Open an employee in Performance → Competencies for the skill-level view.
      </p>

      {loading && <LoadingBlock label="Loading the skill matrix…" />}
      {error && <ErrorBlock message={error} />}

      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.length === 0 && <EmptyBlock message="No one matches this search" />}
          {filtered.map((r) => (
            <div key={r.employeeId} className="rounded-md border border-border-light bg-bg-secondary p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-text-primary text-xs font-semibold truncate">{text(r.employeeName)}</p>
                  <p className="text-text-muted text-[10px] font-mono">{text(r.empCode)}</p>
                </div>
                <Chip label={`Grade ${text(r.grade)}`} tone="default" />
              </div>
              <div className="grid grid-cols-4 gap-1 text-center">
                {[
                  ['Tech', r.avgTechnical],
                  ['Func', r.avgFunctional],
                  ['Lead', r.avgLeadership],
                  ['Behav', r.avgBehavioral],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded bg-bg-card border border-border-light py-1">
                    <p className="text-text-muted text-[9px] uppercase tracking-wider">{String(label)}</p>
                    <p className="text-text-primary text-xs font-mono">{rating(value)}</p>
                  </div>
                ))}
              </div>
              <p className="text-text-muted text-[10px]">{Number(r.skillCount ?? 0)} rated skill(s)</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
