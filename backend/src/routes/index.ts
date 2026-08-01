import { Router } from 'express';
import authRoutes from './auth.routes';
import dashboardRoutes from './dashboard.routes';
import floorRoutes from './floor.routes';
import ledgerRoutes from './ledger.routes';
import employeeRoutes from './employee.routes';
import payrollRoutes from './payroll.routes';
import rateCardRoutes from './rate-card.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/floor', floorRoutes);
router.use('/ledger', ledgerRoutes);
router.use('/employees', employeeRoutes);
router.use('/payroll', payrollRoutes);
router.use('/rate-card', rateCardRoutes);

export default router;
