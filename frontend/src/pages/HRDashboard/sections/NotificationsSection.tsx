import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Check, CheckCheck, RefreshCw, Search, Sparkles } from 'lucide-react';
import { notificationApi } from '../../../api/hrms';
import type { AppNotification } from '../../../types/hrms';
import { WidgetCard } from '../WidgetCard';
import {
  BTN_SECONDARY,
  Chip,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  LoadingBlock,
  StatCard,
} from '../../../components/common/HrmsUI';

// ---------------------------------------------------------------------------
// Local helpers (date-fns is not a dependency)
// ---------------------------------------------------------------------------

/** Compact relative time, e.g. "3h ago". */
function timeAgo(iso: string | null | undefined): string {
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

type ChipTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

/** Backend category enum → friendly label. */
const CATEGORY_LABELS: Record<string, string> = {
  LEAVE: 'Leave',
  ATTENDANCE: 'Attendance',
  PAYROLL: 'Payroll',
  TRAINING: 'Training',
  POLICY: 'Policy',
  SECURITY: 'Security',
  SYSTEM: 'System',
  RECRUITMENT: 'Recruitment',
  EXPENSE: 'Expense',
  TASK: 'Tasks & reminders',
  HELPDESK: 'Helpdesk',
  ASSET: 'Asset',
};

const CATEGORY_TONES: Record<string, ChipTone> = {
  LEAVE: 'info',
  ATTENDANCE: 'primary',
  PAYROLL: 'success',
  TRAINING: 'primary',
  POLICY: 'default',
  SECURITY: 'danger',
  SYSTEM: 'default',
  RECRUITMENT: 'info',
  EXPENSE: 'warning',
  TASK: 'warning',
  HELPDESK: 'info',
  ASSET: 'default',
};

function categoryLabel(code: string): string {
  if (CATEGORY_LABELS[code]) return CATEGORY_LABELS[code];
  const cleaned = code.replace(/_/g, ' ').toLowerCase();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const PRIORITY_DOT: Record<string, string> = {
  URGENT: 'bg-danger',
  HIGH: 'bg-danger',
  NORMAL: 'bg-primary',
  LOW: 'bg-text-muted',
};

type ReadState = 'all' | 'unread' | 'archived';

interface RailItem {
  id: string;
  label: string;
  /** null = no category restriction (the "All" entry). */
  categories: string[] | null;
  disabled?: boolean;
  note?: string;
}

/** Static rails that map onto real categories rather than inventing endpoints. */
const STATIC_RAILS: RailItem[] = [
  { id: 'grp:approvals', label: 'Approval requests', categories: ['LEAVE', 'EXPENSE'] },
  { id: 'grp:announcements', label: 'Company announcements', categories: ['POLICY', 'SYSTEM'] },
];

// ---------------------------------------------------------------------------

export function NotificationsSection({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [active, setActive] = useState<AppNotification[]>([]);
  const [archived, setArchived] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [readState, setReadState] = useState<ReadState>('all');
  const [rail, setRail] = useState('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async (isFirst: boolean) => {
    if (isFirst) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [live, gone] = await Promise.all([
        notificationApi.list({ limit: 200 }),
        notificationApi.list({ archived: true, limit: 200 }).catch(() => [] as AppNotification[]),
      ]);
      setActive(Array.isArray(live) ? live : []);
      setArchived(Array.isArray(gone) ? gone : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notifications');
      setActive([]);
      setArchived([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  // Rows in scope for the current read-state filter.
  const scopeRows = useMemo<AppNotification[]>(() => {
    if (readState === 'archived') return archived ?? [];
    const rows = (active ?? []).filter((r) => !r.isArchived);
    return readState === 'unread' ? rows.filter((r) => !r.isRead) : rows;
  }, [active, archived, readState]);

  const railItems = useMemo<RailItem[]>(() => {
    const present = Array.from(new Set(scopeRows.map((r) => r?.category).filter(Boolean))).sort((a, b) =>
      categoryLabel(a).localeCompare(categoryLabel(b)),
    );
    return [
      { id: 'all', label: 'All', categories: null },
      ...present.map((c) => ({ id: `cat:${c}`, label: categoryLabel(c), categories: [c] })),
      ...STATIC_RAILS,
      { id: 'ai', label: 'AI', categories: [], disabled: true, note: 'Not enabled' },
    ];
  }, [scopeRows]);

  const railCount = useCallback(
    (item: RailItem) => {
      if (item.categories === null) return scopeRows.length;
      if (item.categories.length === 0) return 0;
      const set = new Set(item.categories);
      return scopeRows.filter((r) => set.has(r?.category)).length;
    },
    [scopeRows],
  );

  const visible = useMemo<AppNotification[]>(() => {
    const current = railItems.find((i) => i.id === rail) ?? railItems[0];
    let rows = scopeRows;
    if (current && current.categories !== null) {
      const set = new Set(current.categories);
      rows = rows.filter((r) => set.has(r?.category));
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          (r?.title ?? '').toLowerCase().includes(q) || (r?.body ?? '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [railItems, rail, scopeRows, query]);

  const liveRows = useMemo(() => (active ?? []).filter((r) => !r.isArchived), [active]);
  const unreadCount = liveRows.filter((r) => !r.isRead).length;
  const highCount = liveRows.filter((r) => r?.priority === 'HIGH' || r?.priority === 'URGENT').length;

  const handleMarkAll = async () => {
    setError(null);
    try {
      await notificationApi.markAllRead();
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark all read');
    }
  };

  const handleMarkRead = async (id: number) => {
    setBusyId(id);
    setError(null);
    try {
      await notificationApi.markRead(id);
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark as read');
    } finally {
      setBusyId(null);
    }
  };

  const handleArchive = async (id: number) => {
    setBusyId(id);
    setError(null);
    try {
      await notificationApi.archive(id);
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <WidgetCard title="Notifications" subtitle="Inbox">
        <LoadingBlock label="Loading notifications…" />
      </WidgetCard>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Unread" value={unreadCount} intent={unreadCount > 0 ? 'info' : 'default'} />
        <StatCard label="Total" value={liveRows.length} hint={`${(archived ?? []).length} archived`} />
        <StatCard
          label="High priority"
          value={highCount}
          intent={highCount > 0 ? 'danger' : 'default'}
          hint="Urgent + high"
        />
        <div className="bg-bg-card border border-border-default rounded-md p-4 flex flex-col justify-center gap-2">
          <button
            onClick={() => void handleMarkAll()}
            disabled={unreadCount === 0 || refreshing}
            className={`${BTN_SECONDARY} flex items-center justify-center gap-1.5`}
          >
            <CheckCheck size={16} /> Mark all read
          </button>
          <button
            onClick={() => void load(false)}
            disabled={refreshing}
            className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-text-muted hover:text-primary transition-colors disabled:opacity-40"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button onClick={() => void load(true)} className={BTN_SECONDARY}>
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left rail: categories */}
        <div className="lg:col-span-1">
          <WidgetCard title="Categories" subtitle="From live notifications">
            <div className="space-y-0.5">
              {railItems.map((item) => {
                const count = railCount(item);
                const isActive = item.id === rail && !item.disabled;
                if (item.disabled) {
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md opacity-60 cursor-not-allowed"
                    >
                      <span className="flex items-center gap-1.5 text-text-muted text-xs">
                        <Sparkles size={14} /> {item.label}
                      </span>
                      <span className="text-text-muted text-[10px] italic">{item.note}</span>
                    </div>
                  );
                }
                return (
                  <button
                    key={item.id}
                    onClick={() => setRail(item.id)}
                    className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                      isActive ? 'bg-bg-selected text-primary' : 'text-text-secondary hover:bg-bg-hover'
                    }`}
                  >
                    <span className="text-xs font-medium truncate">{item.label}</span>
                    <span
                      className={`text-[10px] tabular-nums flex-shrink-0 ${
                        isActive ? 'text-primary' : 'text-text-muted'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </WidgetCard>
        </div>

        {/* Main pane */}
        <div className="lg:col-span-3">
          <WidgetCard
            title="Inbox"
            subtitle={`${visible.length} shown`}
            actions={
              <div className="flex items-center gap-1.5">
                {(['all', 'unread', 'archived'] as ReadState[]).map((state) => (
                  <button
                    key={state}
                    onClick={() => setReadState(state)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium border capitalize transition-colors ${
                      readState === state
                        ? 'bg-primary-light border-primary/30 text-primary'
                        : 'border-border-default text-text-muted hover:bg-bg-hover'
                    }`}
                  >
                    {state}
                  </button>
                ))}
              </div>
            }
          >
            <div className="relative mb-3">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title or body…"
                className={`${INPUT_CLS} pl-8`}
              />
            </div>

            {visible.length === 0 ? (
              <EmptyBlock message="You're all caught up" />
            ) : (
              <div className="divide-y divide-border-light -mx-1 max-h-[560px] overflow-y-auto scrollbar-thin">
                {visible.map((n) => {
                  const clickable = !!n.linkPage;
                  return (
                    <div
                      key={n.id}
                      onClick={clickable ? () => onNavigate(n.linkPage as string) : undefined}
                      className={`group flex items-start gap-2.5 px-2 py-2.5 rounded-md transition-colors ${
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
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <Chip
                            label={categoryLabel(n.category)}
                            tone={CATEGORY_TONES[n.category] ?? 'default'}
                          />
                          <span className="text-text-muted text-[10px]">{timeAgo(n.createdAt)}</span>
                          {n.isArchived && <span className="text-text-muted text-[10px]">· archived</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
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
                        {!n.isArchived && (
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
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </WidgetCard>
        </div>
      </div>
    </div>
  );
}
