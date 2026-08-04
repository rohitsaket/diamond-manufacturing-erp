// Typed helpers for the enterprise payroll endpoints.
import { api, BASE_URL, tokenStore } from './client';

const qs = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.append(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

// ---------------------------------------------------------------------------
// Compensation: components, structures, cycles, awards, revisions
// ---------------------------------------------------------------------------
export const compensationApi = {
  components: (filters: { componentType?: string; category?: string; isActive?: boolean } = {}) =>
    api.get<any[]>(`/compensation/components${qs(filters)}`),
  createComponent: (body: Record<string, unknown>) => api.post<any>('/compensation/components', body),
  updateComponent: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/compensation/components/${id}`, body),
  deleteComponent: (id: number) => api.delete<{ success: boolean }>(`/compensation/components/${id}`),

  structures: (filters: { grade?: string; department?: string; isActive?: boolean } = {}) =>
    api.get<any[]>(`/compensation/structures${qs(filters)}`),
  structure: (id: number) => api.get<any>(`/compensation/structures/${id}`),
  createStructure: (body: Record<string, unknown>) => api.post<any>('/compensation/structures', body),
  updateStructure: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/compensation/structures/${id}`, body),
  cloneStructure: (id: number, body: { code: string; name: string }) =>
    api.post<any>(`/compensation/structures/${id}/clone`, body),
  setStructureLines: (id: number, lines: unknown[]) =>
    api.put<any>(`/compensation/structures/${id}/lines`, { lines }),
  previewStructure: (id: number, annualCtc: number) =>
    api.get<any>(`/compensation/structures/${id}/preview${qs({ annualCtc })}`),

  cycles: () => api.get<any[]>('/compensation/cycles'),
  createCycle: (body: Record<string, unknown>) => api.post<any>('/compensation/cycles', body),
  updateCycle: (id: number, body: Record<string, unknown>) => api.put<any>(`/compensation/cycles/${id}`, body),
  setDefaultCycle: (id: number) => api.put<any>(`/compensation/cycles/${id}/default`, {}),

  overtimeRules: () => api.get<any[]>('/compensation/overtime-rules'),
  createOvertimeRule: (body: Record<string, unknown>) => api.post<any>('/compensation/overtime-rules', body),
  updateOvertimeRule: (id: number, body: Record<string, unknown>) =>
    api.put<any>(`/compensation/overtime-rules/${id}`, body),

  awards: (filters: { employeeId?: number; awardClass?: string; status?: string; periodId?: number } = {}) =>
    api.get<any[]>(`/compensation/awards${qs(filters)}`),
  createAward: (body: Record<string, unknown>) => api.post<any>('/compensation/awards', body),
  updateAward: (id: number, body: Record<string, unknown>) => api.put<any>(`/compensation/awards/${id}`, body),
  submitAward: (id: number) => api.put<any>(`/compensation/awards/${id}/submit`, {}),
  approveAward: (id: number) => api.put<any>(`/compensation/awards/${id}/approve`, {}),
  rejectAward: (id: number, note: string) => api.put<any>(`/compensation/awards/${id}/reject`, { note }),
  cancelAward: (id: number) => api.put<any>(`/compensation/awards/${id}/cancel`, {}),

  employeeSalary: (employeeId: number) => api.get<any>(`/compensation/employees/${employeeId}/salary`),
  salaryHistory: (employeeId: number) => api.get<any[]>(`/compensation/employees/${employeeId}/salary/history`),
  createRevision: (employeeId: number, body: Record<string, unknown>) =>
    api.post<any>(`/compensation/employees/${employeeId}/salary`, body),
  approveRevision: (id: number) => api.put<any>(`/compensation/revisions/${id}/approve`, {}),
  rejectRevision: (id: number, reason: string) =>
    api.put<any>(`/compensation/revisions/${id}/reject`, { reason }),
};

