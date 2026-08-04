import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AlertTriangle, Calculator, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { statutoryApi } from '../../../api/compliance';
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
import { useApp } from '../../../contexts/AppContext';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const SCHEMES = ['ALL', 'PF', 'EPS', 'EDLI', 'ESI', 'PT', 'LWF', 'TDS', 'VPF'] as const;

const ROW_CAP = 500;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : inr(n);
}

function decimal(value: unknown, places = 2): string {
  const n = num(value);
  return n === null ? '—' : n.toFixed(places);
}

function text(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? '—' : s;
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

function statusTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'CHALLAN_GENERATED':
      return 'info';
    case 'PAID':
    case 'FILED':
    case 'RECONCILED':
      return 'success';
    case 'COMPUTED':
    default:
      return 'default';
  }
}

function schemeTone(scheme: unknown): Tone {
  switch (String(scheme ?? '').toUpperCase()) {
    case 'PF':
    case 'VPF':
      return 'primary';
    case 'EPS':
    case 'EDLI':
      return 'info';
    case 'ESI':
      return 'success';
    case 'PT':
    case 'LWF':
      return 'warning';
    case 'TDS':
      return 'danger';
    default:
      return 'default';
  }
}

/** Rupee comparison tolerant of the paise rounding the ledger stores. */
function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1;
}

// ---------------------------------------------------------------------------

