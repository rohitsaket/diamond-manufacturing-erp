import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, RefreshCw, Search, Sparkles } from 'lucide-react';
import { hrDashboardApi } from '../../../api/hrms';
import type { ActivityEntry } from '../../../types/hrms';
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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Local-time YYYY-MM-DD bucket key for an ISO timestamp. */
function dayKey(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

function dayHeading(key: string): string {
  if (key === 'unknown') return 'Undated';
  const parts = key.split('-');
  if (parts.length !== 3) return key;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (Number.isNaN(d.getTime())) return key;
  const now = new Date();
  const todayKey = dayKey(now.toISOString());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === todayKey) return 'Today';
  if (key === dayKey(yesterday.toISOString())) return 'Yesterday';
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Streams — several live entityType values map onto each requested stream.
// ---------------------------------------------------------------------------

type ChipTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const STREAM_ENTITIES: Record<string, string[]> = {
  attendance: ['ATTENDANCE', 'PUNCH', 'SHIFT'],
  leave: ['LEAVE_REQUEST', 'LEAVE', 'LEAVE_BALANCE'],
  payroll: ['SALARY_PERIOD', 'ADVANCE', 'PAYROLL', 'PAYSLIP', 'SALARY_STRUCTURE'],
  recruitment: ['CANDIDATE', 'RECRUITMENT', 'INTERVIEW', 'JOB_OPENING'],
  employee: ['EMPLOYEE'],
  asset: ['ASSET'],
  ticket: ['TICKET', 'HELPDESK'],
};

/** Every entity type explicitly claimed by a stream above. */
const CLAIMED = new Set<string>(Object.values(STREAM_ENTITIES).flat());

/** Actions that represent an approval decision, whatever the entity. */
const APPROVAL_ACTIONS = new Set([
  'APPROVED',
  'REJECTED',
  'SUBMITTED',
  'CANCELLED',
  'STATUS_CHANGED',
  'DECIDED',
]);

const ACTION_TONE = (action: string): ChipTone => {
  const a = (action ?? '').toUpperCase();
  if (a === 'CREATED' || a === 'APPROVED' || a === 'COMPLETED' || a === 'PAID') return 'success';
  if (a === 'REJECTED' || a === 'RESIGNED' || a === 'DELETED' || a === 'CANCELLED') return 'danger';
  if (a === 'UPDATED' || a === 'STATUS_CHANGED' || a === 'SUBMITTED') return 'info';
  return 'default';
};

function entityOf(entry: ActivityEntry): string {
  return (entry?.entityType ?? '').toUpperCase();
}

interface Stream {
  id: string;
  label: string;
  match: ((entry: ActivityEntry) => boolean) | null;
  disabled?: boolean;
  note?: string;
}

const STREAMS: Stream[] = [
  { id: 'all', label: 'All activity', match: null },
  { id: 'attendance', label: 'Attendance', match: (e) => STREAM_ENTITIES.attendance.includes(entityOf(e)) },
  { id: 'leave', label: 'Leave', match: (e) => STREAM_ENTITIES.leave.includes(entityOf(e)) },
  { id: 'payroll', label: 'Payroll', match: (e) => STREAM_ENTITIES.payroll.includes(entityOf(e)) },
  {
    id: 'approval',
    label: 'Approvals',
    match: (e) => APPROVAL_ACTIONS.has((e?.action ?? '').toUpperCase()),
  },
  {
    id: 'recruitment',
    label: 'Recruitment',
    match: (e) => STREAM_ENTITIES.recruitment.includes(entityOf(e)),
  },
  { id: 'employee', label: 'Employee', match: (e) => STREAM_ENTITIES.employee.includes(entityOf(e)) },
  { id: 'asset', label: 'Assets', match: (e) => STREAM_ENTITIES.asset.includes(entityOf(e)) },
  { id: 'ticket', label: 'Tickets', match: (e) => STREAM_ENTITIES.ticket.includes(entityOf(e)) },
  {
    id: 'system',
    label: 'System',
    match: (e) => {
      const t = entityOf(e);
      return t === 'RATE_CARD' || !CLAIMED.has(t);
    },
  },
  { id: 'ai', label: 'AI recommendations', match: null, disabled: true, note: 'Not enabled' },
];

const LIMIT_STEPS = [100, 200, 400];

/** Human label for a raw entityType, e.g. "salary_period" → "Salary period". */
function entityLabel(entityType: string): string {
  const cleaned = (entityType ?? '').replace(/_/g, ' ').toLowerCase();
  if (!cleaned) return 'unknown';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// ---------------------------------------------------------------------------

export function ActivitySection({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [rows, setRows] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(LIMIT_STEPS[0]);
  const [stream, setStream] = useState('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async (nextLimit: number, isFirst: boolean) => {
    if (isFirst) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const data = await hrDashboardApi.activity({ limit: nextLimit });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(LIMIT_STEPS[0], true);
  }, [load]);

  const streamCount = useCallback(
    (s: Stream) => {
      if (s.disabled) return 0;
      if (!s.match) return (rows ?? []).length;
      return (rows ?? []).filter((r) => s.match?.(r) ?? false).length;
    },
    [rows],
  );

  const visible = useMemo<ActivityEntry[]>(() => {
    const current = STREAMS.find((s) => s.id === stream);
    let list = rows ?? [];
    if (current?.match) list = list.filter((r) => current.match?.(r) ?? false);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          (r?.summary ?? '').toLowerCase().includes(q) ||
          (r?.actorName ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [rows, stream, query]);

  const groups = useMemo(() => {
    const map = new Map<string, ActivityEntry[]>();
    for (const entry of visible) {
      const key = dayKey(entry?.createdAt);
      const bucket = map.get(key);
      if (bucket) bucket.push(entry);
      else map.set(key, [entry]);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, items]) => ({ key, items }));
  }, [visible]);

  const actorCount = useMemo(
    () => new Set((rows ?? []).map((r) => r?.actorName).filter(Boolean)).size,
    [rows],
  );

  const canLoadMore = limit < LIMIT_STEPS[LIMIT_STEPS.length - 1];
  const handleLoadMore = () => {
    const next = LIMIT_STEPS.find((step) => step > limit) ?? limit;
    if (next === limit) return;
    setLimit(next);
    void load(next, false);
  };

  if (loading) {
    return (
      <WidgetCard title="Activity feed" subtitle="Recent changes across HR">
        <LoadingBlock label="Loading activity…" />
      </WidgetCard>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Entries loaded" value={(rows ?? []).length} hint={`Limit ${limit}`} />
        <StatCard label="Shown" value={visible.length} intent="info" />
        <StatCard label="Contributors" value={actorCount} />
        <div className="bg-bg-card border border-border-default rounded-md p-4 flex flex-col justify-center gap-2">
          <button
            onClick={() => void load(limit, false)}
            disabled={refreshing}
            className={`${BTN_SECONDARY} flex items-center justify-center gap-1.5`}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={() => onNavigate('employees')}
            className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-text-muted hover:text-primary transition-colors"
          >
            <ExternalLink size={14} /> Open employees
          </button>
        </div>
      </div>

      {error && (
        <div className="space-y-2">
          <ErrorBlock message={error} />
          <button onClick={() => void load(limit, true)} className={BTN_SECONDARY}>
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left rail: streams */}
        <div className="lg:col-span-1">
          <WidgetCard title="Streams" subtitle="Filter the timeline">
            <div className="space-y-0.5">
              {STREAMS.map((s) => {
                if (s.disabled) {
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md opacity-60 cursor-not-allowed"
                    >
                      <span className="flex items-center gap-1.5 text-text-muted text-xs truncate">
                        <Sparkles size={14} /> {s.label}
                      </span>
                      <span className="text-text-muted text-[10px] italic flex-shrink-0">{s.note}</span>
                    </div>
                  );
                }
                const isActive = s.id === stream;
                return (
                  <button
                    key={s.id}
                    onClick={() => setStream(s.id)}
                    className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                      isActive ? 'bg-bg-selected text-primary' : 'text-text-secondary hover:bg-bg-hover'
                    }`}
                  >
                    <span className="text-xs font-medium truncate">{s.label}</span>
                    <span
                      className={`text-[10px] tabular-nums flex-shrink-0 ${
                        isActive ? 'text-primary' : 'text-text-muted'
                      }`}
                    >
                      {streamCount(s)}
                    </span>
                  </button>
                );
              })}
            </div>
          </WidgetCard>
        </div>

        {/* Timeline */}
        <div className="lg:col-span-3">
          <WidgetCard title="Activity feed" subtitle={`${visible.length} entries`}>
            <div className="relative mb-3">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search summary or person…"
                className={`${INPUT_CLS} pl-8`}
              />
            </div>

            {groups.length === 0 ? (
              <EmptyBlock message="No activity recorded yet" />
            ) : (
              <div className="space-y-4 max-h-[560px] overflow-y-auto scrollbar-thin pr-1">
                {groups.map((group) => (
                  <div key={group.key}>
                    <p className="text-text-muted text-[10px] uppercase tracking-wider font-medium mb-2 sticky top-0 bg-bg-card py-1 z-10">
                      {dayHeading(group.key)}
                    </p>
                    <div className="border-l border-border-default pl-4 space-y-3">
                      {group.items.map((entry) => (
                        <div key={entry.id} className="relative">
                          <span className="absolute -left-4 top-1.5 w-2 h-2 rounded-full bg-primary -ml-[4.5px]" />
                          <p className="text-text-primary text-sm">{entry.summary}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <Chip label={entry.action || 'ACTION'} tone={ACTION_TONE(entry.action)} />
                            <span className="text-text-muted text-[10px]">
                              {entry.actorName || 'System'} · {entityLabel(entry.entityType)} ·{' '}
                              {timeAgo(entry.createdAt)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {canLoadMore && (
              <div className="flex justify-center mt-4">
                <button
                  onClick={handleLoadMore}
                  disabled={refreshing}
                  className={`${BTN_SECONDARY} flex items-center gap-1.5`}
                >
                  <ChevronDown size={16} /> Load more
                </button>
              </div>
            )}
          </WidgetCard>
        </div>
      </div>
    </div>
  );
}
