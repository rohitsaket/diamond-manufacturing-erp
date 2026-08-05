// Shared contract for the performance management module. Both backend work
// streams code against these shapes; extend in service files, do not fork.

export type CycleType = 'ANNUAL' | 'HALF_YEARLY' | 'QUARTERLY' | 'MONTHLY' | 'PROBATION' | 'PROJECT' | 'CUSTOM';
export type CycleStatus = 'DRAFT' | 'GOAL_SETTING' | 'ACTIVE' | 'SELF_REVIEW' | 'MANAGER_REVIEW' | 'CALIBRATION' | 'CLOSED';
export type GoalKind = 'GOAL' | 'OBJECTIVE' | 'KEY_RESULT';
export type GoalScope = 'INDIVIDUAL' | 'TEAM' | 'DEPARTMENT' | 'ORGANIZATION';
export type GoalStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';
export type ProgressMode = 'MANUAL' | 'METRIC' | 'MILESTONES' | 'CHILDREN';
export type ReviewType = 'SELF' | 'MANAGER' | 'PEER' | 'SUBORDINATE' | 'CUSTOMER' | 'EXTERNAL';
export type ReviewStatus = 'REQUESTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'ACKNOWLEDGED' | 'DECLINED';
export type AppraisalStatus = 'PENDING' | 'IN_REVIEW' | 'CALIBRATED' | 'FINALIZED' | 'LETTER_ISSUED' | 'ACKNOWLEDGED';
export type PromotionStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EFFECTED';
export type PipStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'EXTENDED' | 'CLOSED_SUCCESSFUL' | 'CLOSED_UNSUCCESSFUL' | 'WITHDRAWN' | 'ESCALATED';
export type KpiAutoSource = 'NONE' | 'PRODUCTION_PIECES' | 'PRODUCTION_VALUE' | 'ATTENDANCE_PCT' | 'OT_HOURS';

export interface CycleResponse {
  id: number;
  code: string;
  name: string;
  cycleType: CycleType;
  financialYear: string | null;
  startDate: string;
  endDate: string;
  goalSettingStart: string | null;
  goalSettingEnd: string | null;
  selfReviewStart: string | null;
  selfReviewEnd: string | null;
  managerReviewStart: string | null;
  managerReviewEnd: string | null;
  calibrationStart: string | null;
  calibrationEnd: string | null;
  status: CycleStatus;
  description: string | null;
  createdAt: string;
}

export interface ReviewTemplateResponse {
  id: number;
  code: string;
  name: string;
  appliesTo: ReviewType | 'ALL';
  ratingScale: number;
  sections: TemplateSection[];
  isActive: boolean;
}

export interface TemplateSection {
  section: string;
  questions: { kind: 'TEXT' | 'RATING' | 'COMPETENCY'; question: string; competencyId?: number }[];
}

export interface GoalResponse {
  id: number;
  cycleId: number;
  kind: GoalKind;
  scope: GoalScope;
  employeeId: number | null;
  employeeName?: string | null;
  teamId: number | null;
  teamName?: string | null;
  departmentId: number | null;
  departmentName?: string | null;
  parentGoalId: number | null;
  title: string;
  description: string | null;
  category: string | null;
  metricName: string | null;
  metricUnit: string | null;
  startValue: number | null;
  targetValue: number | null;
  currentValue: number | null;
  weightagePct: number;
  progressPct: number;
  progressMode: ProgressMode;
  status: GoalStatus;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  visibility: 'PRIVATE' | 'MANAGER' | 'ORGANIZATION';
  dueDate: string | null;
  completedAt: string | null;
  approvedBy: number | null;
  approvedAt: string | null;
  createdAt: string;
  milestones?: GoalMilestoneResponse[];
  children?: GoalResponse[];
}

export interface GoalMilestoneResponse {
  id: number;
  goalId: number;
  title: string;
  dueDate: string | null;
  status: 'PENDING' | 'COMPLETED' | 'MISSED';
  completedAt: string | null;
  sortOrder: number;
}

export interface GoalUpdateResponse {
  id: number;
  goalId: number;
  updateType: 'PROGRESS' | 'COMMENT' | 'STATUS' | 'APPROVAL';
  progressPct: number | null;
  currentValue: number | null;
  note: string | null;
  createdBy: number | null;
  actorName?: string | null;
  createdAt: string;
}

export interface KpiResponse {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: 'PRODUCTION' | 'QUALITY' | 'ATTENDANCE' | 'FINANCE' | 'PEOPLE' | 'CUSTOM';
  unit: string | null;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER' | 'TARGET_BAND';
  formula: string | null;
  autoSource: KpiAutoSource;
  isActive: boolean;
}

export interface KpiAssignmentResponse {
  id: number;
  kpiId: number;
  kpiCode: string;
  kpiName: string;
  unit: string | null;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER' | 'TARGET_BAND';
  autoSource: KpiAutoSource;
  cycleId: number;
  scope: GoalScope;
  employeeId: number | null;
  employeeName?: string | null;
  teamId: number | null;
  departmentId: number | null;
  departmentName?: string | null;
  weightagePct: number;
  targetValue: number | null;
  thresholdValue: number | null;
  stretchValue: number | null;
  actualValue: number | null;
  achievementPct: number | null;
  score: number | null;
  lastComputedAt: string | null;
  status: 'ACTIVE' | 'CLOSED';
}

