import { useMemo, useState } from 'react';
import { PageHeader, EmptyBlock } from '../../components/common/HrmsUI';
import { TabBar, type TabItem } from '../../components/common/TabBar';
import { useAuth, isStaffRole } from '../../contexts/AuthContext';
import { OrgStructureTree } from './OrgStructureTree';
import { OrgEntityManager } from './OrgEntityManager';
import { OrgTeams } from './OrgTeams';
import { OrgJobArchitecture } from './OrgJobArchitecture';
import { OrgChart } from './OrgChart';
import { OrgPositions } from './OrgPositions';
import { OrgDashboard } from './OrgDashboard';
import { OrgGovernance } from './OrgGovernance';

type TabId =
  | 'structure'
  | 'chart'
  | 'entities'
  | 'positions'
  | 'teams'
  | 'jobs'
  | 'dashboard'
  | 'governance';

const TABS: TabItem[] = [
  { id: 'structure', label: 'Structure' },
  { id: 'chart', label: 'Org chart' },
  { id: 'entities', label: 'Entities' },
  { id: 'positions', label: 'Positions' },
  { id: 'teams', label: 'Teams' },
  { id: 'jobs', label: 'Job architecture' },
  { id: 'dashboard', label: 'Analytics' },
  { id: 'governance', label: 'Governance' },
];

/** Roles allowed to create, edit, move or delete org records. */
const WRITE_ROLES = ['admin', 'hr'];

/**
 * Organization shell — the company hierarchy, reporting chart, entity registry,
 * positions, teams, job architecture, analytics and governance behind one tab
 * bar. Everyone on staff can read; only admin/HR may write.
 */
export function Organization({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const [active, setActive] = useState<TabId>('structure');

  const canEdit = useMemo(() => !!user && WRITE_ROLES.includes(user.role), [user]);
  const canRead = isStaffRole(user?.role);

  if (!canRead) {
    return (
      <div className="space-y-5">
        <PageHeader title="Organization" subtitle="Companies, structure, positions and reporting" />
        <div className="bg-bg-card border border-border-default rounded-md">
          <EmptyBlock
            message="You do not have access to the organization structure"
            hint="Ask an administrator if you need visibility of company-wide org data."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Organization" subtitle="Companies, structure, positions and reporting" />

      <TabBar tabs={TABS} active={active} onChange={(id) => setActive(id as TabId)} />

      {active === 'structure' && <OrgStructureTree canEdit={canEdit} onNavigate={onNavigate} />}
      {active === 'chart' && <OrgChart onNavigate={onNavigate} />}
      {active === 'entities' && <OrgEntityManager canEdit={canEdit} />}
      {active === 'positions' && <OrgPositions />}
      {active === 'teams' && <OrgTeams canEdit={canEdit} />}
      {active === 'jobs' && <OrgJobArchitecture canEdit={canEdit} />}
      {active === 'dashboard' && <OrgDashboard onNavigate={onNavigate} />}
      {active === 'governance' && <OrgGovernance />}
    </div>
  );
}
