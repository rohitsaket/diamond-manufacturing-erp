export const YIELD_TARGET_PCT = 68;
export const LOT_SLA_DAYS = 18;
export const LEAKAGE_FLAG_THRESHOLD_PCT = 5.0;
export const LEAKAGE_FLAG_WEIGHT_RATIO = 0.35;

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

export function computeLabourAmount(
  polishedWt: number,
  qty: number,
  shapeCategory: ShapeCategory,
  lab: LabType | undefined,
  rates: RateCardRow[],
): number {
  if (!polishedWt || qty <= 0) return 0;
  const wtPerStone = polishedWt / qty;
  const targetLab = shapeCategory === 'BLOCKING' ? 'ANY' : (lab ?? 'IGI');
  const rate = rates
    .filter(r =>
      r.shapeCategory === shapeCategory &&
      r.lab === targetLab &&
      r.ctsMin <= wtPerStone &&
      r.ctsMax >= wtPerStone,
    )
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return rate ? Math.round(polishedWt * rate.ratePerCt) : 0;
}

export const employees: Employee[] = [
  { id: 1, empCode: '301', fullName: 'Jayesh Kumar Arora', shortName: 'J K A*', grade: 'A*', specialist: ['EM', 'RAD'], workerType: 'PIECE_RATE', workStatus: 'WORKING', lotsInHand: 2, totalCts: 124.5, yieldPct: 68.4, periodSalary: 48200, whatsapp: '+91-9876540001', joinedAt: '2019-03-15' },
  { id: 2, empCode: '302', fullName: 'Priya Mehta', shortName: 'P M', grade: 'A+++', specialist: ['PN', 'OV'], workerType: 'PIECE_RATE', workStatus: 'WORKING', lotsInHand: 2, totalCts: 89.2, yieldPct: 71.2, periodSalary: 38600, whatsapp: '+91-9876540002', joinedAt: '2020-07-01' },
  { id: 3, empCode: '303', fullName: 'Ramesh Patel', shortName: 'R P', grade: 'A++', specialist: ['RD', 'MQ'], workerType: 'PIECE_RATE', workStatus: 'WORKING', lotsInHand: 3, totalCts: 203.8, yieldPct: 65.9, periodSalary: 61400, whatsapp: '+91-9876540003', joinedAt: '2018-11-20' },
  { id: 4, empCode: 'DHAR-401', fullName: 'Dharampal Singh', shortName: 'D S', grade: 'A+', specialist: ['CU', 'PR'], workerType: 'DHAR', workStatus: 'WORKING', lotsInHand: 0, totalCts: 45.0, yieldPct: 72.1, periodSalary: 22800, joinedAt: '2021-02-10' },
  { id: 5, empCode: '304', fullName: 'Suresh Bhai', shortName: 'S B', grade: 'A', specialist: ['RD'], workerType: 'PIECE_RATE', workStatus: 'WORKING', lotsInHand: 2, totalCts: 110.4, yieldPct: 64.3, periodSalary: 29700, joinedAt: '2022-05-18' },
  { id: 6, empCode: 'MAXI', fullName: 'Maxi Unit', shortName: 'MAXI', grade: 'A', specialist: ['EM', 'RD', 'PN'], workerType: 'MAXI', workStatus: 'WORKING', lotsInHand: 1, totalCts: 312.6, yieldPct: 69.8, periodSalary: 124500, joinedAt: '2017-01-01' },
  { id: 7, empCode: '305', fullName: 'Kishore Nayak', shortName: 'K N', grade: 'B', specialist: ['OV'], workerType: 'PIECE_RATE', workStatus: 'WORKING', lotsInHand: 1, totalCts: 58.3, yieldPct: 62.7, periodSalary: 18400, joinedAt: '2023-08-01' },
  { id: 8, empCode: '306', fullName: 'Anita Shah', shortName: 'A S', grade: 'A++', specialist: ['RAD', 'CU'], workerType: 'PIECE_RATE', workStatus: 'WORKING', lotsInHand: 1, totalCts: 98.7, yieldPct: 70.5, periodSalary: 44300, joinedAt: '2019-09-12' },
  { id: 9, empCode: '307', fullName: 'Vinod Joshi', shortName: 'V J', grade: 'A*', specialist: ['EM', 'MQ', 'CU'], workerType: 'PIECE_RATE', workStatus: 'RESIGN', lotsInHand: 0, totalCts: 0, yieldPct: 0, periodSalary: 0, joinedAt: '2016-06-20' },
  { id: 10, empCode: '308', fullName: 'Lalita Bai', shortName: 'L B', grade: 'A+', specialist: ['PN', 'PR'], workerType: 'PIECE_RATE', workStatus: 'WORKING', lotsInHand: 2, totalCts: 176.2, yieldPct: 67.4, periodSalary: 52100, joinedAt: '2020-01-15' },
];

