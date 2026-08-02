import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { attendanceApi, hrDashboardApi } from '../../../api/hrms';
import type { Holiday } from '../../../types/hrms';
import { WidgetCard, WidgetEmpty, WidgetUnavailable } from '../WidgetCard';
import { TabBar } from '../../../components/common/TabBar';
import { ModalShell } from '../../../components/common/ModalShell';
import {
  BTN_SECONDARY,
  Chip,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
} from '../../../components/common/HrmsUI';

// ---------------------------------------------------------------------------
// Types (the calendar endpoint is loosely typed in api/hrms.ts)
// ---------------------------------------------------------------------------

type CalendarEventType =
  | 'HOLIDAY'
  | 'LEAVE'
  | 'BIRTHDAY'
  | 'ANNIVERSARY'
  | 'TRAINING'
  | 'MEETING'
  | 'EVENT'
  | 'PAYROLL';

interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  title: string;
  date: string;
  endDate: string | null;
  detail: string | null;
  employeeId: number | null;
}

type ChipTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const EVENT_TYPES: CalendarEventType[] = [
  'HOLIDAY',
  'LEAVE',
  'BIRTHDAY',
  'ANNIVERSARY',
  'TRAINING',
  'MEETING',
  'EVENT',
  'PAYROLL',
];

const TYPE_TONE: Record<CalendarEventType, ChipTone> = {
  HOLIDAY: 'danger',
  LEAVE: 'info',
  BIRTHDAY: 'warning',
  ANNIVERSARY: 'success',
  TRAINING: 'primary',
  MEETING: 'default',
  EVENT: 'default',
  PAYROLL: 'success',
};

const TYPE_LABEL: Record<CalendarEventType, string> = {
  HOLIDAY: 'Holiday',
  LEAVE: 'Leave',
  BIRTHDAY: 'Birthday',
  ANNIVERSARY: 'Anniversary',
  TRAINING: 'Training',
  MEETING: 'Meeting',
  EVENT: 'Event',
  PAYROLL: 'Payroll',
};

/** Chip background used inside compact day cells. */
const TYPE_CELL: Record<CalendarEventType, string> = {
  HOLIDAY: 'bg-danger-light text-danger',
  LEAVE: 'bg-info-light text-info',
  BIRTHDAY: 'bg-warning-light text-warning',
  ANNIVERSARY: 'bg-success-light text-success',
  TRAINING: 'bg-primary-light text-primary',
  MEETING: 'bg-bg-hover text-text-secondary',
  EVENT: 'bg-bg-hover text-text-secondary',
  PAYROLL: 'bg-success-light text-success',
};

// ---------------------------------------------------------------------------
// Date helpers (date-fns is not a dependency)
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Local-time YYYY-MM-DD (never UTC-shifted like toISOString would be). */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Accepts "2026-08-02" or a full ISO timestamp; returns the local calendar date. */
function parseDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const head = String(value).slice(0, 10);
  const parts = head.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const parsed = new Date(y, m - 1, d);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthLabel(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function longDayLabel(iso: string): string {
  const d = parseDay(iso);
  if (!d) return iso;
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  next.setDate(next.getDate() + n);
  return next;
}

// ---------------------------------------------------------------------------
// Normalisation — the API returns `any[]`, so never trust the shape.
// ---------------------------------------------------------------------------

function normalizeEvent(raw: unknown, index: number): CalendarEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const date = typeof rec.date === 'string' ? rec.date.slice(0, 10) : null;
  if (!date || !parseDay(date)) return null;
  const rawType = typeof rec.type === 'string' ? rec.type.toUpperCase() : '';
  const type = (EVENT_TYPES as string[]).includes(rawType) ? (rawType as CalendarEventType) : 'EVENT';
  return {
    id: rec.id != null ? String(rec.id) : `${date}-${index}`,
    type,
    title: typeof rec.title === 'string' && rec.title ? rec.title : TYPE_LABEL[type],
    date,
    endDate: typeof rec.endDate === 'string' ? rec.endDate.slice(0, 10) : null,
    detail: typeof rec.detail === 'string' ? rec.detail : null,
    employeeId: typeof rec.employeeId === 'number' ? rec.employeeId : null,
  };
}

// ---------------------------------------------------------------------------

