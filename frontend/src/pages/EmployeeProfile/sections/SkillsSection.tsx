import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { profileApi } from '../../../api/profile';
import type {
  EmployeeSkill,
  ExperienceLevel,
  Skill,
  SkillCategory,
  SkillGapRow,
} from '../../../types/profile';
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

const CATEGORIES: SkillCategory[] = ['TECHNICAL', 'FUNCTIONAL', 'SOFT'];
const CATEGORY_LABEL: Record<SkillCategory, string> = {
  TECHNICAL: 'Technical',
  FUNCTIONAL: 'Functional',
  SOFT: 'Soft skills',
};

const LEVELS: ExperienceLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];
const LEVEL_LABEL: Record<ExperienceLevel, string> = {
  BEGINNER: 'Beginner',
  INTERMEDIATE: 'Intermediate',
  ADVANCED: 'Advanced',
  EXPERT: 'Expert',
};
const LEVEL_TONE: Record<ExperienceLevel, 'default' | 'info' | 'primary' | 'success'> = {
  BEGINNER: 'default',
  INTERMEDIATE: 'info',
  ADVANCED: 'primary',
  EXPERT: 'success',
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}

function RatingDots({
  value,
  onChange,
  busy,
}: {
  value: number;
  onChange?: (next: number) => void;
  busy?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        const cls = filled ? 'bg-primary' : 'bg-bg-hover border border-border-default';
        if (!onChange) return <span key={n} className={`w-2.5 h-2.5 rounded-full ${cls}`} />;
        return (
          <button
            key={n}
            type="button"
            disabled={busy}
            aria-label={`Set rating ${n}`}
            onClick={() => onChange(n)}
            className={`w-2.5 h-2.5 rounded-full transition-colors disabled:opacity-50 ${cls}`}
          />
        );
      })}
    </span>
  );
}

interface AddDraft {
  mode: 'existing' | 'new';
  skillId: string;
  newName: string;
  newCategory: SkillCategory;
  newDescription: string;
  rating: number;
  experienceLevel: ExperienceLevel;
  yearsExperience: string;
  lastUsedYear: string;
  notes: string;
}

const EMPTY_ADD: AddDraft = {
  mode: 'existing',
  skillId: '',
  newName: '',
  newCategory: 'TECHNICAL',
  newDescription: '',
  rating: 3,
  experienceLevel: 'INTERMEDIATE',
  yearsExperience: '',
  lastUsedYear: '',
  notes: '',
};

