import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCheck, FileCheck2, Home, Plus, RefreshCw, Save, Trash2, XCircle } from 'lucide-react';
import { complianceApi, financialYearOf } from '../../../api/compliance';
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
// Local helpers (date-fns is not installed)
// ---------------------------------------------------------------------------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const iso = String(value).slice(0, 10);
  const parts = iso.split('-');
  if (parts.length !== 3) return String(value);
  const [y, m, d] = parts;
  const monthIndex = Number(m) - 1;
  if (!y || !d) return String(value);
  return `${d} ${MONTH_NAMES[monthIndex] ?? m} ${y}`;
}

function fmtMonth(value: string | null | undefined): string {
  if (!value) return '—';
  const parts = String(value).split('-');
  if (parts.length < 2) return String(value);
  const monthIndex = Number(parts[1]) - 1;
  return `${MONTH_NAMES[monthIndex] ?? parts[1]} ${parts[0]}`;
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
  return `${Math.round(hours / 24)}d ago`;
}

function fyOptions(): string[] {
  const current = financialYearOf();
  const start = Number(current.slice(0, 4));
  return [start - 2, start - 1, start, start + 1].map((y) => `${y}-${y + 1}`);
}

/** The twelve `YYYY-MM` keys of an Indian financial year. */
function fyMonths(fy: string): string[] {
  const startYear = Number(String(fy).slice(0, 4));
  if (!Number.isFinite(startYear)) return [];
  return Array.from({ length: 12 }, (_, i) => {
    const month = ((3 + i) % 12) + 1;
    const year = i < 9 ? startYear : startYear + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  });
}

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const PROOF_STATUS_TONE: Record<string, Tone> = {
  SUBMITTED: 'default',
  UNDER_REVIEW: 'info',
  APPROVED: 'success',
  PARTIALLY_APPROVED: 'warning',
  REJECTED: 'danger',
};

const PROOF_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED'];

interface Proof {
  id: number;
  declarationItemId?: number | null;
  sectionCode?: string | null;
  sectionName?: string | null;
  employeeId?: number | null;
  empCode?: string | null;
  employeeName?: string | null;
  financialYear?: string | null;
  proofType?: string | null;
  title?: string | null;
  claimedAmount?: number | null;
  verifiedAmount?: number | null;
  documentName?: string | null;
  status: string;
  reviewerName?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  createdAt?: string | null;
}

interface HraRow {
  id?: number;
  fromMonth: string;
  toMonth: string;
  monthlyRent: number;
  city: string | null;
  isMetro: boolean;
  landlordName: string | null;
  landlordPan: string | null;
  landlordAddress?: string | null;
  panRequired?: boolean;
}

/**
 * Investment proof verification and the HRA rent declaration.
 *
 * Approving a proof is not cosmetic — the verified amount is written back to
 * the declaration item the tax engine reads, so the review screen says so
 * rather than letting a payslip change without explanation.
 */
