import { Router } from 'express';
import { RateCardController } from '../controllers/RateCardController';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new RateCardController();

router.get('/', authenticate, ctrl.getAll);
router.get('/audit-logs', authenticate, ctrl.getAuditLogs);
router.get('/impact', authenticate, ctrl.computeImpact);
router.get('/latest-effective', authenticate, ctrl.getLatestEffectiveDate);
router.put('/:id', authenticate, ctrl.updateRate);
router.post('/new-version', authenticate, ctrl.newVersion);

export default router;
