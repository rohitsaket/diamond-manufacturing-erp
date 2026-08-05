import { Router } from 'express';
import authRoutes from './auth.routes';
import dashboardRoutes from './dashboard.routes';
import floorRoutes from './floor.routes';
import ledgerRoutes from './ledger.routes';
import employeeRoutes from './employee.routes';
import payrollRoutes from './payroll.routes';
import compensationRoutes from './compensation.routes';
import payrollLoanRoutes from './payroll-loans.routes';
import payrollRunRoutes from './payroll-runs.routes';
import payrollAdminRoutes from './payroll-admin.routes';
import statutoryRoutes from './statutory.routes';
import complianceRoutes from './compliance.routes';
import performanceRoutes from './performance.routes';
import talentRoutes from './talent.routes';
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
import organizationRoutes from './organization.routes';

const router = Router();

// Existing modules
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/floor', floorRoutes);
router.use('/ledger', ledgerRoutes);
router.use('/employees', employeeRoutes);
router.use('/profile', profileRoutes);
router.use('/documents', documentRoutes);
router.use('/organization', organizationRoutes);
router.use('/payroll', payrollRoutes);

// Enterprise payroll
router.use('/compensation', compensationRoutes);
router.use('/payroll-loans', payrollLoanRoutes);
router.use('/payroll-runs', payrollRunRoutes);
router.use('/payroll-admin', payrollAdminRoutes);
router.use('/statutory', statutoryRoutes);
router.use('/compliance', complianceRoutes);

// Performance management
router.use('/performance', performanceRoutes);
router.use('/talent', talentRoutes);
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
