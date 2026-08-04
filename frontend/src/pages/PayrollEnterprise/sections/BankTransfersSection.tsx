import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Download, Plus, RefreshCw, RotateCcw, Send, X } from 'lucide-react';
import { openAuthenticatedFile, payrollAdminApi } from '../../../api/payroll';
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

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

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
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function prettyEnum(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) return '—';
  return s
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

function batchTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'COMPLETED':
      return 'success';
    case 'SENT':
    case 'PROCESSING':
      return 'info';
    case 'PARTIALLY_FAILED':
      return 'warning';
    case 'FAILED':
    case 'CANCELLED':
      return 'danger';
    default:
      return 'default';
  }
}

function itemTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'success';
    case 'SENT':
      return 'info';
    case 'FAILED':
    case 'RETURNED':
      return 'danger';
    default:
      return 'default';
  }
}

/** Plain-English reason a beneficiary was dropped from a batch. */
const VALIDATION_REASONS: Record<string, string> = {
  MISSING_ACCOUNT: 'No bank account on file',
  MISSING_IFSC: 'No IFSC',
  INVALID_IFSC: 'IFSC format is not valid',
  ZERO_AMOUNT: 'Nothing payable',
};

function validationReason(status: unknown): string {
  const key = String(status ?? '').toUpperCase();
  return VALIDATION_REASONS[key] ?? prettyEnum(key);
}

/** Only the last four digits of an account number ever need to be on screen. */
function maskAccount(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) return '—';
  if (s.length <= 4) return `••••${s}`;
  return `••••${s.slice(-4)}`;
}

const PAYMENT_MODES = ['NEFT', 'RTGS', 'IMPS', 'ACH', 'CHEQUE', 'CASH'];
const FILE_FORMATS = ['NEFT', 'RTGS', 'IMPS', 'ACH', 'GENERIC_CSV'];
const ITEM_STATUSES = ['PENDING', 'SENT', 'SUCCESS', 'FAILED', 'RETURNED'];
const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Excluded-items panel — the safety surface of this section
// ---------------------------------------------------------------------------

function ExcludedPanel({ items }: { items: any[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-md bg-danger-light border border-danger/30 p-4">
      <p className="text-danger text-sm font-semibold mb-2">
        <AlertTriangle size={16} className="inline mr-1.5" />
        Excluded from this batch ({items.length})
      </p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={item.id ?? i} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-text-primary truncate">{text(item.beneficiaryName)}</span>
            <span className="text-danger flex-shrink-0">{validationReason(item.validationStatus)}</span>
          </li>
        ))}
      </ul>
      <p className="text-danger text-[11px] mt-3">
        Fix in Employee Profile → Bank details, then regenerate the batch to include them.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generate batch modal
// ---------------------------------------------------------------------------

