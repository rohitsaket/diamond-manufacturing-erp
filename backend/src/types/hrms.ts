import { WorkerType } from './index';

// ---------------------------------------------------------------------------
// Enums / unions
// ---------------------------------------------------------------------------
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LEAVE' | 'HOLIDAY' | 'WEEK_OFF';
export type AttendanceSource = 'MANUAL' | 'IMPORT' | 'LEAVE_SYNC' | 'SELF_PUNCH';
export type LeaveRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type AdvanceType = 'ADVANCE' | 'LOAN';
export type AdvanceStatus = 'ACTIVE' | 'CLOSED' | 'WRITTEN_OFF';
export type RecoverySource = 'PAYROLL' | 'MANUAL';
export type CandidateStatus = 'APPLIED' | 'INTERVIEW' | 'SELECTED' | 'JOINED' | 'REJECTED';
export type JobOpeningStatus = 'OPEN' | 'ON_HOLD' | 'CLOSED';
export type DocumentType = 'AADHAAR' | 'PAN' | 'BANK_PASSBOOK' | 'PHOTO' | 'AGREEMENT' | 'CERTIFICATE' | 'OTHER';
export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketCategory = 'HR' | 'PAYROLL' | 'IT' | 'FACILITY' | 'OTHER';
export type ExpenseStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REIMBURSED';
export type ExpenseCategory = 'TRAVEL' | 'FOOD' | 'TOOLS' | 'MEDICAL' | 'OTHER';
export type AssetStatus = 'AVAILABLE' | 'ASSIGNED' | 'REPAIR' | 'RETIRED';
export type NotificationCategory =
  | 'LEAVE' | 'ATTENDANCE' | 'PAYROLL' | 'TRAINING' | 'POLICY'
  | 'SECURITY' | 'SYSTEM' | 'RECRUITMENT' | 'EXPENSE' | 'TASK' | 'HELPDESK' | 'ASSET';
export type NotificationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type EmailStatus = 'NONE' | 'PENDING' | 'SENT' | 'FAILED';
export type TrainingStatus = 'PLANNED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';
export type DashboardKey = 'employee' | 'manager' | 'hr' | 'executive';

// ---------------------------------------------------------------------------
// Shifts / holidays
// ---------------------------------------------------------------------------
export interface ShiftRow {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  grace_minutes: number;
  week_off_day: number;
  is_default: boolean;
  deleted_at: string | null;
}

export interface ShiftResponse {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  graceMinutes: number;
  weekOffDay: number;
  isDefault: boolean;
}

export interface HolidayRow {
  id: number;
  holiday_date: string;
  name: string;
  year_hint: number;
  is_optional: boolean;
}