export function SkillsSection({ employeeId }: { employeeId: number }) {
  const [skills, setSkills] = useState<EmployeeSkill[]>([]);
  const [gaps, setGaps] = useState<SkillGapRow[]>([]);
  const [master, setMaster] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<AddDraft>(EMPTY_ADD);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      profileApi.skills(employeeId),
      profileApi.skillGap(employeeId).catch(() => [] as SkillGapRow[]),
      profileApi.skillMaster().catch(() => [] as Skill[]),
    ])
      .then(([rows, gapRows, masterRows]) => {
        setSkills(rows);
        setGaps(gapRows);
        setMaster(masterRows);
        setError(null);
      })
      .catch((e: unknown) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const map: Record<SkillCategory, EmployeeSkill[]> = { TECHNICAL: [], FUNCTIONAL: [], SOFT: [] };
    for (const s of skills) map[s.category]?.push(s);
    for (const key of CATEGORIES) map[key].sort((a, b) => b.rating - a.rating || a.skillName.localeCompare(b.skillName));
    return map;
  }, [skills]);

  const masterGrouped = useMemo(() => {
    const taken = new Set(skills.map((s) => s.skillId));
    const map: Record<SkillCategory, Skill[]> = { TECHNICAL: [], FUNCTIONAL: [], SOFT: [] };
    for (const s of master) if (!taken.has(s.id)) map[s.category]?.push(s);
    return map;
  }, [master, skills]);

  const persist = (skill: EmployeeSkill, patch: Partial<EmployeeSkill>) => {
    setBusy(true);
    profileApi
      .setSkill(employeeId, {
        skillId: skill.skillId,
        rating: skill.rating,
        experienceLevel: skill.experienceLevel,
        yearsExperience: skill.yearsExperience,
        lastUsedYear: skill.lastUsedYear,
        notes: skill.notes,
        ...patch,
      })
      .then(() => load())
      .catch((e: unknown) => window.alert(errMsg(e)))
      .finally(() => setBusy(false));
  };

  const remove = (skill: EmployeeSkill) => {
    if (!window.confirm(`Remove "${skill.skillName}" from this profile?`)) return;
    setBusy(true);
    profileApi
      .removeSkill(employeeId, skill.skillId)
      .then(() => load())
      .catch((e: unknown) => window.alert(errMsg(e)))
      .finally(() => setBusy(false));
  };

  const openAdd = () => {
    setDraft(EMPTY_ADD);
    setFormError(null);
    setModalOpen(true);
  };

  const submitAdd = () => {
    const years = draft.yearsExperience.trim() === '' ? null : Number(draft.yearsExperience);
    if (years !== null && (Number.isNaN(years) || years < 0)) {
      setFormError('Years of experience must be a positive number.');
      return;
    }
    const lastUsed = draft.lastUsedYear.trim() === '' ? null : Number(draft.lastUsedYear);
    const nextYear = new Date().getFullYear() + 1;
    if (lastUsed !== null && (!Number.isInteger(lastUsed) || lastUsed < 1950 || lastUsed > nextYear)) {
      setFormError(`Last used year must be between 1950 and ${nextYear}.`);
      return;
    }
    if (draft.mode === 'existing' && draft.skillId === '') {
      setFormError('Pick a skill, or switch to "Create new skill".');
      return;
    }
    if (draft.mode === 'new' && draft.newName.trim() === '') {
      setFormError('Give the new skill a name.');
      return;
    }

    setSaving(true);
    const resolveSkillId: Promise<number> =
      draft.mode === 'new'
        ? profileApi
            .createSkill({
              name: draft.newName.trim(),
              category: draft.newCategory,
              description: draft.newDescription.trim() || null,
            })
            .then((s) => s.id)
        : Promise.resolve(Number(draft.skillId));

    resolveSkillId
      .then((skillId) =>
        profileApi.setSkill(employeeId, {
          skillId,
          rating: draft.rating,
          experienceLevel: draft.experienceLevel,
          yearsExperience: years,
          lastUsedYear: lastUsed,
          notes: draft.notes.trim() || null,
        }),
      )
      .then(() => {
        setModalOpen(false);
        load();
      })
      .catch((e: unknown) => window.alert(errMsg(e)))
      .finally(() => setSaving(false));
  };

  const gapTone = (gap: number): string =>
    gap >= 2 ? 'bg-danger' : gap === 1 ? 'bg-warning' : 'bg-success';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-text-primary font-semibold text-sm">Skills</h3>
          <p className="text-text-muted text-xs mt-0.5">Rated 1–5 across technical, functional and soft skills</p>
        </div>
        <button onClick={openAdd} className={BTN_PRIMARY}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} /> Add skill
          </span>
        </button>
      </div>

      {error && <ErrorBlock message={error} />}
      {loading && <LoadingBlock />}

      {!loading && !error && skills.length === 0 && (
        <EmptyBlock message="No skills recorded" hint="Add skills to build the competency profile." />
      )}

      {!loading && !error && skills.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          {CATEGORIES.map((cat) => (
            <div key={cat} className="bg-bg-card border border-border-default rounded-md">
              <div className="px-4 py-2.5 border-b border-border-light flex items-center justify-between">
                <p className="text-text-primary text-xs font-semibold uppercase tracking-wider">
                  {CATEGORY_LABEL[cat]}
                </p>
                <span className="text-text-muted text-xs tabular-nums">{grouped[cat].length}</span>
              </div>
              {grouped[cat].length === 0 ? (
                <p className="px-4 py-6 text-text-muted text-xs text-center">Nothing recorded</p>
              ) : (
                <ul className="divide-y divide-border-light">
                  {grouped[cat].map((s) => (
                    <li key={s.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-text-primary text-sm font-medium min-w-0 truncate">{s.skillName}</p>
                        <button
                          onClick={() => remove(s)}
                          disabled={busy}
                          aria-label="Remove skill"
                          className="p-1 rounded text-text-muted hover:text-danger hover:bg-danger-light transition-colors disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <RatingDots value={s.rating} busy={busy} onChange={(n) => persist(s, { rating: n })} />
                        <span className="text-text-muted text-[11px] tabular-nums">{s.rating}/5</span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap mt-2">
                        <Chip label={LEVEL_LABEL[s.experienceLevel]} tone={LEVEL_TONE[s.experienceLevel]} />
                        {s.yearsExperience !== null && (
                          <span className="text-text-muted text-[11px]">{s.yearsExperience} yr</span>
                        )}
                        {s.lastUsedYear !== null && (
                          <span className="text-text-muted text-[11px]">last used {s.lastUsedYear}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && !error && (
        <div className="bg-bg-card border border-border-default rounded-md p-4 space-y-3">
          <div>
            <h4 className="text-text-primary font-semibold text-sm">Skill gap</h4>
            <p className="text-text-muted text-xs mt-0.5">Current rating against the target set for this grade</p>
          </div>
          {gaps.length === 0 ? (
            <p className="text-text-muted text-xs">
              No skill targets are defined for this grade, so gap analysis is unavailable.
            </p>
          ) : (
            <TableShell headers={['Skill', 'Target', 'Current', 'Gap']}>
              {gaps.map((g) => (
                <tr key={g.skillId} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-xs text-text-primary">{g.skillName}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary tabular-nums">{g.targetRating}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary tabular-nums">{g.currentRating}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 rounded-full bg-bg-hover overflow-hidden">
                        <div
                          className={`h-full rounded-full ${gapTone(g.gap)}`}
                          style={{ width: `${Math.min(100, (Math.max(0, g.gap) / 5) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-text-secondary tabular-nums">{g.gap}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </div>
      )}

      {modalOpen && (
        <ModalShell
          title="Add skill"
          subtitle="Pick from the skill master or create a new one"
          onClose={() => setModalOpen(false)}
          maxWidth="max-w-xl"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button className={BTN_SECONDARY} onClick={() => setModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className={BTN_PRIMARY} onClick={submitAdd} disabled={saving}>
                {saving ? 'Saving…' : 'Add skill'}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            {formError && <ErrorBlock message={formError} />}

            <div className="flex items-center gap-2">
              {(['existing', 'new'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDraft({ ...draft, mode: m })}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                    draft.mode === m
                      ? 'bg-primary-light border-primary/30 text-primary'
                      : 'border-border-default text-text-muted hover:border-text-muted'
                  }`}
                >
                  {m === 'existing' ? 'Existing skill' : 'Create new skill'}
                </button>
              ))}
            </div>

            {draft.mode === 'existing' ? (
              <div>
                <label className={LABEL_CLS}>Skill</label>
                <select
                  className={INPUT_CLS}
                  value={draft.skillId}
                  onChange={(e) => setDraft({ ...draft, skillId: e.target.value })}
                >
                  <option value="">Select a skill…</option>
                  {CATEGORIES.map((cat) =>
                    masterGrouped[cat].length === 0 ? null : (
                      <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
                        {masterGrouped[cat].map((s) => (
                          <option key={s.id} value={String(s.id)}>
                            {s.name}
                          </option>
                        ))}
                      </optgroup>
                    ),
                  )}
                </select>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>Skill name</label>
                  <input
                    className={INPUT_CLS}
                    value={draft.newName}
                    onChange={(e) => setDraft({ ...draft, newName: e.target.value })}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Category</label>
                  <select
                    className={INPUT_CLS}
                    value={draft.newCategory}
                    onChange={(e) => setDraft({ ...draft, newCategory: e.target.value as SkillCategory })}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={LABEL_CLS}>Description</label>
                  <input
                    className={INPUT_CLS}
                    value={draft.newDescription}
                    onChange={(e) => setDraft({ ...draft, newDescription: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL_CLS}>Rating</label>
                <div className="flex items-center gap-2 h-[38px]">
                  <RatingDots value={draft.rating} onChange={(n) => setDraft({ ...draft, rating: n })} />
                  <span className="text-text-muted text-xs tabular-nums">{draft.rating}/5</span>
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Experience level</label>
                <select
                  className={INPUT_CLS}
                  value={draft.experienceLevel}
                  onChange={(e) => setDraft({ ...draft, experienceLevel: e.target.value as ExperienceLevel })}
                >
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {LEVEL_LABEL[l]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Years of experience</label>
                <input
                  className={INPUT_CLS}
                  inputMode="decimal"
                  value={draft.yearsExperience}
                  onChange={(e) => setDraft({ ...draft, yearsExperience: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Last used year</label>
                <input
                  className={INPUT_CLS}
                  inputMode="numeric"
                  value={draft.lastUsedYear}
                  onChange={(e) => setDraft({ ...draft, lastUsedYear: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>Notes</label>
              <textarea
                className={`${INPUT_CLS} min-h-20`}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
