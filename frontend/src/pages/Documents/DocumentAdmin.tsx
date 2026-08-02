import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Search, Plus, Pencil, Ban, Trash2, Info, RefreshCw } from 'lucide-react';
import { documentApi } from '../../api/documents';
import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategoryCode,
  type DocumentType,
  type DocumentRequirement,
} from '../../types/documents';
import {
  PageHeader,
  Chip,
  TableShell,
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LABEL_CLS,
  BTN_PRIMARY,
  BTN_SECONDARY,
} from '../../components/common/HrmsUI';
import { TabBar } from '../../components/common/TabBar';
import { ModalShell } from '../../components/common/ModalShell';

const CATEGORY_CODES = Object.keys(DOCUMENT_CATEGORY_LABELS) as DocumentCategoryCode[];

const errMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

// ---------------------------------------------------------------------------
// Type form
// ---------------------------------------------------------------------------

interface TypeForm {
  code: string;
  name: string;
  category: DocumentCategoryCode;
  description: string;
  country: string;
  isMandatory: boolean;
  requiresExpiry: boolean;
  requiresApproval: boolean;
  requiresVerification: boolean;
  allowsMultiple: boolean;
  isConfidential: boolean;
  retentionMonths: string;
  renewalReminderDays: string;
  maxFileMb: string;
  sortOrder: string;
}

const EMPTY_TYPE_FORM: TypeForm = {
  code: '',
  name: '',
  category: 'OTHER',
  description: '',
  country: '',
  isMandatory: false,
  requiresExpiry: false,
  requiresApproval: false,
  requiresVerification: true,
  allowsMultiple: false,
  isConfidential: false,
  retentionMonths: '',
  renewalReminderDays: '30',
  maxFileMb: '10',
  sortOrder: '0',
};

function toForm(type: DocumentType): TypeForm {
  return {
    code: type.code ?? '',
    name: type.name ?? '',
    category: (type.category ?? 'OTHER') as DocumentCategoryCode,
    description: type.description ?? '',
    country: type.country ?? '',
    isMandatory: Boolean(type.isMandatory),
    requiresExpiry: Boolean(type.requiresExpiry),
    requiresApproval: Boolean(type.requiresApproval),
    requiresVerification: Boolean(type.requiresVerification),
    allowsMultiple: Boolean(type.allowsMultiple),
    isConfidential: Boolean(type.isConfidential),
    retentionMonths: type.retentionMonths === null || type.retentionMonths === undefined ? '' : String(type.retentionMonths),
    renewalReminderDays: String(type.renewalReminderDays ?? 30),
    maxFileMb: String(type.maxFileMb ?? 10),
    sortOrder: String(type.sortOrder ?? 0),
  };
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5 px-3 py-2 rounded-md border border-border-light bg-bg-secondary cursor-pointer hover:bg-bg-hover transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-[var(--color-primary)]"
      />
      <span className="min-w-0">
        <span className="block text-sm text-text-primary">{label}</span>
        {hint && <span className="block text-[11px] text-text-muted">{hint}</span>}
      </span>
    </label>
  );
}

