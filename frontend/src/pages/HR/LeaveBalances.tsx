import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import {
  TableShell,
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  BTN_SECONDARY,
} from '../../components/common/HrmsUI';
import { leaveApi } from '../../api/hrms';
import type { LeaveBalance, LeaveType } from '../../types/hrms';
import { useApp } from '../../contexts/AppContext';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

const errMsg = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

interface EmployeeBalanceRow {
  employeeId: number;
  name: string;
  code: string;
  cells: Record<number, LeaveBalance>;
}

/** One row per employee, one column per leave type. */
export function LeaveBalances() {
  const { employees } = useApp();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [initialising, setInitialising] = useState(false);

  useEffect(() => {
    leaveApi
      .types()
      .then(setTypes)
      .catch((err: unknown) => setError(errMsg(err, 'Failed to load leave types')));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    leaveApi
      .balances(year)
      .then(setBalances)
      .catch((err: unknown) => setError(errMsg(err, 'Failed to load leave balances')))
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => {
    load();
  }, [load]);

  const initYear = async () => {
    if (!window.confirm(`Allocate the annual leave quota to every employee for ${year}?`)) return;
    setInitialising(true);
    try {
      const res = await leaveApi.initYear(year);
      window.alert(`Initialised ${year} — ${res.rowsAffected} balance row(s) affected.`);
      load();
    } catch (err) {
      window.alert(errMsg(err, 'Failed to initialise the year'));
    } finally {
      setInitialising(false);
    }
  };

  const rows = useMemo<EmployeeBalanceRow[]>(() => {
    const map = new Map<number, EmployeeBalanceRow>();
    for (const b of balances) {
      let row = map.get(b.employeeId);
      if (!row) {
        const emp = employees.find((e) => e.id === b.employeeId);
        row = {
          employeeId: b.employeeId,
          name: b.employeeName ?? emp?.fullName ?? `Employee #${b.employeeId}`,
          code: b.empCode ?? emp?.empCode ?? '—',
          cells: {},
        };
        map.set(b.employeeId, row);
      }
      row.cells[b.leaveTypeId] = b;
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [balances, employees]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
  }, [rows, search]);

  const toneFor = (balance: number): string => {
    if (balance <= 0) return 'text-danger';
    if (balance <= 1) return 'text-warning';
    return 'text-text-primary';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {YEARS.map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                year === y
                  ? 'bg-primary-light border-primary/30 text-primary'
                  : 'border-border-default text-text-muted hover:border-text-muted'
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee…"
              className="w-56 bg-bg-card border border-border-default rounded-md pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>
          <button
            onClick={initYear}
            disabled={initialising}
            className={`${BTN_SECONDARY} flex items-center gap-2`}
          >
            <RefreshCw size={14} className={initialising ? 'animate-spin' : ''} />
            Initialise year
          </button>
        </div>
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label="Loading leave balances…" />
      ) : visible.length === 0 ? (
        <EmptyBlock
          message={`No leave balances for ${year}`}
          hint={search ? 'No employee matches that search.' : 'Use “Initialise year” to allocate the annual quota.'}
        />
      ) : (
        <TableShell headers={['Worker', ...types.map((t) => t.code)]}>
          {visible.map((row) => (
            <tr key={row.employeeId} className="hover:bg-bg-hover transition-colors">
              <td className="px-3 py-2.5">
                <p className="text-text-primary text-sm font-medium">{row.name}</p>
                <p className="text-text-muted text-[10px] font-mono">{row.code}</p>
              </td>
              {types.map((t) => {
                const cell = row.cells[t.id];
                if (!cell) {
                  return (
                    <td key={t.id} className="px-3 py-2.5 text-text-muted text-xs">
                      —
                    </td>
                  );
                }
                const balance = Number(cell.balance);
                return (
                  <td key={t.id} className="px-3 py-2.5">
                    <p className={`text-sm font-mono font-semibold ${toneFor(balance)}`}>{balance.toFixed(1)}</p>
                    <p className="text-text-muted text-[10px] font-mono">
                      {Number(cell.used).toFixed(1)}/{Number(cell.allocated).toFixed(1)}
                    </p>
                  </td>
                );
              })}
            </tr>
          ))}
        </TableShell>
      )}
    </div>
  );
}
