import { Router } from 'express';
import { PayrollLoanController } from '../controllers/PayrollLoanController';
import { authenticate, requireStaff, requireRole, allowSelfOrStaff } from '../middleware/auth';

const router = Router();
const ctrl = new PayrollLoanController();

// --- Reimbursement types ----------------------------------------------------
router.get('/reimbursement-types', authenticate, ctrl.listReimbursementTypes);
router.post('/reimbursement-types', authenticate, requireRole('admin', 'hr'), ctrl.createReimbursementType);
router.put('/reimbursement-types/:id', authenticate, requireRole('admin', 'hr'), ctrl.updateReimbursementType);

// --- Reimbursement claims ---------------------------------------------------
router.get('/claims/me', authenticate, ctrl.myClaims);
router.get('/claims', authenticate, requireStaff, ctrl.listClaims);
router.post('/claims', authenticate, ctrl.createClaim);
router.put('/claims/mark-paid', authenticate, requireRole('admin', 'accountant'), ctrl.markClaimsPaid);
router.put('/claims/:id/decide', authenticate, requireRole('admin', 'accountant', 'hr'), ctrl.decideClaim);

// --- Benefits ---------------------------------------------------------------
router.get('/benefit-plans', authenticate, ctrl.listBenefitPlans);
router.post('/benefit-plans', authenticate, requireRole('admin', 'hr'), ctrl.createBenefitPlan);
router.put('/benefit-plans/:id', authenticate, requireRole('admin', 'hr'), ctrl.updateBenefitPlan);
router.get('/benefits', authenticate, requireStaff, ctrl.listEnrolments);
router.post('/benefits/enrol', authenticate, requireRole('admin', 'hr'), ctrl.enrolBenefit);
router.put('/benefits/:id/end', authenticate, requireRole('admin', 'hr'), ctrl.endEnrolment);
router.get('/employees/:id/benefits', authenticate, allowSelfOrStaff('id'), ctrl.listEmployeeBenefits);

// --- Loans (literal paths before /:id) --------------------------------------
router.get('/me', authenticate, ctrl.myLoans);
router.get('/', authenticate, requireStaff, ctrl.listLoans);
router.post('/', authenticate, requireRole('admin', 'hr', 'accountant'), ctrl.createLoan);
router.get('/:id', authenticate, requireStaff, ctrl.getLoan);
router.put('/:id/approve', authenticate, requireRole('admin', 'accountant'), ctrl.approveLoan);
router.put('/:id/reject', authenticate, requireRole('admin', 'accountant'), ctrl.rejectLoan);
router.put('/:id/foreclose', authenticate, requireRole('admin', 'accountant'), ctrl.forecloseLoan);
router.post('/:id/repayments', authenticate, requireRole('admin', 'accountant'), ctrl.recordRepayment);

export default router;
