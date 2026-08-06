import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../../components/common/HrmsUI';
import { TabBar } from '../../components/common/TabBar';
// The 12 section files are still being written. A static import of a file that
// does not exist yet fails this whole module — and with it the app shell — so
// every section is temporarily stubbed. Restore the real imports once they land.

export const OFFBOARDING_SECTIONS = [
  { id: 'overview', label: 'Exit Dashboard' },
  { id: 'cases', label: 'Separation Cases' },
  { id: 'interviews', label: 'Exit Interviews' },
  { id: 'clearance', label: 'Clearances' },
  { id: 'assets', label: 'Asset Returns' },
  { id: 'kt', label: 'Knowledge Transfer' },
  { id: 'access', label: 'Access Revocation' },
  { id: 'settlement', label: 'Final Settlement' },
  { id: 'letters', label: 'Exit Letters' },
  { id: 'alumni', label: 'Alumni & Rehire' },
  { id: 'analytics', label: 'Exit Analytics' },
  { id: 'reports', label: 'Reports' },
] as const;

/** Placeholder for a section whose file has not landed yet. */
function PendingSection({ name }: { name: string }) {
  return (
    <div className="bg-bg-card border border-border-default rounded-md p-8 text-center">
      <p className="text-text-primary text-sm font-medium">{name} is still being built</p>
      <p className="text-text-muted text-xs mt-1">The backend for this section is live and tested.</p>
    </div>
  );
}

const ExitOverviewSection = (_p: { onNavigate: (p: string) => void; onSectionChange: (s: string) => void }) => <PendingSection name="Exit Dashboard" />;
const SeparationCasesSection = () => <PendingSection name="Separation Cases" />;
const ExitInterviewsSection = () => <PendingSection name="Exit Interviews" />;
const ClearancesSection = () => <PendingSection name="Clearances" />;
const AssetReturnsSection = () => <PendingSection name="Asset Returns" />;
const KnowledgeTransferSection = () => <PendingSection name="Knowledge Transfer" />;
const AccessRevocationSection = () => <PendingSection name="Access Revocation" />;
const FinalSettlementSection = () => <PendingSection name="Final Settlement" />;
const ExitLettersSection = () => <PendingSection name="Exit Letters" />;
const AlumniSection = () => <PendingSection name="Alumni & Rehire" />;
const ExitAnalyticsSection = () => <PendingSection name="Exit Analytics" />;
const ExitReportsSection = () => <PendingSection name="Reports" />;

const SUBTITLE: Record<string, string> = {
  overview: 'Active cases, pending clearances and exit KPIs',
  cases: 'Resignations, notice periods and the full separation lifecycle',
  interviews: 'Exit interviews and the anonymous exit survey',
  clearance: 'Departmental clearances and task checklists',
  assets: 'Asset returns, verification and damage assessment',
  kt: 'Knowledge transfer plans, successors and handover items',
  access: 'System access revocation checklist',
  settlement: 'Full and final settlement computation and approval',
  letters: 'Experience, relieving and other exit letters with QR verification',
  alumni: 'Alumni directory, rehire eligibility and boomerang tracking',
  analytics: 'Attrition trends, exit reasons and retention analysis',
  reports: 'Offboarding and attrition reports',
};

interface OffboardingProps {
  onNavigate: (page: string) => void;
  section?: string;
  onSectionChange?: (section: string) => void;
}

export function Offboarding({ onNavigate, section, onSectionChange }: OffboardingProps) {
  const [localSection, setLocalSection] = useState<string>('overview');
  const active = section ?? localSection;

  const setActive = useCallback(
    (next: string) => {
      setLocalSection(next);
      onSectionChange?.(next);
    },
    [onSectionChange],
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Offboarding" subtitle={SUBTITLE[active] ?? 'Employee separation management'} />

      <TabBar
        tabs={OFFBOARDING_SECTIONS as unknown as { id: string; label: string }[]}
        active={active}
        onChange={setActive}
      />

      <motion.div
        key={active}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="space-y-4"
      >
        {active === 'overview' && (
          <ExitOverviewSection onNavigate={onNavigate} onSectionChange={setActive} />
        )}
        {active === 'cases' && <SeparationCasesSection />}
        {active === 'interviews' && <ExitInterviewsSection />}
        {active === 'clearance' && <ClearancesSection />}
        {active === 'assets' && <AssetReturnsSection />}
        {active === 'kt' && <KnowledgeTransferSection />}
        {active === 'access' && <AccessRevocationSection />}
        {active === 'settlement' && <FinalSettlementSection />}
        {active === 'letters' && <ExitLettersSection />}
        {active === 'alumni' && <AlumniSection />}
        {active === 'analytics' && <ExitAnalyticsSection />}
        {active === 'reports' && <ExitReportsSection />}
      </motion.div>
    </div>
  );
}
