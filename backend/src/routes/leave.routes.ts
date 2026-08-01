import { Router } from 'express';
import { LeaveController } from '../controllers/LeaveController';
import { authenticate, requireStaff, requireRole } from '../middleware/auth';

const router = Router();
const ctrl = new LeaveController();

// --- Self-service (registered first so /me never collides with /:id) ---------
router.get('/me/requests', authenticate, ctrl.myRequests);
router.get('/me/balances', authenticate, ctrl.myBalances);
router.post('/me/requests', authenticate, ctrl.createMyRequest);

// --- Leave types ------------------------------------------------------------
router.get('/types', authenticate, ctrl.listTypes);
router.post('/types', authenticate, requireRole('admin', 'hr'), ctrl.createType);
router.put('/types/:id', authenticate, requireRole('admin', 'hr'), ctrl.updateType);
router.delete('/types/:id', authenticate, requireRole('admin'), ctrl.deleteType);

// --- Balances ---------------------------------------------------------------
router.get('/balances', authenticate, requireStaff, ctrl.getBalances);
router.post('/balances/init', authenticate, requireRole('admin', 'hr'), ctrl.initBalances);

// --- Requests ---------------------------------------------------------------
router.get('/requests', authenticate, requireStaff, ctrl.listRequests);
router.post('/requests', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.createRequest);
router.put('/requests/:id/approve', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.approveRequest);
router.put('/requests/:id/reject', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.rejectRequest);
router.put('/requests/:id/cancel', authenticate, requireStaff, ctrl.cancelRequest);

export default router;
