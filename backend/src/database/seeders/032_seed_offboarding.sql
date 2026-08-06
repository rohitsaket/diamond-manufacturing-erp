-- Offboarding master data: notice rules, the exit survey, one live
-- resignation case awaiting approval, and the historical exit of Vinod Joshi
-- (already RESIGN in the employee seed) registered as an alumnus.
SET @admin_id = (SELECT id FROM users WHERE email = 'admin@harene.com' LIMIT 1);
SET @emp_306 = (SELECT id FROM employees WHERE emp_code = '306' LIMIT 1);
SET @emp_307 = (SELECT id FROM employees WHERE emp_code = '307' LIMIT 1);
SET @dept_polish = (SELECT id FROM departments WHERE code = 'DEPT-POLISH' LIMIT 1);

-- Notice rules (editable configuration, not legal advice) --------------------
INSERT INTO notice_rules (worker_type, grade, notice_days, buyout_allowed, buyout_rate_basis, description, is_active, created_by) VALUES
('PIECE_RATE', NULL, 30, true, 'PER_DAY_GROSS', 'Piece-rate karigars - one month notice', true, @admin_id),
('DHAR', NULL, 30, true, 'PER_DAY_GROSS', 'Dhar workers - one month notice', true, @admin_id),
('MAXI', NULL, 45, false, 'PER_DAY_GROSS', 'Maxi operators - 45 days, no buyout (machine handover)', true, @admin_id)
ON DUPLICATE KEY UPDATE notice_days = VALUES(notice_days);

-- Exit survey ------------------------------------------------------------------
INSERT INTO exit_survey_questions (question, kind, choices_json, sort_order, is_active) VALUES
('What is the main reason you are leaving?', 'CHOICE', '["Better pay elsewhere", "Family or relocation", "Health", "Work environment", "Career growth", "Starting own work", "Other"]', 1, true),
('How satisfied were you with your pay and incentives?', 'RATING', NULL, 2, true),
('How satisfied were you with the work environment and safety?', 'RATING', NULL, 3, true),
('How satisfied were you with your manager and supervision?', 'RATING', NULL, 4, true),
('Did you have the tools and materials you needed to do good work?', 'RATING', NULL, 5, true),
('Would you recommend Harene as a place to work?', 'RATING', NULL, 6, true),
('What should the company improve first?', 'TEXT', NULL, 7, true),
('Anything else you would like to share?', 'TEXT', NULL, 8, true)
ON DUPLICATE KEY UPDATE question = VALUES(question);

-- Live resignation case: Anita Shah, awaiting approval ---------------------------
INSERT INTO separations (sep_code, employee_id, separation_type, status, reason, resignation_date, notice_days, notice_start, notice_end, last_working_day, created_by)
SELECT 'SEP-2026-001', @emp_306, 'RESIGNATION', 'PENDING_APPROVAL', 'Relocating to Mumbai for family reasons.', '2026-08-03', 30, '2026-08-04', '2026-09-02', '2026-09-02', @admin_id
WHERE NOT EXISTS (SELECT 1 FROM separations WHERE sep_code = 'SEP-2026-001');

SET @sep_1 = (SELECT id FROM separations WHERE sep_code = 'SEP-2026-001' LIMIT 1);

INSERT INTO separation_events (separation_id, event, note, created_by)
SELECT @sep_1, 'SUBMITTED', 'Resignation submitted through the portal', @admin_id
WHERE NOT EXISTS (SELECT 1 FROM separation_events WHERE separation_id = @sep_1 AND event = 'SUBMITTED');

-- Historical completed exit: Vinod Joshi (work_status already RESIGN) -----------
INSERT INTO separations (sep_code, employee_id, separation_type, status, reason, resignation_date, notice_days, notice_start, notice_end, last_working_day, approved_by, approved_at, rehire_eligible, rehire_note, completed_at, created_by)
SELECT 'SEP-2025-001', @emp_307, 'RESIGNATION', 'COMPLETED', 'Moved to a family diamond unit in Bhavnagar.', '2025-11-15', 30, '2025-11-16', '2025-12-15', '2025-12-15', @admin_id, '2025-11-18 10:00:00', true, 'Strong performer - welcome back for fancy shapes.', '2025-12-15 18:00:00', @admin_id
WHERE NOT EXISTS (SELECT 1 FROM separations WHERE sep_code = 'SEP-2025-001');

SET @sep_2 = (SELECT id FROM separations WHERE sep_code = 'SEP-2025-001' LIMIT 1);

INSERT INTO alumni (employee_id, separation_id, exit_date, last_grade, last_department, contact_phone, rehire_eligible, is_boomerang, in_alumni_network, notes)
SELECT @emp_307, @sep_2, '2025-12-15', 'A*', 'Polishing', '+91-9876540007', true, false, true, 'Keeps in touch with the floor - attends Diwali gathering.'
WHERE NOT EXISTS (SELECT 1 FROM alumni WHERE employee_id = @emp_307);
