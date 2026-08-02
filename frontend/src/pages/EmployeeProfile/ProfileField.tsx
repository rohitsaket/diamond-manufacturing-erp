// Shared read/edit primitives for the employee profile sections.
// These are imported by every profile section, so keep the API stable.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { INPUT_CLS, LABEL_CLS, BTN_PRIMARY, BTN_SECONDARY } from '../../components/common/HrmsUI';
import type { EmployeeProfile } from '../../types/hrms';

/**
 * The `/employees/:id/profile` endpoint returns every profile column, which is a
 * superset of the shared `EmployeeProfile` type. The extra keys are declared
 * optional so an older/partial payload still renders instead of crashing.
 */
export interface FullProfile extends EmployeeProfile {
  // Personal
  preferredName?: string | null;
  maritalStatus?: string | null;
  nationality?: string | null;
  religion?: string | null;
  hasDisability?: boolean;
  disabilityDetails?: string | null;
  biography?: string | null;

  // Identity — raw secrets never leave the server, only masked forms.
  passportMasked?: string | null;
  hasPassport?: boolean;
  passportExpiry?: string | null;
  visaNumber?: string | null;
  visaExpiry?: string | null;
  drivingLicense?: string | null;
  voterId?: string | null;
  taxId?: string | null;

  // Contact
  mobile?: string | null;
  alternateMobile?: string | null;
  personalEmail?: string | null;
  officialEmail?: string | null;
  permanentAddress?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  contactPrefEmail?: boolean;
  contactPrefSms?: boolean;
  contactPrefWhatsapp?: boolean;

  // Emergency
  emergencyContactRelation?: string | null;
  emergencyContactAddress?: string | null;
  emergencyAltName?: string | null;
  emergencyAltPhone?: string | null;
  emergencyAltRelation?: string | null;
  medicalContactName?: string | null;
  medicalContactPhone?: string | null;
}

/** Props every identity-owned profile section receives from the page. */
export interface ProfileSectionProps {
  employeeId: number;
  profile: FullProfile;
  onSaved: () => void;
}

/* ------------------------------------------------------------------ */
/* Read-only primitives                                                */
/* ------------------------------------------------------------------ */

export function FieldRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: ReactNode;
  mono?: boolean;
}) {
  const isEmpty = value === null || value === undefined || value === '' || value === false;
  return (
    <div className="min-w-0">
      <p className="text-text-muted text-[10px] uppercase tracking-wider">{label}</p>
      <div className={`text-text-primary text-sm mt-0.5 break-words ${mono ? 'font-mono' : ''}`}>
        {isEmpty ? <span className="text-text-muted">—</span> : value}
      </div>
    </div>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Edit primitives                                                     */
/* ------------------------------------------------------------------ */

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="text-danger text-[9px] mt-0.5">{error}</p>;
}

export function EditText({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <div className="min-w-0">
      <label className={LABEL_CLS}>
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLS} ${error ? 'border-danger' : ''}`}
      />
      <FieldError error={error} />
    </div>
  );
}

export function EditSelect({
  label,
  value,
  onChange,
  options,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  error?: string;
}) {
  return (
    <div className="min-w-0">
      <label className={LABEL_CLS}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLS} ${error ? 'border-danger' : ''}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldError error={error} />
    </div>
  );
}

export function EditTextarea({
  label,
  value,
  onChange,
  rows = 3,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  error?: string;
}) {
  return (
    <div className="min-w-0">
      <label className={LABEL_CLS}>{label}</label>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLS} resize-y ${error ? 'border-danger' : ''}`}
      />
      <FieldError error={error} />
    </div>
  );
}

