// Enterprise attendance types. These mirror the backend `types/attendance.ts`
// and sit alongside `types/hrms.ts`, which keeps its existing shapes for the
// daily marking sheet, the monthly register and the shift tab.

export type PunchType = 'IN' | 'OUT' | 'BREAK_IN' | 'BREAK_OUT';

export type CaptureMethod =
  | 'WEB' | 'MOBILE' | 'KIOSK' | 'BIOMETRIC' | 'FACE' | 'QR' | 'NFC' | 'RFID'
  | 'PALM' | 'IRIS' | 'MANUAL' | 'IMPORT' | 'AUTO' | 'API';

export type WorkMode =
  | 'OFFICE' | 'REMOTE' | 'HYBRID' | 'CLIENT_SITE' | 'FIELD' | 'WORK_SITE' | 'BUSINESS_TRAVEL';

export type GeoStatus = 'NOT_REQUIRED' | 'INSIDE' | 'OUTSIDE' | 'NO_FIX' | 'LOW_ACCURACY';
export type PunchStatus = 'ACCEPTED' | 'REJECTED' | 'PENDING' | 'DUPLICATE';

export type DeviceType =
  | 'BIOMETRIC' | 'FACE' | 'QR_KIOSK' | 'NFC_READER' | 'RFID_READER'
  | 'WEB_KIOSK' | 'MOBILE' | 'TURNSTILE' | 'PALM' | 'IRIS';
export type DeviceHealth = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'UNKNOWN';
export type DeviceStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | 'DECOMMISSIONED';
export type SyncStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'RUNNING';

export type ShiftType = 'FIXED' | 'FLEXIBLE' | 'ROTATIONAL' | 'NIGHT' | 'SPLIT' | 'OPEN';

export type AttendanceRequestType =
  | 'REGULARIZATION' | 'MISSED_PUNCH' | 'CORRECTION' | 'OVERTIME' | 'SHIFT_CHANGE'
  | 'SHIFT_SWAP' | 'REMOTE_WORK' | 'ON_DUTY' | 'BREAK_EXTENSION' | 'COMP_OFF'
  | 'EARLY_EXIT' | 'LATE_ARRIVAL';

export type AttendanceRequestStatus =
  | 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ESCALATED' | 'APPLIED' | 'EXPIRED';

export type ApprovalDecision =
  | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED' | 'ESCALATED' | 'AUTO_APPROVED';

export type ApproverType =
  | 'REPORTING_MANAGER' | 'DEPARTMENT_HEAD' | 'BRANCH_MANAGER' | 'HR' | 'ADMIN'
  | 'SPECIFIC_EMPLOYEE' | 'ROLE';

export type OvertimeType = 'WEEKDAY' | 'WEEK_OFF' | 'HOLIDAY' | 'NIGHT';
export type OvertimeStatus = 'DERIVED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID' | 'CANCELLED';
export type RosterStatus = 'DRAFT' | 'PUBLISHED' | 'LOCKED' | 'ARCHIVED';

export type VisitorType = 'VISITOR' | 'CONTRACTOR' | 'VENDOR' | 'TEMP_STAFF' | 'INTERN' | 'AUDITOR' | 'CLIENT';
export type VisitStatus = 'EXPECTED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'NO_SHOW' | 'CANCELLED' | 'OVERSTAY';

export type ComplianceRuleType =
  | 'MAX_DAILY_HOURS' | 'MAX_WEEKLY_HOURS' | 'MIN_REST_HOURS' | 'MAX_OT_MONTHLY'
  | 'MAX_OT_WEEKLY' | 'MANDATORY_WEEKLY_OFF' | 'MAX_CONSECUTIVE_DAYS'
  | 'MANDATORY_BREAK' | 'MIN_DAILY_HOURS' | 'NIGHT_SHIFT_LIMIT';
export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ViolationStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'WAIVED';

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------
export interface AttendancePolicy {
  id: number;
  code: string;
  name: string;
  description: string | null;
  companyId: number | null;
  isDefault: boolean;
  priority: number;

  workingHoursPerDay: number;
  fullDayHours: number;
  halfDayHours: number;
  minHoursForPresent: number;
  maxHoursPerDay: number;
  maxHoursPerWeek: number;

