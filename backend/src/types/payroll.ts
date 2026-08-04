/**
 * Shared payroll types for the enterprise engine.
 *
 * Everything the payroll controllers, the calculation engine and the background
 * job layer exchange is declared here so the modules stay decoupled: nobody has
 * to import a service just to name a shape.
 *
 * Naming rule: rows read straight out of MySQL keep their snake_case column
 * names (`PayComponentRow`), computed application objects use camelCase.
 */

// ---------------------------------------------------------------------------
// Enumerations mirrored from the schema (migrations 061-070)
// ---------------------------------------------------------------------------

export type ComponentType = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION' | 'REIMBURSEMENT';

export type ComponentCategory =
  | 'BASIC' | 'ALLOWANCE' | 'BONUS' | 'INCENTIVE' | 'VARIABLE_PAY' | 'OVERTIME' | 'ARREARS'
  | 'STATUTORY' | 'LOAN' | 'ATTENDANCE' | 'REIMBURSEMENT' | 'OTHER';

export type CalculationType =
  | 'FIXED' | 'PERCENT_OF' | 'FORMULA' | 'ATTENDANCE_BASED' | 'SLAB' | 'PIECE_RATE' | 'MANUAL';

/** The base a PERCENT_OF component is measured against. */
export type PercentBase = 'BASIC' | 'GROSS' | 'CTC' | 'NET';

export type RoundingMode = 'NONE' | 'NEAREST' | 'UP' | 'DOWN';

export type LopBasis = 'CALENDAR_DAYS' | 'WORKING_DAYS' | 'FIXED_DAYS';

export type PayFrequency = 'MONTHLY' | 'WEEKLY' | 'BI_WEEKLY' | 'DAILY' | 'SEMI_MONTHLY';

export type PayrollRunType =
  | 'REGULAR' | 'OFF_CYCLE' | 'RETRO' | 'ARREARS' | 'FINAL_SETTLEMENT' | 'BONUS' | 'SIMULATION';

export type PayrollRunStatus =
  | 'DRAFT' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'LOCKED' | 'PAID';

export type EmployeeSalaryStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'SUPERSEDED';

export type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type SettlementType = 'RESIGNATION' | 'RETIREMENT' | 'TERMINATION' | 'DEATH' | 'END_OF_CONTRACT';

// ---------------------------------------------------------------------------
// Master data rows
// ---------------------------------------------------------------------------

export interface PayComponentRow {
  id: number;
  code: string;
  name: string;
  component_type: ComponentType;
  category: ComponentCategory;
  calculation_type: CalculationType;
  percent_of: PercentBase | null;
  default_value: number | null;
  default_percent: number | null;
  formula: string | null;
  is_taxable: boolean | number;
  is_pf_applicable: boolean | number;
  is_esi_applicable: boolean | number;
  is_prorated: boolean | number;
  affects_gross: boolean | number;
  is_statutory: boolean | number;
  is_system: boolean | number;
  display_order: number;
  is_active: boolean | number;
}

export interface SalaryStructureRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  currency: string;
  country: string;
  grade: string | null;
  designation: string | null;
  department: string | null;
  branch: string | null;
  worker_type: 'PIECE_RATE' | 'DHAR' | 'MAXI' | null;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean | number;
}

export interface SalaryStructureLineRow {
  id: number;
  structure_id: number;
  component_id: number;
  calculation_type: CalculationType | null;
  percent_of: PercentBase | null;
  amount: number | null;
  percent_value: number | null;
  min_amount: number | null;
  max_amount: number | null;
  display_order: number;
}

export interface EmployeeSalaryRow {
  id: number;
  employee_id: number;
  structure_id: number | null;
  currency: string;
  annual_ctc: number | null;
  monthly_gross: number | null;
  effective_from: string;
  effective_to: string | null;
  revision_type: string;
  status: EmployeeSalaryStatus;
}

export interface EmployeeSalaryComponentRow {
  id: number;
  employee_salary_id: number;
  component_id: number;
  amount: number | null;
  percent_value: number | null;
  calculation_type: CalculationType | null;
  percent_of: PercentBase | null;
}

