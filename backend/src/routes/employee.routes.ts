import { Router } from 'express';
import { EmployeeController } from '../controllers/EmployeeController';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new EmployeeController();

router.get('/', authenticate, ctrl.findAll);
router.get('/:id', authenticate, ctrl.findById);
router.get('/:id/lots', authenticate, ctrl.getLots);

export default router;
