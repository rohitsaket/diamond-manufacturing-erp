import { memo } from 'react';
import { BellRing, Siren, AlertTriangle, Info } from 'lucide-react';
import { AlertItem } from '../dashboard.types';
import { SectionCard } from './SectionCard';

const PRIORITY_CFG: Record<AlertItem['priority'], { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; cls: string; badge: string; ring: string }> = {
  critical: { label: 'Critical', icon: Siren, cls: 'text-danger', badge: 'bg-danger-light text-danger border-danger/30', ring: 'border-danger/40' },
  high: { label: 'High', icon: AlertTriangle, cls: 'text-warning', badge: 'bg-warning-light text-warning border-warning/30', ring: 'border-warning/40' },
  medium: { label: 'Medium', icon: AlertTriangle, cls: 'text-primary', badge: 'bg-primary-light text-primary border-primary/30', ring: 'border-primary/30' },
  low: { label: 'Low', icon: Info, cls: 'text-text-secondary', badge: 'bg-bg-hover text-text-muted border-border-default', ring: 'border-border-default' },
};

function AlertCenterBase({ alerts }: { alerts: AlertItem[] }) {
  const countBy = (p: AlertItem['priority']) => alerts.filter((a) => a.priority === p).length;
  return (
    <SectionCard
      title="Alert Center"
      subtitle={`${alerts.length} active alerts`}
      icon={<BellRing size={15} />}
      noPadding
      right={
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-danger-light text-danger border border-danger/30 font-semibold">{countBy('critical')} crit</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-warning-light text-warning border border-warning/30 font-semibold">{countBy('high')} high</span>
        </div>
      }
    >
      <div className="divide-y divide-border-light">
        {alerts.length === 0 ? (
          <p className="px-4 py-8 text-text-muted text-xs text-center">All clear — no active alerts.</p>
        ) : (
          alerts.map((a) => {
            const c = PRIORITY_CFG[a.priority];
            return (
              <div key={a.id} className={`px-4 py-2.5 flex items-start gap-2.5 border-l-2 ${c.ring}`}>
                <c.icon size={14} className={`${c.cls} mt-0.5 flex-shrink-0`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-text-primary text-xs font-medium truncate">{a.title}</p>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wide border ${c.badge} flex-shrink-0`}>{c.label}</span>
                  </div>
                  <p className="text-text-muted text-[10px] mt-0.5">{a.detail}</p>
                </div>
                <span className="text-[9px] uppercase tracking-wide text-text-muted flex-shrink-0 self-center">{a.category}</span>
              </div>
            );
          })
        )}
      </div>
    </SectionCard>
  );
}

export const AlertCenter = memo(AlertCenterBase);
