import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../../components/common/HrmsUI';
import { TabBar } from '../../components/common/TabBar';
import { HiringOverviewSection } from './sections/HiringOverviewSection';
import { JobPortalSection } from './sections/JobPortalSection';
import { RequisitionsSection } from './sections/RequisitionsSection';
import { JobPostingsSection } from './sections/JobPostingsSection';
import { ApplicationsSection } from './sections/ApplicationsSection';
import { InterviewsSection } from './sections/InterviewsSection';
import { AssessmentsSection } from './sections/AssessmentsSection';
import { OffersSection } from './sections/OffersSection';
import { ReferralsSection } from './sections/ReferralsSection';
import { TalentPoolSection } from './sections/TalentPoolSection';
import { CareerSection } from './sections/CareerSection';
import { HiringReportsSection } from './sections/HiringReportsSection';

export const INTERNAL_JOBS_SECTIONS = [
  { id: 'overview', label: 'Hiring Dashboard' },
  { id: 'portal', label: 'Job Portal' },
  { id: 'requisitions', label: 'Requisitions' },
  { id: 'jobs', label: 'Job Postings' },
  { id: 'applications', label: 'Applications' },
  { id: 'interviews', label: 'Interviews' },
  { id: 'assessments', label: 'Assessments' },
  { id: 'offers', label: 'Offers' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'talentpool', label: 'Talent Pool' },
  { id: 'career', label: 'Career Development' },
  { id: 'reports', label: 'Reports' },
] as const;

const SUBTITLE: Record<string, string> = {
  overview: 'Vacancies, hiring funnel and internal mobility KPIs',
  portal: 'Browse, save and apply to internal openings and gigs',
  requisitions: 'Hiring requests, budgets and approvals',
  jobs: 'Posting management, templates, publishing and eligibility',
  applications: 'Pipeline review from submission to hire',
  interviews: 'Rounds, panels, scorecards and schedules',
  assessments: 'Recorded skill and aptitude assessments',
  offers: 'Transfer, promotion and gig offers with letters',
  referrals: 'Employee referrals, review and leaderboard',
  talentpool: 'Talent pools, HiPo and ready-now candidates',
  career: 'Career interests, roadmaps and readiness',
  reports: 'Recruitment and mobility reports',
};

interface InternalJobsProps {
  onNavigate: (page: string) => void;
  section?: string;
  onSectionChange?: (section: string) => void;
}

export function InternalJobs({ onNavigate, section, onSectionChange }: InternalJobsProps) {
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
      <PageHeader title="Internal Jobs" subtitle={SUBTITLE[active] ?? 'Internal talent marketplace'} />

      <TabBar
        tabs={INTERNAL_JOBS_SECTIONS as unknown as { id: string; label: string }[]}
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
          <HiringOverviewSection onNavigate={onNavigate} onSectionChange={setActive} />
        )}
        {active === 'portal' && <JobPortalSection />}
        {active === 'requisitions' && <RequisitionsSection />}
        {active === 'jobs' && <JobPostingsSection />}
        {active === 'applications' && <ApplicationsSection />}
        {active === 'interviews' && <InterviewsSection />}
        {active === 'assessments' && <AssessmentsSection />}
        {active === 'offers' && <OffersSection />}
        {active === 'referrals' && <ReferralsSection />}
        {active === 'talentpool' && <TalentPoolSection />}
        {active === 'career' && <CareerSection />}
        {active === 'reports' && <HiringReportsSection />}
      </motion.div>
    </div>
  );
}
