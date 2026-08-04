// Enterprise attendance API. Additive: the existing hrms.ts helpers for the
// daily sheet, monthly register and shifts are untouched and still in use.

import { api, BASE_URL, tokenStore } from './client';
import type {
  ApprovalWorkflowStep, AttendanceAnalytics, AttendanceAuditEntry, AttendanceCapabilities,
  AttendanceDashboard, AttendanceDevice, AttendancePolicy, AttendanceReportResult,
  AttendanceRequest, AttendanceRequestType, BreakRecord, BreakType, ComplianceRule,
  ComplianceScanResult, ComplianceSummary, ComplianceViolation, DailyAttendanceDetail,
  Delegation, DeviceEnrollment, DeviceHealthSummary, DeviceSyncLog, FaceEnrollment,
  FaceProviderStatus, Geofence, IpRule, LiveAttendanceBoard, NfcCard, OvertimeRecord,
  Paged, PolicyAssignment, PunchRecord, PunchResult, QrTokenResponse, ReportDefinition,
  Roster, RosterCapacity, RosterEntry, RotationPattern, RotationPreview, SelfStatus,
  ShiftAssignment, ShiftDetail, Visitor, VisitorBoard, VisitorVisit,
} from '../types/attendance';

/**
 * Drops undefined/empty values so an unset filter never becomes `?x=undefined`.
 *
 * Generic over the argument because a TypeScript `interface` has no implicit
 * index signature, so the filter interfaces below are not assignable to
 * `Record<string, unknown>` even though they are plain objects.
 */
function qs<T extends object>(params: T): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export interface DayFilters {
  date?: string; from?: string; to?: string; employeeId?: number;
  branchId?: number; departmentId?: number; shiftId?: number;
  status?: string; workMode?: string; exception?: string;
  search?: string; page?: number; pageSize?: number;
}

export interface PunchFilters {
  employeeId?: number; from?: string; to?: string; deviceId?: number;
  punchType?: string; captureMethod?: string; status?: string; geoStatus?: string;
  branchId?: number; departmentId?: number; search?: string;
  page?: number; pageSize?: number;
}

export interface RequestFilters {
  status?: string; requestType?: string; employeeId?: number;
  approverEmployeeId?: number; from?: string; to?: string;
  overdueOnly?: boolean; search?: string; page?: number; pageSize?: number;
}

