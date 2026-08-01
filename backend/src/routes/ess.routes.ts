import { Router } from 'express';
import { EssController } from '../controllers/EssController';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();
const ctrl = new EssController();

// Self-service (any authenticated account)
router.get('/me', authenticate, ctrl.me);
router.put('/me/password', authenticate, ctrl.changePassword);
router.put('/me/theme', authenticate, ctrl.setTheme);

// Account administration
router.post('/employees/bulk-login', authenticate, requireRole('admin', 'hr'), ctrl.bulkProvision);
router.post('/employees/:id/login', authenticate, requireRole('admin', 'hr'), ctrl.provisionLogin);
router.delete('/employees/:id/login', authenticate, requireRole('admin', 'hr'), ctrl.revokeLogin);

export default router;
