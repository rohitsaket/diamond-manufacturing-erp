import { Router } from 'express';
import { AttendanceController } from '../controllers/AttendanceController';
import { AttendanceEnterpriseController } from '../controllers/AttendanceEnterpriseController';
import { authenticate, authenticateStream, requireStaff, requireRole, allowSelfOrStaff } from '../middleware/auth';

const router = Router();
const ctrl = new AttendanceController();
const ent = new AttendanceEnterpriseController();

/** Anyone who can change configuration: policies, devices, workflows, fences. */
const configure = requireRole('admin', 'manager', 'hr');
/** Anyone who can act on attendance data: mark, approve, correct. */
const operate = requireRole('admin', 'manager', 'hr');

// ===========================================================================
// EXISTING ROUTES -- unchanged. Every path, method and permission below is
// exactly as it was before the enterprise upgrade.
// ===========================================================================

// Shifts
router.get('/shifts', authenticate, requireStaff, ctrl.getShifts);
router.post('/shifts', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.createShift);
router.put('/shifts/:id', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.updateShift);
router.delete('/shifts/:id', authenticate, requireRole('admin'), ctrl.deleteShift);

// Holidays (readable by self-service users too)
router.get('/holidays', authenticate, ctrl.getHolidays);
router.post('/holidays', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.createHoliday);
router.delete('/holidays/:id', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.deleteHoliday);

// Self service (declared before /employee/:id so the literal paths win)
router.get('/me/today', authenticate, ctrl.getMyToday);
router.post('/me/punch', authenticate, ctrl.punch);

// Attendance
router.get('/daily', authenticate, requireStaff, ctrl.getDaily);
router.post('/bulk', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.bulkMark);
router.get('/register', authenticate, requireStaff, ctrl.getRegister);
router.post('/import-punches', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.importPunches);

// ===========================================================================
// ENTERPRISE ROUTES -- all additive.
//
// Device sync authenticates with a device key rather than a user token, so it
// sits above `authenticate`. Everything else below requires a session.
// ===========================================================================

// --- Device push (device-key authenticated) --------------------------------
router.post('/devices/sync', ent.deviceSync);
router.post('/devices/heartbeat', ent.deviceHeartbeat);

// --- Capability report -----------------------------------------------------
router.get('/capabilities', authenticate, ent.getCapabilities);

// --- Self service ----------------------------------------------------------
router.get('/me/status', authenticate, ent.getSelfStatus);
router.post('/me/punch-enterprise', authenticate, ent.recordSelfPunch);
router.post('/me/requests', authenticate, ent.createSelfRequest);
router.post('/me/requests/:id/respond-swap', authenticate, ent.respondToSwap);
router.post('/me/sync-offline', authenticate, ent.syncOffline);

// --- Dashboard, live board, analytics --------------------------------------
router.get('/dashboard', authenticate, requireStaff, ent.getDashboard);
router.get('/live', authenticate, requireStaff, ent.getLiveBoard);
// EventSource cannot set headers, so this one route also accepts ?token=.
router.get('/live/stream', authenticateStream, requireStaff, ent.streamLive);
router.get('/analytics', authenticate, requireStaff, ent.getAnalytics);

// --- Punches ---------------------------------------------------------------
router.get('/punches', authenticate, requireStaff, ent.listPunches);
router.post('/punches', authenticate, operate, ent.recordPunch);
router.delete('/punches/:id', authenticate, operate, ent.deletePunch);

// --- Days ------------------------------------------------------------------
router.get('/days', authenticate, requireStaff, ent.listDays);
router.post('/recompute', authenticate, operate, ent.recompute);
router.post('/auto-punch-out', authenticate, operate, ent.autoPunchOut);
router.post('/auto-mark-absent', authenticate, operate, ent.autoMarkAbsent);
router.post('/lock', authenticate, requireRole('admin', 'accountant'), ent.setLock);

// --- Policies and breaks ---------------------------------------------------
router.get('/policies', authenticate, requireStaff, ent.listPolicies);
router.post('/policies', authenticate, configure, ent.createPolicy);
router.get('/policies/assignments', authenticate, requireStaff, ent.listPolicyAssignments);
router.post('/policies/assignments', authenticate, configure, ent.createPolicyAssignment);
router.delete('/policies/assignments/:id', authenticate, configure, ent.deletePolicyAssignment);
router.get('/policies/resolve/:employeeId', authenticate, requireStaff, ent.resolvePolicy);
router.get('/policies/:id', authenticate, requireStaff, ent.getPolicy);
router.put('/policies/:id', authenticate, configure, ent.updatePolicy);
router.delete('/policies/:id', authenticate, requireRole('admin'), ent.deletePolicy);

