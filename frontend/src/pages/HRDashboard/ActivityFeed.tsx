import { useCallback, useEffect, useState } from 'react';
import { hrDashboardApi } from '../../api/hrms';
import type { ActivityEntry } from '../../types/hrms';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../components/common/HrmsUI';
import { WidgetCard } from './WidgetCard';
import { timeAgo } from './NotificationPanel';

/** Vertical audit-trail timeline of the most recent HR actions. */
export function ActivityFeed({ limit = 15 }: { limit?: number }) {
  const [rows, setRows] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await hrDashboardApi.activity({ limit });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <WidgetCard title="Recent activity" subtitle="Audit trail across HR, payroll and recruitment">
      {error && (
        <div className="mb-3">
          <ErrorBlock message={error} />
        </div>
      )}

      {loading ? (
        <LoadingBlock label="Loading activity…" />
      ) : rows.length === 0 ? (
        <EmptyBlock message="No activity recorded yet" />
      ) : (
        <div className="border-l border-border-default pl-4 space-y-4 max-h-[380px] overflow-y-auto scrollbar-thin">
          {rows.map((entry) => (
            <div key={entry.id} className="relative">
              <span className="absolute -left-4 top-1.5 w-2 h-2 rounded-full bg-primary -ml-[4.5px]" />
              <p className="text-text-primary text-xs">{entry.summary}</p>
              <p className="text-text-muted text-[10px] mt-0.5">
                {entry.entityType} · {entry.action} · {timeAgo(entry.createdAt)}
                {entry.actorName ? ` · ${entry.actorName}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
