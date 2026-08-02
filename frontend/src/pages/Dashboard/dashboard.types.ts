import { Lot, Employee, ShapeCategory } from '../../data/mockData';

export interface SparkPoint {
  label: string;
  value: number;
}

export type KpiBadge = 'good' | 'warn' | 'bad' | 'neutral';

export interface KpiCardData {
  id: string;
  title: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals: number;
  target: number;
  iconColor: string;
  iconTint: string;
  badge: KpiBadge;
  statusLabel: string;
  trend: number;
  spark: SparkPoint[];
  sub: string;
  navigate: string;
  tooltip: string;
}

export type RangeKey = 'today' | 'week' | 'month' | 'quarter' | 'year';

export interface ProdPoint {
  label: string;
  actual: number;
  target: number;
}

export interface PipelineStage {
  id: string;
  name: string;
  completed: number;
  running: number;
  pending: number;
  delayed: number;
  rejected: number;
  avgTime: number;
  completionPct: number;
}

export interface DepartmentStat {
  id: number;
  name: string;
  orders: number;
  completed: number;
  pending: number;
  efficiency: number;
  avgTime: number;
  delay: number;
  status: 'on-track' | 'at-risk' | 'idle';
}

export type ShiftKey = 'Morning' | 'Evening' | 'Night';

export interface ShiftStat {
  key: ShiftKey;
  production: number;
  workers: number;
  efficiency: number;
  downtime: number;
  rejections: number;
  machineUsage: number;
  attendance: number;
}

export interface MachineStat {
  id: string;
  name: string;
  operator: string;
  currentJob: string;
  status: 'running' | 'idle' | 'breakdown' | 'maintenance';
  runningTime: number;
  idleTime: number;
  downtime: number;
  efficiency: number;
  temperature: number;
  maintenanceDue: number;
  oee: number;
}

export interface WorkforceRow {
  id: number;
  name: string;
  shortName: string;
  department: string;
  operation: string;
  completed: number;
  pending: number;
  efficiency: number;
  attendance: number;
  score: number;
  skill: number;
  grade: string;
}

export interface QualityStat {
  passPct: number;
  rejectPct: number;
  reworkPct: number;
  openNcr: number;
  inspectionPending: number;
  todaysQc: number;
  defectDist: { name: string; value: number; color: string }[];
  rootCause: { name: string; value: number; color: string }[];
  deptDefects: { name: string; value: number }[];
  inspectionTrend: SparkPoint[];
}

export interface InventoryStat {
  raw: number;
  wip: number;
  finished: number;
  rejected: number;
  reserved: number;
  available: number;
  flow: { name: string; value: number; fill: string }[];
  consumption: { name: string; value: number }[];
  aging: { name: string; value: number; color: string }[];
  turnover: number;
}

export interface OrderStatusItem {
  key: string;
  label: string;
  value: number;
  color: string;
  tint: string;
}

export interface AlertItem {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  detail: string;
}

export interface ActivityItem {
  id: string;
  type: 'issue' | 'receive' | 'verify' | 'rework' | 'system';
  title: string;
  detail: string;
  date: string;
}

export interface GlobalFilters {
  plant: string;
  department: string;
  shift: ShiftKey | 'ALL';
  search: string;
  dateFrom: string | null;
  dateTo: string | null;
}

export interface DashboardData {
  kpis: KpiCardData[];
  series: Record<RangeKey, ProdPoint[]>;
  yieldTrend: { month: string; yield: number; target: number }[];
  caratFlow: { name: string; value: number; fill: string }[];
  pipeline: PipelineStage[];
  departments: DepartmentStat[];
  shifts: ShiftStat[];
  machines: MachineStat[];
  workforce: WorkforceRow[];
  quality: QualityStat;
  inventory: InventoryStat;
  orders: OrderStatusItem[];
  alerts: AlertItem[];
  activities: ActivityItem[];
  totals: {
    totalLots: number;
    activeLots: number;
    todayProduction: number;
    todayReceived: number;
    todayIssued: number;
  };
}

export type { Lot, Employee, ShapeCategory };
