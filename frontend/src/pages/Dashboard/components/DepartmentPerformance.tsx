import { memo } from 'react';
import { Building2, CheckCircle2, Clock3, AlertTriangle, Activity } from 'lucide-react';
import { DepartmentStat } from '../dashboard.types';
import { SectionCard } from './SectionCard';

const STATUS_CFG = {
  'on-track': { label: 'On track', cls: 'bg-success-light text-success border-success/25', dot: 'bg-success' },
  'at-risk': { label: 'At risk', cls: 'bg-danger-light text-danger border-danger/25', dot: 'bg-danger' },
  idle: { label: 'Idle', cls: 'bg-bg-hover text-text-muted border-border-default', dot: 'bg-text-muted' },
} as const;

function DepartmentPerformanceBase({ departments }: { departments: DepartmentStat[] }) {
  const active = departments.filter((d) => d.orders > 0);
  return (
    <SectionCard
      title="Department Performance"
      subtitle={`${active.length} active of ${departments.length} departments`}
      icon={<Building2 size={15} />}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {departments.map((d) => {
          const s = STATUS_CFG[d.status];
          const effColor = d.efficiency >= 60 ? '#16A34A' : d.efficiency >= 45 ? '#CA8A04' : '#DC2626';
          return (
            <div key={d.id} className="border border-border-default rounded-lg p-3.5 bg-bg-card hover:border-border-default hover:bg-bg-hover transition-colors">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-text-primary text-xs font-semibold truncate">{d.name}</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold border ${s.cls}`}>
                  <span className={`w-1 h-1 rounded-full ${s.dot}`} />
                  {s.label}
                </span>
              </div>
              <div className="flex items-center gap-4 text-[11px]">
                <span className="flex items-center gap-1 text-text-muted"><CheckCircle2 size={11} className="text-success" /> {d.completed}</span>
                <span className="flex items-center gap-1 text-text-muted"><Clock3 size={11} className="text-warning" /> {d.pending} pending</span>
                <span className="flex items-center gap-1 text-text-muted"><Activity size={11} /> {d.orders} orders</span>
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
                  <span>Efficiency</span>
                  <span className="font-mono font-semibold tabular-nums" style={{ color: effColor }}>{d.efficiency}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, d.efficiency)}%`, background: effColor }} />
                </div>
              </div>
              <div className="mt-2.5 flex items-center justify-between text-[10px]">
                <span className="text-text-muted">Avg time <span className="font-mono text-text-secondary">{d.avgTime}d</span></span>
                {d.delay > 0 ? (
                  <span className="flex items-center gap-1 text-danger font-medium"><AlertTriangle size={10} /> {d.delay} delayed</span>
                ) : (
                  <span className="text-success">No delays</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

export const DepartmentPerformance = memo(DepartmentPerformanceBase);
