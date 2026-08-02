import { memo, useMemo } from 'react';
import { Trophy, Users, Star, Medal } from 'lucide-react';
import { WorkforceRow } from '../dashboard.types';
import { SectionCard } from './SectionCard';

const MEDAL_CLS = [
  'bg-amber-100 text-amber-600 border-amber-300',
  'bg-slate-200 text-slate-600 border-slate-300',
  'bg-orange-100 text-orange-600 border-orange-300',
];

function WorkforcePerformanceBase({ rows }: { rows: WorkforceRow[] }) {
  const maxScore = useMemo(() => Math.max(...rows.map((r) => r.score), 1), [rows]);
  return (
    <SectionCard
      title="Workforce Performance"
      subtitle="Karigars ranked by performance score"
      icon={<Trophy size={15} />}
      noPadding
      right={
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-text-muted">
          <Users size={12} /> {rows.length} workers
        </span>
      }
    >
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-left min-w-[760px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-text-muted">
              <th className="px-4 py-2.5 font-semibold">#</th>
              <th className="px-3 py-2.5 font-semibold">Employee</th>
              <th className="px-3 py-2.5 font-semibold">Dept</th>
              <th className="px-3 py-2.5 font-semibold">Operation</th>
              <th className="px-3 py-2.5 font-semibold text-right">Done</th>
              <th className="px-3 py-2.5 font-semibold text-right">Pending</th>
              <th className="px-3 py-2.5 font-semibold text-right">Efficiency</th>
              <th className="px-3 py-2.5 font-semibold text-right">Attendance</th>
              <th className="px-3 py-2.5 font-semibold">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w, i) => (
              <tr key={w.id} className="border-t border-border-light hover:bg-bg-hover transition-colors">
                <td className="px-4 py-2.5">
                  {i < 3 ? (
                    <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold ${MEDAL_CLS[i]}`}>
                      {i < 3 ? <Medal size={12} /> : i + 1}
                    </span>
                  ) : (
                    <span className="text-text-muted text-xs font-mono tabular-nums">{i + 1}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-7 h-7 rounded-full bg-bg-hover border border-border-default flex items-center justify-center text-text-secondary text-[9px] font-bold flex-shrink-0">
                      {w.shortName.split(' ').map((s) => s[0]).join('').slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-text-primary text-xs font-medium truncate">{w.name}</p>
                      <p className="text-text-muted text-[10px] font-mono">{w.grade}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-text-secondary text-xs">{w.department}</td>
                <td className="px-3 py-2.5 text-text-secondary text-xs">{w.operation}</td>
                <td className="px-3 py-2.5 text-success text-xs font-semibold tabular-nums text-right">{w.completed}</td>
                <td className="px-3 py-2.5 text-warning text-xs font-semibold tabular-nums text-right">{w.pending}</td>
                <td className="px-3 py-2.5 text-right">
                  <span className={`text-xs font-semibold tabular-nums ${w.efficiency >= 68 ? 'text-success' : w.efficiency >= 60 ? 'text-warning' : 'text-danger'}`}>{w.efficiency}%</span>
                </td>
                <td className="px-3 py-2.5 text-text-secondary text-xs font-mono tabular-nums text-right">{w.attendance}%</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-bg-hover overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${(w.score / maxScore) * 100}%` }} />
                    </div>
                    <span className="text-text-primary text-xs font-semibold tabular-nums w-7">{w.score}</span>
                    {w.score >= 90 && <Star size={12} className="text-warning" fill="currentColor" />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

export const WorkforcePerformance = memo(WorkforcePerformanceBase);
