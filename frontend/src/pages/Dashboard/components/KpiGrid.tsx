import { memo } from 'react';
import {
  TrendingUp, TrendingDown, MousePointerClick, Gem, CheckCircle2, PlayCircle,
  Clock3, XCircle, Gauge, Boxes, CalendarClock, IndianRupee, CheckCircle, RefreshCw, AlertTriangle,
} from 'lucide-react';
import { KpiCardData, KpiBadge } from '../dashboard.types';
import { Sparkline } from './Sparkline';
import { AnimatedNumber } from './AnimatedNumber';

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  'today-production': Gem,
  completed: CheckCircle2,
  running: PlayCircle,
  pending: Clock3,
  rejected: XCircle,
  efficiency: Gauge,
  wip: Boxes,
  'avg-days': CalendarClock,
  labour: IndianRupee,
  'on-time': CheckCircle,
  rework: RefreshCw,
  leakage: AlertTriangle,
};

const BADGE_CLS: Record<KpiBadge, string> = {
  good: 'bg-success-light text-success border-success/25',
  warn: 'bg-warning-light text-warning border-warning/25',
  bad: 'bg-danger-light text-danger border-danger/25',
  neutral: 'bg-bg-hover text-text-secondary border-border-default',
};

function valueColor(c: string): string {
  switch (c) {
    case 'text-success': return '#16A34A';
    case 'text-danger': return '#DC2626';
    case 'text-warning': return '#CA8A04';
    case 'text-primary': return '#2563EB';
    case 'text-info': return '#2563EB';
    case 'text-purple-600': return '#7C3AED';
    default: return 'var(--color-text-primary)';
  }
}

function KpiCardBase({ card, onNavigate }: { card: KpiCardData; onNavigate: (p: string) => void }) {
  const achievement = card.target > 0 ? Math.min(100, Math.round((card.value / card.target) * 100)) : 0;
  const barColor = achievement >= 100 ? '#16A34A' : achievement >= 75 ? '#2563EB' : achievement >= 50 ? '#CA8A04' : '#DC2626';
  const trendingUp = card.trend >= 0;
  const Icon = ICONS[card.id] ?? Gauge;
  const color = valueColor(card.iconColor);
  const sparkColor = card.iconColor === 'text-purple-600' ? '#7C3AED' : valueColor(card.iconColor) === 'var(--color-text-primary)' ? '#9CA3AF' : color;

  return (
    <button
      onClick={() => onNavigate(card.navigate)}
      aria-label={`${card.title}: ${card.value}${card.suffix ?? ''}. Opens ${card.navigate} page.`}
      title={card.tooltip}
      className="relative text-left bg-bg-card border border-border-default rounded-lg shadow-card p-4 overflow-hidden hover:shadow-dropdown hover:-translate-y-0.5 transition-all duration-200 group cursor-pointer focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
    >
      <div className="flex items-center justify-between mb-2.5 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${card.iconTint} group-hover:scale-110 transition-transform duration-150`} style={{ color }}>
            <Icon size={15} />
          </span>
          <span className="text-text-muted text-[11px] font-semibold uppercase tracking-wider truncate">{card.title}</span>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold border whitespace-nowrap ${BADGE_CLS[card.badge]}`}>
          {card.statusLabel}
        </span>
      </div>

      <p className="text-[26px] leading-none font-semibold tabular-nums" style={{ color }}>
        <AnimatedNumber value={card.value} prefix={card.prefix} suffix={card.suffix} decimals={card.decimals} />
      </p>

      <div className="mt-3 h-9 -mx-1" aria-hidden="true">
        <Sparkline data={card.spark} color={sparkColor} />
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-text-muted text-[10px]">Achievement</span>
          <span className="text-text-secondary text-[10px] font-semibold tabular-nums">{achievement}%</span>
        </div>
        <div className="h-1 rounded-full bg-bg-hover overflow-hidden" role="progressbar" aria-valuenow={achievement} aria-valuemin={0} aria-valuemax={100} aria-label={`${card.title} achievement`}>
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${achievement}%`, background: barColor }} />
        </div>
      </div>

      <div className="mt-2.5 pt-2.5 border-t border-border-light flex items-center justify-between gap-2">
        <span className="text-text-muted text-[10px] truncate">{card.sub}</span>
        <span className="flex items-center gap-0.5 text-[10px] font-semibold text-text-secondary flex-shrink-0">
          {card.trend !== 0 && (trendingUp ? <TrendingUp size={11} className="text-success" /> : <TrendingDown size={11} className="text-danger" />)}
          {card.trend !== 0 ? `${trendingUp ? '+' : ''}${card.trend}` : <MousePointerClick size={11} className="text-text-muted" />}
        </span>
      </div>
    </button>
  );
}

export const KpiCard = memo(KpiCardBase);

export function KpiGrid({ kpis, onNavigate }: { kpis: KpiCardData[]; onNavigate: (p: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
      {kpis.map((card) => (
        <KpiCard key={card.id} card={card} onNavigate={onNavigate} />
      ))}
    </div>
  );
}
