import { memo } from 'react';
import { TrendingUp, TrendingDown, IndianRupee, Gem, BarChart3, Clock, DollarSign, Percent, Package, Truck } from 'lucide-react';
import { KpiCardData } from '../../dashboard.types';
import { Sparkline } from '../Sparkline';
import { AnimatedNumber } from '../AnimatedNumber';

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  'mtd-revenue': IndianRupee,
  'mtd-profit': DollarSign,
  'outstanding-payments': Clock,
  'cash-flow': BarChart3,
  'total-production': Gem,
  'order-fulfillment': Truck,
  'inventory-value': Package,
  'capacity-utilization': Percent,
};

const BADGE_STYLES: Record<string, string> = {
  good: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  bad: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
  neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-400 border-gray-200 dark:border-gray-700',
};

function getColorFromClass(className: string): string {
  const colorMap: Record<string, string> = {
    'text-primary': '#2563EB',
    'text-success': '#16A34A',
    'text-warning': '#CA8A04',
    'text-info': '#0891B2',
    'text-purple-600': '#7C3AED',
    'text-blue-600': '#2563EB',
    'text-orange-600': '#EA580C',
  };
  return colorMap[className] || '#6B7280';
}

interface ExecutiveKpiCardProps {
  card: KpiCardData;
  onNavigate: (page: string) => void;
}

function ExecutiveKpiCardBase({ card, onNavigate }: ExecutiveKpiCardProps) {
  const achievement = card.target > 0 ? Math.min(100, Math.round((card.value / card.target) * 100)) : 0;
  const barColor = achievement >= 100 ? '#16A34A' : achievement >= 75 ? '#2563EB' : achievement >= 50 ? '#CA8A04' : '#DC2626';
  const isTrendingUp = card.trend >= 0;
  const Icon = ICONS[card.id] ?? BarChart3;
  const iconColor = getColorFromClass(card.iconColor);
  const sparkColor = iconColor;

  return (
    <button
      onClick={() => onNavigate(card.navigate)}
      aria-label={`${card.title}: ${card.value}${card.suffix ?? ''}. Opens ${card.navigate} page.`}
      title={card.tooltip}
      className="relative text-left bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 border border-border-default rounded-xl shadow-card p-6 overflow-hidden hover:shadow-dropdown hover:-translate-y-1 transition-all duration-300 group cursor-pointer focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 w-full"
    >
      {/* Header with icon and status badge */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span 
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-200"
            style={{ backgroundColor: `${iconColor}15`, color: iconColor }}
          >
            <Icon size={22} />
          </span>
          <div className="text-left">
            <span className="text-text-muted text-xs font-semibold uppercase tracking-wider block">
              {card.title}
            </span>
            <span className="text-text-secondary text-xs mt-0.5 block">{card.sub}</span>
          </div>
        </div>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold border whitespace-nowrap ${BADGE_STYLES[card.badge]}`}>
          {card.statusLabel}
        </span>
      </div>

      {/* Main value */}
      <p className="text-3xl leading-none font-bold tabular-nums text-text-primary mb-4">
        <AnimatedNumber value={card.value} prefix={card.prefix} suffix={card.suffix} decimals={card.decimals} />
      </p>

      {/* Sparkline chart */}
      <div className="h-16 -mx-2 mb-4" aria-hidden="true">
        <Sparkline data={card.spark} color={sparkColor} />
      </div>

      {/* Achievement progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-text-muted text-xs">Target Achievement</span>
          <span className="text-text-secondary text-xs font-semibold tabular-nums">{achievement}%</span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div 
            className="h-full rounded-full transition-all duration-1000 ease-out" 
            style={{ width: `${achievement}%`, background: barColor }}
          />
        </div>
      </div>

      {/* Trend indicator */}
      <div className="pt-4 border-t border-border-light flex items-center justify-between">
        <span className="text-text-muted text-xs">vs previous period</span>
        <span className={`flex items-center gap-1 text-xs font-semibold ${isTrendingUp ? 'text-green-600' : 'text-red-600'}`}>
          {card.trend !== 0 && (isTrendingUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />)}
          {card.trend !== 0 ? `${isTrendingUp ? '+' : ''}${card.trend}%` : 'No change'}
        </span>
      </div>
    </button>
  );
}

export const ExecutiveKpiCard = memo(ExecutiveKpiCardBase);

export function ExecutiveKpiGrid({ kpis, onNavigate }: { kpis: KpiCardData[]; onNavigate: (p: string) => void }) {
  // Executive dashboard uses a 2-column grid for KPI cards on all screen sizes for better readability
  return (
    <div className="bg-bg-card border border-border-default rounded-xl shadow-card p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-text-primary">
          {kpis[0]?.id.includes('financial') || kpis[0]?.id.includes('revenue') || kpis[0]?.prefix === '₹' ? 'Financial Overview' : 'Production Metrics'}
        </h3>
        <span className="text-xs text-text-muted px-3 py-1 bg-bg-hover rounded-full">
          Updated just now
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {kpis.map((card) => (
          <ExecutiveKpiCard key={card.id} card={card} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}