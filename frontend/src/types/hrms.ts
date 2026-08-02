// HRMS domain types. These mirror the backend response shapes in
// backend/src/types/hrms.ts — keep the two in step when either changes.

export type WorkerType = 'PIECE_RATE' | 'DHAR' | 'MAXI';

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LEAVE' | 'HOLIDAY' | 'WEEK_OFF';
export type AttendanceSource = 'MANUAL' | 'IMPORT' | 'LEAVE_SYNC' | 'SELF_PUNCH';

export interface AttendanceRecord {
  id: number | null;
  employeeId: number;
  employeeName: string;
  empCode: string;
  workerType: WorkerType;
  date: string;
  status: AttendanceStatus | null;
  shiftId: number | null;
  leaveTypeId: number | null;
  inTime: string | null;
  outTime: string | null;
  workedHours: number | null;
  otHours: number;
  isLate: boolean;
  source: AttendanceSource | null;
  remarks: string | null;
}

export interface RegisterDayCell {
  status: AttendanceStatus;
  otHours: number;
}

export interface RegisterRow {
  employeeId: number;
  employeeName: string;
  empCode: string;
  workerType: WorkerType;
  days: Record<string, RegisterDayCell>;
  totals: {
    present: number;
    absent: number;
    halfDay: number;
    leave: number;
    holiday: number;
    weekOff: number;
    otHours: number;
    paidDays: number;
    attendancePct: number;
  };
}

export interface Shift {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  graceMinutes: number;
  weekOffDay: number;
  isDefault: boolean;
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
  isOptional: boolean;
}

export interface PunchImportResult {
  imported: number;
  skipped: number;
  errors: { line: number; reason: string }[];
}

export type LeaveRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveType {
  id: number;
  code: string;
  name: string;
  annualQuota: number;
  isPaid: boolean;
  color: string;
}

