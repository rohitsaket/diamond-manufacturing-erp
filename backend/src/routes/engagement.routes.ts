import { Router } from 'express';
import { EngagementController } from '../controllers/EngagementController';
import { authenticate, requireRole, requireStaff } from '../middleware/auth';

const router = Router();
const ctrl = new EngagementController();

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
router.get('/tasks', authenticate, requireStaff, ctrl.listTasks);
router.get('/tasks/me/list', authenticate, ctrl.myTasks);
router.post('/tasks', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.createTask);
router.put('/tasks/:id/status', authenticate, requireStaff, ctrl.updateTaskStatus);

// ---------------------------------------------------------------------------
// Helpdesk tickets
// ---------------------------------------------------------------------------
router.get('/tickets', authenticate, requireStaff, ctrl.listTickets);
router.get('/tickets/me/list', authenticate, ctrl.myTickets);
router.post('/tickets', authenticate, ctrl.createTicket);
router.put('/tickets/:id/status', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.updateTicketStatus);

// ---------------------------------------------------------------------------
// Expense claims
// ---------------------------------------------------------------------------
router.get('/expenses', authenticate, requireStaff, ctrl.listExpenses);
router.get('/expenses/me/list', authenticate, ctrl.myExpenses);
router.post('/expenses', authenticate, ctrl.createExpense);
router.put('/expenses/:id/decide', authenticate, requireRole('admin', 'accountant', 'hr'), ctrl.decideExpense);

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
router.get('/assets', authenticate, requireStaff, ctrl.listAssets);
router.get('/assets/me/list', authenticate, ctrl.myAssets);
router.post('/assets', authenticate, requireRole('admin', 'hr'), ctrl.createAsset);
router.post('/assets/:id/assign', authenticate, requireRole('admin', 'hr'), ctrl.assignAsset);
router.put('/assets/assignments/:id/return', authenticate, requireRole('admin', 'hr'), ctrl.returnAsset);

// ---------------------------------------------------------------------------
// Announcements (everyone sees company news)
// ---------------------------------------------------------------------------
router.get('/announcements', authenticate, ctrl.listAnnouncements);
router.post('/announcements', authenticate, requireRole('admin', 'hr'), ctrl.createAnnouncement);
router.put('/announcements/:id', authenticate, requireRole('admin', 'hr'), ctrl.updateAnnouncement);
router.delete('/announcements/:id', authenticate, requireRole('admin', 'hr'), ctrl.removeAnnouncement);

// ---------------------------------------------------------------------------
// Company events
// ---------------------------------------------------------------------------
router.get('/events', authenticate, ctrl.listEvents);
router.post('/events', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.createEvent);
router.delete('/events/:id', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.removeEvent);

// ---------------------------------------------------------------------------
// Trainings
// ---------------------------------------------------------------------------
router.get('/trainings', authenticate, ctrl.listTrainings);
router.get('/trainings/me/list', authenticate, ctrl.myTrainings);
router.post('/trainings', authenticate, requireRole('admin', 'hr'), ctrl.createTraining);
router.put('/trainings/:id/status', authenticate, requireRole('admin', 'hr'), ctrl.updateTrainingStatus);
router.post('/trainings/:id/enroll', authenticate, requireRole('admin', 'hr'), ctrl.enrollTraining);
router.put('/trainings/:id/enrollment', authenticate, requireRole('admin', 'hr'), ctrl.setEnrollmentStatus);

export default router;
