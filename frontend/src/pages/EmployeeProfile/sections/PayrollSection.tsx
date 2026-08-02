import { useCallback, useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { profileCoreApi } from '../../../api/profile';
import { LoadingBlock, ErrorBlock, inr, Chip } from '../../../components/common/HrmsUI';
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

interface PayrollProfile extends FullProfile {
  payGrade?: string | null;
  salaryStructure?: string | null;
  gratuityApplicable?: boolean;
  insurancePolicyNo?: string | null;
  uanNumber?: string | null;
  esicNumber?: string | null;
}

export function PayrollSection({ employeeId }: { employeeId: number }) {
  const [profile, setProfile] = useState<PayrollProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    profileCoreApi
      .get(employeeId)
      .then((p) => {
        setProfile(p as PayrollProfile);
        setError(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [employeeId]);

  useEffect(load, [load]);

  const editor = useEditableSection(
    () => ({
      monthlySalary: profile?.monthlySalary == null ? '' : String(profile.monthlySalary),
      payGrade: profile?.payGrade ?? '',
      salaryStructure: profile?.salaryStructure ?? '',
      pfApplicable: profile?.pfApplicable ?? false,
      esiApplicable: profile?.esiApplicable ?? false,
      gratuityApplicable: profile?.gratuityApplicable ?? false,
      insurancePolicyNo: profile?.insurancePolicyNo ?? '',
      uanNumber: profile?.uanNumber ?? '',
      esicNumber: profile?.esicNumber ?? '',
    }),
    async (patch) => {
      // The salary field is typed text, so convert before sending.
      const body: Record<string, unknown> = { ...patch };
      if ('monthlySalary' in body) {
        const raw = body.monthlySalary;
        body.monthlySalary = raw === null || raw === '' ? null : Number(raw);
      }
      await profileCoreApi.update(employeeId, body);
      load();
    },
    (form) => {
      const errors: Record<string, string> = {};
      const salary = String(form.monthlySalary).trim();
      if (salary && (!/^\d+(\.\d{1,2})?$/.test(salary) || Number(salary) < 0)) {
        errors.monthlySalary = 'Enter a valid amount';
      }
      const uan = String(form.uanNumber).trim();
      if (uan && !/^\d{12}$/.test(uan)) errors.uanNumber = 'UAN is 12 digits';
      return errors;
    },
  );

  if (loading && !profile) return <LoadingBlock label="Loading payroll information…" />;
  if (error && !profile) return <ErrorBlock message={error} />;
  if (!profile) return null;

  const isFixedPay = profile.workerType === 'DHAR' || profile.workerType === 'MAXI';

  return (
    <div className="space-y-4">
      <SectionCard
        title="Payroll information"
        subtitle="Salary structure and statutory registration"
        editing={editor.editing}
        onEdit={editor.start}
        onCancel={editor.cancel}
        onSave={editor.save}
        saving={editor.saving}
      >
        {editor.editing ? (
          <FieldGrid>
            <EditText
              label="Monthly salary"
              value={editor.form.monthlySalary}
              onChange={(v) => editor.set('monthlySalary', v)}
              error={editor.errors.monthlySalary}
            />
            <EditText label="Pay grade" value={editor.form.payGrade} onChange={(v) => editor.set('payGrade', v)} />
            <EditText
              label="Salary structure"
              value={editor.form.salaryStructure}
              onChange={(v) => editor.set('salaryStructure', v)}
            />
            <EditToggle
              label="PF applicable"
              checked={editor.form.pfApplicable}
              onChange={(v) => editor.set('pfApplicable', v)}
            />
            <EditToggle
              label="ESI applicable"
              checked={editor.form.esiApplicable}
              onChange={(v) => editor.set('esiApplicable', v)}
            />
            <EditToggle
              label="Gratuity applicable"
              checked={editor.form.gratuityApplicable}
              onChange={(v) => editor.set('gratuityApplicable', v)}
            />
            <EditText
              label="UAN number"
              value={editor.form.uanNumber}
              onChange={(v) => editor.set('uanNumber', v)}
              error={editor.errors.uanNumber}
            />
            <EditText label="ESIC number" value={editor.form.esicNumber} onChange={(v) => editor.set('esicNumber', v)} />
            <EditText
              label="Insurance policy no."
              value={editor.form.insurancePolicyNo}
              onChange={(v) => editor.set('insurancePolicyNo', v)}
            />
          </FieldGrid>
        ) : (
          <FieldGrid>
            <FieldRow
              label="Monthly salary"
              value={profile.monthlySalary == null ? null : inr(profile.monthlySalary)}
              mono
            />
            <FieldRow label="Pay grade" value={profile.payGrade} />
            <FieldRow label="Salary structure" value={profile.salaryStructure} />
            <FieldRow
              label="Provident fund"
              value={<Chip label={profile.pfApplicable ? 'Applicable' : 'Not applicable'} tone={profile.pfApplicable ? 'success' : 'default'} />}
            />
            <FieldRow
              label="ESI"
              value={<Chip label={profile.esiApplicable ? 'Applicable' : 'Not applicable'} tone={profile.esiApplicable ? 'success' : 'default'} />}
            />
            <FieldRow
              label="Gratuity"
              value={<Chip label={profile.gratuityApplicable ? 'Applicable' : 'Not applicable'} tone={profile.gratuityApplicable ? 'success' : 'default'} />}
            />
            <FieldRow label="UAN number" value={profile.uanNumber} mono />
            <FieldRow label="ESIC number" value={profile.esicNumber} mono />
            <FieldRow label="Insurance policy no." value={profile.insurancePolicyNo} mono />
          </FieldGrid>
        )}
      </SectionCard>

      {isFixedPay && profile.monthlySalary == null && (
        <div className="px-4 py-3 rounded-md bg-warning-light border border-warning/30 text-warning text-xs">
          This is a {profile.workerType} worker with no monthly salary set. Payroll will calculate zero fixed pay
          for them until a salary is entered.
        </div>
      )}

      <div className="flex items-start gap-2 px-4 py-3 rounded-md bg-info-light border border-primary/20">
        <Info size={14} className="text-primary mt-0.5 flex-shrink-0" />
        <p className="text-text-secondary text-xs">
          Statutory rates are configured once for the whole company, not per employee — provident fund at 12% of the
          capped wage, ESI at 0.75% within the eligibility ceiling, and professional tax by slab. These flags only
          decide whether an employee is covered.
        </p>
      </div>
    </div>
  );
}