export const lots: Lot[] = [
  { id: 1, lotId: '92124978', lotName: '643-019AAA', employeeId: 1, employeeName: 'Jayesh Kumar Arora', qty: 12, shape: 'Emerald', shapeCategory: 'FANCY', issueWeight: 18.50, estimateWt: 12.65, issueDate: '2026-06-05', receivedDate: '2026-06-22', polishedWt: 12.48, color: 'F', clarity: 'VS1', cut: 'EX EX EX', grader: 'J.J.', lab: 'IGI', labourHead: 'Full Polished', status: 'VERIFIED', daysConsumed: 17, weightDiff: 6.02, labourAmount: 13728 },
  { id: 2, lotId: '92125001', lotName: '644-021BBB', employeeId: 1, employeeName: 'Jayesh Kumar Arora', qty: 8, shape: 'Radiant', shapeCategory: 'FANCY', issueWeight: 12.30, estimateWt: 8.10, issueDate: '2026-06-18', labourHead: 'Full Polished', status: 'IN_PROGRESS' },
  { id: 3, lotId: '92125022', lotName: '645-008CCC', employeeId: 2, employeeName: 'Priya Mehta', qty: 20, shape: 'Pear', shapeCategory: 'FANCY', issueWeight: 24.00, estimateWt: 16.20, issueDate: '2026-06-10', receivedDate: '2026-06-28', polishedWt: 15.96, color: 'E', clarity: 'VVS2', cut: 'EX VG EX', grader: 'N.K.', lab: 'GIA', labourHead: 'Full Polished', status: 'RECEIVED', daysConsumed: 18, weightDiff: 8.04, labourAmount: 22344 },
  { id: 4, lotId: '92125045', lotName: '646-033DDD', employeeId: 3, employeeName: 'Ramesh Patel', qty: 30, shape: 'Round', shapeCategory: 'ROUND', issueWeight: 35.80, estimateWt: 23.50, issueDate: '2026-06-02', receivedDate: '2026-06-19', polishedWt: 22.84, color: 'G', clarity: 'SI1', cut: 'EX EX EX', grader: 'J.J.', lab: 'IGI', labourHead: 'Full Polished', status: 'VERIFIED', daysConsumed: 17, weightDiff: 12.96, labourAmount: 20556 },
  { id: 5, lotId: '92125067', lotName: '647-044EEE', employeeId: 3, employeeName: 'Ramesh Patel', qty: 15, shape: 'Oval', shapeCategory: 'FANCY', issueWeight: 19.20, estimateWt: 13.00, issueDate: '2026-06-12', labourHead: 'Full Polished', status: 'ISSUED' },
  { id: 6, lotId: '92125089', lotName: '648-055FFF', employeeId: 4, employeeName: 'Dharampal Singh', qty: 10, shape: 'Cushion', shapeCategory: 'FANCY', issueWeight: 14.50, estimateWt: 9.80, issueDate: '2026-06-08', receivedDate: '2026-06-24', polishedWt: 9.20, color: 'H', clarity: 'VS2', cut: 'VG EX VG', grader: 'N.K.', lab: 'IGI', labourHead: 'Blocking', status: 'VERIFIED', daysConsumed: 16, weightDiff: 5.30, labourAmount: 8280 },
  { id: 7, lotId: '92125110', lotName: '649-066GGG', employeeId: 5, employeeName: 'Suresh Bhai', qty: 25, shape: 'Round', shapeCategory: 'ROUND', issueWeight: 28.60, estimateWt: 19.00, issueDate: '2026-06-10', labourHead: 'Full Polished', status: 'IN_PROGRESS' },
  { id: 8, lotId: '92125132', lotName: '650-077HHH', employeeId: 6, employeeName: 'Maxi Unit', qty: 40, shape: 'Princess', shapeCategory: 'FANCY', issueWeight: 52.40, estimateWt: 36.20, issueDate: '2026-06-03', receivedDate: '2026-06-20', polishedWt: 35.62, color: 'D', clarity: 'IF', cut: 'EX EX EX', grader: 'J.J.', lab: 'GIA', labourHead: 'Full Polished', status: 'VERIFIED', daysConsumed: 17, weightDiff: 16.78, labourAmount: 71240 },
  { id: 9, lotId: '92125155', lotName: '651-088III', employeeId: 6, employeeName: 'Maxi Unit', qty: 18, shape: 'Marquise', shapeCategory: 'FANCY', issueWeight: 22.10, estimateWt: 14.80, issueDate: '2026-06-20', labourHead: 'Full Polished', status: 'ISSUED' },
  { id: 10, lotId: '92125178', lotName: '652-099JJJ', employeeId: 7, employeeName: 'Kishore Nayak', qty: 6, shape: 'Oval', shapeCategory: 'FANCY', issueWeight: 8.40, estimateWt: 5.60, issueDate: '2026-06-06', receivedDate: '2026-06-25', polishedWt: 4.90, color: 'I', clarity: 'SI2', cut: 'VG VG VG', grader: 'N.K.', lab: 'IGI', labourHead: 'Full Polished', status: 'REWORK', remarks: 'Polish lines visible — return for rework', daysConsumed: 19, weightDiff: 3.50, labourAmount: 4410 },
  { id: 11, lotId: '92125200', lotName: '653-100KKK', employeeId: 8, employeeName: 'Anita Shah', qty: 22, shape: 'Radiant', shapeCategory: 'FANCY', issueWeight: 30.20, estimateWt: 20.60, issueDate: '2026-06-09', receivedDate: '2026-06-27', polishedWt: 20.14, color: 'F', clarity: 'VS1', cut: 'EX EX VG', grader: 'J.J.', lab: 'GIA', labourHead: 'Full Polished', status: 'VERIFIED', daysConsumed: 18, weightDiff: 10.06, labourAmount: 28196 },
  { id: 12, lotId: '92125222', lotName: '654-111LLL', employeeId: 10, employeeName: 'Lalita Bai', qty: 14, shape: 'Pear', shapeCategory: 'FANCY', issueWeight: 18.90, estimateWt: 12.80, issueDate: '2026-06-14', labourHead: 'Full Polished', status: 'IN_PROGRESS' },
  { id: 13, lotId: '92125244', lotName: '655-122MMM', employeeId: 10, employeeName: 'Lalita Bai', qty: 9, shape: 'Heart', shapeCategory: 'FANCY', issueWeight: 11.20, estimateWt: 7.40, issueDate: '2026-06-01', receivedDate: '2026-06-18', polishedWt: 6.80, color: 'G', clarity: 'VVS1', cut: 'EX EX EX', grader: 'J.J.', lab: 'IGI', labourHead: 'Full Polished', remarks: 'Leakage: 5.7% — monitored', status: 'VERIFIED', daysConsumed: 17, weightDiff: 4.40, labourAmount: 7480 },
  { id: 14, lotId: '92125266', lotName: '656-133NNN', employeeId: 2, employeeName: 'Priya Mehta', qty: 5, shape: 'Emerald', shapeCategory: 'FANCY', issueWeight: 7.60, estimateWt: 5.10, issueDate: '2026-06-22', labourHead: 'Full Polished', status: 'ISSUED' },
  { id: 15, lotId: '92125288', lotName: '657-144OOO', employeeId: 3, employeeName: 'Ramesh Patel', qty: 35, shape: 'Round', shapeCategory: 'ROUND', issueWeight: 42.30, estimateWt: 28.80, issueDate: '2026-06-25', labourHead: 'Full Polished', status: 'ISSUED' },
];

