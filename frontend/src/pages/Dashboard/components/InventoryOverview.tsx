import { memo } from 'react';
import { PackageSearch, Package, Layers, CheckCircle2, XCircle, Lock, ArrowRightLeft, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { InventoryStat } from '../dashboard.types';
import { SectionCard } from './SectionCard';

function InvCard({ icon: Icon, label, value, cls }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: string | number; cls: string }) {
  return (
    <div className="border border-border-default rounded-lg p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${cls}`}>
          <Icon size={14} />
        </span>
        <span className="text-text-muted text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-semibold text-text-primary tabular-nums">{value}<span className="text-text-muted text-xs font-medium ml-1">ct</span></p>
    </div>
  );
}

function InventoryOverviewBase({ inv }: { inv: InventoryStat }) {
  return (
    <SectionCard title="Inventory Overview" subtitle="carats across the production flow" icon={<PackageSearch size={15} />}>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <InvCard icon={Package} label="Raw" value={inv.raw} cls="bg-bg-hover text-text-secondary" />
        <InvCard icon={Layers} label="WIP" value={inv.wip} cls="bg-warning-light text-warning" />
        <InvCard icon={CheckCircle2} label="Finished" value={inv.finished} cls="bg-success-light text-success" />
        <InvCard icon={XCircle} label="Rejected" value={inv.rejected} cls="bg-danger-light text-danger" />
        <InvCard icon={Lock} label="Reserved" value={inv.reserved} cls="bg-primary-light text-primary" />
        <InvCard icon={PackageSearch} label="Available" value={inv.available} cls="bg-info-light text-info" />
      </div>

      <div className="mt-4 grid grid-cols-12 gap-4">
        {/* Material consumption */}
        <div className="col-span-12 md:col-span-6">
          <h4 className="text-text-secondary text-[11px] font-semibold uppercase tracking-wider mb-2">Material Consumption · issued ct/day</h4>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={inv.consumption} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'var(--color-text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: 'var(--color-text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'var(--color-bg-hover)', opacity: 0.4 }} contentStyle={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="value" name="Issued" fill="#2563EB" radius={[3, 3, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Inventory aging */}
        <div className="col-span-12 md:col-span-6">
          <h4 className="text-text-secondary text-[11px] font-semibold uppercase tracking-wider mb-2">WIP Aging · active lots by age</h4>
          {inv.aging.every((a) => a.value === 0) ? (
            <p className="text-text-muted text-xs py-10 text-center">No active lots</p>
          ) : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={inv.aging} cx="50%" cy="50%" innerRadius={42} outerRadius={62} paddingAngle={3} dataKey="value" strokeWidth={0}>
                    {inv.aging.map((a, i) => <Cell key={i} fill={a.color} />)}
                  </Pie>
                  <Tooltip formatter={(val) => [`${val} lots`, '']} contentStyle={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-lg font-semibold text-text-primary tabular-nums">{inv.aging.reduce((s, a) => s + a.value, 0)}</span>
                <span className="text-[9px] uppercase tracking-wider text-text-muted font-medium">Active</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-text-muted">
        <span className="flex items-center gap-1.5"><ArrowRightLeft size={12} /> Stock turnover <span className="font-mono text-text-secondary tabular-nums">{inv.turnover}%</span></span>
        <span className="flex items-center gap-1.5"><BarChart3 size={12} /> {inv.flow.length} flow stages</span>
      </div>
    </SectionCard>
  );
}

export const InventoryOverview = memo(InventoryOverviewBase);
