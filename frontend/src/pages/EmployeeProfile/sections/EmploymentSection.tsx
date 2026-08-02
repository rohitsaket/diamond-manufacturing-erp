import { useCallback, useEffect, useMemo, useState } from 'react';
import { profileApi, profileCoreApi } from '../../../api/profile';
import { attendanceApi } from '../../../api/hrms';
import type { Shift } from '../../../types/hrms';
import type { EmploymentDetails, EmploymentType, TimelineEvent, TimelineEventType } from '../../../types/profile';
import { useApp } from '../../../contexts/AppContext';
import { Chip, EmptyBlock, ErrorBlock, LoadingBlock, StatCard } from '../../../components/common/HrmsUI';
import {
  EditSelect,
  EditText,
  FieldGrid,
  FieldRow,
  SectionCard,
  errorMessage,
  formatDate,
  toDateInput,
} from '../ProfileField';

const EMPLOYMENT_TYPES: EmploymentType[] = ['PERMANENT', 'CONTRACT', 'PROBATION', 'TRAINEE', 'CONSULTANT'];
const TYPE_LABEL: Record<EmploymentType, string> = {
  PERMANENT: 'Permanent',
  CONTRACT: 'Contract',
  PROBATION: 'Probation',
  TRAINEE: 'Trainee',
  CONSULTANT: 'Consultant',
};

const HISTORY_TYPES: TimelineEventType[] = ['JOINED', 'CONFIRMED', 'PROMOTION', 'TRANSFER', 'EXIT'];
const HISTORY_LABEL: Record<string, string> = {
  JOINED: 'Joined',
  CONFIRMED: 'Confirmed',
  PROMOTION: 'Promotion',
  TRANSFER: 'Transfer',
  EXIT: 'Exit',
};
const HISTORY_DOT: Record<string, string> = {
  JOINED: 'bg-success',
  CONFIRMED: 'bg-success',
  PROMOTION: 'bg-success',
  TRANSFER: 'bg-primary',
  EXIT: 'bg-danger',
};

/** Renders a month count as "3y 4m". */
function yearsMonths(months: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(months ?? 0)));
  const y = Math.floor(total / 12);
  const m = total % 12;
  if (y === 0 && m === 0) return '0m';
  return [y > 0 ? `${y}y` : '', m > 0 ? `${m}m` : ''].filter(Boolean).join(' ');
}

interface EmpForm {
  employmentType: string;
  confirmationDate: string;
  probationMonths: string;
  noticePeriodDays: string;
  retirementDate: string;
  workLocation: string;
  officeLocation: string;
  shiftId: string;
  grade: string;
  designation: string;
  jobRole: string;
  jobLevel: string;
  reportingManagerId: string;
  hrPartnerId: string;
  costCenter: string;
  payrollGroup: string;
}

function buildForm(d: EmploymentDetails): EmpForm {
  return {
    employmentType: d.employmentType ?? '',
    confirmationDate: toDateInput(d.confirmationDate),
    probationMonths: d.probationMonths === null ? '' : String(d.probationMonths),
    noticePeriodDays: d.noticePeriodDays === null ? '' : String(d.noticePeriodDays),
    retirementDate: toDateInput(d.retirementDate),
    workLocation: d.workLocation ?? '',
    officeLocation: d.officeLocation ?? '',
    shiftId: d.shiftId === null ? '' : String(d.shiftId),
    grade: d.grade ?? '',
    designation: d.designation ?? '',
    jobRole: d.jobRole ?? '',
    jobLevel: d.jobLevel ?? '',
    reportingManagerId: d.reportingManagerId === null ? '' : String(d.reportingManagerId),
    hrPartnerId: d.hrPartnerId === null ? '' : String(d.hrPartnerId),
    costCenter: d.costCenter ?? '',
    payrollGroup: d.payrollGroup ?? '',
  };
}

const str = (v: string): string | null => (v.trim() === '' ? null : v.trim());
const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));