export interface HolidayResponse {
  id: number;
  date: string;
  name: string;
  isOptional: boolean;
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
export interface AttendanceRow {
  id: number;
  employee_id: number;
  att_date: string;
  status: AttendanceStatus;
  shift_id: number | null;
  leave_type_id: number | null;
  in_time: string | null;
  out_time: string | null;
  worked_hours: number | null;
  ot_hours: number;
  is_late: boolean;
  source: AttendanceSource;
  remarks: string | null;
}

export interface AttendanceResponse {
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

export interface AttendanceUpsertEntry {
  employeeId: number;
  attDate: string;
  status: AttendanceStatus;
  shiftId?: number | null;
  leaveTypeId?: number | null;
  inTime?: string | null;
  outTime?: string | null;
  workedHours?: number | null;
  otHours?: number;
  isLate?: boolean;
  source?: AttendanceSource;
  remarks?: string | null;
}

export interface RegisterDayCell {
  status: AttendanceStatus;
  otHours: number;
}

export interface RegisterRowResponse {
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

export interface PunchImportResult {
  imported: number;
  skipped: number;
  errors: { line: number; reason: string }[];
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------
export interface LeaveTypeRow {
  id: number;
  code: string;
  name: string;
  annual_quota: number;
  is_paid: boolean;
  color: string;
  deleted_at: string | null;
}

export interface LeaveTypeResponse {
  id: number;
  code: string;
  name: string;
  annualQuota: number;
  isPaid: boolean;
  color: string;
}

export interface LeaveRequestRow {
  id: number;
  employee_id: number;
  leave_type_id: number;
  from_date: string;
  to_date: string;
  days: number;
  reason: string | null;
  status: LeaveRequestStatus;
  applied_by_self: boolean;
  decided_by: number | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface LeaveRequestResponse {
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

export interface LeaveBalanceResponse {
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

// ---------------------------------------------------------------------------
// Advances
// ---------------------------------------------------------------------------
export interface AdvanceRow {
  id: number;
  employee_id: number;
  advance_type: AdvanceType;
  amount: number;
  advance_date: string;
  reason: string | null;
  installment_amount: number;
  status: AdvanceStatus;
  closed_at: string | null;
}

export interface AdvanceResponse {
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

export interface AdvanceRecoveryResponse {
  id: number;
  advanceId: number;
  periodId: number | null;
  periodLabel: string | null;
  amount: number;
  recoveredOn: string;
  source: RecoverySource;
  remarks: string | null;
}

// ---------------------------------------------------------------------------
// Employee profile / documents
// ---------------------------------------------------------------------------
export interface EmployeeProfileResponse {
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

export interface EmployeeDocumentResponse {
  id: number;
  employeeId: number;
  docType: DocumentType;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  verified: boolean;
  verifiedAt: string | null;
  uploadedAt: string;
}

// ---------------------------------------------------------------------------
// Payroll (extended)
// ---------------------------------------------------------------------------
export interface SalaryLineExtendedResponse {
  id: number;
  periodId: number;
  employeeId: number;
  employeeName: string;
  empCode: string;
  whatsapp: string | null;
  workerType: WorkerType | null;
  totalCts: number;
  totalAmount: number;
  lotsCount: number;
  paidDays: number;
  periodDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  otHours: number;
  earnPiece: number;
  earnFixed: number;
  earnOt: number;
  grossAmount: number;
  dedPf: number;
  dedEsi: number;
  dedPt: number;
  dedAdvance: number;
  dedOther: number;
  totalDeductions: number;
  netAmount: number;
  managerVerified: boolean;
  accountVerified: boolean;
  paidAt: string | null;
  recalculatedAt: string | null;
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

export interface ComplianceSummaryResponse {
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

export interface PayslipResponse {
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
  advanceRecoveries: AdvanceRecoveryResponse[];
}

export interface StatutoryConfig {
  pfEnabled: boolean;
  pfRatePct: number;
  pfCeiling: number;
  esiEnabled: boolean;
  esiRatePct: number;
  esiCeiling: number;
  ptEnabled: boolean;
  ptSlabs: { upTo: number | null; amount: number }[];
  otRatePerHour: number;
  fullDayHours: number;
  halfDayHours: number;
  otMinMinutes: number;
}

// ---------------------------------------------------------------------------
// Recruitment
// ---------------------------------------------------------------------------
export interface CandidateResponse {
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

export interface JobOpeningResponse {
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

// ---------------------------------------------------------------------------
// Engagement: tasks, tickets, expenses, assets, announcements, trainings
// ---------------------------------------------------------------------------
export interface TaskResponse {
  id: number;
  title: string;
  description: string | null;
  employeeId: number;
  employeeName: string;
  priority: Priority;
  status: TaskStatus;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface TicketResponse {
  id: number;
  ticketNo: string;
  employeeId: number;
  employeeName: string;
  category: TicketCategory;
  subject: string;
  description: string | null;
  priority: Priority;
  status: TicketStatus;
  assignedTo: number | null;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
}

export interface ExpenseResponse {
  id: number;
  employeeId: number;
  employeeName: string;
  category: ExpenseCategory;
  amount: number;
  expenseDate: string;
  description: string | null;
  status: ExpenseStatus;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface AssetResponse {
  id: number;
  assetCode: string;
  name: string;
  category: string;
  serialNo: string | null;
  status: AssetStatus;
  assignedToId: number | null;
  assignedToName: string | null;
  assignedOn: string | null;
}

export interface AnnouncementResponse {
  id: number;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  publishFrom: string;
  publishTo: string | null;
  audience: string;
  createdAt: string;
}

export interface CompanyEventResponse {
  id: number;
  title: string;
  eventType: string;
  startAt: string;
  endAt: string | null;
  location: string | null;
  description: string | null;
}

export interface TrainingResponse {
  id: number;
  title: string;
  description: string | null;
  trainer: string | null;
  startDate: string;
  endDate: string | null;
  status: TrainingStatus;
  enrolledCount: number;
  completedCount: number;
}

// ---------------------------------------------------------------------------
// Notifications / activity
// ---------------------------------------------------------------------------
export interface NotificationResponse {
  id: number;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  linkPage: string | null;
  linkRefId: number | null;
  isRead: boolean;
  isArchived: boolean;
  snoozedUntil: string | null;
  createdAt: string;
}

export interface CreateNotificationInput {
  userId: number;
  category: NotificationCategory;
  priority?: NotificationPriority;
  title: string;
  body?: string | null;
  linkPage?: string | null;
  linkRefId?: number | null;
  email?: boolean;
  createdBy?: number | null;
}

export interface ActivityResponse {
  id: number;
  actorName: string | null;
  employeeId: number | null;
  entityType: string;
  entityId: number | null;
  action: string;
  summary: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Calendar / search / dashboards
// ---------------------------------------------------------------------------
export interface CalendarEventResponse {
  id: string;
  type: 'HOLIDAY' | 'LEAVE' | 'BIRTHDAY' | 'ANNIVERSARY' | 'TRAINING' | 'MEETING' | 'EVENT' | 'PAYROLL';
  title: string;
  date: string;
  endDate: string | null;
  detail: string | null;
  employeeId: number | null;
}

export interface SearchResultItem {
  type: 'employee' | 'lot' | 'leave' | 'advance' | 'candidate' | 'ticket' | 'asset' | 'document' | 'period';
  id: number;
  title: string;
  subtitle: string | null;
  page: string;
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

export interface DashboardLayoutResponse {
  dashboardKey: DashboardKey;
  layoutName: string;
  isActive: boolean;
  layout: WidgetLayoutItem[];
}

export interface WidgetLayoutItem {
  widgetKey: string;
  order: number;
  colSpan: number;
  hidden: boolean;
  collapsed: boolean;
  pinned: boolean;
}
