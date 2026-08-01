-- Seed engagement data: announcements, events, tasks, tickets, expenses, assets, trainings
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);
SET @emp_301 = (SELECT id FROM employees WHERE emp_code = '301' LIMIT 1);
SET @emp_302 = (SELECT id FROM employees WHERE emp_code = '302' LIMIT 1);
SET @emp_303 = (SELECT id FROM employees WHERE emp_code = '303' LIMIT 1);
SET @emp_304 = (SELECT id FROM employees WHERE emp_code = '304' LIMIT 1);
SET @emp_305 = (SELECT id FROM employees WHERE emp_code = '305' LIMIT 1);
SET @emp_306 = (SELECT id FROM employees WHERE emp_code = '306' LIMIT 1);

INSERT INTO announcements (title, body, category, pinned, publish_from, publish_to, audience, created_by, updated_by) VALUES
('Diwali bonus policy for 2026', 'The management has approved a Diwali bonus equal to one month of average earnings for all karigars who complete 240 working days in the financial year. The payout will be processed with the November salary.', 'POLICY', true, '2026-07-25', '2026-11-30', 'ALL', @admin_id, @admin_id),
('New rate card effective from August', 'The revised rate card for fancy shapes takes effect from 1 August 2026. Please review the updated per-carat rates on the Rate Card screen before issuing new lots.', 'NEWS', false, '2026-07-28', '2026-08-31', 'ALL', @admin_id, @admin_id),
('Biometric attendance goes live', 'From this month attendance is captured on the biometric machine at the main gate. Please punch in and out every day. Any missed punch must be reported to HR the same day.', 'ALERT', false, '2026-08-01', '2026-09-15', 'ALL', @admin_id, @admin_id),
('Safety week celebration', 'Safety week will be observed in the second week of August with daily briefings at the start of each shift.', 'CELEBRATION', false, '2026-08-01', '2026-08-20', 'ALL', @admin_id, @admin_id);

INSERT INTO company_events (title, event_type, start_at, end_at, location, description, created_by, updated_by) VALUES
('Monthly production review', 'MEETING', '2026-08-05 16:00:00', '2026-08-05 17:30:00', 'Conference room', 'Review of July yield, leakage exceptions and pending lots', @admin_id, @admin_id),
('Fancy shape polishing workshop', 'TRAINING', '2026-08-12 10:00:00', '2026-08-14 17:00:00', 'Training bay', 'Three day hands-on workshop for A and A+ grade karigars', @admin_id, @admin_id),
('Statutory audit visit', 'AUDIT', '2026-08-24 11:00:00', '2026-08-24 16:00:00', 'Accounts office', 'PF and ESI records verification', @admin_id, @admin_id),
('Independence Day flag hoisting', 'EVENT', '2026-08-15 08:30:00', '2026-08-15 09:30:00', 'Factory ground', NULL, @admin_id, @admin_id);

INSERT INTO tasks (title, description, employee_id, priority, status, due_date, assigned_by, created_by, updated_by) VALUES
('Complete pending rework on lot HRN-2041', 'Two stones need re-polishing before the lot can be verified', @emp_301, 'HIGH', 'IN_PROGRESS', '2026-08-04', @admin_id, @admin_id, @admin_id),
('Submit updated bank passbook copy', 'Salary transfer failed last month due to an old account number', @emp_303, 'MEDIUM', 'PENDING', '2026-08-08', @admin_id, @admin_id, @admin_id),
('Attend fancy shape workshop', 'Confirm attendance for the three day workshop', @emp_302, 'MEDIUM', 'PENDING', '2026-08-10', @admin_id, @admin_id, @admin_id),
('Hand over blocking tools for audit', 'Tools issued in March need to be listed for the asset audit', @emp_305, 'LOW', 'PENDING', '2026-08-18', @admin_id, @admin_id, @admin_id),
('Verify July attendance register', 'Cross-check biometric punches against the manual register', @emp_306, 'HIGH', 'DONE', '2026-08-01', @admin_id, @admin_id, @admin_id);

UPDATE tasks SET completed_at = '2026-08-01 17:20:00' WHERE status = 'DONE';

INSERT INTO tickets (ticket_no, employee_id, category, subject, description, priority, status, assigned_to, created_by, updated_by) VALUES
('TKT-20260728-0001', @emp_302, 'PAYROLL', 'Sick leave not reflected in July salary', 'I was on approved sick leave from 13 to 15 July but the salary slip shows those days as absent.', 'HIGH', 'IN_PROGRESS', @admin_id, @admin_id, @admin_id),
('TKT-20260730-0002', @emp_304, 'HR', 'Request for updated appointment letter', 'I need a copy of my appointment letter for a bank loan application.', 'LOW', 'OPEN', NULL, @admin_id, @admin_id),
('TKT-20260731-0003', @emp_305, 'FACILITY', 'Polishing bench light not working', 'The lamp at bench 14 has been flickering for a week.', 'MEDIUM', 'OPEN', NULL, @admin_id, @admin_id),
('TKT-20260720-0004', @emp_301, 'IT', 'Cannot open the salary slip on phone', 'The WhatsApp slip link does not open on my phone.', 'LOW', 'RESOLVED', @admin_id, @admin_id, @admin_id);

