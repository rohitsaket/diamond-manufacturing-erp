/**
 * Shared statutory-compliance types.
 *
 * Everything the statutory contribution ledger, the challan/filing pipeline, the
 * Form 16 archive and the compliance calendar exchange is declared here so no
 * module has to import a service just to name a shape.
 *
 * Naming rule (same as `types/payroll.ts`): rows read straight out of MySQL keep
 * their snake_case column names and are suffixed `Row`; computed application
 * objects are camelCase.
 *
 * IMPORTANT: none of the rates, ceilings, slabs or due dates referenced by these
 * types are hard-coded anywhere in the application. They are configuration rows
 * (migrations 071-075, seeder 029) that must be verified against the current Act
 * and notification before any live filing.
 */

// ---------------------------------------------------------------------------
// Enumerations mirrored from the schema (migrations 071-076)
// ---------------------------------------------------------------------------

/** Schemes a per-employee contribution row can be raised under. */
export type ContributionScheme = 'PF' | 'EPS' | 'EDLI' | 'ESI' | 'PT' | 'LWF' | 'TDS' | 'VPF';

/** Schemes a payment challan can be raised for. */
export type ChallanScheme = 'PF' | 'ESI' | 'PT' | 'LWF' | 'TDS';

/** Schemes that carry a configuration row in `statutory_config`. */
export type ConfigScheme = 'PF' | 'ESI' | 'EPS' | 'EDLI' | 'GRATUITY';

export type RegistrationType =
  | 'PF' | 'ESI' | 'PT' | 'LWF' | 'TAN' | 'GRATUITY' | 'SHOPS_ESTABLISHMENT' | 'OTHER';

export type PfStatus = 'NOT_ENROLLED' | 'ACTIVE' | 'EXITED' | 'EXEMPT';
export type EsiStatus = 'NOT_ENROLLED' | 'ACTIVE' | 'EXITED' | 'OUT_OF_COVERAGE';
export type PanStatus = 'NOT_PROVIDED' | 'PROVIDED' | 'VERIFIED' | 'INVALID';

export type NomineeScheme = 'PF' | 'EPS' | 'GRATUITY' | 'INSURANCE';

export type PfClaimType =
  | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'WITHDRAWAL' | 'ADVANCE' | 'PENSION_WITHDRAWAL';
export type PfClaimStatus =
  | 'DRAFT' | 'SUBMITTED' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'SETTLED';

export type RuleFrequency = 'MONTHLY' | 'HALF_YEARLY' | 'ANNUAL';
export type GenderApplicability = 'ALL' | 'MALE' | 'FEMALE';
export type SkillLevel = 'UNSKILLED' | 'SEMI_SKILLED' | 'SKILLED' | 'HIGHLY_SKILLED';

export type ContributionStatus =
  | 'COMPUTED' | 'CHALLAN_GENERATED' | 'PAID' | 'FILED' | 'RECONCILED';

export type PfEntryType =
  | 'CONTRIBUTION' | 'INTEREST' | 'TRANSFER_IN' | 'WITHDRAWAL' | 'ADJUSTMENT';

export type ChallanStatus =
  | 'DRAFT' | 'GENERATED' | 'PENDING_PAYMENT' | 'PAID' | 'ACKNOWLEDGED' | 'CANCELLED';

export type FilingType =
  | 'PF_ECR' | 'ESI_RETURN' | 'PT_RETURN' | 'LWF_RETURN' | 'TDS_24Q'
  | 'FORM_16' | 'FORM_12BB' | 'ANNUAL_RETURN' | 'STATUTORY_REGISTER' | 'OTHER';

export type FilingScheme = 'PF' | 'EPS' | 'ESI' | 'PT' | 'LWF' | 'TDS' | 'MULTI';

export type FilingFrequency = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'ANNUAL' | 'AD_HOC';

