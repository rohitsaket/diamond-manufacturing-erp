// Shared contract for the internal recruitment / talent marketplace module.
// Both backend work streams code against these shapes; extend in service
// files, do not fork this file.

export type RequisitionType = 'NEW_POSITION' | 'REPLACEMENT' | 'EXPANSION';
export type RequisitionStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'FULFILLED' | 'CANCELLED';
export type WorkMode = 'ONSITE' | 'REMOTE' | 'HYBRID';
export type InternalEmploymentType = 'FULL_TIME' | 'PART_TIME' | 'GIG' | 'SHORT_TERM';
export type InternalJobStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PUBLISHED' | 'PAUSED'
  | 'EXPIRED' | 'ARCHIVED' | 'FILLED' | 'CANCELLED';
export type ApplicationStatus =
  | 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'SHORTLISTED' | 'ASSESSMENT'
  | 'INTERVIEW' | 'SELECTED' | 'OFFERED' | 'HIRED' | 'REJECTED' | 'WITHDRAWN';
export type ReferralStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'ACCEPTED' | 'HIRED' | 'REJECTED' | 'WITHDRAWN';
export type InterviewRoundType = 'HR_SCREENING' | 'TECHNICAL' | 'MANAGER' | 'PANEL' | 'FINAL';
export type InterviewStatus = 'SCHEDULED' | 'RESCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type OfferType = 'INTERNAL_TRANSFER' | 'PROMOTION' | 'SALARY_REVISION' | 'GIG_ASSIGNMENT';
export type OfferStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'RELEASED' | 'ACCEPTED'
  | 'DECLINED' | 'EXPIRED' | 'WITHDRAWN' | 'EFFECTED';

/** The whole eligibility rules object stored as JSON on internal_jobs. */
export interface EligibilityRules {
  minTenureMonths?: number | null;
  allowedGrades?: string[];
  minPerformanceRating?: number | null;
  requiredSkills?: string[];
  requiredCertifications?: string[];
  maxNoticeDays?: number | null;
}

/** One rule's evaluation. pass=null means the rule could not be evaluated
 * (e.g. no appraisal exists) - it warns but does not block, and the detail
 * says why. Never fabricate a pass. */
export interface EligibilityCheck {
  rule: string;
  pass: boolean | null;
  detail: string;
}

