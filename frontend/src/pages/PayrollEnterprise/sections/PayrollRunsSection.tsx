import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, FlaskConical, Play, RefreshCw } from 'lucide-react';
import { payrollRunApi, payrollAdminApi } from '../../../api/payroll';
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
  inr,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';
import { TabBar } from '../../../components/common/TabBar';
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : inr(n);
}

function count(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : n.toLocaleString('en-IN');
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

function duration(ms: unknown): string {
  const n = num(ms);
  if (n === null) return '—';
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)} s`;
  return `${Math.floor(n / 60_000)}m ${Math.round((n % 60_000) / 1000)}s`;
}

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

function runTone(status: string | null | undefined): Tone {
  const s = String(status ?? '').toUpperCase();
  if (s === 'COMPLETED' || s === 'APPROVED') return 'success';
  if (s === 'RUNNING' || s === 'PENDING_APPROVAL') return 'info';
  if (s === 'FAILED' || s === 'REJECTED') return 'danger';
  return 'default';
}

function severityTone(severity: string | null | undefined): Tone {
  const s = String(severity ?? '').toUpperCase();
  if (s === 'ERROR' || s === 'FATAL') return 'danger';
  if (s === 'WARNING' || s === 'WARN') return 'warning';
  return 'default';
}

/** Message an API rejection produced, verbatim where possible. */
function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

interface NormalRun {
  runId: number | null;
  status: string | null;
  runType: string | null;
  isSimulation: boolean;
  totalEmployees: number | null;
  processedEmployees: number | null;
  failedEmployees: number | null;
  totalGross: number | null;
  totalDeductions: number | null;
  totalNet: number | null;
  totalEmployerCost: number | null;
  durationMs: number | null;
  warnings: string[];
  errors: any[];
  jobId: number | null;
}

/**
 * `simulate` answers with a flat result; `start` may nest the run under `run`
 * and repeat the totals at the top level. Neither shape is assumed — every
 * field is read from the nested object first and the envelope second.
 */
function normaliseRunResult(raw: any): NormalRun {
  const envelope = raw && typeof raw === 'object' ? raw : {};
  const inner = envelope.run && typeof envelope.run === 'object' ? envelope.run : envelope;

  const pick = (key: string): unknown =>
    inner?.[key] !== undefined && inner?.[key] !== null ? inner[key] : envelope?.[key];

  const list = (key: string): any[] => {
    const value = pick(key);
    return Array.isArray(value) ? value : [];
  };

  return {
    runId: num(pick('runId')) ?? num(pick('id')),
    status: pick('status') === undefined || pick('status') === null ? null : String(pick('status')),
    runType: pick('runType') === undefined || pick('runType') === null ? null : String(pick('runType')),
    isSimulation: Boolean(pick('isSimulation')),
    totalEmployees: num(pick('totalEmployees')),
    processedEmployees: num(pick('processedEmployees')),
    failedEmployees: num(pick('failedEmployees')),
    totalGross: num(pick('totalGross')),
    totalDeductions: num(pick('totalDeductions')),
    totalNet: num(pick('totalNet')),
    totalEmployerCost: num(pick('totalEmployerCost')),
    durationMs: num(pick('durationMs')),
    warnings: list('warnings').map((w) => String(w)),
    errors: list('errors'),
    jobId: num(envelope.jobId) ?? num(inner?.jobId),
  };
}

const RUN_TYPES = [
  { id: 'ALL', label: 'All' },
  { id: 'REGULAR', label: 'Regular' },
  { id: 'OFF_CYCLE', label: 'Off cycle' },
  { id: 'RETRO', label: 'Retro' },
  { id: 'ARREARS', label: 'Arrears' },
  { id: 'FINAL_SETTLEMENT', label: 'Final settlement' },
  { id: 'BONUS', label: 'Bonus' },
  { id: 'SIMULATION', label: 'Simulation' },
];

const POLL_MS = 2000;
const MAX_POLLS = 150; // ~5 minutes

type ModalKind = 'run' | 'simulate' | 'retro' | 'settlement' | 'reject' | null;

/**
 * The payroll run console: simulate, run, retro, settle, and walk a computed
 * run through its approval ladder.
 */
export function PayrollRunsSection({ onSectionChange }: { onSectionChange: (section: string) => void }) {
  const { salaryPeriods, employees } = useApp();

  const [periodId, setPeriodId] = useState<number | null>(null);
  const [runType, setRunType] = useState('ALL');

  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [modal, setModal] = useState<ModalKind>(null);
  const [showMore, setShowMore] = useState(false);

  const [runAsync, setRunAsync] = useState(false);
  const [result, setResult] = useState<NormalRun | null>(null);
  const [simResult, setSimResult] = useState<NormalRun | null>(null);

  const [job, setJob] = useState<any | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCount = useRef(0);

  const [detail, setDetail] = useState<any | null>(null);
  const [detailApprovals, setDetailApprovals] = useState<any[]>([]);
  const [rejectComment, setRejectComment] = useState('');

  // Retro form
  const [retroFrom, setRetroFrom] = useState<number | null>(null);
  const [retroTo, setRetroTo] = useState<number | null>(null);
  const [retroEmployees, setRetroEmployees] = useState<number[]>([]);

  // Final settlement form
  const [settlementEmployee, setSettlementEmployee] = useState<number | null>(null);
  const [lastWorkingDate, setLastWorkingDate] = useState('');
  const [settlement, setSettlement] = useState<any | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    pollCount.current = 0;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  useEffect(() => {
    if (periodId !== null || salaryPeriods.length === 0) return;
    const open = salaryPeriods.find((p) => p.status === 'OPEN');
    const newest = [...salaryPeriods].sort((a, b) => b.fromDate.localeCompare(a.fromDate))[0];
    const chosen = open?.id ?? newest?.id ?? null;
    setPeriodId(chosen);
    setRetroTo(chosen);
  }, [salaryPeriods, periodId]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    payrollRunApi
      .list({ periodId: periodId ?? undefined, runType: runType === 'ALL' ? undefined : runType })
      .then((rows) => setRuns(Array.isArray(rows) ? rows : []))
      .catch((err: any) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [periodId, runType]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedPeriod = salaryPeriods.find((p) => p.id === periodId) ?? null;

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const pollJob = useCallback(
    (jobId: number) => {
      stopPolling();
      pollCount.current = 0;
      pollRef.current = setInterval(() => {
        pollCount.current += 1;
        if (pollCount.current > MAX_POLLS) {
          stopPolling();
          window.alert('Stopped watching this job after 5 minutes. Refresh the runs list to see where it landed.');
          return;
        }
        payrollRunApi
          .job(jobId)
          .then((j) => {
            setJob(j ?? null);
            const status = String(j?.status ?? '').toUpperCase();
            if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
              stopPolling();
              if (j?.result) setResult(normaliseRunResult(j.result));
              if (status === 'FAILED' && j?.errorMessage) window.alert(String(j.errorMessage));
              load();
            }
          })
          .catch((err: any) => {
            stopPolling();
            window.alert(reason(err));
          });
      }, POLL_MS);
    },
    [stopPolling, load],
  );

  const doRun = () => {
    if (!periodId) {
      window.alert('Pick a salary period first');
      return;
    }
    setBusy(true);
    setJob(null);
    payrollRunApi
      .start({ periodId, runType: 'REGULAR', async: runAsync })
      .then((raw) => {
        const normalised = normaliseRunResult(raw);
        setModal(null);
        if (normalised.jobId) {
          setJob({ id: normalised.jobId, status: 'QUEUED', progressPct: 0, progressMessage: 'Queued' });
          pollJob(normalised.jobId);
        } else {
          setResult(normalised);
          load();
        }
      })
      .catch((err: any) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const doSimulate = () => {
    if (!periodId) {
      window.alert('Pick a salary period first');
      return;
    }
    setBusy(true);
    payrollRunApi
      .simulate({ periodId, runType: 'SIMULATION' })
      .then((raw) => {
        setSimResult(normaliseRunResult(raw));
        setModal('simulate');
      })
      .catch((err: any) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const doRetro = () => {
    if (!retroFrom || !retroTo) {
      window.alert('Both a source and a target period are required');
      return;
    }
    setBusy(true);
    payrollRunApi
      .retro({
        fromPeriodId: retroFrom,
        periodId: retroTo,
        employeeIds: retroEmployees,
      })
      .then((raw) => {
        setResult(normaliseRunResult(raw));
        setModal(null);
        load();
      })
      .catch((err: any) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const doSettlement = () => {
    if (!settlementEmployee || !lastWorkingDate) {
      window.alert('Employee and last working date are both required');
      return;
    }
    setBusy(true);
    payrollRunApi
      .finalSettlement({ employeeId: settlementEmployee, lastWorkingDate })
      .then((res) => setSettlement(res ?? null))
      .catch((err: any) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const openDetail = (runId: number) => {
    setDetail(null);
    setDetailApprovals([]);
    payrollRunApi
      .get(runId)
      .then((run) => {
        setDetail(run ?? null);
        const embedded = Array.isArray(run?.approvals) ? run.approvals : [];
        setDetailApprovals(embedded);
        payrollAdminApi
          .approvalsForEntity('PAYROLL_RUN', runId)
          .then((rows) => setDetailApprovals(Array.isArray(rows) ? rows : embedded))
          .catch(() => undefined);
      })
      .catch((err: any) => window.alert(reason(err)));
  };

  const submitForApproval = (runId: number) => {
    setBusy(true);
    payrollRunApi
      .submitApproval(runId)
      .then(() => {
        load();
        openDetail(runId);
      })
      .catch((err: any) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const approveRun = (runId: number) => {
    setBusy(true);
    payrollRunApi
      .approve(runId)
      .then(() => {
        load();
        openDetail(runId);
      })
      .catch((err: any) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const rejectRun = () => {
    const runId = num(detail?.id);
    if (!runId) return;
    if (!rejectComment.trim()) {
      window.alert('A rejection needs a comment — the requester has to know what to fix.');
      return;
    }
    setBusy(true);
    payrollRunApi
      .reject(runId, rejectComment.trim())
      .then(() => {
        setModal(null);
        setRejectComment('');
        load();
        openDetail(runId);
      })
      .catch((err: any) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const detailErrors: any[] = Array.isArray(detail?.errors) ? detail.errors : [];
  const pendingApproval = detailApprovals.find((a: any) => String(a?.status).toUpperCase() === 'PENDING') ?? null;

  const resultPanel = (run: NormalRun, simulated: boolean) => (
    <div className="space-y-4">
      {simulated && (
        <div className="px-3 py-2 rounded-md bg-warning-light border border-warning/30 text-warning text-xs">
          Simulation — nothing was saved. No salary lines were written and no verification was reset.
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Employees processed" value={count(run.processedEmployees)} hint={`of ${count(run.totalEmployees)}`} />
        <StatCard
          label="Failed"
          value={count(run.failedEmployees)}
          intent={run.failedEmployees ? 'danger' : 'default'}
        />
        <StatCard label="Gross" value={money(run.totalGross)} />
        <StatCard label="Deductions" value={money(run.totalDeductions)} intent="warning" />
        <StatCard label="Net" value={money(run.totalNet)} intent="success" />
        <StatCard label="Employer cost" value={money(run.totalEmployerCost)} hint={duration(run.durationMs)} />
      </div>

      {run.warnings.length > 0 && (
        <ul className="space-y-1">
          {run.warnings.map((w, i) => (
            <li key={i} className="text-warning text-xs flex items-start gap-1.5">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              {w}
            </li>
          ))}
        </ul>
      )}

      {(run.failedEmployees ?? 0) > 0 && run.errors.length > 0 && (
        <TableShell headers={['Employee', 'Severity', 'Code', 'Message']}>
          {run.errors.map((e: any, i: number) => (
            <tr key={e?.id ?? i}>
              <td className="px-3 py-2 text-sm text-text-primary whitespace-nowrap">
                {String(e?.employeeName ?? e?.employeeId ?? '—')}
              </td>
              <td className="px-3 py-2">
                <Chip label={String(e?.severity ?? 'ERROR')} tone={severityTone(e?.severity)} />
              </td>
              <td className="px-3 py-2 text-xs font-mono text-text-secondary">{String(e?.code ?? '—')}</td>
              <td className="px-3 py-2 text-sm text-text-secondary">{String(e?.message ?? '')}</td>
            </tr>
          ))}
        </TableShell>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Toolbar ----------------------------------------------------------- */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className={LABEL_CLS} htmlFor="run-period">
              Period
            </label>
            <select
              id="run-period"
              className={`${INPUT_CLS} min-w-[200px]`}
              value={periodId ?? ''}
              onChange={(e) => setPeriodId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All periods</option>
              {salaryPeriods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.status})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={doSimulate} className={BTN_SECONDARY} disabled={busy || !periodId}>
            <FlaskConical size={14} className="inline mr-1.5" />
            Simulate
          </button>
          <button onClick={() => setModal('run')} className={BTN_PRIMARY} disabled={busy || !periodId}>
            <Play size={14} className="inline mr-1.5" />
            Run payroll
          </button>
          <div className="relative">
            <button onClick={() => setShowMore((v) => !v)} className={BTN_SECONDARY}>
              More <ChevronDown size={14} className="inline ml-1" />
            </button>
            {showMore && (
              <div className="absolute right-0 mt-1 z-20 w-52 bg-bg-card border border-border-default rounded-md shadow-modal py-1">
                <button
                  onClick={() => {
                    setShowMore(false);
                    setModal('retro');
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover"
                >
                  Retro / arrears run
                </button>
                <button
                  onClick={() => {
                    setShowMore(false);
                    setSettlement(null);
                    setModal('settlement');
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover"
                >
                  Final settlement
                </button>
              </div>
            )}
          </div>
          <button onClick={load} className={BTN_SECONDARY} disabled={loading}>
            <RefreshCw size={14} className={`inline mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <TabBar tabs={RUN_TYPES} active={runType} onChange={setRunType} />

      {/* Background job progress ------------------------------------------- */}
      {job && (
        <div className="bg-bg-card border border-border-default rounded-md p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-text-primary text-sm font-medium">
              Background run #{count(job.id)} — {String(job.status ?? 'QUEUED')}
            </p>
            <button onClick={() => { stopPolling(); setJob(null); }} className="text-text-muted text-xs hover:text-text-primary">
              Dismiss
            </button>
          </div>
          <div className="h-2 rounded-full bg-bg-secondary overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.max(0, Math.min(100, num(job.progressPct) ?? 0))}%` }}
            />
          </div>
          <p className="text-text-muted text-xs">
            {String(job.progressMessage ?? 'Waiting for a worker to pick this up…')}
          </p>
        </div>
      )}

      {/* Latest result ------------------------------------------------------ */}
      {result && (
        <div className="bg-bg-card border border-border-default rounded-md p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-text-primary text-sm font-semibold">
              Run result {result.runId ? `#${result.runId}` : ''}
            </h3>
            <button onClick={() => setResult(null)} className="text-text-muted text-xs hover:text-text-primary">
              Dismiss
            </button>
          </div>
          {resultPanel(result, false)}
        </div>
      )}

      {/* Runs table --------------------------------------------------------- */}
      {loading && runs.length === 0 && <LoadingBlock label="Loading payroll runs…" />}
      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button onClick={load} className={BTN_SECONDARY}>
            Retry
          </button>
        </div>
      )}

      {!error && !loading && runs.length === 0 && (
        <EmptyBlock
          message="No payroll runs for this filter"
          hint={selectedPeriod ? `Run payroll for ${selectedPeriod.label} to create one.` : undefined}
        />
      )}

      {runs.length > 0 && (
        <TableShell
          headers={['Run', 'Label', 'Type', 'Status', 'Employees', 'Gross', 'Net', 'Duration', 'Started', '']}
        >
          {runs.map((r: any) => (
            <tr
              key={r?.id}
              onClick={() => openDetail(Number(r?.id))}
              className="hover:bg-bg-hover transition-colors cursor-pointer"
            >
              <td className="px-3 py-2 text-sm font-mono text-text-secondary">#{count(r?.id)}</td>
              <td className="px-3 py-2 text-sm text-text-primary">{String(r?.label ?? r?.periodLabel ?? '—')}</td>
              <td className="px-3 py-2">
                <Chip label={String(r?.runType ?? '—')} tone="primary" />
              </td>
              <td className="px-3 py-2">
                <Chip label={String(r?.status ?? '—')} tone={runTone(r?.status)} dot />
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary tabular-nums whitespace-nowrap">
                {count(r?.processedEmployees)} / {count(r?.totalEmployees)}
                {num(r?.failedEmployees) ? (
                  <span className="text-danger ml-1.5">({count(r?.failedEmployees)} failed)</span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary text-right font-mono">{money(r?.totalGross)}</td>
              <td className="px-3 py-2 text-sm text-text-primary text-right font-mono">{money(r?.totalNet)}</td>
              <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{duration(r?.durationMs)}</td>
              <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{timeAgo(r?.startedAt ?? r?.createdAt)}</td>
              <td className="px-3 py-2 text-right">
                <span className="text-primary text-xs">View</span>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      {/* Run detail --------------------------------------------------------- */}
      {detail && (
        <ModalShell
          title={`Payroll run #${count(detail.id)}`}
          subtitle={`${String(detail.runType ?? '')} · ${String(detail.periodLabel ?? '')}`}
          onClose={() => setDetail(null)}
          maxWidth="max-w-4xl"
          footer={
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-text-muted text-xs">
                {pendingApproval
                  ? `Awaiting: ${String(pendingApproval.currentStepName ?? `step ${pendingApproval.currentStep}`)}`
                  : 'No approval request is pending on this run.'}
              </p>
              <div className="flex items-center gap-2">
                {!detail.isSimulation && !pendingApproval && (
                  <button onClick={() => submitForApproval(Number(detail.id))} className={BTN_SECONDARY} disabled={busy}>
                    Submit for approval
                  </button>
                )}
                {pendingApproval && (
                  <>
                    <button onClick={() => setModal('reject')} className={BTN_SECONDARY} disabled={busy}>
                      Reject
                    </button>
                    <button onClick={() => approveRun(Number(detail.id))} className={BTN_PRIMARY} disabled={busy}>
                      Approve
                    </button>
                  </>
                )}
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            {resultPanel(
              {
                ...normaliseRunResult(detail),
                errors: detailErrors,
              },
              Boolean(detail.isSimulation),
            )}

            {detailApprovals.length > 0 && (
              <div>
                <p className={LABEL_CLS}>Approval requests</p>
                <ul className="space-y-2">
                  {detailApprovals.map((a: any) => (
                    <li key={a?.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-text-primary truncate">{String(a?.title ?? '')}</span>
                      <span className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-text-muted text-xs">
                          step {count(a?.currentStep)} · {String(a?.currentStepName ?? '')}
                        </span>
                        <Chip label={String(a?.status ?? '')} tone={runTone(a?.status)} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </ModalShell>
      )}

      {/* Run confirm -------------------------------------------------------- */}
      {modal === 'run' && (
        <ModalShell
          title="Run payroll"
          subtitle={selectedPeriod ? `${selectedPeriod.label} (${selectedPeriod.status})` : null}
          onClose={() => setModal(null)}
          maxWidth="max-w-lg"
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} className={BTN_SECONDARY}>
                Cancel
              </button>
              <button onClick={doRun} className={BTN_PRIMARY} disabled={busy}>
                {busy ? 'Starting…' : 'Run payroll'}
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-sm text-text-secondary">
            <p>This writes salary lines for the selected period. In plain terms:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Existing salary lines for the period are recomputed and overwritten.</li>
              <li>Any manager or account verification already recorded on those lines is reset.</li>
              <li>Payroll can only run while the period is <strong className="text-text-primary">OPEN</strong>; a locked or paid period will be refused.</li>
            </ul>
            {selectedPeriod && selectedPeriod.status !== 'OPEN' && (
              <p className="text-danger text-xs">
                {selectedPeriod.label} is {selectedPeriod.status}. The server will reject this run.
              </p>
            )}
            <label className="flex items-center gap-2 pt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={runAsync}
                onChange={(e) => setRunAsync(e.target.checked)}
                className="accent-primary"
              />
              <span className="text-text-primary text-sm">Run in background</span>
            </label>
            <p className="text-text-muted text-xs">
              Background runs return a job id immediately and report progress here. Use it for anything over a few
              hundred employees.
            </p>
          </div>
        </ModalShell>
      )}

      {/* Simulation result -------------------------------------------------- */}
      {modal === 'simulate' && simResult && (
        <ModalShell
          title="Simulation — nothing was saved"
          subtitle={selectedPeriod ? selectedPeriod.label : null}
          onClose={() => setModal(null)}
          maxWidth="max-w-3xl"
          footer={
            <div className="flex justify-end">
              <button onClick={() => setModal(null)} className={BTN_SECONDARY}>
                Close
              </button>
            </div>
          }
        >
          {resultPanel(simResult, true)}
        </ModalShell>
      )}

      {/* Retro -------------------------------------------------------------- */}
      {modal === 'retro' && (
        <ModalShell
          title="Retro / arrears run"
          subtitle="Corrections post forward as arrears"
          onClose={() => setModal(null)}
          maxWidth="max-w-2xl"
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} className={BTN_SECONDARY}>
                Cancel
              </button>
              <button onClick={doRetro} className={BTN_PRIMARY} disabled={busy}>
                {busy ? 'Running…' : 'Run retro'}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-text-secondary text-sm">
              A retro run recomputes the source period, compares it with what was actually paid, and posts the
              difference as <strong className="text-text-primary">ARREARS</strong> into the target (open) period. The
              locked period is never rewritten — its history stays exactly as it was filed.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS} htmlFor="retro-from">
                  Source period (recompute)
                </label>
                <select
                  id="retro-from"
                  className={INPUT_CLS}
                  value={retroFrom ?? ''}
                  onChange={(e) => setRetroFrom(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Select…</option>
                  {salaryPeriods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.status})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="retro-to">
                  Target period (post arrears)
                </label>
                <select
                  id="retro-to"
                  className={INPUT_CLS}
                  value={retroTo ?? ''}
                  onChange={(e) => setRetroTo(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Select…</option>
                  {salaryPeriods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.status})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={LABEL_CLS} htmlFor="retro-employees">
                Employees (optional — leave empty for everyone)
              </label>
              <select
                id="retro-employees"
                multiple
                size={8}
                className={`${INPUT_CLS} h-auto`}
                value={retroEmployees.map(String)}
                onChange={(e) =>
                  setRetroEmployees(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))
                }
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.empCode} — {emp.fullName}
                  </option>
                ))}
              </select>
              <p className="text-text-muted text-[11px] mt-1">{retroEmployees.length} selected</p>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Final settlement ---------------------------------------------------- */}
      {modal === 'settlement' && (
        <ModalShell
          title="Final settlement"
          subtitle="Calculated, not approved"
          onClose={() => setModal(null)}
          maxWidth="max-w-2xl"
          footer={
            <div className="flex justify-between gap-2">
              <button onClick={() => onSectionChange('approvals')} className={BTN_SECONDARY}>
                Go to approvals
              </button>
              <div className="flex gap-2">
                <button onClick={() => setModal(null)} className={BTN_SECONDARY}>
                  Close
                </button>
                <button onClick={doSettlement} className={BTN_PRIMARY} disabled={busy}>
                  {busy ? 'Calculating…' : 'Calculate'}
                </button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS} htmlFor="fs-employee">
                  Employee
                </label>
                <select
                  id="fs-employee"
                  className={INPUT_CLS}
                  value={settlementEmployee ?? ''}
                  onChange={(e) => setSettlementEmployee(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Select…</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.empCode} — {emp.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="fs-lwd">
                  Last working date
                </label>
                <input
                  id="fs-lwd"
                  type="date"
                  className={INPUT_CLS}
                  value={lastWorkingDate}
                  onChange={(e) => setLastWorkingDate(e.target.value)}
                />
              </div>
            </div>

            {settlement && (
              <div className="space-y-3">
                <div className="px-3 py-2 rounded-md bg-info-light border border-info/30 text-info text-xs">
                  Calculated but not yet approved. Nothing is paid until this settlement clears its approval ladder.
                </div>
                <TableShell headers={['Head', 'Amount']}>
                  {[
                    ['Pending salary', settlement.pendingSalary],
                    [
                      `Leave encashment (${count(settlement.leaveEncashmentDays)} days)`,
                      settlement.leaveEncashmentAmount,
                    ],
                    [`Gratuity (${count(settlement.gratuityYears)} yrs)`, settlement.gratuityAmount],
                    ['Bonus payable', settlement.bonusPayable],
                    ['Other earnings', settlement.otherEarnings],
                    ['Gross payable', settlement.grossPayable],
                    [
                      `Notice recovery (${count(settlement.noticeShortfallDays)} days short)`,
                      settlement.noticeRecovery,
                    ],
                    ['Loan recovery', settlement.loanRecovery],
                    ['Advance recovery', settlement.advanceRecovery],
                    ['Tax deduction', settlement.taxDeduction],
                    ['Total recovery', settlement.totalRecovery],
                    ['Net settlement', settlement.netSettlement],
                  ].map(([label, value], i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-sm text-text-secondary">{String(label)}</td>
                      <td className="px-3 py-2 text-sm text-right font-mono text-text-primary">{money(value)}</td>
                    </tr>
                  ))}
                </TableShell>
                {Array.isArray(settlement.warnings) && settlement.warnings.length > 0 && (
                  <ul className="space-y-1">
                    {settlement.warnings.map((w: string, i: number) => (
                      <li key={i} className="text-warning text-xs flex items-start gap-1.5">
                        <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </ModalShell>
      )}

      {/* Reject comment ------------------------------------------------------ */}
      {modal === 'reject' && (
        <ModalShell
          title="Reject this payroll run"
          subtitle="A reason is required"
          onClose={() => setModal(null)}
          maxWidth="max-w-md"
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} className={BTN_SECONDARY}>
                Cancel
              </button>
              <button onClick={rejectRun} className={BTN_PRIMARY} disabled={busy || !rejectComment.trim()}>
                Reject
              </button>
            </div>
          }
        >
          <label className={LABEL_CLS} htmlFor="reject-comment">
            Comment
          </label>
          <textarea
            id="reject-comment"
            rows={4}
            className={INPUT_CLS}
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            placeholder="What has to change before this run can be approved?"
          />
        </ModalShell>
      )}
    </div>
  );
}
