import { Router } from 'express';
import { PayrollRunController } from '../controllers/PayrollRunController';
import { authenticate, requireRole, requireStaff } from '../middleware/auth';

/**
 * Payroll run lifecycle. Mount at `/payroll-runs`.
 *
 * Literal paths are declared before `/:id` so `/simulate` is never parsed as a
 * run id. Everything requires a session.
 */
const router = Router();
const ctrl = new PayrollRunController();

/** Roles allowed to execute payroll. */
const canRun = requireRole('admin', 'hr', 'accountant');

router.use(authenticate);

// --- Literal paths (must precede /:id) -------------------------------------
router.post('/simulate', canRun, ctrl.simulate);
router.post('/retro', canRun, ctrl.retro);
router.post('/final-settlement', canRun, ctrl.finalSettlement);
router.get('/jobs/:id', requireStaff, ctrl.getJob);

// --- Run register ----------------------------------------------------------
router.get('/', requireStaff, ctrl.list);
router.post('/', canRun, ctrl.start);
router.get('/:id', requireStaff, ctrl.get);

// --- Approval gate ---------------------------------------------------------
router.put('/:id/submit-approval', canRun, ctrl.submitApproval);
router.put('/:id/approve', requireStaff, ctrl.approve);
router.put('/:id/reject', requireStaff, ctrl.reject);

export default router;
