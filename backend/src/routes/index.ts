import { Router } from 'express';
import authRoutes from './auth.routes';
import dashboardRoutes from './dashboard.routes';
import floorRoutes from './floor.routes';
import ledgerRoutes from './ledger.routes';
import employeeRoutes from './employee.routes';
import payrollRoutes from './payroll.routes';
import rateCardRoutes from './rate-card.routes';
import attendanceRoutes from './attendance.routes';
import leaveRoutes from './leave.routes';
import advanceRoutes from './advance.routes';
import candidateRoutes from './candidate.routes';
import engagementRoutes from './engagement.routes';
import hrDashboardRoutes from './hr-dashboard.routes';
import notificationRoutes from './notification.routes';
import essRoutes from './ess.routes';
import profileRoutes from './profile.routes';
import documentRoutes from './document.routes';

const router = Router();

// Existing modules
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/floor', floorRoutes);
router.use('/ledger', ledgerRoutes);
router.use('/employees', employeeRoutes);
router.use('/profile', profileRoutes);
router.use('/documents', documentRoutes);
router.use('/payroll', payrollRoutes);
router.use('/rate-card', rateCardRoutes);

// HRMS
router.use('/attendance', attendanceRoutes);
router.use('/leave', leaveRoutes);
router.use('/advances', advanceRoutes);
router.use('/candidates', candidateRoutes);
router.use('/engagement', engagementRoutes);

// Enterprise dashboard, notifications and employee self-service
router.use('/hr-dashboard', hrDashboardRoutes);
router.use('/notifications', notificationRoutes);
router.use('/ess', essRoutes);

export default router;
