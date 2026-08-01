-- Seed the recruitment pipeline
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);

INSERT INTO job_openings (title, department, grade, worker_type, openings, status, opened_at, notes, created_by, updated_by) VALUES
('Polishing Karigar (A+)', 'Polishing', 'A+', 'PIECE_RATE', 4, 'OPEN', '2026-06-15', 'Urgent requirement for the fancy shapes line', @admin_id, @admin_id),
('Blocking Operator', 'Blocking', 'A', 'PIECE_RATE', 2, 'OPEN', '2026-07-01', 'Experience with 4P blocking preferred', @admin_id, @admin_id),
('Assortment Assistant', 'Assortment', 'B', 'DHAR', 1, 'ON_HOLD', '2026-05-10', 'On hold pending budget approval', @admin_id, @admin_id);

SET @open_polish = (SELECT id FROM job_openings WHERE title = 'Polishing Karigar (A+)' LIMIT 1);
SET @open_block = (SELECT id FROM job_openings WHERE title = 'Blocking Operator' LIMIT 1);

INSERT INTO candidates
  (full_name, phone, email, opening_id, position_grade, worker_type, expected_salary, experience_years, source, status, interview_date, notes, created_by, updated_by)
VALUES
('Hitesh Ramani', '+91-9825011001', 'hitesh.ramani@example.com', @open_polish, 'A+', 'PIECE_RATE', 28000.00, 6.0, 'Referral', 'SELECTED', '2026-07-20 11:00:00', 'Strong on fancy shapes, negotiated rate agreed', @admin_id, @admin_id),
('Jignesh Vasani', '+91-9825011002', NULL, @open_polish, 'A', 'PIECE_RATE', 22000.00, 3.0, 'Walk-in', 'INTERVIEW', '2026-08-05 15:30:00', 'Second round scheduled', @admin_id, @admin_id),
('Bhavesh Kachhadiya', '+91-9825011003', NULL, @open_block, 'A', 'PIECE_RATE', 24000.00, 4.5, 'Agency', 'INTERVIEW', '2026-08-06 10:00:00', NULL, @admin_id, @admin_id),
('Nikita Solanki', '+91-9825011004', 'nikita.s@example.com', @open_polish, 'B', 'PIECE_RATE', 18000.00, 1.0, 'Referral', 'APPLIED', NULL, 'Fresher, trained at a local institute', @admin_id, @admin_id),
('Alpesh Dhameliya', '+91-9825011005', NULL, @open_block, 'A+', 'PIECE_RATE', 32000.00, 8.0, 'Walk-in', 'APPLIED', NULL, NULL, @admin_id, @admin_id),
('Rohit Tank', '+91-9825011006', NULL, @open_polish, 'B', 'PIECE_RATE', 20000.00, 2.0, 'Agency', 'REJECTED', '2026-07-11 12:00:00', 'Yield quality below requirement in the trial', @admin_id, @admin_id);
