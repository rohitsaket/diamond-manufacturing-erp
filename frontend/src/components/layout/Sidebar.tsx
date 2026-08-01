import { LayoutDashboard, Layers, BookOpen, Users, DollarSign, Shield, Database, ChevronRight, Bell, RefreshCw, LogOut } from 'lucide-react';
import { Lot, LOT_SLA_DAYS, LEAKAGE_FLAG_THRESHOLD_PCT } from '../../data/mockData';
import { useApp } from '../../contexts/AppContext';
import { useAuth } from '../../contexts/AuthContext';

interface Exception {
  type: 'leakage' | 'overdue' | 'rework';
  title: string;
  detail: string;
}

function computeExceptions(lots: Lot[]): Exception[] {
  const result: Exception[] = [];
  const now = Date.now();

  for (const lot of lots) {
    if (lot.status === 'VERIFIED' || lot.status === 'RECEIVED') {
      if (lot.weightDiff && lot.issueWeight > 0) {
        const lossPct = (lot.weightDiff / lot.issueWeight) * 100;
        if (lossPct > LEAKAGE_FLAG_THRESHOLD_PCT) {
          result.push({
            type: 'leakage',
            title: `Leakage Flag — ${lossPct.toFixed(1)}%`,
            detail: `${lot.lotName} — ${lot.employeeName.split(' ')[0]}`,
          });
        }
      }
    }
    if (lot.status === 'ISSUED' || lot.status === 'IN_PROGRESS') {
      const days = Math.floor((now - new Date(lot.issueDate).getTime()) / 86400000);
      if (days > LOT_SLA_DAYS) {
        result.push({
          type: 'overdue',
          title: `Overdue ${days}d`,
          detail: `${lot.lotName} — ${lot.employeeName.split(' ')[0]}`,
        });
      }
    }
    if (lot.status === 'REWORK') {
      result.push({
        type: 'rework',
        title: 'Rework Pending',
        detail: `${lot.lotName} — ${lot.employeeName.split(' ')[0]}`,
      });
    }
  }

  return result.slice(0, 5);
}

const EXCEPTION_STYLE: Record<Exception['type'], { bg: string; border: string; dot: string; title: string }> = {
  leakage: { bg: 'bg-danger-light', border: 'border-danger/20', dot: 'bg-danger', title: 'text-danger' },
  overdue: { bg: 'bg-warning-light', border: 'border-warning/20', dot: 'bg-warning', title: 'text-warning' },
  rework: { bg: 'bg-warning-light', border: 'border-warning/20', dot: 'bg-warning', title: 'text-warning' },
};

interface SidebarProps {
  activePage: string;
  setActivePage: (page: string) => void;
  floorBadge: string | null;
  payrollBadge: string | null;
}

export function Sidebar({ activePage, setActivePage, floorBadge, payrollBadge }: SidebarProps) {
  const { lots, refresh } = useApp();
  const { logout } = useAuth();
  const exceptions = computeExceptions(lots);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, badge: null },
    { id: 'floor', label: 'Manufacturing', icon: Layers, badge: floorBadge },
    { id: 'ledger', label: 'Master Ledger', icon: BookOpen, badge: null },
    { id: 'employees', label: 'Karigars', icon: Users, badge: null },
    { id: 'payroll', label: 'Salary & Payout', icon: DollarSign, badge: payrollBadge },
    { id: 'rates', label: 'Rate Card', icon: Shield, badge: null },
    { id: 'masterdata', label: 'Master Data', icon: Database, badge: null },
  ];

  return (
    <aside className="w-64 bg-bg-sidebar border-r border-border-default flex flex-col flex-shrink-0 sticky top-0 h-screen">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border-default">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-text-primary flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M6.5 2h11l4.5 6L12 22 2 8l4.5-6z" opacity={0.95}/>
            </svg>
          </div>
          <div>
            <h1 className="text-text-primary font-semibold text-sm">Harene</h1>
            <p className="text-text-muted text-[10px] uppercase tracking-wider font-medium">Diamond ERP</p>
          </div>
        </div>
      </div>

      {/* Role badge */}
      <div className="px-5 py-3 border-b border-border-default">
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-white border border-border-default">
          <div className="w-7 h-7 rounded-full bg-bg-hover flex items-center justify-center text-text-secondary text-xs font-bold">M</div>
          <div className="min-w-0">
            <p className="text-text-primary text-xs font-medium truncate">Manufacturing</p>
            <p className="text-text-muted text-[10px] truncate">Hastack Division</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <p className="px-3 mb-2 text-[10px] uppercase tracking-wider text-text-muted font-medium">Navigation</p>
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <li key={item.id}>
                <button
                  onClick={() => setActivePage(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors duration-150 group ${
                    isActive
                      ? 'bg-bg-selected text-primary'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                  }`}
                >
                  <Icon size={18} className={isActive ? 'text-primary' : 'text-text-muted group-hover:text-text-secondary'} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.badge && (
                    <span className="px-1.5 py-0.5 rounded-full bg-primary text-white text-[10px] font-semibold min-w-[18px] text-center">
                      {item.badge}
                    </span>
                  )}
                  {isActive && <ChevronRight size={14} className="text-text-muted" />}
                </button>
              </li>
            );
          })}
        </ul>

        {/* Exception feed */}
        <div className="mt-6 px-3">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-text-muted font-medium">
            Live Exceptions {exceptions.length > 0 && <span className="text-danger">({exceptions.length})</span>}
          </p>
          <div className="space-y-2">
            {exceptions.length === 0 && (
              <p className="text-text-muted text-[10px] px-1">No active exceptions</p>
            )}
            {exceptions.map((ex, i) => {
              const s = EXCEPTION_STYLE[ex.type];
              return (
                <div key={i} className={`flex items-start gap-2 p-2 rounded-md ${s.bg} border ${s.border}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${s.dot} mt-1.5 flex-shrink-0`} />
                  <div>
                    <p className={`${s.title} text-[10px] font-medium`}>{ex.title}</p>
                    <p className="text-text-muted text-[9px]">{ex.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Bottom actions */}
      <div className="px-3 pb-4 border-t border-border-default pt-3 space-y-0.5">
        <button
          onClick={() => window.alert('Notifications panel coming soon.')}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <Bell size={16} /> Notifications
        </button>
        <button
          onClick={() => { void refresh(); }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <RefreshCw size={16} /> Refresh Data
        </button>
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-text-muted hover:text-danger hover:bg-danger-light transition-colors"
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </aside>
  );
}
