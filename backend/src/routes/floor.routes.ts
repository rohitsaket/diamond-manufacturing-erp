import { Router } from 'express';
import { FloorController } from '../controllers/FloorController';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new FloorController();

router.get('/lots', authenticate, ctrl.getLots);
router.get('/exceptions', authenticate, ctrl.getExceptions);
router.get('/workers', authenticate, ctrl.getWorkers);
router.get('/labour-heads', authenticate, ctrl.getLabourHeads);
router.get('/shapes', authenticate, ctrl.getShapes);
router.get('/max-lot-id', authenticate, ctrl.getMaxLotId);
router.post('/lots', authenticate, ctrl.issueLot);
router.put('/lots/:id/receive', authenticate, ctrl.receiveLot);
router.put('/lots/:id/verify', authenticate, ctrl.verifyLot);

export default router;