export interface LeaveRequest {
  id: number;
  employeeId: number;
  employeeName: string;
  empCode: string;
  leaveTypeId: number;
  leaveTypeName: string;
  leaveTypeCode: string;
  isPaid: boolean;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string | null;
  status: LeaveRequestStatus;
  appliedBySelf: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface LeaveBalance {
  employeeId: number;
  employeeName?: string;
  empCode?: string;
  leaveTypeId: number;
  leaveTypeCode: string;
  leaveTypeName: string;
  isPaid: boolean;
  year: number;
  allocated: number;
  used: number;
  balance: number;
}

export type AdvanceType = 'ADVANCE' | 'LOAN';
export type AdvanceStatus = 'ACTIVE' | 'CLOSED' | 'WRITTEN_OFF';

export interface Advance {
  id: number;
  employeeId: number;
  employeeName: string;
  empCode: string;
  advanceType: AdvanceType;
  amount: number;
  advanceDate: string;
  reason: string | null;
  installmentAmount: number;
  recovered: number;
  outstanding: number;
  status: AdvanceStatus;
  createdAt: string;
}

export interface AdvanceRecovery {
  id: number;
  advanceId: number;
  periodId: number | null;
  periodLabel: string | null;
  amount: number;
  recoveredOn: string;
  source: 'PAYROLL' | 'MANUAL';
  remarks: string | null;
}

export type CandidateStatus = 'APPLIED' | 'INTERVIEW' | 'SELECTED' | 'JOINED' | 'REJECTED';
export type JobOpeningStatus = 'OPEN' | 'ON_HOLD' | 'CLOSED';

export interface Candidate {
  id: number;
  fullName: string;
  phone: string;
  email: string | null;
  openingId: number | null;
  openingTitle: string | null;
  positionGrade: string;
  workerType: WorkerType;
  expectedSalary: number | null;
  experienceYears: number | null;
  source: string | null;
  status: CandidateStatus;
  interviewDate: string | null;
  notes: string | null;
  convertedEmployeeId: number | null;
  createdAt: string;
}

export interface JobOpening {
  id: number;
  title: string;
  department: string | null;
  grade: string | null;
  workerType: WorkerType;
  openings: number;
  status: JobOpeningStatus;
  openedAt: string;
  closedAt: string | null;
  notes: string | null;
  candidateCount: number;
}

export interface EmployeeProfile {
  employeeId: number;
  empCode: string;
  fullName: string;
  shortName: string;
  grade: string;
  workerType: WorkerType;
  workStatus: string;
  whatsapp: string | null;
  joinedAt: string;
  resignedAt: string | null;
  address: string | null;
  city: string | null;
  dob: string | null;
  gender: string | null;
  bloodGroup: string | null;
  aadhaarMasked: string | null;
  hasAadhaar: boolean;
  pan: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  photoUrl: string | null;
  department: string | null;
  designation: string | null;
  reportingManagerId: number | null;
  reportingManagerName: string | null;
  monthlySalary: number | null;
  pfApplicable: boolean;
  esiApplicable: boolean;
  shiftId: number | null;
  shiftName: string | null;
  hasLogin: boolean;
}

export interface EmployeeDocument {
  id: number;
  employeeId: number;
  docType: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  verified: boolean;
  verifiedAt: string | null;
  uploadedAt: string;
}

export interface KpiCard {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  trendPct?: number | null;
  comparisonLabel?: string | null;
  spark?: number[];
  intent?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  page?: string;
}

export interface DashboardPayload {
  kpis: KpiCard[];
  widgets: Record<string, any>;
}

export interface RecalculateResult {
  periodId: number;
  linesWritten: number;
  linesRemoved: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  warnings: string[];
}

export interface ComplianceSummary {
  periodId: number;
  periodLabel: string;
  fromDate: string;
  toDate: string;
  employeeCount: number;
  totalGross: number;
  totalPf: number;
  totalEsi: number;
  totalPt: number;
  totalAdvance: number;
  totalDeductions: number;
  totalNet: number;
  rows: {
    employeeId: number;
    empCode: string;
    employeeName: string;
    grossAmount: number;
    dedPf: number;
    dedEsi: number;
    dedPt: number;
    netAmount: number;
  }[];
}

export interface Payslip {
  lineId: number;
  period: { id: number; label: string; fromDate: string; toDate: string; status: string };
  employee: {
    id: number;
    empCode: string;
    fullName: string;
    grade: string;
    workerType: WorkerType;
    department: string | null;
    designation: string | null;
    joinedAt: string;
    bankAccount: string | null;
    bankIfsc: string | null;
    whatsapp: string | null;
  };
  attendance: {
    paidDays: number;
    periodDays: number;
    presentDays: number;
    absentDays: number;
    leaveDays: number;
    otHours: number;
  };
  earnings: { label: string; amount: number }[];
  deductions: { label: string; amount: number }[];
  grossAmount: number;
  totalDeductions: number;
  netAmount: number;
  advanceRecoveries: AdvanceRecovery[];
}

export interface AppNotification {
  id: number;
  category: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  title: string;
  body: string | null;
  linkPage: string | null;
  linkRefId: number | null;
  isRead: boolean;
  isArchived: boolean;
  snoozedUntil: string | null;
  createdAt: string;
}

export interface ActivityEntry {
  id: number;
  actorName: string | null;
  employeeId: number | null;
  entityType: string;
  entityId: number | null;
  action: string;
  summary: string;
  createdAt: string;
}

/** Shared presentation config for attendance statuses. */
export const ATTENDANCE_STYLE: Record<
  AttendanceStatus,
  { letter: string; label: string; chip: string; cell: string }
> = {
  PRESENT: {
    letter: 'P',
    label: 'Present',
    chip: 'bg-success-light text-success border-success/30',
    cell: 'bg-success-light text-success',
  },
  ABSENT: {
    letter: 'A',
    label: 'Absent',
    chip: 'bg-danger-light text-danger border-danger/30',
    cell: 'bg-danger-light text-danger',
  },
  HALF_DAY: {
    letter: '½',
    label: 'Half day',
    chip: 'bg-warning-light text-warning border-warning/30',
    cell: 'bg-warning-light text-warning',
  },
  LEAVE: {
    letter: 'L',
    label: 'Leave',
    chip: 'bg-info-light text-info border-info/30',
    cell: 'bg-info-light text-info',
  },
  HOLIDAY: {
    letter: 'H',
    label: 'Holiday',
    chip: 'bg-bg-hover text-text-secondary border-border-default',
    cell: 'bg-bg-hover text-text-secondary',
  },
  WEEK_OFF: {
    letter: 'W',
    label: 'Week off',
    chip: 'bg-bg-hover text-text-muted border-border-default',
    cell: 'bg-bg-hover text-text-muted',
  },
};

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'PRESENT',
  'ABSENT',
  'HALF_DAY',
  'LEAVE',
  'HOLIDAY',
  'WEEK_OFF',
];
