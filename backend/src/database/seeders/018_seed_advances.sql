-- Seed salary advances and loans with a part-recovered example
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);
SET @emp_301 = (SELECT id FROM employees WHERE emp_code = '301' LIMIT 1);
SET @emp_303 = (SELECT id FROM employees WHERE emp_code = '303' LIMIT 1);
SET @emp_dhar = (SELECT id FROM employees WHERE emp_code = 'DHAR-401' LIMIT 1);

INSERT INTO advances (employee_id, advance_type, amount, advance_date, reason, installment_amount, status, created_by, updated_by) VALUES
(@emp_301, 'ADVANCE', 20000.00, '2026-06-05', 'Festival advance', 2500.00, 'ACTIVE', @admin_id, @admin_id),
(@emp_303, 'LOAN', 50000.00, '2026-05-20', 'Medical loan for family treatment', 5000.00, 'ACTIVE', @admin_id, @admin_id),
(@emp_dhar, 'ADVANCE', 8000.00, '2026-07-02', 'Two-wheeler repair', 2000.00, 'ACTIVE', @admin_id, @admin_id);

-- A manual recovery already collected in cash; payroll recalculation must never touch this row
SET @adv_301 = (SELECT id FROM advances WHERE employee_id = @emp_301 AND amount = 20000.00 LIMIT 1);
INSERT INTO advance_recoveries (advance_id, period_id, salary_line_id, amount, recovered_on, source, remarks, created_by) VALUES
(@adv_301, NULL, NULL, 2500.00, '2026-06-30', 'MANUAL', 'Collected in cash at the counter', @admin_id);
