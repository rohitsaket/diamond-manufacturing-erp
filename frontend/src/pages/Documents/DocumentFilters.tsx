import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Filter, RotateCcw } from 'lucide-react';
import { INPUT_CLS, LABEL_CLS } from '../../components/common/HrmsUI';
import { useApp } from '../../contexts/AppContext';
import { DOCUMENT_CATEGORY_LABELS, DOCUMENT_STATUS_META } from '../../types/documents';
import type { DocumentCategoryCode, DocumentStatus, DocumentType } from '../../types/documents';
import type { DocumentSearchParams } from '../../api/documents';

const CATEGORY_ENTRIES = Object.entries(DOCUMENT_CATEGORY_LABELS) as [DocumentCategoryCode, string][];
const STATUS_ENTRIES = Object.entries(DOCUMENT_STATUS_META) as [
  DocumentStatus,
  { label: string; tone: string },
][];

const DEBOUNCE_MS = 350;

interface DocumentFiltersProps {
  value: DocumentSearchParams;
  onChange: (next: DocumentSearchParams) => void;
  types: DocumentType[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className={LABEL_CLS}>{title}</p>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 accent-primary cursor-pointer"
      />
      {label}
    </label>
  );
}

/**
 * Left filter rail for the document browser. Free-text inputs are debounced
 * here (350 ms) so the parent only re-queries once typing settles.
 */