export const rateCard: RateCardRow[] = [
  { id: 1, shapeCategory: 'ROUND', lab: 'IGI', ctsMin: 0.00, ctsMax: 0.49, ratePerCt: 800, effectiveFrom: '2024-01-01' },
  { id: 2, shapeCategory: 'ROUND', lab: 'IGI', ctsMin: 0.50, ctsMax: 0.99, ratePerCt: 900, effectiveFrom: '2024-01-01' },
  { id: 3, shapeCategory: 'ROUND', lab: 'IGI', ctsMin: 1.00, ctsMax: 1.99, ratePerCt: 1000, effectiveFrom: '2024-01-01' },
  { id: 4, shapeCategory: 'ROUND', lab: 'IGI', ctsMin: 2.00, ctsMax: 2.99, ratePerCt: 1100, effectiveFrom: '2024-01-01' },
  { id: 5, shapeCategory: 'ROUND', lab: 'IGI', ctsMin: 3.00, ctsMax: 4.99, ratePerCt: 1200, effectiveFrom: '2024-01-01' },
  { id: 6, shapeCategory: 'ROUND', lab: 'IGI', ctsMin: 5.00, ctsMax: 9.99, ratePerCt: 1300, effectiveFrom: '2024-01-01' },
  { id: 7, shapeCategory: 'ROUND', lab: 'IGI', ctsMin: 10.00, ctsMax: 999, ratePerCt: 1500, effectiveFrom: '2024-01-01' },
  { id: 8, shapeCategory: 'ROUND', lab: 'GIA', ctsMin: 0.00, ctsMax: 0.49, ratePerCt: 950, effectiveFrom: '2024-01-01' },
  { id: 9, shapeCategory: 'ROUND', lab: 'GIA', ctsMin: 0.50, ctsMax: 0.99, ratePerCt: 1050, effectiveFrom: '2024-01-01' },
  { id: 10, shapeCategory: 'ROUND', lab: 'GIA', ctsMin: 1.00, ctsMax: 1.99, ratePerCt: 1150, effectiveFrom: '2024-01-01' },
  { id: 11, shapeCategory: 'ROUND', lab: 'GIA', ctsMin: 2.00, ctsMax: 2.99, ratePerCt: 1300, effectiveFrom: '2024-01-01' },
  { id: 12, shapeCategory: 'ROUND', lab: 'GIA', ctsMin: 3.00, ctsMax: 4.99, ratePerCt: 1450, effectiveFrom: '2024-01-01' },
  { id: 13, shapeCategory: 'ROUND', lab: 'GIA', ctsMin: 5.00, ctsMax: 9.99, ratePerCt: 1600, effectiveFrom: '2024-01-01' },
  { id: 14, shapeCategory: 'ROUND', lab: 'GIA', ctsMin: 10.00, ctsMax: 999, ratePerCt: 1800, effectiveFrom: '2024-01-01' },
  { id: 15, shapeCategory: 'FANCY', lab: 'IGI', ctsMin: 0.00, ctsMax: 0.49, ratePerCt: 850, effectiveFrom: '2024-01-01' },
  { id: 16, shapeCategory: 'FANCY', lab: 'IGI', ctsMin: 0.50, ctsMax: 0.99, ratePerCt: 950, effectiveFrom: '2024-01-01' },
  { id: 17, shapeCategory: 'FANCY', lab: 'IGI', ctsMin: 1.00, ctsMax: 1.99, ratePerCt: 1050, effectiveFrom: '2024-01-01' },
  { id: 18, shapeCategory: 'FANCY', lab: 'IGI', ctsMin: 2.00, ctsMax: 2.99, ratePerCt: 1150, effectiveFrom: '2024-01-01' },
  { id: 19, shapeCategory: 'FANCY', lab: 'IGI', ctsMin: 3.00, ctsMax: 4.99, ratePerCt: 1250, effectiveFrom: '2024-01-01' },
  { id: 20, shapeCategory: 'FANCY', lab: 'IGI', ctsMin: 5.00, ctsMax: 9.99, ratePerCt: 1400, effectiveFrom: '2024-01-01' },
  { id: 21, shapeCategory: 'FANCY', lab: 'IGI', ctsMin: 10.00, ctsMax: 999, ratePerCt: 1600, effectiveFrom: '2024-01-01' },
  { id: 22, shapeCategory: 'FANCY', lab: 'GIA', ctsMin: 0.00, ctsMax: 0.49, ratePerCt: 1000, effectiveFrom: '2024-01-01' },
  { id: 23, shapeCategory: 'FANCY', lab: 'GIA', ctsMin: 0.50, ctsMax: 0.99, ratePerCt: 1100, effectiveFrom: '2024-01-01' },
  { id: 24, shapeCategory: 'FANCY', lab: 'GIA', ctsMin: 1.00, ctsMax: 1.99, ratePerCt: 1200, effectiveFrom: '2024-01-01' },
  { id: 25, shapeCategory: 'FANCY', lab: 'GIA', ctsMin: 2.00, ctsMax: 2.99, ratePerCt: 1400, effectiveFrom: '2024-01-01' },
  { id: 26, shapeCategory: 'FANCY', lab: 'GIA', ctsMin: 3.00, ctsMax: 4.99, ratePerCt: 1550, effectiveFrom: '2024-01-01' },
  { id: 27, shapeCategory: 'FANCY', lab: 'GIA', ctsMin: 5.00, ctsMax: 9.99, ratePerCt: 1750, effectiveFrom: '2024-01-01' },
  { id: 28, shapeCategory: 'FANCY', lab: 'GIA', ctsMin: 10.00, ctsMax: 999, ratePerCt: 2000, effectiveFrom: '2024-01-01' },
  { id: 29, shapeCategory: 'BLOCKING', lab: 'ANY', ctsMin: 0.00, ctsMax: 1.99, ratePerCt: 700, effectiveFrom: '2024-01-01' },
  { id: 30, shapeCategory: 'BLOCKING', lab: 'ANY', ctsMin: 2.00, ctsMax: 4.99, ratePerCt: 800, effectiveFrom: '2024-01-01' },
  { id: 31, shapeCategory: 'BLOCKING', lab: 'ANY', ctsMin: 5.00, ctsMax: 999, ratePerCt: 900, effectiveFrom: '2024-01-01' },
];

