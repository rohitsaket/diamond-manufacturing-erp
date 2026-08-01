import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new AuthController();

router.post('/login', ctrl.login);
router.get('/me', authenticate, ctrl.me);

export default router;