export interface PayCycleRow {
  id: number;
  code: string;
  name: string;
  frequency: PayFrequency;
  currency: string;
  country: string;
  company: string | null;
  branch: string | null;
  cycle_start_day: number;
  cutoff_day: number | null;
  pay_day: number | null;
  rounding_mode: RoundingMode;
  rounding_precision: number;
  lop_basis: LopBasis;
  fixed_days_per_month: number | null;
  is_default: boolean | number;
  is_active: boolean | number;
}

export interface OvertimeRuleRow {
  id: number;
  code: string;
  name: string;
  ot_kind: 'REGULAR' | 'WEEKEND' | 'HOLIDAY' | 'NIGHT_SHIFT';
  rate_type: 'FLAT_HOURLY' | 'MULTIPLIER';
  flat_rate: number | null;
  multiplier: number | null;
  min_minutes: number;
  max_hours_per_day: number | null;
  max_hours_per_month: number | null;
  grade: string | null;
  branch: string | null;
  is_active: boolean | number;
}

/**
 * One employee's effective compensation: the revision, the structure behind it
 * and the component lines that actually apply (employee overrides first, the
 * structure's own lines as the fallback).
 */
export interface EffectiveComponentLine {
  componentId: number;
  calculationType: CalculationType | null;
  percentOf: PercentBase | null;
  amount: number | null;
  percentValue: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  displayOrder: number;
  /** Where the line came from, useful when explaining a payslip. */
  source: 'EMPLOYEE' | 'STRUCTURE';
}

export interface EmployeeCompensation {
  employeeId: number;
  salary: EmployeeSalaryRow;
  structure: SalaryStructureRow | null;
  lines: EffectiveComponentLine[];
  monthlyCtc: number;
  monthlyGross: number;
}

// ---------------------------------------------------------------------------
// Engine input / output
// ---------------------------------------------------------------------------

export interface PayrollRunFilters {
  department?: string | null;
  grade?: string | null;
  branch?: string | null;
  workerType?: 'PIECE_RATE' | 'DHAR' | 'MAXI' | null;
}

export interface PayrollRunInput {
  periodId: number;
  /**
   * Accepts a raw string so a controller can pass request input straight
   * through; the engine normalises anything unrecognised to REGULAR.
   */
  runType: PayrollRunType | string;
  employeeIds?: number[];
  filters?: PayrollRunFilters;
  isSimulation: boolean;
  userId: number;
  actorName: string;
  /** Set when the run is executing inside a background job, for progress reporting. */
  jobId?: number;
  label?: string;
  /** Retro corrections injected as an ARREARS earning, keyed by employee id. */
  arrears?: Record<number, number>;
}

/** One resolved component on a payslip; mirrors `salary_line_components`. */
export interface SalaryLineComponentRow {
  componentId: number | null;
  componentCode: string;
  componentName: string;
  componentType: ComponentType;
  category: ComponentCategory | string | null;
  amount: number;
  baseAmount: number | null;
  percentApplied: number | null;
  isTaxable: boolean;
  isProrated: boolean;
  displayOrder: number;
}

/** Everything the engine computed for one employee in one period. */
export interface EmployeePayComputation {
  employeeId: number;
  empCode: string;
  fullName: string;
  workerType: 'PIECE_RATE' | 'DHAR' | 'MAXI' | null;
  structureId: number | null;
  currency: string;

  periodDays: number;
  paidDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  lopDays: number;
  payableDays: number;
  otHours: number;
  totalCts: number;
  lotsCount: number;

  earnPiece: number;
  earnFixed: number;
  earnOt: number;
  earnBonus: number;
  earnIncentive: number;
  earnVariable: number;
  earnArrears: number;
  earnReimbursement: number;
  grossAmount: number;
  taxableIncome: number;

  dedPf: number;
  dedEsi: number;
  dedPt: number;
  dedIncomeTax: number;
  dedLwf: number;
  dedInsurance: number;
  dedLoan: number;
  dedAdvance: number;
  dedOther: number;
  totalDeductions: number;
  netAmount: number;

  employerPf: number;
  employerEsi: number;
  employerCost: number;

