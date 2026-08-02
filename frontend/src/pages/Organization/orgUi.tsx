// Shared presentation + form primitives for the Organization page family.
// Seventeen entity types share one declarative form modal, so the field
// descriptors live with each screen and the rendering lives here.
import { useState } from 'react';
import {
  Building2,
  Landmark,
  Boxes,
  Layers,
  Network,
  Building,
  MapPin,
  Globe,
  Wallet,
  UsersRound,
  Briefcase,
  User,
  CircleDot,
} from 'lucide-react';
import { Chip, INPUT_CLS, LABEL_CLS, BTN_PRIMARY, BTN_SECONDARY } from '../../components/common/HrmsUI';
import { ModalShell } from '../../components/common/ModalShell';

// ---------------------------------------------------------------------------
// Errors + formatters (date-fns is not installed)
// ---------------------------------------------------------------------------

export const errMsg = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `02 Aug 2026`. Accepts `YYYY-MM-DD` and full ISO timestamps. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) {
    const month = MONTHS[Number(m[2]) - 1] ?? m[2];
    return `${m[3]} ${month} ${m[1]}`;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

/** `YYYY-MM-DD` for `<input type="date">`, tolerant of timestamps and nulls. */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso));
  return m ? m[1] : '';
}

// ---------------------------------------------------------------------------
// Iconography + chips
// ---------------------------------------------------------------------------

type IconComponent = React.ComponentType<{ size?: number | string; className?: string }>;

const ENTITY_ICONS: Record<string, IconComponent> = {
  company: Building2,
  legal_entity: Landmark,
  business_unit: Boxes,
  division: Layers,
  department: Network,
  branch: Building,
  location: MapPin,
  region: Globe,
  cost_center: Wallet,
  team: UsersRound,
  position: Briefcase,
  employee: User,
};

export function EntityIcon({
  entityType,
  size = 16,
  className = 'text-text-muted',
}: {
  entityType: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const Icon = ENTITY_ICONS[String(entityType ?? '')] ?? CircleDot;
  return <Icon size={size} className={className} />;
}

type ChipTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const STATUS_TONES: Record<string, ChipTone> = {
  ACTIVE: 'success',
  FILLED: 'success',
  COMPLETED: 'success',
  INACTIVE: 'default',
  CLOSED: 'danger',
  DISSOLVED: 'danger',
  REJECTED: 'danger',
  ON_HOLD: 'warning',
  DRAFT: 'warning',
  PENDING: 'warning',
  OPEN: 'info',
};

/** Status pill with the org colour conventions applied. */
export function OrgStatusChip({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-text-muted text-xs">—</span>;
  const key = String(status).toUpperCase();
  const tone = STATUS_TONES[key] ?? 'default';
  const label = key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, ' ');
  return <Chip label={label} tone={tone} dot />;
}

/** Headcount with an `+N open` suffix when the unit still has vacancies. */
export function HeadcountPill({
  count,
  vacancies,
}: {
  count: number | null | undefined;
  vacancies?: number | null;
}) {
  const open = Number(vacancies ?? 0);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-bg-secondary border border-border-light text-text-secondary text-[10px] font-medium tabular-nums">
        {Number(count ?? 0)}
      </span>
      {open > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-warning-light text-warning border border-warning/30 text-[10px] font-medium tabular-nums">
          +{open} open
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

export interface SelectOption {
  value: string | number;
  label: string;
}

interface FieldShellProps {
  label: string;
  children: React.ReactNode;
  error?: string | null;
  hint?: string | null;
  required?: boolean;
  className?: string;
}

export function FormField({ label, children, error, hint, required, className }: FieldShellProps) {
  return (
    <div className={className}>
      <label className={LABEL_CLS}>
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-danger text-[9px] mt-1">{error}</p>
      ) : hint ? (
        <p className="text-text-muted text-[9px] mt-1">{hint}</p>
      ) : null}
    </div>
  );
}

const errCls = (error?: string | null) => (error ? `${INPUT_CLS} border-danger` : INPUT_CLS);

interface CommonFieldProps {
  label: string;
  error?: string | null;
  hint?: string | null;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export function TextField({
  value,
  onChange,
  placeholder,
  type = 'text',
  ...rest
}: CommonFieldProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'date' | 'email' | 'tel' | 'url';
}) {
  return (
    <FormField {...rest}>
      <input
        type={type}
        className={errCls(rest.error)}
        value={value}
        placeholder={placeholder}
        disabled={rest.disabled}
        aria-label={rest.label}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  );
}

export function NumberField({
  value,
  onChange,
  placeholder,
  min,
  max,
  step,
  ...rest
}: CommonFieldProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number | string;
}) {
  return (
    <FormField {...rest}>
      <input
        type="number"
        className={errCls(rest.error)}
        value={value}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        disabled={rest.disabled}
        aria-label={rest.label}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  );
}

