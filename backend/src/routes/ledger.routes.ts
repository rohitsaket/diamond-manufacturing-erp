import { Router } from 'express';
import { LedgerController } from '../controllers/LedgerController';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new LedgerController();

router.get('/lots', authenticate, ctrl.getLots);
router.get('/export', authenticate, ctrl.exportCsv);

export default router;
