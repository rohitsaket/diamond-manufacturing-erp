import { useEffect, useRef, useState } from 'react';
import { Activity, Coffee, LogIn, LogOut, MapPin, Radio, Users } from 'lucide-react';
import { attendanceApi } from '../../api/attendance';
import {
  EmptyBlock, ErrorBlock, LoadingBlock, StatCard, TableShell,
} from '../../components/common/HrmsUI';
import type { PunchRecord } from '../../types/attendance';
import { CAPTURE_METHOD_LABELS, PUNCH_TYPE_LABELS, WORK_MODE_LABELS } from '../../types/attendance';
import {
  DateRangePicker, ExceptionChips, MiniBar, RefreshButton, StatusChip,
  formatDateTime, todayISO, useAsync,
} from './shared';

const PUNCH_ICON: Record<string, typeof LogIn> = {
  IN: LogIn, OUT: LogOut, BREAK_OUT: Coffee, BREAK_IN: LogIn,
};

/**
 * Live attendance board.
 *
 * The counters split two ways on purpose. "Present" is the day's marked status,
 * which is what payroll reads. "On the floor" comes from the punch stream and
 * answers a different question: who is physically here right now. Someone who
 * punched in an hour ago is on the floor but has no final status yet, so
 * collapsing the two would be wrong in both directions.
 */