export function SelectField({
  value,
  onChange,
  options,
  placeholder = '— none —',
  ...rest
}: CommonFieldProps & {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}) {
  return (
    <FormField {...rest}>
      <select
        className={errCls(rest.error)}
        value={value}
        disabled={rest.disabled}
        aria-label={rest.label}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}

export function TextareaField({
  value,
  onChange,
  placeholder,
  rows = 3,
  ...rest
}: CommonFieldProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <FormField {...rest}>
      <textarea
        className={`${errCls(rest.error)} resize-y`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={rest.disabled}
        aria-label={rest.label}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  );
}

export function ToggleField({
  value,
  onChange,
  label,
  hint,
  disabled,
  className,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className={LABEL_CLS}>{label}</label>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors disabled:opacity-50 ${
          value
            ? 'bg-primary-light border-primary/30 text-primary'
            : 'bg-bg-secondary border-border-default text-text-muted'
        }`}
      >
        <span
          className={`w-8 h-4 rounded-full relative transition-colors ${value ? 'bg-primary' : 'bg-border-default'}`}
        >
          <span
            className={`absolute top-0.5 w-3 h-3 rounded-full bg-bg-card transition-all ${
              value ? 'left-4.5 translate-x-0' : 'left-0.5'
            }`}
          />
        </span>
        {value ? 'Yes' : 'No'}
      </button>
      {hint && <p className="text-text-muted text-[9px] mt-1">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Declarative entity form modal
// ---------------------------------------------------------------------------

export type FieldType = 'text' | 'number' | 'select' | 'textarea' | 'toggle' | 'date';

export interface FieldDescriptor {
  key: string;
  label: string;
  type: FieldType;
  options?: SelectOption[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** Coerce the submitted select value to a number (foreign keys). */
  numeric?: boolean;
  /** Span both columns in the two-column grid. */
  full?: boolean;
}

type FormState = Record<string, string | boolean>;

function seedValues(fields: FieldDescriptor[], initial: Record<string, unknown> | null | undefined): FormState {
  const out: FormState = {};
  for (const f of fields) {
    const raw = initial ? initial[f.key] : undefined;
    if (f.type === 'toggle') {
      out[f.key] = raw === true || raw === 1 || raw === '1';
    } else if (f.type === 'date') {
      out[f.key] = toDateInput(typeof raw === 'string' ? raw : null);
    } else {
      out[f.key] = raw === null || raw === undefined ? '' : String(raw);
    }
  }
  return out;
}

export interface EntityFormModalProps {
  title: string;
  subtitle?: string | null;
  fields: FieldDescriptor[];
  initial?: Record<string, unknown> | null;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  submitting?: boolean;
  submitLabel?: string;
  maxWidth?: string;
}

/**
 * One modal drives every entity form. Field descriptors keep seventeen CRUD
 * screens from becoming seventeen hand-written dialogs.
 */
export function EntityFormModal({
  title,
  subtitle,
  fields,
  initial,
  onClose,
  onSubmit,
  submitting = false,
  submitLabel = 'Save',
  maxWidth = 'max-w-2xl',
}: EntityFormModalProps) {
  const [values, setValues] = useState<FormState>(() => seedValues(fields, initial));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (key: string, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: '' } : prev));
  };

  const handleSubmit = () => {
    const nextErrors: Record<string, string> = {};
    for (const f of fields) {
      if (!f.required || f.type === 'toggle') continue;
      if (String(values[f.key] ?? '').trim() === '') nextErrors[f.key] = 'Required';
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.key];
      if (f.type === 'toggle') {
        payload[f.key] = raw === true;
      } else if (f.type === 'number') {
        payload[f.key] = String(raw ?? '') === '' ? null : Number(raw);
      } else if (f.type === 'select' && f.numeric) {
        payload[f.key] = String(raw ?? '') === '' ? null : Number(raw);
      } else {
        payload[f.key] = String(raw ?? '') === '' ? null : String(raw);
      }
    }
    void onSubmit(payload);
  };

  return (
    <ModalShell
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      maxWidth={maxWidth}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className={BTN_PRIMARY} onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving…' : submitLabel}
          </button>
        </div>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {fields.map((f) => {
          const span = f.full || f.type === 'textarea' ? 'sm:col-span-2' : '';
          const error = errors[f.key] || null;
          const stringValue = String(values[f.key] ?? '');

          if (f.type === 'toggle') {
            return (
              <ToggleField
                key={f.key}
                className={span}
                label={f.label}
                hint={f.hint}
                value={values[f.key] === true}
                onChange={(v) => set(f.key, v)}
                disabled={submitting}
              />
            );
          }
          if (f.type === 'select') {
            return (
              <SelectField
                key={f.key}
                className={span}
                label={f.label}
                hint={f.hint}
                required={f.required}
                error={error}
                options={f.options ?? []}
                value={stringValue}
                onChange={(v) => set(f.key, v)}
                disabled={submitting}
              />
            );
          }
          if (f.type === 'textarea') {
            return (
              <TextareaField
                key={f.key}
                className={span}
                label={f.label}
                hint={f.hint}
                required={f.required}
                error={error}
                placeholder={f.placeholder}
                value={stringValue}
                onChange={(v) => set(f.key, v)}
                disabled={submitting}
              />
            );
          }
          if (f.type === 'number') {
            return (
              <NumberField
                key={f.key}
                className={span}
                label={f.label}
                hint={f.hint}
                required={f.required}
                error={error}
                placeholder={f.placeholder}
                value={stringValue}
                onChange={(v) => set(f.key, v)}
                disabled={submitting}
              />
            );
          }
          return (
            <TextField
              key={f.key}
              className={span}
              label={f.label}
              hint={f.hint}
              required={f.required}
              error={error}
              placeholder={f.placeholder}
              type={f.type === 'date' ? 'date' : 'text'}
              value={stringValue}
              onChange={(v) => set(f.key, v)}
              disabled={submitting}
            />
          );
        })}
        {/* Lets Enter submit without a visible duplicate button. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Misc shared bits
// ---------------------------------------------------------------------------

/** Small inline label/value row used by the tree detail panel. */
export function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border-light last:border-0">
      <span className="text-text-muted text-[10px] uppercase tracking-wider shrink-0">{label}</span>
      <span className="text-text-primary text-xs text-right break-words">{value ?? '—'}</span>
    </div>
  );
}

/** Horizontal usage bar; turns danger once the value exceeds the ceiling. */
export function CapacityBar({ used, total }: { used: number; total: number | null | undefined }) {
  const cap = Number(total ?? 0);
  if (!cap) {
    return <span className="text-text-muted text-xs tabular-nums">{used} / —</span>;
  }
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const over = used > cap;
  return (
    <div className="min-w-[110px]">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className={`text-[10px] tabular-nums ${over ? 'text-danger' : 'text-text-secondary'}`}>
          {used} / {cap}
        </span>
        {over && <span className="text-danger text-[9px] font-medium">over</span>}
      </div>
      <div className="h-1.5 rounded-full bg-bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-primary'}`}
          style={{ width: `${over ? 100 : pct}%` }}
        />
      </div>
    </div>
  );
}
