// Family members, dependents and nominees.
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { profileApi } from '../../../api/profile';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  Chip,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  TableShell,
} from '../../../components/common/HrmsUI';
import { ModalShell } from '../../../components/common/ModalShell';
import {
  EditSelect,
  EditText,
  EditToggle,
  FieldGrid,
  SectionCard,
  errorMessage,
  formatDate,
  isAadhaar,
  toDateInput,
} from '../ProfileField';
import type { ProfileSectionProps } from '../ProfileField';
import type { FamilyMember, FamilyRelation } from '../../../types/profile';

const RELATIONS: FamilyRelation[] = [
  'FATHER',
  'MOTHER',
  'SPOUSE',
  'CHILD',
  'SIBLING',
  'GUARDIAN',
  'OTHER',
];

const RELATION_OPTIONS = RELATIONS.map((r) => ({
  value: r,
  label: r.charAt(0) + r.slice(1).toLowerCase(),
}));

const relationTone = (relation: FamilyRelation): 'primary' | 'info' | 'default' => {
  if (relation === 'SPOUSE' || relation === 'CHILD') return 'primary';
  if (relation === 'FATHER' || relation === 'MOTHER') return 'info';
  return 'default';
};

interface FamilyForm {
  relation: string;
  fullName: string;
  dob: string;
  occupation: string;
  phone: string;
  aadhaarNumber: string;
  isDependent: boolean;
  isNominee: boolean;
  nomineeSharePct: string;
}

const blankForm = (): FamilyForm => ({
  relation: 'FATHER',
  fullName: '',
  dob: '',
  occupation: '',
  phone: '',
  aadhaarNumber: '',
  isDependent: false,
  isNominee: false,
  nomineeSharePct: '',
});

const formFrom = (member: FamilyMember): FamilyForm => ({
  relation: member.relation,
  fullName: member.fullName ?? '',
  dob: toDateInput(member.dob),
  occupation: member.occupation ?? '',
  phone: member.phone ?? '',
  aadhaarNumber: '',
  isDependent: !!member.isDependent,
  isNominee: !!member.isNominee,
  nomineeSharePct: member.nomineeSharePct === null ? '' : String(member.nomineeSharePct),
});

