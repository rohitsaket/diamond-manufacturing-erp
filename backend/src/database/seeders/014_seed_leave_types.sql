-- Seed leave types and open the current year's balances
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

INSERT INTO leave_types (code, name, annual_quota, is_paid, color, created_by) VALUES
('CL', 'Casual Leave', 7.0, true, 'info', @admin_id),
('SL', 'Sick Leave', 7.0, true, 'warning', @admin_id),
('PL', 'Privilege Leave', 15.0, true, 'success', @admin_id),
('LWP', 'Leave Without Pay', 0.0, false, 'danger', @admin_id)
ON DUPLICATE KEY UPDATE name = VALUES(name), annual_quota = VALUES(annual_quota);

-- Allocate the annual quota to every working employee for 2026
INSERT INTO leave_balances (employee_id, leave_type_id, year, allocated, used)
SELECT e.id, lt.id, 2026, lt.annual_quota, 0
FROM employees e
CROSS JOIN leave_types lt
WHERE e.work_status = 'WORKING' AND e.deleted_at IS NULL AND lt.deleted_at IS NULL
ON DUPLICATE KEY UPDATE allocated = VALUES(allocated);
