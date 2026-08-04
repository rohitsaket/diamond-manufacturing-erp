import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Download, FileCheck2, Plus, RefreshCw } from 'lucide-react';
import { statutoryApi } from '../../../api/compliance';
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
  StatCard,
  TableShell,
  inr,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const SCHEME_FILTERS = ['ALL', 'PF', 'ESI', 'PT', 'LWF', 'TDS'] as const;
const STATUS_FILTERS = ['ALL', 'DRAFT', 'GENERATED', 'PENDING_PAYMENT', 'PAID', 'ACKNOWLEDGED', 'CANCELLED'] as const;
const GENERATE_SCHEMES = ['PF', 'ESI', 'PT', 'LWF', 'TDS'] as const;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: unknown): string {
  const n = num(value);
  return n === null ? '—' : inr(n);
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

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isPast(value: unknown): boolean {
  if (!value) return false;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < new Date(todayIso()).getTime();
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

function statusTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'PAID':
    case 'ACKNOWLEDGED':
      return 'success';
    case 'PENDING_PAYMENT':
      return 'warning';
    case 'GENERATED':
      return 'info';
    case 'CANCELLED':
      return 'danger';
    default:
      return 'default';
  }
}

function schemeTone(scheme: unknown): Tone {
  switch (String(scheme ?? '').toUpperCase()) {
    case 'PF':
      return 'primary';
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

const UNPAID = new Set(['DRAFT', 'GENERATED', 'PENDING_PAYMENT']);

// ---------------------------------------------------------------------------

export function ChallansSection() {
  const [scheme, setScheme] = useState<string>('ALL');
  const [status, setStatus] = useState<string>('ALL');

  const [rows, setRows] = useState<any[]>([]);
  const [overdue, setOverdue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Generate
  const [genOpen, setGenOpen] = useState(false);
  const [genScheme, setGenScheme] = useState<string>('PF');
  const [genMonth, setGenMonth] = useState<string>(currentMonthKey());
  const [genState, setGenState] = useState<string>('');
  const [genDueDate, setGenDueDate] = useState<string>('');
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genResult, setGenResult] = useState<any>(null);

  // Detail
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Detail actions
  const [payOpen, setPayOpen] = useState(false);
  const [paidOn, setPaidOn] = useState<string>(todayIso());
  const [paymentReference, setPaymentReference] = useState<string>('');
  const [bankName, setBankName] = useState<string>('');
  const [ackOpen, setAckOpen] = useState(false);
  const [acknowledgementNo, setAcknowledgementNo] = useState<string>('');
  const [acknowledgedOn, setAcknowledgedOn] = useState<string>(todayIso());
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      statutoryApi.challans({
        scheme: scheme === 'ALL' ? undefined : scheme,
        status: status === 'ALL' ? undefined : status,
      }),
      statutoryApi.overdueChallans().catch(() => [] as any[]),
    ])
      .then(([list, od]) => {
        setRows(Array.isArray(list) ? list : []);
        setOverdue(Array.isArray(od) ? od : []);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [scheme, status]);

  useEffect(() => {
    load();
  }, [load]);

  const loadDetail = useCallback((id: number) => {
    setDetailLoading(true);
    setDetailError(null);
    statutoryApi
      .challan(id)
      .then((d) => setDetail(d ?? null))
      .catch((err) => setDetailError(reason(err)))
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    if (detailId === null) {
      setDetail(null);
      return;
    }
    loadDetail(detailId);
  }, [detailId, loadDetail]);

  const stats = useMemo(() => {
    const month = currentMonthKey();
    const dueThisMonth = rows
      .filter((r) => String(r?.monthKey ?? '') === month)
      .reduce((s, r) => s + (num(r?.totalAmount) ?? 0), 0);
    const unpaid = rows.filter((r) => UNPAID.has(String(r?.status ?? '').toUpperCase())).length;
    return { dueThisMonth, unpaid, overdue: overdue.length };
  }, [rows, overdue]);

  const runGenerate = useCallback(() => {
    setGenBusy(true);
    setGenError(null);
    const body: { scheme: string; monthKey: string; dueDate?: string; stateCode?: string } = {
      scheme: genScheme,
      monthKey: genMonth,
    };
    if (genDueDate) body.dueDate = genDueDate;
    if (genState.trim()) body.stateCode = genState.trim().toUpperCase();

    statutoryApi
      .generateChallan(body)
      .then((result) => {
        setGenResult(result ?? null);
        setGenOpen(false);
        load();
      })
      .catch((err) => setGenError(reason(err)))
      .finally(() => setGenBusy(false));
  }, [genScheme, genMonth, genDueDate, genState, load]);

  const markPaid = useCallback(() => {
    if (detailId === null) return;
    setActionBusy(true);
    statutoryApi
      .markChallanPaid(detailId, { paidOn, paymentReference: paymentReference || null, bankName: bankName || null })
      .then(() => {
        setPayOpen(false);
        loadDetail(detailId);
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setActionBusy(false));
  }, [detailId, paidOn, paymentReference, bankName, load, loadDetail]);

  const recordAck = useCallback(() => {
    if (detailId === null) return;
    setActionBusy(true);
    statutoryApi
      .acknowledgeChallan(detailId, { acknowledgementNo, acknowledgedOn: acknowledgedOn || null })
      .then(() => {
        setAckOpen(false);
        loadDetail(detailId);
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setActionBusy(false));
  }, [detailId, acknowledgementNo, acknowledgedOn, load, loadDetail]);

  const exportCsv = useCallback((id: number) => {
    openAuthenticatedFile(statutoryApi.challanExportUrl(id), 'challan.csv').catch((err) =>
      window.alert(reason(err)),
    );
  }, []);

  if (firstLoad && loading) return <LoadingBlock label="Loading challans…" />;

  const detailChallan = detail?.challan ?? null;
  const detailRows: any[] = Array.isArray(detail?.contributions) ? detail.contributions : [];

  return (
    <div className="space-y-4">
      {/* Controls ---------------------------------------------------------- */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {SCHEME_FILTERS.map((s) => (
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
          <div className="flex items-center gap-2 flex-wrap">
            {STATUS_FILTERS.map((s) => (
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
              setGenError(null);
              setGenOpen(true);
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Plus size={14} />
              Generate challan
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

      {/* Stats -------------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Due this month" value={inr(stats.dueThisMonth)} hint={currentMonthKey()} />
        <StatCard label="Unpaid" value={stats.unpaid} intent={stats.unpaid > 0 ? 'warning' : 'success'} />
        <StatCard label="Overdue" value={stats.overdue} intent={stats.overdue > 0 ? 'danger' : 'success'} />
      </div>

      {genResult && (
        <div className="rounded-md bg-success-light border border-success/30 px-4 py-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-success text-sm font-semibold">
              Challan {text(genResult?.challan?.challanNo)} generated
            </p>
            <p className="text-text-secondary text-xs mt-0.5">
              {text(genResult?.contributionCount)} contribution rows · {money(genResult?.challan?.totalAmount)}
            </p>
            {Array.isArray(genResult?.warnings) && genResult.warnings.length > 0 && (
              <ul className="mt-2 space-y-0.5 list-disc list-inside">
                {genResult.warnings.map((w: string, index: number) => (
                  <li key={index} className="text-text-secondary text-xs">
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="text-text-muted text-xs hover:text-text-primary"
            onClick={() => setGenResult(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Table -------------------------------------------------------------- */}
      {rows.length === 0 ? (
        <EmptyBlock
          message="No challans match this filter"
          hint="Generate a challan once the contribution ledger for the month is built."
        />
      ) : (
        <TableShell
          headers={[
            'Challan no',
            'Scheme',
            'Month',
            'Employees',
            'Wages',
            'Employee',
            'Employer',
            'Admin',
            'Interest',
            'Penalty',
            'Total',
            'Due date',
            'Status',
          ]}
        >
          {rows.map((r, index) => {
            const unpaid = UNPAID.has(String(r?.status ?? '').toUpperCase());
            const late = unpaid && isPast(r?.dueDate);
            return (
              <tr
                key={r?.id ?? index}
                onClick={() => (num(r?.id) === null ? undefined : setDetailId(Number(r.id)))}
                className="hover:bg-bg-hover transition-colors cursor-pointer"
              >
                <td className="px-3 py-2 text-xs text-text-primary font-mono whitespace-nowrap">
                  {text(r?.challanNo)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Chip label={text(r?.scheme)} tone={schemeTone(r?.scheme)} />
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{text(r?.monthKey)}</td>
                <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                  {text(r?.employeeCount)}
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                  {money(r?.totalWages)}
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                  {money(r?.employeeAmount)}
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                  {money(r?.employerAmount)}
                </td>
                <td className="px-3 py-2 text-xs text-text-muted font-mono text-right whitespace-nowrap">
                  {money(r?.adminCharges)}
                </td>
                <td className="px-3 py-2 text-xs text-text-muted font-mono text-right whitespace-nowrap">
                  {money(r?.interestAmount)}
                </td>
                <td className="px-3 py-2 text-xs text-text-muted font-mono text-right whitespace-nowrap">
                  {money(r?.penaltyAmount)}
                </td>
                <td className="px-3 py-2 text-xs text-text-primary font-mono font-semibold text-right whitespace-nowrap">
                  {money(r?.totalAmount)}
                </td>
                <td
                  className={`px-3 py-2 text-xs whitespace-nowrap ${late ? 'text-danger font-medium' : 'text-text-secondary'}`}
                >
                  {fmtDate(r?.dueDate)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Chip label={text(r?.status)} tone={statusTone(r?.status)} />
                </td>
              </tr>
            );
          })}
        </TableShell>
      )}

      {/* Generate modal ----------------------------------------------------- */}
      <AnimatePresence>
        {genOpen && (
          <ModalShell
            title="Generate a challan"
            subtitle="Totals are taken from the contribution ledger for the month"
            onClose={() => setGenOpen(false)}
            maxWidth="max-w-lg"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setGenOpen(false)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={runGenerate} disabled={genBusy}>
                  {genBusy ? 'Generating…' : 'Generate'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              {genError && <ErrorBlock message={genError} />}
              <div>
                <label className={LABEL_CLS} htmlFor="gen-scheme">
                  Scheme
                </label>
                <select
                  id="gen-scheme"
                  className={INPUT_CLS}
                  value={genScheme}
                  onChange={(e) => setGenScheme(e.target.value)}
                >
                  {GENERATE_SCHEMES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="gen-month">
                  Month
                </label>
                <input
                  id="gen-month"
                  type="month"
                  className={INPUT_CLS}
                  value={genMonth}
                  onChange={(e) => setGenMonth(e.target.value)}
                />
              </div>
              {(genScheme === 'PT' || genScheme === 'LWF') && (
                <div>
                  <label className={LABEL_CLS} htmlFor="gen-state">
                    State code
                  </label>
                  <input
                    id="gen-state"
                    className={INPUT_CLS}
                    value={genState}
                    placeholder="GJ"
                    onChange={(e) => setGenState(e.target.value)}
                  />
                  <p className="text-text-muted text-[11px] mt-1">
                    Professional tax and labour welfare fund are collected per state, so a state code is required.
                  </p>
                </div>
              )}
              <div>
                <label className={LABEL_CLS} htmlFor="gen-due">
                  Due date (optional)
                </label>
                <input
                  id="gen-due"
                  type="date"
                  className={INPUT_CLS}
                  value={genDueDate}
                  onChange={(e) => setGenDueDate(e.target.value)}
                />
                <p className="text-text-muted text-[11px] mt-1">
                  PF and ESI take their due day from the scheme configuration. TDS has no configured due day, so a
                  date must be supplied here or the challan will be created without one.
                </p>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Detail modal ------------------------------------------------------- */}
      <AnimatePresence>
        {detailId !== null && (
          <ModalShell
            title={`Challan ${text(detailChallan?.challanNo)}`}
            subtitle={
              detailChallan
                ? `${text(detailChallan.scheme)} · ${text(detailChallan.monthKey)} · ${money(detailChallan.totalAmount)}`
                : null
            }
            onClose={() => setDetailId(null)}
            maxWidth="max-w-5xl"
            footer={
              <div className="flex items-center justify-end gap-2 flex-wrap">
                <button
                  type="button"
                  className={BTN_SECONDARY}
                  onClick={() => exportCsv(detailId)}
                >
                  <span className="inline-flex items-center gap-2">
                    <Download size={14} />
                    Export CSV
                  </span>
                </button>
                <button
                  type="button"
                  className={BTN_SECONDARY}
                  onClick={() => {
                    setAcknowledgementNo(String(detailChallan?.acknowledgementNo ?? ''));
                    setAckOpen(true);
                  }}
                >
                  <span className="inline-flex items-center gap-2">
                    <FileCheck2 size={14} />
                    Record acknowledgement
                  </span>
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={() => setPayOpen(true)}>
                  Mark paid
                </button>
              </div>
            }
          >
            {detailLoading ? (
              <LoadingBlock label="Loading the challan…" />
            ) : detailError ? (
              <div className="space-y-2">
                <ErrorBlock message={detailError} />
                <button type="button" className={BTN_SECONDARY} onClick={() => loadDetail(detailId)}>
                  Retry
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {detailChallan && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard label="Employees" value={text(detailChallan.employeeCount)} />
                    <StatCard label="Total wages" value={money(detailChallan.totalWages)} />
                    <StatCard label="Total amount" value={money(detailChallan.totalAmount)} />
                    <StatCard
                      label="Status"
                      value={text(detailChallan.status)}
                      hint={detailChallan.paidOn ? `Paid ${fmtDate(detailChallan.paidOn)}` : null}
                      intent={statusTone(detailChallan.status) === 'success' ? 'success' : 'default'}
                    />
                  </div>
                )}

                {detailChallan && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                    <div>
                      <p className={LABEL_CLS}>Due date</p>
                      <p className="text-text-secondary">{fmtDate(detailChallan.dueDate)}</p>
                    </div>
                    <div>
                      <p className={LABEL_CLS}>Payment reference</p>
                      <p className="text-text-secondary font-mono">{text(detailChallan.paymentReference)}</p>
                    </div>
                    <div>
                      <p className={LABEL_CLS}>Bank</p>
                      <p className="text-text-secondary">{text(detailChallan.bankName)}</p>
                    </div>
                    <div>
                      <p className={LABEL_CLS}>Acknowledgement</p>
                      <p className="text-text-secondary font-mono">
                        {text(detailChallan.acknowledgementNo)}
                        {detailChallan.acknowledgedOn ? ` · ${fmtDate(detailChallan.acknowledgedOn)}` : ''}
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-text-primary text-sm font-semibold mb-2">Per-employee breakdown</p>
                  {detailRows.length === 0 ? (
                    <EmptyBlock message="No contribution rows are attached to this challan" />
                  ) : (
                    <TableShell
                      headers={['Employee', 'Code', 'Scheme', 'Wage base', 'Employee', 'Employer', 'Admin', 'Total']}
                    >
                      {detailRows.map((r, index) => (
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
                          <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                            {money(r?.employeeAmount)}
                          </td>
                          <td className="px-3 py-2 text-xs text-text-secondary font-mono text-right whitespace-nowrap">
                            {money(r?.employerAmount)}
                          </td>
                          <td className="px-3 py-2 text-xs text-text-muted font-mono text-right whitespace-nowrap">
                            {money(r?.adminCharges)}
                          </td>
                          <td className="px-3 py-2 text-xs text-text-primary font-mono font-semibold text-right whitespace-nowrap">
                            {money(r?.totalAmount)}
                          </td>
                        </tr>
                      ))}
                    </TableShell>
                  )}
                </div>
              </div>
            )}
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Mark paid modal ---------------------------------------------------- */}
      <AnimatePresence>
        {payOpen && (
          <ModalShell
            title="Mark the challan paid"
            onClose={() => setPayOpen(false)}
            maxWidth="max-w-md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setPayOpen(false)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={markPaid} disabled={actionBusy}>
                  {actionBusy ? 'Saving…' : 'Mark paid'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              <div>
                <label className={LABEL_CLS} htmlFor="paid-on">
                  Paid on
                </label>
                <input
                  id="paid-on"
                  type="date"
                  className={INPUT_CLS}
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="paid-ref">
                  Payment reference
                </label>
                <input
                  id="paid-ref"
                  className={INPUT_CLS}
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="paid-bank">
                  Bank
                </label>
                <input
                  id="paid-bank"
                  className={INPUT_CLS}
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                />
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Acknowledgement modal ---------------------------------------------- */}
      <AnimatePresence>
        {ackOpen && (
          <ModalShell
            title="Record the acknowledgement"
            onClose={() => setAckOpen(false)}
            maxWidth="max-w-md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => setAckOpen(false)}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={recordAck} disabled={actionBusy}>
                  {actionBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              <div>
                <label className={LABEL_CLS} htmlFor="ack-no">
                  Acknowledgement no
                </label>
                <input
                  id="ack-no"
                  className={INPUT_CLS}
                  value={acknowledgementNo}
                  onChange={(e) => setAcknowledgementNo(e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="ack-on">
                  Acknowledged on
                </label>
                <input
                  id="ack-on"
                  type="date"
                  className={INPUT_CLS}
                  value={acknowledgedOn}
                  onChange={(e) => setAcknowledgedOn(e.target.value)}
                />
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
