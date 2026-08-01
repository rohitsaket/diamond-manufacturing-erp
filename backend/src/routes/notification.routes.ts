import { Router } from 'express';
import { NotificationController } from '../controllers/NotificationController';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new NotificationController();

router.get('/', authenticate, ctrl.list);
router.get('/unread-count', authenticate, ctrl.unreadCount);
router.put('/read-all', authenticate, ctrl.markAllRead);
router.put('/:id/read', authenticate, ctrl.markRead);
router.put('/:id/archive', authenticate, ctrl.archive);
router.put('/:id/snooze', authenticate, ctrl.snooze);

export default router;
