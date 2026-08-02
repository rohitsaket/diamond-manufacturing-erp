import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Pencil, Plus, Trash2 } from 'lucide-react';
import { profileApi } from '../../../api/profile';
import type { EducationLevel, EducationRecord, GradeType } from '../../../types/profile';
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

const LEVELS: EducationLevel[] = [
  'DOCTORATE',
  'POST_GRADUATION',
  'GRADUATION',
  'DIPLOMA',
  'HIGHER_SECONDARY',
  'SCHOOL',
  'OTHER',
];

const LEVEL_LABEL: Record<EducationLevel, string> = {
  DOCTORATE: 'Doctorate',
  POST_GRADUATION: 'Post graduation',
  GRADUATION: 'Graduation',
  DIPLOMA: 'Diploma',
  HIGHER_SECONDARY: 'Higher secondary',
  SCHOOL: 'School',
  OTHER: 'Other',
};

/** Highest qualification first; index 0 is the most senior level. */
const LEVEL_RANK: Record<EducationLevel, number> = {
  DOCTORATE: 0,
  POST_GRADUATION: 1,
  GRADUATION: 2,
  DIPLOMA: 3,
  HIGHER_SECONDARY: 4,
  SCHOOL: 5,
  OTHER: 6,
};

const GRADE_TYPES: GradeType[] = ['PERCENTAGE', 'CGPA', 'GRADE'];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}

function formatGrade(value: number | null, type: GradeType | null): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  if (type === 'PERCENTAGE') return `${n.toFixed(1)}%`;
  if (type === 'CGPA') return `${n.toFixed(1)} CGPA`;
  return `${n}`;
}

interface EduDraft {
  level: EducationLevel;
  degree: string;
  specialization: string;
  institution: string;
  boardUniversity: string;
  passingYear: string;
  gradeValue: string;
  gradeType: GradeType | '';
  notes: string;
}

const EMPTY_DRAFT: EduDraft = {
  level: 'GRADUATION',
  degree: '',
  specialization: '',
  institution: '',
  boardUniversity: '',
  passingYear: '',
  gradeValue: '',
  gradeType: '',
  notes: '',
};

function toDraft(row: EducationRecord): EduDraft {
  return {
    level: row.level,
    degree: row.degree ?? '',
    specialization: row.specialization ?? '',
    institution: row.institution ?? '',
    boardUniversity: row.boardUniversity ?? '',
    passingYear: row.passingYear === null ? '' : String(row.passingYear),
    gradeValue: row.gradeValue === null ? '' : String(row.gradeValue),
    gradeType: row.gradeType ?? '',
    notes: row.notes ?? '',
  };
}

