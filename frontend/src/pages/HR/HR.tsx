import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../components/common/HrmsUI';
import { TabBar, type TabItem } from '../../components/common/TabBar';
import { leaveApi } from '../../api/hrms';
import { LeaveRequests } from './LeaveRequests';
import { LeaveBalances } from './LeaveBalances';
import { Holidays } from './Holidays';
import { Advances } from './Advances';

type TabId = 'requests' | 'balances' | 'holidays' | 'advances';

/**
 * Leave & Advances shell — leave requests, per-employee balances, the holiday
 * calendar and advances/loans, each behind its own tab.
 */
export function HR() {
  const [active, setActive] = useState<TabId>('requests');
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  const loadPending = useCallback(() => {
    leaveApi
      .requests({ status: 'PENDING' })
      .then((rows) => setPendingCount(rows.length))
      .catch(() => setPendingCount(null));
  }, []);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  const tabs: TabItem[] = [
    { id: 'requests', label: 'Leave Requests', count: pendingCount },
    { id: 'balances', label: 'Leave Balances' },
    { id: 'holidays', label: 'Holidays' },
    { id: 'advances', label: 'Advances & Loans' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leave & Advances"
        subtitle="Leave requests · balances · holiday calendar · advances and loans"
      />

      <TabBar tabs={tabs} active={active} onChange={(id) => setActive(id as TabId)} />

      {active === 'requests' && <LeaveRequests onChanged={loadPending} />}
      {active === 'balances' && <LeaveBalances />}
      {active === 'holidays' && <Holidays />}
      {active === 'advances' && <Advances />}
    </div>
  );
}
