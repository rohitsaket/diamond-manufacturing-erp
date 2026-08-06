import { Router } from 'express';
import { InterviewController } from '../controllers/InterviewController';
import { OfferController } from '../controllers/OfferController';
import { CareerController } from '../controllers/CareerController';
import { RecruitmentAnalyticsController } from '../controllers/RecruitmentAnalyticsController';
import { authenticate, requireStaff, requireRole, allowSelfOrStaff } from '../middleware/auth';

/**
 * Hiring-flow routes for internal recruitment: interview rounds and feedback,
 * recorded assessments, internal offers with PDF letters and effecting,
 * career interests/dashboard, and recruitment analytics/reports.
 */
const router = Router();
const interviews = new InterviewController();
const offers = new OfferController();
const career = new CareerController();
const analytics = new RecruitmentAnalyticsController();

// ---------------------------------------------------------------------------
// Interviews (feedback is open to panel members; the service enforces it)
// ---------------------------------------------------------------------------
router.post('/interviews', authenticate, requireStaff, interviews.schedule);
router.post('/interviews/reminders', authenticate, requireStaff, interviews.sendReminders);
router.get('/interviews', authenticate, requireStaff, interviews.list);
router.get('/interviews/:id', authenticate, interviews.getById);
router.put('/interviews/:id/reschedule', authenticate, requireStaff, interviews.reschedule);
router.put('/interviews/:id/cancel', authenticate, requireStaff, interviews.cancel);
router.put('/interviews/:id/complete', authenticate, requireStaff, interviews.complete);
router.put('/interviews/:id/no-show', authenticate, requireStaff, interviews.noShow);
router.get('/interviews/:id/ics', authenticate, interviews.ics);
router.post('/interviews/:id/feedback', authenticate, interviews.submitFeedback);
router.get('/interviews/:id/feedback', authenticate, requireStaff, interviews.listFeedback);

// ---------------------------------------------------------------------------
// Assessments (recorded, not delivered online)
// ---------------------------------------------------------------------------
router.get('/assessments', authenticate, requireStaff, interviews.listAssessments);
router.post('/assessments', authenticate, requireRole('admin', 'hr'), interviews.createAssessment);
router.put('/assessments/:id', authenticate, requireRole('admin', 'hr'), interviews.updateAssessment);
router.post('/assessments/:id/assign', authenticate, requireStaff, interviews.assignAssessment);
router.put('/assessment-results/:id', authenticate, requireStaff, interviews.recordAssessmentResult);
router.get('/assessment-results', authenticate, requireStaff, interviews.listAssessmentResults);

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------
router.get('/me/offers', authenticate, offers.myOffers);
router.get('/offers', authenticate, requireStaff, offers.list);
router.post('/offers', authenticate, requireRole('admin', 'hr', 'manager'), offers.create);
router.get('/offers/:id', authenticate, requireStaff, offers.getById);
router.post('/offers/:id/submit', authenticate, requireRole('admin', 'hr', 'manager'), offers.submit);
router.post('/offers/:id/approve', authenticate, requireRole('admin', 'hr'), offers.approve);
router.post('/offers/:id/reject-approval', authenticate, requireRole('admin', 'hr'), offers.rejectApproval);
router.post('/offers/:id/release', authenticate, requireRole('admin', 'hr'), offers.release);
router.post('/offers/:id/withdraw', authenticate, requireRole('admin', 'hr'), offers.withdraw);
router.post('/offers/:id/accept', authenticate, offers.accept);
router.post('/offers/:id/decline', authenticate, offers.decline);
router.post('/offers/:id/letter', authenticate, requireRole('admin', 'hr'), offers.issueLetter);
router.get('/offers/:id/letter', authenticate, offers.downloadLetter);
router.post('/offers/:id/effect', authenticate, requireRole('admin', 'hr'), offers.effect);

// ---------------------------------------------------------------------------
// Career development
// ---------------------------------------------------------------------------
router.get('/career/me/dashboard', authenticate, career.myDashboard);
router.get('/career/roadmaps', authenticate, requireStaff, career.roadmaps);
router.get('/career/interests/:employeeId', authenticate, allowSelfOrStaff('employeeId'), career.getInterests);
router.put('/career/interests/:employeeId', authenticate, allowSelfOrStaff('employeeId'), career.saveInterests);

// ---------------------------------------------------------------------------
// Analytics, AI honesty stubs and reports
// ---------------------------------------------------------------------------
router.get('/analytics/dashboard', authenticate, requireStaff, analytics.dashboard);
router.get('/analytics/funnel', authenticate, requireStaff, analytics.funnel);
router.get('/analytics/departments', authenticate, requireStaff, analytics.departments);
router.get('/analytics/referrals', authenticate, requireStaff, analytics.referrals);
router.get('/analytics/cost-savings', authenticate, requireStaff, analytics.costSavings);
router.get('/ai/insights', authenticate, requireStaff, analytics.aiInsights);
router.get('/ai/rank-candidates', authenticate, requireStaff, analytics.aiInsights);
router.get('/reports/:type/export', authenticate, requireStaff, analytics.exportReport);
router.get('/reports/:type', authenticate, requireStaff, analytics.report);

export default router;
