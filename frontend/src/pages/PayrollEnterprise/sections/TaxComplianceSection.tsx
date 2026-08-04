import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AlertTriangle, Plus, RefreshCw, Save, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../../../api/client';
import { payrollAdminApi } from '../../../api/payroll';
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
import { WidgetCard } from '../../HRDashboard/WidgetCard';
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

function declarationTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'VERIFIED':
      return 'success';
    case 'SUBMITTED':
      return 'warning';
    case 'REJECTED':
      return 'danger';
    case 'LOCKED':
      return 'info';
    default:
      return 'default';
  }
}

function proofTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'success';
    case 'SUBMITTED':
      return 'info';
    case 'REJECTED':
      return 'danger';
    default:
      return 'default';
  }
}

/** Indian FY for a date: April → March. */
function currentFy(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function fyOptions(): string[] {
  const base = Number(currentFy().slice(0, 4));
  return [base + 1, base, base - 1, base - 2].map((y) => `${y}-${y + 1}`);
}

const PROOF_STATUSES = ['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED'];

// ---------------------------------------------------------------------------
// Regimes & slabs
// ---------------------------------------------------------------------------

interface SlabForm {
  fromAmount: string;
  toAmount: string;
  ratePct: string;
  surchargePct: string;
  slabOrder: string;
}

function RegimesTab() {
  const [regimes, setRegimes] = useState<any[]>([]);
  const [slabs, setSlabs] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [slabsLoading, setSlabsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ row: any | null; form: SlabForm } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    payrollAdminApi
      .taxRegimes()
      .then((res) => {
        const list = Array.isArray(res) ? res : [];
        setRegimes(list);
        setError(null);
        setSelectedId((prev) => prev ?? (list[0] ? Number(list[0].id) : null));
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadSlabs = useCallback((regimeId: number) => {
    setSlabsLoading(true);
    payrollAdminApi
      .taxSlabs(regimeId)
      .then((res) => setSlabs(Array.isArray(res) ? res : []))
      .catch((err) => {
        setSlabs([]);
        window.alert(reason(err));
      })
      .finally(() => setSlabsLoading(false));
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setSlabs([]);
      return;
    }
    loadSlabs(selectedId);
  }, [selectedId, loadSlabs]);

  const saveSlab = () => {
    if (!editing || selectedId === null) return;
    const f = editing.form;
    const body = {
      regimeId: selectedId,
      fromAmount: num(f.fromAmount) ?? 0,
      toAmount: num(f.toAmount),
      ratePct: num(f.ratePct) ?? 0,
      surchargePct: num(f.surchargePct) ?? 0,
      slabOrder: num(f.slabOrder) ?? slabs.length + 1,
    };
    setSaving(true);
    // payroll.ts exposes reads for slabs only; writes go through the api client.
    const request = editing.row
      ? api.put<any>(`/payroll-admin/tax/slabs/${editing.row.id}`, body)
      : api.post<any>('/payroll-admin/tax/slabs', body);
    request
      .then(() => {
        setEditing(null);
        loadSlabs(selectedId);
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setSaving(false));
  };

  const deleteSlab = (row: any) => {
    if (selectedId === null) return;
    if (!window.confirm('Delete this slab band?')) return;
    api
      .delete<any>(`/payroll-admin/tax/slabs/${row.id}`)
      .then(() => loadSlabs(selectedId))
      .catch((err) => window.alert(reason(err)));
  };

  if (loading && regimes.length === 0) return <LoadingBlock label="Loading tax regimes…" />;
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

  const selected = regimes.find((r) => Number(r.id) === selectedId) ?? null;
  const f = editing?.form;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button className={BTN_SECONDARY} onClick={load}>
          <RefreshCw size={14} className="inline mr-1.5" />
          Refresh
        </button>
      </div>

      {regimes.length === 0 ? (
        <EmptyBlock message="No tax regimes configured" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {regimes.map((r) => {
            const active = Number(r.id) === selectedId;
            return (
              <button
                key={r.id}
                onClick={() => setSelectedId(Number(r.id))}
                className={`text-left rounded-md border p-3 transition-colors ${
                  active ? 'bg-bg-selected border-primary/40' : 'bg-bg-card border-border-default hover:border-primary/30'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary font-medium truncate">{text(r.name)}</p>
                    <p className="text-[11px] text-text-muted font-mono">
                      {text(r.code)} · FY {text(r.financialYear)}
                    </p>
                  </div>
                  {r.isDefault && <Chip label="Default" tone="primary" />}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <span className="text-text-muted">Standard deduction</span>
                  <span className="text-text-secondary font-mono">{money(r.standardDeduction)}</span>
                  <span className="text-text-muted">Rebate</span>
                  <span className="text-text-secondary font-mono">
                    {money(r.rebateAmount)}
                    {num(r.rebateLimit) !== null ? ` up to ${money(r.rebateLimit)}` : ''}
                  </span>
                  <span className="text-text-muted">Cess</span>
                  <span className="text-text-secondary font-mono">{num(r.cessPct) ?? '—'}%</span>
                  <span className="text-text-muted">Exemptions</span>
                  <span className="text-text-secondary">{r.allowsExemptions ? 'Allowed' : 'Not allowed'}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <WidgetCard
          title={`Slab ladder — ${text(selected.name)}`}
          subtitle={`FY ${text(selected.financialYear)}`}
          actions={
            <button
              className={BTN_SECONDARY}
              onClick={() =>
                setEditing({
                  row: null,
                  form: {
                    fromAmount: '',
                    toAmount: '',
                    ratePct: '',
                    surchargePct: '0',
                    slabOrder: String(slabs.length + 1),
                  },
                })
              }
            >
              <Plus size={14} className="inline mr-1.5" />
              Add slab
            </button>
          }
        >
          {slabsLoading ? (
            <LoadingBlock label="Loading slabs…" />
          ) : slabs.length === 0 ? (
            <EmptyBlock message="This regime has no slab bands" />
          ) : (
            <TableShell headers={['#', 'From', 'To', 'Rate', 'Surcharge', '']}>
              {slabs.map((s) => (
                <tr key={s.id} className="hover:bg-bg-hover">
                  <td className="px-3 py-2 text-xs text-text-muted tabular-nums">{num(s.slabOrder) ?? '—'}</td>
                  <td className="px-3 py-2 text-xs font-mono text-text-secondary text-right">{money(s.fromAmount)}</td>
                  <td className="px-3 py-2 text-xs font-mono text-text-secondary text-right">
                    {num(s.toAmount) === null ? 'and above' : money(s.toAmount)}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-right text-text-primary font-semibold">
                    {num(s.ratePct) ?? '—'}%
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-right text-text-secondary">
                    {num(s.surchargePct) ?? 0}%
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-primary text-[11px] px-2"
                        onClick={() =>
                          setEditing({
                            row: s,
                            form: {
                              fromAmount: String(num(s.fromAmount) ?? ''),
                              toAmount: num(s.toAmount) === null ? '' : String(s.toAmount),
                              ratePct: String(num(s.ratePct) ?? ''),
                              surchargePct: String(num(s.surchargePct) ?? 0),
                              slabOrder: String(num(s.slabOrder) ?? ''),
                            },
                          })
                        }
                      >
                        Edit
                      </button>
                      <button
                        className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-danger"
                        title="Delete slab"
                        onClick={() => deleteSlab(s)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </WidgetCard>
      )}

      <AnimatePresence>
        {editing && f && (
          <ModalShell
            title={editing.row ? 'Edit slab band' : 'Add slab band'}
            subtitle="Bands must be ascending, contiguous and non-overlapping"
            onClose={() => setEditing(null)}
            maxWidth="max-w-lg"
            footer={
              <div className="flex items-center justify-end gap-2">
                <button className={BTN_SECONDARY} onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className={BTN_PRIMARY} disabled={saving} onClick={saveSlab}>
                  {saving ? 'Saving…' : 'Save slab'}
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>From (₹)</label>
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.fromAmount}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, fromAmount: e.target.value } })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>To (₹, blank = no ceiling)</label>
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.toAmount}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, toAmount: e.target.value } })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Rate (%)</label>
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.ratePct}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, ratePct: e.target.value } })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Surcharge (%)</label>
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.surchargePct}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, surchargePct: e.target.value } })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Order</label>
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.slabOrder}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, slabOrder: e.target.value } })}
                />
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Employee + FY selector, shared by three tabs
// ---------------------------------------------------------------------------

function EmployeeFySelector({
  employeeId,
  fy,
  onEmployee,
  onFy,
  right,
}: {
  employeeId: number | null;
  fy: string;
  onEmployee: (id: number | null) => void;
  onFy: (fy: string) => void;
  right?: React.ReactNode;
}) {
  const { employees } = useApp();
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className={LABEL_CLS}>Employee</label>
          <select
            className={`${INPUT_CLS} w-auto min-w-56`}
            value={employeeId === null ? '' : String(employeeId)}
            onChange={(e) => onEmployee(num(e.target.value))}
          >
            <option value="">Select…</option>
            {employees.map((e) => (
              <option key={e.id} value={String(e.id)}>
                {e.fullName} ({e.empCode})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Financial year</label>
          <select className={`${INPUT_CLS} w-auto`} value={fy} onChange={(e) => onFy(e.target.value)}>
            {fyOptions().map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

function VerifyModal({
  declaration,
  onClose,
  onDone,
}: {
  declaration: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const items: any[] = (declaration?.items ?? []) as any[];
  const [decisions, setDecisions] = useState<Record<string, { approvedAmount: string; proofStatus: string }>>(() => {
    const seed: Record<string, { approvedAmount: string; proofStatus: string }> = {};
    for (const item of items) {
      seed[String(item.id ?? item.sectionId)] = {
        approvedAmount: String(num(item.approvedAmount) ?? num(item.declaredAmount) ?? 0),
        proofStatus: String(item.proofStatus ?? 'PENDING'),
      };
    }
    return seed;
  });
  const [busy, setBusy] = useState(false);

  const submit = () => {
    const payload = items
      .filter((item) => item.id !== null && item.id !== undefined)
      .map((item) => {
        const d = decisions[String(item.id)];
        return {
          itemId: Number(item.id),
          approvedAmount: num(d?.approvedAmount) ?? 0,
          proofStatus: d?.proofStatus ?? 'PENDING',
        };
      });
    if (payload.length === 0) {
      window.alert('There are no saved declaration items to verify. Save the declaration first.');
      return;
    }
    setBusy(true);
    payrollAdminApi
      .verifyDeclaration(Number(declaration.id), payload)
      .then(() => onDone())
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title="Verify declaration"
      subtitle="Set the approved amount and proof status for each section"
      onClose={onClose}
      maxWidth="max-w-3xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button className={BTN_PRIMARY} disabled={busy} onClick={submit}>
            {busy ? 'Verifying…' : 'Save verification'}
          </button>
        </div>
      }
    >
      <TableShell headers={['Section', 'Declared', 'Max limit', 'Approved', 'Proof status']}>
        {items.map((item) => {
          const key = String(item.id ?? item.sectionId);
          const d = decisions[key];
          return (
            <tr key={key}>
              <td className="px-3 py-2 text-xs text-text-primary">
                <span className="font-mono">{text(item.sectionCode)}</span> {text(item.sectionName)}
              </td>
              <td className="px-3 py-2 text-xs font-mono text-right text-text-secondary">
                {money(item.declaredAmount)}
              </td>
              <td className="px-3 py-2 text-xs font-mono text-right text-text-muted">
                {num(item.maxLimit) === null ? 'none' : money(item.maxLimit)}
              </td>
              <td className="px-3 py-2 w-32">
                <input
                  className={`${INPUT_CLS} text-xs py-1.5 text-right font-mono`}
                  type="number"
                  value={d?.approvedAmount ?? ''}
                  onChange={(e) =>
                    setDecisions({
                      ...decisions,
                      [key]: { approvedAmount: e.target.value, proofStatus: d?.proofStatus ?? 'PENDING' },
                    })
                  }
                />
              </td>
              <td className="px-3 py-2 w-36">
                <select
                  className={`${INPUT_CLS} text-xs py-1.5`}
                  value={d?.proofStatus ?? 'PENDING'}
                  onChange={(e) =>
                    setDecisions({
                      ...decisions,
                      [key]: { approvedAmount: d?.approvedAmount ?? '0', proofStatus: e.target.value },
                    })
                  }
                >
                  {PROOF_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {prettyEnum(s)}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          );
        })}
      </TableShell>
    </ModalShell>
  );
}

function DeclarationsTab({ employeeId, fy, onEmployee, onFy }: {
  employeeId: number | null;
  fy: string;
  onEmployee: (id: number | null) => void;
  onFy: (fy: string) => void;
}) {
  const [declaration, setDeclaration] = useState<any | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { declaredAmount: string; proofAmount: string }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(() => {
    if (employeeId === null) {
      setDeclaration(null);
      return;
    }
    setLoading(true);
    payrollAdminApi
      .declaration(employeeId, fy)
      .then((res) => {
        setDeclaration(res ?? null);
        const seed: Record<string, { declaredAmount: string; proofAmount: string }> = {};
        for (const item of ((res?.items ?? []) as any[])) {
          seed[String(item.sectionId)] = {
            declaredAmount: String(num(item.declaredAmount) ?? 0),
            proofAmount: String(num(item.proofAmount) ?? 0),
          };
        }
        setDrafts(seed);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [employeeId, fy]);

  useEffect(() => {
    load();
  }, [load]);

  const locked = String(declaration?.status ?? '').toUpperCase() === 'LOCKED';
  const items: any[] = (declaration?.items ?? []) as any[];

  const save = () => {
    if (employeeId === null) return;
    setBusy(true);
    payrollAdminApi
      .saveDeclaration(employeeId, fy, {
        regimeId: declaration?.regimeId ?? null,
        items: items.map((item) => ({
          sectionId: item.sectionId,
          declaredAmount: num(drafts[String(item.sectionId)]?.declaredAmount) ?? 0,
          proofAmount: num(drafts[String(item.sectionId)]?.proofAmount) ?? 0,
        })),
      })
      .then(() => load())
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  const submit = () => {
    if (!declaration?.id) {
      window.alert('Save the declaration before submitting it.');
      return;
    }
    setBusy(true);
    payrollAdminApi
      .submitDeclaration(Number(declaration.id))
      .then(() => load())
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-4">
      <EmployeeFySelector
        employeeId={employeeId}
        fy={fy}
        onEmployee={onEmployee}
        onFy={onFy}
        right={
          <>
            <button className={BTN_SECONDARY} onClick={load} disabled={employeeId === null}>
              <RefreshCw size={14} className="inline mr-1.5" />
              Refresh
            </button>
            <button className={BTN_SECONDARY} disabled={busy || locked || employeeId === null} onClick={save}>
              <Save size={14} className="inline mr-1.5" />
              Save
            </button>
            <button className={BTN_SECONDARY} disabled={busy || locked || !declaration?.id} onClick={submit}>
              <Send size={14} className="inline mr-1.5" />
              Submit
            </button>
            <button
              className={BTN_PRIMARY}
              disabled={busy || !declaration?.id}
              onClick={() => setVerifying(true)}
            >
              <ShieldCheck size={14} className="inline mr-1.5" />
              Verify
            </button>
          </>
        }
      />

      {employeeId === null && <EmptyBlock message="Pick an employee to see their declaration" />}
      {loading && <LoadingBlock label="Loading declaration…" />}
      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && declaration && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Chip label={prettyEnum(declaration.status)} tone={declarationTone(declaration.status)} dot />
            {declaration.regimeCode && <Chip label={String(declaration.regimeCode)} tone="primary" />}
            {declaration.isDraftShell && <Chip label="Not yet saved" tone="warning" />}
            {locked && <span className="text-[11px] text-text-muted">Locked — items can no longer be edited.</span>}
            <span className="text-[11px] text-text-muted">
              Declared {money(declaration.totalDeclared)} · approved {money(declaration.totalApproved)}
            </span>
          </div>

          {items.length === 0 ? (
            <EmptyBlock message="No declarable sections configured" />
          ) : (
            <TableShell headers={['Section', 'Max limit', 'Declared', 'Proof', 'Approved', 'Proof status']}>
              {items.map((item) => {
                const key = String(item.sectionId);
                const draft = drafts[key];
                const declared = num(draft?.declaredAmount) ?? 0;
                const maxLimit = num(item.maxLimit);
                const over = maxLimit !== null && declared > maxLimit;
                return (
                  <tr key={key} className="hover:bg-bg-hover">
                    <td className="px-3 py-2 text-xs text-text-primary">
                      <span className="font-mono">{text(item.sectionCode)}</span> {text(item.sectionName)}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-right text-text-muted">
                      {maxLimit === null ? 'none' : money(maxLimit)}
                    </td>
                    <td className="px-3 py-2 w-32">
                      <input
                        className={`${INPUT_CLS} text-xs py-1.5 text-right font-mono`}
                        type="number"
                        disabled={locked}
                        value={draft?.declaredAmount ?? ''}
                        onChange={(e) =>
                          setDrafts({
                            ...drafts,
                            [key]: { declaredAmount: e.target.value, proofAmount: draft?.proofAmount ?? '0' },
                          })
                        }
                      />
                      {over && (
                        <p className="text-warning text-[10px] mt-1">
                          <AlertTriangle size={10} className="inline mr-1" />
                          Exceeds the {money(maxLimit)} limit
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 w-32">
                      <input
                        className={`${INPUT_CLS} text-xs py-1.5 text-right font-mono`}
                        type="number"
                        disabled={locked}
                        value={draft?.proofAmount ?? ''}
                        onChange={(e) =>
                          setDrafts({
                            ...drafts,
                            [key]: { declaredAmount: draft?.declaredAmount ?? '0', proofAmount: e.target.value },
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-right text-success">
                      {money(item.approvedAmount)}
                    </td>
                    <td className="px-3 py-2">
                      <Chip label={prettyEnum(item.proofStatus)} tone={proofTone(item.proofStatus)} />
                    </td>
                  </tr>
                );
              })}
            </TableShell>
          )}
        </>
      )}

      <AnimatePresence>
        {verifying && declaration && (
          <VerifyModal
            declaration={declaration}
            onClose={() => setVerifying(false)}
            onDone={() => {
              setVerifying(false);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

function LadderRow({
  label,
  value,
  strong = false,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
  tone?: 'success' | 'danger';
}) {
  const valueTone = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-text-primary';
  return (
    <div
      className={`flex items-center justify-between gap-4 px-3 py-1.5 ${
        strong ? 'border-t border-border-default font-semibold' : ''
      }`}
    >
      <span className={`text-xs ${strong ? 'text-text-primary' : 'text-text-secondary'}`}>{label}</span>
      <span className={`text-xs font-mono text-right tabular-nums ${valueTone}`}>{value}</span>
    </div>
  );
}

function ComputationTab({ employeeId, fy, onEmployee, onFy }: {
  employeeId: number | null;
  fy: string;
  onEmployee: (id: number | null) => void;
  onFy: (fy: string) => void;
}) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (employeeId === null) {
      setData(null);
      return;
    }
    setLoading(true);
    payrollAdminApi
      .computation(employeeId, fy)
      .then((res) => {
        setData(res ?? null);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [employeeId, fy]);

  useEffect(() => {
    load();
  }, [load]);

  const recompute = () => {
    if (employeeId === null) return;
    setBusy(true);
    payrollAdminApi
      .recomputeTax(employeeId, fy)
      .then(() => load())
      .catch((err) => window.alert(reason(err)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-4">
      <EmployeeFySelector
        employeeId={employeeId}
        fy={fy}
        onEmployee={onEmployee}
        onFy={onFy}
        right={
          <button className={BTN_PRIMARY} disabled={busy || employeeId === null} onClick={recompute}>
            <RefreshCw size={14} className="inline mr-1.5" />
            {busy ? 'Recomputing…' : 'Recompute'}
          </button>
        }
      />

      {employeeId === null && <EmptyBlock message="Pick an employee to see their tax working" />}
      {loading && <LoadingBlock label="Loading computation…" />}
      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <WidgetCard
          title="Annual tax working"
          subtitle={`FY ${text(data.financialYear)}${data.regimeCode ? ` · ${data.regimeCode}` : ''}`}
        >
          <div className="rounded-md border border-border-default divide-y divide-border-light">
            <LadderRow label="Gross annual" value={money(data.grossAnnual)} />
            <LadderRow label="Exemptions" value={money(data.exemptions)} />
            <LadderRow label="Standard deduction" value={money(data.standardDeduction)} />
            <LadderRow label="Chapter VI-A deductions" value={money(data.chapterViaDeductions)} />
            <LadderRow label="Taxable income" value={money(data.taxableIncome)} strong />
            <LadderRow label="Tax before rebate" value={money(data.taxBeforeRebate)} />
            <LadderRow label="Rebate" value={money(data.rebate)} tone="success" />
            <LadderRow label="Surcharge" value={money(data.surcharge)} />
            <LadderRow label="Cess" value={money(data.cess)} />
            <LadderRow label="Total tax" value={money(data.totalTax)} strong />
            <LadderRow label="Paid to date" value={money(data.taxPaidToDate)} tone="success" />
            <LadderRow label="Remaining" value={money(data.remainingTax)} tone="danger" />
            <LadderRow
              label={`Monthly TDS (${num(data.monthsRemaining) ?? '—'} months remaining)`}
              value={money(data.monthlyTds)}
              strong
            />
          </div>
          <p className="text-[11px] text-text-muted mt-3">
            The projection assumes the current monthly gross continues for the remaining months of the year.
            {data.computedAt ? ` Last computed ${fmtDate(data.computedAt)}.` : ''}
          </p>
        </WidgetCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

function ComplianceTab() {
  const { salaryPeriods } = useApp();
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (periodId === null && salaryPeriods.length > 0) setPeriodId(salaryPeriods[0]!.id);
  }, [salaryPeriods, periodId]);

  const load = useCallback(() => {
    if (periodId === null) return;
    setLoading(true);
    payrollAdminApi
      .compliance(periodId)
      .then((res) => {
        setData(res ?? null);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [periodId]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = data?.totals ?? {};
  const missing = data?.missingData ?? {};
  const blockers: string[] = (data?.filingBlockers ?? []) as string[];

  const missingRows: { label: string; value: number | null }[] = [
    { label: 'Missing UAN', value: num(missing.missingUan) },
    { label: 'Missing ESIC', value: num(missing.missingEsic) },
    { label: 'Missing PAN', value: num(missing.missingPan) },
    { label: 'Missing bank details', value: num(missing.missingBank) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <label className={LABEL_CLS}>Salary period</label>
          <select
            className={`${INPUT_CLS} w-auto min-w-56`}
            value={periodId === null ? '' : String(periodId)}
            onChange={(e) => setPeriodId(num(e.target.value))}
          >
            <option value="">Select…</option>
            {salaryPeriods.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <button className={BTN_SECONDARY} onClick={load} disabled={periodId === null}>
          <RefreshCw size={14} className="inline mr-1.5" />
          Refresh
        </button>
      </div>

      {periodId === null && <EmptyBlock message="Pick a period to see its statutory position" />}
      {loading && <LoadingBlock label="Loading compliance…" />}
      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="PF total" value={money(totals.pfTotal)} hint={`Employee ${money(totals.pfEmployee)}`} />
            <StatCard label="ESI total" value={money(totals.esiTotal)} hint={`Employee ${money(totals.esiEmployee)}`} />
            <StatCard label="Professional tax" value={money(totals.professionalTax)} />
            <StatCard label="TDS" value={money(totals.tds)} />
          </div>

          <WidgetCard
            title="Filing readiness"
            subtitle={
              data.readyToFile
                ? 'No blockers — the statutory data is complete'
                : 'These gaps block a filing until they are fixed'
            }
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {missingRows.map((row) => (
                <div key={row.label} className="rounded-md border border-border-default p-3">
                  <p className="text-text-muted text-[10px] uppercase tracking-wider mb-1">{row.label}</p>
                  <Chip
                    label={row.value === null ? '—' : String(row.value)}
                    tone={row.value !== null && row.value > 0 ? 'danger' : 'success'}
                  />
                </div>
              ))}
            </div>
            {blockers.length > 0 && (
              <ul className="mt-3 space-y-1">
                {blockers.map((b, i) => (
                  <li key={i} className="text-danger text-xs">
                    <AlertTriangle size={12} className="inline mr-1.5" />
                    {b}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-text-muted mt-3">
              Grand total payable to the authorities: <span className="font-mono">{money(totals.grandTotal)}</span> across{' '}
              {num(data?.coverage?.employeesProcessed) ?? '—'} employees.
            </p>
          </WidgetCard>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form 16
// ---------------------------------------------------------------------------

function Form16Tab({ employeeId, fy, onEmployee, onFy }: {
  employeeId: number | null;
  fy: string;
  onEmployee: (id: number | null) => void;
  onFy: (fy: string) => void;
}) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (employeeId === null) {
      setData(null);
      return;
    }
    setLoading(true);
    payrollAdminApi
      .form16(employeeId, fy)
      .then((res) => {
        setData(res ?? null);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [employeeId, fy]);

  useEffect(() => {
    load();
  }, [load]);

  const partB = data?.partB ?? {};
  const quarterly: any[] = (data?.quarterlyTds ?? []) as any[];
  const breakup: any[] = (data?.deductionBreakup ?? []) as any[];

  return (
    <div className="space-y-4">
      <EmployeeFySelector
        employeeId={employeeId}
        fy={fy}
        onEmployee={onEmployee}
        onFy={onFy}
        right={
          <button className={BTN_SECONDARY} onClick={load} disabled={employeeId === null}>
            <RefreshCw size={14} className="inline mr-1.5" />
            Refresh
          </button>
        }
      />

      {employeeId === null && <EmptyBlock message="Pick an employee to see their Part B figures" />}
      {loading && <LoadingBlock label="Loading Form 16 data…" />}
      {error && (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button className={BTN_SECONDARY} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.disclaimer && (
            <div className="rounded-md bg-warning-light border border-warning/30 p-4">
              <p className="text-warning text-sm font-semibold mb-1">
                <AlertTriangle size={16} className="inline mr-1.5" />
                Not a statutory Form 16
              </p>
              <p className="text-warning text-xs">{String(data.disclaimer)}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <WidgetCard
              title="Part B figures"
              subtitle={`${text(data?.employee?.fullName)} · PAN ${text(data?.employee?.pan)} · ${text(data.regime)}`}
            >
              <div className="rounded-md border border-border-default divide-y divide-border-light">
                <LadderRow label="Gross salary" value={money(partB.grossSalary)} />
                <LadderRow label="Bonus and variable" value={money(partB.bonusAndVariable)} />
                <LadderRow label="Arrears" value={money(partB.arrears)} />
                <LadderRow label="Exemptions" value={money(partB.exemptions)} />
                <LadderRow label="Standard deduction" value={money(partB.standardDeduction)} />
                <LadderRow label="Professional tax" value={money(partB.professionalTax)} />
                <LadderRow label="Chapter VI-A deductions" value={money(partB.chapterViaDeductions)} />
                <LadderRow label="Taxable income" value={money(partB.taxableIncome)} strong />
                <LadderRow label="Tax payable" value={money(partB.taxPayable)} />
                <LadderRow label="Rebate" value={money(partB.rebate)} tone="success" />
                <LadderRow label="Surcharge" value={money(partB.surcharge)} />
                <LadderRow label="Cess" value={money(partB.cess)} />
                <LadderRow label="Total tax" value={money(partB.totalTax)} strong />
                <LadderRow label="TDS deducted" value={money(partB.tdsDeducted)} tone="success" />
                <LadderRow label="Balance payable" value={money(partB.balancePayable)} strong tone="danger" />
              </div>
            </WidgetCard>

            <div className="space-y-4">
              <WidgetCard title="Quarterly TDS" subtitle="From the salary lines in this financial year">
                {quarterly.length === 0 ? (
                  <EmptyBlock message="No salary lines in this financial year" />
                ) : (
                  <TableShell headers={['Period', 'From', 'To', 'Gross', 'TDS']}>
                    {quarterly.map((q, i) => (
                      <tr key={i} className="hover:bg-bg-hover">
                        <td className="px-3 py-2 text-xs text-text-primary">{text(q.period)}</td>
                        <td className="px-3 py-2 text-xs text-text-secondary">{fmtDate(q.from)}</td>
                        <td className="px-3 py-2 text-xs text-text-secondary">{fmtDate(q.to)}</td>
                        <td className="px-3 py-2 text-xs font-mono text-right text-text-secondary">{money(q.gross)}</td>
                        <td className="px-3 py-2 text-xs font-mono text-right text-text-primary">{money(q.tds)}</td>
                      </tr>
                    ))}
                  </TableShell>
                )}
              </WidgetCard>

              <WidgetCard title="Deduction breakup" subtitle="Chapter VI-A sections declared and approved">
                {breakup.length === 0 ? (
                  <EmptyBlock message="No deductions declared" />
                ) : (
                  <TableShell headers={['Section', 'Declared', 'Approved']}>
                    {breakup.map((d, i) => (
                      <tr key={i} className="hover:bg-bg-hover">
                        <td className="px-3 py-2 text-xs text-text-primary">
                          <span className="font-mono">{text(d.code)}</span> {text(d.name)}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-right text-text-secondary">
                          {money(d.declared)}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-right text-success">{money(d.approved)}</td>
                      </tr>
                    ))}
                  </TableShell>
                )}
              </WidgetCard>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function TaxComplianceSection() {
  const { employees } = useApp();
  const [tab, setTab] = useState('regimes');
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [fy, setFy] = useState(currentFy());

  const firstEmployeeId = useMemo(() => (employees[0] ? employees[0].id : null), [employees]);

  useEffect(() => {
    if (employeeId === null && firstEmployeeId !== null) setEmployeeId(firstEmployeeId);
  }, [firstEmployeeId, employeeId]);

  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { id: 'regimes', label: 'Regimes & slabs' },
          { id: 'declarations', label: 'Declarations' },
          { id: 'computation', label: 'Computation' },
          { id: 'compliance', label: 'Compliance' },
          { id: 'form16', label: 'Form 16' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'regimes' && <RegimesTab />}
      {tab === 'declarations' && (
        <DeclarationsTab employeeId={employeeId} fy={fy} onEmployee={setEmployeeId} onFy={setFy} />
      )}
      {tab === 'computation' && (
        <ComputationTab employeeId={employeeId} fy={fy} onEmployee={setEmployeeId} onFy={setFy} />
      )}
      {tab === 'compliance' && <ComplianceTab />}
      {tab === 'form16' && <Form16Tab employeeId={employeeId} fy={fy} onEmployee={setEmployeeId} onFy={setFy} />}
    </div>
  );
}
