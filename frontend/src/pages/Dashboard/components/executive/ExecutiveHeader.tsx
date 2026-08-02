import { memo, useState } from 'react';
import {
  Search, Bell, User, Download, RefreshCw, Moon, Sun, ChevronDown,
  Calendar, Filter, X, Building2
} from 'lucide-react';
import { GlobalFilters } from '../../dashboard.types';

interface ExecutiveHeaderProps {
  filters: GlobalFilters;
  setFilters: React.Dispatch<React.SetStateAction<GlobalFilters>>;
  onRefresh: () => void;
  onExport: () => void;
  dark: boolean;
  onToggleDark: () => void;
}

const PLANTS = [
  'All Plants',
  'Harene · Hastack Main',
  'Harene · Mumbai Branch',
  'Harene · Surat Unit',
];

const DATE_RANGES = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
  { label: 'This Quarter', value: 'quarter' },
  { label: 'This Year', value: 'year' },
  { label: 'Custom', value: 'custom' },
];

function ExecutiveHeaderBase({
  filters,
  setFilters,
  onRefresh,
  onExport,
  dark,
  onToggleDark,
}: ExecutiveHeaderProps) {
  const [plantOpen, setPlantOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Dashboards', href: '/dashboards' },
    { label: 'Executive Dashboard', href: '/dashboards/executive', current: true },
  ];

  const unreadNotifications = 5;

  return (
    <header className="bg-bg-card border border-border-default rounded-xl shadow-card p-4 md:p-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-text-muted mb-4">
        {breadcrumbs.map((item, idx) => (
          <span key={item.label} className="flex items-center gap-2">
            {idx > 0 && <span className="text-border-default">/</span>}
            {item.current ? (
              <span className="text-text-primary font-medium">{item.label}</span>
            ) : (
              <button className="hover:text-text-primary transition-colors">{item.label}</button>
            )}
          </span>
        ))}
      </nav>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Left section - Title and plant selector */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-3">
            <Building2 size={28} className="text-primary" />
            Executive Dashboard
          </h1>
          <p className="text-text-muted text-sm mt-1">
            Comprehensive overview of all manufacturing operations, financial performance, and business health
          </p>
        </div>

        {/* Right section - All controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className={`relative flex items-center transition-all duration-200 ${searchFocused ? 'w-64' : 'w-48'}`}>
            <Search size={16} className="absolute left-3 text-text-muted" />
            <input
              type="text"
              placeholder="Search anything..."
              value={filters.search}
              onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-bg-hover border border-border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
            />
            {filters.search && (
              <button
                onClick={() => setFilters(f => ({ ...f, search: '' }))}
                className="absolute right-3 text-text-muted hover:text-text-primary"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Plant filter */}
          <div className="relative">
            <button
              onClick={() => { setPlantOpen(!plantOpen); setDateOpen(false); setNotificationsOpen(false); setProfileOpen(false); }}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-hover border border-border-default rounded-lg hover:bg-bg-hover/80 transition-colors"
            >
              <Building2 size={16} className="text-text-muted" />
              {filters.plant}
              <ChevronDown size={16} className="text-text-muted" />
            </button>
            {plantOpen && (
              <div className="absolute top-full mt-2 right-0 w-56 bg-bg-card border border-border-default rounded-lg shadow-dropdown z-50 overflow-hidden">
                {PLANTS.map(plant => (
                  <button
                    key={plant}
                    onClick={() => { setFilters(f => ({ ...f, plant })); setPlantOpen(false); }}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-bg-hover transition-colors ${filters.plant === plant ? 'bg-primary/10 text-primary font-medium' : 'text-text-secondary'}`}
                  >
                    {plant}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date range */}
          <div className="relative">
            <button
              onClick={() => { setDateOpen(!dateOpen); setPlantOpen(false); setNotificationsOpen(false); setProfileOpen(false); }}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-hover border border-border-default rounded-lg hover:bg-bg-hover/80 transition-colors"
            >
              <Calendar size={16} className="text-text-muted" />
              This Month
              <ChevronDown size={16} className="text-text-muted" />
            </button>
            {dateOpen && (
              <div className="absolute top-full mt-2 right-0 w-40 bg-bg-card border border-border-default rounded-lg shadow-dropdown z-50 overflow-hidden">
                {DATE_RANGES.map(range => (
                  <button
                    key={range.value}
                    onClick={() => setDateOpen(false)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-bg-hover transition-colors text-text-secondary"
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Filter button */}
          <button className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-hover border border-border-default rounded-lg hover:bg-bg-hover/80 transition-colors">
            <Filter size={16} className="text-text-muted" />
            <span className="hidden sm:inline">Filters</span>
          </button>

          {/* Export */}
          <button
            onClick={onExport}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
          >
            <Download size={16} />
            <span className="hidden sm:inline">Export</span>
          </button>

          {/* Refresh */}
          <button
            onClick={onRefresh}
            className="p-2 text-text-muted hover:text-text-primary bg-bg-hover border border-border-default rounded-lg hover:bg-bg-hover/80 transition-colors"
            title="Refresh data"
          >
            <RefreshCw size={18} />
          </button>

          {/* Dark mode toggle */}
          <button
            onClick={onToggleDark}
            className="p-2 text-text-muted hover:text-text-primary bg-bg-hover border border-border-default rounded-lg hover:bg-bg-hover/80 transition-colors"
            title="Toggle dark mode"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => { setNotificationsOpen(!notificationsOpen); setPlantOpen(false); setDateOpen(false); setProfileOpen(false); }}
              className="p-2 text-text-muted hover:text-text-primary bg-bg-hover border border-border-default rounded-lg hover:bg-bg-hover/80 transition-colors relative"
              title="Notifications"
            >
              <Bell size={18} />
              {unreadNotifications > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {unreadNotifications}
                </span>
              )}
            </button>
          </div>

          {/* User profile */}
          <div className="relative">
            <button
              onClick={() => { setProfileOpen(!profileOpen); setPlantOpen(false); setDateOpen(false); setNotificationsOpen(false); }}
              className="p-2 text-text-muted hover:text-text-primary bg-bg-hover border border-border-default rounded-lg hover:bg-bg-hover/80 transition-colors"
              title="Profile"
            >
              <User size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Active filters display */}
      {(filters.department !== 'ALL' || filters.dateFrom) && (
        <div className="mt-4 pt-4 border-t border-border-light flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-muted">Active filters:</span>
          {filters.department !== 'ALL' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/10 text-primary text-xs">
              Department: {filters.department}
              <button onClick={() => setFilters(f => ({ ...f, department: 'ALL' }))}>
                <X size={12} />
              </button>
            </span>
          )}
          {filters.dateFrom && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/10 text-primary text-xs">
              Date: {filters.dateFrom} - {filters.dateTo}
              <button onClick={() => setFilters(f => ({ ...f, dateFrom: null, dateTo: null }))}>
                <X size={12} />
              </button>
            </span>
          )}
        </div>
      )}
    </header>
  );
}

export const ExecutiveHeader = memo(ExecutiveHeaderBase);