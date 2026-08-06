import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Router, Request } from 'express';
import { InternalJobController } from '../controllers/InternalJobController';
import { InternalApplicationController } from '../controllers/InternalApplicationController';
import { authenticate, requireStaff, requireRole } from '../middleware/auth';
import { env } from '../config/env';

/**
 * Internal recruitment portal and pipeline routes: requisitions, internal job
 * postings and templates, the employee-facing portal (browse, save, apply,
 * referrals) and the staff application pipeline.
 */
const router = Router();
const jobs = new InternalJobController();
const applications = new InternalApplicationController();

const DOCUMENT_SUBDIR = 'internal-apps';

function sanitiseName(original: string): string {
  return path.basename(original).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}

const documentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      const dir = path.join(env.uploadDir, DOCUMENT_SUBDIR);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err: any) {
      cb(err, '');
    }
  },
  filename: (req: Request, file, cb) => {
    cb(null, `app${req.params.id ?? 'x'}_${Date.now()}_${sanitiseName(file.originalname)}`);
  },
});
const upload = multer({ storage: documentStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// ---------------------------------------------------------------------------
// Requisitions
// ---------------------------------------------------------------------------
router.get('/requisitions', authenticate, requireStaff, jobs.listRequisitions);
router.get('/requisitions/vacancies', authenticate, requireStaff, jobs.requisitionVacancies);
router.get('/requisitions/:id', authenticate, requireStaff, jobs.getRequisition);
router.post('/requisitions', authenticate, requireRole('admin', 'hr', 'manager'), jobs.createRequisition);
router.put('/requisitions/:id', authenticate, requireRole('admin', 'hr', 'manager'), jobs.updateRequisition);
router.post('/requisitions/:id/submit', authenticate, requireRole('admin', 'hr', 'manager'), jobs.submitRequisition);
router.post('/requisitions/:id/approve', authenticate, requireRole('admin', 'hr'), jobs.approveRequisition);
router.post('/requisitions/:id/reject', authenticate, requireRole('admin', 'hr'), jobs.rejectRequisition);
router.post('/requisitions/:id/cancel', authenticate, requireRole('admin', 'hr', 'manager'), jobs.cancelRequisition);
router.put('/requisitions/:id/budget-approve', authenticate, requireRole('admin', 'hr', 'accountant'), jobs.budgetApproveRequisition);

// ---------------------------------------------------------------------------
// Job postings and templates (staff management)
// ---------------------------------------------------------------------------
router.get('/jobs', authenticate, requireStaff, jobs.listJobs);
router.post('/jobs', authenticate, requireRole('admin', 'hr', 'manager'), jobs.createJob);
router.get('/job-templates', authenticate, requireStaff, jobs.listTemplates);
router.post('/job-templates', authenticate, requireRole('admin', 'hr'), jobs.createTemplate);
router.put('/job-templates/:id', authenticate, requireRole('admin', 'hr'), jobs.updateTemplate);
router.post('/jobs/from-template', authenticate, requireRole('admin', 'hr', 'manager'), jobs.createJobFromTemplate);
router.get('/jobs/:id', authenticate, requireStaff, jobs.getJob);
router.put('/jobs/:id', authenticate, requireRole('admin', 'hr', 'manager'), jobs.updateJob);
router.post('/jobs/:id/submit', authenticate, requireRole('admin', 'hr', 'manager'), jobs.submitJob);
router.post('/jobs/:id/approve', authenticate, requireRole('admin', 'hr'), jobs.approveJob);
router.post('/jobs/:id/publish', authenticate, requireRole('admin', 'hr'), jobs.publishJob);
router.post('/jobs/:id/pause', authenticate, requireRole('admin', 'hr'), jobs.pauseJob);
router.post('/jobs/:id/resume', authenticate, requireRole('admin', 'hr'), jobs.resumeJob);
router.post('/jobs/:id/archive', authenticate, requireRole('admin', 'hr'), jobs.archiveJob);
router.post('/jobs/:id/cancel', authenticate, requireRole('admin', 'hr'), jobs.cancelJob);
router.post('/jobs/:id/fill', authenticate, requireRole('admin', 'hr'), jobs.fillJob);

// ---------------------------------------------------------------------------
// Portal (employee-facing; controllers enforce the employee link)
// ---------------------------------------------------------------------------
router.get('/portal/jobs', authenticate, jobs.portalJobs);
router.get('/portal/featured', authenticate, jobs.portalFeatured);
router.get('/portal/recent', authenticate, jobs.portalRecent);
router.get('/portal/recommended', authenticate, jobs.portalRecommended);
router.get('/portal/saved', authenticate, jobs.listSaved);
router.get('/portal/jobs/:id', authenticate, jobs.portalJobDetail);
router.post('/portal/jobs/:id/save', authenticate, jobs.saveJob);
router.delete('/portal/jobs/:id/save', authenticate, jobs.unsaveJob);
router.post('/portal/jobs/:id/apply', authenticate, applications.apply);
router.put('/portal/applications/:id/submit', authenticate, applications.submitDraft);
router.put('/portal/applications/:id/withdraw', authenticate, applications.withdraw);
router.get('/portal/my-applications', authenticate, applications.myApplications);
router.get('/portal/my-referrals', authenticate, applications.myReferrals);

// ---------------------------------------------------------------------------
// Staff application pipeline
// ---------------------------------------------------------------------------
router.get('/applications', authenticate, requireStaff, applications.listApplications);
router.get('/applications/:id', authenticate, requireStaff, applications.getApplication);
router.put('/applications/:id/status', authenticate, requireStaff, applications.updateStatus);
router.put('/applications/:id/override', authenticate, requireRole('admin', 'hr'), applications.override);
router.post('/applications/:id/documents', authenticate, upload.single('file'), applications.uploadDocument);
router.get('/applications/:id/documents', authenticate, requireStaff, applications.listDocuments);
router.get('/application-documents/:id/download', authenticate, applications.downloadDocument);

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------
router.post('/referrals', authenticate, applications.createReferral);
router.get('/referrals/leaderboard', authenticate, requireStaff, applications.referralLeaderboard);
router.get('/referrals', authenticate, requireStaff, applications.listReferrals);
router.put('/referrals/:id/review', authenticate, requireRole('admin', 'hr'), applications.reviewReferral);

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
router.get('/audit-logs', authenticate, requireStaff, jobs.listAuditLogs);

export default router;