export const salaryPeriods: SalaryPeriod[] = [
  { id: 1, label: 'July 2026', fromDate: '2026-07-01', toDate: '2026-07-31', status: 'OPEN' },
  { id: 2, label: 'June 2026', fromDate: '2026-06-01', toDate: '2026-06-30', status: 'PAID' },
  { id: 3, label: 'May 2026', fromDate: '2026-05-01', toDate: '2026-05-31', status: 'PAID' },
];

export const salaryLines: SalaryLine[] = [
  { id: 1, periodId: 1, employeeId: 1, employeeName: 'Jayesh Kumar Arora', empCode: '301', totalCts: 124.5, totalAmount: 48200, managerVerified: true, accountVerified: false, lotsCount: 11 },
  { id: 2, periodId: 1, employeeId: 2, employeeName: 'Priya Mehta', empCode: '302', totalCts: 89.2, totalAmount: 38600, managerVerified: true, accountVerified: false, lotsCount: 8 },
  { id: 3, periodId: 1, employeeId: 3, employeeName: 'Ramesh Patel', empCode: '303', totalCts: 203.8, totalAmount: 61400, managerVerified: false, accountVerified: false, lotsCount: 16 },
  { id: 4, periodId: 1, employeeId: 4, employeeName: 'Dharampal Singh', empCode: 'DHAR-401', totalCts: 45.0, totalAmount: 22800, managerVerified: true, accountVerified: false, lotsCount: 4 },
  { id: 5, periodId: 1, employeeId: 5, employeeName: 'Suresh Bhai', empCode: '304', totalCts: 110.4, totalAmount: 29700, managerVerified: false, accountVerified: false, lotsCount: 9 },
  { id: 6, periodId: 1, employeeId: 6, employeeName: 'Maxi Unit', empCode: 'MAXI', totalCts: 312.6, totalAmount: 124500, managerVerified: true, accountVerified: false, lotsCount: 22 },
  { id: 7, periodId: 1, employeeId: 7, employeeName: 'Kishore Nayak', empCode: '305', totalCts: 58.3, totalAmount: 18400, managerVerified: false, accountVerified: false, lotsCount: 6 },
  { id: 8, periodId: 1, employeeId: 8, employeeName: 'Anita Shah', empCode: '306', totalCts: 98.7, totalAmount: 44300, managerVerified: true, accountVerified: false, lotsCount: 9 },
  { id: 9, periodId: 1, employeeId: 10, employeeName: 'Lalita Bai', empCode: '308', totalCts: 176.2, totalAmount: 52100, managerVerified: false, accountVerified: false, lotsCount: 14 },
];

