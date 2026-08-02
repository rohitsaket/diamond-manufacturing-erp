import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { AppProvider, useApp } from '../contexts/AppContext';
import { Sidebar } from '../components/layout/Sidebar';
import { Dashboard } from '../pages/Dashboard/Dashboard';
import { FloorManager } from '../pages/FloorManager/FloorManager';
import { MasterLedger } from '../pages/MasterLedger/MasterLedger';
import { Employees } from '../pages/Employees/Employees';
import { Payroll } from '../pages/Payroll/Payroll';
import { RateCard } from '../pages/RateCard/RateCard';
import { MasterData } from '../pages/MasterData/MasterData';
import { Attendance } from '../pages/Attendance/Attendance';
import { HR } from '../pages/HR/HR';
import { Recruitment } from '../pages/Recruitment/Recruitment';
import { EmployeeProfile } from '../pages/EmployeeProfile/EmployeeProfile';
import { HRDashboard } from '../pages/HRDashboard/HRDashboard';
import { LoginPage } from '../pages/Login/Login';
import { LOT_SLA_DAYS } from '../data/mockData';

const NOW_LABEL = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });

function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <Loader2 className="w-7 h-7 text-primary animate-spin" />
      <p className="text-text-muted text-sm mt-3">Loading production data…</p>
    </div>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-12 h-12 rounded-full bg-danger-light flex items-center justify-center mb-4">
        <AlertTriangle className="w-6 h-6 text-danger" />
      </div>
      <h3 className="text-text-primary font-semibold text-base">Couldn't load data</h3>
      <p className="text-text-muted text-sm mt-1 max-w-sm">{message}</p>
      <button
        onClick={onRetry}
        className="mt-5 flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors"
      >
        <RefreshCw size={14} /> Retry
      </button>
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 px-4 py-2.5 rounded-md bg-danger-light border border-danger/30">
      <div className="flex items-center gap-2 text-danger text-sm min-w-0">
        <AlertTriangle size={15} className="flex-shrink-0" />
        <span className="truncate">{message}</span>
      </div>
      <button onClick={onRetry} className="flex items-center gap-1.5 text-danger text-xs font-medium hover:underline flex-shrink-0">
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
}

function AppInner() {
  const { isAuthenticated, user } = useAuth();
  const [activePage, setActivePage] = useState('dashboard');
  // Which section of the HRMS dashboard is showing. Held here so the sidebar
  // sub-navigation and the in-page tabs stay in sync.
  const [dashboardSection, setDashboardSection] = useState('hr');
  const { lots, salaryLines, salaryPeriods, loaded, error, refresh } = useApp();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Before the first successful load: show a spinner (or an error screen if it
  // failed). A later refresh that fails while data is present shows a banner.
  const showLoading = !loaded && !error;
  const showError = !!error && !loaded;
  const retry = () => { void refresh(); };

  // Pages that fill the viewport and scroll internally (their own overflow
  // container) rather than growing the page. Floor + the wide Master Ledger.
  const fullHeightPage = activePage === 'floor' || activePage === 'ledger';

  const today = Date.now();
  const floorExceptions = lots.filter(l => {
    if (l.status !== 'ISSUED' && l.status !== 'IN_PROGRESS') return false;
    const days = Math.floor((today - new Date(l.issueDate).getTime()) / 86400000);
    return days > LOT_SLA_DAYS;
  }).length;

  const openPeriod = salaryPeriods.find(p => p.status === 'OPEN');
  const pendingPayrollCount = openPeriod
    ? salaryLines.filter(l => l.periodId === openPeriod.id && (!l.managerVerified || !l.accountVerified)).length
    : 0;

  const pages: Record<string, React.ReactNode> = {
    dashboard: <Dashboard onNavigate={setActivePage} />,
    floor: <FloorManager />,
    ledger: <MasterLedger />,
    employees: <Employees />,
    payroll: <Payroll />,
    rates: <RateCard />,
    masterdata: <MasterData />,
    hrdashboard: (
      <HRDashboard
        onNavigate={setActivePage}
        section={dashboardSection}
        onSectionChange={setDashboardSection}
      />
    ),
    attendance: <Attendance />,
    hr: <HR />,
    recruitment: <Recruitment />,
    hrprofile: <EmployeeProfile onNavigate={setActivePage} />,
  };

  return (
    <div className="min-h-screen bg-bg-secondary text-text-primary flex">
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
        floorBadge={floorExceptions > 0 ? String(floorExceptions) : null}
        payrollBadge={pendingPayrollCount > 0 ? String(pendingPayrollCount) : null}
        dashboardSection={dashboardSection}
        setDashboardSection={setDashboardSection}
      />

      <main className="flex-1 min-h-screen flex flex-col">
        {/* Top bar */}
        <div className="sticky top-0 z-30 border-b border-border-default bg-bg-card px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-text-muted text-xs font-medium">
            <span>Harene Diamond Manufacturing</span>
            <span>·</span>
            <span>Production ERP v2.0</span>
            <span>·</span>
            <span className="text-success flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
              Live
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-text-muted">
            <span>{NOW_LABEL}</span>
            <span>·</span>
            <span>Manufacturing: Hastack</span>
            <span className="px-2 py-1 rounded-md bg-bg-selected text-primary text-xs font-medium">
              {user?.role ?? 'Manager'}
            </span>
          </div>
        </div>

        <div className={`flex-1 p-6 ${fullHeightPage ? 'h-[calc(100vh-53px)] flex flex-col min-h-0' : ''}`}>
          {showLoading ? (
            <LoadingScreen />
          ) : showError ? (
            <ErrorScreen message={error!} onRetry={retry} />
          ) : activePage === 'floor' ? (
            <div className="flex flex-col h-full">
              {error && <ErrorBanner message={error} onRetry={retry} />}
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-text-primary">Manufacturing</h2>
                <p className="text-text-secondary text-sm mt-1">Live lot board · receive · verify · exception feed</p>
              </div>
              <div className="flex-1 min-h-0">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activePage}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="h-full"
                  >
                    {pages[activePage]}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          ) : (
            <>
              {error && <ErrorBanner message={error} onRetry={retry} />}
              <AnimatePresence mode="wait">
                <motion.div
                  key={activePage}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className={fullHeightPage ? 'flex-1 min-h-0' : undefined}
                >
                  {pages[activePage]}
                </motion.div>
              </AnimatePresence>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <AppInner />
      </AppProvider>
    </AuthProvider>
  );
}
