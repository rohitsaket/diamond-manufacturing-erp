// Personal details + identity documents.
import { profileCoreApi } from '../../../api/profile';
import { Chip } from '../../../components/common/HrmsUI';
import {
  EditSelect,
  EditText,
  EditTextarea,
  EditToggle,
  FieldGrid,
  FieldRow,
  SectionCard,
  ageFromDob,
  daysUntil,
  formatDate,
  isAadhaar,
  isPan,
  toDateInput,
  useEditableSection,
} from '../ProfileField';
import type { ProfileSectionProps } from '../ProfileField';

const GENDERS = [
  { value: '', label: '—' },
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
];

const MARITAL = [
  { value: '', label: '—' },
  { value: 'SINGLE', label: 'Single' },
  { value: 'MARRIED', label: 'Married' },
  { value: 'DIVORCED', label: 'Divorced' },
  { value: 'WIDOWED', label: 'Widowed' },
  { value: 'OTHER', label: 'Other' },
];

const BLOOD_GROUPS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((v) => ({
  value: v,
  label: v === '' ? '—' : v,
}));

const titleCase = (v: string | null | undefined): string => {
  if (!v) return '';
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
};

/** Passports/visas inside this window get a warning chip. */
const EXPIRY_WINDOW_DAYS = 180;

function ExpiryValue({ value }: { value: string | null | undefined }) {
  const days = daysUntil(value);
  if (!value || days === null) return null;
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      {formatDate(value)}
      {days < 0 ? (
        <Chip label="Expired" tone="danger" />
      ) : days <= EXPIRY_WINDOW_DAYS ? (
        <Chip label={`Expiring soon · ${days}d`} tone="warning" />
      ) : null}
    </span>
  );
}

