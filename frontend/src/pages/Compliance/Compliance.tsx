import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../../components/common/HrmsUI';
import { TabBar } from '../../components/common/TabBar';
import { ComplianceOverviewSection } from './sections/ComplianceOverviewSection';
import { ContributionsSection } from './sections/ContributionsSection';
import { ChallansSection } from './sections/ChallansSection';
import { FilingsSection } from './sections/FilingsSection';
import { Form16Section } from './sections/Form16Section';
import { ComplianceCalendarSection } from './sections/ComplianceCalendarSection';
import { ComplianceChecksSection } from './sections/ComplianceChecksSection';
import { ComplianceAuditSection } from './sections/ComplianceAuditSection';
import { TaxCalculatorSection } from './sections/TaxCalculatorSection';
import { TaxProofsSection } from './sections/TaxProofsSection';
import { StatutorySetupSection } from './sections/StatutorySetupSection';
import { ComplianceReportsSection } from './sections/ComplianceReportsSection';

export const COMPLIANCE_SECTIONS = [
  { id: 'overview', label: 'Compliance Dashboard' },
  { id: 'contributions', label: 'Contributions' },
  { id: 'challans', label: 'Challans' },
  { id: 'filings', label: 'Returns & Filings' },
  { id: 'form16', label: 'Form 16' },
  { id: 'calendar', label: 'Compliance Calendar' },
  { id: 'checks', label: 'Compliance Checks' },
  { id: 'audit', label: 'Audit & Findings' },
  { id: 'proofs', label: 'Investment Proofs' },
  { id: 'calculator', label: 'Tax Calculator' },
  { id: 'setup', label: 'Statutory Setup' },
  { id: 'reports', label: 'Reports' },
] as const;

const SUBTITLE: Record<string, string> = {
  overview: 'Statutory liability, filing status and compliance score',
  contributions: 'PF, EPS, ESI, PT, LWF and TDS ledger by period',
  challans: 'Statutory payments and acknowledgements',
  filings: 'Government return files prepared for upload',
  form16: 'Part B certificates and distribution',
  calendar: 'Filing and payment due dates',
  checks: 'Automated statutory checks',
  audit: 'Audits, findings and corrective actions',
  proofs: 'Investment proof and HRA verification',
  calculator: 'Regime comparison and take-home projection',
  setup: 'Scheme configuration, state rules and registrations',
  reports: 'Statutory registers and compliance reports',
};

interface ComplianceProps {
  onNavigate: (page: string) => void;
  section?: string;
  onSectionChange?: (section: string) => void;
}

export function Compliance({ onNavigate, section, onSectionChange }: ComplianceProps) {
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
      <PageHeader title="Tax & Compliance" subtitle={SUBTITLE[active] ?? 'Statutory compliance'} />

      <TabBar
        tabs={COMPLIANCE_SECTIONS as unknown as { id: string; label: string }[]}
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
          <ComplianceOverviewSection onNavigate={onNavigate} onSectionChange={setActive} />
        )}
        {active === 'contributions' && <ContributionsSection />}
        {active === 'challans' && <ChallansSection />}
        {active === 'filings' && <FilingsSection />}
        {active === 'form16' && <Form16Section />}
        {active === 'calendar' && <ComplianceCalendarSection />}
        {active === 'checks' && <ComplianceChecksSection onSectionChange={setActive} />}
        {active === 'audit' && <ComplianceAuditSection />}
        {active === 'proofs' && <TaxProofsSection />}
        {active === 'calculator' && <TaxCalculatorSection />}
        {active === 'setup' && <StatutorySetupSection />}
        {active === 'reports' && <ComplianceReportsSection />}
      </motion.div>
    </div>
  );
}
