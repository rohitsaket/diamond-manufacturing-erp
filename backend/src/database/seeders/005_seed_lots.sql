-- Seed lots
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

SET @full_polished = (SELECT id FROM labour_heads WHERE code = 'FULL_POLISHED' LIMIT 1);
SET @blocking = (SELECT id FROM labour_heads WHERE code = 'BLOCKING' LIMIT 1);

INSERT INTO lots (lot_id, lot_name, employee_id, shape, shape_category, qty, issue_weight, estimate_wt, issue_date, labour_head_id, status, received_date, polished_wt, color, clarity, cut, grader, lab, remarks, days_consumed, weight_diff, labour_amount, created_by) VALUES
('92124978', '643-019AAA', @emp1, 'Emerald', 'FANCY', 12, 18.5000, 12.6500, '2026-06-05', @full_polished, 'VERIFIED', '2026-06-22', 12.4800, 'F', 'VS1', 'EX EX EX', 'J.J.', 'IGI', NULL, 17, 6.0200, 13728.00, @admin_id),
('92125001', '644-021BBB', @emp1, 'Radiant', 'FANCY', 8, 12.3000, 8.1000, '2026-06-18', @full_polished, 'IN_PROGRESS', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, @admin_id),
('92125022', '645-008CCC', @emp2, 'Pear', 'FANCY', 20, 24.0000, 16.2000, '2026-06-10', @full_polished, 'RECEIVED', '2026-06-28', 15.9600, 'E', 'VVS2', 'EX VG EX', 'N.K.', 'GIA', NULL, 18, 8.0400, 22344.00, @admin_id),
('92125045', '646-033DDD', @emp3, 'Round', 'ROUND', 30, 35.8000, 23.5000, '2026-06-02', @full_polished, 'VERIFIED', '2026-06-19', 22.8400, 'G', 'SI1', 'EX EX EX', 'J.J.', 'IGI', NULL, 17, 12.9600, 20556.00, @admin_id),
('92125067', '647-044EEE', @emp3, 'Oval', 'FANCY', 15, 19.2000, 13.0000, '2026-06-12', @full_polished, 'ISSUED', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, @admin_id),
('92125089', '648-055FFF', @emp4, 'Cushion', 'FANCY', 10, 14.5000, 9.8000, '2026-06-08', @blocking, 'VERIFIED', '2026-06-24', 9.2000, 'H', 'VS2', 'VG EX VG', 'N.K.', 'IGI', NULL, 16, 5.3000, 8280.00, @admin_id),
('92125110', '649-066GGG', @emp5, 'Round', 'ROUND', 25, 28.6000, 19.0000, '2026-06-10', @full_polished, 'IN_PROGRESS', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, @admin_id),
('92125132', '650-077HHH', @emp6, 'Princess', 'FANCY', 40, 52.4000, 36.2000, '2026-06-03', @full_polished, 'VERIFIED', '2026-06-20', 35.6200, 'D', 'IF', 'EX EX EX', 'J.J.', 'GIA', NULL, 17, 16.7800, 71240.00, @admin_id),
('92125155', '651-088III', @emp6, 'Marquise', 'FANCY', 18, 22.1000, 14.8000, '2026-06-20', @full_polished, 'ISSUED', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, @admin_id),
('92125178', '652-099JJJ', @emp7, 'Oval', 'FANCY', 6, 8.4000, 5.6000, '2026-06-06', @full_polished, 'REWORK', '2026-06-25', 4.9000, 'I', 'SI2', 'VG VG VG', 'N.K.', 'IGI', 'Polish lines visible — return for rework', 19, 3.5000, 4410.00, @admin_id),
('92125200', '653-100KKK', @emp8, 'Radiant', 'FANCY', 22, 30.2000, 20.6000, '2026-06-09', @full_polished, 'VERIFIED', '2026-06-27', 20.1400, 'F', 'VS1', 'EX EX VG', 'J.J.', 'GIA', NULL, 18, 10.0600, 28196.00, @admin_id),
('92125222', '654-111LLL', @emp10, 'Pear', 'FANCY', 14, 18.9000, 12.8000, '2026-06-14', @full_polished, 'IN_PROGRESS', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, @admin_id),
('92125244', '655-122MMM', @emp10, 'Heart', 'FANCY', 9, 11.2000, 7.4000, '2026-06-01', @full_polished, 'VERIFIED', '2026-06-18', 6.8000, 'G', 'VVS1', 'EX EX EX', 'J.J.', 'IGI', 'Leakage: 5.7% — monitored', 17, 4.4000, 7480.00, @admin_id),
('92125266', '656-133NNN', @emp2, 'Emerald', 'FANCY', 5, 7.6000, 5.1000, '2026-06-22', @full_polished, 'ISSUED', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, @admin_id),
('92125288', '657-144OOO', @emp3, 'Round', 'ROUND', 35, 42.3000, 28.8000, '2026-06-25', @full_polished, 'ISSUED', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, @admin_id);
