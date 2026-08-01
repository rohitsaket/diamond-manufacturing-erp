-- Seed employees
SET @user_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

INSERT INTO employees (emp_code, full_name, short_name, grade, worker_type, work_status, whatsapp, joined_at, created_by) VALUES
('301', 'Jayesh Kumar Arora', 'J K A*', 'A*', 'PIECE_RATE', 'WORKING', '+91-9876540001', '2019-03-15', @user_id),
('302', 'Priya Mehta', 'P M', 'A+++', 'PIECE_RATE', 'WORKING', '+91-9876540002', '2020-07-01', @user_id),
('303', 'Ramesh Patel', 'R P', 'A++', 'PIECE_RATE', 'WORKING', '+91-9876540003', '2018-11-20', @user_id),
('DHAR-401', 'Dharampal Singh', 'D S', 'A+', 'DHAR', 'WORKING', NULL, '2021-02-10', @user_id),
('304', 'Suresh Bhai', 'S B', 'A', 'PIECE_RATE', 'WORKING', NULL, '2022-05-18', @user_id),
('MAXI', 'Maxi Unit', 'MAXI', 'A', 'MAXI', 'WORKING', NULL, '2017-01-01', @user_id),
('305', 'Kishore Nayak', 'K N', 'B', 'PIECE_RATE', 'WORKING', NULL, '2023-08-01', @user_id),
('306', 'Anita Shah', 'A S', 'A++', 'PIECE_RATE', 'WORKING', NULL, '2019-09-12', @user_id),
('307', 'Vinod Joshi', 'V J', 'A*', 'PIECE_RATE', 'RESIGN', NULL, '2016-06-20', @user_id),
('308', 'Lalita Bai', 'L B', 'A+', 'PIECE_RATE', 'WORKING', NULL, '2020-01-15', @user_id)
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);

-- Seed employee specialists
SET @emp1 = (SELECT id FROM employees WHERE emp_code = '301' LIMIT 1);
SET @emp2 = (SELECT id FROM employees WHERE emp_code = '302' LIMIT 1);
SET @emp3 = (SELECT id FROM employees WHERE emp_code = '303' LIMIT 1);
SET @emp4 = (SELECT id FROM employees WHERE emp_code = 'DHAR-401' LIMIT 1);
SET @emp5 = (SELECT id FROM employees WHERE emp_code = '304' LIMIT 1);
SET @emp6 = (SELECT id FROM employees WHERE emp_code = 'MAXI' LIMIT 1);
SET @emp7 = (SELECT id FROM employees WHERE emp_code = '305' LIMIT 1);
SET @emp8 = (SELECT id FROM employees WHERE emp_code = '306' LIMIT 1);
SET @emp9 = (SELECT id FROM employees WHERE emp_code = '307' LIMIT 1);
SET @emp10 = (SELECT id FROM employees WHERE emp_code = '308' LIMIT 1);

INSERT IGNORE INTO employee_specialists (employee_id, specialist_code) VALUES
(@emp1, 'EM'), (@emp1, 'RAD'),
(@emp2, 'PN'), (@emp2, 'OV'),
(@emp3, 'RD'), (@emp3, 'MQ'),
(@emp4, 'CU'), (@emp4, 'PR'),
(@emp5, 'RD'),
(@emp6, 'EM'), (@emp6, 'RD'), (@emp6, 'PN'),
(@emp7, 'OV'),
(@emp8, 'RAD'), (@emp8, 'CU'),
(@emp9, 'EM'), (@emp9, 'MQ'), (@emp9, 'CU'),
(@emp10, 'PN'), (@emp10, 'PR');
