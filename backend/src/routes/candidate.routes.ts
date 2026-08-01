import { Router } from 'express';
import { CandidateController } from '../controllers/CandidateController';
import { authenticate, requireRole, requireStaff } from '../middleware/auth';

const router = Router();
const ctrl = new CandidateController();

// Job openings (declared before /:id so the literal path wins)
router.get('/openings', authenticate, requireStaff, ctrl.listOpenings);
router.post('/openings', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.createOpening);
router.put('/openings/:id', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.updateOpening);
router.put('/openings/:id/close', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.closeOpening);

// Candidate pipeline
router.get('/', authenticate, requireStaff, ctrl.list);
router.get('/:id', authenticate, requireStaff, ctrl.getById);
router.post('/', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.create);
router.put('/:id', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.update);
router.put('/:id/status', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.updateStatus);
router.post('/:id/convert', authenticate, requireRole('admin', 'hr'), ctrl.convert);
router.delete('/:id', authenticate, requireRole('admin'), ctrl.remove);

export default router;