function GenerateBatchModal({
  accounts,
  onClose,
  onGenerated,
}: {
  accounts: any[];
  onClose: () => void;
  onGenerated: () => void;
}) {
  const { salaryPeriods } = useApp();
  const [periodId, setPeriodId] = useState(salaryPeriods[0] ? String(salaryPeriods[0].id) : '');
  const [bankAccountId, setBankAccountId] = useState(accounts[0] ? String(accounts[0].id) : '');
  const [paymentMode, setPaymentMode] = useState('NEFT');
  const [valueDate, setValueDate] = useState(TODAY);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  const generate = () => {
    const pid = num(periodId);
    if (pid === null) {
      window.alert('Pick a salary period');
      return;
    }
    setBusy(true);
    payrollAdminApi
      .generateBatch({
        periodId: pid,
        bankAccountId: num(bankAccountId),
        paymentMode,
        valueDate: valueDate || null,
      })
      .then((res) => {
        setResult(res ?? null);
        onGenerated();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const invalidItems: any[] = (result?.invalidItems ?? []) as any[];
  const batch = result?.batch ?? null;

  return (
    <ModalShell
      title="Generate payment batch"
      subtitle="Builds a bank file from the unpaid salary lines of a period"
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className={BTN_SECONDARY} onClick={onClose}>
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button className={BTN_PRIMARY} disabled={busy} onClick={generate}>
              {busy ? 'Generating…' : 'Generate batch'}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {!result && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Salary period</label>
              <select className={INPUT_CLS} value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                <option value="">Select…</option>
                {salaryPeriods.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Company bank account</label>
              <select
                className={INPUT_CLS}
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
              >
                <option value="">Use the default account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.label} — {a.bankName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Payment mode</label>
              <select className={INPUT_CLS} value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Value date</label>
              <input
                className={INPUT_CLS}
                type="date"
                value={valueDate}
                onChange={(e) => setValueDate(e.target.value)}
              />
            </div>
          </div>
        )}

        {batch && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Batch no" value={<span className="text-base font-mono">{text(batch.batchNo)}</span>} />
            <StatCard label="Status" value={<span className="text-base">{prettyEnum(batch.status)}</span>} />
            <StatCard label="Records" value={num(batch.totalRecords) ?? '—'} />
            <StatCard label="Amount" value={money(batch.totalAmount)} intent="info" />
          </div>
        )}

        {result && <ExcludedPanel items={invalidItems} />}
        {result && invalidItems.length === 0 && (
          <p className="text-success text-xs">Every payable line passed validation — nothing was excluded.</p>
        )}
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Record results modal
// ---------------------------------------------------------------------------

function RecordResultsModal({
  batchId,
  items,
  onClose,
  onDone,
}: {
  batchId: number;
  items: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<Record<string, { status: string; utrReference: string; failureReason: string }>>(
    () => {
      const seed: Record<string, { status: string; utrReference: string; failureReason: string }> = {};
      for (const item of items) {
        seed[String(item.id)] = {
          status: String(item.status ?? 'PENDING'),
          utrReference: String(item.utrReference ?? ''),
          failureReason: String(item.failureReason ?? ''),
        };
      }
      return seed;
    },
  );
  const [busy, setBusy] = useState(false);

  const submit = () => {
    const results = items.map((item) => {
      const r = rows[String(item.id)];
      return {
        itemId: Number(item.id),
        status: r?.status ?? 'PENDING',
        utrReference: r?.utrReference?.trim() || null,
        failureReason: r?.failureReason?.trim() || null,
      };
    });
    setBusy(true);
    payrollAdminApi
      .recordResults(batchId, results)
      .then(() => onDone())
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title="Record payment results"
      subtitle="Enter the UTR and outcome the bank returned for each beneficiary"
      onClose={onClose}
      maxWidth="max-w-4xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button className={BTN_PRIMARY} disabled={busy} onClick={submit}>
            {busy ? 'Saving…' : 'Save results'}
          </button>
        </div>
      }
    >
      <p className="text-text-muted text-[11px] mb-3">
        A failure reason is required for anything marked Failed or Returned.
      </p>
      <TableShell headers={['Beneficiary', 'Amount', 'Status', 'UTR', 'Failure reason']}>
        {items.map((item) => {
          const key = String(item.id);
          const r = rows[key];
          return (
            <tr key={key}>
              <td className="px-3 py-2 text-xs text-text-primary">{text(item.beneficiaryName)}</td>
              <td className="px-3 py-2 text-xs font-mono text-right text-text-secondary">{money(item.amount)}</td>
              <td className="px-3 py-2 w-32">
                <select
                  className={`${INPUT_CLS} text-xs py-1.5`}
                  value={r?.status ?? 'PENDING'}
                  onChange={(e) =>
                    setRows({
                      ...rows,
                      [key]: {
                        status: e.target.value,
                        utrReference: r?.utrReference ?? '',
                        failureReason: r?.failureReason ?? '',
                      },
                    })
                  }
                >
                  {ITEM_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {prettyEnum(s)}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2 w-40">
                <input
                  className={`${INPUT_CLS} text-xs py-1.5 font-mono`}
                  value={r?.utrReference ?? ''}
                  onChange={(e) =>
                    setRows({
                      ...rows,
                      [key]: {
                        status: r?.status ?? 'PENDING',
                        utrReference: e.target.value,
                        failureReason: r?.failureReason ?? '',
                      },
                    })
                  }
                />
              </td>
              <td className="px-3 py-2 w-48">
                <input
                  className={`${INPUT_CLS} text-xs py-1.5`}
                  value={r?.failureReason ?? ''}
                  onChange={(e) =>
                    setRows({
                      ...rows,
                      [key]: {
                        status: r?.status ?? 'PENDING',
                        utrReference: r?.utrReference ?? '',
                        failureReason: e.target.value,
                      },
                    })
                  }
                />
              </td>
            </tr>
          );
        })}
      </TableShell>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Batch detail
// ---------------------------------------------------------------------------

function BatchDetailModal({
  batchId,
  onClose,
  onChanged,
}: {
  batchId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [batch, setBatch] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [retryResult, setRetryResult] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    payrollAdminApi
      .batch(batchId)
      .then((res) => {
        setBatch(res ?? null);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [batchId]);

  useEffect(() => {
    load();
  }, [load]);

  const items: any[] = (batch?.items ?? []) as any[];
  const invalidItems = items.filter((i) => String(i.validationStatus ?? 'VALID').toUpperCase() !== 'VALID');

  const exportFile = () => {
    setBusy(true);
    openAuthenticatedFile(payrollAdminApi.batchExportUrl(batchId), `${batch?.batchNo ?? 'batch'}.csv`)
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const markSent = () => {
    setBusy(true);
    payrollAdminApi
      .markBatchSent(batchId)
      .then(() => {
        load();
        onChanged();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const retry = () => {
    if (!window.confirm('Retry creates a new batch containing only the failed items. Continue?')) return;
    setBusy(true);
    payrollAdminApi
      .retryBatch(batchId)
      .then((res) => {
        setRetryResult(res ?? null);
        onChanged();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  // Rendered instead of, not inside, the detail modal: a nested fixed-position
  // dialog would be positioned against the animated ancestor's transform.
  if (recording) {
    return (
      <RecordResultsModal
        batchId={batchId}
        items={items}
        onClose={() => setRecording(false)}
        onDone={() => {
          setRecording(false);
          load();
          onChanged();
        }}
      />
    );
  }

  return (
    <ModalShell
      title={batch ? `Batch ${text(batch.batchNo)}` : 'Batch'}
      subtitle={batch ? `${text(batch.periodLabel)} · ${prettyEnum(batch.status)}` : null}
      onClose={onClose}
      maxWidth="max-w-5xl"
      footer={
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <button className={BTN_SECONDARY} disabled={busy} onClick={exportFile}>
            <Download size={14} className="inline mr-1.5" />
            Export file
          </button>
          <button className={BTN_SECONDARY} disabled={busy} onClick={markSent}>
            <Send size={14} className="inline mr-1.5" />
            Mark sent
          </button>
          <button className={BTN_SECONDARY} disabled={busy || items.length === 0} onClick={() => setRecording(true)}>
            Record results
          </button>
          <button className={BTN_SECONDARY} disabled={busy} onClick={retry}>
            <RotateCcw size={14} className="inline mr-1.5" />
            Retry failed
          </button>
        </div>
      }
    >
      {loading && <LoadingBlock label="Loading batch…" />}
      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && batch && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Records" value={num(batch.totalRecords) ?? '—'} />
            <StatCard label="Amount" value={money(batch.totalAmount)} />
            <StatCard label="Success" value={num(batch.successCount) ?? 0} intent="success" />
            <StatCard
              label="Failed"
              value={num(batch.failedCount) ?? 0}
              intent={(num(batch.failedCount) ?? 0) > 0 ? 'danger' : 'default'}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs">
            <span className="text-text-muted">Bank account</span>
            <span className="text-text-secondary">{text(batch.bankAccountLabel)}</span>
            <span className="text-text-muted">Payment mode</span>
            <span className="text-text-secondary">{text(batch.paymentMode)}</span>
            <span className="text-text-muted">Value date</span>
            <span className="text-text-secondary">{fmtDate(batch.valueDate)}</span>
            <span className="text-text-muted">Generated</span>
            <span className="text-text-secondary">{fmtDate(batch.generatedAt)}</span>
          </div>

          <ExcludedPanel items={invalidItems} />

          {retryResult?.batch && (
            <div className="rounded-md border border-border-default bg-bg-secondary p-3">
              <p className="text-xs text-text-primary">
                Retry batch <span className="font-mono">{text(retryResult.batch.batchNo)}</span> created with{' '}
                {num(retryResult.batch.totalRecords) ?? '—'} record(s), {money(retryResult.batch.totalAmount)}.
              </p>
            </div>
          )}

          {items.length === 0 ? (
            <EmptyBlock message="This batch has no items" />
          ) : (
            <TableShell headers={['Beneficiary', 'Account', 'IFSC', 'Amount', 'Status', 'UTR', 'Failure reason']}>
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-bg-hover">
                  <td className="px-3 py-2 text-xs text-text-primary whitespace-nowrap">
                    {text(item.beneficiaryName)}
                    <span className="block text-[10px] text-text-muted font-mono">{text(item.empCode)}</span>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-text-secondary">{maskAccount(item.accountNumber)}</td>
                  <td className="px-3 py-2 text-xs font-mono text-text-secondary">{text(item.ifsc)}</td>
                  <td className="px-3 py-2 text-xs font-mono text-right text-text-primary">{money(item.amount)}</td>
                  <td className="px-3 py-2">
                    <Chip label={prettyEnum(item.status)} tone={itemTone(item.status)} dot />
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-text-secondary">{text(item.utrReference)}</td>
                  <td className="px-3 py-2 text-xs text-danger">{text(item.failureReason)}</td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Batches tab
// ---------------------------------------------------------------------------

function BatchesTab({ accounts }: { accounts: any[] }) {
  const { salaryPeriods } = useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    payrollAdminApi
      .batches({ periodId: num(periodId) ?? undefined })
      .then((res) => {
        setRows(Array.isArray(res) ? res : []);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [periodId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && rows.length === 0) return <LoadingBlock label="Loading payment batches…" />;
  if (error) {
    return (
      <div className="space-y-3">
        <ErrorBlock message={error} />
        <button className={BTN_SECONDARY} onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <label className={LABEL_CLS}>Period</label>
          <select
            className={`${INPUT_CLS} w-auto min-w-52`}
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
          >
            <option value="">All periods</option>
            {salaryPeriods.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button className={BTN_SECONDARY} onClick={load}>
            <RefreshCw size={14} className="inline mr-1.5" />
            Refresh
          </button>
          <button className={BTN_PRIMARY} onClick={() => setGenerating(true)}>
            <Plus size={14} className="inline mr-1.5" />
            Generate batch
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock message="No payment batches yet" hint="Generate one from a period's unpaid salary lines" />
      ) : (
        <TableShell
          headers={['Batch no', 'Period', 'Mode', 'Value date', 'Records', 'Amount', 'Success / failed', 'Status']}
        >
          {rows.map((row) => (
            <tr
              key={row.id}
              className="hover:bg-bg-hover transition-colors cursor-pointer"
              onClick={() => setDetailId(Number(row.id))}
            >
              <td className="px-3 py-2 text-xs font-mono text-text-primary">{text(row.batchNo)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary">{text(row.periodLabel)}</td>
              <td className="px-3 py-2">
                <Chip label={text(row.paymentMode)} tone="primary" />
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">{fmtDate(row.valueDate)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary tabular-nums text-right">
                {num(row.totalRecords) ?? '—'}
              </td>
              <td className="px-3 py-2 text-xs font-mono text-right text-text-primary">{money(row.totalAmount)}</td>
              <td className="px-3 py-2 text-xs text-right whitespace-nowrap">
                <span className="text-success font-mono">{num(row.successCount) ?? 0}</span>
                <span className="text-text-muted"> / </span>
                <span className={(num(row.failedCount) ?? 0) > 0 ? 'text-danger font-mono' : 'text-text-muted font-mono'}>
                  {num(row.failedCount) ?? 0}
                </span>
              </td>
              <td className="px-3 py-2">
                <Chip label={prettyEnum(row.status)} tone={batchTone(row.status)} dot />
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {generating && (
          <GenerateBatchModal accounts={accounts} onClose={() => setGenerating(false)} onGenerated={load} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detailId !== null && (
          <BatchDetailModal batchId={detailId} onClose={() => setDetailId(null)} onChanged={load} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bank accounts tab
// ---------------------------------------------------------------------------

function AccountsTab({
  accounts,
  loading,
  error,
  onReload,
}: {
  accounts: any[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    label: '',
    bankName: '',
    accountNumber: '',
    ifsc: '',
    branch: '',
    currency: 'INR',
    fileFormat: 'GENERIC_CSV',
    corporateId: '',
    isDefault: false,
  });

  const save = () => {
    if (!form.label.trim() || !form.bankName.trim() || !form.accountNumber.trim()) {
      window.alert('Label, bank name and account number are required');
      return;
    }
    setSaving(true);
    payrollAdminApi
      .createBankAccount({
        label: form.label.trim(),
        bankName: form.bankName.trim(),
        accountNumber: form.accountNumber.trim(),
        ifsc: form.ifsc.trim().toUpperCase() || null,
        branch: form.branch.trim() || null,
        currency: form.currency.trim().toUpperCase() || 'INR',
        fileFormat: form.fileFormat,
        corporateId: form.corporateId.trim() || null,
        isDefault: form.isDefault,
      })
      .then(() => {
        setCreating(false);
        onReload();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setSaving(false));
  };

  if (loading && accounts.length === 0) return <LoadingBlock label="Loading bank accounts…" />;
  if (error) {
    return (
      <div className="space-y-3">
        <ErrorBlock message={error} />
        <button className={BTN_SECONDARY} onClick={onReload}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <button className={BTN_SECONDARY} onClick={onReload}>
          <RefreshCw size={14} className="inline mr-1.5" />
          Refresh
        </button>
        <button className={BTN_PRIMARY} onClick={() => setCreating(true)}>
          <Plus size={14} className="inline mr-1.5" />
          New account
        </button>
      </div>

      {accounts.length === 0 ? (
        <EmptyBlock message="No company bank accounts configured" hint="A batch cannot be generated without one" />
      ) : (
        <TableShell headers={['Label', 'Bank', 'Account', 'IFSC', 'Branch', 'Format', 'Default']}>
          {accounts.map((a) => (
            <tr key={a.id} className="hover:bg-bg-hover">
              <td className="px-3 py-2 text-xs text-text-primary">{text(a.label)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary">{text(a.bankName)}</td>
              <td className="px-3 py-2 text-xs font-mono text-text-secondary">{maskAccount(a.accountNumber)}</td>
              <td className="px-3 py-2 text-xs font-mono text-text-secondary">{text(a.ifsc)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary">{text(a.branch)}</td>
              <td className="px-3 py-2">
                <Chip label={prettyEnum(a.fileFormat)} tone="info" />
              </td>
              <td className="px-3 py-2">
                {a.isDefault ? <Chip label="Default" tone="primary" /> : <span className="text-text-muted text-xs">—</span>}
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex justify-end"
            onClick={() => setCreating(false)}
          >
            <div className="absolute inset-0 bg-black/40" />
            <motion.div
              initial={{ x: 420 }}
              animate={{ x: 0 }}
              exit={{ x: 420 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="relative bg-bg-card border-l border-border-default w-full max-w-md h-full flex flex-col shadow-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b border-border-default flex items-center justify-between flex-shrink-0">
                <h3 className="text-text-primary font-semibold text-sm">New bank account</h3>
                <button
                  onClick={() => setCreating(false)}
                  aria-label="Close"
                  className="text-text-muted hover:text-text-primary"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
                <div>
                  <label className={LABEL_CLS}>Label</label>
                  <input
                    className={INPUT_CLS}
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Bank name</label>
                  <input
                    className={INPUT_CLS}
                    value={form.bankName}
                    onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Account number</label>
                  <input
                    className={`${INPUT_CLS} font-mono`}
                    value={form.accountNumber}
                    onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLS}>IFSC</label>
                    <input
                      className={`${INPUT_CLS} font-mono`}
                      value={form.ifsc}
                      onChange={(e) => setForm({ ...form, ifsc: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Branch</label>
                    <input
                      className={INPUT_CLS}
                      value={form.branch}
                      onChange={(e) => setForm({ ...form, branch: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Currency</label>
                    <input
                      className={INPUT_CLS}
                      value={form.currency}
                      onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>File format</label>
                    <select
                      className={INPUT_CLS}
                      value={form.fileFormat}
                      onChange={(e) => setForm({ ...form, fileFormat: e.target.value })}
                    >
                      {FILE_FORMATS.map((x) => (
                        <option key={x} value={x}>
                          {prettyEnum(x)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={LABEL_CLS}>Corporate id</label>
                  <input
                    className={INPUT_CLS}
                    value={form.corporateId}
                    onChange={(e) => setForm({ ...form, corporateId: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isDefault}
                    onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                    className="accent-[var(--color-primary)]"
                  />
                  Use as the default payout account
                </label>
              </div>

              <div className="px-4 py-3 border-t border-border-default bg-bg-secondary flex items-center justify-end gap-2 flex-shrink-0">
                <button className={BTN_SECONDARY} onClick={() => setCreating(false)}>
                  Cancel
                </button>
                <button className={BTN_PRIMARY} disabled={saving} onClick={save}>
                  {saving ? 'Saving…' : 'Save account'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function BankTransfersSection() {
  const [tab, setTab] = useState('batches');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const loadAccounts = useCallback(() => {
    setAccountsLoading(true);
    payrollAdminApi
      .bankAccounts()
      .then((res) => {
        setAccounts(Array.isArray(res) ? res : []);
        setAccountsError(null);
      })
      .catch((err) => setAccountsError(reason(err)))
      .finally(() => setAccountsLoading(false));
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { id: 'batches', label: 'Batches' },
          { id: 'accounts', label: 'Bank accounts', count: accounts.length },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'batches' && <BatchesTab accounts={accounts} />}
      {tab === 'accounts' && (
        <AccountsTab
          accounts={accounts}
          loading={accountsLoading}
          error={accountsError}
          onReload={loadAccounts}
        />
      )}
    </div>
  );
}
