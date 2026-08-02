import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../components/common/HrmsUI';
import { TabBar, type TabItem } from '../../components/common/TabBar';
import { recruitmentApi } from '../../api/hrms';
import { CandidatePipeline } from './CandidatePipeline';
import { JobOpenings } from './JobOpenings';

/**
 * Recruitment workspace. The shell owns only the tab counts; each tab fetches
 * its own rows and calls `onDataChanged` after a mutation so the counts follow.
 */
export function Recruitment() {
  const [tab, setTab] = useState<string>('pipeline');
  const [candidateCount, setCandidateCount] = useState<number | null>(null);
  const [openCount, setOpenCount] = useState<number | null>(null);

  const loadCounts = useCallback(() => {
    recruitmentApi
      .candidates()
      .then((rows) => setCandidateCount(rows.length))
      .catch(() => setCandidateCount(null));
    recruitmentApi
      .openings('OPEN')
      .then((rows) => setOpenCount(rows.length))
      .catch(() => setOpenCount(null));
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  const tabs: TabItem[] = [
    { id: 'pipeline', label: 'Candidates', count: candidateCount },
    { id: 'openings', label: 'Job Openings', count: openCount },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Recruitment" subtitle="Job openings · candidate pipeline · convert to employee" />

      <TabBar tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'pipeline' && <CandidatePipeline onDataChanged={loadCounts} />}
      {tab === 'openings' && <JobOpenings onDataChanged={loadCounts} />}
    </div>
  );
}