// ---------------------------------------------------------------------------
// Loans, reimbursements, benefits
// ---------------------------------------------------------------------------
export const payrollLoanApi = {
  loans: (filters: { employeeId?: number; status?: string } = {}) =>
    api.get<any[]>(`/payroll-loans${qs(filters)}`),
  loan: (id: number) => api.get<any>(`/payroll-loans/${id}`),
  createLoan: (body: Record<string, unknown>) => api.post<any>('/payroll-loans', body),
  approveLoan: (id: number) => api.put<any>(`/payroll-loans/${id}/approve`, {}),
  rejectLoan: (id: number, reason: string) => api.put<any>(`/payroll-loans/${id}/reject`, { reason }),
  forecloseLoan: (id: number) => api.put<any>(`/payroll-loans/${id}/foreclose`, {}),
  addRepayment: (id: number, body: { amount: number; date?: string; remarks?: string }) =>
    api.post<any>(`/payroll-loans/${id}/repayments`, body),

  reimbursementTypes: () => api.get<any[]>('/payroll-loans/reimbursement-types'),
  claims: (filters: { employeeId?: number; status?: string } = {}) =>
    api.get<any[]>(`/payroll-loans/claims${qs(filters)}`),
  createClaim: (body: Record<string, unknown>) => api.post<any>('/payroll-loans/claims', body),
  decideClaim: (id: number, body: { status: string; note?: string; approvedAmount?: number }) =>
    api.put<any>(`/payroll-loans/claims/${id}/decide`, body),

  benefitPlans: () => api.get<any[]>('/payroll-loans/benefit-plans'),
  employeeBenefits: (employeeId: number) => api.get<any[]>(`/payroll-loans/employees/${employeeId}/benefits`),
};

// ---------------------------------------------------------------------------
// Payroll runs
// ---------------------------------------------------------------------------
export interface StartRunBody {
  periodId: number;
  runType?: string;
  employeeIds?: number[];
  async?: boolean;
}

export const payrollRunApi = {
  list: (filters: { periodId?: number; status?: string; runType?: string } = {}) =>
    api.get<any[]>(`/payroll-runs${qs(filters)}`),
  get: (id: number) => api.get<any>(`/payroll-runs/${id}`),
  start: (body: StartRunBody) => api.post<any>('/payroll-runs', body),
  simulate: (body: StartRunBody) => api.post<any>('/payroll-runs/simulate', body),
  retro: (body: Record<string, unknown>) => api.post<any>('/payroll-runs/retro', body),
  finalSettlement: (body: { employeeId: number; lastWorkingDate: string }) =>
    api.post<any>('/payroll-runs/final-settlement', body),
  submitApproval: (id: number) => api.put<any>(`/payroll-runs/${id}/submit-approval`, {}),
  approve: (id: number, comments?: string) => api.put<any>(`/payroll-runs/${id}/approve`, { comments }),
  reject: (id: number, comments?: string) => api.put<any>(`/payroll-runs/${id}/reject`, { comments }),
  job: (id: number) => api.get<any>(`/payroll-runs/jobs/${id}`),
};

