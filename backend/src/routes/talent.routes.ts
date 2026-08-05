import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Router, Request } from 'express';
import { ReviewController } from '../controllers/ReviewController';
import { TalentController } from '../controllers/TalentController';
import { DevelopmentController } from '../controllers/DevelopmentController';
import { FeedbackController } from '../controllers/FeedbackController';
import { authenticate, requireStaff, requireRole, allowSelfOrStaff } from '../middleware/auth';
import { env } from '../config/env';

/**
 * Talent-side performance management routes: review templates, reviews/360,
 * competencies, appraisals, promotions, 9-box/pools/succession/calibration,
 * development plans, PIPs, feedback/recognition/rewards and reports.
 *
 * Mounted by the router index. Ordering rule: literal paths are declared
 * before their `/:id` siblings so `/reviews/launch` can never be swallowed by
 * `/reviews/:id`.
 */
const router = Router();
const reviewCtrl = new ReviewController();
const talentCtrl = new TalentController();
const devCtrl = new DevelopmentController();
const feedbackCtrl = new FeedbackController();

// --- Review attachment uploads (same disk-storage pattern as the documents
// module, kept under a perf-reviews subfolder of the shared uploads root) ----
const ATTACHMENT_SUBDIR = 'perf-reviews';
const ATTACHMENT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function sanitiseName(original: string): string {
  return path.basename(original).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}

const attachmentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      const dir = path.join(env.uploadDir, ATTACHMENT_SUBDIR);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err: any) {
      cb(err, '');
    }
  },
  filename: (req: Request, file, cb) => {
    cb(null, `review${req.params.id ?? 'x'}_${Date.now()}_${sanitiseName(file.originalname)}`);
  },
});

const attachmentUpload = multer({
  storage: attachmentStorage,
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ATTACHMENT_MIME.has(file.mimetype)) {
      cb(new Error('Only JPG, PNG, WebP and PDF files are allowed'));
      return;
    }
    cb(null, true);
  },
});

// ============================================================================
// Review templates (staff)
// ============================================================================
router.get('/review-templates', authenticate, requireStaff, reviewCtrl.listTemplates);
router.post('/review-templates', authenticate, requireStaff, reviewCtrl.createTemplate);
router.put('/review-templates/:id', authenticate, requireStaff, reviewCtrl.updateTemplate);

// ============================================================================
// Reviews & 360
// ============================================================================
router.get('/reviews', authenticate, requireStaff, reviewCtrl.listReviews);
router.post('/reviews', authenticate, requireStaff, reviewCtrl.createReview);
router.post('/reviews/launch', authenticate, requireStaff, reviewCtrl.launch);
// Attachment download is literal-first so /:id never captures "attachments".
router.get('/reviews/attachments/:id/download', authenticate, reviewCtrl.downloadAttachment);
router.get('/reviews/:id', authenticate, reviewCtrl.getReview);
router.post('/reviews/:id/request-peers', authenticate, requireStaff, reviewCtrl.requestPeers);
router.put('/reviews/:id/respond', authenticate, reviewCtrl.respond);
router.post('/reviews/:id/submit', authenticate, reviewCtrl.submit);
router.post('/reviews/:id/acknowledge', authenticate, reviewCtrl.acknowledge);
router.post('/reviews/:id/decline', authenticate, reviewCtrl.decline);
router.post('/reviews/:id/attachments', authenticate, attachmentUpload.single('file'), reviewCtrl.uploadAttachment);
router.get('/reviews/:id/attachments', authenticate, reviewCtrl.listAttachments);

router.get('/employees/:employeeId/360', authenticate, allowSelfOrStaff('employeeId'), reviewCtrl.get360);

// ============================================================================
// Competencies (staff writes)
// ============================================================================
router.get('/competencies', authenticate, reviewCtrl.listCompetencies);
router.post('/competencies', authenticate, requireStaff, reviewCtrl.createCompetency);
router.put('/competencies/:id', authenticate, requireStaff, reviewCtrl.updateCompetency);
router.get('/competency-ratings', authenticate, requireStaff, reviewCtrl.listCompetencyRatings);
router.post('/competency-ratings', authenticate, requireStaff, reviewCtrl.createCompetencyRating);
router.get('/skill-matrix', authenticate, requireStaff, reviewCtrl.skillMatrix);

