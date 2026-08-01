-- Seed a starting notification set and activity timeline
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);
SET @hr_id = (SELECT id FROM users WHERE email = 'hr@harene.com' LIMIT 1);
SET @emp_302 = (SELECT id FROM employees WHERE emp_code = '302' LIMIT 1);
SET @emp_304 = (SELECT id FROM employees WHERE emp_code = '304' LIMIT 1);
SET @user_302 = (SELECT id FROM users WHERE employee_id = @emp_302 LIMIT 1);

INSERT INTO notifications (user_id, category, priority, title, body, link_page, is_read, created_by) VALUES
(@admin_id, 'LEAVE', 'HIGH', '2 leave requests awaiting approval', 'Suresh Bhai and Kishore Nayak have applied for casual leave in August.', 'hr', false, @admin_id),
(@admin_id, 'PAYROLL', 'NORMAL', 'July payroll is open for recalculation', 'Attendance for July 2026 is complete. Recalculate the period to generate salary lines.', 'payroll', false, @admin_id),
(@admin_id, 'HELPDESK', 'NORMAL', '3 helpdesk tickets are open', 'One payroll query has been open for more than 3 days.', 'hr', false, @admin_id),
(@admin_id, 'RECRUITMENT', 'NORMAL', 'Candidate ready to convert', 'Hitesh Ramani has been marked SELECTED and can be converted to an employee.', 'hr', false, @admin_id),
(@admin_id, 'EXPENSE', 'LOW', '2 expense claims pending approval', 'Total pending reimbursement is 4,650 rupees.', 'hr', true, @admin_id),
(@hr_id, 'ATTENDANCE', 'NORMAL', 'Biometric import reminder', 'Remember to import the punch file every Monday morning.', 'attendance', false, @admin_id),
(@hr_id, 'SYSTEM', 'LOW', 'Welcome to the HR workspace', 'Attendance, leave, advances and recruitment are now available from the sidebar.', 'hr', false, @admin_id);

INSERT INTO notifications (user_id, category, priority, title, body, link_page, is_read, created_by)
SELECT @user_302, 'LEAVE', 'NORMAL', 'Your sick leave was approved',
       'Your sick leave from 13 to 15 July 2026 has been approved with a medical note.', 'ess', false, @admin_id
WHERE @user_302 IS NOT NULL;

INSERT INTO activity_logs (actor_user_id, actor_name, employee_id, entity_type, entity_id, action, summary) VALUES
(@admin_id, 'Admin User', @emp_302, 'LEAVE_REQUEST', NULL, 'APPROVED', 'Admin User approved 3 day sick leave for Priya Mehta'),
(@admin_id, 'Admin User', @emp_304, 'LEAVE_REQUEST', NULL, 'CREATED', 'Admin User recorded a casual leave request for Suresh Bhai'),
(@admin_id, 'Admin User', NULL, 'ATTENDANCE', NULL, 'BULK_MARKED', 'Admin User marked attendance for 31 July 2026'),
(@admin_id, 'Admin User', NULL, 'RATE_CARD', NULL, 'UPDATED', 'Admin User published a new rate card version'),
(@admin_id, 'Admin User', NULL, 'CANDIDATE', NULL, 'STATUS_CHANGED', 'Admin User moved Hitesh Ramani to SELECTED'),
(@admin_id, 'Admin User', NULL, 'ASSET', NULL, 'ASSIGNED', 'Admin User assigned a polishing tang to Jayesh Kumar Arora');
