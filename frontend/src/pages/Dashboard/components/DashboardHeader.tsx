import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Calendar, Factory, Building2, Clock3, RefreshCw, Download, Bell,
  HelpCircle, Sun, Moon, ChevronDown, X, LogOut, ArrowRight,
} from 'lucide-react';
import { Lot } from '../../../data/mockData';
import { useAuth } from '../../../contexts/AuthContext';
import { AlertItem, GlobalFilters, ShiftKey } from '../dashboard.types';

interface DashboardHeaderProps {
  filters: GlobalFilters;
  setFilters: React.Dispatch<React.SetStateAction<GlobalFilters>>;
  onRefresh: () => void;
  onNavigate: (page: string) => void;
  onExport: () => void;
  alerts: AlertItem[];
  searchResults: Lot[];
  departments: string[];
  dark: boolean;
  onToggleDark: () => void;
}

type Dropdown = 'search' | 'notifications' | 'date' | 'plant' | 'dept' | 'shift' | 'profile' | 'help' | null;

const PRIORITY_DOT: Record<AlertItem['priority'], string> = {
  critical: 'bg-danger',
  high: 'bg-warning',
  medium: 'bg-primary',
  low: 'bg-text-muted',
};

const PRIORITY_TEXT: Record<AlertItem['priority'], string> = {
  critical: 'text-danger',
  high: 'text-warning',
  medium: 'text-primary',
  low: 'text-text-secondary',
};