export function DocumentFilters({ value, onChange, types }: DocumentFiltersProps) {
  const { employees } = useApp();
  const [open, setOpen] = useState(false);

  // Latest props in a ref: the debounce effects must not re-fire when an
  // unrelated part of the filter object changes.
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  const [text, setText] = useState(value.employeeName ?? '');
  const [tagText, setTagText] = useState(value.tags ?? '');
  // Remembers what we pushed upward so an external reset can be told apart
  // from the user's own keystrokes.
  const emitted = useRef({ text: value.employeeName ?? '', tags: value.tags ?? '' });

  useEffect(() => {
    const incoming = value.employeeName ?? '';
    if (incoming !== emitted.current.text) {
      emitted.current.text = incoming;
      setText(incoming);
    }
  }, [value.employeeName]);

  useEffect(() => {
    const incoming = value.tags ?? '';
    if (incoming !== emitted.current.tags) {
      emitted.current.tags = incoming;
      setTagText(incoming);
    }
  }, [value.tags]);

  useEffect(() => {
    if (text === (latest.current.value.employeeName ?? '')) return;
    const timer = window.setTimeout(() => {
      emitted.current.text = text;
      latest.current.onChange({
        ...latest.current.value,
        employeeName: text.trim() === '' ? undefined : text.trim(),
        page: 1,
      });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (tagText === (latest.current.value.tags ?? '')) return;
    const timer = window.setTimeout(() => {
      emitted.current.tags = tagText;
      latest.current.onChange({
        ...latest.current.value,
        tags: tagText.trim() === '' ? undefined : tagText.trim(),
        page: 1,
      });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [tagText]);

  const patch = (next: Partial<DocumentSearchParams>) => onChange({ ...value, ...next, page: 1 });

  const selectedStatuses = value.status ?? [];
  const toggleStatus = (status: DocumentStatus) => {
    const has = selectedStatuses.includes(status);
    const next = has ? selectedStatuses.filter((s) => s !== status) : [...selectedStatuses, status];
    patch({ status: next.length > 0 ? next : undefined });
  };

  const visibleTypes = value.category ? types.filter((t) => t.category === value.category) : types;

  const clearAll = () => {
    emitted.current = { text: '', tags: '' };
    setText('');
    setTagText('');
    onChange({ page: 1, limit: value.limit ?? 25, sort: value.sort, order: value.order, currentVersionsOnly: true });
  };

  const activeCount = [
    value.employeeName,
    value.employeeId,
    value.category,
    value.documentTypeId,
    value.status?.length ? 'x' : undefined,
    value.tags,
    value.uploadedFrom,
    value.uploadedTo,
    value.expiresFrom,
    value.expiresTo,
    value.expiringInDays,
    value.includeArchived ? 'x' : undefined,
    value.includeDeleted ? 'x' : undefined,
    value.currentVersionsOnly === false ? 'x' : undefined,
  ].filter((v) => v !== undefined && v !== '' && v !== null).length;

  const body = (
    <div className="space-y-4">
      <Section title="Search">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Employee name or code"
          className={INPUT_CLS}
        />
      </Section>

      <Section title="Employee">
        <select
          value={value.employeeId ?? ''}
          onChange={(e) => patch({ employeeId: e.target.value === '' ? undefined : Number(e.target.value) })}
          className={INPUT_CLS}
        >
          <option value="">All employees</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.fullName} · {emp.empCode}
            </option>
          ))}
        </select>
      </Section>

      <Section title="Category">
        <select
          value={value.category ?? ''}
          onChange={(e) =>
            patch({
              category: e.target.value === '' ? undefined : e.target.value,
              // A type from another category would contradict the new filter.
              documentTypeId: undefined,
            })
          }
          className={INPUT_CLS}
        >
          <option value="">All categories</option>
          {CATEGORY_ENTRIES.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </Section>

      <Section title="Document type">
        <select
          value={value.documentTypeId ?? ''}
          onChange={(e) => patch({ documentTypeId: e.target.value === '' ? undefined : Number(e.target.value) })}
          className={INPUT_CLS}
        >
          <option value="">All types</option>
          {visibleTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Section>

      <Section title="Status">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_ENTRIES.map(([status, meta]) => {
            const on = selectedStatuses.includes(status);
            return (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                  on
                    ? 'bg-primary-light border-primary/30 text-primary'
                    : 'border-border-default text-text-muted hover:border-text-muted'
                }`}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Tag">
        <input
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          placeholder="e.g. onboarding"
          className={INPUT_CLS}
        />
      </Section>

      <Section title="Uploaded between">
        <div className="space-y-2">
          <input
            type="date"
            value={value.uploadedFrom ?? ''}
            onChange={(e) => patch({ uploadedFrom: e.target.value || undefined })}
            className={INPUT_CLS}
          />
          <input
            type="date"
            value={value.uploadedTo ?? ''}
            onChange={(e) => patch({ uploadedTo: e.target.value || undefined })}
            className={INPUT_CLS}
          />
        </div>
      </Section>

      <Section title="Expires between">
        <div className="space-y-2">
          <input
            type="date"
            value={value.expiresFrom ?? ''}
            onChange={(e) => patch({ expiresFrom: e.target.value || undefined })}
            className={INPUT_CLS}
          />
          <input
            type="date"
            value={value.expiresTo ?? ''}
            onChange={(e) => patch({ expiresTo: e.target.value || undefined })}
            className={INPUT_CLS}
          />
        </div>
      </Section>

      <Section title="Expiring within (days)">
        <input
          type="number"
          min={0}
          value={value.expiringInDays ?? ''}
          onChange={(e) => patch({ expiringInDays: e.target.value === '' ? undefined : Number(e.target.value) })}
          placeholder="e.g. 30"
          className={INPUT_CLS}
        />
      </Section>

      <Section title="Include">
        <div className="space-y-1.5">
          <Toggle
            label="Archived documents"
            checked={!!value.includeArchived}
            onChange={(next) => patch({ includeArchived: next || undefined })}
          />
          <Toggle
            label="Deleted documents"
            checked={!!value.includeDeleted}
            onChange={(next) => patch({ includeDeleted: next || undefined })}
          />
          <Toggle
            label="Current versions only"
            checked={value.currentVersionsOnly !== false}
            onChange={(next) => patch({ currentVersionsOnly: next })}
          />
        </div>
      </Section>

      <button
        type="button"
        onClick={clearAll}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-border-default text-text-secondary text-xs font-medium hover:bg-bg-hover transition-colors"
      >
        <RotateCcw size={14} /> Clear filters
      </button>
    </div>
  );

  return (
    <>
      {/* Compact screens: a collapsible panel above the results. */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border-default bg-bg-card text-text-secondary text-sm hover:bg-bg-hover transition-colors"
        >
          <span className="flex items-center gap-2">
            <Filter size={14} /> Filters
            {activeCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-primary-light text-primary text-[10px] font-medium">
                {activeCount}
              </span>
            )}
          </span>
          <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="mt-2 bg-bg-card border border-border-default rounded-md p-4">{body}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Wide screens: a permanent rail. */}
      <aside className="hidden lg:block w-56 flex-shrink-0">
        <div className="bg-bg-card border border-border-default rounded-md p-4 sticky top-4">
          <div className="flex items-center gap-2 mb-4">
            <Filter size={14} className="text-text-muted" />
            <span className="text-sm font-medium text-text-primary">Filters</span>
            {activeCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-primary-light text-primary text-[10px] font-medium">
                {activeCount}
              </span>
            )}
          </div>
          {body}
        </div>
      </aside>
    </>
  );
}
