// Typed helpers for the HRMS endpoints. One function per backend route so
// pages never hand-build URLs.
import { api } from './client';
import type {
  AttendanceRecord,
  AttendanceStatus,
  RegisterRow,
  Shift,
  Holiday,
  PunchImportResult,
  LeaveType,
  LeaveRequest,
  LeaveBalance,
  Advance,
  AdvanceRecovery,
  Candidate,
  JobOpening,
  CandidateStatus,
  EmployeeProfile,
  EmployeeDocument,
  DashboardPayload,
  RecalculateResult,
  ComplianceSummary,
  Payslip,
  AppNotification,
  ActivityEntry,
} from '../types/hrms';

const qs = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.append(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
};

// ---------------------------------------------------------------------------
// Attendance, shifts and holidays
// ---------------------------------------------------------------------------
export interface BulkMarkEntry {
  employeeId: number;
  status: AttendanceStatus;
  otHours?: number;
  remarks?: string | null;
  leaveTypeId?: number | null;
}

export const attendanceApi = {
  daily: (date: string) => api.get<AttendanceRecord[]>(`/attendance/daily${qs({ date })}`),
  bulkMark: (date: string, entries: BulkMarkEntry[]) =>
    api.post<{ marked: number }>('/attendance/bulk', { date, entries }),
  register: (month: string, employeeId?: number) =>
    api.get<RegisterRow[]>(`/attendance/register${qs({ month, employeeId })}`),
  forEmployee: (employeeId: number, from: string, to: string) =>
    api.get<AttendanceRecord[]>(`/attendance/employee/${employeeId}${qs({ from, to })}`),
  importPunches: (csvText: string) =>
    api.post<PunchImportResult>('/attendance/import-punches', { csvText }),

  shifts: () => api.get<Shift[]>('/attendance/shifts'),
  createShift: (body: Partial<Shift>) => api.post<Shift>('/attendance/shifts', body),
  updateShift: (id: number, body: Partial<Shift>) => api.put<Shift>(`/attendance/shifts/${id}`, body),
  deleteShift: (id: number) => api.delete<{ success: boolean }>(`/attendance/shifts/${id}`),

  holidays: (year: number) => api.get<Holiday[]>(`/attendance/holidays${qs({ year })}`),
  createHoliday: (body: { date: string; name: string; isOptional?: boolean }) =>
    api.post<Holiday>('/attendance/holidays', body),
  deleteHoliday: (id: number) => api.delete<{ success: boolean }>(`/attendance/holidays/${id}`),
};

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------
export const leaveApi = {
  types: () => api.get<LeaveType[]>('/leave/types'),
  createType: (body: Partial<LeaveType>) => api.post<LeaveType>('/leave/types', body),
  balances: (year: number, employeeId?: number) =>
    api.get<LeaveBalance[]>(`/leave/balances${qs({ year, employeeId })}`),
  initYear: (year: number) => api.post<{ year: number; rowsAffected: number }>('/leave/balances/init', { year }),
  requests: (filters: { status?: string; employeeId?: number; from?: string; to?: string } = {}) =>
    api.get<LeaveRequest[]>(`/leave/requests${qs(filters)}`),
  createRequest: (body: {
    employeeId: number;
    leaveTypeId: number;
    fromDate: string;
    toDate: string;
    reason?: string;
  }) => api.post<LeaveRequest>('/leave/requests', body),
  approve: (id: number, note?: string) =>
    api.put<LeaveRequest & { warning?: string }>(`/leave/requests/${id}/approve`, { note }),
  reject: (id: number, note: string) => api.put<LeaveRequest>(`/leave/requests/${id}/reject`, { note }),
  cancel: (id: number) => api.put<LeaveRequest>(`/leave/requests/${id}/cancel`, {}),
};

// ---------------------------------------------------------------------------
// Advances and loans
// ---------------------------------------------------------------------------
export const advanceApi = {
  list: (filters: { employeeId?: number; status?: string } = {}) =>
    api.get<Advance[]>(`/advances${qs(filters)}`),
  detail: (id: number) => api.get<{ advance: Advance; recoveries: AdvanceRecovery[] }>(`/advances/${id}`),
  create: (body: {
    employeeId: number;
    advanceType: string;
    amount: number;
    advanceDate: string;
    installmentAmount: number;
    reason?: string;
  }) => api.post<Advance>('/advances', body),
  close: (id: number) => api.put<Advance>(`/advances/${id}/close`, {}),
  addRecovery: (id: number, body: { amount: number; recoveredOn?: string; remarks?: string }) =>
    api.post<AdvanceRecovery>(`/advances/${id}/recoveries`, body),
};

