// Employee profile page: resolves the target employee, loads the core profile
// once and renders the active section inside the profile shell.
import { useCallback, useEffect, useState } from 'react';
import { profileCoreApi } from '../../api/profile';
import { BTN_SECONDARY, EmptyBlock, ErrorBlock, LoadingBlock, PageHeader } from '../../components/common/HrmsUI';
import { useApp } from '../../contexts/AppContext';
import { isStaffRole, useAuth } from '../../contexts/AuthContext';
import type { CompletenessRow } from '../../types/profile';
import { ProfileShell } from './ProfileShell';
import { errorMessage } from './ProfileField';
import type { FullProfile } from './ProfileField';

import { PersonalSection } from './sections/PersonalSection';
import { ContactSection } from './sections/ContactSection';
import { FamilySection } from './sections/FamilySection';
import { EmergencySection } from './sections/EmergencySection';
import { PhotoSection } from './sections/PhotoSection';
// Owned by the records agent — these land alongside this page.
import { EducationSection } from './sections/EducationSection';
import { SkillsSection } from './sections/SkillsSection';
import { CertificationsSection } from './sections/CertificationsSection';
import { LanguagesSection } from './sections/LanguagesSection';
import { ExperienceSection } from './sections/ExperienceSection';
import { EmploymentSection } from './sections/EmploymentSection';
import { OrganizationSection } from './sections/OrganizationSection';
import { BankSection } from './sections/BankSection';
import { PayrollSection } from './sections/PayrollSection';
import { DocumentsSection } from './sections/DocumentsSection';
import { AssetsSection } from './sections/AssetsSection';
import { TimelineSection } from './sections/TimelineSection';
import { SettingsSection } from './sections/SettingsSection';

export function EmployeeProfile({
  employeeId,
  onNavigate,
}: {
  employeeId?: number;
  onNavigate: (page: string) => void;
}) {
  const { employees } = useApp();
  const { user } = useAuth();
  const canSwitch = isStaffRole(user?.role);

  const [overrideId, setOverrideId] = useState<number | null>(null);
  const [active, setActive] = useState('personal');

  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [completeness, setCompleteness] = useState<CompletenessRow[]>([]);
  const [completenessError, setCompletenessError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Prop wins, then the signed-in self-service employee, then the first record.
  const resolvedId = overrideId ?? employeeId ?? user?.employeeId ?? employees[0]?.id ?? null;

  const load = useCallback(
    (id: number) => {
      setLoading(true);
      profileCoreApi
        .get(id)
        .then((res) => {
          setProfile(res as FullProfile);
          setError(null);
        })
        .catch((err: unknown) => {
          setProfile(null);
          setError(errorMessage(err));
        })
        .finally(() => setLoading(false));

      profileCoreApi
        .completeness(id)
        .then((rows) => {
          setCompleteness(rows);
          setCompletenessError(null);
        })
        .catch((err: unknown) => {
          setCompleteness([]);
          setCompletenessError(errorMessage(err));
        });
    },
    [],
  );

  useEffect(() => {
    if (resolvedId === null || resolvedId === undefined) {
      setLoading(false);
      return;
    }
    load(resolvedId);
  }, [resolvedId, load]);

  const reload = useCallback(() => {
    if (resolvedId !== null && resolvedId !== undefined) load(resolvedId);
  }, [resolvedId, load]);

  if (resolvedId === null || resolvedId === undefined) {
    return (
      <div className="space-y-4">
        <PageHeader title="Employee profile" />
        <EmptyBlock message="No employee to show" hint="Pick an employee from the employee list first." />
      </div>
    );
  }

  if (loading && !profile) {
    return (
      <div className="space-y-4">
        <PageHeader title="Employee profile" />
        <LoadingBlock label="Loading profile…" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="space-y-4">
        <PageHeader title="Employee profile" />
        <ErrorBlock message={error ?? 'Profile could not be loaded.'} />
        <button type="button" onClick={reload} className={BTN_SECONDARY}>
          Retry
        </button>
      </div>
    );
  }

  const sectionProps = { employeeId: resolvedId, profile, onSaved: reload };

  const renderSection = () => {
    switch (active) {
      case 'personal':
        return <PersonalSection {...sectionProps} />;
      case 'contact':
        return <ContactSection {...sectionProps} />;
      case 'family':
        return <FamilySection {...sectionProps} />;
      case 'emergency':
        return <EmergencySection {...sectionProps} />;
      case 'photo':
        return <PhotoSection {...sectionProps} />;
      case 'education':
        return <EducationSection employeeId={resolvedId} />;
      case 'skills':
        return <SkillsSection employeeId={resolvedId} />;
      case 'certifications':
        return <CertificationsSection employeeId={resolvedId} />;
      case 'languages':
        return <LanguagesSection employeeId={resolvedId} />;
      case 'experience':
        return <ExperienceSection employeeId={resolvedId} />;
      case 'employment':
        return <EmploymentSection employeeId={resolvedId} />;
      case 'organization':
        return <OrganizationSection employeeId={resolvedId} />;
      case 'bank':
        return <BankSection employeeId={resolvedId} />;
      case 'payroll':
        return <PayrollSection employeeId={resolvedId} />;
      case 'documents':
        return <DocumentsSection employeeId={resolvedId} onNavigate={onNavigate} />;
      case 'assets':
        return <AssetsSection employeeId={resolvedId} onNavigate={onNavigate} />;
      case 'timeline':
        return <TimelineSection employeeId={resolvedId} />;
      case 'settings':
        return <SettingsSection employeeId={resolvedId} />;
      default:
        return <EmptyBlock message="Section not found" />;
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Employee profile"
        subtitle="Personal, employment and statutory records for one employee."
      />
      <ProfileShell
        profile={profile}
        completeness={completeness}
        completenessError={completenessError}
        employees={employees}
        selectedId={resolvedId}
        onSelectEmployee={setOverrideId}
        canSwitch={canSwitch}
        active={active}
        onSectionChange={setActive}
      >
        {renderSection()}
      </ProfileShell>
    </div>
  );
}