export function ContributionsSection() {
  const { salaryPeriods } = useApp();

  const [periodId, setPeriodId] = useState<number | null>(null);
  const [scheme, setScheme] = useState<string>('ALL');

  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [buildOpen, setBuildOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState<any>(null);

  // Default to the newest period once the context has loaded.
  useEffect(() => {
    if (periodId === null && salaryPeriods.length > 0) {
      setPeriodId(salaryPeriods[0]?.id ?? null);
    }
  }, [salaryPeriods, periodId]);

  const load = useCallback(() => {
    if (periodId === null) {
      setLoading(false);
      setFirstLoad(false);
      return;
    }
    setLoading(true);
    setError(null);

    Promise.all([
      statutoryApi.contributions({
        periodId,
        scheme: scheme === 'ALL' ? undefined : scheme,
      }),
      statutoryApi.contributionSummary(periodId).catch(() => null),
    ])
      .then(([ledger, sum]) => {
        setRows(Array.isArray(ledger) ? ledger : (ledger?.rows ?? []));
        setSummary(sum ?? null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [periodId, scheme]);

  useEffect(() => {
    load();
  }, [load]);

  const runBuild = useCallback(() => {
    if (periodId === null) return;
    setBuilding(true);
    statutoryApi
      .buildLedger(periodId)
      .then((result) => {
        setBuildResult(result ?? null);
        setBuildOpen(false);
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBuilding(false));
  }, [periodId, load]);

  // --- PF reconciliation: employer EPF + EPS must equal the employee 12% -----
  const pfCheck = useMemo(() => {
    const pfRows = rows.filter((r) => String(r?.scheme ?? '').toUpperCase() === 'PF');
    const epsRows = rows.filter((r) => String(r?.scheme ?? '').toUpperCase() === 'EPS');
    if (pfRows.length === 0) return null;

    const employee = pfRows.reduce((s, r) => s + (num(r?.employeeAmount) ?? 0), 0);
    const employerPf = pfRows.reduce((s, r) => s + (num(r?.employerAmount) ?? 0), 0);
    const employerEps = epsRows.reduce((s, r) => s + (num(r?.employerAmount) ?? 0), 0);
    const employerTotal = employerPf + employerEps;

    return {
      employee,
      employerPf,
      employerEps,
      employerTotal,
      difference: employerTotal - employee,
      ok: nearlyEqual(employerTotal, employee),
    };
  }, [rows]);

  const displayRows = rows.slice(0, ROW_CAP);
  const truncated = rows.length > ROW_CAP;

  const byScheme: any[] = Array.isArray(summary?.byScheme) ? summary.byScheme : [];
  const buildWarnings: string[] = Array.isArray(buildResult?.warnings) ? buildResult.warnings : [];
  const buildByScheme: any[] = Array.isArray(buildResult?.byScheme) ? buildResult.byScheme : [];

  if (firstLoad && loading) return <LoadingBlock label="Loading the contribution ledger…" />;

  return (
    <div className="space-y-4">
      {/* Controls ---------------------------------------------------------- */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="w-64">
          <label className={LABEL_CLS} htmlFor="contrib-period">
            Salary period
          </label>
          <select
            id="contrib-period"
            className={INPUT_CLS}
            value={periodId ?? ''}
            onChange={(e) => setPeriodId(e.target.value === '' ? null : Number(e.target.value))}
          >
            {salaryPeriods.length === 0 && <option value="">No salary periods</option>}
            {salaryPeriods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.status})
              </option>
            ))}
          </select>
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
            onClick={() => setBuildOpen(true)}
            disabled={periodId === null}
          >
            <span className="inline-flex items-center gap-2">
              <Calculator size={14} />
              Build ledger
            </span>
          </button>
        </div>
      </div>

      {/* Scheme pills ------------------------------------------------------ */}
      <div className="flex items-center gap-2 flex-wrap">
        {SCHEMES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScheme(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
              s === scheme
                ? 'bg-primary-light border-primary/30 text-primary'
                : 'border-border-default text-text-muted hover:border-text-muted'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {/* Build result ------------------------------------------------------ */}
      {buildResult && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-text-primary text-sm font-medium">
              Ledger rebuilt for {text(buildResult.monthKey)} — {text(buildResult.employeesProcessed)} employees
              processed
            </p>
            <button
              type="button"
              className="text-text-muted text-xs hover:text-text-primary"
              onClick={() => setBuildResult(null)}
            >
              Dismiss
            </button>
          </div>

          {buildByScheme.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {buildByScheme.map((s, index) => (
                <StatCard
                  key={s?.scheme ?? index}
                  label={text(s?.scheme)}
                  value={money(s?.total)}
                  hint={`${text(s?.employeeCount)} employees`}
                />
              ))}
            </div>
          )}

          {/* The warnings ARE the point of this run: they name every employee
              the ledger skipped, and hiding them would hide a compliance gap. */}
          <div className="rounded-md bg-warning-light border border-warning/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={16} className="text-warning" />
              <p className="text-warning text-sm font-semibold">
                {buildWarnings.length === 0
                  ? 'No employees were skipped'
                  : `${buildWarnings.length} warning${buildWarnings.length === 1 ? '' : 's'} from this run`}
              </p>
            </div>
            {buildWarnings.length === 0 ? (
              <p className="text-text-secondary text-xs">
                Every employee with posted payroll produced a contribution row.
              </p>
            ) : (
              <ul className="space-y-1 list-disc list-inside">
                {buildWarnings.map((w, index) => (
                  <li key={index} className="text-text-secondary text-xs">
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Summary strip ----------------------------------------------------- */}
      {byScheme.length > 0 && (
        <div className="rounded-md border border-border-default overflow-hidden">
          <div className="px-4 py-2 bg-bg-secondary border-b border-border-default">
            <p className="text-text-muted text-[10px] uppercase tracking-wider font-semibold">
              Summary for {text(summary?.monthKey)}
            </p>
          </div>
          <div className="p-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {byScheme.map((s, index) => (
              <div
                key={s?.scheme ?? index}
                className="rounded-md border border-border-light bg-bg-secondary px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <Chip label={text(s?.scheme)} tone={schemeTone(s?.scheme)} />
                  <span className="text-text-muted text-[10px]">{text(s?.employeeCount)} emp</span>
                </div>
                <p className="text-text-secondary text-[11px] font-mono">EE {money(s?.employeeAmount)}</p>
                <p className="text-text-secondary text-[11px] font-mono">ER {money(s?.employerAmount)}</p>
                <p className="text-text-primary text-xs font-mono font-semibold">{money(s?.total)}</p>
              </div>
            ))}
          </div>
          {summary?.totals && (
            <div className="px-4 py-2 border-t border-border-default flex items-center gap-4 flex-wrap text-xs">
              <span className="text-text-muted">Employee {money(summary.totals.employeeAmount)}</span>
              <span className="text-text-muted">Employer {money(summary.totals.employerAmount)}</span>
              <span className="text-text-muted">Admin {money(summary.totals.adminCharges)}</span>
              <span className="text-text-primary font-semibold">Total {money(summary.totals.total)}</span>
            </div>
          )}
        </div>
      )}

      {/* PF reconciliation -------------------------------------------------- */}
      {pfCheck && (
        <div
          className={`rounded-md border p-4 ${
            pfCheck.ok ? 'bg-success-light border-success/30' : 'bg-danger-light border-danger/30'
          }`}
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-2">
              {pfCheck.ok ? (
                <CheckCircle2 size={16} className="text-success mt-0.5" />
              ) : (
                <XCircle size={16} className="text-danger mt-0.5" />
              )}
              <div>
                <p className={`text-sm font-semibold ${pfCheck.ok ? 'text-success' : 'text-danger'}`}>
                  PF reconciliation
                </p>
                <p className="text-text-secondary text-xs mt-0.5">
                  The employer share is split between EPF and the EPS diversion, so employer EPF + EPS must equal
                  the employee 12%.
                </p>
                <div className="flex items-center gap-4 flex-wrap mt-2 text-xs font-mono text-text-secondary">
                  <span>Employee 12% {inr(pfCheck.employee)}</span>
                  <span>Employer EPF {inr(pfCheck.employerPf)}</span>
                  <span>Employer EPS {inr(pfCheck.employerEps)}</span>
                  <span className="text-text-primary font-semibold">
                    Employer total {inr(pfCheck.employerTotal)}
                  </span>
                </div>
              </div>
            </div>
            <Chip
              label={
                pfCheck.ok
                  ? 'Reconciles'
                  : `Out by ${inr(Math.abs(pfCheck.difference))}`
              }
              tone={pfCheck.ok ? 'success' : 'danger'}
              dot
            />
          </div>
        </div>
      )}

      {/* Ledger table ------------------------------------------------------ */}
      {rows.length === 0 ? (
        <EmptyBlock
          message="No contribution rows for this period"
          hint="Run Build ledger to recompute contributions from posted payroll."
        />
      ) : (
        <>
          <TableShell
            headers={[
              'Employee',
              'Code',
              'Scheme',
              'Wage base',
              'Uncapped wage',
              'Employee',
              'Employer',
              'Admin',
              'Total',
              'NCP days',
              'Status',
            ]}
          >
            {displayRows.map((r, index) => (
              <tr key={r?.id ?? index} className="hover:bg-bg-hover transition-colors">
                <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                  {text(r?.employeeName)}
                </td>
                <td className="px-3 py-2 text-xs text-text-muted font-mono whitespace-nowrap">
                  {text(r?.employeeCode)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Chip label={text(r?.scheme)} tone={schemeTone(r?.scheme)} />
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                  {money(r?.wageBase)}
                </td>
                <td className="px-3 py-2 text-xs text-text-muted font-mono text-right whitespace-nowrap">
                  {money(r?.uncappedWage)}
                </td>
                <td className="px-3 py-2 text-xs text-text-primary font-mono text-right whitespace-nowrap">
                  {money(r?.employeeAmount)}
                </td>
                <td className="px-3 py-2 text-xs text-text-primary font-mono text-right whitespace-nowrap">
                  {money(r?.employerAmount)}
                </td>
                <td className="px-3 py-2 text-xs text-text-muted font-mono text-right whitespace-nowrap">
                  {money(r?.adminCharges)}
                </td>
                <td className="px-3 py-2 text-xs text-text-primary font-mono font-semibold text-right whitespace-nowrap">
                  {money(r?.totalAmount)}
                </td>
                <td className="px-3 py-2 text-xs text-text-muted font-mono text-right whitespace-nowrap">
                  {decimal(r?.ncpDays, 1)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Chip label={text(r?.status)} tone={statusTone(r?.status)} />
                </td>
              </tr>
            ))}
          </TableShell>
          {truncated && (
            <p className="text-text-muted text-[11px]">
              Showing the first {ROW_CAP} of {rows.length} rows. Narrow the scheme filter to see the rest.
            </p>
          )}
        </>
      )}

      {/* Build modal ------------------------------------------------------- */}
      <AnimatePresence>
        {buildOpen && (
          <ModalShell
            title="Build the contribution ledger"
            subtitle={
              salaryPeriods.find((p) => p.id === periodId)?.label ?? (periodId === null ? null : `Period ${periodId}`)
            }
            onClose={() => setBuildOpen(false)}
            maxWidth="max-w-lg"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setBuildOpen(false)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={runBuild} disabled={building}>
                  {building ? 'Building…' : 'Build ledger'}
                </button>
              </div>
            }
          >
            <div className="space-y-3 text-sm text-text-secondary">
              <p>
                This recomputes every PF, EPS, EDLI, ESI, PT, LWF and TDS row for the selected period straight from
                posted payroll and the statutory configuration in force.
              </p>
              <p>
                It replaces the existing rows for the period, so it is safe to re-run after correcting payroll, a
                wage, or a scheme rate. Rows already attached to a challan or a filing keep their link.
              </p>
              <div className="rounded-md bg-warning-light border border-warning/30 px-3 py-2">
                <p className="text-warning text-xs font-medium">Read the warnings afterwards</p>
                <p className="text-text-secondary text-xs mt-0.5">
                  The build names every employee it skipped — over the ESI wage ceiling, no wage on record, no state
                  rule. Those employees will be missing from the resulting returns.
                </p>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
