import { Router } from 'express';
import { AdvanceController } from '../controllers/AdvanceController';
import { authenticate, requireStaff, requireRole } from '../middleware/auth';

const router = Router();
const ctrl = new AdvanceController();

// Registered before '/:id' so the literal path is not swallowed by the param.
router.get('/me', authenticate, ctrl.myAdvances);

router.get('/', authenticate, requireStaff, ctrl.list);
router.post('/', authenticate, requireRole('admin', 'accountant', 'hr'), ctrl.create);

router.get('/:id', authenticate, requireStaff, ctrl.getById);
router.get('/:id/schedule', authenticate, requireStaff, ctrl.getSchedule);
router.put('/:id/close', authenticate, requireRole('admin', 'accountant'), ctrl.close);
router.put('/:id/write-off', authenticate, requireRole('admin', 'accountant'), ctrl.writeOff);
router.post('/:id/recoveries', authenticate, requireRole('admin', 'accountant'), ctrl.addRecovery);

export default router;