export function EducationSection({ employeeId }: { employeeId: number }) {
  const [rows, setRows] = useState<EducationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EduDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    profileApi
      .education(employeeId)
      .then((data) => {
        setRows([...data].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]));
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

  const openEdit = (row: EducationRecord) => {
    setEditingId(row.id);
    setDraft(toDraft(row));
    setFormError(null);
    setModalOpen(true);
  };

  const handleDelete = (row: EducationRecord) => {
    if (!window.confirm(`Delete the ${LEVEL_LABEL[row.level].toLowerCase()} record?`)) return;
    profileApi
      .deleteEducation(row.id)
      .then(() => load())
      .catch((e: unknown) => window.alert(errMsg(e)));
  };

  const handleSave = () => {
    const nextYear = new Date().getFullYear() + 1;
    const year = draft.passingYear.trim() === '' ? null : Number(draft.passingYear);
    if (year !== null && (!Number.isInteger(year) || year < 1950 || year > nextYear)) {
      setFormError(`Passing year must be between 1950 and ${nextYear}.`);
      return;
    }
    const grade = draft.gradeValue.trim() === '' ? null : Number(draft.gradeValue);
    if (grade !== null && Number.isNaN(grade)) {
      setFormError('Grade value must be a number.');
      return;
    }
    if (grade !== null && draft.gradeType === 'PERCENTAGE' && grade > 100) {
      setFormError('A percentage cannot be above 100.');
      return;
    }
    if (grade !== null && draft.gradeType === '') {
      setFormError('Pick a grade type for the grade value.');
      return;
    }

    const body: Partial<EducationRecord> = {
      level: draft.level,
      degree: draft.degree.trim() || null,
      specialization: draft.specialization.trim() || null,
      institution: draft.institution.trim() || null,
      boardUniversity: draft.boardUniversity.trim() || null,
      passingYear: year,
      gradeValue: grade,
      gradeType: draft.gradeType === '' ? null : draft.gradeType,
      notes: draft.notes.trim() || null,
    };

    setSaving(true);
    const req = editingId === null
      ? profileApi.addEducation(employeeId, body)
      : profileApi.updateEducation(editingId, body);
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
          <h3 className="text-text-primary font-semibold text-sm">Education</h3>
          <p className="text-text-muted text-xs mt-0.5">Highest qualification first</p>
        </div>
        <button onClick={openAdd} className={BTN_PRIMARY}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} /> Add qualification
          </span>
        </button>
      </div>

      {error && <ErrorBlock message={error} />}
      {loading && <LoadingBlock />}

      {!loading && !error && rows.length === 0 && (
        <EmptyBlock message="No education records" hint="Add the employee's qualifications to complete the profile." />
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((row) => (
              <div key={row.id} className="bg-bg-card border border-border-default rounded-md p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="w-8 h-8 rounded-md bg-primary-light text-primary flex items-center justify-center flex-shrink-0">
                      <GraduationCap size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-text-primary text-sm font-medium truncate">
                        {row.degree || LEVEL_LABEL[row.level]}
                      </p>
                      <p className="text-text-secondary text-xs mt-0.5 truncate">
                        {row.specialization || '—'}
                      </p>
                      <p className="text-text-muted text-xs mt-1 truncate">
                        {row.institution || '—'}
                        {row.boardUniversity ? ` · ${row.boardUniversity}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
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
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-3">
                  <Chip label={LEVEL_LABEL[row.level]} tone="primary" />
                  {row.passingYear !== null && <Chip label={`Passed ${row.passingYear}`} />}
                  {row.gradeValue !== null && (
                    <Chip label={formatGrade(row.gradeValue, row.gradeType)} tone="info" />
                  )}
                </div>
                {row.notes && <p className="text-text-muted text-xs mt-3">{row.notes}</p>}
              </div>
            ))}
          </div>

          <TableShell
            headers={['Level', 'Degree', 'Specialization', 'Institution', 'Board / University', 'Year', 'Grade']}
          >
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-bg-hover transition-colors">
                <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
                  {LEVEL_LABEL[row.level]}
                </td>
                <td className="px-3 py-2 text-xs text-text-primary">{row.degree || '—'}</td>
                <td className="px-3 py-2 text-xs text-text-secondary">{row.specialization || '—'}</td>
                <td className="px-3 py-2 text-xs text-text-secondary">{row.institution || '—'}</td>
                <td className="px-3 py-2 text-xs text-text-secondary">{row.boardUniversity || '—'}</td>
                <td className="px-3 py-2 text-xs text-text-secondary tabular-nums">{row.passingYear ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-text-secondary tabular-nums">
                  {formatGrade(row.gradeValue, row.gradeType)}
                </td>
              </tr>
            ))}
          </TableShell>
        </>
      )}

      {modalOpen && (
        <ModalShell
          title={editingId === null ? 'Add qualification' : 'Edit qualification'}
          subtitle="Education record"
          onClose={() => setModalOpen(false)}
          maxWidth="max-w-2xl"
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL_CLS}>Level</label>
                <select
                  className={INPUT_CLS}
                  value={draft.level}
                  onChange={(e) => setDraft({ ...draft, level: e.target.value as EducationLevel })}
                >
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {LEVEL_LABEL[l]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Degree</label>
                <input
                  className={INPUT_CLS}
                  value={draft.degree}
                  onChange={(e) => setDraft({ ...draft, degree: e.target.value })}
                  placeholder="B.Com"
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Specialization</label>
                <input
                  className={INPUT_CLS}
                  value={draft.specialization}
                  onChange={(e) => setDraft({ ...draft, specialization: e.target.value })}
                  placeholder="Accounting"
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Institution</label>
                <input
                  className={INPUT_CLS}
                  value={draft.institution}
                  onChange={(e) => setDraft({ ...draft, institution: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Board / University</label>
                <input
                  className={INPUT_CLS}
                  value={draft.boardUniversity}
                  onChange={(e) => setDraft({ ...draft, boardUniversity: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Passing year</label>
                <input
                  className={INPUT_CLS}
                  inputMode="numeric"
                  value={draft.passingYear}
                  onChange={(e) => setDraft({ ...draft, passingYear: e.target.value })}
                  placeholder={String(new Date().getFullYear())}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Grade type</label>
                <select
                  className={INPUT_CLS}
                  value={draft.gradeType}
                  onChange={(e) => setDraft({ ...draft, gradeType: e.target.value as GradeType | '' })}
                >
                  <option value="">Not recorded</option>
                  {GRADE_TYPES.map((g) => (
                    <option key={g} value={g}>
                      {g === 'PERCENTAGE' ? 'Percentage' : g === 'CGPA' ? 'CGPA' : 'Grade'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Grade value</label>
                <input
                  className={INPUT_CLS}
                  inputMode="decimal"
                  value={draft.gradeValue}
                  onChange={(e) => setDraft({ ...draft, gradeValue: e.target.value })}
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