  graceMinutes: number;
  lateAfterMinutes: number;
  latePenaltyType: 'NONE' | 'WARN' | 'HALF_DAY' | 'DEDUCT_HOURS' | 'ABSENT';
  latePenaltyAfterCount: number;
  maxLatePerMonth: number;
  earlyExitGraceMinutes: number;
  earlyExitPenaltyType: 'NONE' | 'WARN' | 'HALF_DAY' | 'DEDUCT_HOURS';

  halfDayEnabled: boolean;
  weekOffDays: number[];
  alternateWeekOff: string | null;
  weekOffPaid: boolean;
  holidayPaid: boolean;
  sandwichLeaveRule: boolean;

  otEnabled: boolean;
  otRequiresApproval: boolean;
  otMinMinutes: number;
  otRoundingMinutes: number;
  otMaxHoursPerDay: number;
  otMaxHoursPerMonth: number;
  otMultiplierWeekday: number;
  otMultiplierWeekoff: number;
  otMultiplierHoliday: number;
  otMultiplierNight: number;

  autoAbsentIfNoPunch: boolean;
  autoPunchOutEnabled: boolean;
  autoPunchOutAfterHours: number | null;
  autoMarkWeekOff: boolean;
  autoMarkHoliday: boolean;

  allowedCaptureMethods: CaptureMethod[];
  requireGeofence: boolean;
  requirePhoto: boolean;
  requireFaceMatch: boolean;
  allowRemotePunch: boolean;
  allowOfflinePunch: boolean;
  offlineMaxAgeHours: number;
  restrictIp: boolean;
  maxPunchesPerDay: number;
  minMinutesBetweenPunches: number;

  minRestHoursBetweenShifts: number;
  maxConsecutiveWorkDays: number;
  mandatoryBreakAfterHours: number | null;

  regularizationEnabled: boolean;
  regularizationWindowDays: number;
  maxRegularizationsPerMonth: number;

  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'DRAFT';
  assignmentCount?: number;
  assignments?: PolicyAssignment[];
}