export interface KraResponse {
  id: number;
  code: string;
  name: string;
  description: string | null;
  departmentId: number | null;
  departmentName?: string | null;
  defaultWeightagePct: number;
  isActive: boolean;
}

export interface EmployeeKraResponse {
  id: number;
  kraId: number;
  kraCode: string;
  kraName: string;
  employeeId: number;
  employeeName?: string | null;
  cycleId: number;
  weightagePct: number;
  selfScore: number | null;
  managerScore: number | null;
  finalScore: number | null;
  remarks: string | null;
  status: 'ASSIGNED' | 'SELF_SCORED' | 'REVIEWED' | 'FINALIZED';
}

// Anonymity contract: reviewerEmployeeId / reviewerName / reviewerUserId MUST
// be nulled out by the service for anonymous reviews unless the caller is
// admin or hr. Peer reviews requested as anonymous stay anonymous everywhere
// else, including for the subject and the subject's manager.
export interface ReviewResponse {
  id: number;
  cycleId: number;
  cycleName?: string | null;
  employeeId: number;
  employeeName?: string | null;
  reviewType: ReviewType;
  reviewerEmployeeId: number | null;
  reviewerName?: string | null;
  reviewerUserId: number | null;
  externalReviewerName: string | null;
  templateId: number | null;
  status: ReviewStatus;
  isAnonymous: boolean;
  overallRating: number | null;
  achievements: string | null;
  challenges: string | null;
  learnings: string | null;
  developmentNotes: string | null;
  dueDate: string | null;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  responses?: ReviewResponseItem[];
}

export interface ReviewResponseItem {
  id: number;
  reviewId: number;
  section: string | null;
  question: string;
  responseText: string | null;
  rating: number | null;
  competencyId: number | null;
  sortOrder: number;
}

export interface CompetencyResponse {
  id: number;
  code: string;
  name: string;
  category: 'TECHNICAL' | 'FUNCTIONAL' | 'LEADERSHIP' | 'BEHAVIORAL';
  description: string | null;
  levels: Record<string, string> | null;
  isActive: boolean;
}

export interface CompetencyRatingResponse {
  id: number;
  employeeId: number;
  employeeName?: string | null;
  competencyId: number;
  competencyCode?: string;
  competencyName?: string;
  category?: string;
  cycleId: number | null;
  reviewId: number | null;
  rating: number;
  ratedByType: 'SELF' | 'MANAGER' | 'PEER' | 'OTHER';
  note: string | null;
  createdAt: string;
}

export interface DevelopmentPlanResponse {
  id: number;
  employeeId: number;
  employeeName?: string | null;
  cycleId: number | null;
  title: string;
  careerGoal: string | null;
  targetRoleId: number | null;
  targetRoleName?: string | null;
  mentorEmployeeId: number | null;
  mentorName?: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  startDate: string | null;
  endDate: string | null;
  progressPct: number;
  reviewNotes: string | null;
  items?: DevelopmentPlanItemResponse[];
}

export interface DevelopmentPlanItemResponse {
  id: number;
  planId: number;
  itemType: 'TRAINING' | 'CERTIFICATION' | 'MENTORING' | 'PROJECT' | 'READING' | 'OTHER';
  title: string;
  description: string | null;
  trainingId: number | null;
  trainingTitle?: string | null;
  dueDate: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  completedAt: string | null;
  sortOrder: number;
}

export interface PipResponse {
  id: number;
  employeeId: number;
  employeeName?: string | null;
  cycleId: number | null;
  reason: string;
  startDate: string;
  endDate: string;
  status: PipStatus;
  outcomeNote: string | null;
  closedAt: string | null;
  openedBy: number | null;
  approvedBy: number | null;
  approvedAt: string | null;
  objectives?: PipObjectiveResponse[];
  reviews?: PipReviewResponse[];
}

export interface PipObjectiveResponse {
  id: number;
  pipId: number;
  objective: string;
  successCriteria: string | null;
  status: 'PENDING' | 'ON_TRACK' | 'AT_RISK' | 'MET' | 'NOT_MET';
  sortOrder: number;
}

export interface PipReviewResponse {
  id: number;
  pipId: number;
  reviewDate: string;
  progress: 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK';
  summary: string | null;
  nextSteps: string | null;
  createdBy: number | null;
  createdAt: string;
}

export interface AppraisalResponse {
  id: number;
  cycleId: number;
  cycleName?: string | null;
  employeeId: number;
  employeeName?: string | null;
  empCode?: string | null;
  goalScore: number | null;
  kraScore: number | null;
  kpiScore: number | null;
  competencyScore: number | null;
  totalScore: number | null;
  selfRating: number | null;
  managerRating: number | null;
  calibratedRating: number | null;
  finalRating: number | null;
  ratingLabel: string | null;
  salaryIncreasePct: number | null;
  promotionRecommended: boolean;
  status: AppraisalStatus;
  remarks: string | null;
  letterNumber: string | null;
  letterGeneratedAt: string | null;
  finalizedAt: string | null;
}