export function TaxProofsSection() {
  const [tab, setTab] = useState<'proofs' | 'hra'>('proofs');

  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { id: 'proofs', label: 'Proofs' },
          { id: 'hra', label: 'HRA' },
        ]}
        active={tab}
        onChange={(id) => setTab(id === 'hra' ? 'hra' : 'proofs')}
      />
      {tab === 'proofs' ? <ProofsTab /> : <HraTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

function ProofsTab() {
  const { employees } = useApp();

  const [financialYear, setFinancialYear] = useState<string>(financialYearOf());
  const [status, setStatus] = useState('ALL');
  const [employeeId, setEmployeeId] = useState<number | null>(null);

  const [proofs, setProofs] = useState<Proof[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reviewing, setReviewing] = useState<Proof | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      complianceApi.proofs({
        financialYear,
        status: status === 'ALL' ? undefined : status,
        employeeId: employeeId ?? undefined,
      }),
      complianceApi.pendingProofSummary().catch(() => null),
    ])
      .then(([rows, summaryRes]) => {
        setProofs(Array.isArray(rows) ? (rows as Proof[]) : []);
        setSummary(summaryRes ?? null);
        setSelected(new Set());
      })
      .catch((err: any) => setError(err?.message ?? 'Could not load investment proofs'))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [financialYear, status, employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const pendingEmployees = Array.isArray(summary?.employees) ? summary.employees : [];
  const totalPendingClaimed = pendingEmployees.reduce((sum: number, e: any) => sum + Number(e?.claimedAmount ?? 0), 0);
  const oldest = pendingEmployees.reduce((acc: string | null, e: any) => {
    const value = e?.oldestSubmittedAt ? String(e.oldestSubmittedAt) : null;
    if (!value) return acc;
    return !acc || value < acc ? value : acc;
  }, null as string | null);

  const toggleRow = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === proofs.length ? new Set() : new Set(proofs.map((p) => p.id))));
  };

  const bulkReview = (target: 'APPROVED' | 'REJECTED') => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    complianceApi
      .bulkReviewProofs(ids, target)
      .then((res) => {
        const updated = Number(res?.updated ?? 0);
        const skipped = Array.isArray(res?.skipped) ? res.skipped.length : 0;
        window.alert(`${updated} proof(s) set to ${target}${skipped > 0 ? `, ${skipped} skipped` : ''}.`);
        load();
      })
      .catch((err: any) => window.alert(err?.message ?? 'The bulk review failed'))
      .finally(() => setBulkBusy(false));
  };

  return (
    <div className="space-y-4">
      {/* Filters ----------------------------------------------------------- */}
      <div className="bg-bg-card border border-border-default rounded-md p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className={LABEL_CLS} htmlFor="pf-fy">
              Financial year
            </label>
            <select
              id="pf-fy"
              className={`${INPUT_CLS} w-36`}
              value={financialYear}
              onChange={(e) => setFinancialYear(e.target.value)}
            >
              {fyOptions().map((fy) => (
                <option key={fy} value={fy}>
                  {fy}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="pf-status">
              Status
            </label>
            <select id="pf-status" className={`${INPUT_CLS} w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ALL">All statuses</option>
              {PROOF_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="pf-emp">
              Employee
            </label>
            <select
              id="pf-emp"
              className={`${INPUT_CLS} min-w-[200px]`}
              value={employeeId ?? ''}
              onChange={(e) => setEmployeeId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All employees</option>
              {(employees ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.empCode} · {emp.fullName}
                </option>
              ))}
            </select>
          </div>
          <button onClick={load} className={BTN_SECONDARY} disabled={loading}>
            <RefreshCw size={14} className={`inline mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Pending summary --------------------------------------------------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Pending proofs"
          value={Number(summary?.totalPending ?? 0)}
          intent={Number(summary?.totalPending ?? 0) > 0 ? 'warning' : 'success'}
          hint="Submitted or under review, all years"
        />
        <StatCard label="Employees waiting" value={pendingEmployees.length} />
        <StatCard label="Amount claimed (pending)" value={inr(totalPendingClaimed)} intent="info" />
        <StatCard label="Oldest submission" value={timeAgo(oldest)} hint={oldest ? fmtDate(oldest) : 'nothing pending'} />
      </div>

      {/* Bulk bar ---------------------------------------------------------- */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => bulkReview('APPROVED')} className={BTN_PRIMARY} disabled={bulkBusy || selected.size === 0}>
          <CheckCheck size={14} className="inline mr-1.5" />
          Approve {selected.size > 0 ? `(${selected.size})` : ''}
        </button>
        <button onClick={() => bulkReview('REJECTED')} className={BTN_SECONDARY} disabled={bulkBusy || selected.size === 0}>
          <XCircle size={14} className="inline mr-1.5" />
          Reject {selected.size > 0 ? `(${selected.size})` : ''}
        </button>
        <span className="text-text-muted text-[11px]">
          Bulk review offers only approve-in-full or reject: the backend refuses a partial status in bulk because
          there is no sensible bulk answer to &ldquo;how much&rdquo;. Use Review on a single row for a partial amount.
        </span>
      </div>

      {loading && firstLoad && <LoadingBlock label="Loading proofs…" />}

      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button onClick={load} className={BTN_SECONDARY}>
            Retry
          </button>
        </div>
      )}

      {!error && !firstLoad && proofs.length === 0 && (
        <EmptyBlock message="No proofs for these filters" hint="Employees submit proofs from their self-service page." />
      )}

      {!error && proofs.length > 0 && (
        <TableShell
          headers={['', 'Employee', 'Type', 'Title', 'Claimed', 'Verified', 'Status', 'Reviewer', '']}
        >
          <tr className="bg-bg-secondary">
            <td className="px-3 py-1.5">
              <input
                type="checkbox"
                aria-label="Select all proofs"
                checked={selected.size === proofs.length && proofs.length > 0}
                onChange={toggleAll}
              />
            </td>
            <td colSpan={8} className="px-3 py-1.5 text-[11px] text-text-muted">
              {selected.size} of {proofs.length} selected
            </td>
          </tr>
          {proofs.map((p) => (
            <tr key={p.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={`Select proof ${p.id}`}
                  checked={selected.has(p.id)}
                  onChange={() => toggleRow(p.id)}
                />
              </td>
              <td className="px-3 py-2 text-sm text-text-primary whitespace-nowrap">
                {p.employeeName ?? '—'}
                <span className="block text-text-muted text-[11px] font-mono">{p.empCode ?? '—'}</span>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {p.proofType ? <Chip label={String(p.proofType).replace(/_/g, ' ')} tone="primary" /> : '—'}
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary">
                {p.title ?? '—'}
                {p.sectionCode && <span className="block text-text-muted text-[11px]">Section {p.sectionCode}</span>}
              </td>
              <td className="px-3 py-2 text-sm text-right font-mono text-text-primary whitespace-nowrap">
                {p.claimedAmount === null || p.claimedAmount === undefined ? '—' : inr(Number(p.claimedAmount))}
              </td>
              <td className="px-3 py-2 text-sm text-right font-mono whitespace-nowrap">
                {p.verifiedAmount === null || p.verifiedAmount === undefined ? (
                  <span className="text-text-muted">—</span>
                ) : (
                  <span
                    className={
                      Number(p.verifiedAmount) < Number(p.claimedAmount ?? 0) ? 'text-warning' : 'text-text-primary'
                    }
                  >
                    {inr(Number(p.verifiedAmount))}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Chip label={String(p.status).replace(/_/g, ' ')} tone={PROOF_STATUS_TONE[p.status] ?? 'default'} dot />
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">
                {p.reviewerName ?? '—'}
                {p.reviewedAt && <span className="block text-text-muted text-[11px]">{timeAgo(p.reviewedAt)}</span>}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <button
                  onClick={() => setReviewing(p)}
                  className="px-2 py-1 rounded border border-border-default text-text-secondary text-[11px] font-medium hover:bg-bg-hover transition-colors inline-flex items-center gap-1"
                >
                  <FileCheck2 size={13} /> Review
                </button>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {reviewing && (
          <ReviewProofModal
            proof={reviewing}
            onClose={() => setReviewing(null)}
            onDone={() => {
              setReviewing(null);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review modal
// ---------------------------------------------------------------------------

function ReviewProofModal({ proof, onClose, onDone }: { proof: Proof; onClose: () => void; onDone: () => void }) {
  const claimed = Number(proof.claimedAmount ?? 0);
  const [mode, setMode] = useState<'FULL' | 'PARTIAL' | 'REJECT'>('FULL');
  const [verified, setVerified] = useState<string>(String(claimed));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = () => {
    setSaving(true);
    const body =
      mode === 'FULL'
        ? { status: 'APPROVED', verifiedAmount: claimed, note: note.trim() || null }
        : mode === 'PARTIAL'
          ? { status: 'APPROVED', verifiedAmount: Number(verified), note: note.trim() || null }
          : { status: 'REJECTED', verifiedAmount: 0, note: note.trim() || null };
    complianceApi
      .reviewProof(proof.id, body)
      .then(() => onDone())
      .catch((err: any) => window.alert(err?.message ?? 'The review could not be saved'))
      .finally(() => setSaving(false));
  };

  const partialInvalid =
    mode === 'PARTIAL' && (!Number.isFinite(Number(verified)) || Number(verified) < 0 || Number(verified) > claimed);

  return (
    <ModalShell
      title={`Review: ${proof.title ?? `proof #${proof.id}`}`}
      subtitle={`${proof.employeeName ?? '—'} · ${proof.proofType ?? '—'} · ${proof.financialYear ?? '—'} · claimed ${inr(claimed)}`}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={BTN_SECONDARY} disabled={saving}>
            Cancel
          </button>
          <button onClick={submit} className={BTN_PRIMARY} disabled={saving || partialInvalid}>
            {saving ? 'Saving…' : 'Save review'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {(
            [
              { id: 'FULL', label: 'Approve in full' },
              { id: 'PARTIAL', label: 'Approve a partial amount' },
              { id: 'REJECT', label: 'Reject' },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              onClick={() => setMode(option.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                mode === option.id
                  ? 'bg-primary-light border-primary/30 text-primary'
                  : 'border-border-default text-text-muted hover:border-text-muted'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {mode === 'PARTIAL' && (
          <div>
            <label className={LABEL_CLS} htmlFor="pf-verified">
              Verified amount
            </label>
            <input
              id="pf-verified"
              className={INPUT_CLS}
              value={verified}
              onChange={(e) => setVerified(e.target.value.replace(/[^\d.]/g, ''))}
            />
            {partialInvalid && (
              <p className="text-danger text-[11px] mt-1">
                Must be a non-negative amount not greater than the {inr(claimed)} claimed.
              </p>
            )}
          </div>
        )}

        <div className="px-3 py-2 rounded-md bg-info-light border border-info/30 text-info text-[11px] flex items-start gap-2">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            The verified amount is written back to the declaration item&rsquo;s approved amount — the only figure the
            tax engine spends — capped at the section limit. Approving less than was claimed is stored as
            PARTIALLY_APPROVED, and the employee&rsquo;s TDS changes from the next payroll run.
          </span>
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="pf-note">
            Reviewer note
          </label>
          <textarea
            id="pf-note"
            className={INPUT_CLS}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={mode === 'REJECT' ? 'Why the proof was rejected (shown to the employee)' : 'Optional'}
          />
        </div>

        <div className="text-text-muted text-[11px] space-y-0.5">
          <p>Document: {proof.documentName ?? 'none attached'}</p>
          <p>Submitted {timeAgo(proof.createdAt)}</p>
          {proof.reviewNote && <p>Previous note: {proof.reviewNote}</p>}
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// HRA
// ---------------------------------------------------------------------------

function HraTab() {
  const { employees } = useApp();

  const [financialYear, setFinancialYear] = useState<string>(financialYearOf());
  const [employeeId, setEmployeeId] = useState<number | null>(null);

  const [rows, setRows] = useState<HraRow[]>([]);
  const [exemption, setExemption] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (employeeId === null && (employees ?? []).length > 0) {
      setEmployeeId(Number(employees[0]?.id ?? 0) || null);
    }
  }, [employees, employeeId]);

  const load = useCallback(() => {
    if (!employeeId) return;
    setLoading(true);
    setError(null);
    Promise.all([complianceApi.hra(employeeId, financialYear), complianceApi.hraExemption(employeeId, financialYear)])
      .then(([rentRows, exemptionRes]) => {
        setRows(
          (Array.isArray(rentRows) ? rentRows : []).map((r: any) => ({
            id: r?.id,
            fromMonth: String(r?.fromMonth ?? ''),
            toMonth: String(r?.toMonth ?? ''),
            monthlyRent: Number(r?.monthlyRent ?? 0),
            city: r?.city ?? null,
            isMetro: !!r?.isMetro,
            landlordName: r?.landlordName ?? null,
            landlordPan: r?.landlordPan ?? null,
            landlordAddress: r?.landlordAddress ?? null,
            panRequired: !!r?.panRequired,
          })),
        );
        setExemption(exemptionRes ?? null);
      })
      .catch((err: any) => setError(err?.message ?? 'Could not load the HRA declaration'))
      .finally(() => setLoading(false));
  }, [employeeId, financialYear]);

  useEffect(() => {
    load();
  }, [load]);

  const months = useMemo(() => fyMonths(financialYear), [financialYear]);

  const annualRent = rows.reduce((sum, r) => {
    const from = r.fromMonth;
    const to = r.toMonth;
    if (!from || !to) return sum;
    const count =
      (Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7))) - (Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7))) + 1;
    return sum + (Number.isFinite(count) && count > 0 ? Number(r.monthlyRent ?? 0) * count : 0);
  }, 0);
  const panRequired = annualRent > 100000;

  const patch = (index: number, changes: Partial<HraRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...changes } : r)));
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        fromMonth: months[0] ?? '',
        toMonth: months[months.length - 1] ?? '',
        monthlyRent: 0,
        city: null,
        isMetro: false,
        landlordName: null,
        landlordPan: null,
      },
    ]);
  };

  const save = () => {
    if (!employeeId) return;
    setSaving(true);
    complianceApi
      .saveHra(
        employeeId,
        financialYear,
        rows.map((r) => ({
          fromMonth: r.fromMonth,
          toMonth: r.toMonth,
          monthlyRent: Number(r.monthlyRent ?? 0),
          city: r.city,
          isMetro: r.isMetro,
          landlordName: r.landlordName,
          landlordPan: r.landlordPan,
          landlordAddress: r.landlordAddress ?? null,
        })),
      )
      .then(() => load())
      .catch((err: any) => window.alert(err?.message ?? 'The HRA declaration could not be saved'))
      .finally(() => setSaving(false));
  };

  const totals = exemption?.totals ?? {};
  const basis = exemption?.basis ?? {};
  const workings: any[] = Array.isArray(exemption?.rows) ? exemption.rows : [];
  const caveats: string[] = Array.isArray(exemption?.caveats) ? exemption.caveats.map(String) : [];
  const grantedExemption = Number(totals?.exemption ?? 0);

  return (
    <div className="space-y-4">
      <div className="bg-bg-card border border-border-default rounded-md p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className={LABEL_CLS} htmlFor="hra-emp">
              Employee
            </label>
            <select
              id="hra-emp"
              className={`${INPUT_CLS} min-w-[220px]`}
              value={employeeId ?? ''}
              onChange={(e) => setEmployeeId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Select an employee</option>
              {(employees ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.empCode} · {emp.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="hra-fy">
              Financial year
            </label>
            <select
              id="hra-fy"
              className={`${INPUT_CLS} w-36`}
              value={financialYear}
              onChange={(e) => setFinancialYear(e.target.value)}
            >
              {fyOptions().map((fy) => (
                <option key={fy} value={fy}>
                  {fy}
                </option>
              ))}
            </select>
          </div>
          <button onClick={load} className={BTN_SECONDARY} disabled={loading || !employeeId}>
            <RefreshCw size={14} className={`inline mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button onClick={addRow} className={BTN_SECONDARY} disabled={!employeeId}>
            <Plus size={14} className="inline mr-1.5" />
            Add rent period
          </button>
          <button onClick={save} className={BTN_PRIMARY} disabled={saving || !employeeId}>
            <Save size={14} className="inline mr-1.5" />
            {saving ? 'Saving…' : 'Save declaration'}
          </button>
          {panRequired && <Chip label="Landlord PAN required (rent over ₹1,00,000)" tone="warning" />}
        </div>
      </div>

      {loading && <LoadingBlock label="Loading HRA declaration…" />}

      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button onClick={load} className={BTN_SECONDARY}>
            Retry
          </button>
        </div>
      )}

      {!error && !loading && employeeId && rows.length === 0 && (
        <EmptyBlock message="No rent periods declared" hint="Add a rent period, then save to compute the exemption." />
      )}

      {!error && rows.length > 0 && (
        <div className="bg-bg-card border border-border-default rounded-md overflow-hidden">
          <div className="px-4 py-2 bg-bg-secondary border-b border-border-default flex items-center gap-2">
            <Home size={14} className="text-text-muted" />
            <h3 className="text-text-primary text-sm font-semibold">Declared rent periods</h3>
            <span className="text-text-muted text-xs">annual rent {inr(annualRent)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-bg-secondary">
                <tr>
                  {['From', 'To', 'Monthly rent', 'City', 'Metro', 'Landlord', 'Landlord PAN', ''].map((h) => (
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
                {rows.map((r, index) => (
                  <tr key={r.id ?? `new-${index}`}>
                    <td className="px-3 py-2">
                      <select
                        className={`${INPUT_CLS} py-1 w-28`}
                        value={r.fromMonth}
                        onChange={(e) => patch(index, { fromMonth: e.target.value })}
                        aria-label="From month"
                      >
                        {months.map((m) => (
                          <option key={m} value={m}>
                            {fmtMonth(m)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className={`${INPUT_CLS} py-1 w-28`}
                        value={r.toMonth}
                        onChange={(e) => patch(index, { toMonth: e.target.value })}
                        aria-label="To month"
                      >
                        {months.map((m) => (
                          <option key={m} value={m}>
                            {fmtMonth(m)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className={`${INPUT_CLS} py-1 w-28 text-right font-mono`}
                        value={String(r.monthlyRent ?? 0)}
                        onChange={(e) => patch(index, { monthlyRent: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })}
                        aria-label="Monthly rent"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className={`${INPUT_CLS} py-1 w-28`}
                        value={r.city ?? ''}
                        onChange={(e) => patch(index, { city: e.target.value || null })}
                        aria-label="City"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={r.isMetro}
                          onChange={(e) => patch(index, { isMetro: e.target.checked })}
                        />
                        {r.isMetro ? <Chip label="Metro 50%" tone="info" /> : <span className="text-text-muted">40%</span>}
                      </label>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className={`${INPUT_CLS} py-1 w-36`}
                        value={r.landlordName ?? ''}
                        onChange={(e) => patch(index, { landlordName: e.target.value || null })}
                        aria-label="Landlord name"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className={`${INPUT_CLS} py-1 w-32 font-mono uppercase`}
                        value={r.landlordPan ?? ''}
                        onChange={(e) => patch(index, { landlordPan: e.target.value.toUpperCase() || null })}
                        aria-label="Landlord PAN"
                      />
                      {panRequired && !r.landlordPan && <Chip label="PAN required" tone="warning" />}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                        className="text-text-muted hover:text-danger transition-colors"
                        aria-label="Remove rent period"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-text-muted text-[11px] border-t border-border-light">
            Edits are only stored once you press Save — the exemption below is recomputed from what is saved, not from
            what is on screen.
          </p>
        </div>
      )}

      {/* Exemption working ------------------------------------------------- */}
      {exemption && (
        <div className="bg-bg-card border border-border-default rounded-md p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-text-primary text-sm font-semibold">Exemption working</h3>
            {totals?.panRequired && <Chip label="Landlord PAN mandatory" tone="warning" />}
            {Number(totals?.panMissingRows ?? 0) > 0 && (
              <Chip label={`${Number(totals.panMissingRows)} period(s) without PAN`} tone="danger" />
            )}
          </div>

          {/* Nil exemption: the reason matters more than the number. */}
          {grantedExemption === 0 && (
            <div className="px-3 py-3 rounded-md bg-warning-light border border-warning/30 text-warning text-sm space-y-1">
              <p className="font-medium flex items-center gap-1.5">
                <AlertTriangle size={15} /> Exemption is nil
              </p>
              {exemption?.reason ? (
                <p className="text-xs leading-relaxed">{String(exemption.reason)}</p>
              ) : caveats.length > 0 ? (
                <ul className="list-disc pl-4 text-xs leading-relaxed space-y-0.5">
                  {caveats.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs">The payload gave no reason for the nil exemption.</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Annual salary (basic + DA)" value={inr(Number(basis?.annualSalaryForHra ?? 0))} hint={basis?.source ? String(basis.source) : null} />
            <StatCard label="Annual HRA received" value={inr(Number(basis?.annualHraReceived ?? 0))} />
            <StatCard label="Annual rent paid" value={inr(Number(totals?.annualRentPaid ?? 0))} />
            <StatCard
              label="Exemption granted"
              value={inr(grantedExemption)}
              intent={grantedExemption > 0 ? 'success' : 'warning'}
            />
          </div>

          {workings.length > 0 && (
            <div className="space-y-3">
              {workings.map((w: any, i: number) => (
                <div key={i} className="rounded-md border border-border-light bg-bg-secondary p-3">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-text-primary text-xs font-medium">
                      {fmtMonth(w?.fromMonth)} → {fmtMonth(w?.toMonth)} ({Number(w?.months ?? 0)} month(s))
                    </span>
                    {w?.city && <Chip label={String(w.city)} />}
                    {w?.isMetro ? <Chip label="Metro" tone="info" /> : <Chip label="Non-metro" />}
                    {w?.panMissing && <Chip label="PAN missing" tone="danger" />}
                  </div>
                  <dl className="font-mono text-xs space-y-1">
                    <Ladder label="Actual HRA received" value={Number(w?.hraReceivedForPeriod ?? 0)} />
                    <Ladder
                      label="Rent paid − 10% of salary"
                      value={Number(w?.rentMinusTenPercentOfSalary ?? 0)}
                      hint={`rent ${inr(Number(w?.rentPaid ?? 0))} − 10% of ${inr(Number(w?.salaryForPeriod ?? 0))}`}
                    />
                    <Ladder
                      label={`${Number(w?.capRatePct ?? 0)}% of salary`}
                      value={Number(w?.percentOfSalaryCap ?? 0)}
                      hint={`on ${inr(Number(w?.salaryForPeriod ?? 0))}`}
                    />
                    <div className="border-t border-border-default pt-1">
                      <Ladder label="Least of the three — exemption" value={Number(w?.exemption ?? 0)} strong />
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          )}

          {exemption?.rule && <p className="text-text-muted text-[11px] leading-relaxed">{String(exemption.rule)}</p>}

          {caveats.length > 0 && grantedExemption > 0 && (
            <ul className="list-disc pl-4 text-text-muted text-[11px] space-y-0.5">
              {caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Ladder({
  label,
  value,
  hint,
  strong = false,
}: {
  label: string;
  value: number;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? 'text-text-primary font-semibold' : 'text-text-secondary'}>
        {label}
        {hint && <span className="text-text-muted ml-1.5">({hint})</span>}
      </dt>
      <dd className={`text-right tabular-nums ${strong ? 'text-text-primary font-semibold' : 'text-text-secondary'}`}>
        {inr(value)}
      </dd>
    </div>
  );
}