export interface PolicyAssignment {
  id: number;
  policyId: number;
  policyName?: string;
  scopeType: 'GLOBAL' | 'COMPANY' | 'BRANCH' | 'DEPARTMENT' | 'DIVISION' | 'TEAM' | 'JOB_GRADE' | 'EMPLOYEE' | 'WORKER_TYPE';
  scopeId: number | null;
  scopeValue: string | null;
  scopeLabel?: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface BreakType {
  id: number;
  code: string;
  name: string;
  companyId: number | null;
  isPaid: boolean;
  defaultMinutes: number;
  maxMinutes: number;
  maxPerDay: number;
  requiresApproval: boolean;
  isMandatory: boolean;
  earliestStart: string | null;
  latestEnd: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

// ---------------------------------------------------------------------------
// Shifts and scheduling
// ---------------------------------------------------------------------------
export interface ShiftDetail {
  id: number;
  code: string | null;
  name: string;
  companyId: number | null;
  branchId: number | null;
  branchName?: string | null;
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  isNightShift: boolean;
  secondStartTime: string | null;
  secondEndTime: string | null;
  flexibleCoreStart: string | null;
  flexibleCoreEnd: string | null;
  flexibleMinHours: number | null;
  breakMinutes: number;
  graceMinutes: number;
  weekOffDay: number;
  weekOffDays: number[];
  fullDayHours: number | null;
  halfDayHours: number | null;
  otEligible: boolean;
  timezone: string | null;
  color: string | null;
  maxEmployees: number | null;
  isDefault: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  assignedCount?: number;
}

export interface RotationPattern {
  id: number;
  code: string;
  name: string;
  companyId: number | null;
  description: string | null;
  cycleDays: number;
  pattern: string[];
  status: 'ACTIVE' | 'INACTIVE';
}

export interface RotationPreview {
  pattern: RotationPattern;
  days: { date: string; shiftCode: string; shiftName: string | null; isOff: boolean }[];
}

export interface ShiftAssignment {
  id: number;
  employeeId: number;
  employeeName?: string;
  empCode?: string;
  shiftId: number | null;
  shiftName?: string | null;
  shiftCode?: string | null;
  rotationPatternId: number | null;
  rotationPatternName?: string | null;
  rotationAnchorDate: string | null;
  rotationOffset: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isPrimary: boolean;
  assignmentReason: string | null;
}

export interface Roster {
  id: number;
  code: string;
  name: string;
  companyId: number | null;
  branchId: number | null;
  branchName?: string | null;
  departmentId: number | null;
  departmentName?: string | null;
  fromDate: string;
  toDate: string;
  status: RosterStatus;
  notes: string | null;
  publishedAt: string | null;
  publishedByName?: string | null;
  entryCount?: number;
  employeeCount?: number;
}

export interface RosterEntry {
  id: number;
  rosterId: number;
  employeeId: number;
  employeeName?: string;
  empCode?: string;
  workDate: string;
  shiftId: number | null;
  shiftCode?: string | null;
  shiftName?: string | null;
  shiftColor?: string | null;
  isWeekOff: boolean;
  isHoliday: boolean;
  isLeave: boolean;
  plannedHours: number | null;
  locationId: number | null;
  notes: string | null;
}

export interface RosterCapacity {
  roster: Roster;
  days: {
    date: string;
    off: number;
    shifts: { shiftId: number | null; shiftName: string; planned: number; capacity: number | null; gap: number | null }[];
  }[];
}

// ---------------------------------------------------------------------------
// Devices and credentials
// ---------------------------------------------------------------------------
export interface AttendanceDevice {
  id: number;
  code: string;
  name: string;
  deviceType: DeviceType;
  vendor: string | null;
  model: string | null;
  serialNo: string | null;
  firmwareVersion: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  companyId: number | null;
  branchId: number | null;
  branchName?: string | null;
  locationId: number | null;
  locationName?: string | null;
  geofenceId: number | null;
  geofenceName?: string | null;
  timezone: string;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  supportsInOut: boolean;
  defaultPunchType: 'AUTO' | 'IN' | 'OUT';
  syncMode: 'PUSH' | 'PULL' | 'MANUAL';
  syncIntervalMinutes: number;
  heartbeatIntervalMinutes: number;
  lastHeartbeatAt: string | null;
  lastSyncAt: string | null;
  lastPunchAt: string | null;
  totalPunches: number;
  enrolledCount: number;
  healthStatus: DeviceHealth;
  healthNote: string | null;
  status: DeviceStatus;
  installedOn: string | null;
  warrantyExpiresOn: string | null;
  notes: string | null;
  minutesSinceHeartbeat: number | null;
}

export interface DeviceSyncLog {
  id: number;
  deviceId: number;
  deviceName?: string;
  syncType: 'PUSH' | 'PULL' | 'MANUAL' | 'HEARTBEAT' | 'CONFIG';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: SyncStatus;
  recordsReceived: number;
  recordsAccepted: number;
  recordsDuplicate: number;
  recordsRejected: number;
  errorMessage: string | null;
}

export interface DeviceEnrollment {
  id: number;
  deviceId: number;
  deviceName?: string;
  employeeId: number;
  employeeName?: string;
  empCode?: string;
  deviceUserId: string;
  enrollmentType: 'FINGERPRINT' | 'FACE' | 'PALM' | 'IRIS' | 'CARD' | 'PIN';
  templatesCount: number;
  qualityScore: number | null;
  enrolledAt: string | null;
  lastVerifiedAt: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'FAILED';
  notes: string | null;
}

export interface DeviceHealthSummary {
  online: number;
  offline: number;
  degraded: number;
  unknown: number;
  total: number;
}

export interface Geofence {
  id: number;
  code: string;
  name: string;
  companyId: number | null;
  branchId: number | null;
  branchName?: string | null;
  locationId: number | null;
  fenceType: 'CIRCLE' | 'POLYGON';
  centerLat: number | null;
  centerLng: number | null;
  radiusM: number;
  polygon: [number, number][] | null;
  address: string | null;
  allowMethods: CaptureMethod[];
  enforceOnIn: boolean;
  enforceOnOut: boolean;
  maxAccuracyM: number;
  status: 'ACTIVE' | 'INACTIVE';
  employeeCount?: number;
}

export interface QrTokenResponse {
  token: string;
  deviceId: number | null;
  deviceName?: string | null;
  geofenceId: number | null;
  isStatic: boolean;
  rotationSeconds: number;
  issuedAt: string;
  expiresAt: string | null;
  expiresInSeconds: number | null;
  payload: string;
}

export interface NfcCard {
  id: number;
  cardUid: string;
  cardType: 'NFC' | 'RFID' | 'SMART_CARD' | 'MIFARE' | 'HID';
  employeeId: number | null;
  employeeName?: string | null;
  empCode?: string | null;
  cardNumber: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'LOST' | 'DAMAGED' | 'EXPIRED' | 'RETURNED';
  reportedLostAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  notes: string | null;
}

export interface FaceEnrollment {
  id: number;
  employeeId: number;
  employeeName?: string;
  empCode?: string;
  provider: string;
  externalRef: string | null;
  imagesCount: number;
  qualityScore: number | null;
  enrolledAt: string | null;
  lastVerifiedAt: string | null;
  verificationCount: number;
  status: 'ACTIVE' | 'PENDING' | 'FAILED' | 'REVOKED' | 'NOT_CONFIGURED';
  statusNote: string | null;
}

export interface FaceProviderStatus {
  configured: boolean;
  provider: string;
  threshold: number;
  capabilities: Record<string, boolean>;
  note: string;
}

export interface IpRule {
  id: number;
  code: string;
  name: string;
  ruleType: 'ALLOW' | 'DENY';
  cidr: string | null;
  ipFrom: string | null;
  ipTo: string | null;
  companyId: number | null;
  branchId: number | null;
  status: 'ACTIVE' | 'INACTIVE';
}

// ---------------------------------------------------------------------------
// Punches and days
// ---------------------------------------------------------------------------
export interface PunchRecord {
  id: number;
  employeeId: number;
  employeeName?: string;
  empCode?: string;
  punchAt: string;
  punchDate: string;
  punchTime: string;
  timezone: string;
  punchType: PunchType;
  captureMethod: CaptureMethod;
  workMode: WorkMode;
  deviceId: number | null;
  deviceName?: string | null;
  shiftId: number | null;
  projectRef: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  geofenceId: number | null;
  geofenceName?: string | null;
  geoStatus: GeoStatus;
  distanceM: number | null;
  addressLabel: string | null;
  ipAddress: string | null;
  browser: string | null;
  os: string | null;
  photoPath: string | null;
  faceVerified: boolean;
  faceMatchScore: number | null;
  livenessPassed: boolean | null;
  faceProviderNote: string | null;
  clientPunchId: string | null;
  isOffline: boolean;
  capturedAt: string | null;
  syncedAt: string | null;
  status: PunchStatus;
  rejectReason: string | null;
  isManualEntry: boolean;
  remarks: string | null;
  createdAt: string;
}

export interface BreakRecord {
  id: number;
  attendanceId: number | null;
  employeeId: number;
  attDate: string;
  breakTypeId: number | null;
  breakTypeName: string | null;
  startTime: string | null;
  endTime: string | null;
  minutes: number;
  isPaid: boolean;
  isOpen: boolean;
  exceededByMinutes: number;
  approvalStatus: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  source: 'PUNCH' | 'MANUAL' | 'POLICY' | 'IMPORT';
  remarks: string | null;
}

export interface DailyAttendanceDetail {
  id: number | null;
  employeeId: number;
  employeeName: string;
  empCode: string;
  date: string;
  status: string | null;
  workMode: WorkMode;
  shiftId: number | null;
  shiftName: string | null;
  shiftCode: string | null;
  inTime: string | null;
  outTime: string | null;
  firstInTime: string | null;
  lastOutTime: string | null;
  punchCount: number;
  breakMinutes: number;
  paidBreakMinutes: number;
  unpaidBreakMinutes: number;
  grossHours: number | null;
  workedHours: number | null;
  expectedHours: number | null;
  deficitHours: number | null;
  otHours: number;
  otApprovedHours: number;
  otStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
  otType: 'NONE' | OvertimeType;
  isLate: boolean;
  lateMinutes: number;
  isEarlyExit: boolean;
  earlyExitMinutes: number;
  isMissingPunch: boolean;
  exceptionFlags: string[];
  isCrossDay: boolean;
  shiftEndDate: string | null;
  timezone: string | null;
  policyId: number | null;
  policyName?: string | null;
  deviceId: number | null;
  branchId: number | null;
  departmentId: number | null;
  approvalStatus: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  isRegularized: boolean;
  isLocked: boolean;
  lockedReason: string | null;
  source: string | null;
  remarks: string | null;
  punches?: PunchRecord[];
  breaks?: BreakRecord[];
}

export interface PunchResult {
  punch: PunchRecord;
  attendance: DailyAttendanceDetail;
  warnings: string[];
  nextExpectedPunch: PunchType | null;
}

export interface SelfStatus {
  date: string;
  timezone: string;
  state: 'NOT_STARTED' | 'IN' | 'ON_BREAK' | 'OUT';
  nextExpectedPunch: PunchType | null;
  canPunchIn: boolean;
  canPunchOut: boolean;
  canStartBreak: boolean;
  canEndBreak: boolean;
  workedMinutesSoFar: number;
  shift: { id: number; name: string; startTime: string; endTime: string; crossesMidnight: boolean } | null;
  attendance: DailyAttendanceDetail | null;
  punches: PunchRecord[];
}

// ---------------------------------------------------------------------------
// Requests, approvals and overtime
// ---------------------------------------------------------------------------
export interface RequestApproval {
  id: number;
  requestId: number;
  level: number;
  approverType: ApproverType;
  approverEmployeeId: number | null;
  approverName: string | null;
  approverRole: string | null;
  decision: ApprovalDecision;
  decidedByName: string | null;
  decidedAt: string | null;
  comments: string | null;
  delegatedFromName: string | null;
  dueAt: string | null;
  escalatedAt: string | null;
}

export interface AttendanceRequest {
  id: number;
  requestNo: string;
  requestType: AttendanceRequestType;
  employeeId: number;
  employeeName: string;
  empCode: string;
  departmentName?: string | null;
  attDate: string;
  toDate: string | null;
  attendanceId: number | null;
  currentValue: Record<string, unknown> | null;
  requestedValue: Record<string, unknown> | null;
  requestedHours: number | null;
  reason: string | null;
  attachmentPath: string | null;
  counterpartyEmployeeId: number | null;
  counterpartyName: string | null;
  counterpartyResponse: 'NOT_REQUIRED' | 'PENDING' | 'ACCEPTED' | 'DECLINED';
  status: AttendanceRequestStatus;
  currentLevel: number;
  totalLevels: number;
  submittedAt: string | null;
  decidedAt: string | null;
  appliedAt: string | null;
  dueAt: string | null;
  isOverdue: boolean;
  decisionNote: string | null;
  createdAt: string;
  approvals?: RequestApproval[];
}

export interface ApprovalWorkflowStep {
  id: number;
  requestType: AttendanceRequestType;
  companyId: number | null;
  branchId: number | null;
  departmentId: number | null;
  level: number;
  approverType: ApproverType;
  approverEmployeeId: number | null;
  approverName?: string | null;
  approverRole: string | null;
  isMandatory: boolean;
  slaHours: number;
  autoEscalate: boolean;
  escalateToType: 'DEPARTMENT_HEAD' | 'HR' | 'ADMIN' | 'SPECIFIC_EMPLOYEE' | null;
  escalateToEmployeeId: number | null;
  autoApproveAfterHours: number | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface Delegation {
  id: number;
  fromEmployeeId: number;
  fromEmployeeName: string;
  toEmployeeId: number;
  toEmployeeName: string;
  fromDate: string;
  toDate: string;
  requestTypes: AttendanceRequestType[];
  reason: string | null;
  status: 'ACTIVE' | 'CANCELLED' | 'EXPIRED';
}

export interface OvertimeRecord {
  id: number;
  employeeId: number;
  employeeName: string;
  empCode: string;
  attDate: string;
  attendanceId: number | null;
  requestId: number | null;
  otType: OvertimeType;
  derivedHours: number;
  requestedHours: number;
  approvedHours: number;
  multiplier: number;
  payableHours: number;
  hourlyRate: number | null;
  amount: number | null;
  status: OvertimeStatus;
  reason: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
}

// ---------------------------------------------------------------------------
// Visitors
// ---------------------------------------------------------------------------
export interface Visitor {
  id: number;
  visitorCode: string;
  visitorType: VisitorType;
  fullName: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  idProofType: string | null;
  idProofNo: string | null;
  photoPath: string | null;
  nationality: string | null;
  contractorAgency: string | null;
  contractFrom: string | null;
  contractTo: string | null;
  dailyRate: number | null;
  isBlacklisted: boolean;
  blacklistReason: string | null;
  notes: string | null;
  visitCount?: number;
  lastVisitDate?: string | null;
  onSite?: boolean;
}

export interface VisitorVisit {
  id: number;
  visitorId: number;
  visitorName: string;
  visitorCode: string;
  visitorType: VisitorType;
  companyName: string | null;
  visitDate: string;
  hostEmployeeId: number | null;
  hostName: string | null;
  purpose: string | null;
  branchId: number | null;
  locationId: number | null;
  locationName: string | null;
  badgeNo: string | null;
  vehicleNo: string | null;
  expectedIn: string | null;
  expectedOut: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  hours: number | null;
  accompanyingCount: number;
  approvalStatus: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  status: VisitStatus;
  safetyBriefingDone: boolean;
  remarks: string | null;
}

export interface VisitorBoard {
  date: string;
  summary: {
    expected: number; onSite: number; checkedOut: number; overstay: number; total: number;
    byType: { type: string; count: number }[];
  };
  onSite: VisitorVisit[];
  expected: VisitorVisit[];
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------
export interface ComplianceRule {
  id: number;
  code: string;
  name: string;
  ruleType: ComplianceRuleType;
  thresholdValue: number;
  comparison: 'GT' | 'GTE' | 'LT' | 'LTE';
  period: 'DAY' | 'WEEK' | 'MONTH' | 'ROLLING_7' | 'ROLLING_30';
  severity: Severity;
  country: string | null;
  companyId: number | null;
  branchId: number | null;
  legalReference: string | null;
  remediation: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  openViolations?: number;
}

export interface ComplianceViolation {
  id: number;
  ruleId: number;
  ruleCode: string;
  ruleName: string;
  ruleType: ComplianceRuleType;
  legalReference: string | null;
  remediation: string | null;
  employeeId: number;
  employeeName: string;
  empCode: string;
  periodStart: string;
  periodEnd: string;
  observedValue: number;
  thresholdValue: number;
  severity: Severity;
  detail: string | null;
  status: ViolationStatus;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  detectedAt: string;
}

export interface ComplianceScanResult {
  scannedFrom: string;
  scannedTo: string;
  rulesEvaluated: number;
  employeesScanned: number;
  violationsFound: number;
  violationsNew: number;
  bySeverity: Record<Severity, number>;
  skipped: { code: string; reason: string }[];
}

export interface ComplianceSummary {
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  total: number;
  rules: { total: number; active: number };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export interface AttendanceAuditEntry {
  id: number;
  entityType: string;
  entityId: number | null;
  employeeId: number | null;
  employeeName: string | null;
  attDate: string | null;
  action: string;
  summary: string | null;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  actorUserId: number | null;
  actorRole: string | null;
  actorName: string | null;
  ipAddress: string | null;
  device: string | null;
  browser: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Dashboard, analytics, reports
// ---------------------------------------------------------------------------
export interface LiveAttendanceBoard {
  date: string;
  generatedAt: string;
  totals: {
    headcount: number;
    present: number;
    absent: number;
    late: number;
    onLeave: number;
    holiday: number;
    weekOff: number;
    remote: number;
    businessTravel: number;
    notMarked: number;
    currentlyIn: number;
    onBreak: number;
    punchedOut: number;
    overtimeHours: number;
    exceptions: number;
    missingPunches: number;
    attendancePct: number;
  };
  shiftCoverage: { shiftId: number | null; shiftName: string; planned: number; present: number; coveragePct: number }[];
  byDepartment: { departmentId: number | null; name: string; headcount: number; present: number; absent: number; pct: number }[];
  byBranch: { branchId: number | null; name: string; headcount: number; present: number; pct: number }[];
  recentPunches: PunchRecord[];
  exceptions: { employeeId: number; employeeName: string; empCode: string; flags: string[]; detail: string }[];
  devices: DeviceHealthSummary;
}

export interface AttendanceTrendPoint {
  bucket: string;
  present: number;
  absent: number;
  halfDay: number;
  leave: number;
  late: number;
  otHours: number;
  attendancePct: number;
}

export interface AttendanceAnalytics {
  from: string;
  to: string;
  trend: AttendanceTrendPoint[];
  byDepartment: { name: string; present: number; absent: number; late: number; otHours: number; attendancePct: number }[];
  byBranch: { name: string; present: number; absent: number; attendancePct: number }[];
  absenteeism: { employeeId: number; employeeName: string; empCode: string; absentDays: number; ratePct: number }[];
  overtime: { employeeId: number; employeeName: string; empCode: string; otHours: number; approvedHours: number }[];
  punctuality: { employeeId: number; employeeName: string; empCode: string; lateDays: number; avgLateMinutes: number }[];
  heatmap: { date: string; dayOfWeek: number; present: number; total: number; pct: number }[];
  captureMix: { method: CaptureMethod; count: number; pct: number }[];
  workModeMix: { mode: WorkMode; days: number; pct: number }[];
  summary: {
    totalEmployees: number;
    avgAttendancePct: number;
    totalOtHours: number;
    totalLateInstances: number;
    totalAbsentDays: number;
    avgWorkedHours: number;
  };
}

export interface AttendanceDashboard {
  board: LiveAttendanceBoard;
  requests: Record<string, number>;
  compliance: ComplianceSummary;
  visitors: VisitorBoard['summary'];
  trend: AttendanceTrendPoint[];
}

export interface ReportDefinition {
  slug: string;
  title: string;
  description: string;
  headers: { key: string; label: string; align?: 'left' | 'right' }[];
}

export interface AttendanceReportResult {
  report: string;
  title: string;
  generatedAt: string;
  from: string;
  to: string;
  headers: { key: string; label: string; align?: 'left' | 'right' }[];
  rows: Record<string, string | number | null>[];
  total: number;
  truncatedAt?: number | null;
  note?: string | null;
}

/** What this deployment actually has switched on, straight from the server. */
export interface AttendanceCapabilities {
  face: FaceProviderStatus;
  qr: { configured: boolean; rotationSeconds: number };
  geofencing: { configured: boolean; note: string };
  nfc: { configured: boolean; note: string };
  biometric: { configured: boolean; note: string };
  offlineSync: { configured: boolean; note: string };
  realtime: { configured: boolean; transport: string; note: string };
  notifications: { inApp: boolean; email: boolean; sms: boolean; whatsapp: boolean; push: boolean; note: string };
  exports: { csv: boolean; pdf: boolean; excel: boolean; note: string };
  caching: { redis: boolean; note: string };
}

// ---------------------------------------------------------------------------
// Display helpers shared across the attendance screens
// ---------------------------------------------------------------------------
export const PUNCH_TYPE_LABELS: Record<PunchType, string> = {
  IN: 'In', OUT: 'Out', BREAK_IN: 'Back from break', BREAK_OUT: 'Break',
};

export const CAPTURE_METHOD_LABELS: Record<CaptureMethod, string> = {
  WEB: 'Web', MOBILE: 'Mobile', KIOSK: 'Kiosk', BIOMETRIC: 'Fingerprint', FACE: 'Face',
  QR: 'QR', NFC: 'NFC', RFID: 'RFID', PALM: 'Palm', IRIS: 'Iris',
  MANUAL: 'Manual', IMPORT: 'Import', AUTO: 'Automatic', API: 'API',
};

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  OFFICE: 'On site', REMOTE: 'Remote', HYBRID: 'Hybrid', CLIENT_SITE: 'Client site',
  FIELD: 'Field', WORK_SITE: 'Work site', BUSINESS_TRAVEL: 'Business travel',
};

export const REQUEST_TYPE_LABELS: Record<AttendanceRequestType, string> = {
  REGULARIZATION: 'Regularization', MISSED_PUNCH: 'Missed punch', CORRECTION: 'Correction',
  OVERTIME: 'Overtime', SHIFT_CHANGE: 'Shift change', SHIFT_SWAP: 'Shift swap',
  REMOTE_WORK: 'Remote work', ON_DUTY: 'On duty', BREAK_EXTENSION: 'Break extension',
  COMP_OFF: 'Compensatory off', EARLY_EXIT: 'Early exit', LATE_ARRIVAL: 'Late arrival',
};

export const SHIFT_TYPE_LABELS: Record<ShiftType, string> = {
  FIXED: 'Fixed', FLEXIBLE: 'Flexible', ROTATIONAL: 'Rotational',
  NIGHT: 'Night', SPLIT: 'Split', OPEN: 'Open',
};

export const VISITOR_TYPE_LABELS: Record<VisitorType, string> = {
  VISITOR: 'Visitor', CONTRACTOR: 'Contractor', VENDOR: 'Vendor',
  TEMP_STAFF: 'Temporary staff', INTERN: 'Intern', AUDITOR: 'Auditor', CLIENT: 'Client',
};

export const EXCEPTION_LABELS: Record<string, string> = {
  LATE: 'Late', EARLY_EXIT: 'Early exit', OVERTIME: 'Overtime', ABSENT: 'Absent',
  MISSING_PUNCH: 'Missing punch', OUTSIDE_FENCE: 'Outside fence', OVER_MAX_HOURS: 'Over hours cap',
};

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
