/**
 * Enterprise attendance types.
 *
 * These sit alongside `types/hrms.ts` rather than replacing anything in it --
 * AttendanceStatus, AttendanceResponse and the register types keep their
 * existing shapes so the daily sheet, the register and payroll are untouched.
 */

// ---------------------------------------------------------------------------
// Unions
// ---------------------------------------------------------------------------
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

export type AuditEntityType =
  | 'PUNCH' | 'ATTENDANCE' | 'REQUEST' | 'APPROVAL' | 'SHIFT' | 'ROSTER' | 'DEVICE'
  | 'POLICY' | 'GEOFENCE' | 'QR_TOKEN' | 'NFC_CARD' | 'FACE' | 'BREAK' | 'OVERTIME'
  | 'VISITOR' | 'COMPLIANCE' | 'HOLIDAY' | 'ASSIGNMENT';

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
// Shifts (enterprise view -- the classic ShiftResponse in hrms.ts is unchanged)
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

// ---------------------------------------------------------------------------
// Devices
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
  /** Recomputed from lastHeartbeatAt against heartbeatIntervalMinutes on read. */
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

// ---------------------------------------------------------------------------
// Location and credentials
// ---------------------------------------------------------------------------
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
  /** Seconds left before the client must fetch a new token. */
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
// Punches
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

/** What a client sends to record a punch. */
export interface PunchInput {
  employeeId?: number;
  punchType?: PunchType | 'AUTO';
  captureMethod?: CaptureMethod;
  workMode?: WorkMode;
  deviceCode?: string;
  deviceId?: number;
  devicePunchRef?: string;
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
  qrToken?: string;
  cardUid?: string;
  photoPath?: string;
  faceImageRef?: string;
  projectRef?: string;
  breakTypeCode?: string;
  clientPunchId?: string;
  capturedAt?: string;
  isOffline?: boolean;
  remarks?: string;
  timezone?: string;
}

export interface PunchResult {
  punch: PunchRecord;
  attendance: DailyAttendanceDetail;
  /** Non-fatal notes -- e.g. "outside the fence, recorded and flagged". */
  warnings: string[];
  nextExpectedPunch: PunchType | null;
}

/** The enterprise view of a single day. */
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

// ---------------------------------------------------------------------------
// Requests and approvals
// ---------------------------------------------------------------------------
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
  /** Rules the scan could not evaluate, with the reason. */
  skipped: { code: string; reason: string }[];
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export interface AttendanceAuditEntry {
  id: number;
  entityType: AuditEntityType;
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

export interface AuditContext {
  userId?: number | null;
  actorRole?: string | null;
  actorName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  browser?: string | null;
  device?: string | null;
  latitude?: number | null;
  longitude?: number | null;
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
  devices: { online: number; offline: number; degraded: number; unknown: number; total: number };
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

export interface AttendanceReportResult {
  report: string;
  title: string;
  generatedAt: string;
  from: string;
  to: string;
  headers: { key: string; label: string; align?: 'left' | 'right' }[];
  rows: Record<string, string | number | null>[];
  total: number;
  /** Populated when the report is truncated, so a partial export is never silent. */
  truncatedAt?: number | null;
  note?: string | null;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}
