import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import { ExecutiveHeader } from './components/executive/ExecutiveHeader';
import { ExecutiveKpiGrid } from './components/executive/ExecutiveKpiGrid';
import { ExecutiveOverviewChart } from './components/executive/ExecutiveOverviewChart';
import { DepartmentHealthMap } from './components/executive/DepartmentHealthMap';
import { FinancialPerformance } from './components/executive/FinancialPerformance';
import { ProductionEfficiencyGauge } from './components/executive/ProductionEfficiencyGauge';
import { ExecutiveRecentAlerts } from './components/executive/ExecutiveRecentAlerts';
import { TopPerformingTeams } from './components/executive/TopPerformingTeams';
import { ExecutiveQuickActions } from './components/executive/ExecutiveQuickActions';
import { CustomizePanel, useWidgetConfig, WidgetDef } from './components/CustomizePanel';
import { useExecutiveDashboardData } from './hooks/useExecutiveDashboardData';
import { GlobalFilters } from './dashboard.types';

const EXECUTIVE_WIDGET_DEFS: WidgetDef[] = [
  { id: 'financial-kpis', title: 'Financial Overview' },
  { id: 'production-metrics', title: 'Production Metrics' },
  { id: 'overview-chart', title: 'Revenue & Profit Trend' },
  { id: 'department-health', title: 'Department Health Map' },
  { id: 'financial-performance', title: 'Financial Performance' },
  { id: 'efficiency-gauge', title: 'Overall Efficiency' },
  { id: 'top-teams', title: 'Top Performing Teams' },
  { id: 'recent-alerts', title: 'Critical Alerts' },
  { id: 'quick-actions', title: 'Executive Actions' },
];

const THEME_KEY = 'harene_theme';

function loadTheme(): boolean {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
  } catch { /* ignore */ }
  return false;
}

interface ExecutiveDashboardProps {
  onNavigate?: (page: string) => void;
}

export function ExecutiveDashboard({ onNavigate = () => {} }: ExecutiveDashboardProps) {
  const { refresh } = useApp();
  const [filters, setFilters] = useState<GlobalFilters>({
    plant: 'All Plants',
    department: 'ALL',
    shift: 'ALL',
    search: '',
    dateFrom: null,
    dateTo: null,
  });
  const [dark, setDark] = useState(loadTheme);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const { config, visibleWidgets, toggle, move, reset } = useWidgetConfig(EXECUTIVE_WIDGET_DEFS);
  const data = useExecutiveDashboardData(filters);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch { /* ignore */ }
  }, [dark]);

  const handleRefresh = useCallback(() => { void refresh(); }, [refresh]);
  const handleExport = useCallback(() => {
    // Executive-specific CSV export for C-suite reporting
    data.exportExecutiveReport();
  }, [data]);

  const renderWidget = (id: string) => {
    switch (id) {
      case 'financial-kpis':
        return <ExecutiveKpiGrid kpis={data.financialKpis} onNavigate={onNavigate} />;
      case 'production-metrics':
        return <ExecutiveKpiGrid kpis={data.productionKpis} onNavigate={onNavigate} />;
      case 'overview-chart':
        return <ExecutiveOverviewChart series={data.revenueTrend} ready={data.ready} />;
      case 'department-health':
        return <DepartmentHealthMap departments={data.departments} onNavigate={onNavigate} />;
      case 'financial-performance':
        return <FinancialPerformance data={data.financialMetrics} />;
      case 'efficiency-gauge':
        return <ProductionEfficiencyGauge metrics={data.overallMetrics} />;
      case 'top-teams':
        return <TopPerformingTeams teams={data.topTeams} />;
      case 'recent-alerts':
        return <ExecutiveRecentAlerts alerts={data.criticalAlerts} />;
      case 'quick-actions':
        return <ExecutiveQuickActions onNavigate={onNavigate} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <ExecutiveHeader
        filters={filters}
        setFilters={setFilters}
        onRefresh={handleRefresh}
        onExport={handleExport}
        dark={dark}
        onToggleDark={() => setDark((d) => !d)}
      />

      {/* Executive summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-xl p-4 border border-blue-200 dark:border-blue-800">
          <span className="text-blue-600 dark:text-blue-400 text-xs font-semibold uppercase tracking-wider">Total Revenue (MTD)</span>
          <p className="text-2xl font-bold text-blue-900 dark:text-blue-100 mt-1">₹{data.totals.mtdRevenue.toFixed(2)}Cr</p>
        </div>
        <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 rounded-xl p-4 border border-green-200 dark:border-green-800">
          <span className="text-green-600 dark:text-green-400 text-xs font-semibold uppercase tracking-wider">Net Profit Margin</span>
          <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-1">{data.totals.profitMargin.toFixed(1)}%</p>
        </div>
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 rounded-xl p-4 border border-purple-200 dark:border-purple-800">
          <span className="text-purple-600 dark:text-purple-400 text-xs font-semibold uppercase tracking-wider">Order Fulfillment</span>
          <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-1">{data.totals.fulfillmentRate.toFixed(1)}%</p>
        </div>
        <div className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/20 dark:to-amber-800/20 rounded-xl p-4 border border-amber-200 dark:border-amber-800">
          <span className="text-amber-600 dark:text-amber-400 text-xs font-semibold uppercase tracking-wider">Inventory Turnover</span>
          <p className="text-2xl font-bold text-amber-900 dark:text-amber-100 mt-1">{data.totals.inventoryTurnover.toFixed(2)}x</p>
        </div>
      </div>

      {/* Executive widgets grid with unique 3-column layout for C-suite */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {visibleWidgets
            .filter(w => ['financial-kpis', 'production-metrics', 'overview-chart', 'department-health', 'financial-performance'].includes(w.id))
            .map((w) => (
              <div key={w.id} className="fade-in-up">
                {renderWidget(w.id)}
              </div>
            ))}
        </div>
        <div className="space-y-6">
          {visibleWidgets
            .filter(w => ['efficiency-gauge', 'top-teams', 'recent-alerts', 'quick-actions'].includes(w.id))
            .map((w) => (
              <div key={w.id} className="fade-in-up">
                {renderWidget(w.id)}
              </div>
            ))}
        </div>
      </div>

      <CustomizePanel
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        defs={EXECUTIVE_WIDGET_DEFS}
        config={config}
        onToggle={toggle}
        onMove={move}
        onReset={reset}
      />
    </div>
  );
}

export function ExecutiveDashboardSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="flex items-center gap-2 text-text-muted text-sm">
        <Loader2 size={15} className="animate-spin" /> Loading executive dashboard data…
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-24 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="skeleton h-80 w-full" />
          <div className="skeleton h-64 w-full" />
        </div>
        <div className="space-y-6">
          <div className="skeleton h-48 w-full" />
          <div className="skeleton h-64 w-full" />
        </div>
      </div>
    </div>
  );
}