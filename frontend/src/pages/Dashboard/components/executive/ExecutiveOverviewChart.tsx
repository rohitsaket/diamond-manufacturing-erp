import { memo, useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { Loader2, BarChart3, Download } from 'lucide-react';

interface ChartDataPoint {
  month: string;
  revenue: number;
  profit: number;
  target: number;
}

interface ExecutiveOverviewChartProps {
  series: ChartDataPoint[];
  ready: boolean;
}

function ExecutiveOverviewChartBase({ series, ready }: ExecutiveOverviewChartProps) {
  const [activeTab, setActiveTab] = useState<'revenue' | 'comparison'>('comparison');
  const [timeRange, setTimeRange] = useState<'6m' | '12m'>('12m');

  // Filter data based on selected time range
  const filteredData = useMemo(() => {
    if (timeRange === '6m' && series.length > 6) {
      return series.slice(-6);
    }
    return series;
  }, [series, timeRange]);

  // Generate mock data if API data is not yet available (will be replaced by real API data)
  const displayData = useMemo(() => {
    if (filteredData.length > 0) return filteredData;
    
    // Fallback mock data that matches the API structure
    return [
      { month: 'Jan', revenue: 85, profit: 16, target: 90 },
      { month: 'Feb', revenue: 92, profit: 18, target: 92 },
      { month: 'Mar', revenue: 88, profit: 17, target: 95 },
      { month: 'Apr', revenue: 105, profit: 21, target: 100 },
      { month: 'May', revenue: 112, profit: 22, target: 105 },
      { month: 'Jun', revenue: 108, profit: 20, target: 110 },
      { month: 'Jul', revenue: 118, profit: 23, target: 115 },
      { month: 'Aug', revenue: 124, profit: 25, target: 120 },
      { month: 'Sep', revenue: 115, profit: 22, target: 125 },
      { month: 'Oct', revenue: 128, profit: 26, target: 130 },
      { month: 'Nov', revenue: 132, profit: 27, target: 135 },
      { month: 'Dec', revenue: 145, profit: 30, target: 140 },
    ].slice(timeRange === '6m' ? -6 : 0);
  }, [filteredData, timeRange]);

  if (!ready) {
    return (
      <div className="bg-bg-card border border-border-default rounded-xl shadow-card p-6 flex items-center justify-center h-80">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin text-primary" />
          <span className="text-text-muted">Loading financial data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-card border border-border-default rounded-xl shadow-card p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <BarChart3 size={20} className="text-primary" />
            Revenue & Profit Trend
          </h3>
          <p className="text-text-muted text-sm mt-1">12-month financial performance across all divisions</p>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Time range selector */}
          <div className="flex items-center bg-bg-hover rounded-lg p-1">
            <button
              onClick={() => setTimeRange('6m')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${timeRange === '6m' ? 'bg-white dark:bg-gray-700 shadow-sm text-text-primary' : 'text-text-muted'}`}
            >
              6 Months
            </button>
            <button
              onClick={() => setTimeRange('12m')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${timeRange === '12m' ? 'bg-white dark:bg-gray-700 shadow-sm text-text-primary' : 'text-text-muted'}`}
            >
              12 Months
            </button>
          </div>
          
          {/* View toggle */}
          <div className="flex items-center bg-bg-hover rounded-lg p-1">
            <button
              onClick={() => setActiveTab('comparison')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'comparison' ? 'bg-white dark:bg-gray-700 shadow-sm text-text-primary' : 'text-text-muted'}`}
            >
              Comparison
            </button>
            <button
              onClick={() => setActiveTab('revenue')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'revenue' ? 'bg-white dark:bg-gray-700 shadow-sm text-text-primary' : 'text-text-muted'}`}
            >
              Area View
            </button>
          </div>
          
          {/* Export button */}
          <button className="p-2 text-text-muted hover:text-text-primary bg-bg-hover rounded-lg transition-colors" title="Export chart data">
            <Download size={18} />
          </button>
        </div>
      </div>

      {/* Chart container */}
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {activeTab === 'comparison' ? (
            <LineChart data={displayData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
              <XAxis 
                dataKey="month" 
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
                tickFormatter={(value) => `₹${value}Cr`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border-default)',
                  borderRadius: '8px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                }}
                labelStyle={{ color: 'var(--color-text-primary)', fontWeight: 600 }}
                formatter={(value: number) => [`₹${value}Cr`, '']}
              />
              <Legend 
                wrapperStyle={{ paddingTop: '20px' }}
                iconType="circle"
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#2563EB"
                strokeWidth={3}
                dot={{ fill: '#2563EB', r: 4 }}
                activeDot={{ r: 6, stroke: '#2563EB', strokeWidth: 2, fill: '#fff' }}
                name="Revenue"
              />
              <Line
                type="monotone"
                dataKey="profit"
                stroke="#16A34A"
                strokeWidth={3}
                dot={{ fill: '#16A34A', r: 4 }}
                activeDot={{ r: 6, stroke: '#16A34A', strokeWidth: 2, fill: '#fff' }}
                name="Net Profit"
              />
              <Line
                type="monotone"
                dataKey="target"
                stroke="#94A3B8"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                name="Target"
              />
            </LineChart>
          ) : (
            <AreaChart data={displayData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563EB" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#2563EB" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#16A34A" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#16A34A" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
              <XAxis 
                dataKey="month" 
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
                tickFormatter={(value) => `₹${value}Cr`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border-default)',
                  borderRadius: '8px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                }}
                labelStyle={{ color: 'var(--color-text-primary)', fontWeight: 600 }}
                formatter={(value: number) => [`₹${value}Cr`, '']}
              />
              <Legend 
                wrapperStyle={{ paddingTop: '20px' }}
                iconType="circle"
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#2563EB"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorRevenue)"
                name="Revenue"
              />
              <Area
                type="monotone"
                dataKey="profit"
                stroke="#16A34A"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorProfit)"
                name="Net Profit"
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Key metrics summary below chart */}
      <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-border-light">
        <div className="text-center">
          <p className="text-2xl font-bold text-text-primary">₹1,248Cr</p>
          <p className="text-xs text-text-muted mt-1">Total Revenue (YTD)</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-green-600">₹229Cr</p>
          <p className="text-xs text-text-muted mt-1">Total Profit (YTD)</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-blue-600">18.3%</p>
          <p className="text-xs text-text-muted mt-1">Average Margin</p>
        </div>
      </div>
    </div>
  );
}

export const ExecutiveOverviewChart = memo(ExecutiveOverviewChartBase);