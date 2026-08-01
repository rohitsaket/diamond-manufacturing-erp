-- Seed salary lines for the OPEN period (July 2026)
SET @period_id = (SELECT id FROM salary_periods WHERE label = 'July 2026' LIMIT 1);
SET @manager_id = (SELECT id FROM users WHERE email = 'manager@harene.com' LIMIT 1);
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

SET @emp1 = (SELECT id FROM employees WHERE emp_code = '301' LIMIT 1);
SET @emp2 = (SELECT id FROM employees WHERE emp_code = '302' LIMIT 1);
SET @emp3 = (SELECT id FROM employees WHERE emp_code = '303' LIMIT 1);
SET @emp4 = (SELECT id FROM employees WHERE emp_code = 'DHAR-401' LIMIT 1);
SET @emp5 = (SELECT id FROM employees WHERE emp_code = '304' LIMIT 1);
SET @emp6 = (SELECT id FROM employees WHERE emp_code = 'MAXI' LIMIT 1);
SET @emp7 = (SELECT id FROM employees WHERE emp_code = '305' LIMIT 1);
SET @emp8 = (SELECT id FROM employees WHERE emp_code = '306' LIMIT 1);
SET @emp10 = (SELECT id FROM employees WHERE emp_code = '308' LIMIT 1);

INSERT INTO salary_lines (period_id, employee_id, total_cts, total_amount, lots_count, manager_verified, created_by) VALUES
(@period_id, @emp1, 124.5000, 48200.00, 11, true, @admin_id),
(@period_id, @emp2, 89.2000, 38600.00, 8, true, @admin_id),
(@period_id, @emp3, 203.8000, 61400.00, 16, false, @admin_id),
(@period_id, @emp4, 45.0000, 22800.00, 4, true, @admin_id),
(@period_id, @emp5, 110.4000, 29700.00, 9, false, @admin_id),
(@period_id, @emp6, 312.6000, 124500.00, 22, true, @admin_id),
(@period_id, @emp7, 58.3000, 18400.00, 6, false, @admin_id),
(@period_id, @emp8, 98.7000, 44300.00, 9, true, @admin_id),
(@period_id, @emp10, 176.2000, 52100.00, 14, false, @admin_id);