export function PersonalSection({ employeeId, profile, onSaved }: ProfileSectionProps) {
  const commit = async (patch: Record<string, unknown>) => {
    await profileCoreApi.update(employeeId, patch);
    onSaved();
  };

  const personal = useEditableSection(
    () => ({
      fullName: profile.fullName ?? '',
      preferredName: profile.preferredName ?? '',
      shortName: profile.shortName ?? '',
      gender: profile.gender ?? '',
      dob: toDateInput(profile.dob),
      bloodGroup: profile.bloodGroup ?? '',
      maritalStatus: profile.maritalStatus ?? '',
      nationality: profile.nationality ?? '',
      religion: profile.religion ?? '',
      hasDisability: !!profile.hasDisability,
      disabilityDetails: profile.disabilityDetails ?? '',
      biography: profile.biography ?? '',
    }),
    commit,
    (form) => {
      const errors: Record<string, string> = {};
      if (!form.fullName.trim()) errors.fullName = 'Full name is required';
      return errors;
    },
  );

  const identity = useEditableSection(
    () => ({
      // Masked values are never prefilled — writing a mask back would destroy
      // the stored number. Blank means "leave unchanged".
      aadhaarNumber: '',
      pan: profile.pan ?? '',
      passportNumber: '',
      passportExpiry: toDateInput(profile.passportExpiry),
      visaNumber: profile.visaNumber ?? '',
      visaExpiry: toDateInput(profile.visaExpiry),
      drivingLicense: profile.drivingLicense ?? '',
      voterId: profile.voterId ?? '',
      taxId: profile.taxId ?? '',
    }),
    commit,
    (form) => {
      const errors: Record<string, string> = {};
      if (form.aadhaarNumber.trim() && !isAadhaar(form.aadhaarNumber)) {
        errors.aadhaarNumber = 'Aadhaar must be 12 digits';
      }
      if (form.pan.trim() && !isPan(form.pan)) errors.pan = 'PAN must look like ABCDE1234F';
      return errors;
    },
  );

  const age = ageFromDob(profile.dob);

  return (
    <>
      <SectionCard
        title="Personal details"
        subtitle="Identity basics used across payroll and compliance."
        editing={personal.editing}
        saving={personal.saving}
        onEdit={personal.start}
        onCancel={personal.cancel}
        onSave={personal.save}
      >
        {personal.editing ? (
          <div className="space-y-4">
            <FieldGrid>
              <EditText
                label="Full name"
                required
                value={personal.form.fullName}
                error={personal.errors.fullName}
                onChange={(v) => personal.set('fullName', v)}
              />
              <EditText
                label="Preferred name"
                value={personal.form.preferredName}
                onChange={(v) => personal.set('preferredName', v)}
              />
              <EditText
                label="Short name"
                value={personal.form.shortName}
                onChange={(v) => personal.set('shortName', v)}
              />
              <EditSelect
                label="Gender"
                value={personal.form.gender}
                options={GENDERS}
                onChange={(v) => personal.set('gender', v)}
              />
              <EditText
                label="Date of birth"
                type="date"
                value={personal.form.dob}
                onChange={(v) => personal.set('dob', v)}
              />
              <EditSelect
                label="Blood group"
                value={personal.form.bloodGroup}
                options={BLOOD_GROUPS}
                onChange={(v) => personal.set('bloodGroup', v)}
              />
              <EditSelect
                label="Marital status"
                value={personal.form.maritalStatus}
                options={MARITAL}
                onChange={(v) => personal.set('maritalStatus', v)}
              />
              <EditText
                label="Nationality"
                value={personal.form.nationality}
                onChange={(v) => personal.set('nationality', v)}
              />
              <EditText
                label="Religion"
                value={personal.form.religion}
                onChange={(v) => personal.set('religion', v)}
              />
              <EditToggle
                label="Has disability"
                checked={personal.form.hasDisability}
                onChange={(v) => personal.set('hasDisability', v)}
              />
              <EditText
                label="Disability details"
                value={personal.form.disabilityDetails}
                onChange={(v) => personal.set('disabilityDetails', v)}
              />
            </FieldGrid>
            <EditTextarea
              label="Biography"
              rows={4}
              value={personal.form.biography}
              onChange={(v) => personal.set('biography', v)}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <FieldGrid>
              <FieldRow label="Full name" value={profile.fullName} />
              <FieldRow label="Preferred name" value={profile.preferredName} />
              <FieldRow label="Short name" value={profile.shortName} />
              <FieldRow label="Gender" value={titleCase(profile.gender)} />
              <FieldRow
                label="Date of birth"
                value={
                  profile.dob ? `${formatDate(profile.dob)}${age !== null ? ` · ${age} yrs` : ''}` : null
                }
              />
              <FieldRow label="Blood group" value={profile.bloodGroup} />
              <FieldRow label="Marital status" value={titleCase(profile.maritalStatus)} />
              <FieldRow label="Nationality" value={profile.nationality} />
              <FieldRow label="Religion" value={profile.religion} />
              <FieldRow
                label="Disability"
                value={
                  <span className="inline-flex items-center gap-2 flex-wrap">
                    <Chip
                      label={profile.hasDisability ? 'Yes' : 'No'}
                      tone={profile.hasDisability ? 'warning' : 'default'}
                    />
                    {profile.hasDisability && profile.disabilityDetails && (
                      <span className="text-text-secondary text-sm">{profile.disabilityDetails}</span>
                    )}
                  </span>
                }
              />
            </FieldGrid>
            <div className="pt-2 border-t border-border-light">
              <FieldRow label="Biography" value={profile.biography} />
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Identity documents"
        subtitle="Aadhaar and passport numbers are stored masked — enter a value only to replace it."
        editing={identity.editing}
        saving={identity.saving}
        onEdit={identity.start}
        onCancel={identity.cancel}
        onSave={identity.save}
      >
        {identity.editing ? (
          <FieldGrid>
            <EditText
              label="Aadhaar"
              placeholder="Enter to replace"
              value={identity.form.aadhaarNumber}
              error={identity.errors.aadhaarNumber}
              onChange={(v) => identity.set('aadhaarNumber', v)}
            />
            <EditText
              label="PAN"
              value={identity.form.pan}
              error={identity.errors.pan}
              onChange={(v) => identity.set('pan', v.toUpperCase())}
            />
            <EditText
              label="Passport number"
              placeholder="Enter to replace"
              value={identity.form.passportNumber}
              onChange={(v) => identity.set('passportNumber', v)}
            />
            <EditText
              label="Passport expiry"
              type="date"
              value={identity.form.passportExpiry}
              onChange={(v) => identity.set('passportExpiry', v)}
            />
            <EditText
              label="Visa number"
              value={identity.form.visaNumber}
              onChange={(v) => identity.set('visaNumber', v)}
            />
            <EditText
              label="Visa expiry"
              type="date"
              value={identity.form.visaExpiry}
              onChange={(v) => identity.set('visaExpiry', v)}
            />
            <EditText
              label="Driving licence"
              value={identity.form.drivingLicense}
              onChange={(v) => identity.set('drivingLicense', v)}
            />
            <EditText
              label="Voter ID"
              value={identity.form.voterId}
              onChange={(v) => identity.set('voterId', v)}
            />
            <EditText
              label="Tax identification"
              value={identity.form.taxId}
              onChange={(v) => identity.set('taxId', v)}
            />
          </FieldGrid>
        ) : (
          <FieldGrid>
            <FieldRow label="Aadhaar" value={profile.aadhaarMasked} mono />
            <FieldRow label="PAN" value={profile.pan} mono />
            <FieldRow label="Passport" value={profile.passportMasked} mono />
            <FieldRow
              label="Passport expiry"
              value={profile.passportExpiry ? <ExpiryValue value={profile.passportExpiry} /> : null}
            />
            <FieldRow label="Visa number" value={profile.visaNumber} mono />
            <FieldRow
              label="Visa expiry"
              value={profile.visaExpiry ? <ExpiryValue value={profile.visaExpiry} /> : null}
            />
            <FieldRow label="Driving licence" value={profile.drivingLicense} mono />
            <FieldRow label="Voter ID" value={profile.voterId} mono />
            <FieldRow label="Tax identification" value={profile.taxId} mono />
          </FieldGrid>
        )}
      </SectionCard>
    </>
  );
}
