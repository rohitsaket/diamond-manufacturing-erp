import { Router } from 'express';
import { OrganizationController } from '../controllers/OrganizationController';
import { authenticate, requireStaff, requireRole } from '../middleware/auth';

const router = Router();
const ctrl = new OrganizationController();

/**
 * Every literal path is registered BEFORE the generic `/:slug` handlers, so
 * `/dashboard` is never mistaken for an entity called "dashboard".
 */

// --- Analytics and views ----------------------------------------------------
router.get('/dashboard', authenticate, requireStaff, ctrl.getDashboard);
router.get('/search', authenticate, requireStaff, ctrl.search);
router.get('/workforce', authenticate, requireStaff, ctrl.getWorkforce);
router.get('/tree', authenticate, requireStaff, ctrl.getTree);
router.get('/chart', authenticate, requireStaff, ctrl.getChart);
router.get('/position-chart', authenticate, requireStaff, ctrl.getPositionChart);
router.get('/audit', authenticate, requireStaff, ctrl.getAudit);
router.get('/export/:entity', authenticate, requireStaff, ctrl.exportCsv);

// --- Structural moves -------------------------------------------------------
router.put('/reparent', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.reparent);

// --- Matrix / dotted-line reporting ----------------------------------------
router.get('/reporting', authenticate, requireStaff, ctrl.listReporting);
router.post('/reporting', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.createReporting);
router.delete('/reporting/:id', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.deleteReporting);

// --- Change requests --------------------------------------------------------
router.get('/change-requests', authenticate, requireStaff, ctrl.listChangeRequests);
router.post('/change-requests', authenticate, requireStaff, ctrl.createChangeRequest);
router.put('/change-requests/:id/decide', authenticate, requireRole('admin', 'hr'), ctrl.decideChangeRequest);

// --- Policies ---------------------------------------------------------------
router.get('/policies', authenticate, ctrl.listPolicies);
router.post('/policies', authenticate, requireRole('admin', 'hr'), ctrl.createPolicy);
router.put('/policies/:id', authenticate, requireRole('admin', 'hr'), ctrl.updatePolicy);

// --- Career paths -----------------------------------------------------------
router.get('/career-paths', authenticate, requireStaff, ctrl.listCareerPaths);
router.post('/career-paths', authenticate, requireRole('admin', 'hr'), ctrl.createCareerPath);
router.delete('/career-paths/:id', authenticate, requireRole('admin', 'hr'), ctrl.deleteCareerPath);

// --- Team membership --------------------------------------------------------
router.get('/teams/:teamId/members', authenticate, requireStaff, ctrl.listTeamMembers);
router.post('/teams/:teamId/members', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.addTeamMember);
router.delete(
  '/teams/:teamId/members/:employeeId',
  authenticate,
  requireRole('admin', 'hr', 'manager'),
  ctrl.removeTeamMember,
);

// --- Bulk -------------------------------------------------------------------
router.post('/bulk/transfer', authenticate, requireRole('admin', 'hr'), ctrl.bulkTransfer);
router.post('/bulk/:slug/import', authenticate, requireRole('admin', 'hr'), ctrl.bulkImport);

// --- Generic entity CRUD (must stay last) -----------------------------------
router.get('/:slug', authenticate, requireStaff, ctrl.listEntities);
router.get('/:slug/:id', authenticate, requireStaff, ctrl.getEntity);
router.post('/:slug', authenticate, requireRole('admin', 'hr'), ctrl.createEntity);
router.put('/:slug/:id', authenticate, requireRole('admin', 'hr'), ctrl.updateEntity);
router.delete('/:slug/:id', authenticate, requireRole('admin'), ctrl.deleteEntity);

export default router;
