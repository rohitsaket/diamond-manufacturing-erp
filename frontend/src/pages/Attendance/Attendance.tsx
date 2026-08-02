import { useState } from 'react';
import { PageHeader } from '../../components/common/HrmsUI';
import { TabBar, type TabItem } from '../../components/common/TabBar';
import { DailyMarking } from './DailyMarking';
import { MonthlyRegister } from './MonthlyRegister';
import { ShiftsTab } from './ShiftsTab';

const TABS: TabItem[] = [
  { id: 'daily', label: 'Daily Marking' },
  { id: 'register', label: 'Monthly Register' },
  { id: 'shifts', label: 'Shifts' },
];

/**
 * Attendance workspace. Each tab owns its own fetching so switching tabs
 * remounts the child and refetches naturally.
 */
export function Attendance() {
  const [tab, setTab] = useState<string>('daily');

  return (
    <div className="space-y-5">
      <PageHeader title="Attendance" subtitle="Daily marking · monthly register · shifts" />

      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'daily' && <DailyMarking />}
      {tab === 'register' && <MonthlyRegister />}
      {tab === 'shifts' && <ShiftsTab />}
    </div>
  );
}
