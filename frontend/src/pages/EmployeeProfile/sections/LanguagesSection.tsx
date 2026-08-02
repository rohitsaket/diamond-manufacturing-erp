import { useCallback, useEffect, useState } from 'react';
import { Check, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { profileApi } from '../../../api/profile';
import type { LanguageProficiency, LanguageRecord } from '../../../types/profile';
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
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';

const PROFICIENCIES: LanguageProficiency[] = ['BASIC', 'CONVERSATIONAL', 'PROFICIENT', 'FLUENT', 'NATIVE'];
const PROFICIENCY_LABEL: Record<LanguageProficiency, string> = {
  BASIC: 'Basic',
  CONVERSATIONAL: 'Conversational',
  PROFICIENT: 'Proficient',
  FLUENT: 'Fluent',
  NATIVE: 'Native',
};
const PROFICIENCY_TONE: Record<LanguageProficiency, 'default' | 'info' | 'primary' | 'success'> = {
  BASIC: 'default',
  CONVERSATIONAL: 'default',
  PROFICIENT: 'info',
  FLUENT: 'primary',
  NATIVE: 'success',
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}

function YesNo({ on }: { on: boolean }) {
  return on ? (
    <Check size={16} className="text-success" aria-label="Yes" />
  ) : (
    <Minus size={16} className="text-text-muted" aria-label="No" />
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`flex items-center justify-between gap-3 w-full px-3 py-2 rounded-md border transition-colors ${
        value ? 'bg-primary-light border-primary/30' : 'bg-bg-card border-border-default hover:bg-bg-hover'
      }`}
    >
      <span className={`text-sm ${value ? 'text-primary' : 'text-text-secondary'}`}>{label}</span>
      <span
        className={`w-9 h-5 rounded-full flex items-center px-0.5 transition-colors ${
          value ? 'bg-primary' : 'bg-bg-hover border border-border-default'
        }`}
      >
        <span
          className={`w-4 h-4 rounded-full bg-bg-card shadow-sm transition-transform ${
            value ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}

interface LangDraft {
  language: string;
  canRead: boolean;
  canWrite: boolean;
  canSpeak: boolean;
  proficiency: LanguageProficiency;
  isNative: boolean;
}

const EMPTY_DRAFT: LangDraft = {
  language: '',
  canRead: true,
  canWrite: true,
  canSpeak: true,
  proficiency: 'CONVERSATIONAL',
  isNative: false,
};

export function LanguagesSection({ employeeId }: { employeeId: number }) {
  const [rows, setRows] = useState<LanguageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<LangDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    profileApi
      .languages(employeeId)
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch((e: unknown) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (row: LanguageRecord) => {
    setEditingId(row.id);
    setDraft({
      language: row.language,
      canRead: row.canRead,
      canWrite: row.canWrite,
      canSpeak: row.canSpeak,
      proficiency: row.proficiency,
      isNative: row.isNative,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleDelete = (row: LanguageRecord) => {
    if (!window.confirm(`Remove ${row.language} from this profile?`)) return;
    profileApi
      .deleteLanguage(row.id)
      .then(() => load())
      .catch((e: unknown) => window.alert(errMsg(e)));
  };

  const handleSave = () => {
    if (draft.language.trim() === '') {
      setFormError('Language name is required.');
      return;
    }
    if (!draft.canRead && !draft.canWrite && !draft.canSpeak) {
      setFormError('Select at least one of read, write or speak.');
      return;
    }

    const body: Partial<LanguageRecord> = {
      language: draft.language.trim(),
      canRead: draft.canRead,
      canWrite: draft.canWrite,
      canSpeak: draft.canSpeak,
      proficiency: draft.proficiency,
      isNative: draft.isNative,
    };

    setSaving(true);
    const req = editingId === null
      ? profileApi.addLanguage(employeeId, body)
      : profileApi.updateLanguage(editingId, body);
    req
      .then(() => {
        setModalOpen(false);
        load();
      })
      .catch((e: unknown) => window.alert(errMsg(e)))
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-text-primary font-semibold text-sm">Languages</h3>
          <p className="text-text-muted text-xs mt-0.5">Reading, writing and speaking ability</p>
        </div>
        <button onClick={openAdd} className={BTN_PRIMARY}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} /> Add language
          </span>
        </button>
      </div>

      {error && <ErrorBlock message={error} />}
      {loading && <LoadingBlock />}

      {!loading && !error && rows.length === 0 && (
        <EmptyBlock message="No languages recorded" hint="Add the languages this employee works in." />
      )}

      {!loading && !error && rows.length > 0 && (
        <TableShell headers={['Language', 'Read', 'Write', 'Speak', 'Proficiency', 'Native', '']}>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-xs text-text-primary font-medium">{row.language}</td>
              <td className="px-3 py-2">
                <YesNo on={row.canRead} />
              </td>
              <td className="px-3 py-2">
                <YesNo on={row.canWrite} />
              </td>
              <td className="px-3 py-2">
                <YesNo on={row.canSpeak} />
              </td>
              <td className="px-3 py-2">
                <Chip label={PROFICIENCY_LABEL[row.proficiency]} tone={PROFICIENCY_TONE[row.proficiency]} />
              </td>
              <td className="px-3 py-2">
                <YesNo on={row.isNative} />
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={() => openEdit(row)}
                    aria-label="Edit"
                    className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(row)}
                    aria-label="Delete"
                    className="p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-danger-light transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      {modalOpen && (
        <ModalShell
          title={editingId === null ? 'Add language' : 'Edit language'}
          subtitle="Language ability"
          onClose={() => setModalOpen(false)}
          maxWidth="max-w-lg"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button className={BTN_SECONDARY} onClick={() => setModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className={BTN_PRIMARY} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            {formError && <ErrorBlock message={formError} />}
            <div>
              <label className={LABEL_CLS}>Language</label>
              <input
                className={INPUT_CLS}
                value={draft.language}
                onChange={(e) => setDraft({ ...draft, language: e.target.value })}
                placeholder="Gujarati"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Toggle label="Read" value={draft.canRead} onChange={(v) => setDraft({ ...draft, canRead: v })} />
              <Toggle label="Write" value={draft.canWrite} onChange={(v) => setDraft({ ...draft, canWrite: v })} />
              <Toggle label="Speak" value={draft.canSpeak} onChange={(v) => setDraft({ ...draft, canSpeak: v })} />
            </div>
            <div>
              <label className={LABEL_CLS}>Proficiency</label>
              <select
                className={INPUT_CLS}
                value={draft.proficiency}
                onChange={(e) => setDraft({ ...draft, proficiency: e.target.value as LanguageProficiency })}
              >
                {PROFICIENCIES.map((p) => (
                  <option key={p} value={p}>
                    {PROFICIENCY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <Toggle
              label="Native language"
              value={draft.isNative}
              onChange={(v) => setDraft({ ...draft, isNative: v })}
            />
          </div>
        </ModalShell>
      )}
    </div>
  );
}