export interface RequisitionResponse {
  id: number;
  reqCode: string;
  requisitionType: RequisitionType;
  title: string;
  positionId: number | null;
  positionTitle?: string | null;
  departmentId: number | null;
  departmentName?: string | null;
  jobRoleId: number | null;
  jobRoleName?: string | null;
  headcount: number;
  replacementForEmployeeId: number | null;
  replacementForName?: string | null;
  justification: string | null;
  budgetAmount: number | null;
  budgetApproved: boolean;
  status: RequisitionStatus;
  requestedBy: number | null;
  approvedBy: number | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface InternalJobResponse {
  id: number;
  jobCode: string;
  requisitionId: number | null;
  openingId: number | null;
  title: string;
  description: string | null;
  category: string | null;
  departmentId: number | null;
  departmentName?: string | null;
  teamId: number | null;
  jobRoleId: number | null;
  jobRoleName?: string | null;
  grade: string | null;
  location: string | null;
  workMode: WorkMode;
  employmentType: InternalEmploymentType;
  openings: number;
  salaryRangeMin: number | null;
  salaryRangeMax: number | null;
  eligibilityRules: EligibilityRules | null;
  isFeatured: boolean;
  isConfidential: boolean;
  visibility: 'ALL' | 'DEPARTMENT';
  visibilityDepartmentId: number | null;
  status: InternalJobStatus;
  publishAt: string | null;
  expiresAt: string | null;
  publishedAt: string | null;
  filledAt: string | null;
  hiringManagerEmployeeId: number | null;
  hiringManagerName?: string | null;
  applicationCount?: number;
  createdAt: string;
  /** Set on portal reads for the calling employee. */
  saved?: boolean;
  favorite?: boolean;
  applied?: boolean;
  /** Rule-based match info on recommended lists. Explicitly NOT AI. */
  matchScore?: number;
  matchReasons?: string[];
}

export interface ApplicationResponse {
  id: number;
  jobId: number;
  jobCode?: string;
  jobTitle?: string;
  employeeId: number;
  employeeName?: string | null;
  empCode?: string | null;
  grade?: string | null;
  status: ApplicationStatus;
  coverLetter: string | null;
  resumeDocumentId: number | null;
  expectedNoticeDays: number | null;
  eligibilityResult: EligibilityCheck[] | null;
  eligibilityPassed: boolean | null;
  eligibilityOverride: boolean;
  overrideReason: string | null;
  submittedAt: string | null;
  withdrawnAt: string | null;
  withdrawReason: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  timeline?: StageEventResponse[];
}

export interface StageEventResponse {
  id: number;
  applicationId: number;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdBy: number | null;
  actorName?: string | null;
  createdAt: string;
}

export interface ReferralResponse {
  id: number;
  jobId: number | null;
  jobTitle?: string | null;
  referrerEmployeeId: number;
  referrerName?: string | null;
  referredEmployeeId: number | null;
  referredName?: string | null;
  externalName: string | null;
  externalPhone: string | null;
  externalEmail: string | null;
  note: string | null;
  status: ReferralStatus;
  applicationId: number | null;
  candidateId: number | null;
  rewardPoints: number;
  rewardRecognitionId: number | null;
  approvedBy: number | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface InterviewRoundResponse {
  id: number;
  applicationId: number;
  jobTitle?: string | null;
  applicantName?: string | null;
  roundNo: number;
  roundType: InterviewRoundType;
  scheduledAt: string;
  durationMinutes: number;
  mode: 'IN_PERSON' | 'PHONE' | 'VIDEO';
  location: string | null;
  meetingLink: string | null;
  panel: { employeeId?: number; userId?: number; name: string; role?: string }[] | null;
  status: InterviewStatus;
  rescheduleReason: string | null;
  outcome: 'PENDING' | 'PASS' | 'FAIL' | 'ON_HOLD';
  feedback?: InterviewFeedbackResponse[];
  createdAt: string;
}

export interface InterviewFeedbackResponse {
  id: number;
  roundId: number;
  interviewerEmployeeId: number | null;
  interviewerName?: string | null;
  scorecard: { criterion: string; score: number; comment?: string }[] | null;
  overallScore: number | null;
  recommendation: 'STRONG_YES' | 'YES' | 'NEUTRAL' | 'NO' | 'STRONG_NO' | null;
  comments: string | null;
  submittedAt: string | null;
}

export interface AssessmentResponse {
  id: number;
  code: string;
  name: string;
  assessmentType: 'TECHNICAL' | 'APTITUDE' | 'CODING' | 'BEHAVIORAL' | 'LEADERSHIP' | 'SKILL';
  description: string | null;
  maxScore: number;
  passScore: number | null;
  durationMinutes: number | null;
  isActive: boolean;
}

export interface AssessmentResultResponse {
  id: number;
  assessmentId: number;
  assessmentName?: string;
  applicationId: number | null;
  employeeId: number;
  employeeName?: string | null;
  score: number | null;
  result: 'PENDING' | 'PASS' | 'FAIL';
  notes: string | null;
  assessedBy: number | null;
  assessedAt: string | null;
}

export interface OfferResponse {
  id: number;
  offerCode: string;
  applicationId: number;
  jobTitle?: string | null;
  employeeId?: number;
  employeeName?: string | null;
  offerType: OfferType;
  title: string;
  toDepartmentId: number | null;
  toDepartmentName?: string | null;
  toTeamId: number | null;
  toRoleId: number | null;
  toRoleName?: string | null;
  toPositionId: number | null;
  toGrade: string | null;
  salaryRevisionPct: number | null;
  salaryRevisionAmount: number | null;
  effectiveDate: string | null;
  validUntil: string | null;
  terms: string | null;
  letterNumber: string | null;
  letterGeneratedAt: string | null;
  status: OfferStatus;
  releasedAt: string | null;
  respondedAt: string | null;
  responseNote: string | null;
  effectedAt: string | null;
  createdAt: string;
}

export interface CareerInterestResponse {
  id: number;
  employeeId: number;
  employeeName?: string | null;
  preferredRoles: string[];
  preferredDepartments: string[];
  workModePreference: 'ANY' | 'ONSITE' | 'REMOTE' | 'HYBRID';
  willingToRelocate: boolean;
  openToGigs: boolean;
  careerStatement: string | null;
  updatedAt: string;
}
