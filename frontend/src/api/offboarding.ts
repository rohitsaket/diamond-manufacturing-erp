// Typed helpers for the offboarding endpoints (/offboarding: separation
// lifecycle, interviews, clearances, assets, KT, access revocation;
// /exit-services: settlements, letters, alumni, analytics, reports).
import { api, BASE_URL } from './client';

const qs = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.append(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const offboardingApi = {
  // ESS
  submitResignation: (body: Record<string, unknown>) => api.post<any>('/offboarding/me/resignation', body),
  submitDraftResignation: () => api.put<any>('/offboarding/me/resignation/submit', {}),
  withdrawResignation: (reason?: string) => api.put<any>('/offboarding/me/resignation/withdraw', { reason }),
  myCase: () => api.get<any>('/offboarding/me/case'),
  submitSurvey: (body: { anonymous: boolean; answers: unknown[] }) =>
    api.post<any>('/offboarding/me/survey', body),

  // Separations (staff)
  separations: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/offboarding/separations${qs(filters)}`),
  separation: (id: number) => api.get<any>(`/offboarding/separations/${id}`),
  createSeparation: (body: Record<string, unknown>) => api.post<any>('/offboarding/separations', body),
  updateSeparation: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/offboarding/separations/${id}`, body),
  managerReview: (id: number, note: string) =>
    api.put<any>(`/offboarding/separations/${id}/manager-review`, { note }),
  hrReview: (id: number, note: string) => api.put<any>(`/offboarding/separations/${id}/hr-review`, { note }),
  approveSeparation: (id: number) => api.post<any>(`/offboarding/separations/${id}/approve`, {}),
  rejectSeparation: (id: number, reason: string) =>
    api.post<any>(`/offboarding/separations/${id}/reject`, { reason }),
  cancelSeparation: (id: number) => api.post<any>(`/offboarding/separations/${id}/cancel`, {}),
  updateNotice: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/offboarding/separations/${id}/notice`, body),
  requestEarlyRelease: (id: number, body: { earlyReleaseDate: string; reason: string }) =>
    api.post<any>(`/offboarding/separations/${id}/early-release`, body),
  decideEarlyRelease: (id: number, approve: boolean) =>
    api.put<any>(`/offboarding/separations/${id}/early-release/decide`, { approve }),
  noticeBuyout: (id: number, days: number) => api.post<any>(`/offboarding/separations/${id}/buyout`, { days }),
  waiveNotice: (id: number, reason: string) =>
    api.post<any>(`/offboarding/separations/${id}/waive-notice`, { reason }),
  gardenLeave: (id: number, enabled: boolean) =>
    api.post<any>(`/offboarding/separations/${id}/garden-leave`, { enabled }),
  completeSeparation: (id: number) => api.post<any>(`/offboarding/separations/${id}/complete`, {}),
  setRehireFlag: (id: number, body: { rehireEligible: boolean; note?: string }) =>
    api.put<any>(`/offboarding/separations/${id}/rehire-flag`, body),

  noticeRules: () => api.get<any[]>('/offboarding/notice-rules'),
  createNoticeRule: (body: Record<string, unknown>) => api.post<any>('/offboarding/notice-rules', body),
  updateNoticeRule: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/offboarding/notice-rules/${id}`, body),

  // Exit interviews & survey admin
  interviews: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/offboarding/interviews${qs(filters)}`),
  scheduleInterview: (id: number, body: { scheduledAt: string; interviewerUserId?: number }) =>
    api.put<any>(`/offboarding/interviews/${id}/schedule`, body),
  completeInterview: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/offboarding/interviews/${id}/complete`, body),
  cancelInterview: (id: number) => api.put<any>(`/offboarding/interviews/${id}/cancel`, {}),
  surveyQuestions: () => api.get<any[]>('/offboarding/survey/questions'),
  createSurveyQuestion: (body: Record<string, unknown>) => api.post<any>('/offboarding/survey/questions', body),
  updateSurveyQuestion: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/offboarding/survey/questions/${id}`, body),
  surveyResults: (questionId?: number) =>
    api.get<any>(`/offboarding/survey/results${qs({ questionId })}`),

  // Clearances
  clearances: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/offboarding/clearances${qs(filters)}`),
  updateClearance: (id: number, body: { status: string; note?: string }) =>
    api.put<any>(`/offboarding/clearances/${id}`, body),
  updateClearanceTask: (id: number, body: { status: string; note?: string }) =>
    api.put<any>(`/offboarding/clearance-tasks/${id}`, body),
  addClearanceTask: (clearanceId: number, task: string) =>
    api.post<any>(`/offboarding/clearances/${clearanceId}/tasks`, { task }),

  // Asset returns, KT, access revocation
  assetReturns: (separationId?: number) =>
    api.get<any[]>(`/offboarding/asset-returns${qs({ separationId })}`),
  updateAssetReturn: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/offboarding/asset-returns/${id}`, body),
  ktPlan: (separationId: number) => api.get<any>(`/offboarding/kt/${separationId}`),
  updateKtPlan: (planId: number, body: Record<string, unknown>) => api.put<any>(`/offboarding/kt/${planId}`, body),
  addKtItem: (planId: number, body: Record<string, unknown>) =>
    api.post<any>(`/offboarding/kt/${planId}/items`, body),
  updateKtItem: (id: number, body: { status: string }) => api.put<any>(`/offboarding/kt/items/${id}`, body),
  deleteKtItem: (id: number) => api.delete<any>(`/offboarding/kt/items/${id}`),
  approveKtPlan: (planId: number) => api.post<any>(`/offboarding/kt/${planId}/approve`, {}),
  accessRevocations: (separationId?: number) =>
    api.get<any[]>(`/offboarding/access-revocations${qs({ separationId })}`),
  updateAccessRevocation: (id: number, body: { status: string; note?: string }) =>
    api.put<any>(`/offboarding/access-revocations/${id}`, body),
  sendReminders: () => api.post<any>('/offboarding/reminders', {}),
  auditLogs: (filters: { entityType?: string; entityId?: number; limit?: number } = {}) =>
    api.get<any[]>(`/offboarding/audit-logs${qs(filters)}`),
};

export const exitServicesApi = {
  // Final settlement
  computeSettlement: (separationId: number) =>
    api.post<any>('/exit-services/settlements/compute', { separationId }),
  settlements: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/exit-services/settlements${qs(filters)}`),
  settlement: (id: number) => api.get<any>(`/exit-services/settlements/${id}`),
  updateSettlement: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/exit-services/settlements/${id}`, body),
  submitSettlement: (id: number) => api.post<any>(`/exit-services/settlements/${id}/submit`, {}),
  approveSettlement: (id: number) => api.post<any>(`/exit-services/settlements/${id}/approve`, {}),
  rejectSettlement: (id: number, reason: string) =>
    api.post<any>(`/exit-services/settlements/${id}/reject`, { reason }),
  markSettlementPaid: (id: number, paidAt?: string) =>
    api.post<any>(`/exit-services/settlements/${id}/mark-paid`, { paidAt }),
  settlementStatementUrl: (id: number) => `${BASE_URL}/exit-services/settlements/${id}/statement`,
  mySettlement: () => api.get<any>('/exit-services/me/settlement'),

  // Exit letters
  generateLetter: (body: { separationId: number; letterType: string }) =>
    api.post<any>('/exit-services/letters/generate', body),
  letters: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/exit-services/letters${qs(filters)}`),
  letterPdfUrl: (id: number) => `${BASE_URL}/exit-services/letters/${id}/pdf`,
  verifyLetter: (body: { letterNumber: string; token: string }) =>
    api.post<any>('/exit-services/letters/verify', body),
  emailLetter: (id: number) => api.post<any>(`/exit-services/letters/${id}/email`, {}),
  myLetters: () => api.get<any[]>('/exit-services/me/letters'),
  myLetterPdfUrl: (id: number) => `${BASE_URL}/exit-services/me/letters/${id}/pdf`,

  // Alumni & rehire
  alumni: (filters: Record<string, string | number | boolean | undefined> = {}) =>
    api.get<any[]>(`/exit-services/alumni${qs(filters)}`),
  alumnus: (id: number) => api.get<any>(`/exit-services/alumni/${id}`),
  updateAlumnus: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/exit-services/alumni/${id}`, body),
  rehireReview: (id: number, body: { decision: string; reason?: string }) =>
    api.post<any>(`/exit-services/alumni/${id}/rehire-review`, body),
  markBoomerang: (id: number, body: { rehiredEmployeeId: number; rehiredAt: string }) =>
    api.post<any>(`/exit-services/alumni/${id}/mark-boomerang`, body),
  alumniStats: () => api.get<any>('/exit-services/alumni/stats'),

  // Analytics & reports
  dashboard: () => api.get<any>('/exit-services/analytics/dashboard'),
  attrition: () => api.get<any>('/exit-services/analytics/attrition'),
  attritionCost: () => api.get<any>('/exit-services/analytics/cost'),
  aiPrediction: () => api.get<any>('/exit-services/ai/predict-attrition'),
  report: (type: string, params: Record<string, string | number | undefined> = {}) =>
    api.get<any>(`/exit-services/reports/${type}${qs(params)}`),
  reportExportUrl: (type: string, params: Record<string, string | number | undefined> = {}) =>
    `${BASE_URL}/exit-services/reports/${type}/export${qs(params)}`,
};
