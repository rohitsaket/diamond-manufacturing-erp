import { Router } from 'express';
import { PayrollController } from '../controllers/PayrollController';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();
const ctrl = new PayrollController();

router.get('/periods', authenticate, ctrl.getPeriods);
router.post('/periods', authenticate, ctrl.createPeriod);
router.get('/periods/:id/lines', authenticate, ctrl.getPeriodLines);
router.put('/periods/:id/lock', authenticate, requireRole('admin', 'manager'), ctrl.lockPeriod);
router.put('/periods/:id/pay', authenticate, requireRole('admin', 'accountant'), ctrl.markPaid);
router.put('/lines/:id/manager-verify', authenticate, requireRole('admin', 'manager'), ctrl.managerVerify);
router.put('/lines/:id/account-verify', authenticate, requireRole('admin', 'accountant'), ctrl.accountVerify);
router.get('/periods/:id/export', authenticate, ctrl.exportCsv);

export default router;
