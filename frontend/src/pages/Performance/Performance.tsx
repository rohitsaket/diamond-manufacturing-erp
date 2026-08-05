import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '../../components/common/HrmsUI';
import { TabBar } from '../../components/common/TabBar';
import { PerformanceOverviewSection } from './sections/PerformanceOverviewSection';
import { CyclesSection } from './sections/CyclesSection';
import { GoalsSection } from './sections/GoalsSection';
import { KpisSection } from './sections/KpisSection';
import { KrasSection } from './sections/KrasSection';
import { ReviewsSection } from './sections/ReviewsSection';
import { AppraisalsSection } from './sections/AppraisalsSection';
import { PromotionsSection } from './sections/PromotionsSection';
import { CompetenciesSection } from './sections/CompetenciesSection';
import { DevelopmentSection } from './sections/DevelopmentSection';
import { TalentSection } from './sections/TalentSection';
import { FeedbackSection } from './sections/FeedbackSection';
import { PipSection } from './sections/PipSection';
import { PerformanceReportsSection } from './sections/PerformanceReportsSection';

export const PERFORMANCE_SECTIONS = [
  { id: 'overview', label: 'Performance Dashboard' },
  { id: 'cycles', label: 'Performance Cycles' },
  { id: 'goals', label: 'Goals & OKRs' },
  { id: 'kpis', label: 'KPIs' },
  { id: 'kras', label: 'KRAs' },
  { id: 'reviews', label: 'Reviews & 360°' },
  { id: 'appraisals', label: 'Appraisals' },
  { id: 'promotions', label: 'Promotions' },
  { id: 'competencies', label: 'Competencies' },
  { id: 'development', label: 'Development Plans' },
  { id: 'talent', label: 'Talent & Succession' },
  { id: 'feedback', label: 'Feedback & Recognition' },
  { id: 'pip', label: 'Improvement Plans' },
  { id: 'reports', label: 'Reports' },
] as const;

const SUBTITLE: Record<string, string> = {
  overview: 'Goal completion, review progress and organization performance',
  cycles: 'Annual, quarterly and custom review cycles',
  goals: 'Goals, objectives and key results with cascading alignment',
  kpis: 'KPI library, scorecards and automatic tracking from production data',
  kras: 'Key result areas, weightages and scoring',
  reviews: 'Self, manager, peer and 360° feedback',
  appraisals: 'Appraisal records, ratings, calibration and letters',
  promotions: 'Promotion cases, approvals and grade changes',
  competencies: 'Competency framework, assessments and skill matrix',
  development: 'Individual development plans, mentors and learning items',
  talent: '9-box matrix, talent pools, succession and calibration',
  feedback: 'Continuous feedback, recognition and reward points',
  pip: 'Performance improvement plans (confidential)',
  reports: 'Performance, talent and appraisal reports',
};

interface PerformanceProps {
  onNavigate: (page: string) => void;
  section?: string;
  onSectionChange?: (section: string) => void;
}

export function Performance({ onNavigate, section, onSectionChange }: PerformanceProps) {
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
      <PageHeader title="Performance Management" subtitle={SUBTITLE[active] ?? 'Performance management'} />

      <TabBar
        tabs={PERFORMANCE_SECTIONS as unknown as { id: string; label: string }[]}
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
          <PerformanceOverviewSection onNavigate={onNavigate} onSectionChange={setActive} />
        )}
        {active === 'cycles' && <CyclesSection />}
        {active === 'goals' && <GoalsSection />}
        {active === 'kpis' && <KpisSection />}
        {active === 'kras' && <KrasSection />}
        {active === 'reviews' && <ReviewsSection />}
        {active === 'appraisals' && <AppraisalsSection />}
        {active === 'promotions' && <PromotionsSection />}
        {active === 'competencies' && <CompetenciesSection />}
        {active === 'development' && <DevelopmentSection />}
        {active === 'talent' && <TalentSection />}
        {active === 'feedback' && <FeedbackSection />}
        {active === 'pip' && <PipSection />}
        {active === 'reports' && <PerformanceReportsSection />}
      </motion.div>
    </div>
  );
}
