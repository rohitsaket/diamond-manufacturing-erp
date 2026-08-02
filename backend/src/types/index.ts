export type LotStatus = 'ISSUED' | 'IN_PROGRESS' | 'RECEIVED' | 'VERIFIED' | 'REWORK' | 'LOST';
export type WorkerType = 'PIECE_RATE' | 'DHAR' | 'MAXI';
export type WorkStatus = 'WORKING' | 'RESIGN';
export type LabType = 'IGI' | 'GIA' | 'US';
export type ShapeCategory = 'ROUND' | 'FANCY' | 'BLOCKING';
export type SalaryPeriodStatus = 'OPEN' | 'LOCKED' | 'PAID';
export type RateCardLab = 'IGI' | 'GIA' | 'ANY';
export type AuditChangeType = 'increase' | 'decrease' | 'bulk';
export type UserRole = 'admin' | 'manager' | 'operator' | 'accountant' | 'hr' | 'employee';

export * from './hrms';
export * from './profile';

// Database row types (snake_case columns)
export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  last_login_at: string | null;
  employee_id: number | null;
  phone: string | null;
  avatar_url: string | null;
  theme: 'light' | 'dark' | 'system';
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface EmployeeRow {
  id: number;
  emp_code: string;
  full_name: string;
  short_name: string;
  grade: string;
  worker_type: WorkerType;
  work_status: WorkStatus;
  whatsapp: string | null;
  joined_at: string;
  resigned_at: string | null;
  address: string | null;
  city: string | null;
  dob: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
  blood_group: string | null;
  aadhaar_number: string | null;
  pan: string | null;
  bank_name: string | null;
  bank_account: string | null;
  bank_ifsc: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  photo_url: string | null;
  department: string | null;
  designation: string | null;
  reporting_manager_id: number | null;
  monthly_salary: number | null;
  pf_applicable: boolean;
  esi_applicable: boolean;
  shift_id: number | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface EmployeeSpecialistRow {
  id: number;
  employee_id: number;
  specialist_code: string;
}

export interface LabourHeadRow {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
}

export interface ShapeRow {
  id: number;
  name: string;
  shape_category: ShapeCategory;
}

export interface LotRow {
  id: number;
  lot_id: string;
  lot_name: string;
  employee_id: number;
  shape: string;
  shape_category: ShapeCategory;
  qty: number;
  issue_weight: number;
  estimate_wt: number;
  issue_date: string;
  labour_head_id: number;
  status: LotStatus;
  received_date: string | null;
  polished_wt: number | null;
  color: string | null;
  clarity: string | null;
  cut: string | null;
  grader: string | null;
  lab: LabType | null;
  remarks: string | null;
  days_consumed: number | null;
  weight_diff: number | null;
  labour_amount: number | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface RateCardRow {
  id: number;
  shape_category: ShapeCategory;
  lab: RateCardLab;
  cts_min: number;
  cts_max: number;
  rate_per_ct: number;
  effective_from: string;
  is_active: boolean;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SalaryPeriodRow {
  id: number;
  label: string;
  from_date: string;
  to_date: string;
  status: SalaryPeriodStatus;
  locked_at: string | null;
  paid_at: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SalaryLineRow {
  id: number;
  period_id: number;
  employee_id: number;
  total_cts: number;
  total_amount: number;
  lots_count: number;
  manager_verified: boolean;
  manager_verified_by: number | null;
  manager_verified_at: string | null;
  account_verified: boolean;
  account_verified_by: number | null;
  account_verified_at: string | null;
  paid_at: string | null;
  worker_type: WorkerType | null;
  paid_days: number;
  period_days: number;
  present_days: number;
  absent_days: number;
  leave_days: number;
  ot_hours: number;
  earn_piece: number;
  earn_fixed: number;
  earn_ot: number;
  gross_amount: number;
  ded_pf: number;
  ded_esi: number;
  ded_pt: number;
  ded_advance: number;
  ded_other: number;
  total_deductions: number;
  net_amount: number;
  recalculated_at: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface RateCardAuditLogRow {
  id: number;
  rate_card_row_id: number | null;
  actor: string;
  change_description: string;
  change_type: AuditChangeType;
  old_rate: number | null;
  new_rate: number | null;
  created_at: string;
}

export interface SettingRow {
  id: number;
  key: string;
  value: string;
  description: string | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

// API response types (camelCase)
export interface EmployeeResponse {
  id: number;
  empCode: string;
  fullName: string;
  shortName: string;
  grade: string;
  specialist: string[];
  workerType: WorkerType;
  workStatus: WorkStatus;
  lotsInHand: number;
  totalCts: number;
  yieldPct: number;
  periodSalary: number;
  whatsapp: string | null;
  joinedAt: string;
  /** Org placement, surfaced so directory and compliance filters can populate. */
  department?: string | null;
  branch?: string | null;
  designation?: string | null;
}

export interface LotResponse {
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
  receivedDate: string | null;
  polishedWt: number | null;
  color: string | null;
  clarity: string | null;
  cut: string | null;
  grader: string | null;
  lab: LabType | null;
  labourHead: string;
  remarks: string | null;
  status: LotStatus;
  daysConsumed: number | null;
  weightDiff: number | null;
  labourAmount: number | null;
}

export interface RateCardResponse {
  id: number;
  shapeCategory: ShapeCategory;
  lab: RateCardLab;
  ctsMin: number;
  ctsMax: number;
  ratePerCt: number;
  effectiveFrom: string;
}

export interface SalaryPeriodResponse {
  id: number;
  label: string;
  fromDate: string;
  toDate: string;
  status: SalaryPeriodStatus;
}

export interface SalaryLineResponse {
  id: number;
  periodId: number;
  employeeId: number;
  employeeName: string;
  empCode: string;
  totalCts: number;
  totalAmount: number;
  managerVerified: boolean;
  accountVerified: boolean;
  paidAt: string | null;
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

export interface AuditEntryResponse {
  date: string;
  actor: string;
  change: string;
  type: AuditChangeType;
}

export interface YieldTrendPoint {
  month: string;
  yield: number;
  target: number;
}

export interface CaratFlowItem {
  name: string;
  value: number;
  fill: string;
}

export interface StatusDistItem {
  name: string;
  value: number;
  color: string;
}

export interface LeaderboardEntry {
  id: number;
  name: string;
  shortName: string;
  yieldPct: number;
  totalCts: number;
  grade: string;
}

export interface ExceptionItem {
  type: 'leakage' | 'overdue' | 'rework';
  title: string;
  detail: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface LotFilterParams extends PaginationParams {
  search?: string;
  status?: LotStatus;
  lab?: LabType;
  employeeId?: number;
}