function TypeFormModal({
  initial,
  editing,
  onClose,
  onSaved,
}: {
  initial: TypeForm;
  editing: DocumentType | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<TypeForm>(initial);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof TypeForm>(key: K, value: TypeForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const numberOrNull = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const submit = () => {
    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();
    if (!code) {
      window.alert('A code is required.');
      return;
    }
    if (!name) {
      window.alert('A name is required.');
      return;
    }
    const maxFileMb = numberOrNull(form.maxFileMb) ?? 10;
    if (maxFileMb < 1 || maxFileMb > 50) {
      window.alert('Max file size must be between 1 and 50 MB.');
      return;
    }
    const country = form.country.trim().toUpperCase();
    if (country && country.length !== 2) {
      window.alert('Country must be a 2-letter code, or blank for all countries.');
      return;
    }

    const body: Partial<DocumentType> = {
      code,
      name,
      category: form.category,
      description: form.description.trim() || null,
      country: country || null,
      isMandatory: form.isMandatory,
      requiresExpiry: form.requiresExpiry,
      requiresApproval: form.requiresApproval,
      requiresVerification: form.requiresVerification,
      allowsMultiple: form.allowsMultiple,
      isConfidential: form.isConfidential,
      retentionMonths: numberOrNull(form.retentionMonths),
      renewalReminderDays: numberOrNull(form.renewalReminderDays) ?? 30,
      maxFileMb,
      sortOrder: numberOrNull(form.sortOrder) ?? 0,
    };

    setSaving(true);
    const request = editing ? documentApi.updateType(editing.id, body) : documentApi.createType(body);
    request
      .then(() => onSaved())
      .catch((err: unknown) => window.alert(errMessage(err, 'Failed to save the document type')))
      .finally(() => setSaving(false));
  };

  return (
    <ModalShell
      title={editing ? `Edit ${editing.code}` : 'New document type'}
      subtitle={editing ? editing.name : 'Defines what can be collected and how it is policed'}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className={BTN_SECONDARY} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className={BTN_PRIMARY} onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create type'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS} htmlFor="type-code">
              Code *
            </label>
            <input
              id="type-code"
              className={`${INPUT_CLS} font-mono uppercase`}
              value={form.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              placeholder="PAN_CARD"
              disabled={Boolean(editing)}
            />
            <p className="text-text-muted text-[11px] mt-1">
              {editing ? 'The code is fixed once documents reference it.' : 'Uppercase, unique across all types.'}
            </p>
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="type-name">
              Name *
            </label>
            <input
              id="type-name"
              className={INPUT_CLS}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="PAN card"
            />
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="type-category">
              Category
            </label>
            <select
              id="type-category"
              className={INPUT_CLS}
              value={form.category}
              onChange={(e) => set('category', e.target.value as DocumentCategoryCode)}
            >
              {CATEGORY_CODES.map((code) => (
                <option key={code} value={code}>
                  {DOCUMENT_CATEGORY_LABELS[code]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="type-country">
              Country
            </label>
            <input
              id="type-country"
              className={`${INPUT_CLS} uppercase`}
              maxLength={2}
              value={form.country}
              onChange={(e) => set('country', e.target.value.toUpperCase())}
              placeholder="IN"
            />
            <p className="text-text-muted text-[11px] mt-1">Two-letter code. Leave blank to apply everywhere.</p>
          </div>
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="type-description">
            Description
          </label>
          <textarea
            id="type-description"
            className={`${INPUT_CLS} min-h-[70px]`}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="What this document is and when it is collected"
          />
        </div>

        <div>
          <p className={LABEL_CLS}>Policy</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Toggle
              label="Mandatory"
              hint="Counts against the compliance score"
              checked={form.isMandatory}
              onChange={(v) => set('isMandatory', v)}
            />
            <Toggle
              label="Expiry required"
              hint="An expiry date must be supplied on upload"
              checked={form.requiresExpiry}
              onChange={(v) => set('requiresExpiry', v)}
            />
            <Toggle
              label="Approval required"
              hint="Needs sign-off after verification"
              checked={form.requiresApproval}
              onChange={(v) => set('requiresApproval', v)}
            />
            <Toggle
              label="Verification required"
              hint="HR must confirm the document against the original"
              checked={form.requiresVerification}
              onChange={(v) => set('requiresVerification', v)}
            />
            <Toggle
              label="Multiple allowed"
              hint="More than one live document of this type per employee"
              checked={form.allowsMultiple}
              onChange={(v) => set('allowsMultiple', v)}
            />
            <Toggle
              label="Confidential"
              hint="Restricted to privileged roles"
              checked={form.isConfidential}
              onChange={(v) => set('isConfidential', v)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className={LABEL_CLS} htmlFor="type-retention">
              Retention (months)
            </label>
            <input
              id="type-retention"
              type="number"
              min={0}
              className={INPUT_CLS}
              value={form.retentionMonths}
              onChange={(e) => set('retentionMonths', e.target.value)}
              placeholder="Blank = forever"
            />
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="type-reminder">
              Renewal reminder (days)
            </label>
            <input
              id="type-reminder"
              type="number"
              min={0}
              className={INPUT_CLS}
              value={form.renewalReminderDays}
              onChange={(e) => set('renewalReminderDays', e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="type-maxsize">
              Max file (MB)
            </label>
            <input
              id="type-maxsize"
              type="number"
              min={1}
              max={50}
              className={INPUT_CLS}
              value={form.maxFileMb}
              onChange={(e) => set('maxFileMb', e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="type-sort">
              Sort order
            </label>
            <input
              id="type-sort"
              type="number"
              className={INPUT_CLS}
              value={form.sortOrder}
              onChange={(e) => set('sortOrder', e.target.value)}
            />
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Requirement form
// ---------------------------------------------------------------------------

interface RequirementForm {
  documentTypeId: string;
  country: string;
  employmentType: string;
  workerType: string;
  grade: string;
  department: string;
  isMandatory: boolean;
  dueDaysAfterJoining: string;
  notes: string;
}

type ScopeKey = 'country' | 'employmentType' | 'workerType' | 'grade' | 'department';

const EMPTY_REQ_FORM: RequirementForm = {
  documentTypeId: '',
  country: '',
  employmentType: '',
  workerType: '',
  grade: '',
  department: '',
  isMandatory: true,
  dueDaysAfterJoining: '',
  notes: '',
};

const WILDCARD_HINT = 'Leave blank to apply to everyone.';

function RequirementFormModal({
  types,
  onClose,
  onSaved,
}: {
  types: DocumentType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RequirementForm>(EMPTY_REQ_FORM);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof RequirementForm>(key: K, value: RequirementForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const scopeFields: { key: ScopeKey; label: string; placeholder: string }[] = [
    { key: 'country', label: 'Country', placeholder: 'IN' },
    { key: 'employmentType', label: 'Employment type', placeholder: 'PERMANENT' },
    { key: 'workerType', label: 'Worker type', placeholder: 'KARIGAR' },
    { key: 'grade', label: 'Grade', placeholder: 'A' },
    { key: 'department', label: 'Department', placeholder: 'Polishing' },
  ];

  const submit = () => {
    const typeId = Number(form.documentTypeId);
    if (!Number.isFinite(typeId) || typeId <= 0) {
      window.alert('Select a document type.');
      return;
    }
    const dueRaw = form.dueDaysAfterJoining.trim();
    const dueDays = dueRaw === '' ? null : Number(dueRaw);
    if (dueDays !== null && !Number.isFinite(dueDays)) {
      window.alert('Due days must be a number, or blank.');
      return;
    }

    const body: Partial<DocumentRequirement> = {
      documentTypeId: typeId,
      country: form.country.trim().toUpperCase() || null,
      employmentType: form.employmentType.trim() || null,
      workerType: form.workerType.trim() || null,
      grade: form.grade.trim() || null,
      department: form.department.trim() || null,
      isMandatory: form.isMandatory,
      dueDaysAfterJoining: dueDays,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    documentApi
      .createRequirement(body)
      .then(() => onSaved())
      .catch((err: unknown) => window.alert(errMessage(err, 'Failed to create the requirement')))
      .finally(() => setSaving(false));
  };

  return (
    <ModalShell
      title="New requirement"
      subtitle="Decides which employees must supply a document type"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className={BTN_SECONDARY} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className={BTN_PRIMARY} onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Create requirement'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={LABEL_CLS} htmlFor="req-type">
            Document type *
          </label>
          <select
            id="req-type"
            className={INPUT_CLS}
            value={form.documentTypeId}
            onChange={(e) => set('documentTypeId', e.target.value)}
          >
            <option value="">Select a document type…</option>
            {types.map((type) => (
              <option key={type.id} value={String(type.id)}>
                {type.code} — {type.name}
              </option>
            ))}
          </select>
        </div>

        <div className="px-3 py-2 rounded-md bg-info-light border border-info/30 text-info text-xs">
          Every scope field left blank acts as a wildcard. A requirement with all five blank applies to the whole
          workforce.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {scopeFields.map((field) => (
            <div key={field.key}>
              <label className={LABEL_CLS} htmlFor={`req-${field.key}`}>
                {field.label}
              </label>
              <input
                id={`req-${field.key}`}
                className={INPUT_CLS}
                value={form[field.key]}
                onChange={(e) => set(field.key, e.target.value)}
                placeholder={field.placeholder}
              />
              <p className="text-text-muted text-[11px] mt-1">{WILDCARD_HINT}</p>
            </div>
          ))}

          <div>
            <label className={LABEL_CLS} htmlFor="req-due">
              Due days after joining
            </label>
            <input
              id="req-due"
              type="number"
              min={0}
              className={INPUT_CLS}
              value={form.dueDaysAfterJoining}
              onChange={(e) => set('dueDaysAfterJoining', e.target.value)}
              placeholder="30"
            />
            <p className="text-text-muted text-[11px] mt-1">Blank means there is no deadline.</p>
          </div>
        </div>

        <Toggle
          label="Mandatory"
          hint="Mandatory requirements count towards the compliance score"
          checked={form.isMandatory}
          onChange={(v) => set('isMandatory', v)}
        />

        <div>
          <label className={LABEL_CLS} htmlFor="req-notes">
            Notes
          </label>
          <textarea
            id="req-notes"
            className={`${INPUT_CLS} min-h-[60px]`}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Why this document is required for this group"
          />
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function TypeFlags({ type }: { type: DocumentType }) {
  const flags: { label: string; on: boolean; tone: 'primary' | 'warning' | 'info' | 'success' | 'danger' | 'default' }[] =
    [
      { label: 'Mandatory', on: Boolean(type.isMandatory), tone: 'primary' },
      { label: 'Expiry', on: Boolean(type.requiresExpiry), tone: 'warning' },
      { label: 'Approval', on: Boolean(type.requiresApproval), tone: 'info' },
      { label: 'Verification', on: Boolean(type.requiresVerification), tone: 'info' },
      { label: 'Multiple', on: Boolean(type.allowsMultiple), tone: 'default' },
      { label: 'Confidential', on: Boolean(type.isConfidential), tone: 'danger' },
    ];
  const active = flags.filter((flag) => flag.on);
  if (active.length === 0) return <span className="text-text-muted text-xs">—</span>;
  return (
    <div className="flex items-center gap-1 flex-wrap max-w-[280px]">
      {active.map((flag) => (
        <Chip key={flag.label} label={flag.label} tone={flag.tone} />
      ))}
    </div>
  );
}

export function DocumentAdmin() {
  const [tab, setTab] = useState('types');

  const [types, setTypes] = useState<DocumentType[]>([]);
  const [requirements, setRequirements] = useState<DocumentRequirement[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadingReqs, setLoadingReqs] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState('');

  const [typeModal, setTypeModal] = useState<{ initial: TypeForm; editing: DocumentType | null } | null>(null);
  const [reqModal, setReqModal] = useState(false);

  const loadTypes = useCallback(() => {
    setLoadingTypes(true);
    documentApi
      .types()
      .then((rows) => setTypes(rows ?? []))
      .catch((err: unknown) => {
        setTypes([]);
        setError(errMessage(err, 'Failed to load document types'));
      })
      .finally(() => setLoadingTypes(false));
  }, []);

  const loadRequirements = useCallback(() => {
    setLoadingReqs(true);
    documentApi
      .requirements()
      .then((rows) => setRequirements(rows ?? []))
      .catch((err: unknown) => {
        setRequirements([]);
        setError(errMessage(err, 'Failed to load requirements'));
      })
      .finally(() => setLoadingReqs(false));
  }, []);

  useEffect(() => {
    loadTypes();
    loadRequirements();
  }, [loadTypes, loadRequirements]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const type of types) {
      const key = type.category ?? 'OTHER';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [types]);

  const visibleTypes = useMemo(() => {
    const term = search.trim().toLowerCase();
    return types.filter((type) => {
      if (category && type.category !== category) return false;
      if (!term) return true;
      return (
        (type.code ?? '').toLowerCase().includes(term) ||
        (type.name ?? '').toLowerCase().includes(term) ||
        (type.description ?? '').toLowerCase().includes(term)
      );
    });
  }, [types, category, search]);

  const typeNameById = useMemo(() => {
    const map = new Map<number, DocumentType>();
    for (const type of types) map.set(type.id, type);
    return map;
  }, [types]);

  const deactivate = (type: DocumentType) => {
    if (
      !window.confirm(
        `Deactivate "${type.name}"? It stays on existing documents but can no longer be selected for new uploads.`,
      )
    ) {
      return;
    }
    documentApi
      .deleteType(type.id)
      .then(() => loadTypes())
      .catch((err: unknown) => window.alert(errMessage(err, 'Failed to deactivate the document type')));
  };

  const removeRequirement = (req: DocumentRequirement) => {
    if (!window.confirm('Delete this requirement? Employees in scope will no longer be asked for the document.')) return;
    documentApi
      .deleteRequirement(req.id)
      .then(() => loadRequirements())
      .catch((err: unknown) => window.alert(errMessage(err, 'Failed to delete the requirement')));
  };

  const scopeCell = (value: string | null) =>
    value ? (
      <span className="text-text-primary">{value}</span>
    ) : (
      <span className="text-text-muted" title="Applies to everyone">
        Any
      </span>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Document administration"
        subtitle="The catalogue of document types and the rules that decide who must supply them"
        actions={
          <>
            <button
              onClick={() => {
                loadTypes();
                loadRequirements();
              }}
              className={`${BTN_SECONDARY} inline-flex items-center gap-2`}
            >
              <RefreshCw size={14} className={loadingTypes || loadingReqs ? 'animate-spin' : ''} /> Refresh
            </button>
            {tab === 'types' ? (
              <button
                onClick={() => setTypeModal({ initial: EMPTY_TYPE_FORM, editing: null })}
                className={`${BTN_PRIMARY} inline-flex items-center gap-2`}
              >
                <Plus size={14} /> New type
              </button>
            ) : (
              <button onClick={() => setReqModal(true)} className={`${BTN_PRIMARY} inline-flex items-center gap-2`}>
                <Plus size={14} /> New requirement
              </button>
            )}
          </>
        }
      />

      {error && <ErrorBlock message={error} />}

      <TabBar
        tabs={[
          { id: 'types', label: 'Document types', count: types.length },
          { id: 'rules', label: 'Requirements', count: requirements.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'types' ? (
        <div className="space-y-4">
          <div className="px-3 py-2 rounded-md bg-bg-secondary border border-border-light text-text-secondary text-xs inline-flex items-start gap-2">
            <Info size={14} className="mt-0.5 flex-shrink-0 text-text-muted" />
            <span>
              The catalogue ships with 116 seeded types across 16 categories. Deactivate rather than delete — history
              and existing documents keep pointing at the type.
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setCategory('')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                category === ''
                  ? 'bg-primary-light border-primary/30 text-primary'
                  : 'border-border-default text-text-muted hover:border-text-muted'
              }`}
            >
              All <span className="ml-1.5">({types.length})</span>
            </button>
            {CATEGORY_CODES.filter((code) => (categoryCounts.get(code) ?? 0) > 0).map((code) => (
              <button
                key={code}
                onClick={() => setCategory(code)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                  category === code
                    ? 'bg-primary-light border-primary/30 text-primary'
                    : 'border-border-default text-text-muted hover:border-text-muted'
                }`}
              >
                {DOCUMENT_CATEGORY_LABELS[code]} <span className="ml-1.5">({categoryCounts.get(code) ?? 0})</span>
              </button>
            ))}
          </div>

          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              className={`${INPUT_CLS} pl-8`}
              placeholder="Search code, name or description"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loadingTypes ? (
            <LoadingBlock label="Loading document types…" />
          ) : visibleTypes.length === 0 ? (
            <EmptyBlock
              message={types.length === 0 ? 'No document types configured' : 'No type matches these filters'}
              hint={types.length === 0 ? 'Create a type to start collecting documents' : undefined}
            />
          ) : (
            <TableShell
              headers={[
                'Code',
                'Name',
                'Category',
                'Country',
                'Flags',
                'Retention',
                'Max size',
                'Active',
                'Actions',
              ]}
            >
              {visibleTypes.map((type) => (
                <tr key={type.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs font-mono text-text-primary whitespace-nowrap">{type.code}</td>
                  <td className="px-3 py-2">
                    <p className="text-sm text-text-primary">{type.name}</p>
                    {type.description && (
                      <p className="text-[11px] text-text-muted truncate max-w-[240px]">{type.description}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">
                    {DOCUMENT_CATEGORY_LABELS[type.category] ?? type.category}
                  </td>
                  <td className="px-3 py-2 text-sm text-text-secondary">{type.country ?? 'Any'}</td>
                  <td className="px-3 py-2">
                    <TypeFlags type={type} />
                  </td>
                  <td className="px-3 py-2 text-sm text-text-secondary tabular-nums whitespace-nowrap">
                    {type.retentionMonths === null || type.retentionMonths === undefined
                      ? '—'
                      : `${type.retentionMonths} mo`}
                  </td>
                  <td className="px-3 py-2 text-sm text-text-secondary tabular-nums whitespace-nowrap">
                    {type.maxFileMb ? `${type.maxFileMb} MB` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Chip label={type.isActive ? 'Active' : 'Inactive'} tone={type.isActive ? 'success' : 'default'} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setTypeModal({ initial: toForm(type), editing: type })}
                        title="Edit"
                        className="p-1.5 rounded-md text-text-muted hover:text-primary hover:bg-bg-hover transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      {type.isActive && (
                        <button
                          onClick={() => deactivate(type)}
                          title="Deactivate"
                          className="p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-bg-hover transition-colors"
                        >
                          <Ban size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-text-secondary text-xs">
            A requirement links a document type to a slice of the workforce. Blank scope fields are wildcards, so a rule
            with no scope applies to everyone.
          </p>

          {loadingReqs ? (
            <LoadingBlock label="Loading requirements…" />
          ) : requirements.length === 0 ? (
            <EmptyBlock
              message="No requirements configured"
              hint="Without requirements the compliance score has nothing to measure against"
            />
          ) : (
            <TableShell
              headers={[
                'Document type',
                'Country',
                'Employment type',
                'Worker type',
                'Grade',
                'Department',
                'Mandatory',
                'Due days',
                'Notes',
                '',
              ]}
            >
              {requirements.map((req) => {
                const type = typeNameById.get(req.documentTypeId);
                return (
                  <tr key={req.id} className="hover:bg-bg-hover transition-colors">
                    <td className="px-3 py-2">
                      <p className="text-sm text-text-primary">
                        {req.typeName ?? type?.name ?? `Type #${req.documentTypeId}`}
                      </p>
                      <p className="text-[11px] text-text-muted font-mono">{req.typeCode ?? type?.code ?? ''}</p>
                    </td>
                    <td className="px-3 py-2 text-sm">{scopeCell(req.country)}</td>
                    <td className="px-3 py-2 text-sm">{scopeCell(req.employmentType)}</td>
                    <td className="px-3 py-2 text-sm">{scopeCell(req.workerType)}</td>
                    <td className="px-3 py-2 text-sm">{scopeCell(req.grade)}</td>
                    <td className="px-3 py-2 text-sm">{scopeCell(req.department)}</td>
                    <td className="px-3 py-2">
                      <Chip
                        label={req.isMandatory ? 'Mandatory' : 'Optional'}
                        tone={req.isMandatory ? 'primary' : 'default'}
                      />
                    </td>
                    <td className="px-3 py-2 text-sm text-text-secondary tabular-nums whitespace-nowrap">
                      {req.dueDaysAfterJoining === null || req.dueDaysAfterJoining === undefined
                        ? '—'
                        : `${req.dueDaysAfterJoining} d`}
                    </td>
                    <td className="px-3 py-2 text-sm text-text-secondary">
                      <span className="block truncate max-w-[200px]">{req.notes ?? '—'}</span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => removeRequirement(req)}
                        title="Delete requirement"
                        className="p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-bg-hover transition-colors"
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
      )}

      <AnimatePresence>
        {typeModal && (
          <TypeFormModal
            initial={typeModal.initial}
            editing={typeModal.editing}
            onClose={() => setTypeModal(null)}
            onSaved={() => {
              setTypeModal(null);
              loadTypes();
            }}
          />
        )}
        {reqModal && (
          <RequirementFormModal
            types={types.filter((type) => type.isActive)}
            onClose={() => setReqModal(false)}
            onSaved={() => {
              setReqModal(false);
              loadRequirements();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