  components: SalaryLineComponentRow[];
  /** Loan installments this computation intends to recover (written post-line). */
  loanRecoveries: { installmentId: number; loanId: number; amount: number }[];
  /** Advance recoveries this computation intends to post. */
  advanceRecoveries: { advanceId: number; amount: number; closes: boolean }[];
  warnings: string[];
}

export interface PayrollRunSummary {
  runId: number;
  periodId: number;
  runType: PayrollRunType;
  status: PayrollRunStatus;
  isSimulation: boolean;
  totalEmployees: number;
  processedEmployees: number;
  failedEmployees: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerCost: number;
  durationMs: number;
}

export interface PayrollRunError {
  employeeId: number | null;
  code: string;
  message: string;
  severity: 'WARNING' | 'ERROR';
}

export interface PayrollRunResult extends PayrollRunSummary {
  linesWritten: number;
  linesRemoved: number;
  warnings: string[];
  errors: PayrollRunError[];
  /** Populated for simulations, where nothing is persisted. */
  employees?: EmployeePayComputation[];
}

export interface RetroEmployeeDelta {
  employeeId: number;
  periodId: number;
  previousGross: number;
  recomputedGross: number;
  difference: number;
}

export interface RetroRunResult {
  /** Id of the payroll run that posted the arrears into the target period. */
  runId: number;
  periodId: number;
  fromPeriodId: number;
  deltas: RetroEmployeeDelta[];
  arrearsByEmployee: Record<number, number>;
  totalArrears: number;
  run: PayrollRunResult;
}

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

export interface TaxSlabRow {
  id: number;
  regime_id: number;
  from_amount: number;
  to_amount: number | null;
  rate_pct: number;
  surcharge_pct: number;
  slab_order: number;
}

export interface TaxRegimeRow {
  id: number;
  code: string;
  name: string;
  country: string;
  financial_year: string;
  standard_deduction: number;
  rebate_limit: number | null;
  rebate_amount: number | null;
  cess_pct: number;
  allows_exemptions: boolean | number;
  is_default: boolean | number;
  is_active: boolean | number;
}

export interface TaxComputationResult {
  employeeId: number;
  financialYear: string;
  regimeId: number | null;
  regimeCode: string | null;
  grossAnnual: number;
  exemptions: number;
  standardDeduction: number;
  chapterViaDeductions: number;
  taxableIncome: number;
  taxBeforeRebate: number;
  rebate: number;
  surcharge: number;
  cess: number;
  totalTax: number;
  taxPaidToDate: number;
  remainingTax: number;
  monthlyTds: number;
  monthsRemaining: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Final settlement
// ---------------------------------------------------------------------------

export interface FinalSettlementResult {
  /** Id of the persisted `final_settlements` row (null when not persisted). */
  id: number | null;
  /** Alias of `id`, kept for callers that prefer the explicit name. */
  settlementId: number | null;
  employeeId: number;
  empCode: string;
  fullName: string;
  settlementType: SettlementType;
  lastWorkingDate: string;
  noticePeriodDays: number;
  noticeServedDays: number;
  noticeShortfallDays: number;
  pendingSalary: number;
  leaveEncashmentDays: number;
  leaveEncashmentAmount: number;
  gratuityYears: number;
  gratuityAmount: number;
  bonusPayable: number;
  otherEarnings: number;
  noticeRecovery: number;
  loanRecovery: number;
  advanceRecovery: number;
  assetRecovery: number;
  taxDeduction: number;
  otherDeductions: number;
  grossPayable: number;
  totalRecovery: number;
  netSettlement: number;
  perDayPay: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Background jobs
// ---------------------------------------------------------------------------

export interface JobRecord {
  id: number;
  jobType: string;
  payload: any;
  status: JobStatus;
  progressPct: number;
  progressMessage: string | null;
  result: any;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  runAfter: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: number | null;
  createdAt: string;
}

export interface JobFilters {
  jobType?: string;
  status?: JobStatus;
  limit?: number;
}

export type JobProgressReporter = (pct: number, message?: string) => Promise<void>;

export type JobHandler = (payload: any, updateProgress: JobProgressReporter) => Promise<unknown>;