// ============================================================================
// Appraisals (staff; ESS reads under /me)
// ============================================================================
router.post('/appraisals/generate', authenticate, requireStaff, talentCtrl.generateAppraisals);
router.get('/appraisals', authenticate, requireStaff, talentCtrl.listAppraisals);
router.get('/appraisals/:id', authenticate, requireStaff, talentCtrl.getAppraisal);
router.put('/appraisals/:id', authenticate, requireStaff, talentCtrl.updateAppraisal);
router.post('/appraisals/:id/finalize', authenticate, requireStaff, talentCtrl.finalizeAppraisal);
router.post('/appraisals/:id/letter', authenticate, requireStaff, talentCtrl.issueAppraisalLetter);
router.get('/appraisals/:id/letter', authenticate, requireStaff, talentCtrl.downloadAppraisalLetter);
router.post('/appraisals/:id/acknowledge', authenticate, talentCtrl.acknowledgeAppraisal);

// ============================================================================
// Promotions (staff; approve/reject restricted to admin/hr)
// ============================================================================
router.get('/promotions/eligibility', authenticate, requireStaff, talentCtrl.promotionEligibility);
router.get('/promotions', authenticate, requireStaff, talentCtrl.listPromotions);
router.post('/promotions', authenticate, requireStaff, talentCtrl.createPromotion);
router.put('/promotions/:id', authenticate, requireStaff, talentCtrl.updatePromotion);
router.post('/promotions/:id/submit', authenticate, requireStaff, talentCtrl.submitPromotion);
router.post('/promotions/:id/approve', authenticate, requireRole('admin', 'hr'), talentCtrl.approvePromotion);
router.post('/promotions/:id/reject', authenticate, requireRole('admin', 'hr'), talentCtrl.rejectPromotion);
router.post('/promotions/:id/effect', authenticate, requireRole('admin', 'hr'), talentCtrl.effectPromotion);
router.post('/promotions/:id/letter', authenticate, requireStaff, talentCtrl.issuePromotionLetter);
router.get('/promotions/:id/letter', authenticate, requireStaff, talentCtrl.downloadPromotionLetter);

// ============================================================================
// Talent: 9-box, pools (staff)
// ============================================================================
router.get('/talent/matrix', authenticate, requireStaff, talentCtrl.talentMatrix);
router.put('/talent/assessments', authenticate, requireStaff, talentCtrl.upsertAssessment);
router.get('/talent/pools', authenticate, requireStaff, talentCtrl.listPools);
router.post('/talent/pools', authenticate, requireStaff, talentCtrl.createPool);
// Member removal is literal-first so "/talent/pools/members/:id" is never
// parsed as a pool id.
router.delete('/talent/pools/members/:id', authenticate, requireStaff, talentCtrl.removePoolMember);
router.get('/talent/pools/:id', authenticate, requireStaff, talentCtrl.getPool);
router.put('/talent/pools/:id', authenticate, requireStaff, talentCtrl.updatePool);
router.post('/talent/pools/:id/members', authenticate, requireStaff, talentCtrl.addPoolMember);

// ============================================================================
// Succession (staff)
// ============================================================================
router.get('/succession/dashboard', authenticate, requireStaff, talentCtrl.successionDashboard);
router.get('/succession', authenticate, requireStaff, talentCtrl.listSuccession);
router.post('/succession', authenticate, requireStaff, talentCtrl.createSuccession);
router.put('/succession/candidates/:id', authenticate, requireStaff, talentCtrl.updateSuccessionCandidate);
router.delete('/succession/candidates/:id', authenticate, requireStaff, talentCtrl.removeSuccessionCandidate);
router.put('/succession/:id', authenticate, requireStaff, talentCtrl.updateSuccession);
router.post('/succession/:id/candidates', authenticate, requireStaff, talentCtrl.addSuccessionCandidate);

// ============================================================================
// Calibration (staff)
// ============================================================================
router.get('/calibration/sessions', authenticate, requireStaff, talentCtrl.listCalibrationSessions);
router.post('/calibration/sessions', authenticate, requireStaff, talentCtrl.createCalibrationSession);
router.put('/calibration/sessions/:id', authenticate, requireStaff, talentCtrl.updateCalibrationSession);
router.post('/calibration/sessions/:id/adjust', authenticate, requireStaff, talentCtrl.adjustCalibration);
router.post('/calibration/sessions/:id/complete', authenticate, requireStaff, talentCtrl.completeCalibrationSession);