export const kpiData: KPIData = {
  yieldPct: 68.4,
  wipCarats: 81.9,
  wipValue: 8420000,
  avgDaysConsumed: 17.4,
  labourPerCt: 980,
  onTimePct: 82.3,
  reworkPct: 4.2,
  totalLots: 15,
  activeLots: 7,
  leakageExceptions: 1,
};

export const yieldTrend = [
  { month: 'Aug', yield: 65.2, target: 68 },
  { month: 'Sep', yield: 66.8, target: 68 },
  { month: 'Oct', yield: 67.1, target: 68 },
  { month: 'Nov', yield: 69.4, target: 68 },
  { month: 'Dec', yield: 68.2, target: 68 },
  { month: 'Jan', yield: 70.1, target: 68 },
  { month: 'Feb', yield: 67.8, target: 68 },
  { month: 'Mar', yield: 69.6, target: 68 },
  { month: 'Apr', yield: 71.2, target: 68 },
  { month: 'May', yield: 68.9, target: 68 },
  { month: 'Jun', yield: 70.4, target: 68 },
  { month: 'Jul', yield: 68.4, target: 68 },
];

export const caratFlow = [
  { name: 'Issued', value: 345.5, fill: '#6B7280' },
  { name: 'Polished', value: 236.4, fill: '#16A34A' },
  { name: 'Leakage', value: 89.6, fill: '#DC2626' },
  { name: 'Rework', value: 12.2, fill: '#CA8A04' },
  { name: 'Lost', value: 7.3, fill: '#9CA3AF' },
];

export const statusDist = [
  { name: 'Issued', value: 4, color: '#9CA3AF' },
  { name: 'In Progress', value: 3, color: '#CA8A04' },
  { name: 'Received', value: 1, color: '#2563EB' },
  { name: 'Verified', value: 6, color: '#16A34A' },
  { name: 'Rework', value: 1, color: '#EA580C' },
  { name: 'Lost', value: 0, color: '#DC2626' },
];

export const workerLeaderboard = employees
  .filter(e => e.workStatus === 'WORKING' && e.empCode !== 'MAXI')
  .sort((a, b) => b.yieldPct - a.yieldPct)
  .slice(0, 6);
