import { useState } from 'react';
import { Loader2, UserPlus, AlertTriangle } from 'lucide-react';
import { ModalShell } from '../../components/common/ModalShell';
import { INPUT_CLS, LABEL_CLS, BTN_PRIMARY, BTN_SECONDARY } from '../../components/common/HrmsUI';
import { recruitmentApi } from '../../api/hrms';
import type { Candidate, WorkerType } from '../../types/hrms';

const WORKER_TYPES: WorkerType[] = ['PIECE_RATE', 'DHAR', 'MAXI'];
const TODAY = new Date().toISOString().slice(0, 10);

const errText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

interface ConvertForm {
  empCode: string;
  grade: string;
  workerType: WorkerType;
  joinedAt: string;
  monthlySalary: string;
  department: string;
  designation: string;
}

interface ConvertCandidateModalProps {
  candidate: Candidate;
  onClose: () => void;
  /** Fired after the employee is created so the parent can refetch + refresh. */
  onConverted: () => void;
}

/**
 * Converts a SELECTED candidate into a permanent employee record. This is the
 * only path that moves a candidate to JOINED — the status endpoint rejects it.
 */
export function ConvertCandidateModal({ candidate, onClose, onConverted }: ConvertCandidateModalProps) {
  const [form, setForm] = useState<ConvertForm>({
    empCode: '',
    grade: candidate.positionGrade ?? '',
    workerType: candidate.workerType,
    joinedAt: TODAY,
    monthlySalary: candidate.expectedSalary != null ? String(candidate.expectedSalary) : '',
    department: '',
    designation: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ConvertForm>(key: K, value: ConvertForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const salaryMissing =
    (form.workerType === 'DHAR' || form.workerType === 'MAXI') && form.monthlySalary.trim() === '';

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.empCode.trim()) e.empCode = 'Required';
    if (!form.joinedAt) e.joinedAt = 'Required';
    if (form.monthlySalary.trim() !== '') {
      const n = Number(form.monthlySalary);
      if (Number.isNaN(n) || n < 0) e.monthlySalary = 'Must be a number ≥ 0';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    const empCode = form.empCode.trim().toUpperCase();
    setSaving(true);
    try {
      await recruitmentApi.convert(candidate.id, {
        empCode,
        grade: form.grade.trim() || undefined,
        workerType: form.workerType,
        joinedAt: form.joinedAt,
        monthlySalary: form.monthlySalary.trim() === '' ? null : Number(form.monthlySalary),
        department: form.department.trim() || null,
        designation: form.designation.trim() || null,
      });
      window.alert(`Employee ${empCode} created`);
      onConverted();
      onClose();
    } catch (err) {
      // Stay open so the user can fix a duplicate employee code.
      window.alert(errText(err, 'Failed to convert candidate'));
    } finally {
      setSaving(false);
    }
  };

  const fieldCls = (key: string) => `${INPUT_CLS}${errors[key] ? ' border-danger' : ''}`;

  return (
    <ModalShell
      title="Convert to employee"
      subtitle={candidate.fullName}
      maxWidth="max-w-lg"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={saving}
            className={`${BTN_PRIMARY} inline-flex items-center gap-2`}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
            Create employee
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md bg-info-light border border-primary/20 px-3 py-2.5 text-xs text-text-secondary">
          This creates a permanent employee record from the candidate and marks the candidate as{' '}
          <strong className="text-text-primary">JOINED</strong>. The employee code must be unique and cannot be
          reused later.
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS} htmlFor="conv-empcode">
              Employee code *
            </label>
            <input
              id="conv-empcode"
              type="text"
              value={form.empCode}
              onChange={(e) => set('empCode', e.target.value.toUpperCase())}
              placeholder="HRN-042"
              className={`${fieldCls('empCode')} font-mono`}
            />
            {errors.empCode && <p className="text-danger text-[9px] mt-0.5">{errors.empCode}</p>}
          </div>

          <div>
            <label className={LABEL_CLS} htmlFor="conv-joined">
              Joining date *
            </label>
            <input
              id="conv-joined"
              type="date"
              value={form.joinedAt}
              onChange={(e) => set('joinedAt', e.target.value)}
              className={fieldCls('joinedAt')}
            />
            {errors.joinedAt && <p className="text-danger text-[9px] mt-0.5">{errors.joinedAt}</p>}
          </div>

          <div>
            <label className={LABEL_CLS} htmlFor="conv-grade">
              Grade
            </label>
            <input
              id="conv-grade"
              type="text"
              value={form.grade}
              onChange={(e) => set('grade', e.target.value)}
              placeholder="A+"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className={LABEL_CLS} htmlFor="conv-workertype">
              Worker type
            </label>
            <select
              id="conv-workertype"
              value={form.workerType}
              onChange={(e) => set('workerType', e.target.value as WorkerType)}
              className={INPUT_CLS}
            >
              {WORKER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <label className={LABEL_CLS} htmlFor="conv-salary">
              Monthly salary
            </label>
            <input
              id="conv-salary"
              type="number"
              min={0}
              value={form.monthlySalary}
              onChange={(e) => set('monthlySalary', e.target.value)}
              placeholder="18000"
              className={fieldCls('monthlySalary')}
            />
            {errors.monthlySalary && <p className="text-danger text-[9px] mt-0.5">{errors.monthlySalary}</p>}
            <p className="text-text-muted text-[10px] mt-1">
              Required for DHAR and MAXI workers — used to prorate monthly pay
            </p>
            {salaryMissing && (
              <p className="text-warning text-[10px] mt-1 flex items-center gap-1">
                <AlertTriangle size={10} />
                {form.workerType} workers are paid monthly — leaving this empty means no monthly pay is
                calculated.
              </p>
            )}
          </div>

          <div>
            <label className={LABEL_CLS} htmlFor="conv-department">
              Department
            </label>
            <input
              id="conv-department"
              type="text"
              value={form.department}
              onChange={(e) => set('department', e.target.value)}
              placeholder="Polishing"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className={LABEL_CLS} htmlFor="conv-designation">
              Designation
            </label>
            <input
              id="conv-designation"
              type="text"
              value={form.designation}
              onChange={(e) => set('designation', e.target.value)}
              placeholder="Karigar"
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div className="rounded-md border border-border-light bg-bg-secondary px-3 py-2.5 space-y-1">
          {(
            [
              ['Applied for', candidate.openingTitle ?? '—'],
              ['Phone', candidate.phone],
              ['Email', candidate.email ?? '—'],
              ['Source', candidate.source ?? '—'],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-text-muted text-[11px]">{k}</span>
              <span className="text-text-secondary text-[11px] truncate">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}
