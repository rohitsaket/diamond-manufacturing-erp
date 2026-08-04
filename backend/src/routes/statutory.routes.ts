import { Router } from 'express';
import { StatutoryController } from '../controllers/StatutoryController';
import { allowSelfOrStaff, authenticate, requireRole, requireStaff } from '../middleware/auth';

/**
 * Statutory compliance. Mount at `/statutory`.
 *
 * Reads are open to every staff role; anything that changes a statutory figure,
 * raises a challan, generates a government return file or issues a tax
 * certificate is restricted to admin, accountant and HR. Employee-scoped reads
 * use `allowSelfOrStaff`, so a self-service login can see its own enrolment, PF
 * passbook and Form 16 and nothing else.
 *
 * Literal segments are declared before parameterised ones throughout, so
 * `/challans/overdue` never resolves as `/challans/:id`.
 */
const router = Router();
const ctrl = new StatutoryController();

/** Roles that may change statutory configuration, money and filings. */
const compliance = requireRole('admin', 'accountant', 'hr');

router.use(authenticate);

// ===========================================================================
// Scheme configuration and state rules
// ===========================================================================
router.get('/config', requireStaff, ctrl.listConfig);
router.post('/config', compliance, ctrl.createConfig);
router.put('/config', compliance, ctrl.updateConfig);
router.put('/config/:id', compliance, ctrl.updateConfig);

router.get('/pt-rules', requireStaff, ctrl.listPtRules);
router.post('/pt-rules', compliance, ctrl.createPtRule);
router.put('/pt-rules', compliance, ctrl.updatePtRule);
router.get('/pt-rules/:id/slabs', requireStaff, ctrl.listPtSlabs);
router.put('/pt-rules/:id/slabs', compliance, ctrl.replacePtSlabs);
router.put('/pt-rules/:id', compliance, ctrl.updatePtRule);

router.get('/lwf-rules', requireStaff, ctrl.listLwfRules);
router.post('/lwf-rules', compliance, ctrl.createLwfRule);
router.put('/lwf-rules', compliance, ctrl.updateLwfRule);
router.put('/lwf-rules/:id', compliance, ctrl.updateLwfRule);

router.get('/minimum-wage', requireStaff, ctrl.listMinimumWage);
router.post('/minimum-wage', compliance, ctrl.createMinimumWage);
router.put('/minimum-wage', compliance, ctrl.updateMinimumWage);
router.put('/minimum-wage/:id', compliance, ctrl.updateMinimumWage);

// ===========================================================================
// Establishment registrations
// ===========================================================================
router.get('/registrations', requireStaff, ctrl.listRegistrations);
router.post('/registrations', compliance, ctrl.createRegistration);
router.put('/registrations', compliance, ctrl.updateRegistration);
router.put('/registrations/:id', compliance, ctrl.updateRegistration);
router.delete('/registrations/:id', requireRole('admin'), ctrl.deleteRegistration);

// ===========================================================================
// Contribution ledger -- declared before /employees/:id so nothing shadows it
// ===========================================================================
router.get('/contributions', requireStaff, ctrl.listContributions);
router.post('/contributions/build', compliance, ctrl.buildContributions);
router.get('/contributions/summary/:periodId', requireStaff, ctrl.contributionSummary);

router.get('/gratuity/provisions', requireStaff, ctrl.listGratuityProvisions);
router.post('/gratuity/compute', compliance, ctrl.computeGratuity);
router.post('/pf/interest', compliance, ctrl.creditPfInterest);
router.post('/pf/post-entries', compliance, ctrl.postPfContributions);

// ===========================================================================
// Challans
// ===========================================================================
router.get('/challans', requireStaff, ctrl.listChallans);
router.get('/challans/overdue', requireStaff, ctrl.overdueChallans);
router.post('/challans/generate', compliance, ctrl.generateChallan);
router.get('/challans/:id', requireStaff, ctrl.getChallan);
router.get('/challans/:id/export', requireStaff, ctrl.exportChallan);
router.put('/challans/:id/paid', compliance, ctrl.markChallanPaid);
router.put('/challans/:id/acknowledge', compliance, ctrl.acknowledgeChallan);
router.put('/challans/:id/cancel', compliance, ctrl.cancelChallan);

// ===========================================================================
// Regulatory filings and government file generation
// ===========================================================================
router.get('/filings', requireStaff, ctrl.listFilings);
router.get('/filings/overdue', requireStaff, ctrl.overdueFilings);
router.post('/filings/generate/pf-ecr', compliance, ctrl.generatePfEcr);
router.post('/filings/generate/esi-return', compliance, ctrl.generateEsiReturn);
router.post('/filings/generate/pt-return', compliance, ctrl.generatePtReturn);
router.post('/filings/generate/lwf-return', compliance, ctrl.generateLwfReturn);
router.post('/filings/generate/24q', compliance, ctrl.generate24Q);
router.post('/filings/generate/register', compliance, ctrl.generateRegister);
router.get('/filings/:id', requireStaff, ctrl.getFiling);
router.get('/filings/:id/download', requireStaff, ctrl.downloadFiling);
router.put('/filings/:id/filed', compliance, ctrl.markFilingFiled);

// Short aliases for the same generators.
router.post('/pf-ecr', compliance, ctrl.generatePfEcr);
router.post('/esi-return', compliance, ctrl.generateEsiReturn);
router.post('/pt-return', compliance, ctrl.generatePtReturn);
router.post('/lwf-return', compliance, ctrl.generateLwfReturn);
router.post('/24q', compliance, ctrl.generate24Q);
router.post('/register', compliance, ctrl.generateRegister);

// ===========================================================================
// Form 16
// ===========================================================================
router.get('/form16', requireStaff, ctrl.listForm16);
router.post('/form16/generate', compliance, ctrl.generateForm16);
router.post('/form16/bulk', compliance, ctrl.bulkGenerateForm16);
router.get('/form16/:id', requireStaff, ctrl.getForm16);
router.get('/form16/:id/pdf', requireStaff, ctrl.downloadForm16Pdf);
router.put('/form16/:id/issue', compliance, ctrl.issueForm16);
router.post('/form16/:id/email', compliance, ctrl.emailForm16);

// ===========================================================================
// PF claims and nominees
// ===========================================================================
router.get('/pf-claims', requireStaff, ctrl.listPfClaims);
router.post('/pf-claims', compliance, ctrl.createPfClaim);
router.put('/pf-claims/:id', compliance, ctrl.updatePfClaim);

router.put('/nominees/:id', compliance, ctrl.updateNominee);
router.delete('/nominees/:id', compliance, ctrl.deleteNominee);

// ===========================================================================
// Employee-scoped records
// ===========================================================================
router.get('/employees/:id/statutory', allowSelfOrStaff('id'), ctrl.getEmployeeStatutory);
router.put('/employees/:id/statutory', compliance, ctrl.saveEmployeeStatutory);
router.get('/employees/:id/nominees', allowSelfOrStaff('id'), ctrl.listNominees);
router.post('/employees/:id/nominees', compliance, ctrl.createNominee);
router.get('/employees/:id/pf-account', allowSelfOrStaff('id'), ctrl.getPfAccount);
router.get('/employees/:id/form16', allowSelfOrStaff('id'), ctrl.employeeForm16);

export default router;