export function EmploymentSection({ employeeId }: { employeeId: number }) {
  const { employees } = useApp();

  const [details, setDetails] = useState<EmploymentDetails | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [history, setHistory] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EmpForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      profileCoreApi.employment(employeeId),
      attendanceApi.shifts().catch(() => [] as Shift[]),
      profileApi.timeline(employeeId).catch(() => [] as TimelineEvent[]),
    ])
      .then(([d, s, t]) => {
        setDetails(d);
        setShifts(s);
        setHistory(
          t
            .filter((e) => (HISTORY_TYPES as string[]).includes(e.eventType))
            .sort((a, b) => (a.eventDate < b.eventDate ? 1 : a.eventDate > b.eventDate ? -1 : 0)),
        );
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const peopleOptions = useMemo(
    () => [
      { value: '', label: 'Not assigned' },
      ...employees
        .filter((e) => e.id !== employeeId)
        .map((e) => ({ value: String(e.id), label: `${e.fullName} (${e.empCode})` })),
    ],
    [employees, employeeId],
  );

  const shiftOptions = useMemo(
    () => [
      { value: '', label: 'Not assigned' },
      ...shifts.map((s) => ({ value: String(s.id), label: `${s.name} (${s.startTime}–${s.endTime})` })),
    ],
    [shifts],
  );

  const startEdit = () => {
    if (!details) return;
    setForm(buildForm(details));
    setFormError(null);
    setEditing(true);
  };

  const handleSave = () => {
    if (!form) return;
    const probation = num(form.probationMonths);
    if (probation !== null && (!Number.isFinite(probation) || probation < 0)) {
      setFormError('Probation months must be a positive number.');
      return;
    }
    const notice = num(form.noticePeriodDays);
    if (notice !== null && (!Number.isFinite(notice) || notice < 0)) {
      setFormError('Notice period must be a positive number of days.');
      return;
    }

    const body: Record<string, unknown> = {
      employmentType: str(form.employmentType),
      confirmationDate: str(form.confirmationDate),
      probationMonths: probation,
      noticePeriodDays: notice,
      retirementDate: str(form.retirementDate),
      workLocation: str(form.workLocation),
      officeLocation: str(form.officeLocation),
      shiftId: num(form.shiftId),
      grade: str(form.grade),
      designation: str(form.designation),
      jobRole: str(form.jobRole),
      jobLevel: str(form.jobLevel),
      reportingManagerId: num(form.reportingManagerId),
      hrPartnerId: num(form.hrPartnerId),
      costCenter: str(form.costCenter),
      payrollGroup: str(form.payrollGroup),
    };

    setSaving(true);
    profileCoreApi
      .update(employeeId, body)
      .then(() => {
        setEditing(false);
        setFormError(null);
        load();
      })
      .catch((e: unknown) => window.alert(errorMessage(e)))
      .finally(() => setSaving(false));
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;
  if (!details) return <EmptyBlock message="No employment details available" />;

  const set = (key: keyof EmpForm, value: string) =>
    setForm((prev) => (prev === null ? prev : { ...prev, [key]: value }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tenure" value={yearsMonths(details.tenureMonths)} hint={`Joined ${formatDate(details.joinedAt) || '—'}`} />
        <StatCard label="Status" value={details.employmentStatus || '—'} />
        <StatCard
          label="Type"
          value={details.employmentType ? TYPE_LABEL[details.employmentType] : '—'}
        />
        <StatCard label="Notice period" value={details.noticePeriodDays === null ? '—' : `${details.noticePeriodDays} d`} />
      </div>

      <SectionCard
        title="Employment"
        subtitle="Contract, reporting and posting details"
        editing={editing}
        onEdit={startEdit}
        onCancel={() => {
          setEditing(false);
          setFormError(null);
        }}
        onSave={handleSave}
        saving={saving}
      >
        {formError && (
          <div className="mb-4">
            <ErrorBlock message={formError} />
          </div>
        )}

        {!editing || form === null ? (
          <FieldGrid>
            <FieldRow label="Employee ID" value={details.employeeId} mono />
            <FieldRow label="Employee code" value={details.empCode} mono />
            <FieldRow label="Employment status" value={details.employmentStatus} />
            <FieldRow
              label="Employment type"
              value={details.employmentType ? TYPE_LABEL[details.employmentType] : null}
            />
            <FieldRow label="Joining date" value={formatDate(details.joinedAt)} />
            <FieldRow label="Confirmation date" value={formatDate(details.confirmationDate)} />
            <FieldRow label="Probation months" value={details.probationMonths} />
            <FieldRow label="Notice period (days)" value={details.noticePeriodDays} />
            <FieldRow label="Exit date" value={formatDate(details.exitDate)} />
            <FieldRow label="Retirement date" value={formatDate(details.retirementDate)} />
            <FieldRow label="Work location" value={details.workLocation} />
            <FieldRow label="Office location" value={details.officeLocation} />
            <FieldRow label="Shift" value={details.shiftName} />
            <FieldRow label="Grade" value={details.grade} />
            <FieldRow label="Designation" value={details.designation} />
            <FieldRow label="Job role" value={details.jobRole} />
            <FieldRow label="Job level" value={details.jobLevel} />
            <FieldRow label="Reporting manager" value={details.reportingManagerName} />
            <FieldRow label="HR business partner" value={details.hrPartnerName} />
            <FieldRow label="Cost centre" value={details.costCenter} />
            <FieldRow label="Payroll group" value={details.payrollGroup} />
          </FieldGrid>
        ) : (
          <FieldGrid>
            <FieldRow label="Employee ID" value={details.employeeId} mono />
            <FieldRow label="Employee code" value={details.empCode} mono />
            <FieldRow label="Employment status" value={details.employmentStatus} />
            <EditSelect
              label="Employment type"
              value={form.employmentType}
              onChange={(v) => set('employmentType', v)}
              options={[
                { value: '', label: 'Not set' },
                ...EMPLOYMENT_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] })),
              ]}
            />
            <FieldRow label="Joining date" value={formatDate(details.joinedAt)} />
            <EditText
              label="Confirmation date"
              type="date"
              value={form.confirmationDate}
              onChange={(v) => set('confirmationDate', v)}
            />
            <EditText
              label="Probation months"
              value={form.probationMonths}
              onChange={(v) => set('probationMonths', v)}
            />
            <EditText
              label="Notice period (days)"
              value={form.noticePeriodDays}
              onChange={(v) => set('noticePeriodDays', v)}
            />
            <FieldRow label="Exit date" value={formatDate(details.exitDate)} />
            <EditText
              label="Retirement date"
              type="date"
              value={form.retirementDate}
              onChange={(v) => set('retirementDate', v)}
            />
            <EditText label="Work location" value={form.workLocation} onChange={(v) => set('workLocation', v)} />
            <EditText label="Office location" value={form.officeLocation} onChange={(v) => set('officeLocation', v)} />
            <EditSelect label="Shift" value={form.shiftId} onChange={(v) => set('shiftId', v)} options={shiftOptions} />
            <EditText label="Grade" value={form.grade} onChange={(v) => set('grade', v)} />
            <EditText label="Designation" value={form.designation} onChange={(v) => set('designation', v)} />
            <EditText label="Job role" value={form.jobRole} onChange={(v) => set('jobRole', v)} />
            <EditText label="Job level" value={form.jobLevel} onChange={(v) => set('jobLevel', v)} />
            <EditSelect
              label="Reporting manager"
              value={form.reportingManagerId}
              onChange={(v) => set('reportingManagerId', v)}
              options={peopleOptions}
            />
            <EditSelect
              label="HR business partner"
              value={form.hrPartnerId}
              onChange={(v) => set('hrPartnerId', v)}
              options={peopleOptions}
            />
            <EditText label="Cost centre" value={form.costCenter} onChange={(v) => set('costCenter', v)} />
            <EditText label="Payroll group" value={form.payrollGroup} onChange={(v) => set('payrollGroup', v)} />
          </FieldGrid>
        )}
      </SectionCard>

      <SectionCard title="Employment history" subtitle="Joining, confirmation, promotions, transfers and exit">
        {history.length === 0 ? (
          <EmptyBlock message="No employment events recorded" hint="Events added to the career timeline appear here." />
        ) : (
          <ul className="space-y-3">
            {history.map((e) => (
              <li key={e.id} className="flex items-start gap-3">
                <span
                  className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${HISTORY_DOT[e.eventType] ?? 'bg-text-muted'}`}
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-text-primary text-sm font-medium">{e.title}</p>
                    <Chip label={HISTORY_LABEL[e.eventType] ?? e.eventType} />
                  </div>
                  <p className="text-text-muted text-xs mt-0.5">
                    {formatDate(e.eventDate) || e.eventDate}
                    {e.fromValue || e.toValue ? ` · ${e.fromValue ?? '—'} → ${e.toValue ?? '—'}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