export type FilingStatus =
  | 'NOT_STARTED' | 'DRAFT' | 'GENERATED' | 'PENDING_APPROVAL' | 'APPROVED'
  | 'FILED' | 'ACKNOWLEDGED' | 'REJECTED' | 'OVERDUE';

/**
 * How a return reaches the authority.
 *
 * This deployment has NO automated e-filing integration. Every file produced by
 * `RegulatoryFilingService` is generated for a human to upload to the government
 * portal, so `PORTAL_MANUAL` is the only value the generators ever set.
 */
export type SubmissionMode = 'PORTAL_MANUAL' | 'OFFLINE' | 'API';

export type FilingValidationStatus =
  | 'VALID' | 'MISSING_IDENTIFIER' | 'INVALID_IDENTIFIER' | 'ZERO_WAGE' | 'MISSING_PAN';

export type Form16Status = 'DRAFT' | 'GENERATED' | 'ISSUED' | 'REVISED' | 'CANCELLED';
export type Form16Channel = 'EMAIL' | 'DOWNLOAD' | 'PRINT';
export type Form16DistributionStatus = 'PENDING' | 'SENT' | 'FAILED' | 'DOWNLOADED';

// --- Compliance governance (migration 076); shared with the calendar module ---

export type ComplianceCategory =
  | 'PF' | 'ESI' | 'PT' | 'LWF' | 'TDS' | 'LABOUR_LAW' | 'GRATUITY' | 'BONUS'
  | 'MINIMUM_WAGE' | 'OTHER';

export type ObligationType = 'PAYMENT' | 'RETURN' | 'REGISTER' | 'RENEWAL' | 'DISCLOSURE';

export type ObligationFrequency = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'ANNUAL' | 'ONE_TIME';

export type ComplianceCalendarStatus =
  | 'UPCOMING' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED' | 'NOT_APPLICABLE' | 'WAIVED';

export type ComplianceSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ComplianceCheckResult = 'PASS' | 'FAIL' | 'WARNING' | 'NOT_APPLICABLE' | 'MANUAL_REVIEW';

// ---------------------------------------------------------------------------
// Database rows (snake_case, exactly as MySQL returns them)
// ---------------------------------------------------------------------------

export interface StatutoryConfigRow {
  id: number;
  scheme: ConfigScheme;
  legal_entity: string | null;
  country: string;
  effective_from: string;
  effective_to: string | null;
  employee_rate_pct: number;
  employer_rate_pct: number;
  wage_ceiling: number | null;
  diversion_rate_pct: number | null;
  diversion_ceiling: number | null;
  admin_charge_pct: number | null;
  min_admin_charge: number | null;
  gratuity_days_per_year: number | null;
  gratuity_denominator: number | null;
  gratuity_min_years: number | null;
  gratuity_max_amount: number | null;
  filing_due_day: number | null;
  is_active: number | boolean;
  notes: string | null;
}

export interface PtStateRuleRow {
  id: number;
  state_code: string;
  state_name: string;
  country: string;
  effective_from: string;
  effective_to: string | null;
  frequency: RuleFrequency;
  gender_applicability: GenderApplicability;
  annual_cap: number | null;
  filing_due_day: number | null;
  is_active: number | boolean;
  notes: string | null;
}

export interface PtStateSlabRow {
  id: number;
  rule_id: number;
  from_amount: number;
  to_amount: number | null;
  tax_amount: number;
  special_month: number | null;
  special_month_amount: number | null;
  slab_order: number;
}

export interface LwfStateRuleRow {
  id: number;
  state_code: string;
  state_name: string;
  country: string;
  effective_from: string;
  effective_to: string | null;
  frequency: RuleFrequency;
  employee_contribution: number;
  employer_contribution: number;
  wage_ceiling: number | null;
  /** Comma separated month numbers, e.g. `6,12`. */
  deduction_months: string | null;
  filing_due_day: number | null;
  is_active: number | boolean;
  notes: string | null;
}

