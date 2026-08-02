import { memo } from 'react';
import { ShieldCheck, XCircle, RefreshCw, FileWarning, ClipboardCheck, BadgeCheck, BarChart3 } from 'lucide-react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';import { QualityStat } from '../dashboard.types';
import { SectionCard } from './SectionCard';
import { Sparkline } from './Sparkline';

function QCard({ icon: Icon, label, value, suffix = '', cls }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: number | string; suffix?: string; cls: string }) {
  return (
    <div className="border border-border-default rounded-lg p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${cls}`}>
          <Icon size={14} />
        </span>
        <span className="text-text-muted text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-semibold text-text-primary tabular-nums">{value}{suffix}</p>
    </div>
  );
}

function QualityOverviewBase({ q }: { q: QualityStat }) {
  return (
    <SectionCard title="Quality Dashboard" subtitle="QC pass / reject / rework analysis" icon={<ShieldCheck size={15} />}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <QCard icon={BadgeCheck} label="Pass %" value={q.passPct} suffix="%" cls="bg-success-light text-success" />
        <QCard icon={XCircle} label="Reject %" value={q.rejectPct} suffix="%" cls="bg-danger-light text-danger" />
        <QCard icon={RefreshCw} label="Rework %" value={q.reworkPct} suffix="%" cls="bg-warning-light text-warning" />
        <QCard icon={FileWarning} label="Open NCR" value={q.openNcr} cls="bg-danger-light text-danger" />
        <QCard icon={ClipboardCheck} label="Inspection Pending" value={q.inspectionPending} cls="bg-primary-light text-primary" />
        <QCard icon={BadgeCheck} label="Today's QC" value={q.todaysQc} cls="bg-bg-hover text-text-secondary" />
      </div>

      <div className="mt-4 grid grid-cols-12 gap-4">
        {/* Defect analysis donut */}
        <div className="col-span-12 md:col-span-4">
          <h4 className="text-text-secondary text-[11px] font-semibold uppercase tracking-wider mb-2">Defect Analysis</h4>
          {q.defectDist.length === 0 ? (
            <p className="text-text-muted text-xs py-8 text-center">No defects recorded</p>
          ) : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={q.defectDist} cx="50%" cy="50%" innerRadius={42} outerRadius={66} paddingAngle={3} dataKey="value" strokeWidth={0}>
                    {q.defectDist.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={(val) => [`${val} lots`, '']} contentStyle={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-lg font-semibold text-text-primary tabular-nums">{q.defectDist.reduce((s, d) => s + d.value, 0)}</span>
                <span className="text-[9px] uppercase tracking-wider text-text-muted font-medium">Defects</span>
              </div>
            </div>
          )}
        </div>

        {/* Root cause by lab */}
        <div className="col-span-12 md:col-span-4">
          <h4 className="text-text-secondary text-[11px] font-semibold uppercase tracking-wider mb-2">Root Cause · by Lab</h4>
          {q.rootCause.length === 0 ? (
            <p className="text-text-muted text-xs py-8 text-center">No rejections by lab</p>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={q.rootCause} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={36} tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'var(--color-bg-hover)', opacity: 0.4 }} contentStyle={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={14}>
                  {q.rootCause.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Inspection trend */}
        <div className="col-span-12 md:col-span-4">
          <h4 className="text-text-secondary text-[11px] font-semibold uppercase tracking-wider mb-2">Inspection Trend · weekly lots</h4>
          <div className="h-[150px] flex items-end">
            <div className="w-full">
              <Sparkline data={q.inspectionTrend} color="#2563EB" height={70} />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <BarChart3 size={12} className="text-text-muted" />
            <span className="text-text-muted text-[10px]">{q.inspectionTrend.reduce((s, p) => s + p.value, 0)} lots inspected · last 12 weeks</span>
          </div>
        </div>
      </div>

      {/* Department defects */}
      {q.deptDefects.length > 0 && (
        <div className="mt-4">
          <h4 className="text-text-secondary text-[11px] font-semibold uppercase tracking-wider mb-2">Defects by Department</h4>
          <div className="flex flex-wrap gap-2">
            {q.deptDefects.map((d) => (
              <span key={d.name} className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-bg-hover border border-border-default text-[11px] text-text-secondary">
                {d.name}
                <span className="font-mono font-semibold text-danger tabular-nums">{d.value}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

export const QualityOverview = memo(QualityOverviewBase);