// ---------------------------------------------------------------------------
// Recruitment
// ---------------------------------------------------------------------------
export const recruitmentApi = {
  openings: (status?: string) => api.get<JobOpening[]>(`/candidates/openings${qs({ status })}`),
  createOpening: (body: Partial<JobOpening>) => api.post<JobOpening>('/candidates/openings', body),
  closeOpening: (id: number) => api.put<JobOpening>(`/candidates/openings/${id}/close`, {}),

  candidates: (filters: { status?: string; openingId?: number; search?: string } = {}) =>
    api.get<Candidate[]>(`/candidates${qs(filters)}`),
  create: (body: Partial<Candidate>) => api.post<Candidate>('/candidates', body),
  update: (id: number, body: Partial<Candidate>) => api.put<Candidate>(`/candidates/${id}`, body),
  setStatus: (id: number, status: CandidateStatus) =>
    api.put<Candidate>(`/candidates/${id}/status`, { status }),
  convert: (
    id: number,
    body: {
      empCode: string;
      grade?: string;
      workerType?: string;
      joinedAt: string;
      monthlySalary?: number | null;
      department?: string | null;
      designation?: string | null;
    },
  ) => api.post<{ employeeId: number; empCode: string }>(`/candidates/${id}/convert`, body),
};

// ---------------------------------------------------------------------------
// Employee profile, KYC and documents
// ---------------------------------------------------------------------------
export const employeeHrApi = {
  profile: (id: number) => api.get<EmployeeProfile>(`/employees/${id}/profile`),
  updateProfile: (id: number, body: Partial<EmployeeProfile> & { aadhaarNumber?: string }) =>
    api.put<EmployeeProfile>(`/employees/${id}/profile`, body),
  create: (body: Record<string, unknown>) => api.post<EmployeeProfile>('/employees', body),
  documents: (id: number) => api.get<EmployeeDocument[]>(`/employees/${id}/documents`),
  uploadDocument: (id: number, file: File, docType: string, title?: string) =>
    api.upload<EmployeeDocument>(`/employees/${id}/documents`, file, {
      docType,
      ...(title ? { title } : {}),
    }),
  verifyDocument: (docId: number) => api.put<{ success: boolean }>(`/employees/documents/${docId}/verify`, {}),
  deleteDocument: (docId: number) => api.delete<{ success: boolean }>(`/employees/documents/${docId}`),
};

// ---------------------------------------------------------------------------
// Payroll additions
// ---------------------------------------------------------------------------
export const payrollHrApi = {
  recalculate: (periodId: number) =>
    api.post<RecalculateResult>(`/payroll/periods/${periodId}/recalculate`),
  compliance: (periodId: number) => api.get<ComplianceSummary>(`/payroll/periods/${periodId}/compliance`),
  payslip: (lineId: number) => api.get<Payslip>(`/payroll/lines/${lineId}/payslip`),
};

// ---------------------------------------------------------------------------
// Dashboards, notifications and activity
// ---------------------------------------------------------------------------
export const hrDashboardApi = {
  hr: () => api.get<DashboardPayload>('/hr-dashboard/hr'),
  manager: (employeeId?: number) => api.get<DashboardPayload>(`/hr-dashboard/manager${qs({ employeeId })}`),
  executive: () => api.get<DashboardPayload>('/hr-dashboard/executive'),
  employee: (employeeId?: number) => api.get<DashboardPayload>(`/hr-dashboard/employee${qs({ employeeId })}`),
  activity: (filters: { employeeId?: number; entityType?: string; limit?: number } = {}) =>
    api.get<ActivityEntry[]>(`/hr-dashboard/activity${qs(filters)}`),
  search: (q: string) => api.get<any[]>(`/hr-dashboard/search${qs({ q })}`),
  calendar: (from: string, to: string) => api.get<any[]>(`/hr-dashboard/calendar${qs({ from, to })}`),
};

export const notificationApi = {
  list: (filters: { unreadOnly?: boolean; archived?: boolean; category?: string; limit?: number } = {}) =>
    api.get<AppNotification[]>(`/notifications${qs(filters)}`),
  unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
  markRead: (id: number) => api.put<{ success: boolean }>(`/notifications/${id}/read`, {}),
  markAllRead: () => api.put<{ updated: number }>('/notifications/read-all', {}),
  archive: (id: number) => api.put<{ success: boolean }>(`/notifications/${id}/archive`, {}),
};
