import { memo } from 'react';
import { Activity, Factory, TrendingUp, Clock, CheckCircle, AlertCircle } from 'lucide-react';

interface ProductionMetrics {
  capacityUtilization: number;
  oee: number; // Overall Equipment Effectiveness
  onTimeDelivery: number;
  qualityRate: number;
  productionToday: number;
  targetToday: number;
}

interface ProductionEfficiencyGaugeProps {
  metrics: ProductionMetrics;
}

function Gauge({ value, max = 100, label, description }: { value: number; max?: number; label: string; description: string }) {
  const percentage = Math.min(100, (value / max) * 100);
  const circumference = 2 * Math.PI * 45; // r=45
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  
  // Determine color based on performance
  const getColor = () => {
    if (percentage >= 90) return '#16A34A'; // Green for excellent
    if (percentage >= 75) return '#2563EB'; // Blue for good
    if (percentage >= 60) return '#CA8A04'; // Amber for moderate
    return '#DC2626'; // Red for needs improvement
  };

  const color = getColor();

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-32 h-32">
        {/* SVG Gauge */}
        <svg className="w-full h-full transform -rotate-90">
          {/* Background circle */}
          <circle
            cx="64"
            cy="64"
            r="45"
            stroke="var(--color-border-light)"
            strokeWidth="8"
            fill="none"
          />
          {/* Progress circle */}
          <circle
            cx="64"
            cy="64"
            r="45"
            stroke={color}
            strokeWidth="8"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center transform rotate-0">
          <span className="text-2xl font-bold text-text-primary">{value}%</span>
          <span className="text-[10px] text-text-muted">{label}</span>
        </div>
      </div>
      <p className="text-xs text-text-muted mt-2 text-center">{description}</p>
    </div>
  );
}

function ProductionEfficiencyGaugeBase({ metrics }: ProductionEfficiencyGaugeProps) {
  return (
    <div className="bg-bg-card border border-border-default rounded-xl shadow-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Factory size={20} className="text-primary" />
            Production Efficiency
          </h3>
          <p className="text-text-muted text-sm mt-1">Real-time operational metrics</p>
        </div>
        <div className="flex items-center gap-2 text-green-600">
          <Activity size={16} className="animate-pulse" />
          <span className="text-xs font-medium">Live</span>
        </div>
      </div>

      {/* Gauges section */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Gauge value={metrics.capacityUtilization} label="Capacity" description="Factory Utilization" />
        <Gauge value={metrics.oee} label="OEE" description="Overall Effectiveness" />
        <Gauge value={metrics.onTimeDelivery} label="OTD" description="On-Time Delivery" />
        <Gauge value={metrics.qualityRate} label="Quality" description="First Pass Yield" />
      </div>

      {/* Today's production summary */}
      <div className="pt-6 border-t border-border-light">
        <h4 className="text-sm font-semibold text-text-primary mb-4">Today's Production</h4>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-text-muted">Produced / Target</span>
          <span className="text-sm font-semibold text-text-primary">
            {metrics.productionToday} carats / {metrics.targetToday} carats
          </span>
        </div>
        <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden mb-4">
          <div 
            className="h-full bg-green-500 rounded-full transition-all duration-1000"
            style={{ width: `${(metrics.productionToday / metrics.targetToday) * 100}%` }}
          />
        </div>

        {/* Today's highlights */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <CheckCircle size={16} className="text-green-600 mb-1" />
            <span className="text-xs font-semibold text-green-700 dark:text-green-400">100%</span>
            <span className="text-[10px] text-text-muted">On schedule</span>
          </div>
          <div className="flex flex-col items-center p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <Clock size={16} className="text-blue-600 mb-1" />
            <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">8h 23m</span>
            <span className="text-[10px] text-text-muted">Avg runtime</span>
          </div>
          <div className="flex flex-col items-center p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
            <AlertCircle size={16} className="text-amber-600 mb-1" />
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">0</span>
            <span className="text-[10px] text-text-muted">Downtime</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export const ProductionEfficiencyGauge = memo(ProductionEfficiencyGaugeBase);