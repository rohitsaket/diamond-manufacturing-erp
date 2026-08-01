import { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { TrendingUp, TrendingDown, Gem, Clock, DollarSign, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { LOT_SLA_DAYS, YIELD_TARGET_PCT, LEAKAGE_FLAG_THRESHOLD_PCT } from '../../data/mockData';
import { DiamondGauge } from '../../components/common/DiamondGauge';
import { useApp } from '../../contexts/AppContext';
import { api } from '../../api/client';

interface YieldPoint { month: string; yield: number; target: number; }
interface CaratFlowItem { name: string; value: number; fill: string; }

function AnimatedNumber({ value, prefix = '', suffix = '', decimals = 0 }: { value: number; prefix?: string; suffix?: string; decimals?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const end = value;
    const duration = 1000;
    const startTime = performance.now();
    let rafId: number;
    const step = (ts: number) => {
      const progress = Math.min((ts - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(end * eased);
      if (progress < 1) rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [value]);
  return <span>{prefix}{display.toFixed(decimals)}{suffix}</span>;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-border-default rounded-lg px-4 py-3 shadow-dropdown">
        <p className="text-text-secondary text-xs font-medium mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} className="text-text-primary text-xs">{p.name}: <span className="font-semibold" style={{ color: p.color }}>{p.value.toFixed(1)}%</span></p>
        ))}
      </div>
    );
  }
  return null;
};

