// Shared contract for the offboarding module. Both backend work streams code
// against these shapes; extend in service files, do not fork this file.

export type SeparationType =
  | 'RESIGNATION' | 'RETIREMENT' | 'TERMINATION' | 'LAYOFF' | 'CONTRACT_END'
  | 'ABSCONDING' | 'DEATH_IN_SERVICE' | 'MUTUAL' | 'ENTITY_TRANSFER';
export type SeparationStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'
  | 'IN_NOTICE' | 'CLEARANCE' | 'SETTLEMENT' | 'COMPLETED' | 'CANCELLED';
export type ClearanceDepartment =
  | 'HR' | 'IT' | 'FINANCE' | 'ADMIN' | 'SECURITY' | 'MANAGER' | 'PROJECT' | 'FACILITY' | 'LEGAL';
export type ClearanceStatus = 'PENDING' | 'IN_PROGRESS' | 'CLEARED' | 'BLOCKED';
export type ExitLetterType = 'ACCEPTANCE' | 'EXPERIENCE' | 'RELIEVING' | 'RECOMMENDATION' | 'CLEARANCE_CERT';

export interface SeparationResponse {
  id: number;
  sepCode: string;
  employeeId: number;
  employeeName?: string | null;
  empCode?: string | null;
  grade?: string | null;
  workerType?: string | null;
  departmentName?: string | null;
  separationType: SeparationType;
  status: SeparationStatus;
  reason: string | null;
  resignationDate: string | null;
  noticeDays: number | null;
  noticeStart: string | null;
  noticeEnd: string | null;
  lastWorkingDay: string | null;
  earlyReleaseRequested: boolean;
  earlyReleaseDate: string | null;
  earlyReleaseReason: string | null;
  noticeBuyoutDays: number | null;
  noticeBuyoutAmount: number | null;
  noticeWaived: boolean;
  noticeWaiverReason: string | null;
  gardenLeave: boolean;
  managerReviewedAt: string | null;
  managerNote: string | null;
  hrReviewedAt: string | null;
  hrNote: string | null;
  approvedBy: number | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  withdrawnAt: string | null;
  withdrawReason: string | null;
  rehireEligible: boolean | null;
  rehireNote: string | null;
  completedAt: string | null;
  createdAt: string;
  events?: SeparationEventResponse[];
  /** Filled on detail reads: progress of every offboarding leg. */
  progress?: SeparationProgress;
}

export interface SeparationEventResponse {
  id: number;
  separationId: number;
  event: string;
  note: string | null;
  createdBy: number | null;
  actorName?: string | null;
  createdAt: string;
}

/** Per-leg completion the UI renders as the exit workflow timeline. */
export interface SeparationProgress {
  clearances: { total: number; cleared: number; blocked: number };
  assetReturns: { total: number; returned: number; damagedOrLost: number };
  ktItems: { total: number; done: number };
  accessRevocations: { total: number; revoked: number };
  interviews: { total: number; completed: number };
  letters: { issued: number };
  settlementStatus: string | null;
}

export interface NoticeRuleResponse {
  id: number;
  workerType: string | null;
  grade: string | null;
  noticeDays: number;
  buyoutAllowed: boolean;
  buyoutRateBasis: 'PER_DAY_GROSS' | 'PER_DAY_BASIC';
  description: string | null;
  isActive: boolean;
}

export interface ExitInterviewResponse {
  id: number;
  separationId: number;
  employeeName?: string | null;
  interviewType: 'HR' | 'MANAGER';
  scheduledAt: string | null;
  interviewerUserId: number | null;
  interviewerName?: string | null;
  status: 'PENDING' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  summary: string | null;
  keyReasons: string | null;
  wouldRecommendCompany: boolean | null;
  completedAt: string | null;
}

export interface SurveyQuestionResponse {
  id: number;
  question: string;
  kind: 'TEXT' | 'RATING' | 'CHOICE';
  choices: string[] | null;
  sortOrder: number;
  isActive: boolean;
}

export interface ClearanceResponse {
  id: number;
  separationId: number;
  department: ClearanceDepartment;
  status: ClearanceStatus;
  note: string | null;
  clearedBy: number | null;
  clearedByName?: string | null;
  clearedAt: string | null;
  tasks?: ClearanceTaskResponse[];
}

export interface ClearanceTaskResponse {
  id: number;
  clearanceId: number;
  task: string;
  status: 'PENDING' | 'DONE' | 'NA';
  note: string | null;
  doneBy: number | null;
  doneAt: string | null;
  sortOrder: number;
}

export interface AssetReturnResponse {
  id: number;
  separationId: number;
  assetAssignmentId: number;
  assetName?: string | null;
  assetTag?: string | null;
  assetCategory?: string | null;
  assignedOn?: string | null;
  returnCondition: 'PENDING' | 'GOOD' | 'DAMAGED' | 'LOST';
  damageNote: string | null;
  damageCharge: number | null;
  returnedAt: string | null;
  verifiedBy: number | null;
}

export interface KtPlanResponse {
  id: number;
  separationId: number;
  employeeName?: string | null;
  successorEmployeeId: number | null;
  successorName?: string | null;
  status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'APPROVED';
  note: string | null;
  approvedBy: number | null;
  approvedAt: string | null;
  items?: KtItemResponse[];
}

export interface KtItemResponse {
  id: number;
  planId: number;
  itemType: 'SESSION' | 'DOCUMENT' | 'PROJECT_HANDOVER' | 'CLIENT_HANDOVER' | 'TEAM_HANDOVER' | 'RESPONSIBILITY';
  title: string;
  description: string | null;
  dueDate: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE';
  completedAt: string | null;
  sortOrder: number;
}

export interface AccessRevocationResponse {
  id: number;
  separationId: number;
  systemName: string;
  isInternal: boolean;
  status: 'PENDING' | 'REVOKED' | 'NA';
  note: string | null;
  revokedBy: number | null;
  revokedAt: string | null;
}

export interface ExitLetterResponse {
  id: number;
  separationId: number;
  employeeName?: string | null;
  letterType: ExitLetterType;
  letterNumber: string;
  status: 'DRAFT' | 'ISSUED' | 'EMAILED';
  generatedAt: string | null;
  emailedAt: string | null;
  emailError: string | null;
}

export interface AlumniResponse {
  id: number;
  employeeId: number;
  employeeName?: string | null;
  empCode?: string | null;
  separationId: number | null;
  exitDate: string | null;
  lastGrade: string | null;
  lastDepartment: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  rehireEligible: boolean | null;
  rehireRestrictionNote: string | null;
  isBoomerang: boolean;
  rehiredEmployeeId: number | null;
  rehiredAt: string | null;
  inAlumniNetwork: boolean;
  notes: string | null;
  latestDecision?: { decision: 'ELIGIBLE' | 'RESTRICTED' | 'BLOCKED'; reason: string | null; decidedAt: string } | null;
}
