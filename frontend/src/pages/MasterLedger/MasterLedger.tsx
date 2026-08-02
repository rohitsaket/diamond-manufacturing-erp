import { useState, useMemo } from 'react';
import { Search, Download, ChevronUp, ChevronDown } from 'lucide-react';
import { Lot, LotStatus, YIELD_TARGET_PCT, LOT_SLA_DAYS, LEAKAGE_FLAG_WEIGHT_RATIO } from '../../data/mockData';
import { StatusChip } from '../../components/common/StatusChip';
import { useApp } from '../../contexts/AppContext';

function exportToCsv(rows: Lot[]) {
  const headers = [
    'Lot Name', 'Lot ID', 'Worker', 'Shape', 'Qty',
    'Issue Wt (ct)', 'Est Wt (ct)', 'Polished Wt (ct)',
    'Issue Date', 'Received Date', 'Days', 'Color', 'Clarity', 'Cut',
    'Lab', 'Labour Head', 'Labour Amount (₹)', 'Weight Diff (ct)', 'Status',
  ];
  const escape = (v: string | number | undefined) => {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    headers.join(','),
    ...rows.map(l => [
      l.lotName, l.lotId, l.employeeName, l.shape, l.qty,
      l.issueWeight, l.estimateWt, l.polishedWt ?? '',
      l.issueDate, l.receivedDate ?? '', l.daysConsumed ?? '',
      l.color ?? '', l.clarity ?? '', l.cut ?? '',
      l.lab ?? '', l.labourHead, l.labourAmount ?? '', l.weightDiff ?? '', l.status,
    ].map(escape).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `master-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type SortKey = keyof Lot;

const columns = [
  { key: 'lotName', label: 'Lot Name', width: 'w-28' },
  { key: 'employeeName', label: 'Worker', width: 'w-36' },
  { key: 'shape', label: 'Shape', width: 'w-20' },
  { key: 'qty', label: 'Qty', width: 'w-12' },
  { key: 'issueWeight', label: 'Issue Wt', width: 'w-20' },
  { key: 'estimateWt', label: 'Est Wt', width: 'w-18' },
  { key: 'polishedWt', label: 'Polish Wt', width: 'w-20' },
  { key: 'issueDate', label: 'Issue Date', width: 'w-24' },
  { key: 'daysConsumed', label: 'Days', width: 'w-14' },
  { key: 'color', label: 'Color', width: 'w-14' },
  { key: 'clarity', label: 'Clarity', width: 'w-16' },
  { key: 'lab', label: 'Lab', width: 'w-14' },
  { key: 'labourHead', label: 'Labour Head', width: 'w-28' },
  { key: 'labourAmount', label: 'Labour ₹', width: 'w-24' },
  { key: 'weightDiff', label: 'Wt Diff', width: 'w-18' },
  { key: 'status', label: 'Status', width: 'w-28' },
];

function Th({ col, sort, setSort, stickyLeft }: { col: typeof columns[0]; sort: { key: SortKey; dir: 'asc' | 'desc' }; setSort: (s: { key: SortKey; dir: 'asc' | 'desc' }) => void; stickyLeft?: string }) {
  const isActive = sort.key === col.key;
  return (
    <th
      className={`px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider cursor-pointer whitespace-nowrap select-none ${col.width} ${stickyLeft ? `sticky ${stickyLeft} z-10 bg-bg-secondary` : ''} ${isActive ? 'text-primary' : 'text-text-muted hover:text-text-secondary'}`}
      onClick={() => setSort({ key: col.key as SortKey, dir: isActive && sort.dir === 'asc' ? 'desc' : 'asc' })}
    >
      <span className="flex items-center gap-1">
        {col.label}
        {isActive ? (sort.dir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : null}
      </span>
    </th>
  );
}

export function MasterLedger() {
  const { lots } = useApp();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LotStatus | 'ALL'>('ALL');
  const [labFilter, setLabFilter] = useState<string>('ALL');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'issueDate', dir: 'desc' });

  const filtered = useMemo(() => {
    let data = [...lots];
    if (search) data = data.filter(l => [l.lotName, l.lotId, l.employeeName, l.shape].some(v => v?.toLowerCase().includes(search.toLowerCase())));
    if (statusFilter !== 'ALL') data = data.filter(l => l.status === statusFilter);
    if (labFilter !== 'ALL') data = data.filter(l => l.lab === labFilter);
    data.sort((a, b) => {
      const av = (a as any)[sort.key] ?? '';
      const bv = (b as any)[sort.key] ?? '';
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return data;
  }, [lots, search, statusFilter, labFilter, sort]);

  const totals = useMemo(() => ({
    qty: filtered.reduce((s, l) => s + l.qty, 0),
    issueWeight: filtered.reduce((s, l) => s + l.issueWeight, 0),
    polishedWt: filtered.reduce((s, l) => s + (l.polishedWt || 0), 0),
    labourAmount: filtered.reduce((s, l) => s + (l.labourAmount || 0), 0),
  }), [filtered]);

  const statuses: (LotStatus | 'ALL')[] = ['ALL', 'ISSUED', 'IN_PROGRESS', 'RECEIVED', 'VERIFIED', 'REWORK', 'LOST'];

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-text-primary">Master Ledger</h2>
          <p className="text-text-secondary text-sm mt-1">All lots · sortable · filterable</p>
        </div>
        <button
          onClick={() => exportToCsv(filtered)}
          className="flex items-center gap-2 px-4 py-2 rounded-md border border-border-default text-text-secondary text-sm hover:bg-bg-hover transition-colors"
        >
          <Download size={14} />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search lots, workers, shapes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-bg-card border border-border-default rounded-md pl-9 pr-3 py-2 text-text-primary text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 placeholder:text-text-muted"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${statusFilter === s ? 'bg-primary-light border-primary/30 text-primary' : 'border-border-default text-text-muted hover:border-text-muted hover:text-text-secondary'}`}
            >
              {s === 'ALL' ? 'All' : s === 'IN_PROGRESS' ? 'In Progress' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {['ALL', 'IGI', 'GIA', 'US'].map(l => (
            <button
              key={l}
              onClick={() => setLabFilter(l)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-all ${labFilter === l ? 'bg-primary-light border-primary/30 text-primary' : 'border-border-default text-text-muted hover:border-text-muted'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-6 px-4 py-2.5 bg-bg-card border border-border-default rounded-md text-xs">
        <span className="text-text-muted">{filtered.length} lots</span>
        <span className="text-text-muted">Qty: <span className="text-text-secondary font-mono">{totals.qty}</span></span>
        <span className="text-text-muted">Issue: <span className="text-text-primary font-mono">{totals.issueWeight.toFixed(2)} ct</span></span>
        <span className="text-text-muted">Polished: <span className="text-success font-mono">{totals.polishedWt.toFixed(2)} ct</span></span>
        <span className="text-text-muted">Labour: <span className="text-text-primary font-mono font-semibold">₹{totals.labourAmount.toLocaleString()}</span></span>
        {totals.issueWeight > 0 && (
          <span className="text-text-muted">Yield: <span className={`font-mono font-semibold ${(totals.polishedWt / totals.issueWeight * 100) >= YIELD_TARGET_PCT ? 'text-success' : 'text-warning'}`}>
            {((totals.polishedWt / totals.issueWeight) * 100).toFixed(1)}%
          </span></span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto rounded-md border border-border-default bg-bg-card">
        <table className="w-full min-w-max">
          <thead className="sticky top-0 bg-bg-secondary border-b border-border-default z-20">
            <tr>
              <th className="sticky left-0 z-10 bg-bg-secondary px-3 py-3 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider w-10">#</th>
              {columns.map(col => (
                <Th key={col.key} col={col} sort={sort} setSort={setSort} stickyLeft={col.key === 'lotName' ? 'left-10' : undefined} />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {filtered.map((lot, i) => (
              <tr
                key={lot.id}
                className="group hover:bg-bg-hover transition-colors"
              >
                <td className="sticky left-0 z-10 bg-bg-card group-hover:bg-bg-hover px-3 py-2.5 text-text-muted text-[10px] font-mono">{i + 1}</td>
                <td className="sticky left-10 z-10 bg-bg-card group-hover:bg-bg-hover px-3 py-2.5">
                  <div>
                    <p className="text-text-primary text-xs font-semibold font-mono">{lot.lotName}</p>
                    <p className="text-text-muted text-[10px]">{lot.lotId}</p>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-text-secondary text-xs truncate max-w-[140px]">{lot.employeeName}</td>
                <td className="px-3 py-2.5 text-text-secondary text-xs">{lot.shape}</td>
                <td className="px-3 py-2.5 text-text-muted text-xs font-mono">{lot.qty}</td>
                <td className="px-3 py-2.5 text-text-primary text-xs font-mono">{lot.issueWeight.toFixed(2)}</td>
                <td className="px-3 py-2.5 text-text-muted text-xs font-mono">{lot.estimateWt.toFixed(2)}</td>
                <td className="px-3 py-2.5 text-success text-xs font-mono">{lot.polishedWt?.toFixed(2) ?? '—'}</td>
                <td className="px-3 py-2.5 text-text-muted text-xs">{lot.issueDate}</td>
                <td className="px-3 py-2.5">
                  {lot.daysConsumed ? (
                    <span className={`text-xs font-mono ${lot.daysConsumed > LOT_SLA_DAYS ? 'text-warning' : 'text-text-muted'}`}>{lot.daysConsumed}d</span>
                  ) : '—'}
                </td>
                <td className="px-3 py-2.5 text-text-muted text-xs font-mono">{lot.color ?? '—'}</td>
                <td className="px-3 py-2.5 text-text-muted text-xs font-mono">{lot.clarity ?? '—'}</td>
                <td className="px-3 py-2.5">
                  {lot.lab && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-bg-hover text-text-secondary">
                      {lot.lab}
                    </span>
                  )}
                  {!lot.lab && <span className="text-text-muted">—</span>}
                </td>
                <td className="px-3 py-2.5 text-text-muted text-xs">{lot.labourHead}</td>
                <td className="px-3 py-2.5 text-text-primary text-xs font-mono font-semibold">
                  {lot.labourAmount ? `₹${lot.labourAmount.toLocaleString()}` : '—'}
                </td>
                <td className="px-3 py-2.5">
                  {lot.weightDiff ? (
                    <span className={`text-xs font-mono ${lot.weightDiff / lot.issueWeight > LEAKAGE_FLAG_WEIGHT_RATIO ? 'text-danger' : 'text-warning/70'}`}>
                      {lot.weightDiff.toFixed(2)}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-3 py-2.5"><StatusChip status={lot.status} /></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-6 py-16 text-center">
                  <div className="flex flex-col items-center gap-3 text-text-muted">
                    <span className="text-4xl">◇</span>
                    <p className="text-sm font-medium">No lots match your filters</p>
                    <p className="text-xs">Try adjusting the search or status filter</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
