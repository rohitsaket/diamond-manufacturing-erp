import { memo } from 'react';
import { History, PlayCircle, PackageCheck, ShieldCheck, RotateCcw, Settings2 } from 'lucide-react';
import { ActivityItem } from '../dashboard.types';
import { SectionCard } from './SectionCard';

const TYPE_CFG = {
  issue: { icon: PlayCircle, cls: 'text-primary bg-primary-light' },
  receive: { icon: PackageCheck, cls: 'text-warning bg-warning-light' },
  verify: { icon: ShieldCheck, cls: 'text-success bg-success-light' },
  rework: { icon: RotateCcw, cls: 'text-danger bg-danger-light' },
  system: { icon: Settings2, cls: 'text-text-secondary bg-bg-hover' },
} as const;

function fmtDate(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - dt.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff} days ago`;
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function RecentActivityBase({ activities }: { activities: ActivityItem[] }) {
  return (
    <SectionCard title="Recent Activity" subtitle="latest lot events across the floor" icon={<History size={15} />} noPadding>
      <div className="p-4 space-y-0">
        {activities.length === 0 ? (
          <p className="text-text-muted text-xs text-center py-8">No recent activity</p>
        ) : (
          activities.map((a, i) => {
            const c = TYPE_CFG[a.type];
            return (
              <div key={a.id} className="flex gap-3 relative pb-4 last:pb-0">
                {i < activities.length - 1 && (
                  <span className="absolute left-[13px] top-8 bottom-0 w-px bg-border-light" aria-hidden="true" />
                )}
                <span className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${c.cls}`}>
                  <c.icon size={13} />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-text-primary text-xs font-medium truncate">{a.title}</p>
                    <span className="text-text-muted text-[10px] flex-shrink-0">{fmtDate(a.date)}</span>
                  </div>
                  <p className="text-text-muted text-[10px] mt-0.5 truncate">{a.detail}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </SectionCard>
  );
}

export const RecentActivity = memo(RecentActivityBase);
