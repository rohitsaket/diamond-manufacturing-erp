import { useCallback, useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, Loader2 } from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import { Lot } from '../../data/mockData';
import { useDashboardData } from './useDashboardData';
import { GlobalFilters, ShiftKey } from './dashboard.types';
import { DashboardHeader } from './components/DashboardHeader';
import { KpiGrid } from './components/KpiGrid';
import { ProductionAnalytics } from './components/ProductionAnalytics';
import { ManufacturingPipeline } from './components/ManufacturingPipeline';
import { DepartmentPerformance } from './components/DepartmentPerformance';
import { ShiftPerformance } from './components/ShiftPerformance';
import { MachineMonitoring } from './components/MachineMonitoring';
import { WorkforcePerformance } from './components/WorkforcePerformance';
import { QualityOverview } from './components/QualityOverview';
import { InventoryOverview } from './components/InventoryOverview';
import { OrderStatus } from './components/OrderStatus';
import { AlertCenter } from './components/AlertCenter';
import { RecentActivity } from './components/RecentActivity';
import { QuickActions } from './components/QuickActions';
import { CustomizePanel, useWidgetConfig, WidgetDef } from './components/CustomizePanel';

const WIDGET_DEFS: WidgetDef[] = [
  { id: 'kpis', title: 'KPI Cards' },
  { id: 'analytics', title: 'Production Analytics' },
  { id: 'pipeline', title: 'Manufacturing Pipeline' },
  { id: 'departments', title: 'Department Performance' },
  { id: 'shifts', title: 'Shift Performance' },
  { id: 'machines', title: 'Machine / Line Monitoring' },
  { id: 'workforce', title: 'Workforce Performance' },
  { id: 'quality', title: 'Quality Dashboard' },
  { id: 'inventory', title: 'Inventory Overview' },
  { id: 'orders', title: 'Order Status' },
  { id: 'alerts', title: 'Alert Center' },
  { id: 'activity', title: 'Recent Activity' },
  { id: 'quick', title: 'Quick Actions' },
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

export function exportLotsCsv(lots: Lot[]) {
  const headers = [
    'Lot Name', 'Lot ID', 'Worker', 'Shape', 'Qty', 'Issue Wt (ct)', 'Est Wt (ct)',
    'Polished Wt (ct)', 'Issue Date', 'Received Date', 'Days', 'Color', 'Clarity',
    'Lab', 'Labour Head', 'Labour Amount (₹)', 'Weight Diff (ct)', 'Status',
  ];
  const escape = (v: string | number | undefined | null) => {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    headers.join(','),
    ...lots.map((l) => [
      l.lotName, l.lotId, l.employeeName, l.shape, l.qty, l.issueWeight, l.estimateWt,
      l.polishedWt ?? '', l.issueDate, l.receivedDate ?? '', l.daysConsumed ?? '',
      l.color ?? '', l.clarity ?? '', l.lab ?? '', l.labourHead, l.labourAmount ?? '',
      l.weightDiff ?? '', l.status,
    ].map(escape).join(',')),
  ];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mfg-dashboard-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface DashboardProps {
  onNavigate?: (page: string) => void;
}

export function Dashboard({ onNavigate = () => {} }: DashboardProps) {
  const { lots, refresh } = useApp();
  const [filters, setFilters] = useState<GlobalFilters>({
    plant: 'Harene · Hastack',
    department: 'ALL',
    shift: 'ALL' as ShiftKey | 'ALL',
    search: '',
    dateFrom: null,
    dateTo: null,
  });
  const [dark, setDark] = useState(loadTheme);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const { config, visibleWidgets, toggle, move, reset } = useWidgetConfig(WIDGET_DEFS);

  const data = useDashboardData(filters);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch { /* ignore */ }
  }, [dark]);

  const departments = useMemo(
    () => (data.departments?.length ? data.departments.map((d) => d.name) : []),
    [data.departments],
  );

  const handleRefresh = useCallback(() => { void refresh(); }, [refresh]);
  const handleExport = useCallback(() => exportLotsCsv(lots), [lots]);

  const renderWidget = (id: string) => {
    switch (id) {
      case 'kpis':
        return <KpiGrid kpis={data.kpis} onNavigate={onNavigate} />;
      case 'analytics':
        return (
          <ProductionAnalytics
            series={data.series}
            yieldTrend={data.yieldTrend}
            caratFlow={data.caratFlow}
            yieldPct={data.kpis.find((k) => k.id === 'efficiency')?.value ?? 0}
            ready={data.ready}
          />
        );
      case 'pipeline':
        return <ManufacturingPipeline stages={data.pipeline} totalLots={data.totals.totalLots} />;
      case 'departments':
        return <DepartmentPerformance departments={data.departments} />;
      case 'shifts':
        return <ShiftPerformance shifts={data.shifts} />;
      case 'machines':
        return <MachineMonitoring machines={data.machines} />;
      case 'workforce':
        return <WorkforcePerformance rows={data.workforce} />;
      case 'quality':
        return <QualityOverview q={data.quality} />;
      case 'inventory':
        return <InventoryOverview inv={data.inventory} />;
      case 'orders':
        return <OrderStatus orders={data.orders} totalLots={data.totals.totalLots} />;
      case 'alerts':
        return <AlertCenter alerts={data.alerts} />;
      case 'activity':
        return <RecentActivity activities={data.activities} />;
      case 'quick':
        return <QuickActions onNavigate={onNavigate} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <DashboardHeader
        filters={filters}
        setFilters={setFilters}
        onRefresh={handleRefresh}
        onNavigate={onNavigate}
        onExport={handleExport}
        alerts={data.alerts}
        searchResults={data.searchResults}
        departments={departments}
        dark={dark}
        onToggleDark={() => setDark((d) => !d)}
      />

      {/* Totals strip */}
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-text-muted">
        <span className="px-2.5 py-1 rounded-md bg-bg-card border border-border-default">
          <b className="text-text-primary tabular-nums">{data.totals.totalLots}</b> total lots
        </span>
        <span className="px-2.5 py-1 rounded-md bg-bg-card border border-border-default">
          <b className="text-warning tabular-nums">{data.totals.activeLots}</b> active
        </span>
        <span className="px-2.5 py-1 rounded-md bg-bg-card border border-border-default">
          <b className="text-success tabular-nums">{data.totals.todayProduction.toFixed(1)}</b> ct today
        </span>
        <span className="px-2.5 py-1 rounded-md bg-bg-card border border-border-default">
          <b className="text-primary tabular-nums">{data.totals.todayReceived}</b> received today
        </span>
        {filters.department !== 'ALL' && (
          <span className="px-2.5 py-1 rounded-md bg-primary-light text-primary border border-primary/25">
            Filtering: {filters.department}
          </span>
        )}
        {filters.dateFrom && (
          <button
            onClick={() => setFilters((f) => ({ ...f, dateFrom: null, dateTo: null }))}
            className="px-2.5 py-1 rounded-md bg-bg-card border border-border-default hover:bg-bg-hover transition-colors"
          >
            Since {filters.dateFrom} <span className="text-danger">✕</span>
          </button>
        )}
      </div>

      {/* Widgets */}
      <div className="space-y-6">
        {visibleWidgets.map((w) => (
          <div key={w.id} className="fade-in-up">
            {renderWidget(w.id)}
          </div>
        ))}
      </div>

      {/* Floating customize button */}
      <button
        onClick={() => setCustomizeOpen(true)}
        aria-label="Customize dashboard layout"
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-primary text-white text-xs font-semibold shadow-modal hover:bg-primary-hover transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <SlidersHorizontal size={15} /> Customize
      </button>

      <CustomizePanel
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        defs={WIDGET_DEFS}
        config={config}
        onToggle={toggle}
        onMove={move}
        onReset={reset}
      />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="flex items-center gap-2 text-text-muted text-sm">
        <Loader2 size={15} className="animate-spin" /> Loading production data…
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton h-44 w-full" />
        ))}
      </div>
      <div className="skeleton h-[280px] w-full" />
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-8 skeleton h-64 w-full" />
        <div className="col-span-4 skeleton h-64 w-full" />
      </div>
    </div>
  );
}
