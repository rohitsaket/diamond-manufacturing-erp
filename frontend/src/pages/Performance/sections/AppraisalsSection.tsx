import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Award, Download, Plus, Sparkles, Star } from 'lucide-react';
import { performanceApi, talentApi } from '../../../api/performance';
import { openAuthenticatedFile } from '../../../api/payroll';
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
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const APPRAISAL_STATUSES = ['PENDING', 'IN_REVIEW', 'CALIBRATED', 'FINALIZED', 'LETTER_ISSUED', 'ACKNOWLEDGED'];

const STATUS_TONE: Record<string, Tone> = {
  PENDING: 'default',
  IN_REVIEW: 'info',
  CALIBRATED: 'warning',
  FINALIZED: 'primary',
  LETTER_ISSUED: 'info',
  ACKNOWLEDGED: 'success',
};

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function score(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : String(n);
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

// ---------------------------------------------------------------------------

export function AppraisalsSection() {
  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [cyclesError, setCyclesError] = useState<string | null>(null);
  const [tab, setTab] = useState('appraisals');

  useEffect(() => {
    performanceApi
      .cycles()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setCycles(list);
        // Appraisals are generated on the annual cycle in the seed data;
        // default to the first ACTIVE ANNUAL cycle, then any active one.
        const annual = list.find((c) => c?.status === 'ACTIVE' && c?.cycleType === 'ANNUAL');
        const fallback = list.find((c) => c?.status === 'ACTIVE') ?? list[0];
        const chosen = annual ?? fallback;
        if (chosen?.id) setCycleId(Number(chosen.id));
      })
      .catch((err) => setCyclesError(reason(err)));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <TabBar
          tabs={[
            { id: 'appraisals', label: 'Appraisals' },
            { id: 'calibration', label: 'Calibration' },
          ]}
          active={tab}
          onChange={setTab}
        />
        <div className="w-64">
          <label className={LABEL_CLS} htmlFor="ap-cycle">
            Performance cycle
          </label>
          <select
            id="ap-cycle"
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
      </div>

      {cyclesError && <ErrorBlock message={cyclesError} />}
      {cycleId === null && !cyclesError && <LoadingBlock label="Loading cycles…" />}
      {cycleId !== null && tab === 'appraisals' && <AppraisalsTab cycleId={cycleId} />}
      {cycleId !== null && tab === 'calibration' && <CalibrationTab cycleId={cycleId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appraisals
// ---------------------------------------------------------------------------

function AppraisalsTab({ cycleId }: { cycleId: number }) {
  const { employees } = useApp();
  const empName = (id: unknown) => {
    const emp = (employees ?? []).find((e) => Number(e.id) === Number(id));
    return emp ? emp.fullName : `Employee #${id}`;
  };

  const [status, setStatus] = useState('ALL');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genResult, setGenResult] = useState<any>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    talentApi
      .appraisals({ cycleId })
      .then((list) => setRows(Array.isArray(list) ? list : []))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [cycleId]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = () => {
    setGenBusy(true);
    talentApi
      .generateAppraisals(cycleId)
      .then((res) => {
        setGenResult(res ?? null);
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setGenBusy(false));
  };

  const filtered = rows.filter((r) => status === 'ALL' || r?.status === status);
  const genEmployees: any[] = Array.isArray(genResult?.employees) ? genResult.employees : [];

  if (loading) return <LoadingBlock label="Loading appraisals…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {['ALL', ...APPRAISAL_STATUSES].map((s) => (
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
              {s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        <button type="button" className={BTN_PRIMARY} onClick={generate} disabled={genBusy}>
          <span className="inline-flex items-center gap-2">
            <Sparkles size={14} />
            {genBusy ? 'Generating…' : 'Generate appraisals'}
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

      {genResult && (
        <div className="rounded-md border border-border-default bg-bg-card p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Chip label={`${Number(genResult.created ?? 0)} created`} tone="success" />
              <Chip label={`${Number(genResult.skippedExisting ?? 0)} skipped (already existed)`} tone="default" />
            </div>
            <button
              type="button"
              className="text-text-muted text-xs hover:text-text-primary"
              onClick={() => setGenResult(null)}
            >
              Dismiss
            </button>
          </div>
          {genEmployees.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-text-muted text-[11px]">
                Components actually used per employee — an empty component list means no goal, KRA, KPI or competency
                data existed to score, and the appraisal starts with no total score.
              </p>
              {genEmployees.map((e: any) => {
                const used: string[] = Array.isArray(e?.componentsUsed) ? e.componentsUsed : [];
                return (
                  <div key={e.employeeId} className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="text-text-secondary">
                      {empName(e.employeeId)} <span className="text-text-muted font-mono">({text(e.empCode)})</span>
                    </span>
                    {used.length === 0 ? (
                      <Chip label="no data" tone="warning" />
                    ) : (
                      used.map((c) => <Chip key={c} label={c} tone="info" />)
                    )}
                    <span className="text-text-muted font-mono">total {score(e.totalScore)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!error && filtered.length === 0 && (
        <EmptyBlock message="No appraisals for these filters" hint="Generate appraisals for this cycle to score employees." />
      )}

      {!error && filtered.length > 0 && (
        <TableShell
          headers={['Employee', 'Goal', 'KRA', 'KPI', 'Comp', 'Total', 'Self', 'Mgr', 'Calib', 'Final', 'Label', 'Status', 'Promo']}
        >
          {filtered.map((r) => (
            <tr
              key={r.id}
              className="hover:bg-bg-hover transition-colors cursor-pointer"
              onClick={() => setDetailId(Number(r.id))}
            >
              <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                {text(r.employeeName)}
                <span className="block text-text-muted font-mono text-[11px]">{text(r.empCode)}</span>
              </td>
              <td className="px-3 py-2 text-xs font-mono text-text-secondary">{score(r.goalScore)}</td>
              <td className="px-3 py-2 text-xs font-mono text-text-secondary">{score(r.kraScore)}</td>
              <td className="px-3 py-2 text-xs font-mono text-text-secondary">{score(r.kpiScore)}</td>
              <td className="px-3 py-2 text-xs font-mono text-text-secondary">{score(r.competencyScore)}</td>
              <td className="px-3 py-2 text-xs font-mono text-text-primary">{score(r.totalScore)}</td>
              <td className="px-3 py-2 text-xs font-mono text-text-secondary">{score(r.selfRating)}</td>
              <td className="px-3 py-2 text-xs font-mono text-text-secondary">{score(r.managerRating)}</td>
              <td className="px-3 py-2 text-xs font-mono text-text-secondary">{score(r.calibratedRating)}</td>
              <td className="px-3 py-2 text-xs font-mono text-text-primary">{score(r.finalRating)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {r.ratingLabel ? <Chip label={String(r.ratingLabel)} tone="primary" /> : <span className="text-text-muted text-xs">—</span>}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip label={text(r.status).replace(/_/g, ' ')} tone={STATUS_TONE[r.status] ?? 'default'} dot />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {r.promotionRecommended ? <Star size={14} className="text-warning fill-warning" /> : null}
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {detailId !== null && (
          <AppraisalDetailModal appraisalId={detailId} onClose={() => setDetailId(null)} onChanged={load} />
        )}
      </AnimatePresence>
    </div>
  );
}

function ScoreLadderRow({ label, value }: { label: string; value: unknown }) {
  const n = num(value);
  return (
    <div className="flex items-baseline justify-between gap-6 py-1.5">
      <span className="text-xs text-text-secondary">{label}</span>
      {n === null ? (
        <span className="text-xs text-text-muted">
          — <span className="text-[10px]">no data recorded</span>
        </span>
      ) : (
        <span className="text-xs font-mono tabular-nums text-text-primary">{n}</span>
      )}
    </div>
  );
}

function AppraisalDetailModal({
  appraisalId,
  onClose,
  onChanged,
}: {
  appraisalId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [row, setRow] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finalizeNote, setFinalizeNote] = useState<string | null>(null);

  // Manager assessment editor
  const [managerRating, setManagerRating] = useState('');
  const [remarks, setRemarks] = useState('');
  const [salaryIncreasePct, setSalaryIncreasePct] = useState('');
  const [promotionRecommended, setPromotionRecommended] = useState(false);
  const [finalOverride, setFinalOverride] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    talentApi
      .appraisal(appraisalId)
      .then((r) => {
        setRow(r ?? null);
        setManagerRating(r?.managerRating !== null && r?.managerRating !== undefined ? String(r.managerRating) : '');
        setRemarks(r?.remarks ?? '');
        setSalaryIncreasePct(
          r?.salaryIncreasePct !== null && r?.salaryIncreasePct !== undefined ? String(r.salaryIncreasePct) : '',
        );
        setPromotionRecommended(!!r?.promotionRecommended);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [appraisalId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = (fn: () => Promise<any>, after?: (res: any) => void) => {
    setBusy(true);
    setActionError(null);
    fn()
      .then((res) => {
        after?.(res);
        load();
        onChanged();
      })
      .catch((err) => setActionError(reason(err)))
      .finally(() => setBusy(false));
  };

  const saveAssessment = () =>
    run(() =>
      talentApi.updateAppraisal(appraisalId, {
        managerRating: managerRating === '' ? null : Number(managerRating),
        remarks: remarks.trim() || null,
        salaryIncreasePct: salaryIncreasePct === '' ? null : Number(salaryIncreasePct),
        promotionRecommended,
      }),
    );

  const finalize = () =>
    run(
      () => talentApi.finalizeAppraisal(appraisalId, finalOverride === '' ? {} : { finalRating: Number(finalOverride) }),
      (res) => setFinalizeNote(res?.note ? String(res.note) : null),
    );

  const issueLetter = () =>
    run(
      () => talentApi.issueAppraisalLetter(appraisalId),
      () => {
        openAuthenticatedFile(talentApi.appraisalLetterUrl(appraisalId), 'appraisal-letter.pdf').catch((err) =>
          setActionError(reason(err)),
        );
      },
    );

  const editable = row && !['FINALIZED', 'LETTER_ISSUED', 'ACKNOWLEDGED'].includes(row.status);
  const canFinalize = editable;
  const canIssue = row && ['FINALIZED', 'LETTER_ISSUED', 'ACKNOWLEDGED'].includes(row.status);
  const canAcknowledge = row && ['FINALIZED', 'LETTER_ISSUED'].includes(row.status);

  return (
    <ModalShell
      title={row ? `Appraisal — ${text(row.employeeName)}` : 'Appraisal'}
      subtitle={row ? `${text(row.cycleName)} · ${text(row.empCode)}` : null}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        row ? (
          <div className="flex items-center justify-end gap-2 flex-wrap">
            {canIssue && (
              <>
                <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={issueLetter}>
                  <span className="inline-flex items-center gap-1.5">
                    <Award size={14} /> Issue letter
                  </span>
                </button>
                {row.letterNumber && (
                  <button
                    type="button"
                    className={BTN_SECONDARY}
                    onClick={() =>
                      openAuthenticatedFile(talentApi.appraisalLetterUrl(appraisalId), 'appraisal-letter.pdf').catch(
                        (err) => setActionError(reason(err)),
                      )
                    }
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Download size={14} /> Letter PDF
                    </span>
                  </button>
                )}
              </>
            )}
            {canAcknowledge && (
              <button
                type="button"
                className={BTN_SECONDARY}
                disabled={busy}
                onClick={() => run(() => talentApi.acknowledgeAppraisal(appraisalId))}
              >
                Acknowledge
              </button>
            )}
            {canFinalize && (
              <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={finalize}>
                Finalize
              </button>
            )}
          </div>
        ) : null
      }
    >
      {loading ? (
        <LoadingBlock label="Loading the appraisal…" />
      ) : error ? (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      ) : row ? (
        <div className="space-y-4">
          {actionError && <ErrorBlock message={actionError} />}
          {finalizeNote && (
            <div className="rounded-md bg-info-light border border-info/30 px-3 py-2 text-info text-xs">{finalizeNote}</div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Chip label={text(row.status).replace(/_/g, ' ')} tone={STATUS_TONE[row.status] ?? 'default'} dot />
            {row.ratingLabel && <Chip label={String(row.ratingLabel)} tone="primary" />}
            {row.promotionRecommended && <Chip label="Promotion recommended" tone="warning" />}
            {row.letterNumber && <Chip label={`Letter ${row.letterNumber}`} tone="info" />}
            <span className="text-text-muted text-xs">finalized {fmtDate(row.finalizedAt)}</span>
          </div>

          <div className="rounded-md border border-border-default bg-bg-secondary p-4">
            <p className={LABEL_CLS}>Score ladder</p>
            <ScoreLadderRow label="Goal score" value={row.goalScore} />
            <ScoreLadderRow label="KRA score" value={row.kraScore} />
            <ScoreLadderRow label="KPI score" value={row.kpiScore} />
            <ScoreLadderRow label="Competency score" value={row.competencyScore} />
            <div className="border-t border-border-default mt-1 pt-2 flex items-baseline justify-between">
              <span className="text-xs text-text-primary font-semibold">Total score</span>
              <span className="text-xs font-mono font-semibold text-text-primary">{score(row.totalScore)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {(
              [
                ['Self', row.selfRating],
                ['Manager', row.managerRating],
                ['Calibrated', row.calibratedRating],
                ['Final', row.finalRating],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-md border border-border-light bg-bg-card p-2">
                <p className="text-text-muted text-[10px] uppercase tracking-wider">{label}</p>
                <p className="text-text-primary font-mono text-lg">{score(value)}</p>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-border-default p-3 space-y-3">
            <p className="text-text-primary text-sm font-semibold">Manager assessment</p>
            {!editable && (
              <p className="text-text-muted text-[11px]">
                This appraisal is {String(row.status).replace(/_/g, ' ').toLowerCase()} — the assessment can no longer be
                edited.
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className={LABEL_CLS}>Manager rating (0–5)</label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={0.1}
                  className={INPUT_CLS}
                  value={managerRating}
                  disabled={!editable}
                  onChange={(e) => setManagerRating(e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Salary increase %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  className={INPUT_CLS}
                  value={salaryIncreasePct}
                  disabled={!editable}
                  onChange={(e) => setSalaryIncreasePct(e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <label className={LABEL_CLS}>Remarks</label>
                <input className={INPUT_CLS} value={remarks} disabled={!editable} onChange={(e) => setRemarks(e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={promotionRecommended}
                disabled={!editable}
                onChange={(e) => setPromotionRecommended(e.target.checked)}
              />
              Recommend for promotion
            </label>
            <p className="text-text-muted text-[11px]">
              The salary increase % is a recommendation only — the payroll revision itself happens in the payroll
              module, nothing is auto-applied.
            </p>
            {editable && (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="w-44">
                  <label className={LABEL_CLS}>Finalize override (optional)</label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    className={INPUT_CLS}
                    placeholder="Use calibrated/manager"
                    value={finalOverride}
                    onChange={(e) => setFinalOverride(e.target.value)}
                  />
                </div>
                <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={saveAssessment}>
                  {busy ? 'Saving…' : 'Save assessment'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

function CalibrationTab({ cycleId }: { cycleId: number }) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    talentApi
      .calibrationSessions(cycleId)
      .then((rows) => setSessions(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [cycleId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingBlock label="Loading calibration sessions…" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className={BTN_PRIMARY} onClick={() => setCreateOpen(true)}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} /> New session
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

      {!error && sessions.length === 0 && (
        <EmptyBlock message="No calibration sessions for this cycle" hint="Create a session to adjust ratings as a committee." />
      )}

      {sessions.length > 0 && (
        <TableShell headers={['Session', 'Date', 'Status', 'Committee', '']}>
          {sessions.map((s) => (
            <tr key={s.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                {text(s.name)}
                <span className="block text-text-muted text-[11px]">{text(s.cycleName)}</span>
              </td>
              <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDate(s.sessionDate)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip
                  label={text(s.status).replace(/_/g, ' ')}
                  tone={s.status === 'COMPLETED' ? 'success' : s.status === 'IN_PROGRESS' ? 'info' : 'default'}
                  dot
                />
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary">
                {(Array.isArray(s.committee) ? s.committee : [])
                  .map((m: any) => (m?.role ? `${m.name} (${m.role})` : m?.name))
                  .filter(Boolean)
                  .join(', ') || '—'}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <button
                  type="button"
                  className="text-primary text-xs font-medium hover:underline"
                  onClick={() => setSelected(s)}
                >
                  Open
                </button>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {createOpen && (
          <CreateSessionModal
            cycleId={cycleId}
            onClose={() => setCreateOpen(false)}
            onSaved={() => {
              setCreateOpen(false);
              load();
            }}
          />
        )}
        {selected && (
          <SessionDetailModal
            session={selected}
            cycleId={cycleId}
            onClose={() => setSelected(null)}
            onChanged={(updated) => {
              setSelected(updated);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CreateSessionModal({
  cycleId,
  onClose,
  onSaved,
}: {
  cycleId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [sessionDate, setSessionDate] = useState('');
  const [committee, setCommittee] = useState<{ name: string; role: string }[]>([{ name: '', role: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setBusy(true);
    setError(null);
    talentApi
      .createCalibrationSession({
        cycleId,
        name: name.trim(),
        sessionDate: sessionDate || null,
        committee: committee
          .filter((m) => m.name.trim() !== '')
          .map((m) => (m.role.trim() ? { name: m.name.trim(), role: m.role.trim() } : { name: m.name.trim() })),
      })
      .then(() => onSaved())
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title="New calibration session"
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !name.trim()} onClick={save}>
            {busy ? 'Creating…' : 'Create session'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorBlock message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Session name</label>
            <input className={INPUT_CLS} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Date</label>
            <input type="date" className={INPUT_CLS} value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <p className={LABEL_CLS}>Committee</p>
          {committee.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={INPUT_CLS}
                placeholder="Name"
                value={m.name}
                onChange={(e) => setCommittee((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <input
                className={INPUT_CLS}
                placeholder="Role (optional)"
                value={m.role}
                onChange={(e) => setCommittee((prev) => prev.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}
              />
              <button
                type="button"
                aria-label="Remove member"
                className="text-text-muted hover:text-danger transition-colors flex-shrink-0"
                onClick={() => setCommittee((prev) => prev.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-primary text-xs font-medium hover:underline"
            onClick={() => setCommittee((prev) => [...prev, { name: '', role: '' }])}
          >
            + Add committee member
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/**
 * The backend exposes adjustment history on mutation responses and via the
 * calibration report — there is no session-detail GET. The history shown here
 * comes from the report (filtered by session name) merged with any
 * adjustments carried on the session object after an adjust/complete call.
 */
function SessionDetailModal({
  session,
  cycleId,
  onClose,
  onChanged,
}: {
  session: any;
  cycleId: number;
  onClose: () => void;
  onChanged: (updated: any) => void;
}) {
  const [appraisals, setAppraisals] = useState<any[]>([]);
  const [reportRows, setReportRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [appraisalId, setAppraisalId] = useState('');
  const [adjustedRating, setAdjustedRating] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  useEffect(() => {
    Promise.all([
      talentApi.appraisals({ cycleId }),
      talentApi.report('calibration', { cycleId }).catch(() => null),
    ])
      .then(([apps, report]) => {
        setAppraisals(Array.isArray(apps) ? apps : []);
        const rows = Array.isArray(report?.rows) ? report.rows : [];
        setReportRows(rows.filter((r: any) => String(r?.session) === String(session.name)));
      })
      .catch((err) => setError(reason(err)));
  }, [cycleId, session.name]);

  const sessionAdjustments: any[] = Array.isArray(session?.adjustments) ? session.adjustments : [];
  const history =
    sessionAdjustments.length > 0
      ? sessionAdjustments.map((a) => ({
          employeeName: a.employeeName,
          previousRating: a.previousRating,
          adjustedRating: a.adjustedRating,
          reason: a.reason,
          date: a.createdAt,
        }))
      : reportRows.map((r) => ({
          employeeName: r.employeeName,
          previousRating: r.previousRating,
          adjustedRating: r.adjustedRating,
          reason: r.reason,
          date: r.date,
        }));

  const adjust = () => {
    setBusy(true);
    setError(null);
    talentApi
      .calibrationAdjust(Number(session.id), {
        appraisalId: Number(appraisalId),
        adjustedRating: Number(adjustedRating),
        reason: adjustReason.trim(),
      })
      .then((updated) => {
        onChanged(updated ?? session);
        setAppraisalId('');
        setAdjustedRating('');
        setAdjustReason('');
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  const complete = () => {
    setBusy(true);
    setError(null);
    talentApi
      .completeCalibration(Number(session.id))
      .then((updated) => onChanged(updated ?? session))
      .catch((err) => setError(reason(err)))
      .finally(() => setBusy(false));
  };

  const open = session.status !== 'COMPLETED';
  // Only appraisals that are not yet locked can be calibrated.
  const adjustable = appraisals.filter((a) => !['FINALIZED', 'LETTER_ISSUED', 'ACKNOWLEDGED'].includes(a?.status));

  return (
    <ModalShell
      title={`Calibration — ${text(session.name)}`}
      subtitle={`${text(session.cycleName)} · ${text(session.status)}`}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        open ? (
          <div className="flex items-center justify-end">
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={complete}>
              {busy ? 'Working…' : 'Complete session'}
            </button>
          </div>
        ) : null
      }
    >
      <div className="space-y-4">
        {error && <ErrorBlock message={error} />}

        {open ? (
          <div className="rounded-md border border-border-default p-3 space-y-3">
            <p className="text-text-primary text-sm font-semibold">Adjust a rating</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={LABEL_CLS}>Appraisal</label>
                <select className={INPUT_CLS} value={appraisalId} onChange={(e) => setAppraisalId(e.target.value)}>
                  <option value="">Select…</option>
                  {adjustable.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.employeeName} — mgr {score(a.managerRating)} / calib {score(a.calibratedRating)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Adjusted rating (0–5)</label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={0.1}
                  className={INPUT_CLS}
                  value={adjustedRating}
                  onChange={(e) => setAdjustedRating(e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Reason</label>
                <input className={INPUT_CLS} value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={busy || !appraisalId || adjustedRating === '' || !adjustReason.trim()}
                onClick={adjust}
              >
                {busy ? 'Applying…' : 'Apply adjustment'}
              </button>
            </div>
            {adjustable.length === 0 && (
              <p className="text-text-muted text-[11px]">
                No adjustable appraisals — finalized and letter-issued appraisals can no longer be calibrated.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-md bg-bg-secondary border border-border-default px-3 py-2 text-text-muted text-xs">
            This session is completed — adjustments are closed.
          </div>
        )}

        <div>
          <p className="text-text-primary text-sm font-semibold mb-2">Adjustment history</p>
          {history.length === 0 ? (
            <EmptyBlock message="No adjustments recorded in this session yet" />
          ) : (
            <TableShell headers={['Employee', 'Previous', '', 'Adjusted', 'Reason', 'Date']}>
              {history.map((a, i) => (
                <tr key={i} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">{text(a.employeeName)}</td>
                  <td className="px-3 py-2 text-xs font-mono text-text-secondary">{score(a.previousRating)}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">→</td>
                  <td className="px-3 py-2 text-xs font-mono text-text-primary">{score(a.adjustedRating)}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary">{text(a.reason)}</td>
                  <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDate(a.date)}</td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
