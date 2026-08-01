import { Router } from 'express';
import { HrDashboardController } from '../controllers/HrDashboardController';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();
const ctrl = new HrDashboardController();

// Role dashboards
router.get('/employee', authenticate, ctrl.employeeDashboard);
router.get('/manager', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.managerDashboard);
router.get('/hr', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.hrDashboard);
router.get('/executive', authenticate, requireRole('admin', 'hr'), ctrl.executiveDashboard);

// Cross-cutting
router.get('/search', authenticate, ctrl.globalSearch);
router.get('/calendar', authenticate, ctrl.getCalendar);
router.get('/activity', authenticate, ctrl.getActivity);

// Per-user widget layouts
router.get('/layouts/:dashboardKey', authenticate, ctrl.getLayouts);
router.put('/layouts/:dashboardKey', authenticate, ctrl.saveLayout);
router.delete('/layouts/:dashboardKey/:layoutName', authenticate, ctrl.deleteLayout);
router.post('/layouts/:dashboardKey/reset', authenticate, ctrl.resetLayouts);

export default router;