export function EditToggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <label className={LABEL_CLS}>{label}</label>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="flex items-center gap-2 group"
      >
        <span
          className={`w-9 h-5 rounded-full border transition-colors flex items-center px-0.5 ${
            checked ? 'bg-primary border-primary' : 'bg-bg-hover border-border-default'
          }`}
        >
          <span
            className={`w-4 h-4 rounded-full bg-bg-card shadow-sm transition-transform ${
              checked ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </span>
        <span className="text-text-secondary text-sm">{checked ? 'Yes' : 'No'}</span>
      </button>
      {hint && <p className="text-text-muted text-[9px] mt-0.5">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card wrapper                                                        */
/* ------------------------------------------------------------------ */

export function SectionCard({
  title,
  subtitle,
  editing = false,
  onEdit,
  onCancel,
  onSave,
  saving = false,
  actions,
  children,
}: {
  title: string;
  subtitle?: string | null;
  editing?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onSave?: () => void;
  saving?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-bg-card border border-border-default rounded-md">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border-light flex-wrap">
        <div className="min-w-0">
          <h3 className="text-text-primary font-semibold text-sm">{title}</h3>
          {subtitle && <p className="text-text-muted text-xs mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {editing ? (
            <>
              <button type="button" onClick={onCancel} disabled={saving} className={BTN_SECONDARY}>
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className={`${BTN_PRIMARY} inline-flex items-center gap-1.5`}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Save
              </button>
            </>
          ) : (
            onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className={`${BTN_SECONDARY} inline-flex items-center gap-1.5`}
              >
                <Pencil size={14} /> Edit
              </button>
            )
          )}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers shared by the identity sections                             */
/* ------------------------------------------------------------------ */

/** `2024-05-01T00:00:00.000Z` / `2024-05-01` → `2024-05-01`, else `''`. */
export function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  return String(value).slice(0, 10);
}

/** Human date without pulling in a date library (date-fns is not installed). */
export function formatDate(value: string | null | undefined): string {
  const iso = toDateInput(value);
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Whole years between `dob` and today, or null when unparseable. */
export function ageFromDob(dob: string | null | undefined): number | null {
  const iso = toDateInput(dob);
  if (!iso) return null;
  const born = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const beforeBirthday =
    now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** Days from today until `value`; negative when already past. */
export function daysUntil(value: string | null | undefined): number | null {
  const iso = toDateInput(value);
  if (!iso) return null;
  const target = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/**
 * Photos are stored as bare filenames by the backend, and there is no public
 * route that serves them, so anything that is not an absolute/rooted/data URL
 * cannot be rendered — callers fall back to initials in that case.
 */
export function resolvePhotoSrc(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null;
  return /^(https?:\/\/|data:|blob:|\/)/i.test(photoUrl) ? photoUrl : null;
}

export function initialsOf(name: string | null | undefined): string {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '—';
  return parts
    .map((p) => p[0]!)
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'Something went wrong. Please try again.';

/* ------------------------------------------------------------------ */
/* Edit-state hook                                                     */
/* ------------------------------------------------------------------ */

export interface EditorApi<T> {
  editing: boolean;
  saving: boolean;
  form: T;
  errors: Record<string, string>;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  setMany: (patch: Partial<T>) => void;
  start: () => void;
  cancel: () => void;
  save: () => void;
}

/**
 * Read/edit state for one card. `build` produces the pristine form from the
 * loaded profile and is re-run on save so only genuinely changed keys are sent.
 */
export function useEditableSection<T extends Record<string, string | boolean>>(
  build: () => T,
  commit: (patch: Record<string, unknown>) => Promise<void>,
  validate?: (form: T) => Record<string, string>,
): EditorApi<T> {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<T>(build);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof T>(key: K, value: T[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[String(key)]) return prev;
      const next = { ...prev };
      delete next[String(key)];
      return next;
    });
  };

  const setMany = (patch: Partial<T>) => setForm((prev) => ({ ...prev, ...patch }));

  const start = () => {
    setForm(build());
    setErrors({});
    setEditing(true);
  };

  const cancel = () => {
    setErrors({});
    setEditing(false);
  };

  const save = () => {
    const found = validate ? validate(form) : {};
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    const original = build();
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(form)) {
      const next = form[key];
      const prev = original[key];
      if (next === prev) continue;
      if (typeof next === 'string') {
        const trimmed = next.trim();
        patch[key] = trimmed === '' ? null : trimmed;
      } else {
        patch[key] = next;
      }
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    commit(patch)
      .then(() => {
        setErrors({});
        setEditing(false);
      })
      .catch((err: unknown) => {
        window.alert(errorMessage(err));
      })
      .finally(() => setSaving(false));
  };

  return { editing, saving, form, errors, set, setMany, start, cancel, save };
}

/* ------------------------------------------------------------------ */
/* Light client-side validation mirroring the server rules             */
/* ------------------------------------------------------------------ */

export const isEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
export const isPostalCode = (v: string): boolean => /^\d{6}$/.test(v.trim());
export const isAadhaar = (v: string): boolean => /^\d{12}$/.test(v.replace(/\s/g, ''));
export const isPan = (v: string): boolean => /^[A-Z]{5}\d{4}[A-Z]$/.test(v.trim().toUpperCase());