UPDATE tickets SET resolved_at = '2026-07-22 14:00:00', resolution = 'Sent the slip as a PDF attachment instead of a link' WHERE ticket_no = 'TKT-20260720-0004';

INSERT INTO expense_claims (employee_id, category, amount, expense_date, description, status, decided_by, decided_at, decision_note, created_by, updated_by) VALUES
(@emp_301, 'TRAVEL', 850.00, '2026-07-18', 'Auto fare for delivering a rush lot to the client office', 'APPROVED', @admin_id, '2026-07-20 11:00:00', 'Approved, reimburse with salary', @admin_id, @admin_id),
(@emp_303, 'MEDICAL', 3200.00, '2026-07-22', 'Hospital charges for on-site injury dressing', 'PENDING', NULL, NULL, NULL, @admin_id, @admin_id),
(@emp_305, 'TOOLS', 1450.00, '2026-07-26', 'Replacement polishing wheel purchased locally', 'PENDING', NULL, NULL, NULL, @admin_id, @admin_id),
(@emp_306, 'FOOD', 600.00, '2026-07-15', 'Team lunch during the month-end assortment push', 'REJECTED', @admin_id, '2026-07-17 09:30:00', 'Not covered by the expense policy', @admin_id, @admin_id);

INSERT INTO assets (asset_code, name, category, serial_no, purchase_date, purchase_cost, status, created_by, updated_by) VALUES
('AST-0001', 'Polishing tang (4P)', 'TOOL', 'TNG-4P-0091', '2024-03-12', 12500.00, 'AVAILABLE', @admin_id, @admin_id),
('AST-0002', 'Digital carat scale', 'DEVICE', 'SCL-88231', '2023-11-05', 34000.00, 'AVAILABLE', @admin_id, @admin_id),
('AST-0003', 'Blocking machine B-12', 'MACHINE', 'BLK-B12-77', '2022-07-19', 285000.00, 'AVAILABLE', @admin_id, @admin_id),
('AST-0004', 'Loupe 10x', 'TOOL', 'LP-10X-441', '2025-01-30', 2200.00, 'AVAILABLE', @admin_id, @admin_id),
('AST-0005', 'Bench lamp LED', 'FURNITURE', NULL, '2025-06-02', 3400.00, 'REPAIR', @admin_id, @admin_id);

SET @asset_1 = (SELECT id FROM assets WHERE asset_code = 'AST-0001' LIMIT 1);
SET @asset_4 = (SELECT id FROM assets WHERE asset_code = 'AST-0004' LIMIT 1);

INSERT INTO asset_assignments (asset_id, employee_id, assigned_on, returned_on, condition_note, created_by) VALUES
(@asset_1, @emp_301, '2026-04-01', NULL, 'Issued in good condition', @admin_id),
(@asset_4, @emp_303, '2026-05-15', NULL, 'Standard issue', @admin_id);

UPDATE assets SET status = 'ASSIGNED' WHERE asset_code IN ('AST-0001', 'AST-0004');

INSERT INTO trainings (title, description, trainer, start_date, end_date, status, created_by, updated_by) VALUES
('Fancy shape polishing masterclass', 'Advanced techniques for pear, marquise and heart shapes', 'Mahesh Zaveri', '2026-08-12', '2026-08-14', 'PLANNED', @admin_id, @admin_id),
('Workplace safety and first aid', 'Mandatory annual safety refresher', 'Surat Safety Council', '2026-07-08', '2026-07-08', 'COMPLETED', @admin_id, @admin_id),
('Yield improvement techniques', 'Reducing weight loss during blocking', 'Internal - Senior karigars', '2026-09-01', '2026-09-03', 'PLANNED', @admin_id, @admin_id);

SET @train_safety = (SELECT id FROM trainings WHERE title = 'Workplace safety and first aid' LIMIT 1);
SET @train_fancy = (SELECT id FROM trainings WHERE title = 'Fancy shape polishing masterclass' LIMIT 1);

INSERT INTO training_enrollments (training_id, employee_id, status, completed_at)
SELECT @train_safety, e.id, 'COMPLETED', '2026-07-08'
FROM employees e WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL
ON DUPLICATE KEY UPDATE status = VALUES(status);

INSERT INTO training_enrollments (training_id, employee_id, status) VALUES
(@train_fancy, @emp_301, 'ENROLLED'),
(@train_fancy, @emp_302, 'ENROLLED'),
(@train_fancy, @emp_303, 'ENROLLED')
ON DUPLICATE KEY UPDATE status = VALUES(status);
