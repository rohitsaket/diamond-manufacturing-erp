import { Router } from 'express';
import { RateCardController } from '../controllers/RateCardController';
import { authenticate, requireStaff } from '../middleware/auth';

const router = Router();
const ctrl = new RateCardController();

router.get('/', authenticate, requireStaff, ctrl.getAll);
router.get('/audit-logs', authenticate, requireStaff, ctrl.getAuditLogs);
router.get('/impact', authenticate, requireStaff, ctrl.computeImpact);
router.get('/latest-effective', authenticate, requireStaff, ctrl.getLatestEffectiveDate);
router.put('/:id', authenticate, requireStaff, ctrl.updateRate);
router.post('/new-version', authenticate, requireStaff, ctrl.newVersion);

export default router;
