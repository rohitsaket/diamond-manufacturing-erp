// Typed helpers for the statutory and compliance endpoints.
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
// Statutory: configuration, contributions, challans, filings, Form 16
// ---------------------------------------------------------------------------
export const statutoryApi = {
  config: () => api.get<any[]>('/statutory/config'),
  saveConfig: (body: Record<string, unknown>) => api.post<any>('/statutory/config', body),
  updateConfig: (id: number, body: Record<string, unknown>) => api.put<any>(`/statutory/config/${id}`, body),

  ptRules: () => api.get<any[]>('/statutory/pt-rules'),
  ptSlabs: (ruleId: number) => api.get<any[]>(`/statutory/pt-rules/${ruleId}/slabs`),
  savePtSlabs: (ruleId: number, slabs: unknown[]) =>
    api.put<any>(`/statutory/pt-rules/${ruleId}/slabs`, { slabs }),
  lwfRules: () => api.get<any[]>('/statutory/lwf-rules'),
  minimumWage: () => api.get<any[]>('/statutory/minimum-wage'),

  registrations: () => api.get<any[]>('/statutory/registrations'),
  createRegistration: (body: Record<string, unknown>) => api.post<any>('/statutory/registrations', body),
  updateRegistration: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/statutory/registrations/${id}`, body),

  employeeStatutory: (employeeId: number) => api.get<any>(`/statutory/employees/${employeeId}/statutory`),
  updateEmployeeStatutory: (employeeId: number, body: Record<string, unknown>) =>
    api.put<any>(`/statutory/employees/${employeeId}/statutory`, body),
  nominees: (employeeId: number) => api.get<any[]>(`/statutory/employees/${employeeId}/nominees`),
  addNominee: (employeeId: number, body: Record<string, unknown>) =>
    api.post<any>(`/statutory/employees/${employeeId}/nominees`, body),
  pfAccount: (employeeId: number) => api.get<any>(`/statutory/employees/${employeeId}/pf-account`),
  pfClaims: (filters: { employeeId?: number; status?: string } = {}) =>
    api.get<any[]>(`/statutory/pf-claims${qs(filters)}`),
  createPfClaim: (body: Record<string, unknown>) => api.post<any>('/statutory/pf-claims', body),

  contributions: (filters: { periodId?: number; scheme?: string; financialYear?: string } = {}) =>
    api.get<any>(`/statutory/contributions${qs(filters)}`),
  buildLedger: (periodId: number) => api.post<any>('/statutory/contributions/build', { periodId }),
  contributionSummary: (periodId: number) => api.get<any>(`/statutory/contributions/summary/${periodId}`),

  gratuityProvisions: (filters: { financialYear?: string } = {}) =>
    api.get<any[]>(`/statutory/gratuity/provisions${qs(filters)}`),
  computeGratuity: (asOfDate: string) => api.post<any>('/statutory/gratuity/compute', { asOfDate }),
  creditPfInterest: (body: { financialYear: string; ratePct: number }) =>
    api.post<any>('/statutory/pf/interest', body),

  challans: (filters: { scheme?: string; status?: string; monthKey?: string } = {}) =>
    api.get<any[]>(`/statutory/challans${qs(filters)}`),
  challan: (id: number) => api.get<any>(`/statutory/challans/${id}`),
  overdueChallans: () => api.get<any[]>('/statutory/challans/overdue'),
  generateChallan: (body: { scheme: string; monthKey: string; dueDate?: string }) =>
    api.post<any>('/statutory/challans/generate', body),
  markChallanPaid: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/statutory/challans/${id}/paid`, body),
  acknowledgeChallan: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/statutory/challans/${id}/acknowledge`, body),
  challanExportUrl: (id: number) => `${BASE_URL}/statutory/challans/${id}/export`,

  filings: (filters: { filingType?: string; status?: string; financialYear?: string } = {}) =>
    api.get<any[]>(`/statutory/filings${qs(filters)}`),
  filing: (id: number) => api.get<any>(`/statutory/filings/${id}`),
  overdueFilings: () => api.get<any[]>('/statutory/filings/overdue'),
  filingDownloadUrl: (id: number) => `${BASE_URL}/statutory/filings/${id}/download`,
  markFiled: (id: number, body: Record<string, unknown>) => api.put<any>(`/statutory/filings/${id}/filed`, body),
  generatePfEcr: (monthKey: string) => api.post<any>('/statutory/filings/generate/pf-ecr', { monthKey }),
  generateEsiReturn: (monthKey: string) => api.post<any>('/statutory/filings/generate/esi-return', { monthKey }),
  generatePtReturn: (body: { monthKey: string; stateCode: string }) =>
    api.post<any>('/statutory/filings/generate/pt-return', body),
  generateLwfReturn: (body: Record<string, unknown>) =>
    api.post<any>('/statutory/filings/generate/lwf-return', body),
  generate24Q: (body: { financialYear: string; quarter: number }) =>
    api.post<any>('/statutory/filings/generate/24q', body),
  generateRegister: (body: Record<string, unknown>) =>
    api.post<any>('/statutory/filings/generate/register', body),

  form16List: (filters: { financialYear?: string; status?: string } = {}) =>
    api.get<any[]>(`/statutory/form16${qs(filters)}`),
  form16: (id: number) => api.get<any>(`/statutory/form16/${id}`),
  form16PdfUrl: (id: number) => `${BASE_URL}/statutory/form16/${id}/pdf`,
  generateForm16: (body: { employeeId: number; financialYear: string }) =>
    api.post<any>('/statutory/form16/generate', body),
  bulkForm16: (body: { financialYear: string; employeeIds?: number[] }) =>
    api.post<any>('/statutory/form16/bulk', body),
  issueForm16: (id: number) => api.put<any>(`/statutory/form16/${id}/issue`, {}),
  emailForm16: (id: number) => api.post<any>(`/statutory/form16/${id}/email`, {}),
};

// ---------------------------------------------------------------------------
// Compliance: calendar, checks, audits, analytics, calculator, proofs
// ---------------------------------------------------------------------------
export const complianceApi = {
  dashboard: (financialYear?: string) => api.get<any>(`/compliance/dashboard${qs({ financialYear })}`),
  taxAnalytics: (financialYear: string) => api.get<any>(`/compliance/analytics/tax${qs({ financialYear })}`),
  contributionTrends: (params: { from?: string; to?: string } = {}) =>
    api.get<any>(`/compliance/analytics/contributions${qs(params)}`),
  filingStatus: (financialYear: string) =>
    api.get<any>(`/compliance/analytics/filing-status${qs({ financialYear })}`),
  forecast: (months = 6) => api.get<any>(`/compliance/analytics/forecast${qs({ months })}`),
  score: (financialYear: string) => api.get<any>(`/compliance/score${qs({ financialYear })}`),

  calendar: (filters: { financialYear?: string; month?: string; status?: string; category?: string } = {}) =>
    api.get<any[]>(`/compliance/calendar${qs(filters)}`),
  generateCalendar: (financialYear: string) =>
    api.post<any>('/compliance/calendar/generate', { financialYear }),
  refreshCalendar: () => api.post<any>('/compliance/calendar/refresh', {}),
  upcoming: (days = 30) => api.get<any[]>(`/compliance/calendar/upcoming${qs({ days })}`),
  overdueCalendar: () => api.get<any[]>('/compliance/calendar/overdue'),
  completeEntry: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/compliance/calendar/${id}/complete`, body),
  waiveEntry: (id: number, reason: string) => api.put<any>(`/compliance/calendar/${id}/waive`, { reason }),
  extendEntry: (id: number, body: { newDueDate: string; reason: string }) =>
    api.put<any>(`/compliance/calendar/${id}/extend`, body),
  sendReminders: () => api.post<any>('/compliance/calendar/reminders', {}),

  obligations: () => api.get<any[]>('/compliance/obligations'),
  createObligation: (body: Record<string, unknown>) => api.post<any>('/compliance/obligations', body),

  checkItems: () => api.get<any[]>('/compliance/checks/items'),
  runChecks: (body: { financialYear?: string; periodId?: number }) =>
    api.post<any>('/compliance/checks/run', body),
  checkResults: (filters: { financialYear?: string; result?: string } = {}) =>
    api.get<any>(`/compliance/checks/results${qs(filters)}`),
  raiseFindings: (resultIds: number[]) => api.post<any>('/compliance/checks/raise-findings', { resultIds }),

  audits: (filters: { status?: string } = {}) => api.get<any[]>(`/compliance/audits${qs(filters)}`),
  audit: (id: number) => api.get<any>(`/compliance/audits/${id}`),
  createAudit: (body: Record<string, unknown>) => api.post<any>('/compliance/audits', body),
  closeAudit: (id: number) => api.put<any>(`/compliance/audits/${id}/close`, {}),

  findings: (filters: { status?: string; severity?: string; category?: string } = {}) =>
    api.get<any[]>(`/compliance/findings${qs(filters)}`),
  findingsSummary: () => api.get<any>('/compliance/findings/summary'),
  createFinding: (body: Record<string, unknown>) => api.post<any>('/compliance/findings', body),
  updateFinding: (id: number, body: Record<string, unknown>) => api.put<any>(`/compliance/findings/${id}`, body),
  closeFinding: (id: number, note?: string) => api.put<any>(`/compliance/findings/${id}/close`, { note }),
  findingActions: (id: number) => api.get<any[]>(`/compliance/findings/${id}/actions`),
  addAction: (id: number, body: Record<string, unknown>) =>
    api.post<any>(`/compliance/findings/${id}/actions`, body),
  updateAction: (id: number, body: Record<string, unknown>) => api.put<any>(`/compliance/actions/${id}`, body),

  proofs: (filters: { employeeId?: number; status?: string; financialYear?: string } = {}) =>
    api.get<any[]>(`/compliance/proofs${qs(filters)}`),
  reviewProof: (id: number, body: Record<string, unknown>) => api.put<any>(`/compliance/proofs/${id}/review`, body),
  bulkReviewProofs: (ids: number[], status: string) =>
    api.put<any>('/compliance/proofs/bulk-review', { ids, status }),
  pendingProofSummary: () => api.get<any>('/compliance/proofs/pending-summary'),

  hra: (employeeId: number, fy: string) => api.get<any>(`/compliance/hra/${employeeId}/${fy}`),
  saveHra: (employeeId: number, fy: string, rows: unknown[]) =>
    api.put<any>(`/compliance/hra/${employeeId}/${fy}`, { rows }),
  hraExemption: (employeeId: number, fy: string) =>
    api.get<any>(`/compliance/hra/${employeeId}/${fy}/exemption`),

  compareRegimes: (employeeId: number, fy: string) =>
    api.get<any>(`/compliance/calculator/compare/${employeeId}/${fy}`),
  calculate: (body: Record<string, unknown>) => api.post<any>('/compliance/calculator', body),
  takeHome: (employeeId: number, fy: string) =>
    api.get<any>(`/compliance/calculator/take-home/${employeeId}/${fy}`),

  report: (type: string, params: Record<string, string | number | undefined> = {}) =>
    api.get<any>(`/compliance/reports/${type}${qs(params)}`),
  reportExportUrl: (type: string, params: Record<string, string | number | undefined> = {}) =>
    `${BASE_URL}/compliance/reports/${type}/export${qs(params)}`,
};

/** Indian financial year label for a date, e.g. 2026-2027. */
export function financialYearOf(date = new Date()): string {
  const y = date.getFullYear();
  const startYear = date.getMonth() + 1 >= 4 ? y : y - 1;
  return `${startYear}-${startYear + 1}`;
}