router.get('/break-types', authenticate, requireStaff, ent.listBreakTypes);
router.post('/break-types', authenticate, configure, ent.createBreakType);
router.put('/break-types/:id', authenticate, configure, ent.updateBreakType);
router.delete('/break-types/:id', authenticate, configure, ent.deleteBreakType);
router.get('/breaks', authenticate, requireStaff, ent.listBreaks);

// --- Requests and approvals ------------------------------------------------
router.get('/requests', authenticate, requireStaff, ent.listRequests);
router.post('/requests', authenticate, operate, ent.createRequest);
router.get('/requests/summary', authenticate, requireStaff, ent.getRequestSummary);
router.post('/requests/escalate', authenticate, operate, ent.runEscalations);
router.get('/requests/:id', authenticate, requireStaff, ent.getRequest);
router.post('/requests/:id/decide', authenticate, operate, ent.decideRequest);
router.post('/requests/:id/cancel', authenticate, requireStaff, ent.cancelRequest);

router.get('/workflows', authenticate, requireStaff, ent.listWorkflows);
router.post('/workflows', authenticate, configure, ent.createWorkflowStep);
router.delete('/workflows/:id', authenticate, configure, ent.deleteWorkflowStep);

router.get('/delegations', authenticate, requireStaff, ent.listDelegations);
router.post('/delegations', authenticate, operate, ent.createDelegation);
router.delete('/delegations/:id', authenticate, operate, ent.cancelDelegation);

router.get('/overtime', authenticate, requireStaff, ent.listOvertime);
router.post('/overtime/decide', authenticate, operate, ent.decideOvertime);

// --- Scheduling ------------------------------------------------------------
router.get('/scheduling/shifts', authenticate, requireStaff, ent.listShiftDetails);
router.post('/scheduling/shifts', authenticate, configure, ent.createShiftDetail);
router.put('/scheduling/shifts/:id', authenticate, configure, ent.updateShiftDetail);

router.get('/scheduling/rotations', authenticate, requireStaff, ent.listRotations);
router.post('/scheduling/rotations', authenticate, configure, ent.createRotation);
router.get('/scheduling/rotations/:id/preview', authenticate, requireStaff, ent.previewRotation);
router.delete('/scheduling/rotations/:id', authenticate, configure, ent.deleteRotation);

router.get('/scheduling/assignments', authenticate, requireStaff, ent.listShiftAssignments);
router.post('/scheduling/assignments', authenticate, operate, ent.createShiftAssignment);
router.delete('/scheduling/assignments/:id', authenticate, operate, ent.deleteShiftAssignment);
router.get('/scheduling/resolve', authenticate, requireStaff, ent.resolveShifts);

router.get('/scheduling/rosters', authenticate, requireStaff, ent.listRosters);
router.post('/scheduling/rosters', authenticate, operate, ent.generateRoster);
router.post('/scheduling/rosters/swap', authenticate, operate, ent.swapRosterEntries);
router.get('/scheduling/rosters/:id', authenticate, requireStaff, ent.getRoster);
router.get('/scheduling/rosters/:id/capacity', authenticate, requireStaff, ent.getRosterCapacity);
router.put('/scheduling/rosters/:id/entries', authenticate, operate, ent.updateRosterEntries);
router.post('/scheduling/rosters/:id/status', authenticate, operate, ent.setRosterStatus);
router.delete('/scheduling/rosters/:id', authenticate, operate, ent.deleteRoster);

