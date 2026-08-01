-- Seed July 2026 production so the OPEN July salary period has real piece-rate
-- earnings to aggregate when payroll is recalculated.
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

SET @emp1 = (SELECT id FROM employees WHERE emp_code = '301' LIMIT 1);
SET @emp2 = (SELECT id FROM employees WHERE emp_code = '302' LIMIT 1);
SET @emp3 = (SELECT id FROM employees WHERE emp_code = '303' LIMIT 1);
SET @emp4 = (SELECT id FROM employees WHERE emp_code = 'DHAR-401' LIMIT 1);
SET @emp5 = (SELECT id FROM employees WHERE emp_code = '304' LIMIT 1);
SET @emp7 = (SELECT id FROM employees WHERE emp_code = '305' LIMIT 1);
SET @emp8 = (SELECT id FROM employees WHERE emp_code = '306' LIMIT 1);
SET @emp10 = (SELECT id FROM employees WHERE emp_code = '308' LIMIT 1);

SET @full_polished = (SELECT id FROM labour_heads WHERE code = 'FULL_POLISHED' LIMIT 1);
SET @blocking = (SELECT id FROM labour_heads WHERE code = 'BLOCKING' LIMIT 1);

INSERT INTO lots (lot_id, lot_name, employee_id, shape, shape_category, qty, issue_weight, estimate_wt, issue_date, labour_head_id, status, received_date, polished_wt, color, clarity, cut, grader, lab, remarks, days_consumed, weight_diff, labour_amount, created_by) VALUES
('92130010', '701-012AAA', @emp1, 'Emerald', 'FANCY', 14, 21.4000, 14.6000, '2026-07-02', @full_polished, 'VERIFIED', '2026-07-19', 14.3800, 'F', 'VS1', 'EX EX EX', 'J.J.', 'IGI', NULL, 17, 7.0200, 15818.00, @admin_id),
('92130032', '702-013BBB', @emp1, 'Round', 'ROUND', 26, 31.2000, 21.0000, '2026-07-08', @full_polished, 'RECEIVED', '2026-07-26', 20.7600, 'E', 'VVS2', 'EX EX EX', 'N.K.', 'GIA', NULL, 18, 10.4400, 18684.00, @admin_id),
('92130054', '703-014CCC', @emp2, 'Pear', 'FANCY', 22, 26.8000, 18.1000, '2026-07-03', @full_polished, 'VERIFIED', '2026-07-21', 17.9200, 'E', 'VVS2', 'EX VG EX', 'N.K.', 'GIA', NULL, 18, 8.8800, 25088.00, @admin_id),
('92130076', '704-015DDD', @emp2, 'Oval', 'FANCY', 11, 15.6000, 10.4000, '2026-07-14', @full_polished, 'RECEIVED', '2026-07-30', 10.2400, 'G', 'VS2', 'EX EX VG', 'J.J.', 'IGI', NULL, 16, 5.3600, 11264.00, @admin_id),
('92130098', '705-016EEE', @emp3, 'Round', 'ROUND', 34, 40.2000, 26.8000, '2026-07-01', @full_polished, 'VERIFIED', '2026-07-18', 26.1400, 'G', 'SI1', 'EX EX EX', 'J.J.', 'IGI', NULL, 17, 14.0600, 23526.00, @admin_id),
('92130111', '706-017FFF', @emp3, 'Cushion', 'FANCY', 9, 12.8000, 8.6000, '2026-07-16', @blocking, 'RECEIVED', '2026-07-29', 8.4200, 'H', 'VS2', 'VG EX VG', 'N.K.', 'IGI', NULL, 13, 4.3800, 7578.00, @admin_id),
('92130133', '707-018GGG', @emp4, 'Cushion', 'FANCY', 12, 16.9000, 11.4000, '2026-07-06', @blocking, 'VERIFIED', '2026-07-23', 11.2200, 'H', 'VS2', 'VG EX VG', 'N.K.', 'IGI', NULL, 17, 5.6800, 10098.00, @admin_id),
('92130155', '708-019HHH', @emp5, 'Round', 'ROUND', 28, 32.4000, 21.6000, '2026-07-04', @full_polished, 'VERIFIED', '2026-07-22', 21.2800, 'F', 'VS1', 'EX EX EX', 'J.J.', 'GIA', NULL, 18, 11.1200, 19152.00, @admin_id),
('92130177', '709-020III', @emp5, 'Princess', 'FANCY', 16, 20.6000, 13.8000, '2026-07-15', @full_polished, 'IN_PROGRESS', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, @admin_id),
('92130199', '710-021JJJ', @emp7, 'Oval', 'FANCY', 8, 10.8000, 7.2000, '2026-07-07', @full_polished, 'VERIFIED', '2026-07-24', 7.0400, 'I', 'SI2', 'VG VG VG', 'N.K.', 'IGI', NULL, 17, 3.7600, 6336.00, @admin_id),
('92130212', '711-022KKK', @emp8, 'Radiant', 'FANCY', 24, 33.6000, 22.8000, '2026-07-09', @full_polished, 'VERIFIED', '2026-07-27', 22.4600, 'F', 'VS1', 'EX EX VG', 'J.J.', 'GIA', NULL, 18, 11.1400, 31444.00, @admin_id),
('92130234', '712-023LLL', @emp10, 'Heart', 'FANCY', 10, 13.4000, 8.9000, '2026-07-05', @full_polished, 'VERIFIED', '2026-07-20', 8.7200, 'G', 'VVS1', 'EX EX EX', 'J.J.', 'IGI', NULL, 15, 4.6800, 9592.00, @admin_id),
('92130256', '713-024MMM', @emp10, 'Pear', 'FANCY', 13, 17.2000, 11.6000, '2026-07-17', @full_polished, 'RECEIVED', '2026-07-31', 11.4000, 'F', 'VS2', 'EX VG EX', 'N.K.', 'IGI', NULL, 14, 5.8000, 12540.00, @admin_id),
('92130278', '714-025NNN', @emp1, 'Marquise', 'FANCY', 19, 23.8000, 16.0000, '2026-07-25', @full_polished, 'ISSUED', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, @admin_id)
ON DUPLICATE KEY UPDATE lot_name = VALUES(lot_name);
