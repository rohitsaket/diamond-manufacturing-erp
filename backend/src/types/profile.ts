// Employee profile domain types (personal, family, education, skills,
// certifications, languages, experience, timeline and settings).

export type FamilyRelation = 'FATHER' | 'MOTHER' | 'SPOUSE' | 'CHILD' | 'SIBLING' | 'GUARDIAN' | 'OTHER';
export type EducationLevel =
  | 'SCHOOL' | 'HIGHER_SECONDARY' | 'DIPLOMA' | 'GRADUATION' | 'POST_GRADUATION' | 'DOCTORATE' | 'OTHER';
export type GradeType = 'PERCENTAGE' | 'CGPA' | 'GRADE';
export type SkillCategory = 'TECHNICAL' | 'FUNCTIONAL' | 'SOFT';
export type ExperienceLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT';
export type CertificationType = 'PROFESSIONAL' | 'TECHNICAL' | 'LICENSE' | 'OTHER';
export type LanguageProficiency = 'BASIC' | 'CONVERSATIONAL' | 'PROFICIENT' | 'FLUENT' | 'NATIVE';
export type PriorEmploymentType = 'PERMANENT' | 'CONTRACT' | 'PART_TIME' | 'INTERNSHIP' | 'FREELANCE';
export type TimelineEventType =
  | 'JOINED' | 'CONFIRMED' | 'PROMOTION' | 'TRANSFER' | 'SALARY_REVISION'
  | 'AWARD' | 'DISCIPLINARY' | 'PERFORMANCE_REVIEW' | 'TRAINING' | 'EXIT' | 'OTHER';
export type EmploymentType = 'PERMANENT' | 'CONTRACT' | 'PROBATION' | 'TRAINEE' | 'CONSULTANT';
export type MaritalStatus = 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED' | 'OTHER';
export type DocumentCategory =
  | 'IDENTITY' | 'ADDRESS' | 'EDUCATION' | 'EXPERIENCE' | 'BANK' | 'MEDICAL' | 'EMPLOYMENT' | 'FAMILY' | 'OTHER';
export type ProfileVisibility = 'EVERYONE' | 'TEAM' | 'HR_ONLY';

export interface FamilyMemberResponse {
  id: number;
  employeeId: number;
  relation: FamilyRelation;
  fullName: string;
  dob: string | null;
  occupation: string | null;
  phone: string | null;
  isDependent: boolean;
  isNominee: boolean;
  nomineeSharePct: number | null;
  aadhaarMasked: string | null;
  notes: string | null;
}

export interface EducationResponse {
  id: number;
  employeeId: number;
  level: EducationLevel;
  degree: string | null;
  specialization: string | null;
  institution: string | null;
  boardUniversity: string | null;
  passingYear: number | null;
  gradeValue: number | null;
  gradeType: GradeType | null;
  documentId: number | null;
  notes: string | null;
}

export interface SkillResponse {
  id: number;
  name: string;
  category: SkillCategory;
  description: string | null;
}

export interface EmployeeSkillResponse {
  id: number;
  employeeId: number;
  skillId: number;
  skillName: string;
  category: SkillCategory;
  rating: number;
  experienceLevel: ExperienceLevel;
  yearsExperience: number | null;
  lastUsedYear: number | null;
  notes: string | null;
}

export interface SkillGapRow {
  skillId: number;
  skillName: string;
  category: SkillCategory;
  targetRating: number;
  currentRating: number;
  gap: number;
}

export interface CertificationResponse {
  id: number;
  employeeId: number;
  name: string;
  certType: CertificationType;
  issuingAuthority: string | null;
  credentialId: string | null;
  issuedOn: string | null;
  validUntil: string | null;
  renewalDate: string | null;
  documentId: number | null;
  notes: string | null;
  isExpired: boolean;
  expiringSoon: boolean;
}

export interface LanguageResponse {
  id: number;
  employeeId: number;
  language: string;
  canRead: boolean;
  canWrite: boolean;
  canSpeak: boolean;
  proficiency: LanguageProficiency;
  isNative: boolean;
}

export interface ExperienceResponse {
  id: number;
  employeeId: number;
  companyName: string;
  designation: string | null;
  employmentType: PriorEmploymentType | null;
  industry: string | null;
  location: string | null;
  fromDate: string;
  toDate: string | null;
  isCurrent: boolean;
  lastSalary: number | null;
  reasonForLeaving: string | null;
  projects: string | null;
  referenceName: string | null;
  referenceDesignation: string | null;
  referencePhone: string | null;
  referenceEmail: string | null;
  documentId: number | null;
  months: number;
}

export interface TimelineEventResponse {
  id: number;
  employeeId: number;
  eventType: TimelineEventType;
  eventDate: string;
  title: string;
  details: string | null;
  fromValue: string | null;
  toValue: string | null;
  amount: number | null;
  rating: number | null;
  documentId: number | null;
  recordedBy: string | null;
  createdAt: string;
}

export interface EmployeeSettingsResponse {
  employeeId: number;
  profileVisibility: ProfileVisibility;
  showContactToPeers: boolean;
  showBirthday: boolean;
  notifyLeave: boolean;
  notifyPayroll: boolean;
  notifyAttendance: boolean;
  notifyAnnouncements: boolean;
  notifyEmail: boolean;
  language: string;
  theme: 'light' | 'dark' | 'system';
  dateFormat: string;
  twoFactorEnabled: boolean;
}

/** Everything the profile page needs about employment and organization placement. */
export interface EmploymentDetailsResponse {
  employeeId: number;
  empCode: string;
  employmentStatus: string;
  employmentType: EmploymentType | null;
  joinedAt: string;
  confirmationDate: string | null;
  probationMonths: number | null;
  noticePeriodDays: number | null;
  exitDate: string | null;
  retirementDate: string | null;
  workLocation: string | null;
  officeLocation: string | null;
  shiftId: number | null;
  shiftName: string | null;
  grade: string;
  designation: string | null;
  jobRole: string | null;
  jobLevel: string | null;
  reportingManagerId: number | null;
  reportingManagerName: string | null;
  hrPartnerId: number | null;
  hrPartnerName: string | null;
  costCenter: string | null;
  payrollGroup: string | null;
  tenureMonths: number;
}

export interface OrganizationDetailsResponse {
  employeeId: number;
  company: string | null;
  businessUnit: string | null;
  division: string | null;
  department: string | null;
  section: string | null;
  team: string | null;
  branch: string | null;
  region: string | null;
  country: string | null;
  legalEntity: string | null;
}

export interface OrgChartNode {
  employeeId: number;
  empCode: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  photoUrl: string | null;
  reports: OrgChartNode[];
}

/** Aggregate returned by GET /employees/:id/profile/full. */
export interface FullProfileResponse {
  personal: Record<string, unknown>;
  contact: Record<string, unknown>;
  employment: EmploymentDetailsResponse;
  organization: OrganizationDetailsResponse;
  bank: Record<string, unknown>;
  payroll: Record<string, unknown>;
  family: FamilyMemberResponse[];
  education: EducationResponse[];
  skills: EmployeeSkillResponse[];
  certifications: CertificationResponse[];
  languages: LanguageResponse[];
  experience: ExperienceResponse[];
  timeline: TimelineEventResponse[];
  settings: EmployeeSettingsResponse;
  completeness: { section: string; filled: number; total: number; pct: number }[];
}