export function FamilySection({ employeeId }: ProfileSectionProps) {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FamilyForm>(blankForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    profileApi
      .family(employeeId)
      .then((rows) => {
        setMembers(rows);
        setError(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const nomineeTotal = members.reduce(
    (sum, m) => sum + (m.isNominee ? Number(m.nomineeSharePct ?? 0) : 0),
    0,
  );

  const openAdd = () => {
    setEditingId(null);
    setForm(blankForm());
    setErrors({});
    setModalOpen(true);
  };

  const openEdit = (member: FamilyMember) => {
    setEditingId(member.id);
    setForm(formFrom(member));
    setErrors({});
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
  };

  const set = <K extends keyof FamilyForm>(key: K, value: FamilyForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  /** Nominee shares are capped at 100 server-side — warn before the round trip. */
  const projectedNomineeTotal = (() => {
    const others = members
      .filter((m) => m.id !== editingId && m.isNominee)
      .reduce((sum, m) => sum + Number(m.nomineeSharePct ?? 0), 0);
    const own = form.isNominee ? Number(form.nomineeSharePct || 0) : 0;
    return others + (Number.isFinite(own) ? own : 0);
  })();

  const submit = () => {
    const found: Record<string, string> = {};
    if (!form.fullName.trim()) found.fullName = 'Name is required';
    if (form.aadhaarNumber.trim() && !isAadhaar(form.aadhaarNumber)) {
      found.aadhaarNumber = 'Aadhaar must be 12 digits';
    }
    if (form.isNominee && form.nomineeSharePct.trim()) {
      const pct = Number(form.nomineeSharePct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) found.nomineeSharePct = 'Share must be 0–100';
    }
    if (projectedNomineeTotal > 100) {
      found.nomineeSharePct = `Nominee shares would total ${projectedNomineeTotal}% (max 100%)`;
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    const body: Partial<FamilyMember> & { aadhaarNumber?: string } = {
      relation: form.relation as FamilyRelation,
      fullName: form.fullName.trim(),
      dob: form.dob ? form.dob : null,
      occupation: form.occupation.trim() || null,
      phone: form.phone.trim() || null,
      isDependent: form.isDependent,
      isNominee: form.isNominee,
      nomineeSharePct: form.isNominee && form.nomineeSharePct.trim() ? Number(form.nomineeSharePct) : null,
    };
    // Aadhaar comes back masked, so only send it when a new value was typed.
    if (form.aadhaarNumber.trim()) body.aadhaarNumber = form.aadhaarNumber.replace(/\s/g, '');

    setSaving(true);
    const request =
      editingId === null ? profileApi.addFamily(employeeId, body) : profileApi.updateFamily(editingId, body);
    request
      .then(() => {
        setModalOpen(false);
        load();
      })
      .catch((err: unknown) => window.alert(errorMessage(err)))
      .finally(() => setSaving(false));
  };

  const remove = (member: FamilyMember) => {
    if (!window.confirm(`Remove ${member.fullName} from the family list?`)) return;
    setDeletingId(member.id);
    profileApi
      .deleteFamily(member.id)
      .then(() => load())
      .catch((err: unknown) => window.alert(errorMessage(err)))
      .finally(() => setDeletingId(null));
  };

  return (
    <SectionCard
      title="Family"
      subtitle="Dependents and nominees used for insurance and statutory records."
      actions={
        <button type="button" onClick={openAdd} className={`${BTN_PRIMARY} inline-flex items-center gap-1.5`}>
          <Plus size={14} /> Add member
        </button>
      }
    >
      {loading ? (
        <LoadingBlock label="Loading family members…" />
      ) : error ? (
        <div className="space-y-3">
          <ErrorBlock message={error} />
          <button type="button" onClick={load} className={BTN_SECONDARY}>
            Retry
          </button>
        </div>
      ) : members.length === 0 ? (
        <EmptyBlock message="No family members recorded" hint="Add a member to capture dependents and nominees." />
      ) : (
        <div className="space-y-3">
          <TableShell
            headers={[
              'Relation',
              'Name',
              'Date of birth',
              'Occupation',
              'Phone',
              'Dependent',
              'Nominee',
              'Share %',
              'Actions',
            ]}
          >
            {members.map((member) => (
              <tr key={member.id} className="hover:bg-bg-hover transition-colors">
                <td className="px-3 py-2">
                  <Chip
                    label={member.relation.charAt(0) + member.relation.slice(1).toLowerCase()}
                    tone={relationTone(member.relation)}
                  />
                </td>
                <td className="px-3 py-2 text-sm text-text-primary whitespace-nowrap">{member.fullName}</td>
                <td className="px-3 py-2 text-sm text-text-secondary whitespace-nowrap">
                  {member.dob ? formatDate(member.dob) : '—'}
                </td>
                <td className="px-3 py-2 text-sm text-text-secondary">{member.occupation ?? '—'}</td>
                <td className="px-3 py-2 text-sm text-text-secondary font-mono whitespace-nowrap">
                  {member.phone ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <Chip label={member.isDependent ? 'Yes' : 'No'} tone={member.isDependent ? 'info' : 'default'} />
                </td>
                <td className="px-3 py-2">
                  <Chip label={member.isNominee ? 'Yes' : 'No'} tone={member.isNominee ? 'success' : 'default'} />
                </td>
                <td className="px-3 py-2 text-sm text-text-secondary tabular-nums whitespace-nowrap">
                  {member.isNominee && member.nomineeSharePct !== null ? `${member.nomineeSharePct}%` : '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(member)}
                      aria-label={`Edit ${member.fullName}`}
                      className="text-text-muted hover:text-primary transition-colors"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(member)}
                      disabled={deletingId === member.id}
                      aria-label={`Delete ${member.fullName}`}
                      className="text-text-muted hover:text-danger transition-colors disabled:opacity-50"
                    >
                      {deletingId === member.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </TableShell>

          <p className={`text-xs ${nomineeTotal > 100 ? 'text-danger' : 'text-text-muted'}`}>
            Nominee share total: {nomineeTotal}%
            {nomineeTotal > 100 && ' — this exceeds 100% and will be rejected on save.'}
          </p>
        </div>
      )}

      <AnimatePresence>
        {modalOpen && (
          <ModalShell
            title={editingId === null ? 'Add family member' : 'Edit family member'}
            subtitle="Nominee shares across all members must not exceed 100%."
            onClose={closeModal}
            maxWidth="max-w-2xl"
            footer={
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className={`text-xs ${projectedNomineeTotal > 100 ? 'text-danger' : 'text-text-muted'}`}>
                  Nominee share total after save: {projectedNomineeTotal}%
                </p>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={closeModal} disabled={saving} className={BTN_SECONDARY}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={saving}
                    className={`${BTN_PRIMARY} inline-flex items-center gap-1.5`}
                  >
                    {saving && <Loader2 size={14} className="animate-spin" />}
                    {editingId === null ? 'Add member' : 'Save changes'}
                  </button>
                </div>
              </div>
            }
          >
            <div className="space-y-4">
              <FieldGrid>
                <EditSelect
                  label="Relation"
                  value={form.relation}
                  options={RELATION_OPTIONS}
                  onChange={(v) => set('relation', v)}
                />
                <EditText
                  label="Full name"
                  required
                  value={form.fullName}
                  error={errors.fullName}
                  onChange={(v) => set('fullName', v)}
                />
                <EditText
                  label="Date of birth"
                  type="date"
                  value={form.dob}
                  onChange={(v) => set('dob', v)}
                />
                <EditText
                  label="Occupation"
                  value={form.occupation}
                  onChange={(v) => set('occupation', v)}
                />
                <EditText label="Phone" value={form.phone} onChange={(v) => set('phone', v)} />
                <EditText
                  label="Aadhaar"
                  placeholder="Enter to replace"
                  value={form.aadhaarNumber}
                  error={errors.aadhaarNumber}
                  onChange={(v) => set('aadhaarNumber', v)}
                />
              </FieldGrid>
              <FieldGrid>
                <EditToggle
                  label="Dependent"
                  checked={form.isDependent}
                  onChange={(v) => set('isDependent', v)}
                />
                <EditToggle label="Nominee" checked={form.isNominee} onChange={(v) => set('isNominee', v)} />
                <EditText
                  label="Nominee share %"
                  type="number"
                  value={form.nomineeSharePct}
                  error={errors.nomineeSharePct}
                  onChange={(v) => set('nomineeSharePct', v)}
                />
              </FieldGrid>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </SectionCard>
  );
}
