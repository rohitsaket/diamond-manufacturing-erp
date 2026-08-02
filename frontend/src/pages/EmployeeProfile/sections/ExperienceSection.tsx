import { useCallback, useEffect, useState } from 'react';
import { Briefcase, Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { profileApi } from '../../../api/profile';
import type { ExperienceSummary } from '../../../api/profile';
import type { ExperienceRecord, PriorEmploymentType } from '../../../types/profile';
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
  inr,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';

const TYPES: PriorEmploymentType[] = ['PERMANENT', 'CONTRACT', 'PART_TIME', 'INTERNSHIP', 'FREELANCE'];
const TYPE_LABEL: Record<PriorEmploymentType, string> = {
  PERMANENT: 'Permanent',
  CONTRACT: 'Contract',
  PART_TIME: 'Part time',
  INTERNSHIP: 'Internship',
  FREELANCE: 'Freelance',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtMonth(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Renders a month count as "3y 4m" (either part is dropped when zero). */
function yearsMonths(months: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(months ?? 0)));
  const y = Math.floor(total / 12);
  const m = total % 12;
  if (y === 0 && m === 0) return '0m';
  return [y > 0 ? `${y}y` : '', m > 0 ? `${m}m` : ''].filter(Boolean).join(' ');
}

function toInputDate(v: string | null | undefined): string {
  return v ? String(v).slice(0, 10) : '';
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}

interface ExpDraft {
  companyName: string;
  designation: string;
  employmentType: PriorEmploymentType | '';
  industry: string;
  location: string;
  fromDate: string;
  toDate: string;
  isCurrent: boolean;
  lastSalary: string;
  reasonForLeaving: string;
  projects: string;
  referenceName: string;
  referenceDesignation: string;
  referencePhone: string;
  referenceEmail: string;
}

const EMPTY_DRAFT: ExpDraft = {
  companyName: '',
  designation: '',
  employmentType: '',
  industry: '',
  location: '',
  fromDate: '',
  toDate: '',
  isCurrent: false,
  lastSalary: '',
  reasonForLeaving: '',
  projects: '',
  referenceName: '',
  referenceDesignation: '',
  referencePhone: '',
  referenceEmail: '',
};

function toDraft(row: ExperienceRecord): ExpDraft {
  return {
    companyName: row.companyName,
    designation: row.designation ?? '',
    employmentType: row.employmentType ?? '',
    industry: row.industry ?? '',
    location: row.location ?? '',
    fromDate: toInputDate(row.fromDate),
    toDate: toInputDate(row.toDate),
    isCurrent: row.isCurrent,
    lastSalary: row.lastSalary === null ? '' : String(row.lastSalary),
    reasonForLeaving: row.reasonForLeaving ?? '',
    projects: row.projects ?? '',
    referenceName: row.referenceName ?? '',
    referenceDesignation: row.referenceDesignation ?? '',
    referencePhone: row.referencePhone ?? '',
    referenceEmail: row.referenceEmail ?? '',
  };
}

export function ExperienceSection({ employeeId }: { employeeId: number }) {
  const [rows, setRows] = useState<ExperienceRecord[]>([]);
  const [summary, setSummary] = useState<ExperienceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ExpDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      profileApi.experience(employeeId),
      profileApi.totalExperience(employeeId).catch(() => null),
    ])
      .then(([data, total]) => {
        setRows(
          [...data].sort((a, b) => (a.fromDate < b.fromDate ? 1 : a.fromDate > b.fromDate ? -1 : 0)),
        );
        setSummary(total);
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

  const openEdit = (row: ExperienceRecord) => {
    setEditingId(row.id);
    setDraft(toDraft(row));
    setFormError(null);
    setModalOpen(true);
  };

  const handleDelete = (row: ExperienceRecord) => {
    if (!window.confirm(`Delete the ${row.companyName} experience record?`)) return;
    profileApi
      .deleteExperience(row.id)
      .then(() => load())
      .catch((e: unknown) => window.alert(errMsg(e)));
  };

  const handleSave = () => {
    if (draft.companyName.trim() === '') {
      setFormError('Company name is required.');
      return;
    }
    if (draft.fromDate === '') {
      setFormError('From date is required.');
      return;
    }
    if (!draft.isCurrent && draft.toDate && draft.toDate < draft.fromDate) {
      setFormError('To date cannot be before the from date.');
      return;
    }
    const salary = draft.lastSalary.trim() === '' ? null : Number(draft.lastSalary);
    if (salary !== null && (Number.isNaN(salary) || salary < 0)) {
      setFormError('Last salary must be a positive number.');
      return;
    }

    const body: Partial<ExperienceRecord> = {
      companyName: draft.companyName.trim(),
      designation: draft.designation.trim() || null,
      employmentType: draft.employmentType === '' ? null : draft.employmentType,
      industry: draft.industry.trim() || null,
      location: draft.location.trim() || null,
      fromDate: draft.fromDate,
      // The server rejects a record that is both current and has an end date.
      toDate: draft.isCurrent ? null : draft.toDate || null,
      isCurrent: draft.isCurrent,
      lastSalary: salary,
      reasonForLeaving: draft.reasonForLeaving.trim() || null,
      projects: draft.projects.trim() || null,
      referenceName: draft.referenceName.trim() || null,
      referenceDesignation: draft.referenceDesignation.trim() || null,
      referencePhone: draft.referencePhone.trim() || null,
      referenceEmail: draft.referenceEmail.trim() || null,
    };

    setSaving(true);
    const req = editingId === null
      ? profileApi.addExperience(employeeId, body)
      : profileApi.updateExperience(editingId, body);
    req
      .then(() => {
        setModalOpen(false);
        load();
      })
      .catch((e: unknown) => window.alert(errMsg(e)))
      .finally(() => setSaving(false));
  };

  const companies = new Set(rows.map((r) => r.companyName.trim().toLowerCase())).size;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-text-primary font-semibold text-sm">Prior experience</h3>
          <p className="text-text-muted text-xs mt-0.5">Employment before joining Harene</p>
        </div>
        <button onClick={openAdd} className={BTN_PRIMARY}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} /> Add experience
          </span>
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total experience"
          value={summary === null ? '—' : summary.display}
          hint="Prior roles plus current tenure"
        />
        <StatCard
          label="Prior experience"
          value={summary === null ? '—' : yearsMonths(summary.priorMonths)}
          hint="Before joining Harene"
        />
        <StatCard
          label="Current tenure"
          value={summary === null ? '—' : yearsMonths(summary.currentTenureMonths)}
          hint="At Harene"
        />
        <StatCard label="Companies" value={companies} hint={`${rows.length} experience records`} />
      </div>

      {error && <ErrorBlock message={error} />}
      {loading && <LoadingBlock />}

      {!loading && !error && rows.length === 0 && (
        <EmptyBlock message="No prior experience recorded" hint="Add previous roles to build the career history." />
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="relative pl-6">
          <span className="absolute left-2 top-2 bottom-2 w-px bg-border-default" aria-hidden />
          <div className="space-y-4">
            {rows.map((row) => (
              <div key={row.id} className="relative">
                <span
                  className={`absolute -left-[18px] top-4 w-2.5 h-2.5 rounded-full border-2 border-bg-card ${
                    row.isCurrent ? 'bg-success' : 'bg-primary'
                  }`}
                  aria-hidden
                />
                <div className="bg-bg-card border border-border-default rounded-md p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="w-8 h-8 rounded-md bg-bg-secondary text-text-secondary flex items-center justify-center flex-shrink-0">
                        <Briefcase size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-text-primary text-sm font-medium truncate">{row.companyName}</p>
                        <p className="text-text-secondary text-xs mt-0.5 truncate">{row.designation || '—'}</p>
                        <p className="text-text-muted text-xs mt-1">
                          {fmtMonth(row.fromDate)} – {row.isCurrent ? 'Present' : fmtMonth(row.toDate)}
                          <span className="mx-1.5">·</span>
                          {yearsMonths(row.months)}
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
                    {row.employmentType && <Chip label={TYPE_LABEL[row.employmentType]} tone="primary" />}
                    {row.industry && <Chip label={row.industry} />}
                    {row.location && <Chip label={row.location} />}
                    {row.isCurrent && <Chip label="Current" tone="success" dot />}
                    {row.lastSalary !== null && <Chip label={`Last drawn ${inr(row.lastSalary)}`} tone="info" />}
                  </div>

                  {(row.reasonForLeaving || row.projects) && (
                    <div className="grid gap-3 sm:grid-cols-2 mt-3">
                      {row.reasonForLeaving && (
                        <div>
                          <p className={LABEL_CLS}>Reason for leaving</p>
                          <p className="text-text-secondary text-xs">{row.reasonForLeaving}</p>
                        </div>
                      )}
                      {row.projects && (
                        <div>
                          <p className={LABEL_CLS}>Projects</p>
                          <p className="text-text-secondary text-xs">{row.projects}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {(row.referenceName || row.referencePhone || row.referenceEmail) && (
                    <div className="mt-3 rounded-md border border-border-light bg-bg-secondary p-3">
                      <p className={LABEL_CLS}>Reference</p>
                      <p className="text-text-primary text-xs font-medium">{row.referenceName || '—'}</p>
                      {row.referenceDesignation && (
                        <p className="text-text-muted text-xs mt-0.5">{row.referenceDesignation}</p>
                      )}
                      <div className="flex items-center gap-4 flex-wrap mt-2">
                        {row.referencePhone && (
                          <span className="inline-flex items-center gap-1.5 text-text-secondary text-xs">
                            <Phone size={14} className="text-text-muted" /> {row.referencePhone}
                          </span>
                        )}
                        {row.referenceEmail && (
                          <span className="inline-flex items-center gap-1.5 text-text-secondary text-xs">
                            <Mail size={14} className="text-text-muted" /> {row.referenceEmail}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {modalOpen && (
        <ModalShell
          title={editingId === null ? 'Add experience' : 'Edit experience'}
          subtitle="Prior employment record"
          onClose={() => setModalOpen(false)}
          maxWidth="max-w-3xl"
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
                <label className={LABEL_CLS}>Company</label>
                <input
                  className={INPUT_CLS}
                  value={draft.companyName}
                  onChange={(e) => setDraft({ ...draft, companyName: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Designation</label>
                <input
                  className={INPUT_CLS}
                  value={draft.designation}
                  onChange={(e) => setDraft({ ...draft, designation: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Employment type</label>
                <select
                  className={INPUT_CLS}
                  value={draft.employmentType}
                  onChange={(e) =>
                    setDraft({ ...draft, employmentType: e.target.value as PriorEmploymentType | '' })
                  }
                >
                  <option value="">Not recorded</option>
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Industry</label>
                <input
                  className={INPUT_CLS}
                  value={draft.industry}
                  onChange={(e) => setDraft({ ...draft, industry: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Location</label>
                <input
                  className={INPUT_CLS}
                  value={draft.location}
                  onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Last salary (monthly)</label>
                <input
                  className={INPUT_CLS}
                  inputMode="numeric"
                  value={draft.lastSalary}
                  onChange={(e) => setDraft({ ...draft, lastSalary: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>From</label>
                <input
                  type="date"
                  className={INPUT_CLS}
                  value={draft.fromDate}
                  onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>To</label>
                <input
                  type="date"
                  className={INPUT_CLS}
                  value={draft.isCurrent ? '' : draft.toDate}
                  disabled={draft.isCurrent}
                  onChange={(e) => setDraft({ ...draft, toDate: e.target.value })}
                />
                {draft.isCurrent && (
                  <p className="text-text-muted text-[11px] mt-1">Cleared because this is the current role.</p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setDraft({ ...draft, isCurrent: !draft.isCurrent, toDate: '' })}
              className={`flex items-center justify-between gap-3 w-full px-3 py-2 rounded-md border transition-colors ${
                draft.isCurrent
                  ? 'bg-primary-light border-primary/30'
                  : 'bg-bg-card border-border-default hover:bg-bg-hover'
              }`}
            >
              <span className={`text-sm ${draft.isCurrent ? 'text-primary' : 'text-text-secondary'}`}>
                Currently working here
              </span>
              <span
                className={`w-9 h-5 rounded-full flex items-center px-0.5 transition-colors ${
                  draft.isCurrent ? 'bg-primary' : 'bg-bg-hover border border-border-default'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full bg-bg-card shadow-sm transition-transform ${
                    draft.isCurrent ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </span>
            </button>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL_CLS}>Reason for leaving</label>
                <textarea
                  className={`${INPUT_CLS} min-h-20`}
                  value={draft.reasonForLeaving}
                  onChange={(e) => setDraft({ ...draft, reasonForLeaving: e.target.value })}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Projects</label>
                <textarea
                  className={`${INPUT_CLS} min-h-20`}
                  value={draft.projects}
                  onChange={(e) => setDraft({ ...draft, projects: e.target.value })}
                />
              </div>
            </div>

            <div className="rounded-md border border-border-light bg-bg-secondary p-3">
              <p className={LABEL_CLS}>Reference</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>Name</label>
                  <input
                    className={INPUT_CLS}
                    value={draft.referenceName}
                    onChange={(e) => setDraft({ ...draft, referenceName: e.target.value })}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Designation</label>
                  <input
                    className={INPUT_CLS}
                    value={draft.referenceDesignation}
                    onChange={(e) => setDraft({ ...draft, referenceDesignation: e.target.value })}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Phone</label>
                  <input
                    className={INPUT_CLS}
                    value={draft.referencePhone}
                    onChange={(e) => setDraft({ ...draft, referencePhone: e.target.value })}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Email</label>
                  <input
                    type="email"
                    className={INPUT_CLS}
                    value={draft.referenceEmail}
                    onChange={(e) => setDraft({ ...draft, referenceEmail: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
