// Typed helpers for the employee profile endpoints.
import { api } from './client';
import type {
  FamilyMember,
  EducationRecord,
  Skill,
  EmployeeSkill,
  SkillGapRow,
  Certification,
  LanguageRecord,
  ExperienceRecord,
  TimelineEvent,
  EmployeeSettings,
  EmploymentDetails,
  OrganizationDetails,
  OrgChartNode,
  CompletenessRow,
  DirectoryEntry,
} from '../types/profile';
import type { EmployeeProfile, EmployeeDocument } from '../types/hrms';

/**
 * Skill-gap analysis is only meaningful when the employee's grade has target
 * ratings configured, so the server reports availability explicitly rather than
 * returning an empty list that would read as a perfect score.
 */
export interface SkillGapResult {
  available: boolean;
  message?: string;
  rows: SkillGapRow[];
}

export interface ExperienceSummary {
  priorMonths: number;
  currentTenureMonths: number;
  totalMonths: number;
  totalYears: number;
  display: string;
}

const qs = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.append(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

/** Core employee record: personal, contact, employment, organization, bank, payroll. */
export const profileCoreApi = {
  get: (id: number) => api.get<EmployeeProfile>(`/employees/${id}/profile`),
  update: (id: number, body: Record<string, unknown>) =>
    api.put<EmployeeProfile>(`/employees/${id}/profile`, body),
  employment: (id: number) => api.get<EmploymentDetails>(`/employees/${id}/employment`),
  organization: (id: number) => api.get<OrganizationDetails>(`/employees/${id}/organization`),
  completeness: (id: number) => api.get<CompletenessRow[]>(`/employees/${id}/completeness`),
  directory: (filters: { search?: string; department?: string; branch?: string; workStatus?: string } = {}) =>
    api.get<DirectoryEntry[]>(`/employees/directory${qs(filters)}`),
  documents: (id: number) => api.get<EmployeeDocument[]>(`/employees/${id}/documents`),
  uploadDocument: (id: number, file: File, docType: string, title?: string) =>
    api.upload<EmployeeDocument>(`/employees/${id}/documents`, file, {
      docType,
      ...(title ? { title } : {}),
    }),
  uploadPhoto: (id: number, file: File) => api.upload<EmployeeProfile>(`/employees/${id}/photo`, file),
  verifyDocument: (docId: number) => api.put<{ success: boolean }>(`/employees/documents/${docId}/verify`, {}),
  deleteDocument: (docId: number) => api.delete<{ success: boolean }>(`/employees/documents/${docId}`),
  documentUrl: (docId: number) => `/employees/documents/${docId}/download`,
};

/** Repeating profile sections. */
export const profileApi = {
  family: (id: number) => api.get<FamilyMember[]>(`/profile/${id}/family`),
  addFamily: (id: number, body: Partial<FamilyMember>) => api.post<FamilyMember>(`/profile/${id}/family`, body),
  updateFamily: (itemId: number, body: Partial<FamilyMember>) =>
    api.put<FamilyMember>(`/profile/family/${itemId}`, body),
  deleteFamily: (itemId: number) => api.delete<{ success: boolean }>(`/profile/family/${itemId}`),

  education: (id: number) => api.get<EducationRecord[]>(`/profile/${id}/education`),
  addEducation: (id: number, body: Partial<EducationRecord>) =>
    api.post<EducationRecord>(`/profile/${id}/education`, body),
  updateEducation: (itemId: number, body: Partial<EducationRecord>) =>
    api.put<EducationRecord>(`/profile/education/${itemId}`, body),
  deleteEducation: (itemId: number) => api.delete<{ success: boolean }>(`/profile/education/${itemId}`),

  certifications: (id: number) => api.get<Certification[]>(`/profile/${id}/certifications`),
  addCertification: (id: number, body: Partial<Certification>) =>
    api.post<Certification>(`/profile/${id}/certifications`, body),
  updateCertification: (itemId: number, body: Partial<Certification>) =>
    api.put<Certification>(`/profile/certifications/${itemId}`, body),
  deleteCertification: (itemId: number) => api.delete<{ success: boolean }>(`/profile/certifications/${itemId}`),

  languages: (id: number) => api.get<LanguageRecord[]>(`/profile/${id}/languages`),
  addLanguage: (id: number, body: Partial<LanguageRecord>) =>
    api.post<LanguageRecord>(`/profile/${id}/languages`, body),
  updateLanguage: (itemId: number, body: Partial<LanguageRecord>) =>
    api.put<LanguageRecord>(`/profile/languages/${itemId}`, body),
  deleteLanguage: (itemId: number) => api.delete<{ success: boolean }>(`/profile/languages/${itemId}`),

  experience: (id: number) => api.get<ExperienceRecord[]>(`/profile/${id}/experience`),
  totalExperience: (id: number) => api.get<ExperienceSummary>(`/profile/${id}/experience/total`),
  addExperience: (id: number, body: Partial<ExperienceRecord>) =>
    api.post<ExperienceRecord>(`/profile/${id}/experience`, body),
  updateExperience: (itemId: number, body: Partial<ExperienceRecord>) =>
    api.put<ExperienceRecord>(`/profile/experience/${itemId}`, body),
  deleteExperience: (itemId: number) => api.delete<{ success: boolean }>(`/profile/experience/${itemId}`),

  timeline: (id: number) => api.get<TimelineEvent[]>(`/profile/${id}/timeline`),
  addTimeline: (id: number, body: Partial<TimelineEvent>) =>
    api.post<TimelineEvent>(`/profile/${id}/timeline`, body),
  updateTimeline: (itemId: number, body: Partial<TimelineEvent>) =>
    api.put<TimelineEvent>(`/profile/timeline/${itemId}`, body),
  deleteTimeline: (itemId: number) => api.delete<{ success: boolean }>(`/profile/timeline/${itemId}`),

  skills: (id: number) => api.get<EmployeeSkill[]>(`/profile/${id}/skills`),
  setSkill: (id: number, body: Partial<EmployeeSkill>) => api.put<EmployeeSkill>(`/profile/${id}/skills`, body),
  removeSkill: (id: number, skillId: number) =>
    api.delete<{ success: boolean }>(`/profile/${id}/skills/${skillId}`),
  skillGap: (id: number) => api.get<SkillGapResult>(`/profile/${id}/skill-gap`),
  skillMaster: (category?: string) => api.get<Skill[]>(`/profile/skills${qs({ category })}`),
  createSkill: (body: Partial<Skill>) => api.post<Skill>('/profile/skills', body),

  settings: (id: number) => api.get<EmployeeSettings>(`/profile/${id}/settings`),
  updateSettings: (id: number, body: Partial<EmployeeSettings>) =>
    api.put<EmployeeSettings>(`/profile/${id}/settings`, body),

  orgChart: (rootId?: number) =>
    api.get<OrgChartNode | OrgChartNode[]>(rootId ? `/profile/org-chart/${rootId}` : '/profile/org-chart'),
  reportingChain: (id: number) => api.get<OrgChartNode[]>(`/profile/${id}/reporting-chain`),
};