function DashboardHeaderBase(props: DashboardHeaderProps) {
  const { filters, setFilters, onRefresh, onNavigate, onExport, alerts, searchResults, departments, dark, onToggleDark } = props;
  const { user, logout } = useAuth();
  const [open, setOpen] = useState<Dropdown>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState(filters.search);
  const searchRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => { setOpen(null); setSearchOpen(false); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); setSearchText(filters.search); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, filters.search]);

  const initials = useMemo(
    () => (user?.name ?? 'U').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase(),
    [user],
  );

  const setDateRange = (days: number | null) => {
    if (days === null) {
      setFilters((f) => ({ ...f, dateFrom: null, dateTo: null }));
    } else {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - days);
      setFilters((f) => ({ ...f, dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) }));
    }
    setOpen(null);
  };

  const dateLabel = useMemo(() => {
    if (!filters.dateFrom || !filters.dateTo) return 'All time';
    return `${filters.dateFrom.slice(5)} → ${filters.dateTo.slice(5)}`;
  }, [filters.dateFrom, filters.dateTo]);

  const goSearch = () => {
    close();
    setSearchText('');
    setFilters((f) => ({ ...f, search: '' }));
    onNavigate('ledger');
  };

  const iconBtn = 'w-9 h-9 rounded-md border border-border-default bg-bg-card text-text-secondary hover:text-text-primary hover:bg-bg-hover hover:border-border-default transition-colors flex items-center justify-center';
  const selectBtn = 'h-9 px-3 rounded-md border border-border-default bg-bg-card text-text-secondary hover:text-text-primary hover:border-border-default transition-colors flex items-center gap-2 text-xs font-medium min-w-0';

  return (
    <div className="sticky top-[53px] z-30 -mx-6 px-6 py-3 bg-bg-secondary/95 backdrop-blur-sm border-b border-border-light">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Breadcrumb + title */}
        <div className="flex items-center gap-2 min-w-0 mr-auto">
          <button
            onClick={() => onNavigate('dashboard')}
            aria-label="Home"
            className="text-text-muted hover:text-primary transition-colors"
          >
            <Factory size={15} />
          </button>
          <ChevronDown size={12} className="text-text-muted rotate-[-90deg]" aria-hidden="true" />
          <span className="text-text-muted text-xs">Home</span>
          <ChevronDown size={12} className="text-text-muted rotate-[-90deg]" aria-hidden="true" />
          <h2 className="text-text-primary text-sm font-semibold whitespace-nowrap">MFG Dashboard</h2>
        </div>

        {/* Global search */}
        <div ref={searchRef} className="relative flex-1 min-w-[200px] max-w-sm">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={searchText}
              placeholder="Search lot, packet, worker…"
              aria-label="Global search"
              onChange={(e) => { setSearchText(e.target.value); setFilters((f) => ({ ...f, search: e.target.value })); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              className="w-full h-9 pl-9 pr-3 rounded-md border border-border-default bg-bg-card text-text-primary text-xs placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
            />
          </div>
          {searchOpen && (
            <div className="absolute right-0 left-0 mt-1.5 top-full bg-bg-card border border-border-default rounded-md shadow-dropdown z-40 overflow-hidden">
              {searchText.trim() === '' ? (
                <p className="px-3 py-3 text-text-muted text-xs">Type to search across lots, packets and workers.</p>
              ) : searchResults.length === 0 ? (
                <p className="px-3 py-3 text-text-muted text-xs">No matches found.</p>
              ) : (
                <ul role="listbox" className="max-h-80 overflow-y-auto">
                  {searchResults.map((lot) => (
                    <li key={lot.id}>
                      <button
                        role="option"
                        onClick={goSearch}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-bg-hover text-left transition-colors"
                      >
                        <span className="w-7 h-7 rounded-md bg-bg-hover border border-border-default flex items-center justify-center text-[9px] font-bold text-text-secondary flex-shrink-0">
                          {lot.lotId.slice(-4)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-text-primary text-xs font-medium truncate">{lot.lotName}</span>
                          <span className="block text-text-muted text-[10px] truncate">
                            {lot.employeeName} · {lot.shape} · {lot.issueWeight} ct
                          </span>
                        </span>
                        <ArrowRight size={13} className="text-text-muted flex-shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Date range */}
        <div className="relative">
          <button onClick={() => setOpen(open === 'date' ? null : 'date')} aria-haspopup="true" aria-expanded={open === 'date'} aria-label="Date range" className={selectBtn}>
            <Calendar size={14} className="text-text-muted flex-shrink-0" />
            <span className="truncate hidden sm:inline">{dateLabel}</span>
          </button>
          {open === 'date' && (
            <>
              <div className="fixed inset-0 z-30" onClick={close} aria-hidden="true" />
              <div className="absolute right-0 mt-1.5 top-full w-44 bg-bg-card border border-border-default rounded-md shadow-dropdown z-40 py-1">
                {[
                  { label: 'All time', days: null },
                  { label: 'Last 7 days', days: 7 },
                  { label: 'Last 30 days', days: 30 },
                  { label: 'Last 90 days', days: 90 },
                ].map((o) => (
                  <button
                    key={o.label}
                    onClick={() => setDateRange(o.days)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-bg-hover transition-colors ${filters.dateFrom === null && o.days === null ? 'text-primary font-medium' : 'text-text-secondary'}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Plant */}
        <div className="relative hidden xl:block">
          <button onClick={() => setOpen(open === 'plant' ? null : 'plant')} aria-haspopup="true" aria-expanded={open === 'plant'} aria-label="Plant selector" className={selectBtn}>
            <Building2 size={14} className="text-text-muted flex-shrink-0" />
            <span className="truncate">Harene · Hastack</span>
          </button>
          {open === 'plant' && (
            <>
              <div className="fixed inset-0 z-30" onClick={close} aria-hidden="true" />
              <div className="absolute right-0 mt-1.5 top-full w-48 bg-bg-card border border-border-default rounded-md shadow-dropdown z-40 py-1">
                <button onClick={close} className="w-full text-left px-3 py-2 text-xs text-primary font-medium hover:bg-bg-hover">Harene · Hastack</button>
              </div>
            </>
          )}
        </div>

        {/* Department */}
        <div className="relative hidden md:block">
          <button onClick={() => setOpen(open === 'dept' ? null : 'dept')} aria-haspopup="true" aria-expanded={open === 'dept'} aria-label="Department selector" className={selectBtn}>
            <Factory size={14} className="text-text-muted flex-shrink-0" />
            <span className="truncate max-w-[110px]">{filters.department === 'ALL' ? 'All Depts' : filters.department}</span>
          </button>
          {open === 'dept' && (
            <>
              <div className="fixed inset-0 z-30" onClick={close} aria-hidden="true" />
              <div className="absolute right-0 mt-1.5 top-full w-48 bg-bg-card border border-border-default rounded-md shadow-dropdown z-40 py-1 max-h-72 overflow-y-auto">
                <button
                  onClick={() => { setFilters((f) => ({ ...f, department: 'ALL' })); setOpen(null); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-bg-hover text-text-secondary"
                >
                  All Departments
                </button>
                {departments.map((d) => (
                  <button
                    key={d}
                    onClick={() => { setFilters((f) => ({ ...f, department: d })); setOpen(null); }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-bg-hover text-text-secondary"
                  >
                    {d}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Shift */}
        <div className="relative hidden lg:block">
          <button onClick={() => setOpen(open === 'shift' ? null : 'shift')} aria-haspopup="true" aria-expanded={open === 'shift'} aria-label="Shift selector" className={selectBtn}>
            <Clock3 size={14} className="text-text-muted flex-shrink-0" />
            <span className="truncate">{filters.shift === 'ALL' ? 'All Shifts' : `${filters.shift} Shift`}</span>
          </button>
          {open === 'shift' && (
            <>
              <div className="fixed inset-0 z-30" onClick={close} aria-hidden="true" />
              <div className="absolute right-0 mt-1.5 top-full w-44 bg-bg-card border border-border-default rounded-md shadow-dropdown z-40 py-1">
                {(['ALL', 'Morning', 'Evening', 'Night'] as (ShiftKey | 'ALL')[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => { setFilters((f) => ({ ...f, shift: s as ShiftKey })); setOpen(null); }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-bg-hover text-text-secondary"
                  >
                    {s === 'ALL' ? 'All Shifts' : `${s} Shift`}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Refresh */}
        <button onClick={onRefresh} aria-label="Refresh data" title="Refresh data" className={iconBtn}>
          <RefreshCw size={15} />
        </button>

        {/* Export */}
        <button onClick={onExport} aria-label="Export CSV" title="Export CSV" className={iconBtn}>
          <Download size={15} />
        </button>

        {/* Dark toggle */}
        <button onClick={onToggleDark} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'} className={iconBtn}>
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        {/* Notifications */}
        <div className="relative">
          <button onClick={() => setOpen(open === 'notifications' ? null : 'notifications')} aria-haspopup="true" aria-expanded={open === 'notifications'} aria-label={`Notifications (${alerts.length})`} className={`${iconBtn} relative`}>
            <Bell size={15} />
            {alerts.length > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[9px] font-bold flex items-center justify-center">
                {alerts.length}
              </span>
            )}
          </button>
          {open === 'notifications' && (
            <>
              <div className="fixed inset-0 z-30" onClick={close} aria-hidden="true" />
              <div className="absolute right-0 mt-1.5 top-full w-80 bg-bg-card border border-border-default rounded-md shadow-dropdown z-40 overflow-hidden">
                <div className="px-4 py-3 border-b border-border-light flex items-center justify-between">
                  <p className="text-text-primary text-xs font-semibold">Notifications</p>
                  <span className="text-text-muted text-[10px]">{alerts.length} active</span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {alerts.length === 0 ? (
                    <p className="px-4 py-6 text-text-muted text-xs text-center">All clear — no active alerts.</p>
                  ) : (
                    alerts.map((a) => (
                      <div key={a.id} className="px-4 py-2.5 border-b border-border-light last:border-0 flex items-start gap-2.5">
                        <span className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${PRIORITY_DOT[a.priority]}`} />
                        <div className="min-w-0">
                          <p className={`text-xs font-medium ${PRIORITY_TEXT[a.priority]}`}>{a.title}</p>
                          <p className="text-text-muted text-[10px] mt-0.5 truncate">{a.detail}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Help */}
        <div className="relative hidden sm:block">
          <button onClick={() => setOpen(open === 'help' ? null : 'help')} aria-haspopup="true" aria-expanded={open === 'help'} aria-label="Help" className={iconBtn}>
            <HelpCircle size={15} />
          </button>
          {open === 'help' && (
            <>
              <div className="fixed inset-0 z-30" onClick={close} aria-hidden="true" />
              <div className="absolute right-0 mt-1.5 top-full w-64 bg-bg-card border border-border-default rounded-md shadow-dropdown z-40 p-4">
                <p className="text-text-primary text-xs font-semibold mb-2">Shortcuts</p>
                <ul className="space-y-1.5 text-[11px] text-text-secondary">
                  <li className="flex justify-between"><span>Refresh data</span><kbd className="px-1.5 py-0.5 rounded bg-bg-hover border border-border-default text-text-muted">F5</kbd></li>
                  <li className="flex justify-between"><span>Close panels</span><kbd className="px-1.5 py-0.5 rounded bg-bg-hover border border-border-default text-text-muted">Esc</kbd></li>
                  <li className="flex justify-between"><span>Focus search</span><kbd className="px-1.5 py-0.5 rounded bg-bg-hover border border-border-default text-text-muted">/</kbd></li>
                </ul>
                <p className="text-text-muted text-[10px] mt-3">Metrics are computed live from lot, worker and payroll data.</p>
              </div>
            </>
          )}
        </div>

        {/* Profile */}
        <div className="relative">
          <button onClick={() => setOpen(open === 'profile' ? null : 'profile')} aria-haspopup="true" aria-expanded={open === 'profile'} aria-label="User profile" className="h-9 pl-1 pr-2 rounded-md border border-border-default bg-bg-card flex items-center gap-2 hover:bg-bg-hover transition-colors">
            <span className="w-7 h-7 rounded-md bg-primary text-white flex items-center justify-center text-[10px] font-bold">{initials}</span>
            <span className="text-text-secondary text-xs font-medium hidden lg:block">{user?.name?.split(' ')[0] ?? 'User'}</span>
            <ChevronDown size={12} className="text-text-muted hidden lg:block" />
          </button>
          {open === 'profile' && (
            <>
              <div className="fixed inset-0 z-30" onClick={close} aria-hidden="true" />
              <div className="absolute right-0 mt-1.5 top-full w-56 bg-bg-card border border-border-default rounded-md shadow-dropdown z-40 p-2">
                <div className="px-3 py-2 mb-1 border-b border-border-light">
                  <p className="text-text-primary text-xs font-semibold truncate">{user?.name}</p>
                  <p className="text-text-muted text-[10px] truncate">{user?.email}</p>
                  <span className="inline-flex mt-1.5 px-2 py-0.5 rounded-full bg-primary-light text-primary text-[10px] font-medium capitalize">{user?.role}</span>
                </div>
                <button
                  onClick={() => { close(); logout(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs text-text-secondary hover:text-danger hover:bg-danger-light transition-colors"
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            </>
          )}
        </div>

        {/* Close button for open dropdown on mobile */}
        {open && (
          <button onClick={close} aria-label="Close panel" className="lg:hidden w-9 h-9 rounded-md border border-border-default flex items-center justify-center text-text-muted">
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

export const DashboardHeader = memo(DashboardHeaderBase);