export const attendanceApi = {
  // -------------------------------------------------------------------------
  // Capabilities, dashboard, analytics
  // -------------------------------------------------------------------------
  capabilities: (): Promise<AttendanceCapabilities> => api.get('/attendance/capabilities'),
  dashboard: (date?: string): Promise<AttendanceDashboard> => api.get(`/attendance/dashboard${qs({ date })}`),
  liveBoard: (date?: string): Promise<LiveAttendanceBoard> => api.get(`/attendance/live${qs({ date })}`),
  analytics: (params: { from: string; to: string; granularity?: string; branchId?: number; departmentId?: number; employeeId?: number }): Promise<AttendanceAnalytics> =>
    api.get(`/attendance/analytics${qs(params)}`),

  /**
   * Live punch feed over server-sent events.
   *
   * EventSource cannot send an Authorization header, so the token rides as a
   * query parameter. Returns a close function; call it on unmount or the
   * connection stays open and the server keeps polling for it.
   */
  liveStream: (onPunch: (punches: PunchRecord[]) => void, onError?: (message: string) => void): (() => void) => {
    const token = tokenStore.get();
    if (!token) {
      onError?.('Not signed in');
      return () => undefined;
    }
    const source = new EventSource(`${BASE_URL}/attendance/live/stream?token=${encodeURIComponent(token)}`);
    source.addEventListener('punch', (event) => {
      try {
        onPunch(JSON.parse((event as MessageEvent).data));
      } catch {
        /* a malformed frame should not tear the feed down */
      }
    });
    source.addEventListener('error', () => {
      onError?.('Live feed disconnected, retrying');
    });
    return () => source.close();
  },

  // -------------------------------------------------------------------------
  // Punches and days
  // -------------------------------------------------------------------------
  punches: (filters: PunchFilters = {}): Promise<Paged<PunchRecord>> => api.get(`/attendance/punches${qs(filters)}`),
  recordPunch: (body: Record<string, unknown>): Promise<PunchResult> => api.post('/attendance/punches', body),
  deletePunch: (id: number, reason: string): Promise<{ success: true; recomputed: { employeeId: number; date: string } }> =>
    api.delete(`/attendance/punches/${id}`, { reason }),

  days: (filters: DayFilters = {}): Promise<Paged<DailyAttendanceDetail>> => api.get(`/attendance/days${qs(filters)}`),
  dayDetail: (employeeId: number, date: string): Promise<DailyAttendanceDetail> =>
    api.get(`/attendance/employee/${employeeId}/day${qs({ date })}`),
  breaks: (from: string, to?: string, employeeId?: number): Promise<BreakRecord[]> =>
    api.get(`/attendance/breaks${qs({ from, to, employeeId })}`),

  recompute: (body: { from: string; to?: string; employeeId?: number }): Promise<{ days: number; skippedLocked: number; employees: number }> =>
    api.post('/attendance/recompute', body),
  autoPunchOut: (date?: string): Promise<{ closed: number; skipped: number; details: string[] }> =>
    api.post('/attendance/auto-punch-out', { date }),
  autoMarkAbsent: (date: string): Promise<{ marked: number; skipped: number }> =>
    api.post('/attendance/auto-mark-absent', { date }),
  setLock: (body: { from: string; to: string; locked: boolean; reason?: string }): Promise<{ affected: number }> =>
    api.post('/attendance/lock', body),

  // -------------------------------------------------------------------------
  // Self service
  // -------------------------------------------------------------------------
  selfStatus: (): Promise<SelfStatus> => api.get('/attendance/me/status'),
  selfPunch: (body: Record<string, unknown>): Promise<PunchResult> => api.post('/attendance/me/punch-enterprise', body),
  selfRequest: (body: Record<string, unknown>): Promise<AttendanceRequest> => api.post('/attendance/me/requests', body),
  respondToSwap: (id: number, accept: boolean): Promise<AttendanceRequest> =>
    api.post(`/attendance/me/requests/${id}/respond-swap`, { accept }),
  syncOffline: (punches: Record<string, unknown>[]): Promise<{ accepted: number; duplicates: number; rejected: { index: number; reason: string }[]; recomputed: number }> =>
    api.post('/attendance/me/sync-offline', { punches }),

  // -------------------------------------------------------------------------
  // Policies and breaks
  // -------------------------------------------------------------------------
  policies: (includeInactive = false): Promise<AttendancePolicy[]> =>
    api.get(`/attendance/policies${qs({ includeInactive: includeInactive || undefined })}`),
  policy: (id: number): Promise<AttendancePolicy> => api.get(`/attendance/policies/${id}`),
  createPolicy: (body: Partial<AttendancePolicy>): Promise<AttendancePolicy> => api.post('/attendance/policies', body),
  updatePolicy: (id: number, body: Partial<AttendancePolicy>): Promise<AttendancePolicy> => api.put(`/attendance/policies/${id}`, body),
  deletePolicy: (id: number): Promise<{ success: true }> => api.delete(`/attendance/policies/${id}`),
  resolvePolicy: (employeeId: number, date?: string): Promise<AttendancePolicy> =>
    api.get(`/attendance/policies/resolve/${employeeId}${qs({ date })}`),

  policyAssignments: (policyId?: number): Promise<PolicyAssignment[]> =>
    api.get(`/attendance/policies/assignments${qs({ policyId })}`),
  createPolicyAssignment: (body: Partial<PolicyAssignment>): Promise<PolicyAssignment[]> =>
    api.post('/attendance/policies/assignments', body),
  deletePolicyAssignment: (id: number): Promise<{ success: true }> =>
    api.delete(`/attendance/policies/assignments/${id}`),

  breakTypes: (includeInactive = false): Promise<BreakType[]> =>
    api.get(`/attendance/break-types${qs({ includeInactive: includeInactive || undefined })}`),
  createBreakType: (body: Partial<BreakType>): Promise<BreakType[]> => api.post('/attendance/break-types', body),
  updateBreakType: (id: number, body: Partial<BreakType>): Promise<BreakType[]> => api.put(`/attendance/break-types/${id}`, body),
  deleteBreakType: (id: number): Promise<{ success: true }> => api.delete(`/attendance/break-types/${id}`),

  // -------------------------------------------------------------------------
  // Requests, workflows, delegations, overtime
  // -------------------------------------------------------------------------
  requests: (filters: RequestFilters = {}): Promise<Paged<AttendanceRequest>> => api.get(`/attendance/requests${qs(filters)}`),
  request: (id: number): Promise<AttendanceRequest> => api.get(`/attendance/requests/${id}`),
  createRequest: (body: Record<string, unknown>): Promise<AttendanceRequest> => api.post('/attendance/requests', body),
  decideRequest: (id: number, decision: 'APPROVE' | 'REJECT', comments?: string): Promise<AttendanceRequest> =>
    api.post(`/attendance/requests/${id}/decide`, { decision, comments }),
  cancelRequest: (id: number): Promise<AttendanceRequest> => api.post(`/attendance/requests/${id}/cancel`, {}),
  requestSummary: (from?: string, to?: string): Promise<Record<string, number>> =>
    api.get(`/attendance/requests/summary${qs({ from, to })}`),
  runEscalations: (): Promise<{ escalated: number; autoApproved: number; details: string[] }> =>
    api.post('/attendance/requests/escalate', {}),

  workflows: (requestType?: AttendanceRequestType): Promise<ApprovalWorkflowStep[]> =>
    api.get(`/attendance/workflows${qs({ requestType })}`),
  createWorkflowStep: (body: Partial<ApprovalWorkflowStep>): Promise<ApprovalWorkflowStep[]> =>
    api.post('/attendance/workflows', body),
  deleteWorkflowStep: (id: number): Promise<{ success: true }> => api.delete(`/attendance/workflows/${id}`),

  delegations: (employeeId?: number): Promise<Delegation[]> => api.get(`/attendance/delegations${qs({ employeeId })}`),
  createDelegation: (body: Partial<Delegation>): Promise<Delegation[]> => api.post('/attendance/delegations', body),
  cancelDelegation: (id: number): Promise<{ success: true }> => api.delete(`/attendance/delegations/${id}`),

  overtime: (filters: { from?: string; to?: string; employeeId?: number; status?: string; page?: number; pageSize?: number } = {}): Promise<Paged<OvertimeRecord>> =>
    api.get(`/attendance/overtime${qs(filters)}`),
  decideOvertime: (body: { employeeId: number; attDate: string; approvedHours: number; approve: boolean }): Promise<{ approvedHours: number; status: string }> =>
    api.post('/attendance/overtime/decide', body),

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------
  shiftDetails: (includeInactive = false): Promise<ShiftDetail[]> =>
    api.get(`/attendance/scheduling/shifts${qs({ includeInactive: includeInactive || undefined })}`),
  createShiftDetail: (body: Partial<ShiftDetail>): Promise<ShiftDetail> => api.post('/attendance/scheduling/shifts', body),
  updateShiftDetail: (id: number, body: Partial<ShiftDetail>): Promise<ShiftDetail> =>
    api.put(`/attendance/scheduling/shifts/${id}`, body),

  rotations: (): Promise<RotationPattern[]> => api.get('/attendance/scheduling/rotations'),
  createRotation: (body: Partial<RotationPattern>): Promise<RotationPattern[]> =>
    api.post('/attendance/scheduling/rotations', body),
  deleteRotation: (id: number): Promise<{ success: true }> => api.delete(`/attendance/scheduling/rotations/${id}`),
  previewRotation: (id: number, from: string, days = 14, anchorDate?: string): Promise<RotationPreview> =>
    api.get(`/attendance/scheduling/rotations/${id}/preview${qs({ from, days, anchorDate })}`),

  shiftAssignments: (employeeId?: number, activeOn?: string): Promise<ShiftAssignment[]> =>
    api.get(`/attendance/scheduling/assignments${qs({ employeeId, activeOn })}`),
  assignShift: (body: Partial<ShiftAssignment>): Promise<ShiftAssignment[]> =>
    api.post('/attendance/scheduling/assignments', body),
  deleteShiftAssignment: (id: number): Promise<{ success: true }> =>
    api.delete(`/attendance/scheduling/assignments/${id}`),
  resolveShifts: (date?: string): Promise<ShiftAssignment[]> =>
    api.get(`/attendance/scheduling/resolve${qs({ date })}`),

  rosters: (filters: { branchId?: number; departmentId?: number; status?: string; from?: string; to?: string } = {}): Promise<Roster[]> =>
    api.get(`/attendance/scheduling/rosters${qs(filters)}`),
  roster: (id: number): Promise<{ roster: Roster; entries: RosterEntry[] }> =>
    api.get(`/attendance/scheduling/rosters/${id}`),
  generateRoster: (body: Record<string, unknown>): Promise<{ roster: Roster; entries: number; warnings: string[] }> =>
    api.post('/attendance/scheduling/rosters', body),
  updateRosterEntries: (id: number, entries: Partial<RosterEntry>[]): Promise<{ written: number }> =>
    api.put(`/attendance/scheduling/rosters/${id}/entries`, { entries }),
  setRosterStatus: (id: number, status: string): Promise<Roster> =>
    api.post(`/attendance/scheduling/rosters/${id}/status`, { status }),
  deleteRoster: (id: number): Promise<{ success: true }> => api.delete(`/attendance/scheduling/rosters/${id}`),
  rosterCapacity: (id: number): Promise<RosterCapacity> => api.get(`/attendance/scheduling/rosters/${id}/capacity`),
  swapRosterEntries: (entryIdA: number, entryIdB: number): Promise<{ success: true }> =>
    api.post('/attendance/scheduling/rosters/swap', { entryIdA, entryIdB }),

  // -------------------------------------------------------------------------
  // Devices and credentials
  // -------------------------------------------------------------------------
  devices: (filters: { deviceType?: string; branchId?: number; status?: string; healthStatus?: string; search?: string } = {}): Promise<AttendanceDevice[]> =>
    api.get(`/attendance/devices${qs(filters)}`),
  device: (id: number): Promise<AttendanceDevice> => api.get(`/attendance/devices/${id}`),
  createDevice: (body: Partial<AttendanceDevice>): Promise<{ device: AttendanceDevice; apiKey: string; notice: string }> =>
    api.post('/attendance/devices', body),
  updateDevice: (id: number, body: Partial<AttendanceDevice>): Promise<AttendanceDevice> =>
    api.put(`/attendance/devices/${id}`, body),
  deleteDevice: (id: number): Promise<{ success: true }> => api.delete(`/attendance/devices/${id}`),
  rotateDeviceKey: (id: number): Promise<{ apiKey: string; notice: string }> =>
    api.post(`/attendance/devices/${id}/rotate-key`, {}),
  deviceHealth: (): Promise<DeviceHealthSummary> => api.get('/attendance/devices/health'),
  syncLogs: (deviceId?: number, limit = 50): Promise<DeviceSyncLog[]> =>
    api.get(`/attendance/devices/sync-logs${qs({ deviceId, limit })}`),
  pullDevice: (id: number): Promise<never> => api.post(`/attendance/devices/${id}/pull`, {}),
  issueQr: (deviceId: number): Promise<QrTokenResponse> => api.get(`/attendance/devices/${deviceId}/qr`),

  enrollments: (deviceId?: number, employeeId?: number): Promise<DeviceEnrollment[]> =>
    api.get(`/attendance/devices/enrollments${qs({ deviceId, employeeId })}`),
  createEnrollment: (body: Partial<DeviceEnrollment>): Promise<DeviceEnrollment[]> =>
    api.post('/attendance/devices/enrollments', body),
  deleteEnrollment: (id: number): Promise<{ success: true }> =>
    api.delete(`/attendance/devices/enrollments/${id}`),

  geofences: (includeInactive = false): Promise<Geofence[]> =>
    api.get(`/attendance/geofences${qs({ includeInactive: includeInactive || undefined })}`),
  createGeofence: (body: Partial<Geofence>): Promise<Geofence[]> => api.post('/attendance/geofences', body),
  updateGeofence: (id: number, body: Partial<Geofence>): Promise<Geofence[]> => api.put(`/attendance/geofences/${id}`, body),
  deleteGeofence: (id: number): Promise<{ success: true }> => api.delete(`/attendance/geofences/${id}`),
  assignGeofence: (employeeId: number, geofenceId: number): Promise<{ success: true }> =>
    api.post('/attendance/geofences/assign', { employeeId, geofenceId }),
  unassignGeofence: (employeeId: number, geofenceId: number): Promise<{ success: true }> =>
    api.post('/attendance/geofences/unassign', { employeeId, geofenceId }),

  cards: (filters: { employeeId?: number; status?: string; search?: string } = {}): Promise<NfcCard[]> =>
    api.get(`/attendance/cards${qs(filters)}`),
  createCard: (body: Partial<NfcCard>): Promise<NfcCard[]> => api.post('/attendance/cards', body),
  setCardStatus: (id: number, status: string, notes?: string): Promise<NfcCard[]> =>
    api.put(`/attendance/cards/${id}/status`, { status, notes }),
  deleteCard: (id: number): Promise<{ success: true }> => api.delete(`/attendance/cards/${id}`),

  faceEnrollments: (employeeId?: number): Promise<{ status: FaceProviderStatus; rows: FaceEnrollment[] }> =>
    api.get(`/attendance/face-enrollments${qs({ employeeId })}`),
  enrollFace: (employeeId: number, imageRefs: string[]): Promise<FaceEnrollment[]> =>
    api.post('/attendance/face-enrollments', { employeeId, imageRefs }),

  ipRules: (includeInactive = false): Promise<IpRule[]> =>
    api.get(`/attendance/ip-rules${qs({ includeInactive: includeInactive || undefined })}`),
  createIpRule: (body: Partial<IpRule>): Promise<IpRule[]> => api.post('/attendance/ip-rules', body),
  deleteIpRule: (id: number): Promise<{ success: true }> => api.delete(`/attendance/ip-rules/${id}`),

  // -------------------------------------------------------------------------
  // Compliance
  // -------------------------------------------------------------------------
  complianceRules: (includeInactive = false): Promise<ComplianceRule[]> =>
    api.get(`/attendance/compliance/rules${qs({ includeInactive: includeInactive || undefined })}`),
  createComplianceRule: (body: Partial<ComplianceRule>): Promise<ComplianceRule[]> =>
    api.post('/attendance/compliance/rules', body),
  updateComplianceRule: (id: number, body: Partial<ComplianceRule>): Promise<ComplianceRule[]> =>
    api.put(`/attendance/compliance/rules/${id}`, body),
  deleteComplianceRule: (id: number): Promise<{ success: true }> =>
    api.delete(`/attendance/compliance/rules/${id}`),
  runComplianceScan: (from: string, to?: string): Promise<ComplianceScanResult> =>
    api.post('/attendance/compliance/scan', { from, to }),
  violations: (filters: { status?: string; severity?: string; ruleId?: number; employeeId?: number; from?: string; to?: string; page?: number; pageSize?: number } = {}): Promise<Paged<ComplianceViolation>> =>
    api.get(`/attendance/compliance/violations${qs(filters)}`),
  resolveViolation: (id: number, status: string, note?: string): Promise<{ success: true }> =>
    api.post(`/attendance/compliance/violations/${id}/resolve`, { status, note }),
  complianceSummary: (): Promise<ComplianceSummary> => api.get('/attendance/compliance/summary'),

  // -------------------------------------------------------------------------
  // Visitors
  // -------------------------------------------------------------------------
  visitors: (filters: { visitorType?: string; search?: string; onSiteOnly?: boolean } = {}): Promise<Visitor[]> =>
    api.get(`/attendance/visitors${qs(filters)}`),
  createVisitor: (body: Partial<Visitor>): Promise<Visitor[]> => api.post('/attendance/visitors', body),
  updateVisitor: (id: number, body: Partial<Visitor>): Promise<Visitor[]> => api.put(`/attendance/visitors/${id}`, body),
  deleteVisitor: (id: number): Promise<{ success: true }> => api.delete(`/attendance/visitors/${id}`),

  visitorBoard: (date?: string): Promise<VisitorBoard> => api.get(`/attendance/visitors/board${qs({ date })}`),
  visits: (filters: { from?: string; to?: string; visitorId?: number; status?: string; visitorType?: string; page?: number; pageSize?: number } = {}): Promise<Paged<VisitorVisit>> =>
    api.get(`/attendance/visitors/visits${qs(filters)}`),
  createVisit: (body: Partial<VisitorVisit>): Promise<VisitorVisit> => api.post('/attendance/visitors/visits', body),
  checkInVisit: (id: number): Promise<VisitorVisit> => api.post(`/attendance/visitors/visits/${id}/check-in`, {}),
  checkOutVisit: (id: number): Promise<VisitorVisit> => api.post(`/attendance/visitors/visits/${id}/check-out`, {}),
  setVisitStatus: (id: number, status: string, remarks?: string): Promise<VisitorVisit> =>
    api.post(`/attendance/visitors/visits/${id}/status`, { status, remarks }),
  deleteVisit: (id: number): Promise<{ success: true }> => api.delete(`/attendance/visitors/visits/${id}`),

  // -------------------------------------------------------------------------
  // Reports and audit
  // -------------------------------------------------------------------------
  reports: (): Promise<ReportDefinition[]> => api.get('/attendance/reports'),
  runReport: (slug: string, params: { from?: string; to?: string; employeeId?: number; branchId?: number; departmentId?: number; status?: string } = {}): Promise<AttendanceReportResult> =>
    api.get(`/attendance/reports/${slug}${qs(params)}`),

  /**
   * CSV download. Goes through fetch rather than a plain link because the
   * endpoint needs the bearer token, which an anchor cannot carry.
   */
  downloadReportCsv: async (slug: string, params: Record<string, unknown> = {}): Promise<void> => {
    const token = tokenStore.get();
    const res = await fetch(`${BASE_URL}/attendance/reports/${slug}${qs({ ...params, format: 'csv' })}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      let message = `Export failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch { /* non-JSON error body */ }
      throw new Error(message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-${slug}-${params.from ?? ''}-to-${params.to ?? ''}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  audit: (filters: { entityType?: string; entityId?: number; employeeId?: number; action?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}): Promise<Paged<AttendanceAuditEntry>> =>
    api.get(`/attendance/audit${qs(filters)}`),
};
