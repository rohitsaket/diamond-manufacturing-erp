import { Router } from 'express';
import { DocumentController } from '../controllers/DocumentController';
import { authenticate, requireStaff, requireRole, allowSelfOrStaff } from '../middleware/auth';
import { upload } from '../middleware/upload';

/**
 * Document management routes. Mounted at `/documents` by the router index.
 *
 * Ordering rule: every literal path is declared before the `/:id` family, so
 * `/search`, `/types`, `/reports/...` and friends can never be swallowed by the
 * id parameter. `/shared/:token` is declared first and intentionally carries no
 * `authenticate` — a share link that required a login would not be a share link.
 */
const router = Router();
const ctrl = new DocumentController();

// --- Public share links -----------------------------------------------------
router.get('/shared/:token', ctrl.sharedDownload);

// --- Document types ---------------------------------------------------------
router.get('/types', authenticate, ctrl.listTypes);
router.post('/types', authenticate, requireRole('admin', 'hr'), ctrl.createType);
router.put('/types/:typeId', authenticate, requireRole('admin', 'hr'), ctrl.updateType);
router.delete('/types/:typeId', authenticate, requireRole('admin'), ctrl.deleteType);

// --- Requirements -----------------------------------------------------------
router.get('/requirements', authenticate, ctrl.listRequirements);
router.post('/requirements', authenticate, requireRole('admin', 'hr'), ctrl.createRequirement);
router.delete('/requirements/:reqId', authenticate, requireRole('admin', 'hr'), ctrl.deleteRequirement);

// --- Search, dashboard, storage ---------------------------------------------
router.get('/search', authenticate, requireStaff, ctrl.search);
router.get('/dashboard', authenticate, requireStaff, ctrl.dashboard);
router.get('/storage-drivers', authenticate, requireRole('admin'), ctrl.storageDrivers);

// --- Reports (add ?format=csv for a download) -------------------------------
router.get('/reports/:report', authenticate, requireStaff, ctrl.report);

// --- Compliance -------------------------------------------------------------
router.get('/compliance', authenticate, requireStaff, ctrl.compliance);
router.get('/compliance/:employeeId', authenticate, allowSelfOrStaff('employeeId'), ctrl.complianceForEmployee);
router.get('/missing/:employeeId', authenticate, allowSelfOrStaff('employeeId'), ctrl.missingForEmployee);

// --- Bulk actions -----------------------------------------------------------
router.post('/bulk/:action', authenticate, requireRole('admin', 'hr'), ctrl.bulk);

// --- Scheduled maintenance (safe to call repeatedly; reminders are idempotent per day)
router.post('/maintenance/expire', authenticate, requireRole('admin', 'hr'), ctrl.runExpirySweep);
router.post('/maintenance/expiry-reminders', authenticate, requireRole('admin', 'hr'), ctrl.runExpiryReminders);

// --- Share administration (literal, before /:id) ----------------------------
router.delete('/shares/:shareId', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.revokeShare);

// --- Employee-scoped --------------------------------------------------------
router.post(
  '/employee/:employeeId',
  authenticate,
  requireRole('admin', 'hr', 'manager'),
  upload.single('file'),
  ctrl.upload,
);
router.get('/employee/:employeeId', authenticate, allowSelfOrStaff('employeeId'), ctrl.listForEmployee);

// --- Single document: reads -------------------------------------------------
router.get('/:id', authenticate, ctrl.getOne);
router.get('/:id/versions', authenticate, ctrl.versions);
router.get('/:id/audit', authenticate, requireStaff, ctrl.audit);
router.get('/:id/comments', authenticate, ctrl.listComments);
router.get('/:id/shares', authenticate, requireStaff, ctrl.listShares);
router.get('/:id/download', authenticate, ctrl.download);
router.get('/:id/print', authenticate, ctrl.print);

// --- Single document: creates ------------------------------------------------
router.post('/:id/replace', authenticate, requireRole('admin', 'hr', 'manager'), upload.single('file'), ctrl.replace);
router.post('/:id/comments', authenticate, ctrl.addComment);
router.post('/:id/integrity', authenticate, requireStaff, ctrl.integrity);
router.post('/:id/share', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.createShare);

// Honest 501s: the columns and hooks exist, the engines do not.
router.post('/:id/ocr', authenticate, requireRole('admin', 'hr'), ctrl.ocr);
router.post('/:id/scan', authenticate, requireRole('admin', 'hr'), ctrl.scan);

// --- Single document: updates ------------------------------------------------
router.put('/:id/submit', authenticate, ctrl.submit);
router.put('/:id/review', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.review);
router.put('/:id/verify', authenticate, requireRole('admin', 'hr'), ctrl.verify);
router.put('/:id/approve', authenticate, requireRole('admin', 'hr'), ctrl.approve);
router.put('/:id/reject', authenticate, requireRole('admin', 'hr'), ctrl.reject);
router.put('/:id/archive', authenticate, requireRole('admin', 'hr'), ctrl.archive);
router.put('/:id/lock', authenticate, requireRole('admin', 'hr'), ctrl.lock);
router.put('/:id/unlock', authenticate, requireRole('admin', 'hr'), ctrl.unlock);
router.put('/:id/restore-version', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.restoreVersion);
router.put('/:id/restore', authenticate, requireRole('admin', 'hr'), ctrl.restore);
router.put('/:id', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.updateMetadata);

// --- Single document: delete -------------------------------------------------
router.delete('/:id', authenticate, requireRole('admin', 'hr'), ctrl.remove);

export default router;
