import { Router } from 'express';
import { ExitProcessController } from '../controllers/ExitProcessController';
import { SeparationController } from '../controllers/SeparationController';
import { authenticate, requireEmployeeSelf, requireRole, requireStaff } from '../middleware/auth';

/**
 * Offboarding: the separation lifecycle and every exit-process leg behind it.
 * ESS routes live under /me; staff routes are gated by requireStaff or a
 * tighter requireRole where the action changes someone's employment record.
 * The sibling exit-services router owns settlements, letters, alumni and
 * analytics.
 */
const router = Router();
const separations = new SeparationController();
const process = new ExitProcessController();

router.use(authenticate);

// ===========================================================================
// ESS self-service
// ===========================================================================
router.post('/me/resignation', requireEmployeeSelf, separations.createMyResignation);
router.put('/me/resignation/submit', requireEmployeeSelf, separations.submitMyResignation);
router.put('/me/resignation/withdraw', requireEmployeeSelf, separations.withdrawMyResignation);
router.get('/me/case', requireEmployeeSelf, separations.getMyCase);
router.post('/me/survey', requireEmployeeSelf, process.submitMySurvey);

// ===========================================================================
// Separations (staff)
// ===========================================================================
router.get('/separations', requireStaff, separations.list);
router.get('/separations/:id', requireStaff, separations.get);
router.post('/separations', requireStaff, separations.create);
router.put('/separations/:id', requireStaff, separations.update);

router.put('/separations/:id/manager-review', requireRole('admin', 'manager', 'hr'), separations.managerReview);
router.put('/separations/:id/hr-review', requireRole('admin', 'hr'), separations.hrReview);
router.post('/separations/:id/approve', requireRole('admin', 'hr'), separations.approve);
router.post('/separations/:id/reject', requireRole('admin', 'hr'), separations.reject);
router.post('/separations/:id/cancel', requireRole('admin', 'hr'), separations.cancel);

// Notice management. Early release requests may also come from the employee
// on their own case, so that one stays at plain authenticate.
router.put('/separations/:id/notice', requireRole('admin', 'hr'), separations.updateNotice);
router.post('/separations/:id/early-release', separations.requestEarlyRelease);
router.put('/separations/:id/early-release/decide', requireRole('admin', 'hr'), separations.decideEarlyRelease);
router.post('/separations/:id/buyout', requireRole('admin', 'hr'), separations.buyout);
router.post('/separations/:id/waive-notice', requireRole('admin', 'hr'), separations.waiveNotice);
router.post('/separations/:id/garden-leave', requireRole('admin', 'hr'), separations.gardenLeave);

router.post('/separations/:id/complete', requireRole('admin', 'hr'), separations.complete);
router.put('/separations/:id/rehire-flag', requireRole('admin', 'hr'), separations.setRehireFlag);

// ===========================================================================
// Notice rules and audit trail
// ===========================================================================
router.get('/notice-rules', requireStaff, separations.listNoticeRules);
router.post('/notice-rules', requireRole('admin', 'hr'), separations.createNoticeRule);
router.put('/notice-rules/:id', requireRole('admin', 'hr'), separations.updateNoticeRule);
router.get('/audit-logs', requireStaff, separations.listAuditLogs);

// ===========================================================================
// Exit interviews and survey
// ===========================================================================
router.get('/interviews', requireStaff, process.listInterviews);
router.put('/interviews/:id/schedule', requireStaff, process.scheduleInterview);
router.put('/interviews/:id/complete', requireStaff, process.completeInterview);
router.put('/interviews/:id/cancel', requireStaff, process.cancelInterview);

router.get('/survey/questions', process.listSurveyQuestions);
router.post('/survey/questions', requireRole('admin', 'hr'), process.createSurveyQuestion);
router.put('/survey/questions/:id', requireRole('admin', 'hr'), process.updateSurveyQuestion);
router.get('/survey/results', requireStaff, process.surveyResults);

// ===========================================================================
// Clearances
// ===========================================================================
router.get('/clearances', requireStaff, process.listClearances);
router.put('/clearances/:id', requireStaff, process.updateClearance);
router.post('/clearances/:id/tasks', requireStaff, process.addClearanceTask);
router.put('/clearance-tasks/:id', requireStaff, process.updateClearanceTask);

// ===========================================================================
// Asset returns, knowledge transfer, access revocations
// ===========================================================================
router.get('/asset-returns', requireStaff, process.listAssetReturns);
router.put('/asset-returns/:id', requireStaff, process.verifyAssetReturn);

router.get('/kt/:separationId', requireStaff, process.getKtPlan);
router.put('/kt/items/:id', requireStaff, process.updateKtItem);
router.delete('/kt/items/:id', requireStaff, process.deleteKtItem);
router.put('/kt/:planId', requireStaff, process.updateKtPlan);
router.post('/kt/:planId/items', requireStaff, process.addKtItem);
router.post('/kt/:planId/approve', requireRole('admin', 'hr', 'manager'), process.approveKtPlan);

router.get('/access-revocations', requireStaff, process.listAccessRevocations);
router.put('/access-revocations/:id', requireStaff, process.updateAccessRevocation);

// ===========================================================================
// Reminders
// ===========================================================================
router.post('/reminders', requireStaff, process.sendReminders);

export default router;