export interface PromotionResponse {
  id: number;
  employeeId: number;
  employeeName?: string | null;
  appraisalId: number | null;
  fromGrade: string | null;
  toGrade: string | null;
  fromRoleId: number | null;
  fromRoleName?: string | null;
  toRoleId: number | null;
  toRoleName?: string | null;
  fromPositionId: number | null;
  toPositionId: number | null;
  salaryImpactPct: number | null;
  salaryImpactAmount: number | null;
  effectiveDate: string | null;
  justification: string | null;
  status: PromotionStatus;
  letterNumber: string | null;
  requestedBy: number | null;
  approvedBy: number | null;
  approvedAt: string | null;
  effectedAt: string | null;
  createdAt: string;
}

export interface TalentAssessmentResponse {
  id: number;
  cycleId: number;
  employeeId: number;
  employeeName?: string | null;
  empCode?: string | null;
  grade?: string | null;
  performanceScore: number;
  potentialScore: number;
  boxPosition: number;
  isHipo: boolean;
  attritionRisk: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  assessmentNote: string | null;
  updatedAt: string;
}

export interface TalentPoolResponse {
  id: number;
  code: string;
  name: string;
  poolType: 'HIPO' | 'LEADERSHIP' | 'CRITICAL_SKILL' | 'SUCCESSOR' | 'CUSTOM';
  description: string | null;
  isActive: boolean;
  memberCount?: number;
  members?: { id: number; employeeId: number; employeeName: string; note: string | null; addedAt: string }[];
}

export interface SuccessionPlanResponse {
  id: number;
  positionId: number | null;
  positionName?: string | null;
  roleId: number | null;
  roleName?: string | null;
  incumbentEmployeeId: number | null;
  incumbentName?: string | null;
  criticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskOfLoss: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'ACTIVE' | 'CLOSED';
  notes: string | null;
  candidates?: SuccessionCandidateResponse[];
}

export interface SuccessionCandidateResponse {
  id: number;
  planId: number;
  employeeId: number;
  employeeName?: string | null;
  readiness: 'READY_NOW' | 'READY_1_YEAR' | 'READY_2_YEARS' | 'DEVELOPMENT_NEEDED';
  ranking: number | null;
  developmentNote: string | null;
}

export interface CalibrationSessionResponse {
  id: number;
  cycleId: number;
  cycleName?: string | null;
  name: string;
  sessionDate: string | null;
  departmentId: number | null;
  departmentName?: string | null;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';
  committee: { name: string; role?: string }[] | null;
  notes: string | null;
  adjustments?: CalibrationAdjustmentResponse[];
}

export interface CalibrationAdjustmentResponse {
  id: number;
  sessionId: number;
  appraisalId: number;
  employeeName?: string | null;
  previousRating: number | null;
  adjustedRating: number;
  reason: string | null;
  createdAt: string;
}

// Anonymity contract mirrors reviews: fromEmployeeId/fromName are nulled for
// anonymous feedback unless the caller is admin or hr.
export interface FeedbackResponse {
  id: number;
  toEmployeeId: number;
  toEmployeeName?: string | null;
  fromEmployeeId: number | null;
  fromUserId: number | null;
  fromName?: string | null;
  feedbackType: 'FEEDBACK' | 'APPRECIATION' | 'COACHING' | 'SUGGESTION' | 'IMPROVEMENT';
  message: string;
  visibility: 'PRIVATE' | 'MANAGER' | 'PUBLIC';
  isAnonymous: boolean;
  relatedGoalId: number | null;
  createdAt: string;
}

export interface RecognitionResponse {
  id: number;
  employeeId: number;
  employeeName?: string | null;
  awardType: 'SPOT' | 'ACHIEVEMENT' | 'MILESTONE' | 'SERVICE' | 'TEAM' | 'CUSTOM';
  title: string;
  citation: string | null;
  points: number;
  monetaryAmount: number | null;
  payAwardId: number | null;
  cycleId: number | null;
  isPublic: boolean;
  awardedBy: number | null;
  awardedByName?: string | null;
  awardedAt: string | null;
}

export interface RewardLedgerEntryResponse {
  id: number;
  employeeId: number;
  entryType: 'EARNED' | 'REDEEMED' | 'ADJUSTED' | 'EXPIRED';
  points: number;
  recognitionId: number | null;
  redemptionId: number | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

export interface RewardRedemptionResponse {
  id: number;
  employeeId: number;
  employeeName?: string | null;
  points: number;
  rewardItem: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'FULFILLED';
  note: string | null;
  requestedAt: string;
  decidedBy: number | null;
  decidedAt: string | null;
}

export interface PerfAuditLogResponse {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  userId: number | null;
  userName?: string | null;
  userRole: string | null;
  previousValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

// Context every write path should carry for audit logging.
export interface PerfActionContext {
  userId: number;
  userRole: string;
  actorName?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}
