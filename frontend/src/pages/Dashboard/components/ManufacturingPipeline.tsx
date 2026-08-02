import { memo, useRef } from 'react';
import { ChevronRight, CheckCircle2, Loader2, Clock3, AlertTriangle, XCircle, Gauge } from 'lucide-react';
import { PipelineStage } from '../dashboard.types';
import { SectionCard } from './SectionCard';

function stageColor(pct: number): string {
  if (pct >= 90) return '#16A34A';
  if (pct >= 50) return '#2563EB';
  if (pct > 0) return '#CA8A04';
  return '#9CA3AF';
}

function StageNode({ stage, last }: { stage: PipelineStage; last: boolean }) {
  const color = stageColor(stage.completionPct);
  const barWidth = `${Math.min(100, stage.completionPct)}%`;

  return (
    <div className="flex items-stretch flex-1 min-w-[160px]">
      <div className="relative flex-1 bg-bg-card border border-border-default rounded-lg p-3 shadow-card hover:shadow-dropdown transition-shadow">
        <div className="flex items-center justify-between mb-2">
          <span className="text-text-primary text-xs font-semibold truncate">{stage.name}</span>
          <span className="text-[10px] font-mono font-semibold tabular-nums" style={{ color }}>{stage.completionPct}%</span>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-2">
          <Metric icon={CheckCircle2} cls="text-success" label="Done" value={stage.completed} />
          <Metric icon={Loader2} cls="text-warning" label="Running" value={stage.running} />
          <Metric icon={Clock3} cls="text-text-muted" label="Pending" value={stage.pending} />
          <Metric icon={XCircle} cls="text-danger" label="Rejected" value={stage.rejected} />
        </div>

        <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
          <span>Avg time</span>
          <span className="font-mono tabular-nums">{stage.avgTime}d</span>
        </div>
        <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: barWidth, background: color }} />
        </div>

        {stage.delayed > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-danger-light border border-danger/30 text-danger text-[9px] font-semibold">
            <AlertTriangle size={9} /> {stage.delayed} delayed
          </span>
        )}
      </div>

      {!last && <ChevronRight size={16} className="self-center text-text-muted flex-shrink-0" />}
    </div>
  );
}

function Metric({ icon: Icon, cls, label, value }: { icon: React.ComponentType<{ size?: number; className?: string }>; cls: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1">
      <Icon size={11} className={cls} />
      <span className="text-text-muted text-[10px]">{label}</span>
      <span className="text-text-secondary text-[10px] font-semibold tabular-nums ml-auto">{value}</span>
    </div>
  );
}

function ManufacturingPipelineBase({ stages, totalLots }: { stages: PipelineStage[]; totalLots: number }) {
  const scroller = useRef<HTMLDivElement>(null);

  return (
    <SectionCard
      title="Manufacturing Pipeline"
      subtitle={`${totalLots} lots · estimated live position from lot statuses`}
      icon={<Gauge size={15} />}
      noPadding
      right={
        <button
          onClick={() => scroller.current?.scrollTo({ left: scroller.current.scrollLeft + 360, behavior: 'smooth' })}
          className="px-2.5 py-1 rounded-md border border-border-default text-text-secondary text-xs hover:bg-bg-hover transition-colors"
        >
          Next →
        </button>
      }
    >
      <div ref={scroller} className="overflow-x-auto scrollbar-thin" role="list" aria-label="Manufacturing pipeline stages">
        <div className="flex items-stretch gap-1 p-4 min-w-max">
          {stages.map((s, i) => (
            <StageNode key={s.id} stage={s} last={i === stages.length - 1} />
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

export const ManufacturingPipeline = memo(ManufacturingPipelineBase);
