import { useCallback, useEffect, useState } from 'react';
import { Check, Archive, CheckCheck } from 'lucide-react';
import { notificationApi } from '../../api/hrms';
import type { AppNotification } from '../../types/hrms';
import { Chip, EmptyBlock, ErrorBlock, LoadingBlock } from '../../components/common/HrmsUI';
import { WidgetCard } from './WidgetCard';

/** Compact relative time ("3h ago"). date-fns is not a dependency here. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 0) {
    const ahead = Math.abs(seconds);
    if (ahead < 3600) return `in ${Math.max(1, Math.floor(ahead / 60))}m`;
    if (ahead < 86400) return `in ${Math.floor(ahead / 3600)}h`;
    return `in ${Math.floor(ahead / 86400)}d`;
  }
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`;
  if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}mo ago`;
  return `${Math.floor(seconds / 31536000)}y ago`;
}

const PRIORITY_DOT: Record<string, string> = {
  URGENT: 'bg-danger',
  HIGH: 'bg-danger',
  NORMAL: 'bg-primary',
  LOW: 'bg-text-muted',
};

/** Self-contained notification inbox with category filters and row actions. */
export function NotificationPanel({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('ALL');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await notificationApi.list({ limit: 20 });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notifications');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unread = rows.filter((r) => !r.isRead).length;
  const categories = Array.from(new Set(rows.map((r) => r.category).filter(Boolean)));
  const visible = category === 'ALL' ? rows : rows.filter((r) => r.category === category);

  const handleMarkAll = async () => {
    try {
      await notificationApi.markAllRead();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark all read');
    }
  };

  const handleMarkRead = async (id: number) => {
    setBusyId(id);
    try {
      await notificationApi.markRead(id);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, isRead: true } : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark as read');
    } finally {
      setBusyId(null);
    }
  };

  const handleArchive = async (id: number) => {
    setBusyId(id);
    try {
      await notificationApi.archive(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <WidgetCard
      title="Notifications"
      subtitle="Latest 20"
      actions={
        <>
          <Chip label={`${unread} unread`} tone={unread > 0 ? 'primary' : 'default'} dot />
          <button
            onClick={() => void handleMarkAll()}
            disabled={unread === 0}
            className="flex items-center gap-1 text-[11px] font-medium text-text-secondary hover:text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCheck size={14} /> Mark all read
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <ErrorBlock message={error} />
        </div>
      )}

      {loading ? (
        <LoadingBlock label="Loading notifications…" />
      ) : rows.length === 0 ? (
        <EmptyBlock message="You're all caught up" />
      ) : (
        <>
          {categories.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              {['ALL', ...categories].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors ${
                    cat === category
                      ? 'bg-primary-light border-primary/30 text-primary'
                      : 'border-border-default text-text-muted hover:bg-bg-hover'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {visible.length === 0 ? (
            <EmptyBlock message="Nothing in this category" />
          ) : (
            <div className="divide-y divide-border-light -mx-1 max-h-[380px] overflow-y-auto scrollbar-thin">
              {visible.map((n) => {
                const clickable = !!n.linkPage && !!onNavigate;
                return (
                  <div
                    key={n.id}
                    onClick={clickable ? () => onNavigate?.(n.linkPage as string) : undefined}
                    className={`group flex items-start gap-2.5 px-1 py-2.5 transition-colors ${
                      n.isRead ? '' : 'bg-bg-selected'
                    } ${clickable ? 'cursor-pointer hover:bg-bg-hover' : ''}`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                        PRIORITY_DOT[n.priority] ?? 'bg-text-muted'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-text-primary text-xs ${
                          n.isRead ? 'font-medium' : 'font-semibold'
                        }`}
                      >
                        {n.title}
                      </p>
                      {n.body && <p className="text-text-secondary text-xs mt-0.5">{n.body}</p>}
                      <p className="text-text-muted text-[10px] mt-1">
                        {n.category} · {timeAgo(n.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!n.isRead && (
                        <button
                          title="Mark as read"
                          disabled={busyId === n.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleMarkRead(n.id);
                          }}
                          className="p-1 rounded text-text-muted hover:text-success hover:bg-bg-hover transition-colors disabled:opacity-40"
                        >
                          <Check size={14} />
                        </button>
                      )}
                      <button
                        title="Archive"
                        disabled={busyId === n.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleArchive(n.id);
                        }}
                        className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-40"
                      >
                        <Archive size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </WidgetCard>
  );
}
