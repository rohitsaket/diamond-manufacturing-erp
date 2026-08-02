import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Layers, BookOpen, Users, DollarSign, Shield, Database,
  ChevronRight, ChevronDown, Bell, RefreshCw, LogOut,
  CalendarCheck, Briefcase, UserPlus, PieChart, IdCard, FolderLock, Network,
} from 'lucide-react';
import { Lot, LOT_SLA_DAYS, LEAKAGE_FLAG_THRESHOLD_PCT } from '../../data/mockData';
import { useApp } from '../../contexts/AppContext';
import { useAuth, isStaffRole } from '../../contexts/AuthContext';
import { leaveApi, notificationApi } from '../../api/hrms';

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
  dashboardSection?: string;
  setDashboardSection?: (section: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge: string | null;
  /** Sub-navigation, rendered when the parent item is expanded. */
  children?: { id: string; label: string }[];
}

/** Sections of the HRMS dashboard, mirrored from HRDashboard.DASHBOARD_SECTIONS. */
const DASHBOARD_SECTION_ITEMS = [
  { id: 'hr', label: 'HR Dashboard' },
  { id: 'employee', label: 'Employee Dashboard' },
  { id: 'manager', label: 'Manager Dashboard' },
  { id: 'executive', label: 'Executive Dashboard' },
  { id: 'widgets', label: 'Widgets' },
  { id: 'kpis', label: 'KPI Cards' },
  { id: 'actions', label: 'Quick Actions' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'activity', label: 'Activity Feed' },
];

export function Sidebar({
  activePage,
  setActivePage,
  floorBadge,
  payrollBadge,
  dashboardSection,
  setDashboardSection,
}: SidebarProps) {
  const { lots, refresh } = useApp();
  const { logout, user } = useAuth();
  const exceptions = computeExceptions(lots);
  const isStaff = isStaffRole(user?.role);

  // Counts for the HRMS badges. Fetched once on mount; a failure just leaves
  // the badges off rather than breaking navigation.
  const [pendingLeave, setPendingLeave] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  // Which parent nav items have their sub-navigation open. Defaults to open
  // for whichever item is currently active.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    if (isStaff) {
      leaveApi
        .requests({ status: 'PENDING' })
        .then((rows) => { if (!cancelled) setPendingLeave(rows.length); })
        .catch(() => undefined);
    }
    notificationApi
      .unreadCount()
      .then((r) => { if (!cancelled) setUnreadNotifications(Number(r?.count ?? 0)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [isStaff]);

  // Self-service worker logins have no access to company-wide screens, so the
  // staff navigation is hidden for them rather than shown and failing with 403s.
  const navGroups: { title: string; items: NavItem[] }[] = !isStaff ? [] : [
    {
      title: 'Manufacturing',
      items: [
        { id: 'dashboard', label: 'MFG Dashboard', icon: LayoutDashboard, badge: null },
        { id: 'floor', label: 'Manufacturing', icon: Layers, badge: floorBadge },
        { id: 'ledger', label: 'Master Ledger', icon: BookOpen, badge: null },
        { id: 'employees', label: 'Karigars', icon: Users, badge: null },
        { id: 'payroll', label: 'Salary & Payout', icon: DollarSign, badge: payrollBadge },
        { id: 'rates', label: 'Rate Card', icon: Shield, badge: null },
        { id: 'masterdata', label: 'Master Data', icon: Database, badge: null },
      ],
    },
    {
      title: 'HRMS',
      items: [
        { id: 'hrdashboard', label: 'Dashboard', icon: PieChart, badge: null, children: DASHBOARD_SECTION_ITEMS },
        { id: 'organization', label: 'Organization', icon: Network, badge: null },
        { id: 'hrprofile', label: 'Employee Profile', icon: IdCard, badge: null },
        { id: 'documents', label: 'Documents', icon: FolderLock, badge: null },
        { id: 'attendance', label: 'Attendance', icon: CalendarCheck, badge: null },
        { id: 'hr', label: 'Leave & Advances', icon: Briefcase, badge: pendingLeave > 0 ? String(pendingLeave) : null },
        { id: 'recruitment', label: 'Recruitment', icon: UserPlus, badge: null },
      ],
    },
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
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-bg-card border border-border-default">
          <div className="w-7 h-7 rounded-full bg-bg-hover flex items-center justify-center text-text-secondary text-xs font-bold">M</div>
          <div className="min-w-0">
            <p className="text-text-primary text-xs font-medium truncate">Manufacturing</p>
            <p className="text-text-muted text-[10px] truncate">Hastack Division</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {navGroups.map((group, groupIndex) => (
          <div key={group.title} className={groupIndex > 0 ? 'mt-5' : undefined}>
            <p className="px-3 mb-2 text-[10px] uppercase tracking-wider text-text-muted font-medium">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activePage === item.id;
                const hasChildren = !!item.children?.length;
                const isExpanded = hasChildren && (expanded[item.id] ?? isActive);
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => {
                        setActivePage(item.id);
                        if (hasChildren) {
                          setExpanded((prev) => ({ ...prev, [item.id]: !(prev[item.id] ?? isActive) }));
                        }
                      }}
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
                      {hasChildren ? (
                        <ChevronDown
                          size={14}
                          className={`text-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      ) : (
                        isActive && <ChevronRight size={14} className="text-text-muted" />
                      )}
                    </button>

                    {hasChildren && isExpanded && (
                      <ul className="mt-0.5 mb-1 ml-[26px] pl-3 border-l border-border-default space-y-0.5">
                        {item.children!.map((child) => {
                          const isChildActive = isActive && dashboardSection === child.id;
                          return (
                            <li key={child.id}>
                              <button
                                onClick={() => {
                                  setActivePage(item.id);
                                  setDashboardSection?.(child.id);
                                }}
                                className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                                  isChildActive
                                    ? 'bg-bg-selected text-primary font-medium'
                                    : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
                                }`}
                              >
                                {child.label}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

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
          onClick={() => {
            setActivePage('hrdashboard');
            setDashboardSection?.('notifications');
          }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <Bell size={16} />
          <span className="flex-1 text-left">Notifications</span>
          {unreadNotifications > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-danger text-white text-[10px] font-semibold min-w-[18px] text-center">
              {unreadNotifications}
            </span>
          )}
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
