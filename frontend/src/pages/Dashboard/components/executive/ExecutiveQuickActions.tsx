import { memo } from 'react';
import { FileText, BarChart3, Users, Settings, Calendar, MessageSquare, DollarSign, Package, ArrowRight } from 'lucide-react';

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  onClick: () => void;
}

function ExecutiveQuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="bg-bg-card border border-border-default rounded-xl shadow-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Settings size={20} className="text-primary" />
            Quick Actions
          </h3>
          <p className="text-text-muted text-sm mt-1">C-suite tools and shortcuts</p>
        </div>
      </div>

      {/* Action grid - 2 column layout for sidebar widget */}
      <div className="grid grid-cols-2 gap-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              onClick={action.onClick}
              className="flex flex-col items-start p-4 rounded-xl bg-bg-hover hover:bg-gray-100 dark:hover:bg-gray-700/50 border border-border-default transition-all hover:-translate-y-0.5 hover:shadow-md group text-left"
            >
              <span 
                className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-200"
                style={{ backgroundColor: `${action.color}15`, color: action.color }}
              >
                <Icon size={20} />
              </span>
              <h4 className="font-medium text-text-primary text-sm">{action.label}</h4>
              <p className="text-xs text-text-muted mt-1 line-clamp-2">{action.description}</p>
              <span className="mt-3 flex items-center gap-1 text-primary text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                Get started <ArrowRight size={12} />
              </span>
            </button>
          );
        })}
      </div>

      {/* Upcoming section */}
      <div className="mt-6 pt-6 border-t border-border-light">
        <h4 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Calendar size={14} className="text-primary" />
          Upcoming This Week
        </h4>
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-800 flex items-center justify-center flex-shrink-0">
              <MessageSquare size={14} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">Board Meeting</p>
              <p className="text-xs text-text-muted">Tomorrow, 10:00 AM</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-100 dark:border-green-800">
            <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-800 flex items-center justify-center flex-shrink-0">
              <DollarSign size={14} className="text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">Q4 Financial Review</p>
              <p className="text-xs text-text-muted">Friday, 2:00 PM</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-100 dark:border-purple-800">
            <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-800 flex items-center justify-center flex-shrink-0">
              <Package size={14} className="text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">New Plant Tour</p>
              <p className="text-xs text-text-muted">Saturday, 9:00 AM</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Create a pre-configured component with default executive actions
function DefaultExecutiveQuickActions({ onNavigate }: { onNavigate: (page: string) => void }) {
  const defaultActions: QuickAction[] = [
    {
      id: 'generate-report',
      label: 'Generate Report',
      description: 'Create comprehensive executive summary',
      icon: FileText,
      color: '#2563EB',
      onClick: () => onNavigate('/reports/executive'),
    },
    {
      id: 'view-analytics',
      label: 'Deep Analytics',
      description: 'Explore advanced BI dashboards',
      icon: BarChart3,
      color: '#16A34A',
      onClick: () => onNavigate('/analytics'),
    },
    {
      id: 'team-management',
      label: 'Team Hub',
      description: 'Manage organization structure',
      icon: Users,
      color: '#7C3AED',
      onClick: () => onNavigate('/organization'),
    },
    {
      id: 'system-settings',
      label: 'Settings',
      description: 'Configure enterprise settings',
      icon: Settings,
      color: '#CA8A04',
      onClick: () => onNavigate('/settings'),
    },
  ];

  return <ExecutiveQuickActions actions={defaultActions} />;
}

export const ExecutiveQuickActions = memo(DefaultExecutiveQuickActions);