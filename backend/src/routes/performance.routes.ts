import { Router } from 'express';
import { PerformanceController } from '../controllers/PerformanceController';
import { authenticate, requireStaff } from '../middleware/auth';

/**
 * Performance management core. Mount at `/performance`.
 *
 * Reads are open to any authenticated user (services trim what self-service
 * accounts may touch); anything that changes master data — cycles, the KPI
 * and KRA libraries, assignments, approvals, analytics — is staff-only.
 * Self-service users create/update their own goals and self-score their own
 * KRAs; the services enforce ownership, so those routes need only
 * `authenticate`.
 *
 * Literal segments are declared before parameterised ones throughout, so
 * `/goals/tree` never resolves as `/goals/:id`.
 */
const router = Router();
const ctrl = new PerformanceController();

router.use(authenticate);

// ===========================================================================
// Cycles
// ===========================================================================
router.get('/', ctrl.listCycles);
router.get('/cycles', ctrl.listCycles);
router.post('/cycles', requireStaff, ctrl.createCycle);
router.get('/cycles/:id/calendar', ctrl.cycleCalendar);
router.put('/cycles/:id/status', requireStaff, ctrl.changeCycleStatus);
router.get('/cycles/:id', ctrl.getCycle);
router.put('/cycles/:id', requireStaff, ctrl.updateCycle);

// ===========================================================================
// Goals & OKRs
// ===========================================================================
router.get('/goals', ctrl.listGoals);
router.get('/goals/tree', ctrl.goalTree);
router.post('/goals', ctrl.createGoal);
router.post('/goals/bulk-from-template', requireStaff, ctrl.bulkGoalsFromTemplate);
router.get('/goals/:id/updates', ctrl.goalUpdates);
router.post('/goals/:id/submit', ctrl.submitGoal);
router.post('/goals/:id/approve', requireStaff, ctrl.approveGoal);
router.post('/goals/:id/reject', requireStaff, ctrl.rejectGoal);
router.post('/goals/:id/progress', ctrl.recordGoalProgress);
router.post('/goals/:id/complete', ctrl.completeGoal);
router.post('/goals/:id/cancel', ctrl.cancelGoal);
router.post('/goals/:id/milestones', ctrl.addMilestone);
router.get('/goals/:id', ctrl.getGoal);
router.put('/goals/:id', ctrl.updateGoal);
router.delete('/goals/:id', ctrl.deleteGoal);

router.put('/milestones/:id', ctrl.updateMilestone);
router.delete('/milestones/:id', ctrl.deleteMilestone);

router.get('/goal-templates', ctrl.listGoalTemplates);
router.post('/goal-templates', requireStaff, ctrl.createGoalTemplate);
router.put('/goal-templates/:id', requireStaff, ctrl.updateGoalTemplate);

// ===========================================================================
// KPI library, assignments, values, auto-compute
// ===========================================================================
router.get('/kpis', ctrl.listKpis);
router.post('/kpis', requireStaff, ctrl.createKpi);
router.put('/kpis/:id', requireStaff, ctrl.updateKpi);

router.get('/kpi-assignments', ctrl.listKpiAssignments);
router.post('/kpi-assignments', requireStaff, ctrl.createKpiAssignment);
router.post('/kpi-assignments/compute', requireStaff, ctrl.computeKpiAssignments);
router.get('/kpi-assignments/:id/values', ctrl.listKpiValues);
router.put('/kpi-assignments/:id/value', requireStaff, ctrl.recordKpiValue);
router.put('/kpi-assignments/:id', requireStaff, ctrl.updateKpiAssignment);
router.delete('/kpi-assignments/:id', requireStaff, ctrl.deleteKpiAssignment);

// ===========================================================================
// KRA library and per-employee scoring
// ===========================================================================
router.get('/kras', ctrl.listKras);
router.post('/kras', requireStaff, ctrl.createKra);
router.put('/kras/:id', requireStaff, ctrl.updateKra);

router.get('/employee-kras', ctrl.listEmployeeKras);
router.post('/employee-kras', requireStaff, ctrl.assignEmployeeKra);
router.post('/employee-kras/bulk', requireStaff, ctrl.bulkAssignEmployeeKras);
router.put('/employee-kras/:id/self-score', ctrl.selfScoreKra); // employee-or-staff, enforced in the service
router.put('/employee-kras/:id/manager-score', requireStaff, ctrl.managerScoreKra);
router.put('/employee-kras/:id/finalize', requireStaff, ctrl.finalizeKra);

// ===========================================================================
// Employee self-service
// ===========================================================================
router.get('/me/goals', ctrl.myGoals);
router.get('/me/kpis', ctrl.myKpis);
router.get('/me/kras', ctrl.myKras);

// ===========================================================================
// Analytics, AI stubs, reports, audit
// ===========================================================================
router.get('/analytics/dashboard', requireStaff, ctrl.analyticsDashboard);
router.get('/analytics/distribution', requireStaff, ctrl.analyticsDistribution);
router.get('/analytics/departments', requireStaff, ctrl.analyticsDepartments);
router.get('/analytics/trends', requireStaff, ctrl.analyticsTrends);
router.get('/analytics/attrition', requireStaff, ctrl.analyticsAttrition);

router.get('/ai/insights', ctrl.aiInsights);
router.post('/ai/suggest-goals', ctrl.aiSuggestGoals);

router.get('/reports/:type/export', requireStaff, ctrl.reportExport);
router.get('/reports/:type', requireStaff, ctrl.report);

router.get('/audit-logs', requireStaff, ctrl.auditLogs);

export default router;
