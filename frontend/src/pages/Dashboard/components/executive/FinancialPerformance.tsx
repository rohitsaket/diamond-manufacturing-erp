import { memo } from 'react';
import { TrendingUp, TrendingDown, IndianRupee, BarChart3 } from 'lucide-react';

interface FinancialMetrics {
  mtdRevenue: number;
  mtdExpenses: number;
  mtdProfit: number;
  ytdRevenue: number;
  ytdExpenses: number;
  ytdProfit: number;
  revenueGrowth: number;
  profitGrowth: number;
}

interface FinancialPerformanceProps {
  data: FinancialMetrics;
}

function FinancialPerformanceBase({ data }: FinancialPerformanceProps) {
  const mtdMargin = ((data.mtdProfit / data.mtdRevenue) * 100).toFixed(1);
  const ytdMargin = ((data.ytdProfit / data.ytdRevenue) * 100).toFixed(1);

  return (
    <div className="bg-bg-card border border-border-default rounded-xl shadow-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <BarChart3 size={20} className="text-primary" />
            Financial Performance
          </h3>
          <p className="text-text-muted text-sm mt-1">Month-to-date and year-to-date financials</p>
        </div>
      </div>

      {/* Main financial cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {/* Revenue */}
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-100 dark:border-blue-800">
          <div className="flex items-center gap-2 mb-2">
            <IndianRupee size={16} className="text-blue-600 dark:text-blue-400" />
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide">Revenue</span>
          </div>
          <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">₹{data.mtdRevenue}Cr</p>
          <div className="flex items-center gap-1 mt-2">
            {data.revenueGrowth >= 0 ? (
              <TrendingUp size={14} className="text-green-600" />
            ) : (
              <TrendingDown size={14} className="text-red-600" />
            )}
            <span className={`text-xs font-medium ${data.revenueGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {data.revenueGrowth >= 0 ? '+' : ''}{data.revenueGrowth}%
            </span>
            <span className="text-xs text-blue-600/70 dark:text-blue-400/70 ml-1">vs last year</span>
          </div>
        </div>

        {/* Expenses */}
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-100 dark:border-amber-800">
          <div className="flex items-center gap-2 mb-2">
            <IndianRupee size={16} className="text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">Expenses</span>
          </div>
          <p className="text-2xl font-bold text-amber-900 dark:text-amber-100">₹{data.mtdExpenses}Cr</p>
          <div className="flex items-center gap-1 mt-2">
            <span className="text-xs text-amber-600/70 dark:text-amber-400/70">Under budget by 3.2%</span>
          </div>
        </div>

        {/* Profit */}
        <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 border border-green-100 dark:border-green-800">
          <div className="flex items-center gap-2 mb-2">
            <IndianRupee size={16} className="text-green-600 dark:text-green-400" />
            <span className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wide">Net Profit</span>
          </div>
          <p className="text-2xl font-bold text-green-900 dark:text-green-100">₹{data.mtdProfit}Cr</p>
          <div className="flex items-center gap-1 mt-2">
            {data.profitGrowth >= 0 ? (
              <TrendingUp size={14} className="text-green-600" />
            ) : (
              <TrendingDown size={14} className="text-red-600" />
            )}
            <span className={`text-xs font-medium ${data.profitGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {data.profitGrowth >= 0 ? '+' : ''}{data.profitGrowth}%
            </span>
            <span className="text-xs text-green-600/70 dark:text-green-400/70 ml-1">vs last year</span>
          </div>
        </div>
      </div>

      {/* YTD comparison */}
      <div className="pt-6 border-t border-border-light">
        <h4 className="text-sm font-semibold text-text-primary mb-4">Year-to-Date Summary</h4>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-muted">Total Revenue</span>
              <span className="text-sm font-semibold text-text-primary">₹{data.ytdRevenue}Cr</span>
            </div>
            <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: '90%' }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-muted">Total Expenses</span>
              <span className="text-sm font-semibold text-text-primary">₹{data.ytdExpenses}Cr</span>
            </div>
            <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full" style={{ width: '75%' }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-muted">Net Profit Margin</span>
              <span className="text-sm font-semibold text-text-primary">{ytdMargin}%</span>
            </div>
            <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
              <div className="h-full bg-green-500 rounded-full" style={{ width: `${parseFloat(ytdMargin)}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const FinancialPerformance = memo(FinancialPerformanceBase);