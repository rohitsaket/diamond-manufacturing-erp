import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calculator,
  Check,
  Copy,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  X,
} from 'lucide-react';
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
  TableShell,
  inr,
} from '../../../components/common/HrmsUI';
import { TabBar } from '../../../components/common/TabBar';

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

/** `2026-04-01` → `01 Apr 2026`. No date-fns in this project. */
function fmtDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function reason(err: any): string {
  return err?.message ? String(err.message) : 'Something went wrong';
}

function typeTone(componentType: unknown): Tone {
  switch (String(componentType ?? '').toUpperCase()) {
    case 'EARNING':
      return 'success';
    case 'DEDUCTION':
      return 'danger';
    case 'EMPLOYER_CONTRIBUTION':
      return 'info';
    case 'REIMBURSEMENT':
      return 'primary';
    default:
      return 'default';
  }
}

function prettyEnum(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) return '—';
  return s
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

const COMPONENT_TYPES = ['EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION', 'REIMBURSEMENT'];
const CATEGORIES = [
  'BASIC', 'ALLOWANCE', 'BONUS', 'INCENTIVE', 'VARIABLE_PAY', 'OVERTIME', 'ARREARS',
  'STATUTORY', 'LOAN', 'ATTENDANCE', 'REIMBURSEMENT', 'OTHER',
];
const CALC_TYPES = ['FIXED', 'PERCENT_OF', 'FORMULA', 'ATTENDANCE_BASED', 'SLAB', 'PIECE_RATE', 'MANUAL'];
const PERCENT_BASES = ['BASIC', 'GROSS', 'CTC', 'NET'];
const FREQUENCIES = ['MONTHLY', 'WEEKLY', 'BI_WEEKLY', 'DAILY', 'SEMI_MONTHLY'];
const ROUNDING_MODES = ['NONE', 'NEAREST', 'UP', 'DOWN'];
const LOP_BASES = ['CALENDAR_DAYS', 'WORKING_DAYS', 'FIXED_DAYS'];
const OT_KINDS = ['REGULAR', 'WEEKEND', 'HOLIDAY', 'NIGHT_SHIFT'];
const OT_RATE_TYPES = ['FLAT_HOURLY', 'MULTIPLIER'];
const WORKER_TYPES = ['PIECE_RATE', 'DHAR', 'MAXI'];

const FORMULA_HINT = 'Only + - * / ( ) and component codes are allowed, e.g. (BASIC + HRA) * 0.1';

// ---------------------------------------------------------------------------
// Shared local chrome
// ---------------------------------------------------------------------------

function SlidePanel({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
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
        initial={{ x: 420 }}
        animate={{ x: 0 }}
        exit={{ x: 420 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="relative bg-bg-card border-l border-border-default w-full max-w-md h-full flex flex-col shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border-default flex items-start justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-text-primary font-semibold text-sm truncate">{title}</h3>
            {subtitle && <p className="text-text-muted text-[11px] mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text-primary">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">{children}</div>
        {footer && (
          <div className="px-4 py-3 border-t border-border-default bg-bg-secondary flex-shrink-0">{footer}</div>
        )}
      </motion.div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      {children}
    </div>
  );
}

function CheckToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--color-primary)]"
      />
      {label}
    </label>
  );
}

/** Tiny yes/no marker for the boolean columns in the components table. */
function Flag({ on, label }: { on: boolean; label: string }) {
  return on ? (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-success-light text-success text-[10px] font-medium">
      <Check size={10} /> {label}
    </span>
  ) : (
    <span className="text-text-muted text-[10px]">—</span>
  );
}

// ---------------------------------------------------------------------------
// Components tab
// ---------------------------------------------------------------------------

interface ComponentForm {
  code: string;
  name: string;
  componentType: string;
  category: string;
  calculationType: string;
  percentOf: string;
  defaultValue: string;
  defaultPercent: string;
  formula: string;
  isTaxable: boolean;
  isPfApplicable: boolean;
  isEsiApplicable: boolean;
  isProrated: boolean;
  affectsGross: boolean;
  isStatutory: boolean;
  displayOrder: string;
  isActive: boolean;
}

const EMPTY_COMPONENT: ComponentForm = {
  code: '',
  name: '',
  componentType: 'EARNING',
  category: 'ALLOWANCE',
  calculationType: 'FIXED',
  percentOf: 'BASIC',
  defaultValue: '',
  defaultPercent: '',
  formula: '',
  isTaxable: true,
  isPfApplicable: false,
  isEsiApplicable: false,
  isProrated: true,
  affectsGross: true,
  isStatutory: false,
  displayOrder: '100',
  isActive: true,
};

function toComponentForm(row: any): ComponentForm {
  return {
    code: String(row?.code ?? ''),
    name: String(row?.name ?? ''),
    componentType: String(row?.componentType ?? 'EARNING'),
    category: String(row?.category ?? 'ALLOWANCE'),
    calculationType: String(row?.calculationType ?? 'FIXED'),
    percentOf: String(row?.percentOf ?? 'BASIC'),
    defaultValue: row?.defaultValue === null || row?.defaultValue === undefined ? '' : String(row.defaultValue),
    defaultPercent:
      row?.defaultPercent === null || row?.defaultPercent === undefined ? '' : String(row.defaultPercent),
    formula: String(row?.formula ?? ''),
    isTaxable: !!row?.isTaxable,
    isPfApplicable: !!row?.isPfApplicable,
    isEsiApplicable: !!row?.isEsiApplicable,
    isProrated: !!row?.isProrated,
    affectsGross: !!row?.affectsGross,
    isStatutory: !!row?.isStatutory,
    displayOrder: String(row?.displayOrder ?? 100),
    isActive: row?.isActive !== false,
  };
}

function ComponentsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [editing, setEditing] = useState<{ row: any | null; form: ComponentForm } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    compensationApi
      .components({ componentType: typeFilter || undefined, category: categoryFilter || undefined })
      .then((res) => {
        setRows(Array.isArray(res) ? res : []);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, [typeFilter, categoryFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const save = () => {
    if (!editing) return;
    const f = editing.form;
    const body: Record<string, unknown> = {
      code: f.code.trim().toUpperCase(),
      name: f.name.trim(),
      componentType: f.componentType,
      category: f.category,
      calculationType: f.calculationType,
      percentOf: f.calculationType === 'PERCENT_OF' ? f.percentOf : null,
      defaultValue: f.calculationType === 'FIXED' ? num(f.defaultValue) : null,
      defaultPercent: f.calculationType === 'PERCENT_OF' ? num(f.defaultPercent) : null,
      formula: f.calculationType === 'FORMULA' ? f.formula.trim() || null : null,
      isTaxable: f.isTaxable,
      isPfApplicable: f.isPfApplicable,
      isEsiApplicable: f.isEsiApplicable,
      isProrated: f.isProrated,
      affectsGross: f.affectsGross,
      isStatutory: f.isStatutory,
      displayOrder: num(f.displayOrder) ?? 100,
      isActive: f.isActive,
    };
    if (editing.row?.isSystem) delete body.code;

    setSaving(true);
    const request = editing.row
      ? compensationApi.updateComponent(Number(editing.row.id), body)
      : compensationApi.createComponent(body);
    request
      .then(() => {
        setEditing(null);
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setSaving(false));
  };

  const remove = (row: any) => {
    if (!window.confirm(`Delete component ${row?.code}? This cannot be undone.`)) return;
    compensationApi
      .deleteComponent(Number(row.id))
      .then(() => load())
      .catch((err) => window.alert(reason(err)));
  };

  if (loading && rows.length === 0) return <LoadingBlock label="Loading pay components…" />;
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

  const f = editing?.form;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <TabBar
            tabs={[{ id: '', label: 'All types' }, ...COMPONENT_TYPES.map((t) => ({ id: t, label: prettyEnum(t) }))]}
            active={typeFilter}
            onChange={setTypeFilter}
          />
          <select
            className={`${INPUT_CLS} w-auto py-1.5 text-xs`}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {prettyEnum(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button className={BTN_SECONDARY} onClick={load}>
            <RefreshCw size={14} className="inline mr-1.5" />
            Refresh
          </button>
          <button className={BTN_PRIMARY} onClick={() => setEditing({ row: null, form: { ...EMPTY_COMPONENT } })}>
            <Plus size={14} className="inline mr-1.5" />
            New component
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock message="No pay components match these filters" />
      ) : (
        <TableShell
          headers={['Code', 'Name', 'Type', 'Category', 'Calculation', 'Taxable', 'PF', 'ESI', 'Prorated', 'Order', '']}
        >
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-xs font-mono text-text-primary whitespace-nowrap">
                <span className="flex items-center gap-1.5">
                  {text(row.code)}
                  {row.isSystem && <Chip label="System" tone="info" />}
                </span>
              </td>
              <td className="px-3 py-2 text-xs text-text-primary">{text(row.name)}</td>
              <td className="px-3 py-2">
                <Chip label={prettyEnum(row.componentType)} tone={typeTone(row.componentType)} />
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary">{prettyEnum(row.category)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary">
                {row.calculationType === 'PERCENT_OF'
                  ? `${num(row.defaultPercent) ?? '—'}% of ${text(row.percentOf)}`
                  : row.calculationType === 'FIXED'
                    ? money(row.defaultValue)
                    : row.calculationType === 'FORMULA'
                      ? <span className="font-mono text-[11px]">{text(row.formula)}</span>
                      : prettyEnum(row.calculationType)}
              </td>
              <td className="px-3 py-2">
                <Flag on={!!row.isTaxable} label="Tax" />
              </td>
              <td className="px-3 py-2">
                <Flag on={!!row.isPfApplicable} label="PF" />
              </td>
              <td className="px-3 py-2">
                <Flag on={!!row.isEsiApplicable} label="ESI" />
              </td>
              <td className="px-3 py-2">
                <Flag on={!!row.isProrated} label="Pro" />
              </td>
              <td className="px-3 py-2 text-xs text-text-muted tabular-nums">{num(row.displayOrder) ?? '—'}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1 justify-end">
                  <button
                    className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-primary"
                    title="Edit"
                    onClick={() => setEditing({ row, form: toComponentForm(row) })}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed"
                    title={row.isSystem ? 'System components cannot be deleted' : 'Delete'}
                    disabled={!!row.isSystem}
                    onClick={() => remove(row)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {editing && f && (
          <SlidePanel
            title={editing.row ? `Edit ${editing.row.code}` : 'New pay component'}
            subtitle={editing.row?.isSystem ? 'System component — code is fixed' : null}
            onClose={() => setEditing(null)}
            footer={
              <div className="flex items-center justify-end gap-2">
                <button className={BTN_SECONDARY} onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className={BTN_PRIMARY} disabled={saving} onClick={save}>
                  {saving ? 'Saving…' : 'Save component'}
                </button>
              </div>
            }
          >
            <Field label="Code">
              <input
                className={INPUT_CLS}
                value={f.code}
                readOnly={!!editing.row?.isSystem}
                onChange={(e) => setEditing({ ...editing, form: { ...f, code: e.target.value } })}
              />
            </Field>
            <Field label="Name">
              <input
                className={INPUT_CLS}
                value={f.name}
                onChange={(e) => setEditing({ ...editing, form: { ...f, name: e.target.value } })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select
                  className={INPUT_CLS}
                  value={f.componentType}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, componentType: e.target.value } })}
                >
                  {COMPONENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {prettyEnum(t)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Category">
                <select
                  className={INPUT_CLS}
                  value={f.category}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, category: e.target.value } })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {prettyEnum(c)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Calculation type">
              <select
                className={INPUT_CLS}
                value={f.calculationType}
                onChange={(e) => setEditing({ ...editing, form: { ...f, calculationType: e.target.value } })}
              >
                {CALC_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {prettyEnum(c)}
                  </option>
                ))}
              </select>
            </Field>

            {f.calculationType === 'FIXED' && (
              <Field label="Default amount (₹)">
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.defaultValue}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, defaultValue: e.target.value } })}
                />
              </Field>
            )}

            {f.calculationType === 'PERCENT_OF' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Percent">
                  <input
                    className={INPUT_CLS}
                    type="number"
                    value={f.defaultPercent}
                    onChange={(e) => setEditing({ ...editing, form: { ...f, defaultPercent: e.target.value } })}
                  />
                </Field>
                <Field label="Of base">
                  <select
                    className={INPUT_CLS}
                    value={f.percentOf}
                    onChange={(e) => setEditing({ ...editing, form: { ...f, percentOf: e.target.value } })}
                  >
                    {PERCENT_BASES.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}

            {f.calculationType === 'FORMULA' && (
              <Field label="Formula">
                <textarea
                  className={`${INPUT_CLS} font-mono h-24`}
                  value={f.formula}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, formula: e.target.value } })}
                />
                <p className="text-text-muted text-[11px] mt-1">{FORMULA_HINT}</p>
              </Field>
            )}

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border-light">
              <CheckToggle
                label="Taxable"
                checked={f.isTaxable}
                onChange={(v) => setEditing({ ...editing, form: { ...f, isTaxable: v } })}
              />
              <CheckToggle
                label="PF applicable"
                checked={f.isPfApplicable}
                onChange={(v) => setEditing({ ...editing, form: { ...f, isPfApplicable: v } })}
              />
              <CheckToggle
                label="ESI applicable"
                checked={f.isEsiApplicable}
                onChange={(v) => setEditing({ ...editing, form: { ...f, isEsiApplicable: v } })}
              />
              <CheckToggle
                label="Prorated"
                checked={f.isProrated}
                onChange={(v) => setEditing({ ...editing, form: { ...f, isProrated: v } })}
              />
              <CheckToggle
                label="Affects gross"
                checked={f.affectsGross}
                onChange={(v) => setEditing({ ...editing, form: { ...f, affectsGross: v } })}
              />
              <CheckToggle
                label="Statutory"
                checked={f.isStatutory}
                onChange={(v) => setEditing({ ...editing, form: { ...f, isStatutory: v } })}
              />
              <CheckToggle
                label="Active"
                checked={f.isActive}
                onChange={(v) => setEditing({ ...editing, form: { ...f, isActive: v } })}
              />
            </div>

            <Field label="Display order">
              <input
                className={INPUT_CLS}
                type="number"
                value={f.displayOrder}
                onChange={(e) => setEditing({ ...editing, form: { ...f, displayOrder: e.target.value } })}
              />
            </Field>
          </SlidePanel>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Structures tab
