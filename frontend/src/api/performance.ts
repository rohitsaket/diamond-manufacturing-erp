// Typed helpers for the performance management endpoints (goals, KPIs, KRAs,
// cycles, analytics under /performance; reviews, appraisals, talent,
// development, feedback under /talent).
import { api, BASE_URL } from './client';

const qs = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.append(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

// ---------------------------------------------------------------------------
// Core: cycles, goals & OKRs, KPI, KRA, analytics, reports, audit
// ---------------------------------------------------------------------------
export const performanceApi = {
  cycles: (filters: { status?: string } = {}) => api.get<any[]>(`/performance/cycles${qs(filters)}`),
  cycle: (id: number) => api.get<any>(`/performance/cycles/${id}`),
  createCycle: (body: Record<string, unknown>) => api.post<any>('/performance/cycles', body),
  updateCycle: (id: number, body: Record<string, unknown>) => api.put<any>(`/performance/cycles/${id}`, body),
  setCycleStatus: (id: number, status: string) => api.put<any>(`/performance/cycles/${id}/status`, { status }),
  cycleCalendar: (id: number) => api.get<any[]>(`/performance/cycles/${id}/calendar`),

  goals: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/performance/goals${qs(filters)}`),
  goalTree: (cycleId: number) => api.get<any[]>(`/performance/goals/tree${qs({ cycleId })}`),
  goal: (id: number) => api.get<any>(`/performance/goals/${id}`),
  createGoal: (body: Record<string, unknown>) => api.post<any>('/performance/goals', body),
  updateGoal: (id: number, body: Record<string, unknown>) => api.put<any>(`/performance/goals/${id}`, body),
  deleteGoal: (id: number) => api.delete<any>(`/performance/goals/${id}`),
  submitGoal: (id: number) => api.post<any>(`/performance/goals/${id}/submit`, {}),
  approveGoal: (id: number) => api.post<any>(`/performance/goals/${id}/approve`, {}),
  rejectGoal: (id: number, reason: string) => api.post<any>(`/performance/goals/${id}/reject`, { reason }),
  goalProgress: (id: number, body: { progressPct?: number; currentValue?: number; note?: string }) =>
    api.post<any>(`/performance/goals/${id}/progress`, body),
  completeGoal: (id: number) => api.post<any>(`/performance/goals/${id}/complete`, {}),
  cancelGoal: (id: number) => api.post<any>(`/performance/goals/${id}/cancel`, {}),
  goalUpdates: (id: number) => api.get<any[]>(`/performance/goals/${id}/updates`),
  addMilestone: (goalId: number, body: Record<string, unknown>) =>
    api.post<any>(`/performance/goals/${goalId}/milestones`, body),
  updateMilestone: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/performance/milestones/${id}`, body),
  deleteMilestone: (id: number) => api.delete<any>(`/performance/milestones/${id}`),
  goalTemplates: () => api.get<any[]>('/performance/goal-templates'),
  createGoalTemplate: (body: Record<string, unknown>) => api.post<any>('/performance/goal-templates', body),
  updateGoalTemplate: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/performance/goal-templates/${id}`, body),
  bulkGoalsFromTemplate: (body: Record<string, unknown>) =>
    api.post<any>('/performance/goals/bulk-from-template', body),
  myGoals: (cycleId?: number) => api.get<any[]>(`/performance/me/goals${qs({ cycleId })}`),

  kpis: () => api.get<any[]>('/performance/kpis'),
  createKpi: (body: Record<string, unknown>) => api.post<any>('/performance/kpis', body),
  updateKpi: (id: number, body: Record<string, unknown>) => api.put<any>(`/performance/kpis/${id}`, body),
  kpiAssignments: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/performance/kpi-assignments${qs(filters)}`),
  createKpiAssignment: (body: Record<string, unknown>) => api.post<any>('/performance/kpi-assignments', body),
  updateKpiAssignment: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/performance/kpi-assignments/${id}`, body),
  deleteKpiAssignment: (id: number) => api.delete<any>(`/performance/kpi-assignments/${id}`),
  recordKpiValue: (id: number, body: { periodKey: string; value: number; note?: string }) =>
    api.put<any>(`/performance/kpi-assignments/${id}/value`, body),
  computeKpis: (body: { cycleId: number; periodKey?: string }) =>
    api.post<any>('/performance/kpi-assignments/compute', body),
  myKpis: (cycleId?: number) => api.get<any[]>(`/performance/me/kpis${qs({ cycleId })}`),

  kras: () => api.get<any[]>('/performance/kras'),
  createKra: (body: Record<string, unknown>) => api.post<any>('/performance/kras', body),
  updateKra: (id: number, body: Record<string, unknown>) => api.put<any>(`/performance/kras/${id}`, body),
  employeeKras: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/performance/employee-kras${qs(filters)}`),
  assignKra: (body: Record<string, unknown>) => api.post<any>('/performance/employee-kras', body),
  bulkAssignKras: (body: Record<string, unknown>) => api.post<any>('/performance/employee-kras/bulk', body),
  selfScoreKra: (id: number, body: { score: number; remarks?: string }) =>
    api.put<any>(`/performance/employee-kras/${id}/self-score`, body),
  managerScoreKra: (id: number, body: { score: number; remarks?: string }) =>
    api.put<any>(`/performance/employee-kras/${id}/manager-score`, body),
  finalizeKra: (id: number, body: { finalScore?: number } = {}) =>
    api.put<any>(`/performance/employee-kras/${id}/finalize`, body),
  myKras: (cycleId?: number) => api.get<any[]>(`/performance/me/kras${qs({ cycleId })}`),

  dashboard: (cycleId?: number) => api.get<any>(`/performance/analytics/dashboard${qs({ cycleId })}`),
  distribution: (cycleId?: number) => api.get<any>(`/performance/analytics/distribution${qs({ cycleId })}`),
  departmentAnalytics: (cycleId?: number) => api.get<any>(`/performance/analytics/departments${qs({ cycleId })}`),
  trends: (months = 6) => api.get<any>(`/performance/analytics/trends${qs({ months })}`),
  attrition: (cycleId?: number) => api.get<any>(`/performance/analytics/attrition${qs({ cycleId })}`),
  aiInsights: () => api.get<any>('/performance/ai/insights'),

  report: (type: string, params: Record<string, string | number | undefined> = {}) =>
    api.get<any>(`/performance/reports/${type}${qs(params)}`),
  reportExportUrl: (type: string, params: Record<string, string | number | undefined> = {}) =>
    `${BASE_URL}/performance/reports/${type}/export${qs(params)}`,
  auditLogs: (filters: { entityType?: string; entityId?: number; limit?: number } = {}) =>
    api.get<any[]>(`/performance/audit-logs${qs(filters)}`),
};

