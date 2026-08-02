import { memo, useState } from 'react';
import { Moon, Sun, CloudMoon, Users, PackageCheck, Gauge, AlertTriangle, Cpu, UserCheck } from 'lucide-react';
import { ShiftStat, ShiftKey } from '../dashboard.types';
import { SectionCard } from './SectionCard';

const SHIFT_ICON: Record<ShiftKey, React.ComponentType<{ size?: number; className?: string }>> = {
  Morning: Sun,
  Evening: CloudMoon,
  Night: Moon,
};

function ShiftMetric({ icon: Icon, label, value, suffix = '' }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: number | string; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={13} className="text-text-muted flex-shrink-0" />
      <span className="text-text-muted text-[11px]">{label}</span>
      <span className="ml-auto text-text-primary text-xs font-semibold tabular-nums">{value}{suffix}</span>
    </div>
  );
}

function ShiftPerformanceBase({ shifts }: { shifts: ShiftStat[] }) {
  const [active, setActive] = useState<ShiftKey>('Morning');
  const current = shifts.find((s) => s.key === active) ?? shifts[0];

  return (
    <SectionCard
      title="Shift Performance"
      subtitle="workers grouped for shift view"
      icon={<Sun size={15} />}
      right={
        <div className="flex items-center gap-1 p-0.5 rounded-md bg-bg-hover" role="tablist" aria-label="Shift selection">
          {shifts.map((s) => {
            const Icon = SHIFT_ICON[s.key];
            return (
              <button
                key={s.key}
                role="tab"
                aria-selected={active === s.key}
                onClick={() => setActive(s.key)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${active === s.key ? 'bg-bg-card text-primary shadow-card' : 'text-text-muted hover:text-text-secondary'}`}
              >
                <Icon size={11} />
                {s.key}
              </button>
            );
          })}
        </div>
      }
    >
      {!current ? (
        <p className="text-text-muted text-xs py-6 text-center">No shift data</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
          <ShiftMetric icon={PackageCheck} label="Production" value={current.production} suffix=" ct" />
          <ShiftMetric icon={Users} label="Workers" value={current.workers} />
          <ShiftMetric icon={Gauge} label="Efficiency" value={current.efficiency} suffix="%" />
          <ShiftMetric icon={AlertTriangle} label="Downtime" value={current.downtime} suffix="%" />
          <ShiftMetric icon={AlertTriangle} label="Rejections" value={current.rejections} />
          <ShiftMetric icon={Cpu} label="Machine usage" value={current.machineUsage} suffix="%" />
          <ShiftMetric icon={UserCheck} label="Attendance" value={current.attendance} suffix="%" />
        </div>
      )}
    </SectionCard>
  );
}

export const ShiftPerformance = memo(ShiftPerformanceBase);
