import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Plus, RefreshCw, Search, TrendingDown, TrendingUp, X } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { compensationApi } from '../../../api/payroll';
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

function revisionTone(status: unknown): Tone {
  switch (String(status ?? '').toUpperCase()) {
    case 'ACTIVE':
    case 'APPROVED':
      return 'success';
    case 'PENDING_APPROVAL':
      return 'warning';
    case 'REJECTED':
      return 'danger';
    case 'SUPERSEDED':
      return 'default';
    default:
      return 'info';
  }
}

const REVISION_TYPES = [
  'INITIAL', 'INCREMENT', 'PROMOTION', 'ANNUAL_REVISION', 'MARKET_ADJUSTMENT', 'SPECIAL', 'CORRECTION',
];

const TODAY = new Date().toISOString().slice(0, 10);

function typeTone(componentType: unknown): Tone {
  switch (String(componentType ?? '').toUpperCase()) {
    case 'EARNING':
      return 'success';
    case 'DEDUCTION':
      return 'danger';
    case 'EMPLOYER_CONTRIBUTION':
      return 'info';
    default:
      return 'default';
  }
}

// ---------------------------------------------------------------------------
// Employee picker
// ---------------------------------------------------------------------------

function EmployeePicker({
  employees,
  selectedId,
  onSelect,
}: {
  employees: { id: number; fullName: string; empCode: string }[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? employees.filter(
          (e) => e.fullName.toLowerCase().includes(q) || String(e.empCode).toLowerCase().includes(q),
        )
      : employees;
    return list.slice(0, 60);
  }, [employees, query]);

  return (
    <div className="bg-bg-card border border-border-default rounded-md">
      <div className="p-3 border-b border-border-default">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className={`${INPUT_CLS} pl-8`}
            placeholder="Search employee…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto scrollbar-thin divide-y divide-border-light">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-muted">No employee matches that search.</p>
        ) : (
          filtered.map((e) => (
            <button
              key={e.id}
              onClick={() => onSelect(e.id)}
              className={`w-full text-left px-3 py-2 transition-colors ${
                e.id === selectedId ? 'bg-bg-selected' : 'hover:bg-bg-hover'
              }`}
            >
              <p className="text-xs text-text-primary truncate">{e.fullName}</p>
              <p className="text-[10px] text-text-muted font-mono">{e.empCode}</p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New revision panel
// ---------------------------------------------------------------------------

interface RevisionForm {
  structureId: string;
  annualCtc: string;
  effectiveFrom: string;
  revisionType: string;
  revisionReason: string;
}

function NewRevisionPanel({
  employeeId,
  employeeName,
  structures,
  currentCtc,
  onClose,
  onSaved,
}: {
  employeeId: number;
  employeeName: string;
  structures: any[];
  currentCtc: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RevisionForm>({
    structureId: structures[0] ? String(structures[0].id) : '',
    annualCtc: currentCtc === null ? '' : String(currentCtc),
    effectiveFrom: TODAY,
    revisionType: 'INCREMENT',
    revisionReason: '',
  });
  const [preview, setPreview] = useState<any | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const structureId = num(form.structureId);
  const ctc = num(form.annualCtc);

  // Live preview of the split, debounced so typing a CTC does not spam the API.
  useEffect(() => {
    if (structureId === null || ctc === null || ctc <= 0) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const timer = window.setTimeout(() => {
      compensationApi
        .previewStructure(structureId, ctc)
        .then((res) => {
          if (cancelled) return;
          setPreview(res ?? null);
          setPreviewError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setPreview(null);
          setPreviewError(reason(err));
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [structureId, ctc]);

  const save = () => {
    if (ctc === null || ctc <= 0) {
      window.alert('Enter an annual CTC greater than zero');
      return;
    }
    setSaving(true);
    compensationApi
      .createRevision(employeeId, {
        structureId,
        annualCtc: ctc,
        effectiveFrom: form.effectiveFrom,
        revisionType: form.revisionType,
        revisionReason: form.revisionReason.trim() || null,
      })
      .then(() => onSaved())
      .catch((err) => window.alert(reason(err)))
      .finally(() => setSaving(false));
  };

  const rows: any[] = [
    ...((preview?.earnings ?? []) as any[]),
    ...((preview?.deductions ?? []) as any[]),
    ...((preview?.employerContributions ?? []) as any[]),
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex justify-end"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <motion.div
        initial={{ x: 460 }}
        animate={{ x: 0 }}
        exit={{ x: 460 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="relative bg-bg-card border-l border-border-default w-full max-w-lg h-full flex flex-col shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border-default flex items-start justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-text-primary font-semibold text-sm">New salary revision</h3>
            <p className="text-text-muted text-[11px] truncate">{employeeName}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text-primary">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
          <div>
            <label className={LABEL_CLS}>Salary structure</label>
            <select
              className={INPUT_CLS}
              value={form.structureId}
              onChange={(e) => setForm({ ...form, structureId: e.target.value })}
            >
              <option value="">No structure</option>
              {structures.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Annual CTC (₹)</label>
              <input
                className={INPUT_CLS}
                type="number"
                value={form.annualCtc}
                onChange={(e) => setForm({ ...form, annualCtc: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Effective from</label>
              <input
                className={INPUT_CLS}
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Revision type</label>
            <select
              className={INPUT_CLS}
              value={form.revisionType}
              onChange={(e) => setForm({ ...form, revisionType: e.target.value })}
            >
              {REVISION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {prettyEnum(t)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_CLS}>Reason</label>
            <textarea
              className={`${INPUT_CLS} h-20`}
              value={form.revisionReason}
              onChange={(e) => setForm({ ...form, revisionReason: e.target.value })}
            />
          </div>

          {currentCtc !== null && ctc !== null && currentCtc > 0 && (
            <p className="text-xs text-text-secondary">
              Change from {inr(currentCtc)}:{' '}
              <span className={ctc >= currentCtc ? 'text-success' : 'text-danger'}>
                {ctc >= currentCtc ? '+' : ''}
                {(((ctc - currentCtc) / currentCtc) * 100).toFixed(1)}%
              </span>
            </p>
          )}

          <div className="pt-3 border-t border-border-light">
            <p className="text-text-primary text-xs font-semibold uppercase tracking-wider mb-2">
              Component preview
            </p>
            {previewing && <p className="text-text-muted text-xs">Calculating…</p>}
            {previewError && <ErrorBlock message={previewError} />}
            {!previewing && !previewError && rows.length === 0 && (
              <p className="text-text-muted text-xs">
                Pick a structure and a CTC to see how it splits into components.
              </p>
            )}
            {rows.length > 0 && (
              <>
                {((preview?.warnings ?? []) as string[]).map((w, i) => (
                  <p key={i} className="text-warning text-[11px] mb-1">
                    • {w}
                  </p>
                ))}
                <TableShell headers={['Component', 'Type', 'Monthly', 'Annual']}>
                  {rows.map((c: any, i: number) => (
                    <tr key={`${c.componentId}-${i}`}>
                      <td className="px-3 py-1.5 text-xs text-text-primary">
                        <span className="font-mono">{text(c.code)}</span> {text(c.name)}
                      </td>
                      <td className="px-3 py-1.5">
                        <Chip label={prettyEnum(c.componentType)} tone={typeTone(c.componentType)} />
                      </td>
                      <td className="px-3 py-1.5 text-xs font-mono text-right text-text-primary">
                        {money(c.monthlyAmount)}
                      </td>
                      <td className="px-3 py-1.5 text-xs font-mono text-right text-text-secondary">
                        {money(c.annualAmount)}
                      </td>
                    </tr>
                  ))}
                </TableShell>
                <p className="text-[11px] text-text-muted mt-2">
                  Monthly gross {money(preview?.monthlyGross)} · net {money(preview?.monthlyNet)} · employer cost{' '}
                  {money(preview?.monthlyEmployerCost)}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border-default bg-bg-secondary flex items-center justify-end gap-2 flex-shrink-0">
          <button className={BTN_SECONDARY} onClick={onClose}>
            Cancel
          </button>
          <button className={BTN_PRIMARY} disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save revision'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function CompensationSection() {
  const { employees } = useApp();

  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [salary, setSalary] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [structures, setStructures] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    compensationApi
      .structures({ isActive: true })
      .then((res) => setStructures(Array.isArray(res) ? res : []))
      .catch(() => setStructures([]));
  }, []);

  useEffect(() => {
    if (employeeId === null && employees.length > 0) setEmployeeId(employees[0]!.id);
  }, [employees, employeeId]);

  const load = useCallback(() => {
    if (employeeId === null) return;
    setLoading(true);
    Promise.all([
      compensationApi.employeeSalary(employeeId).catch(() => null),
      compensationApi.salaryHistory(employeeId),
    ])
      .then(([current, rows]) => {
        setSalary(current ?? null);
        setHistory(Array.isArray(rows) ? rows : []);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => {
        setLoading(false);
        setFirstLoad(false);
      });
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedEmployee = employees.find((e) => e.id === employeeId) ?? null;

  const decide = (row: any, approve: boolean) => {
    const request = approve
      ? compensationApi.approveRevision(Number(row.id))
      : compensationApi.rejectRevision(Number(row.id), window.prompt('Rejection reason') ?? '');
    request
      .then(() => load())
      .catch((err) => window.alert(reason(err)));
  };

  // Oldest → newest so the chart reads left to right.
  const chartData = useMemo(
    () =>
      [...history]
        .filter((h) => num(h.annualCtc) !== null)
        .sort((a, b) => String(a.effectiveFrom ?? '').localeCompare(String(b.effectiveFrom ?? '')))
        .map((h) => ({
          date: String(h.effectiveFrom ?? '').slice(0, 10),
          ctc: num(h.annualCtc) ?? 0,
        })),
    [history],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-1">
          <EmployeePicker
            employees={employees}
            selectedId={employeeId}
            onSelect={(id) => setEmployeeId(id)}
          />
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-text-primary text-sm font-semibold truncate">
                {selectedEmployee ? selectedEmployee.fullName : 'Select an employee'}
              </h3>
              {selectedEmployee && (
                <p className="text-text-muted text-[11px] font-mono">{selectedEmployee.empCode}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button className={BTN_SECONDARY} onClick={load} disabled={employeeId === null}>
                <RefreshCw size={14} className="inline mr-1.5" />
                Refresh
              </button>
              <button className={BTN_PRIMARY} disabled={employeeId === null} onClick={() => setPanelOpen(true)}>
                <Plus size={14} className="inline mr-1.5" />
                New revision
              </button>
            </div>
          </div>

          {loading && firstLoad && <LoadingBlock label="Loading compensation…" />}

          {error && (
            <div className="space-y-3">
              <ErrorBlock message={error} />
              <button className={BTN_SECONDARY} onClick={load}>
                Retry
              </button>
            </div>
          )}

          {!error && !firstLoad && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Annual CTC" value={money(salary?.annualCtc)} />
                <StatCard label="Monthly gross" value={money(salary?.monthlyGross)} />
                <StatCard
                  label="Structure"
                  value={<span className="text-base">{text(salary?.structureCode)}</span>}
                  hint={salary?.structureName ? String(salary.structureName) : null}
                />
                <StatCard
                  label="Effective from"
                  value={<span className="text-base">{fmtDate(salary?.effectiveFrom)}</span>}
                  hint={salary?.status ? prettyEnum(salary.status) : null}
                />
              </div>

              {salary?.status && (
                <div className="flex items-center gap-2">
                  <Chip label={prettyEnum(salary.status)} tone={revisionTone(salary.status)} dot />
                  {salary.revisionType && <Chip label={prettyEnum(salary.revisionType)} />}
                </div>
              )}

              {chartData.length >= 2 && (
                <WidgetCard title="CTC over time" subtitle="Annual cost to company at each revision">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                          stroke="var(--color-border-default)"
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                          stroke="var(--color-border-default)"
                          tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                        />
                        <Tooltip
                          contentStyle={{
                            background: 'var(--color-bg-card)',
                            border: '1px solid var(--color-border-default)',
                            borderRadius: 8,
                            fontSize: 12,
                            color: 'var(--color-text-primary)',
                          }}
                          formatter={(v: any) => inr(Number(v))}
                        />
                        <Line
                          type="monotone"
                          dataKey="ctc"
                          stroke="var(--color-primary)"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </WidgetCard>
              )}

              <WidgetCard title="Revision history" subtitle={`${history.length} revision(s) on record`}>
                {history.length === 0 ? (
                  <EmptyBlock message="No salary revisions recorded for this employee" />
                ) : (
                  <ol className="relative border-l border-border-default ml-2 space-y-4">
                    {history.map((row) => {
                      const changePct = num(row.changePct);
                      const previous = num(row.previousCtc);
                      const current = num(row.annualCtc);
                      const up = changePct !== null && changePct >= 0;
                      const status = String(row.status ?? '').toUpperCase();
                      const decidable = status === 'DRAFT' || status === 'PENDING_APPROVAL';
                      return (
                        <li key={row.id} className="ml-4">
                          <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-primary" />
                          <div className="bg-bg-secondary border border-border-light rounded-md p-3">
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                              <div>
                                <p className="text-xs text-text-primary font-medium">
                                  {fmtDate(row.effectiveFrom)}
                                </p>
                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                  <Chip label={prettyEnum(row.revisionType)} />
                                  <Chip label={prettyEnum(row.status)} tone={revisionTone(row.status)} dot />
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-mono text-text-secondary">
                                  {previous === null ? '—' : inr(previous)} →{' '}
                                  <span className="text-text-primary font-semibold">
                                    {current === null ? '—' : inr(current)}
                                  </span>
                                </p>
                                {changePct !== null && (
                                  <p className={`text-[11px] mt-0.5 ${up ? 'text-success' : 'text-danger'}`}>
                                    {up ? <TrendingUp size={12} className="inline" /> : <TrendingDown size={12} className="inline" />}{' '}
                                    {up ? '+' : ''}
                                    {changePct.toFixed(1)}%
                                  </p>
                                )}
                              </div>
                            </div>
                            {row.revisionReason && (
                              <p className="text-[11px] text-text-secondary mt-2">{String(row.revisionReason)}</p>
                            )}
                            <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                              <p className="text-[10px] text-text-muted">
                                {row.structureCode ? `Structure ${row.structureCode}` : 'No structure'}
                                {row.approvedBy ? ` · approved by ${row.approvedBy}` : ''}
                              </p>
                              {decidable && (
                                <div className="flex items-center gap-2">
                                  <button
                                    className="px-2 py-1 rounded text-[11px] font-medium bg-success-light text-success border border-success/30"
                                    onClick={() => decide(row, true)}
                                  >
                                    <Check size={11} className="inline mr-1" />
                                    Approve
                                  </button>
                                  <button
                                    className="px-2 py-1 rounded text-[11px] font-medium bg-danger-light text-danger border border-danger/30"
                                    onClick={() => decide(row, false)}
                                  >
                                    <X size={11} className="inline mr-1" />
                                    Reject
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </WidgetCard>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {panelOpen && employeeId !== null && (
          <NewRevisionPanel
            employeeId={employeeId}
            employeeName={selectedEmployee?.fullName ?? ''}
            structures={structures}
            currentCtc={num(salary?.annualCtc)}
            onClose={() => setPanelOpen(false)}
            onSaved={() => {
              setPanelOpen(false);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
