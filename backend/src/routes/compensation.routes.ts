import { Router } from 'express';
import { CompensationController } from '../controllers/CompensationController';
import { authenticate, requireStaff, requireRole, allowSelfOrStaff } from '../middleware/auth';

const router = Router();
const ctrl = new CompensationController();

// --- Pay components ---------------------------------------------------------
router.get('/components', authenticate, requireStaff, ctrl.listComponents);
router.post('/components', authenticate, requireRole('admin', 'hr'), ctrl.createComponent);
router.get('/components/:id', authenticate, requireStaff, ctrl.getComponent);
router.put('/components/:id', authenticate, requireRole('admin', 'hr'), ctrl.updateComponent);
router.delete('/components/:id', authenticate, requireRole('admin', 'hr'), ctrl.deleteComponent);

// --- Salary structures ------------------------------------------------------
router.get('/structures', authenticate, requireStaff, ctrl.listStructures);
router.post('/structures', authenticate, requireRole('admin', 'hr'), ctrl.createStructure);
router.get('/structures/:id', authenticate, requireStaff, ctrl.getStructure);
router.get('/structures/:id/preview', authenticate, requireStaff, ctrl.previewStructure);
router.put('/structures/:id', authenticate, requireRole('admin', 'hr'), ctrl.updateStructure);
router.delete('/structures/:id', authenticate, requireRole('admin', 'hr'), ctrl.deleteStructure);
router.post('/structures/:id/clone', authenticate, requireRole('admin', 'hr'), ctrl.cloneStructure);
router.put('/structures/:id/lines', authenticate, requireRole('admin', 'hr'), ctrl.setStructureLines);

// --- Pay cycles -------------------------------------------------------------
router.get('/cycles', authenticate, requireStaff, ctrl.listCycles);
router.post('/cycles', authenticate, requireRole('admin', 'hr'), ctrl.createCycle);
router.get('/cycles/:id', authenticate, requireStaff, ctrl.getCycle);
router.put('/cycles/:id/default', authenticate, requireRole('admin', 'hr'), ctrl.setDefaultCycle);
router.put('/cycles/:id', authenticate, requireRole('admin', 'hr'), ctrl.updateCycle);
router.delete('/cycles/:id', authenticate, requireRole('admin', 'hr'), ctrl.deleteCycle);

// --- Overtime rules ---------------------------------------------------------
router.get('/overtime-rules', authenticate, requireStaff, ctrl.listOvertimeRules);
router.post('/overtime-rules', authenticate, requireRole('admin', 'hr'), ctrl.createOvertimeRule);
router.put('/overtime-rules/:id', authenticate, requireRole('admin', 'hr'), ctrl.updateOvertimeRule);
router.delete('/overtime-rules/:id', authenticate, requireRole('admin', 'hr'), ctrl.deleteOvertimeRule);

// --- Awards: bonus, incentives, variable pay --------------------------------
// Literal paths first so /awards/bulk never resolves as /awards/:id.
router.get('/awards', authenticate, requireStaff, ctrl.listAwards);
router.post('/awards', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.createAward);
router.post('/awards/bulk', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.bulkCreateAwards);
router.put('/awards/mark-paid', authenticate, requireRole('admin', 'accountant'), ctrl.markAwardsPaid);
router.get('/awards/:id', authenticate, requireStaff, ctrl.getAward);
router.put('/awards/:id', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.updateAward);
router.put('/awards/:id/submit', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.submitAward);
router.put('/awards/:id/approve', authenticate, requireRole('admin', 'hr', 'accountant'), ctrl.approveAward);
router.put('/awards/:id/reject', authenticate, requireRole('admin', 'hr', 'accountant'), ctrl.rejectAward);
router.put('/awards/:id/cancel', authenticate, requireRole('admin', 'hr', 'accountant'), ctrl.cancelAward);

// --- Employee compensation --------------------------------------------------
router.get('/employees/:id/salary/history', authenticate, allowSelfOrStaff('id'), ctrl.getEmployeeSalaryHistory);
router.get('/employees/:id/salary', authenticate, allowSelfOrStaff('id'), ctrl.getEmployeeSalary);
router.post('/employees/:id/salary', authenticate, requireRole('admin', 'hr'), ctrl.createRevision);
router.get('/employees/:id/awards', authenticate, allowSelfOrStaff('id'), ctrl.listEmployeeAwards);

// --- Revision approvals -----------------------------------------------------
router.put('/revisions/:id/approve', authenticate, requireRole('admin', 'hr', 'accountant'), ctrl.approveRevision);
router.put('/revisions/:id/reject', authenticate, requireRole('admin', 'hr', 'accountant'), ctrl.rejectRevision);

export default router;
