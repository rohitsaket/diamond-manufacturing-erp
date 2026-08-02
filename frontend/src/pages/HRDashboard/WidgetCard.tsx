import { Info } from 'lucide-react';
import { EmptyBlock } from '../../components/common/HrmsUI';

/** Framed dashboard panel with a header row and a padded body. */
export function WidgetCard({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string | null;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-bg-card border border-border-default rounded-md ${className}`}>
      <div className="px-4 py-3 border-b border-border-default flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-text-primary text-sm font-semibold truncate">{title}</h3>
          {subtitle && <p className="text-text-muted text-[11px] mt-0.5 truncate">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/** Nothing to show for a widget whose data simply came back empty. */
export function WidgetEmpty({ message = 'No data yet' }: { message?: string }) {
  return <EmptyBlock message={message} />;
}

/** The backend explicitly reported this widget as unavailable. */
export function WidgetUnavailable({ reason }: { reason?: string | null }) {
  return (
    <div className="flex items-start gap-2 py-6 text-text-muted">
      <Info size={16} className="flex-shrink-0 mt-0.5" />
      <p className="text-xs italic">Not available — {reason || 'no data source for this metric'}</p>
    </div>
  );
}
