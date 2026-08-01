import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';
import { authenticate } from '../middleware/auth';

const router = Router();
const ctrl = new DashboardController();

router.get('/kpis', authenticate, ctrl.getKpis);
router.get('/yield-trend', authenticate, ctrl.getYieldTrend);
router.get('/carat-flow', authenticate, ctrl.getCaratFlow);
router.get('/status-distribution', authenticate, ctrl.getStatusDistribution);
router.get('/leaderboard', authenticate, ctrl.getLeaderboard);

export default router;
