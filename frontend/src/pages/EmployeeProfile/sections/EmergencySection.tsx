// Emergency and medical contacts.
import { profileCoreApi } from '../../../api/profile';
import {
  EditText,
  EditTextarea,
  FieldGrid,
  FieldRow,
  SectionCard,
  useEditableSection,
} from '../ProfileField';
import type { ProfileSectionProps } from '../ProfileField';

export function EmergencySection({ employeeId, profile, onSaved }: ProfileSectionProps) {
  const commit = async (patch: Record<string, unknown>) => {
    await profileCoreApi.update(employeeId, patch);
    onSaved();
  };

  const primary = useEditableSection(
    () => ({
      emergencyContactName: profile.emergencyContactName ?? '',
      emergencyContactRelation: profile.emergencyContactRelation ?? '',
      emergencyContactPhone: profile.emergencyContactPhone ?? '',
      emergencyContactAddress: profile.emergencyContactAddress ?? '',
    }),
    commit,
  );

  const secondary = useEditableSection(
    () => ({
      emergencyAltName: profile.emergencyAltName ?? '',
      emergencyAltRelation: profile.emergencyAltRelation ?? '',
      emergencyAltPhone: profile.emergencyAltPhone ?? '',
    }),
    commit,
  );

  const medical = useEditableSection(
    () => ({
      medicalContactName: profile.medicalContactName ?? '',
      medicalContactPhone: profile.medicalContactPhone ?? '',
    }),
    commit,
  );

  return (
    <>
      <SectionCard
        title="Primary emergency contact"
        subtitle="Called first if something happens on the floor."
        editing={primary.editing}
        saving={primary.saving}
        onEdit={primary.start}
        onCancel={primary.cancel}
        onSave={primary.save}
      >
        {primary.editing ? (
          <div className="space-y-4">
            <FieldGrid>
              <EditText
                label="Name"
                value={primary.form.emergencyContactName}
                onChange={(v) => primary.set('emergencyContactName', v)}
              />
              <EditText
                label="Relation"
                value={primary.form.emergencyContactRelation}
                onChange={(v) => primary.set('emergencyContactRelation', v)}
              />
              <EditText
                label="Phone"
                value={primary.form.emergencyContactPhone}
                onChange={(v) => primary.set('emergencyContactPhone', v)}
              />
            </FieldGrid>
            <EditTextarea
              label="Address"
              rows={3}
              value={primary.form.emergencyContactAddress}
              onChange={(v) => primary.set('emergencyContactAddress', v)}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <FieldGrid>
              <FieldRow label="Name" value={profile.emergencyContactName} />
              <FieldRow label="Relation" value={profile.emergencyContactRelation} />
              <FieldRow label="Phone" value={profile.emergencyContactPhone} mono />
            </FieldGrid>
            <div className="pt-2 border-t border-border-light">
              <FieldRow label="Address" value={profile.emergencyContactAddress} />
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Secondary contact"
        editing={secondary.editing}
        saving={secondary.saving}
        onEdit={secondary.start}
        onCancel={secondary.cancel}
        onSave={secondary.save}
      >
        {secondary.editing ? (
          <FieldGrid>
            <EditText
              label="Name"
              value={secondary.form.emergencyAltName}
              onChange={(v) => secondary.set('emergencyAltName', v)}
            />
            <EditText
              label="Relation"
              value={secondary.form.emergencyAltRelation}
              onChange={(v) => secondary.set('emergencyAltRelation', v)}
            />
            <EditText
              label="Phone"
              value={secondary.form.emergencyAltPhone}
              onChange={(v) => secondary.set('emergencyAltPhone', v)}
            />
          </FieldGrid>
        ) : (
          <FieldGrid>
            <FieldRow label="Name" value={profile.emergencyAltName} />
            <FieldRow label="Relation" value={profile.emergencyAltRelation} />
            <FieldRow label="Phone" value={profile.emergencyAltPhone} mono />
          </FieldGrid>
        )}
      </SectionCard>

      <SectionCard
        title="Medical contact"
        subtitle="Family doctor or clinic to call in a medical emergency."
        editing={medical.editing}
        saving={medical.saving}
        onEdit={medical.start}
        onCancel={medical.cancel}
        onSave={medical.save}
      >
        {medical.editing ? (
          <FieldGrid>
            <EditText
              label="Name"
              value={medical.form.medicalContactName}
              onChange={(v) => medical.set('medicalContactName', v)}
            />
            <EditText
              label="Phone"
              value={medical.form.medicalContactPhone}
              onChange={(v) => medical.set('medicalContactPhone', v)}
            />
          </FieldGrid>
        ) : (
          <FieldGrid>
            <FieldRow label="Name" value={profile.medicalContactName} />
            <FieldRow label="Phone" value={profile.medicalContactPhone} mono />
          </FieldGrid>
        )}
      </SectionCard>
    </>
  );
}
