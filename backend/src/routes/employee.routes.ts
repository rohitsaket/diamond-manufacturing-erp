import { Router } from 'express';
import { EmployeeController } from '../controllers/EmployeeController';
import { authenticate, requireStaff, requireRole, allowSelfOrStaff } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();
const ctrl = new EmployeeController();

router.get('/', authenticate, requireStaff, ctrl.findAll);
router.post('/', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.create);

// Documents are addressed by document id, so these must be declared before '/:id'.
// Literal paths must be declared before '/:id' or the param route swallows them.
router.get('/directory', authenticate, requireStaff, ctrl.getDirectory);

router.get('/documents/:docId/download', authenticate, ctrl.downloadDocument);
router.put('/documents/:docId/verify', authenticate, requireRole('admin', 'hr'), ctrl.verifyDocument);
router.delete('/documents/:docId', authenticate, requireRole('admin', 'hr'), ctrl.deleteDocument);

router.get('/:id', authenticate, requireStaff, ctrl.findById);
router.get('/:id/lots', authenticate, requireStaff, ctrl.getLots);
router.get('/:id/profile', authenticate, allowSelfOrStaff('id'), ctrl.getProfile);
router.put('/:id/profile', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.updateProfile);
router.put('/:id/resign', authenticate, requireRole('admin', 'hr'), ctrl.markResigned);

// Extended profile reads
router.get('/:id/profile/full', authenticate, allowSelfOrStaff('id'), ctrl.getFullProfile);
router.get('/:id/employment', authenticate, allowSelfOrStaff('id'), ctrl.getEmploymentDetails);
router.get('/:id/organization', authenticate, allowSelfOrStaff('id'), ctrl.getOrganizationDetails);
router.get('/:id/completeness', authenticate, allowSelfOrStaff('id'), ctrl.getCompleteness);

router.post(
  '/:id/photo',
  authenticate,
  requireRole('admin', 'hr', 'manager'),
  upload.single('file'),
  ctrl.uploadPhoto,
);

router.get('/:id/documents', authenticate, allowSelfOrStaff('id'), ctrl.listDocuments);
router.post(
  '/:id/documents',
  authenticate,
  requireRole('admin', 'hr', 'manager'),
  upload.single('file'),
  ctrl.uploadDocument,
);

export default router;