// ============================================================================
// Development plans (staff; ESS under /me)
// ============================================================================
router.get('/development-plans', authenticate, requireStaff, devCtrl.listPlans);
router.post('/development-plans', authenticate, requireStaff, devCtrl.createPlan);
router.put('/development-plans/items/:id', authenticate, requireStaff, devCtrl.updatePlanItem);
router.delete('/development-plans/items/:id', authenticate, requireStaff, devCtrl.deletePlanItem);
router.get('/development-plans/:id', authenticate, requireStaff, devCtrl.getPlan);
router.put('/development-plans/:id', authenticate, requireStaff, devCtrl.updatePlan);
router.post('/development-plans/:id/items', authenticate, requireStaff, devCtrl.addPlanItem);

// ============================================================================
// PIPs -- confidential: admin/hr/manager only, never surfaced via ESS
// ============================================================================
const pipRoles = requireRole('admin', 'hr', 'manager');
router.get('/pips', authenticate, pipRoles, devCtrl.listPips);
router.post('/pips', authenticate, pipRoles, devCtrl.createPip);
router.put('/pips/objectives/:id', authenticate, pipRoles, devCtrl.updatePipObjective);
router.get('/pips/:id', authenticate, pipRoles, devCtrl.getPip);
router.put('/pips/:id', authenticate, pipRoles, devCtrl.updatePip);
router.post('/pips/:id/activate', authenticate, pipRoles, devCtrl.activatePip);
router.post('/pips/:id/reviews', authenticate, pipRoles, devCtrl.addPipReview);
router.post('/pips/:id/close', authenticate, pipRoles, devCtrl.closePip);
router.post('/pips/:id/extend', authenticate, pipRoles, devCtrl.extendPip);
router.post('/pips/:id/escalate', authenticate, pipRoles, devCtrl.escalatePip);

// ============================================================================
// Feedback & recognition
// ============================================================================
router.get('/feedback', authenticate, feedbackCtrl.listFeedback);
router.post('/feedback', authenticate, feedbackCtrl.createFeedback);
router.delete('/feedback/:id', authenticate, feedbackCtrl.deleteFeedback);

router.get('/recognitions', authenticate, requireStaff, feedbackCtrl.listRecognitions);
router.post('/recognitions', authenticate, requireStaff, feedbackCtrl.createRecognition);

router.get('/rewards/balance/:employeeId', authenticate, allowSelfOrStaff('employeeId'), feedbackCtrl.rewardBalance);
router.post('/rewards/redemptions', authenticate, feedbackCtrl.requestRedemption);
router.get('/rewards/redemptions', authenticate, requireStaff, feedbackCtrl.listRedemptions);
router.put('/rewards/redemptions/:id/decide', authenticate, requireStaff, feedbackCtrl.decideRedemption);
router.put('/rewards/redemptions/:id/fulfill', authenticate, requireStaff, feedbackCtrl.fulfillRedemption);

// ============================================================================
// ESS (/me)
// ============================================================================
router.get('/me/reviews', authenticate, reviewCtrl.myReviews);
router.get('/me/reviews/history', authenticate, reviewCtrl.myReviewHistory);
router.get('/me/appraisals', authenticate, talentCtrl.myAppraisals);
router.get('/me/appraisals/:id/letter', authenticate, talentCtrl.myAppraisalLetter);
router.get('/me/development-plan', authenticate, devCtrl.myPlan);
router.get('/me/feedback', authenticate, feedbackCtrl.myFeedback);
router.get('/me/recognitions', authenticate, feedbackCtrl.myRecognitions);
router.get('/me/rewards', authenticate, feedbackCtrl.myRewards);

// ============================================================================
// Reports (staff; the PIP report is further restricted in the controller)
// ============================================================================
router.get('/reports/:type/export', authenticate, requireStaff, talentCtrl.reportExport);
router.get('/reports/:type', authenticate, requireStaff, talentCtrl.report);

export default router;
