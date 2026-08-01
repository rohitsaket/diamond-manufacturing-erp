export type LotStatus = 'ISSUED' | 'IN_PROGRESS' | 'RECEIVED' | 'VERIFIED' | 'REWORK' | 'LOST';
export type WorkerType = 'PIECE_RATE' | 'DHAR' | 'MAXI';
export type LabType = 'IGI' | 'GIA' | 'US';
export type ShapeCategory = 'ROUND' | 'FANCY' | 'BLOCKING';

export interface Employee {
  id: number;
  empCode: string;
  fullName: string;
  shortName: string;
  grade: string;
  specialist: string[];
  workerType: WorkerType;
  workStatus: 'WORKING' | 'RESIGN';
  lotsInHand: number;
  totalCts: number;
  yieldPct: number;
  periodSalary: number;
  whatsapp?: string;
  joinedAt: string;
}

export interface Lot {
  id: number;
  lotId: string;
  lotName: string;
  employeeId: number;
  employeeName: string;
  qty: number;
  shape: string;
  shapeCategory: ShapeCategory;
  issueWeight: number;
  estimateWt: number;
  issueDate: string;
  receivedDate?: string;
  polishedWt?: number;
  color?: string;
  clarity?: string;
  cut?: string;
  grader?: string;
  lab?: LabType;
  labourHead: string;
  remarks?: string;
  status: LotStatus;
  daysConsumed?: number;
  weightDiff?: number;
  labourAmount?: number;
}

export interface RateCardRow {
  id: number;
  shapeCategory: ShapeCategory;
  lab: 'IGI' | 'GIA' | 'ANY';
  ctsMin: number;
  ctsMax: number;
  ratePerCt: number;
  effectiveFrom: string;
}

export interface SalaryPeriod {
  id: number;
  label: string;
  fromDate: string;
  toDate: string;
  status: 'OPEN' | 'LOCKED' | 'PAID';
}

export interface SalaryLine {
  id: number;
  periodId: number;
  employeeId: number;
  employeeName: string;
  empCode: string;
  totalCts: number;
  totalAmount: number;
  managerVerified: boolean;
  accountVerified: boolean;
  paidAt?: string;
  lotsCount: number;
}

export interface KPIData {
  yieldPct: number;
  wipCarats: number;
  wipValue: number;
  avgDaysConsumed: number;
  labourPerCt: number;
  onTimePct: number;
  reworkPct: number;
  totalLots: number;
  activeLots: number;
  leakageExceptions: number;
}
