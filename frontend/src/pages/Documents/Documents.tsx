import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/common/HrmsUI';
import { TabBar, type TabItem } from '../../components/common/TabBar';
import { useAuth } from '../../contexts/AuthContext';
import { DocumentBrowser } from './DocumentBrowser';
import { DocumentDashboard } from './DocumentDashboard';
import { DocumentCompliance } from './DocumentCompliance';
import { DocumentAdmin } from './DocumentAdmin';
import { DocumentReports } from './DocumentReports';

type TabId = 'browse' | 'dashboard' | 'compliance' | 'admin' | 'reports';

/** Roles allowed to edit the document taxonomy and requirement rules. */
const ADMIN_ROLES = ['admin', 'hr'];

/**
 * Documents shell — browsing/search, the overview dashboard, compliance
 * tracking, the type/requirement admin screen and reports, each behind a tab.
 */
export function Documents({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const canAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const [active, setActive] = useState<TabId>('browse');

  const tabs = useMemo<TabItem[]>(() => {
    const list: TabItem[] = [
      { id: 'browse', label: 'All documents' },
      { id: 'dashboard', label: 'Overview' },
      { id: 'compliance', label: 'Compliance' },
    ];
    if (canAdmin) list.push({ id: 'admin', label: 'Types & rules' });
    list.push({ id: 'reports', label: 'Reports' });
    return list;
  }, [canAdmin]);

  // If the role loses admin access while the tab is open, fall back to browse.
  const current: TabId = active === 'admin' && !canAdmin ? 'browse' : active;

  return (
    <div className="space-y-5">
      <PageHeader title="Documents" subtitle="Employee document management, verification and compliance" />

      <TabBar tabs={tabs} active={current} onChange={(id) => setActive(id as TabId)} />

      {current === 'browse' && <DocumentBrowser />}
      {current === 'dashboard' && <DocumentDashboard onNavigate={onNavigate} />}
      {current === 'compliance' && <DocumentCompliance onNavigate={onNavigate} />}
      {current === 'admin' && <DocumentAdmin />}
      {current === 'reports' && <DocumentReports />}
    </div>
  );
}
