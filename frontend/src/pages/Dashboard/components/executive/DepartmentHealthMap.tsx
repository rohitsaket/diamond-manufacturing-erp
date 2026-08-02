import { memo } from 'react';
import { Building2, ArrowRight } from 'lucide-react';
import { ExecutiveDepartmentHealth } from '../../hooks/useExecutiveDashboardData';

interface DepartmentHealthMapProps {
  departments: ExecutiveDepartmentHealth[];
  onNavigate: (page: string) => void;
}

const STATUS_COLORS = {
  healthy: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-400',
    border: 'border-green-200 dark:border-green-800',
    bar: 'bg-green-500',
    label: 'Healthy',
  },
  'at-risk': {
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800',
    bar: 'bg-amber-500',
    label: 'At Risk',
  },
  critical: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-400',
    border: 'border-red-200 dark:border-red-800',
    bar: 'bg-red-500',
    label: 'Critical',
  },
};

function DepartmentHealthMapBase({ departments, onNavigate }: DepartmentHealthMapProps) {
  return (
    <div className="bg-bg-card border border-border-default rounded-xl shadow-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Building2 size={20} className="text-primary" />
            Department Health Map
          </h3>
          <p className="text-text-muted text-sm mt-1">Performance health across all manufacturing divisions</p>
        </div>
        <button 
          onClick={() => onNavigate('/departments')}
          className="flex items-center gap-1 text-primary text-sm font-medium hover:underline"
        >
          View All <ArrowRight size={16} />
        </button>
      </div>

      {/* Department cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {departments.map((dept) => {
          const styles = STATUS_COLORS[dept.status];
          return (
            <button
              key={dept.id}
              onClick={() => onNavigate(`/departments/${dept.id}`)}
              className={`text-left p-4 rounded-xl border transition-all hover:shadow-md hover:-translate-y-0.5 ${styles.bg} ${styles.border}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h4 className="font-semibold text-text-primary">{dept.name}</h4>
                  <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${styles.bg} ${styles.text}`}>
                    {styles.label}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-text-primary">{dept.healthScore}%</p>
                  <p className="text-xs text-text-muted">Health Score</p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mb-4">
                <div className="h-2 rounded-full bg-white/50 dark:bg-black/20 overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-1000 ${styles.bar}`}
                    style={{ width: `${dept.healthScore}%` }}
                  />
                </div>
              </div>

              {/* Key metrics */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-white/40 dark:bg-black/20 rounded-lg p-2">
                  <p className="text-sm font-semibold text-text-primary">₹{dept.revenue}Cr</p>
                  <p className="text-[10px] text-text-muted">Revenue</p>
                </div>
                <div className="bg-white/40 dark:bg-black/20 rounded-lg p-2">
                  <p className="text-sm font-semibold text-text-primary">{dept.activeOrders}</p>
                  <p className="text-[10px] text-text-muted">Active</p>
                </div>
                <div className="bg-white/40 dark:bg-black/20 rounded-lg p-2">
                  <p className="text-sm font-semibold text-text-primary">{dept.completedOrders}</p>
                  <p className="text-[10px] text-text-muted">Completed</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Summary statistics */}
      <div className="mt-6 grid grid-cols-3 gap-4 pt-6 border-t border-border-light">
        <div className="text-center">
          <p className="text-2xl font-bold text-green-600">
            {departments.filter(d => d.status === 'healthy').length}
          </p>
          <p className="text-xs text-text-muted mt-1">Healthy</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-amber-600">
            {departments.filter(d => d.status === 'at-risk').length}
          </p>
          <p className="text-xs text-text-muted mt-1">At Risk</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-red-600">
            {departments.filter(d => d.status === 'critical').length}
          </p>
          <p className="text-xs text-text-muted mt-1">Critical</p>
        </div>
      </div>
    </div>
  );
}

export const DepartmentHealthMap = memo(DepartmentHealthMapBase);