export interface MinimumWageRuleRow {
  id: number;
  state_code: string;
  state_name: string;
  skill_level: SkillLevel;
  industry: string | null;
  monthly_minimum: number;
  daily_minimum: number | null;
  effective_from: string;
  effective_to: string | null;
  is_active: number | boolean;
}

// ---------------------------------------------------------------------------
// Application shapes
// ---------------------------------------------------------------------------

export interface StatutoryRegistration {
  id: number;
  regType: RegistrationType;
  registrationNo: string;
  legalEntity: string | null;
  company: string | null;
  branch: string | null;
  country: string;
  stateCode: string | null;
  authorityName: string | null;
  registeredOn: string | null;
  validUntil: string | null;
  portalUsername: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  isActive: boolean;
  notes: string | null;
}

export interface EmployeeStatutory {
  id: number;
  employeeId: number;
  uan: string | null;
  pfMemberId: string | null;
  pfJoinedOn: string | null;
  pfExitOn: string | null;
  pfStatus: PfStatus;
  vpfPercent: number;
  vpfAmount: number | null;
  epsApplicable: boolean;
  esiIpNumber: string | null;
  esiJoinedOn: string | null;
  esiExitOn: string | null;
  esiStatus: EsiStatus;
  esiDispensary: string | null;
  pan: string | null;
  panStatus: PanStatus;
  panVerifiedOn: string | null;
  ptStateCode: string | null;
  lwfStateCode: string | null;
  gratuityEligible: boolean;
}

export interface StatutoryNominee {
  id: number;
  employeeId: number;
  scheme: NomineeScheme;
  nomineeName: string;
  relation: string;
  dob: string | null;
  sharePct: number;
  address: string | null;
  isMinor: boolean;
  guardianName: string | null;
  documentId: number | null;
}

export interface PfClaim {
  id: number;
  employeeId: number;
  employeeName?: string | null;
  claimType: PfClaimType;
  claimNo: string | null;
  formType: string | null;
  amount: number | null;
  previousUan: string | null;
  previousMemberId: string | null;
  previousEmployer: string | null;
  reason: string | null;
  status: PfClaimStatus;
  submittedOn: string | null;
  settledOn: string | null;
  documentId: number | null;
  remarks: string | null;
}

// ---------------------------------------------------------------------------
// Pure calculation results (see `utils/statutoryRules.ts`)
// ---------------------------------------------------------------------------

export interface PfSplit {
  /** Employee's own 12% share (VPF excluded). */
  employeeShare: number;
  /** Voluntary provident fund on top of the statutory employee share. */
  vpfShare: number;
  /** Employer share that lands in the PF account (employer total minus EPS). */
  employerPf: number;
  /** Employer share diverted to the pension scheme. */
  employerEps: number;
  /** Employees Deposit Linked Insurance, employer borne. */
  edli: number;
  /** PF administration charge, employer borne, as a straight percentage. */
  adminCharges: number;
  /** Wage the PF employee/employer shares were computed on, after the ceiling. */
  totalWage: number;
  /** Wage EPS was computed on, after its own diversion ceiling. */
  epsWage: number;
  /** Wage EDLI was computed on, after its own ceiling. */
  edliWage: number;
  /** Wage before any ceiling was applied. */
  uncappedWage: number;
  /**
   * True when the configured employer rate was smaller than the EPS diversion,
   * which means the configuration already states the *post-diversion* EPF rate
   * (e.g. 3.67 rather than 12). The caller should surface this once.
   */
  employerRateIsNetOfEps: boolean;
}

export interface EsiSplit {
  employeeAmount: number;
  employerAmount: number;
  wageBase: number;
  covered: boolean;
  /** Why coverage was declined, when it was. */
  reason: string | null;
}

export interface PtResolution {
  amount: number;
  ruleId: number | null;
  slabId: number | null;
  stateCode: string | null;
}

export interface LwfResolution {
  employeeAmount: number;
  employerAmount: number;
  ruleId: number | null;
  /** False in months the state does not collect the fund. */
  applicableThisMonth: boolean;
}

