import { Router } from 'express';
import { LedgerController } from '../controllers/LedgerController';
import { authenticate, requireStaff } from '../middleware/auth';

const router = Router();
const ctrl = new LedgerController();

router.get('/lots', authenticate, requireStaff, ctrl.getLots);
router.get('/export', authenticate, requireStaff, ctrl.exportCsv);

export default router;
