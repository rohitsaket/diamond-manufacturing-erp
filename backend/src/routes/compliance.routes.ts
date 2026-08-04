import { Router } from 'express';
import { ComplianceController } from '../controllers/ComplianceController';
import { authenticate, requireStaff, requireRole, allowSelfOrStaff } from '../middleware/auth';

const router = Router();
const ctrl = new ComplianceController();

/** Anyone allowed to change compliance data: file, close, waive, review. */
const manage = requireRole('admin', 'accountant', 'hr');

// Every route below needs a session.
router.use(authenticate);

// ---------------------------------------------------------------------------
// Self service. Declared first so `/me/...` can never be swallowed by a
// parameterised path further down.
// ---------------------------------------------------------------------------
router.get('/me/tax-summary/:fy', ctrl.getMyTaxSummary);
router.get('/me/proofs', ctrl.getMyProofs);
router.post('/me/proofs', ctrl.submitMyProof);
router.get('/me/hra/:fy', ctrl.getMyHra);
router.put('/me/hra/:fy', ctrl.saveMyHra);
router.get('/me/regime-comparison/:fy', ctrl.getMyRegimeComparison);

// ---------------------------------------------------------------------------
// Dashboard, analytics and score
// ---------------------------------------------------------------------------
router.get('/dashboard', requireStaff, ctrl.getDashboard);
router.get('/analytics/tax', requireStaff, ctrl.getTaxAnalytics);
router.get('/analytics/contributions', requireStaff, ctrl.getContributionTrends);
router.get('/analytics/filing-status', requireStaff, ctrl.getFilingStatusAnalytics);
router.get('/analytics/forecast', requireStaff, ctrl.getForecast);
router.get('/score', requireStaff, ctrl.getScore);

// ---------------------------------------------------------------------------
// Calendar. Literal paths before `/:id`.
// ---------------------------------------------------------------------------
router.get('/calendar', requireStaff, ctrl.getCalendar);
router.get('/calendar/upcoming', requireStaff, ctrl.getUpcoming);
router.get('/calendar/overdue', requireStaff, ctrl.getOverdue);
router.post('/calendar/generate', manage, ctrl.generateCalendar);
router.post('/calendar/refresh', manage, ctrl.refreshCalendar);
router.post('/calendar/reminders', manage, ctrl.sendCalendarReminders);
router.put('/calendar/:id/complete', manage, ctrl.completeCalendarEntry);
router.put('/calendar/:id/not-applicable', manage, ctrl.markCalendarNotApplicable);
router.put('/calendar/:id/waive', manage, ctrl.waiveCalendarEntry);
router.put('/calendar/:id/extend', manage, ctrl.extendCalendarEntry);
router.put('/calendar/:id/assign', manage, ctrl.assignCalendarEntry);

// ---------------------------------------------------------------------------
// Obligations
// ---------------------------------------------------------------------------
router.get('/obligations', requireStaff, ctrl.listObligations);
router.post('/obligations', manage, ctrl.createObligation);
router.put('/obligations/:id', manage, ctrl.updateObligation);
router.delete('/obligations/:id', requireRole('admin'), ctrl.deleteObligation);

// ---------------------------------------------------------------------------
// Automated checks
// ---------------------------------------------------------------------------
router.post('/checks/run', manage, ctrl.runChecks);
router.get('/checks/results', requireStaff, ctrl.getCheckResults);
router.get('/checks/items', requireStaff, ctrl.listChecklistItems);
router.post('/checks/items', manage, ctrl.createChecklistItem);
router.put('/checks/items/:id', manage, ctrl.updateChecklistItem);
router.post('/checks/raise-findings', manage, ctrl.raiseFindings);

// ---------------------------------------------------------------------------
// Audits
// ---------------------------------------------------------------------------
router.get('/audits', requireStaff, ctrl.listAudits);
router.post('/audits', manage, ctrl.createAudit);
router.get('/audits/:id', requireStaff, ctrl.getAudit);
router.put('/audits/:id', manage, ctrl.updateAudit);
router.put('/audits/:id/close', manage, ctrl.closeAudit);
router.delete('/audits/:id', requireRole('admin'), ctrl.deleteAudit);

// ---------------------------------------------------------------------------
// Findings and corrective actions
// ---------------------------------------------------------------------------
router.get('/findings', requireStaff, ctrl.listFindings);
router.get('/findings/summary', requireStaff, ctrl.getFindingsSummary);
router.post('/findings', manage, ctrl.createFinding);
router.get('/findings/:id', requireStaff, ctrl.getFinding);
router.put('/findings/:id', manage, ctrl.updateFinding);
router.put('/findings/:id/close', manage, ctrl.closeFinding);
router.get('/findings/:id/actions', requireStaff, ctrl.listActions);
router.post('/findings/:id/actions', manage, ctrl.createAction);
router.put('/actions/:id', manage, ctrl.updateAction);

// ---------------------------------------------------------------------------
// Investment proofs
// ---------------------------------------------------------------------------
router.get('/proofs', requireStaff, ctrl.listProofs);
router.get('/proofs/pending-summary', requireStaff, ctrl.getProofPendingSummary);
router.put('/proofs/bulk-review', manage, ctrl.bulkReviewProofs);
router.put('/proofs/:id/review', manage, ctrl.reviewProof);

// ---------------------------------------------------------------------------
// HRA (employee scoped)
// ---------------------------------------------------------------------------
router.get('/hra/:employeeId/:fy/exemption', allowSelfOrStaff('employeeId'), ctrl.getHraExemption);
router.get('/hra/:employeeId/:fy', allowSelfOrStaff('employeeId'), ctrl.getHra);
router.put('/hra/:employeeId/:fy', allowSelfOrStaff('employeeId'), ctrl.saveHra);

// ---------------------------------------------------------------------------
// Tax calculator
// ---------------------------------------------------------------------------
router.post('/calculator', requireStaff, ctrl.calculate);
router.get('/calculator/compare/:employeeId/:fy', allowSelfOrStaff('employeeId'), ctrl.compareRegimes);
router.get('/calculator/take-home/:employeeId/:fy', allowSelfOrStaff('employeeId'), ctrl.getTakeHome);

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
router.get('/reports/:type/export', requireStaff, ctrl.exportReport);
router.get('/reports/:type', requireStaff, ctrl.getReport);

export default router;
