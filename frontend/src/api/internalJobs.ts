// Typed helpers for the internal recruitment / talent marketplace endpoints
// (/internal-jobs: portal, requisitions, jobs, applications, referrals;
//  /internal-hiring: interviews, assessments, offers, career, analytics).
import { api, BASE_URL } from './client';

const qs = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.append(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const internalJobsApi = {
  // Requisitions
  requisitions: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/internal-jobs/requisitions${qs(filters)}`),
  requisition: (id: number) => api.get<any>(`/internal-jobs/requisitions/${id}`),
  createRequisition: (body: Record<string, unknown>) => api.post<any>('/internal-jobs/requisitions', body),
  updateRequisition: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/internal-jobs/requisitions/${id}`, body),
  submitRequisition: (id: number) => api.post<any>(`/internal-jobs/requisitions/${id}/submit`, {}),
  approveRequisition: (id: number) => api.post<any>(`/internal-jobs/requisitions/${id}/approve`, {}),
  rejectRequisition: (id: number, reason: string) =>
    api.post<any>(`/internal-jobs/requisitions/${id}/reject`, { reason }),
  cancelRequisition: (id: number) => api.post<any>(`/internal-jobs/requisitions/${id}/cancel`, {}),
  budgetApproveRequisition: (id: number) => api.put<any>(`/internal-jobs/requisitions/${id}/budget-approve`, {}),
  vacancies: () => api.get<any>('/internal-jobs/requisitions/vacancies'),

  // Job management (staff)
  jobs: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/internal-jobs/jobs${qs(filters)}`),
  job: (id: number) => api.get<any>(`/internal-jobs/jobs/${id}`),
  createJob: (body: Record<string, unknown>) => api.post<any>('/internal-jobs/jobs', body),
  updateJob: (id: number, body: Record<string, unknown>) => api.put<any>(`/internal-jobs/jobs/${id}`, body),
  submitJob: (id: number) => api.post<any>(`/internal-jobs/jobs/${id}/submit`, {}),
  approveJob: (id: number) => api.post<any>(`/internal-jobs/jobs/${id}/approve`, {}),
  publishJob: (id: number, body: { publishAt?: string; expiresAt?: string } = {}) =>
    api.post<any>(`/internal-jobs/jobs/${id}/publish`, body),
  pauseJob: (id: number) => api.post<any>(`/internal-jobs/jobs/${id}/pause`, {}),
  resumeJob: (id: number) => api.post<any>(`/internal-jobs/jobs/${id}/resume`, {}),
  archiveJob: (id: number) => api.post<any>(`/internal-jobs/jobs/${id}/archive`, {}),
  cancelJob: (id: number) => api.post<any>(`/internal-jobs/jobs/${id}/cancel`, {}),
  fillJob: (id: number) => api.post<any>(`/internal-jobs/jobs/${id}/fill`, {}),
  jobTemplates: () => api.get<any[]>('/internal-jobs/job-templates'),
  createJobTemplate: (body: Record<string, unknown>) => api.post<any>('/internal-jobs/job-templates', body),
  updateJobTemplate: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/internal-jobs/job-templates/${id}`, body),
  jobFromTemplate: (body: Record<string, unknown>) => api.post<any>('/internal-jobs/jobs/from-template', body),

  // Portal (employee-facing)
  portalJobs: (filters: Record<string, string | number | boolean | undefined> = {}) =>
    api.get<any[]>(`/internal-jobs/portal/jobs${qs(filters)}`),
  portalJob: (id: number) => api.get<any>(`/internal-jobs/portal/jobs/${id}`),
  featuredJobs: () => api.get<any[]>('/internal-jobs/portal/featured'),
  recentJobs: () => api.get<any[]>('/internal-jobs/portal/recent'),
  recommendedJobs: () => api.get<any>('/internal-jobs/portal/recommended'),
  saveJob: (id: number, favorite = false) =>
    api.post<any>(`/internal-jobs/portal/jobs/${id}/save`, { favorite }),
  unsaveJob: (id: number) => api.delete<any>(`/internal-jobs/portal/jobs/${id}/save`),
  savedJobs: () => api.get<any[]>('/internal-jobs/portal/saved'),

  // Applications
  apply: (jobId: number, body: Record<string, unknown>) =>
    api.post<any>(`/internal-jobs/portal/jobs/${jobId}/apply`, body),
  submitApplication: (id: number) => api.put<any>(`/internal-jobs/portal/applications/${id}/submit`, {}),
  withdrawApplication: (id: number, reason?: string) =>
    api.put<any>(`/internal-jobs/portal/applications/${id}/withdraw`, { reason }),
  myApplications: () => api.get<any[]>('/internal-jobs/portal/my-applications'),
  applications: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/internal-jobs/applications${qs(filters)}`),
  application: (id: number) => api.get<any>(`/internal-jobs/applications/${id}`),
  setApplicationStatus: (id: number, body: { status: string; note?: string }) =>
    api.put<any>(`/internal-jobs/applications/${id}/status`, body),
  overrideEligibility: (id: number, reason: string) =>
    api.put<any>(`/internal-jobs/applications/${id}/override`, { reason }),
  uploadApplicationDocument: (id: number, file: File, fields: Record<string, string> = {}) =>
    api.upload<any>(`/internal-jobs/applications/${id}/documents`, file, fields),
  applicationDocumentUrl: (id: number) => `${BASE_URL}/internal-jobs/application-documents/${id}/download`,

  // Referrals
  createReferral: (body: Record<string, unknown>) => api.post<any>('/internal-jobs/referrals', body),
  myReferrals: () => api.get<any[]>('/internal-jobs/portal/my-referrals'),
  referrals: (filters: { status?: string } = {}) => api.get<any[]>(`/internal-jobs/referrals${qs(filters)}`),
  reviewReferral: (id: number, body: { action: 'accept' | 'reject'; note?: string }) =>
    api.put<any>(`/internal-jobs/referrals/${id}/review`, body),
  referralLeaderboard: () => api.get<any[]>('/internal-jobs/referrals/leaderboard'),

  auditLogs: (filters: { entityType?: string; entityId?: number; limit?: number } = {}) =>
    api.get<any[]>(`/internal-jobs/audit-logs${qs(filters)}`),
};

export const internalHiringApi = {
  // Interviews
  interviews: (filters: Record<string, string | number | boolean | undefined> = {}) =>
    api.get<any[]>(`/internal-hiring/interviews${qs(filters)}`),
  interview: (id: number) => api.get<any>(`/internal-hiring/interviews/${id}`),
  scheduleInterview: (body: Record<string, unknown>) => api.post<any>('/internal-hiring/interviews', body),
  rescheduleInterview: (id: number, body: { scheduledAt: string; reason: string }) =>
    api.put<any>(`/internal-hiring/interviews/${id}/reschedule`, body),
  cancelInterview: (id: number) => api.put<any>(`/internal-hiring/interviews/${id}/cancel`, {}),
  completeInterview: (id: number, outcome: string) =>
    api.put<any>(`/internal-hiring/interviews/${id}/complete`, { outcome }),
  noShowInterview: (id: number) => api.put<any>(`/internal-hiring/interviews/${id}/no-show`, {}),
  interviewIcsUrl: (id: number) => `${BASE_URL}/internal-hiring/interviews/${id}/ics`,
  submitInterviewFeedback: (id: number, body: Record<string, unknown>) =>
    api.post<any>(`/internal-hiring/interviews/${id}/feedback`, body),
  interviewFeedback: (id: number) => api.get<any[]>(`/internal-hiring/interviews/${id}/feedback`),
  sendInterviewReminders: () => api.post<any>('/internal-hiring/interviews/reminders', {}),

  // Assessments
  assessments: () => api.get<any[]>('/internal-hiring/assessments'),
  createAssessment: (body: Record<string, unknown>) => api.post<any>('/internal-hiring/assessments', body),
  updateAssessment: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/internal-hiring/assessments/${id}`, body),
  assignAssessment: (id: number, applicationId: number) =>
    api.post<any>(`/internal-hiring/assessments/${id}/assign`, { applicationId }),
  recordAssessmentResult: (resultId: number, body: Record<string, unknown>) =>
    api.put<any>(`/internal-hiring/assessment-results/${resultId}`, body),
  assessmentResults: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/internal-hiring/assessment-results${qs(filters)}`),

  // Offers
  offers: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/internal-hiring/offers${qs(filters)}`),
  offer: (id: number) => api.get<any>(`/internal-hiring/offers/${id}`),
  createOffer: (body: Record<string, unknown>) => api.post<any>('/internal-hiring/offers', body),
  submitOffer: (id: number) => api.post<any>(`/internal-hiring/offers/${id}/submit`, {}),
  approveOffer: (id: number) => api.post<any>(`/internal-hiring/offers/${id}/approve`, {}),
  rejectOfferApproval: (id: number, reason: string) =>
    api.post<any>(`/internal-hiring/offers/${id}/reject-approval`, { reason }),
  releaseOffer: (id: number) => api.post<any>(`/internal-hiring/offers/${id}/release`, {}),
  withdrawOffer: (id: number) => api.post<any>(`/internal-hiring/offers/${id}/withdraw`, {}),
  myOffers: () => api.get<any[]>('/internal-hiring/me/offers'),
  acceptOffer: (id: number) => api.post<any>(`/internal-hiring/offers/${id}/accept`, {}),
  declineOffer: (id: number, note?: string) => api.post<any>(`/internal-hiring/offers/${id}/decline`, { note }),
  issueOfferLetter: (id: number) => api.post<any>(`/internal-hiring/offers/${id}/letter`, {}),
  offerLetterUrl: (id: number) => `${BASE_URL}/internal-hiring/offers/${id}/letter`,
  effectOffer: (id: number) => api.post<any>(`/internal-hiring/offers/${id}/effect`, {}),

  // Career
  careerInterests: (employeeId: number) => api.get<any>(`/internal-hiring/career/interests/${employeeId}`),
  saveCareerInterests: (employeeId: number, body: Record<string, unknown>) =>
    api.put<any>(`/internal-hiring/career/interests/${employeeId}`, body),
  myCareerDashboard: () => api.get<any>('/internal-hiring/career/me/dashboard'),
  careerRoadmaps: () => api.get<any[]>('/internal-hiring/career/roadmaps'),

  // Analytics & reports
  dashboard: () => api.get<any>('/internal-hiring/analytics/dashboard'),
  funnel: (jobId?: number) => api.get<any>(`/internal-hiring/analytics/funnel${qs({ jobId })}`),
  departmentAnalytics: () => api.get<any>('/internal-hiring/analytics/departments'),
  referralAnalytics: () => api.get<any>('/internal-hiring/analytics/referrals'),
  costSavings: () => api.get<any>('/internal-hiring/analytics/cost-savings'),
  aiInsights: () => api.get<any>('/internal-hiring/ai/insights'),
  report: (type: string, params: Record<string, string | number | undefined> = {}) =>
    api.get<any>(`/internal-hiring/reports/${type}${qs(params)}`),
  reportExportUrl: (type: string, params: Record<string, string | number | undefined> = {}) =>
    `${BASE_URL}/internal-hiring/reports/${type}/export${qs(params)}`,
};