// --- Devices and credentials ------------------------------------------------
router.get('/devices', authenticate, requireStaff, ent.listDevices);
router.post('/devices', authenticate, configure, ent.createDevice);
router.get('/devices/health', authenticate, requireStaff, ent.getDeviceHealth);
router.get('/devices/sync-logs', authenticate, requireStaff, ent.listSyncLogs);
router.get('/devices/enrollments', authenticate, requireStaff, ent.listEnrollments);
router.post('/devices/enrollments', authenticate, configure, ent.createEnrollment);
router.delete('/devices/enrollments/:id', authenticate, configure, ent.deleteEnrollment);
router.get('/devices/:id', authenticate, requireStaff, ent.getDevice);
router.put('/devices/:id', authenticate, configure, ent.updateDevice);
router.delete('/devices/:id', authenticate, requireRole('admin'), ent.deleteDevice);
router.post('/devices/:id/rotate-key', authenticate, requireRole('admin'), ent.rotateDeviceKey);
router.post('/devices/:id/pull', authenticate, configure, ent.pullDevice);
router.get('/devices/:id/qr', authenticate, requireStaff, ent.issueQr);

router.get('/geofences', authenticate, requireStaff, ent.listGeofences);
router.post('/geofences', authenticate, configure, ent.createGeofence);
router.post('/geofences/assign', authenticate, configure, ent.assignGeofence);
router.post('/geofences/unassign', authenticate, configure, ent.unassignGeofence);
router.put('/geofences/:id', authenticate, configure, ent.updateGeofence);
router.delete('/geofences/:id', authenticate, configure, ent.deleteGeofence);

router.get('/cards', authenticate, requireStaff, ent.listCards);
router.post('/cards', authenticate, configure, ent.createCard);
router.put('/cards/:id/status', authenticate, configure, ent.updateCardStatus);
router.delete('/cards/:id', authenticate, configure, ent.deleteCard);

router.get('/face-enrollments', authenticate, requireStaff, ent.listFaceEnrollments);
router.post('/face-enrollments', authenticate, configure, ent.enrollFace);

router.get('/ip-rules', authenticate, requireStaff, ent.listIpRules);
router.post('/ip-rules', authenticate, requireRole('admin'), ent.createIpRule);
router.delete('/ip-rules/:id', authenticate, requireRole('admin'), ent.deleteIpRule);

// --- Compliance -------------------------------------------------------------
router.get('/compliance/rules', authenticate, requireStaff, ent.listComplianceRules);
router.post('/compliance/rules', authenticate, configure, ent.createComplianceRule);
router.put('/compliance/rules/:id', authenticate, configure, ent.updateComplianceRule);
router.delete('/compliance/rules/:id', authenticate, requireRole('admin'), ent.deleteComplianceRule);
router.post('/compliance/scan', authenticate, operate, ent.runComplianceScan);
router.get('/compliance/violations', authenticate, requireStaff, ent.listViolations);
router.post('/compliance/violations/:id/resolve', authenticate, operate, ent.resolveViolation);
router.get('/compliance/summary', authenticate, requireStaff, ent.getComplianceSummary);

// --- Visitors ---------------------------------------------------------------
router.get('/visitors', authenticate, requireStaff, ent.listVisitors);
router.post('/visitors', authenticate, requireStaff, ent.createVisitor);
router.get('/visitors/board', authenticate, requireStaff, ent.getVisitorBoard);
router.get('/visitors/visits', authenticate, requireStaff, ent.listVisits);
router.post('/visitors/visits', authenticate, requireStaff, ent.createVisit);
router.post('/visitors/visits/:id/check-in', authenticate, requireStaff, ent.checkInVisit);
router.post('/visitors/visits/:id/check-out', authenticate, requireStaff, ent.checkOutVisit);
router.post('/visitors/visits/:id/status', authenticate, requireStaff, ent.setVisitStatus);
router.delete('/visitors/visits/:id', authenticate, configure, ent.deleteVisit);
router.put('/visitors/:id', authenticate, requireStaff, ent.updateVisitor);
router.delete('/visitors/:id', authenticate, configure, ent.deleteVisitor);

// --- Reports and audit -------------------------------------------------------
router.get('/reports', authenticate, requireStaff, ent.listReports);
router.get('/reports/:slug', authenticate, requireStaff, ent.runReport);
router.get('/audit', authenticate, requireStaff, ent.listAudit);

// ===========================================================================
// Parameterised existing route last, so none of the literal enterprise paths
// above are swallowed by /employee/:id or /:employeeId patterns.
// ===========================================================================
router.get('/employee/:id', authenticate, allowSelfOrStaff('id'), ctrl.getEmployeeAttendance);
router.get('/employee/:employeeId/day', authenticate, allowSelfOrStaff('employeeId'), ent.getDayDetail);

export default router;
