import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Gem, X } from 'lucide-react';
import { Employee, YIELD_TARGET_PCT } from '../../data/mockData';
import { WorkerStatusDot, StatusChip } from '../../components/common/StatusChip';
import { DiamondGauge } from '../../components/common/DiamondGauge';
import { useApp } from '../../contexts/AppContext';

const gradeColors: Record<string, string> = {
  'A*': 'text-text-primary border-border-default bg-bg-hover',
  'A+++': 'text-text-secondary border-border-default bg-bg-hover',
  'A++': 'text-text-secondary border-border-default bg-bg-hover',
  'A+': 'text-text-muted border-border-default bg-bg-card',
  'A': 'text-text-muted border-border-default bg-bg-card',
  'B': 'text-text-muted border-border-default bg-bg-card',
};

function EmployeeModal({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const { lots } = useApp();
  const empLots = lots.filter(l => l.employeeId === emp.id);
  const activeLots = empLots.filter(l => l.status === 'ISSUED' || l.status === 'IN_PROGRESS');

  const BUCKET_RANGES = [
    { label: '0.00–0.49', min: 0, max: 0.49 },
    { label: '0.50–0.99', min: 0.5, max: 0.99 },
    { label: '1.00–1.99', min: 1.0, max: 1.99 },
    { label: '2.00–2.99', min: 2.0, max: 2.99 },
    { label: '3.00–4.99', min: 3.0, max: 4.99 },
    { label: '5.00–9.99', min: 5.0, max: 9.99 },
    { label: '10.00+', min: 10.0, max: Infinity },
  ];

  const totalLotCount = empLots.length || 1;
  const weightBuckets = BUCKET_RANGES.map(b => {
    const count = empLots.filter(l => {
      const wt = l.polishedWt ?? l.issueWeight;
      return wt >= b.min && wt <= b.max;
    }).length;
    return { label: b.label, count, pct: (count / totalLotCount) * 100 };
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="relative bg-bg-card border border-border-default rounded-lg w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-modal"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-border-default flex items-start gap-4">
          <div className="w-14 h-14 rounded-md bg-bg-hover border border-border-default flex items-center justify-center text-text-secondary font-bold text-lg">
            {emp.shortName.split(' ').map(s => s[0]).join('').slice(0, 2)}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-text-primary">{emp.fullName}</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${gradeColors[emp.grade] || gradeColors['A']}`}>
                {emp.grade}
              </span>
              <WorkerStatusDot status={emp.workStatus} />
            </div>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-text-muted text-sm font-mono">{emp.empCode}</span>
              <span className="text-text-muted text-xs">·</span>
              <span className="text-text-muted text-sm">{emp.workerType.replace('_', ' ')}</span>
              <span className="text-text-muted text-xs">·</span>
              <span className="text-text-muted text-sm">Joined {emp.joinedAt}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {emp.specialist.map(s => (
                <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-bg-hover border border-border-default text-text-secondary font-medium">
                  {s}
                </span>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* KPI row */}
          <div className="grid grid-cols-5 divide-x divide-border-light border-b border-border-default">
            {[
              { label: 'Lots in Hand', value: activeLots.length.toString(), color: 'text-warning' },
              { label: 'Total Carats', value: `${emp.totalCts.toFixed(1)} ct`, color: 'text-text-primary' },
              { label: 'Period Salary', value: `₹${emp.periodSalary.toLocaleString()}`, color: 'text-success' },
              { label: 'Total Lots', value: empLots.length.toString(), color: 'text-primary' },
              { label: 'Yield %', value: `${emp.yieldPct.toFixed(1)}%`, color: emp.yieldPct >= YIELD_TARGET_PCT ? 'text-success' : 'text-warning' },
            ].map(kpi => (
              <div key={kpi.label} className="p-4 text-center">
                <p className={`text-xl font-semibold ${kpi.color}`}>{kpi.value}</p>
                <p className="text-text-muted text-[10px] uppercase tracking-wider mt-0.5">{kpi.label}</p>
              </div>
            ))}
          </div>

          <div className="p-6 grid grid-cols-3 gap-6">
            {/* Gauge */}
            <div className="flex flex-col items-center justify-center">
              <DiamondGauge yieldPct={emp.yieldPct} size={140} />
            </div>

            {/* Weight distribution */}
            <div className="col-span-2">
              <h4 className="text-text-muted text-xs uppercase tracking-wider font-medium mb-3">Weight distribution by bucket</h4>
              <div className="space-y-2">
                {weightBuckets.map((b) => (
                  <div key={b.label} className="flex items-center gap-2">
                    <span className="text-text-muted text-[10px] w-20 flex-shrink-0">{b.label}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-bg-hover">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${b.pct}%` }}
                      />
                    </div>
                    <span className="text-text-muted text-[10px] w-8 text-right">{b.count}</span>
                  </div>
                ))}
                {empLots.length === 0 && (
                  <p className="text-text-muted text-xs text-center py-2">No lot history</p>
                )}
              </div>
            </div>

            {/* Lots table */}
            <div className="col-span-3">
              <h4 className="text-text-muted text-xs uppercase tracking-wider font-medium mb-3">Lot history ({empLots.length} lots)</h4>
              <div className="rounded-md border border-border-default overflow-hidden">
                <table className="w-full">
                  <thead className="bg-bg-secondary">
                    <tr>
                      {['Lot Name', 'Shape', 'Issue Wt', 'Polish Wt', 'Days', 'Labour', 'Status'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {empLots.map(lot => (
                      <tr key={lot.id} className="hover:bg-bg-hover">
                        <td className="px-3 py-2 text-text-primary text-xs font-mono font-semibold">{lot.lotName}</td>
                        <td className="px-3 py-2 text-text-secondary text-xs">{lot.shape}</td>
                        <td className="px-3 py-2 text-text-primary text-xs font-mono">{lot.issueWeight.toFixed(2)}</td>
                        <td className="px-3 py-2 text-success text-xs font-mono">{lot.polishedWt?.toFixed(2) ?? '—'}</td>
                        <td className="px-3 py-2 text-text-muted text-xs font-mono">{lot.daysConsumed ?? '—'}</td>
                        <td className="px-3 py-2 text-text-primary text-xs font-mono">{lot.labourAmount ? `₹${lot.labourAmount.toLocaleString()}` : '—'}</td>
                        <td className="px-3 py-2"><StatusChip status={lot.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function Employees() {
  const { lots, employees } = useApp();
  const [search, setSearch] = useState('');
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'WORKING' | 'RESIGN'>('WORKING');

  const filtered = employees.filter(e => {
    const matchSearch = !search || e.fullName.toLowerCase().includes(search.toLowerCase()) || e.empCode.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'ALL' || e.workStatus === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-text-primary">Karigars</h2>
          <p className="text-text-secondary text-sm mt-1">Polisher profiles · {employees.filter(e => e.workStatus === 'WORKING').length} active</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-bg-card border border-border-default rounded-md pl-9 pr-3 py-2 text-text-primary text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 placeholder:text-text-muted w-48"
            />
          </div>
          <div className="flex items-center gap-1">
            {(['ALL', 'WORKING', 'RESIGN'] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${filterStatus === s ? 'bg-primary-light border-primary/30 text-primary' : 'border-border-default text-text-muted hover:border-text-muted'}`}
              >
                {s === 'ALL' ? 'All' : s === 'WORKING' ? 'Working' : 'Resigned'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {filtered.map((emp) => {
          const empLots = lots.filter(l => l.employeeId === emp.id);
          const activeLots = empLots.filter(l => l.status === 'ISSUED' || l.status === 'IN_PROGRESS');

          return (
            <div
              key={emp.id}
              onClick={() => setSelectedEmp(emp)}
              className="bg-bg-card border border-border-default rounded-md p-5 cursor-pointer hover:border-primary/30 hover:bg-bg-hover transition-colors duration-150 group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md bg-bg-hover border border-border-default flex items-center justify-center text-text-secondary font-bold text-sm">
                    {emp.shortName.split(' ').map(s => s[0]).join('').slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-text-primary text-sm font-semibold">{emp.fullName}</p>
                    <p className="text-text-muted text-[10px] font-mono mt-0.5">{emp.empCode}</p>
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${gradeColors[emp.grade] || gradeColors['A']}`}>
                  {emp.grade}
                </span>
              </div>

              <div className="flex items-center justify-between mb-3">
                <WorkerStatusDot status={emp.workStatus} />
                {activeLots.length > 0 && (
                  <span className="text-[10px] text-warning bg-warning-light border border-warning/20 px-2 py-0.5 rounded-full">
                    {activeLots.length} in hand
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-text-primary text-sm font-bold font-mono">
                    <Gem size={12} />
                    {emp.totalCts.toFixed(0)}
                  </div>
                  <p className="text-text-muted text-[9px] mt-0.5">carats</p>
                </div>
                <div className="text-center border-x border-border-light">
                  <p className={`text-sm font-bold font-mono ${emp.yieldPct >= YIELD_TARGET_PCT ? 'text-success' : emp.yieldPct >= 60 ? 'text-warning' : 'text-danger'}`}>
                    {emp.yieldPct.toFixed(1)}%
                  </p>
                  <p className="text-text-muted text-[9px] mt-0.5">yield</p>
                </div>
                <div className="text-center">
                  <p className="text-success text-sm font-bold font-mono">₹{(emp.periodSalary / 1000).toFixed(0)}k</p>
                  <p className="text-text-muted text-[9px] mt-0.5">salary</p>
                </div>
              </div>

              {/* Yield bar */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-text-muted text-[9px]">Yield vs {YIELD_TARGET_PCT}% target</span>
                </div>
                <div className="h-1 rounded-full bg-bg-hover overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      background: emp.yieldPct >= YIELD_TARGET_PCT ? '#16A34A' : emp.yieldPct >= 60 ? '#CA8A04' : '#DC2626',
                      width: `${Math.min(emp.yieldPct, 100)}%`
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mt-3">
                {emp.specialist.map(s => (
                  <span key={s} className="text-[9px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted">{s}</span>
                ))}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full flex flex-col items-center gap-3 py-20 text-text-muted">
            <span className="text-5xl">◇</span>
            <p className="text-sm font-medium">No karigars match your search</p>
            <p className="text-xs">Try a different name, code, or status filter</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedEmp && (
          <EmployeeModal emp={selectedEmp} onClose={() => setSelectedEmp(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
