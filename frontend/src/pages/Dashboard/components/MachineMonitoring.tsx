import { memo } from 'react';
import { Cpu, User, Briefcase, Thermometer, Wrench, Activity } from 'lucide-react';
import { MachineStat } from '../dashboard.types';
import { SectionCard } from './SectionCard';

const STATUS_CFG: Record<MachineStat['status'], { label: string; cls: string; dot: string }> = {
  running: { label: 'Running', cls: 'bg-success-light text-success border-success/25', dot: 'bg-success' },
  idle: { label: 'Idle', cls: 'bg-warning-light text-warning border-warning/25', dot: 'bg-warning' },
  breakdown: { label: 'Breakdown', cls: 'bg-danger-light text-danger border-danger/25', dot: 'bg-danger' },
  maintenance: { label: 'Maintenance', cls: 'bg-primary-light text-primary border-primary/25', dot: 'bg-primary' },
};

function MachineCard({ m }: { m: MachineStat }) {
  const s = STATUS_CFG[m.status];
  const borderColor = m.status === 'running' ? 'border-success/30' : m.status === 'idle' ? 'border-warning/30' : m.status === 'breakdown' ? 'border-danger/40' : 'border-primary/30';
  return (
    <div className={`border ${borderColor} rounded-lg p-3.5 bg-bg-card transition-colors`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-bg-hover border border-border-default flex items-center justify-center text-text-secondary flex-shrink-0">
            <Cpu size={15} />
          </span>
          <div className="min-w-0">
            <p className="text-text-primary text-xs font-semibold">{m.name}</p>
            <p className="text-text-muted text-[10px] font-mono">{m.id}</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-semibold border ${s.cls}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${m.status === 'running' ? 'animate-pulse' : ''}`} />
          {s.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
        <Info icon={User} label="Operator" value={m.operator} />
        <Info icon={Briefcase} label="Current job" value={m.currentJob} />
        <Info icon={Activity} label="OEE" value={`${m.oee}%`} strong />
        <Info icon={Wrench} label="Efficiency" value={`${m.efficiency}%`} />
        <Info icon={Thermometer} label="Temp" value={`${m.temperature}°C`} />
        <Info
          icon={Activity}
          label="Run / Idle"
          value={`${m.runningTime}d / ${m.idleTime}d`}
        />
      </div>

      <div className="mt-2.5 pt-2.5 border-t border-border-light flex items-center justify-between text-[10px]">
        <span className="text-text-muted">Downtime</span>
        <span className="font-mono text-text-secondary font-semibold tabular-nums">{m.downtime}%</span>
      </div>
    </div>
  );
}

function Info({ icon: Icon, label, value, strong }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <Icon size={10} className="text-text-muted flex-shrink-0" />
      <span className="text-text-muted truncate">{label}</span>
      <span className={`ml-auto font-mono truncate ${strong ? 'text-text-primary font-semibold' : 'text-text-secondary'}`}>{value}</span>
    </div>
  );
}

function MachineMonitoringBase({ machines }: { machines: MachineStat[] }) {
  return (
    <SectionCard
      title="Machine / Line Monitoring"
      subtitle="Derived from live lot data per shape line"
      icon={<Cpu size={15} />}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {machines.map((m) => (
          <MachineCard key={m.id} m={m} />
        ))}
      </div>
      <p className="mt-3 text-[10px] text-text-muted">Status: <span className="text-success">● running</span> · <span className="text-warning">● idle</span> · <span className="text-danger">● breakdown</span> · <span className="text-primary">● maintenance</span></p>
    </SectionCard>
  );
}

export const MachineMonitoring = memo(MachineMonitoringBase);
