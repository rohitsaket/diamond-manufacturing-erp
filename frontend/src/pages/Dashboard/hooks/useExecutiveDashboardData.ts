import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../../../api/client';
import { useApp } from '../../../contexts/AppContext';
import { GlobalFilters, KpiCardData } from '../dashboard.types';

export interface ExecutiveDepartmentHealth {
  id: string;
  name: string;
  healthScore: number;
  status: 'healthy' | 'at-risk' | 'critical';
  revenue: number;
  expenses: number;
  profit: number;
  activeOrders: number;
  completedOrders: number;
}

export interface ExecutiveTeam {
  id: string;
  name: string;
  manager: string;
  members: number;
  department: string;
  productivityScore: number;
  trend: number;
  qualityRate: number;
  teamLeaders: Array<{ id: string; name: string }>;
  revenue: number;
}

export interface ExecutiveAlert {
  id: string;
  type: 'critical' | 'warning' | 'success' | 'info';
  title: string;
  description: string;
  timestamp: Date;
  department: string;
  read: boolean;
}

export interface ExecutiveDashboardData {
  financialKpis: KpiCardData[];
  productionKpis: KpiCardData[];
  revenueTrend: { month: string; revenue: number; profit: number; target: number }[];
  departments: ExecutiveDepartmentHealth[];
  financialMetrics: {
    mtdRevenue: number;
    mtdExpenses: number;
    mtdProfit: number;
    ytdRevenue: number;
    ytdExpenses: number;
    ytdProfit: number;
    revenueGrowth: number;
    profitGrowth: number;
  };
  overallMetrics: {
    overallEfficiency: number;
    targetEfficiency: number;
    oee: number;
    yieldRate: number;
    firstPassYield: number;
  };
  topTeams: ExecutiveTeam[];
  criticalAlerts: ExecutiveAlert[];
  totals: {
    mtdRevenue: number;
    profitMargin: number;
    fulfillmentRate: number;
    inventoryTurnover: number;
  };
  ready: boolean;
  exportExecutiveReport: () => void;
}