// ---------------------------------------------------------------------------
// Talent: reviews & 360, competencies, appraisals, promotions, 9-box,
// succession, calibration, development plans, PIP, feedback & recognition
// ---------------------------------------------------------------------------
export const talentApi = {
  reviewTemplates: () => api.get<any[]>('/talent/review-templates'),
  createReviewTemplate: (body: Record<string, unknown>) => api.post<any>('/talent/review-templates', body),
  updateReviewTemplate: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/talent/review-templates/${id}`, body),

  reviews: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/talent/reviews${qs(filters)}`),
  review: (id: number) => api.get<any>(`/talent/reviews/${id}`),
  createReview: (body: Record<string, unknown>) => api.post<any>('/talent/reviews', body),
  launchReviews: (cycleId: number) => api.post<any>('/talent/reviews/launch', { cycleId }),
  requestPeers: (id: number, body: { reviewerEmployeeIds: number[]; isAnonymous: boolean }) =>
    api.post<any>(`/talent/reviews/${id}/request-peers`, body),
  respondReview: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/talent/reviews/${id}/respond`, body),
  submitReview: (id: number) => api.post<any>(`/talent/reviews/${id}/submit`, {}),
  acknowledgeReview: (id: number) => api.post<any>(`/talent/reviews/${id}/acknowledge`, {}),
  declineReview: (id: number, reason: string) => api.post<any>(`/talent/reviews/${id}/decline`, { reason }),
  feedback360: (employeeId: number, cycleId?: number) =>
    api.get<any>(`/talent/employees/${employeeId}/360${qs({ cycleId })}`),
  myReviews: () => api.get<any[]>('/talent/me/reviews'),
  myReviewHistory: () => api.get<any[]>('/talent/me/reviews/history'),

  competencies: () => api.get<any[]>('/talent/competencies'),
  createCompetency: (body: Record<string, unknown>) => api.post<any>('/talent/competencies', body),
  updateCompetency: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/talent/competencies/${id}`, body),
  competencyRatings: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/talent/competency-ratings${qs(filters)}`),
  rateCompetency: (body: Record<string, unknown>) => api.post<any>('/talent/competency-ratings', body),
  skillMatrix: () => api.get<any>('/talent/skill-matrix'),

  generateAppraisals: (cycleId: number) => api.post<any>('/talent/appraisals/generate', { cycleId }),
  appraisals: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/talent/appraisals${qs(filters)}`),
  appraisal: (id: number) => api.get<any>(`/talent/appraisals/${id}`),
  updateAppraisal: (id: number, body: Record<string, unknown>) => api.put<any>(`/talent/appraisals/${id}`, body),
  finalizeAppraisal: (id: number, body: Record<string, unknown> = {}) =>
    api.post<any>(`/talent/appraisals/${id}/finalize`, body),
  issueAppraisalLetter: (id: number) => api.post<any>(`/talent/appraisals/${id}/letter`, {}),
  appraisalLetterUrl: (id: number) => `${BASE_URL}/talent/appraisals/${id}/letter`,
  acknowledgeAppraisal: (id: number) => api.post<any>(`/talent/appraisals/${id}/acknowledge`, {}),
  myAppraisals: () => api.get<any[]>('/talent/me/appraisals'),

  promotions: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/talent/promotions${qs(filters)}`),
  createPromotion: (body: Record<string, unknown>) => api.post<any>('/talent/promotions', body),
  updatePromotion: (id: number, body: Record<string, unknown>) => api.put<any>(`/talent/promotions/${id}`, body),
  submitPromotion: (id: number) => api.post<any>(`/talent/promotions/${id}/submit`, {}),
  approvePromotion: (id: number) => api.post<any>(`/talent/promotions/${id}/approve`, {}),
  rejectPromotion: (id: number, reason: string) => api.post<any>(`/talent/promotions/${id}/reject`, { reason }),
  effectPromotion: (id: number) => api.post<any>(`/talent/promotions/${id}/effect`, {}),
  issuePromotionLetter: (id: number) => api.post<any>(`/talent/promotions/${id}/letter`, {}),
  promotionLetterUrl: (id: number) => `${BASE_URL}/talent/promotions/${id}/letter`,
  promotionEligibility: (cycleId?: number) =>
    api.get<any>(`/talent/promotions/eligibility${qs({ cycleId })}`),

  talentMatrix: (cycleId?: number) => api.get<any>(`/talent/talent/matrix${qs({ cycleId })}`),
  assessTalent: (body: Record<string, unknown>) => api.put<any>('/talent/talent/assessments', body),
  talentPools: () => api.get<any[]>('/talent/talent/pools'),
  createTalentPool: (body: Record<string, unknown>) => api.post<any>('/talent/talent/pools', body),
  updateTalentPool: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/talent/talent/pools/${id}`, body),
  talentPool: (id: number) => api.get<any>(`/talent/talent/pools/${id}`),
  addPoolMember: (poolId: number, body: { employeeId: number; note?: string }) =>
    api.post<any>(`/talent/talent/pools/${poolId}/members`, body),
  removePoolMember: (memberId: number) => api.delete<any>(`/talent/talent/pools/members/${memberId}`),

  successionPlans: () => api.get<any[]>('/talent/succession'),
  createSuccessionPlan: (body: Record<string, unknown>) => api.post<any>('/talent/succession', body),
  updateSuccessionPlan: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/talent/succession/${id}`, body),
  addSuccessionCandidate: (planId: number, body: Record<string, unknown>) =>
    api.post<any>(`/talent/succession/${planId}/candidates`, body),
  updateSuccessionCandidate: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/talent/succession/candidates/${id}`, body),
  removeSuccessionCandidate: (id: number) => api.delete<any>(`/talent/succession/candidates/${id}`),
  successionDashboard: () => api.get<any>('/talent/succession/dashboard'),

  calibrationSessions: (cycleId?: number) =>
    api.get<any[]>(`/talent/calibration/sessions${qs({ cycleId })}`),
  createCalibrationSession: (body: Record<string, unknown>) =>
    api.post<any>('/talent/calibration/sessions', body),
  updateCalibrationSession: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/talent/calibration/sessions/${id}`, body),
  calibrationAdjust: (sessionId: number, body: { appraisalId: number; adjustedRating: number; reason: string }) =>
    api.post<any>(`/talent/calibration/sessions/${sessionId}/adjust`, body),
  completeCalibration: (sessionId: number) =>
    api.post<any>(`/talent/calibration/sessions/${sessionId}/complete`, {}),

  developmentPlans: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/talent/development-plans${qs(filters)}`),
  developmentPlan: (id: number) => api.get<any>(`/talent/development-plans/${id}`),
  createDevelopmentPlan: (body: Record<string, unknown>) => api.post<any>('/talent/development-plans', body),
  updateDevelopmentPlan: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/talent/development-plans/${id}`, body),
  addPlanItem: (planId: number, body: Record<string, unknown>) =>
    api.post<any>(`/talent/development-plans/${planId}/items`, body),
  updatePlanItem: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/talent/development-plans/items/${id}`, body),
  deletePlanItem: (id: number) => api.delete<any>(`/talent/development-plans/items/${id}`),
  myDevelopmentPlan: () => api.get<any>('/talent/me/development-plan'),

  pips: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/talent/pips${qs(filters)}`),
  pip: (id: number) => api.get<any>(`/talent/pips/${id}`),
  createPip: (body: Record<string, unknown>) => api.post<any>('/talent/pips', body),
  updatePip: (id: number, body: Record<string, unknown>) => api.put<any>(`/talent/pips/${id}`, body),
  activatePip: (id: number) => api.post<any>(`/talent/pips/${id}/activate`, {}),
  updatePipObjective: (id: number, body: { status: string }) =>
    api.put<any>(`/talent/pips/objectives/${id}`, body),
  addPipReview: (pipId: number, body: Record<string, unknown>) =>
    api.post<any>(`/talent/pips/${pipId}/reviews`, body),
  closePip: (id: number, body: { outcome: string; note?: string }) =>
    api.post<any>(`/talent/pips/${id}/close`, body),
  extendPip: (id: number, body: { newEndDate: string; reason: string }) =>
    api.post<any>(`/talent/pips/${id}/extend`, body),
  escalatePip: (id: number, reason: string) => api.post<any>(`/talent/pips/${id}/escalate`, { reason }),

  feedback: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/talent/feedback${qs(filters)}`),
  giveFeedback: (body: Record<string, unknown>) => api.post<any>('/talent/feedback', body),
  deleteFeedback: (id: number) => api.delete<any>(`/talent/feedback/${id}`),
  recognitions: (filters: Record<string, string | number | undefined> = {}) =>
    api.get<any[]>(`/talent/recognitions${qs(filters)}`),
  giveRecognition: (body: Record<string, unknown>) => api.post<any>('/talent/recognitions', body),
  rewardBalance: (employeeId: number) => api.get<any>(`/talent/rewards/balance/${employeeId}`),
  requestRedemption: (body: { points: number; rewardItem: string }) =>
    api.post<any>('/talent/rewards/redemptions', body),
  redemptions: (filters: { status?: string } = {}) =>
    api.get<any[]>(`/talent/rewards/redemptions${qs(filters)}`),
  decideRedemption: (id: number, body: { approve: boolean; note?: string }) =>
    api.put<any>(`/talent/rewards/redemptions/${id}/decide`, body),
  fulfillRedemption: (id: number) => api.put<any>(`/talent/rewards/redemptions/${id}/fulfill`, {}),
  myFeedback: () => api.get<any[]>('/talent/me/feedback'),
  myRecognitions: () => api.get<any[]>('/talent/me/recognitions'),
  myRewards: () => api.get<any>('/talent/me/rewards'),

  report: (type: string, params: Record<string, string | number | undefined> = {}) =>
    api.get<any>(`/talent/reports/${type}${qs(params)}`),
  reportExportUrl: (type: string, params: Record<string, string | number | undefined> = {}) =>
    `${BASE_URL}/talent/reports/${type}/export${qs(params)}`,
};
