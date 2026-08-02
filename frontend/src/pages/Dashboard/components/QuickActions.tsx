import { memo } from 'react';
import { PlusCircle, PackagePlus, Play, ShieldCheck, PackageCheck, FileText, Cpu, ClipboardList } from 'lucide-react';
import { SectionCard } from './SectionCard';

const ACTIONS: { id: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; page: string; desc: string; tone: string }[] = [
  { id: 'create', label: 'Create Production', icon: PlusCircle, page: 'floor', desc: 'Issue a new lot', tone: 'bg-primary text-white hover:bg-primary-hover' },
  { id: 'issue', label: 'Issue Material', icon: PackagePlus, page: 'floor', desc: 'Hand out stock', tone: 'bg-success text-white hover:brightness-95' },
  { id: 'start', label: 'Start Job', icon: Play, page: 'floor', desc: 'Begin operation', tone: 'bg-warning text-white hover:brightness-95' },
  { id: 'qc', label: 'Quality Check', icon: ShieldCheck, page: 'floor', desc: 'Verify a lot', tone: 'bg-bg-card border border-border-default text-text-secondary hover:bg-bg-hover' },
  { id: 'dispatch', label: 'Dispatch', icon: PackageCheck, page: 'ledger', desc: 'Send finished goods', tone: 'bg-bg-card border border-border-default text-text-secondary hover:bg-bg-hover' },
  { id: 'report', label: 'Generate Report', icon: FileText, page: 'ledger', desc: 'Export ledger CSV', tone: 'bg-bg-card border border-border-default text-text-secondary hover:bg-bg-hover' },
  { id: 'machines', label: 'Machine Status', icon: Cpu, page: 'dashboard', desc: 'View lines', tone: 'bg-bg-card border border-border-default text-text-secondary hover:bg-bg-hover' },
  { id: 'plan', label: 'Production Planning', icon: ClipboardList, page: 'floor', desc: 'Plan pipeline', tone: 'bg-bg-card border border-border-default text-text-secondary hover:bg-bg-hover' },
];

function QuickActionsBase({ onNavigate }: { onNavigate: (p: string) => void }) {
  return (
    <SectionCard title="Quick Actions" subtitle="jump straight to a task" noPadding>
      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            onClick={() => onNavigate(a.page)}
            className={`flex flex-col items-start gap-2 px-3 py-3 rounded-lg text-left transition-colors ${a.tone}`}
          >
            <a.icon size={17} />
            <span>
              <span className="block text-xs font-semibold">{a.label}</span>
              <span className={`block text-[10px] ${a.tone.includes('bg-primary') || a.tone.includes('bg-success') || a.tone.includes('bg-warning') ? 'text-white/70' : 'text-text-muted'}`}>{a.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </SectionCard>
  );
}

export const QuickActions = memo(QuickActionsBase);