export function CalendarSection({ onNavigate }: { onNavigate: (page: string) => void }) {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState('month');
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => new Set<string>());
  const [openDay, setOpenDay] = useState<string | null>(null);

  const monthStart = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1), [cursor]);
  const monthEnd = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0), [cursor]);
  const todayIso = toIsoDate(today);

  const load = useCallback(
    async (isFirst: boolean) => {
      if (isFirst) setLoading(true);
      else setRefreshing(true);
      setError(null);
      const from = toIsoDate(monthStart);
      const to = toIsoDate(monthEnd);
      try {
        // Single month only — the server rejects ranges longer than 400 days.
        const raw = await hrDashboardApi.calendar(from, to);
        const list = Array.isArray(raw) ? raw : [];
        setEvents(list.map((r, i) => normalizeEvent(r, i)).filter((e): e is CalendarEvent => e !== null));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load the calendar');
        setEvents([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
      try {
        const hol = await attendanceApi.holidays(monthStart.getFullYear());
        setHolidays(Array.isArray(hol) ? hol : []);
      } catch {
        setHolidays([]);
      }
    },
    [monthStart, monthEnd],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const typesPresent = useMemo(() => {
    const present = new Set<string>((events ?? []).map((e) => e.type));
    return EVENT_TYPES.filter((t) => present.has(t));
  }, [events]);

  const filtered = useMemo(
    () => (events ?? []).filter((e) => !hiddenTypes.has(e.type)),
    [events, hiddenTypes],
  );

  /** date (YYYY-MM-DD) → events, expanding multi-day ranges inside this month. */
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    const firstIso = toIsoDate(monthStart);
    const lastIso = toIsoDate(monthEnd);
    for (const ev of filtered) {
      const start = parseDay(ev.date);
      if (!start) continue;
      const end = parseDay(ev.endDate) ?? start;
      let cur = start;
      // Guard against reversed / runaway ranges.
      let guard = 0;
      while (cur.getTime() <= end.getTime() && guard < 400) {
        const iso = toIsoDate(cur);
        if (iso >= firstIso && iso <= lastIso) {
          const bucket = map.get(iso);
          if (bucket) bucket.push(ev);
          else map.set(iso, [ev]);
        }
        cur = addDays(cur, 1);
        guard += 1;
      }
    }
    return map;
  }, [filtered, monthStart, monthEnd]);

  const agendaGroups = useMemo(() => {
    const keys = Array.from(byDay.keys()).sort();
    return keys.map((iso) => ({ iso, items: byDay.get(iso) ?? [] }));
  }, [byDay]);

  const monthHolidays = useMemo(
    () =>
      (holidays ?? [])
        .filter((h) => !!h?.date)
        .slice()
        .sort((a, b) => String(a.date).localeCompare(String(b.date))),
    [holidays],
  );

  const toggleType = (type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const goToday = () => setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
  const shiftMonth = (delta: number) =>
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));

  const leadingBlanks = monthStart.getDay();
  const daysInMonth = monthEnd.getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_unused, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const openDayEvents = openDay ? (byDay.get(openDay) ?? []) : [];

  return (
    <div className="space-y-4">
      <WidgetCard
        title="Calendar"
        subtitle="Holidays, leave, birthdays, anniversaries, training, meetings and payroll dates"
        actions={
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-text-primary text-xs font-semibold min-w-[120px] text-center">
              {monthLabel(cursor)}
            </span>
            <button
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              <ChevronRight size={18} />
            </button>
            <button
              onClick={goToday}
              className="px-2.5 py-1 rounded-md border border-border-default text-text-secondary text-[11px] font-medium hover:bg-bg-hover transition-colors"
            >
              Today
            </button>
            <button
              onClick={() => void load(false)}
              disabled={refreshing}
              aria-label="Refresh"
              className="p-1 rounded text-text-muted hover:text-primary hover:bg-bg-hover transition-colors disabled:opacity-40"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      >
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <TabBar
            tabs={[
              { id: 'month', label: 'Month' },
              { id: 'agenda', label: 'Agenda', count: agendaGroups.length },
            ]}
            active={view}
            onChange={setView}
          />
          {typesPresent.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {typesPresent.map((type) => {
                const on = !hiddenTypes.has(type);
                return (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors ${
                      on
                        ? `${TYPE_CELL[type]} border-transparent`
                        : 'border-border-default text-text-muted hover:bg-bg-hover'
                    }`}
                  >
                    {TYPE_LABEL[type]}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <div className="mb-3 space-y-2">
            <ErrorBlock message={error} />
            <button onClick={() => void load(true)} className={BTN_SECONDARY}>
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <LoadingBlock label="Loading calendar…" />
        ) : view === 'month' ? (
          <div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAYS.map((w) => (
                <div
                  key={w}
                  className="text-center text-[10px] uppercase tracking-wider text-text-muted font-medium py-1"
                >
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, idx) => {
                if (day === null) {
                  return <div key={`blank-${idx}`} className="min-h-[92px] rounded-md" />;
                }
                const iso = toIsoDate(new Date(cursor.getFullYear(), cursor.getMonth(), day));
                const dayEvents = byDay.get(iso) ?? [];
                const weekend = idx % 7 === 0 || idx % 7 === 6;
                const isToday = iso === todayIso;
                return (
                  <button
                    key={iso}
                    onClick={() => setOpenDay(iso)}
                    className={`min-h-[92px] border border-border-light rounded-md p-1.5 text-left transition-colors hover:bg-bg-hover ${
                      weekend ? 'bg-bg-secondary' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      {isToday ? (
                        <span className="bg-primary text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px]">
                          {day}
                        </span>
                      ) : (
                        <span className="text-text-secondary text-[11px] font-medium">{day}</span>
                      )}
                      {dayEvents.length > 0 && (
                        <span className="text-text-muted text-[9px] tabular-nums">{dayEvents.length}</span>
                      )}
                    </div>
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 3).map((ev) => (
                        <div
                          key={`${iso}-${ev.id}`}
                          title={ev.title}
                          className={`truncate rounded px-1 py-0.5 text-[9px] font-medium ${TYPE_CELL[ev.type]}`}
                        >
                          {ev.title}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <div className="text-text-muted text-[9px] px-1">+{dayEvents.length - 3} more</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : agendaGroups.length === 0 ? (
          <WidgetEmpty message="Nothing scheduled this month" />
        ) : (
          <div className="space-y-4 max-h-[520px] overflow-y-auto scrollbar-thin">
            {agendaGroups.map((group) => (
              <div key={group.iso}>
                <p className="text-text-muted text-[10px] uppercase tracking-wider font-medium mb-1.5">
                  {longDayLabel(group.iso)}
                  {group.iso === todayIso && <span className="text-primary"> · today</span>}
                </p>
                <div className="space-y-1">
                  {group.items.map((ev) => (
                    <div
                      key={`${group.iso}-${ev.id}`}
                      className="flex items-start gap-2.5 px-2 py-1.5 rounded-md hover:bg-bg-hover transition-colors"
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        <Chip label={TYPE_LABEL[ev.type]} tone={TYPE_TONE[ev.type]} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-text-primary text-xs font-medium">{ev.title}</p>
                        {ev.detail && <p className="text-text-secondary text-[11px] mt-0.5">{ev.detail}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-3 flex-wrap mt-4 pt-3 border-t border-border-light">
          <span className="text-text-muted text-[10px] uppercase tracking-wider font-medium">Legend</span>
          {EVENT_TYPES.map((type) => (
            <span key={type} className="flex items-center gap-1.5 text-text-muted text-[10px]">
              <span className={`w-2.5 h-2.5 rounded-sm ${TYPE_CELL[type]}`} />
              {TYPE_LABEL[type]}
            </span>
          ))}
        </div>
      </WidgetCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WidgetCard
          title="Company holidays"
          subtitle={`Declared holidays for ${monthStart.getFullYear()}`}
        >
          {monthHolidays.length === 0 ? (
            <WidgetEmpty message="No holidays declared for this year" />
          ) : (
            <div className="divide-y divide-border-light max-h-[260px] overflow-y-auto scrollbar-thin">
              {monthHolidays.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-text-primary text-xs font-medium truncate">{h.name}</p>
                    <p className="text-text-muted text-[10px]">{longDayLabel(String(h.date))}</p>
                  </div>
                  {h.isOptional && <Chip label="Optional" tone="warning" />}
                </div>
              ))}
            </div>
          )}
        </WidgetCard>

        <WidgetCard
          title="Shift calendar"
          subtitle="Rotation view"
          actions={
            <button onClick={() => onNavigate('attendance')} className={BTN_SECONDARY}>
              <span className="flex items-center gap-1.5">
                <CalendarDays size={14} /> Open attendance
              </span>
            </button>
          }
        >
          <WidgetUnavailable reason="Shift rotations are not scheduled per-day yet — shifts are assigned per employee" />
        </WidgetCard>
      </div>

      <AnimatePresence>
        {openDay && (
          <ModalShell
            title={longDayLabel(openDay)}
            subtitle={`${openDayEvents.length} event${openDayEvents.length === 1 ? '' : 's'}`}
            onClose={() => setOpenDay(null)}
            maxWidth="max-w-lg"
          >
            {openDayEvents.length === 0 ? (
              <EmptyBlock message="Nothing scheduled on this day" />
            ) : (
              <div className="space-y-2">
                {openDayEvents.map((ev) => (
                  <div
                    key={`modal-${ev.id}`}
                    className="flex items-start gap-3 p-3 rounded-md border border-border-light"
                  >
                    <div className="flex-shrink-0">
                      <Chip label={TYPE_LABEL[ev.type]} tone={TYPE_TONE[ev.type]} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-text-primary text-sm font-medium">{ev.title}</p>
                      {ev.detail && <p className="text-text-secondary text-xs mt-0.5">{ev.detail}</p>}
                      {ev.endDate && ev.endDate !== ev.date && (
                        <p className="text-text-muted text-[10px] mt-1">
                          {longDayLabel(ev.date)} → {longDayLabel(ev.endDate)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
