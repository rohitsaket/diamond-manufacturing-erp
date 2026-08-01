import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';
import { Lot, RateCardRow, SalaryLine, SalaryPeriod, Employee } from '../data/mockData';

export interface LabourHead {
  id: number;
  code: string;
  name: string;
}

interface IssueLotPayload {
  workerId: number;
  lotId: string;
  lotName: string;
  shape: string;
  shapeCategory: 'ROUND' | 'FANCY' | 'BLOCKING';
  qty: number;
  issueWt: number;
  estimateWt: number;
  issueDate: string;
  lab: string;
  labourHeadId: number;
}

interface ReceiveLotPayload {
  polishedWt: number;
  color?: string;
  clarity?: string;
  cut?: string;
  grader?: string;
  receivedDate: string;
}

interface AppContextType {
  lots: Lot[];
  setLots: React.Dispatch<React.SetStateAction<Lot[]>>;
  rateCard: RateCardRow[];
  setRateCard: React.Dispatch<React.SetStateAction<RateCardRow[]>>;
  salaryLines: SalaryLine[];
  setSalaryLines: React.Dispatch<React.SetStateAction<SalaryLine[]>>;
  salaryPeriods: SalaryPeriod[];
  setSalaryPeriods: React.Dispatch<React.SetStateAction<SalaryPeriod[]>>;
  employees: Employee[];
  labourHeads: LabourHead[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  // Lot actions
  issueLot: (payload: IssueLotPayload) => Promise<Lot>;
  receiveLot: (id: number, payload: ReceiveLotPayload) => Promise<Lot>;
  verifyLot: (id: number) => Promise<Lot>;
  // Rate card actions
  updateRate: (id: number, ratePerCt: number) => Promise<void>;
  newRateVersion: (effectiveFrom: string) => Promise<void>;
  // Payroll actions
  managerVerify: (lineId: number, verify: boolean, periodId: number) => Promise<void>;
  accountVerify: (lineId: number, verify: boolean, periodId: number) => Promise<void>;
  lockPeriod: (periodId: number) => Promise<void>;
  markPaid: (periodId: number) => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();

  const [lots, setLots] = useState<Lot[]>([]);
  const [rateCard, setRateCard] = useState<RateCardRow[]>([]);
  const [salaryLines, setSalaryLines] = useState<SalaryLine[]>([]);
  const [salaryPeriods, setSalaryPeriods] = useState<SalaryPeriod[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [labourHeads, setLabourHeads] = useState<LabourHead[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [periods, emps, heads, lotsRes, rc] = await Promise.all([
        api.get<SalaryPeriod[]>('/payroll/periods'),
        api.get<Employee[]>('/employees?workStatus=ALL'),
        api.get<LabourHead[]>('/floor/labour-heads'),
        api.get<{ rows: Lot[]; total: number }>('/floor/lots?limit=1000'),
        api.get<RateCardRow[]>('/rate-card'),
      ]);

      const lineArrays = await Promise.all(
        periods.map((p) => api.get<SalaryLine[]>(`/payroll/periods/${p.id}/lines`)),
      );

      setSalaryPeriods(periods);
      setEmployees(emps);
      setLabourHeads(heads);
      setLots(lotsRes.rows);
      setRateCard(rc);
      setSalaryLines(lineArrays.flat());
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void refresh();
    } else {
      setLots([]);
      setRateCard([]);
      setSalaryLines([]);
      setSalaryPeriods([]);
      setEmployees([]);
      setLabourHeads([]);
      setError(null);
      setLoaded(false);
    }
  }, [isAuthenticated, refresh]);

  // --- Lot actions ---
  const issueLot = useCallback(async (payload: IssueLotPayload) => {
    const created = await api.post<Lot>('/floor/lots', payload);
    setLots((prev) => [created, ...prev]);
    return created;
  }, []);

  const receiveLot = useCallback(async (id: number, payload: ReceiveLotPayload) => {
    const updated = await api.put<Lot>(`/floor/lots/${id}/receive`, payload);
    setLots((prev) => prev.map((l) => (l.id === id ? updated : l)));
    return updated;
  }, []);

  const verifyLot = useCallback(async (id: number) => {
    const updated = await api.put<Lot>(`/floor/lots/${id}/verify`);
    setLots((prev) => prev.map((l) => (l.id === id ? updated : l)));
    return updated;
  }, []);

  // --- Rate card actions ---
  const updateRate = useCallback(async (id: number, ratePerCt: number) => {
    const updated = await api.put<RateCardRow>(`/rate-card/${id}`, { ratePerCt });
    setRateCard((prev) => prev.map((r) => (r.id === id ? updated : r)));
  }, []);

  const newRateVersion = useCallback(async (effectiveFrom: string) => {
    const rows = await api.post<RateCardRow[]>('/rate-card/new-version', { effectiveFrom });
    setRateCard(rows);
  }, []);

  // --- Payroll actions ---
  const refreshPeriodLines = useCallback(async (periodId: number) => {
    const lines = await api.get<SalaryLine[]>(`/payroll/periods/${periodId}/lines`);
    setSalaryLines((prev) => [...prev.filter((l) => l.periodId !== periodId), ...lines]);
  }, []);

  const managerVerify = useCallback(
    async (lineId: number, verify: boolean, periodId: number) => {
      await api.put(`/payroll/lines/${lineId}/manager-verify`, { verify });
      await refreshPeriodLines(periodId);
    },
    [refreshPeriodLines],
  );

  const accountVerify = useCallback(
    async (lineId: number, verify: boolean, periodId: number) => {
      await api.put(`/payroll/lines/${lineId}/account-verify`, { verify });
      await refreshPeriodLines(periodId);
    },
    [refreshPeriodLines],
  );

  const lockPeriod = useCallback(async (periodId: number) => {
    const updated = await api.put<SalaryPeriod>(`/payroll/periods/${periodId}/lock`);
    setSalaryPeriods((prev) => prev.map((p) => (p.id === periodId ? updated : p)));
  }, []);

  const markPaid = useCallback(async (periodId: number) => {
    const updated = await api.put<SalaryPeriod>(`/payroll/periods/${periodId}/pay`);
    setSalaryPeriods((prev) => prev.map((p) => (p.id === periodId ? updated : p)));
  }, []);

  return (
    <AppContext.Provider
      value={{
        lots,
        setLots,
        rateCard,
        setRateCard,
        salaryLines,
        setSalaryLines,
        salaryPeriods,
        setSalaryPeriods,
        employees,
        labourHeads,
        loading,
        loaded,
        error,
        refresh,
        issueLot,
        receiveLot,
        verifyLot,
        updateRate,
        newRateVersion,
        managerVerify,
        accountVerify,
        lockPeriod,
        markPaid,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
