import { Router } from 'express';
import { FloorController } from '../controllers/FloorController';
import { authenticate, requireStaff } from '../middleware/auth';

const router = Router();
const ctrl = new FloorController();

router.get('/lots', authenticate, requireStaff, ctrl.getLots);
router.get('/exceptions', authenticate, requireStaff, ctrl.getExceptions);
router.get('/workers', authenticate, requireStaff, ctrl.getWorkers);
router.get('/labour-heads', authenticate, requireStaff, ctrl.getLabourHeads);
router.get('/shapes', authenticate, requireStaff, ctrl.getShapes);
router.get('/max-lot-id', authenticate, requireStaff, ctrl.getMaxLotId);
router.post('/lots', authenticate, requireStaff, ctrl.issueLot);
router.put('/lots/:id/receive', authenticate, requireStaff, ctrl.receiveLot);
router.put('/lots/:id/verify', authenticate, requireStaff, ctrl.verifyLot);

export default router;