export function LiveBoardTab() {
  const [date, setDate] = useState(todayISO());
  const { data, loading, error, reload } = useAsync(() => attendanceApi.liveBoard(date), [date]);

  // Punches arriving over SSE while the board is open. Kept separate from the
  // fetched snapshot so a live event never rewrites the aggregate counters,
  // which would drift out of step with the server.
  const [liveFeed, setLiveFeed] = useState<PunchRecord[]>([]);
  const [feedState, setFeedState] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const isToday = date === todayISO();
  const closeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isToday) {
      setFeedState('offline');
      return undefined;
    }
    setFeedState('connecting');
    const close = attendanceApi.liveStream(
      (punches) => {
        setFeedState('live');
        setLiveFeed((prev) => [...punches.slice().reverse(), ...prev].slice(0, 30));
      },
      () => setFeedState('offline'),
    );
    closeRef.current = close;
    // The connected event arrives immediately; treat an absence of errors as live.
    const timer = window.setTimeout(() => setFeedState((s) => (s === 'connecting' ? 'live' : s)), 1500);
    return () => { window.clearTimeout(timer); close(); };
  }, [isToday]);

  if (loading && !data) return <LoadingBlock label="Loading the live board…" />;
  if (error) return <ErrorBlock message={error} />;
  if (!data) return <EmptyBlock message="No attendance data for this date" />;

  const t = data.totals;
  const feed = liveFeed.length ? liveFeed : data.recentPunches;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <DateRangePicker from={date} to={date} onChange={(f) => setDate(f)} label="Board date" />
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <Radio
              size={13}
              className={feedState === 'live' ? 'text-success' : feedState === 'connecting' ? 'text-warning' : 'text-text-muted'}
            />
            {feedState === 'live' ? 'Live feed connected'
              : feedState === 'connecting' ? 'Connecting to the live feed…'
                : isToday ? 'Live feed offline, showing the last snapshot' : 'Live feed runs for today only'}
          </span>
          <RefreshButton onClick={reload} busy={loading} />
        </div>
      </div>

      {/* Day status, straight from the marked records */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard label="Headcount" value={t.headcount} hint="Working employees" />
        <StatCard label="Present" value={t.present} intent="success" hint={`${t.attendancePct}% attendance`} />
        <StatCard label="Absent" value={t.absent} intent={t.absent > 0 ? 'danger' : 'default'} />
        <StatCard label="Late" value={t.late} intent={t.late > 0 ? 'warning' : 'default'} />
        <StatCard label="On leave" value={t.onLeave} intent="info" />
        <StatCard label="Not marked" value={t.notMarked} hint={t.notMarked > 0 ? 'No record yet' : 'All accounted for'} />
      </div>

      {/* Physical presence, from the punch stream */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard label="On the floor" value={t.currentlyIn} intent="success" hint="Last punch was an entry" />
        <StatCard label="On break" value={t.onBreak} intent="warning" />
        <StatCard label="Punched out" value={t.punchedOut} />
        <StatCard label="Remote" value={t.remote} intent="info" />
        <StatCard label="Business travel" value={t.businessTravel} intent="info" />
        <StatCard label="Overtime" value={`${t.overtimeHours} h`} intent={t.overtimeHours > 0 ? 'info' : 'default'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Shift coverage */}
        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-text-primary text-sm font-semibold mb-3 flex items-center gap-2">
            <Users size={14} className="text-primary" /> Shift coverage
          </h4>
          {data.shiftCoverage.length === 0 ? (
            <p className="text-text-muted text-xs">No shifts are planned for this date.</p>
          ) : (
            <div className="space-y-3">
              {data.shiftCoverage.map((s) => (
                <div key={`${s.shiftId ?? 'none'}`}>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-text-secondary text-xs truncate">{s.shiftName}</span>
                    <span className="text-text-primary text-xs tabular-nums flex-shrink-0">
                      {s.present}/{s.planned}
                      <span className="text-text-muted ml-1.5">{s.coveragePct}%</span>
                    </span>
                  </div>
                  <MiniBar
                    value={s.present}
                    max={s.planned}
                    tone={s.coveragePct >= 90 ? 'success' : s.coveragePct >= 70 ? 'warning' : 'danger'}
                  />
                </div>
              ))}
            </div>
          )}
          <p className="text-text-muted text-[11px] mt-3 leading-relaxed">
            Planned comes from the published roster where one exists, otherwise from each employee's standing shift.
          </p>
        </div>

        {/* Departments */}
        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-text-primary text-sm font-semibold mb-3">By department</h4>
          {data.byDepartment.length === 0 ? (
            <p className="text-text-muted text-xs">No departments configured.</p>
          ) : (
            <div className="space-y-3">
              {data.byDepartment.map((d) => (
                <div key={`${d.departmentId ?? 'none'}`}>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-text-secondary text-xs truncate">{d.name}</span>
                    <span className="text-text-primary text-xs tabular-nums flex-shrink-0">
                      {d.present}/{d.headcount}
                      <span className="text-text-muted ml-1.5">{d.pct}%</span>
                    </span>
                  </div>
                  <MiniBar value={d.present} max={d.headcount} tone={d.pct >= 90 ? 'success' : d.pct >= 70 ? 'warning' : 'danger'} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Device health */}
        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-text-primary text-sm font-semibold mb-3 flex items-center gap-2">
            <Activity size={14} className="text-primary" /> Capture devices
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-2xl font-semibold text-success tabular-nums">{data.devices.online}</p>
              <p className="text-text-muted text-[11px]">Online</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-danger tabular-nums">{data.devices.offline}</p>
              <p className="text-text-muted text-[11px]">Offline</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-warning tabular-nums">{data.devices.degraded}</p>
              <p className="text-text-muted text-[11px]">Degraded</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-text-muted tabular-nums">{data.devices.unknown}</p>
              <p className="text-text-muted text-[11px]">Never reported</p>
            </div>
          </div>
          <p className="text-text-muted text-[11px] mt-3 leading-relaxed">
            A device is marked offline after three missed heartbeats, so a single dropped beat does not raise an alert.
          </p>
        </div>
      </div>

      {/* Exceptions */}
      <div>
        <h4 className="text-text-primary text-sm font-semibold mb-2">
          Exceptions {data.totals.exceptions > 0 && <span className="text-text-muted font-normal">({data.totals.exceptions})</span>}
        </h4>
        {data.exceptions.length === 0 ? (
          <div className="bg-bg-card border border-border-default rounded-md px-4 py-6 text-center">
            <p className="text-text-secondary text-sm">Nothing flagged on this date.</p>
          </div>
        ) : (
          <TableShell headers={['Employee', 'Code', 'Flags', 'Detail']}>
            {data.exceptions.map((e) => (
              <tr key={e.employeeId} className="hover:bg-bg-hover transition-colors">
                <td className="px-3 py-2 text-sm text-text-primary">{e.employeeName}</td>
                <td className="px-3 py-2 text-sm text-text-muted tabular-nums">{e.empCode}</td>
                <td className="px-3 py-2"><ExceptionChips flags={e.flags} /></td>
                <td className="px-3 py-2 text-sm text-text-secondary">{e.detail}</td>
              </tr>
            ))}
          </TableShell>
        )}
      </div>

      {/* Punch feed */}
      <div>
        <h4 className="text-text-primary text-sm font-semibold mb-2">
          Recent punches
          {liveFeed.length > 0 && <span className="text-success text-xs font-normal ml-2">{liveFeed.length} live</span>}
        </h4>
        {feed.length === 0 ? (
          <div className="bg-bg-card border border-border-default rounded-md px-4 py-6 text-center">
            <p className="text-text-secondary text-sm">No punches recorded yet.</p>
          </div>
        ) : (
          <TableShell headers={['Time', 'Employee', 'Type', 'Method', 'Mode', 'Device', 'Location']}>
            {feed.map((p) => {
              const Icon = PUNCH_ICON[p.punchType] ?? LogIn;
              return (
                <tr key={p.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2 text-sm text-text-primary tabular-nums whitespace-nowrap">{p.punchTime}</td>
                  <td className="px-3 py-2 text-sm text-text-primary">
                    {p.employeeName}
                    <span className="text-text-muted text-xs ml-1.5">{p.empCode}</span>
                  </td>
                  <td className="px-3 py-2 text-sm">
                    <span className="inline-flex items-center gap-1.5 text-text-secondary">
                      <Icon size={13} className={p.punchType === 'OUT' ? 'text-text-muted' : 'text-success'} />
                      {PUNCH_TYPE_LABELS[p.punchType]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-text-secondary">{CAPTURE_METHOD_LABELS[p.captureMethod]}</td>
                  <td className="px-3 py-2 text-sm text-text-secondary">{WORK_MODE_LABELS[p.workMode]}</td>
                  <td className="px-3 py-2 text-sm text-text-muted">{p.deviceName ?? '—'}</td>
                  <td className="px-3 py-2">
                    {p.geoStatus === 'NOT_REQUIRED' ? (
                      <span className="text-text-muted text-xs">Not checked</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin size={12} className={p.geoStatus === 'INSIDE' ? 'text-success' : 'text-danger'} />
                        <StatusChip value={p.geoStatus} />
                        {p.distanceM !== null && p.geoStatus === 'OUTSIDE' && (
                          <span className="text-text-muted text-xs tabular-nums">{p.distanceM} m</span>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </TableShell>
        )}
        <p className="text-text-muted text-[11px] mt-2">
          Snapshot generated {formatDateTime(data.generatedAt)}.
        </p>
      </div>
    </div>
  );
}
