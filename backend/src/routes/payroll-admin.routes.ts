import { Router } from 'express';
import { PayrollAdminController } from '../controllers/PayrollAdminController';
import { authenticate, allowSelfOrStaff, requireRole, requireStaff } from '../middleware/auth';

/**
 * Payroll back office. Mount at `/payroll-admin`.
 *
 * Literal segments are always declared before parameterised ones, and every
 * route sits behind `authenticate`. Self-service routes live under `/me` and
 * read the employee id from the token, never from the URL.
 */
const router = Router();
const ctrl = new PayrollAdminController();

/** Roles that may move money or change tax configuration. */
const finance = requireRole('admin', 'accountant');
/** Roles that may see cost and forecast figures. */
const costViewers = requireRole('admin', 'accountant', 'hr');

router.use(authenticate);

// ===========================================================================
// Employee self service -- declared first so `/me/...` never hits a :param route
// ===========================================================================
router.get('/me/payslips', ctrl.myPayslips);
router.get('/me/payslips/:lineId/pdf', ctrl.myPayslipPdf);
router.get('/me/tax-declaration/:fy', ctrl.myTaxDeclaration);
router.put('/me/tax-declaration/:fy', ctrl.saveMyTaxDeclaration);
router.get('/me/salary-history', ctrl.mySalaryHistory);

// ===========================================================================
// Dashboard and analytics
// ===========================================================================
router.get('/dashboard', requireStaff, ctrl.getDashboard);
router.get('/analytics/cost', costViewers, ctrl.getCostAnalytics);
router.get('/analytics/trends', requireStaff, ctrl.getSalaryTrends);
router.get('/analytics/increments', requireStaff, ctrl.getIncrementAnalysis);
router.get('/analytics/overtime', requireStaff, ctrl.getOvertimeAnalysis);
router.get('/analytics/bonus', requireStaff, ctrl.getBonusAnalysis);
router.get('/analytics/forecast', costViewers, ctrl.getForecast);
router.get('/compliance/:periodId', requireStaff, ctrl.getCompliance);

// ===========================================================================
// Reports
// ===========================================================================
router.get('/reports/:type/export', requireStaff, ctrl.exportReport);
router.post('/reports/:type/queue', requireStaff, ctrl.queueReport);
router.get('/reports/:type', requireStaff, ctrl.getReport);

// ===========================================================================
// Bank accounts
// ===========================================================================
router.get('/bank-accounts', requireStaff, ctrl.listBankAccounts);
router.post('/bank-accounts', finance, ctrl.createBankAccount);
router.get('/bank-accounts/:id', requireStaff, ctrl.getBankAccount);
router.put('/bank-accounts/:id', finance, ctrl.updateBankAccount);
router.delete('/bank-accounts/:id', requireRole('admin'), ctrl.deleteBankAccount);

// ===========================================================================
// Payment batches
// ===========================================================================
router.get('/batches', requireStaff, ctrl.listBatches);
router.post('/batches', finance, ctrl.createBatch);
router.get('/batches/:id', requireStaff, ctrl.getBatch);
router.get('/batches/:id/export', finance, ctrl.exportBatch);
router.put('/batches/:id/sent', finance, ctrl.markBatchSent);
router.post('/batches/:id/results', finance, ctrl.recordBatchResults);
router.post('/batches/:id/retry', finance, ctrl.retryBatch);

// ===========================================================================
// Currencies and exchange rates
// ===========================================================================
router.get('/currencies', requireStaff, ctrl.listCurrencies);
router.get('/exchange-rates', requireStaff, ctrl.listExchangeRates);
router.post('/exchange-rates', finance, ctrl.upsertExchangeRate);
router.get('/exchange-rates/convert', requireStaff, ctrl.convertCurrency);

// ===========================================================================
// Tax configuration
// ===========================================================================
router.get('/tax/regimes', requireStaff, ctrl.listRegimes);
router.get('/tax/regimes/:id', requireStaff, ctrl.getRegime);

router.get('/tax/slabs', requireStaff, ctrl.listSlabs);
router.post('/tax/slabs', finance, ctrl.createSlab);
router.put('/tax/slabs/:id', finance, ctrl.updateSlab);
router.delete('/tax/slabs/:id', finance, ctrl.deleteSlab);

router.get('/tax/sections', requireStaff, ctrl.listSections);
router.post('/tax/sections', finance, ctrl.createSection);
router.put('/tax/sections/:id', finance, ctrl.updateSection);
router.delete('/tax/sections/:id', finance, ctrl.deleteSection);

// --- Tax declarations (literal segments before the :employeeId/:fy pair) ----
router.get('/tax/declarations', requireStaff, ctrl.listDeclarations);
router.put('/tax/declarations/:id/submit', requireStaff, ctrl.submitDeclaration);
router.put('/tax/declarations/:id/verify', finance, ctrl.verifyDeclaration);
router.put('/tax/declarations/:id/reject', finance, ctrl.rejectDeclaration);
router.get('/tax/declarations/:employeeId/:fy', allowSelfOrStaff('employeeId'), ctrl.getDeclaration);
router.put('/tax/declarations/:employeeId/:fy', allowSelfOrStaff('employeeId'), ctrl.saveDeclaration);

router.get('/tax/computations/:employeeId/:fy', allowSelfOrStaff('employeeId'), ctrl.getComputation);
router.post('/tax/computations/:employeeId/:fy/recompute', finance, ctrl.recomputeTax);
router.get('/tax/form16/:employeeId/:fy', allowSelfOrStaff('employeeId'), ctrl.getForm16);

// ===========================================================================
// Approvals
// ===========================================================================
router.get('/approvals/pending', requireStaff, ctrl.listPendingApprovals);
router.get('/approvals/entity/:type/:id', requireStaff, ctrl.getEntityApprovals);
router.put('/approvals/:id/act', requireStaff, ctrl.actOnApproval);
router.put('/approvals/:id/cancel', requireStaff, ctrl.cancelApproval);

// ===========================================================================
// Audit
// ===========================================================================
router.get('/audit', costViewers, ctrl.listAudit);

// ===========================================================================
// Payslips
// ===========================================================================
router.post('/payslips/bulk', requireStaff, ctrl.bulkPayslips);
router.get('/payslips/verify/:token', requireStaff, ctrl.verifyPayslip);
router.get('/payslips/:lineId/pdf', requireStaff, ctrl.getPayslipPdf);
router.get('/payslips/:lineId', requireStaff, ctrl.getPayslip);

export default router;