export interface MinimumWageCheck {
  compliant: boolean;
  shortfall: number;
  appliedMinimum: number;
  ruleId: number | null;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export interface ContributionRowInput {
  employeeId: number;
  periodId: number;
  salaryLineId: number | null;
  runId: number | null;
  scheme: ContributionScheme;
  financialYear: string;
  monthKey: string;
  stateCode: string | null;
  wageBase: number;
  uncappedWage: number;
  employeeAmount: number;
  employerAmount: number;
  adminCharges: number;
  totalAmount: number;
  rateApplied: number | null;
  ncpDays: number;
  paidDays: number;
  remarks: string | null;
}

export interface ContributionRecord extends ContributionRowInput {
  id: number;
  employeeCode?: string | null;
  employeeName?: string | null;
  uan?: string | null;
  esiIpNumber?: string | null;
  challanId: number | null;
  filingId: number | null;
  status: ContributionStatus;
}

export interface SchemeSummary {
  scheme: ContributionScheme;
  employeeCount: number;
  employeeAmount: number;
  employerAmount: number;
  adminCharges: number;
  total: number;
}

export interface LedgerBuildResult {
  periodId: number;
  monthKey: string;
  financialYear: string;
  employeesProcessed: number;
  byScheme: SchemeSummary[];
  warnings: string[];
}

export interface LedgerFilters {
  periodId?: number;
  scheme?: ContributionScheme | string;
  financialYear?: string;
  monthKey?: string;
  employeeId?: number;
  status?: ContributionStatus | string;
  stateCode?: string;
  limit?: number;
}

export interface GratuityProvision {
  id: number;
  employeeId: number;
  employeeCode?: string | null;
  employeeName?: string | null;
  asOfDate: string;
  financialYear: string;
  yearsOfService: number;
  lastDrawnWage: number;
  isEligible: boolean;
  provisionAmount: number;
  previousProvision: number;
  incrementalProvision: number;
  settledAmount: number;
}

export interface GratuityComputeResult {
  asOfDate: string;
  financialYear: string;
  employeesProcessed: number;
  eligibleCount: number;
  totalProvision: number;
  totalIncremental: number;
  warnings: string[];
}

export interface PfAccountEntry {
  id: number;
  employeeId: number;
  financialYear: string;
  monthKey: string | null;
  entryType: PfEntryType;
  employeeShare: number;
  employerShare: number;
  pensionShare: number;
  vpfShare: number;
  interestRatePct: number | null;
  closingBalance: number;
  entryDate: string;
  reference: string | null;
  remarks: string | null;
}

// ---------------------------------------------------------------------------
// Challans
// ---------------------------------------------------------------------------

export interface StatutoryChallan {
  id: number;
  challanNo: string;
  scheme: ChallanScheme;
  registrationId: number | null;
  periodId: number | null;
  monthKey: string | null;
  financialYear: string;
  quarter: number | null;
  stateCode: string | null;
  employeeCount: number;
  totalWages: number;
  employeeAmount: number;
  employerAmount: number;
  adminCharges: number;
  interestAmount: number;
  penaltyAmount: number;
  totalAmount: number;
  currency: string;
  dueDate: string | null;
  status: ChallanStatus;
  paidOn: string | null;
  paymentReference: string | null;
  bankName: string | null;
  fileName: string | null;
  filePath: string | null;
  acknowledgementNo: string | null;
  acknowledgedOn: string | null;
  remarks: string | null;
  createdAt: string | null;
}

export interface ChallanFilters {
  scheme?: ChallanScheme | string;
  status?: ChallanStatus | string;
  monthKey?: string;
  financialYear?: string;
  stateCode?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Regulatory filings
// ---------------------------------------------------------------------------

export interface RegulatoryFiling {
  id: number;
  filingCode: string;
  filingType: FilingType;
  scheme: FilingScheme;
  registrationId: number | null;
  frequency: FilingFrequency;
  financialYear: string;
  monthKey: string | null;
  quarter: number | null;
  periodId: number | null;
  stateCode: string | null;
  dueDate: string | null;
  employeeCount: number;
  totalAmount: number;
  status: FilingStatus;
  challanId: number | null;
  fileName: string | null;
  filePath: string | null;
  fileFormat: string | null;
  generatedAt: string | null;
  filedOn: string | null;
  acknowledgementNo: string | null;
  acknowledgedOn: string | null;
  submissionMode: SubmissionMode;
  rejectionReason: string | null;
  remarks: string | null;
}

export interface FilingItemInput {
  employeeId: number;
  identifier: string | null;
  wageBase: number;
  employeeAmount: number;
  employerAmount: number;
  totalAmount: number;
  ncpDays: number;
  extra: Record<string, unknown> | null;
  validationStatus: FilingValidationStatus;
  validationMessage: string | null;
}

export interface FilingItem extends FilingItemInput {
  id: number;
  filingId: number;
  employeeCode?: string | null;
  employeeName?: string | null;
}

/**
 * What every generator returns.
 *
 * `submissionMode` is always `PORTAL_MANUAL` and `note` always says so: the file
 * is produced here, a person uploads it to the government portal. Nothing in
 * this codebase talks to EPFO, ESIC, a state portal or TRACES.
 */
export interface FilingGenerationResult {
  filing: RegulatoryFiling;
  fileContent: string;
  fileName: string;
  submissionMode: SubmissionMode;
  note: string;
  includedCount: number;
  excludedCount: number;
  invalidItems: FilingItem[];
}

export interface RegisterResult {
  registerType: string;
  fileName: string;
  filePath: string | null;
  fileContent: string;
  rowCount: number;
  note: string;
}

export interface FilingFilters {
  filingType?: FilingType | string;
  status?: FilingStatus | string;
  financialYear?: string;
  monthKey?: string;
  quarter?: number;
  stateCode?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Form 16
// ---------------------------------------------------------------------------

export interface Form16Record {
  id: number;
  employeeId: number;
  employeeCode?: string | null;
  employeeName?: string | null;
  financialYear: string;
  assessmentYear: string | null;
  certificateNo: string | null;
  pan: string | null;
  tan: string | null;
  employerName: string | null;
  regimeCode: string | null;
  grossSalary: number;
  exemptAllowances: number;
  standardDeduction: number;
  professionalTax: number;
  chapterViaDeductions: number;
  taxableIncome: number;
  taxOnIncome: number;
  rebate: number;
  surcharge: number;
  cess: number;
  totalTax: number;
  tdsDeducted: number;
  taxPayable: number;
  refundDue: number;
  /** Always false here: Part A is downloaded from TRACES, never generated. */
  hasPartA: boolean;
  partADocumentId: number | null;
  /** Always false here: no digital signature certificate is held by this system. */
  isStatutorySigned: boolean;
  status: Form16Status;
  fileName: string | null;
  filePath: string | null;
  generatedAt: string | null;
  issuedAt: string | null;
  revisionNo: number;
  remarks: string | null;
}

export interface Form16Distribution {
  id: number;
  form16Id: number;
  channel: Form16Channel;
  recipient: string | null;
  status: Form16DistributionStatus;
  errorMessage: string | null;
  sentAt: string | null;
  actorUserId: number | null;
}

export interface Form16Filters {
  financialYear?: string;
  status?: Form16Status | string;
  employeeId?: number;
  limit?: number;
}

export interface Form16BulkResult {
  financialYear: string;
  requested: number;
  generated: number;
  failures: { employeeId: number; employeeName?: string | null; reason: string }[];
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** One row of the compliance-grade audit trail (`payroll_audit_logs`). */
export interface ComplianceAuditInput {
  entityType: string;
  entityId?: number | null;
  employeeId?: number | null;
  periodId?: number | null;
  action: string;
  summary: string;
  fieldName?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  actorUserId?: number | null;
  actorName?: string | null;
  actorRole?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}
