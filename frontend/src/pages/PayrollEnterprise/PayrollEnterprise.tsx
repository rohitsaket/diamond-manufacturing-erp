import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../../components/common/HrmsUI';
import { TabBar } from '../../components/common/TabBar';
import { PayrollOverviewSection } from './sections/PayrollOverviewSection';
import { PayrollRunsSection } from './sections/PayrollRunsSection';
import { SalaryStructuresSection } from './sections/SalaryStructuresSection';
import { CompensationSection } from './sections/CompensationSection';
import { AwardsSection } from './sections/AwardsSection';
import { LoansSection } from './sections/LoansSection';
import { ReimbursementsSection } from './sections/ReimbursementsSection';
import { TaxComplianceSection } from './sections/TaxComplianceSection';
import { BankTransfersSection } from './sections/BankTransfersSection';
import { PayslipsSection } from './sections/PayslipsSection';
import { PayrollAnalyticsSection } from './sections/PayrollAnalyticsSection';
import { PayrollReportsSection } from './sections/PayrollReportsSection';
import { PayrollApprovalsSection } from './sections/PayrollApprovalsSection';
import { PayrollAuditSection } from './sections/PayrollAuditSection';

export const PAYROLL_SECTIONS = [
  { id: 'overview', label: 'Payroll Dashboard' },
  { id: 'runs', label: 'Payroll Runs' },
  { id: 'structures', label: 'Salary Structures' },
  { id: 'compensation', label: 'Compensation' },
  { id: 'awards', label: 'Bonus & Incentives' },
  { id: 'loans', label: 'Loans & Advances' },
  { id: 'reimbursements', label: 'Reimbursements' },
  { id: 'tax', label: 'Tax & Compliance' },
  { id: 'bank', label: 'Bank Transfers' },
  { id: 'payslips', label: 'Payslips' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'reports', label: 'Reports' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'audit', label: 'Audit Log' },
] as const;

const SUBTITLE: Record<string, string> = {
  overview: 'Live payroll cost, run status and compliance at a glance',
  runs: 'Process, simulate and approve payroll',
  structures: 'Pay components and salary structures',
  compensation: 'Employee packages and revision history',
  awards: 'Bonus, incentives and variable pay',
  loans: 'Employee loans with EMI recovery',
  reimbursements: 'Claims paid through payroll',
  tax: 'Income tax slabs, declarations and statutory compliance',
  bank: 'Salary disbursement files and payment status',
  payslips: 'Generate, download and share payslips',
  analytics: 'Cost, trends, increments, overtime and forecasting',
  reports: 'Registers, statutory and audit reports',
  approvals: 'Multi-level payroll approvals',
  audit: 'Who changed what, and when',
};

interface PayrollEnterpriseProps {
  onNavigate: (page: string) => void;
  section?: string;
  onSectionChange?: (section: string) => void;
}

export function PayrollEnterprise({ onNavigate, section, onSectionChange }: PayrollEnterpriseProps) {
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
      <PageHeader title="Payroll" subtitle={SUBTITLE[active] ?? 'Enterprise payroll and compensation'} />

      <TabBar
        tabs={PAYROLL_SECTIONS as unknown as { id: string; label: string }[]}
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
        {active === 'overview' && <PayrollOverviewSection onNavigate={onNavigate} onSectionChange={setActive} />}
        {active === 'runs' && <PayrollRunsSection onSectionChange={setActive} />}
        {active === 'structures' && <SalaryStructuresSection />}
        {active === 'compensation' && <CompensationSection />}
        {active === 'awards' && <AwardsSection />}
        {active === 'loans' && <LoansSection />}
        {active === 'reimbursements' && <ReimbursementsSection />}
        {active === 'tax' && <TaxComplianceSection />}
        {active === 'bank' && <BankTransfersSection />}
        {active === 'payslips' && <PayslipsSection />}
        {active === 'analytics' && <PayrollAnalyticsSection />}
        {active === 'reports' && <PayrollReportsSection />}
        {active === 'approvals' && <PayrollApprovalsSection />}
        {active === 'audit' && <PayrollAuditSection />}
      </motion.div>
    </div>
  );
}
