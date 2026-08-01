import { Router } from 'express';
import { AttendanceController } from '../controllers/AttendanceController';
import { authenticate, requireStaff, requireRole, allowSelfOrStaff } from '../middleware/auth';

const router = Router();
const ctrl = new AttendanceController();

// Shifts
router.get('/shifts', authenticate, requireStaff, ctrl.getShifts);
router.post('/shifts', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.createShift);
router.put('/shifts/:id', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.updateShift);
router.delete('/shifts/:id', authenticate, requireRole('admin'), ctrl.deleteShift);

// Holidays (readable by self-service users too)
router.get('/holidays', authenticate, ctrl.getHolidays);
router.post('/holidays', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.createHoliday);
router.delete('/holidays/:id', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.deleteHoliday);

// Self service (declared before /employee/:id so the literal paths win)
router.get('/me/today', authenticate, ctrl.getMyToday);
router.post('/me/punch', authenticate, ctrl.punch);

// Attendance
router.get('/daily', authenticate, requireStaff, ctrl.getDaily);
router.post('/bulk', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.bulkMark);
router.get('/register', authenticate, requireStaff, ctrl.getRegister);
router.post('/import-punches', authenticate, requireRole('admin', 'manager', 'hr'), ctrl.importPunches);
router.get('/employee/:id', authenticate, allowSelfOrStaff('id'), ctrl.getEmployeeAttendance);

export default router;