// ---------------------------------------------------------------------------
// Payroll admin: analytics, reports, bank, tax, approvals, audit, payslips
// ---------------------------------------------------------------------------
export const payrollAdminApi = {
  dashboard: (periodId?: number) => api.get<any>(`/payroll-admin/dashboard${qs({ periodId })}`),
  costAnalytics: (params: { from?: string; to?: string } = {}) =>
    api.get<any>(`/payroll-admin/analytics/cost${qs(params)}`),
  salaryTrends: (employeeId?: number) => api.get<any>(`/payroll-admin/analytics/trends${qs({ employeeId })}`),
  incrementAnalysis: () => api.get<any>('/payroll-admin/analytics/increments'),
  overtimeAnalysis: (params: { from?: string; to?: string } = {}) =>
    api.get<any>(`/payroll-admin/analytics/overtime${qs(params)}`),
  bonusAnalysis: (params: { from?: string; to?: string } = {}) =>
    api.get<any>(`/payroll-admin/analytics/bonus${qs(params)}`),
  forecast: (months = 6) => api.get<any>(`/payroll-admin/analytics/forecast${qs({ months })}`),
  compliance: (periodId: number) => api.get<any>(`/payroll-admin/compliance/${periodId}`),

  report: (type: string, params: Record<string, string | number | undefined> = {}) =>
    api.get<any>(`/payroll-admin/reports/${type}${qs(params)}`),
  reportExportUrl: (type: string, params: Record<string, string | number | undefined> = {}) =>
    `${BASE_URL}/payroll-admin/reports/${type}/export${qs(params)}`,
  /** Runs a large report in the background; returns a job id to poll. */
  queueReport: (type: string, params: Record<string, string | number | undefined> = {}) =>
    api.post<{ jobId: number; jobType?: string; status?: string }>(
      `/payroll-admin/reports/${type}/queue`,
      params,
    ),

  bankAccounts: () => api.get<any[]>('/payroll-admin/bank-accounts'),
  createBankAccount: (body: Record<string, unknown>) => api.post<any>('/payroll-admin/bank-accounts', body),
  batches: (filters: { periodId?: number; status?: string } = {}) =>
    api.get<any[]>(`/payroll-admin/batches${qs(filters)}`),
  batch: (id: number) => api.get<any>(`/payroll-admin/batches/${id}`),
  generateBatch: (body: Record<string, unknown>) => api.post<any>('/payroll-admin/batches', body),
  markBatchSent: (id: number) => api.put<any>(`/payroll-admin/batches/${id}/sent`, {}),
  recordResults: (id: number, results: unknown[]) =>
    api.post<any>(`/payroll-admin/batches/${id}/results`, { results }),
  retryBatch: (id: number) => api.post<any>(`/payroll-admin/batches/${id}/retry`, {}),
  batchExportUrl: (id: number) => `${BASE_URL}/payroll-admin/batches/${id}/export`,

  currencies: () => api.get<any[]>('/payroll-admin/currencies'),
  exchangeRates: () => api.get<any[]>('/payroll-admin/exchange-rates'),

  taxRegimes: () => api.get<any[]>('/payroll-admin/tax/regimes'),
  taxSlabs: (regimeId?: number) => api.get<any[]>(`/payroll-admin/tax/slabs${qs({ regimeId })}`),
  taxSections: () => api.get<any[]>('/payroll-admin/tax/sections'),
  declaration: (employeeId: number, fy: string) =>
    api.get<any>(`/payroll-admin/tax/declarations/${employeeId}/${fy}`),
  saveDeclaration: (employeeId: number, fy: string, body: Record<string, unknown>) =>
    api.put<any>(`/payroll-admin/tax/declarations/${employeeId}/${fy}`, body),
  submitDeclaration: (id: number) => api.put<any>(`/payroll-admin/tax/declarations/${id}/submit`, {}),
  verifyDeclaration: (id: number, decisions: unknown[]) =>
    api.put<any>(`/payroll-admin/tax/declarations/${id}/verify`, { decisions }),
  computation: (employeeId: number, fy: string) =>
    api.get<any>(`/payroll-admin/tax/computations/${employeeId}/${fy}`),
  recomputeTax: (employeeId: number, fy: string) =>
    api.post<any>(`/payroll-admin/tax/computations/${employeeId}/${fy}/recompute`, {}),
  form16: (employeeId: number, fy: string) => api.get<any>(`/payroll-admin/tax/form16/${employeeId}/${fy}`),

  pendingApprovals: () => api.get<any[]>('/payroll-admin/approvals/pending'),
  actOnApproval: (id: number, body: { action: 'APPROVE' | 'REJECT'; comments?: string }) =>
    api.put<any>(`/payroll-admin/approvals/${id}/act`, body),
  approvalsForEntity: (type: string, id: number) =>
    api.get<any>(`/payroll-admin/approvals/entity/${type}/${id}`),

  audit: (filters: { entityType?: string; periodId?: number; limit?: number } = {}) =>
    api.get<any>(`/payroll-admin/audit${qs(filters)}`),

  payslip: (lineId: number) => api.get<any>(`/payroll-admin/payslips/${lineId}`),
  payslipPdfUrl: (lineId: number) => `${BASE_URL}/payroll-admin/payslips/${lineId}/pdf`,
  bulkPayslips: (body: { periodId: number; employeeIds?: number[] }) =>
    api.post<any>('/payroll-admin/payslips/bulk', body),
};

/**
 * Opens an authenticated file endpoint. The API expects a bearer token, which a
 * plain anchor cannot send, so the file is fetched and handed to the browser as
 * a blob URL instead.
 */
export async function openAuthenticatedFile(url: string, fileName?: string): Promise<void> {
  const token = tokenStore.get();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  if (fileName) a.download = fileName;
  else a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
