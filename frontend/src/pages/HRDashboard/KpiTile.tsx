import { TrendingUp, TrendingDown } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line } from 'recharts';
import type { KpiCard } from '../../types/hrms';

const INTENT_TEXT: Record<string, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  default: 'text-text-primary',
};

/**
 * Single KPI tile: label, tinted value, optional trend row and optional
 * sparkline. Every optional field is guarded — the API may omit any of them.
 */
export function KpiTile({ kpi, onClick }: { kpi: KpiCard; onClick?: () => void }) {
  const tone = INTENT_TEXT[kpi.intent ?? 'default'] ?? INTENT_TEXT.default;
  const spark = kpi.spark ?? [];
  const hasSpark = spark.length >= 2;
  const trend = typeof kpi.trendPct === 'number' ? kpi.trendPct : null;
  const clickable = typeof onClick === 'function';

  const sparkData = hasSpark ? spark.map((v, i) => ({ i, v: Number(v) || 0 })) : [];

  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`bg-bg-card border border-border-default rounded-md p-4 ${
        clickable ? 'cursor-pointer hover:border-primary/30 transition-colors' : ''
      }`}
    >
      <p className="text-text-muted text-xs uppercase tracking-wider">{kpi.label}</p>

      <p className={`text-2xl font-semibold tabular-nums mt-1 ${tone}`}>
        {kpi.value}
        {kpi.unit && <span className="text-sm font-normal text-text-muted ml-1">{kpi.unit}</span>}
      </p>

      {trend !== null && (
        <div className="flex items-center gap-1.5 mt-1.5">
          {trend >= 0 ? (
            <TrendingUp size={14} className="text-success flex-shrink-0" />
          ) : (
            <TrendingDown size={14} className="text-danger flex-shrink-0" />
          )}
          <span className={`text-[11px] font-medium ${trend >= 0 ? 'text-success' : 'text-danger'}`}>
            {Math.abs(trend).toFixed(1)}%
          </span>
          {kpi.comparisonLabel && (
            <span className="text-text-muted text-[11px] truncate">{kpi.comparisonLabel}</span>
          )}
        </div>
      )}

      {trend === null && kpi.comparisonLabel && (
        <p className="text-text-muted text-[11px] mt-1.5 truncate">{kpi.comparisonLabel}</p>
      )}

      {hasSpark && (
        <div className={`h-10 mt-2 -mx-1 ${tone}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <Line
                type="monotone"
                dataKey="v"
                stroke="currentColor"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
