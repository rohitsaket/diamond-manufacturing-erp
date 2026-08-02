// Contact numbers, addresses and communication preferences.
import { Copy } from 'lucide-react';
import { profileCoreApi } from '../../../api/profile';
import { BTN_SECONDARY, Chip } from '../../../components/common/HrmsUI';
import {
  EditText,
  EditTextarea,
  EditToggle,
  FieldGrid,
  FieldRow,
  SectionCard,
  isEmail,
  isPostalCode,
  useEditableSection,
} from '../ProfileField';
import type { ProfileSectionProps } from '../ProfileField';

export function ContactSection({ employeeId, profile, onSaved }: ProfileSectionProps) {
  const commit = async (patch: Record<string, unknown>) => {
    await profileCoreApi.update(employeeId, patch);
    onSaved();
  };

  const contact = useEditableSection(
    () => ({
      mobile: profile.mobile ?? '',
      alternateMobile: profile.alternateMobile ?? '',
      personalEmail: profile.personalEmail ?? '',
      officialEmail: profile.officialEmail ?? '',
      whatsapp: profile.whatsapp ?? '',
    }),
    commit,
    (form) => {
      const errors: Record<string, string> = {};
      if (form.personalEmail.trim() && !isEmail(form.personalEmail)) {
        errors.personalEmail = 'Enter a valid email address';
      }
      if (form.officialEmail.trim() && !isEmail(form.officialEmail)) {
        errors.officialEmail = 'Enter a valid email address';
      }
      return errors;
    },
  );

  const address = useEditableSection(
    () => ({
      address: profile.address ?? '',
      permanentAddress: profile.permanentAddress ?? '',
      city: profile.city ?? '',
      state: profile.state ?? '',
      country: profile.country ?? '',
      postalCode: profile.postalCode ?? '',
    }),
    commit,
    (form) => {
      const errors: Record<string, string> = {};
      if (form.postalCode.trim() && !isPostalCode(form.postalCode)) {
        errors.postalCode = 'Postal code must be 6 digits';
      }
      return errors;
    },
  );

  const prefs = useEditableSection(
    () => ({
      contactPrefEmail: !!profile.contactPrefEmail,
      contactPrefSms: !!profile.contactPrefSms,
      contactPrefWhatsapp: !!profile.contactPrefWhatsapp,
    }),
    commit,
  );

  const prefChip = (label: string, on: boolean | undefined) => (
    <Chip label={`${label}: ${on ? 'On' : 'Off'}`} tone={on ? 'success' : 'default'} />
  );

  return (
    <>
      <SectionCard
        title="Contact"
        editing={contact.editing}
        saving={contact.saving}
        onEdit={contact.start}
        onCancel={contact.cancel}
        onSave={contact.save}
      >
        {contact.editing ? (
          <FieldGrid>
            <EditText
              label="Mobile"
              value={contact.form.mobile}
              onChange={(v) => contact.set('mobile', v)}
            />
            <EditText
              label="Alternate mobile"
              value={contact.form.alternateMobile}
              onChange={(v) => contact.set('alternateMobile', v)}
            />
            <EditText
              label="Personal email"
              type="email"
              value={contact.form.personalEmail}
              error={contact.errors.personalEmail}
              onChange={(v) => contact.set('personalEmail', v)}
            />
            <EditText
              label="Official email"
              type="email"
              value={contact.form.officialEmail}
              error={contact.errors.officialEmail}
              onChange={(v) => contact.set('officialEmail', v)}
            />
            <EditText
              label="WhatsApp"
              value={contact.form.whatsapp}
              onChange={(v) => contact.set('whatsapp', v)}
            />
          </FieldGrid>
        ) : (
          <FieldGrid>
            <FieldRow label="Mobile" value={profile.mobile} mono />
            <FieldRow label="Alternate mobile" value={profile.alternateMobile} mono />
            <FieldRow label="Personal email" value={profile.personalEmail} />
            <FieldRow label="Official email" value={profile.officialEmail} />
            <FieldRow label="WhatsApp" value={profile.whatsapp} mono />
          </FieldGrid>
        )}
      </SectionCard>

      <SectionCard
        title="Addresses"
        editing={address.editing}
        saving={address.saving}
        onEdit={address.start}
        onCancel={address.cancel}
        onSave={address.save}
      >
        {address.editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <EditTextarea
                label="Current address"
                rows={3}
                value={address.form.address}
                onChange={(v) => address.set('address', v)}
              />
              <div>
                <EditTextarea
                  label="Permanent address"
                  rows={3}
                  value={address.form.permanentAddress}
                  onChange={(v) => address.set('permanentAddress', v)}
                />
                <button
                  type="button"
                  onClick={() => address.setMany({ permanentAddress: address.form.address })}
                  className={`${BTN_SECONDARY} mt-2 inline-flex items-center gap-1.5`}
                >
                  <Copy size={14} /> Same as current address
                </button>
              </div>
            </div>
            <FieldGrid>
              <EditText label="City" value={address.form.city} onChange={(v) => address.set('city', v)} />
              <EditText label="State" value={address.form.state} onChange={(v) => address.set('state', v)} />
              <EditText
                label="Country"
                value={address.form.country}
                onChange={(v) => address.set('country', v)}
              />
              <EditText
                label="Postal code"
                value={address.form.postalCode}
                error={address.errors.postalCode}
                onChange={(v) => address.set('postalCode', v)}
              />
            </FieldGrid>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <FieldRow label="Current address" value={profile.address} />
              <FieldRow label="Permanent address" value={profile.permanentAddress} />
            </div>
            <FieldGrid>
              <FieldRow label="City" value={profile.city} />
              <FieldRow label="State" value={profile.state} />
              <FieldRow label="Country" value={profile.country} />
              <FieldRow label="Postal code" value={profile.postalCode} mono />
            </FieldGrid>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Communication preferences"
        subtitle="Channels this employee agrees to receive notifications on."
        editing={prefs.editing}
        saving={prefs.saving}
        onEdit={prefs.start}
        onCancel={prefs.cancel}
        onSave={prefs.save}
      >
        {prefs.editing ? (
          <FieldGrid>
            <EditToggle
              label="Email"
              checked={prefs.form.contactPrefEmail}
              onChange={(v) => prefs.set('contactPrefEmail', v)}
            />
            <EditToggle
              label="SMS"
              checked={prefs.form.contactPrefSms}
              onChange={(v) => prefs.set('contactPrefSms', v)}
            />
            <EditToggle
              label="WhatsApp"
              checked={prefs.form.contactPrefWhatsapp}
              onChange={(v) => prefs.set('contactPrefWhatsapp', v)}
            />
          </FieldGrid>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {prefChip('Email', profile.contactPrefEmail)}
            {prefChip('SMS', profile.contactPrefSms)}
            {prefChip('WhatsApp', profile.contactPrefWhatsapp)}
          </div>
        )}
      </SectionCard>
    </>
  );
}
