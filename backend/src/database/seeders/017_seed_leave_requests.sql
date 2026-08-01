-- Seed sample leave requests: one approved (synced to attendance), one pending, one rejected
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);
SET @emp_302 = (SELECT id FROM employees WHERE emp_code = '302' LIMIT 1);
SET @emp_304 = (SELECT id FROM employees WHERE emp_code = '304' LIMIT 1);
SET @emp_305 = (SELECT id FROM employees WHERE emp_code = '305' LIMIT 1);
SET @type_cl = (SELECT id FROM leave_types WHERE code = 'CL' LIMIT 1);
SET @type_sl = (SELECT id FROM leave_types WHERE code = 'SL' LIMIT 1);

INSERT INTO leave_requests
  (employee_id, leave_type_id, from_date, to_date, days, reason, status, decided_by, decided_at, decision_note, created_by, updated_by)
VALUES
(@emp_302, @type_sl, '2026-07-13', '2026-07-15', 3.0, 'Viral fever, doctor advised rest', 'APPROVED', @admin_id, '2026-07-12 10:30:00', 'Approved with medical note', @admin_id, @admin_id),
(@emp_304, @type_cl, '2026-08-10', '2026-08-11', 2.0, 'Family function', 'PENDING', NULL, NULL, NULL, @admin_id, @admin_id),
(@emp_305, @type_cl, '2026-08-17', '2026-08-19', 3.0, 'Personal work', 'PENDING', NULL, NULL, NULL, @admin_id, @admin_id);

-- The approved sick leave must show up on the attendance register
UPDATE attendance_records
SET status = 'LEAVE', leave_type_id = @type_sl, source = 'LEAVE_SYNC',
    remarks = 'Leave: Sick Leave', in_time = NULL, out_time = NULL, worked_hours = NULL, ot_hours = 0
WHERE employee_id = @emp_302 AND att_date BETWEEN '2026-07-13' AND '2026-07-15';

-- ...and consume the balance
UPDATE leave_balances SET used = 3.0
WHERE employee_id = @emp_302 AND leave_type_id = @type_sl AND year = 2026;
