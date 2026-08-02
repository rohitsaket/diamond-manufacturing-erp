import { memo } from 'react';
import { Bell, AlertTriangle, CheckCircle, Info, ArrowRight, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Alert {
  id: string;
  type: 'critical' | 'warning' | 'success' | 'info';
  title: string;
  description: string;
  timestamp: Date;
  department: string;
  read: boolean;
}

interface ExecutiveRecentAlertsProps {
  alerts: Alert[];
  onViewAll: () => void;
  onAlertClick: (id: string) => void;
}

const ALERT_STYLES = {
  critical: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    icon: AlertTriangle,
    iconColor: 'text-red-600 dark:text-red-400',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800',
    icon: AlertTriangle,
    iconColor: 'text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  },
  success: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-200 dark:border-green-800',
    icon: CheckCircle,
    iconColor: 'text-green-600 dark:text-green-400',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    icon: Info,
    iconColor: 'text-blue-600 dark:text-blue-400',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  },
};

function ExecutiveRecentAlertsBase({ alerts, onViewAll, onAlertClick }: ExecutiveRecentAlertsProps) {
  const unreadCount = alerts.filter(a => !a.read).length;

  return (
    <div className="bg-bg-card border border-border-default rounded-xl shadow-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Bell size={20} className="text-primary" />
            Recent Alerts
            {unreadCount > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-primary text-white text-xs font-semibold rounded-full">
                {unreadCount} new
              </span>
            )}
          </h3>
          <p className="text-text-muted text-sm mt-1">Latest critical updates and notifications</p>
        </div>
        <button
          onClick={onViewAll}
          className="flex items-center gap-1 text-primary text-sm font-medium hover:underline"
        >
          View All <ArrowRight size={16} />
        </button>
      </div>

      {/* Alerts list */}
      <div className="space-y-3">
        {alerts.map((alert) => {
          const styles = ALERT_STYLES[alert.type];
          const Icon = styles.icon;
          return (
            <button
              key={alert.id}
              onClick={() => onAlertClick(alert.id)}
              className={`w-full text-left p-4 rounded-xl border transition-all hover:shadow-sm ${!alert.read ? styles.bg + ' ' + styles.border : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'}`}
            >
              <div className="flex items-start gap-3">
                <span className={styles.iconColor + ' flex-shrink-0 mt-0.5'}>
                  <Icon size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className={`font-medium text-text-primary text-sm ${!alert.read ? 'font-semibold' : ''}`}>
                      {alert.title}
                    </h4>
                    <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full whitespace-nowrap ${styles.badge}`}>
                      {alert.type}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-1 line-clamp-2">{alert.description}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[10px] text-text-muted flex items-center gap-1">
                      <Clock size={10} />
                      {formatDistanceToNow(alert.timestamp, { addSuffix: true })}
                    </span>
                    <span className="text-[10px] text-text-muted">{alert.department}</span>
                    {!alert.read && (
                      <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {alerts.length === 0 && (
        <div className="text-center py-8">
          <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-3">
            <CheckCircle size={24} className="text-green-600 dark:text-green-400" />
          </div>
          <p className="text-text-muted">All systems running smoothly. No new alerts.</p>
        </div>
      )}
    </div>
  );
}

export const ExecutiveRecentAlerts = memo(ExecutiveRecentAlertsBase);