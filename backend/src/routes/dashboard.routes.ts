import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';
import { authenticate, requireStaff } from '../middleware/auth';

const router = Router();
const ctrl = new DashboardController();

router.get('/kpis', authenticate, requireStaff, ctrl.getKpis);
router.get('/yield-trend', authenticate, requireStaff, ctrl.getYieldTrend);
router.get('/carat-flow', authenticate, requireStaff, ctrl.getCaratFlow);
router.get('/status-distribution', authenticate, requireStaff, ctrl.getStatusDistribution);
router.get('/leaderboard', authenticate, requireStaff, ctrl.getLeaderboard);

export default router;