// ---------------------------------------------------------------------------

interface LineDraft {
  componentId: string;
  calculationType: string;
  percentOf: string;
  amount: string;
  percentValue: string;
  minAmount: string;
  maxAmount: string;
  displayOrder: string;
}

function toLineDraft(line: any, index: number): LineDraft {
  return {
    componentId: String(line?.componentId ?? ''),
    calculationType: String(line?.calculationType ?? ''),
    percentOf: String(line?.percentOf ?? ''),
    amount: line?.amount === null || line?.amount === undefined ? '' : String(line.amount),
    percentValue: line?.percentValue === null || line?.percentValue === undefined ? '' : String(line.percentValue),
    minAmount: line?.minAmount === null || line?.minAmount === undefined ? '' : String(line.minAmount),
    maxAmount: line?.maxAmount === null || line?.maxAmount === undefined ? '' : String(line.maxAmount),
    displayOrder: String(line?.displayOrder ?? (index + 1) * 10),
  };
}

interface StructureForm {
  code: string;
  name: string;
  description: string;
  currency: string;
  grade: string;
  department: string;
  workerType: string;
  effectiveFrom: string;
  effectiveTo: string;
  isActive: boolean;
}

const TODAY = new Date().toISOString().slice(0, 10);

const EMPTY_STRUCTURE: StructureForm = {
  code: '',
  name: '',
  description: '',
  currency: 'INR',
  grade: '',
  department: '',
  workerType: '',
  effectiveFrom: TODAY,
  effectiveTo: '',
  isActive: true,
};

function StructuresTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([]);
  const [savingLines, setSavingLines] = useState(false);

  const [ctcInput, setCtcInput] = useState('600000');
  const [preview, setPreview] = useState<any | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ row: any | null; form: StructureForm } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      compensationApi.structures({}).catch((err) => {
        throw err;
      }),
      compensationApi.components({ isActive: true }).catch(() => [] as any[]),
    ])
      .then(([structures, comps]) => {
        setRows(Array.isArray(structures) ? structures : []);
        setComponents(Array.isArray(comps) ? comps : []);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadDetail = useCallback((id: number) => {
    setDetailLoading(true);
    setDetailError(null);
    setPreview(null);
    setPreviewError(null);
    compensationApi
      .structure(id)
      .then((res) => {
        setDetail(res ?? null);
        setLineDrafts(((res?.lines ?? []) as any[]).map(toLineDraft));
      })
      .catch((err) => setDetailError(reason(err)))
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setLineDrafts([]);
      return;
    }
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const componentById = useMemo(() => {
    const map = new Map<number, any>();
    for (const c of components) map.set(Number(c.id), c);
    return map;
  }, [components]);

  const saveStructure = () => {
    if (!editing) return;
    const f = editing.form;
    const body: Record<string, unknown> = {
      code: f.code.trim().toUpperCase(),
      name: f.name.trim(),
      description: f.description.trim() || null,
      currency: f.currency.trim().toUpperCase() || 'INR',
      grade: f.grade.trim() || null,
      department: f.department.trim() || null,
      workerType: f.workerType || null,
      effectiveFrom: f.effectiveFrom,
      effectiveTo: f.effectiveTo || null,
      isActive: f.isActive,
    };
    setSaving(true);
    const request = editing.row
      ? compensationApi.updateStructure(Number(editing.row.id), body)
      : compensationApi.createStructure(body);
    request
      .then(() => {
        setEditing(null);
        load();
        if (editing.row && selectedId === Number(editing.row.id)) loadDetail(Number(editing.row.id));
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setSaving(false));
  };

  const clone = (row: any) => {
    const code = window.prompt(`New code for the copy of ${row?.code}`, `${row?.code ?? ''}-COPY`);
    if (!code) return;
    const name = window.prompt('New name', `${row?.name ?? ''} (copy)`);
    if (!name) return;
    compensationApi
      .cloneStructure(Number(row.id), { code: code.trim().toUpperCase(), name: name.trim() })
      .then(() => load())
      .catch((err) => window.alert(reason(err)));
  };

  const saveLines = () => {
    if (selectedId === null) return;
    const lines = lineDrafts
      .filter((l) => num(l.componentId) !== null)
      .map((l, i) => ({
        componentId: num(l.componentId),
        calculationType: l.calculationType || null,
        percentOf: l.percentOf || null,
        amount: num(l.amount),
        percentValue: num(l.percentValue),
        minAmount: num(l.minAmount),
        maxAmount: num(l.maxAmount),
        displayOrder: num(l.displayOrder) ?? (i + 1) * 10,
      }));
    setSavingLines(true);
    compensationApi
      .setStructureLines(selectedId, lines)
      .then(() => {
        loadDetail(selectedId);
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setSavingLines(false));
  };

  const runPreview = () => {
    if (selectedId === null) return;
    const ctc = num(ctcInput);
    if (ctc === null || ctc <= 0) {
      window.alert('Enter an annual CTC greater than zero');
      return;
    }
    setPreviewing(true);
    setPreviewError(null);
    compensationApi
      .previewStructure(selectedId, ctc)
      .then((res) => setPreview(res ?? null))
      .catch((err) => {
        setPreview(null);
        setPreviewError(reason(err));
      })
      .finally(() => setPreviewing(false));
  };

  if (loading && rows.length === 0) return <LoadingBlock label="Loading salary structures…" />;
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

  const previewRows: any[] = [
    ...((preview?.earnings ?? []) as any[]),
    ...((preview?.deductions ?? []) as any[]),
    ...((preview?.employerContributions ?? []) as any[]),
  ];
  const f = editing?.form;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-text-secondary text-xs">
          {rows.length} structure{rows.length === 1 ? '' : 's'}
        </p>
        <div className="flex items-center gap-2">
          <button className={BTN_SECONDARY} onClick={load}>
            <RefreshCw size={14} className="inline mr-1.5" />
            Refresh
          </button>
          <button className={BTN_PRIMARY} onClick={() => setEditing({ row: null, form: { ...EMPTY_STRUCTURE } })}>
            <Plus size={14} className="inline mr-1.5" />
            New structure
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock message="No salary structures yet" hint="Create one to define how CTC splits into components" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((row) => {
            const active = Number(row.id) === selectedId;
            return (
              <button
                key={row.id}
                onClick={() => setSelectedId(active ? null : Number(row.id))}
                className={`text-left rounded-md border p-3 transition-colors ${
                  active
                    ? 'bg-bg-selected border-primary/40'
                    : 'bg-bg-card border-border-default hover:border-primary/30'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-primary">{text(row.code)}</p>
                    <p className="text-sm text-text-primary font-medium truncate">{text(row.name)}</p>
                  </div>
                  <Chip label={row.isActive ? 'Active' : 'Inactive'} tone={row.isActive ? 'success' : 'default'} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <span className="text-text-muted">Currency</span>
                  <span className="text-text-secondary">{text(row.currency)}</span>
                  <span className="text-text-muted">Worker type</span>
                  <span className="text-text-secondary">{prettyEnum(row.workerType)}</span>
                  <span className="text-text-muted">Effective</span>
                  <span className="text-text-secondary">
                    {fmtDate(row.effectiveFrom)}
                    {row.effectiveTo ? ` → ${fmtDate(row.effectiveTo)}` : ' → open'}
                  </span>
                  <span className="text-text-muted">Lines</span>
                  <span className="text-text-secondary tabular-nums">{num(row.lineCount) ?? '—'}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedId !== null && (
        <div className="rounded-md border border-border-default bg-bg-card">
          <div className="px-4 py-3 border-b border-border-default flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-text-primary text-sm font-semibold truncate">
                {text(detail?.name)} <span className="font-mono text-text-muted">({text(detail?.code)})</span>
              </h3>
              <p className="text-text-muted text-[11px]">{text(detail?.description)}</p>
            </div>
            <div className="flex items-center gap-2">
              <button className={BTN_SECONDARY} onClick={() => detail && clone(detail)}>
                <Copy size={14} className="inline mr-1.5" />
                Clone
              </button>
              <button
                className={BTN_SECONDARY}
                onClick={() =>
                  detail &&
                  setEditing({
                    row: detail,
                    form: {
                      code: String(detail.code ?? ''),
                      name: String(detail.name ?? ''),
                      description: String(detail.description ?? ''),
                      currency: String(detail.currency ?? 'INR'),
                      grade: String(detail.grade ?? ''),
                      department: String(detail.department ?? ''),
                      workerType: String(detail.workerType ?? ''),
                      effectiveFrom: String(detail.effectiveFrom ?? TODAY).slice(0, 10),
                      effectiveTo: detail.effectiveTo ? String(detail.effectiveTo).slice(0, 10) : '',
                      isActive: detail.isActive !== false,
                    },
                  })
                }
              >
                <Pencil size={14} className="inline mr-1.5" />
                Edit
              </button>
              <button className={BTN_SECONDARY} onClick={() => setSelectedId(null)}>
                Close
              </button>
            </div>
          </div>

          <div className="p-4 space-y-5">
            {detailLoading && <LoadingBlock label="Loading structure…" />}
            {detailError && <ErrorBlock message={detailError} />}

            {!detailLoading && !detailError && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-text-primary text-xs font-semibold uppercase tracking-wider">
                      <Layers size={14} className="inline mr-1.5" />
                      Structure lines
                    </h4>
                    <div className="flex items-center gap-2">
                      <button
                        className={BTN_SECONDARY}
                        onClick={() =>
                          setLineDrafts([
                            ...lineDrafts,
                            {
                              componentId: '',
                              calculationType: '',
                              percentOf: '',
                              amount: '',
                              percentValue: '',
                              minAmount: '',
                              maxAmount: '',
                              displayOrder: String((lineDrafts.length + 1) * 10),
                            },
                          ])
                        }
                      >
                        <Plus size={14} className="inline mr-1.5" />
                        Add line
                      </button>
                      <button className={BTN_PRIMARY} disabled={savingLines} onClick={saveLines}>
                        {savingLines ? 'Saving…' : 'Save lines'}
                      </button>
                    </div>
                  </div>

                  {lineDrafts.length === 0 ? (
                    <EmptyBlock message="This structure has no lines yet" />
                  ) : (
                    <TableShell headers={['Component', 'Calculation', 'Value', 'Min', 'Max', 'Order', '']}>
                      {lineDrafts.map((line, index) => {
                        const comp = componentById.get(Number(line.componentId));
                        const update = (patch: Partial<LineDraft>) =>
                          setLineDrafts(lineDrafts.map((l, i) => (i === index ? { ...l, ...patch } : l)));
                        return (
                          <tr key={index} className="align-top">
                            <td className="px-3 py-2 min-w-[180px]">
                              <select
                                className={`${INPUT_CLS} text-xs py-1.5`}
                                value={line.componentId}
                                onChange={(e) => update({ componentId: e.target.value })}
                              >
                                <option value="">Select…</option>
                                {components.map((c) => (
                                  <option key={c.id} value={String(c.id)}>
                                    {c.code} — {c.name}
                                  </option>
                                ))}
                              </select>
                              {comp && (
                                <span className="mt-1 inline-block">
                                  <Chip label={prettyEnum(comp.componentType)} tone={typeTone(comp.componentType)} />
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 min-w-[140px]">
                              <select
                                className={`${INPUT_CLS} text-xs py-1.5`}
                                value={line.calculationType}
                                onChange={(e) => update({ calculationType: e.target.value })}
                              >
                                <option value="">Use component default</option>
                                {CALC_TYPES.map((c) => (
                                  <option key={c} value={c}>
                                    {prettyEnum(c)}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 min-w-[170px]">
                              {line.calculationType === 'PERCENT_OF' ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    className={`${INPUT_CLS} text-xs py-1.5 w-20`}
                                    type="number"
                                    placeholder="%"
                                    value={line.percentValue}
                                    onChange={(e) => update({ percentValue: e.target.value })}
                                  />
                                  <select
                                    className={`${INPUT_CLS} text-xs py-1.5 w-24`}
                                    value={line.percentOf}
                                    onChange={(e) => update({ percentOf: e.target.value })}
                                  >
                                    <option value="">of…</option>
                                    {PERCENT_BASES.map((b) => (
                                      <option key={b} value={b}>
                                        {b}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : (
                                <input
                                  className={`${INPUT_CLS} text-xs py-1.5`}
                                  type="number"
                                  placeholder="Amount"
                                  value={line.amount}
                                  onChange={(e) => update({ amount: e.target.value })}
                                />
                              )}
                            </td>
                            <td className="px-3 py-2 w-24">
                              <input
                                className={`${INPUT_CLS} text-xs py-1.5`}
                                type="number"
                                value={line.minAmount}
                                onChange={(e) => update({ minAmount: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2 w-24">
                              <input
                                className={`${INPUT_CLS} text-xs py-1.5`}
                                type="number"
                                value={line.maxAmount}
                                onChange={(e) => update({ maxAmount: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2 w-20">
                              <input
                                className={`${INPUT_CLS} text-xs py-1.5`}
                                type="number"
                                value={line.displayOrder}
                                onChange={(e) => update({ displayOrder: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <button
                                className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-danger"
                                title="Remove line"
                                onClick={() => setLineDrafts(lineDrafts.filter((_, i) => i !== index))}
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </TableShell>
                  )}
                </div>

                <div>
                  <h4 className="text-text-primary text-xs font-semibold uppercase tracking-wider mb-2">
                    <Calculator size={14} className="inline mr-1.5" />
                    CTC preview
                  </h4>
                  <div className="flex items-end gap-2 flex-wrap mb-3">
                    <div>
                      <label className={LABEL_CLS}>Annual CTC (₹)</label>
                      <input
                        className={INPUT_CLS}
                        type="number"
                        value={ctcInput}
                        onChange={(e) => setCtcInput(e.target.value)}
                      />
                    </div>
                    <button className={BTN_PRIMARY} disabled={previewing} onClick={runPreview}>
                      {previewing ? 'Calculating…' : 'Preview split'}
                    </button>
                  </div>

                  {previewError && <ErrorBlock message={previewError} />}

                  {preview && (
                    <div className="space-y-3">
                      {((preview.warnings ?? []) as string[]).length > 0 && (
                        <ul className="text-warning text-xs space-y-1">
                          {((preview.warnings ?? []) as string[]).map((w, i) => (
                            <li key={i}>• {w}</li>
                          ))}
                        </ul>
                      )}
                      <TableShell
                        headers={['Component', 'Type', 'Calculation', 'Monthly', 'Annual']}
                        footer={
                          <tfoot className="bg-bg-secondary">
                            <tr>
                              <td className="px-3 py-2 text-xs font-semibold text-text-primary" colSpan={3}>
                                Monthly gross / net / employer cost
                              </td>
                              <td className="px-3 py-2 text-xs font-mono text-right text-text-primary">
                                {money(preview.monthlyGross)}
                              </td>
                              <td className="px-3 py-2 text-xs font-mono text-right text-text-primary">
                                {money(preview.annualGross)}
                              </td>
                            </tr>
                            <tr>
                              <td className="px-3 py-2 text-[11px] text-text-muted" colSpan={3}>
                                Net {money(preview.monthlyNet)} · deductions {money(preview.monthlyDeductions)} ·
                                employer cost {money(preview.monthlyEmployerCost)}
                              </td>
                              <td />
                              <td />
                            </tr>
                          </tfoot>
                        }
                      >
                        {previewRows.length === 0 ? (
                          <tr>
                            <td className="px-3 py-4 text-xs text-text-muted" colSpan={5}>
                              The preview returned no components.
                            </td>
                          </tr>
                        ) : (
                          previewRows.map((c: any, i: number) => (
                            <tr key={`${c.componentId}-${i}`} className="hover:bg-bg-hover">
                              <td className="px-3 py-2 text-xs text-text-primary">
                                <span className="font-mono">{text(c.code)}</span> {text(c.name)}
                                {c.isBalancing && (
                                  <span className="ml-1.5">
                                    <Chip label="Balancing" tone="warning" />
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <Chip label={prettyEnum(c.componentType)} tone={typeTone(c.componentType)} />
                              </td>
                              <td className="px-3 py-2 text-xs text-text-secondary">
                                {c.calculationType === 'PERCENT_OF'
                                  ? `${num(c.percentValue) ?? '—'}% of ${text(c.percentOf)}`
                                  : prettyEnum(c.calculationType)}
                              </td>
                              <td className="px-3 py-2 text-xs font-mono text-right text-text-primary">
                                {money(c.monthlyAmount)}
                              </td>
                              <td className="px-3 py-2 text-xs font-mono text-right text-text-secondary">
                                {money(c.annualAmount)}
                              </td>
                            </tr>
                          ))
                        )}
                      </TableShell>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {editing && f && (
          <SlidePanel
            title={editing.row ? `Edit ${editing.row.code}` : 'New salary structure'}
            onClose={() => setEditing(null)}
            footer={
              <div className="flex items-center justify-end gap-2">
                <button className={BTN_SECONDARY} onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className={BTN_PRIMARY} disabled={saving} onClick={saveStructure}>
                  {saving ? 'Saving…' : 'Save structure'}
                </button>
              </div>
            }
          >
            <Field label="Code">
              <input
                className={INPUT_CLS}
                value={f.code}
                onChange={(e) => setEditing({ ...editing, form: { ...f, code: e.target.value } })}
              />
            </Field>
            <Field label="Name">
              <input
                className={INPUT_CLS}
                value={f.name}
                onChange={(e) => setEditing({ ...editing, form: { ...f, name: e.target.value } })}
              />
            </Field>
            <Field label="Description">
              <textarea
                className={`${INPUT_CLS} h-20`}
                value={f.description}
                onChange={(e) => setEditing({ ...editing, form: { ...f, description: e.target.value } })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Currency">
                <input
                  className={INPUT_CLS}
                  value={f.currency}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, currency: e.target.value } })}
                />
              </Field>
              <Field label="Worker type">
                <select
                  className={INPUT_CLS}
                  value={f.workerType}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, workerType: e.target.value } })}
                >
                  <option value="">Any</option>
                  {WORKER_TYPES.map((w) => (
                    <option key={w} value={w}>
                      {prettyEnum(w)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Grade">
                <input
                  className={INPUT_CLS}
                  value={f.grade}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, grade: e.target.value } })}
                />
              </Field>
              <Field label="Department">
                <input
                  className={INPUT_CLS}
                  value={f.department}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, department: e.target.value } })}
                />
              </Field>
              <Field label="Effective from">
                <input
                  className={INPUT_CLS}
                  type="date"
                  value={f.effectiveFrom}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, effectiveFrom: e.target.value } })}
                />
              </Field>
              <Field label="Effective to">
                <input
                  className={INPUT_CLS}
                  type="date"
                  value={f.effectiveTo}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, effectiveTo: e.target.value } })}
                />
              </Field>
            </div>
            <CheckToggle
              label="Active"
              checked={f.isActive}
              onChange={(v) => setEditing({ ...editing, form: { ...f, isActive: v } })}
            />
          </SlidePanel>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pay cycles tab
// ---------------------------------------------------------------------------

interface CycleForm {
  code: string;
  name: string;
  frequency: string;
  currency: string;
  cycleStartDay: string;
  cutoffDay: string;
  payDay: string;
  roundingMode: string;
  roundingPrecision: string;
  lopBasis: string;
  fixedDaysPerMonth: string;
  isActive: boolean;
}

const EMPTY_CYCLE: CycleForm = {
  code: '',
  name: '',
  frequency: 'MONTHLY',
  currency: 'INR',
  cycleStartDay: '1',
  cutoffDay: '',
  payDay: '',
  roundingMode: 'NEAREST',
  roundingPrecision: '0',
  lopBasis: 'CALENDAR_DAYS',
  fixedDaysPerMonth: '',
  isActive: true,
};

function CyclesTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ row: any | null; form: CycleForm } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    compensationApi
      .cycles()
      .then((res) => {
        setRows(Array.isArray(res) ? res : []);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = () => {
    if (!editing) return;
    const f = editing.form;
    const body: Record<string, unknown> = {
      code: f.code.trim().toUpperCase(),
      name: f.name.trim(),
      frequency: f.frequency,
      currency: f.currency.trim().toUpperCase() || 'INR',
      cycleStartDay: num(f.cycleStartDay) ?? 1,
      cutoffDay: num(f.cutoffDay),
      payDay: num(f.payDay),
      roundingMode: f.roundingMode,
      roundingPrecision: num(f.roundingPrecision) ?? 0,
      lopBasis: f.lopBasis,
      fixedDaysPerMonth: num(f.fixedDaysPerMonth),
      isActive: f.isActive,
    };
    setSaving(true);
    const request = editing.row
      ? compensationApi.updateCycle(Number(editing.row.id), body)
      : compensationApi.createCycle(body);
    request
      .then(() => {
        setEditing(null);
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setSaving(false));
  };

  const makeDefault = (row: any) => {
    compensationApi
      .setDefaultCycle(Number(row.id))
      .then(() => load())
      .catch((err) => window.alert(reason(err)));
  };

  if (loading && rows.length === 0) return <LoadingBlock label="Loading pay cycles…" />;
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

  const f = editing?.form;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <button className={BTN_SECONDARY} onClick={load}>
          <RefreshCw size={14} className="inline mr-1.5" />
          Refresh
        </button>
        <button className={BTN_PRIMARY} onClick={() => setEditing({ row: null, form: { ...EMPTY_CYCLE } })}>
          <Plus size={14} className="inline mr-1.5" />
          New cycle
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock message="No pay cycles configured" />
      ) : (
        <TableShell
          headers={['Code', 'Name', 'Frequency', 'Currency', 'Cutoff', 'Pay day', 'Rounding', 'LOP basis', '']}
        >
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-xs font-mono text-text-primary">
                <span className="flex items-center gap-1.5">
                  {text(row.code)}
                  {row.isDefault && <Chip label="Default" tone="primary" />}
                </span>
              </td>
              <td className="px-3 py-2 text-xs text-text-primary">{text(row.name)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary">{prettyEnum(row.frequency)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary">{text(row.currency)}</td>
              <td className="px-3 py-2 text-xs text-text-secondary tabular-nums">{num(row.cutoffDay) ?? '—'}</td>
              <td className="px-3 py-2 text-xs text-text-secondary tabular-nums">{num(row.payDay) ?? '—'}</td>
              <td className="px-3 py-2 text-xs text-text-secondary">
                {prettyEnum(row.roundingMode)} ({num(row.roundingPrecision) ?? 0})
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary">
                {prettyEnum(row.lopBasis)}
                {row.lopBasis === 'FIXED_DAYS' && row.fixedDaysPerMonth ? ` (${row.fixedDaysPerMonth})` : ''}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1 justify-end">
                  {!row.isDefault && (
                    <button
                      className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-primary"
                      title="Make default"
                      onClick={() => makeDefault(row)}
                    >
                      <Star size={14} />
                    </button>
                  )}
                  <button
                    className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-primary"
                    title="Edit"
                    onClick={() =>
                      setEditing({
                        row,
                        form: {
                          code: String(row.code ?? ''),
                          name: String(row.name ?? ''),
                          frequency: String(row.frequency ?? 'MONTHLY'),
                          currency: String(row.currency ?? 'INR'),
                          cycleStartDay: String(row.cycleStartDay ?? 1),
                          cutoffDay: row.cutoffDay === null || row.cutoffDay === undefined ? '' : String(row.cutoffDay),
                          payDay: row.payDay === null || row.payDay === undefined ? '' : String(row.payDay),
                          roundingMode: String(row.roundingMode ?? 'NEAREST'),
                          roundingPrecision: String(row.roundingPrecision ?? 0),
                          lopBasis: String(row.lopBasis ?? 'CALENDAR_DAYS'),
                          fixedDaysPerMonth:
                            row.fixedDaysPerMonth === null || row.fixedDaysPerMonth === undefined
                              ? ''
                              : String(row.fixedDaysPerMonth),
                          isActive: row.isActive !== false,
                        },
                      })
                    }
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {editing && f && (
          <SlidePanel
            title={editing.row ? `Edit ${editing.row.code}` : 'New pay cycle'}
            onClose={() => setEditing(null)}
            footer={
              <div className="flex items-center justify-end gap-2">
                <button className={BTN_SECONDARY} onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className={BTN_PRIMARY} disabled={saving} onClick={save}>
                  {saving ? 'Saving…' : 'Save cycle'}
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code">
                <input
                  className={INPUT_CLS}
                  value={f.code}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, code: e.target.value } })}
                />
              </Field>
              <Field label="Currency">
                <input
                  className={INPUT_CLS}
                  value={f.currency}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, currency: e.target.value } })}
                />
              </Field>
            </div>
            <Field label="Name">
              <input
                className={INPUT_CLS}
                value={f.name}
                onChange={(e) => setEditing({ ...editing, form: { ...f, name: e.target.value } })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Frequency">
                <select
                  className={INPUT_CLS}
                  value={f.frequency}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, frequency: e.target.value } })}
                >
                  {FREQUENCIES.map((x) => (
                    <option key={x} value={x}>
                      {prettyEnum(x)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cycle start day">
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.cycleStartDay}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, cycleStartDay: e.target.value } })}
                />
              </Field>
              <Field label="Cutoff day">
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.cutoffDay}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, cutoffDay: e.target.value } })}
                />
              </Field>
              <Field label="Pay day">
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.payDay}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, payDay: e.target.value } })}
                />
              </Field>
              <Field label="Rounding mode">
                <select
                  className={INPUT_CLS}
                  value={f.roundingMode}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, roundingMode: e.target.value } })}
                >
                  {ROUNDING_MODES.map((x) => (
                    <option key={x} value={x}>
                      {prettyEnum(x)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Rounding precision">
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.roundingPrecision}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, roundingPrecision: e.target.value } })}
                />
              </Field>
              <Field label="LOP basis">
                <select
                  className={INPUT_CLS}
                  value={f.lopBasis}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, lopBasis: e.target.value } })}
                >
                  {LOP_BASES.map((x) => (
                    <option key={x} value={x}>
                      {prettyEnum(x)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fixed days / month">
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.fixedDaysPerMonth}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, fixedDaysPerMonth: e.target.value } })}
                />
              </Field>
            </div>
            <CheckToggle
              label="Active"
              checked={f.isActive}
              onChange={(v) => setEditing({ ...editing, form: { ...f, isActive: v } })}
            />
          </SlidePanel>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overtime rules tab
// ---------------------------------------------------------------------------

interface OtForm {
  code: string;
  name: string;
  otKind: string;
  rateType: string;
  flatRate: string;
  multiplier: string;
  minMinutes: string;
  maxHoursPerDay: string;
  maxHoursPerMonth: string;
  requiresApproval: boolean;
  grade: string;
  isActive: boolean;
}

const EMPTY_OT: OtForm = {
  code: '',
  name: '',
  otKind: 'REGULAR',
  rateType: 'MULTIPLIER',
  flatRate: '',
  multiplier: '2',
  minMinutes: '30',
  maxHoursPerDay: '',
  maxHoursPerMonth: '',
  requiresApproval: true,
  grade: '',
  isActive: true,
};

function OvertimeTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ row: any | null; form: OtForm } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    compensationApi
      .overtimeRules()
      .then((res) => {
        setRows(Array.isArray(res) ? res : []);
        setError(null);
      })
      .catch((err) => setError(reason(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = () => {
    if (!editing) return;
    const f = editing.form;
    const body: Record<string, unknown> = {
      code: f.code.trim().toUpperCase(),
      name: f.name.trim(),
      otKind: f.otKind,
      rateType: f.rateType,
      flatRate: f.rateType === 'FLAT_HOURLY' ? num(f.flatRate) : null,
      multiplier: f.rateType === 'MULTIPLIER' ? num(f.multiplier) : null,
      minMinutes: num(f.minMinutes) ?? 0,
      maxHoursPerDay: num(f.maxHoursPerDay),
      maxHoursPerMonth: num(f.maxHoursPerMonth),
      requiresApproval: f.requiresApproval,
      grade: f.grade.trim() || null,
      isActive: f.isActive,
    };
    setSaving(true);
    const request = editing.row
      ? compensationApi.updateOvertimeRule(Number(editing.row.id), body)
      : compensationApi.createOvertimeRule(body);
    request
      .then(() => {
        setEditing(null);
        load();
      })
      .catch((err) => window.alert(reason(err)))
      .finally(() => setSaving(false));
  };

  if (loading && rows.length === 0) return <LoadingBlock label="Loading overtime rules…" />;
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

  const f = editing?.form;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <button className={BTN_SECONDARY} onClick={load}>
          <RefreshCw size={14} className="inline mr-1.5" />
          Refresh
        </button>
        <button className={BTN_PRIMARY} onClick={() => setEditing({ row: null, form: { ...EMPTY_OT } })}>
          <Plus size={14} className="inline mr-1.5" />
          New rule
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock message="No overtime rules configured" />
      ) : (
        <TableShell headers={['Code', 'Name', 'Kind', 'Rate type', 'Rate', 'Min minutes', 'Monthly cap', 'Approval', '']}>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-xs font-mono text-text-primary">{text(row.code)}</td>
              <td className="px-3 py-2 text-xs text-text-primary">{text(row.name)}</td>
              <td className="px-3 py-2">
                <Chip label={prettyEnum(row.otKind)} tone={row.otKind === 'HOLIDAY' ? 'warning' : 'default'} />
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary">{prettyEnum(row.rateType)}</td>
              <td className="px-3 py-2 text-xs font-mono text-text-primary">
                {row.rateType === 'FLAT_HOURLY'
                  ? `${money(row.flatRate)}/hr`
                  : num(row.multiplier) !== null
                    ? `${num(row.multiplier)}×`
                    : '—'}
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary tabular-nums">{num(row.minMinutes) ?? '—'}</td>
              <td className="px-3 py-2 text-xs text-text-secondary tabular-nums">
                {num(row.maxHoursPerMonth) === null ? '—' : `${num(row.maxHoursPerMonth)} h`}
              </td>
              <td className="px-3 py-2">
                <Chip
                  label={row.requiresApproval ? 'Required' : 'Not required'}
                  tone={row.requiresApproval ? 'warning' : 'default'}
                />
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-primary"
                  title="Edit"
                  onClick={() =>
                    setEditing({
                      row,
                      form: {
                        code: String(row.code ?? ''),
                        name: String(row.name ?? ''),
                        otKind: String(row.otKind ?? 'REGULAR'),
                        rateType: String(row.rateType ?? 'MULTIPLIER'),
                        flatRate: row.flatRate === null || row.flatRate === undefined ? '' : String(row.flatRate),
                        multiplier:
                          row.multiplier === null || row.multiplier === undefined ? '' : String(row.multiplier),
                        minMinutes: String(row.minMinutes ?? 0),
                        maxHoursPerDay:
                          row.maxHoursPerDay === null || row.maxHoursPerDay === undefined
                            ? ''
                            : String(row.maxHoursPerDay),
                        maxHoursPerMonth:
                          row.maxHoursPerMonth === null || row.maxHoursPerMonth === undefined
                            ? ''
                            : String(row.maxHoursPerMonth),
                        requiresApproval: !!row.requiresApproval,
                        grade: String(row.grade ?? ''),
                        isActive: row.isActive !== false,
                      },
                    })
                  }
                >
                  <Pencil size={14} />
                </button>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <AnimatePresence>
        {editing && f && (
          <SlidePanel
            title={editing.row ? `Edit ${editing.row.code}` : 'New overtime rule'}
            onClose={() => setEditing(null)}
            footer={
              <div className="flex items-center justify-end gap-2">
                <button className={BTN_SECONDARY} onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className={BTN_PRIMARY} disabled={saving} onClick={save}>
                  {saving ? 'Saving…' : 'Save rule'}
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code">
                <input
                  className={INPUT_CLS}
                  value={f.code}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, code: e.target.value } })}
                />
              </Field>
              <Field label="Kind">
                <select
                  className={INPUT_CLS}
                  value={f.otKind}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, otKind: e.target.value } })}
                >
                  {OT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {prettyEnum(k)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Name">
              <input
                className={INPUT_CLS}
                value={f.name}
                onChange={(e) => setEditing({ ...editing, form: { ...f, name: e.target.value } })}
              />
            </Field>
            <Field label="Rate type">
              <select
                className={INPUT_CLS}
                value={f.rateType}
                onChange={(e) => setEditing({ ...editing, form: { ...f, rateType: e.target.value } })}
              >
                {OT_RATE_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {prettyEnum(r)}
                  </option>
                ))}
              </select>
            </Field>
            {f.rateType === 'FLAT_HOURLY' ? (
              <Field label="Flat hourly rate (₹)">
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.flatRate}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, flatRate: e.target.value } })}
                />
              </Field>
            ) : (
              <Field label="Multiplier (× normal hourly)">
                <input
                  className={INPUT_CLS}
                  type="number"
                  step="0.1"
                  value={f.multiplier}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, multiplier: e.target.value } })}
                />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min minutes to qualify">
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.minMinutes}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, minMinutes: e.target.value } })}
                />
              </Field>
              <Field label="Max hours / day">
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.maxHoursPerDay}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, maxHoursPerDay: e.target.value } })}
                />
              </Field>
              <Field label="Max hours / month">
                <input
                  className={INPUT_CLS}
                  type="number"
                  value={f.maxHoursPerMonth}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, maxHoursPerMonth: e.target.value } })}
                />
              </Field>
              <Field label="Grade">
                <input
                  className={INPUT_CLS}
                  value={f.grade}
                  onChange={(e) => setEditing({ ...editing, form: { ...f, grade: e.target.value } })}
                />
              </Field>
            </div>
            <CheckToggle
              label="Requires approval"
              checked={f.requiresApproval}
              onChange={(v) => setEditing({ ...editing, form: { ...f, requiresApproval: v } })}
            />
            <CheckToggle
              label="Active"
              checked={f.isActive}
              onChange={(v) => setEditing({ ...editing, form: { ...f, isActive: v } })}
            />
          </SlidePanel>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function SalaryStructuresSection() {
  const [tab, setTab] = useState('components');

  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { id: 'components', label: 'Components' },
          { id: 'structures', label: 'Structures' },
          { id: 'cycles', label: 'Pay cycles' },
          { id: 'overtime', label: 'Overtime rules' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'components' && <ComponentsTab />}
      {tab === 'structures' && <StructuresTab />}
      {tab === 'cycles' && <CyclesTab />}
      {tab === 'overtime' && <OvertimeTab />}
    </div>
  );
}
