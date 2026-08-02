import { memo, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { CalendarDays, CalendarRange, Layers, TrendingUp, Gauge } from 'lucide-react';
import { ProdPoint, RangeKey } from '../dashboard.types';
import { SectionCard } from './SectionCard';
import { DiamondGauge } from '../../../components/common/DiamondGauge';

const TABS: { key: RangeKey; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { key: 'today', label: 'Today', icon: CalendarDays },
  { key: 'week', label: 'Week', icon: CalendarRange },
  { key: 'month', label: 'Month', icon: Layers },
  { key: 'quarter', label: 'Quarter', icon: TrendingUp },
  { key: 'year', label: 'Year', icon: Gauge },
];

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-bg-card border border-border-default rounded-md px-3 py-2 shadow-dropdown text-xs">
      <p className="text-text-secondary font-medium mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-text-primary">
          {p.dataKey}: <span className="font-semibold" style={{ color: p.color }}>{Number(p.value).toFixed(1)} ct</span>
        </p>
      ))}
    </div>
  );
}

interface ProductionAnalyticsProps {
  series: Record<RangeKey, ProdPoint[]>;
  yieldTrend: { month: string; yield: number; target: number }[];
  caratFlow: { name: string; value: number; fill: string }[];
  yieldPct: number;
  ready: boolean;
}

function ProductionAnalyticsBase({ series, yieldTrend, caratFlow, yieldPct, ready }: ProductionAnalyticsProps) {
  const [tab, setTab] = useState<RangeKey>('week');
  const data = series[tab] ?? [];

  const rangeLabels: Record<RangeKey, string> = {
    today: 'daily output · last 7 days',
    week: 'daily output · last 4 weeks',
    month: 'daily output · last 90 days',
    quarter: 'weekly output · last 6 months',
    year: 'monthly output · last 12 months',
  };

  const barData = data.filter((d) => d.label !== '').slice(-12);

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Production trend */}
      <SectionCard
        title="Production Trend"
        subtitle={rangeLabels[tab]}
        className="col-span-12 lg:col-span-8"
        right={
          <div className="flex items-center gap-1 p-0.5 rounded-md bg-bg-hover" role="tablist" aria-label="Production time range">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${tab === t.key ? 'bg-bg-card text-primary shadow-card' : 'text-text-muted hover:text-text-secondary'}`}
              >
                <t.icon size={11} />
                {t.label}
              </button>
            ))}
          </div>
        }
      >
        {!ready ? (
          <div className="h-[260px] space-y-3">
            <div className="skeleton h-[200px] w-full" />
            <div className="skeleton h-4 w-40" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="prodGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563EB" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="target" name="Target" stroke="#9CA3AF" strokeDasharray="4 4" strokeWidth={1.5} dot={false} fillOpacity={0} />
              <Area type="monotone" dataKey="actual" name="Actual" stroke="#2563EB" fill="url(#prodGrad)" strokeWidth={2.5} dot={{ r: 2, strokeWidth: 0 }} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      {/* Gauge + Carat flow */}
      <SectionCard title="Overall Yield" className="col-span-12 lg:col-span-4" noPadding>
        {!ready ? (
          <div className="p-5 space-y-3">
            <div className="skeleton w-40 h-40 mx-auto rounded-full" />
            <div className="skeleton h-4 w-full" />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-5">
            <DiamondGauge yieldPct={yieldPct} size={150} />
            <div className="w-full mt-4 space-y-2">
              {caratFlow.map((f) => (
                <div key={f.name} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: f.fill }} />
                  <span className="text-text-muted text-xs flex-1">{f.name}</span>
                  <span className="text-text-primary text-xs font-medium tabular-nums">{f.value.toFixed(1)} ct</span>
                  <div className="w-14 h-1 rounded-full bg-bg-hover overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(f.value / 345.5) * 100}%`, background: f.fill }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {/* Target vs actual (bar) */}
      <SectionCard title="Target vs Actual" subtitle="latest output buckets" className="col-span-12 lg:col-span-6">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={barData} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-bg-hover)', opacity: 0.4 }} />
            <Bar dataKey="actual" name="Actual" fill="#2563EB" radius={[3, 3, 0, 0]} maxBarSize={28} />
            <Bar dataKey="target" name="Target" fill="#9CA3AF" radius={[3, 3, 0, 0]} maxBarSize={28} fillOpacity={0.5} />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* Yield trend (line/area) */}
      <SectionCard title="Yield % Trend" subtitle="polished ÷ issued · vs target" className="col-span-12 lg:col-span-6">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={yieldTrend} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="yieldGrad2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#16A34A" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default)" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis domain={[60, 75]} tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="target" name="Target" stroke="#9CA3AF" strokeDasharray="4 4" strokeWidth={1.5} dot={false} fillOpacity={0} />
            <Area type="monotone" dataKey="yield" name="Yield" stroke="#16A34A" fill="url(#yieldGrad2)" strokeWidth={2.5} dot={{ r: 2.5, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </SectionCard>
    </div>
  );
}

export const ProductionAnalytics = memo(ProductionAnalyticsBase);