export function useExecutiveDashboardData(filters: GlobalFilters): ExecutiveDashboardData {
  const { lots } = useApp();
  const [revenueTrend, setRevenueTrend] = useState<{ month: string; revenue: number; profit: number; target: number }[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get<{ month: string; revenue: number; profit: number; target: number }[]>('/executive-dashboard/revenue-trend'),
    ])
      .then(([rt]) => {
        if (active) { setRevenueTrend(rt); }
      })
      .catch(() => { /* gracefully handle API failure */ })
      .finally(() => { if (active) setReady(true); });

    return () => { active = false; };
  }, []);

  // Calculate totals for the summary strip
  const totals = useMemo(() => ({
    mtdRevenue: 124.8,
    profitMargin: 18.4,
    fulfillmentRate: 94.2,
    inventoryTurnover: 5.8,
  }), []);

  // Financial KPIs - unique to executive dashboard
  const financialKpis = useMemo<KpiCardData[]>(() => [
    {
      id: 'mtd-revenue',
      title: 'MTD Revenue',
      value: 124.8,
      prefix: '₹',
      suffix: 'Cr',
      decimals: 1,
      target: 140,
      iconColor: 'text-primary',
      iconTint: 'bg-primary-light',
      badge: 'good',
      statusLabel: 'On Track',
      trend: 12.5,
      spark: Array.from({ length: 8 }, () => Math.random() * 30 + 100),
      sub: 'vs last month ₹111Cr',
      navigate: '/finance',
      tooltip: 'Month-to-date revenue across all plants',
    },
    {
      id: 'mtd-profit',
      title: 'MTD Net Profit',
      value: 22.9,
      prefix: '₹',
      suffix: 'Cr',
      decimals: 1,
      target: 25,
      iconColor: 'text-success',
      iconTint: 'bg-success-light',
      badge: 'good',
      statusLabel: 'Near Target',
      trend: 8.3,
      spark: Array.from({ length: 8 }, () => Math.random() * 5 + 20),
      sub: 'Margin: 18.4%',
      navigate: '/finance',
      tooltip: 'Month-to-date net profit',
    },
    {
      id: 'outstanding-payments',
      title: 'Outstanding',
      value: 18.7,
      prefix: '₹',
      suffix: 'Cr',
      decimals: 1,
      target: 15,
      iconColor: 'text-warning',
      iconTint: 'bg-warning-light',
      badge: 'warn',
      statusLabel: 'Attention',
      trend: -5.2,
      spark: Array.from({ length: 8 }, () => Math.random() * 10 + 15),
      sub: '32 pending invoices',
      navigate: '/accounts/receivables',
      tooltip: 'Total outstanding receivables',
    },
    {
      id: 'cash-flow',
      title: 'Net Cash Flow',
      value: 8.9,
      prefix: '₹',
      suffix: 'Cr',
      decimals: 1,
      target: 10,
      iconColor: 'text-purple-600',
      iconTint: 'bg-purple-100 dark:bg-purple-900/30',
      badge: 'neutral',
      statusLabel: 'Stable',
      trend: 2.1,
      spark: Array.from({ length: 8 }, () => Math.random() * 5 + 7),
      sub: 'Positive for 6 months',
      navigate: '/finance/cashflow',
      tooltip: 'Monthly net cash flow',
    },
  ], []);

  // Production KPIs - executive summary
  const productionKpis = useMemo<KpiCardData[]>(() => [
    {
      id: 'total-production',
      title: 'MTD Production',
      value: 12458,
      suffix: ' ct',
      decimals: 0,
      target: 14000,
      iconColor: 'text-info',
      iconTint: 'bg-info-light',
      badge: 'good',
      statusLabel: 'On Track',
      trend: 7.8,
      spark: Array.from({ length: 8 }, () => Math.random() * 2000 + 10000),
      sub: '1,245 carats this week',
      navigate: '/production',
      tooltip: 'Total carats produced month-to-date',
    },
    {
      id: 'order-fulfillment',
      title: 'Order Fulfillment',
      value: 94.2,
      suffix: '%',
      decimals: 1,
      target: 95,
      iconColor: 'text-success',
      iconTint: 'bg-success-light',
      badge: 'good',
      statusLabel: 'Excellent',
      trend: 1.5,
      spark: Array.from({ length: 8 }, () => Math.random() * 5 + 90),
      sub: '156 orders delivered',
      navigate: '/orders',
      tooltip: 'On-time order fulfillment rate',
    },
    {
      id: 'inventory-value',
      title: 'Inventory Value',
      value: 287.5,
      prefix: '₹',
      suffix: 'Cr',
      decimals: 1,
      target: 300,
      iconColor: 'text-blue-600',
      iconTint: 'bg-blue-100 dark:bg-blue-900/30',
      badge: 'neutral',
      statusLabel: 'Optimal',
      trend: -2.3,
      spark: Array.from({ length: 8 }, () => Math.random() * 50 + 250),
      sub: 'Turnover: 5.8x',
      navigate: '/inventory',
      tooltip: 'Total inventory valuation',
    },
    {
      id: 'capacity-utilization',
      title: 'Capacity Usage',
      value: 82.7,
      suffix: '%',
      decimals: 1,
      target: 85,
      iconColor: 'text-orange-600',
      iconTint: 'bg-orange-100 dark:bg-orange-900/30',
      badge: 'good',
      statusLabel: 'High',
      trend: 3.2,
      spark: Array.from({ length: 8 }, () => Math.random() * 10 + 75),
      sub: 'All plants operational',
      navigate: '/capacity',
      tooltip: 'Overall factory capacity utilization',
    },
  ], []);

  // Department health data
  const departments = useMemo<ExecutiveDepartmentHealth[]>(() => [
    {
      id: 'cutting',
      name: 'Cutting Division',
      healthScore: 94,
      status: 'healthy',
      revenue: 32.5,
      expenses: 24.2,
      profit: 8.3,
      activeOrders: 45,
      completedOrders: 128,
    },
    {
      id: 'polishing',
      name: 'Polishing Division',
      healthScore: 88,
      status: 'healthy',
      revenue: 41.2,
      expenses: 31.8,
      profit: 9.4,
      activeOrders: 52,
      completedOrders: 156,
    },
    {
      id: 'qc',
      name: 'Quality Control',
      healthScore: 96,
      status: 'healthy',
      revenue: 0,
      expenses: 8.5,
      profit: -8.5,
      activeOrders: 38,
      completedOrders: 284,
    },
    {
      id: 'logistics',
      name: 'Logistics',
      healthScore: 72,
      status: 'at-risk',
      revenue: 12.8,
      expenses: 14.2,
      profit: -1.4,
      activeOrders: 28,
      completedOrders: 87,
    },
  ], []);

  // Financial metrics for detailed chart
  const financialMetrics = useMemo(() => ({
    mtdRevenue: 124.8,
    mtdExpenses: 101.9,
    mtdProfit: 22.9,
    ytdRevenue: 987.5,
    ytdExpenses: 812.3,
    ytdProfit: 175.2,
    revenueGrowth: 15.8,
    profitGrowth: 12.4,
  }), []);

  // Overall efficiency metrics for gauge
  const overallMetrics = useMemo(() => ({
    capacityUtilization: 82.7,
    oee: 82.1,
    onTimeDelivery: 94.2,
    qualityRate: 88.7,
    productionToday: 412,
    targetToday: 450,
  }), []);

  // Top performing teams
  const topTeams = useMemo<ExecutiveTeam[]>(() => [
    {
      id: 'team-qc-1',
      name: 'QC Team Excellence',
      manager: 'Amit Patel',
      members: 12,
      department: 'Quality Control',
      productivityScore: 99,
      trend: 2.3,
      qualityRate: 99,
      teamLeaders: [
        { id: 'l1', name: 'Amit Patel' },
        { id: 'l2', name: 'Sneha Gupta' },
        { id: 'l3', name: 'Rahul Singh' },
      ],
      revenue: 0,
    },
    {
      id: 'team-cutting-1',
      name: 'Cutting Team Alpha',
      manager: 'Rajesh Kumar',
      members: 15,
      department: 'Cutting Division',
      productivityScore: 96.2,
      trend: 3.1,
      qualityRate: 97,
      teamLeaders: [
        { id: 'l4', name: 'Rajesh Kumar' },
        { id: 'l5', name: 'Vikram Mehta' },
      ],
      revenue: 12.4,
    },
    {
      id: 'team-polish-2',
      name: 'Polishing Team Beta',
      manager: 'Priya Sharma',
      members: 14,
      department: 'Polishing Division',
      productivityScore: 94.8,
      trend: 1.8,
      qualityRate: 98,
      teamLeaders: [
        { id: 'l6', name: 'Priya Sharma' },
        { id: 'l7', name: 'Anjali Desai' },
        { id: 'l8', name: 'Suresh Nair' },
        { id: 'l9', name: 'Pooja Iyer' },
      ],
      revenue: 15.8,
    },
    {
      id: 'team-logistics-1',
      name: 'Logistics Team West',
      manager: 'Mohan Reddy',
      members: 10,
      department: 'Logistics',
      productivityScore: 78.5,
      trend: -4.2,
      qualityRate: 85,
      teamLeaders: [
        { id: 'l10', name: 'Mohan Reddy' },
      ],
      revenue: 6.2,
    },
  ], []);

  // Critical alerts for executives
  const criticalAlerts = useMemo<ExecutiveAlert[]>(() => [
    {
      id: 'alert-1',
      type: 'critical',
      title: 'Raw material shipment delayed',
      description: 'Rough diamond shipment from South Africa delayed by 7 days. Expected arrival now 15th October.',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      department: 'Supply Chain',
      read: false,
    },
    {
      id: 'alert-2',
      type: 'warning',
      title: 'Machine #12 maintenance due',
      description: 'Polishing machine #12 scheduled for preventive maintenance in 3 days to avoid downtime.',
      timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
      department: 'Maintenance',
      read: false,
    },
    {
      id: 'alert-3',
      type: 'warning',
      title: 'Elevated defect rate in cutting',
      description: '3% defect rate detected in Cutting Division - investigate potential tool wear.',
      timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000), // 8 hours ago
      department: 'Cutting',
      read: true,
    },
    {
      id: 'alert-4',
      type: 'success',
      title: 'Q3 targets achieved ahead of schedule',
      description: 'All divisions exceeded Q3 production and revenue targets - 12% above forecast.',
      timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      department: 'Executive',
      read: true,
    },
  ], []);

  // Export function for executive reports
  const exportExecutiveReport = useCallback(() => {
    // Generate comprehensive CSV for C-suite reporting
    const headers = [
      'Metric', 'Value', 'Target', 'Status', 'Trend'
    ];
    const allKpis = [...financialKpis, ...productionKpis];
    const rows = [
      headers.join(','),
      ...allKpis.map(k => [
        k.title,
        `${k.prefix || ''}${k.value}${k.suffix || ''}`,
        k.target,
        k.statusLabel,
        `${k.trend >= 0 ? '+' : ''}${k.trend}%`
      ].join(','))
    ];
    
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `executive-dashboard-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [financialKpis, productionKpis]);

  return {
    financialKpis,
    productionKpis,
    revenueTrend,
    departments,
    financialMetrics,
    overallMetrics,
    topTeams,
    criticalAlerts,
    totals,
    ready,
    exportExecutiveReport,
  };
}