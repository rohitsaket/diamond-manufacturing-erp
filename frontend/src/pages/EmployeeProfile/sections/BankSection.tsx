import { useCallback, useEffect, useState } from 'react';
import { profileCoreApi } from '../../../api/profile';
import { LoadingBlock, ErrorBlock } from '../../../components/common/HrmsUI';
import {
  FieldGrid,
  FieldRow,
  SectionCard,
  EditText,
  EditToggle,
  useEditableSection,
  errorMessage,
  type FullProfile,
} from '../ProfileField';

interface BankProfile extends FullProfile {
  bankBranch?: string | null;
  upiId?: string | null;
  isSalaryAccount?: boolean;
}

/** Shows only the last four digits; the full number stays out of the read view. */
function maskAccount(value: string | null | undefined): string {
  const digits = String(value ?? '').trim();
  if (!digits) return '';
  if (digits.length <= 4) return digits;
  return `${'•'.repeat(Math.min(8, digits.length - 4))}${digits.slice(-4)}`;
}

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function BankSection({ employeeId }: { employeeId: number }) {
  const [profile, setProfile] = useState<BankProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    profileCoreApi
      .get(employeeId)
      .then((p) => {
        setProfile(p as BankProfile);
        setError(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [employeeId]);

  useEffect(load, [load]);

  const editor = useEditableSection(
    () => ({
      bankName: profile?.bankName ?? '',
      bankAccount: profile?.bankAccount ?? '',
      bankIfsc: profile?.bankIfsc ?? '',
      bankBranch: profile?.bankBranch ?? '',
      upiId: profile?.upiId ?? '',
      isSalaryAccount: profile?.isSalaryAccount ?? true,
    }),
    async (patch) => {
      await profileCoreApi.update(employeeId, patch);
      load();
    },
    (form) => {
      const errors: Record<string, string> = {};
      const ifsc = String(form.bankIfsc).trim().toUpperCase();
      if (ifsc && !IFSC_RE.test(ifsc)) errors.bankIfsc = 'IFSC should look like HDFC0001234';
      const account = String(form.bankAccount).trim();
      if (account && !/^\d{6,20}$/.test(account)) errors.bankAccount = 'Account number should be 6 to 20 digits';
      const upi = String(form.upiId).trim();
      if (upi && !upi.includes('@')) errors.upiId = 'UPI ID should look like name@bank';
      return errors;
    },
  );

  if (loading && !profile) return <LoadingBlock label="Loading bank details…" />;
  if (error && !profile) return <ErrorBlock message={error} />;
  if (!profile) return null;

  return (
    <div className="space-y-4">
      <SectionCard
        title="Bank details"
        subtitle="Account used for salary transfer"
        editing={editor.editing}
        onEdit={editor.start}
        onCancel={editor.cancel}
        onSave={editor.save}
        saving={editor.saving}
      >
        {editor.editing ? (
          <FieldGrid>
            <EditText label="Bank name" value={editor.form.bankName} onChange={(v) => editor.set('bankName', v)} />
            <EditText
              label="Account number"
              value={editor.form.bankAccount}
              onChange={(v) => editor.set('bankAccount', v)}
              error={editor.errors.bankAccount}
            />
            <EditText
              label="IFSC code"
              value={editor.form.bankIfsc}
              onChange={(v) => editor.set('bankIfsc', v.toUpperCase())}
              error={editor.errors.bankIfsc}
            />
            <EditText label="Branch" value={editor.form.bankBranch} onChange={(v) => editor.set('bankBranch', v)} />
            <EditText
              label="UPI ID"
              value={editor.form.upiId}
              onChange={(v) => editor.set('upiId', v)}
              error={editor.errors.upiId}
            />
            <EditToggle
              label="Salary account"
              checked={editor.form.isSalaryAccount}
              onChange={(v) => editor.set('isSalaryAccount', v)}
              hint="Salary is credited to this account"
            />
          </FieldGrid>
        ) : (
          <FieldGrid>
            <FieldRow label="Bank name" value={profile.bankName} />
            <FieldRow label="Account number" value={maskAccount(profile.bankAccount)} mono />
            <FieldRow label="IFSC code" value={profile.bankIfsc} mono />
            <FieldRow label="Branch" value={profile.bankBranch} />
            <FieldRow label="UPI ID" value={profile.upiId} mono />
            <FieldRow label="Salary account" value={profile.isSalaryAccount ? 'Yes' : 'No'} />
          </FieldGrid>
        )}
      </SectionCard>

      <p className="text-text-muted text-[11px]">
        The account number is shown masked. Enter the full number when editing to replace it.
      </p>
    </div>
  );
}