export function Dashboard() {
  const { lots, salaryLines, employees } = useApp();
  const [yieldTrend, setYieldTrend] = useState<YieldPoint[]>([]);
  const [caratFlow, setCaratFlow] = useState<CaratFlowItem[]>([]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get<YieldPoint[]>('/dashboard/yield-trend'),
      api.get<CaratFlowItem[]>('/dashboard/carat-flow'),
    ])
      .then(([yt, cf]) => {
        if (active) { setYieldTrend(yt); setCaratFlow(cf); }
      })
      .catch(() => { /* dashboard charts stay empty on failure */ });
    return () => { active = false; };
  }, []);

  const workerLeaderboard = useMemo(
    () =>
      employees
        .filter(e => e.workStatus === 'WORKING' && e.empCode !== 'MAXI')
        .sort((a, b) => b.yieldPct - a.yieldPct)
        .slice(0, 6),
    [employees],
  );

  const kpi = useMemo(() => {
    const verifiedOrReceived = lots.filter(l => l.status === 'VERIFIED' || l.status === 'RECEIVED');
    const totalPolished = verifiedOrReceived.reduce((s, l) => s + (l.polishedWt ?? 0), 0);
    const totalIssued = verifiedOrReceived.reduce((s, l) => s + l.issueWeight, 0);
    const yieldPct = totalIssued > 0 ? (totalPolished / totalIssued) * 100 : 0;

    const wip = lots.filter(l => l.status === 'ISSUED' || l.status === 'IN_PROGRESS');
    const wipCarats = wip.reduce((s, l) => s + l.issueWeight, 0);

    const withDays = verifiedOrReceived.filter(l => l.daysConsumed !== undefined);
    const avgDays = withDays.length > 0
      ? withDays.reduce((s, l) => s + (l.daysConsumed ?? 0), 0) / withDays.length
      : 0;

    const totalLabour = salaryLines.reduce((s, l) => s + l.totalAmount, 0);
    const totalCts = salaryLines.reduce((s, l) => s + l.totalCts, 0);
    const labourPerCt = totalCts > 0 ? totalLabour / totalCts : 0;

    const received = lots.filter(l => l.daysConsumed !== undefined);
    const onTime = received.filter(l => (l.daysConsumed ?? 0) <= LOT_SLA_DAYS);
    const onTimePct = received.length > 0 ? (onTime.length / received.length) * 100 : 0;

    const reworkCount = lots.filter(l => l.status === 'REWORK').length;
    const reworkPct = received.length > 0 ? (reworkCount / (received.length + reworkCount)) * 100 : 0;

    const leakageExceptions = verifiedOrReceived.filter(l => {
      if (!l.weightDiff || !l.issueWeight) return false;
      return (l.weightDiff / l.issueWeight) * 100 > LEAKAGE_FLAG_THRESHOLD_PCT;
    }).length;

    return { yieldPct, wipCarats, avgDays, labourPerCt, onTimePct, reworkPct, leakageExceptions };
  }, [lots, salaryLines]);

  const liveStatusDist = useMemo(() => [
    { name: 'Issued', value: lots.filter(l => l.status === 'ISSUED').length, color: '#9CA3AF' },
    { name: 'In Progress', value: lots.filter(l => l.status === 'IN_PROGRESS').length, color: '#CA8A04' },
    { name: 'Received', value: lots.filter(l => l.status === 'RECEIVED').length, color: '#2563EB' },
    { name: 'Verified', value: lots.filter(l => l.status === 'VERIFIED').length, color: '#16A34A' },
    { name: 'Rework', value: lots.filter(l => l.status === 'REWORK').length, color: '#EA580C' },
    { name: 'Lost', value: lots.filter(l => l.status === 'LOST').length, color: '#DC2626' },
  ].filter(d => d.value > 0), [lots]);

  const kpiCards = [
    {
      title: 'Yield',
      value: kpi.yieldPct,
      suffix: '%',
      decimals: 1,
      icon: Gem,
      trend: '+1.2%',
      trendUp: true,
      color: '#16A34A',
      sub: `target ${YIELD_TARGET_PCT}%`,
    },
    {
      title: 'WIP Carats',
      value: kpi.wipCarats,
      suffix: ' ct',
      decimals: 1,
      icon: Gem,
      trend: null as string | null,
      trendUp: null as boolean | null,
      color: '#6B7280',
      sub: 'in floor right now',
    },
    {
      title: 'Avg Days',
      value: kpi.avgDays,
      suffix: 'd',
      decimals: 1,
      icon: Clock,
      trend: '-0.6d',
      trendUp: false,
      color: '#2563EB',
      sub: `SLA ${LOT_SLA_DAYS}d`,
    },
    {
      title: 'Labour / ct',
      value: kpi.labourPerCt,
      prefix: '₹',
      decimals: 0,
      icon: DollarSign,
      trend: null as string | null,
      trendUp: null as boolean | null,
      color: '#6B7280',
      sub: 'blended this period',
    },
    {
      title: 'On-time',
      value: kpi.onTimePct,
      suffix: '%',
      decimals: 1,
      icon: CheckCircle,
      trend: '+3.1%',
      trendUp: true,
      color: '#16A34A',
      sub: `≤${LOT_SLA_DAYS}d receive`,
    },
    {
      title: 'Rework',
      value: kpi.reworkPct,
      suffix: '%',
      decimals: 1,
      icon: RefreshCw,
      trend: '-0.8%',
      trendUp: false,
      color: '#EA580C',
      sub: 'of all received lots',
    },
  ];

  const nowLabel = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-text-primary">Dashboard</h2>
          <p className="text-text-secondary text-sm mt-1">Production intelligence · {nowLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {kpi.leakageExceptions > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-danger-light border border-danger/30 text-danger text-sm font-medium">
              <AlertTriangle size={14} />
              {kpi.leakageExceptions} leakage exception{kpi.leakageExceptions !== 1 ? 's' : ''}
            </div>
          )}
          <div className="px-3 py-1.5 rounded-md bg-success-light border border-success/30 text-success text-xs font-medium flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            Real-time
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 xl:grid-cols-6 gap-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.title}
              className="bg-bg-card border border-border-default rounded-md p-4 relative hover:bg-bg-hover transition-colors duration-150"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-text-muted text-[11px] font-medium uppercase tracking-wider">{card.title}</p>
                <Icon size={16} style={{ color: card.color }} />
              </div>
              <p className="text-2xl font-semibold tabular-nums" style={{ color: card.color }}>
                <AnimatedNumber value={card.value} prefix={card.prefix} suffix={card.suffix} decimals={card.decimals} />
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                {card.trendUp === true && <TrendingUp size={11} className="text-success" />}
                {card.trendUp === false && <TrendingDown size={11} className="text-success" />}
                {card.trend && <span className={`text-[10px] font-medium ${card.trendUp !== null ? 'text-success' : 'text-text-muted'}`}>{card.trend}</span>}
              </div>
              <p className="text-text-muted text-[10px] mt-0.5">{card.sub}</p>
            </div>
          );
        })}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-12 gap-4">
        {/* Yield Trend */}
        <div className="col-span-8 bg-bg-card border border-border-default rounded-md p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-text-primary font-semibold text-sm">Yield % — 12-month trend</h3>
              <p className="text-text-muted text-xs mt-0.5">Polished ÷ issued carats per period</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs text-success"><span className="w-3 h-0.5 rounded bg-success inline-block" /> Actual</span>
              <span className="flex items-center gap-1.5 text-xs text-text-muted"><span className="w-3 h-0.5 rounded border-t border-dashed border-text-muted inline-block" /> Target {YIELD_TARGET_PCT}%</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={yieldTrend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="yieldGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#16A34A" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="month" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} domain={[60, 75]} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="target" name="Target" stroke="#9CA3AF" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="yield" name="Yield" stroke="#16A34A" fill="url(#yieldGrad)" strokeWidth={2} dot={{ fill: '#16A34A', r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: '#16A34A' }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Diamond Gauge + Carat Flow */}
        <div className="col-span-4 bg-bg-card border border-border-default rounded-md p-5 flex flex-col items-center justify-center">
          <h3 className="text-text-primary font-semibold text-sm self-start mb-4">Overall Yield</h3>
          <DiamondGauge yieldPct={kpi.yieldPct} size={180} />
          <div className="w-full mt-4 space-y-2">
            {caratFlow.map(f => (
              <div key={f.name} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: f.fill }} />
                <span className="text-text-muted text-xs flex-1">{f.name}</span>
                <span className="text-text-primary text-xs font-medium">{f.value.toFixed(1)} ct</span>
                <div className="w-16 h-1 rounded-full bg-bg-hover overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(f.value / 345.5) * 100}%`, background: f.fill }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-12 gap-4">
        {/* Status Distribution */}
        <div className="col-span-4 bg-bg-card border border-border-default rounded-md p-5">
          <h3 className="text-text-primary font-semibold text-sm mb-4">Lot Status Distribution</h3>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={liveStatusDist} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                {liveStatusDist.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(val) => [`${val} lots`, '']} contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }} />
              <Legend iconSize={8} iconType="circle" formatter={(value) => <span style={{ color: '#6B7280', fontSize: 11 }}>{value}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Worker Leaderboard */}
        <div className="col-span-8 bg-bg-card border border-border-default rounded-md p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-text-primary font-semibold text-sm">Worker Leaderboard — Yield %</h3>
            <span className="text-text-muted text-xs">Sorted by yield, highest first</span>
          </div>
          <div className="space-y-2.5">
            {workerLeaderboard.map((w, i) => (
              <div key={w.id} className="flex items-center gap-3">
                <span className="text-text-muted text-xs font-mono w-4 text-right">{i + 1}</span>
                <div className="w-7 h-7 rounded-full bg-bg-hover border border-border-default flex items-center justify-center text-text-secondary text-[10px] font-bold flex-shrink-0">
                  {w.shortName.split(' ').map((s: string) => s[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-text-primary text-xs font-medium truncate">{w.fullName}</span>
                    <span className="text-text-secondary text-xs font-mono ml-2">{w.yieldPct.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        background: i === 0 ? '#16A34A' : i === 1 ? '#22C55E' : i <= 3 ? '#2563EB' : '#CA8A04',
                        width: `${w.yieldPct}%`
                      }}
                    />
                  </div>
                </div>
                <span className="text-text-muted text-[10px] w-12 text-right">{w.empCode}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
