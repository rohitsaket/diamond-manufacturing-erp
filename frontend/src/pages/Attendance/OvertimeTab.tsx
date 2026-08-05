import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { attendanceApi } from '../../api/attendance';
import {
  BTN_PRIMARY, BTN_SECONDARY, EmptyBlock, ErrorBlock, INPUT_CLS, LABEL_CLS,
  LoadingBlock, StatCard, TableShell,
} from '../../components/common/HrmsUI';
import { TabBar } from '../../components/common/TabBar';
import type { OvertimeRecord } from '../../types/attendance';
import {
  ActionFeedback, DateRangePicker, RefreshButton, StatusChip, formatDate,
  monthEndISO, monthStartISO, todayISO, useAction, useAsync,
} from './shared';

const STATUS_TABS = [
  { id: 'PENDING', label: 'Pending' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'DERIVED', label: 'Derived only' },
  { id: '', label: 'All' },
];

/**
 * Overtime ledger.
 *
 * Derived hours come out of the punches. Approved hours are what payroll pays.
 * The two are shown side by side because they are genuinely different numbers
 * and conflating them is how overtime gets paid twice or not at all.
 */
export function OvertimeTab() {
  const [from, setFrom] = useState(monthStartISO(todayISO()));
  const [to, setTo] = useState(monthEndISO(todayISO()));
  const [status, setStatus] = useState('PENDING');
  const [editing, setEditing] = useState<OvertimeRecord | null>(null);
  const [hours, setHours] = useState('');
  const action = useAction();

  const { data, loading, error, reload } = useAsync(
    () => attendanceApi.overtime({ from, to, status: status || undefined, pageSize: 200 }),
    [from, to, status],
  );

  const totals = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      derived: Math.round(rows.reduce((s, r) => s + r.derivedHours, 0) * 100) / 100,
      approved: Math.round(rows.reduce((s, r) => s + r.approvedHours, 0) * 100) / 100,
      payable: Math.round(rows.reduce((s, r) => s + r.payableHours, 0) * 100) / 100,
      pending: rows.filter((r) => r.status === 'PENDING').length,
    };
  }, [data]);

  const decide = async (row: OvertimeRecord, approve: boolean, approvedHours: number) => {
    const ok = await action.run(
      () => attendanceApi.decideOvertime({
        employeeId: row.employeeId, attDate: row.attDate, approvedHours, approve,
      }),
      approve ? `Approved ${approvedHours} h for ${row.employeeName}.` : `Rejected overtime for ${row.employeeName}.`,
    );
    if (ok) { setEditing(null); reload(); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <RefreshButton onClick={reload} busy={loading} />
      </div>

      <TabBar tabs={STATUS_TABS} active={status} onChange={setStatus} />
      <ActionFeedback error={action.error} notice={action.notice} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Derived hours" value={totals.derived} hint="From the punch stream" />
        <StatCard label="Approved hours" value={totals.approved} intent="success" hint="What payroll pays" />
        <StatCard label="Payable hours" value={totals.payable} intent="info" hint="After the multiplier" />
        <StatCard label="Awaiting decision" value={totals.pending} intent={totals.pending > 0 ? 'warning' : 'default'} />
      </div>

      {loading && !data && <LoadingBlock label="Loading overtime…" />}
      {error && <ErrorBlock message={error} />}

      {data && (data.rows.length === 0 ? (
        <EmptyBlock message="No overtime in this range" hint="Overtime is derived when a day runs past its shift by more than the policy minimum." />
      ) : (
        <TableShell headers={['Date', 'Employee', 'Type', 'Derived', 'Approved', 'Rate', 'Payable', 'Status', '']}>
          {data.rows.map((r) => (
            <tr key={r.id} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2 text-sm text-text-primary whitespace-nowrap">{formatDate(r.attDate)}</td>
              <td className="px-3 py-2 text-sm text-text-primary">
                {r.employeeName}
                <span className="text-text-muted text-xs ml-1.5">{r.empCode}</span>
              </td>
              <td className="px-3 py-2 text-sm text-text-secondary">{r.otType.replace('_', ' ').toLowerCase()}</td>
              <td className="px-3 py-2 text-sm text-text-secondary tabular-nums">{r.derivedHours}</td>
              <td className="px-3 py-2 text-sm text-text-primary font-medium tabular-nums">{r.approvedHours}</td>
              <td className="px-3 py-2 text-sm text-text-muted tabular-nums">×{r.multiplier}</td>
              <td className="px-3 py-2 text-sm text-primary font-medium tabular-nums">{r.payableHours}</td>
              <td className="px-3 py-2"><StatusChip value={r.status} /></td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {r.status === 'PENDING' || r.status === 'DERIVED' ? (
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => { setEditing(r); setHours(String(r.derivedHours)); }}
                      className="px-2 py-1 rounded border border-success/40 text-success text-xs font-medium hover:bg-success-light transition-colors"
                    >
                      <span className="flex items-center gap-1"><Check size={12} /> Approve</span>
                    </button>
                    <button
                      onClick={() => decide(r, false, 0)}
                      className="px-2 py-1 rounded border border-danger/40 text-danger text-xs font-medium hover:bg-danger-light transition-colors"
                    >
                      <span className="flex items-center gap-1"><X size={12} /> Reject</span>
                    </button>
                  </div>
                ) : (
                  <span className="text-text-muted text-xs">{r.approvedByName ?? '—'}</span>
                )}
              </td>
            </tr>
          ))}
        </TableShell>
      ))}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-bg-card border border-border-default rounded-lg w-full max-w-md p-5 shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-text-primary font-semibold text-base">Approve overtime</h3>
            <p className="text-text-muted text-xs mt-0.5">
              {editing.employeeName} · {formatDate(editing.attDate)}
            </p>
            <div className="mt-4">
              <label className={LABEL_CLS}>Hours to approve</label>
              <input
                type="number" step="0.25" min="0" max={editing.derivedHours}
                value={hours} onChange={(e) => setHours(e.target.value)} className={INPUT_CLS}
              />
              <p className="text-text-muted text-xs mt-1.5">
                {editing.derivedHours} h were derived from the punches. More than that cannot be approved —
                the hours have to be evidenced by the day, not assigned.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className={BTN_SECONDARY}>Cancel</button>
              <button
                onClick={() => decide(editing, true, Number(hours))}
                disabled={action.busy || Number(hours) > editing.derivedHours || Number(hours) < 0}
                className={BTN_PRIMARY}
              >
                {action.busy ? 'Saving…' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
